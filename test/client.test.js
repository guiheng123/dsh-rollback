import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the shipped Client component with controlled hooks and deferred Fetches.
// Fetch deliberately ignores abort so the response-generation check is tested too.
async function fixture({ status = { ok: true }, activeLocale = null, deferStatus = false } = {}) {
  const code = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const slots = new Map(), requests = [], statusRequests = [];
  let statusReply = status;
  let hooks = [], effects = [];
  let cursor = 0, dirty = false, tree, definition, Dialog, props;
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    Fragment: Symbol('fragment'),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; dirty = true; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) { const i = cursor++; const old = hooks[i]; if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index]))) { effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; }); } },
    useLayoutEffect(fn, deps) { React.useEffect(fn, deps); },
  };
  const context = {
    window: { location: { origin: 'http://localhost' }, __ModuleLoader__: { load(value) { definition = value; } } },
    document: { activeElement: null }, URL, AbortController, console,
    setInterval: () => 1, clearInterval: () => {},
    fetch(url, options) {
      const action = url.searchParams.get('action');
      if (action === 'status') {
        if (deferStatus) return new Promise((resolve, reject) => statusRequests.push({ url, signal: options.signal, resolve: data => resolve({ ok: true, json: async () => data }), reject }));
        statusRequests.push({ url, signal: options.signal });
        return Promise.resolve({ ok: true, json: async () => statusReply });
      }
      return new Promise((resolve, reject) => requests.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined, signal: options.signal, resolve: (data, ok = true) => resolve({ ok, status: ok ? 200 : 400, json: async () => data }), reject }));
    },
  };
  vm.runInNewContext(code, context);
  definition.factory(() => React).apply({
    get: () => undefined,
    locale: { bind: () => key => key, subscribe: () => () => {}, getSnapshot: () => activeLocale ? { active: activeLocale } : null, register: () => () => {} },
    effect: fn => fn(),
    slots: { inject: (_key, fn) => fn(), register: (spec, component) => slots.set(spec.name, component) },
  });
  slots.get('conversation.session.header.utilities')({ sessionId: 's1' }).props.onClick();
  const overlay = slots.get('shell.overlay')();
  const dialog = overlay.props.children.find(child => typeof child?.type === 'function');
  Dialog = dialog.type; props = dialog.props;
  function render() {
    for (let pass = 0; pass < 20; pass++) {
      dirty = false; cursor = 0; tree = Dialog(props);
      while (effects.length) effects.shift()();
      if (!dirty) return tree;
    }
    throw new Error('Component did not settle');
  }
  function find(predicate, node = tree) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of node.props?.children?.flat(Infinity) ?? []) { const found = find(predicate, child); if (found) return found; }
    return null;
  }
  async function settle() { await new Promise(resolve => setImmediate(resolve)); render(); }
  render();
  // Render one turnTail entry through its own throwaway hook scope, without disturbing
  // the dialog's persisted hooks: swap in a fresh array for the duration.
  function renderTurn(props) {
    const saved = { hooks, effects };
    const localHooks = [], localEffects = [];
    hooks = localHooks; effects = localEffects; cursor = 0;
    let entry;
    try { entry = slots.get('conversation.chat.turnTail')(props); }
    finally { while (effects.length) effects.shift()(); hooks = saved.hooks; effects = saved.effects; }
    return { entry, flush() { cursor = 0; while (effects.length) effects.shift()(); } };
  }
  return { requests, statusRequests, setStatus(value) { statusReply = value; }, isOpen: () => slots.get('shell.overlay')().props.children.some(child => typeof child?.type === 'function'), render, settle, find, tree: () => tree, renderTurn, loadMore: () => find(node => node.props?.onClick?.name === 'loadMore').props.onClick(), unmount() { for (const hook of hooks) hook?.cleanup?.(); } };
}
const response = (id, nextOffset = 100) => ({ ok: true, records: [{ id, turn: 1, files: [], createdAt: 0 }], total: nextOffset === null ? 1 : 201, nextOffset });
const storageStatus = (storage = {}, settings = {}) => ({
  ok: true,
  storage: { scope: 'all-workspaces', recordCount: 9, protectedRecordCount: 2, logicalBytes: 8192, uniqueContentBytes: 4096, storedBytes: 2048, recordBytes: 1024, contentBytes: 1024, packCount: 2, orphanPackCount: 1, legacyRecordCount: 3, quotaExceeded: false, ...storage },
  settings: { retentionDays: 7, maxStorageBytes: 1572864, maxRecords: 100, ...settings },
});
const input = (f, label) => f.find(node => node.type === 'input' && node.props['aria-label'] === label);
const button = (f, label) => f.find(node => typeof node.type === 'function' && node.props.children?.includes(label));
const changeInput = (f, label, value) => { input(f, label).props.onChange({ target: { value } }); f.render(); };

