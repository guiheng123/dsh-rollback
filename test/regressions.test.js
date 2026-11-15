import test from 'node:test';
import assert from 'node:assert/strict';
import { absent, hashText, WorkspaceIO, HistoryService, diffText, DIFF_LIMITS } from '../core.js';
const side = (text, version = 'v1') => ({ exists: true, available: true, text, hash: hashText(text), bytes: Buffer.byteLength(text), version });
const unavailable = { exists: true, available: false, text: null, hash: null, bytes: 10, version: 'v1', reason: 'Cannot read file' };
function fixture() {
  let current = side('after');
  let writes = 0;
  const file = { id: 'f', path: 'a.txt', display: 'a.txt', before: absent(), after: side('after') };
  const records = new Map([['r', { id: 'r', cwd: '/work', sessionId: 's', files: [file] }]]);
  const history = new HistoryService({ io: { read: async () => current, restore: async () => { writes++; } }, records: { get: id => records.get(id), put: async (id, value) => records.set(id, value) }, global: { get: () => ({ retentionDays: 0 }) }, limits: {} });
  return { file, history, scope: { cwd: '/work', sessionId: 's' }, setCurrent: value => { current = value; }, writes: () => writes };
}

test('an unreadable current file cannot get a deletion preview token', async () => {
  const f = fixture();
  f.setCurrent(unavailable);
  const result = await f.history.prepare({ recordId: 'r', fileIds: ['f'], side: 'before' }, f.scope);
  assert.equal(result.canRestore, false);
  assert.equal(result.token, null);
  assert.equal(f.writes(), 0);
});

test('a missing current version cannot get a deletion preview token', async () => {
  const f = fixture();
  f.setCurrent({ ...side('after'), version: undefined });
  assert.equal((await f.history.prepare({ recordId: 'r', fileIds: ['f'] }, f.scope)).canRestore, false);
});

test('a current file becoming unreadable after preview aborts before mutation', async () => {
  const f = fixture();
  const preview = await f.history.prepare({ recordId: 'r', fileIds: ['f'] }, f.scope);
  assert.equal(preview.canRestore, true);
  f.setCurrent(unavailable);
  await assert.rejects(() => f.history.restore(preview.token, f.scope), { code: 'STALE_PREVIEW' });
  assert.equal(f.writes(), 0);
});

test('WorkspaceIO refuses unverified expected versions for both deletion and replacement', async () => {
  let writes = 0;
  const fs = { resolve: async path => ({ targetKey: path }), stat: async () => ({ type: 'directory' }), lstat: async () => ({ type: 'file' }), contains: () => true, deleteFile: async () => { writes++; }, writeText: async () => { writes++; } };
  const io = new WorkspaceIO(fs, {});
  for (const target of [absent(), side('before')]) {
    for (const expected of [unavailable, { ...side('after'), version: undefined }]) {
      await assert.rejects(() => io.restore('/work', { path: 'a.txt' }, target, expected), { code: 'CURRENT_VERSION_UNAVAILABLE' });
    }
  }
  assert.equal(writes, 0);
});

test('unavailable snapshots retain existence metadata and expose a warning', async () => {
  const target = { targetKey: '/work/a.txt' };
  const fs = { resolve: async path => path === '/work' ? { targetKey: '/work' } : target, stat: async t => t.targetKey === target.targetKey ? { type: 'file', size: 10, version: 'v1' } : { type: 'directory' }, contains: () => true, lstat: async () => ({ type: 'file', size: 10 }), listDir: async () => [{ name: 'a.txt', target }], readBytes: async () => { throw new Error('read denied'); } };
  const snapshot = await new WorkspaceIO(fs, { maxFileBytes: 100, maxSnapshotBytes: 1000, maxFiles: 10 }).scan('/work');
  assert.equal(snapshot.files.get('a.txt').exists, true);
  assert.equal(snapshot.files.get('a.txt').available, false);
  assert.match(snapshot.warnings[0], /Cannot back up a.txt/);
});

