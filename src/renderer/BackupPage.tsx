import { useState } from "react";
import type {
  LibraryState,
  BackupPreview,
  MergeReport,
} from "../shared/contracts";
import type { Run } from "./App";
import { api } from "./api";
export function BackupPage({
  state,
  run,
  busy,
}: {
  state: LibraryState;
  run: Run;
  busy: boolean;
}) {
  const [pending, setPending] = useState<{
      path: string;
      preview: BackupPreview;
    } | null>(null),
    [report, setReport] = useState<MergeReport | null>(null),
    [exported, setExported] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TAKE YOUR KNOWLEDGE WITH YOU</div>
          <h2>备份与迁移</h2>
          <p>一个文件，在 macOS 和 Windows 之间带走你的积累。</p>
        </div>
      </div>
      <div className="backup-grid">
        <section className="source-card">
          <div className="empty-icon">↗</div>
          <h3>导出资料库</h3>
          <p>
            包含文章、图片、历史版本、问答、题库、简历/JD
            文本及面试记录。网站登录状态、模型设置和 API Key 不会放入备份。
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.exportBackup();
                if (r.path) setExported(r.path);
              })
            }
          >
            {busy ? "正在处理…" : "导出备份包"}
          </button>
          {exported && <p className="success-text">已导出：{exported}</p>}
        </section>
        <section className="source-card">
          <div className="empty-icon">↙</div>
          <h3>合并导入</h3>
          <p>
            保留两边新增的资料，同名分类合并。重新导入旧备份也会恢复其中已在本机删除的问答。
          </p>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => setPending(await api.inspectBackup()))
            }
          >
            选择备份文件
          </button>
          {pending && (
            <div className="import-preview">
              <p>
                校验通过 · {pending.preview.recordCount} 篇文章 ·{" "}
                {pending.preview.questionCount ?? 0} 条问答 ·{" "}
                {pending.preview.materialCount ?? 0} 份面试资料 ·{" "}
                {pending.preview.bankCount ?? 0} 道题 ·{" "}
                {pending.preview.interviewCount ?? 0} 场面试 ·{" "}
                {(pending.preview.totalBytes / 1024 / 1024).toFixed(1)} MB
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setReport(await api.importBackup(pending.path));
                    setPending(null);
                  })
                }
              >
                开始合并导入
              </button>
            </div>
          )}
          {report && (
            <p className="success-text">
              新增 {report.added} · 更新 {report.updated} · 重复{" "}
              {report.duplicates} · 冲突 {report.conflicts}
              <br />
              新增问答 {report.questionsAdded ?? 0} · 问答冲突{" "}
              {report.questionConflicts ?? 0}
              。同时间文章冲突保留本机当前版本；问答冲突保留双方记录。
              <br />
              面试相关新增 {report.interviewsAdded ?? 0} · 冲突保留双方{" "}
              {report.interviewConflicts ?? 0}
            </p>
          )}
        </section>
      </div>
      <div className="info-note">
        <b>合并规则</b>
        <p>
          同一篇文章优先使用采集时间较新的版本；旧版本保留。导入不迁移登录信息、密钥或向量缓存，也不会自动采集网站。若本机已开启自动向量索引，导入资料会发送到所配置的
          Embedding 服务补齐索引。
        </p>
      </div>
      <div className="storage-path">
        <small>当前资料目录</small>
        <code>{state.root}</code>
      </div>
    </>
  );
}
