import type { ExtractedArticle, Source, Asset } from "../../shared/contracts";
import type { LibraryRepository } from "../library/repository";
export async function downloadAssets(
  repo: LibraryRepository,
  source: Source,
  article: ExtractedArticle,
  fetcher: (
    source: Source,
    url: string,
  ) => Promise<{ bytes: Buffer; mimeType: string }>,
) {
  const assets: Asset[] = [],
    missing: string[] = [];
  for (const input of article.assets) {
    try {
      const result = await fetcher(source, input.remoteUrl),
        asset = repo.writeAsset(result.bytes, result.mimeType);
      assets.push(asset);
      article.markdown = article.markdown
        .split(input.localRef)
        .join(`asset:${asset.hash}`);
    } catch {
      missing.push(input.remoteUrl);
      article.markdown = article.markdown
        .split(input.localRef)
        .join(input.remoteUrl);
    }
  }
  return { assets, missing };
}
