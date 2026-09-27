import { describe, expect, it, vi } from "vitest";

const calls: unknown[] = [];
vi.mock("./llm", () => ({
  generateRaw: vi.fn(async (body: { contents: { role: string; parts: { functionResponse?: { response: Record<string, string> } }[] }[] }) => {
    calls.push(body);
    const last = body.contents[body.contents.length - 1];
    const fr = last.parts.find((p) => p.functionResponse);
    if (!fr) return { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "what_if", args: { events: [{ service: "mri", month: 3 }] } } }] } }] };
    const r = fr.functionResponse!.response;
    return { candidates: [{ content: { role: "model", parts: [{ text: `An MRI in March costs you ${r.extraForYou}. Your plan would also cover a spa day for $999.` }] } }] };
  }),
}));

import { guard, runAgent, type AgentContext } from "./agent";
import { CATALOG } from "./catalog";

const ctx: AgentContext = {
  planName: "Test plan",
  issuer: "UnitedHealthcare",
  planType: "EPO",
  hiosId: null,
  zip: "65201",
  kind: "marketplace",
  memberPhone: null,
  plan: CATALOG[0].plan,
  events: [],
};

describe("agent", () => {
  it("runs the engine through a tool call and drops invented numbers", async () => {
    const r = await runAgent(ctx, [], "What would an MRI cost me in March?");
    expect(r.tools).toEqual(["what_if"]);
    expect(r.cards[0].type).toBe("whatif");
    expect(r.text).toMatch(/An MRI in March costs you \$/);
    expect(r.text).not.toMatch(/999/);
  });
  it("guard keeps sourced money and drops the rest", () => {
    expect(guard("You pay $1,200. Also $55 for fun.", '{"youPay":"$1,200"}')).toBe("You pay $1,200.");
    expect(guard("Three visits a year.", "")).toBe("Three visits a year.");
  });
});
