import { fitBounds, type Camera } from '@whiteboard/board-core';

// Keep the remembered column when travelling between the two bottom-right rows.
export function rowNavigation() {
  let column = 0;
  return (key: string, active: HTMLElement, items: HTMLElement[]): boolean => {
    const row = active.dataset.tvRow;
    if (!row || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return false;
    const same = items.filter(el => el.dataset.tvRow === row);
    if (row === 'view') column = same.indexOf(active);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const index = Math.max(0, Math.min(same.length - 1, same.indexOf(active) + (key === 'ArrowRight' ? 1 : -1)));
      same[index]?.focus(); if (row === 'view') column = index;
    } else {
      const target = key === 'ArrowUp' && row === 'view' ? 'join' : key === 'ArrowDown' && row === 'join' ? 'view' : '';
      const next = items.filter(el => el.dataset.tvRow === target);
      if (next.length) next[Math.min(column, next.length - 1)].focus();
    }
    return true;
  };
}

// Fit to the actual unobstructed rectangle, with no arbitrary padding or zoom cap.
export function fitTVContent(bounds: Parameters<typeof fitBounds>[0], width: number, height: number, joinVisible: boolean): Camera {
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
