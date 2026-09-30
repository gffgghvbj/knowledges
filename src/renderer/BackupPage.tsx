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
          <p>包含文章、图片和历史版本。网站登录状态不会放入备份。</p>
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
          <p>保留两边新增的资料，重复内容去重，旧版本依然可以恢复。</p>
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
              同时间冲突保留本机当前版本，双方历史均已保存。
            </p>
          )}
        </section>
      </div>
      <div className="info-note">
        <b>合并规则</b>
        <p>
          同一篇文章优先使用采集时间较新的版本；旧版本保留。导入不会迁移网站登录信息，也不会自动开始采集。
        </p>
      </div>
      <div className="storage-path">
        <small>当前资料目录</small>
        <code>{state.root}</code>
      </div>
    </>
  );
}
