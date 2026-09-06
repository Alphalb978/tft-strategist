# M10 Addendum — V1 Must-Have Integrations and Efficient Visual Validation

This addendum is part of M10 and is high authority alongside `M10_V1_PRODUCT_POLISH_HARDENING.md` and `M10_THEME_CUSTOMIZATION_ADDENDUM.md`.

## 1. Do not waste M10 on failed host desktop-capture tooling

The current Codex host has already failed to capture the native app/Edge reliably. Do not debug that environment as part of M10.

For visual acceptance, use the proven repository path:
- deterministic browser/Playwright fixture states;
- Playwright screenshots at 1440, 1000 and 860 px;
- normal source inspection;
- supplied human screenshots when available.

Do not spend milestone time troubleshooting Windows capture APIs, Edge blank captures, native-window accessibility, or Computer Use rendering. This changes the validation mechanism, not the visual-quality bar. Iterate on screenshots until the same professional acceptance standard is met.

## 2. Automatic current-lobby opponent discovery is a V1 usability requirement

M3 already has the official `spectator-tft-v5` current-game provider boundary and manual identity fallback. V1 should not require the user to manually type seven opponent Riot IDs on supported platforms when the official Riot current-game response can supply participants.

Implement/finish a polished automatic flow using only documented/public Riot APIs:
1. resolve/use the configured own-account PUUID and platform;
2. call the official TFT spectator current-game endpoint on supported platforms;
3. normalize returned participants;
4. identify and exclude the configured own account by PUUID;
5. obtain the other participants from the response without protected-process access;
6. feed those identities/PUUIDs into the existing M3/M4 history, caching, dedupe, partial-result and lobby-pressure pipeline rather than creating a parallel scanner;
7. preserve manual seven-opponent input as fallback when spectator discovery is unsupported/unavailable;
8. make no-current-game, unsupported-route, missing-key, partial-discovery, duplicate/self and transient-failure states explicit and polished;
9. never persist or expose `RIOT_API_KEY`.

The desired user experience is approximately: configure own Riot ID once -> when a supported current TFT game is discoverable, one action (or a safe bounded automatic refresh if already architecturally appropriate) discovers the seven other participants and scans them without manual entry.

Do not use LCU/private client IPC, process memory, packet interception, screen OCR, injection, or proprietary companion internals for identity discovery.

### Riot policy boundary

Keep technical capability separate from Riot product-policy compliance. Current Riot TFT policy restricts displaying opponent/lobby scouting information during gameplay/loading. Do not claim that automatic spectator discovery makes such display policy-compliant. Preserve an explicit product-policy note/guard in the release report and UI where appropriate. Do not bypass Riot restrictions or hidden-player protections.

## 3. Copy Team Code / Team Planner is a V1 priority, not a cosmetic afterthought

The human considers `Copy Team Code` important for V1. M10 should make a serious bounded verification/implementation pass using directly inspectable public evidence before leaving the feature disabled.

Use only public/inspectable evidence such as Riot/CommunityDragon team-planner data and independently inspectable open-source format evidence. Do not reverse engineer proprietary companion binaries, protected Riot processes, private IPC/auth, or hidden client state.

Target current Set 18 only.

### Required implementation work

- audit the current Set 18 team-planner dataset and map eligible Set 18 units to the planner IDs/codes actually supplied by public data;
- verify the current Set 18 code version/prefix, field widths, slot count/order semantics and set suffix from independent evidence rather than guessing;
- implement a deterministic encoder/decoder or support contract behind the existing Team Planner boundary;
- reject unsupported/ambiguous units and never invent missing IDs or positions;
- add known-good independent fixtures that do more than self-round-trip;
- expose a polished `Copy Team Code` action in playbooks/Active Plan only when the current target roster can be encoded truthfully;
- copying a code must not imply verified positioning if only roster semantics are encoded;
- keep Lux/multi-form or other same-ID ambiguities explicit if public data cannot preserve the variant;
- add focused unit/integration/Playwright coverage.

### Human client verification gate

A real current TFT-client paste remains the final acceptance gate for enabling the feature as verified. M10 should prepare the exact candidate code(s) and a concise human check procedure if automated tooling cannot paste into the Riot client.

Do not disable the entire implementation merely because Codex cannot interact with the real client. Instead:
- complete the public-data audit, codec, fixtures and UI support;
- mark the final support state `Awaiting client paste verification` if that is the only missing gate;
- provide at least one current Set 18 candidate code and the expected roster for the human to paste/check;
- once the human confirms the imported roster matches, the verified gate can be flipped with a bounded follow-up change.

If independent public format/ID evidence itself is still insufficient, keep `Copy Team Code` disabled and document exactly what evidence is missing. Do not guess.

## 4. M10 completion/report additions

`docs/M10_V1_RELEASE_REPORT.md` must additionally document:
- automatic spectator-based opponent discovery behavior, supported/unsupported routes, fallback and failure states;
- the Riot policy boundary for opponent/lobby scouting;
- Set 18 Team Planner data source and audited ID coverage;
- exact codec/version/slot/set-suffix evidence;
- independent fixture status;
- human real-client paste-verification status;
- whether `Copy Team Code` ships enabled, awaits only human paste verification, or remains unavailable with a precise reason;
- confirmation that failed Codex host desktop-capture tooling was not debugged and browser/Playwright screenshots were used for visual iteration instead.
