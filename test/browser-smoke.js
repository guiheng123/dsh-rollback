// Real Chromium smoke test of the working-tree client.js. No application server or
// Host is used: a virtual HTTPS document is fulfilled through CDP, window.fetch is
// an in-memory mock, and every other browser request is blocked by CDP and CSP.
// Run: node test/browser-smoke.js
// Overrides: DSH_SMOKE_CHROMIUM, DSH_SMOKE_ASAR, DSH_SMOKE_OUTPUT.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, process.env.DSH_SMOKE_OUTPUT || '.test-output/browser-smoke');
const chromium = process.env.DSH_SMOKE_CHROMIUM || 'C:/Users/gh/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe';
const asar = process.env.DSH_SMOKE_ASAR || 'D:/dshnext/DSH NEXT/resources/app.asar';
const origin = 'https://rollback-fixture.invalid';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
fs.mkdirSync(output, { recursive: true });
const client = fs.readFileSync(path.join(root, 'client.js'), 'utf8');
const report = {
  startedAt: new Date().toISOString(), clientSha256: hash(client), node: process.version,
  chromium, asar, mode: 'Real Chromium / isolated mock fixture, NOT installed-plugin verification',
  safety: { hostMutations: 0, externalBrowserRequests: [], mockOrigin: origin, mockFetchOnly: true },
  checks: [], screenshots: [], consoleErrors: [], pageExceptions: [],
};

// Electron asar Pickle layout. Open the original archive read-only and extract
// only the standalone built React + scheduler + ReactDOM section to a test cache.
function extractRuntime() {
  const fd = fs.openSync(asar, 'r');
  try {
    const prefix = Buffer.alloc(16); fs.readSync(fd, prefix, 0, 16, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12)); fs.readSync(fd, header, 0, header.length, 16);
    const tree = JSON.parse(header.toString());
    const directory = tree.files.node_modules.files['@deepseek-ai'].files['dsh-web-frontend'].files.dist.files.assets.files;
    const name = Object.keys(directory).find(name => /^index-.*\.js$/.test(name));
    assert.ok(name, 'packaged web frontend exists');
    const entry = directory[name]; assert.ok(!entry.unpacked, 'React bundle resides inside archive');
    const bytes = Buffer.alloc(entry.size);
    fs.readSync(fd, bytes, 0, bytes.length, 8 + prefix.readUInt32LE(4) + Number(entry.offset));
    const text = bytes.toString();
    // Fail closed if upstream bundling changes. These are verified boundaries of
    // the archived 18.3.1 React CJS/scheduler/DOM factories, not rewritten library code.
    const quStart = text.indexOf('function Qu(e,t){');
    const quEnd = text.indexOf('(function(){', quStart);
    const start = text.indexOf('function qa(e){');
    const end = text.indexOf('function gS(e){', start);
    assert.ok(quStart >= 0 && quEnd > quStart && start > quEnd && end > start, 'known runtime boundaries');
    const section = text.slice(start, end);
    assert.ok(section.includes('react.production.min.js') && section.includes('react-dom.production.min.js') && section.includes('scheduler.production.min.js'));
    const runtime = `${text.slice(quStart, quEnd)}\n${section}\nwindow.React=x;window.ReactDOM=Tn;\n`;
    // Keep the extracted renderer in memory only: the smoke test is allowed to
    // create artifacts under .test-output, but must not write into dependencies.
    report.runtime = { source: `node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/${name}`, sourceSha256: hash(bytes), extractedSha256: hash(runtime), persisted: false };
    return runtime;
  } finally { fs.closeSync(fd); }
}

