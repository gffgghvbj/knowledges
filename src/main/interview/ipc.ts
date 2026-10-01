import { ReviewRepository } from "./reviews";
import { reviewStateSchema } from "../../shared/review";
import { DraftBuffer } from "./drafts";
import { InterviewService } from "./service";
import { projectSession } from "./projection";
import { configSchema } from "../../shared/interview";
import type { Retriever } from "../knowledge/hybrid";
import { QuestionService } from "./questions";
import { ModelSettings } from "../knowledge/settings";
import { questionInputSchema, providerSchema } from "../../shared/interview";
import { dialog, type BrowserWindow } from "electron";
import { z } from "zod";
import type { LibraryRepository } from "../library/repository";
import { InterviewRepository } from "./repository";
import { extractDocument } from "./documents";
import { interviewId, materialInputSchema } from "../../shared/interview";
export type IpcHandle = (
  name: string,
  schema: z.ZodType,
  fn: (...args: any[]) => unknown,
) => void;
export function registerInterviewIpc(
  handle: IpcHandle,
  win: BrowserWindow,
  library: LibraryRepository,
  settings: ModelSettings,
  retriever: Retriever,
) {
  const repo = new InterviewRepository(library.db);
  const reviews = new ReviewRepository(library.db);
  handle("reviewSummaries", z.tuple([]), () => reviews.summaries());
  handle("reviewItem", z.tuple([interviewId]), (id) => reviews.get(id) ?? null);
  handle(
    "addReview",
    z.tuple([interviewId, z.number().int().min(0).max(19)]),
    (id, index) => reviews.add(id, index),
  );
  handle(
    "setReviewState",
    z.tuple([interviewId, reviewStateSchema]),
    (id, state) => reviews.setState(id, state),
  );
  handle("deleteReview", z.tuple([interviewId]), (id) => reviews.delete(id));
  handle(
    "practiceReview",
    z.tuple([interviewId, providerSchema]),
    (id, provider) => service.createReview(id, provider),
  );
  const questions = new QuestionService(library, repo, settings);
  const service = new InterviewService(library, repo, settings, retriever);
  const drafts = new DraftBuffer((id, index, text) =>
    service.saveDraft(id, index, text),
  );
  win.on("close", (event) => {
    try {
      drafts.flush();
    } catch {
      event.preventDefault();
      dialog.showErrorBox(
        "草稿尚未保存",
        "无法写入资料库，请检查磁盘后再关闭。",
      );
    }
  });
  handle("flushInterviewDrafts", z.tuple([]), () => drafts.flush());
  handle("interviewSessions", z.tuple([]), () => {
    drafts.flush();
    return repo.listSessions().map(projectSession);
  });
  handle("interviewSessionSummaries", z.tuple([]), () =>
    repo.sessionSummaries(),
  );
  handle("interviewSession", z.tuple([interviewId]), (id) => {
    drafts.flush();
    const session = repo.getSession(id);
    return session ? projectSession(session) : null;
  });
  handle("interviewMaterialSummaries", z.tuple([]), () =>
    repo.materialSummaries(),
  );
  handle(
    "interviewMaterial",
    z.tuple([interviewId]),
    (id) => repo.getMaterial(id) ?? null,
  );
  handle("interviewQuestionSummaries", z.tuple([]), () =>
    repo.questionSummaries(),
  );
  handle(
    "interviewQuestion",
    z.tuple([interviewId]),
    (id) => repo.getQuestion(id) ?? null,
  );
  handle("createInterview", z.tuple([configSchema]), (config) =>
    service.create(config),
  );
  handle(
    "saveInterviewDraft",
    z.tuple([
      interviewId,
      z.number().int().min(0).max(19),
      z.string().max(12000),
    ]),
    (id, index, text) => drafts.set(id, index, text),
  );
  handle(
    "submitInterviewAnswer",
    z.tuple([
      interviewId,
      z.number().int().min(0).max(19),
      z.string().trim().min(1).max(12000),
    ]),
    (id, index, text) => {
      service.submit(id, index, text);
      drafts.discard(id);
    },
  );
  handle("nextInterview", z.tuple([interviewId]), (id) => service.next(id));
  handle("retryInterview", z.tuple([interviewId]), (id) => service.retry(id));
  handle("finishInterview", z.tuple([interviewId]), (id) => {
    drafts.flush();
    service.finish(id);
  });
  handle("deleteInterview", z.tuple([interviewId]), (id) => {
    drafts.discard(id);
    service.delete(id);
  });
  handle("interviewQuestions", z.tuple([]), () => repo.listQuestions());
  handle("saveInterviewQuestion", z.tuple([questionInputSchema]), (input) =>
    repo.saveQuestion(input),
  );
  handle("deleteInterviewQuestion", z.tuple([interviewId]), (id) =>
    repo.deleteQuestion(id),
  );
  handle(
    "proposeInterviewQuestions",
    z.tuple([
      z.array(interviewId).min(1).max(10),
      z.number().int().min(1).max(5),
      providerSchema,
    ]),
    (ids, count, provider) => questions.propose(ids, count, provider),
  );
  handle(
    "acceptInterviewQuestions",
    z.tuple([z.array(interviewId).min(1).max(5)]),
    (ids) => questions.acceptCandidates(ids),
  );
  handle("interviewMaterials", z.tuple([]), () => repo.listMaterials());
  handle("saveInterviewMaterial", z.tuple([materialInputSchema]), (input) =>
    repo.saveMaterial(input),
  );
  handle("deleteInterviewMaterial", z.tuple([interviewId]), (id) =>
    repo.deleteMaterial(id),
  );
  let importing = false;
  handle("importInterviewDocument", z.tuple([]), async () => {
    if (importing) throw Error("正在提取文档，请稍候");
    importing = true;
    try {
      const result = await dialog.showOpenDialog(win, {
        title: "导入简历或 JD",
        properties: ["openFile"],
        filters: [{ name: "PDF / Word", extensions: ["pdf", "docx"] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return await extractDocument(result.filePaths[0]);
    } finally {
      importing = false;
    }
  });
  return {
    flush: () => drafts.flush(),
    close: () => {
      drafts.flush();
      service.close();
    },
  };
}
