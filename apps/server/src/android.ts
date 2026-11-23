import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWhiteboardServer } from './server';
import { localRequestAllowed } from './local-policy';

// All paths and the control secret come from the private Android service, not HTTP.
const [root, dataDir, statusPath, networkPath, stopToken] = process.argv.slice(2);
if (!root || !dataDir || !statusPath || !networkPath || !/^[a-f0-9]{64}$/.test(stopToken || '')) throw new Error('Invalid local host configuration');
const port = 8787;
function joinOrigin(): string | null {
  try {
    const { address } = JSON.parse(readFileSync(networkPath, 'utf8'));
    // Java selects a real Wi-Fi/Ethernet link address; never accept arbitrary URLs.
    if (typeof address === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(address) && address.split('.').every(x => Number(x) <= 255) && !address.startsWith('127.') && !address.startsWith('0.')) return `http://${address}:${port}`;
  } catch { /* Network disconnected or being replaced. */ }
  return null;
}
let stopping = false;
const app = createWhiteboardServer({ dataDir, webRoot: resolve(root, 'web'), local: {
  joinOrigin, allowRequest: req => localRequestAllowed(req, joinOrigin()), stopToken,
  stop: () => { if (stopping) return; stopping = true; void app.close().then(() => process.exit(0), () => process.exit(1)); },
} });
function status(value: object) { writeFileSync(statusPath + '.tmp', JSON.stringify(value), { mode: 0o600 }); renameSync(statusPath + '.tmp', statusPath); }
app.listen(port, '0.0.0.0').then(() => status({ ready: true, port }), error => {
  status({ ready: false, error: error.code === 'EADDRINUSE' ? '本地端口被占用，请关闭占用 8787 端口的应用后重试' : '本地服务启动失败，请重新打开应用' });
  process.exitCode = 1;
});
