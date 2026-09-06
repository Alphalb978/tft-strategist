import { metaFixture } from './meta-fixture';
console.log(
  JSON.stringify(await metaFixture(Number(process.argv[2] ?? 120), process.argv[3] ?? 'EUW1')),
);
