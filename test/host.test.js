import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { apply, MAX_BODY_BYTES } from '../index.js';
import { hashText } from '../core.js';
import { decodePack } from '../storage.js';

// Mirrors dsh-client-connection bridge(): the route's declared body mode decides
// how the carrier turns the raw socket into a WHATWG Request, for EVERY method the
// route accepts. A `streaming` declaration therefore attaches a body to GET/HEAD,
// which `new Request` rejects — exactly how history reads used to fail with a 400.
function carrierRequest(route, { method = 'GET', url = 'http://localhost/api/local-dsh-rollback', body, headers } = {}) {
  if (route.requestBody === 'buffered') return new Request(url, { method, ...(headers === undefined ? {} : { headers }), ...(body === undefined ? {} : { body }) });
  const stream = Readable.toWeb(Readable.from(body === undefined ? [] : [body]));
  return new Request(url, { method, ...(headers === undefined ? {} : { headers }), body: stream, duplex: 'half' });
}

function hostFixture() {
  const listeners = new Map(), disposers = [], data = new Map(), states = new WeakMap();
  let projected, tool, command, route, globalValue;
  const session = { id: 's1', firstLifecycleSeq: 0, header: { cwd: '/work' }, seq: 0 };
  const agent = { id: 's1' }, files = new Map([['/work/a.txt', { text: 'old\r\n', version: 'v1' }]]);
  const directory = { targetKey: '/work', displayPath: '/work' };
  const fs = {
    resolve: async path => ({ targetKey: path.replaceAll('\\', '/'), displayPath: path }),
    contains: (root, child) => child.targetKey === root.targetKey || child.targetKey.startsWith(`${root.targetKey}/`),
    stat: async target => target.targetKey === '/work' ? { type: 'directory', version: 'root' } : files.has(target.targetKey) ? { type: 'file', size: Buffer.byteLength(files.get(target.targetKey).text), version: files.get(target.targetKey).version } : undefined,
    lstat: async path => fs.stat({ targetKey: path }),
    listDir: async target => target.targetKey === '/work' ? [...files].map(([key, value]) => ({ name: key.slice(6), type: 'file', size: Buffer.byteLength(value.text), target: { targetKey: key, displayPath: key } })) : [],
    readBytes: async target => Buffer.from(files.get(target.targetKey).text),
    async writeText(target, content, guard, signal, policy) {
      assert.equal(policy.mode, 'workspace-write');
      const current = files.get(target.targetKey);
      if (guard.kind === 'replaceIfVersion') assert.equal(current.version, guard.version); else assert.equal(current, undefined);
      files.set(target.targetKey, { text: content, version: `v${Math.random()}` }); return { version: files.get(target.targetKey).version };
    },
    async deleteFile(target, guard, signal, policy) { assert.equal(policy.mode, 'workspace-write'); assert.equal(files.get(target.targetKey).version, guard.version); files.delete(target.targetKey); }
  };
  const table = { get: key => data.get(key), entries: () => data.entries(), get size() { return data.size; }, put: async (key, value) => { if (state.beforePut) await state.beforePut(key, value); data.set(key, structuredClone(value)); }, deleteMany: async keys => keys.reduce((n, key) => n + Number(data.delete(key)), 0) };
  // Attachment and liveness are independent: a reopened Session is attached (so it can
  // be listed) while no Agent is live (so restore must wait).
  const state = { attached: true, live: true };
  const ctx = {
    fs,
    get: key => key === 'sessionController' ? { state: async () => ({ running: false }) } : undefined,
    storageDomain: { async open(spec) {
      assert.equal(spec.version, 2); assert.deepEqual(spec.compatibleVersions, [1]);
      globalValue = spec.global.initial;
      const validatedTable = { ...table, get size() { return data.size; }, put: (key, value) => table.put(key, spec.tables.records.valueSchema.parse(value)) };
      return { table: () => validatedTable, global: { get: () => globalValue, set: async value => { globalValue = spec.global.schema.parse(value); } }, close: async () => {} };
    } }, 
    sessionProjections: { async register(definition) { projected = definition; return { stateOf: s => states.get(s) ?? definition.init(s.header, 0), dispose: async () => {} }; } },
    sessions: { get: id => state.attached && id === 's1' ? session : undefined, list: () => state.attached ? [session] : [] },
    agents: { list: () => state.live ? [agent] : [], get: id => state.live && id === 's1' ? agent : undefined },
    workingDirectory: { get: () => '/work' },
    commands: { register(def) { command = def; return () => {}; } }, tools: { register(def) { tool = def; return () => {}; } },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/work', sessionId: 's1' }) },
    connection: { browserPeer: { id: 'browser' }, admit: request => request.headers.get('authorization') === 'Bearer api-test' ? { peer: { id: 'api' } } : request.headers.get('authorization') === 'Bearer invalid' ? { rejection: 401 } : { peer: { id: 'browser' } }, fetch: { register(def) { route = def; return async () => {}; } } },
    on(event, fn) { const list = listeners.get(event) ?? []; list.push(fn); listeners.set(event, list); return () => {}; },
    effect(fn) { const disposer = fn(); if (disposer) disposers.push(disposer); return disposer; }
  };
  const event = async (type, payload) => { const entry = { type, seq: session.seq++, time: Date.now(), data: payload }; states.set(session, projected.apply(states.get(session) ?? projected.init(session.header, 0), entry)); for (const handler of listeners.get('session/event') ?? []) handler(session, entry); return entry; };
  const run = async (name, ...args) => { for (const handler of listeners.get(name) ?? []) await handler(...args); };
  return { ctx, files, data, session, agent, state, event, run, route: () => route, tool: () => tool, command: () => command, async close() { for (const disposer of disposers.reverse()) await disposer(); } };
}
test('Host lifecycle captures a completed turn and keeps file writes user-only', async () => {
  const f = hostFixture();
  await apply(f.ctx, { maxFileBytes: 4096, maxSnapshotBytes: 8192, maxFiles: 10 });
  try {
    await f.event('turn/start', { turn: 1 });
    const payload = { agent: f.agent, signal: new AbortController().signal, turn: 1, step: 1 };
    const enter = { kind: 'enter', messages: [], startsRequestSeries: true };
    await f.run('agent/pre-step', payload, async () => enter);
    f.files.set('/work/a.txt', { text: 'new\r\n', version: 'v2' });
    const msg = await f.event('assistant/message', { turn: 1, step: 1, message: {} });
    await f.run('agent/turn-stopping', { agent: f.agent, signal: payload.signal, turn: 1 });
    const end = await f.event('turn/end', { turn: 1, reason: { kind: 'completed' } });
    await f.run('session/flush', f.session);
    assert.equal([...f.data.values()].filter(row => row.kind === 'change' || row.kind === 'restore').length, 1);
    const record = [...f.data.values()].find(row => row.kind === 'change');
    assert.equal(record.endSeq, end.seq);
    assert.equal(record.messageSeq, msg.seq);
    assert.equal(record.storageFormat, 2);
    assert.equal(record.files[0].before.text, undefined);
    const detail = await f.tool().execute({ action: 'detail', recordId: record.id, fileId: record.files[0].id }, { agent: f.agent });
    assert.equal(detail.file.before.text, 'old\r\n');
    assert.equal(detail.file.after.text, 'new\r\n');
    const exec = { agent: f.agent, signal: payload.signal };
    const list = await f.tool().execute({ action: 'list' }, exec);
    const turns = await f.tool().execute({ action: 'turns' }, exec);
    assert.deepEqual(turns.turns, [{ turn: 1, endSeq: end.seq, fileCount: 1 }]);
    const turnResponse = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback?action=turns&sessionId=s1'));
    assert.deepEqual((await turnResponse.json()).turns, turns.turns);
    const response = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback?action=list&sessionId=s1'));
    assert.deepEqual(await response.json(), list);
    assert.equal('text' in list.records[0].files[0].before, false);
    const plan = await f.tool().execute({ action: 'prepare', recordId: record.id, fileIds: [record.files[0].id] }, exec);
    assert.equal(plan.canRestore, true);
    // The agent may preview, but only the UI confirmation may write files or delete backups.
    const toolRestore = await f.tool().execute({ action: 'restore', token: plan.token }, exec);
    assert.equal(toolRestore.ok, false);
    assert.equal(toolRestore.code, 'USER_ONLY_ACTION');
    assert.equal(f.files.get('/work/a.txt').text, 'new\r\n');
    const toolDelete = await f.tool().execute({ action: 'delete', recordIds: [record.id], confirm: true }, exec);
    assert.equal(toolDelete.code, 'USER_ONLY_ACTION');
    assert.equal([...f.data.values()].filter(row => row.kind === 'change' || row.kind === 'restore').length, 1);
    const restored = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'restore', sessionId: 's1', token: plan.token }) }));
    assert.equal((await restored.json()).ok, true);
    assert.equal(f.files.get('/work/a.txt').text, 'old\r\n');
    assert.equal([...f.data.values()].filter(row => row.kind === 'change' || row.kind === 'restore').length, 2);
    assert.equal([...f.data.values()].filter(row => row.kind === 'content').length, 1, 'restore reuses original content pack');
    const toolSettings = await f.tool().execute({ action: 'settings', retentionDays: 7 }, exec);
    assert.equal(toolSettings.code, 'USER_ONLY_ACTION', 'retention changes are user-only');
    const setSettings = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'settings', sessionId: 's1', retentionDays: 7 }) }));
    assert.equal((await setSettings.json()).settings.retentionDays, 7);
    const readSettings = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback?action=settings&sessionId=s1'));
    assert.equal((await readSettings.json()).settings.retentionDays, 7);
    const command = await f.command().handler({ rawInput: JSON.stringify({ action: 'detail', recordId: record.id, fileId: record.files[0].id }), agent: f.agent, signal: payload.signal });
    assert.equal(command.kind, 'error', 'command must not persist backup content in log');
  } finally { await f.close(); }
});
test('an answered turn is indexed by turn number, so the turn row is not anchored on the message seq', async () => {
  const f = hostFixture();
  await apply(f.ctx, { maxFileBytes: 4096, maxSnapshotBytes: 8192, maxFiles: 10 });
  try {
    await f.event('turn/start', { turn: 1 });
    const payload = { agent: f.agent, signal: new AbortController().signal, turn: 1, step: 1 };
    await f.run('agent/pre-step', payload, async () => ({ kind: 'enter', messages: [] }));
    f.files.set('/work/a.txt', { text: 'new', version: 'v2' });
    const msg = await f.event('assistant/message', { turn: 1, step: 1, message: {} });
    await f.run('agent/turn-stopping', payload);
    const end = await f.event('turn/end', { turn: 1, reason: { kind: 'completed' } });
    await f.run('session/flush', f.session);
    assert.notEqual(msg.seq, end.seq, 'an answered turn closes after its message');
    // The Chat UI reports the message seq as its turnTail `seq`; the turn index must still resolve.
    const viaRoute = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback?action=turns&sessionId=s1'));
    const turns = (await viaRoute.json()).turns;
    assert.deepEqual(turns, [{ turn: 1, endSeq: end.seq, fileCount: 1 }]);
    assert.equal(turns[0].endSeq, end.seq, 'the row carries the exact closing sequence');
    assert.notEqual(turns[0].endSeq, msg.seq, 'a message-seq lookup would have missed this row');
    // A turn filter on the message seq finds nothing; on the turn number it finds the backup.
    const wrong = await f.route().fetch(new Request(`http://localhost/api/local-dsh-rollback?action=list&sessionId=s1&endSeq=${msg.seq}`));
    assert.equal((await wrong.json()).total, 0);
    const right = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback?action=list&sessionId=s1&turn=1'));
    assert.equal((await right.json()).total, 1);
  } finally { await f.close(); }
});
test('a reopened session without a live agent can still read history but cannot restore', async () => {
  const f = hostFixture();
  await apply(f.ctx, { maxFileBytes: 4096, maxSnapshotBytes: 8192, maxFiles: 10 });
  try {
    await f.event('turn/start', { turn: 1 });
    const payload = { agent: f.agent, signal: new AbortController().signal, turn: 1, step: 1 };
    await f.run('agent/pre-step', payload, async () => ({ kind: 'enter', messages: [] }));
    f.files.set('/work/a.txt', { text: 'new', version: 'v2' });
    await f.event('assistant/message', { turn: 1, step: 1, message: {} });
    await f.run('agent/turn-stopping', payload);
    await f.event('turn/end', { turn: 1, reason: { kind: 'completed' } });
    await f.run('session/flush', f.session);
    // Restart effect: the Session stays attached, its Agent is gone.
    f.state.live = false;
    const list = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback?action=list&sessionId=s1'));
    const listed = await list.json();
    assert.equal(listed.ok, true, 'reads must not require a live agent');
    assert.equal(listed.total, 1);
    const turns = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback?action=turns&sessionId=s1'));
    assert.equal((await turns.json()).turns.length, 1);
    const status = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback?action=status&sessionId=s1'));
    assert.equal((await status.json()).ok, true);
    // Mutations still need the Agent that carries the resolved sandbox policy.
    const record = [...f.data.values()].find(row => row.kind === 'change');
    const prepare = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'prepare', sessionId: 's1', recordId: record.id, fileIds: [record.files[0].id] }) }));
    const prepared = await prepare.json();
    assert.equal(prepared.ok, false);
    assert.equal(prepared.code, 'SESSION_MISSING');
    assert.equal(f.files.get('/work/a.txt').text, 'new', 'no file was touched');
    // Detaching the Session entirely closes even the read path.
    f.state.attached = false;
    const gone = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback?action=list&sessionId=s1'));
    assert.equal(gone.status, 404);
  } finally { await f.close(); }
});
test('status reports global JSON estimates; quotas and optimization stay user-only', async () => {
  const f = hostFixture(); await apply(f.ctx);
  const side = text => ({ exists: true, available: true, bytes: Buffer.byteLength(text), text, hash: hashText(text), version: 'v1' });
  const old = { id: 'legacy', kind: 'change', sessionId: 's1', turn: 1, turnStartSeq: 1, messageSeq: 2, createdAt: 1, cwd: '/work', warnings: [], files: [{ id: 'f', path: 'a.txt', display: 'a.txt', change: 'modified', before: side('old\r\n'), after: side('new\r\n') }] };
  f.data.set('legacy', old);
  const post = async body => (await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 's1', ...body }) }))).json();
  try {
    assert.equal((await post({ action: 'optimize' })).code, 'CONFIRM_REQUIRED');
    assert.equal((await f.tool().execute({ action: 'optimize', confirm: true }, { agent: f.agent })).code, 'USER_ONLY_ACTION');
    const settings = await post({ action: 'settings', maxRecords: 1, maxStorageBytes: 100000 });
    assert.equal(settings.settings.maxRecords, 1); assert.equal(settings.settings.retentionDays, 0);
    const optimized = await post({ action: 'optimize', confirm: true });
    assert.equal(optimized.migrated, 1); assert.equal(optimized.storage.recordCount, 1);
    assert.equal(optimized.storage.legacyRecordCount, 0); assert.equal(optimized.storage.quotaExceeded, true);
    assert.equal(f.files.get('/work/a.txt').text, 'old\r\n', 'optimization never modifies workspace');
    const status = await f.tool().execute({ action: 'status' }, { agent: f.agent });
    assert.equal(status.storage.scope, 'all-workspaces'); assert.equal(status.recordCount, 1);
    assert.equal(JSON.stringify(status).includes('contentRef'), false);
    const detail = await f.tool().execute({ action: 'detail', recordId: 'legacy', fileId: 'f' }, { agent: f.agent });
    assert.equal(detail.file.before.text, 'old\r\n');
    const plan = await post({ action: 'prepare', recordId: 'legacy', fileIds: ['f'], side: 'after' });
    const rejected = await post({ action: 'restore', token: plan.token });
    assert.equal(rejected.code, 'BACKUP_QUOTA_EXCEEDED'); assert.equal(f.files.get('/work/a.txt').text, 'old\r\n');
    const packs = [...f.data.values()].filter(row => row.kind === 'content');
    assert.equal(packs.length, 1); assert.equal(decodePack(packs[0]).get(hashText('new\r\n')), 'new\r\n');
  } finally { await f.close(); }
});
test('a restore token minted while live cannot be spent after the agent goes away', async () => {
  const f = hostFixture();
  await apply(f.ctx, { maxFileBytes: 4096, maxSnapshotBytes: 8192, maxFiles: 10 });
  try {
    await f.event('turn/start', { turn: 1 });
    const payload = { agent: f.agent, signal: new AbortController().signal, turn: 1, step: 1 };
    await f.run('agent/pre-step', payload, async () => ({ kind: 'enter', messages: [] }));
    f.files.set('/work/a.txt', { text: 'new', version: 'v2' });
    await f.event('assistant/message', { turn: 1, step: 1, message: {} });
    await f.run('agent/turn-stopping', payload);
    await f.event('turn/end', { turn: 1, reason: { kind: 'completed' } });
    await f.run('session/flush', f.session);
    const record = [...f.data.values()].find(row => row.kind === 'change');
    const prepared = await (await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'prepare', sessionId: 's1', recordId: record.id, fileIds: [record.files[0].id] }) }))).json();
    assert.equal(prepared.canRestore, true);
    // The Agent disappears between preview and confirmation.
    f.state.live = false;
    const restored = await (await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'restore', sessionId: 's1', token: prepared.token }) }))).json();
    assert.equal(restored.ok, false);
    assert.equal(restored.code, 'SESSION_MISSING');
    assert.equal(f.files.get('/work/a.txt').text, 'new', 'the workspace must not be touched by a policy-less restore');
  } finally { await f.close(); }
});

