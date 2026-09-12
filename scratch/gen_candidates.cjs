const fs = require('fs');

const raw = JSON.parse(fs.readFileSync('data/fixtures/cdragon-set18.json', 'utf8'));
const rules = JSON.parse(fs.readFileSync('data/rules/set18.json', 'utf8'));
const set = raw.setData[0];

const candidates = set.champions.map(c => {
  const disallowed = rules.board.disallowedUnitApiNames.includes(c.apiName);
  const variant = rules.board.exclusiveUnitGroups.some(g => g.unitApiNames.includes(c.apiName));
  const status = disallowed ? 'placeholder' : variant ? 'runtime-variant' : 'pool';
  return {
    api_name: c.apiName,
    name: c.name,
    cost: c.cost,
    shop_status: status,
  };
});

candidates.sort((a, b) => a.api_name.localeCompare(b.api_name));

console.log(`Generated ${candidates.length} candidates`);

const rustLines = candidates.map(c => {
  return `        ChampionCandidate { api_name: "${c.api_name}".into(), name: "${c.name}".into(), cost: ${c.cost}, shop_status: "${c.shop_status}".into() },`;
});

const rustCode = `pub fn get_default_set18_candidates() -> Vec<ChampionCandidate> {
    vec![
${rustLines.join('\n')}
    ]
}`;

fs.writeFileSync('scratch/candidates_rust.txt', rustCode);
console.log('Saved scratch/candidates_rust.txt successfully');
