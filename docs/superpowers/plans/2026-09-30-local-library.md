# 第一阶段：本地资料库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可在 macOS 和 Windows 使用的个人资料库桌面应用，支持首批网站采集、Markdown 阅读、手动更新、版本恢复及单文件合并导入。

**Architecture:** Electron 负责桌面窗口和按来源隔离的登录会话，React 呈现本地管理界面。采集通过相同会话加载网页并提取正文，资料内容落地 Markdown 和资源文件，SQLite 保存元信息、任务状态与全文索引。备份使用带版本清单的 ZIP 容器，导入通过暂存校验和可恢复的提交过程保护已有数据。

**Tech Stack:** 建议 Electron、TypeScript、React、Vite、better-sqlite3、Turndown（含 GFM 转换）、markdown-it、DOMPurify、yauzl/yazl、Vitest、Playwright Electron 测试、electron-builder。执行时核对兼容版本、锁定 lockfile；本计划不声称依赖已安装或兼容性已实测。

**Spec:** [已批准的需求设计](../specs/2026-09-30-interview-knowledge-design.md)

## Global Constraints

- 同一个桌面应用分三阶段交付：资料库、知识库问答、面试练习。
- 支持整站发现与采集学习资料；扫描后可选择栏目，默认选择全部学习资料。
- 首批适配小林 coding 和 JavaGuide。
- 用户手动触发网站更新，不做定时后台检查。
- 原文与图片保存到本地，问答及面试支持在线 API 和本地模型。
- 跨设备采用单文件备份包导出、导入和合并，不包含实时云同步。
- 网站登录状态和 API Key 默认不导出，另一台电脑单独配置。
- 导入采用合并去重，保留双方新增数据；重复导入同一备份不重复创建记录。
- 本计划只实现第一阶段；后两阶段在资料库接口稳定后分别编写实施计划，不提前安装模型或文档解析依赖。

## Review Focus

- 中文标题、Windows 保留文件名、大小写冲突与长 URL：以稳定 ID 命名文件、保留展示标题；任务 2 验证跨平台路径。
- 中文短词和代码符号查询：不能依赖英文分词表现；任务 6 验证“回收”、Redis、C++ 查询。
- 登录页伪装成 HTTP 200、登录过期与跳转外站：不能被当成文章覆盖原文；任务 3、4 验证分类与会话边界。
- 图片失效、任务中断和磁盘写入失败：已完成正文可保留，但不虚报完整采集；任务 2、4 验证可恢复状态。
- 恶意备份路径、解压过量、相同时间版本冲突与重复导入：不能损坏已有库；任务 7 验证预检查及幂等性。

## 方案比较与依据

选择 Electron 的主要原因是本项目需要内嵌网站登录、动态页面加载及跨平台一致的浏览器环境。代价是安装包和内存占用较高。Tauri 加独立浏览器引擎也可实现，但会增加浏览器分发与会话衔接工作；Python GUI 加浏览器自动化则引入额外运行时打包工作。以上是针对当前需求的工程取舍，不是对其他方案能力的否定。

官方依据：