const post = (f, value, headers = {}) => f.route().fetch(new Request('http://localhost/api/local-dsh-rollback', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ sessionId: 's1', ...value }) }));
const retained = () => {
  const side = text => ({ exists: true, available: true, bytes: Buffer.byteLength(text), text, hash: hashText(text), version: 'v1' });
  return { id: 'source', kind: 'change', cwd: '/work', sessionId: 's1', turn: 1, turnStartSeq: 1, messageSeq: 2, createdAt: Date.now(), warnings: [], files: [{ id: 'file', path: 'a.txt', display: 'a.txt', change: 'modified', before: side('old\r\n'), after: side('new') }] };
};

test('a whole-record restore is not capped at 500 files and needs no id list', async () => {
  const f = hostFixture(); await apply(f.ctx);
  try {
    // 900 files: well past the old 500 ceiling, and enough that listing every id
    // would exceed a small request body.
    const side = text => ({ exists: true, available: true, bytes: Buffer.byteLength(text), text, hash: hashText(text), version: 'v1' });
    const files = Array.from({ length: 900 }, (_, index) => ({ id: `file-${index}`, path: `d${index % 30}/f${index}.txt`, display: `d${index % 30}/f${index}.txt`, change: 'modified', before: side('old'), after: side('new') }));
    f.data.set('source', { ...retained(), files });
    for (const file of files) f.files.set(`/work/${file.path}`, { text: 'new', version: 'v2' });
    // `all` resolves the selection on the Host, so no fileIds array is sent at all.
    const prepared = await (await post(f, { action: 'prepare', recordId: 'source', side: 'before', all: true })).json();
    assert.equal(prepared.canRestore, true);
    assert.equal(prepared.files.length, 900, 'every file of the record is previewed');
    const restored = await (await post(f, { action: 'restore', token: prepared.token })).json();
    assert.equal(restored.ok, true);
    assert.equal(restored.restored.length, 900);
    for (const file of files) assert.equal(f.files.get(`/work/${file.path}`).text, 'old', file.path);
    // An explicit id list of the same size also works now.
    const explicit = await (await post(f, { action: 'prepare', recordId: 'source', side: 'after', fileIds: files.map(file => file.id) })).json();
    assert.equal(explicit.canRestore, true);
    assert.equal(explicit.files.length, 900);
  } finally { await f.close(); }
});

