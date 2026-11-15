import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { absent, hashText, HistoryService, publicRecord } from '../core.js';
import { BackupStore, encodePack, decodePack, storageValueSchema, jsonBytes, MAX_CONTENT_BYTES, MAX_PACK_BYTES } from '../storage.js';

// Reads and writes clone just as a persistent storageDomain table does. Tests
// must never pass by mutating an in-memory row without its durable commit.
class CloneTable {
  constructor(rows = []) {
    this.map = new Map([...rows].map(([key, value]) => [key, structuredClone(value)]));
    this.calls = []; this.failPut = null; this.beforePut = null;
  }
  get(key) { return structuredClone(this.map.get(key)); }
  *entries() { for (const [key, value] of this.map) yield [key, structuredClone(value)]; }
  get size() { return this.map.size; }
  async put(key, value) {
    this.calls.push({ operation: 'put', key, value: structuredClone(value) });
    if (this.beforePut) await this.beforePut(key, value);
    if (this.failPut?.(key, value)) throw new Error(`injected put failure: ${key}`);
    this.map.set(key, structuredClone(value));
  }
  async deleteMany(keys) {
    this.calls.push({ operation: 'deleteMany', keys: [...keys] });
    let count = 0;
    for (const key of keys) if (this.map.delete(key)) count++;
    return count;
  }
}
const textSide = (text, version = 'v1') => ({ exists: true, available: true, bytes: Buffer.byteLength(text, 'utf8'), hash: hashText(text), text, version });
const unavailable = () => ({ exists: true, available: false, bytes: 23, hash: null, text: null, reason: 'Binary or unreadable', version: 'opaque' });
const file = (id, before = textSide('before'), after = textSide('after'), extra = {}) => ({ id, path: `${id}.txt`, display: `${id}.txt`, change: !before.exists ? 'added' : !after.exists ? 'deleted' : 'modified', before, after, ...extra });
const record = (id, files = [file('f1')], extra = {}) => ({ id, kind: 'change', cwd: '/work', sessionId: 's1', turn: 1, turnStartSeq: 2, messageSeq: 8, createdAt: 1000, files, warnings: [], ...extra });
const packs = table => [...table.entries()].filter(([, row]) => row.kind === 'content').map(([, row]) => row);
const snapshot = table => [...table.entries()];
const totalBytes = table => [...table.entries()].reduce((sum, [, value]) => sum + jsonBytes(value), 0);
const corrupt = operation => assert.throws(operation, { code: 'BACKUP_CORRUPT' });
const refs = row => row.files.flatMap(f => [f.before, f.after]).map(s => s.contentRef).filter(Boolean);
function assertNoPayload(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['text', 'texts', 'data', 'contentRef'].includes(key), `public metadata leaked ${key}`);
    assertNoPayload(child);
  }
}
function serviceFixture({ limits = {}, settings = {} } = {}) {
  const table = new CloneTable(), config = { retentionDays: 0, ...settings }, current = new Map();
  let history;
  const store = new BackupStore(table, () => history.settings());
  const mutations = [];
  const io = {
    async read(_cwd, path) { return structuredClone(current.get(path) ?? absent()); },
    async restore(_cwd, f, side) {
      const journals = [...store.entries()].map(([, r]) => r).filter(r => r.kind === 'restore');
      assert.ok(journals.some(r => r.status === 'prepared'), 'durable journal precedes file publication');
      for (const journal of journals) for (const saved of journal.files) store.hydrateFile(saved);
      mutations.push(f.path);
      if (side.exists) current.set(f.path, textSide(side.text, `restored-${mutations.length}`)); else current.delete(f.path);
    },
  };
  history = new HistoryService({ io, records: store, global: { get: () => config, async set(value) { Object.assign(config, value); } }, limits, now: () => 10 * 86400000 });
  return { table, store, history, current, mutations, config, scope: { cwd: '/work', sessionId: 's1', policy: { mode: 'workspace-write' } } };
}
function randomAscii(length) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' + String.fromCharCode(34, 92);
  const buffer = Buffer.alloc(length);
  let state = 123456789;
  for (let i = 0; i < length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    buffer[i] = alphabet.charCodeAt(state >>> 26);
  }
  return buffer.toString('ascii');
}
function manualPack(entries, body) {
  return { id: `content-${hashText(JSON.stringify(entries.map(e => e.hash)))}`, kind: 'content', format: 2, entries, rawBytes: entries.reduce((sum, e) => sum + e.bytes, 0), ...body };
}

test('jsonBytes measures serialized UTF-8 bytes, including escaping and non-ASCII', () => {
  const value = { text: '\uFEFF中文🙂\r\n"\\', empty: '', nested: [null, 1] };
  assert.equal(jsonBytes(value), Buffer.from(JSON.stringify(value)).length);
  assert.ok(jsonBytes(value) > JSON.stringify(value).length);
});

test('pack codec preserves exact UTF-8, BOM, CRLF, astral/combining characters and empty text', () => {
  for (const text of ['', '\uFEFF', '中文🙂e\u0301\r\nlast\r', '\uFEFFline\r\n'.repeat(4000)]) {
    const packed = encodePack(new Map([[hashText(text), text]]));
    assert.equal(storageValueSchema.safeParse(packed).success, true);
    assert.equal(decodePack(packed).get(hashText(text)), text);
    assert.equal(packed.rawBytes, Buffer.byteLength(text));
  }
});

