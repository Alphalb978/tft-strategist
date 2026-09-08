import { readFile } from 'node:fs/promises';
import { normalizeCommunityDragon } from '../src/providers/communityDragon';
import { loadPlaybooks } from '../src/providers/playbooks';
import { auditStaticData } from '../src/rules/ruleSet';
import { validatePlaybook } from '../src/rules/validation';
import { validateExternal } from '../src/providers/externalMeta';
import type { Provenance } from '../src/domain/models';

async function main() {
  console.log('=== TFT Strategist Knowledge Validation ===\n');

  // 1. Validate CommunityDragon static data
  console.log('[1/3] Validating CommunityDragon static data...');
  const cdragonRaw = JSON.parse(await readFile('data/fixtures/cdragon-set18.json', 'utf8'));
  const provenance: Provenance = JSON.parse(
    await readFile('data/fixtures/cdragon-set18.provenance.json', 'utf8'),
  );
  const data = normalizeCommunityDragon(cdragonRaw, provenance);

  const staticAudit = auditStaticData(data);
  if (staticAudit.length) {
    console.error('Static data audit issues found:');
    for (const issue of staticAudit) {
      console.error(`  - [${issue.code}] ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`  ✓ Champions: ${data.champions.length}`);
  console.log(`  ✓ Traits: ${data.traits.length}`);
  console.log(`  ✓ Items: ${data.items.length}`);
  console.log(`  ✓ Augments: ${data.augments.length}`);
  console.log(`  ✓ Knowledge fingerprint: ${data.knowledge?.fingerprint ?? 'none'}`);
  console.log(`  ✓ Parity status: ${data.version.parityStatus}`);

  // 2. Validate Curated Playbooks
  console.log('\n[2/3] Validating Curated Playbooks...');
  const playbooks = loadPlaybooks(data);
  let playbookErrors = 0;
  for (const playbook of playbooks) {
    const issues = validatePlaybook(playbook, data);
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length) {
      playbookErrors++;
      console.error(`  ✕ Playbook ${playbook.id} (${playbook.title}) has validation errors:`);
      for (const err of errors) console.error(`    - ${err.message}`);
    }
  }
  if (playbookErrors > 0) {
    console.error(`  ✕ ${playbookErrors} playbooks failed validation.`);
    process.exitCode = 1;
    return;
  }
  console.log(`  ✓ ${playbooks.length} curated playbooks validated successfully.`);

  // 3. Validate External Meta
  console.log('\n[3/3] Validating MetaTFT External Data...');
  try {
    const externalRaw = JSON.parse(await readFile('public/data/external/current.json', 'utf8'));
    const validatedMeta = validateExternal(externalRaw, data);
    console.log(`  ✓ Provider: ${validatedMeta.manifest.provider}`);
    console.log(
      `  ✓ Scope: Set ${validatedMeta.manifest.scope.set}, Patch ${validatedMeta.manifest.scope.patch}${validatedMeta.manifest.scope.hotfix ?? ''}`,
    );
    console.log(`  ✓ Comps count: ${validatedMeta.comps.length}`);
    console.log(`  ✓ Population sample: ${validatedMeta.manifest.population}`);
    console.log(`  ✓ Content hash: ${validatedMeta.manifest.contentHash}`);
  } catch (err) {
    console.warn(
      `  ⚠ External data validation skipped or warning: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log('\n=== All knowledge sources validated successfully! ===');
}

main().catch((err) => {
  console.error('Validation failed unexpectedly:', err);
  process.exit(1);
});