test('late pagination cannot contaminate a new search or reset its active loading state', async () => {
  const f = await fixture();
  f.requests[0].resolve(response('old-first')); await f.settle();
  const oldMore = f.loadMore(); f.render();
  const oldRequest = f.requests[1];
  f.find(node => node.type === 'input' && node.props.placeholder === 'Filter files').props.onChange({ target: { value: 'new' } }); f.render();
  assert.equal(oldRequest.signal.aborted, true);
  f.requests[2].resolve(response('new-first')); await f.settle();
  const newMore = f.loadMore(); f.render();
  oldRequest.resolve(response('old-second', null)); await oldMore; await f.settle();
  assert.equal(f.find(node => node.props?.onClick?.name === 'loadMore').props.disabled, true);
  f.requests[3].resolve(response('new-second', null)); await newMore; await f.settle();
  const rendered = JSON.stringify(f.tree());
  assert.ok(rendered.includes('new-first') && rendered.includes('new-second'));
  assert.ok(!rendered.includes('old-second'));
  f.unmount();
});

test('scope changes discard failed pagination and fresh first-page loading blocks load more', async () => {
  const f = await fixture();
  f.requests[0].resolve(response('session-first')); await f.settle();
  const pending = f.loadMore(); f.render();
  f.find(node => node.type === 'select' && node.props['aria-label'] === 'This conversation').props.onChange({ target: { value: 'workspace' } }); f.render();
  assert.equal(f.requests[1].signal.aborted, true);
  f.requests[1].reject(new Error('obsolete failure')); await pending; await f.settle();
  assert.ok(!JSON.stringify(f.tree()).includes('obsolete failure'));
  f.requests[2].resolve(response('workspace-first')); await f.settle();
  const last = f.loadMore(); f.render();
  assert.equal(f.requests[3].url.searchParams.get('scope'), 'workspace');
  f.unmount();
  assert.equal(f.requests[3].signal.aborted, true);
  f.requests[3].resolve(response('after-unmount')); await last;
});

test('refresh cancels pagination and duplicate clicks submit one request', async () => {
  const f = await fixture();
  f.requests[0].resolve(response('first')); await f.settle();
  const pending = f.loadMore();
  await f.loadMore();
  assert.equal(f.requests.length, 2);
  f.render();
  f.find(node => node.props?.title === 'Refresh').props.onClick(); f.render();
  assert.equal(f.requests[1].signal.aborted, true);
  f.requests[1].resolve(response('stale')); await pending; await f.settle();
  assert.ok(!JSON.stringify(f.tree()).includes('stale'));
  f.requests[2].resolve(response('fresh', null)); await f.settle();
  f.unmount();
});

test('the turn anchor resolves by turn number and renders no rollback button', async () => {
  const f = await fixture();
  // A real answered turn: the slot's `seq` is the last assistant message seq (5),
  // while the record closes at turn/end seq (7). A seq-keyed lookup finds nothing.
  f.renderTurn({ sessionId: 's1', turn: 2, seq: 5 });
  await f.settle();
  const turnRequest = f.requests.find(request => request.url.searchParams.get('action') === 'turns');
  assert.ok(turnRequest, 'the turn anchor asks the Host for the turn summary');
  turnRequest.resolve({ ok: true, turns: [{ turn: 2, endSeq: 7, fileCount: 3 }], truncated: false });
  await f.settle();
  const { entry } = f.renderTurn({ sessionId: 's1', turn: 2, seq: 5 });
  // Only the invisible anchor remains: no "Roll back · N files" footer button.
  assert.equal(entry.type, 'span');
  assert.equal(entry.props.className, 'dshr-turnanchor');
  assert.ok(!JSON.stringify(entry).includes('Roll back'), 'no rollback button is rendered below a turn');
  f.unmount();
});