test('compression selects gzip only when its entire serialized pack is smaller than raw', () => {
  const small = encodePack(new Map([[hashText('x'), 'x']]));
  assert.equal(small.codec, 'raw');
  assert.deepEqual(small.texts, ['x']); assert.equal('data' in small, false);
  const text = '\uFEFF中文🙂\r\n'.repeat(10000), compressed = encodePack(new Map([[hashText(text), text]]));
  assert.equal(compressed.codec, 'gzip'); assert.equal('texts' in compressed, false);
  const raw = { ...compressed, codec: 'raw', texts: [text] }; delete raw.data;
  assert.ok(jsonBytes(compressed) < jsonBytes(raw) / 10);
  assert.equal(decodePack(compressed).get(hashText(text)), text);
});

test('two-entry packs have deterministic identities independent of Map insertion order', () => {
  const a = '\uFEFFa\r\n'.repeat(200), b = '你好🙂\r\n'.repeat(300), contents = [[hashText(a), a], [hashText(b), b]];
  assert.deepEqual(encodePack(new Map(contents)), encodePack(new Map(contents.toReversed())));
  assert.deepEqual(decodePack(encodePack(new Map(contents))), new Map(contents));
});

test('valid large gzip packs below the documented 16 MiB limit do not overflow base64 validation', () => {
  const text = randomAscii(12 * 1024 * 1024), packed = encodePack(new Map([[hashText(text), text]]));
  assert.equal(packed.codec, 'gzip');
  assert.equal(decodePack(packed).get(hashText(text)), text);
});

test('encode rejects no/too many entries, incorrect digest and non-round-trippable surrogates', () => {
  corrupt(() => encodePack(new Map()));
  corrupt(() => encodePack(new Map(['a', 'b', 'c'].map(text => [hashText(text), text]))));
  corrupt(() => encodePack(new Map([[hashText('wrong'), 'actual']])));
  corrupt(() => encodePack(new Map([[hashText('\uD800'), '\uD800']])));
});

test('public store get/entries/size contain only history, never content rows', async () => {
  const table = new CloneTable(), store = new BackupStore(table), source = record('source');
  await store.put(source.id, source);
  assert.equal(store.size, 1); assert.equal(table.size, 2);
  assert.equal(store.get(packs(table)[0].id), undefined);
  assert.deepEqual([...store.entries()].map(([id]) => id), ['source']);
  const retrieved = store.get(source.id); retrieved.files[0].path = 'not-durable';
  assert.equal(store.get(source.id).files[0].path, 'f1.txt');
  assert.ok(source.files[0].before.text, 'put must not mutate caller-owned inline source');
  assert.equal('storageFormat' in source, false);
});

test('put removes persisted text, writes packs before its atomic history commit, and hydrates exact sides', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  const source = record('source', [file('unicode', textSide('\uFEFF老\r\n🙂'), textSide('新\r\n🙂')), file('empty', absent(), textSide('')), file('unreadable', unavailable(), absent())]);
  table.beforePut = (_id, value) => {
    if (value.kind !== 'content') for (const ref of refs(value)) assert.ok(table.get(ref), 'all referenced packs must already be durable');
  };
  await store.put(source.id, source);
  assert.equal(table.calls.at(-1).key, source.id);
  const stored = store.get(source.id);
  assert.equal(stored.storageFormat, 2);
  for (let i = 0; i < source.files.length; i++) {
    const actual = store.hydrateFile(stored.files[i]);
    for (const side of ['before', 'after']) {
      assert.equal(actual[side].text, source.files[i][side].text);
      assert.equal(actual[side].hash, source.files[i][side].hash);
      assert.equal(actual[side].bytes, source.files[i][side].bytes);
      assert.equal(actual[side].exists, source.files[i][side].exists);
      assert.equal(actual[side].available, source.files[i][side].available);
      assert.equal('contentRef' in actual[side], false);
    }
  }
  for (const side of stored.files.flatMap(f => [f.before, f.after])) {
    if (side.exists && side.available) { assert.equal('text' in side, false); assert.ok(side.contentRef); }
    else { assert.equal(side.text, null); assert.equal('contentRef' in side, false); }
  }
});

test('absent and unavailable sides need no pack and cannot become empty existing content', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  await store.put('no-content', record('no-content', [file('f', unavailable(), absent())]));
  assert.equal(packs(table).length, 0);
  const actual = store.hydrateFile(store.get('no-content').files[0]);
  assert.deepEqual(actual.before, unavailable()); assert.deepEqual(actual.after, absent());
  assert.equal(store.stats().logicalBytes, 0); assert.equal(store.stats().uniqueContentBytes, 0);
});

