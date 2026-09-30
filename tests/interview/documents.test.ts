import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractDocument } from "../../src/main/interview/documents";
import { docx, pdf } from "./fixtures";
test("local PDF and DOCX extraction rejects empty, invalid, oversized and unsupported input", async () => {
  const root = mkdtempSync(join(tmpdir(), "interview-doc-"));
  try {
    const p = join(root, "resume.pdf"),
      d = join(root, "job.docx");
    writeFileSync(p, pdf("Java engineer"));
    await docx(d, "Redis engineer");
    expect((await extractDocument(p)).text).toContain("Java engineer");
    await expect(extractDocument(p, 1)).rejects.toThrow();
    expect((await extractDocument(d)).text).toContain("Redis engineer");
    writeFileSync(p, pdf(""));
    await expect(extractDocument(p)).rejects.toThrow();
    await docx(d, " ");
    await expect(extractDocument(d)).rejects.toThrow();
    writeFileSync(p, "not pdf");
    await expect(extractDocument(p)).rejects.toThrow();
    writeFileSync(p, Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(extractDocument(p)).rejects.toThrow();
    await expect(extractDocument(join(root, "legacy.doc"))).rejects.toThrow();
    await docx(d, "x".repeat(30001));
    await expect(extractDocument(d)).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