test('global storage summary and settings load from status; saving sends retention and both quotas', async () => {
  const f = await fixture({ status: storageStatus() });
  f.requests[0].resolve({ ...response('first', null), settings: { retentionDays: 1 } }); await f.settle();
  assert.equal(input(f, 'Retention (days)').props.value, '7', 'status settings take precedence over legacy list settings');
  assert.equal(input(f, 'Storage quota (MiB)').props.value, '1.5');
  assert.equal(input(f, 'Backup count quota').props.value, '100');
  const summary = f.find(node => node.type === 'summary');
  assert.match(summary.props.children.join(''), /All workspaces.*9 Backups.*2 KiB/);
  const rendered = JSON.stringify(f.tree());
  for (const label of ['Logical content', 'Unique content', 'Estimated stored JSON', 'Legacy records', 'Protected records', 'not physical disk usage']) assert.ok(rendered.includes(label), label);
  changeInput(f, 'Retention (days)', '30');
  changeInput(f, 'Storage quota (MiB)', '2.5');
  changeInput(f, 'Backup count quota', '250');
  const saving = f.find(node => node.props?.onClick?.name === 'saveSettings').props.onClick();
  const request = f.requests.at(-1);
  assert.equal(request.method, 'POST');
  assert.equal(request.url.origin, 'http://localhost');
  assert.equal(request.url.pathname, '/api/local-dsh-rollback');
  assert.deepEqual(request.body, { action: 'settings', sessionId: 's1', retentionDays: 30, maxStorageBytes: 2621440, maxRecords: 250 });
  f.setStatus(storageStatus({}, request.body));
  request.resolve({ ok: true, settings: request.body }); await saving; await f.settle();
  assert.equal(f.statusRequests.length, 2, 'saving refreshes global statistics and quota warnings');
  f.requests.at(-1).resolve(response('refreshed', null)); await f.settle();
  assert.ok(JSON.stringify(f.tree()).includes('Settings saved.'));
  f.unmount();
});

test('zero quotas mean unlimited while invalid quota values cannot submit', async () => {
  const f = await fixture();
  f.requests[0].resolve(response('first', null)); await f.settle();
  changeInput(f, 'Storage quota (MiB)', '-1');
  let save = f.find(node => node.props?.onClick?.name === 'saveSettings');
  assert.equal(save.props.disabled, true);
  await save.props.onClick();
  assert.equal(f.requests.length, 1);
  changeInput(f, 'Storage quota (MiB)', '0');
  changeInput(f, 'Backup count quota', '1.5');
  assert.equal(f.find(node => node.props?.onClick?.name === 'saveSettings').props.disabled, true);
  changeInput(f, 'Backup count quota', '');
  assert.equal(f.find(node => node.props?.onClick?.name === 'saveSettings').props.disabled, true);
  changeInput(f, 'Backup count quota', '0');
  save = f.find(node => node.props?.onClick?.name === 'saveSettings');
  assert.equal(save.props.disabled, false);
  const saving = save.props.onClick();
  assert.deepEqual(f.requests[1].body, { action: 'settings', sessionId: 's1', retentionDays: 0, maxStorageBytes: 0, maxRecords: 0 });
  f.requests[1].resolve({ ok: true }); await saving; await f.settle();
  f.requests.at(-1).resolve(response('refreshed', null)); await f.settle();
  f.unmount();
});