test('consecutive V0→V1 and V1→V2 reuse the shared version without a delta dependency', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  await store.put('r1', record('r1', [file('a', textSide('V0'), textSide('V1'))]));
  const shared = store.get('r1').files[0].after.contentRef;
  await store.put('r2', record('r2', [file('a', textSide('V1'), textSide('V2'))]));
  assert.equal(store.get('r2').files[0].before.contentRef, shared);
  assert.equal(packs(table).length, 2);
  assert.deepEqual(packs(table).map(p => p.entries.length).sort(), [1, 2]);
  assert.equal(store.stats().logicalBytes, 8); assert.equal(store.stats().uniqueContentBytes, 6);
  await store.deleteMany(['r1']);
  assert.equal(packs(table).length, 2, 'pack carrying retained V1 must survive even if V0 is now unused');
  const hydrated = store.hydrateFile(store.get('r2').files[0]);
  assert.equal(hydrated.before.text, 'V1'); assert.equal(hydrated.after.text, 'V2');
});

test('localIndex reuses packs created earlier in the same multi-file plan', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  await store.put('r1', record('r1', [file('a', textSide('A'), textSide('B')), file('b', textSide('A'), textSide('C')), file('c', textSide('C'), textSide('B'))]));
  assert.equal(packs(table).length, 2);
  const [a, b, c] = store.get('r1').files;
  assert.equal(a.before.contentRef, b.before.contentRef);
  assert.equal(a.after.contentRef, c.after.contentRef);
  assert.equal(b.after.contentRef, c.before.contentRef);
  assert.deepEqual(store.get('r1').files.map(f => store.hydrateFile(f).after.text), ['B', 'C', 'B']);
});

test('identical before/after, files and workspaces share a single exact content entry', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  await store.put('r1', record('r1', [file('a', textSide('same'), textSide('same')), file('b', absent(), textSide('same'))]));
  const first = packs(table)[0];
  await store.put('r2', record('r2', [file('a', textSide('same'), absent())], { cwd: '/other' }));
  assert.equal(packs(table).length, 1); assert.equal(first.entries.length, 1);
  assert.equal(store.stats().logicalBytes, 16); assert.equal(store.stats().uniqueContentBytes, 4);
});

test('restart rebuilds dedup index and never writes another pack for existing content', async () => {
  const table = new CloneTable(); let store = new BackupStore(table);
  await store.put('r1', record('r1'));
  const firstPacks = packs(table); table.calls = [];
  store = new BackupStore(new CloneTable(snapshot(table)));
  await store.put('r2', record('r2'));
  assert.deepEqual(packs(store.table), firstPacks);
  assert.equal(store.table.calls.filter(c => c.operation === 'put' && c.value.kind === 'content').length, 0);
});

test('concurrent puts serialize deduplication and optimize cannot collect a pending commit pack', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  await Promise.all([store.put('r1', record('r1')), store.put('r2', record('r2')), store.optimize('/work')]);
  assert.equal(store.size, 2); assert.equal(packs(table).length, 1);
  for (const [, row] of store.entries()) assert.equal(store.hydrateFile(row.files[0]).after.text, 'after');
});

test('deleteMany cannot delete packs by their ids and final reference deletion collects content', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  await store.put('r1', record('r1')); await store.put('r2', record('r2'));
  const packId = packs(table)[0].id;
  assert.equal(await store.deleteMany([packId, 'missing']), 0);
  assert.ok(table.get(packId));
  assert.equal(await store.deleteMany(['r1', 'r1', packId]), 1); assert.ok(table.get(packId));
  assert.equal(await store.deleteMany(['r2']), 1); assert.equal(table.size, 0);
  assert.equal(store.stats().packCount, 0); assert.equal(store.stats().recordCount, 0);
});

test('source removal leaves a completed restore journal self-contained and reversible', async () => {
  const f = serviceFixture(); const source = record('source');
  await f.store.put(source.id, source); f.current.set('f1.txt', textSide('after'));
  const prepared = await f.history.prepare({ recordId: source.id, fileIds: ['f1'] }, f.scope);
  assert.equal(prepared.canRestore, true);
  const result = await f.history.restore(prepared.token, f.scope);
  assert.equal(result.ok, true); assert.equal(f.current.get('f1.txt').text, 'before');
  const journal = f.store.get(result.recordId);
  assert.equal(journal.status, 'completed');
  await f.history.remove([source.id], '/work', true);
  await f.store.optimize('/work');
  const hydrated = f.store.hydrateFile(f.store.get(journal.id).files[0]);
  assert.equal(hydrated.before.text, 'after'); assert.equal(hydrated.after.text, 'before');
  const redo = await f.history.prepare({ recordId: journal.id, fileIds: [journal.files[0].id], side: 'before' }, f.scope);
  assert.equal((await f.history.restore(redo.token, f.scope)).ok, true);
  assert.equal(f.current.get('f1.txt').text, 'after');
});

test('prepared and partial journals retain GC references and resist age-based cleanup', async () => {
  const f = serviceFixture({ settings: { retentionDays: 1 } });
  const source = record('source'); await f.store.put(source.id, source);
  for (const status of ['prepared', 'partial']) await f.store.put(status, record(status, [file(status)], { kind: 'restore', sourceRecordId: source.id, status, results: [] }));
  assert.equal(f.store.stats().protectedRecordCount, 2);
  assert.equal((await f.history.clean('/work')).deleted, 1);
  assert.equal(f.store.size, 2); assert.equal(packs(f.table).length, 1);
  await f.store.optimize('/other');
  for (const [, row] of f.store.entries()) assert.equal(f.store.hydrateFile(row.files[0]).before.text, 'before');
});

