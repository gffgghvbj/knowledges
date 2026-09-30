import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  materialInputSchema,
  materialSchema,
  questionInputSchema,
  questionSchema,
  type InterviewMaterial,
  type MaterialInput,
  type InterviewQuestion,
  type QuestionInput,
} from "../../shared/interview";
export class InterviewRepository {
  constructor(readonly db: DatabaseSync) {}
  listMaterials(): InterviewMaterial[] {
    return this.db
      .prepare("SELECT data FROM interview_materials ORDER BY rowid DESC")
      .all()
      .map((r) => materialSchema.parse(JSON.parse(r.data as string)));
  }
  saveMaterial(raw: MaterialInput): InterviewMaterial {
    const input = materialInputSchema.parse(raw),
      old = input.id
        ? this.listMaterials().find((m) => m.id === input.id)
        : undefined;
    if (input.id && !old) throw Error("面试资料已不存在");
    const now = new Date().toISOString(),
      record = {
        ...input,
        id: old?.id ?? randomUUID(),
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      };
    this.putMaterial(record);
    return record;
  }
  putMaterial(record: InterviewMaterial) {
    this.db
      .prepare("INSERT OR REPLACE INTO interview_materials VALUES (?,?)")
      .run(record.id, JSON.stringify(materialSchema.parse(record)));
  }
  deleteMaterial(id: string) {
    this.db.prepare("DELETE FROM interview_materials WHERE id=?").run(id);
  }
  listQuestions(): InterviewQuestion[] {
    return this.db
      .prepare("SELECT data FROM interview_questions ORDER BY rowid DESC")
      .all()
      .map((r) => questionSchema.parse(JSON.parse(r.data as string)));
  }
  saveQuestion(raw: QuestionInput): InterviewQuestion {
    const input = questionInputSchema.parse(raw),
      old = input.id
        ? this.listQuestions().find((q) => q.id === input.id)
        : undefined;
    if (input.id && !old) throw Error("题目已不存在");
    const now = new Date().toISOString();
    const record: InterviewQuestion = {
      ...input,
      id: old?.id ?? randomUUID(),
      origin: "manual",
      evidence: old?.evidence ?? [],
      supplement: true,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    };
    this.putQuestion(record);
    return record;
  }
  putQuestion(record: InterviewQuestion) {
    this.db
      .prepare("INSERT OR REPLACE INTO interview_questions VALUES (?,?)")
      .run(record.id, JSON.stringify(questionSchema.parse(record)));
  }
  deleteQuestion(id: string) {
    this.db.prepare("DELETE FROM interview_questions WHERE id=?").run(id);
  }
}
