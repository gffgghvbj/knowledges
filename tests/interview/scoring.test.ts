import { test, expect } from "vitest";
import { parseGrade, dimensionsFor } from "../../src/main/interview/scoring";
const output = (kind: "technical" | "project", scores: number[]) =>
  JSON.stringify({
    dimensions: dimensionsFor(kind).map((d, i) => ({
      name: d.name,
      score: scores[i],
      reason: "Specific answer feedback",
    })),
    omissions: [],
    suggestions: ["Review"],
    referenceAnswer: "Reference",
    uncertainty: "",
    evidenceIds: [],
  });
test("fixed weighted grading rejects invalid values and invented citations", () => {
  expect(
    parseGrade(output("technical", [80, 80, 80]), "technical", []).total,
  ).toBe(80);
  expect(
    parseGrade(output("project", [100, 50, 0, 100]), "project", []).total,
  ).toBe(55);
  expect(() =>
    parseGrade(output("technical", [-1, 80, 80]), "technical", []),
  ).toThrow();
  expect(() =>
    parseGrade(output("technical", [101, 80, 80]), "technical", []),
  ).toThrow();
  expect(() =>
    parseGrade(
      output("technical", [80, 80, 80]).replace(
        '"evidenceIds":[]',
        '"evidenceIds":["fake"]',
      ),
      "technical",
      [],
    ),
  ).toThrow();
});
