import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeCommunityDragon, STATIC_URL } from '../src/providers/communityDragon';
import { loadPlaybooks } from '../src/providers/playbooks';
import type { Provenance } from '../src/domain/models';
import { auditStaticData } from '../src/rules/ruleSet';
// Explicit --download replaces the source fixture; ordinary runs reproduce the bundled snapshot.
if (process.argv.includes('--download')) {
  const response = await fetch(STATIC_URL, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Static download failed (${response.status})`);
  const full = (await response.json()) as {
    items: { apiName: string }[];
    setData: {
      number: number;
      mutator: string;
      champions: { apiName: string }[];
      items: string[];
      augments: string[];
    }[];
  };
  const set = full.setData.find((s) => s.number === 18 && s.mutator === 'TFTSet18');
  if (!set) throw new Error('Set 18 missing; do not silently advance sets.');
  const ids = new Set([...set.items, ...set.augments].filter((id) => id.startsWith('DA_')));
  const reduced = {
    items: full.items.filter((i) => ids.has(i.apiName)),
    setData: [
      {
        ...set,
        champions: set.champions.filter((c) => c.apiName.startsWith('DA_')),
        items: set.items.filter((id) => ids.has(id)),
        augments: set.augments.filter((id) => ids.has(id)),
      },
    ],
  };
  const provenance: Provenance = {
    source: STATIC_URL,
    fetchedAt: new Date().toISOString(),
    publishedAt: response.headers.get('last-modified') ?? undefined,
    status: 'verified',
    patch: null,
    note: 'Reduced public static export. Exact balance/hotfix parity is unverified.',
  };
  normalizeCommunityDragon(reduced, provenance);
  await writeFile('data/fixtures/cdragon-set18.json', JSON.stringify(reduced));
  await writeFile(
    'data/fixtures/cdragon-set18.provenance.json',
    JSON.stringify(provenance, null, 2),
  );
}
const raw = await readFile('data/fixtures/cdragon-set18.json', 'utf8');
const provenance = JSON.parse(
  await readFile('data/fixtures/cdragon-set18.provenance.json', 'utf8'),
) as Provenance;
const data = normalizeCommunityDragon(JSON.parse(raw), {
  ...provenance,
  hash: createHash('sha256').update(raw).digest('hex'),
});
const auditIssues = auditStaticData(data);
if (auditIssues.length)
  throw new Error(
    `Audited rule fixture mismatch: ${auditIssues.map((issue) => issue.message).join(' ')}`,
  );
await mkdir('public/data', { recursive: true });
await mkdir('public/assets/tft', { recursive: true });
await writeFile('public/data/static-set18.json', JSON.stringify(data));
const playbooks = loadPlaybooks(data);
const units = new Set(
  playbooks.flatMap((p) =>
    [...p.target.units, ...p.stages.flatMap((s) => s.board.value?.units ?? [])].map(
      (u) => u.championId,
    ),
  ),
);
const heroes = new Set(playbooks.map((p) => p.hero));
const items = new Set(
  playbooks.flatMap((p) => [...p.items.flatMap((i) => i.priorities), ...p.components]),
);
const urls = [
  ...new Set(
    [
      ...data.champions
        .filter((c) => units.has(c.id))
        .flatMap((c) => [c.icon, heroes.has(c.id) ? c.splash : null]),
      ...data.items.filter((i) => items.has(i.id)).map((i) => i.icon),
    ].filter((v): v is string => !!v),
  ),
];
const manifest: Record<string, string> = {};
const queue = [...urls];
let failed = 0;
await Promise.all(
  Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const url = queue.shift()!;
      const file = `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.png`;
      try {
        let buffer: Uint8Array;
        try {
          buffer = await readFile(`public/assets/tft/${file}`);
        } catch {
          const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
          if (!response.ok || !response.headers.get('content-type')?.includes('image/'))
            throw new Error('Asset unavailable');
          buffer = new Uint8Array(await response.arrayBuffer());
          await writeFile(`public/assets/tft/${file}`, buffer);
        }
        if (!buffer.byteLength) throw new Error('Empty asset');
        manifest[url] = `/assets/tft/${file}`;
      } catch {
        failed++;
        console.log(`Asset unavailable: ${url}`);
      }
    }
  }),
);
const stableManifest = Object.fromEntries(
  Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right)),
);
await writeFile('public/data/asset-manifest.json', JSON.stringify(stableManifest));
console.log(
  JSON.stringify(
    {
      champions: data.champions.length,
      traits: data.traits.length,
      items: data.items.length,
      augments: data.augments.length,
      assets: Object.keys(stableManifest).length,
      failed,
    },
    null,
    2,
  ),
);
