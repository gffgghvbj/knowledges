import { RetrievalPanel } from "./RetrievalPanel";
import type { LibraryState } from "../shared/contracts";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { ModelProfile } from "../shared/knowledge";
import type { Run } from "./App";
export function ModelPage({ run, state }: { run: Run; state: LibraryState }) {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]),
    [provider, setProvider] = useState<"online" | "ollama">("online"),
    [baseUrl, setBaseUrl] = useState(""),
    [model, setModel] = useState(""),
    [key, setKey] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void run(async () => setProfiles(await api.modelProfiles()));
  }, []);
  useEffect(() => {
    const p = profiles.find((p) => p.provider === provider);
    if (p) {
      setBaseUrl(p.baseUrl);
      setModel(p.model);
    }
    setKey("");
  }, [provider, profiles]);
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
  const save = async (clearKey = false) => {
    setProfiles(
      await api.saveModel({
        provider,
        baseUrl,
        model,
        apiKey: clearKey ? "" : key,
        clearKey,
      }),
    );
    setKey("");
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR MODEL, YOUR CHOICE</div>
          <h2>模型设置</h2>
          <p>在线使用 DeepSeek，或连接本机 Ollama。设置只保存在这台电脑。</p>
        </div>
      </div>
      <section className="source-card model-form">
        <div className="model-switch">
          <button
            className={provider === "online" ? "primary" : ""}
            onClick={() => setProvider("online")}
            disabled={busy}
          >
            DeepSeek / 兼容接口
          </button>
          <button
            className={provider === "ollama" ? "primary" : ""}
            onClick={() => setProvider("ollama")}
            disabled={busy}
          >
            Ollama 本地模型
          </button>
        </div>
        <label>
          服务地址
          <input
            aria-label="服务地址"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={busy}
          />
        </label>
        <small>
          {provider === "online"
            ? "填写 API 基础地址，例如 https://api.deepseek.com；兼容服务可包含 /v1。"
            : "先安装并启动 Ollama，再填写已下载的模型名称。"}
        </small>
        <label>
          模型名称
          <input
            aria-label="模型名称"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={busy}
          />
        </label>
        {provider === "online" && (
          <>
            <label>
              API Key
              <input
                aria-label="API Key"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  profiles.find((p) => p.provider === provider)?.hasKey
                    ? "已加密保存；留空保留原密钥"
                    : "仅在本机填写，不需要发给任何人"
                }
                disabled={busy}
              />
            </label>
            <small>修改服务地址会清除旧密钥。密钥不会进入备份包。</small>
          </>
        )}
        <div className="card-actions">
          <button
            className="primary"
            disabled={busy || !model.trim() || !baseUrl}
            onClick={() =>
              action(async () => {
                await save();
                setMessage("设置已保存");
              })
            }
          >
            保存设置
          </button>
          <button
            disabled={busy || !model.trim() || !baseUrl}
            onClick={() =>
              action(async () => {
                await save();
                await api.testModel(provider);
                setMessage("连接成功，模型已返回响应");
              })
            }
          >
            {busy ? "正在处理…" : "保存并测试连接"}
          </button>
          {provider === "online" && (
            <button
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await save(true);
                  setMessage("密钥已清除");
                })
              }
            >
              清除密钥
            </button>
          )}
        </div>
        {message && (
          <p role="status" className="success-text">
            {message}
          </p>
        )}
        <p className="settings-note">
          测试连接只发送一条简短测试消息，不包含资料。在线服务可能产生少量 API
          费用。
        </p>
      </section>
      <RetrievalPanel run={run} status={state.vectorIndex} />
      <div className="info-note">
        <b>资料怎样交给模型？</b>
        <p>
          在线问答仅发送本次问题及检索到的相关段落，不上传整个资料库。使用本机
          Ollama 时，请求发往你配置的本机服务。两种方式的问答记录都保存在本地。
        </p>
      </div>
    </>
  );
}
