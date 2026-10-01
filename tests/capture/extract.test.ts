import { expect, test } from "vitest";
import { getAdapter } from "../../src/main/capture/adapters/types";
import {
  extractionPresets,
  resolveExtractionRule,
} from "../../src/shared/extraction";
import { validateRule } from "../../src/main/capture/adapters/rules";
import MarkdownIt from "markdown-it";
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

const carlUrl = "https://programmercarl.com/hot100/0001.two-sum.html";
const source = {
  id: "s",
  entryUrl: carlUrl,
  allowedOrigins: ["https://programmercarl.com"],
  label: "Carl",
  adapterId: "generic",
};
const candidate = {
  sourceId: "s",
  canonicalUrl: carlUrl,
  title: "fallback",
  sectionPath: [],
};
const snapshot = (html: string) => ({
  html,
  finalUrl: carlUrl,
  fetchedAt: "2026-10-01T00:00:00Z",
  statusCode: 200,
});

test("Carl structure preserves all language blocks and indentation without line numbers or surrounding navigation", () => {
  const languages = ["cpp", "python", "java", "go", "javascript"];
  const codes = languages.map(
    (lang, i) => `// ${lang}\n    return ${i} < 2;\n`,
  );
  const html =
    `<main><nav>Outside noise</nav><div class="theme-default-content"><h1><a class="header-anchor">#</a> 两数之和</h1>` +
    languages
      .map(
        (lang, i) =>
          `<h3>${lang}</h3><div class="language-${lang} line-numbers-mode"><pre class="language-${lang}"><code><span class="token">${codes[i].replaceAll("<", "&lt;")}</span></code></pre><div class="line-numbers-wrapper"><span>1</span><br><span>2</span></div></div>`,
      )
      .join("") +
    '<span class="sr-only">opens new window</span></div><footer>Footer noise</footer></main>';
  const result = getAdapter({
    ...source,
    extraction: { preset: "auto" },
  }).extract(snapshot(html), candidate);
  const fences = new MarkdownIt()
    .parse(result.markdown, {})
    .filter((t) => t.type === "fence");
  expect(fences.map((t) => t.info)).toEqual(languages);
  expect(fences.map((t) => t.content)).toEqual(codes);
  expect(result.markdown).not.toMatch(
    /Outside noise|Footer noise|opens new window|\n1\s*\n2/,
  );
  expect(result.candidate.title).toBe("两数之和");
  expect(
    resolveExtractionRule({
      ...source,
      entryUrl: "https://programmercarl.com.evil.test/",
      extraction: { preset: "auto" },
    }).name,
  ).toBe("通用规则");
});

test("custom rules scope discovery and remove noise while preserving folded content", () => {
  const rule = {
    ...extractionPresets.generic,
    name: "Custom",
    bodySelector: ".lesson",
    titleSelector: "h2",
    linkSelector: ".toc a[href]",
    removeSelectors: [".promo"],
    pathPrefixes: ["/hot100/"],
  };
  const adapter = getAdapter({
    ...source,
    extraction: { preset: "custom", rule },
  });
  const page = snapshot(
    '<div class="toc"><a href="/hot100/a.html">A</a><a href="/algo/">B</a><a href="https://evil.test/hot100/a">C</a></div><a href="/hot100/ignored.html">D</a><div class="lesson"><h2>Title</h2><p class="promo">Remove</p><details><summary>Reason</summary><p>Keep explanation</p></details><script>unsafe()</script></div>',
  );
  expect(adapter.discover(page).map((c) => c.title)).toEqual(["A"]);
  const result = adapter.extract(page, candidate);
  expect(result.markdown).toContain("**Reason**");
  expect(result.markdown).toContain("Keep explanation");
  expect(result.markdown).not.toMatch(/Remove|unsafe/);
  expect(() =>
    adapter.extract(snapshot("<article>Wrong container</article>"), candidate),
  ).toThrow("未识别到正文");
});

test("rule validation rejects invalid selectors and executable or unsupported configuration", () => {
  expect(() =>
    validateRule({ ...extractionPresets.generic, bodySelector: "[" }),
  ).toThrow("CSS");
  expect(() =>
    validateRule({ ...extractionPresets.generic, script: "alert(1)" }),
  ).toThrow();
  expect(() =>
    validateRule({ ...extractionPresets.generic, formatVersion: 999 }),
  ).toThrow();
  expect(() =>
    validateRule({
      ...extractionPresets.generic,
      pathPrefixes: ["https://evil.test"],
    }),
  ).toThrow();
});
