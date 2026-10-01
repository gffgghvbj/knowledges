import { useState } from "react";
export function ConfirmDelete({
  title,
  description,
  action = "确认删除",
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  action?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3>{title}</h3>
        <p>{description}</p>
        <div className="modal-actions">
          <button disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            className="danger-button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
          >
            {busy ? "正在处理…" : action}
          </button>
        </div>
      </section>
    </div>
  );
}
