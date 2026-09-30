# 第三阶段：题库与文字模拟面试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可导入简历/JD、管理题库、完成文字面试并评分复盘的拾知 v0.5。

**Architecture:** 在现有 Electron 主进程增加独立 interview 模块，SQLite 保存业务记录，渲染进程只通过经过校验的 IPC 操作。沿用模型配置、JSON 模型传输、版本化 Evidence 和 HybridRetriever；面试状态机负责异步任务、持久化及正式模拟的答案隐藏。资料、题库、场次分别提供可验证的纵向功能，最后扩展备份及交付。

**Tech Stack:** Electron / React / TypeScript / Zod / node:sqlite。文档解析选择 pdfjs-dist 与 mammoth，执行时先核验官方 API 与 Electron 打包支持，再固定实际安装版本；不依赖用户安装 Python、Office 或额外服务。

**Spec:** `docs/superpowers/specs/2026-09-30-phase3-interview-design.md`

## Global Constraints

- macOS 和 Windows；DeepSeek / 兼容在线接口与 Ollama；此次不包含语音面试。
- 支持粘贴文字、文本型 PDF 和 Word `.docx`，本机提取；不支持 `.doc`、扫描 PDF OCR、密码保护文档。
- 文档上限 10 MiB，确认文本每份最多 30000 字符；提取结果必须先预览、修正、保存。
- 总题量默认 5，可选 1–20；追问计入总题量；题库不足明确失败，不补入 AI 新题。
- 量表版本 `interview-v1`；技术题权重 50/30/20，项目题权重 25/30/30/15；程序计算总分。
- 正式模拟结束前，页面及 IPC 返回值均不包含参考答案、评分与未展示的题目。
- 回答先落库；失败、重启不自动重发；历史使用资料和题目快照；密钥、原始简历文件和派生向量不导出。
- 执行方式沿用当前任务内直接实现，每项测试先失败再通过，最后一次独立代码审查。

## Review Focus

- 小体积压缩文档解压后极大或解析卡住：任务 1 用资源上限与解析超时测试，用户得到明确错误且窗口仍可用。
- 模型返回看似合理但无效的分数、未知引用或重复问题：任务 2/3 拒绝响应，保留可重试记录，不推进进度。
- 正式模拟从历史列表、错误信息或提前结束路径泄露答案：任务 3 检查所有返回投影；提前结束显式终结场次后才显示已有评分。
- 请求未结束时重复提交、退出、删除或重启：任务 3 验证回答不丢失、计数不重复、删除不复活；重启无外部调用。
- 两台设备修改同一资料后备份冲突，或题库/简历已删除：任务 4 验证独立快照完整、引用合法、重复导入幂等。

## 1. 面试资料管理与本地文档提取

**Files:** 新建 `src/shared/interview.ts`、`src/main/interview/repository.ts`、`src/main/interview/documents.ts`、`src/main/interview/document-worker.ts`、`src/main/interview/ipc.ts`、`src/renderer/InterviewMaterialsPage.tsx`；修改 `src/main/library/schema.ts`、`src/main/ipc.ts`、`src/shared/contracts.ts`、`src/preload/index.ts`、`src/renderer/App.tsx`、`scripts/build.mjs`、`package.json`；测试 `tests/interview/documents.test.ts`、`tests/interview/repository.test.ts`、`tests/e2e/interview-materials.spec.ts`。

**Interfaces:** `InterviewMaterial {id,name,kind:'resume'|'jd',text,createdAt,updatedAt}`；`MaterialInput {id?,name,kind,text}`。`InterviewRepository(db: DatabaseSync)` 暴露 `listMaterials(): InterviewMaterial[]`、`saveMaterial(input: MaterialInput): InterviewMaterial`、`deleteMaterial(id: string): void`。`extractDocument(path: string): Promise<{name:string,text:string}>` 只由主进程已选择的文件调用；IPC `importInterviewDocument(): Promise<{name:string,text:string}|null>` 不接受渲染进程任意路径。

- [ ] 写失败测试：PDF/DOCX 固定小文件正确提取；空白、扫描、密码保护、错误扩展名、超过 10 MiB 或文本超过 30000 字符被拒绝；超时解析终止。资料保存去首尾空白，重开 DB 后内容不变，取消预览无落库。
- [ ] 运行 `npm test -- tests/interview/documents.test.ts tests/interview/repository.test.ts`，确认失败来自缺失能力。
- [ ] 实现 Zod 输入边界与 SQLite schema v5，增加三张独立业务表（materials、questions、sessions）；解析在可终止 worker 中执行，30 秒超时，DOCX 先限制解压条目数量和总量（10000 项 / 50 MiB）；PDF 限 200 页。worker 不执行文档脚本或外部资源请求。构建脚本包含 worker 与 PDF 必需运行资源。
- [ ] 实现独立 IPC 注册入口，共用现有可信窗口/主框架检查；界面支持新增、编辑、删除、文件选择、提取预览及保存，错误显示在当前表单。在线使用范围说明在资料页和创建面试页可见。
- [ ] 运行上述单元测试、`npm run typecheck` 与新桌面测试；通过后提交 `feat: add interview materials and local document import`。

