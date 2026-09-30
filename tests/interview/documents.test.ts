import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractDocument } from "../../src/main/interview/documents";
import { ZipFile } from "yazl";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
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
    writeFileSync(p, pdf("", true));
    expect((await extractDocument(p)).text).toContain("中文");
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

test("compressed Word expansion are rejected before extraction", async () => {
  const root = mkdtempSync(join(tmpdir(), "interview-zip-"));
  try {
    const path = join(root, "large.docx"),
      zip = new ZipFile();
    const done = pipeline(zip.outputStream, createWriteStream(path));
    zip.addBuffer(Buffer.alloc(51 * 1024 * 1024, 65), "word/document.xml");
    zip.end();
    await done;
    await expect(extractDocument(path)).rejects.toThrow("过大或已加密");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("Word rejects a forged uncompressed size and encrypted entries", async () => {
  const root = mkdtempSync(join(tmpdir(), "interview-forged-"));
  try {
    const path = join(root, "forged.docx");
    await docx(path, "Valid text ".repeat(100));
    const bytes = readFileSync(path);
    for (let offset = 0; offset < bytes.length - 46; offset++) {
      if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
      const n = bytes.readUInt16LE(offset + 28);
      if (
        bytes.subarray(offset + 46, offset + 46 + n).toString() ===
        "word/document.xml"
      )
        bytes.writeUInt32LE(1, offset + 24);
    }
    writeFileSync(path, bytes);
    await expect(extractDocument(path)).rejects.toThrow("Word 文件损坏");
    await docx(path, "Encrypted text");
    const encrypted = readFileSync(path);
    for (let offset = 0; offset < encrypted.length - 46; offset++) {
      if (encrypted.readUInt32LE(offset) === 0x02014b50)
        encrypted.writeUInt16LE(
          encrypted.readUInt16LE(offset + 8) | 1,
          offset + 8,
        );
    }
    writeFileSync(path, encrypted);
    await expect(extractDocument(path)).rejects.toThrow("已加密");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
