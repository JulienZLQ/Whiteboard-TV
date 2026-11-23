import type { IncomingMessage } from 'node:http';

/** Never accept DNS names: prevents a web page rebinding its hostname to the TV. */
export function localRequestAllowed(req: IncomingMessage, joinOrigin: string | null) {
  const local = `http://127.0.0.1:${req.socket.localPort}`;
  const requested = `http://${req.headers.host}`;
  if (requested !== local && requested !== joinOrigin) return false;
  // WebView 66 emits Origin:null on same-origin fetch with no-referrer.
  // Restrict that compatibility case to the embedded shell on the loopback socket.
  const legacyShell = requested === local && req.socket.remoteAddress === '127.0.0.1'
    && req.headers.origin === 'null' && (req.headers['user-agent'] || '').includes(' WhiteboardTV/');
  return !req.headers.origin || req.headers.origin === requested || legacyShell;
}
