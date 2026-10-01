import type { MaterialSummary } from "../shared/lists";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Run } from "./App";
import type { InterviewConfig, InterviewMaterial } from "../shared/interview";
export function InterviewSetup({
  run,
  onCreated,
}: {
  run: Run;
  onCreated: (id: string) => Promise<void>;
}) {
  const [materials, setMaterials] = useState<MaterialSummary[]>([]),
    [busy, setBusy] = useState(false),
    [points, setPoints] = useState(""),
    [config, setConfig] = useState<InterviewConfig>({
      scope: "topic",
      mode: "bank",
      feedback: "practice",
      provider: "online",
      difficulty: "medium",
      questionCount: 5,
      topic: "",
      knowledgePoints: [],
    });
  useEffect(() => {
    void run(async () => setMaterials(await api.interviewMaterialSummaries()));
  }, []);
  return (
    <form
      className="source-card interview-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          setBusy(true);
          try {
            const id = await api.createInterview({
              ...config,
              knowledgePoints: points
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean),
            });
            await onCreated(id);
          } finally {
            setBusy(false);
          }
        });
      }}
    >
      <h3>开始一场面试</h3>
      <p>围绕一个专题练习，或为目标岗位做一次完整模拟。</p>
      <div className="form-pair">
        <label>
          面试范围
          <select
            aria-label="面试范围"
            value={config.scope}
            onChange={(e) =>
              setConfig({
                ...config,
                scope: e.target.value as InterviewConfig["scope"],
              })
            }
          >
            <option value="topic">专题练习</option>
            <option value="job">目标岗位综合</option>
          </select>
        </label>
        <label>
          出题方式
          <select
            aria-label="出题方式"
            value={config.mode}
            onChange={(e) =>
              setConfig({
                ...config,
                mode: e.target.value as InterviewConfig["mode"],
              })
            }
          >
            <option value="bank">题库随机抽题</option>
            <option value="ai">AI 延伸与追问</option>
          </select>
        </label>
      </div>
      {config.scope === "job" && (
        <div className="form-pair">
          <label>
            选择简历
            <select
              aria-label="选择简历"
              required
              value={config.resumeId ?? ""}
              onChange={(e) =>
                setConfig({ ...config, resumeId: e.target.value || undefined })
              }
            >
              <option value="">请选择</option>
              {materials
                .filter((m) => m.kind === "resume")
                .map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            选择 JD
            <select
              aria-label="选择 JD"
              required
              value={config.jdId ?? ""}
              onChange={(e) =>
                setConfig({ ...config, jdId: e.target.value || undefined })
              }
            >
              <option value="">请选择</option>
              {materials
                .filter((m) => m.kind === "jd")
                .map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}
      <div className="form-pair">
        <label>
          专题关键词
          <input
            value={config.topic}
            maxLength={200}
            placeholder="例如 Redis；留空使用全部专题"
            onChange={(e) => setConfig({ ...config, topic: e.target.value })}
          />
        </label>
        <label>
          限定知识点
          <input
            value={points}
            placeholder="逗号分隔，可留空"
            onChange={(e) => setPoints(e.target.value)}
          />
        </label>
      </div>
      <div className="form-pair">
        <label>
          难度
          <select
            value={config.difficulty}
            onChange={(e) =>
              setConfig({
                ...config,
                difficulty: e.target.value as InterviewConfig["difficulty"],
              })
            }
          >
            <option value="easy">基础</option>
            <option value="medium">进阶</option>
            <option value="hard">挑战</option>
          </select>
        </label>
        <label>
          总题量
          <input
            aria-label="总题量"
            type="number"
            required
            min={1}
            max={20}
            value={config.questionCount}
            onChange={(e) =>
              setConfig({ ...config, questionCount: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <div className="form-pair">
        <label>
          反馈时机
          <select
            aria-label="反馈时机"
            value={config.feedback}
            onChange={(e) =>
              setConfig({
                ...config,
                feedback: e.target.value as InterviewConfig["feedback"],
              })
            }
          >
            <option value="practice">练习：逐题反馈</option>
            <option value="formal">正式模拟：结束后统一反馈</option>
          </select>
        </label>
        <label>
          面试模型
          <select
            aria-label="面试模型"
            value={config.provider}
            onChange={(e) =>
              setConfig({
                ...config,
                provider: e.target.value as InterviewConfig["provider"],
              })
            }
          >
            <option value="online">DeepSeek / 在线模型</option>
            <option value="ollama">Ollama 本地模型</option>
          </select>
        </label>
      </div>
      <small>
        追问计入总题量。题库不足会提示调整，不会自动补入 AI
        新题。岗位题库模式会从最多 100 道随机候选题中按简历与 JD 选题。
      </small>
      <div className="info-note">
        {config.provider === "online"
          ? "开始后会把选中的简历、JD、回答和相关资料片段发给已配置的在线模型。"
          : "请求发送至已配置的 Ollama 服务。"}{" "}
        检索服务沿用模型设置；若启用在线 Embedding /
        精排，也会发送相应查询和资料片段。
      </div>
      <button className="primary" disabled={busy}>
        {busy ? "正在创建…" : "开始面试"}
      </button>
    </form>
  );
}
