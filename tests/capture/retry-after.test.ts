import { test, expect } from "vitest";
import { parseRetryAfter } from "../../src/main/capture/retry-after";
test("parses both server delta seconds and HTTP dates without truncating the delay", () => {
  const now = Date.parse("2026-09-30T00:00:00Z");
  expect(parseRetryAfter("120", now)).toBe(120000);
  expect(parseRetryAfter("Wed, 30 Sep 2026 00:02:00 GMT", now)).toBe(120000);
  expect(parseRetryAfter("invalid", now)).toBe(0);
  expect(parseRetryAfter(null, now)).toBe(0);
});
