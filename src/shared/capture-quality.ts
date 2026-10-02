export type CaptureIssueCode =
  | "short-text"
  | "login-prompt"
  | "missing-images"
  | "empty-code"
  | "link-heavy";
export interface CaptureIssue {
  code: CaptureIssueCode;
  message: string;
}
export interface CaptureQuality {
  checkedAt: string;
  textLength: number;
  codeBlocks: number;
  issues: CaptureIssue[];
}
