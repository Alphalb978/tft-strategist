# TFT Strategist

A private TFT pre-game desktop companion. The current build includes attributed Set 18 playbooks, a deterministic three-plan portfolio, visible confidence, local Riot/meta/discovery evidence, source-backed match playbooks, and a durable selected-plan session workflow. No runtime LLM or protected game-process access.

## Run

Requires Node 22.12+ (tested with Node 24.15). Install dependencies once:

```powershell
npm ci
npm run dev
```

Open **http://127.0.0.1:1420**. Bundled real static data and art allow startup without external network access. Browser development uses localStorage.

For native Tauri 2, install [Rust MSVC, Visual C++ Build Tools and WebView2](https://v2.tauri.app/start/prerequisites/), then:

```powershell
npm run tauri dev
npm run tauri build -- --no-bundle
```

Stop an existing Vite server before `tauri dev`, which starts its own server on port 1420. The `tauri` wrapper prefers system Cargo and can also use this workstation's isolated M1 installation in ignored `.cache/cargo` and `.cache/rustup`. Native storage is SQLite in Tauri's app configuration directory. No permanent PATH change is needed.

Allow several GB of free disk space for Rust dependencies and build artifacts. On this workstation C: is almost full; the native verification uses `D:\CodexBuildCache\tft-strategist-m1`. Reuse it in PowerShell before native commands:

```powershell
$env:CARGO_TARGET_DIR = 'D:\CodexBuildCache\tft-strategist-m1\target'
$env:TEMP = 'D:\CodexBuildCache\tft-strategist-m1\temp'
$env:TMP = $env:TEMP
```

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:ui
npm run format:check
```

UI tests use installed Microsoft Edge via Playwright. Screenshots go to ignored `artifacts/`. Tests require no Riot credentials or external TFT access; the SQLite test uses Node's `node:sqlite` module.

## Source and refresh

Set 18 / Enchanted Wilds / patch 18.1 was audited against Riot's patch notes on September 6, 2026. The available static export is dated August 29 and predates the August 31 / September 1 hotfix, so combat-value parity is explicitly `known-stale`. Set selection is pinned to a reviewed manifest and mutator, not inferred from the highest set number.

The bundle contains 74 unit records (including Avatar forms), 36 traits, 502 item/special-object definitions, 254 augment definitions, and 57 art assets. Definitions do not imply that every special item is equippable or every augment is enabled on live.

```powershell
# Reproduce the normalized bundle and ensure required art is present.
npm run data:refresh
# Explicitly fetch a new export, then review changed data and provenance.
npm run data:refresh -- --download
```

The UI's **Refresh static source** validates and caches a successful fetch. Failure retains prior data. Locking a plan creates one immutable local session snapshot; current data may refresh independently without rewriting it. Incompatible sessions remain visible as historical/stale snapshots until explicitly switched or ended.

## Current support

- **Playbooks:** four public Mobalytics guide examples, labeled Experimental because the app has no measured outcomes. Boards, stages, role/item directions and broad routes are attributed curation.
- **Scoring:** inputs, risk estimates, contest elasticity, core criticality and optimizer weights are seeded and labeled. Personal influence defaults to 5%, bounded to 5–10%; no history currently means zero adjustment.
- **Match workflow:** one explicit active plan survives navigation and restart, reuses the M7 playbook, persists lightweight stage/Decision Map state, and preserves replaced/ended records for future match reconciliation.
- **Team Planner:** disabled / Unverified. Public candidate format evidence exists, but the audited Set 18 mapping, independent fixture and human client paste remain outstanding. No speculative codes are emitted.
- **Riot:** contracts and a fixture-backed scanner exist. No authenticated provider or live account/lobby connection. No environment variables or API keys are consumed by M1.
- **Rules:** board capacity, occupied slots, Riftbeast 10 capacity, Lux/Elder Dragon counting, normal duplicate counting, shop odds, pools, XP, interest, star copies, item recipes, and current-set references are fixture-backed and validated. Emblems, other conditional capacity exceptions, most live augment statuses, and Team Planner remain unverified.
- **Guidance:** missing stabilization boards, alternatives, substitutes, actionable pivots, precise timing and positioning are explicitly unavailable.
- **Post-game:** typed association and deterministic end-state summary exist; import UI and historical personal modeling are future work.

See the [M2 rule evidence ledger](docs/M2_RULE_EVIDENCE_LEDGER.md), [playbook audit](docs/M2_PLAYBOOK_AUDIT.md), [Riot setup](docs/RIOT_SETUP.md), and [prioritized next tasks](docs/V1_5_BACKLOG.md).

## Core principle

TFT facts are data- and rule-authoritative. Models may implement and explain, but must not invent current-set rules, champion facts, Team Planner encoding, or strategic evidence.
