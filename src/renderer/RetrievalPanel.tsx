import { useEffect, useState } from "react";
import type { RetrievalConfig, VectorStatus } from "../shared/retrieval";
import type { Run } from "./App";
import { api } from "./api";
const statusLabels = {
  disabled: "混合检索未启用",
  paused: "向量索引已暂停",
  running: "正在建立向量索引…",
  ready: "向量索引已就绪",
  failed: "向量索引失败，等待重试",
};
export function RetrievalPanel({
  run,
  status,
}: {
  run: Run;
  status?: VectorStatus;
}) {
  const [config, setConfig] = useState<RetrievalConfig | null>(null),
    [embeddingKey, setEmbeddingKey] = useState(""),
    [rerankKey, setRerankKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    void run(async () => setConfig(await api.retrievalConfig()));
  }, []);
  if (!config) return null;
  const c = config;
  const changeEmbedding = (p: Partial<RetrievalConfig["embedding"]>) =>
    setConfig({ ...c, embedding: { ...c.embedding, ...p } });
  const changeRerank = (p: Partial<RetrievalConfig["rerank"]>) =>
    setConfig({ ...c, rerank: { ...c.rerank, ...p } });
  const action = (fn: () => Promise<void>) =>
    run(async () => {
      setBusy(true);
      setMessage("");
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    });
  const save = async (clear?: "embedding" | "rerank") => {
    setConfig(
      await api.saveRetrieval({
        ...c,
        embedding: {
          ...c.embedding,
          apiKey: clear === "embedding" ? "" : embeddingKey,
          clearKey: clear === "embedding",
        },
        rerank: {
          ...c.rerank,
          apiKey: clear === "rerank" ? "" : rerankKey,
          clearKey: clear === "rerank",
        },
      }),
    );
    setEmbeddingKey("");
    setRerankKey("");
  };
  return (
    <section className="source-card retrieval-settings">
      <div className="section-heading">
        <div>
          <div className="eyebrow">SEMANTIC SEARCH</div>
          <h3>向量检索与精排</h3>
        </div>
        <label className="toggle-label">
          <input
            aria-label="启用混合检索"
            type="checkbox"
            checked={c.enabled}
            disabled={busy}
            onChange={(e) => setConfig({ ...c, enabled: e.target.checked })}
          />
          启用混合检索
        </label>
      </div>
      <p className="settings-note">
        关键词与语义共同召回资料，精排后交给回答模型。这里的模型和密钥独立于
        DeepSeek。
      </p>
      <div className="retrieval-columns">
        <fieldset disabled={busy}>
          <legend>Embedding · 文本编码</legend>
          <label>
            Embedding 协议
            <select
              aria-label="Embedding 协议"
              value={c.embedding.protocol}
              onChange={(e) =>
                changeEmbedding({
                  protocol: e.target.value as typeof c.embedding.protocol,
                })
              }
            >
              <option value="dashscope">百炼 / DashScope 原生</option>
              <option value="openai">兼容 Embeddings 接口</option>
              <option value="ollama">Ollama 本机接口</option>
            </select>
          </label>
          <label>
            Embedding 接口地址
            <input
              aria-label="Embedding 接口地址"
              value={c.embedding.url}
              onChange={(e) => changeEmbedding({ url: e.target.value })}
              placeholder={
                c.embedding.protocol === "ollama"
                  ? "http://127.0.0.1:11434/api/embed"
                  : "完整 URL，包含接口路径"
              }
            />
          </label>
          <label>
            Embedding 模型
            <input
              aria-label="Embedding 模型"
              value={c.embedding.model}
              onChange={(e) => changeEmbedding({ model: e.target.value })}
            />
          </label>
          <label>
            向量维度
            <input
              aria-label="向量维度"
              type="number"
              min={1}
              max={8192}
              value={c.embedding.dimensions}
              onChange={(e) =>
                changeEmbedding({ dimensions: Number(e.target.value) })
              }
            />
          </label>
          {c.embedding.protocol !== "ollama" && (
            <>
              <label>
                Embedding API Key
                <input
                  aria-label="Embedding API Key"
                  type="password"
                  autoComplete="off"
                  value={embeddingKey}
                  onChange={(e) => setEmbeddingKey(e.target.value)}
                  placeholder={
                    c.embedding.hasKey
                      ? "已加密保存；留空保留"
                      : "填写此服务的 API Key"
                  }
                />
              </label>
              <button
                className="small-action"
                onClick={() =>
                  action(async () => {
                    await save("embedding");
                    setMessage("Embedding 密钥已清除");
                  })
                }
              >
                清除 Embedding 密钥
              </button>
            </>
          )}
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Rerank · 相关性精排</legend>
          <label className="toggle-label">
            <input
              aria-label="启用精排"
              type="checkbox"
              checked={c.rerank.enabled}
              onChange={(e) => changeRerank({ enabled: e.target.checked })}
            />
            启用精排
          </label>
          <label>
            Rerank 协议
            <select
              aria-label="Rerank 协议"
              value={c.rerank.protocol}
              onChange={(e) =>
                changeRerank({
                  protocol: e.target.value as typeof c.rerank.protocol,
                })
              }
            >
              <option value="dashscope">百炼 / DashScope 原生</option>
              <option value="compatible">兼容 Rerank 接口</option>
            </select>
          </label>
          <label>
            Rerank 接口地址
            <input
              aria-label="Rerank 接口地址"
              value={c.rerank.url}
              onChange={(e) => changeRerank({ url: e.target.value })}
              placeholder="完整 URL，包含接口路径"
            />
          </label>
          <label>
            Rerank 模型
            <input
              aria-label="Rerank 模型"
              value={c.rerank.model}
              onChange={(e) => changeRerank({ model: e.target.value })}
            />
          </label>
          <label>
            Rerank API Key
            <input
              aria-label="Rerank API Key"
              type="password"
              autoComplete="off"
              value={rerankKey}
              onChange={(e) => setRerankKey(e.target.value)}
              placeholder={
                c.rerank.hasKey
                  ? "已加密保存；留空保留"
                  : "可填写同一百炼账户的 API Key"
              }
            />
          </label>
          <button
            className="small-action"
            onClick={() =>
              action(async () => {
                await save("rerank");
                setMessage("Rerank 密钥已清除");
              })
            }
          >
            清除 Rerank 密钥
          </button>
        </fieldset>
      </div>
      <details className="endpoint-help">
        <summary>百炼接口地址填写示例</summary>
        <p>
          将 HOST 替换为控制台提供的业务空间 API
          Host，例如：业务空间ID.cn-beijing.maas.aliyuncs.com。不要把聊天接口地址填在这里。
        </p>
        <code>
          Embedding：https://HOST/api/v1/services/embeddings/text-embedding/text-embedding
        </code>
        <code>
          Rerank：https://HOST/api/v1/services/rerank/text-rerank/text-rerank
        </code>
        <p>
          选择兼容 Embeddings 协议时，填写
          https://HOST/compatible-mode/v1/embeddings。Qwen flash 常用维度为
          1024，也支持 768、512、256；Ollama 则填写本机已安装的 Embedding
          模型和对应维度。
        </p>
      </details>
      <details>
        <summary>检索参数</summary>
        <label>
          最低向量相似度
          <input
            aria-label="最低向量相似度"
            type="number"
            min={-1}
            max={1}
            step={0.05}
            value={c.minSimilarity}
            onChange={(e) =>
              setConfig({ ...c, minSimilarity: Number(e.target.value) })
            }
          />
        </label>
        <p>默认 0.2。数值越高，召回越严格；相似度不代表答案置信度。</p>
      </details>
      <div className="card-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            action(async () => {
              await save();
              setMessage("检索设置已保存；点击建立 / 继续索引开始处理资料");
            })
          }
        >
          保存检索设置
        </button>
        <button
          disabled={busy}
          onClick={() =>
            action(async () => {
              await save();
              const result = await api.testRetrieval();
              setMessage(`检索连接成功 · ${result.dimensions} 维`);
            })
          }
        >
          {busy ? "正在处理…" : "保存并测试检索"}
        </button>
      </div>
      {message && (
        <p className="success-text" role="status">
          {message}
        </p>
      )}
      <div className="vector-status">
        <div className="section-heading">
          <h3>{statusLabels[status?.state ?? "disabled"]}</h3>
          <small>
            {status?.ready ?? 0} / {status?.total ?? 0} 段已完成
          </small>
        </div>
        <div className="progress">
          <div
            style={{
              width: `${status?.total ? (100 * status.ready) / status.total : 0}%`,
            }}
          />
        </div>
        {!!status?.excluded && (
          <p className="error-text">
            {status.excluded} 个片段超过 18000
            字符，未进入向量索引；原文仍保留。
          </p>
        )}
        {status?.error && <p className="error-text">{status.error}</p>}
        <div className="card-actions">
          <button
            disabled={busy || !c.enabled || status?.state === "disabled"}
            onClick={() => action(() => api.controlVectorIndex("start"))}
          >
            建立 / 继续索引
          </button>
          <button
            disabled={
              busy || (status?.state !== "running" && status?.state !== "ready")
            }
            onClick={() => action(() => api.controlVectorIndex("pause"))}
          >
            暂停自动索引
          </button>
          <button
            disabled={busy || !c.enabled || status?.state === "disabled"}
            onClick={() => action(() => api.controlVectorIndex("rebuild"))}
          >
            重建当前模型索引
          </button>
        </div>
        <p className="settings-note">
          开始后会自动处理新增、更新、恢复和导入的资料，重启后继续；失败时暂停，等待手动重试。修改设置会暂停任务。重建会重新调用模型，可能产生费用。
        </p>
      </div>
      <div className="info-note">
        <b>发送哪些资料？</b>
        <p>
          在线建立向量时会分批发送资料片段；查询时发送问题，精排时还会发送候选段落。测试连接只发送内置测试文本。向量存在本机，不随备份导出；API
          Key 加密保存，更换接口地址会清除对应旧密钥。
        </p>
      </div>
    </section>
  );
}
