import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as Y from 'yjs';

export type Room = { id: string; editorToken: string; viewerToken: string; doc: Y.Doc; queue: Promise<void> };
type RecordOnDisk = { schemaVersion: 1; id: string; editorToken: string; viewerToken: string; update: string };

export class RoomStore {
  readonly rooms = new Map<string, Room>();
  private loads = new Map<string, Promise<Room>>();
  constructor(readonly directory: string) {}
  async create() {
    if (this.rooms.size >= 64) throw new Error('实验服务房间数已达上限');
    const room: Room = { id: randomBytes(12).toString('hex'), editorToken: randomBytes(32).toString('hex'), viewerToken: randomBytes(32).toString('hex'), doc: new Y.Doc(), queue: Promise.resolve() };
    await this.save(room, room.doc);
    this.rooms.set(room.id, room);
    return room;
  }
  async get(id: string): Promise<Room> {
    if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('房间不存在');
    const existing = this.rooms.get(id);
    if (existing) return existing;
    let loading = this.loads.get(id);
    if (!loading) {
      loading = this.load(id).finally(() => this.loads.delete(id));
      this.loads.set(id, loading);
    }
    return loading;
  }
  private async load(id: string) {
    if (this.rooms.size >= 64) throw new Error('实验服务房间数已达上限');
    const data: RecordOnDisk = JSON.parse(await readFile(join(this.directory, id + '.json'), 'utf8'));
    if (data.schemaVersion !== 1 || data.id !== id) throw new Error('白板版本不兼容');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(data.update, 'base64'));
    const room: Room = { id, editorToken: data.editorToken, viewerToken: data.viewerToken, doc, queue: Promise.resolve() };
    this.rooms.set(id, room);
    return room;
  }
  async save(room: Room, doc: Y.Doc) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = join(this.directory, room.id + '.json');
    const temporary = target + '.' + randomBytes(6).toString('hex') + '.tmp';
    const data: RecordOnDisk = { schemaVersion: 1, id: room.id, editorToken: room.editorToken, viewerToken: room.viewerToken, update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') };
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, target);
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) { await rm(temporary, { force: true }); throw error; }
  }
  async close() {
    await Promise.all([...this.rooms.values()].map(room => room.queue));
    for (const room of this.rooms.values()) room.doc.destroy();
  }
}
