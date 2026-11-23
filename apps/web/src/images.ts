import { IMAGE_LIMITS, validAssetId, type Credentials } from '@whiteboard/board-core';

export function imagePath(credentials: Credentials, assetId = '') { return `/api/rooms/${credentials.roomId}/images${assetId ? '/' + assetId : ''}`; }
export async function imageBlob(credentials: Credentials, assetId: string) {
  if (!validAssetId(assetId)) throw new Error('图片地址无效');
  const response = await fetch(imagePath(credentials, assetId), { headers: { Authorization: 'Bearer ' + credentials.token } });
  if (!response.ok) throw new Error('图片暂时无法加载');
  return response.blob();
}
type ImageEntry = { image: HTMLImageElement; url?: string; loaded: boolean; failedAt?: number; retry?: ReturnType<typeof setTimeout> };
export class ImageCache {
  private entries = new Map<string, ImageEntry>();
  private disposed = false;
  constructor(private credentials: () => Credentials, private changed: () => void) { window.addEventListener('online', this.online); }
  private online = () => { if (!this.disposed) this.changed(); };
  get(assetId: string): HTMLImageElement | null {
    if (!validAssetId(assetId) || this.disposed) return null;
    let entry = this.entries.get(assetId);
    if (!entry && this.entries.size >= IMAGE_LIMITS.assets + 8) return null;
    if (entry?.failedAt && Date.now() - entry.failedAt > 5000 && navigator.onLine) { this.entries.delete(assetId); entry = undefined; }
    if (!entry) {
      const next = { image: new Image(), loaded: false } as ImageEntry;
      entry = next; this.entries.set(assetId, next);
      const failed = () => {
        if (this.disposed) return;
        next.failedAt = Date.now(); if (next.url) URL.revokeObjectURL(next.url);
        next.retry = setTimeout(() => { if (!this.disposed) this.changed(); }, 5100);
        this.changed();
      };
      imageBlob(this.credentials(), assetId).then(blob => {
        if (this.disposed) return;
        next.url = URL.createObjectURL(blob);
        next.image.onload = () => { if (!this.disposed) { next.loaded = true; this.changed(); } };
        next.image.onerror = failed;
        next.image.src = next.url;
      }).catch(failed);
    }
    return entry.loaded ? entry.image : null;
  }
  get loaded() { return [...this.entries.values()].filter(e => e.loaded).length; }
  destroy() { this.disposed = true; window.removeEventListener('online', this.online); for (const e of this.entries.values()) { clearTimeout(e.retry); if (e.url) URL.revokeObjectURL(e.url); } this.entries.clear(); }
}

// File decoding and PNG normalization happen only when the editor chooses a photo.
export async function prepareImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片；其他格式请先转换');
  if (file.size > 20 * 1024 * 1024) throw new Error('原图请控制在 20 MB 以内');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('无法读取这张图片')); image.src = url; });
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 30_000_000) throw new Error('图片像素过大，请选择较小图片');
    let edge = IMAGE_LIMITS.edge;
    while (edge >= 160) {
      const factor = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * factor)); canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片压缩失败')), 'image/png'));
      if (blob.size <= IMAGE_LIMITS.bytes) return blob;
      edge = Math.floor(edge * .75);
    }
    throw new Error('图片压缩后仍过大，请选择较小图片');
  } finally { URL.revokeObjectURL(url); }
}