test('command channel cannot forge UI confirmation for restore, delete, settings or cleanup', async () => {
  const f = hostFixture(); await apply(f.ctx); f.data.set('source', retained());
  try {
    for (const args of [{ action: 'restore', token: 'any' }, { action: 'delete', recordIds: ['source'], confirm: true }, { action: 'settings', retentionDays: 1 }, { action: 'clean', confirm: true }, { action: 'optimize', confirm: true }]) {
      const result = await f.command().handler({ rawInput: JSON.stringify(args), agent: f.agent });
      assert.equal(result.kind, 'error'); assert.equal(JSON.parse(result.text).code, 'USER_ONLY_ACTION');
    }
    assert.equal(f.data.has('source'), true); assert.equal(f.files.get('/work/a.txt').text, 'old\r\n');
    assert.equal((await f.command().handler({ rawInput: '{"action":"status"}', agent: f.agent })).kind, 'success');
  } finally { await f.close(); }
});

test('Fetch body routes reject unauthenticated, API-peer and cross-site requests before payload access', async () => {
  const f = hostFixture(); await apply(f.ctx); f.data.set('source', retained());
  try {
    for (const [headers, expected] of [[{ authorization: 'Bearer invalid' }, 401], [{ authorization: 'Bearer api-test' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403]]) {
      const response = await post(f, { action: 'delete', recordIds: ['source'], confirm: true }, headers);
      assert.equal(response.status, expected); assert.equal(f.data.has('source'), true);
      const read = await f.route().fetch(new Request('http://localhost/api/local-dsh-rollback?action=detail&recordId=source&fileId=file&sessionId=s1', { headers }));
      assert.equal(read.status, expected); assert.equal(JSON.stringify(await read.json()).includes('old\\r\\n'), false);
    }
  } finally { await f.close(); }
});

test('Fetch input validates exact JSON media type, bounded bodies and typed operation fields', async () => {
  const f = hostFixture(); await apply(f.ctx);
  try {
    assert.equal((await post(f, { action: 'status' }, { 'content-type': 'application/jsonp' })).status, 415);
    assert.equal((await post(f, { action: 'status', query: 'x'.repeat(MAX_BODY_BYTES) })).status, 413);
    for (const value of [{ action: 'list', offset: -1 }, { action: 'list', query: {} }, { action: 'prepare', fileIds: Array(20001).fill('f') }, { action: 'delete', confirm: 'true' }, { action: 'settings', maxRecords: '5' }, { action: 'status', arbitrary: true }]) {
      const response = await post(f, value); assert.equal((await response.json()).code, 'INVALID_INPUT');
    }
  } finally { await f.close(); }
});

test('the route stays buffered so the carrier can build GET/HEAD reads without a body', async () => {
  const f = hostFixture(); await apply(f.ctx); f.data.set('source', retained());
  try {
    // A `streaming` declaration makes the carrier attach a socket body to every
    // accepted method; WHATWG Request then throws for GET/HEAD and the web server
    // answers a bodiless 400, which the UI renders as "无法读取文件历史。 (400)".
    assert.equal(f.route().requestBody, 'buffered');
    for (const method of ['GET', 'HEAD']) {
      const request = carrierRequest(f.route(), { method, url: 'http://localhost/api/local-dsh-rollback?action=list&sessionId=s1' });
      const response = await f.route().fetch(request);
      assert.equal(response.status, 200, `${method} reads must reach the handler`);
      if (method === 'HEAD') assert.equal(response.body, null);
      else assert.equal((await response.json()).ok, true);
    }
    // POST mutations keep working through the same route.
    const mutation = await f.route().fetch(carrierRequest(f.route(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'status', sessionId: 's1' }) }));
    assert.equal((await mutation.json()).ok, true);
  } finally { await f.close(); }
});

