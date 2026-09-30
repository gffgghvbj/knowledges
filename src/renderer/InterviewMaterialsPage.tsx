import { useEffect, useState } from "react";
import { api } from "./api";
import type { Run } from "./App";
import type { InterviewMaterial, MaterialInput } from "../shared/interview";
const empty: MaterialInput = { name: "", kind: "resume", text: "" };
export function InterviewMaterialsPage({ run }: { run: Run }) {
  const [items, setItems] = useState<InterviewMaterial[]>([]),
    [form, setForm] = useState<MaterialInput>(empty),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [deleting, setDeleting] = useState<string | null>(null);
  const refresh = async () => setItems(await api.interviewMaterials());
  useEffect(() => {
    void run(refresh);
  }, []);
  const act = (fn: () => Promise<void>) =>
    run(async () => {
      setBusy(true);
      setMessage("");
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR EXPERIENCE, YOUR NEXT ROLE</div>
          <h2>面试资料</h2>
          <p>准备简历与职位描述，让面试围绕你的经历和目标展开。</p>
        </div>
        <button disabled={busy} onClick={() => setForm(empty)}>
          新建资料
        </button>
      </div>
      <div className="interview-grid">
        <aside className="source-card">
          <h3>已保存资料</h3>
          {items.map((m) => (
            <button
              className="article-item material-item"
              key={m.id}
              disabled={busy}
              onClick={() => {
                setForm(m);
                setMessage("");
              }}
            >
              <strong>{m.name}</strong>
              <small>
                {m.kind === "resume" ? "简历" : "职位描述"} · {m.text.length}{" "}
                字符
              </small>
            </button>
          ))}
          {!items.length && <p>保存后的简历和 JD 会出现在这里。</p>}
        </aside>
        <form
          className="source-card interview-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api.saveInterviewMaterial(form);
              await refresh();
              setForm({ ...empty, kind: form.kind });
              setMessage("资料已保存");
            });
          }}
        >
          <div className="form-pair">
            <label>
              资料类型
              <select
                aria-label="资料类型"
                value={form.kind}
                disabled={busy}
                onChange={(e) =>
                  setForm({ ...form, kind: e.target.value as "resume" | "jd" })
                }
              >
                <option value="resume">简历</option>
                <option value="jd">职位描述 JD</option>
              </select>
            </label>
            <label>
              资料名称
              <input
                aria-label="资料名称"
                value={form.name}
                maxLength={100}
                disabled={busy}
                required
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const result = await api.importInterviewDocument();
                if (result) {
                  setForm({ ...form, id: undefined, ...result });
                  setMessage("已提取，请检查并修正后确认保存。");
                }
              })
            }
          >
            {busy ? "正在处理…" : "导入 PDF / DOCX"}
          </button>
          <label>
            资料正文
            <textarea
              aria-label="资料正文"
              rows={16}
              value={form.text}
              maxLength={30000}
              disabled={busy}
              required
              placeholder="粘贴简历或 JD，或导入文件后在这里检查和修改。"
              onChange={(e) => setForm({ ...form, text: e.target.value })}
            />
          </label>
          <small>
            {form.text.length} / 30000 字符 · 支持文本 PDF、.docx；扫描 PDF 请先
            OCR，旧 .doc 请转换格式。
          </small>
          <div className="card-actions">
            <button
              className="primary"
              disabled={busy || !form.name.trim() || !form.text.trim()}
            >
              确认保存资料
            </button>
            {form.id && (
              <button
                type="button"
                className="danger-text"
                disabled={busy}
                onClick={() => setDeleting(form.id!)}
              >
                删除资料
              </button>
            )}
          </div>
          {message && <p role="status">{message}</p>}
        </form>
      </div>
      <div className="info-note">
        文件在本机提取，只有确认保存的文本会用于面试。使用在线模型时，会向你配置的服务发送选中的简历、JD、回答和相关资料片段；原始文件不存入备份。
      </div>
      {deleting && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="删除资料"
          >
            <h3>删除这份资料？</h3>
            <p>已有面试中的资料快照会保留。</p>
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setDeleting(null)}>
                取消
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api.deleteInterviewMaterial(deleting);
                    await refresh();
                    setForm(empty);
                    setDeleting(null);
                  })
                }
              >
                确认删除
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