test('new-write record/byte quotas reject atomically before any pack or history change', async () => {
  for (const settings of [{ maxRecords: 1 }, { maxStorageBytes: 1 }]) {
    const table = new CloneTable(), store = new BackupStore(table, () => settings);
    if (settings.maxRecords) await store.put('existing', record('existing'));
    const before = snapshot(table), writes = table.calls.length;
    await assert.rejects(store.put('rejected', record('rejected', [file('different', textSide('unseen old'), textSide('unseen new'))])), { code: 'BACKUP_QUOTA_EXCEEDED' });
    assert.deepEqual(snapshot(table), before); assert.equal(table.calls.length, writes);
    assert.equal(store.get('rejected'), undefined);
  }
});

test('prepared journal quota includes its recovery-progress reserve', async () => {
  const journal = record('journal', [file('f')], { kind: 'restore', status: 'prepared', results: [] });
  const scratch = new CloneTable(), unlimited = new BackupStore(scratch);
  await unlimited.put(journal.id, journal);
  const settings = { maxStorageBytes: totalBytes(scratch) + 1 }, table = new CloneTable(), store = new BackupStore(table, () => settings);
  await assert.rejects(store.put(journal.id, journal), { code: 'BACKUP_QUOTA_EXCEEDED' });
  assert.equal(table.size, 0);
});

test('journal progress remains writable after lowering quotas and touches only its small row', async () => {
  const settings = {}, table = new CloneTable(), store = new BackupStore(table, () => settings);
  await store.put('journal', record('journal', [file('f')], { kind: 'restore', status: 'prepared', results: [] }));
  const originalPacks = packs(table); table.calls = [];
  Object.assign(settings, { maxStorageBytes: 1, maxRecords: 1 });
  const results = [{ id: 'f', status: 'failed', message: 'progress'.repeat(500) }];
  await store.updateJournal('journal', 'partial', results); results[0].message = 'not durable';
  assert.equal(store.get('journal').status, 'partial');
  assert.equal(store.get('journal').results[0].message, 'progress'.repeat(500));
  assert.deepEqual(packs(table), originalPacks);
  assert.equal(table.calls.length, 1); assert.equal(table.calls[0].key, 'journal');
  assert.equal(store.stats().quotaExceeded, true);
  await store.updateJournal('journal', 'completed', [{ id: 'f', status: 'restored' }]);
  assert.equal(store.stats().protectedRecordCount, 0);
});

test('updateJournal rejects missing/non-restore journals and invalid status without mutation', async () => {
  const table = new CloneTable(), store = new BackupStore(table); await store.put('change', record('change'));
  const before = snapshot(table);
  for (const [id, status] of [['missing', 'partial'], ['change', 'completed'], ['change', 'unknown']]) await assert.rejects(store.updateJournal(id, status, []), { code: 'BACKUP_CORRUPT' });
  assert.deepEqual(snapshot(table), before);
});

test('pack-write failure commits no history and fails closed until a store restart', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  table.failPut = (_id, value) => value.kind === 'content';
  await assert.rejects(store.put('failed', record('failed')), /injected put failure/);
  assert.equal(table.size, 0); assert.equal(store.size, 0);
  table.failPut = null;
  await assert.rejects(store.put('unsafe-retry', record('unsafe-retry')), { code: 'BACKUP_STORAGE_UNCERTAIN' });
  await assert.rejects(store.optimize('/work'), { code: 'BACKUP_STORAGE_UNCERTAIN' });
  await assert.rejects(store.deleteMany([]), { code: 'BACKUP_STORAGE_UNCERTAIN' });
  assert.throws(() => store.readSide(textSide('inline')), { code: 'BACKUP_STORAGE_UNCERTAIN' });
  const restarted = new BackupStore(new CloneTable(snapshot(table)));
  await restarted.put('retry', record('retry'));
  assert.equal(restarted.hydrateFile(restarted.get('retry').files[0]).before.text, 'before');
});

test('failure of a later pack leaves only an orphan; restart+global optimize collects it', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  let packWrites = 0; table.failPut = (_id, value) => value.kind === 'content' && ++packWrites === 2;
  await assert.rejects(store.put('failed', record('failed', [file('a'), file('b', textSide('second-old'), textSide('second-new'))])), /injected put failure/);
  assert.equal(store.size, 0); assert.equal(packs(table).length, 1); assert.equal(store.stats().orphanPackCount, 1);
  const restarted = new BackupStore(new CloneTable(snapshot(table)));
  assert.equal((await restarted.optimize('/unrelated')).reclaimedPacks, 1);
  assert.equal(restarted.table.size, 0);
});

test('history commit failure leaves orphan packs, restart sees no dangling history, optimize reclaims', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  table.failPut = id => id === 'failed';
  await assert.rejects(store.put('failed', record('failed')), /injected put failure/);
  assert.equal(store.get('failed'), undefined); assert.equal(store.stats().orphanPackCount, 1);
  const restarted = new BackupStore(new CloneTable(snapshot(table)));
  assert.equal(restarted.size, 0);
  const optimized = await restarted.optimize('/elsewhere');
  assert.equal(optimized.reclaimedPacks, 1); assert.equal(optimized.storage.storedBytes, 0);
  await restarted.put('retry', record('retry'));
  assert.equal(restarted.hydrateFile(restarted.get('retry').files[0]).after.text, 'after');
});

