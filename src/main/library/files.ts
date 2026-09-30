import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  realpathSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function safePath(root: string, path: string): string {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path)
  )
    throw new Error("非法文件路径");
  const target = resolve(root, path),
    rel = relative(resolve(root), target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("路径超出资料库");
  let cursor = target;
  while (cursor !== resolve(root)) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error("资料路径不能包含符号链接");
    cursor = dirname(cursor);
  }
  if (
    existsSync(target) &&
    !realpathSync(target).startsWith(realpathSync(root) + sep)
  )
    throw new Error("路径超出资料库");
  return target;
}
export function atomicWrite(path: string, content: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}
export function normalizeUrl(input: string) {
  const url = new URL(input);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("请输入 HTTP 或 HTTPS 网站地址");
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|spm$|from$)/.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
