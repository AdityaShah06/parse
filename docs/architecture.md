# Architecture

Parse is a Next.js App Router application. The browser renders the interface and runs the cost engine locally; server routes hold every API key and talk to Gemini, ElevenLabs, Google Maps Platform and CMS. The design rule behind everything below: **models read and route; code computes.**

```
Browser                                   Server (Next.js route handlers)
───────────────────────────────           ─────────────────────────────────────────────
components/parse/*   ── rooms             /api/decode-plan     PDF → Gemini → schema-checked plan
lib/engine.ts        ── all money         /api/plan-explain    engine facts → Gemini → guarded prose
lib/care.ts, year.ts ── visit and year    /api/agent           question → Gemini tools → engine
                        pricing           /api/places, network Google Places + CMS provider directory
                                          /api/marketplace/... CMS Marketplace API (plans, premiums)
                                          /api/rx, drug-coverage  NADAC, Cost Plus, formularies
                                          /api/speak           ElevenLabs, cached MP3
                                          lib/server-cache.ts  memory + disk cache, daily budgets
                                          lib/rate-limit.ts    per-visitor limits
```

## The cost engine

`lib/engine.ts` applies care events to an accumulator in date order. For each event:

1. Preventive care is free and touches nothing.
2. If the benefit's cost sharing applies after the deductible, the allowed amount goes to the remaining deductible first; cost sharing applies to the remainder.
3. Copays may be per visit, per day (capped at a maximum number of days) or per stay. Coinsurance may carry a per-event maximum ("10% up to $50").
4. The patient's share is clamped to the remaining out-of-pocket room. When the clamp bites, the cost share is reduced before the deductible credit.
5. Balance bills are added on top and never count toward the out-of-pocket maximum.

$$
\text{you pay} = \min\Big(\min(A, D) + \min\big(c\,(A - \min(A, D)),\ \text{cap}\big),\ M\Big) + B
$$

`runYear` folds a list of events through this function; `visitCost` answers "what would one more visit cost today, given everything already this year". `rankPlans` runs the same year through many plans.

The engine is pure TypeScript with no I/O, so it runs identically in the browser, on the server for the agent's tools, and in tests.

## Reading CMS cost-sharing data

The CMS public use files describe cost sharing as text. `lib/parse-cost-share.ts` is a small grammar for those strings, and `lib/load-plans.ts` turns public-use-file rows into engine plans. The traps it handles, each covered by tests:

| In the file | What it actually means |
|---|---|
| `"20.00% Coinsurance after deductible"` | Coinsurance, deductible applies |
| `"20.00%"` | Coinsurance with the deductible **waived** |
| `"$30 Copay after deductible"` / `"$30"` | Copay after the deductible / from the first dollar |
| `"No Charge after deductible"` in the copay column, coinsurance `"Not Applicable"` | Covered at $0 after the deductible, not an exclusion |
| Blank `InpatientCopaymentMaximumDays` | Casts to 0, which means *uncapped*, not free |
| `PlanId` with a variant suffix | Rates join on `StandardComponentId`; filtering to the standard on-exchange variant avoids one row per cost-sharing reduction |
| Tobacco rating columns | Encoded differently by issuer; filtering to one convention drops most plans |

`data-raw/extract.sql` produces the 43-plan Missouri slice in `app/data/mo-plans.json`.

## The AI boundary

`lib/llm.ts` is a minimal Gemini client over `fetch`. It finds a model the key can use at startup and, when a model answers with a capacity or rate-limit error, retries the same request on the next model in a fallback list, keeping a model that rescued a request for a minute so a conversation stays on one model.

| Use | Guardrails |
|---|---|
| **Plan decoding** (`/api/decode-plan`) | JSON schema; each value returns with its quote and page; `lib/decode.ts` re-validates types and ranges and rejects rows missing the number their kind needs. Per-fill caps are read from the printed text with a regex, not from the model. |
| **Explanations** (`/api/plan-explain`) | The model receives only facts the engine already computed. Any sentence containing a number that is not in those facts is removed. |
| **Agent** (`lib/agent.ts`) | Function calling over five tools. Cost answers come from tool output; the same numbers guard runs over the final text. Crisis and medical-advice questions are intercepted before the model call. |
| **Denial letters** (`/api/decode-denial`) | Schema-checked extraction and classification. Deadlines, routing and the appeal letter are deterministic templates in `lib/denial.ts`. |

## Prices

`lib/prices.ts` loads `data/local-prices.json`, built by `scripts/build-local-prices.mjs` from MU Health Care's standard charges file: commercial contracts only, reporting the median with the 25th and 75th percentiles. When the plan's insurer has its own contract, `applyPayer` swaps in that insurer's rates. Physician fees use the 2026 Medicare Physician Fee Schedule multiplied by RAND's measured commercial markup.

## External services, caching and cost control

Every paid call goes through three layers:

1. **Cache** (`lib/server-cache.ts`): an in-memory map backed by files in `.cache/` (or the OS temp directory on serverless hosts). Place searches, plan lookups, explanations and synthesized audio are cached, so repeated demos cost nothing.
2. **Daily budgets** (`spend`): a named daily cap per service (Places, Gemini agent turns, ElevenLabs characters, CMS lookups).
3. **Per-visitor limits** (`lib/rate-limit.ts`): per-minute and per-day limits per route group, keyed by a hash of the visitor's IP.

Budgets and limits are counted in Upstash Redis when it is configured (`lib/shared-store.ts`, plain REST), so they hold across serverless instances, and fall back to local counters otherwise.

## Knowledge base

`lib/kb/` holds small, cited datasets used across rooms: state ambulance protections, claim denial and appeal statistics by insurer, drug discount programs, insurer contacts, the people to call for each kind of problem, and a checked FAQ. Each entry carries its source.

## Testing

Vitest covers the engine (hand-computed expectations), the cost-share grammar, plan loading, decoding and sanitizing, the agent's tools and numbers guard, the guide's crisis and medical screens, pricing, ranking, the Marketplace, Places and NPI clients against recorded fixtures, and the appeal data. Run `npm test` from `app/`.
