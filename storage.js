import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { hashText, HistoryError, publicSide } from './core.js';

// A content pack is a self-contained set of one or two exact UTF-8 versions, not
// a delta. Reusing a version never depends on retaining its source history row.
export const MAX_CONTENT_BYTES = 16 * 1024 * 1024;
export const MAX_PACK_BYTES = 2 * MAX_CONTENT_BYTES;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sideSchema = z.object({ exists: z.boolean(), available: z.boolean(), bytes: z.number().int().nonnegative(), hash: digest.nullable(), text: z.string().nullable().optional(), contentRef: z.string().optional(), version: z.string().optional(), reason: z.string().optional() });
const fileSchema = z.object({ id: z.string(), path: z.string(), display: z.string(), change: z.enum(['added', 'modified', 'deleted']), before: sideSchema, after: sideSchema, sourceFileId: z.string().optional() });
export const historyRecordSchema = z.object({ id: z.string(), kind: z.enum(['change', 'restore']), sessionId: z.string(), turn: z.number(), turnStartSeq: z.number(), messageSeq: z.number(), cwd: z.string(), createdAt: z.number(), files: z.array(fileSchema), warnings: z.array(z.string()) }).passthrough();
export const contentPackSchema = z.object({ id: z.string(), kind: z.literal('content'), format: z.literal(2), entries: z.array(z.object({ hash: digest, bytes: z.number().int().min(0).max(MAX_CONTENT_BYTES) })).min(1).max(2), rawBytes: z.number().int().min(0).max(MAX_PACK_BYTES), codec: z.enum(['gzip', 'raw']), data: z.string().optional(), texts: z.array(z.string()).optional() });
export const storageValueSchema = z.union([historyRecordSchema, contentPackSchema]);
export const jsonBytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const isPack = value => value?.kind === 'content';
const contentId = entries => `content-${hashText(JSON.stringify(entries.map(entry => entry.hash)))}`;
const corrupt = message => new HistoryError('BACKUP_CORRUPT', message);
function validBase64(data) {
  if (data.length % 4 || /[^A-Za-z0-9+/=]/.test(data)) return false;
  const padding = data.indexOf('=');
  return padding < 0 || (padding >= data.length - 2 && /^={1,2}$/.test(data.slice(padding)));
}
function validateText(text, side) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') !== side.bytes || side.bytes > MAX_CONTENT_BYTES || hashText(text) !== side.hash) throw corrupt('Backup content failed its size/hash verification.');
  // Reject lone surrogates too: valid captured UTF-8 must round-trip exactly.
  if (Buffer.from(text, 'utf8').toString('utf8') !== text) throw corrupt('Backup content is not exact UTF-8.');
  return text;
}
export function encodePack(contents) {
  const sorted = [...contents].sort(([a], [b]) => a.localeCompare(b));
  if (!sorted.length || sorted.length > 2) throw corrupt('Invalid content pack size.');
  const entries = sorted.map(([hash, text]) => ({ hash, bytes: Buffer.byteLength(text, 'utf8') }));
  sorted.forEach(([, text], index) => validateText(text, entries[index]));
  const texts = sorted.map(([, text]) => text), rawBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const base = { id: contentId(entries), kind: 'content', format: 2, entries, rawBytes };
  const raw = { ...base, codec: 'raw', texts };
  const packed = { ...base, codec: 'gzip', data: gzipSync(Buffer.concat(texts.map(text => Buffer.from(text, 'utf8'))), { level: 6 }).toString('base64') };
  return jsonBytes(packed) < jsonBytes(raw) ? packed : raw;
}
export function decodePack(pack) {
  try {
    contentPackSchema.parse(pack);
    if (contentId(pack.entries) !== pack.id || new Set(pack.entries.map(entry => entry.hash)).size !== pack.entries.length || pack.entries.reduce((sum, e) => sum + e.bytes, 0) !== pack.rawBytes) throw corrupt('Invalid content pack identity or size.');
    let texts;
    if (pack.codec === 'raw') {
      if (pack.data !== undefined || pack.texts?.length !== pack.entries.length) throw corrupt('Invalid raw content pack.');
      texts = pack.texts;
    } else {
      if (pack.texts !== undefined || typeof pack.data !== 'string' || pack.data.length > Math.ceil((MAX_PACK_BYTES + 65536) / 3) * 4 || !validBase64(pack.data)) throw corrupt('Invalid compressed content pack.');
      const data = gunzipSync(Buffer.from(pack.data, 'base64'), { maxOutputLength: Math.max(1, pack.rawBytes) });
      if (data.length !== pack.rawBytes) throw corrupt('Unexpected decompressed size.');
      let offset = 0;
      texts = pack.entries.map(entry => {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data.subarray(offset, offset + entry.bytes));
        offset += entry.bytes; return text;
      });
    }
    return new Map(pack.entries.map((entry, index) => [entry.hash, validateText(texts[index], entry)]));
  } catch (error) {
    if (error.code === 'BACKUP_CORRUPT') throw error;
    throw corrupt(`Cannot decode backup content: ${String(error.message).slice(0, 160)}`);
  }
}