test('bounded JSON bodies preserve split UTF-8 and enforce the byte ceiling despite false Content-Length', async () => {
  const f = hostFixture(); await apply(f.ctx);
  try {
    assert.equal(f.route().requestBody, 'buffered');
    const bytes = new TextEncoder().encode(JSON.stringify({ action: 'list', sessionId: 's1', query: '中文🙂' }));
    const request = chunks => new Request('http://localhost/api/local-dsh-rollback', { method: 'POST', duplex: 'half', headers: { 'content-type': 'application/json', 'content-length': '1' }, body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }) });
    assert.equal((await (await f.route().fetch(request([...bytes].map(byte => new Uint8Array([byte]))))).json()).ok, true);
    const body = JSON.stringify({ action: 'status', sessionId: 's1' });
    const boundary = new TextEncoder().encode(body + ' '.repeat(MAX_BODY_BYTES - Buffer.byteLength(body)));
    assert.equal(boundary.length, MAX_BODY_BYTES);
    assert.equal((await (await f.route().fetch(request([boundary]))).json()).ok, true);
    const overflow = new TextEncoder().encode(body + ' '.repeat(MAX_BODY_BYTES + 1 - Buffer.byteLength(body)));
    assert.equal(overflow.length, MAX_BODY_BYTES + 1);
    let cancelled = false;
    const tooLarge = new Request('http://localhost/api/local-dsh-rollback', { method: 'POST', duplex: 'half', headers: { 'content-type': 'application/json', 'content-length': '1' }, body: new ReadableStream({ start(controller) { controller.enqueue(boundary); controller.enqueue(new Uint8Array([32])); }, cancel() { cancelled = true; } }) });
    const result = await f.route().fetch(tooLarge);
    assert.equal(result.status, 413);
    assert.equal(cancelled, true, 'an overflowing body is cancelled rather than buffered to the end');
    assert.equal((await f.route().fetch(request([overflow]))).status, 413);
    const invalid = await f.route().fetch(request([new Uint8Array([0xff])]));
    assert.equal(invalid.status, 400);
  } finally { await f.close(); }
});

