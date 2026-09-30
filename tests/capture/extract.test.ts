import { expect, test } from "vitest";
import { getAdapter } from "../../src/main/capture/adapters/types";
test("extracts code, tables and lazy relative images while removing interactive noise", () => {
  const url = "https://example.com/docs/a.html";
  const a = getAdapter({
    id: "s",
    entryUrl: url,
    allowedOrigins: ["https://example.com"],
    label: "x",
    adapterId: "generic",
  }).extract(
    {
      html: '<article><h1>Redis</h1><nav>广告</nav><pre><code class="language-java">return 1;</code></pre><table><thead><tr><th>键</th><th>值</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table><img data-src="../img.png" alt="示意图"><script>alert(1)</script></article>',
      finalUrl: url,
      statusCode: 200,
      fetchedAt: "2026-09-30T00:00:00Z",
    },
    { sourceId: "s", canonicalUrl: url, title: "Redis", sectionPath: ["docs"] },
  );
  expect(a.markdown).toContain("```java");
  expect(a.markdown).toContain("| 键 | 值 |");
  expect(a.assets[0].remoteUrl).toBe("https://example.com/img.png");
  expect(a.markdown).not.toContain("alert(");
  expect(a.text).not.toContain("广告");
});