const runtime = extractRuntime();
function browserFixture(config) {
  const slots = new Map(); let definition;
  const mock = window.__fixture = {
    config, calls: [], pending: [], held: false,
    count(action) { return this.calls.filter(call => call.method === 'POST' && call.body.action === action).length; },
    release() { this.pending.splice(0).forEach(resolve => resolve()); },
  };
  const before = { exists: true, available: true, text: 'export const version = "before";\n' };
  const after = { exists: true, available: true, text: 'export const version = "after";\n' };
  const files = [
    { id: 'f1', display: 'src/components/HistoryPanel.tsx', path: 'D:/fixture/src/components/HistoryPanel.tsx', change: 'modified', before, after },
    { id: 'f2', display: 'docs/回滚体验与安全说明.md', path: 'D:/fixture/docs/回滚体验与安全说明.md', change: 'added', before: { exists: false, available: true }, after },
    { id: 'f3', display: 'src/' + 'very-long-path-segment/'.repeat(9) + 'long-line.ts', path: 'D:/fixture/long-line.ts', change: 'deleted', before, after: { exists: false, available: true } },
  ];
  const records = config.empty ? [] : [
    { id: 'record-1', sessionId: 'fixture-session', turn: 12, messageSeq: 48, endSeq: 50, createdAt: 1794739200000, kind: 'change', files },
    { id: 'record-2', sessionId: 'fixture-session', turn: 11, messageSeq: 44, endSeq: 46, createdAt: 1794735600000, kind: 'change', files: [files[0]] },
    { id: 'record-3', sessionId: 'fixture-session', turn: 10, messageSeq: 40, endSeq: 42, createdAt: 1794732000000, kind: 'restore', status: 'completed', files: [files[1]] },
  ];
  const storage = { recordCount: records.length, protectedRecordCount: 0, logicalBytes: 19820, uniqueContentBytes: 12820, storedBytes: 6470, recordBytes: 2100, contentBytes: 4370, packCount: 2, orphanPackCount: 0, legacyRecordCount: 0, quotaExceeded: false };
  const settings = { retentionDays: 0, maxStorageBytes: 0, maxRecords: 0 };
  // No native fetch fallback is retained; even an unexpected action fails closed.
  window.fetch = async (input, options = {}) => {
    const url = new URL(input); const method = options.method || 'GET';
    if (url.origin !== location.origin || url.pathname !== '/api/local-dsh-rollback') throw new Error('Unexpected fixture endpoint');
    const body = options.body ? JSON.parse(options.body) : undefined;
    const action = body?.action || url.searchParams.get('action');
    mock.calls.push({ method, action, body, url: url.href });
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (method === 'POST' && mock.held) await new Promise(resolve => mock.pending.push(resolve));
    let data;
    switch (action) {
      case 'status': data = { ok: true, canMutate: config.canMutate !== false, workspaceBusy: false, settings, storage }; break;
      case 'list': data = { ok: true, records: url.searchParams.get('query') ? [] : records, total: records.length, nextOffset: null }; break;
      case 'turns': data = { ok: true, turns: records.map(record => ({ turn: record.turn, endSeq: record.endSeq, fileCount: record.files.length })) }; break;
      case 'detail': {
        const file = files.find(file => file.id === url.searchParams.get('fileId'));
        data = { ok: true, file, diff: { truncated: false, lines: [
          { type: 'context', oldLine: 1, newLine: 1, text: 'import { useState } from "react";' },
          { type: 'remove', oldLine: 2, text: 'export const message = "before · ' + 'long-unbroken-text-'.repeat(50) + '";' },
          { type: 'add', newLine: 2, text: 'export const message = "after · ' + 'long-unbroken-text-'.repeat(50) + '";' },
          ...Array.from({ length: 5 }, (_, index) => ({ type: 'context', oldLine: index + 3, newLine: index + 3, text: `// unchanged context ${index + 1}` })),
        ] } }; break;
      }
      case 'prepare': data = { ok: true, token: 'mock-preview-token-not-a-host-token', expiresAt: Date.now() + 300000, canRestore: true,
        files: files.filter(file => body.fileIds.includes(file.id)).map(file => ({ id: file.id, display: file.display, path: file.path, target: body.side, noOp: false, operation: file.id === 'f2' && body.side === 'before' ? 'delete' : 'replace' })), checks: [] }; break;
      case 'restore': data = { ok: true, recordId: 'mock-recovery-record', restored: files.slice(0, 2), noOp: false }; break;
      case 'settings': Object.assign(settings, body); data = { ok: true, settings }; break;
      case 'optimize': data = { ok: true, migrated: 0, pruned: 0, reclaimedPacks: 0, storage }; break;
      case 'clean': data = { ok: true, deleted: 0 }; break;
      case 'delete': data = { ok: true, deleted: 1 }; break;
      default: throw new Error('Unexpected fixture action: ' + action);
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  window.__ModuleLoader__ = { load(value) { definition = value; } };
  mock.mount = () => {
    definition.factory(id => { if (id !== 'react') throw new Error('Unexpected require: ' + id); return window.React; }).apply({
      get: () => undefined,
      locale: { bind: () => key => key, subscribe: () => () => {}, getSnapshot: () => config.localeSnapshot, register: () => () => {} },
      effect: fn => fn(),
      slots: { inject: (_name, fn) => fn(), register: (spec, component) => slots.set(spec.name, component) },
    });
    const h = React.createElement;
    ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment, null,
      h(slots.get('conversation.session.header.utilities'), { sessionId: 'fixture-session' }),
      h(slots.get('shell.overlay'))));
    mock.ready = true;
  };
}