test('a restore token survives a rejected attempt but is spent once it reaches mutation', async () => {
  const f = fixture();
  let writes = 0;
  f.history.io.restore = async () => { writes++; };
  const preview = await f.history.prepare({ recordId: 'r', fileIds: ['f'] }, f.scope);
  // A concurrent editing agent must not burn the user's preview.
  f.history.isBusy = () => true;
  await assert.rejects(() => f.history.restore(preview.token, f.scope), { code: 'WORKSPACE_BUSY' });
  f.history.isBusy = () => false;
  assert.equal((await f.history.restore(preview.token, f.scope)).ok, true);
  assert.equal(writes, 1);
  // Now the plan is spent: replaying it must fail.
  await assert.rejects(() => f.history.restore(preview.token, f.scope), { code: 'PLAN_EXPIRED' });
  assert.equal(writes, 1);
});

test('removing a selected file from a backup yields STALE_PREVIEW instead of a crash', async () => {
  const f = fixture();
  const preview = await f.history.prepare({ recordId: 'r', fileIds: ['f'] }, f.scope);
  // Simulate the backup being pruned after the preview was minted.
  const table = { get: () => ({ id: 'r', cwd: '/work', sessionId: 's', files: [] }) };
  const history = new HistoryService({ io: f.history.io, records: table, global: { get: () => ({ retentionDays: 0 }) }, limits: {} });
  history.tokens = f.history.tokens;
  await assert.rejects(() => history.restore(preview.token, f.scope), { code: 'STALE_PREVIEW' });
});

test('diff limits reject oversized ASCII, UTF-8 and newline inputs before line allocation', () => {

  for (const text of ['a'.repeat(DIFF_LIMITS.maxInputBytes + 1), '中'.repeat(Math.floor(DIFF_LIMITS.maxInputBytes / 3) + 1), '\n'.repeat(DIFF_LIMITS.maxInputLines)]) {
    assert.deepEqual(diffText(text, ''), { lines: [], truncated: true, coarse: true });
  }
});

test('diff handles asymmetric middles, empty middles and caps requested output', () => {
  const large = Array(1500).fill('old').join('\n');
  const small = Array(170).fill('new').join('\n');
  const result = diffText(large, small);
  assert.equal(result.coarse, true);
  assert.equal(result.lines.length, 1670);
  // n*m fits the old budget, but the actual table including its border exceeds it.
  assert.equal(diffText(Array(500).fill('a').join(String.fromCharCode(10)), Array(499).fill('b').join(String.fromCharCode(10))).coarse, true);
  assert.equal(diffText('head\ntail', 'head\nadded\ntail').lines.filter(line => line.type === 'add')[0].text, 'added');
  assert.equal(diffText('x\n'.repeat(3000), '', 100000).lines.length, DIFF_LIMITS.maxOutputLines);
  assert.equal(diffText('a\nb\n', 'a\r\nb\r\n').lines.every(line => line.type === 'equal'), true);
});

test('a turn that changed nothing records no backup, even when the workspace holds unbackable files', async () => {
  const put = [];
  const snapshot = warnings => ({ files: new Map([['logo.png', { exists: true, available: false, bytes: 90, hash: null, text: null, version: 'v1', reason: 'Cannot back up as UTF-8: The encoded data was not valid for encoding utf-8' }]]), skipped: new Set(), warnings, complete: true });
  const history = new HistoryService({ io: {}, records: { put: async (id, value) => put.push(value) }, global: { get: () => ({ retentionDays: 0 }) }, limits: {} });
  const warnings = ['Cannot back up logo.png: Cannot back up as UTF-8: The encoded data was not valid for encoding utf-8'];
  const saved = await history.saveChange({ id: 'r', sessionId: 's', turn: 1, turnStartSeq: 1, messageSeq: 2, cwd: '/work', before: snapshot(warnings), after: snapshot(warnings) });
  assert.equal(saved, null, 'scan warnings alone must not create an unrestorable record');
  assert.equal(put.length, 0);
});