test('status flags distinguish unavailable Agent, read-only policy and workspace activity before turn/start', async () => {
  const f = hostFixture(); await apply(f.ctx);
  const status = async () => (await post(f, { action: 'status' })).json();
  try {
    assert.equal((await status()).canMutate, true); assert.equal((await status()).workspaceBusy, false);
    await f.run('agent/status', { agent: f.agent, status: 'running' });
    assert.equal((await status()).workspaceBusy, true, 'driver scheduling is busy even with no open turn');
    await f.run('agent/status', { agent: f.agent, status: 'idle' });
    assert.equal((await status()).workspaceBusy, false);
    f.ctx.sandboxPolicy.resolve = () => ({ mode: 'read-only', workspaceRoot: '/work' });
    assert.equal((await status()).canMutate, false); assert.equal((await status()).mutationBlockedReason, 'READ_ONLY');
    f.state.live = false;
    assert.equal((await status()).mutationBlockedReason, 'SESSION_MISSING');
  } finally { await f.close(); }
});

test('plugin activation during an existing wake reads passive driver state rather than undocumented Agent fields', async () => {
  const f = hostFixture(); f.ctx.get = key => key === 'sessionController' ? { state: async () => ({ running: true }) } : undefined;
  await apply(f.ctx);
  try { assert.equal((await (await post(f, { action: 'status' })).json()).workspaceBusy, true); }
  finally { await f.close(); }
});

