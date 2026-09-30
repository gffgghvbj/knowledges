import { build as bundle } from 'esbuild';
import { build } from 'vite';
import { mkdir } from 'node:fs/promises';
await mkdir('dist/main', { recursive: true });
await bundle({ entryPoints: ['src/main/app.ts'], outfile: 'dist/main/app.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'better-sqlite3'], sourcemap: true });
await bundle({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/main/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await build({ root: 'src/renderer', base: './', build: { outDir: '../../dist/renderer', emptyOutDir: true } });
