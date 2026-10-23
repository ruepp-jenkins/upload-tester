import { generate } from 'selfsigned';
import { buildApp, normalizeBasePath } from './app.js';

const port = Number(process.env.PORT ?? 8080);
// Browsers only allow streamed request bodies (the slow-upload test) over HTTP/2, which they only speak over TLS.
// 0 switches the HTTPS listener off.
const httpsPort = Number(process.env.HTTPS_PORT ?? 8443);
// Everything is served below this path only, e.g. BASE_PATH=/upload/tester. Default: the root.
const basePath = normalizeBasePath(process.env.BASE_PATH);

try {
  const http = await buildApp({ basePath, httpsPort: httpsPort > 0 ? httpsPort : null });
  await http.listen({ port, host: '0.0.0.0' });

  if (httpsPort > 0) {
    const pems = await generate([{ name: 'commonName', value: 'upload-tester' }], {
      notAfterDate: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000),
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }],
    });
    const https = await buildApp({ basePath, httpsPort, https: { key: pems.private, cert: pems.cert } });
    await https.listen({ port: httpsPort, host: '0.0.0.0' });
    https.log.info('HTTPS/HTTP2 listener uses a self-signed certificate; accept the browser warning once');
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
