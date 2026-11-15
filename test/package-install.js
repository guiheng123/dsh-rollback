// Isolated tarball installation/import smoke. Never changes a Harness profile.
// Usage: node test/package-install.js releases/local-dsh-rollback-1.3.1.tgz
// Requires DSH_SMOKE_PNPM pointing to pnpm.mjs. Child output is inherited, not piped.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tarball = path.resolve(root, process.argv[2] || 'releases/local-dsh-rollback-1.3.1.tgz');
assert.ok(tarball.startsWith(path.join(root, 'releases') + path.sep), 'inspect the intended release artifact');
const pnpm = process.env.DSH_SMOKE_PNPM;
assert.ok(pnpm && path.isAbsolute(pnpm), 'DSH_SMOKE_PNPM must name the inspected pnpm.mjs');
const packed = await readFile(tarball);
const tar = gunzipSync(packed, { maxOutputLength: 16 * 1024 * 1024 });
const files = new Map();
for (let cursor = 0; cursor + 512 <= tar.length;) {
  const header = tar.subarray(cursor, cursor + 512); cursor += 512;
  if (header.every(byte => byte === 0)) break;
  const text = (a, b) => header.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
  const size = parseInt(text(124, 136).trim() || '0', 8);
  const prefix = text(345, 500), name = `${prefix ? prefix + '/' : ''}${text(0, 100)}`;
  const type = text(156, 157);
  assert.ok(Number.isSafeInteger(size) && size >= 0 && cursor + size <= tar.length, 'bounded tar entry');
  assert.ok(!name.startsWith('/') && !name.split('/').includes('..'), 'no tar path traversal');
  assert.ok(type === '' || type === '0' || type === '5', `unexpected tar entry type ${type}`);
  if (type !== '5') files.set(name, tar.subarray(cursor, cursor + size));
  cursor += Math.ceil(size / 512) * 512;
}
const expected = ['package.json','index.js','core.js','storage.js','client.js','cordis.patch.yml','icon.svg','LICENSE','README.md','locale/en.json','locale/zh.json'].map(p => 'package/' + p);
assert.deepEqual([...files.keys()].sort(), expected.sort(), 'only explicit runtime/docs files are distributed');
for (const [name, bytes] of files) {
  const source = await readFile(path.join(root, name.slice(8)));
  // pnpm normalizes the manifest's formatting and key order during pack.
  if (name === 'package/package.json') assert.deepEqual(JSON.parse(bytes.toString()), JSON.parse(source.toString()), 'packed manifest has identical semantic fields');
  else assert.deepEqual(bytes, source, `${name} matches reviewed working tree`);
}
const manifest = JSON.parse(files.get('package/package.json').toString('utf8'));
assert.equal(manifest.name, '@guiheng123/dsh-rollback'); assert.equal(manifest.version, '1.3.1');
const out = path.join(root, '.test-output', `package-install-${Date.now()}`);
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'package.json'), JSON.stringify({ name: 'rollback-isolated-install-smoke', private: true, type: 'module' }));
const result = spawnSync(process.execPath, [pnpm, 'add', '--offline', '--ignore-scripts', '--store-dir', path.join(root, '.pnpm-store'), tarball], { cwd: out, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
if (result.error) throw result.error;
assert.equal(result.status, 0, 'isolated offline installation succeeds');
await writeFile(path.join(out, 'smoke.mjs'), `import assert from 'node:assert/strict';
import * as plugin from '@guiheng123/dsh-rollback';
import { z } from 'zod';
import fs from 'node:fs/promises';
assert.equal(typeof plugin.apply, 'function');
assert.ok(plugin.inject.includes('fs') && plugin.inject.includes('connection'));
assert.equal(z.string().parse('ready'), 'ready');
const client = await fs.readFile(new URL('./node_modules/@guiheng123/dsh-rollback/client.js', import.meta.url), 'utf8');
assert.ok(client.includes('window.__ModuleLoader__.load'));
assert.ok(client.includes('plugins.bundle.config'));
console.log('Isolated release import passed; plugin apply was NOT called.');\n`);
// The direct zod import belongs to the installed plugin, not the test root. Resolve
// it via the plugin's package context, preserving pnpm's strict dependency layout.
let script = await readFile(path.join(out, 'smoke.mjs'), 'utf8');
script = script.replace("import { z } from 'zod';", "import { createRequire } from 'node:module'; const require = createRequire(import.meta.resolve('@guiheng123/dsh-rollback')); const { z } = require('zod');");
await writeFile(path.join(out, 'smoke.mjs'), script);
const imported = spawnSync(process.execPath, [path.join(out, 'smoke.mjs')], { cwd: out, stdio: 'inherit' });
if (imported.error) throw imported.error;
assert.equal(imported.status, 0, 'installed package imports without running apply');
const report = { ok: true, tarball: path.relative(root, tarball), version: manifest.version, sha256: createHash('sha256').update(packed).digest('hex'), packedBytes: packed.length, files: [...files.keys()], offlineInstall: true, installScripts: false, hostApplyCalled: false, userProfileModified: false, installDirectory: path.relative(root, out) };
await mkdir(path.join(root, '.test-output'), { recursive: true });
await writeFile(path.join(root, '.test-output', 'package-install-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