test('failed replacement preserves the prior committed record and its readable content', async () => {
  const table = new CloneTable(), store = new BackupStore(table); await store.put('r1', record('r1'));
  const previous = store.get('r1'); table.failPut = id => id === 'r1';
  await assert.rejects(store.put('r1', record('r1', [file('f1', textSide('new-before'), textSide('new-after'))])), /injected put failure/);
  assert.deepEqual(store.get('r1'), previous); assert.equal(store.stats().orphanPackCount, 1);
  const restarted = new BackupStore(new CloneTable(snapshot(table))); await restarted.optimize('/work');
  assert.equal(restarted.hydrateFile(restarted.get('r1').files[0]).after.text, 'after');
  assert.equal(restarted.stats().orphanPackCount, 0);
});

test('after reopening, an orphan from failed history commit can serve the next committed record', async () => {
  const table = new CloneTable(), store = new BackupStore(table); table.failPut = id => id === 'failed';
  await assert.rejects(store.put('failed', record('failed')), /injected put failure/);
  const original = packs(table), reopened = new BackupStore(new CloneTable(snapshot(table)));
  await reopened.put('next', record('next'));
  assert.deepEqual(packs(reopened.table), original); assert.equal(reopened.table.calls.length, 1);
  await reopened.optimize('/work'); assert.equal(reopened.stats().orphanPackCount, 0);
});

test('ambiguous history-write failure cannot GC content already committed on disk but absent in RAM', async () => {
  class AmbiguousTable extends CloneTable {
    constructor(rows = []) { super(rows); this.disk = new Map(snapshot(this)); this.rejectAfterCommit = null; }
    async put(key, value) {
      this.calls.push({ operation: 'put', key, value: structuredClone(value) });
      this.disk.set(key, structuredClone(value));
      if (this.rejectAfterCommit?.(key, value)) throw new Error('ambiguous durable failure');
      this.map.set(key, structuredClone(value));
    }
  }
  const table = new AmbiguousTable(), store = new BackupStore(table);
  table.rejectAfterCommit = key => key === 'committed-on-disk';
  await assert.rejects(store.put('committed-on-disk', record('committed-on-disk')), /ambiguous durable failure/);
  assert.equal(store.get('committed-on-disk'), undefined);
  assert.ok(table.disk.get('committed-on-disk'), 'the rejected promise is not proof that nothing committed');
  const before = structuredClone([...table.disk]);
  await assert.rejects(store.optimize('/work'), { code: 'BACKUP_STORAGE_UNCERTAIN' });
  await assert.rejects(store.deleteMany(['committed-on-disk']), { code: 'BACKUP_STORAGE_UNCERTAIN' });
  await assert.rejects(store.put('later', record('later')), { code: 'BACKUP_STORAGE_UNCERTAIN' });
  assert.deepEqual([...table.disk], before, 'uncertain handle must not mutate or sweep durable content');
  const restarted = new BackupStore(new CloneTable(table.disk));
  assert.equal((await restarted.optimize('/work')).reclaimedPacks, 0);
  assert.equal(restarted.hydrateFile(restarted.get('committed-on-disk').files[0]).before.text, 'before');
});

test('failed journal update locks further writes without rewriting its immutable content', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  await store.put('journal', record('journal', [file('f')], { kind: 'restore', status: 'prepared', results: [] }));
  const savedPacks = packs(table); table.failPut = id => id === 'journal';
  await assert.rejects(store.updateJournal('journal', 'partial', [{ id: 'f', status: 'failed' }]), /injected put failure/);
  await assert.rejects(store.updateJournal('journal', 'completed', []), { code: 'BACKUP_STORAGE_UNCERTAIN' });
  assert.deepEqual(packs(table), savedPacks);
  const restarted = new BackupStore(new CloneTable(snapshot(table)));
  assert.equal(restarted.get('journal').status, 'prepared');
  assert.equal(restarted.hydrateFile(restarted.get('journal').files[0]).before.text, 'before');
});

test('first restore-progress failure returns its recovery id and stops before the next file', async () => {
  const f = serviceFixture();
  await f.store.put('source', record('source', [file('a'), file('b')]));
  for (const path of ['a.txt', 'b.txt']) f.current.set(path, textSide('after'));
  let journalWrites = 0;
  f.table.failPut = (_id, row) => row.kind === 'restore' && ++journalWrites === 2;
  const preview = await f.history.prepare({ recordId: 'source', fileIds: ['a', 'b'] }, f.scope);
  const result = await f.history.restore(preview.token, f.scope);
  assert.equal(result.ok, false); assert.equal(result.journalFailed, true); assert.ok(result.recordId);
  assert.deepEqual(result.restored, ['a']); assert.equal(result.failed[0].code, 'JOURNAL_FAILED');
  assert.match(result.message, /Restart/); assert.ok(result.message.includes(result.recordId));
  assert.equal(journalWrites, 2, 'failed progress must not be followed by another final-status write');
  assert.deepEqual(f.mutations, ['a.txt']);
  assert.equal(f.current.get('a.txt').text, 'before'); assert.equal(f.current.get('b.txt').text, 'after');
  assert.equal(f.store.get(result.recordId).status, 'prepared'); assert.deepEqual(f.store.get(result.recordId).results, []);
  await assert.rejects(f.store.optimize('/work'), { code: 'BACKUP_STORAGE_UNCERTAIN' });
  const restarted = new BackupStore(new CloneTable(snapshot(f.table)));
  assert.equal(restarted.stats().protectedRecordCount, 1);
  await restarted.deleteMany(['source']); await restarted.optimize('/work');
  for (const saved of restarted.get(result.recordId).files) {
    const hydrated = restarted.hydrateFile(saved);
    assert.equal(hydrated.before.text, 'after'); assert.equal(hydrated.after.text, 'before');
  }
});

