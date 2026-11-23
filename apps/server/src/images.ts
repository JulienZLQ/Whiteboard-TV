import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { IMAGE_LIMITS } from '@whiteboard/board-core';

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
// Accept only the bounded, non-interlaced RGB/RGBA PNG emitted by our canvas encoder.
export function pngSize(bytes: Buffer) {
  if (bytes.length > IMAGE_LIMITS.bytes || bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('图片格式无效');
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('图片格式无效');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), color = bytes[25];
  if (!width || !height || width > IMAGE_LIMITS.edge || height > IMAGE_LIMITS.edge || bytes[24] !== 8 || ![2, 6].includes(color) || bytes[26] || bytes[27] || bytes[28]) throw new Error('图片尺寸或格式超出范围');
  const chunks: Buffer[] = []; let offset = 8, ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (length > bytes.length - offset - 12) throw new Error('图片不完整');
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error('图片校验失败');
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === 'IEND') { ended = length === 0 && offset === bytes.length; break; }
  }
  const expected = (width * (color === 6 ? 4 : 3) + 1) * height;
  if (!ended || !chunks.length || inflateSync(Buffer.concat(chunks), { maxOutputLength: expected }).length !== expected) throw new Error('图片数据无效');
  return { width, height };
}
export class ImageStore {
  constructor(private directory: string) {}
  private folder(roomId: string) { return join(this.directory, 'images', roomId); }
  async get(roomId: string, assetId: string) { return readFile(join(this.folder(roomId), assetId + '.png')); }
  async exists(roomId: string, assetId: string) { return this.get(roomId, assetId).then(() => true, () => false); }
  async put(roomId: string, bytes: Buffer) {
    const size = pngSize(bytes), assetId = createHash('sha256').update(bytes).digest('hex');
    const folder = this.folder(roomId); await mkdir(folder, { recursive: true, mode: 0o700 });
    if (await this.exists(roomId, assetId)) return { assetId, ...size };
    if ((await readdir(folder)).filter(n => n.endsWith('.png')).length >= IMAGE_LIMITS.assets) throw new Error('每个白板最多上传 20 张不同图片');
    const temp = join(folder, randomBytes(8).toString('hex') + '.tmp');
    try {
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, join(folder, assetId + '.png'));
      const dir = await open(folder, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    } finally { await rm(temp, { force: true }); }
    return { assetId, ...size };
  }
}
