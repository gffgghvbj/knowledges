export class DraftBuffer {
  private pending = new Map<string, { index: number; text: string }>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private save: (id: string, index: number, text: string) => void,
    private delay = 400,
  ) {}
  set(id: string, index: number, text: string) {
    if (!this.pending.has(id) && this.pending.size >= 100) this.flush();
    this.pending.set(id, { index, text });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // Keep unsaved entries for an explicit flush/retry if the disk is unavailable.
      try {
        this.flush();
      } catch {}
    }, this.delay);
  }
  discard(id: string) {
    this.pending.delete(id);
  }
  flush() {
    clearTimeout(this.timer);
    for (const [id, value] of this.pending) {
      this.save(id, value.index, value.text);
      this.pending.delete(id);
    }
  }
}