test('final restore-journal failure returns successful file ids but preserves protected prepared journal', async () => {
  const f = serviceFixture(); await f.store.put('source', record('source'));
  f.current.set('f1.txt', textSide('after'));
  let journalWrites = 0;
  f.table.failPut = (_id, row) => row.kind === 'restore' && ++journalWrites === 3;
  const preview = await f.history.prepare({ recordId: 'source', fileIds: ['f1'] }, f.scope);
  const result = await f.history.restore(preview.token, f.scope);
  assert.equal(result.ok, false); assert.equal(result.journalFailed, true); assert.ok(result.recordId);
  assert.deepEqual(result.restored, ['f1']); assert.equal(result.failed[0].code, 'JOURNAL_FAILED');
  assert.match(result.message, /Restart/); assert.ok(result.message.includes(result.recordId));
  assert.equal(journalWrites, 3); assert.deepEqual(f.mutations, ['f1.txt']);
  assert.equal(f.current.get('f1.txt').text, 'before');
  const saved = f.store.get(result.recordId);
  assert.equal(saved.status, 'prepared'); assert.equal(saved.results.length, 1); assert.equal(saved.results[0].status, 'restored');
  const restarted = new BackupStore(new CloneTable(snapshot(f.table)));
  assert.equal(restarted.stats().protectedRecordCount, 1);
  await restarted.deleteMany(['source']); await restarted.optimize('/work');
  assert.equal(restarted.hydrateFile(restarted.get(result.recordId).files[0]).before.text, 'after');
  assert.equal(restarted.hydrateFile(restarted.get(result.recordId).files[0]).after.text, 'before');
});

test('failed history deletion or GC also latches uncertain storage before another operation', async () => {
  for (const stage of ['history', 'gc']) {
    const table = new CloneTable(), store = new BackupStore(table); await store.put('source', record('source'));
    const remove = table.deleteMany.bind(table);
    table.deleteMany = async keys => {
      const isContent = keys.some(key => table.get(key)?.kind === 'content');
      if (stage === 'history' || isContent) throw new Error('injected deletion failure');
      return remove(keys);
    };
    await assert.rejects(store.deleteMany(['source']), /injected deletion failure/);
    await assert.rejects(store.optimize('/work'), { code: 'BACKUP_STORAGE_UNCERTAIN' });
    const restarted = new BackupStore(new CloneTable(snapshot(table)));
    await restarted.optimize('/work');
    if (stage === 'history') assert.equal(restarted.hydrateFile(restarted.get('source').files[0]).after.text, 'after');
    else assert.equal(restarted.table.size, 0);
  }
});

test('legacy inline rows remain readable; optimize migrates only cwd but sweeps orphans globally', async () => {
  const a = record('legacy-a', [file('a', textSide('\uFEFFold\r\n'.repeat(1000)), textSide('new\r\n'.repeat(1000)))]);
  const b = record('legacy-b', [file('b')], { cwd: '/other' });
  const orphan = encodePack(new Map([[hashText('orphan'), 'orphan']]));
  const table = new CloneTable([[a.id, a], [b.id, b], [orphan.id, orphan]]), store = new BackupStore(table, () => ({ maxRecords: 1, maxStorageBytes: 1 }));
  assert.equal(storageValueSchema.safeParse(a).success, true);
  assert.equal(store.hydrateFile(store.get(a.id).files[0]).before.text, a.files[0].before.text);
  const result = await store.optimize('/work');
  assert.equal(result.migrated, 1); assert.equal(result.reclaimedPacks, 1);
  assert.equal(store.get(a.id).storageFormat, 2); assert.deepEqual(store.get(b.id), b);
  assert.equal(store.stats().legacyRecordCount, 1); assert.equal(table.get(orphan.id), undefined);
  assert.equal(store.hydrateFile(store.get(a.id).files[0]).before.text, a.files[0].before.text);
  assert.equal((await store.optimize('/work')).migrated, 0);
});

test('optimize removes empty warning-only records of the current workspace and keeps other workspaces', async () => {
  // The real shape left by the old build: already format 2, no files, only scan warnings.
  const real = { ...record('real', [file('a')]), storageFormat: 2 };
  const empty = { ...record('empty', [], { warnings: ['Cannot back up logo.png: Cannot back up as UTF-8: bad'] }), storageFormat: 2 };
  const elsewhere = { ...record('elsewhere', [], { cwd: '/other' }), storageFormat: 2 };
  const journal = { ...record('journal', []), kind: 'restore', status: 'partial', results: [], storageFormat: 2 };
  // A truncated scan keeps its coverage record even though it captured no file.
  const truncated = { ...record('truncated', []), coverage: 'incomplete', storageFormat: 2 };
  const table = new CloneTable([[real.id, real], [empty.id, empty], [elsewhere.id, elsewhere], [journal.id, journal], [truncated.id, truncated]]);
  const store = new BackupStore(table);
  const result = await store.optimize('/work');
  assert.equal(result.pruned, 1, 'only the empty change record in this workspace is dropped');
  assert.equal(result.migrated, 0);
  assert.deepEqual([...store.entries()].map(([id]) => id).sort(), ['elsewhere', 'journal', 'real', 'truncated']);
  assert.equal(store.stats().recordCount, 4);
  assert.equal((await store.optimize('/work')).pruned, 0, 're-running is a no-op');
});

