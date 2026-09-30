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
) {
  const repo = new InterviewRepository(library.db);
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
