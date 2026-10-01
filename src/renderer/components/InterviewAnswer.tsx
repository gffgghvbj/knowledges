import { useEffect, useState } from "react";
import { api } from "../api";
// Own the hot input state so each keystroke does not re-render history or feedback.
export function InterviewAnswer({
  id,
  index,
  initial,
  cache,
  busy,
  submit,
}: {
  id: string;
  index: number;
  initial: string;
  cache: Map<string, string>;
  busy: boolean;
  submit: (text: string) => Promise<void>;
}) {
  const key = `${id}:${index}`;
  const [text, setText] = useState(cache.get(key) ?? initial);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      void api.flushInterviewDrafts().catch(() => {});
    },
    [],
  );
  const flush = () =>
    void api
      .flushInterviewDrafts()
      .catch(() => setError("草稿保存失败，请检查磁盘后重试"));
  return (
    <>
      <label>
        本题回答
        <textarea
          aria-label="本题回答"
          rows={10}
          maxLength={12000}
          value={text}
          placeholder="用自己的语言说明思路、依据和取舍…"
          onBlur={flush}
          onChange={(e) => {
            const value = e.target.value;
            cache.set(key, value);
            setText(value);
            void api
              .saveInterviewDraft(id, index, value)
              .catch(() => setError("草稿保存失败，请重试"));
          }}
        />
      </label>
      <small>{text.length} / 12000 字符 · 草稿自动保存在本机</small>
      {error && (
        <p role="alert">
          {error}
          <button onClick={flush}>重试保存</button>
        </p>
      )}
      <button
        className="primary"
        disabled={busy || !text.trim()}
        onClick={() => void submit(text)}
      >
        提交回答
      </button>
    </>
  );
}