## 2. 题库与候选题确认

**Files:** 扩展 `src/shared/interview.ts`、`src/main/interview/repository.ts`、`src/main/interview/ipc.ts`；新建 `src/main/interview/questions.ts`、`src/main/interview/prompts.ts`、`src/renderer/QuestionBankPage.tsx`；修改 `src/shared/contracts.ts`、`src/preload/index.ts`、`src/renderer/App.tsx`；测试 `tests/interview/questions.test.ts`、`tests/e2e/question-bank.spec.ts`。

**Interfaces:** `InterviewQuestion {id,prompt,referenceAnswer,knowledgePoints:string[],difficulty:'easy'|'medium'|'hard',kind:'technical'|'project',origin:'manual'|'ai-organized'|'ai-extended',evidence:Evidence[],supplement:boolean,createdAt,updatedAt}`。仓库提供 `listQuestions()`、`saveQuestion(input)`、`deleteQuestion(id)`。`QuestionService.propose(articleIds:string[],count:number,provider:'online'|'ollama'): Promise<InterviewQuestion[]>` 返回未保存候选，最多 5 道/次；`acceptCandidates(ids:string[]): InterviewQuestion[]` 只接受主进程缓存中本次候选，避免页面伪造证据。

- [ ] 写失败测试：手工题 CRUD、筛选；生成题的来源标记；模型输出未知 evidence ID 被拒绝；候选生成不落库，选取保存只保存所选，重复确认不重复入库；原文章更新后题目仍引用旧版本。
- [ ] 运行 `npm test -- tests/interview/questions.test.ts`，确认预期失败。
- [ ] 实现题库表单与文章选择生成入口。生成输入仅包含选定文章的受限片段；模型只返回引用 ID，由主进程从实际证据构造 Evidence。没有来源的补充明确标记，禁止把模型文本标为原文；手工录入题不凭空补引用。
- [ ] 实现题库知识点、难度、类型筛选和批量候选确认；生成失败可重试，关闭候选预览不保存，候选缓存在过期/关闭时清理。
- [ ] 执行单元、类型和桌面测试；通过后提交 `feat: add interview question bank and reviewed AI candidates`。

## 3. 面试状态机、评分与完整桌面流程

**Files:** 扩展共享类型、仓库、IPC、导航和模型提示词；新建 `src/main/interview/service.ts`、`src/main/interview/scoring.ts`、`src/main/interview/projection.ts`、`src/renderer/InterviewPage.tsx`、`src/renderer/InterviewSetup.tsx`、`src/renderer/InterviewReport.tsx`；测试 `tests/interview/service.test.ts`、`tests/interview/scoring.test.ts`、`tests/interview/projection.test.ts`、`tests/e2e/interview.spec.ts`。

**Interfaces:** `InterviewConfig {scope:'topic'|'job',mode:'bank'|'ai',feedback:'practice'|'formal',provider:'online'|'ollama',difficulty,questionCount:number,topic:string,knowledgePoints:string[],resumeId?:string,jdId?:string}`。`InterviewSession` 保存 id、createdAt、config、资料快照、规则版本、状态、turns、待执行步骤及安全错误。`InterviewTurn` 保存题目快照、draft、answer、submittedAt、grade、每次实际模型名/时间、isFollowup。`InterviewService` 提供 `create(config):string`、`saveDraft(id,turnIndex,text):void`、`submit(id,turnIndex,answer):void`、`next(id):void`、`retry(id):void`、`finish(id):void`、`delete(id):void`、`waitForIdle():Promise<void>`；`projectSession(session): InterviewSessionView` 是唯一对外场次投影。

