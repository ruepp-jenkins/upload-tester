import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

const clientDir = fileURLToPath(new URL('../client', import.meta.url));

interface Progress {
  received: number;
  done: boolean;
  aborted: boolean;
}

// Live byte counters per client-supplied upload id, so the UI can show how far the server really got.
// Shared by the HTTP and HTTPS listeners: the page may be opened on either.
const uploads = new Map<string, Progress>();

/** Builds the app. `httpsPort` is only reported to the UI, which links to it for HTTP/2-only features. */
export async function buildApp(
  options: { httpsPort: number | null; https?: { key: string; cert: string } },
): Promise<FastifyInstance> {
  const common = {
    logger: true,
    // No application-level limit: limits under test come from the infrastructure.
    bodyLimit: Number.MAX_SAFE_INTEGER,
    connectionTimeout: 0,
    requestTimeout: 0,
  };
  const app = (
    options.https
      ? Fastify({ ...common, http2: true, https: { ...options.https, allowHTTP1: true } })
      : Fastify(common)
  ) as unknown as FastifyInstance;

  // Hand every body (whatever its content type) to the route as an unparsed stream.
  app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/info', async () => ({ httpsPort: options.httpsPort }));

  app.get<{ Params: { id: string } }>('/api/upload/:id/progress', async (request, reply) => {
    const progress = uploads.get(request.params.id);
    if (!progress) return reply.code(404).send({ error: 'unknown upload id' });
    return progress;
  });

  app.post('/api/upload', async (request, reply) => {
    const started = performance.now();
    const id = request.headers['x-upload-id'];
    const progress: Progress = { received: 0, done: false, aborted: false };
    if (typeof id === 'string' && id.length <= 64) uploads.set(id, progress);
    try {
      for await (const chunk of request.raw as AsyncIterable<Buffer>) {
        progress.received += chunk.length;
      }
    } catch (err) {
      progress.aborted = true;
      request.log.warn({ received: progress.received, err }, 'upload aborted');
      return reply.hijack();
    } finally {
      progress.done = true;
      if (typeof id === 'string') setTimeout(() => uploads.delete(id), 60_000).unref();
    }
    request.log.info({ received: progress.received }, 'upload received');
    return reply
      .header('X-Duration-Ms', Math.round(performance.now() - started))
      .type('text/plain')
      .send(String(progress.received));
  });

  await app.register(fastifyStatic, { root: clientDir });
  return app;
}
