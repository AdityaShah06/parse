import { describe, expect, it } from "vitest";
import { findInsurer, INSURERS, type Insurer, type Sourced } from "./kb/insurers";
import {
  ANCHORS,
  DEFAULT_WEIGHTS,
  gradeFor,
  normalize,
  normalizeFactor,
  rankPlans,
  scoreInsurer,
} from "./ranking";

const S = (value: number | null): Sourced<number | null> => ({
  value,
  year: 2024,
  sourceName: "test",
  sourceUrl: "https://example.org",
});

function fake(over: Partial<Record<keyof Insurer["factors"], number | null>> = {}): Insurer {
  const v = (k: keyof Insurer["factors"]) => S(k in over ? (over[k] as number | null) : null);
  return {
    id: "fake",
    name: "Fake Health",
    aliases: [],
    hiosIds: [],
    parent: "Fake",
    markets: ["marketplace-MO"],
    factors: {
      denialRate: v("denialRate"),
      complaintIndexMO: v("complaintIndexMO"),
      mlrRebateMO: v("mlrRebateMO"),
      qrsOverall: v("qrsOverall"),
      priorAuthDenial: v("priorAuthDenial"),
      ncqa: v("ncqa"),
      networkBreadth: v("networkBreadth"),
    },
  };
}

describe("normalize", () => {
  it("anchors denial rate to the published national range, average at 0.5", () => {
    expect(normalizeFactor("denialRate", 3)).toBe(1);
    expect(normalizeFactor("denialRate", 19)).toBe(0.5);
    expect(normalizeFactor("denialRate", 36)).toBe(0);
    expect(normalizeFactor("denialRate", 11)).toBeCloseTo(0.75);
    expect(normalizeFactor("denialRate", 50)).toBe(0); // clamped
    expect(normalizeFactor("denialRate", 1)).toBe(1); // clamped
  });

  it("anchors the complaint index at 100 = average", () => {
    expect(normalizeFactor("complaintIndexMO", 100)).toBe(0.5);
    expect(normalizeFactor("complaintIndexMO", 0)).toBe(1);
    expect(normalizeFactor("complaintIndexMO", 300)).toBe(0);
    expect(normalizeFactor("complaintIndexMO", 200)).toBeCloseTo(0.25);
    expect(normalizeFactor("complaintIndexMO", 50)).toBeCloseTo(0.75);
  });

  it("scores higher-is-better factors upward", () => {
    expect(normalizeFactor("qrsOverall", 5)).toBe(1);
    expect(normalizeFactor("qrsOverall", 3)).toBe(0.5);
    expect(normalizeFactor("qrsOverall", 1)).toBe(0);
    expect(normalizeFactor("networkBreadth", 40)).toBe(0.5);
    expect(normalizeFactor("networkBreadth", 49)).toBeGreaterThan(0.5);
  });

  it("treats an MLR rebate as a flag, not by size", () => {
    expect(normalizeFactor("mlrRebateMO", 3_000_000)).toBe(normalizeFactor("mlrRebateMO", 90_000_000));
    expect(normalizeFactor("mlrRebateMO", 1)).toBeLessThan(normalizeFactor("mlrRebateMO", 0));
  });

  it("does not depend on the other insurers in the list", () => {
    const a = scoreInsurer(fake({ denialRate: 10 }));
    const b = scoreInsurer(fake({ denialRate: 10 }));
    expect(a.score).toBe(b.score);
    expect(normalize(10, ANCHORS.denialRate)).toBe(a.factors[0].normalized);
  });
});

