// Original exports live in the selected workspace; DSH still owns its native
// attachment references. Never replace user files or follow an archive junction.
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function attachmentFileName(value) {
  let name = String(value || 'attachment').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '');
  if (!name || /^\.+$/.test(name)) name = 'attachment';
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name;
  const extension = extname(name).slice(0, 20);
  let stem = '';
  for (const char of name.slice(0, name.length - extname(name).length)) {
    if (Buffer.byteLength(stem + char, 'utf8') > 160) break;
    stem += char;
  }
  return stem + extension;
}

function within(root, path) {
  const part = relative(root, path);
  return part && !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep);
}

/** Private, bounded disk spool so workspace-copy failure cannot consume the
 * only upstream stream and lose the DSH attachment, or vice versa. */
export async function stageAttachment(data, { signal } = {}) {
  signal?.throwIfAborted();
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-attachment-'));
  const file = join(root, 'original');
  const dispose = async () => {
    if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith('dsh-web-attachment-')) throw new Error('Unsafe temporary cleanup target');
    await rm(root, { recursive: true, force: true });
  };
  let bytes = 0;
  try {
    const checked = (async function* () {
      for await (const chunk of data) {
        signal?.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > 100 * 1024 * 1024) throw new Error('附件超过单文件导入上限 100 MiB');
        yield chunk;
      }
    })();
    await pipeline(Readable.from(checked), createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal });
    return { path: file, bytes, dispose, read: async function* () {
      yield* createReadStream(file, { signal });
    } };
  } catch (error) { await dispose(); throw error; }
}

export async function createWorkspaceArchive(cwd, sessionId) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('无法安全定位目标工作区，原文件未保存到工作区');
  const workspace = await realpath(cwd);
  if (!(await lstat(workspace)).isDirectory()) throw new Error('目标工作区不是目录');
  const parent = join(workspace, 'deepseek-web-attachments');
  try { await mkdir(parent, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(parent);
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(parent) !== parent) throw new Error('附件目录是链接或不是目录，已拒绝向工作区外写入');
  const prefix = String(sessionId || 'conversation').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'conversation';
  const directory = await mkdtemp(join(parent, prefix + '-'));
  return {
    directory,
    async save(stage, name, signal) {
      signal?.throwIfAborted();
      if (await realpath(directory) !== directory || !(within(workspace, directory))) throw new Error('附件目录已改变，已停止写入');
      const leaf = attachmentFileName(name), extension = extname(leaf), stem = leaf.slice(0, leaf.length - extension.length);
      for (let index = 0; index < 1000; index++) {
        const file = join(directory, index ? `${stem} (${index + 1})${extension}` : leaf);
        if (!within(directory, file)) throw new Error('附件文件名越界');
        try {
          await copyFile(stage.path, file, constants.COPYFILE_EXCL);
          return { name: basename(file), path: relative(workspace, file).split(sep).join('/') };
        } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      throw new Error('附件同名文件过多，未覆盖现有文件');
    },
  };
}
