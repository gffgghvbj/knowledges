import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWrite, hash } from "../library/files";
import { endpoint, type SecretCodec } from "./settings";
import {
  retrievalSettingsSchema,
  type RetrievalInput,
  type RetrievalConfig,
} from "../../shared/retrieval";
const storedSchema = retrievalSettingsSchema.extend({
  embedding: retrievalSettingsSchema.shape.embedding
    .omit({ apiKey: true, clearKey: true })
    .extend({ encryptedKey: z.string().optional() }),
  rerank: retrievalSettingsSchema.shape.rerank
    .omit({ apiKey: true, clearKey: true })
    .extend({ encryptedKey: z.string().optional() }),
});
type Stored = z.infer<typeof storedSchema>;
export class RetrievalSettings {
  private file: string;
  constructor(
    root: string,
    private codec: SecretCodec,
  ) {
    this.file = join(root, "retrieval-settings.json");
  }
  private load(): Stored {
    if (existsSync(this.file))
      return storedSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    return {
      enabled: false,
      minSimilarity: 0.2,
      embedding: {
        protocol: "dashscope",
        url: "",
        model: "qwen3.7-text-embedding-flash",
        dimensions: 1024,
      },
      rerank: {
        enabled: true,
        protocol: "dashscope",
        url: "",
        model: "qwen3.7-text-rerank",
      },
    };
  }
  get(): RetrievalConfig {
    const s = this.load();
    const { encryptedKey: ek, ...e } = s.embedding,
      { encryptedKey: rk, ...r } = s.rerank;
    return {
      ...s,
      embedding: { ...e, hasKey: !!ek },
      rerank: { ...r, hasKey: !!rk },
    };
  }
  save(raw: RetrievalInput): RetrievalConfig {
    const input = retrievalSettingsSchema.parse(raw),
      old = this.load();
    const secure = (
      part: RetrievalInput["embedding"] | RetrievalInput["rerank"],
      previous: Stored["embedding"] | Stored["rerank"],
      required: boolean,
    ) => {
      const { apiKey, clearKey, ...rest } = part;
      const url = part.url ? endpoint(part.url) : "";
      if (required && !url) throw Error("请填写完整的向量 / 精排接口地址");
      let encryptedKey =
        url === previous.url && !clearKey ? previous.encryptedKey : undefined;
      if (part.protocol === "ollama") encryptedKey = undefined;
      else if (apiKey?.trim()) {
        if (!this.codec.isEncryptionAvailable())
          throw Error("系统密钥存储不可用，未保存设置");
        encryptedKey = this.codec
          .encryptString(apiKey.trim())
          .toString("base64");
      }
      return { ...rest, url, encryptedKey };
    };
    const next = storedSchema.parse({
      ...input,
      embedding: secure(input.embedding, old.embedding, input.enabled),
      rerank: secure(
        input.rerank,
        old.rerank,
        input.enabled && input.rerank.enabled,
      ),
    });
    atomicWrite(this.file, JSON.stringify(next));
    return this.get();
  }
  resolve() {
    const s = this.load();
    const unlock = <T extends { url: string; encryptedKey?: string }>(
      part: T,
    ) => {
      const { encryptedKey, ...rest } = part;
      let apiKey = "";
      if (encryptedKey) {
        try {
          apiKey = this.codec.decryptString(
            Buffer.from(encryptedKey, "base64"),
          );
        } catch {
          throw Error("无法解密检索密钥，请重新填写");
        }
      }
      return { ...rest, apiKey };
    };
    return { ...s, embedding: unlock(s.embedding), rerank: unlock(s.rerank) };
  }
}
export type ResolvedRetrieval = ReturnType<RetrievalSettings["resolve"]>;
export function embeddingFingerprint(config: RetrievalConfig["embedding"]) {
  return hash(
    JSON.stringify([
      "title-quote-v1",
      config.protocol,
      config.url,
      config.model,
      config.dimensions,
    ]),
  );
}
