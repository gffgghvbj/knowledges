import { resolveExtractionRule } from "../../../shared/extraction";
import { validateRule } from "./rules";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import type {
  Source,
  Candidate,
  PageSnapshot,
  PageResult,
  ExtractedArticle,
} from "../../../shared/contracts";
import { hash, normalizeUrl } from "../../library/files";

export interface SiteAdapter {
  canonicalize(url: string): string;
  classify(snapshot: PageSnapshot): PageResult;
  discover(snapshot: PageSnapshot): Candidate[];
  extract(snapshot: PageSnapshot, candidate: Candidate): ExtractedArticle;
}
export function getAdapter(source: Source): SiteAdapter {
  const rule = validateRule(resolveExtractionRule(source));
  const selector = rule.bodySelector;
  return {
    canonicalize: normalizeUrl,
    classify(snapshot) {
      const { document } = parseHTML(snapshot.html);
      const gateText =
        /(?:扫码|扫描二维码|登录|登陆|会员|订阅|付费|解锁).{0,12}(?:阅读|查看|全文|继续|访问)|(?:阅读|查看).{0,12}(?:登录|登陆|订阅|付费)/;
      const gateElements = [
        ...document.querySelectorAll(
          "h1, [role=dialog], .paywall, .login-wall, .login-required, .subscription-gate",
        ),
      ];
      const body = document.querySelector(selector),
        shortBody = body?.textContent?.trim() || "";
      const gated =
        gateElements.some(
          (el) =>
            !el.hasAttribute("hidden") && gateText.test(el.textContent || ""),
        ) ||
        (shortBody.length < 600 && gateText.test(shortBody));
      if (
        gated ||
        [401, 403].includes(snapshot.statusCode) ||
        document.querySelector("input[type=password]") ||
        /\/(login|signin)(\/|\?|$)/i.test(snapshot.finalUrl)
      )
        return { kind: "login-required" };
      if (snapshot.statusCode >= 400)
        return {
          kind: "unavailable",
          reason: `HTTP ${snapshot.statusCode}`,
          statusCode: snapshot.statusCode,
        };
      if (!source.allowedOrigins.includes(new URL(snapshot.finalUrl).origin))
        return { kind: "failed", reason: "跳转到采集范围之外" };
      if (!document.querySelector(selector)?.textContent?.trim())
        return { kind: "failed", reason: "未识别到学习正文" };
      return { kind: "article", snapshot };
    },
    discover(snapshot) {
      const { document } = parseHTML(snapshot.html),
        found = new Map<string, Candidate>();
      for (const a of document.querySelectorAll(rule.linkSelector)) {
        const href = a.getAttribute("href");
        if (!href || href.startsWith("#")) continue;
        try {
          const canonicalUrl = normalizeUrl(
              new URL(href, snapshot.finalUrl).href,
            ),
            url = new URL(canonicalUrl);
          if (
            !source.allowedOrigins.includes(url.origin) ||
            (rule.pathPrefixes.length > 0 &&
              !rule.pathPrefixes.some((p) => url.pathname.startsWith(p))) ||
            /\.(png|jpe?g|gif|webp|svg|pdf|zip|css|js|mp[34]|ico)(\?|$)/i.test(
              url.pathname,
            ) ||
            /\/(login|signin|logout|search|tags?|categories)(\/|$)/i.test(
              url.pathname,
            )
          )
            continue;
          const parts = url.pathname.split("/").filter(Boolean);
          const sectionPath = parts.slice(0, -1).map((p) => {
            try {
              return decodeURIComponent(p);
            } catch {
              return p;
            }
          });
          found.set(canonicalUrl, {
            sourceId: source.id,
            canonicalUrl,
            title: a.textContent?.trim() || parts.at(-1) || source.label,
            sectionPath,
          });
        } catch {
          /* Non-web links are not documents. */
        }
      }
      return [...found.values()];
    },
    extract(snapshot, candidate) {
      const { document } = parseHTML(snapshot.html),
        body = document.querySelector(selector);
      if (!body) throw new Error("未识别到正文");
      const title =
        body
          .querySelector(rule.titleSelector)
          ?.textContent?.replace(/^#\s*/, "")
          .trim() ||
        document.querySelector(rule.titleSelector)?.textContent?.trim() ||
        document.querySelector("title")?.textContent?.split("|")[0].trim() ||
        candidate.title;
      for (const node of body.querySelectorAll(
        "script,style,nav,iframe,form,button,.header-anchor,.copy-code-button,.vp-page-nav,.vp-comment,.advertisement,.ads",
      ))
        node.remove();
      for (const excluded of rule.removeSelectors)
        for (const node of body.querySelectorAll(excluded)) node.remove();
      if (rule.normalizeCode) {
        for (const node of body.querySelectorAll(
          ".line-numbers-wrapper, .line-numbers-rows, .copy-code, .code-copy",
        ))
          node.remove();
        for (const pre of body.querySelectorAll("pre")) {
          const original = pre.querySelector("code");
          const language =
            [original, pre, pre.parentElement]
              .map((n) => n?.getAttribute("class") ?? "")
              .join(" ")
              .match(/(?:language-|lang-)([a-zA-Z0-9_+-]+)/)?.[1] ?? "";
          const code = document.createElement("code");
          code.textContent = original?.textContent ?? pre.textContent ?? "";
          if (language) code.setAttribute("class", "language-" + language);
          pre.replaceChildren(code);
        }
      }
      if (rule.expandDetails)
        for (const summary of body.querySelectorAll("details > summary")) {
          const heading = document.createElement("p");
          const strong = document.createElement("strong");
          strong.textContent = summary.textContent;
          heading.appendChild(strong);
          summary.replaceWith(heading);
        }
      const blocks = [...body.querySelectorAll("pre")];
      const extractionStats = {
        codeBlocks: blocks.length,
        emptyCodeBlocks: blocks.filter((p) => !p.textContent?.trim()).length,
        missingImageSources: 0,
      };
      const assets: ExtractedArticle["assets"] = [];
      for (const img of body.querySelectorAll("img")) {
        const raw =
          img.getAttribute("data-src") ||
          img.getAttribute("data-original") ||
          img.getAttribute("src");
        try {
          if (!raw) {
            extractionStats.missingImageSources++;
            continue;
          }
          const remoteUrl = normalizeUrl(new URL(raw, snapshot.finalUrl).href),
            localRef = `image-ref:${hash(remoteUrl)}`;
          assets.push({ remoteUrl, localRef });
          img.setAttribute("src", localRef);
        } catch {
          extractionStats.missingImageSources++;
          img.remove();
        }
      }
      for (const a of body.querySelectorAll("a[href]")) {
        try {
          a.setAttribute(
            "href",
            new URL(a.getAttribute("href")!, snapshot.finalUrl).href,
          );
        } catch {
          a.removeAttribute("href");
        }
      }
      const converter = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
      });
      converter.use(gfm);
      const markdown = converter.turndown(body.innerHTML);
      return {
        extractionStats,
        candidate: { ...candidate, title },
        markdown: markdown.startsWith("# ")
          ? markdown
          : `# ${title}\n\n${markdown}`,
        text: body.textContent || "",
        fetchedAt: snapshot.fetchedAt,
        assets,
      };
    },
  };
}
