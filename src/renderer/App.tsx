import { InterviewPage } from "./InterviewPage";
import { QuestionBankPage } from "./QuestionBankPage";
import { InterviewMaterialsPage } from "./InterviewMaterialsPage";
import { KnowledgePage } from "./KnowledgePage";
import { ModelPage } from "./ModelPage";
import { useEffect, useState } from "react";
import type { LibraryState } from "../shared/contracts";
import { api } from "./api";
import { SourcePage } from "./SourcePage";
import { TaskPage } from "./TaskPage";
import { LibraryPage } from "./LibraryPage";
import { BackupPage } from "./BackupPage";
import "./style.css";
const empty: LibraryState = { sources: [], articles: [], tasks: [], root: "" };
export function App() {
  const [state, setState] = useState(empty),
    [view, setView] = useState("sources"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => setState(await api.state());
  const run = async (action: () => Promise<unknown>) => {
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
  };
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
    const interval = setInterval(() => void refresh().catch(() => {}), 1200);
    return () => clearInterval(interval);
  }, []);
  const active = state.tasks.filter((t) =>
    ["queued", "running", "login-required"].includes(t.state),
  ).length;
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
            ["bank", "▦", "题库"],
            ["materials", "▧", "面试资料"],
            ["models", "⚙", "模型设置"],
            ["backup", "⇄", "备份与迁移"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              aria-label={label}
              className={view === id ? "nav-item selected" : "nav-item"}
              onClick={() => setView(id)}
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
          <span className="status-dot" /> 本地资料库 <small>v0.4</small>
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
                  models: "模型设置",
                  sources: "网站来源",
                  library: "资料库",
                  tasks: "采集任务",
                  backup: "备份与迁移",
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
          {view === "interview" && <InterviewPage run={run} />}
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
          {view === "library" && <LibraryPage state={state} run={run} />}
          {view === "backup" && (
            <BackupPage state={state} run={run} busy={busy} />
          )}
        </main>
      </div>
    </div>
  );
}
export type Run = (action: () => Promise<unknown>) => Promise<void>;
