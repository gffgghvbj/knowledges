import { ExtractionDialog, ruleOptions } from "./ExtractionDialog";
import {
  resolveExtractionRule,
  type ExtractionSelection,
} from "../shared/extraction";
import type { Source } from "../shared/contracts";
import { useState } from "react";
import type { LibraryState } from "../shared/contracts";
import type { Run } from "./App";
import { api } from "./api";
import { ConfirmDelete } from "./components/ConfirmDelete";
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
    [url, setUrl] = useState(""),
    [selection, setSelection] = useState<ExtractionSelection>({
      preset: "auto",
    }),
    [editing, setEditing] = useState<Source | null>(null),
    [deleting, setDeleting] = useState<Source | null>(null);
  const sources = state.sources.filter((s) => !s.deletedAt);
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
            {sources.length}
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
          网站来源 <span>{sources.length}</span>
        </h3>
        <small>按需采集 · 手动更新</small>
      </div>
      {sources.length === 0 ? (
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
          {sources.map((s) => {
            const latest = state.tasks.find((t) => t.sourceId === s.id);
            return (
              <section className="source-card" key={s.id}>
                <div className="source-title">
                  <div className="source-icon">{s.label.slice(0, 1)}</div>
                  <div>
                    <h3>{s.label}</h3>
                    <small>{new URL(s.entryUrl).hostname}</small>
                  </div>
                  <span className="tag">{resolveExtractionRule(s).name}</span>
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
                    className="danger-button"
                    disabled={busy}
                    onClick={() => setDeleting(s)}
                  >
                    删除来源
                  </button>
                  <button disabled={busy} onClick={() => setEditing(s)}>
                    提取规则
                  </button>
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
      {deleting && (
        <ConfirmDelete
          title="删除网站来源？"
          description={`将移除「${deleting.label}」和该网站的采集任务，停止后续结果保存。已采集文章、问答和面试记录都会保留。重新添加同一网站可恢复来源配置。`}
          onCancel={() => setDeleting(null)}
          onConfirm={() =>
            run(async () => {
              await api.deleteSource(deleting.id);
              setDeleting(null);
            })
          }
        />
      )}
      {editing && (
        <ExtractionDialog
          source={editing}
          run={run}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api.addSource(url, selection);
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
            <label>
              提取规则
              <select
                aria-label="新网站提取规则"
                value={selection.preset}
                onChange={(e) =>
                  setSelection({
                    preset: e.target.value as
                      "auto" | "generic" | "xiaolin" | "javaguide" | "carl",
                  })
                }
              >
                {ruleOptions
                  .filter(([id]) => id !== "custom")
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </select>
            </label>
            <small>保存网站后，可在“提取规则”中预览或导入自定义规则。</small>
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