describe("scoreInsurer", () => {
  it("renormalizes over the factors that have data and reports coverage", () => {
    const s = scoreInsurer(fake({ denialRate: 3, complaintIndexMO: 300 }));
    // denial 1.0 at weight 30, complaints 0.0 at weight 20 -> 30/50 = 60
    expect(s.score).toBe(60);
    expect(s.coverage).toBeCloseTo(50 / 100);
    const eff = s.factors.filter((f) => !f.missing).map((f) => f.effectiveWeight);
    expect(eff.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
    expect(s.factors.filter((f) => f.missing).every((f) => f.effectiveWeight === 0)).toBe(true);
    expect(s.coverageNote).toContain("2 of 7");
  });

  it("returns no score, not a made-up one, when nothing is known", () => {
    const s = scoreInsurer(fake());
    expect(s.score).toBeNull();
    expect(s.grade).toBeNull();
    expect(s.coverage).toBe(0);
  });

  it("an all-average insurer scores 50", () => {
    const s = scoreInsurer(
      fake({ denialRate: 19, complaintIndexMO: 100, qrsOverall: 3, ncqa: 3, priorAuthDenial: 18, networkBreadth: 40 }),
    );
    expect(s.score).toBe(50);
    expect(s.grade).toBe("C");
    expect(s.pros).toEqual([]);
    expect(s.cons).toEqual([]);
  });

  it("custom weights change the result and zero weight drops a factor", () => {
    const ins = fake({ denialRate: 3, complaintIndexMO: 300 });
    expect(scoreInsurer(ins, { complaintIndexMO: 0 }).score).toBe(100);
    expect(scoreInsurer(ins, { denialRate: 0 }).score).toBe(0);
  });

  it("builds plain-English pros and cons from the numbers", () => {
    const s = scoreInsurer(fake({ denialRate: 7.5, complaintIndexMO: 280, mlrRebateMO: 87_529_084 }));
    expect(s.pros).toContain("Denies fewer claims than most: 7.5% vs 19% national average");
    expect(s.cons.some((c) => c.startsWith("More complaints to Missouri regulators") && c.includes("280"))).toBe(true);
    expect(s.cons.some((c) => c.includes("$87.5 million"))).toBe(true);
    for (const line of [...s.pros, ...s.cons]) expect(line).not.toMatch(/\u2014/);
  });

  it("says when a figure is for the parent company nationwide", () => {
    const ins = fake({ priorAuthDenial: 25 });
    ins.factors.priorAuthDenial = { ...ins.factors.priorAuthDenial, scope: "parent-national" };
    expect(scoreInsurer(ins).cons[0]).toBe(
      "Turns down more prior authorization requests: 25% vs 18% marketplace average (parent company, nationwide)",
    );
  });

  it("grades on fixed cut points", () => {
    expect(gradeFor(80)).toBe("A");
    expect(gradeFor(65)).toBe("B");
    expect(gradeFor(50)).toBe("C");
    expect(gradeFor(35)).toBe("D");
    expect(gradeFor(34.9)).toBe("F");
  });

  it("scores every real insurer without throwing, within 0..100", () => {
    for (const ins of INSURERS) {
      const s = scoreInsurer(ins);
      if (s.score !== null) {
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100);
      }
      expect(s.factors).toHaveLength(Object.keys(DEFAULT_WEIGHTS).length);
    }
  });

  it("ranks the real Missouri issuers sensibly on the carried-over data", () => {
    const score = (id: string) => scoreInsurer(INSURERS.find((i) => i.id === id)!).score!;
    // Anthem: lowest denial rate; Medica and Oscar: highest denials and complaints.
    expect(score("anthem-mo")).toBeGreaterThan(score("medica"));
    expect(score("anthem-mo")).toBeGreaterThan(score("oscar"));
    expect(score("blue-kc")).toBeGreaterThan(score("oscar"));
  });
});

