import { build as bundle } from "esbuild";
import { build } from "vite";
import { mkdir, cp } from "node:fs/promises";
await mkdir("dist/main", { recursive: true });
await bundle({
  entryPoints: ["src/main/app.ts"],
  outfile: "dist/main/app.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "better-sqlite3"],
  sourcemap: true,
});
await bundle({
  entryPoints: ["src/preload/index.ts"],
  outfile: "dist/main/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await bundle({
  entryPoints: ["src/main/interview/document-worker.ts"],
  outfile: "dist/main/document-worker.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["pdfjs-dist/*"],
});
await cp(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "dist/main/pdf.worker.mjs",
);
await cp("node_modules/pdfjs-dist/cmaps", "dist/main/cmaps", {
  recursive: true,
});
await cp("node_modules/pdfjs-dist/standard_fonts", "dist/main/standard_fonts", {
  recursive: true,
});
await build({
  root: "src/renderer",
  base: "./",
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
});
