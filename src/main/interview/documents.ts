import { Worker } from "node:worker_threads";
import { stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
export async function extractDocument(
  path: string,
  timeoutMs = 30000,
): Promise<{ name: string; text: string }> {
  const extension = extname(path).toLowerCase();
  if (![".pdf", ".docx"].includes(extension))
    throw Error("仅支持文本型 PDF 与 Word .docx；旧 .doc 请转换格式或粘贴文字");
  const info = await stat(path);
  if (!info.isFile() || info.size > 10 * 1024 * 1024)
    throw Error("文档必须小于或等于 10 MiB");
  const local = join(__dirname, "document-worker.cjs");
  const workerPath = existsSync(local)
    ? local
    : join(process.cwd(), "dist/main/document-worker.cjs");
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: { path, extension },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const timer = setTimeout(
      () => finish(Error("文档解析超时，请精简文件或粘贴文字")),
      timeoutMs,
    );
    let settled = false;
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve({ name: basename(path, extension), text: text! });
    };
    worker.once("message", (result) => {
      if (result.error) return finish(Error(result.error));
      const text = String(result.text ?? "")
        .replace(/\u0000/g, "")
        .trim();
      if (!text || !/[\p{L}\p{N}]/u.test(text))
        return finish(
          Error("未提取到有效文字；扫描 PDF 需先 OCR 或直接粘贴文字"),
        );
      if (text.length > 30000)
        return finish(Error("提取内容超过 30000 字符，请精简文档"));
      finish(undefined, text);
    });
    worker.once("error", () =>
      finish(Error("文档解析失败，请检查文件或粘贴文字")),
    );
    worker.once("exit", () => {
      if (!settled) finish(Error("文档解析中断，请转换格式或粘贴文字"));
    });
  });
}
