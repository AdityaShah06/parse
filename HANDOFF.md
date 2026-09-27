# Plainly: handoff (September 27, 2026)

Read this first. It replaces the older parts of `CLAUDE.md` (its layout section and
test count are out of date; its working rules still apply).

## What Plainly is

A TigerHacks 2026 entry (Mizzou, health theme). It is an AI-forward health insurance
app for a college student on a parent's plan. Upload your plan's Summary of Benefits
(SBC) PDF, or pick a plan, and Plainly:

- reads the plan;
- scores it;
- runs a year of costs through a deterministic engine;
- finds in-network care on Google Maps;
- prices prescriptions without GoodRx;
- shops better HealthCare.gov plans;
- answers questions through a tool-calling agent.

Every path ends at a real person to call.

## Rules that must not be broken

1. Every dollar figure on screen comes from `app/lib/engine.ts` (`runYear`,
   `visitCost`, `eventCost`). AI text never invents numbers: a guard drops any
   sentence whose $ or % values are not in the tool or fact output.
2. Do not modify `lib/engine.ts` or `lib/parse-cost-share.ts` without a diff and a
   failing test shown to the owner first.
3. No em dashes anywhere, including code comments and regex literals. Use the escape `\u2014`
   in code if you must match one.
4. Keys live only in `app/.env.local` (gitignored). Server keys are never prefixed
   `NEXT_PUBLIC_` and never read in client components. Never print key values.
   The only public key is `NEXT_PUBLIC_GOOGLE_MAPS_KEY`, which is referrer
   restricted to the Maps JavaScript API.
5. Ask the owner before adding a dependency.
6. Budgets are real: ElevenLabs has roughly 10,000 credits total, and Google Places
   is billed. Keep the caches and daily caps in `lib/server-cache.ts` on.

## Run it

```
cd app
npm install
npm run dev        # http://localhost:3000
npx vitest run     # 16 files, 158 tests, all passing
npx tsc --noEmit   # clean
```

Windows machine. Not deploying to Vercel. The demo runs locally.

### `app/.env.local` variables (names only)

| Variable | What it is |
| --- | --- |
| `PLAINLY_GEMINI_KEY` | Gemini, AI Studio key (read by `lib/llm.ts`) |
| `ELEVENLABS_API_KEY` | voice, an `sk_` key |
| `CMS_MARKETPLACE_KEY` | marketplace.api.healthcare.gov |
| `GOOGLE_MAPS_KEY` | server only; Places API (New) and Geocoding API |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | browser map; Maps JavaScript API |

Optional variables:

- `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`;
- `ELEVENLABS_DAILY_CHARS` (default 2500);
- `AGENT_DAILY_LIMIT` (default 300);
- `GEMINI_SURFACE`, `GEMINI_MODEL`.

## The Gemini key issue (open, most important)

`/api/llm-check` reported that the server was using a key starting `AIz` with
length 39. The key in `.env.local` starts `AQ.` with length 53. The cause is a
`GEMINI_API_KEY` set in the Windows environment, which overrides `.env.local` in
Next.js. The fix, already applied:

- `lib/llm.ts` reads `PLAINLY_GEMINI_KEY` first;
- the `.env.local` line was renamed to `PLAINLY_GEMINI_KEY`.

To verify, restart `npm run dev` and open `http://localhost:3000/api/llm-check`. It
should say `"ok":true` and show `key: "AQ.... length 53"`.

If it still fails with "API key not valid", the AQ. key itself is rejected. In that
case, create a key at aistudio.google.com/apikey.

Optional cleanup: remove the stale Windows variable in PowerShell with
`[Environment]::SetEnvironmentVariable("GEMINI_API_KEY",$null,"User")` (and
"Machine" if it was set there), then open a new terminal.

## What is built (all in `app/`)

**Rooms.** `components/plainly/Plainly.tsx` is the shell and `Wall.tsx` is the room
menu. Room state lives in `lib/app-state.ts`.

- **Your plan** (`YourPlan.tsx`):
  - an animated SBC document with highlighted fields;
  - a score with parts, pros and cons (`lib/plan-score.ts`);
  - Gemini explanation (`app/api/plan-explain`);
  - a benefit grid with "Find X near you" (`lib/benefits.ts`).
- **Decode / upload** (`Decode.tsx`, `lib/decode.ts`, `app/api/decode-plan`):
  - Gemini reads the PDF: 15 benefit rows, referral, coverage period, exclusions,
    other covered services;
  - a confirm card, then the plan is merged with CMS catalog rows when the name
    matches (`lib/my-plan.ts`).
- **Stress test** (`Stress.tsx`): a year of care events through the engine.
- **Find care** (`FindCare.tsx`, `GMap.tsx`):
  - Google Places search;
  - CMS network check through `lib/network.ts` (`checkPlaces`) and
    `app/api/network`;
  - engine visit cost on each card.