const light = { 'bg-base': '#ffffff', 'bg-layer-1': '#f7f8fa', 'bg-layer-2': '#eceef2', 'label-primary': '#20242c', 'label-secondary': '#626a78', 'border-l1': '#dfe3e9', 'brand-primary': '#3b66d9', 'state-success-primary': '#18784c', 'state-error-primary': '#c03d43', 'state-warn-primary': '#a36c11' };
const dark = { 'bg-base': '#181c24', 'bg-layer-1': '#222731', 'bg-layer-2': '#2d3441', 'label-primary': '#edf0f7', 'label-secondary': '#a7afbf', 'border-l1': '#3a4352', 'brand-primary': '#8baeff', 'state-success-primary': '#74d3a2', 'state-error-primary': '#ff949a', 'state-warn-primary': '#edc677' };
function html(config) {
  const palette = config.theme === 'dark' ? dark : light;
  const vars = Object.entries(palette).map(([key, value]) => `--dsw-alias-${key}:${value}`).join(';');
  const script = text => `<script>${text.replace(/<\/script/gi, '<\\/script')}</script>`;
  const setup = `(${browserFixture})(${JSON.stringify({ ...config, localeSnapshot: { active: config.locale || 'zh' } })});`;
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\';script-src \'unsafe-inline\';style-src \'unsafe-inline\';img-src data:;connect-src \'none\'">' +
    `<title>Rollback · Offline Chromium fixture</title><style>:root{${vars};color-scheme:${config.theme}}body{margin:0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:14px system-ui}#fixture-note{padding:24px}#root>.dshr-headerbutton{margin:20px}</style></head><body>` +
    '<p id="fixture-note">OFFLINE MOCK FIXTURE · Working-tree client · No Host mutations</p><div id="root"></div>' +
    script(runtime) + script(setup) + script(client) + script('__fixture.mount();') + '</body></html>';
}

class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const entry = this.pending.get(message.id); if (!entry) return;
        this.pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result);
      } else for (const listener of this.listeners.get(message.method) || []) Promise.resolve(listener(message.params)).catch(error => report.pageExceptions.push({ source: 'CDP event handler', error: String(error) }));
    });
  }
  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    return new CDP(socket);
  }
  on(method, fn) { const listeners = this.listeners.get(method) || []; listeners.push(fn); this.listeners.set(method, listeners); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  close() { this.socket.close(); }
}

let browser, cdp, browserCDP, fixtureHtml = '';
const profile = path.join(output, 'chromium-profile-' + Date.now());
async function eventually(expression, label = expression) {
  const deadline = Date.now() + 9000;
  do { if (await cdp.eval(`Boolean(${expression})`)) return; await delay(30); } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}
