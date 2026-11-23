// Only the embedded TV uses loopback. Phone links always use the current LAN IP.
const embedded = location.origin === 'http://127.0.0.1:8787' && new URL(location.href).searchParams.get('tvShell') === 'android';
let origin: string | null = embedded ? null : location.origin;
const listeners = new Set<() => void>();
export const joinOrigin = () => origin;
export function watchJoinOrigin(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
if (embedded) {
  const refresh = async () => {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 2500);
    let next: string | null = null;
    try {
      const response = await fetch('/api/local-info', { cache: 'no-store', signal: abort.signal });
      const value = await response.json();
      if (value.mode === 'local' && typeof value.joinOrigin === 'string') {
        const candidate = new URL(value.joinOrigin);
        if (candidate.protocol === 'http:' && /^(\d{1,3}\.){3}\d{1,3}$/.test(candidate.hostname) && !candidate.hostname.startsWith('127.') && !candidate.username && !candidate.password && candidate.port === '8787' && candidate.pathname === '/' && !candidate.search && !candidate.hash) next = candidate.origin;
      }
    } catch { /* Never show a stale or loopback QR after network loss. */ }
    finally { clearTimeout(timer); }
    if (next !== origin) { origin = next; listeners.forEach(listener => listener()); }
    setTimeout(refresh, 3000);
  };
  void refresh();
}
