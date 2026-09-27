# Agent instructions

Read `HANDOFF.md` first: current state, open issues and the remaining work list.
`CLAUDE.md` has the data traps and working rules (its layout section is older).

Hard rules:
- Every dollar figure comes from `app/lib/engine.ts`. Never let a model invent a number.
- Do not modify `app/lib/engine.ts` or `app/lib/parse-cost-share.ts` without showing the owner a diff and a failing test first.
- No em dashes anywhere, code included.
- Never print, log or commit values from `app/.env.local`. Server keys never get a `NEXT_PUBLIC_` prefix.
- Ask before adding a dependency.
- Run `npx vitest run` and `npx tsc --noEmit` from `app/` before calling anything done.