test('migration pack/commit failure preserves exact legacy row and restart can safely retry', async () => {
  for (const stage of ['pack', 'commit']) {
    const source = record('legacy'), table = new CloneTable([[source.id, source]]), store = new BackupStore(table);
    table.failPut = (id, value) => stage === 'pack' ? value.kind === 'content' : id === source.id;
    await assert.rejects(store.optimize('/work'), /injected put failure/);
    assert.deepEqual(store.get(source.id), source);
    assert.throws(() => store.hydrateFile(store.get(source.id).files[0]), { code: 'BACKUP_STORAGE_UNCERTAIN' });
    const restarted = new BackupStore(new CloneTable(snapshot(table)));
    assert.equal(restarted.hydrateFile(restarted.get(source.id).files[0]).before.text, 'before');
    await restarted.optimize('/unrelated');
    assert.equal(restarted.stats().orphanPackCount, 0); assert.deepEqual(restarted.get(source.id), source);
    assert.equal((await restarted.optimize('/work')).migrated, 1);
    assert.equal(restarted.hydrateFile(restarted.get(source.id).files[0]).after.text, 'after');
  }
});

test('decode rejects corrupt gzip, base64, identity, hash, byte counts and raw metadata', () => {
  const text = 'hello\uFEFF\r\n'.repeat(200), good = encodePack(new Map([[hashText(text), text]]));
  assert.equal(good.codec, 'gzip');
  const cases = [
    { ...good, data: 'not base64!' }, { ...good, data: 'A' }, { ...good, data: '====' },
    { ...good, data: Buffer.from('not gzip').toString('base64') },
    { ...good, data: good.data.slice(0, -8) }, { ...good, data: gzipSync('wrong').toString('base64') },
    { ...good, rawBytes: good.rawBytes + 1 }, { ...good, id: 'content-wrong' },
    { ...good, texts: [text] }, { ...good, format: 3 },
    manualPack([{ hash: hashText('different'), bytes: Buffer.byteLength(text) }], { codec: 'gzip', data: good.data }),
    manualPack([{ hash: hashText(text), bytes: Buffer.byteLength(text) - 1 }], { codec: 'gzip', data: good.data }),
    manualPack([{ hash: hashText('a'), bytes: 1 }], { codec: 'raw', texts: ['b'] }),
    manualPack([{ hash: hashText('a'), bytes: 1 }], { codec: 'raw', texts: [] }),
    manualPack([{ hash: hashText('a'), bytes: 1 }], { codec: 'raw', texts: ['a'], data: '' }),
    manualPack([{ hash: hashText('a'), bytes: 1 }, { hash: hashText('a'), bytes: 1 }], { codec: 'raw', texts: ['a', 'a'] }),
    manualPack([{ hash: hashText('\uD800'), bytes: 3 }], { codec: 'raw', texts: ['\uD800'] }),
  ];
  for (const candidate of cases) corrupt(() => decodePack(candidate));
});

test('gzip decoding is bounded by declared output and UTF-8 cannot be split across entries', () => {
  const tiny = { hash: hashText('x'), bytes: 1 };
  corrupt(() => decodePack(manualPack([tiny], { codec: 'gzip', data: gzipSync('x'.repeat(4 * 1024 * 1024)).toString('base64') })));
  corrupt(() => decodePack(manualPack([{ hash: hashText(''), bytes: 0 }], { codec: 'gzip', data: gzipSync('x').toString('base64') })));
  corrupt(() => decodePack(manualPack([{ hash: hashText('x'), bytes: 1 }], { codec: 'gzip', data: gzipSync(Buffer.from([0xff])).toString('base64') })));
  const entries = [{ hash: hashText('a'), bytes: 1 }, { hash: hashText('b'), bytes: 2 }];
  corrupt(() => decodePack(manualPack(entries, { codec: 'gzip', data: gzipSync(Buffer.from('€')).toString('base64') })));
  const tooLarge = manualPack([{ hash: hashText('x'), bytes: MAX_CONTENT_BYTES + 1 }], { codec: 'raw', texts: ['x'] });
  assert.equal(storageValueSchema.safeParse(tooLarge).success, false); corrupt(() => decodePack(tooLarge));
  corrupt(() => decodePack({ ...tooLarge, rawBytes: MAX_PACK_BYTES + 1 }));
});

