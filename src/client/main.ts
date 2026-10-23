import { UNITS, formatBytes, parseSize } from '../shared/units';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('form');
const sizeInput = $<HTMLInputElement>('size');
const unitSelect = $<HTMLSelectElement>('unit');
const fileInput = $<HTMLInputElement>('file');
const slowCheckbox = $<HTMLInputElement>('slow');
const rateInput = $<HTMLInputElement>('rate');
const rateUnit = $<HTMLSelectElement>('rate-unit');
const sendButton = $<HTMLButtonElement>('send');
const stopButton = $<HTMLButtonElement>('stop');
const maxStart = $<HTMLButtonElement>('max-start');

for (const select of [unitSelect, rateUnit, $<HTMLSelectElement>('max-cap-unit'), $<HTMLSelectElement>('max-precision-unit')]) {
  for (const unit of UNITS) select.add(new Option(unit.label, unit.label));
}
unitSelect.value = 'MiB';
rateUnit.value = 'KB';
$<HTMLSelectElement>('max-cap-unit').value = 'TiB';
$<HTMLSelectElement>('max-precision-unit').value = 'KiB';

const human = (bytes: number) => {
  const { decimal, binary } = formatBytes(bytes);
  return decimal === binary ? decimal : `${binary} / ${decimal}`;
};
const withHuman = (bytes: number) => `${bytes} B (${human(bytes)})`;

/** Fills a stat tile with a human-readable headline and the exact figures on a second line. */
function setStat(id: string, main: string, sub = '') {
  const head = document.createElement('span');
  head.className = 'main';
  head.textContent = main;
  const nodes: HTMLElement[] = [head];
  if (sub) {
    const line = document.createElement('span');
    line.className = 'sub';
    line.textContent = sub;
    nodes.push(line);
  }
  $(id).replaceChildren(...nodes);
}
const mode = () => (form.elements.namedItem('mode') as RadioNodeList).value;

function formatDuration(ms: number): string {
  const total = ms / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toFixed(1).padStart(4, '0');
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function selectedSize(): number | null {
  if (mode() === 'file') return fileInput.files?.[0]?.size ?? null;
  try {
    return parseSize(sizeInput.valueAsNumber, unitSelect.value);
  } catch {
    return null;
  }
}

function selectedRate(): number | null {
  try {
    const rate = parseSize(rateInput.valueAsNumber, rateUnit.value);
    return rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

function refresh() {
  const isFile = mode() === 'file';
  $('generated-fields').hidden = isFile;
  $('file-fields').hidden = !isFile;
  const size = selectedSize();
  const text = size === null ? '' : `= ${withHuman(size)}`;
  $(isFile ? 'file-preview' : 'size-preview').textContent = text;

  const slow = slowCheckbox.checked;
  rateInput.disabled = rateUnit.disabled = !slow;
  $('slow-hint').hidden = !slow;
  const rate = selectedRate();
  $('eta').textContent = slow && size !== null && rate !== null ? `≈ ${formatDuration((size / rate) * 1000)} total` : '';
  sendButton.disabled = size === null || (slow && rate === null) || busy;
}

/**
 * Builds a body of exactly `size` bytes without allocating it all: blobs only reference their parts, so a
 * 1 MiB chunk is reused for a 1 GiB block, which is reused for the bulk of the payload (1 TiB is ~1000 parts).
 */
function generatePayload(size: number): Blob {
  const MiB = 1024 * 1024;
  const GiB = 1024 * MiB;
  const chunk = new Blob([new Uint8Array(Math.min(size, MiB))]);
  const block = size >= GiB ? new Blob(Array<Blob>(1024).fill(chunk)) : chunk;
  const parts: BlobPart[] = Array<Blob>(Math.floor(size / GiB)).fill(block);
  let rest = size % GiB;
  for (; rest >= MiB; rest -= MiB) parts.push(chunk);
  if (rest > 0) parts.push(chunk.slice(0, rest));
  return new Blob(parts, { type: 'application/octet-stream' });
}

/** Re-emits the blob's bytes at roughly `bytesPerSecond`. */
function throttledStream(body: Blob, bytesPerSecond: number, onSent: (n: number) => void, signal: AbortSignal) {
  const reader = body.stream().getReader();
  const started = performance.now();
  let sent = 0;
  let pending = new Uint8Array(0);
  const tickMs = 100;

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        while (pending.length === 0) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          pending = value;
        }
        // Wait until the budget (rate x elapsed) allows at least one more byte.
        let allowed: number;
        for (;;) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          allowed = Math.floor(((performance.now() - started) / 1000) * bytesPerSecond) + 1 - sent;
          if (allowed > 0) break;
          await new Promise((r) => setTimeout(r, Math.min(tickMs, 1000 / bytesPerSecond)));
        }
        const n = Math.min(allowed, pending.length, 64 * 1024);
        controller.enqueue(pending.subarray(0, n));
        pending = pending.subarray(n);
        sent += n;
        onSent(sent);
      },
      cancel: () => reader.cancel(),
    },
    { highWaterMark: 0 },
  );
}

