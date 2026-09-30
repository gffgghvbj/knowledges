import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWrite } from "../library/files";
import {
  profileSchema,
  type ProfileInput,
  type ModelProfile,
} from "../../shared/knowledge";
export interface SecretCodec {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}
const storedSchema = z.array(
  z.object({
    provider: z.enum(["online", "ollama"]),
    baseUrl: z.string(),
    model: z.string(),
    encryptedKey: z.string().optional(),
  }),
);
type Stored = z.infer<typeof storedSchema>[number];
export function endpoint(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw Error("请输入有效的模型服务地址");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (
    (u.protocol !== "https:" && !(local && u.protocol === "http:")) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw Error(
      "模型地址需要 HTTPS；本机服务可以使用 HTTP，地址不能包含密码或查询参数",
    );
  return u.href.replace(/\/+$/, "");
}
export class ModelSettings {
  private file: string;
  constructor(
    root: string,
    private codec: SecretCodec,
  ) {
    this.file = join(root, "model-settings.json");
  }
  private load(): Stored[] {
    if (existsSync(this.file))
      return storedSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    return [
      {
        provider: "online",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-flash",
      },
      {
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3:8b",
      },
    ];
  }
  list(): ModelProfile[] {
    return this.load().map(({ encryptedKey, ...p }) => ({
      ...p,
      hasKey: !!encryptedKey,
    }));
  }
  save(raw: ProfileInput) {
    const input = profileSchema.parse(raw),
      baseUrl = endpoint(input.baseUrl),
      all = this.load(),
      old = all.find((p) => p.provider === input.provider);
    let encryptedKey =
      old?.baseUrl === baseUrl && !input.clearKey
        ? old.encryptedKey
        : undefined;
    if (input.provider === "ollama") encryptedKey = undefined;
    else if (input.apiKey?.trim()) {
      if (!this.codec.isEncryptionAvailable())
        throw Error("系统密钥存储不可用，未保存 API Key");
      encryptedKey = this.codec
        .encryptString(input.apiKey.trim())
        .toString("base64");
    }
    const next: Stored = {
      provider: input.provider,
      baseUrl,
      model: input.model,
      encryptedKey,
    };
    atomicWrite(
      this.file,
      JSON.stringify(
        [...all.filter((p) => p.provider !== input.provider), next].sort(
          (a, b) => (a.provider === "online" ? -1 : 1),
        ),
      ),
    );
    return this.list();
  }
  resolve(provider: "online" | "ollama") {
    const p = this.load().find((p) => p.provider === provider);
    if (!p) throw Error("请先保存模型设置");
    let apiKey = "";
    if (p.encryptedKey) {
      try {
        apiKey = this.codec.decryptString(
          Buffer.from(p.encryptedKey, "base64"),
        );
      } catch {
        throw Error("无法解密 API Key，请在模型设置中重新填写");
      }
    }
    if (provider === "online" && !apiKey)
      throw Error("请先在模型设置中填写 API Key");
    return { provider, baseUrl: endpoint(p.baseUrl), model: p.model, apiKey };
  }
}
