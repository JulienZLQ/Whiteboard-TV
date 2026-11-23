import { fitBounds, type Camera } from '@whiteboard/board-core';

/** Rows follow the screen: header → welcome (before creation), or header → QR → view. Left of the views reaches the UI toggle. */
export function rowNavigation() {
  let column = 0;
  return (key: string, active: HTMLElement, items: HTMLElement[]): boolean => {
    const row = active.dataset.tvRow;
    if (!row || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return false;
    const same = items.filter(el => el.dataset.tvRow === row);
    if (row === 'view') column = same.indexOf(active);
    const move = (target: string, index = 0) => {
      const next = items.filter(el => el.dataset.tvRow === target);
      next[Math.min(index, next.length - 1)]?.focus();
    };
    if (row === 'visibility') {
      if (key === 'ArrowRight') move('view', column);
      if (key === 'ArrowUp') move('header');
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const index = same.indexOf(active) + (key === 'ArrowRight' ? 1 : -1);
      if (row === 'view' && index < 0) move('visibility');
      else same[Math.max(0, Math.min(same.length - 1, index))]?.focus();
    } else if (key === 'ArrowUp') {
      if (row === 'view') move(items.some(el => el.dataset.tvRow === 'join') ? 'join' : 'header');
      if (row === 'join' || row === 'welcome') move('header', 1);
    } else {
      if (row === 'header') {
        const target = ['join', 'view', 'welcome'].find(target => items.some(el => el.dataset.tvRow === target));
        if (target) move(target, target === 'view' ? column : 0);
      }
      if (row === 'join') move('view', column);
    }
    return true;
  };
}

// Fit to the actual unobstructed rectangle, with no arbitrary padding or zoom cap.
export function fitTVContent(bounds: Parameters<typeof fitBounds>[0], width: number, height: number, joinVisible: boolean): Camera {
  if (document.documentElement.classList.contains('tv-ui-hidden')) return fitBounds(bounds, { width, height });
  const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
  const header = rect('.brand'), status = rect('.collaboration, .connection');
  const toggle = rect('.qr-toggle, #toggle-qr'), footer = rect('.zoom-controls, #view-controls');
  const qr = rect('.tv-qr-content, #qr-content');
  const top = Math.max(header?.bottom ?? 0, status?.bottom ?? 0);
  const bottom = Math.min(toggle?.top ?? height, footer?.top ?? height);
  const right = joinVisible ? qr?.left ?? width : width;
  const camera = fitBounds(bounds, { width: Math.max(1, right), height: Math.max(1, bottom - top) });
  camera.y += top; return camera;
}
