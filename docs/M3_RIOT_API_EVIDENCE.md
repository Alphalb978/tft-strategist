# M3 Riot API evidence

Reviewed: 2026-09-06

This record captures the official surface used by M3. Endpoint paths and route families were checked against the current [Riot API reference](https://developer.riotgames.com/apis), [Riot account API](https://developer.riotgames.com/api-details/account-v1), [TFT match API](https://developer.riotgames.com/api-details/tft-match-v1), [TFT spectator API](https://developer.riotgames.com/api-details/spectator-tft-v5), [TFT developer documentation](https://developer.riotgames.com/docs/tft), and [Developer Portal documentation](https://developer.riotgames.com/docs/portal).

## Endpoints used

| Purpose | Official path | Route |
| --- | --- | --- |
| Riot ID to account/PUUID | `GET /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}` | regional account cluster |
| PUUID to display identity | `GET /riot/account/v1/accounts/by-puuid/{puuid}` | regional account cluster |
| Recent TFT match IDs | `GET /tft/match/v1/matches/by-puuid/{puuid}/ids?start={start}&count={count}` | regional match cluster |
| Completed TFT match | `GET /tft/match/v1/matches/{matchId}` | regional match cluster |
| Current TFT game by PUUID | `GET /lol/spectator/tft/v5/active-games/by-puuid/{encryptedPUUID}` | platform cluster |

Path segments are URL encoded. Authentication is sent only as `X-Riot-Token` by the native HTTP adapter.

## Route model

account-v1 currently exposes AMERICAS, ASIA, and EUROPE. tft-match-v1 exposes AMERICAS, ASIA, EUROPE, and SEA. The implementation keeps the account and match route derivations separate for that reason.

| Platforms | Account route | Match route |
| --- | --- | --- |
| BR1, LA1, LA2, NA1 | AMERICAS | AMERICAS |
| JP1, KR | ASIA | ASIA |
| EUN1, EUW1, ME1, RU, TR1 | EUROPE | EUROPE |
| OC1, PH2, SG2, TH2, TW2, VN2 | ASIA | SEA |

The generic TFT routing table and the match-v1 endpoint description are not perfectly aligned: the generic table includes PH2/TH2, while the match-v1 prose lists the other SEA platforms. M3 retains PH2/TH2 as SEA match routes based on the current generic routing table and records this inconsistency rather than hiding it.

The current spectator-tft-v5 reference lists BR1, EUN1, EUW1, JP1, KR, LA1, LA2, ME1, NA1, OC1, RU, SG2, TR1, TW2, and VN2. PH2 and TH2 are therefore explicitly unsupported for current-game discovery until official reference evidence changes.

## DTO evidence retained

The match adapter validates the current `metadata` and `info` envelope and retains match ID, data version, game datetime/length/version, queue/TFT game type/set identifiers, and every participant's PUUID, placement, augments, traits, and units. Units retain character ID, rarity/tier, item names, and unresolved identifiers. Unknown current-set unit, item, augment, or trait IDs are evidence, not silently discarded or fuzzy-mapped.

The current DTO does not establish a repository comp family or a strategic style. M3 therefore does not derive family, reroll, Fast 8, AD/AP, or meta classifications from final boards.

## Rate-limit and failure evidence

Riot responses can provide:

- `X-App-Rate-Limit` and `X-App-Rate-Limit-Count`;
- `X-Method-Rate-Limit` and `X-Method-Rate-Limit-Count`;
- `X-Rate-Limit-Type` on rate-limit responses;
- `Retry-After` on HTTP 429.

The native scheduler observes application and per-method windows, maintains one limiter for the process/API-key session, honors Retry-After and rate-limit type, and applies bounded exponential backoff with jitter for retryable transient failures. It does not encode a claimed production allowance. Validation/auth failures are not automatically retried. Request deadlines and cancellation tokens cover scheduling, sending, and response-body reading.

## Current-game and policy boundary

The official spectator endpoint exposes current-game participant identities on its supported platform routes. M3 uses only that endpoint, excludes the user's PUUID, deduplicates participants, and caps opponents at seven. A 404 is normalized as `not-in-game`; unsupported platforms and safe auth/rate/transient states remain explicit. Manual Riot IDs remain available at all times.

Riot's published policy language restricts certain opponent-history and aggregate assistance during gameplay/loading. Its exact applicability to every private desktop scouting workflow is not unambiguous. This implementation makes no compliance claim: it warns in the UI, performs no automatic protected-client discovery, reads no protected process or traffic, and exposes no live shop/board/bench/gold/augment state or adaptive gameplay prescription.

## Credential lifecycle

The Developer Portal currently describes development keys as temporary and expiring every 24 hours. This is documentation, not application logic. Product/production keys have different approval and limit arrangements; observed response headers, rather than a hard-coded tier assumption, control pacing.