test('optimization needs a second confirmation, sends one request and refreshes safe storage statistics', async () => {
  const f = await fixture({ status: storageStatus({ quotaExceeded: true }) });
  f.requests[0].resolve(response('first', null)); await f.settle();
  assert.ok(JSON.stringify(f.tree()).includes('Global backup quota exceeded'));
  button(f, 'Optimize old backups (this workspace)').props.onClick(); f.render();
  assert.equal(f.requests.length, 1, 'opening confirmation does not mutate backups');
  const confirmation = f.find(node => node.props?.role === 'group' && node.props['aria-label']?.startsWith('Optimize backups in the current workspace?'));
  assert.ok(confirmation);
  f.find(node => node.props.children?.includes('Cancel'), confirmation).props.onClick(); f.render();
  assert.equal(f.requests.length, 1, 'cancel does not submit');
  button(f, 'Optimize old backups (this workspace)').props.onClick(); f.render();
  const confirm = f.find(node => node.props?.onClick?.name === 'optimizeBackups');
  const optimizing = confirm.props.onClick();
  await confirm.props.onClick();
  f.render();
  assert.equal(f.requests.length, 2, 'double confirmation clicks share one in-flight request');
  assert.equal(f.find(node => node.props?.onClick?.name === 'optimizeBackups').props.disabled, true);
  assert.deepEqual(f.requests[1].body, { action: 'optimize', sessionId: 's1', confirm: true });
  assert.equal(f.requests[1].url.origin, 'http://localhost');
  const optimized = storageStatus({ storedBytes: 512, legacyRecordCount: 0, orphanPackCount: 0 });
  f.setStatus(optimized);
  f.requests[1].resolve({ ok: true, migrated: 3, pruned: 2, reclaimedPacks: 1, storage: optimized.storage, compressedPayload: 'DO_NOT_RENDER_PAYLOAD' });
  await optimizing; await f.settle();
  assert.equal(f.statusRequests.length, 2, 'optimization re-reads global status');
  const rendered = JSON.stringify(f.tree());
  assert.match(f.find(node => node.type === 'summary').props.children.join(''), /512 B/);
  assert.ok(rendered.includes('Migrated records: 3') && rendered.includes('Empty records removed: 2') && rendered.includes('Reclaimed packs: 1'));
  assert.ok(!rendered.includes('Global backup quota exceeded'));
  assert.ok(!rendered.includes('DO_NOT_RENDER_PAYLOAD'), 'only explicit safe summary fields are rendered');
  f.requests.at(-1).resolve(response('refreshed', null)); await f.settle();
  f.unmount();
});

test('optimization failure stays actionable and preserves existing statistics', async () => {
  const f = await fixture({ status: storageStatus() });
  f.requests[0].resolve(response('first', null)); await f.settle();
  button(f, 'Optimize old backups (this workspace)').props.onClick(); f.render();
  const optimizing = f.find(node => node.props?.onClick?.name === 'optimizeBackups').props.onClick();
  f.requests[1].resolve({ ok: false, message: 'Optimization unavailable' }, false);
  await optimizing; await f.settle();
  assert.ok(JSON.stringify(f.tree()).includes('Optimization unavailable'));
  assert.equal(f.find(node => node.props?.onClick?.name === 'optimizeBackups').props.disabled, false);
  assert.match(f.find(node => node.type === 'summary').props.children.join(''), /2 KiB/);
  assert.equal(f.statusRequests.length, 1);
  f.unmount();
});

test('quota warnings disable restore and storage controls are localized in Chinese', async () => {
  const f = await fixture({ activeLocale: 'zh', status: storageStatus({ quotaExceeded: true }) });
  f.requests[0].resolve({ ...response('first', null), records: [{ id: 'first', turn: 1, files: [{ id: 'f1', path: 'sample.txt' }], createdAt: 0 }] }); await f.settle();
  f.find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange(); f.render();
  assert.equal(button(f, '回滚所选文件到之前版本').props.disabled, true);
  assert.equal(button(f, '回滚所选文件到之后版本').props.disabled, true);
  const count = f.requests.length;
  await button(f, '回滚所选文件到之前版本').props.onClick();
  assert.equal(f.requests.length, count, 'disabled restore handler also guards quota state');
  const rendered = JSON.stringify(f.tree());
  for (const label of ['全局 · 所有工作区', '逻辑正文', '实际存储 JSON 估算', '唯一正文', '遗留记录', '受保护记录', '空间配额（MiB）', '配额 0 表示无限', '拒绝新备份和回滚']) assert.ok(rendered.includes(label), label);
  button(f, '优化旧备份（当前工作区）').props.onClick(); f.render();
  assert.ok(JSON.stringify(f.tree()).includes('确认优化当前工作区的备份？'));
  f.unmount();
});

