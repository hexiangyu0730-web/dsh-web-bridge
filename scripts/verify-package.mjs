// Works without account credentials, network dependencies or an existing profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateArtifacts, validateManifest, validatePackList } from './package-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const taskTemp = await mkdtemp(join(tmpdir(), 'dsh-web-package-'));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'run this check through npm run verify:package');
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], {
  cwd, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' },
});
try {
  const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', taskTemp], root))[0];
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  validateManifest(pkg);
  assert.equal(packed.name, pkg.name);
  assert.equal(packed.version, pkg.version);
  validatePackList(pkg, packed.files.map(file => file.path));

  const consumer = join(taskTemp, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--package-lock=false', join(taskTemp, packed.filename)], consumer);
  const installed = join(consumer, 'node_modules', ...pkg.name.split('/'));
  const text = file => readFile(join(installed, file), 'utf8');
  validateManifest(JSON.parse(await text('package.json')));
  validateArtifacts(pkg, { patch: await text('cordis.patch.yml'), client: await text('lib/client.js'),
    host: await text('lib/index.js'), license: await text('LICENSE'), notices: await text('THIRD_PARTY_NOTICES.md') });
  const host = await import(pathToFileURL(join(installed, 'lib/index.js')).href);
  assert.equal(host.name, pkg.name);
  assert.equal(typeof host.apply, 'function');
  for (const language of ['en', 'zh']) {
    const locale = JSON.parse(await text(`locale/${language}.json`));
    assert.ok(locale.meta.title && locale.meta.description);
  }
  for (const specifier of [pkg.name, pkg.name + '/client', pkg.name + '/locale/en.json', pkg.name + '/icon']) {
    // Resolve as a real consumer, not from the repository's own directory.
    execFileSync(process.execPath, ['--input-type=module', '-e', 'console.log(import.meta.resolve(process.argv[1]))', specifier],
      { cwd: consumer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
  }
  const screenshots = JSON.parse(await text('screenshots.json'));
  assert.ok(Array.isArray(screenshots) && screenshots.length >= 1 && screenshots.length <= 8);
  for (const file of screenshots) {
    assert.match(file, /^assets\/screenshots\/[a-z\d-]+\.png$/);
    const bytes = await readFile(join(installed, file));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `not a PNG: ${file}`);
    assert.ok(bytes.length > 1000 && bytes.length < 5 * 1024 * 1024, `unexpected screenshot size: ${file}`);
    for (let offset = 8; offset < bytes.length;) {
      assert.ok(offset + 12 <= bytes.length, `truncated PNG: ${file}`);
      const length = bytes.readUInt32BE(offset);
      const chunk = bytes.subarray(offset + 4, offset + 8).toString('ascii');
      assert.ok(!['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(chunk), `remove potentially private image metadata: ${file}`);
      offset += length + 12;
      assert.ok(offset <= bytes.length, `invalid PNG chunk: ${file}`);
    }
  }
  // Catch repository-only relative documentation links before shipping a tarball.
  async function markdownFiles(folder) {
    const entries = await readdir(folder, { withFileTypes: true });
    return (await Promise.all(entries.map(entry => entry.isDirectory()
      ? markdownFiles(join(folder, entry.name)) : /\.md$/.test(entry.name) ? [join(folder, entry.name)] : []))).flat();
  }
  for (const file of await markdownFiles(installed)) {
    const source = await readFile(file, 'utf8');
    assert.ok(!/[A-Z]:[\\/]Users[\\/]|E:[\\/]deepseek harness plugin/i.test(source), `personal path in ${file}`);
    for (const [, link] of source.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(link)) continue;
      const target = resolve(dirname(file), decodeURIComponent(link.split('#')[0]));
      assert.ok(target.startsWith(installed + sep), `link escapes the package: ${link}`);
      await readFile(target);
    }
  }
  console.log(`Verified ${pkg.name}@${pkg.version}: ${packed.files.length} packed files, offline clean install, exports, client identity, license and screenshots.`);
  console.log(`sha512 integrity: ${packed.integrity}`);
} finally {
  assert.equal(dirname(taskTemp), resolve(tmpdir()));
  assert.ok(basename(taskTemp).startsWith('dsh-web-package-'));
  await rm(taskTemp, { recursive: true, force: true });
}
