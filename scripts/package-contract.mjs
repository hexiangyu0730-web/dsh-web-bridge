import assert from 'node:assert/strict';
import vm from 'node:vm';

export const packageName = '@xueray/dsh-web-bridge';
export const licenseId = 'PolyForm-Noncommercial-1.0.0';

export function validateManifest(pkg) {
  assert.equal(pkg.name, packageName);
  assert.notEqual(pkg.private, true, 'private packages cannot be published or indexed');
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i);
  assert.equal(pkg.license, licenseId);
  assert.equal(pkg.engines?.dsh, '>=0.2.1-rc.2 <0.3.0');
  assert.equal(pkg.engines?.node, '^22.19.0 || >=24.0.0');
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh?.client?.platform, 'web');
  assert.equal(pkg.exports?.['.'], './lib/index.js');
  assert.equal(pkg.exports?.['./client'], './lib/client.js');
  assert.equal(pkg.exports?.['./icon'], './icon.svg');
  assert.equal(pkg.exports?.['./locale/*.json'], './locale/*.json');
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org/');
  assert.equal(pkg.author?.name, 'SaiSenBox');
  assert.equal(pkg.repository?.url, 'git+https://github.com/SaiSenBox/dsh-web-bridge.git');
  assert.equal(pkg.homepage, 'https://github.com/SaiSenBox/dsh-web-bridge#readme');
  assert.equal(pkg.bugs?.url, 'https://github.com/SaiSenBox/dsh-web-bridge/issues');
  assert.ok(pkg.keywords?.includes('dsh-plugin'));
  assert.deepEqual(Object.keys(pkg.dependencies || {}), [], 'keep runtime self-contained');
  assert.ok(!pkg.scripts?.prepare && !pkg.scripts?.install && !pkg.scripts?.postinstall,
    'published plain JavaScript must not need install-time builds');
  assert.ok(pkg.scripts?.prepublishOnly?.includes('verify:package'));
}

export function validateArtifacts(pkg, { patch, client, host, license, notices }) {
  // This bundle intentionally uses one small, fixed patch shape. Do not build a
  // partial YAML parser; reject deviations, and test composition with DSH itself.
  const body = patch.replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter(line => !/^\s*(?:#.*)?$/.test(line)).join('\n');
  assert.equal(body, '- insert:\n    - id: deepseek-web\n      name: ./lib/index.js\n      config: {}',
    'bundle must stay a top-level patch array with its own relative entry');
  let definition;
  vm.runInNewContext(client, { window: { __ModuleLoader__: { load(value) {
    assert.equal(definition, undefined, 'register only one browser module');
    definition = value;
  } } } }, { timeout: 1000 });
  assert.equal(definition?.id, pkg.name, 'browser factory id must match package identity');
  assert.equal(typeof definition?.factory, 'function');
  assert.equal(/export const name = "([^"]+)"/.exec(host)?.[1], pkg.name);
  assert.equal(/const VERSION = "([^"]+)"/.exec(host)?.[1], pkg.version);
  assert.equal(/var FALLBACK_VERSION = "([^"]+)"/.exec(client)?.[1], pkg.version);
  assert.ok(license.startsWith('# PolyForm Noncommercial License 1.0.0\n'));
  assert.ok(license.includes('Required Notice: Copyright (c) 2026 SaiSenBox (https://github.com/SaiSenBox)'));
  assert.ok(license.includes('## Noncommercial Organizations'));
  assert.ok(notices.includes('Copyright (c) 2026 DeepSeek'));
  assert.ok(notices.includes('Permission is hereby granted, free of charge'));
}

export function validatePackList(pkg, paths) {
  const required = ['package.json', 'README.md', 'README.en.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'CHANGELOG.md', 'cordis.patch.yml', 'lib/index.js', 'lib/deepseek-api.js',
    'lib/workspace-files.js', 'lib/client.js', 'locale/zh.json', 'locale/en.json', 'icon.svg',
    'docs/usage.md', 'docs/releasing.md', 'docs/submission/SaiSenBox__dsh-web-bridge.yml', 'screenshots.json'];
  for (const file of required) assert.ok(paths.includes(file), `missing packed file: ${file}`);
  for (const file of paths) {
    assert.ok(!/^(?:\/|[a-z]:)|(?:^|\/)\.\.(?:\/|$)/i.test(file), `unsafe path: ${file}`);
    assert.ok(!/(?:^|\/)(?:node_modules|output|test|scripts|\.playwright-cli|\.github|\.git)(?:\/|$)/.test(file),
      `private/development files must not be packed: ${file}`);
    assert.ok(!/(?:^|\/)(?:\.env(?:\.|$)|\.credentials\.|.*\.(?:log|tgz|tmp)$)/.test(file), `private artifact: ${file}`);
    assert.ok(file === 'package.json' || pkg.files.some(entry => file === entry || file.startsWith(entry + '/')),
      `unexpected packed file: ${file}`);
  }
}
