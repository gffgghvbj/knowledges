import type { ResolvedRetrieval } from "./retrieval-settings";
import { endpoint } from "./settings";
export function retrievalError(e: unknown): string {
  const message = e instanceof Error ? e.message : "";
  return /^(检索|向量|精排|请填写|无法解密)/.test(message)
    ? message.slice(0, 400)
    : "检索服务连接失败或超时，请检查地址、权限和网络";
}
async function post(
  url: string,
  apiKey: string,
  body: unknown,
  signal: AbortSignal,
): Promise<any> {
  if (!url) throw Error("请填写完整的检索服务地址");
  signal.throwIfAborted();
  const response = await fetch(endpoint(url), {
    method: "POST",
    redirect: "error",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      response.status === 401 || response.status === 403
        ? "检索服务密钥无效或无权限"
        : response.status === 429
          ? "检索服务限流或额度不足，请稍后重试"
          : `检索服务返回 HTTP ${response.status}，请检查接口地址和模型名称`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("检索服务返回空响应");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) throw Error("检索响应超过 8 MiB 限制");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw Error("检索响应不是有效 JSON");
  }
}
export function normalize(vector: unknown, dimensions: number): number[] {
  if (
    !Array.isArray(vector) ||
    vector.length !== dimensions ||
    vector.some((n) => typeof n !== "number" || !Number.isFinite(n))
  )
    throw Error("向量维度或数值无效，请核对模型与维度设置");
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm < 1e-12) throw Error("向量为空或数值异常");
  return vector.map((n) => n / norm);
}
function needsKey(url: string) {
  try {
    return !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return true;
  }
}
export async function embed(
  config: ResolvedRetrieval["embedding"],
  texts: string[],
  kind: "query" | "document",
  signal: AbortSignal,
): Promise<number[][]> {
  if (!texts.length || texts.length > 8) throw Error("向量请求批次不合法");
  if (config.protocol !== "ollama" && !config.apiKey && needsKey(config.url))
    throw Error("检索服务缺少 Embedding API Key");
  const body =
    config.protocol === "dashscope"
      ? {
          model: config.model,
          input: { texts },
          parameters: {
            text_type: kind,
            dimension: config.dimensions,
            output_type: "dense",
          },
        }
      : config.protocol === "ollama"
        ? {
            model: config.model,
            input: texts,
            dimensions: config.dimensions,
            truncate: false,
          }
        : {
            model: config.model,
            input: texts,
            dimensions: config.dimensions,
            encoding_format: "float",
          };
  const data = await post(
    config.url,
    config.protocol === "ollama" ? "" : config.apiKey,
    body,
    signal,
  );
  if (config.protocol === "ollama") {
    if (
      !Array.isArray(data.embeddings) ||
      data.embeddings.length !== texts.length
    )
      throw Error("向量响应数量不一致");
    return data.embeddings.map((v: unknown) => normalize(v, config.dimensions));
  }
  const rows =
    config.protocol === "dashscope" ? data.output?.embeddings : data.data;
  if (!Array.isArray(rows) || rows.length !== texts.length)
    throw Error("向量响应数量不一致");
  const result: number[][] = new Array(texts.length);
  const seen = new Set<number>();
  for (const row of rows) {
    const index = config.protocol === "dashscope" ? row.text_index : row.index;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= texts.length ||
      seen.has(index)
    )
      throw Error("向量响应索引无效");
    seen.add(index);
    result[index] = normalize(row.embedding, config.dimensions);
  }
  return result;
}
export async function rerank(
  config: ResolvedRetrieval["rerank"],
  query: string,
  documents: string[],
  signal: AbortSignal,
): Promise<number[]> {
  if (!documents.length) return [];
  if (!config.apiKey && needsKey(config.url))
    throw Error("精排服务缺少 API Key");
  const body =
    config.protocol === "dashscope"
      ? {
          model: config.model,
          input: { query, documents },
          parameters: { top_n: documents.length },
        }
      : { model: config.model, query, documents, top_n: documents.length };
  const data = await post(config.url, config.apiKey, body, signal),
    rows =
      config.protocol === "dashscope" ? data.output?.results : data.results;
  if (!Array.isArray(rows) || rows.length !== documents.length)
    throw Error("精排返回数量不一致");
  const seen = new Set<number>();
  for (const row of rows) {
    if (
      !Number.isInteger(row.index) ||
      row.index < 0 ||
      row.index >= documents.length ||
      seen.has(row.index) ||
      typeof row.relevance_score !== "number" ||
      !Number.isFinite(row.relevance_score)
    )
      throw Error("精排返回索引或分值无效");
    seen.add(row.index);
  }
  return rows
    .sort((a, b) => b.relevance_score - a.relevance_score || a.index - b.index)
    .map((r) => r.index);
}
