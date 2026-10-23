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

/** Turns `upload/tester/`, `/upload//tester` etc. into `/upload/tester`; empty means the root. */
export function normalizeBasePath(raw: string | undefined): string {
  const segments = (raw ?? '').split('/').filter(Boolean);
  return segments.length > 0 ? `/${segments.join('/')}` : '';
}

/**
 * Builds the app. Everything (UI and API) is served below `basePath` and nowhere else.
 * `httpsPort` is only reported to the UI, which links to it for HTTP/2-only features.
 */
export async function buildApp(
  options: { basePath: string; httpsPort: number | null; https?: { key: string; cert: string } },
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

  if (options.basePath) {
    // The page's relative URLs resolve against a trailing slash, so /base must lead to /base/.
    app.get(options.basePath, async (request, reply) => {
      const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
      return reply.redirect(`${options.basePath}/${query}`, 301);
    });
  }

  await app.register(
    async (scope) => {
      // Hand every body (whatever its content type) to the route as an unparsed stream.
      scope.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

      scope.get('/api/health', async () => ({ status: 'ok' }));
      scope.get('/api/info', async () => ({ httpsPort: options.httpsPort }));

      scope.get<{ Params: { id: string } }>('/api/upload/:id/progress', async (request, reply) => {
        const progress = uploads.get(request.params.id);
        if (!progress) return reply.code(404).send({ error: 'unknown upload id' });
        return progress;
      });

      scope.post('/api/upload', async (request, reply) => {
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

      // `redirect` sends /base to /base/, which the UI's relative URLs rely on.
      await scope.register(fastifyStatic, { root: clientDir, redirect: true });
    },
    { prefix: options.basePath },
  );
  return app;
}
