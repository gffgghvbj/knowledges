import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LibraryRepository } from "../../src/main/library/repository";
import { InterviewRepository } from "../../src/main/interview/repository";
test("confirmed material text persists across reopen and rejects invalid input", () => {
  const root = mkdtempSync(join(tmpdir(), "interview-repo-"));
  let library = new LibraryRepository(root);
  try {
    let repo = new InterviewRepository(library.db);
    const m = repo.saveMaterial({
      name: " Resume ",
      kind: "resume",
      text: " Java engineer ",
    });
    expect(m.text).toBe("Java engineer");
    expect(() =>
      repo.saveMaterial({ name: "x", kind: "jd", text: " " }),
    ).toThrow();
    expect(() =>
      repo.saveMaterial({ name: "x", kind: "jd", text: "x".repeat(30001) }),
    ).toThrow();
    library.close();
    library = new LibraryRepository(root);
    repo = new InterviewRepository(library.db);
    expect(repo.listMaterials()).toEqual([m]);
    repo.deleteMaterial(m.id);
    expect(repo.listMaterials()).toEqual([]);
  } finally {
    library.close();
    rmSync(root, { recursive: true, force: true });
  }
});
