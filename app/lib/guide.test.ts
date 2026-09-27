import { describe, expect, it } from "vitest";
import { matchFaq, screen, scrubModelText } from "./guide";
import { FAQ } from "./kb/faq";
import { PEOPLE } from "./kb/people";

describe("guide screen", () => {
  it("sends crisis words to 988 before anything else", () => {
    const a = screen("I want to kill myself, can insurance pay for therapy");
    expect(a?.kind).toBe("crisis");
    expect(a?.people).toContain("crisis");
  });

  it("refuses symptom questions and routes to a nurse line and 911", () => {
    const a = screen("I have chest pain, should I go to urgent care or the ER?");
    expect(a?.kind).toBe("medical");
    expect(a?.people).toEqual(expect.arrayContaining(["emergency", "nurse"]));
  });

  it("answers covered questions from the FAQ", () => {
    expect(screen("Can I stay on my parents plan until 26?")?.kind).toBe("faq");
    expect(matchFaq("does goodrx count toward my deductible")?.id).toBe("cash-deductible");
    expect(matchFaq("what does CO-197 mean")?.id).toBe("prior-auth");
  });

  it("leaves unknown questions for the model", () => {
    expect(screen("what is the capital of france")).toBeNull();
  });

  it("drops model sentences that carry a dollar figure", () => {
    expect(scrubModelText("Your visit is covered. It will cost $40. Call your insurer.")).toBe("Your visit is covered. Call your insurer.");
  });

  it("every FAQ answer routes to a real person and has no em dash", () => {
    for (const f of FAQ) {
      expect(f.people.length).toBeGreaterThan(0);
      for (const id of f.people) expect(PEOPLE[id], `${f.id} -> ${id}`).toBeDefined();
      expect(f.a).not.toMatch(/\u2014/);
    }
  });
});
