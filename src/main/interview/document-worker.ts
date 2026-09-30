import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fromBuffer } from "yauzl";
import mammoth from "mammoth";
async function checkZip(buffer: Buffer) {
  await new Promise<void>((resolve, reject) =>
    fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) return reject(Error("Word 文件损坏或已加密"));
        let count = 0,
          size = 0;
        zip.on("error", reject);
        zip.on("end", resolve);
        zip.on("entry", (entry) => {
          if (
            ++count > 10000 ||
            (size += entry.uncompressedSize) > 50 * 1024 * 1024 ||
            entry.generalPurposeBitFlag & 1
          ) {
            zip.close();
            return reject(Error("Word 文档过大或已加密，请精简后导入"));
          }
          zip.readEntry();
        });
        zip.readEntry();
      },
    ),
  );
}
(async () => {
  const bytes = await readFile(workerData.path);
  if (bytes.length > 10 * 1024 * 1024) throw Error("文档超过 10 MiB");
  let text = "";
  if (workerData.extension === ".docx") {
    await checkZip(bytes);
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else {
    const { getDocument, GlobalWorkerOptions } =
      await import("pdfjs-dist/legacy/build/pdf.mjs");
    GlobalWorkerOptions.workerSrc = pathToFileURL(
      join(__dirname, "pdf.worker.mjs"),
    ).href;
    const task = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      disableFontFace: true,
      useWasm: false,
      cMapUrl: pathToFileURL(join(__dirname, "cmaps") + "/").href,
      cMapPacked: true,
      standardFontDataUrl: pathToFileURL(
        join(__dirname, "standard_fonts") + "/",
      ).href,
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 200) throw Error("PDF 超过 200 页，请精简后导入");
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i),
          content = await page.getTextContent();
        text +=
          content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("") + "\n";
        page.cleanup();
        if (text.length > 30000)
          throw Error("提取内容超过 30000 字符，请精简文档");
      }
    } finally {
      await task.destroy();
    }
  }
  parentPort!.postMessage({ text });
})().catch((error) =>
  parentPort!.postMessage({
    error:
      error?.name === "PasswordException"
        ? "PDF 已加密，请解密后导入"
        : /^(文档|Word|PDF|提取)/.test(error?.message)
          ? error.message
          : "文档解析失败，请检查文件或粘贴文字",
  }),
);