test('a truncated scan keeps its coverage diagnostic even with no captured file', async () => {
  const put = [];
  const truncated = { files: new Map(), skipped: new Set(), warnings: ['Snapshot entry limit reached; coverage is incomplete.'], complete: false };
  const history = new HistoryService({ io: {}, records: { put: async (id, value) => put.push(value) }, global: { get: () => ({ retentionDays: 0 }) }, limits: {} });
  const record = await history.saveChange({ id: 'r', sessionId: 's', turn: 1, turnStartSeq: 1, messageSeq: 2, cwd: '/work', before: truncated, after: truncated });
  assert.equal(record.coverage, 'incomplete');
  assert.equal(record.files.length, 0);
  assert.deepEqual(record.warnings, ['Snapshot entry limit reached; coverage is incomplete.']);
  assert.equal(put.length, 1, 'an incomplete scan cannot prove that nothing changed');
});

test('record warnings describe only this turn\'s changes, grouped and deduplicated', async () => {
  const put = [];
  const unbackable = (reason, version) => ({ exists: true, available: false, bytes: 90, hash: null, text: null, version, reason });
  const before = { files: new Map([['a.txt', side('old')], ['logo.png', unbackable('Cannot back up as UTF-8: bad', 'p1')], ['same.png', unbackable('Cannot back up as UTF-8: bad', 'p1')]]), skipped: new Set(), warnings: ['Cannot back up logo.png: Cannot back up as UTF-8: bad', 'Cannot back up same.png: Cannot back up as UTF-8: bad', 'Cannot back up notes.bin: Cannot back up as UTF-8: bad', 'Snapshot entry limit reached; coverage is incomplete.'], complete: true };
  const after = { files: new Map([['a.txt', side('new', 'v2')], ['logo.png', unbackable('Cannot back up as UTF-8: bad', 'p2')], ['same.png', unbackable('Cannot back up as UTF-8: bad', 'p1')], ['huge.zip', unbackable('File exceeds backup size limit', 'z1')]]), skipped: new Set(), warnings: ['Cannot back up logo.png: Cannot back up as UTF-8: bad', 'Cannot back up huge.zip: File exceeds backup size limit'], complete: true };
  const history = new HistoryService({ io: {}, records: { put: async (id, value) => put.push(value) }, global: { get: () => ({ retentionDays: 0 }) }, limits: {} });
  const record = await history.saveChange({ id: 'r', sessionId: 's', turn: 1, turnStartSeq: 1, messageSeq: 2, cwd: '/work', before, after });
  assert.equal(record.files.length, 3, 'the changed text file, the changed image and the new archive are recorded');
  // notes.bin never changed in this turn and same.png is byte-identical: neither is reported.
  assert.equal(record.warnings.some(warning => warning.includes('notes.bin')), false);
  assert.equal(record.warnings.some(warning => warning.includes('same.png')), false);
  assert.equal(record.warnings.filter(warning => warning.includes('logo.png')).length, 1);
  assert.equal(record.warnings.some(warning => warning.includes('huge.zip') && warning.includes('over the per-file size limit')), true);
  assert.equal(record.warnings.some(warning => warning.includes('Snapshot entry limit reached')), true, 'scan-level problems still explain coverage');
  assert.equal(record.warnings.filter(warning => warning.startsWith('Cannot back up ')).length, 2, 'one line per cause, not one per file');
  assert.equal(record.warnings.length, 3);
});

test('grouped change warnings stay bounded when many files fail the same way', async () => {
  const unbackable = version => ({ exists: true, available: false, bytes: 4, hash: null, text: null, version, reason: 'Cannot back up as UTF-8: bad' });
  const files = Array.from({ length: 40 }, (_, index) => `img${String(index).padStart(2, '0')}.png`);
  const before = { files: new Map(), skipped: new Set(), warnings: [], complete: true };
  const after = { files: new Map(files.map(name => [name, unbackable('v1')])), skipped: new Set(), warnings: [], complete: true };
  const put = [];
  const history = new HistoryService({ io: {}, records: { put: async (id, value) => put.push(value) }, global: { get: () => ({ retentionDays: 0 }) }, limits: {} });
  const record = await history.saveChange({ id: 'r', sessionId: 's', turn: 1, turnStartSeq: 1, messageSeq: 2, cwd: '/work', before, after });
  assert.equal(record.files.length, 40);
  assert.equal(record.warnings.length, 1);
  assert.match(record.warnings[0], /40 changed files/);
  assert.match(record.warnings[0], /\(\+32 more\)$/);
});