function check(name, details) { report.checks.push({ name, pass: true, ...(details === undefined ? {} : { details }) }); console.log('PASS', name); }
async function test(name, fn) { try { const details = await fn(); check(name, details); } catch (error) { report.checks.push({ name, pass: false, error: String(error), stack: error.stack }); console.error('FAIL', name, String(error)); if (cdp) try { await screenshot(name.replaceAll(/[^a-z0-9]+/gi, '-').slice(0,100) + '-failure'); } catch {} } }
async function screenshot(name) {
  await cdp.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const filename = path.join(output, name + '.png'); fs.writeFileSync(filename, Buffer.from(result.data, 'base64'));
  report.screenshots.push(path.relative(root, filename)); return filename;
}
async function click(selector) {
  const position = await cdp.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing click target');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position });
}
async function button(text, group = '.dshr-dialog') {
  await cdp.eval(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(group + ' button')})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button: '+${JSON.stringify(text)});b.dataset.smokeTarget='yes'})()`);
  await click('[data-smoke-target="yes"]'); await cdp.eval("document.querySelector('[data-smoke-target]')?.removeAttribute('data-smoke-target')");
}
async function key(key, modifiers = 0) { const virtualKey = key === 'Tab' ? 9 : key === 'Escape' ? 27 : 13; await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, modifiers, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, modifiers, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey }); }
async function open(config) {
  fixtureHtml = html(config);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: config.width, height: config.height, deviceScaleFactor: 1, mobile: config.width < 600 });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: config.theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp.send('Page.navigate', { url: `${origin}/${config.name}` });
  await eventually('window.__fixture?.ready && document.querySelector(".dshr-headerbutton")', 'fixture boot');
  await click('.dshr-headerbutton');
  await eventually('document.querySelector(".dshr-dialog") && __fixture.calls.some(c=>c.action==="list") && !document.body.innerText.includes("正在加载历史") && !document.body.innerText.includes("Loading history")', 'dialog records loaded');
  if (!config.empty) await eventually('document.querySelector(".dshr-diff")', 'real React diff mounted');
  report.reactVersion = await cdp.eval('React.version');
}
function labels(config) {
  return config.locale === 'en' ? { before: 'Restore selected to before', confirm: 'Confirm restore', cancel: 'Cancel', close: 'Close', save: 'Save', optimize: 'Optimize old backups (this workspace)', simpleConfirm: 'Confirm', clean: 'Clean expired backups', delete: 'Delete backup', restored: 'Restore completed.', empty: 'Your next changes start here' }
    : { before: '回滚所选文件到之前版本', confirm: '确认回滚', cancel: '取消', close: '关闭', save: '保存', optimize: '优化旧备份（当前工作区）', simpleConfirm: '确认', clean: '清理过期备份', delete: '删除备份', restored: '回滚已完成。', empty: '从下一次修改开始，留住每个版本' };
}
async function workflow(config) {
  const l = labels(config);
  await open(config);
  await screenshot(config.name + '-history');
  await test(config.name + ': viewport contains dialog without page overflow', async () => {
    const metrics = await cdp.eval(`(()=>{const e=document.querySelector('.dshr-dialog'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}})()`);
    assert.ok(metrics.x >= 0 && metrics.y >= 0 && metrics.right <= metrics.width + 1 && metrics.bottom <= metrics.height + 1); assert.ok(metrics.scrollWidth <= metrics.width + 1); return metrics;
  });
  await test(config.name + ': optional management defaults collapsed and keyboard toggles', async () => {
    assert.equal(await cdp.eval("document.querySelector('details').open"), false);
    await cdp.eval("document.querySelector('summary').focus()"); await key('Enter');
    await eventually("document.querySelector('details').open");
    assert.equal(await cdp.eval("document.querySelector('details input').offsetParent!==null"), true);
    await screenshot(config.name + '-management');
    const footer = await cdp.eval(`(()=>{const b=[...document.querySelectorAll('details button')].find(e=>e.textContent===${JSON.stringify(l.clean)});b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect(),f=document.querySelector('.dshr-footer');return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,scrollTop:f.scrollTop,scrollHeight:f.scrollHeight,clientHeight:f.clientHeight,pageWidth:document.documentElement.scrollWidth}})()`);
    assert.ok(footer.x>=0 && footer.y>=0 && footer.right<=config.width+1 && footer.bottom<=config.height+1, 'management bottom action must remain reachable');
    assert.ok(footer.pageWidth<=config.width+1, 'expanded footer must not widen mobile page');
    await screenshot(config.name + '-management-bottom'); await key('Enter');
    assert.equal(await cdp.eval("document.querySelector('details').open"), false);
    return footer;
  });
  await test(config.name + ': long diff is horizontally scrollable, not page-wide', async () => {
    const metrics = await cdp.eval("(()=>{const d=document.querySelector('.dshr-diff');d.scrollIntoView({block:'nearest'});d.scrollLeft=480;return {clientWidth:d.clientWidth,scrollWidth:d.scrollWidth,scrollLeft:d.scrollLeft,bodyWidth:document.documentElement.scrollWidth}})()");
    assert.ok(metrics.scrollWidth > metrics.clientWidth * 3); assert.ok(metrics.scrollLeft > 0); assert.ok(metrics.bodyWidth <= config.width + 1);
    await screenshot(config.name + '-long-diff'); await cdp.eval("document.querySelector('.dshr-diff').scrollLeft=0"); return metrics;
  });
  await test(config.name + ': select files / preview only / duplicate prepare guarded', async () => {
    await click('.dshr-file:nth-child(1) input'); await click('.dshr-file:nth-child(2) input');
    assert.equal(await cdp.eval("document.querySelectorAll('.dshr-file input:checked').length"), 2);
    assert.equal(await cdp.eval("__fixture.calls.filter(c=>c.method==='POST').length"), 0);
    await cdp.eval(`(()=>{__fixture.held=true;const b=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(l.before)});b.click();b.click();b.click()})()`);
    await eventually("__fixture.count('prepare')===1 && __fixture.pending.length===1");
    assert.equal(await cdp.eval("__fixture.count('prepare')"), 1);
    assert.equal(await cdp.eval("__fixture.count('restore')"), 0);
    await key('Escape'); assert.equal(await cdp.eval("!!document.querySelector('.dshr-dialog')"), true, 'in-flight dialog cannot dismiss');
    await cdp.eval('__fixture.held=false;__fixture.release()');
    await eventually("[...document.querySelectorAll('.dshr-confirm')].some(e=>e.querySelector('strong'))", 'preview visible');
    const request = await cdp.eval("__fixture.calls.find(c=>c.action==='prepare').body"); assert.deepEqual(request.fileIds, ['f1', 'f2']); assert.equal(request.side, 'before');
    const previewMetrics = await cdp.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(l.confirm)}),r=b.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);
    assert.ok(previewMetrics.x>=0 && previewMetrics.y>=0 && previewMetrics.right<=config.width+1 && previewMetrics.bottom<=config.height+1, 'preview confirmation must be visible without clipping');
    await screenshot(config.name + '-preview'); return { request, previewMetrics };
  });
  await test(config.name + ': confirm restore repeated clicks make exactly one mock POST', async () => {
    await cdp.eval(`(()=>{__fixture.held=true;const b=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(l.confirm)});b.click();b.click();b.click()})()`);
    await eventually("__fixture.count('restore')===1 && __fixture.pending.length===1");
    assert.equal(await cdp.eval("__fixture.count('restore')"), 1);
    assert.equal(await cdp.eval("[...document.querySelectorAll('button')].find(e=>e.title===('" + l.close + "')).disabled"), true);
    await key('Escape'); assert.equal(await cdp.eval("!!document.querySelector('.dshr-dialog')"), true);
    await cdp.eval('__fixture.held=false;__fixture.release()');
    await eventually(`document.body.innerText.includes(${JSON.stringify(l.restored)})`);
    assert.equal(await cdp.eval("document.querySelectorAll('.dshr-file input:checked').length"), 0);
    await screenshot(config.name + '-restored');
  });
  await test(config.name + ': keyboard focus trap / focus-visible / Escape restores opener', async () => {
    await cdp.eval("document.querySelector('.dshr-dialog').focus()"); await key('Tab');
    assert.equal(await cdp.eval("document.activeElement===document.querySelector('.dshr-header button')"), true);
    await key('Tab', 8);
    const focus = await cdp.eval("(()=>{const d=document.querySelector('.dshr-dialog'),nodes=[...d.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex]:not([tabindex=\"-1\"])')].filter(e=>e.offsetParent!==null);return {tag:document.activeElement.tagName,text:document.activeElement.textContent?.slice(0,120),html:document.activeElement.outerHTML.slice(0,250),nodes:nodes.map(e=>({tag:e.tagName,text:e.textContent?.slice(0,55),rects:e.getClientRects().length,height:e.getBoundingClientRect().height,visible:e.checkVisibility?.()}))}})()");
    report[config.name + '-focusDiagnostics'] = focus;
    assert.equal(await cdp.eval("document.activeElement===document.querySelector('summary')"), true, JSON.stringify(focus));
    await key('Tab');
    assert.equal(await cdp.eval("document.activeElement===document.querySelector('.dshr-header button')"), true);
    const outline = await cdp.eval("getComputedStyle(document.activeElement).outlineStyle"); assert.equal(outline, 'solid');
    await screenshot(config.name + '-keyboard-focus');
    await key('Escape'); await eventually("!document.querySelector('.dshr-dialog')");
    assert.equal(await cdp.eval("document.activeElement===document.querySelector('.dshr-headerbutton')"), true);
  });
  await test(config.name + ': explicit close and backdrop restore opener without posting', async () => {
    if (await cdp.eval("!!document.querySelector('.dshr-dialog')")) await key('Escape');
    await click('.dshr-headerbutton'); await eventually("document.querySelector('.dshr-dialog')");
    const count = await cdp.eval("__fixture.calls.filter(c=>c.method==='POST').length");
    await button(l.close); await eventually("!document.querySelector('.dshr-dialog')");
    assert.equal(await cdp.eval("document.activeElement===document.querySelector('.dshr-headerbutton')"), true);
    await click('.dshr-headerbutton'); await eventually("document.querySelector('.dshr-dialog')");
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed', x:2, y:2, button:'left', clickCount:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased', x:2, y:2, button:'left', clickCount:1});
    await eventually("!document.querySelector('.dshr-dialog')");
    assert.equal(await cdp.eval("__fixture.calls.filter(c=>c.method==='POST').length"), count);
  });
  report[config.name] = await cdp.eval('__fixture.calls');
}

