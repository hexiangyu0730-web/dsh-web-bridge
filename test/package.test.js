import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateArtifacts, validateManifest, validatePackList } from '../scripts/package-contract.mjs';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const pkg = JSON.parse(await read('package.json'));
const artifacts = { patch: await read('cordis.patch.yml'), client: await read('lib/client.js'),
  host: await read('lib/index.js'), license: await read('LICENSE'), notices: await read('THIRD_PARTY_NOTICES.md') };

test('public manifest, relative bundle and browser identity agree after the package rename', () => {
  validateManifest(pkg);
  validateArtifacts(pkg, artifacts);
});

test('release guard rejects private packages, stale names, missing DSH compatibility and license drift', () => {
  for (const change of [{ private: true }, { name: 'dsh-deepseek-web' }, { name: 'dsh-web-bridge' }, { engines: { node: pkg.engines.node } }, { license: 'MIT' }]) {
    assert.throws(() => validateManifest({ ...pkg, ...change }));
  }
});

test('release guard rejects stale client ids, versions and unsafe bundle aliases', () => {
  assert.throws(() => validateArtifacts(pkg, { ...artifacts, client: artifacts.client.replace('id: "' + pkg.name + '"', 'id: "dsh-deepseek-web"') }));
  assert.throws(() => validateArtifacts({ ...pkg, version: '99.0.0' }, artifacts));
  assert.throws(() => validateArtifacts(pkg, { ...artifacts, patch: artifacts.patch.replace('./lib/index.js', 'dsh-deepseek-web') }));
  assert.throws(() => validateArtifacts(pkg, { ...artifacts, license: 'MIT' }));
});

test('pack guard rejects secret, private fixture and missing notice files', () => {
  const paths = ['package.json', 'README.md', 'README.en.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md',
    'cordis.patch.yml', 'lib/index.js', 'lib/deepseek-api.js', 'lib/workspace-files.js', 'lib/client.js',
    'locale/zh.json', 'locale/en.json', 'icon.svg', 'docs/usage.md', 'docs/releasing.md',
    'docs/submission/SaiSenBox__dsh-web-bridge.yml', 'screenshots.json'];
  validatePackList(pkg, paths);
  for (const file of ['.env', '.credentials.yaml', 'output/playwright/requests.json', 'node_modules/private/index.js']) {
    assert.throws(() => validatePackList(pkg, [...paths, file]));
  }
  assert.throws(() => validatePackList(pkg, paths.filter(file => file !== 'THIRD_PARTY_NOTICES.md')));
});