function memoryFs(contents = new Map([['/work/a.txt', 'after']])) {
  const target = path => ({ targetKey: path, displayPath: path });
  const fs = {
    resolve: async path => target(path), contains: (root, child) => child.targetKey === root.targetKey || child.targetKey.startsWith(`${root.targetKey}/`),
    stat: async t => t.targetKey === '/work' ? { type: 'directory', version: 'root' } : contents.has(t.targetKey) ? { type: 'file', version: 'v1', size: Buffer.byteLength(contents.get(t.targetKey)) } : undefined,
    lstat: async path => fs.stat(target(path)), listDir: async t => t.targetKey === '/work' ? [...contents].map(([path]) => ({ name: path.slice(6), target: target(path) })) : [],
    readBytes: async (t, _signal, cap) => { const bytes = Buffer.from(contents.get(t.targetKey)); if (bytes.length > cap) throw Object.assign(new Error('too large'), { code: 'FS_TOO_LARGE' }); return bytes; },
    writeText: async () => {}, deleteFile: async () => {}
  };
  return fs;
}
const ioLimits = { maxFileBytes: 100, maxSnapshotBytes: 1000, maxFiles: 10, excludeDirectories: [] };

test('portable path validation blocks ADS, drive-relative paths, device names and Win32 aliases', async () => {
  const io = new WorkspaceIO(memoryFs(), ioLimits);
  for (const path of ['a.txt:stream', 'C:outside', 'dir/D:other', 'a.txt::$DATA', 'CON', 'nul.txt', 'LPT1.log', 'COM¹', 'a.', 'a ', 'dir/.. /x', '/absolute', '\\absolute', 'dir\\file', 'a\u0001b', '', null, 1]) {
    await assert.rejects(() => io.target('/work', path), { code: 'INVALID_PATH' }, String(path));
  }
  assert.equal((await io.target('/work', 'normal.txt')).targetKey, '/work/normal.txt');
});

test('root, parent and leaf symbolic links are rejected before content reads or writes', async () => {
  for (const linked of ['/work', '/work/dir', '/work/dir/a.txt']) {
    const fs = memoryFs(); const lstat = fs.lstat;
    fs.lstat = async path => path === linked ? { type: 'symlink', version: 'link' } : lstat(path);
    const io = new WorkspaceIO(fs, ioLimits);
    await assert.rejects(() => io.read('/work', 'dir/a.txt'), { code: 'UNSAFE_PATH' });
  }
});

test('directory-list and lstat failures retain incomplete coverage even when no changes are known', async () => {
  for (const fail of ['list', 'lstat']) {
    const fs = memoryFs();
    if (fail === 'list') fs.listDir = async () => { throw new Error('listing unavailable'); };
    else { const lstat = fs.lstat; fs.lstat = async path => { if (path.endsWith('a.txt')) throw new Error('metadata unavailable'); return lstat(path); }; }
    const snapshot = await new WorkspaceIO(fs, ioLimits).scan('/work');
    assert.equal(snapshot.complete, false); assert.equal(snapshot.files.size, 0);
    const f = fixture(); const saved = await f.history.saveChange({ id: 'incomplete', sessionId: 's', cwd: '/work', before: snapshot, after: snapshot });
    assert.equal(saved.coverage, 'incomplete'); assert.ok(saved.warnings.length);
  }
});

