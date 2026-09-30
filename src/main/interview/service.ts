import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  configSchema,
  type InterviewConfig,
  type InterviewSession,
  type InterviewQuestion,
} from "../../shared/interview";
import type { LibraryRepository } from "../library/repository";
import type { Retriever } from "../knowledge/hybrid";
import { InterviewRepository } from "./repository";
import { ModelSettings } from "../knowledge/settings";
import { requestModel } from "../knowledge/model";
import { generatedQuestionSchema, makeQuestion } from "./questions";
import { dimensionsFor, parseGrade } from "./scoring";
import {
  INTERVIEW_RULES,
  newQuestionPrompt,
  selectionPrompt,
  scoringPrompt,
} from "./prompts";
export class InterviewService {
  private running = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private closed = false;
  constructor(
    private library: LibraryRepository,
    private repo: InterviewRepository,
    private settings: ModelSettings,
    private retriever: Retriever,
    private model: typeof requestModel = requestModel,
    private timeoutMs = 120000,
  ) {
    for (const session of repo.listSessions())
      if (["preparing", "grading"].includes(session.status)) {
        session.status = "failed";
        session.error = "上次请求被中断，已保存进度，请重试";
        repo.putSession(session);
      }
  }
  create(raw: InterviewConfig): string {
    if (this.closed) throw Error("面试服务已关闭");
    if (this.running.size >= 2) throw Error("最多同时处理两场面试，请稍候");
    const config = configSchema.parse(raw),
      materials = this.repo.listMaterials(),
      resume = materials.find(
        (m) => m.id === config.resumeId && m.kind === "resume",
      ),
      jd = materials.find((m) => m.id === config.jdId && m.kind === "jd");
    if (config.scope === "job" && (!resume || !jd))
      throw Error("岗位面试需要选择已保存的简历和 JD");
    const unique = new Set<string>();
    let candidates = this.repo
      .listQuestions()
      .filter(
        (q) =>
          q.difficulty === config.difficulty &&
          (!config.topic ||
            (q.prompt + " " + q.knowledgePoints.join(" "))
              .toLowerCase()
              .includes(config.topic.toLowerCase())) &&
          config.knowledgePoints.every((k) => q.knowledgePoints.includes(k)),
      )
      .filter((q) => {
        const key = q.prompt.trim().toLowerCase();
        if (unique.has(key)) return false;
        unique.add(key);
        return true;
      });
    if (config.mode === "bank" && candidates.length < config.questionCount)
      throw Error(
        `题库仅有 ${candidates.length} 道符合条件的不重复题目，请减少题量或调整范围`,
      );
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const session: InterviewSession = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      config,
      resume: config.scope === "job" ? resume : undefined,
      jd: config.scope === "job" ? jd : undefined,
      rulesVersion: INTERVIEW_RULES,
      status: "preparing",
      turns: [],
      bankQueue:
        config.mode === "bank"
          ? candidates.slice(
              0,
              config.scope === "job" ? 100 : config.questionCount,
            )
          : [],
      retryStep:
        config.mode === "bank" && config.scope === "job"
          ? "select"
          : "question",
    };
    this.repo.putSession(session);
    this.launch(session.id);
    return session.id;
  }
  saveDraft(id: string, index: number, text: string) {
    if (text.length > 12000) throw Error("回答最多 12000 字符");
    const s = this.repo.getSession(id);
    if (!s || s.status !== "awaiting-answer" || index !== s.turns.length - 1)
      return;
    s.turns[index].draft = text;
    this.repo.putSession(s);
  }
  submit(id: string, index: number, answer: string) {
    const s = this.repo.getSession(id);
    if (
      !s ||
      s.status !== "awaiting-answer" ||
      index !== s.turns.length - 1 ||
      this.running.has(id)
    )
      return;
    const value = z.string().trim().min(1).max(12000).parse(answer);
    s.turns[index].answer = value;
    s.turns[index].draft = value;
    s.turns[index].submittedAt = new Date().toISOString();
    s.status = "grading";
    s.retryStep = "grade";
    s.error = undefined;
    this.repo.putSession(s);
    this.launch(id);
  }
  next(id: string) {
    const s = this.repo.getSession(id);
    if (!s || s.status !== "awaiting-next" || this.running.has(id)) return;
    if (s.turns.length >= s.config.questionCount) return;
    s.status = "preparing";
    s.retryStep = "question";
    s.error = undefined;
    this.repo.putSession(s);
    this.launch(id);
  }
  retry(id: string) {
    const s = this.repo.getSession(id);
    if (!s || s.status !== "failed" || !s.retryStep || this.running.has(id))
      return;
    s.status = s.retryStep === "grade" ? "grading" : "preparing";
    s.error = undefined;
    this.repo.putSession(s);
    this.launch(id);
  }
  finish(id: string) {
    const s = this.repo.getSession(id);
    if (!s || ["completed", "aborted"].includes(s.status)) return;
    this.running.get(id)?.controller.abort();
    s.status = "aborted";
    s.endedAt = new Date().toISOString();
    s.retryStep = undefined;
    s.error = undefined;
    this.repo.putSession(s);
  }
  delete(id: string) {
    this.running.get(id)?.controller.abort();
    this.repo.deleteSession(id);
  }
  close() {
    this.closed = true;
    for (const run of this.running.values()) run.controller.abort();
  }
  async waitForIdle() {
    await Promise.all([...this.running.values()].map((r) => r.promise));
  }
  private launch(id: string) {
    if (this.closed || this.running.has(id)) return;
    if (this.running.size >= 2) {
      const s = this.repo.getSession(id)!;
      s.status = "failed";
      s.error = "最多同时处理两场面试，请稍后重试";
      this.repo.putSession(s);
      return;
    }
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => this.process(id, controller))
      .finally(() => {
        if (this.running.get(id)?.controller === controller)
          this.running.delete(id);
      });
    this.running.set(id, { controller, promise });
  }
  private async process(id: string, controller: AbortController) {
    const s = this.repo.getSession(id);
    if (!s) return;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);
    const persist = () => {
      signal.throwIfAborted();
      if (this.closed || !this.repo.getSession(id)) throw Error("closed");
      this.repo.putSession(s);
    };
    const call = async (task: string, instruction: string, data: unknown) => {
      signal.throwIfAborted();
      const profile = this.settings.resolve(s.config.provider);
      if (task === "select") s.selectionModel = profile.model;
      if (task === "grade") s.turns.at(-1)!.gradeModel = profile.model;
      persist();
      const text = await this.model(
        profile,
        [
          { role: "system", content: instruction },
          {
            role: "user",
            content: JSON.stringify({ task, ...(data as object) }),
          },
        ],
        signal,
      );
      signal.throwIfAborted();
      return { text, model: profile.model };
    };
    try {
      signal.throwIfAborted();
      if (s.retryStep === "select") {
        const result = await call("select", selectionPrompt, {
          count: s.config.questionCount,
          resume: s.resume,
          jd: s.jd,
          candidates: s.bankQueue.map((q) => ({
            id: q.id,
            prompt: q.prompt.slice(0, 1000),
            knowledgePoints: q.knowledgePoints,
            kind: q.kind,
          })),
        });
        let ids: string[];
        try {
          ids = z
            .object({ ids: z.array(z.string()).length(s.config.questionCount) })
            .parse(JSON.parse(result.text)).ids;
        } catch {
          throw Error("面试选题格式无效，请重试");
        }
        if (
          new Set(ids).size !== ids.length ||
          ids.some((id) => !s.bankQueue.some((q) => q.id === id))
        )
          throw Error("面试选题包含未知或重复题目，请重试");
        s.bankQueue = ids.map((id) => s.bankQueue.find((q) => q.id === id)!);
        s.retryStep = "question";
        persist();
      }
      if (s.retryStep === "question") {
        let question: InterviewQuestion,
          isFollowup = false,
          questionModel: string | undefined;
        if (s.config.mode === "bank") question = s.bankQueue[s.turns.length];
        else {
          const last = s.turns.at(-1),
            query =
              (
                s.config.topic +
                " " +
                s.config.knowledgePoints.join(" ") +
                " " +
                (last?.question.prompt ?? s.jd?.text ?? "")
              )
                .trim()
                .slice(0, 4000) || "面试技术基础";
          const { evidence } = await this.retriever.retrieve(query, {}, signal);
          signal.throwIfAborted();
          const result = await call("question", newQuestionPrompt, {
            config: s.config,
            resume: s.resume,
            jd: s.jd,
            history: s.turns.map((t) => ({
              question: t.question.prompt,
              answer: t.answer?.slice(0, 4000),
            })),
            evidence,
          });
          let response: {
            question: z.infer<typeof generatedQuestionSchema>;
            isFollowup: boolean;
          };
          try {
            response = z
              .object({
                question: generatedQuestionSchema,
                isFollowup: z.boolean(),
              })
              .parse(JSON.parse(result.text));
          } catch {
            throw Error("面试题目格式无效，请重试");
          }
          question = makeQuestion(
            { ...response.question, difficulty: s.config.difficulty },
            evidence,
            "ai-extended",
          );
          isFollowup = !!s.turns.length && response.isFollowup;
          questionModel = result.model;
        }
        if (
          !question ||
          s.turns.some(
            (t) =>
              t.question.prompt.trim().toLowerCase() ===
              question.prompt.trim().toLowerCase(),
          )
        )
          throw Error("面试题目为空或重复，请重试");
        s.turns.push({ question, isFollowup, questionModel, draft: "" });
        s.status = "awaiting-answer";
        s.retryStep = undefined;
        persist();
      } else if (s.retryStep === "grade") {
        const turn = s.turns.at(-1)!;
        const result = await call("grade", scoringPrompt, {
          question: turn.question,
          answer: turn.answer,
          dimensions: dimensionsFor(turn.question.kind),
          resume: s.resume,
          jd: s.jd,
          history: s.turns
            .slice(0, -1)
            .map((t) => ({
              question: t.question.prompt,
              answer: t.answer?.slice(0, 4000),
            })),
        });
        turn.grade = parseGrade(
          result.text,
          turn.question.kind,
          turn.question.evidence,
        );
        turn.gradeModel = result.model;
        turn.gradedAt = new Date().toISOString();
        s.status =
          s.turns.length >= s.config.questionCount
            ? "completed"
            : "awaiting-next";
        s.retryStep = undefined;
        if (s.status === "completed") s.endedAt = new Date().toISOString();
        persist();
      }
    } catch (e) {
      if (controller.signal.aborted || this.closed || !this.repo.getSession(id))
        return;
      s.status = "failed";
      const message = e instanceof Error ? e.message : "";
      s.error = signal.aborted
        ? "面试请求超时，回答已保存，请重试"
        : /^(面试|评分|题目|请先|API Key|模型|系统|无法解密|检索)/.test(message)
          ? message.slice(0, 500)
          : "面试服务连接或响应失败，进度已保存，请重试";
      this.repo.putSession(s);
    }
  }
}
