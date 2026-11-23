import type { Credentials } from '@whiteboard/board-core';

export const androidTV = () => new URL(location.href).searchParams.get('tvShell') === 'android';
const credentialKey = (roomId: string, role: Credentials['role']) => `whiteboard.credentials.${roomId}.${role}`;
export function saveCredentials(credentials: Credentials) {
  try { sessionStorage.setItem(credentialKey(credentials.roomId, credentials.role), JSON.stringify(credentials)); } catch { /* live session remains available */ }
  if (androidTV() && credentials.role === 'viewer') {
    try { localStorage.setItem('whiteboard.tv.last', JSON.stringify(credentials)); } catch { /* restoration unavailable */ }
  }
}
export function loadCredentials(roomId: string, role: Credentials['role']): Credentials | null {
  try {
    const raw = sessionStorage.getItem(credentialKey(roomId, role)) ?? (androidTV() && role === 'viewer' ? localStorage.getItem('whiteboard.tv.last') : null);
    const value = JSON.parse(raw ?? 'null') as Credentials | null;
    return value?.roomId === roomId && value.role === role && /^[a-f0-9]{64}$/.test(value.token) ? value : null;
  } catch { return null; }
}

declare global { interface Window { WhiteboardTV?: { key: (key: string) => boolean; back: () => boolean } } }
const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]';
function controls(): HTMLElement[] {
  const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
  const scope = dialogs.at(-1) ?? document;
  return [...scope.querySelectorAll<HTMLElement>(selector)].filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
}
function focus(el?: HTMLElement) { el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
export function installTVNavigation() {
  if (new URL(location.href).searchParams.get('mode') !== 'tv') return () => {};
  document.documentElement.classList.add('tv-navigation');
  const key = (key: string): boolean => {
    const items = controls(); if (!items.length) return false;
    const active = document.activeElement as HTMLElement;
    if (active instanceof HTMLInputElement && !active.readOnly && active.type !== 'checkbox') return false;
    if (key === 'Enter') {
      if (!items.includes(active)) focus(items.find(el => el.matches('.primary')) ?? items[0]);
      else if (!(active instanceof HTMLSelectElement)) active.click();
      return true;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return false;
    if (!items.includes(active)) { focus(items.find(el => el.matches('.primary')) ?? items[0]); return true; }
    if (active instanceof HTMLSelectElement && (key === 'ArrowUp' || key === 'ArrowDown')) {
      active.selectedIndex = Math.max(0, Math.min(active.options.length - 1, active.selectedIndex + (key === 'ArrowDown' ? 1 : -1)));
      active.dispatchEvent(new Event('change', { bubbles: true })); return true;
    }
    const rect = active.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight', sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    const candidates = items.filter(el => el !== active).map(el => {
      const r = el.getBoundingClientRect(), dx = r.x + r.width / 2 - x, dy = r.y + r.height / 2 - y;
      const forward = (horizontal ? dx : dy) * sign, side = Math.abs(horizontal ? dy : dx);
      return { el, forward, score: forward + side * 2 + side * side / Math.max(forward, 1) };
    }).filter(c => c.forward > 1).sort((a,b) => a.score - b.score);
    focus(candidates[0]?.el); return true;
  };
  const back = () => {
    const dialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
    if (!dialog) return false;
    dialog.dispatchEvent(new Event('cancel', { cancelable: true })); return true;
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { if (back()) event.preventDefault(); }
    else if (key(event.key)) event.preventDefault();
  };
  const restoreFocus = () => {
    const items = controls(); if (!items.includes(document.activeElement as HTMLElement)) focus(items.find(el => el.matches('.primary')) ?? items[0]);
  };
  // Watch structure and availability, not the canvas attributes updated each frame.
  const observer = new MutationObserver(restoreFocus);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'open'] });
  window.WhiteboardTV = { key, back }; window.addEventListener('keydown', onKey); restoreFocus();
  return () => { observer.disconnect(); window.removeEventListener('keydown', onKey); delete window.WhiteboardTV; document.documentElement.classList.remove('tv-navigation'); };
}