test('late status responses never overwrite quota edits in progress', async () => {
  const f = await fixture({ deferStatus: true });
  changeInput(f, 'Storage quota (MiB)', '12');
  changeInput(f, 'Backup count quota', '24');
  f.requests[0].resolve({ ...response('first', null), settings: { retentionDays: 7, maxStorageBytes: 0, maxRecords: 0 } });
  f.statusRequests[0].resolve(storageStatus()); await f.settle();
  assert.equal(input(f, 'Storage quota (MiB)').props.value, '12');
  assert.equal(input(f, 'Backup count quota').props.value, '24');
  f.unmount();
});

const sampleFile = (id, change = 'modified') => ({ id, path: `${id}.txt`, display: `${id}.txt`, change, before: { exists: change !== 'added', available: true }, after: { exists: change !== 'deleted', available: true } });
const fileResponse = (files = [sampleFile('f1')]) => ({ ok: true, records: [{ id: 'r1', turn: 2, messageSeq: 5, createdAt: 0, files }], total: 1, nextOffset: null });
const action = (f, name) => f.find(node => node.props?.onClick?.name === name);
const selectFirst = f => { f.find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange(); f.render(); };

test('live TurnLocation owner props keep a jump anchor without a footer rollback entry', async () => {
  const f = await fixture();
  f.renderTurn({ sessionId: 's1', turn: { turn: 2, end: { seq: 7 } }, seq: 5 });
  await f.settle();
  const request = f.requests.find(r => r.url.searchParams.get('action') === 'turns');
  assert.ok(request, 'actual object-shaped owner props must still resolve the turn summary');
  request.resolve({ ok: true, turns: [{ turn: 2, endSeq: 7, fileCount: 3 }] }); await f.settle();
  const { entry } = f.renderTurn({ sessionId: 's1', turn: { turn: 2, end: { seq: 7 } }, seq: 5 });
  assert.equal(entry.type, 'span', 'the turn contributes only an anchor');
  assert.equal(entry.props.className, 'dshr-turnanchor');
  assert.ok(!f.find(node => node.type === 'button', entry), 'no rollback button is rendered below a turn');
  f.unmount();
});

test('first-use guidance renders without any setup claim and keeps optional settings collapsed', async () => {
  const f = await fixture({ activeLocale: 'zh' });
  f.requests[0].resolve({ ok: true, records: [], total: 0 }); await f.settle();
  const text = JSON.stringify(f.tree());
  for (const label of ['自动备份', '从下一次修改开始', '无法恢复启用前的修改', '备份默认永不过期']) assert.ok(text.includes(label), label);
  assert.ok(!text.includes('无需配置'), 'no setup-free claim may be rendered');
  const management = f.find(node => node.type === 'details' && node.props.className === 'dshr-management');
  assert.ok(management && !management.props.open, 'settings are collapsed by default');
  f.unmount();
});

test('prepare and restore confirmation reject duplicate clicks before React rerenders', async () => {
  const f = await fixture();
  f.requests[0].resolve(fileResponse()); await f.settle(); selectFirst(f);
  const prepare = button(f, 'Restore selected to before');
  const pending = prepare.props.onClick();
  await prepare.props.onClick();
  assert.equal(f.requests.filter(r => r.body?.action === 'prepare').length, 1);
  f.render();
  assert.equal(button(f, 'Close').props.disabled, true);
  const preparing = f.requests.find(r => r.body?.action === 'prepare');
  preparing.resolve({ ok: true, token: 'safe-token', expiresAt: Date.now() + 300000, canRestore: true, files: [{ id: 'f1', display: 'f1.txt', conflict: false, noOp: false }] });
  await pending; await f.settle();
  assert.ok(JSON.stringify(f.tree()).includes('Will replace content'));
  const confirm = action(f, 'confirmRestore');
  const restoring = confirm.props.onClick(); await confirm.props.onClick();
  assert.equal(f.requests.filter(r => r.body?.action === 'restore').length, 1);
  f.requests.find(r => r.body?.action === 'restore').resolve({ ok: true, noOp: true });
  await restoring; await f.settle();
  assert.ok(JSON.stringify(f.tree()).includes('No working files or backups changed'));
  f.unmount();
});

