import { expect, test } from "vitest";
import { getAdapter } from "../../src/main/capture/adapters/types";
import type { Source, PageSnapshot } from "../../src/shared/contracts";
const source: Source = {
  id: "s",
  entryUrl: "https://example.com/start",
  allowedOrigins: ["https://example.com"],
  adapterId: "generic",
  label: "test",
};
const snap = (html: string, statusCode = 200): PageSnapshot => ({
  html,
  finalUrl: source.entryUrl,
  statusCode,
  fetchedAt: "2026-09-30T00:00:00Z",
});
test("discovery deduplicates anchors and tracking links without following other sites", () => {
  const links = getAdapter(source).discover(
    snap(
      '<nav><a href="/redis.html#one">Redis</a><a href="/redis.html?utm_source=a">Redis</a><a href="https://other.com/a">Outside</a><a href="/a.png">image</a></nav>',
    ),
  );
  expect(links.map((l) => l.canonicalUrl)).toEqual([
    "https://example.com/redis.html",
  ]);
});
test("HTTP 200 login form and 401 cannot overwrite article content", () => {
  expect(
    getAdapter(source).classify(snap('<form><input type="password"></form>'))
      .kind,
  ).toBe("login-required");
  expect(getAdapter(source).classify(snap("", 401)).kind).toBe(
    "login-required",
  );
  expect(
    getAdapter(source).classify(snap("<main>Not Found</main>", 404)).kind,
  ).toBe("unavailable");
});
test("known site selectors prefer article body to navigation", () => {
  for (const [adapterId, body] of [
    [
      "xiaolin",
      '<div class="theme-default-content"><h1>Redis</h1><p>面试题内容</p></div>',
    ],
    ["javaguide", "<h1>JVM</h1><div vp-content><p>垃圾回收内容</p></div>"],
  ]) {
    const adapter = getAdapter({ ...source, adapterId });
    expect(adapter.classify(snap(`<nav>菜单</nav>${body}`)).kind).toBe(
      "article",
    );
    expect(
      adapter.extract(snap(`<nav>菜单</nav>${body}`), {
        sourceId: "s",
        canonicalUrl: source.entryUrl,
        title: "x",
        sectionPath: [],
      }).text,
    ).not.toContain("菜单");
  }
});
