# Parse design direction

Read this before touching any screen. It replaces every earlier visual direction
(the cyanotype and the dark obsidian passes). `CLAUDE.md` still owns the rules
for money, safety and data.

## North star

Marketing first, information second. Every screen sells one idea in one
sentence, then proves it with a real object moving on screen. Nobody reads
insurance; they watch it happen to a card, a receipt, a letter.

## What the references teach, and where we use it

| Reference | The technique | Where it goes in Parse |
|---|---|---|
| Ramp | One physical object (their card) travels through every scene, and each scene has smaller animations inside it: an invoice building line by line, a chat bubble popping, a receipt attaching | Your insurance card is our traveling object. It is the hero, it flips to show your four numbers, it drops into the receipt, it slides into the plan comparison |
| Ramp | Card titles: bold noun in ink, the rest in gray. "**Banking** that flows money to the highest return" | Every feature card title |
| Ramp | A live ticker strip at the bottom of the hero | "Parse, today" strip with honest numbers only (see below) |
| Ramp | The AI prompt box *is* the call to action | The PDF dropzone and the Ask bar are the CTAs; no "Get started" buttons |
| Oura | Two-word serif statements with periods. "Subtle. Power." A stat as the whole headline | Hero and section statements |
| Oura | Warm cream, not white. Photography and objects carry the color | Base palette |
| Alan | A mascot in a health insurance brand, and a Before / With toggle | The sphere is our mascot; "Your plan / A better plan" toggle in Compare |
| Mono | Scroll-pinned hero: huge word behind, the image expands into a bento | Landing: "PLAINLY" behind the sphere, which splits into the room tiles on scroll |
| Mono | One scene crossfading dawn, day, dusk, night as you scroll | The stress test: the sky behind the receipt moves January to December, getting darker as bills pile up |
| Mono | Words blurring in one by one as you scroll | Used once only: the manifesto line under the hero |
| Paper shaders (GrainGradient) | A grainy, film-like WebGL gradient | The sphere itself, shape "sphere", greens and mint. Needs `@paper-design/shaders-react` (ask Adi before adding) |
| Kokonut action search bar | Command bar with staggered suggestions that expand below | Ask: "Ask about a bill, a denial, a deductible" with suggested questions |

## Palette: "Clinic garden"

Warm light by default, one deep forest night section for drama.

| Token | Value | Use |
|---|---|---|
| ivory | `#F6F4EE` | Page |
| paper | `#FCFBF8` | Cards, the receipt |
| ink | `#0F2A1F` | Text, primary buttons |
| stone | `#6B7A72` | Secondary text |
| line | `rgb(15 42 31 / 0.08)` | Hairlines |
| moss | `#1F6B47` | The plan pays, "in network", good outcomes |
| mint | `#8FE0B5` | Sphere highlights, focus rings |
| sage | `#DCEBDF` | Soft fills, selected states |
| coral | `#EE6A4C` | Money leaving your pocket, and nothing else |
| night | `#07140E` | The dark section and the human handoff card |

Type: Instrument Serif for statements (Oura), Geist Sans for everything else,
Geist Mono tabular for every number. Display tracking -0.03em, body 0.

## Title grammar

1. **A statement, not a label.** "Denied." beats "Claim denial assistant".
2. **Two beats.** Setup, then the turn. "Your plan covers you. Eventually."
3. **Bold the noun, gray the promise.** "**Ambulances** your state forgot to cover"
4. **A number can be the headline.** "1 in 5 claims gets denied. Under 1% get appealed."
5. **Subtitles are one line**, specific, and never restate the title.
6. **Never** "built for", "all in one place", "powered by AI", "seamless", "unlock".
7. The sphere's sentence *is* the heading of each room. No eyebrow, headline and paragraph stacks.

## Voice

A deadpan actuary who has read every insurance contract and emerged tired. The
Office and Silicon Valley, not a meme page. Jokes land on the system, never on
the user's body, illness or bill. Short. It never gives medical advice.

Line bank:
- "Hello. I read insurance documents so you don't have to. It's a living."
- "Found your deductible. It was on page 4. They always hide it on page 4."
- "Good news: you hit your out-of-pocket max. From here, your plan pays. I'd celebrate, but I'm an actuary."
- "This clinic is out of network. That's insurance for 'good luck'."
- "I do math, not medicine. If something hurts, call 911 or your nurse line."

## Motion map: one signature per surface, never repeated

| Surface | Signature motion |
|---|---|
| Landing | Grain sphere breathing, its one-line face; pinned scroll splits it into room tiles |
| Manifesto line | Scroll blur-in, word by word (the only place) |
| Insurance card | Shared-element travel between rooms; flip on decode |
| PDF drop | Card flip plus a scan line; status lines swap with a vertical blur |
| Decoded numbers | Number roll (the only count-up in the app) |
| Stress test | Receipt prints line by line; sky crossfades month to month; stamp at the ceiling |
| Compare | Before / With toggle; rows reorder with FLIP |
| Ambulance | A dial you spin to see which company showed up |
| Denied | Highlighter strike-through on jargon, then the appeal letter types itself |
| Ask | Command bar; suggestions cascade in below |
| Find care | Pins drop onto the map; route line draws to the selected place |
| Human handoff | The card inverts to night and lifts; everything else dims |

Rules from the skills still apply: press 0.96, ease-out under 300ms for UI,
springs without bounce unless something was thrown, animate transform, opacity and
filter only, reduced motion becomes cross-fades.

## The "Parse, today" strip

Only true numbers: 43 Missouri plans loaded, 23 states with ambulance
protections, 1 in 5 marketplace claims denied (KFF), under 1% appealed (KFF),
your year so far. No invented usage counts.

## The 2-minute demo

1. 0:00 Sphere intro, drop a Summary of Benefits, card flips to four numbers, one marked "this one hurts".
2. 0:30 Tap "Torn ACL": receipt prints, sky darkens, stamp lands at the ceiling.
3. 1:10 "Could you do better?" Three questions, three plans, worst case first, Before / With toggle.
4. 1:40 Montage: ambulance dial, letter translation, the night handoff card.
