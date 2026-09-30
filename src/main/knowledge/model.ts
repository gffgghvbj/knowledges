import type { ModelSettings } from "./settings";
export async function requestModel(
  profile: ReturnType<ModelSettings["resolve"]>,
  messages: { role: string; content: string }[],
  signal: AbortSignal,
): Promise<string> {
  const ollama = profile.provider === "ollama";
  const response = await fetch(
    profile.baseUrl + (ollama ? "/api/chat" : "/chat/completions"),
    {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(profile.apiKey
          ? { Authorization: `Bearer ${profile.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: profile.model,
        messages,
        stream: false,
        ...(ollama
          ? { format: "json", options: { num_predict: 4096 } }
          : {
              response_format: { type: "json_object" },
              max_tokens: 4096,
              ...(new URL(profile.baseUrl).hostname === "api.deepseek.com"
                ? { thinking: { type: "disabled" } }
                : {}),
            }),
      }),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      response.status === 401 || response.status === 403
        ? "API Key 无效或无权限，请检查模型设置"
        : response.status === 429
          ? "模型服务限流或额度不足，请稍后重试"
          : `模型服务返回 HTTP ${response.status}，请检查地址、模型名称和服务状态`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("模型返回空响应");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2 * 1024 * 1024) throw Error("模型响应超过大小限制");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  let data: any;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Error("模型响应不是有效 JSON");
  }
  if (
    ollama
      ? data.done !== true || data.done_reason === "length"
      : data.choices?.[0]?.finish_reason !== "stop"
  )
    throw Error("模型输出未完整结束，请重试或切换模型");
  const content = ollama
    ? data.message?.content
    : data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw Error("模型没有返回回答内容");
  return content;
}