/** All mutations (including mark/sweep) share this chain. No filesystem bypass,
 * refcounts, cross-record transaction assumption, or permanent plaintext cache. */
export class BackupStore {
  constructor(table, settings = () => ({})) {
    this.table = table; this.settings = settings; this.queue = Promise.resolve(); this.sizes = new WeakMap(); this.reindex();
  }
  assertHealthy() {
    if (this.failure) throw new HistoryError('BACKUP_STORAGE_UNCERTAIN', 'A backup storage write failed. Restart/reopen the plugin before further backup operations; no content will be collected from an uncertain in-memory view.');
  }
  serial(operation) {
    const result = this.queue.then(() => { this.assertHealthy(); return operation(); });
    this.queue = result.catch(() => {}); return result;
  }
  async durable(operation) {
    try { return await operation(); }
    catch (error) { this.failure = error; throw error; }
  }
  sizeOf(value) {
    // storageDomain values are immutable objects: don't stringify every historical
    // compressed payload again at each turn, only newly published objects.
    if (!this.sizes.has(value)) this.sizes.set(value, jsonBytes(value));
    return this.sizes.get(value);
  }
  reindex() {
    this.index = new Map();
    for (const [id, pack] of this.table.entries()) if (isPack(pack)) for (const entry of pack.entries) if (!this.index.has(entry.hash)) this.index.set(entry.hash, id);
  }
  get(id) { const row = this.table.get(id); return isPack(row) ? undefined : row; }
  *entries() { for (const [id, row] of this.table.entries()) if (!isPack(row)) yield [id, row]; }
  get size() { return [...this.entries()].length; }
  readSide(side, cache = new Map()) {
    this.assertHealthy();
    if (!side.exists || !side.available) return { ...publicSide(side), text: null };
    if (typeof side.text === 'string') return { ...publicSide(side), text: validateText(side.text, side) };
    const id = side.contentRef, pack = id && this.table.get(id);
    if (!isPack(pack) || pack.id !== id) throw corrupt('Referenced backup content is missing.');
    if (!cache.has(id)) cache.set(id, decodePack(pack));
    const text = cache.get(id).get(side.hash);
    return { ...publicSide(side), text: validateText(text, side) };
  }
  hydrateFile(file) {
    const cache = new Map();
    return { ...file, before: this.readSide(file.before, cache), after: this.readSide(file.after, cache) };
  }
  plan(record) {
    const packs = new Map(), localIndex = new Map(this.index);
    const files = record.files.map(file => {
      // Keep decoded data bounded to this file, not the entire restore selection.
      const missing = new Map(), cache = new Map();
      for (const side of [file.before, file.after]) {
        if (!side.exists || !side.available) continue;
        const text = this.readSide(side, cache);
        if (localIndex.has(side.hash)) {
          // Never publish a new reference to an unverified/corrupt existing pack.
          const ref = localIndex.get(side.hash);
          if (packs.has(ref)) {
            if (!cache.has(ref)) cache.set(ref, decodePack(packs.get(ref)));
            validateText(cache.get(ref)?.get(side.hash), side);
          } else this.readSide({ ...side, text: undefined, contentRef: ref }, cache);
        } else missing.set(side.hash, text.text);
      }
      if (missing.size) {
        const pack = encodePack(missing); decodePack(pack);
        packs.set(pack.id, pack);
        for (const entry of pack.entries) localIndex.set(entry.hash, pack.id);
        cache.set(pack.id, new Map(missing));
      }
      const encodeSide = side => {
        const meta = publicSide(side);
        return side.exists && side.available ? { ...meta, contentRef: localIndex.get(side.hash) } : { ...meta, text: null };
      };
      return { ...file, before: encodeSide(file.before), after: encodeSide(file.after) };
    });
    return { record: { ...record, storageFormat: 2, files }, packs };
  }
  put(id, record) { return this.serial(() => this.putNow(id, record)); }
  async putNow(id, record, migration = false) {
    if (id !== record.id || isPack(record)) throw corrupt('Invalid history record identity.');
    const plan = this.plan(record), previous = this.get(id);
    const addedPacks = [...plan.packs].filter(([key]) => !this.table.get(key));
    const stats = this.stats(), settings = this.settings();
    const nextBytes = stats.storedBytes - (previous ? jsonBytes(previous) : 0) + jsonBytes(plan.record) + addedPacks.reduce((sum, [, pack]) => sum + jsonBytes(pack), 0);
    // Reserve enough room for bounded per-file recovery results. Subsequent journal
    // progress MUST remain writable even if the user lowers the quota meanwhile.
    const reserve = record.status === 'prepared' ? record.files.length * 4096 + 1024 : 0;
    if (!previous && !migration && ((settings.maxRecords && stats.recordCount + 1 > settings.maxRecords) || (settings.maxStorageBytes && nextBytes + reserve > settings.maxStorageBytes))) throw new HistoryError('BACKUP_QUOTA_EXCEEDED', 'Backup quota reached. No files were restored. Optimize/delete backups or increase the quota; no backups were automatically deleted.');
    for (const [key, pack] of addedPacks) {
      await this.durable(() => this.table.put(key, pack));
      for (const entry of pack.entries) this.index.set(entry.hash, key);
    }
    // Atomic single-record replacement is the commit point. A crash before this
    // can leave an orphan pack, never a history row pointing at absent content.
    await this.durable(() => this.table.put(id, plan.record));
  }
  updateJournal(id, status, results) {
    return this.serial(async () => {
      const record = this.get(id);
      if (record?.kind !== 'restore' || !['prepared', 'partial', 'completed'].includes(status)) throw corrupt('Missing recovery journal.');
      // Only the small history row is rewritten; immutable compressed packs stay put.
      await this.durable(() => this.table.put(id, { ...record, status, results: structuredClone(results) }));
    });
  }
  deleteMany(ids) {
    return this.serial(async () => {
      const deleted = await this.durable(() => this.table.deleteMany(ids.filter(id => this.get(id))));
      await this.gcNow(); return deleted;
    });
  }
  async gcNow() {
    this.assertHealthy();
    const marked = new Set();
    for (const [, record] of this.entries()) for (const file of record.files) for (const side of [file.before, file.after]) if (side.contentRef) marked.add(side.contentRef);
    const ids = [...this.table.entries()].filter(([id, row]) => isPack(row) && !marked.has(id)).map(([id]) => id);
    if (ids.length) await this.durable(() => this.table.deleteMany(ids));
    this.reindex(); return ids.length;
  }
  optimize(cwd) {
    return this.serial(async () => {
      let migrated = 0;
      for (const [id, record] of this.entries()) {
        if (record.cwd !== cwd || record.storageFormat === 2) continue;
        await this.putNow(id, record, true); migrated++;
      }
      // Older builds also saved change records whose only payload was scan warnings.
      // They hold no file version, so dropping them cannot lose a restorable backup.
      // A truncated scan is excluded: it cannot prove that nothing changed.
      const empty = [...this.entries()].filter(([, record]) => record.cwd === cwd && record.kind === 'change' && !record.files?.length && record.coverage !== 'incomplete').map(([id]) => id);
      const pruned = empty.length ? await this.durable(() => this.table.deleteMany(empty)) : 0;
      const reclaimedPacks = await this.gcNow();
      return { ok: true, migrated, pruned, reclaimedPacks, storage: this.stats() };
    });
  }
  stats() {
    let recordCount = 0, protectedRecordCount = 0, logicalBytes = 0, recordBytes = 0, contentBytes = 0, packCount = 0, legacyRecordCount = 0;
    const unique = new Map(), referenced = new Set();
    for (const [, record] of this.entries()) {
      recordCount++; recordBytes += this.sizeOf(record);
      if (record.status === 'prepared' || record.status === 'partial') protectedRecordCount++;
      if (record.storageFormat !== 2) legacyRecordCount++;
      for (const file of record.files) for (const side of [file.before, file.after]) {
        if (side.exists && side.available) { logicalBytes += side.bytes; unique.set(side.hash, side.bytes); }
        if (side.contentRef) referenced.add(side.contentRef);
      }
    }
    let orphanPackCount = 0;
    for (const [id, pack] of this.table.entries()) if (isPack(pack)) { packCount++; contentBytes += this.sizeOf(pack); if (!referenced.has(id)) orphanPackCount++; }
    const storedBytes = recordBytes + contentBytes, settings = this.settings();
    return { scope: 'all-workspaces', recordCount, protectedRecordCount, logicalBytes, uniqueContentBytes: [...unique.values()].reduce((sum, n) => sum + n, 0), storedBytes, recordBytes, contentBytes, packCount, orphanPackCount, legacyRecordCount, quotaExceeded: Boolean((settings.maxRecords && recordCount >= settings.maxRecords) || (settings.maxStorageBytes && storedBytes >= settings.maxStorageBytes)) };
  }
}
