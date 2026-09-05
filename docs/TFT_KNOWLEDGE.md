# TFT Knowledge & Data Authority

## Principle
The app must understand TFT from structured current-set data and explicit rules. A language model is not a gameplay database.

## Static data sources
Primary working source for active-set static data/assets: CommunityDragon or another explicitly approved current source.

Expected entities:
- champions/units;
- traits;
- items/components/emblems where available;
- augments;
- active set identifiers;
- Team Planner IDs where exposed;
- current visual assets;
- content IDs needed to join completed-match data.

Riot APIs provide account/rank/current-game participant discovery where available and completed TFT match history.

Every ingested payload should record source, fetched-at time, set/patch/version metadata where available, and schema version.

## Domain model
### Champion
At minimum:
- stable internal ID;
- display name;
- cost;
- traits;
- art/icon reference;
- current-set membership;
- optional role metadata such as carry/tank/support only when sourced/curated;
- Team Planner identifier if verified.

### Trait
- stable ID;
- display name;
- active breakpoints/effects represented in versioned rules when required by strategy validation;
- emblem/unique constraints where applicable and verified.

### Item
- stable ID;
- name;
- components/recipe when applicable;
- category;
- current-set availability;
- holder/affinity metadata only when evidence/curation exists.

### Augment
- stable ID;
- name;
- tier/category when sourced;
- explicit trait/special requirements when known;
- strategic tags may be curated, never inferred as authoritative without provenance.

### Board
- target level/unit capacity;
- units;
- optional star targets;
- positions when the playbook intentionally specifies them;
- active trait summary computed by rules;
- source/evidence label.

### Playbook
A playbook is larger than a final comp and should include:
- comp family ID/name;
- evidence label and provenance;
- core units;
- flex units/replacements;
- target carry/tank roles;
- stage boards;
- reroll/level strategy;
- item priorities and acceptable alternatives;
- temporary holders;
- augment branch guidance;
- play/avoid signals;
- Decision Map;
- pivot relationships;
- final board variants such as Standard, Low-Contest, High-Cap;
- Team Planner representation when supported.

## Rules engine responsibilities
Represent only the rules actually needed by product logic, but make them explicit/versioned.

Examples include:
- active set membership;
- legal board size for a target level;
- unique-unit/duplicate constraints where relevant;
- trait counting and breakpoint reachability;
- unit cost;
- shop/pool/XP/economy values only if a recommendation actually depends on them and those values are verified;
- star-upgrade/copy assumptions if used by roll burden;
- set-specific rules/units/emblems only when verified.

Exact current values must not be copied from memory. Add fixtures with provenance.

## Validation
Critical validators should reject or flag:
- units not in the active set;
- impossible unit count for target level;
- nonexistent items/augments;
- claimed trait breakpoint not reached by the actual board;
- duplicate/unique violations where the active rules require them;
- variant that loses a declared required core relationship;
- reroll guidance incompatible with its declared cost/level assumptions;
- Team Planner code generated using an unsupported/unverified format.

Validation does not prove a board is strategically good; it proves it is structurally/legal-data consistent.

## Strategy metadata
Strategic metadata is separate from raw TFT truth.

It can include:
- core-unit importance;
- carry/tank/support roles;
- item compatibility;
- augment compatibility;
- stage-strength estimates;
- roll burden;
- transition cost;
- dependency fragility;
- contest elasticity;
- substitution relationships.

Every such field should be either evidence-derived, explicitly curated, or clearly estimated with confidence/provenance.

## Patch/update behavior
- Never silently combine old-set and current-set entities.
- Version rules and seeded playbooks.
- Invalidate/recompute derived features when source version changes materially.
- Preserve historical completed-match records with their original set/patch metadata.
- If patch identification is uncertain, display that uncertainty rather than presenting stale strategy as current.

## Team Planner
Team Planner is isolated behind a codec/adapter.

Required before `supported=true`:
1. active-set unit ID mapping;
2. at least one known-good source code/fixture;
3. encode/decode or round-trip tests where format permits;
4. manual paste test in the current TFT client.

Until then, UI must say unverified/unavailable rather than emitting a code as if trusted.

## No-invention rule
When an agent encounters a missing exact TFT fact, it must implement the surrounding contract if useful, leave the fact explicitly unverified, and report the gap. Never fill it from model memory just to make tests green.
