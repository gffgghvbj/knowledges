import { test, expect, vi } from "vitest";
import { DraftBuffer } from "../../src/main/interview/drafts";
test("burst typing coalesces writes; flushing navigation/close preserves final text", () => {
  vi.useFakeTimers();
  try {
    const save = vi.fn(),
      drafts = new DraftBuffer(save);
    for (let i = 0; i < 100; i++) drafts.set("one", 0, `中文草稿${i}`);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(save).toHaveBeenCalledExactlyOnceWith("one", 0, "中文草稿99");
    drafts.set("one", 0, "末尾文字");
    drafts.flush();
    expect(save).toHaveBeenLastCalledWith("one", 0, "末尾文字");
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
test("failed disk writes remain retryable; delete/submit discard pending drafts", () => {
  vi.useFakeTimers();
  try {
    const save = vi.fn().mockImplementationOnce(() => {
        throw Error("disk");
      }),
      drafts = new DraftBuffer(save);
    drafts.set("one", 0, "keep");
    vi.advanceTimersByTime(400);
    drafts.flush();
    expect(save).toHaveBeenLastCalledWith("one", 0, "keep");
    drafts.set("deleted", 0, "do not resurrect");
    drafts.discard("deleted");
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
