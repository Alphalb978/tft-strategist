import { readFile, writeFile } from 'node:fs/promises';
import { compileKnowledge } from '../src/providers/knowledge';
import type { StaticData } from '../src/domain/models';
const data = JSON.parse(await readFile('public/data/static-set18.json', 'utf8')) as StaticData;
data.knowledge = compileKnowledge(
  JSON.parse(await readFile('data/fixtures/cdragon-set18.json', 'utf8')),
  data,
);
await writeFile('public/data/static-set18.json', JSON.stringify(data));
console.log(
  JSON.stringify({
    fingerprint: data.knowledge.fingerprint,
    coverage: data.knowledge.coverage.reduce<Record<string, number>>((s, e) => {
      const key = `${e.kind}:${e.state}`;
      s[key] = (s[key] ?? 0) + 1;
      return s;
    }, {}),
  }),
);
