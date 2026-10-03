import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";
import type { SyncSettings } from "../../shared/sync";

const FILE = "sync-settings.json";

interface Stored {
  endpoint?: string;
  tokenEncrypted?: string;
}

export class SyncSettingsStore {
  constructor(private readonly root: string) {}
  private get path() {
    return join(this.root, FILE);
  }
  get(): SyncSettings {
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Stored;
      return { endpoint: raw.endpoint ?? "" };
    } catch {
      return { endpoint: "" };
    }
  }
  hasToken(): boolean {
    return existsSync(this.path) && !!(this.read().tokenEncrypted);
  }
  token(): string | undefined {
    const stored = this.read();
    if (!stored.tokenEncrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(stored.tokenEncrypted, "base64"));
  }
  save(input: SyncSettings & { token?: string }) {
    if (input.token) {
      if (!safeStorage.isEncryptionAvailable())
        throw Error("系统密钥存储不可用时拒绝保存密钥");
    } else if (input.token === undefined && !this.hasToken()) {
      throw Error("请先填写同步密钥");
    }
    const stored: Stored = { endpoint: input.endpoint };
    const token = input.token ?? this.token();
    if (token)
      stored.tokenEncrypted = safeStorage
        .encryptString(token)
        .toString("base64");
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(stored, null, 2));
    renameSync(tmp, this.path);
  }
  private read(): Stored {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Stored;
    } catch {
      return {};
    }
  }
}