test('clearing selection invalidates a preview token and prevents accidental restore', async () => {
  const f = await fixture();
  f.requests[0].resolve(fileResponse()); await f.settle(); selectFirst(f);
  const pending = button(f, 'Restore selected to before').props.onClick();
  f.requests.find(r => r.body?.action === 'prepare').resolve({ ok: true, token: 'safe-token', expiresAt: Date.now() + 300000, canRestore: true, files: [] });
  await pending; await f.settle();
  assert.ok(action(f, 'confirmRestore'));
  button(f, 'Clear selection').props.onClick(); f.render();
  assert.equal(action(f, 'confirmRestore'), null);
  assert.equal(f.requests.filter(r => r.body?.action === 'restore').length, 0);
  f.unmount();
});

test('per-file conflicts and expired preview explain why confirmation is unavailable', async () => {
  const f = await fixture();
  f.requests[0].resolve(fileResponse()); await f.settle(); selectFirst(f);
  const pending = button(f, 'Restore selected to before').props.onClick();
  f.requests.find(r => r.body?.action === 'prepare').resolve({ ok: true, token: null, expiresAt: Date.now() - 1000, canRestore: false, files: [{ id: 'f1', display: 'f1.txt', conflict: true, reason: 'External edit detected' }] });
  await pending; await f.settle();
  const text = JSON.stringify(f.tree());
  assert.ok(text.includes('External edit detected') && text.includes('Preview expired'));
  assert.equal(action(f, 'confirmRestore').props.disabled, true);
  await action(f, 'confirmRestore').props.onClick();
  assert.equal(f.requests.filter(r => r.body?.action === 'restore').length, 0);
  f.unmount();
});

test('cold/read-only and busy sessions explain disabled restore controls', async () => {
  for (const status of [{ ok: true, canMutate: false }, { ok: true, canMutate: true, workspaceBusy: true }]) {
    const f = await fixture({ status });
    f.requests[0].resolve(fileResponse()); await f.settle(); selectFirst(f);
    assert.equal(button(f, 'Restore selected to before').props.disabled, true);
    await button(f, 'Restore selected to before').props.onClick();
    assert.equal(f.requests.filter(r => r.body?.action === 'prepare').length, 0);
    assert.ok(JSON.stringify(f.tree()).includes(status.canMutate === false ? 'Read-only history' : 'This workspace is busy'));
    f.unmount();
  }
});

test('select all previews the whole record through the Host selector instead of capping at 500', async () => {
  const f = await fixture();
  f.requests[0].resolve(fileResponse(Array.from({ length: 1201 }, (_, i) => sampleFile(`f${i}`)))); await f.settle();
  button(f, 'Select all').props.onClick(); f.render();
  assert.ok(JSON.stringify(f.tree()).includes('1201 selected'), 'the whole record is selected, not a truncated slice');
  const pending = button(f, 'Restore selected to before').props.onClick();
  const request = f.requests.find(r => r.body?.action === 'prepare');
  assert.equal(request.body.all, true, 'whole-record selection is resolved by the Host');
  assert.equal(request.body.fileIds, undefined, 'no id list is sent, so the body ceiling cannot truncate it');
  request.resolve({ ok: true, canRestore: false, files: [] }); await pending; await f.settle();
  // Individual checkboxes stay unbounded too.
  button(f, 'Select all').props.onClick(); f.render();
  const first = f.find(node => node.type === 'input' && node.props.type === 'checkbox');
  first.props.onChange(); f.render();
  assert.ok(JSON.stringify(f.tree()).includes('1 selected'), 'toggling a checkbox leaves the whole-record mode');
  f.unmount();
});

test('partial restore error retains recovery identity after automatic list refresh', async () => {
  const f = await fixture();
  f.requests[0].resolve(fileResponse()); await f.settle(); selectFirst(f);
  const pending = button(f, 'Restore selected to before').props.onClick();
  f.requests.find(r => r.body?.action === 'prepare').resolve({ ok: true, canRestore: true, token: 'token', expiresAt: Date.now() + 300000, files: [] });
  await pending; await f.settle();
  const restoring = action(f, 'confirmRestore').props.onClick();
  f.requests.find(r => r.body?.action === 'restore').resolve({ ok: false, recordId: 'recovery-123', message: 'Journal commit failed' }, false);
  await restoring; await f.settle();
  f.requests.at(-1).resolve(fileResponse()); await f.settle();
  const text = JSON.stringify(f.tree());
  assert.ok(text.includes('recovery-123') && text.includes('Some files may have changed'));
  f.unmount();
});
