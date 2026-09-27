# Parse

**Your health insurance, translated.** Parse answers one question: *if this happens to me, what do I actually pay?*

Drop in your plan's Summary of Benefits and Coverage, or pick a real Missouri marketplace plan, and Parse reads it, runs a year of real-world care through a deterministic cost engine, finds in-network care near you, prices prescriptions, shops better plans, and helps you fight a denied claim. Every path ends at a real person to call.

**Live:** [parse-ochre.vercel.app](https://parse-ochre.vercel.app) · Built by Aditya Shah for TigerHacks 2026 (University of Missouri).

---

## Why

Most college students on a parent's plan have never read it. The answers are in a ten-page PDF written in a dialect that sounds like English and behaves like tax law. Meanwhile, HealthCare.gov insurers denied **76.6 million** in-network claims in 2024, people appealed **0.33%** of them, and **about one in three** appeals won. Parse is built to close that gap.

## What it does

| Room | What you get |
|---|---|
| **Your plan** | Upload an SBC PDF. Gemini extracts the deductible, coinsurance, out-of-pocket max and every benefit row, each with the quote and page it came from. A computed plan score, and a plain-language read of how the plan behaves. |
| **Stress test** | A year of care (a torn ACL, therapy, an ER visit) run event by event, in date order, until the out-of-pocket max stops the bleeding. |
| **Find care** | Nearby providers from Google Places, checked against the federal marketplace provider directory, with the cost of one visit on your plan. |
| **Pharmacy** | Your plan's price for a drug next to Cost Plus Drugs, discount generic lists and the NADAC benchmark, plus a formulary check. |
| **Better plan** | Every HealthCare.gov plan for your ZIP, ranked on a normal year *and* a bad year, quality stars and each insurer's claim denial rate. |
| **Ambulance** | One ride, four endings: in network, protected by state law, a self-funded employer plan state law can't reach, and Missouri, where nothing stops the surprise bill. |
| **Denied** | Your insurer's real 2024 appeal record, a line-by-line translation of the denial letter, and an appeal letter drafted from it. |
| **Ask** | A tool-calling agent. "What if I need an MRI in March?" runs the MRI through your plan instead of guessing. |

## How it works

### A deterministic cost engine

`app/lib/engine.ts` is the only code allowed to compute money. For a care event with allowed amount $A$, remaining deductible $D$, coinsurance rate $c$, remaining out-of-pocket room $M$ and balance bill $B$:

$$
\text{you pay} = \min\Big(\min(A, D) + c\,\big(A - \min(A, D)\big),\ M\Big) + B
$$

Events run in date order against a shared accumulator. Copays can skip the deductible, preventive care is free, inpatient copays can be charged per day up to a cap, coinsurance can carry a per-event maximum, and balance bills sit outside the out-of-pocket limit entirely.

### AI that reads, never counts

Gemini is used for three narrow jobs: reading documents (plan PDFs and denial letters), writing plain-language explanations, and routing questions to tools. It never produces a figure the app displays:

- Every model call requests JSON against a schema, and the server validates the result again.
- A numbers guard drops any sentence whose dollar amounts or percentages do not appear in the engine's output or the plan's own facts.
- The agent answers cost questions only by calling tools (`plan_summary`, `what_if`, `find_care`, `drug_prices`, `who_to_call`) that call the engine.
- Crisis and medical-advice questions are screened before the model sees them and routed to people instead.

More detail in [docs/architecture.md](docs/architecture.md).

## Data sources

| Source | Used for |
|---|---|
| CMS 2026 Marketplace public use files | 43 Missouri plans and their cost-sharing rules |
| CMS Marketplace API | Live plans, premiums, provider networks and formularies by ZIP |
| MU Health Care standard charges file | Negotiated prices at the local hospital, by insurer |
| Medicare Physician Fee Schedule × RAND commercial markup | Physician fees |
| CMS Transparency in Coverage public use file | Claim denial and appeal outcomes for 185 insurers (2024 claims) |
| Commonwealth Fund, healthinsurance.org | State ambulance protections and the average ground ambulance surprise bill |
| NADAC (Medicaid.gov), Cost Plus Drugs | Prescription benchmarks and cash prices |
| Google Places, NPI Registry | Providers near you |

Where a number is an average or estimate rather than a quote, the interface says so.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Framer Motion · Vitest · Gemini API · ElevenLabs · Google Maps Platform · Upstash Redis (optional) · Vercel

No SDKs for the external APIs: each is a small typed client over `fetch`, with timeouts, caching and daily budgets.

## Getting started

Requires Node.js 20 or later.

```bash
git clone https://github.com/AdityaShah06/parse.git
cd parse/app
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). The app runs without any keys: the sample plan, the engine, the ambulance game and the sample denial letters all work offline. Keys unlock the live features.

### Environment

Create `app/.env.local`:

| Variable | Needed for | Where it runs |
|---|---|---|
| `PLAINLY_GEMINI_KEY` | Reading PDFs, explanations, Ask | Server |
| `CMS_MARKETPLACE_KEY` | Live plans, networks and formularies | Server |
| `GOOGLE_MAPS_KEY` | Places and geocoding | Server |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Drawing the map (restrict it to your domains) | Browser |
| `ELEVENLABS_API_KEY` | Voice | Server |

Optional: `GEMINI_MODEL`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`, `ELEVENLABS_STABILITY`, `ELEVENLABS_STYLE`, daily budgets such as `AGENT_DAILY_LIMIT` and `ELEVENLABS_DAILY_CHARS`, and per-visitor limits as `RATE_<GROUP>_MIN` / `RATE_<GROUP>_DAY`. With `KV_REST_API_URL` and `KV_REST_API_TOKEN` (Upstash), budgets and rate limits are shared across server instances.

### Scripts

Run from `app/`:

```bash
npm run dev        # development server
npm test           # 168 unit tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

### Deploying

On Vercel, import the repository, set the root directory to `app`, and add the environment variables above. Connect Upstash for Redis from the Vercel Marketplace for shared rate limits.

## Project structure

```
app/
  app/                 routes and API handlers (agent, decode-plan, plan-explain, places, rx, speak, ...)
  components/parse/    the interface, one file per room
  lib/
    engine.ts          the cost engine, the only place money is computed
    parse-cost-share.ts  grammar for CMS cost-sharing strings
    llm.ts             Gemini client with model fallback
    agent.ts           tool-calling agent and its numbers guard
    kb/                cited knowledge: ambulance laws, denials, people to call, FAQ
    ...                marketplace, places, pharmacy, prices, rate limits, caching
  data/                checked-in public data (plans, local prices, denial statistics)
  scripts/             data builders and API checks
data-raw/              the SQL that extracts Missouri plans from the CMS files
docs/                  architecture and design notes
```

## Limitations

- The engine models one person, in network, on a plan with one combined deductible. Family deductibles, separate pharmacy deductibles and out-of-network benefits are out of scope.
- Hospital prices are medians from one health system's price file. Real bills vary.
- Sample denial letters come from a made-up insurer; the denial codes are real.
- Appeal statistics cover individual marketplace plans only. Employer plans don't report them.

Parse does math, not medicine. It is not medical, legal or insurance advice. If something hurts, call 911 or your plan's nurse line.
