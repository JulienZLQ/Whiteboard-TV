import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWhiteboardServer } from './server';

const host = process.env.HOST ?? '127.0.0.1';
const app = createWhiteboardServer({
  dataDir: resolve(process.env.DATA_DIR ?? '.data'),
  webRoot: resolve(fileURLToPath(new URL('../../web/dist', import.meta.url))),
});
const port = await app.listen(Number(process.env.PORT ?? 8787), host);
console.log(`Whiteboard TV M3 history preview: http://${host}:${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
