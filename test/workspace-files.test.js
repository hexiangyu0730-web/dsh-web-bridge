import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, symlink, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, relative } from 'node:path';
import { attachmentFileName, createWorkspaceArchive, stageAttachment } from '../lib/workspace-files.js';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-test-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('dsh-workspace-files-test-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('workspace copies retain original bytes, preserve names, and never overwrite collisions', async (t) => {
  const root = await workspace(t), archive = await createWorkspaceArchive(root, 'web-session');
  const bytes = Buffer.from([0, 255, 0, 128]), stage = await stageAttachment([bytes.subarray(0, 2), bytes.subarray(2)]);
  try {
    const first = await archive.save(stage, '原文件.bin');
    await writeFile(join(root, first.path), 'user change');
    const second = await archive.save(stage, '原文件.bin');
    assert.notEqual(first.path, second.path);
    assert.equal(await readFile(join(root, first.path), 'utf8'), 'user change');
    assert.deepEqual(await readFile(join(root, second.path)), bytes);
    assert.equal(second.name, '原文件 (2).bin');
    const repeated = await createWorkspaceArchive(root, 'web-session');
    assert.notEqual(archive.directory, repeated.directory, 'a repeated import must not overwrite a previous export');
  } finally { await stage.dispose(); }
});

test('unsafe, reserved, Unicode and long names stay in the selected workspace', async (t) => {
  const root = await workspace(t), archive = await createWorkspaceArchive(root, '../../outside');
  const stage = await stageAttachment([Buffer.from('data')]);
  try {
    for (const name of ['../../evil.txt', 'C:\\Windows\\evil.exe', 'NUL.txt', 'CON', 'a:b?.txt', '\u0000', '.', '🙂'.repeat(150) + '.png']) {
      const saved = await archive.save(stage, name);
      assert.ok(!relative(root, join(root, saved.path)).startsWith('..'));
      assert.deepEqual(await readFile(join(root, saved.path)), Buffer.from('data'));
      assert.ok(!/[<>:"\\|?*\u0000]/.test(saved.name));
    }
    assert.equal(attachmentFileName('NUL.txt'), '_NUL.txt');
  } finally { await stage.dispose(); }
});

test('an archive junction or non-directory is refused without touching its target', async (t) => {
  const root = await workspace(t), outside = await workspace(t);
  await symlink(outside, join(root, 'deepseek-web-attachments'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createWorkspaceArchive(root, 'chat'), /链接/);
  assert.deepEqual(await readdir(outside), []);
  const other = await workspace(t);
  await writeFile(join(other, 'deepseek-web-attachments'), 'do not replace');
  await assert.rejects(createWorkspaceArchive(other, 'chat'));
  assert.equal(await readFile(join(other, 'deepseek-web-attachments'), 'utf8'), 'do not replace');
});

test('unknown or relative workspaces fail closed and staging supports cancellation', async () => {
  for (const path of [undefined, '', '.', '../other']) await assert.rejects(createWorkspaceArchive(path, 'chat'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(stageAttachment([Buffer.from('data')], { signal: controller.signal }), error => error.name === 'AbortError');
});