interface RawResult {
  status: number;
  statusText: string;
  headers: string;
  text: string;
  error?: string;
}

interface Outcome {
  ok: boolean;
  sent: number;
  received: number | null;
  raw: RawResult;
  serverSeen: number | null;
  clientSent: number;
  durationMs: number;
  avgBytesPerSecond: number;
}

let busy = false;
let currentAbort: AbortController | null = null;

function sendXhr(body: Blob, id: string, onSent: (n: number) => void, signal: AbortSignal): Promise<RawResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const done = (error?: string) =>
      resolve({
        status: error ? 0 : xhr.status,
        statusText: xhr.statusText,
        headers: error ? '' : xhr.getAllResponseHeaders(),
        text: error ? '' : xhr.responseText,
        error,
      });
    xhr.upload.onprogress = (e) => onSent(e.loaded);
    xhr.onload = () => done();
    xhr.onerror = () => done('Network error: connection closed or blocked before a response arrived');
    xhr.onabort = () => done('Aborted');
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('X-Upload-Id', id);
    xhr.send(body);
  });
}

async function sendStream(body: Blob, rate: number, id: string, onSent: (n: number) => void, signal: AbortSignal): Promise<RawResult> {
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'X-Upload-Id': id, 'Content-Type': 'application/octet-stream' },
      body: throttledStream(body, rate, onSent, signal),
      // @ts-expect-error `duplex` is required for streamed bodies but missing from lib.dom
      duplex: 'half',
      signal,
    });
    const headers = [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
    return { status: res.status, statusText: res.statusText, headers, text: await res.text() };
  } catch (e) {
    const aborted = signal.aborted;
    return {
      status: 0,
      statusText: '',
      headers: '',
      text: '',
      error: aborted
        ? 'Aborted'
        : `Network error: ${e instanceof Error ? e.message : String(e)} (streamed uploads need HTTP/2 or HTTP/3 - open the page over HTTPS - or the connection was closed/blocked)`,
    };
  }
}

/** Runs one upload, driving the live panel (progress, speed, stopwatch). Resolves when it ends for any reason. */
async function runUpload(body: Blob, slowRate: number | null, signal: AbortSignal): Promise<Outcome> {
  const id = crypto.randomUUID();
  const started = performance.now();
  let clientSent = 0;
  let serverSeen: number | null = null;
  let state = 'Uploading…';
  let finished = false;
  let frozenMs = 0;
  // Recent (time, bytes) samples; the current speed is measured over the last couple of seconds.
  const samples: { ms: number; bytes: number }[] = [];

  $('live').hidden = false;
  const progress = $<HTMLProgressElement>('progress');
  const render = () => {
    const ms = finished ? frozenMs : performance.now() - started;
    const seconds = Math.max(ms / 1000, 0.001);
    progress.value = body.size === 0 ? 100 : (clientSent / body.size) * 100;
    setStat('live-sent', `${human(clientSent)} of ${human(body.size)} (${progress.value.toFixed(1)}%)`, `${clientSent} of ${body.size} B`);
    if (serverSeen === null) setStat('live-server', '–');
    else setStat('live-server', human(serverSeen), `${serverSeen} B`);
    const average = `${human(clientSent / seconds)}/s average`;
    if (finished) {
      setStat('live-speed', average);
    } else {
      samples.push({ ms, bytes: clientSent });
      while (samples.length > 2 && ms - samples[0]!.ms > 2000) samples.shift();
      const first = samples[0]!;
      const current = ms > first.ms ? ((clientSent - first.bytes) / (ms - first.ms)) * 1000 : 0;
      setStat('live-speed', `${human(current)}/s now`, average);
    }
    $('live-elapsed').textContent = formatDuration(ms);
    $('live-state').textContent = state;
  };
  const poll = async () => {
    try {
      const res = await fetch(`/api/upload/${id}/progress`, { cache: 'no-store' });
      if (res.ok) serverSeen = ((await res.json()) as { received: number }).received;
    } catch {
      /* the server may be unreachable mid-test; keep the last value */
    }
  };
  const timer = setInterval(render, 50);
  const pollTimer = setInterval(() => void poll().then(render), 300);
  render();

  const onSent = (n: number) => {
    clientSent = n;
  };
  const raw = slowRate === null ? await sendXhr(body, id, onSent, signal) : await sendStream(body, slowRate, id, onSent, signal);

  finished = true;
  frozenMs = performance.now() - started;
  clearInterval(timer);
  clearInterval(pollTimer);
  await poll();

  const text = raw.text.trim();
  const received = /^\d+$/.test(text) ? Number(text) : null;
  const ok = !raw.error && raw.status >= 200 && raw.status < 300 && received === body.size;
  if (ok) clientSent = body.size;
  state = raw.error
    ? `Stopped: ${raw.error}`
    : ok
      ? 'Done'
      : `Finished with HTTP ${raw.status}`;
  if (!ok && serverSeen !== null) state += ` – server had seen ${serverSeen} B`;
  render();
  return { ok, sent: body.size, received, raw, serverSeen, clientSent, durationMs: frozenMs, avgBytesPerSecond: clientSent / Math.max(frozenMs / 1000, 0.001) };
}

