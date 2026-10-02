import type { CaptureQuality } from "../../shared/capture-quality";
export function QualityNotice({ quality }: { quality?: CaptureQuality }) {
  if (!quality) return null;
  return (
    <div
      className={quality.issues.length ? "quality-notice" : "quality-summary"}
    >
      <small>
        采集检查 · {quality.textLength} 字符 · {quality.codeBlocks} 个代码块
        {!quality.issues.length && " · 未发现明显异常"}
      </small>
      {quality.issues.length > 0 && (
        <>
          <ul>
            {quality.issues.map((i) => (
              <li key={i.code}>{i.message}</li>
            ))}
          </ul>
          <small>规则检查仅供参考，请结合原网页确认内容。</small>
        </>
      )}
    </div>
  );
}