test('failed turn seal never recaptures later workspace content at turn/end', async () => {
  const f = hostFixture(); await apply(f.ctx);
  try {
    await f.event('turn/start', { turn: 1 });
    const payload = { agent: f.agent, signal: new AbortController().signal };
    await f.run('agent/pre-step', payload, async () => ({ kind: 'enter', messages: [] }));
    const resolve = f.ctx.fs.resolve;
    f.ctx.fs.resolve = async () => { throw new Error('seal failed'); };
    await f.run('agent/turn-stopping', payload);
    let rescans = 0;
    f.ctx.fs.resolve = async (...args) => { rescans++; return resolve(...args); };
    f.files.set('/work/a.txt', { text: 'belongs to later writer', version: 'v2' });
    await f.event('turn/end', { turn: 1 }); await f.run('session/flush', f.session);
    assert.equal(rescans, 0); assert.equal([...f.data.values()].some(row => row.kind === 'change'), false);
    const status = await (await post(f, { action: 'status' })).json(); assert.match(status.diagnostic.message, /seal failed/);
  } finally { await f.close(); }
});

test('restore rechecks driver activity after preflight reads before publishing its journal', async () => {
  const f = hostFixture(); await apply(f.ctx); f.data.set('source', retained());
  try {
    const plan = await (await post(f, { action: 'prepare', recordId: 'source', fileIds: ['file'], side: 'after' })).json();
    assert.equal(plan.canRestore, true);
    const read = f.ctx.fs.readBytes;
    let reads = 0;
    f.ctx.fs.readBytes = async (...args) => { if (++reads === 1) await f.run('agent/status', { agent: f.agent, status: 'running' }); return read(...args); };
    const result = await (await post(f, { action: 'restore', token: plan.token })).json();
    assert.equal(result.code, 'WORKSPACE_BUSY'); assert.equal(f.files.get('/work/a.txt').text, 'old\r\n');
    assert.equal([...f.data.values()].some(row => row.kind === 'restore'), false);
  } finally { await f.close(); }
});

