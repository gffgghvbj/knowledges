import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { LibraryRepository } from "../library/repository";
import { InterviewRepository } from "./repository";
import { ModelSettings } from "../knowledge/settings";
import { requestModel } from "../knowledge/model";
import { currentChunks } from "../knowledge/vector-index";
import { packEvidence } from "../knowledge/index";
import {
  questionInputSchema,
  type InterviewQuestion,
} from "../../shared/interview";
import type { Evidence } from "../../shared/knowledge";
import { candidatePrompt } from "./prompts";
export const generatedQuestionSchema = questionInputSchema
  .omit({ id: true })
  .extend({
    evidenceIds: z.array(z.string()).max(12),
    supplement: z.boolean(),
  });
export function makeQuestion(
  value: z.infer<typeof generatedQuestionSchema>,
  evidence: Evidence[],
  origin: InterviewQuestion["origin"],
): InterviewQuestion {
  const ids = new Set(value.evidenceIds),
    selected = evidence.filter((e) => ids.has(e.id));
  if (selected.length !== ids.size) throw Error("题目引用无效，请重试");
  const { evidenceIds, ...rest } = value,
    now = new Date().toISOString();
  return {
    ...rest,
    id: randomUUID(),
    origin,
    evidence: selected,
    supplement: value.supplement || !selected.length,
    createdAt: now,
    updatedAt: now,
  };
}
export class QuestionService {
  private candidates = new Map<
    string,
    { question: InterviewQuestion; expires: number }
  >();
  private busy = false;
  constructor(
    private library: LibraryRepository,
    private repo: InterviewRepository,
    private settings: ModelSettings,
    private model: typeof requestModel = requestModel,
  ) {}
  async propose(
    articleIds: string[],
    count: number,
    provider: "online" | "ollama",
  ): Promise<InterviewQuestion[]> {
    if (this.busy) throw Error("正在整理题目，请稍候");
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 5 ||
      !articleIds.length ||
      articleIds.length > 10
    )
      throw Error("请选择 1–10 篇资料，每次整理 1–5 题");
    const evidence = packEvidence(
      currentChunks(this.library).filter((c) =>
        articleIds.includes(c.articleId),
      ),
    );
    if (!evidence.length) throw Error("选定资料没有可用片段");
    this.busy = true;
    try {
      const text = await this.model(
        this.settings.resolve(provider),
        [
          { role: "system", content: candidatePrompt },
          { role: "user", content: JSON.stringify({ count, evidence }) },
        ],
        AbortSignal.timeout(120000),
      );
      let values: z.infer<typeof generatedQuestionSchema>[];
      try {
        values = z
          .object({ questions: z.array(generatedQuestionSchema).length(count) })
          .parse(JSON.parse(text)).questions;
      } catch {
        throw Error("题目生成格式无效，请重试或更换模型");
      }
      if (
        new Set(values.map((q) => q.prompt.trim().toLowerCase())).size !==
        values.length
      )
        throw Error("模型返回重复题目，请重试");
      const rows = values.map((q) => makeQuestion(q, evidence, "ai-organized"));
      this.candidates.clear();
      for (const question of rows)
        this.candidates.set(question.id, {
          question,
          expires: Date.now() + 30 * 60 * 1000,
        });
      return rows;
    } finally {
      this.busy = false;
    }
  }
  acceptCandidates(ids: string[]): InterviewQuestion[] {
    const rows = [...new Set(ids)].map((id) => {
      const entry = this.candidates.get(id);
      if (!entry || entry.expires < Date.now())
        throw Error("候选题已过期，请重新生成");
      return entry.question;
    });
    for (const row of rows)
      if (!this.repo.listQuestions().some((q) => q.id === row.id))
        this.repo.putQuestion(row);
    return rows;
  }
}
