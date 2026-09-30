import { contextBridge, ipcRenderer } from "electron";
const names = [
  "getStatus",
  "state",
  "addSource",
  "login",
  "scan",
  "capture",
  "update",
  "control",
  "read",
  "versions",
  "restore",
  "search",
  "openArticle",
  "openUrl",
  "exportBackup",
  "inspectBackup",
  "importBackup",
];
contextBridge.exposeInMainWorld(
  "libraryApi",
  Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]) => ipcRenderer.invoke(`library:${name}`, ...args),
    ]),
  ),
);
