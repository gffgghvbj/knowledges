import { useEffect, useState } from "react";
import type { SyncPushResult } from "../shared/sync";
import type { Run } from "./App";
import { api } from "./api";

export function SyncPage({ run, busy }: { run: Run; busy: boolean }) {
  const [endpoint, setEndpoint] = useState(""),
    [token, setToken] = useState(""),
    [hasToken, setHasToken] = useState(false),
    [result, setResult] = useState<SyncPushResult | null>(null);
  useEffect(() => {
    void api.syncSettings().then((s) => {
      setEndpoint(s.endpoint);
      setHasToken(s.hasToken);
    });
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SYNC TO MINI PROGRAM</div>
          <h2>云同步</h2>
          <p>把资料、题库和复习记录推送到云端，供微信小程序阅读和练习。</p>
        </div>
      </div>
      <div className="backup-grid">
        <section className="source-card">
          <div className="empty-icon">⇡</div>
          <h3>同步设置</h3>
          <p>
            云端同步地址使用云开发 HTTP 访问服务地址，同步密钥加密保存在本机，不进入备份。
          </p>
          <label className="field">
            <span>同步地址</span>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://<环境ID>.service.tcloudbase.com/sync-api"
            />
          </label>
          <label className="field">
            <span>同步密钥{hasToken ? "（已保存，可留空保持不变）" : ""}</span>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={hasToken ? "••••••••" : "与云函数环境变量 SYNC_TOKEN 一致"}
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.saveSyncSettings(
                  endpoint.trim(),
                  token.trim() || undefined,
                );
                const saved = await api.syncSettings();
                setHasToken(saved.hasToken);
                setToken("");
              })
            }
          >
            保存设置
          </button>
        </section>
        <section className="source-card">
          <div className="empty-icon">☁</div>
          <h3>推送到云端</h3>
          <p>
            全量比对推送：来源、文章（含回收站）、当前版本正文、图片、题库与复习记录。重复推送安全，图片只上传新增部分。
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => run(async () => setResult(await api.syncPush()))}
          >
            {busy ? "正在同步…" : "开始同步"}
          </button>
          {result && (
            <p className="success-text">
              同步完成：来源 {result.sources} · 文章 {result.articles} · 版本{" "}
              {result.versions} · 图片 {result.assets} · 题目{" "}
              {result.questions} · 复习 {result.reviews}
            </p>
          )}
        </section>
      </div>
      <div className="info-note">
        <b>说明</b>
        <p>
          同步为单向（桌面 → 云端 → 小程序），小程序端的问答记录不会回传。正文中的图片会上传到云端存储并替换为在线地址。文章删除状态会同步，回收站文章在小程序中不可见。
        </p>
      </div>
    </>
  );
}
