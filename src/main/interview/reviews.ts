import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  reviewSchema,
  type ReviewItem,
  type ReviewSummary,
} from "../../shared/review";
import type { InterviewSession } from "../../shared/interview";
import { InterviewRepository } from "./repository";

export class ReviewRepository {
  constructor(private db: DatabaseSync) {}
  summaries(): ReviewSummary[] {
    return this.db
      .prepare(
        `SELECT id, json_extract(data,'$.state') state,
      json_extract(data,'$.updatedAt') updatedAt,
      json_extract(data,'$.sourceSessionId') sourceSessionId,
      json_extract(data,'$.sourceIndex') sourceIndex,
      substr(json_extract(data,'$.baseline.question.prompt'),1,200) prompt,
      json_extract(data,'$.baseline.question.knowledgePoints') points,
      json_array_length(data,'$.attempts') attempts
      FROM interview_reviews ORDER BY json_extract(data,'$.updatedAt') DESC, id DESC`,
      )
      .all()
      .map(({ points, ...row }) => ({
        ...row,
        knowledgePoints: JSON.parse(points as string),
      })) as ReviewSummary[];
  }
  list(): ReviewItem[] {
    return this.db
      .prepare("SELECT data FROM interview_reviews ORDER BY rowid")
      .all()
      .map((row) => reviewSchema.parse(JSON.parse(row.data as string)));
  }
  get(id: string): ReviewItem | undefined {
    const row = this.db
      .prepare("SELECT data FROM interview_reviews WHERE id=?")
      .get(id);
    return row ? reviewSchema.parse(JSON.parse(row.data as string)) : undefined;
  }
  put(item: ReviewItem) {
    this.db
      .prepare("INSERT OR REPLACE INTO interview_reviews VALUES (?,?)")
      .run(item.id, JSON.stringify(reviewSchema.parse(item)));
  }
  add(sessionId: string, index: number): string {
    const s = new InterviewRepository(this.db).getSession(sessionId);
    if (!s || !["completed", "aborted"].includes(s.status))
      throw Error("请结束面试后再加入复习");
    const baseline = s.turns[index];
    if (!baseline) throw Error("面试题目不存在");
    if (s.reviewId && this.get(s.reviewId)) return s.reviewId;
    const old = this.db
      .prepare(
        `SELECT id FROM interview_reviews WHERE
      json_extract(data,'$.sourceSessionId')=? AND json_extract(data,'$.sourceIndex')=?`,
      )
      .get(sessionId, index);
    if (old) return old.id as string;
    const now = new Date().toISOString();
    const item: ReviewItem = {
      id: randomUUID(),
      sourceSessionId: sessionId,
      sourceIndex: index,
      createdAt: now,
      updatedAt: now,
      state: "pending",
      baseline,
      config: s.config,
      resume: s.resume,
      jd: s.jd,
      attempts: [],
    };
    this.put(item);
    return item.id;
  }
  setState(id: string, state: ReviewItem["state"]) {
    const item = this.get(id);
    if (!item) throw Error("复习题目已不存在");
    this.put({ ...item, state, updatedAt: new Date().toISOString() });
  }
  delete(id: string) {
    this.db.prepare("DELETE FROM interview_reviews WHERE id=?").run(id);
  }
  recordAttempt(session: InterviewSession) {
    if (!session.reviewId || session.status !== "completed") return;
    const item = this.get(session.reviewId),
      turn = session.turns[0];
    // Deleted review items are never resurrected by an in-flight response.
    if (
      !item ||
      !turn?.grade ||
      item.attempts.some((a) => a.sessionId === session.id)
    )
      return;
    item.attempts.push({ sessionId: session.id, turn });
    item.updatedAt = new Date().toISOString();
    this.put(item);
  }
}