- **Pharmacy** (`Pharmacy.tsx`, `lib/pharmacy.ts`, `app/api/rx`):
  - price sources are the NADAC benchmark, Mark Cuban Cost Plus and
    `lib/kb/rx-programs.ts`;
  - plan formulary check through `/api/drug-coverage`;
  - no GoodRx.
- **Better plan** (`PlanShop.tsx`, `lib/shop.ts`):
  - live HealthCare.gov plans by ZIP, age and income (`app/api/marketplace/plans`);
  - each plan is scored on cost, protection, network, CMS quality stars and the
    2024 claim denial rate;
  - "Make it mine" switches the plan.
- **Ask** (`Agent.tsx`, `lib/agent.ts`, `app/api/agent`):
  - Gemini function calling with the tools `plan_summary`, `what_if`, `find_care`,
    `drug_prices` and `who_to_call`;
  - renders cards;
  - has crisis and medical screens, a numbers guard and a daily cap.
- **Ambulance and Denied**: older rooms, untouched this round (owner will revisit).

**Real data behind the numbers:**

- **Prices** (`lib/prices.ts` from `data/local-prices.json`):
  - MU Health Care standard charges file (dated 2025-12-15), commercial contracts
    only, median with p25 and p75;
  - physician fees are Medicare PFS × 1.84 (RAND 5.1);
  - `applyPayer(issuer)` swaps in that insurer's own MU rates;
  - Ambetter has no MU contract.
- **Denials** (`lib/kb/denials.ts`, `data/denials-2024.slim.json`): CMS Transparency
  in Coverage PUF, 2024 individual QHP, 185 issuers.
- **Plans**: CMS Marketplace API. `getPlan` is required for full benefits, because
  search results omit most of them. Only the 29 HealthCare.gov states are served;
  other states get a redirect to their state marketplace.
- **Offline catalog**: `data/mo-plans.json`, 43 Missouri plans from the 2026 PUFs.

**Voice.** `app/api/speak` (ElevenLabs Flash v2.5) with a disk cache and a daily
character cap, plus `components/plainly/voice.ts`. It falls back to browser speech on
error. `Sphere.tsx` mouths to the audio level.

**Shared infrastructure.** `lib/server-cache.ts` provides a memory and disk cache,
daily budgets and `fetchWithTimeout`. `lib/llm.ts` is the Gemini client (plain
fetch, no SDK).

**Scripts** (`app/scripts`):

- `build-local-prices.mjs` (needs the 1 GB MU CSV in `data/raw`);
- `build-denials.mjs --all`;
- `check-apis.mjs` (pings every API);
- `key-test.mjs`.

## Remaining work, in priority order (demo is today)

1. **Gemini live test.** After the key works, test these on localhost and fix
   anything that breaks:
   - Upload a real SBC PDF. The confirm card should show the extra benefit rows.
   - "Your plan": the AI card fills in and its numbers match the engine.
   - Better plan: the pick's AI explanation appears.
   - Ask: try "What if I need an MRI in March?", "Find urgent care near 65201",
     "How much is sertraline?" and "Who do I call about a denied claim?". Each
     should show tool chips and a card.
2. **Demo script and rehearsal**, about 3 minutes:
   - upload a parent's SBC, then Your plan;
   - Find care, showing the in-network badge;
   - Pharmacy;
   - Better plan;
   - one Ask question with voice on.
   - Have a fallback PDF ready and a backup screen recording.
3. **Mobile and night-mode pass** on the new rooms (Your plan, Find care, Pharmacy,
   Better plan, Ask): check at 390px width and in night mode.
4. **Budget safety before judging.** Confirm the ElevenLabs remaining credits.
   Consider lowering `ELEVENLABS_DAILY_CHARS`. Prefetch and cache the intro lines
   once so the demo replays from disk.
5. **Refresh `CLAUDE.md`** so it matches this file (layout, commands, test count).
6. Later (owner's call): Ambulance and Denied rooms.

## Known gotchas

- The Marketplace API fields differ from its docs:
  - providers use `street1`/`zipcode` and `provider_type` ("Group" means a
    facility);
  - `/providers/covered` returns `{coverage:[...]}`;
  - `/drugs/autocomplete` is a top-level array.
- Network matching strips "Dr", "MD" and similar titles, and has a surname fallback.
  The match threshold is 0.5 and results are limited to 30 miles.
- A0425 ambulance mileage rows are full-trip rates, so they are excluded.
- `next dev` loads env only at startup for some changes. Restart after editing
  `.env.local`.
- Do not run git inside Claude's device VM. It left an undeletable
  `.git/index.lock`; git from Windows is fine.
