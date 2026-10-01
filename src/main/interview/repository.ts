import type {
  MaterialSummary,
  QuestionSummary,
  SessionSummary,
} from "../../shared/lists";
import { sessionSchema, type InterviewSession } from "../../shared/interview";
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
  materialSummaries(): MaterialSummary[] {
    return this.db
      .prepare(
        `SELECT id, json_extract(data,'$.name') name, json_extract(data,'$.kind') kind,
      json_extract(data,'$.createdAt') createdAt, json_extract(data,'$.updatedAt') updatedAt,
      length(json_extract(data,'$.text')) characters FROM interview_materials ORDER BY rowid DESC`,
      )
      .all() as MaterialSummary[];
  }
  questionSummaries(): QuestionSummary[] {
    return this.db
      .prepare(
        `SELECT id, substr(json_extract(data,'$.prompt'),1,200) prompt,
      json_extract(data,'$.knowledgePoints') points, json_extract(data,'$.difficulty') difficulty,
      json_extract(data,'$.kind') kind, json_extract(data,'$.origin') origin FROM interview_questions ORDER BY rowid DESC`,
      )
      .all()
      .map(({ points, ...r }) => ({
        ...r,
        knowledgePoints: JSON.parse(points as string),
      })) as QuestionSummary[];
  }
  sessionSummaries(): SessionSummary[] {
    return this.db
      .prepare(
        `SELECT id, json_extract(data,'$.createdAt') createdAt,
      json_extract(data,'$.status') status, json_extract(data,'$.config.questionCount') questionCount,
      CASE WHEN json_extract(data,'$.config.scope')='job' THEN coalesce(json_extract(data,'$.jd.name'),'岗位面试')
      ELSE coalesce(nullif(json_extract(data,'$.config.topic'),''),'专题练习') END title,
      (SELECT count(*) FROM json_each(data,'$.turns') WHERE json_extract(value,'$.answer') IS NOT NULL) answered
      FROM interview_sessions ORDER BY json_extract(data,'$.createdAt') DESC, id DESC`,
      )
      .all() as SessionSummary[];
  }
  getMaterial(id: string): InterviewMaterial | undefined {
    const row = this.db
      .prepare("SELECT data FROM interview_materials WHERE id=?")
      .get(id);
    return row
      ? materialSchema.parse(JSON.parse(row.data as string))
      : undefined;
  }
  getQuestion(id: string): InterviewQuestion | undefined {
    const row = this.db
      .prepare("SELECT data FROM interview_questions WHERE id=?")
      .get(id);
    return row
      ? questionSchema.parse(JSON.parse(row.data as string))
      : undefined;
  }
  listMaterials(): InterviewMaterial[] {
    return this.db
      .prepare("SELECT data FROM interview_materials ORDER BY rowid DESC")
      .all()
      .map((r) => materialSchema.parse(JSON.parse(r.data as string)));
  }
  saveMaterial(raw: MaterialInput): InterviewMaterial {
    const input = materialInputSchema.parse(raw),
      old = input.id ? this.getMaterial(input.id) : undefined;
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
      old = input.id ? this.getQuestion(input.id) : undefined;
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
  listSessions(): InterviewSession[] {
    return this.db
      .prepare("SELECT data FROM interview_sessions ORDER BY rowid DESC")
      .all()
      .map((r) => sessionSchema.parse(JSON.parse(r.data as string)));
  }
  getSession(id: string): InterviewSession | undefined {
    const row = this.db
      .prepare("SELECT data FROM interview_sessions WHERE id=?")
      .get(id);
    return row
      ? sessionSchema.parse(JSON.parse(row.data as string))
      : undefined;
  }
  putSession(record: InterviewSession) {
    this.db
      .prepare("INSERT OR REPLACE INTO interview_sessions VALUES (?,?)")
      .run(record.id, JSON.stringify(sessionSchema.parse(record)));
  }
  deleteSession(id: string) {
    this.db.prepare("DELETE FROM interview_sessions WHERE id=?").run(id);
  }
}