try {
  const log = fs.openSync(path.join(output, 'chromium.log'), 'w');
  browser = spawn(chromium, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--metrics-recording-only', '--password-store=basic', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', log, log] });
  fs.closeSync(log);
  let port;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (browser.exitCode !== null) throw new Error('Chromium exited before CDP became ready: ' + browser.exitCode);
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); if (port) break; } catch {}
    await delay(50);
  }
  assert.ok(port, 'Chromium CDP port available');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); report.browserVersion = version.Browser;
  browserCDP = await CDP.open(version.webSocketDebuggerUrl);
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  cdp = await CDP.open(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  cdp.on('Runtime.exceptionThrown', event => report.pageExceptions.push(event.exceptionDetails));
  cdp.on('Runtime.consoleAPICalled', event => { if (event.type === 'error') report.consoleErrors.push(event.args.map(arg => arg.value || arg.description)); });
  cdp.on('Fetch.requestPaused', async event => {
    if (event.request.url.startsWith(origin + '/') && event.resourceType === 'Document') await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from(fixtureHtml).toString('base64') });
    else { report.safety.externalBrowserRequests.push({ url: event.request.url, method: event.request.method }); await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); }
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  for (const config of [
    { name: 'desktop-light-zh', width: 1440, height: 1000, theme: 'light', locale: 'zh' },
    { name: 'desktop-dark-en', width: 1440, height: 1000, theme: 'dark', locale: 'en' },
    { name: 'mobile-light-zh', width: 390, height: 844, theme: 'light', locale: 'zh' },
    { name: 'mobile-dark-en', width: 390, height: 844, theme: 'dark', locale: 'en' },
  ]) await workflow(config);
  for (const config of [
    { name: 'empty-desktop-light-zh', width: 1440, height: 1000, theme: 'light', locale: 'zh', empty: true },
    { name: 'empty-mobile-dark-zh', width: 390, height: 844, theme: 'dark', locale: 'zh', empty: true },
  ]) {
    await open(config);
    await test(config.name + ': explanatory initial empty state and no mutations', async () => {
      await eventually(`document.querySelector('.dshr-empty h3')?.textContent===${JSON.stringify(labels(config).empty)}`);
      assert.equal(await cdp.eval("document.querySelector('details').open"), false);
      assert.equal(await cdp.eval("__fixture.calls.filter(c=>c.method==='POST').length"), 0);
      assert.ok(await cdp.eval("document.querySelector('.dshr-empty').getBoundingClientRect().height>0"));
      await screenshot(config.name); await key('Escape');
    });
  }
  await test('no browser JavaScript errors or unexpected network escapes', async () => {
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageExceptions, []); assert.deepEqual(report.safety.externalBrowserRequests, []);
  });
  // Explicitly read-only check of the existing URL; no auth bypass and no mutation.
  try {
    const response = await fetch('http://127.0.0.1:55691/', { signal: AbortSignal.timeout(5000) });
    report.liveShellConnectivity = { url: response.url, status: response.status, contentType: response.headers.get('content-type'), note: response.ok ? 'Read-only HTTP shell check only, not plugin installation verification.' : (await response.text()).slice(0, 160) };
  } catch (error) { report.liveShellConnectivity = { error: String(error) }; }
} catch (error) {
  report.fatal = { error: String(error), stack: error.stack }; console.error(error);
  if (cdp) try { await screenshot('failure'); report.failureDom = await cdp.eval('document.body.innerText'); } catch {}
} finally {
  if (browserCDP) try { await browserCDP.send('Browser.close'); } catch {}
  cdp?.close(); browserCDP?.close();
  if (browser && browser.exitCode === null) { await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(2500)]); if (browser.exitCode === null) browser.kill(); }
  report.finishedAt = new Date().toISOString();
  report.clientUnchangedDuringRun = hash(fs.readFileSync(path.join(root, 'client.js'))) === report.clientSha256;
  report.passed = !report.fatal && report.checks.every(check => check.pass);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const lines = ['# Chromium mock-fixture smoke report', '', `- Result: **${report.passed ? 'PASS' : 'FAIL'}** (${report.checks.filter(c => c.pass).length}/${report.checks.length} checks)`, `- Browser: ${report.browserVersion || 'not started'}; React: ${report.reactVersion || 'not mounted'}`, `- Working-tree client SHA-256: \`${report.clientSha256}\``, `- Client unchanged during run: ${report.clientUnchangedDuringRun}`, '- Scope: real Chromium + real archived React renderer; mock slots, locale, theme aliases and in-memory API responses. **Not verification of the installed plugin.**', '- No replacement app server, no real Host mutations, isolated disposable browser profile.', `- Existing shell read-only check: ${JSON.stringify(report.liveShellConnectivity || null)}`, '', '## Checks', ...report.checks.map(c => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.error ? ': ' + c.error : ''}`), '', '## Screenshots', ...report.screenshots.map(p => `- [${path.basename(p)}](<${path.basename(p)}>)`)];
  if (report.fatal) lines.push('', '## Fatal error', '```', report.fatal.stack, '```');
  fs.writeFileSync(path.join(output, 'report.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.checks.filter(c => !c.pass).map(c => c.name), report: path.join(output, 'report.json'), screenshots: report.screenshots }, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