test('an Agent waking during journal commit stops restoration with a retained partial journal', async () => {
  const f = hostFixture(); await apply(f.ctx); f.data.set('source', retained());
  try {
    const plan = await (await post(f, { action: 'prepare', recordId: 'source', fileIds: ['file'], side: 'after' })).json();
    f.state.beforePut = async (_key, row) => { if (row.kind === 'restore') await f.run('agent/status', { agent: f.agent, status: 'running' }); };
    const result = await (await post(f, { action: 'restore', token: plan.token })).json();
    assert.equal(result.ok, false); assert.equal(result.failed[0].code, 'WORKSPACE_BUSY');
    assert.equal(f.files.get('/work/a.txt').text, 'old\r\n');
    assert.equal(f.data.get(result.recordId).status, 'partial');
  } finally { await f.close(); }
});

test('pre-step cannot enter tool work while a restore is holding workspace publication', async () => {
  const f = hostFixture(); await apply(f.ctx); f.data.set('source', retained());
  let release, entered;
  try {
    const plan = await (await post(f, { action: 'prepare', recordId: 'source', fileIds: ['file'], side: 'after' })).json();
    const publication = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const write = f.ctx.fs.writeText;
    f.ctx.fs.writeText = async (...args) => { entered(); await gate; return write(...args); };
    const restoring = post(f, { action: 'restore', token: plan.token });
    await publication;
    await f.event('turn/start', { turn: 2 });
    let stepEntered = false;
    const step = f.run('agent/pre-step', { agent: f.agent, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] })).then(() => { stepEntered = true; });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(stepEntered, false);
    release();
    assert.equal((await (await restoring).json()).ok, true);
    await step; assert.equal(stepEntered, true);
    assert.equal(f.files.get('/work/a.txt').text, 'new');
  } finally { release?.(); await f.close(); }
});
