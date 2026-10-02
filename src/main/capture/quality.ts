import MarkdownIt from "markdown-it";
import type { ExtractedArticle } from "../../shared/contracts";
import type { CaptureQuality } from "../../shared/capture-quality";

const parser = new MarkdownIt({ html: false });
export function inspectQuality(
  article: ExtractedArticle,
  missingImages = 0,
): CaptureQuality {
  const text = article.text.replace(/\s+/g, " ").trim();
  const tokens = parser.parse(article.markdown, {});
  const code = tokens.filter(
    (t) => t.type === "fence" || t.type === "code_block",
  );
  const links = tokens
    .flatMap((t) => t.children ?? [])
    .filter((t) => t.type === "link_open").length;
  const result: CaptureQuality = {
    checkedAt: new Date().toISOString(),
    textLength: text.length,
    codeBlocks: Math.max(code.length, article.extractionStats?.codeBlocks ?? 0),
    issues: [],
  };
  if (text.length < 120)
    result.issues.push({
      code: "short-text",
      message: `正文仅 ${text.length} 字符，可能是短文、导航页或提取不完整，请预览确认。`,
    });
  if (
    /(?:登录|登陆|扫码|订阅|付费|会员).{0,12}(?:阅读|查看全文|解锁|继续访问)|(?:全文|继续阅读).{0,12}(?:登录|订阅|付费)/.test(
      text.slice(0, 2000),
    )
  )
    result.issues.push({
      code: "login-prompt",
      message: "正文含登录或解锁提示，请确认是否已提取完整内容。",
    });
  if (
    article.extractionStats?.emptyCodeBlocks ||
    code.some((t) => !t.content.trim())
  )
    result.issues.push({
      code: "empty-code",
      message: "检测到空代码块，请检查网页是否需要加载或调整提取规则。",
    });
  if (links >= 12 && text.length / links < 45)
    result.issues.push({
      code: "link-heavy",
      message: "链接占比较高，可能混入目录或导航，请检查正文范围。",
    });
  missingImages += article.extractionStats?.missingImageSources ?? 0;
  if (missingImages)
    result.issues.push({
      code: "missing-images",
      message: `${missingImages} 张图片缺少有效地址或未下载，请预览确认并尝试单篇重采。`,
    });
  return result;
}