function showResult(o: Outcome) {
  $('result').hidden = false;
  const verdict = $('verdict');
  verdict.className = o.ok ? 'ok' : 'bad';
  verdict.textContent = o.raw.error
    ? `✘ ${o.raw.error}`
    : o.ok
      ? '✔ Server received exactly what was sent'
      : o.received !== null && o.raw.status < 300
        ? '✘ Byte count mismatch'
        : `✘ Upload failed (HTTP ${o.raw.status})`;
  setStat('sent', human(o.sent), `${o.sent} B`);
  // The server's answer is shown 1:1, exactly as it came back.
  if (o.received === null) setStat('received', '–');
  else setStat('received', human(o.received), `${o.received} B`);
  $('status').textContent = o.raw.error ? '–' : `${o.raw.status} ${o.raw.statusText}`;
  $('duration').textContent = formatDuration(o.durationMs);
  $('avg-speed').textContent = `${human(o.avgBytesPerSecond)}/s`;
  $('raw-text').textContent = o.raw.error
    ? o.raw.error
    : `HTTP ${o.raw.status} ${o.raw.statusText}\n${o.raw.headers}\n${o.raw.text}`;
}

function setBusy(value: boolean) {
  busy = value;
  stopButton.hidden = !value;
  maxStart.disabled = value;
  refresh();
}

async function guarded<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  currentAbort = new AbortController();
  setBusy(true);
  try {
    return await fn(currentAbort.signal);
  } finally {
    setBusy(false);
    currentAbort = null;
  }
}

form.addEventListener('input', refresh);
form.addEventListener('change', refresh);
stopButton.addEventListener('click', () => currentAbort?.abort());

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const size = selectedSize();
  if (size === null) return;
  const body = mode() === 'file' ? fileInput.files![0]! : generatePayload(size);
  const rate = slowCheckbox.checked ? selectedRate() : null;
  $('result').hidden = true;
  void guarded(async (signal) => showResult(await runUpload(body, rate, signal)));
});

maxStart.addEventListener('click', () => {
  let cap: number, precision: number;
  try {
    cap = parseSize($<HTMLInputElement>('max-cap').valueAsNumber, $<HTMLSelectElement>('max-cap-unit').value);
    precision = Math.max(1, parseSize($<HTMLInputElement>('max-precision').valueAsNumber, $<HTMLSelectElement>('max-precision-unit').value));
  } catch (err) {
    $('max-result').textContent = String(err instanceof Error ? err.message : err);
    return;
  }
  const log = $('max-log');
  const result = $('max-result');
  log.textContent = '';
  result.textContent = '';
  result.className = '';
  $('result').hidden = true;

  void guarded(async (signal) => {
    let probes = 0;
    const probe = async (size: number) => {
      probes++;
      const o = await runUpload(generatePayload(size), null, signal);
      log.textContent += `#${probes}: ${withHuman(size)} → ${o.ok ? 'accepted' : `rejected (${o.raw.error ?? `HTTP ${o.raw.status}`}, server saw ${o.serverSeen ?? '?'} B)`}\n`;
      return o.ok;
    };
    log.style.whiteSpace = 'pre-wrap';

    let good = 0;
    let bad: number | null = null;
    let size = Math.min(1024 * 1024, cap);
    while (!signal.aborted) {
      if (await probe(size)) {
        good = size;
        if (size >= cap) break;
        size = Math.min(size * 2, cap);
      } else {
        bad = size;
        break;
      }
    }
    while (!signal.aborted && bad !== null && bad - good > precision) {
      const mid = good + Math.floor((bad - good) / 2);
      if (await probe(mid)) good = mid;
      else bad = mid;
    }

    if (signal.aborted) {
      result.textContent = 'Aborted';
      return;
    }
    if (bad === null) {
      result.className = 'ok';
      result.textContent = `✔ No limit found up to ${withHuman(cap)} (${probes} uploads)`;
    } else {
      result.className = 'ok';
      result.textContent = `Maximum accepted size: ${withHuman(good)} – first rejected: ${withHuman(bad)} (±${human(bad - good)} precision, ${probes} uploads)`;
    }
  });
});

refresh();
