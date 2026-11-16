import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(manifest.name, '@guiheng123/dsh-rollback');
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(manifest.dsh.client.platform, 'web');
assert.equal(manifest.private, false, 'release package must be publishable');
assert.equal(manifest.license, 'MIT');
assert.equal(manifest.version, '1.3.2');
assert.ok(manifest.engines.dsh.includes('0.2.2-rc.3'), 'declare inspected DSH compatibility');
assert.equal(manifest.dependencies.zod, '4.6.7', 'release dependency is pinned to the audited version');
for (const script of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(manifest.scripts[script], undefined, 'no installation build scripts');
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
assert.match(patch, /config: \{\}/, 'the bundle loads with code defaults instead of a config checklist');
// The Client loader keys factories by the registration id and refuses a bundle whose
// id differs from the boot-graph entry, failing the WHOLE Client half silently
// ("loaded without registering ... via __ModuleLoader__.load"). Keep them identical.
const client = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const registered = /__ModuleLoader__\.load\(\{[\s\S]{0,400}?id:\s*'([^']+)'/.exec(client)?.[1];
assert.equal(registered, manifest.name, 'client.js must register exactly the package name');
assert.ok(client.includes(`key: '${manifest.name}'`), 'the plugins.bundle.config key must be the package name');
for (const path of ['index.js','core.js','storage.js','client.js','cordis.patch.yml','locale/en.json','locale/zh.json','icon.svg','README.md','LICENSE']) {
  assert.ok(manifest.files.some(entry => entry === path || (entry.includes('*') && entry.split('*')[0] && path.startsWith(entry.split('*')[0]))), `${path} must be distributed`);
  const url = new URL(`../${path}`, import.meta.url);
  assert.ok((await stat(url)).isFile(), `${path} must be a file`);
}
for (const lang of ['en', 'zh']) {
  const data = JSON.parse(await readFile(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'));
  assert.ok(data.meta.title.length > 3 && data.meta.description.length > 20);
}
const icon = await readFile(new URL('../icon.svg', import.meta.url), 'utf8');
assert.ok(icon.startsWith('<svg ') && icon.includes('xmlns="http://www.w3.org/2000/svg"'));
assert.ok(Buffer.byteLength(icon) <= 262144);
assert.ok(!/<script|href\s*=|onload\s*=/i.test(icon));
console.log('Manifest, required distribution files, localized metadata and SVG safety checks passed.');
