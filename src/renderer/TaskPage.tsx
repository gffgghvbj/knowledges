import { CaptureItems } from "./CaptureItems";
import type { Source } from "../shared/contracts";
import { useState } from "react";
import type { LibraryState, CaptureTask } from "../shared/contracts";
import type { Run } from "./App";
import { api } from "./api";
import { ConfirmDelete } from "./components/ConfirmDelete";
import { Pagination } from "./components/Pagination";
const status: Record<string, string> = {
  queued: "等待开始",
  running: "正在采集",
  paused: "已暂停",
  complete: "采集完成",
  partial: "部分完成",
  failed: "需要重试",
  "login-required": "需要登录",
};
export function TaskPage({
  state,
  run,
  busy,
}: {
  state: LibraryState;
  run: Run;
  busy: boolean;
}) {
  const [deleting, setDeleting] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(state.tasks.length / 50) - 1),
  );
  const completed = state.tasks
    .filter((t) => t.state === "complete")
    .map((t) => t.id);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CAPTURE QUEUE</div>
          <h2>采集任务</h2>
          <p>查看进度、选择栏目，或从中断的位置继续。</p>
        </div>
        <button
          disabled={busy || !completed.length}
          onClick={() => setDeleting(completed)}
        >
          清理已完成任务
        </button>
      </div>
      {!state.tasks.length && (
        <div className="empty-card">
          <h3>暂时没有采集任务</h3>
          <p>在「网站来源」中添加网站并开始扫描。</p>
        </div>
      )}
      {state.tasks.slice(safePage * 50, (safePage + 1) * 50).map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          latest={state.tasks[0]?.id === t.id}
          source={state.sources.find((s) => s.id === t.sourceId)}
          label={
            state.sources.find((s) => s.id === t.sourceId)?.label || "网站"
          }
          run={run}
          busy={busy}
          onDelete={() => setDeleting([t.id])}
        />
      ))}
      <Pagination
        page={safePage}
        total={state.tasks.length}
        onChange={setPage}
      />
      {deleting.length > 0 && (
        <ConfirmDelete
          title="删除采集任务？"
          description={`将删除 ${deleting.length} 条任务记录，删除后不能继续或重试这些任务。进行中的请求不再保存后续采集结果；已采集文章不会删除。`}
          onCancel={() => setDeleting([])}
          onConfirm={() =>
            run(async () => {
              await api.deleteTasks(deleting);
              setDeleting([]);
            })
          }
        />
      )}
    </>
  );
}
function TaskCard({
  task: t,
  latest,
  source,
  label,
  run,
  busy,
  onDelete,
}: {
  task: CaptureTask;
  latest: boolean;
  source?: Source;
  onDelete: () => void;
  label: string;
  run: Run;
  busy: boolean;
}) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const sections = [
    ...new Set(t.items.map((i) => i.candidate.sectionPath[0] || "其他")),
  ];
  const done = t.items.filter((i) =>
    ["complete", "partial", "failed", "skipped"].includes(i.state),
  ).length;
  const isScan = t.mode === "scan";
  return (
    <section className="task-card">
      <div className="section-heading">
        <div>
          <h3>
            {label}{" "}
            <span>
              {isScan
                ? "栏目扫描"
                : t.mode === "update"
                  ? "手动更新"
                  : "正文采集"}
            </span>
          </h3>
          <small>{new Date(t.createdAt).toLocaleString()}</small>
        </div>
        <span className={`pill ${t.state}`}>
          {isScan && t.state === "complete" ? "扫描完成" : status[t.state]}
        </span>
      </div>
      <div className="progress">
        <div
          style={{
            width: `${t.items.length ? (done / t.items.length) * 100 : 0}%`,
          }}
        />
      </div>
      <div className="task-summary">
        <span>
          已处理 {done} / {t.items.length}
          {!t.scanComplete ? " · 仍在发现更多文章" : ""}
        </span>
        <span>
          {
            t.items.filter((i) => ["failed", "partial"].includes(i.state))
              .length
          }{" "}
          项失败或图片待补全 ·{" "}
          {t.items.filter((i) => i.quality?.issues.length).length} 项质量提示
        </span>
      </div>
      {t.error && <p className="error-text">{t.error}</p>}
      {isScan && t.scanComplete && (
        <div className="sections">
          <b>选择要采集的栏目</b>
          <div>
            {sections.map((s) => (
              <label key={s}>
                <input
                  type="checkbox"
                  checked={!excluded.includes(s)}
                  onChange={(e) =>
                    setExcluded(
                      e.target.checked
                        ? excluded.filter((x) => x !== s)
                        : [...excluded, s],
                    )
                  }
                />
                {s}
                <small>
                  {
                    t.items.filter(
                      (i) => (i.candidate.sectionPath[0] || "其他") === s,
                    ).length
                  }
                </small>
              </label>
            ))}
          </div>
          <button
            className="primary"
            disabled={busy || excluded.length === sections.length}
            onClick={() =>
              run(() =>
                api.capture(
                  t.id,
                  sections.filter((s) => !excluded.includes(s)),
                ),
              )
            }
          >
            采集所选栏目
          </button>
        </div>
      )}
      <CaptureItems
        task={t}
        source={source}
        run={run}
        busy={busy}
        latest={latest}
      />
      <div className="card-actions">
        <button className="danger-button" disabled={busy} onClick={onDelete}>
          删除任务
        </button>
        {["running", "queued"].includes(t.state) && (
          <button onClick={() => run(() => api.control(t.id, "pause"))}>
            暂停
          </button>
        )}
        {t.state === "login-required" && (
          <button
            className="primary"
            onClick={() => run(() => api.login(t.sourceId))}
          >
            打开登录窗口
          </button>
        )}
        {["paused", "login-required"].includes(t.state) && (
          <button onClick={() => run(() => api.control(t.id, "resume"))}>
            继续任务
          </button>
        )}
        {["failed", "partial"].includes(t.state) && (
          <button onClick={() => run(() => api.control(t.id, "retry"))}>
            重试失败项
          </button>
        )}
      </div>
      {t.items.some((i) => i.error) && (
        <details>
          <summary>查看失败详情</summary>
          {t.items
            .filter((i) => i.error)
            .slice(0, 50)
            .map((i) => (
              <p className="failure" key={i.candidate.canonicalUrl}>
                <b>{i.candidate.title}</b>
                <small>{i.error}</small>
              </p>
            ))}
        </details>
      )}
    </section>
  );
}
