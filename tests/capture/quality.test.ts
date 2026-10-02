import { test, expect } from "vitest";
import { getAdapter } from "../../src/main/capture/adapters/types";
import { inspectQuality } from "../../src/main/capture/quality";
import type { Source } from "../../src/shared/contracts";
const source: Source = {
  id: "s",
  entryUrl: "https://example.com/",
  allowedOrigins: ["https://example.com"],
  adapterId: "generic",
  label: "Example",
};
function extract(body: string) {
  return getAdapter(source).extract(
    {
      html: `<article><h1>标题</h1>${body}</article>`,
      finalUrl: source.entryUrl,
      statusCode: 200,
      fetchedAt: new Date().toISOString(),
    },
    {
      sourceId: source.id,
      canonicalUrl: source.entryUrl,
      title: "标题",
      sectionPath: [],
    },
  );
}
test("checks source HTML empty code and malformed images even when Markdown omits them", () => {
  const a = extract(
    '<p>登录后查看全文</p><pre><code></code></pre><img><img src="data:image/png;base64,abc">',
  );
  const q = inspectQuality(a, 1);
  expect(q.codeBlocks).toBe(1);
  expect(q.issues.map((i) => i.code)).toEqual([
    "short-text",
    "login-prompt",
    "empty-code",
    "missing-images",
  ]);
  expect(q.issues.at(-1)?.message).toContain("3 张图片");
});
test("normal long article and code pass; link-heavy navigation is advisory and unchanged", () => {
  const a = extract(
    `<p>${"数据库持久化。".repeat(50)}</p><pre><code class="language-java">int a = 1;</code></pre>`,
  );
  const original = a.markdown;
  expect(inspectQuality(a).issues).toEqual([]);
  expect(a.markdown).toBe(original);
  const nav = extract(
    Array.from({ length: 14 }, (_, i) => `<a href="/${i}">目录${i}</a>`).join(
      " ",
    ),
  );
  expect(inspectQuality(nav).issues.map((i) => i.code)).toContain("link-heavy");
});
