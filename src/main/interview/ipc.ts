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
) {
  const repo = new InterviewRepository(library.db);
  const questions = new QuestionService(library, repo, settings);
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
}
