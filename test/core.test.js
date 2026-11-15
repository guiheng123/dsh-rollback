import test from 'node:test';
import assert from 'node:assert/strict';
import { absent, hashText, publicRecord, snapshotChanges, diffText, HistoryService, WorkspaceIO } from '../core.js';

const textSide = (text, version = 'v1') => ({ exists: true, available: true, bytes: Buffer.byteLength(text), text, hash: hashText(text), version });
const snapshot = (values, extra = {}) => ({ files: new Map(Object.entries(values)), skipped: new Set(), warnings: [], complete: true, ...extra });
class Table {
  constructor() { this.map = new Map(); this.fail = false; }
  get(key) { return this.map.get(key); }
  entries() { return this.map.entries(); }
  get size() { return this.map.size; }
  async put(key, value) { if (this.fail) throw new Error('disk full'); this.map.set(key, structuredClone(value)); }
  async deleteMany(keys) { let count = 0; for (const key of keys) count += this.map.delete(key) ? 1 : 0; return count; }
}
function fixture() {
  const records = new Table(), current = new Map([['a.txt', textSide('after')]]), mutations = [];
  let globalValue = { retentionDays: 0 }, time = 1000000000;
  const io = { async read(_cwd, path) { return structuredClone(current.get(path) ?? absent()); }, async restore(cwd, file, side, expected, policy) {
    assert.ok(records.size > 1, 'journal must exist before workspace mutation');
    assert.equal(policy.mode, 'workspace-write');
    mutations.push(file.path);
    if (side.exists) current.set(file.path, textSide(side.text, `v${mutations.length + 1}`)); else current.delete(file.path);
  } };
  const history = new HistoryService({ io, records, global: { get: () => globalValue, set: async value => { globalValue = value; } }, limits: { defaultRetentionDays: 0 }, now: () => time });
  const file = { id: 'f1', path: 'a.txt', display: 'a.txt', change: 'modified', before: textSide('before'), after: textSide('after') };
  const record = { id: 'r1', kind: 'change', cwd: '/work', sessionId: 's1', turn: 1, turnStartSeq: 2, messageSeq: 8, createdAt: time, files: [file], warnings: [] };
  records.map.set(record.id, structuredClone(record));
  const scope = { cwd: '/work', sessionId: 's1', policy: { mode: 'workspace-write', workspaceRoot: '/work' } };
  return { records, current, mutations, history, scope, record, setTime: value => { time = value; } };
}
test('captures modified, created, deleted, and empty files without false absence', () => {
  const changes = snapshotChanges(snapshot({ 'a.txt': textSide('old'), 'deleted': textSide('gone'), 'same': textSide('') }), snapshot({ 'a.txt': textSide('new'), 'new': textSide(''), 'same': textSide('') }));
  assert.deepEqual(changes.map(f => [f.path, f.change]), [['a.txt', 'modified'], ['deleted', 'deleted'], ['new', 'added']]);
  assert.equal(changes[1].after.exists, false);
  assert.equal(changes[2].after.text, '');
});
test('incomplete coverage never guesses creations or deletions', () => {
  assert.equal(snapshotChanges(snapshot({}, { complete: false }), snapshot({ a: textSide('a') })).length, 0);
  assert.equal(snapshotChanges(snapshot({ a: textSide('a') }), snapshot({}, { skipped: new Set(['']) })).length, 0);
});
test('line diff handles actual LF/CRLF and bounded/coarse output', () => {
  const diff = diffText('a\nb\nc\n', 'a\nx\nc\n');
  assert.deepEqual(diff.lines.map(l => l.type), ['equal', 'remove', 'add', 'equal', 'equal']);
  assert.equal(diffText('a\r\nb', 'a\r\nc').lines[0].text, 'a');
  assert.equal(diffText('a\nb', 'a\nc', 1).truncated, true);
  assert.equal(diffText(Array(600).fill('x').join('\n'), Array(600).fill('y').join('\n')).coarse, true);
});
test('public list omits saved contents', () => {
  const f = fixture();
  const visible = publicRecord(f.record);
  assert.equal('text' in visible.files[0].before, false);
  assert.equal(JSON.stringify(visible).includes('"text"'), false);
});
test('prepare + confirm retains both rollback versions and a one-use token', async () => {
  const f = fixture();
  const plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1'] }, f.scope);
  assert.equal(plan.canRestore, true);
  const result = await f.history.restore(plan.token, f.scope);
  assert.equal(result.ok, true);
  assert.equal(f.current.get('a.txt').text, 'before');
  const journal = f.records.get(result.recordId);
  assert.equal(journal.before, undefined);
  assert.equal(journal.files[0].before.text, 'after');
  assert.equal(journal.files[0].after.text, 'before');
  assert.equal(f.records.get('r1').files[0].after.text, 'after');
  await assert.rejects(() => f.history.restore(plan.token, f.scope), { code: 'PLAN_EXPIRED' });
});
test('stale previews and conflicts cannot overwrite later work', async () => {
  const f = fixture();
  const plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1'] }, f.scope);
  f.current.set('a.txt', textSide('later', 'v2'));
  await assert.rejects(() => f.history.restore(plan.token, f.scope), { code: 'STALE_PREVIEW' });
  assert.equal(f.mutations.length, 0);
  const conflict = await f.history.prepare({ recordId: 'r1', fileIds: ['f1'] }, f.scope);
  assert.equal(conflict.canRestore, false);
  assert.equal(conflict.token, null);
});
test('journal durability failure aborts before any mutation', async () => {
  const f = fixture(), plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1'] }, f.scope);
  f.records.fail = true;
  await assert.rejects(() => f.history.restore(plan.token, f.scope), /disk full/);
  assert.equal(f.mutations.length, 0);
});
test('cross-workspace and cross-session preview tokens are rejected', async () => {
  const f = fixture();
  assert.throws(() => f.history.detail('r1', 'f1', '/other'), { code: 'NOT_FOUND' });
  const plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1'] }, f.scope);
  await assert.rejects(() => f.history.restore(plan.token, { ...f.scope, sessionId: 'other' }), { code: 'PLAN_EXPIRED' });
});
test('busy agents and expired plans refuse restoration', async () => {
  const f = fixture();
  f.history.isBusy = () => true;
  await assert.rejects(() => f.history.prepare({ recordId: 'r1', fileIds: ['f1'] }, f.scope), { code: 'WORKSPACE_BUSY' });
  f.history.isBusy = () => false;
  const plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1'] }, f.scope);
  f.setTime(plan.expiresAt + 1);
  await assert.rejects(() => f.history.restore(plan.token, f.scope), { code: 'PLAN_EXPIRED' });
});
test('retention zero keeps backups; expiration protects partial recovery records', async () => {
  const f = fixture(); f.setTime(f.record.createdAt + 3 * 86400000);
  assert.equal((await f.history.clean()).deleted, 0);
  await f.history.setSettings(1);
  f.records.map.set('partial', { ...f.record, id: 'partial', status: 'partial' });
  assert.equal((await f.history.clean()).deleted, 1);
  assert.ok(f.records.get('partial'));
  assert.equal(f.mutations.length, 0);
  await assert.rejects(() => f.history.setSettings(-1), { code: 'INVALID_RETENTION' });
});
test('manual cleanup needs confirmation and touches no working files', async () => {
  const f = fixture();
  await assert.rejects(() => f.history.remove(['r1'], '/work', false), { code: 'CONFIRM_REQUIRED' });
  assert.equal((await f.history.remove(['r1'], '/work', true)).deleted, 1);
  assert.equal(f.current.get('a.txt').text, 'after');
});
test('rollback of a creation removes the file and rollback of a deletion recreates it', async () => {
  const f = fixture();
  const record = f.records.get('r1');
  record.files[0].before = absent(); record.files[0].change = 'added';
  let plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1'] }, f.scope);
  const first = await f.history.restore(plan.token, f.scope);
  assert.equal(first.ok, true); assert.equal(f.current.has('a.txt'), false);
  const undo = f.records.get(first.recordId);
  plan = await f.history.prepare({ recordId: undo.id, fileIds: [undo.files[0].id], side: 'before' }, f.scope);
  assert.equal((await f.history.restore(plan.token, f.scope)).ok, true);
  assert.equal(f.current.get('a.txt').text, 'after');
});
test('partial multi-file restore retains a recovery journal and stops at first failure', async () => {
  const f = fixture();
  const record = f.records.get('r1');
  record.files.push({ ...structuredClone(record.files[0]), id: 'f2', path: 'b.txt', display: 'b.txt' });
  f.current.set('b.txt', textSide('after'));
  const restore = f.history.io.restore;
  f.history.io.restore = async (...args) => { if (args[1].path === 'b.txt') throw new Error('blocked'); return restore(...args); };
  const plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1', 'f2'] }, f.scope);
  const result = await f.history.restore(plan.token, f.scope);
  assert.equal(result.ok, false);
  assert.deepEqual(result.restored, ['f1']); assert.equal(result.failed[0].id, 'f2');
  assert.equal(f.records.get(result.recordId).status, 'partial');
  assert.equal(f.records.get(result.recordId).files.length, 2);
  assert.equal(f.current.get('a.txt').text, 'before'); assert.equal(f.current.get('b.txt').text, 'after');
});
test('unavailable binary backup is never restored as an empty file', async () => {
  const f = fixture(); const record = f.records.get('r1');
  record.files[0].before = { exists: true, available: false, bytes: 20, hash: null, text: null, reason: 'Binary file' };
  const plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1'] }, f.scope);
  assert.equal(plan.canRestore, false); assert.equal(plan.token, null); assert.equal(f.mutations.length, 0);
});
test('core honors explicit preview busy exemption; Host never grants it to UI restore', async () => {
  const f = fixture();
  f.history.isBusy = (_cwd, allowed) => allowed !== 's1';
  await assert.rejects(() => f.history.prepare({ recordId: 'r1', fileIds: ['f1'] }, f.scope), { code: 'WORKSPACE_BUSY' });
  const scope = { ...f.scope, allowActiveSessionId: 's1' };
  const plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1'] }, scope);
  assert.equal((await f.history.restore(plan.token, scope)).ok, true);
});
test('turn index aggregates changed files by turn number and ignores other sessions and restores', () => {
  const f = fixture(), source = f.records.get('r1');
  source.endSeq = 11;
  source.files.push({ ...structuredClone(source.files[0]), id: 'f2', path: 'b.txt' });
  // A restore journal for the same Turn must not inflate the changed-file count.
  f.records.map.set('restore1', { ...structuredClone(source), id: 'restore1', kind: 'restore', endSeq: 12, sessionId: 's1' });
  f.records.map.set('other', { ...structuredClone(source), id: 'other', sessionId: 's2', endSeq: 11, cwd: '/work' });
  assert.deepEqual(f.history.turns({ cwd: '/work', sessionId: 's1' }), { ok: true, turns: [{ turn: 1, endSeq: 11, fileCount: 2 }], truncated: false });
  assert.deepEqual(f.history.turns({ cwd: '/work', sessionId: 'missing' }).turns, []);
  // A second Turn in the same Session stays a separate row, newest first.
  f.records.map.set('turn2', { ...structuredClone(source), id: 'turn2', turn: 2, endSeq: 20 });
  assert.deepEqual(f.history.turns({ cwd: '/work', sessionId: 's1' }).turns.map(row => [row.turn, row.endSeq, row.fileCount]), [[2, 20, 2], [1, 11, 2]]);
});
test('list filters by exact turn and page bounds clamp', () => {
  const f = fixture(), source = f.records.get('r1');
  source.endSeq = 11;
  f.records.map.set('turn2', { ...structuredClone(source), id: 'turn2', turn: 2, endSeq: 20 });
  assert.deepEqual(f.history.list({ cwd: '/work', sessionId: 's1', turn: 2 }).records.map(r => r.id), ['turn2']);
  assert.deepEqual(f.history.list({ cwd: '/work', sessionId: 's1', turn: 1 }).records.map(r => r.id), ['r1']);
  assert.equal(f.history.list({ cwd: '/work', sessionId: 's1', turn: 9 }).total, 0);
  const paged = f.history.list({ cwd: '/work', sessionId: 's1', offset: -5, limit: 999 });
  assert.equal(paged.records.length, 2);
  assert.equal(paged.records.some(r => 'text' in r.files[0].before), false);
});
test('workspaceOf recovers a cold session workspace from retained records', () => {
  const f = fixture();
  assert.equal(f.history.workspaceOf('s1'), '/work');
  assert.equal(f.history.workspaceOf('unknown'), undefined);
  f.records.map.set('newer', { ...structuredClone(f.records.get('r1')), id: 'newer', cwd: '/elsewhere', createdAt: f.record.createdAt + 1 });
  assert.equal(f.history.workspaceOf('s1'), '/elsewhere');
});
test('no-op restore spends its token without a journal or any workspace write', async () => {
  const f = fixture();
  const plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1'], side: 'after' }, f.scope);
  assert.equal(plan.files[0].noOp, true);
  assert.equal('text' in f.history.tokens.get(plan.token).checks[0].current, false);
  const result = await f.history.restore(plan.token, f.scope);
  assert.equal(result.noOp, true); assert.equal(result.recordId, null);
  assert.deepEqual(result.skipped, ['f1']); assert.deepEqual(result.restored, []);
  assert.equal(f.records.size, 1); assert.equal(f.mutations.length, 0);
  await assert.rejects(() => f.history.restore(plan.token, f.scope), { code: 'PLAN_EXPIRED' });
});
test('mixed restore journals only real changes but still checks skipped files for staleness', async () => {
  const f = fixture(), source = f.records.get('r1');
  source.files.push({ ...structuredClone(source.files[0]), id: 'f2', path: 'b.txt' });
  f.current.set('b.txt', textSide('before'));
  let plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1', 'f2'] }, f.scope);
  f.current.set('b.txt', textSide('before', 'new-version'));
  await assert.rejects(() => f.history.restore(plan.token, f.scope), { code: 'STALE_PREVIEW' });
  assert.equal(f.mutations.length, 0);
  plan = await f.history.prepare({ recordId: 'r1', fileIds: ['f1', 'f2'] }, f.scope);
  const result = await f.history.restore(plan.token, f.scope);
  assert.deepEqual(result.skipped, ['f2']); assert.deepEqual(result.restored, ['f1']);
  assert.equal(f.records.get(result.recordId).files.length, 1);
});
test('quota settings validate safe integers, merge patches and retain unlimited defaults', async () => {
  const f = fixture();
  assert.deepEqual(f.history.settings(), { retentionDays: 0, maxStorageBytes: 0, maxRecords: 0 });
  await f.history.setSettings({ maxStorageBytes: 1024, maxRecords: 5 });
  await f.history.setSettings(7);
  assert.deepEqual(f.history.settings(), { retentionDays: 7, maxStorageBytes: 1024, maxRecords: 5 });
  for (const value of [-1, 0.1, Infinity, Number.MAX_SAFE_INTEGER + 1, '100']) await assert.rejects(() => f.history.setSettings({ maxStorageBytes: value }), { code: 'INVALID_QUOTA' });
});
test('WorkspaceIO rejects traversal and handles strict UTF-8/BOM/NULL', async () => {
  const fs = { resolve: async path => ({ targetKey: path, displayPath: path }), stat: async t => t.targetKey === '/work' ? { type: 'directory', version: 'r' } : { type: 'file', version: 'v1', size: 10 }, contains: (r, c) => c.targetKey.startsWith(`${r.targetKey}/`), lstat: async () => ({ type: 'file' }), readBytes: async () => new TextEncoder().encode('\uFEFFok\r\n') };
  const io = new WorkspaceIO(fs, { maxFileBytes: 100, maxSnapshotBytes: 1000, maxFiles: 10, excludeDirectories: [] });
  await assert.rejects(() => io.target('/work', '../bad'), { code: 'INVALID_PATH' });
  const bom = await io.read('/work', 'good.txt');
  assert.equal(bom.text, '\uFEFFok\r\n');
  fs.readBytes = async () => new Uint8Array([0, 1, 2]);
  assert.equal((await io.read('/work', 'binary')).available, false);
  fs.readBytes = async () => new Uint8Array([0xff]);
  assert.equal((await io.read('/work', 'invalid')).available, false);
});
