# Build plan: TigerHacks 2026

Solo build, duct tape allowed. Stand up every screen with working flow first, mock
data where the real source is not wired yet, then swap mocks for real data one by
one. Every Claude session (this chat or Claude Code in VS Code) reads this file and
`CLAUDE.md` first, takes the next open task, and marks it done here.

## What it is, in one breath

A guide that takes the health plan you already have (usually a parent's or an
employer's), decodes it, shows what your year will cost, finds care near you, helps
when a claim gets denied, and sorts out the money around it: family, taxes,
ambulances. Every path ends at a real person you can call.

## Who it is for

53.5% of Americans had employment-based coverage in 2025 (Census). About 80% of
students 18 to 25 with private coverage are on someone else's plan (GAO, 2022 data).
67% of covered workers are in self-funded employer plans (KFF 2025), which state
insurance laws usually do not reach.

## The rooms

The guide stays on the left the whole time. The right side is the stage, and it
changes room as you move through the path.

| # | Room | What it does | Status | Data now | Data later |
|---|---|---|---|---|---|
| 1 | Welcome | ZIP, whose plan | Built | Real | |
| 2 | Decode my plan | PDF of the Summary of Benefits, or card numbers, or sample | Built | Gemini + sample | |
| 3 | My year | Who pays, the bar, the surprise slider, three futures | Built, futures to add | Real engine, placeholder prices | Sourced prices |
| 4 | Find care | Map of providers, rating, review summary, in-network, cost per visit on your plan | To build | **Mock providers, labeled** | NPI Registry + Google Places + Marketplace API |
| 5 | Ask the guide | Free-text questions. Refuses medical advice, routes to people | To build | Gemini | |
| 6 | Denied? | Upload an EOB or denial letter: paperwork or real denial, deadline, appeal letter, who to call | To build | Gemini + sample letter | |
| 7 | Family | Spouse and kids: which tier, or spouse keeps their own plan | To build | Mock premiums you type | Engine family deductible, tested |
| 8 | Taxes | HSA savings, subsidy clawback check, which 1095 form, free VITA help | To build | Mock, needs rubric | IRS figures |
| 9 | Ambulance | State map plus the self-funded caveat | To build | Mock state list, labeled | Commonwealth Fund, each state checked |
| 10 | Compare plans | Every Missouri marketplace plan ranked by your year | Built | Real | Real premiums by age |

## Rules that do not bend

- Dollars come only from `lib/engine.ts`. The AI never writes a dollar figure.
- Anything mocked carries a visible "Sample data" badge until it is real. Nothing
  fake ever claims a real clinic is in network.
- AI output is confirmed by the user before it touches the math.
- The guide gives no medical advice and refuses when asked. Every answer ends with a
  person: nurse line, doctor, billing office, appeals team, Missouri DCI or the U.S.
  Department of Labor, VITA, 911, 988.
- The demo must work with the wifi off: every AI and API feature has a sample path.
- No em dashes. Ask before adding a dependency.

## Who writes code

One writer at a time. The Cowork chat builds and screenshots, then ships files into
this folder. Claude Code in VS Code fixes things that need Adi's machine and takes
over if the chat is unavailable. Close any file tab Claude is changing, or turn off
VS Code Auto Save, so a stale editor copy cannot overwrite a delivery.

## Build order

- [x] Engine, parser fix, data, tests
- [x] Rooms 1, 2, 3 (core), 10
- [x] **Shell.** Left guide, right stage, room tabs with transitions
- [ ] **Room 4 Find care** on mock providers, with the map
- [ ] **Room 5 Ask the guide** with the refusal layer and refusal tests
- [x] **Room 6 Denied?** example letter, deadline, who to call, appeal letter
- [x] **Rx and tests** cash vs plan over the whole year, sample prices
- [x] **Five doors**: employer, marketplace, student, Medicaid, uninsured
- [ ] **Room 9 Ambulance** on a mock state list
- [ ] **Room 7 Family** and **Room 8 Taxes** on mock numbers
- [ ] **Room 3** three futures
- [ ] Swap mocks for real data, in this order: providers, ambulance states, prices, taxes
- [ ] Design pass: the Rolls-Royce one
- [ ] Ship checklist: Vercel, phone test, backup recording, interviews, Devpost with
      every AI tool cited, domain, three timed rehearsals
