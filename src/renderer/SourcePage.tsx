import { useState } from "react";
import type { LibraryState } from "../shared/contracts";
import type { Run } from "./App";
import { api } from "./api";
export function SourcePage({
  state,
  run,
  busy,
  onTask,
}: {
  state: LibraryState;
  run: Run;
  busy: boolean;
  onTask: () => void;
}) {
  const [adding, setAdding] = useState(false),
    [url, setUrl] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">COLLECT · KEEP · LEARN</div>
          <h2>把好内容，收进自己的资料库。</h2>
          <p>从网站到本地 Markdown，让每一次积累都有迹可循。</p>
        </div>
        <button className="primary" onClick={() => setAdding(true)}>
          添加网站
        </button>
      </div>
      <section className="stats">
        <div>
          <span>已添加来源</span>
          <strong>
            {state.sources.length}
            <small>个网站</small>
          </strong>
        </div>
        <div>
          <span>本地文章</span>
          <strong>
            {state.articles.length}
            <small>篇资料</small>
          </strong>
        </div>
        <div>
          <span>正在进行</span>
          <strong>
            {
              state.tasks.filter((t) => ["running", "queued"].includes(t.state))
                .length
            }
            <small>个任务</small>
          </strong>
        </div>
      </section>
      <div className="section-heading">
        <h3>
          网站来源 <span>{state.sources.length}</span>
        </h3>
        <small>按需采集 · 手动更新</small>
      </div>
      {state.sources.length === 0 ? (
        <section className="empty-card">
          <div className="empty-icon">◈</div>
          <h3>从一个值得收藏的网站开始</h3>
          <p>添加网站，扫描栏目，再选择想保存在本地的资料。</p>
          <div className="suggestions">
            {[
              ["小林 coding", "https://xiaolincoding.com/interview/redis.html"],
              [
                "JavaGuide",
                "https://www.javaguide.cn/java/jvm/jvm-garbage-collection.html",
              ],
            ].map(([name, link]) => (
              <button
                key={name}
                onClick={() => {
                  setUrl(link);
                  setAdding(true);
                }}
              >
                ＋ {name}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="source-grid">
          {state.sources.map((s) => {
            const latest = state.tasks.find((t) => t.sourceId === s.id);
            return (
              <section className="source-card" key={s.id}>
                <div className="source-title">
                  <div className="source-icon">{s.label.slice(0, 1)}</div>
                  <div>
                    <h3>{s.label}</h3>
                    <small>{new URL(s.entryUrl).hostname}</small>
                  </div>
                  <span className="tag">
                    {s.adapterId === "generic" ? "通用识别" : "专用适配"}
                  </span>
                </div>
                <p className="source-link">{s.entryUrl}</p>
                <div className="source-meta">
                  <span>
                    <b>
                      {state.articles.filter((a) => a.sourceId === s.id).length}
                    </b>{" "}
                    篇本地文章
                  </span>
                  <span>
                    {latest
                      ? new Date(latest.createdAt).toLocaleDateString()
                      : "尚未采集"}
                  </span>
                </div>
                <div className="card-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.scan(s.id);
                        onTask();
                      })
                    }
                  >
                    扫描网站
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.update(s.id);
                        onTask();
                      })
                    }
                  >
                    更新
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => api.login(s.id))}
                  >
                    登录网站
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
      <div className="info-note">
        <b>你的资料，你来掌握</b>
        <p>
          正文与图片保存在本机。网站更新会保留历史版本；源站移除文章也不会删除你的本地副本。
        </p>
      </div>
      {adding && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api.addSource(url);
                setAdding(false);
                setUrl("");
              });
            }}
          >
            <h3>添加网站来源</h3>
            <p>可以使用网站首页，或任意一篇学习文章的链接。</p>
            <label>
              网站地址
              <input
                autoFocus
                required
                type="url"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <small>扫描范围限定在同一网站；登录后内容需要先完成登录。</small>
            <div className="modal-actions">
              <button type="button" onClick={() => setAdding(false)}>
                取消
              </button>
              <button className="primary" disabled={busy} type="submit">
                保存网站
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
