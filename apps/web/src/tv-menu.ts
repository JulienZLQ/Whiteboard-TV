import './tv-presentation.css';

const nativeShell = () => /WhiteboardTV\//.test(navigator.userAgent);
function showDialog(title: string, message: string, actions: [string, () => void][]) {
  if (document.querySelector('dialog.tv-menu[open]')) return;
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog'); dialog.className = 'tv-menu';
  dialog.setAttribute('aria-label', title);
  const heading = document.createElement('h2'); heading.textContent = title; dialog.appendChild(heading);
  if (message) { const p = document.createElement('p'); p.textContent = message; dialog.appendChild(p); }
  dialog.addEventListener('close', () => { dialog.remove(); previous?.focus(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  for (const [label, action] of actions) {
    const button = document.createElement('button'); button.textContent = label;
    button.onclick = () => { dialog.close(); action(); }; dialog.appendChild(button);
  }
  document.body.appendChild(dialog); dialog.showModal(); dialog.querySelector('button')?.focus();
}
export function closeTVDialog() {
  const dialog = document.querySelector<HTMLDialogElement>('dialog.tv-menu[open]');
  if (!dialog) return false;
  dialog.close(); return true;
}
export function browserTVBack() {
  if (nativeShell()) return false; // Android owns the application exit confirmation.
  showDialog('退出白板？', '已同步的内容会保留。退出后返回白板首页。', [
    ['继续展示', () => {}], ['退出白板', () => { location.href = location.pathname + '?mode=tv'; }],
  ]);
  return true;
}
export function openTVMenu() {
  if (nativeShell()) { location.href = '/__whiteboard_tv__/menu'; return; }
  showDialog('电视白板', '', [
    ['继续展示', () => {}], ['重新加载', () => location.reload()],
    ['新建白板', () => showDialog('新建白板？', '当前白板仍会保留，手机成员可以继续使用。', [
      ['取消', () => {}], ['新建', () => { location.href = location.pathname + '?mode=tv'; }],
    ])],
    ['退出白板', () => { browserTVBack(); }],
  ]);
}