test('snapshot read cap uses actual remaining budget when metadata omits file sizes', async () => {
  const fs = memoryFs(new Map([['/work/a.txt', '12345'], ['/work/b.txt', '67890']]));
  const stat = fs.stat, caps = [];
  fs.stat = async t => { const info = await stat(t); if (info) delete info.size; return info; };
  const read = fs.readBytes; fs.readBytes = async (t, signal, cap) => { caps.push(cap); return read(t, signal, cap); };
  const snapshot = await new WorkspaceIO(fs, { ...ioLimits, maxSnapshotBytes: 6 }).scan('/work');
  assert.deepEqual(caps, [6, 1]); assert.equal(snapshot.bytes, 5);
  assert.equal(snapshot.files.get('b.txt').available, false);
});

test('missing version metadata fails snapshot capture closed instead of trusting two undefined versions', async () => {
  const fs = memoryFs(), stat = fs.stat;
  fs.stat = async t => { const info = await stat(t); if (info?.type === 'file') delete info.version; return info; };
  const value = await new WorkspaceIO(fs, ioLimits).read('/work', 'a.txt');
  assert.equal(value.available, false); assert.match(value.reason, /version was unavailable/);
});

test('async busy checks are awaited and a late busy transition refuses before journal writes', async () => {
  const f = fixture(); f.history.isBusy = async () => false;
  const plan = await f.history.prepare({ recordId: 'r', fileIds: ['f'] }, f.scope);
  let checks = 0;
  f.history.isBusy = async () => ++checks > 1;
  await assert.rejects(() => f.history.restore(plan.token, f.scope), { code: 'WORKSPACE_BUSY' });
  assert.equal(f.writes(), 0);
  assert.ok(f.history.tokens.has(plan.token), 'rejected preflight does not spend token');
});

test('restore revalidates liveness after serial queuing and holds its workspace lock through completion', async () => {
  const f = fixture(), plan = await f.history.prepare({ recordId: 'r', fileIds: ['f'] }, f.scope);
  let release, locked = false;
  f.history.queue = new Promise(resolve => { release = resolve; });
  const pending = f.history.restore(plan.token, { ...f.scope, withWorkspaceLock: async operation => { locked = true; try { return await operation(); } finally { locked = false; } }, validateScope: () => { assert.equal(locked, true); throw Object.assign(new Error('detached'), { code: 'SESSION_CHANGED' }); } });
  release();
  await assert.rejects(pending, { code: 'SESSION_CHANGED' }); assert.equal(locked, false); assert.equal(f.writes(), 0);
});

test('restore selection memory budget bounds legacy rows before hydration or any mutation', async () => {
  const f = fixture(); f.file.before = side('old'); f.history.limits.maxSnapshotBytes = 2;
  let hydrated = false;
  f.history.hydrateFile = () => { hydrated = true; throw new Error('must not decode'); };
  await assert.rejects(() => f.history.prepare({ recordId: 'r', fileIds: ['f'] }, f.scope), { code: 'RESTORE_SIZE_LIMIT' });
  assert.equal(hydrated, false); assert.equal(f.writes(), 0);
});

test('a file disappearing between listing and content read is unknown, not an authoritative absence', async () => {
  const fs = memoryFs(), stat = fs.stat;
  let fileStats = 0;
  fs.stat = async target => target.targetKey.endsWith('a.txt') && ++fileStats > 1 ? undefined : stat(target);
  const captured = await new WorkspaceIO(fs, ioLimits).scan('/work');
  assert.equal(captured.complete, false); assert.equal(captured.files.has('a.txt'), false); assert.equal(captured.skipped.has('a.txt'), true);
});

test('canonical workspace keys prevent capture and restore after root redirection', async () => {
  const f = fixture();
  f.history.io.root = async () => ({ targetKey: 'new-root' });
  f.history.records.get('r').workspaceKey = 'original-root';
  await assert.rejects(() => f.history.prepare({ recordId: 'r', fileIds: ['f'] }, f.scope), { code: 'WORKSPACE_CHANGED' });
  const snapshot = rootKey => ({ rootKey, files: new Map(), skipped: new Set(), warnings: [], complete: true });
  await assert.rejects(() => f.history.saveChange({ id: 'r2', cwd: '/work', before: snapshot('old'), after: snapshot('new') }), { code: 'WORKSPACE_CHANGED' });
});
