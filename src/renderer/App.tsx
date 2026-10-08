import { ReviewPage } from "./ReviewPage";
import { InterviewPage } from "./InterviewPage";
import { QuestionBankPage } from "./QuestionBankPage";
import { InterviewMaterialsPage } from "./InterviewMaterialsPage";
import { KnowledgePage } from "./KnowledgePage";
import { ModelPage } from "./ModelPage";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryState, StartupStatus } from "../shared/contracts";
import { api } from "./api";
import { SourcePage } from "./SourcePage";
import { TaskPage } from "./TaskPage";
import { LibraryPage } from "./LibraryPage";
import { BackupPage } from "./BackupPage";
import { SyncPage } from "./SyncPage";
import "./style.css";
const empty: LibraryState = { sources: [], articles: [], tasks: [], root: "" };
export function App() {
  const [state, setState] = useState(empty),
    [starting, setStarting] = useState(true),
    [startup, setStartup] = useState<StartupStatus>({
      message: "正在打开本地资料库…",
    }),
    [view, setView] = useState("sources"),
    [interviewId, setInterviewId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const revision = useRef<string | undefined>(undefined);
  const refresh = useCallback(async () => {
    const update = await api.stateUpdate(revision.current);
    revision.current = update.revision;
    setStarting(false);
    if (Object.keys(update.patch).length)
      setState((old) => ({ ...old, ...update.patch }));
  }, []);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setError("");
      try {
        await action();
        await refresh();
      } catch (e) {
        setError(
          String(e).replace(
            /^Error: (?:Error invoking remote method '[^']+': Error: )?/,
            "",
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  useEffect(() => {
    if (!starting) return;
    let active = true;
    const update = () =>
      void api
        .startupStatus()
        .then((value) => {
          if (active) setStartup(value);
        })
        .catch(() => {});
    update();
    const timer = setInterval(update, 250);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [starting]);
  const working =
    state.tasks.some((t) => ["queued", "running"].includes(t.state)) ||
    state.vectorIndex?.state === "running";
  useEffect(() => {
    if (!working) return;
    const interval = setInterval(() => void refresh().catch(() => {}), 1200);
    return () => clearInterval(interval);
  }, [working, refresh]);
  const active = state.tasks.filter((t) =>
    ["queued", "running", "login-required"].includes(t.state),
  ).length;
  if (starting)
    return (
      <section className="startup-screen" aria-label="启动状态">
        <span className="brand-mark">拾</span>
        <h1>拾知</h1>
        <p role="status">{startup.message}</p>
        {startup.error || error ? (
          <p role="alert">
            {startup.error ||
              "无法加载资料库，请检查本地资料和模型设置后重启。"}
          </p>
        ) : (
          <>
            <progress
              aria-label="资料检查进度"
              max={startup.total || 1}
              value={startup.total ? startup.completed : undefined}
            />
            {startup.total ? (
              <small>
                {startup.completed} / {startup.total} 篇
              </small>
            ) : null}
            <small>首次升级可能需要整理资料，后续启动会复用已有索引。</small>
          </>
        )}
      </section>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">拾</span>
          <div>
            <h1>拾知</h1>
            <small>把知识，留在身边</small>
          </div>
        </div>
        <div className="nav-caption">我的工作空间</div>
        <nav>
          {[
            ["sources", "◈", "网站来源"],
            ["library", "▤", "资料库"],
            ["tasks", "⇣", "采集任务"],
            ["qa", "✧", "知识库问答"],
            ["interview", "◇", "模拟面试"],
            ["review", "↻", "复习"],
            ["bank", "▦", "题库"],
            ["materials", "▧", "面试资料"],
            ["models", "⚙", "模型设置"],
            ["backup", "⇄", "备份与迁移"],
            ["sync", "☁", "云同步"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              aria-label={label}
              className={view === id ? "nav-item selected" : "nav-item"}
              onClick={() => {
                void api
                  .flushInterviewDrafts()
                  .then(() => setView(id))
                  .catch(() => setError("草稿尚未保存，请检查磁盘后重试"));
              }}
            >
              <span className="nav-icon">{icon}</span>
              {label}
              {id === "tasks" && active > 0 && (
                <b className="count">{active}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" /> 本地资料库 <small>v0.9.1</small>
          <p>资料属于你，随时可以带走。</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            个人空间 <i>/</i>{" "}
            {
              (
                {
                  qa: "知识库问答",
                  materials: "面试资料",
                  bank: "题库",
                  interview: "模拟面试",
                  review: "复习",
                  models: "模型设置",
                  sources: "网站来源",
                  library: "资料库",
                  tasks: "采集任务",
                  backup: "备份与迁移",
                  sync: "云同步",
                } as Record<string, string>
              )[view]
            }
          </span>
          <span className="local-badge">● 本地存储</span>
        </header>
        <main className="page">
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button onClick={() => setError("")}>关闭</button>
            </div>
          )}
          {view === "qa" && (
            <KnowledgePage
              state={state}
              run={run}
              onSettings={() => setView("models")}
            />
          )}
          {view === "interview" && (
            <InterviewPage run={run} initialId={interviewId} />
          )}
          {view === "review" && (
            <ReviewPage
              run={run}
              onPractice={(id) => {
                setInterviewId(id);
                setView("interview");
              }}
            />
          )}
          {view === "bank" && <QuestionBankPage run={run} state={state} />}
          {view === "materials" && <InterviewMaterialsPage run={run} />}
          {view === "models" && <ModelPage run={run} state={state} />}
          {view === "sources" && (
            <SourcePage
              state={state}
              run={run}
              busy={busy}
              onTask={() => setView("tasks")}
            />
          )}
          {view === "tasks" && <TaskPage state={state} run={run} busy={busy} />}
          {view === "library" && (
            <LibraryPage
              state={state}
              run={run}
              onTask={() => setView("tasks")}
            />
          )}
          {view === "backup" && (
            <BackupPage state={state} run={run} busy={busy} />
          )}
          {view === "sync" && <SyncPage run={run} busy={busy} />}
        </main>
      </div>
    </div>
  );
}
export type Run = (action: () => Promise<unknown>) => Promise<void>;