- [Electron Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds)：提供 WebContentsView 嵌入方式。
- [Electron Session](https://www.electronjs.org/docs/latest/api/session)：按分区管理会话及使用会话网络请求。
- [Electron Security](https://github.com/electron/electron/blob/main/docs/tutorial/security.md)：远程网页关闭 Node.js 集成、启用隔离和沙箱。
- [SQLite FTS5](https://www.sqlite.org/fts5.html)：全文索引能力；中文短词另有回退查询。

仍需实测：两个网站的正文和目录结构、是否存在登录限制、登录是否允许内嵌浏览器、图片与动态加载行为。不能将官方 API 能力当作目标网站已经兼容的证据。

## 文件结构

```text
src/shared/contracts.ts                 跨进程 DTO、ID 和状态类型
src/main/app.ts                         窗口、生命周期、数据路径
src/main/ipc.ts                         校验过的本地界面 IPC
src/preload/index.ts                    最小只读/命令桥接
src/main/library/{schema,repository,files,recovery}.ts
                                       数据迁移、文章版本、原子文件写入和恢复
src/main/capture/{sessions,browser,discovery,queue,extract,assets}.ts
                                       登录、加载、发现、持久任务、转换和图片
src/main/capture/adapters/{types,xiaolin,javaguide,generic}.ts
                                       站点范围、识别与提取规则
src/main/library/{updates,search}.ts     更新、恢复及本地搜索
src/main/backup/{manifest,export,validate,merge}.ts
                                       备份清单、导出、校验和合并
src/renderer/{App,SourcePage,TaskPage,LibraryPage,BackupPage}.tsx
                                       各使用流程
src/renderer/components/{Reader,VersionHistory}.tsx
                                       安全阅读及历史查看
tests/{library,capture,backup,search}/   领域行为测试和小型 HTML fixtures
tests/e2e/                             Electron 本地测试站与集成测试
docs/verification/                     实际网站与双平台验收记录
```

依赖关系：任务 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。每个任务完成后验证再进入下一项。当前目录只有设计文档且不是 Git 仓库；执行时初始化仓库并建立基线提交，之后只提交相关文件，不在本轮规划中初始化或修改代码。

## 公共契约及数据规则

在 `src/shared/contracts.ts` 中定义全部跨模块 DTO；时间为 UTC ISO 8601，ID 和 hash 为字符串类型别名。

- `Source { id, entryUrl, allowedOrigins: string[], adapterId, label }`；新增域名须用户显式纳入范围，登录跳转域名不自动进入采集范围。
- `Candidate { sourceId, canonicalUrl, title, sectionPath: string[] }`。
- `PageSnapshot { finalUrl, html, fetchedAt, statusCode }`；`PageResult` 为 `article(snapshot)`、`login-required`、`unavailable(reason)` 或 `failed(reason)` 判别联合。
- `ExtractedArticle { candidate, markdown, text, fetchedAt, assets: AssetInput[] }`；`AssetInput { remoteUrl, localRef }`，下载后生成 `Asset { hash, relativePath, mimeType, size }`。
- `Article { id, sourceId, canonicalUrl, title, sectionPath, currentVersionId, sourceStatus }`；`ArticleVersion { id, articleId, contentHash, capturedAt, markdownPath, assets: Asset[], completeness }`。
- `completeness` 为 `complete | assets-pending`；`sourceStatus` 为 `available | unavailable | removed`。404/410 可标记 removed，网络失败标记 unavailable，均保留本地内容。
- `TaskState = queued | running | paused | login-required | partial | failed | complete`；`TaskProgress { taskId, state, discovered, completed, failed, pending }`。扫描未结束时单独携带 `scanComplete: false`。
- `MergeReport { added, updated, duplicates, conflicts, failed }`，各项为数量，另有记录级明细。
- `LibraryEvent { type: article-current-changed, articleId, versionId }` 为阶段二预留本地通知，现阶段不构建语义索引。

稳定标识：来源依据规范入口确定；文章 ID 为 canonical URL 的 SHA-256；版本 ID 为文章 ID 与内容 hash 的组合。内容 hash 对规范正文和资源内容 hash 清单计算，排除抓取时间。相同内容重复采集更新 lastSeenAt，不创建版本；版本 capturedAt 记录该内容的最新成功采集时间，以保持已确认的合并语义。

持久目录：`library.sqlite`、`articles/<articleId>/current.md`、`articles/<articleId>/versions/<versionId>.md`、`assets/<hash>.<ext>`、`staging/`、`journal/`。版本与 current.md 到 assets 的相对链接分别生成；不将绝对路径写入 Markdown。原文标题作为内容和元信息，文件名不直接来自网页。

## Task 1: 桌面与通信最小骨架

**Files:** Create `package.json`, `tsconfig.json`, `vite.config.ts`, `electron-builder.yml`, `src/shared/contracts.ts`, `src/main/app.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`, `tests/e2e/app.spec.ts`。

**Interfaces:** 产生 `LibraryApi.getStatus(): Promise<{ ready: boolean }>`，仅本地应用界面可调用；其他命令随所属任务添加，不暴露通用文件执行或任意 IPC。

- [ ] 初始化 Git 并提交现有文档，配置开发、类型检查、单测、Electron e2e 和打包命令；锁定依赖兼容版本。
- [ ] 编写失败测试 `app.spec.ts`：`expect(await api.getStatus()).toEqual({ready:true})`；远程窗口不具有 `window.libraryApi`。
- [ ] 运行 `npm run test:e2e -- tests/e2e/app.spec.ts`，确认因应用/桥接未实现失败。
- [ ] 实现窗口和经过参数及发送方验证的 IPC；本地界面启用 contextIsolation，远程网页禁用 Node、无 preload、启用 sandbox。
- [ ] 运行该 e2e 与 `npm run typecheck`，预期均通过；记录 Electron 与原生 SQLite 模块的构建兼容性。
- [ ] 提交 `feat: bootstrap local desktop library`。

## Task 2: Markdown、版本与可恢复存储

**Files:** Create `src/main/library/{schema,repository,files,recovery}.ts`, `tests/library/storage.test.ts`。

**Interfaces:** `openLibrary(root: string): Promise<LibraryRepository>`；`saveArticle(input: ExtractedArticle, assets: Asset[]): Promise<ArticleVersion>`；`getArticle(id: string): Promise<Article>`；`listVersions(id: string): Promise<ArticleVersion[]>`；`recoverPendingWrites(): Promise<void>`。

- [ ] 写失败测试：重复保存相同正文 `expect(versions).toHaveLength(1)`；正文改变后长度为 2；保存失败 `expect(currentVersionId).toBe(previousId)`；中文/CON/仅大小写不同标题不导致路径冲突；current 和历史 Markdown 的图片链接均可解析。
- [ ] 运行 `npm run test -- tests/library/storage.test.ts`，确认缺失存储实现导致失败。
- [ ] 实现 SQLite migrations、稳定 ID、资源 hash、临时文件与 journal：先准备不可变内容，事务更新指针，再重建 current.md；启动恢复未完成的 current.md 更新，不能宣称 SQLite 事务能回滚文件系统。
- [ ] 加入中断注入测试，逐个模拟文件落盘前后及数据库提交后的终止，执行恢复后断言 current.md 与数据库指针一致，旧版本仍在。
- [ ] 运行该测试文件和类型检查，预期通过。
- [ ] 提交 `feat: persist versioned markdown library`。

## Task 3: 登录会话与站点发现

**Files:** Create `src/main/capture/{sessions,browser,discovery}.ts`, `src/main/capture/adapters/{types,xiaolin,javaguide,generic}.ts`, `tests/capture/discovery.test.ts`, `tests/e2e/login.spec.ts`, `docs/verification/sites.md`。

**Interfaces:** `openLogin(source: Source): Promise<void>`；`loadPage(source: Source, url: string): Promise<PageResult>`；`discover(source: Source, signal: AbortSignal): AsyncIterable<Candidate>`；`SiteAdapter { canonicalize(url): string; classify(snapshot): PageResult; discover(snapshot): Candidate[]; extract(snapshot, candidate): ExtractedArticle }`。

- [ ] 写失败测试：anchor 与已确认跟踪参数变体只发现一次；外站不加入队列；两个来源 cookie 隔离；受保护页面登录前是 login-required，登录后是 article；HTTP 200 登录表单不视为正文。
- [ ] 运行 `npm run test -- tests/capture/discovery.test.ts` 和 `npm run test:e2e -- tests/e2e/login.spec.ts`，确认失败原因正确。
- [ ] 实现每来源持久 session partition、WebContentsView 登录及同会话加载；从栏目导航和站内学习链接发现文章，站点允许时补充 sitemap。泛用适配器结果需标示识别失败，不把任意网页当作学习正文。
- [ ] 实测两个样例和代表性栏目，记录日期、最终 URL、提取规则和失败原因；仅保存必要的小型非敏感 fixture。需要用户登录时提供窗口；若嵌入登录被拒绝，记录阻塞，不声称已支持该站登录。
- [ ] 运行两项测试并确认扫描范围和数量状态正确；实际站点失败单独记录，不用 fixture 通过替代真实验收。
- [ ] 提交 `feat: discover source articles with isolated login sessions`。

## Task 4: 可恢复采集与正文资源转换

**Files:** Create `src/main/capture/{queue,extract,assets}.ts`, `tests/capture/queue.test.ts`, `tests/capture/extract.test.ts`。

**Interfaces:** `startCapture(sourceId: string, candidates: Candidate[]): Promise<string>`；`pauseTask(taskId: string): Promise<void>`；`resumeTask(taskId: string): Promise<void>`；`retryFailed(taskId: string): Promise<void>`；`getTask(taskId: string): Promise<TaskProgress>`；`downloadAssets(article: ExtractedArticle): Promise<{assets: Asset[]; missing: string[]}>`。

- [ ] 写失败测试：fixture 的标题、代码语言、GFM 表格保留；导航与评论被剔除；相对和延迟加载图片本地化；缺图时状态为 partial；暂停恢复不重复入库；登录过期保留队列并进入 login-required；模拟超时和限流不形成重试死循环。
- [ ] 运行 `npm run test -- tests/capture/queue.test.ts tests/capture/extract.test.ts`，预期缺失实现失败。
- [ ] 实现正文识别、Turndown 转换与资源下载，持久化逐 URL 状态；每来源默认并发 2、请求间隔至少 1 秒，临时错误最多重试 3 次并尊重 Retry-After，之后等待手动重试。
- [ ] 用任务 2 存储结果；缺图仍保存可读正文并标记 assets-pending，重试补资源；启动时将未完成 running 项恢复为 queued，用户暂停的任务继续保持 paused。
- [ ] 运行上述测试和类型检查，预期通过。
- [ ] 提交 `feat: capture markdown with resumable tasks`。

## Task 5: 手动更新与版本恢复

**Files:** Create `src/main/library/updates.ts`, `tests/library/updates.test.ts`。

**Interfaces:** `updateSource(sourceId: string): Promise<string>` 返回采集 taskId；`restoreVersion(articleId: string, versionId: string): Promise<void>`；消费任务 2、4 契约并发出 LibraryEvent。

- [ ] 写失败测试：相同内容无新版本；正文或图片改变产生新版本；404 保留原文并标记 removed；超时仅标记 unavailable；恢复版本后 current.md 与选中版本一致且版本总数不减少。
- [ ] 运行 `npm run test -- tests/library/updates.test.ts`，确认缺失更新逻辑导致失败。
- [ ] 实现按用户已选栏目重新发现与重采集，发现新增文章；扫描遗漏不能当作删除依据。恢复改变当前指针和物化文件，不伪造采集时间。
- [ ] 测试恢复后再导入较新版本仍按既定采集时间优先规则处理，并在界面说明此行为。
- [ ] 运行该测试和类型检查，预期通过。
- [ ] 提交 `feat: update sources and restore article versions`。

## Task 6: 资料库界面、阅读与中文搜索

**Files:** Create `src/main/library/search.ts`, `src/renderer/{SourcePage,TaskPage,LibraryPage}.tsx`, `src/renderer/components/{Reader,VersionHistory}.tsx`, `tests/search/query.test.ts`, `tests/e2e/library.spec.ts`; Modify `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`。

**Interfaces:** `searchArticles(query: string, filter: {sourceId?: string; sectionPath?: string[]}, page: number): Promise<{items: Article[]; total: number}>`；将任务 3—5 命令添加至类型化 LibraryApi。

- [ ] 写失败测试：搜索“回收”、Redis、C++ 命中标题或正文；引号和 SQL 字符仅作查询文本；搜索过滤生效；阅读中的脚本和事件属性不会执行，外链只能显式打开允许的 http/https 地址。
- [ ] 运行 `npm run test -- tests/search/query.test.ts` 与 `npm run test:e2e -- tests/e2e/library.spec.ts`，确认失败。
- [ ] 实现中文界面：添加来源、扫描栏目选择、登录、任务控制、文章树、阅读、版本查看恢复和打开本地文件；空态、失败、未完整扫描及资源缺失均可见。
- [ ] 实现 FTS5 trigram 检索，短于三个字符和不适用的符号查询使用参数化 substring 回退，结果每页 50 条；Markdown 禁用原始 HTML 并清洗渲染结果，只通过受限资源协议读取库内图片。
- [ ] 运行两项测试和类型检查；人工检查常用桌面尺寸下长标题、代码横向滚动、表格、图片和键盘操作。
- [ ] 提交 `feat: browse and search local learning materials`。

## Task 7: 单文件备份与合并导入

**Files:** Create `src/main/backup/{manifest,export,validate,merge}.ts`, `src/renderer/BackupPage.tsx`, `tests/backup/merge.test.ts`; Modify `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`。

**Interfaces:** `exportLibrary(destination: string): Promise<void>`；`inspectBackup(path: string): Promise<BackupPreview>`；`importBackup(path: string): Promise<MergeReport>`；`BackupPreview { formatVersion, recordCount, totalBytes, conflicts }`。

- [ ] 写失败测试：A/B 各有新增文章，互相导入后合集保留；新采集版本成为当前；旧版本可恢复；二次导入 added=0；相同时间不同正文 conflicts=1 且原当前版本不变；篡改 hash、路径穿越、符号链接条目和未知格式版本被拒绝。
- [ ] 运行 `npm run test -- tests/backup/merge.test.ts`，确认缺失实现失败。
- [ ] 实现格式 v1 的 `.ikb` ZIP 包：manifest.json、规范数据记录、文章版本和资源，不复制运行中 SQLite 文件、不包含 session、缓存或密钥。导出保持数据库读取快照引用的不可变文件一致。
- [ ] 实现逐条目流式解压与 hash 校验，拒绝绝对路径、越界路径、大小写重复条目；单包最多 100000 个条目、单条目最多 256 MiB、解压总量最多 20 GiB，超限明确失败，不申请无界内存。
- [ ] 校验后暂存所有新内容，在 journal 保护下事务合并记录并重建 current.md 与搜索索引；任何阶段失败均可恢复。未来记录类型通过 formatVersion 演进，本阶段遇到不认识的必需类型明确拒绝，不静默丢弃。
- [ ] 增加断电注入、空间不足和导出过程中更新文章的测试，断言旧库不损坏且导出包自洽；运行测试与类型检查通过。
- [ ] 界面展示导入预检查、进度与合并结果；提交 `feat: export and merge portable library backups`。

## Task 8: 双平台打包与交付验证

**Files:** Modify `electron-builder.yml`, `package.json`; Create `docs/verification/release-checklist.md`, `README.md`。

**Interfaces:** `npm run dist:mac` 生成 macOS 安装产物，`npm run dist:win` 在 Windows 构建环境生成 Windows 安装产物；文档指明数据目录、备份方式和已验证系统架构。

- [ ] 运行 `npm run typecheck`、`npm run test`、`npm run test:e2e`，全部通过后再打包，不以增加无关测试代替修复已知问题。
- [ ] 在 macOS 构建并验证安装、启动、采集、重启、阅读、版本恢复、备份导入；确认原生 SQLite 随包正常工作。
- [ ] 在实际 Windows 环境执行相同验证，包括非 ASCII 用户目录、路径长度、安装后权限和图片相对链接。没有 Windows 环境时明确记录未验证，不声称双平台交付完成。
- [ ] 两台设备互导备份并重复导入，确认文章、资源、版本、搜索一致且登录状态未迁移。
- [ ] 记录应用签名/公证状态；没有证书时交付本地测试包并如实说明，不声称已签名或可公开发行。
- [ ] 完成代码审查及验收记录，将实际站点失败项与产品限制写入 README；提交 `build: package and verify desktop library`。

## 自审与后续边界

第一阶段覆盖映射：扫描与登录→任务3；正文和图片→任务2、4；暂停继续与失败重试→任务4；手动更新和历史→任务5；阅读搜索→任务6；备份合并→任务7；macOS/Windows→任务8。中文与路径、登录伪正文、中断和备份冲突均有归属测试。

第二阶段另行计划：模型配置、检索与重建、答案出处和历史版本引用、问答记录及备份扩展。第三阶段另行计划：简历/JD 的文字、PDF、Word 提取与确认，题库、两种面试范围、两种出题与反馈方式、评分量表和记录合并。文档格式边界和评分细则在对应阶段明确，当前不悄然删减已批准需求。

执行方法待用户选择：主代理在当前会话按任务推进，或由子代理逐任务实现并审查。计划审阅及执行方式确认前不开始实现。本轮仅产出计划；所有测试命令均为后续执行步骤，未在本轮运行。
