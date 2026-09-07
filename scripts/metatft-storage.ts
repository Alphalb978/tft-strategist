import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { StaticData } from '../src/domain/models';
import type { ExternalSnapshot } from '../src/domain/externalMeta';
import { validateExternal } from '../src/providers/externalMeta';
export async function activateExternal(root: string, input: unknown, data: StaticData) {
  await mkdir(join(root, 'archive'), { recursive: true });
  let previous: ExternalSnapshot | null = null;
  try {
    previous = JSON.parse(await readFile(join(root, 'current.json'), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const next = validateExternal(input, data, previous);
  // Immutable archive first; the single-file rename replaces the pointer atomically on Windows too.
  if (previous)
    await writeFile(
      join(
        root,
        'archive',
        `${previous.manifest.retrievedAt.replace(/:/g, '-')}-${previous.manifest.contentHash}.json`,
      ),
      JSON.stringify(previous),
    );
  const archiveFiles = (await readdir(join(root, 'archive')))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(-12);
  const history = await Promise.all(
    archiveFiles.map((f) => readFile(join(root, 'archive', f), 'utf8').then(JSON.parse)),
  );
  await writeFile(join(root, 'history.json'), JSON.stringify(history));
  const pending = join(root, `pending-${crypto.randomUUID()}.json`);
  await writeFile(pending, JSON.stringify(next));
  await rename(pending, join(root, 'current.json'));
  return next;
}