test('readSide validates inline/ref hash and byte count and never masks missing or corrupted content', async () => {
  const table = new CloneTable(), store = new BackupStore(table);
  corrupt(() => store.readSide({ ...textSide('actual'), hash: hashText('other') }));
  corrupt(() => store.readSide({ ...textSide('actual'), bytes: 1 }));
  corrupt(() => store.readSide({ ...textSide('actual'), text: undefined, contentRef: 'missing' }));
  await store.put('r1', record('r1'));
  const side = store.get('r1').files[0].before, packed = table.get(side.contentRef);
  table.map.set(side.contentRef, { ...packed, id: 'wrong' });
  corrupt(() => store.readSide(side));
  table.map.set(side.contentRef, packed);
  corrupt(() => store.readSide({ ...side, bytes: side.bytes + 1 }));
  corrupt(() => store.readSide({ ...side, hash: hashText('not-present') }));
  table.map.delete(side.contentRef); corrupt(() => store.readSide(side));
});

test('dedup never publishes a fresh history reference to a corrupted existing pack', async () => {
  const table = new CloneTable(), store = new BackupStore(table); await store.put('r1', record('r1'));
  const pack = packs(table)[0];
  table.map.set(pack.id, pack.codec === 'raw' ? { ...pack, texts: pack.texts.map(() => 'bad') } : { ...pack, data: 'bad!' });
  const before = snapshot(table), calls = table.calls.length;
  await assert.rejects(store.put('r2', record('r2')), { code: 'BACKUP_CORRUPT' });
  assert.deepEqual(snapshot(table), before); assert.equal(table.calls.length, calls);
});

test('list and detail.record expose metadata without text, pack bytes or content references', async () => {
  const f = serviceFixture(), legacy = record('legacy'), source = record('packed');
  f.table.map.set(legacy.id, legacy); await f.store.put(source.id, source);
  const listed = f.history.list({ cwd: '/work', sessionId: 's1' });
  assert.equal(listed.records.length, 2); assertNoPayload(listed);
  assertNoPayload(publicRecord(f.store.get(source.id)));
  const detail = f.history.detail(source.id, 'f1', '/work');
  assertNoPayload(detail.record);
  // The existing detail contract intentionally returns hydrated text/diff for the
  // selected file only; no storage pack, internal ref, or other file payload leaks.
  assert.equal(detail.file.before.text, 'before'); assert.equal(detail.file.after.text, 'after');
  assert.equal('contentRef' in detail.file.before, false);
  assert.equal(JSON.stringify(detail).includes('"data"'), false);
});

test('ambiguous settings failure latches content mutations until restart and preserves saved backups', async () => {
  const table = new CloneTable(); let current = { retentionDays: 0 }, disk = current, history;
  const store = new BackupStore(table, () => history.settings());
  history = new HistoryService({ records: store, io: {}, limits: {}, global: { get: () => current, async set(value) { disk = value; throw new Error('settings commit outcome unknown'); } } });
  await store.put('kept', record('kept'));
  await assert.rejects(history.setSettings({ maxRecords: 1 }), { code: 'BACKUP_SETTINGS_UNCERTAIN' });
  assert.equal(disk.maxRecords, 1); assert.equal(history.settings().maxRecords, 0);
  await assert.rejects(store.optimize('/work'), { code: 'BACKUP_STORAGE_UNCERTAIN' });
  await assert.rejects(store.put('blocked', record('blocked')), { code: 'BACKUP_STORAGE_UNCERTAIN' });
  current = disk;
  const restarted = new BackupStore(new CloneTable(snapshot(table)), () => current);
  assert.equal(restarted.hydrateFile(restarted.get('kept').files[0]).after.text, 'after');
  await assert.rejects(restarted.put('over-quota', record('over-quota')), { code: 'BACKUP_QUOTA_EXCEEDED' });
});

test('stats equal actual serialized storage and compression+dedup materially reduce space', async () => {
  const old = '\uFEFFconsole.log("old");\r\n'.repeat(6000), newer = '\uFEFFconsole.log("new");\r\n'.repeat(6000);
  const rows = Array.from({ length: 8 }, (_, i) => record(`r${i}`, [file(`f${i}`, textSide(old), textSide(newer))]));
  const table = new CloneTable(rows.map(r => [r.id, r])), store = new BackupStore(table);
  const inlineBytes = totalBytes(table), logicalBytes = rows.length * (Buffer.byteLength(old) + Buffer.byteLength(newer));
  const optimized = await store.optimize('/work'), stats = store.stats();
  assert.equal(optimized.migrated, 8); assert.equal(stats.recordCount, 8); assert.equal(stats.packCount, 1);
  assert.equal(stats.scope, 'all-workspaces'); assert.equal(stats.logicalBytes, logicalBytes);
  assert.equal(stats.uniqueContentBytes, Buffer.byteLength(old) + Buffer.byteLength(newer));
  assert.equal(stats.storedBytes, totalBytes(table)); assert.equal(stats.storedBytes, stats.recordBytes + stats.contentBytes);
  assert.equal(stats.contentBytes, packs(table).reduce((sum, p) => sum + jsonBytes(p), 0));
  assert.ok(stats.storedBytes < inlineBytes / 20, `${stats.storedBytes} should be < 5% of legacy ${inlineBytes}`);
  assert.equal(stats.legacyRecordCount, 0); assert.equal(stats.orphanPackCount, 0);
  for (const [, r] of store.entries()) assert.equal(store.hydrateFile(r.files[0]).before.text, old);
});
