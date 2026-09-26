# What you'd actually pay

A web app that answers one question: if this happens to me, what do I actually pay?
Deterministic cost engine over CMS 2026 marketplace data, Next.js front end. The
target user is a college student on a parent's plan who has never read their coverage.

## Working agreement

- Every dollar figure on screen comes from `app/lib/engine.ts`. Components may add
  engine numbers to place a bar segment, but never to print a figure.
- Do not modify `engine.ts` or `parse-cost-share.ts` without showing me the diff and
  a failing test first.
- Ask before adding a dependency.
- No em dashes anywhere, code comments included.
- When a number is estimated rather than verified, say so in the interface.

## Layout

```
app/                    Next.js project root (run npm commands from here)
  app/                  routes, layout, globals.css
  components/           Planner, AccumulatorBar, WhoPaid, PlanTable, EventList
  lib/engine.ts         the cost engine, and the only place money is computed
  lib/parse-cost-share.ts   grammar for the PUF cost-sharing strings
  lib/load-plans.ts     PUF rows to engine Plan objects
  lib/catalog.ts        the 43 plans, loaded once, plus usd() formatting
  lib/prices.ts         representative service prices. Most are placeholders.
  lib/scenarios.ts      personas and the ladder of unexpected care
  data/mo-plans.json    output of extract.sql, checked in (160 KB)
data-raw/               the three CMS CSVs and extract.sql. CSVs are not in git.
```

## Commands

```
npm run dev        http://localhost:3000
npm test           vitest, 17 tests
npm run typecheck  tsc --noEmit
npm run build      production build
```

## Stack

Next.js 16 (app router), React 19, Tailwind v4 (no config file, tokens live in
`app/globals.css` under `@theme`), framer-motion for the bar springs and the FLIP
table reorder, vitest. Fonts come from `next/font/google`, so the first build needs
network access.

## Data traps, all handled, do not undo

1. Cost sharing is text, not numbers: `"20.00% Coinsurance after deductible"`.
2. A bare percentage waives the deductible. `"20.00%"` bills from the first dollar.
3. Inpatient copays are per day or per stay, capped by `InpatientCopaymentMaximumDays`.
4. Blank numeric cells cast to zero. A zero day cap means uncapped, not free.
5. Booleans are Yes/No strings.
6. Rates join on `StandardComponentId`, not the suffixed `PlanId`.
7. Tobacco encoding varies by issuer. Filtering to one convention drops most plans.
8. Filter to `Standard % On Exchange Plan` or the join fans out per CSR variant.
9. Use the `TEHB*` columns and keep only `MedicalDrugDeductiblesIntegrated = Yes`.
10. `"No Charge after deductible"` can sit in the copay column with coinsurance
    `"Not Applicable"`. That is covered care, not an exclusion. It is what
    `pickCostShare` returns the copay value for, and there is a test.

## Known gaps

- Most prices in `lib/prices.ts` are placeholders. Only the ambulance balance bill
  has a source.
- Premiums in `mo-plans.json` are quoted for a 30-year-old, before any tax credit,
  Boone County. The default selected plan is Catastrophic, which only people under
  30 can buy, so the two disagree.
- `excludedFromMoop` is a property of the care event, not the plan, so it cannot
  vary per plan in a ranking. No Missouri row in the current slice sets it.
- A rate in Rating Area 5 does not prove a plan is sold in Boone County. That needs
  the Service Area PUF.
- The engine models one person, in network, with one combined deductible.

## Keys and external services

All keys live in `app/.env.local`, which git ignores. Never prefix a server key
with `NEXT_PUBLIC_`, and never read one from a client component.

| Variable | What for | Where it runs |
|---|---|---|
| `GEMINI_API_KEY` | Reading plan PDFs, denial letters, the guide | Server routes, via `lib/llm.ts` (plain fetch) |
| `GEMINI_MODEL` | Optional. Pins a model; otherwise `lib/llm.ts` picks the newest Flash the key can use | Server |
| `GOOGLE_PLACES_KEY` | Places API (New): ratings, review summaries | Server only |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Maps JavaScript API, drawing the map | Browser, restricted to allowed websites |
| `CMS_MARKETPLACE_API_KEY` | In-network checks and premiums for marketplace plans | Server |

`node scripts/gemini-check.mjs` and `node scripts/marketplace-probe.mjs` test the
keys. Gemini is only ever asked for JSON matching a schema, and the caller validates
the result again. The AI reads and routes. It never computes money.

The Gemini free tier may use submitted content to improve Google products, so the
demo uses sample denial letters, never a real person's medical documents.
