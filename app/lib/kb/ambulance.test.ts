import { describe, expect, it } from "vitest";
import { STATES, stateFromZip, stateLawApplies } from "./ambulance";

describe("ambulance states", () => {
  it("has 50 states plus DC on distinct tiles", () => {
    expect(STATES).toHaveLength(51);
    expect(new Set(STATES.map((s) => `${s.col},${s.row}`)).size).toBe(51);
  });

  it("matches the 23-state list: 19 full, 4 partial", () => {
    expect(STATES.filter((s) => s.status === "protected")).toHaveLength(19);
    expect(STATES.filter((s) => s.status === "partial").map((s) => s.id).sort()).toEqual(["CO", "FL", "MD", "WV"]);
    expect(STATES.find((s) => s.id === "MO")?.status).toBe("none");
  });

  it("never lets a state law reach a self-funded plan", () => {
    expect(stateLawApplies("protected", true)).toBe("no");
    expect(stateLawApplies("protected", false)).toBe("yes");
    expect(stateLawApplies("protected", null)).toBe("depends");
    expect(stateLawApplies("none", false)).toBe("no");
  });

  it("maps Missouri ZIPs to MO", () => {
    expect(stateFromZip("65201")).toBe("MO");
    expect(stateFromZip("63501")).toBe("MO");
    expect(stateFromZip("66044")).toBe("KS");
  });
});
