import { describe, it, expect } from "vitest";
import { NotADenial, SAMPLE_DENIAL, appealDeadline, appealLetter, daysLeft, sanitizeDenial, whoToCall } from "./denial";

describe("appeal deadline", () => {
  it("is 180 days after the notice", () => {
    // Sep 10 2026 + 180 days: 20 left in Sep, 31 Oct, 30 Nov, 31 Dec,
    // 31 Jan, 28 Feb = 171, so 9 more days into March: Mar 9 2027.
    expect(appealDeadline("2026-09-10")).toBe("2027-03-09");
  });
  it("refuses a date it cannot read", () => {
    expect(appealDeadline("September 10")).toBeNull();
    expect(appealDeadline(null)).toBeNull();
  });
  it("counts days left, including the last day", () => {
    expect(daysLeft("2027-03-09", new Date("2027-03-09T10:00:00Z"))).toBe(1);
    expect(daysLeft("2027-03-09", new Date("2027-03-10T10:00:00Z"))).toBe(0);
  });
});

describe("who to call", () => {
  it("sends paperwork problems to the billing office first", () => {
    expect(whoToCall({ ...SAMPLE_DENIAL, kind: "paperwork" })[0].id).toBe("billing");
  });
  it("routes a self-funded plan to the Department of Labor, not the state", () => {
    const ids = whoToCall({ ...SAMPLE_DENIAL, selfFunded: true }).map((p) => p.id);
    expect(ids).toContain("ebsa");
    expect(ids).not.toContain("moDci");
  });
  it("lists both regulators when funding is unknown", () => {
    const ids = whoToCall({ ...SAMPLE_DENIAL, selfFunded: null }).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["ebsa", "moDci"]));
  });
});

describe("reading a denial", () => {
  it("keeps clean fields and drops malformed ones", () => {
    const d = sanitizeDenial({
      is_denial: true,
      kind: "made_up_kind",
      codes: ["CO-197", 42, "N130"],
      notice_date: "09/10/2026",
      denied: -5,
      billed: 1850,
    });
    expect(d.kind).toBe("unclear");
    expect(d.codes).toEqual(["CO-197", "N130"]);
    expect(d.noticeDate).toBeNull();
    expect(d.denied).toBeNull();
    expect(d.billed).toBe(1850);
  });
  it("rejects a document that is not a denial", () => {
    expect(() => sanitizeDenial({ is_denial: false })).toThrow(NotADenial);
  });
});

describe("the appeal letter", () => {
  it("fills facts from the notice and asks for the claim file", () => {
    const l = appealLetter(SAMPLE_DENIAL, { name: "Maya Patel", memberId: "X123", today: "September 26, 2026" });
    expect(l).toContain("Claim number: EHP-2026-0418273");
    expect(l).toContain("notice dated September 10, 2026");
    expect(l).toContain("copy of my complete claim file");
    expect(l).not.toMatch(/\u2014/);
  });
  it("leaves visible blanks instead of inventing facts", () => {
    const l = appealLetter({ ...SAMPLE_DENIAL, claimNumber: null }, { name: "", memberId: "", today: "x" });
    expect(l).toContain("[Claim number]");
    expect(l).toContain("[Your name]");
  });
});