- [ ] 写失败测试：组合覆盖 2×2×2 模式；题库不足拒绝、抽题不重复、岗位选择请求带入实际简历/JD且仅返回合法题库 ID；AI 追问带入实际回答并计入 1–20 的限额，重复题被拒绝。
- [ ] 写失败测试：延迟模型请求时重复 submit/retry/next 不重复推进；草稿与提交内容重启保留，处理中状态转可重试且启动不请求；删除/提前结束终止任务、迟到结果不写回；重新配置模型后的重试保存实际模型名。
- [ ] 写失败测试：技术维度均为 80 时总分为 80；项目维度 100/50/0/100 时总分为 55。拒绝负值、超过 100、缺少理由及未知引用；平均分只取已评分题，并报告未评分数。
- [ ] 写失败测试：正式模式的 list/get 投影、失败及未终结状态均不含 referenceAnswer/grade/evidence 等隐藏内容和未来题目；练习模式提交后显示反馈，完成或明确提前结束才解除正式模式隐藏。
- [ ] 运行 `npm test -- tests/interview/service.test.ts tests/interview/scoring.test.ts tests/interview/projection.test.ts`，确认失败。
- [ ] 实现状态机：`preparing → awaiting-answer → grading → awaiting-next → preparing/completed`；网络失败记 `failed` 和明确 retryStep，取消结束记 `aborted`。每场仅一个异步任务，提交原子保存后才调用模型，更新时核对场次/轮次/任务代次。题库场次固定抽题快照；岗位题库模式只选择已有题；AI 每轮生成一题，附加本轮检索证据，避免一次生成整场超过输出限制。
- [ ] 实现评分 JSON 校验与固定权重计算。技术题根据证据与标记的参考答案评分，项目题按职责/取舍/过程/一致性反馈，不断言履历真伪。量表与提示词均标 `interview-v1`；报告用已保存评分确定性汇总薄弱点、建议与版本化复习资料。
- [ ] 实现设置、单题作答、草稿保存（防抖并在导航/提交前刷新）、失败重试、提前结束确认、逐题反馈、正式报告及历史删除。正式页面只消费投影，引用阅读复用现有 Reader 交互。默认 5 题，最多 20，用户在线发送范围在启动前可见。
- [ ] 运行上述测试、类型检查和完整桌面面试测试：从资料选择到两题作答/追问/报告；正式模式隐藏；中断恢复。通过后提交 `feat: add resumable mock interviews and versioned scoring`。

## 4. 面试备份迁移

**Files:** 修改 `src/main/backup/manifest.ts`、`export.ts`、`validate.ts`、`merge.ts`、`src/shared/contracts.ts`、`src/renderer/BackupPage.tsx`；新建 `tests/interview/backup.test.ts`。

**Interfaces:** manifest format v4 增加 `interviewMaterials`、`interviewQuestions`、`interviewSessions`，旧 v1/v2/v3 默认空数组；preview/report 增加面试资料、题目、场次数量与冲突计数。使用任务 1–3 的共享 schema；会话引用快照不要求原始材料/题目仍存在，但 Evidence 必须关联备份中的真实文章版本。

- [ ] 写失败测试：完整场次往返；删除原题/简历后仍能导出与查看历史；同 ID 不同内容保留双方，重复导入幂等；非法评分、未知引用、重复 ID 拒绝且目标库不变；旧 v3 备份可导入。导入处理中场次转可重试，完成场次不改变内容。
- [ ] 运行 `npm test -- tests/interview/backup.test.ts`，确认预期失败。
- [ ] 实现清单、验证和合并；冲突副本 ID 使用原 ID 加规范化内容哈希确定，快照避免悬空关系；导入不调用模型，不导入运行中控制器。复用原文引用完整性校验，事务包裹业务合并。
- [ ] 执行备份及全单元回归；通过后提交 `feat: include interview materials and sessions in backups`。

## 5. 最终验收与 v0.5 交付

**Files:** 更新 `README.md`、`docs/verification/phase3.md`、版本号、UI 样式与 `tests/e2e` 验收；产物写入 `release/v0.5.0`。

- [ ] 对照已批准 spec 自查每项范围，并运行 `npm run typecheck`、`npm test`、`npm run test:e2e`；失败先定位再修正，不能用 fixture 成功声称真实模型质量通过。
- [ ] 依 requesting-code-review 技能安排一次只读独立审查，聚焦状态机、正式模式泄露、文档导入与备份；修复重要问题并补回归。
- [ ] macOS 打包后执行桌面测试，包含真实 PDF/DOCX 文件导入，验证 worker 和运行资源随包可用；检查主要页面截图。
- [ ] Windows x64 打包并校验 ZIP 和 SHA-256，核对两端 asar 版本为 0.5.0。没有 Windows 实机时明确限制；不覆盖旧版本产物。
- [ ] 记录真实服务测试是否执行、模型质量和平台边界；更新使用说明和验证文档，提交最终修正，提供新产物链接。

## 计划自查

资料输入与确认由任务 1 覆盖；题目独立管理与来源区分由任务 2 覆盖；所有模式组合、题量、状态、评分、隐私和复盘由任务 3 覆盖；备份与历史快照由任务 4 覆盖；平台、打包和原有功能回归由任务 5 覆盖。Review Focus 的五类输入均有对应测试。此计划仍等待用户审阅后开始实现，不新增执行方式选择。