describe("every figure is sourced", () => {
  it("carries value, year, source name and URL, and nulls carry a reason", () => {
    for (const ins of INSURERS) {
      for (const [key, f] of Object.entries(ins.factors)) {
        if (!f) continue;
        expect(f.sourceName, `${ins.id}.${key}`).toBeTruthy();
        expect(f.sourceUrl, `${ins.id}.${key}`).toMatch(/^https:\/\//);
        if (f.value === null) expect(f.note, `${ins.id}.${key}`).toBeTruthy();
        else expect(f.year, `${ins.id}.${key}`).toBeTypeOf("number");
        expect(JSON.stringify(f)).not.toMatch(/\u2014/);
      }
    }
  });
});

describe("findInsurer", () => {
  const cases: [string, string | null][] = [
    ["UnitedHealthcare", "uhc"],
    ["UHC", "uhc"],
    ["UnitedHealthcare Insurance Company", "uhc"],
    ["Anthem Blue Cross Blue Shield", "anthem-mo"],
    ["Anthem Blue Cross and Blue Shield", "anthem-mo"],
    ["Healthy Alliance Life Insurance Co.", "anthem-mo"],
    ["Blue KC", "blue-kc"],
    ["BlueKC", "blue-kc"],
    ["Blue Cross and Blue Shield of Kansas City", "blue-kc"],
    ["Ambetter", "ambetter-mo"],
    ["Ambetter Health", "ambetter-mo"],
    ["Ambetter from Home State Health", "ambetter-mo"],
    ["Home State Health", "ambetter-mo"],
    ["Celtic Insurance Company", "ambetter-mo"],
    ["Medica", "medica"],
    ["Medica Central Health Plan", "medica"],
    ["Oscar", "oscar"],
    ["Cigna", "cigna"],
    ["Cigna Healthcare", "cigna"],
    ["Aetna", "aetna"],
    ["Cox HealthPlans", "cox"],
    ["95426MO0410021", "uhc"],
    ["32753", "anthem-mo"],
    ["99723MO0010001-01", "ambetter-mo"],
    ["Blue Cross Blue Shield", null], // ambiguous: Anthem or Blue KC
    ["Medical Mutual", null], // "medica" must not match inside "medical"
    ["Kaiser Permanente", null],
    ["", null],
  ];
  it.each(cases)("%s -> %s", (input, id) => {
    expect(findInsurer(input)?.id ?? null).toBe(id);
  });
});

describe("rankPlans", () => {
  const base = { convenience: 0.5 };

  it("puts a cheaper plan first when insurers are the same", () => {
    const r = rankPlans([
      { id: "a", name: "A", issuerName: "UHC", annualCostTypical: 8000, annualCostBad: 12000, ...base },
      { id: "b", name: "B", issuerName: "UHC", annualCostTypical: 6000, annualCostBad: 10000, ...base },
    ]);
    expect(r.map((p) => p.id)).toEqual(["b", "a"]);
    expect(r[0].rank).toBe(1);
    expect(r[0].breakdown.cost.normalized).toBe(1);
  });

  it("lets a better insurer win a near tie on cost, and emphasis shifts the balance", () => {
    const plans = [
      { id: "anthem", name: "Anthem plan", issuerName: "Anthem", annualCostTypical: 6300, annualCostBad: 10300, ...base },
      { id: "medica", name: "Medica plan", issuerName: "Medica", annualCostTypical: 6000, annualCostBad: 10000, ...base },
    ];
    expect(rankPlans(plans, { emphasis: "quality" })[0].id).toBe("anthem");
    expect(rankPlans(plans, { blend: { cost: 100, convenience: 0, insurer: 0 } })[0].id).toBe("medica");
  });

  it("never lets insurer score overwhelm a large cost gap on the cost preset", () => {
    const r = rankPlans(
      [
        { id: "pricey", name: "Pricey", issuerName: "Anthem", annualCostTypical: 14000, annualCostBad: 20000, ...base },
        { id: "cheap", name: "Cheap", issuerName: "Oscar", annualCostTypical: 5000, annualCostBad: 9000, ...base },
      ],
      { emphasis: "cost" },
    );
    expect(r[0].id).toBe("cheap");
  });

  it("drops unknown insurers and missing convenience, and says so", () => {
    const [p] = rankPlans([
      { id: "x", name: "X", issuerName: "Kaiser", annualCostTypical: 5000, annualCostBad: 9000, convenience: null },
    ]);
    expect(p.breakdown.insurer.effectiveWeight).toBe(0);
    expect(p.breakdown.convenience.effectiveWeight).toBe(0);
    expect(p.breakdown.cost.effectiveWeight).toBe(1);
    expect(p.total).toBe(100);
    expect(p.notes.length).toBe(2);
  });

  it("uses riskAversion to blend typical and bad years", () => {
    const [p] = rankPlans(
      [{ id: "x", name: "X", issuerName: "UHC", annualCostTypical: 1000, annualCostBad: 3000, ...base }],
      { riskAversion: 0.5 },
    );
    expect(p.blendedCost).toBe(2000);
  });

  it("scales insurer weight by that insurer's data coverage", () => {
    const [p] = rankPlans([
      { id: "x", name: "X", issuerName: "Cox HealthPlans", annualCostTypical: 5000, annualCostBad: 9000, ...base },
    ]);
    const cov = p.breakdown.insurer.coverage;
    expect(cov).toBeGreaterThan(0);
    expect(cov).toBeLessThan(1);
    expect(p.breakdown.insurer.effectiveWeight).toBeCloseTo((30 * cov) / (55 + 15 + 30 * cov));
  });
});
