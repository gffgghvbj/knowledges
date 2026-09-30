# 向量检索验收与使用说明

版本 0.3.0，日期 2026-09-30。

## 配置用户指定的模型

在「模型设置 → 向量检索与精排」勾选「启用混合检索」：

- Embedding 模型：`qwen3.7-text-embedding-flash`，默认 1024 维。
- Rerank 模型：`qwen3.7-text-rerank`，默认启用。
- 两个模型默认采用百炼 / DashScope 原生协议；每项使用完整接口地址及对应 API Key。地址、模型和维度均可修改。
- DeepSeek 回答模型继续使用原有聊天设置，不能把聊天 URL 填作 Embedding 或 rerank URL。

以下 `HOST` 替换为自己控制台的业务空间 API Host，不能保留示例占位符：

```text
https://HOST/api/v1/services/embeddings/text-embedding/text-embedding
https://HOST/api/v1/services/rerank/text-rerank/text-rerank
```

例如北京地域 API Host 格式为 `业务空间ID.cn-beijing.maas.aliyuncs.com`，具体值以账户控制台为准。依据：[Embedding 官方接口](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api)、[Rerank 官方接口](https://help.aliyun.com/zh/model-studio/text-rerank-api)。

如果使用第三方兼容服务，选择对应协议并填写它提供的完整 URL；兼容 Embeddings 为 `model/input/dimensions` 请求与 `data[index,embedding]` 响应，兼容 Rerank 为 `model/query/documents/top_n` 请求与 `results[index,relevance_score]` 响应。不承诺所有第三方非标准协议通用。

本地 Embedding 可选择 Ollama，地址通常是 `http://127.0.0.1:11434/api/embed`，填写本机已下载的模型和匹配维度。Qwen 3.7 云端模型名称不能直接视为 Ollama 已安装模型。可关闭云端精排，仅使用本地向量与关键词。

点击「保存并测试检索」，测试通过后点击「建立 / 继续索引」。测试只发送内置短文本，建索引会分批发送资料片段至配置服务，可能产生费用。支持本机兼容服务无需 Key；远程在线接口必须填写 Key，禁止不加密的远程 HTTP。

## 实际实现

- 本地 SQLite 保存归一化 Float32 向量，显式小端编码，macOS/Windows 共用代码。
- 使用余弦精确检索，没有引入独立向量服务器或 ANN 索引。索引模型、协议、地址、维度与输入格式共同形成指纹；输入哈希防止过期内容复用。
- 向量与关键词各召回最多 24 条，RRF（k=60）融合，最多 24 个候选、48000 字符交给 rerank；最终最多 8 段、18000 字符交给回答模型。
- 向量相似度阈值默认 0.2，可以调整，不等于答案可信度。向量失败时降级关键词，精排失败时使用召回顺序；实际方式及原因保存在问答记录并展示。
- 第一次手动开始后，新增、更新、恢复及导入自动补齐索引。暂停与错误持久化，错误停止请求，需手动重试；应用正常关闭保留自动维护意图，重启继续。更改配置会暂停任务，旧请求不能污染新索引。
- 超过 18000 字符的单个片段被排除并显示数量，原文仍保留。大型资料库尚未性能验收；精确检索复杂度随片段数和向量维度增长。
- 备份继续使用格式 v2；问答新增可选检索记录字段，向量和密钥不导出。导入到另一设备后使用本机设置重建。已开启自动索引的本机会对导入片段调用其配置的模型。

## 验证与边界

- TypeScript 类型检查通过，43 项单元测试通过，5 项打包版 macOS Electron 端到端测试通过。
- 协议验证覆盖 DashScope、兼容 Embeddings、Ollama；包含返回乱序、维度不符、零向量、重复/越界索引及重定向拒绝。
- 控制向量的语义召回测试：问题与原文无共同关键词时仍命中目标；覆盖范围过滤、当前版本、模型空间、缓存复用、暂停时过期请求、失败、问答取消及备份重建。
- 桌面测试覆盖用户指定模型名的配置、连接测试、建立索引、混合召回与精排、最终版本引用；原有采集、登录、问答流程回归通过。
- 这些测试使用本机可控制服务，不等同于真实 Qwen 推理质量验收。没有读取或使用用户 API Key。实际业务空间权限、额度、模型可用性及答案质量需本机配置后验证。
- 独立审查未发现 Critical / Important 问题。两项测试建议已补齐：不暂停时更新文档拒绝旧向量；关闭并重新打开数据库后继续未完成索引、保留失败暂停状态并可手动恢复。
- macOS Apple Silicon 应用和 Windows x64 便携版位于 `release/v0.3.0`，两端 app.asar 内版本均核验为 0.3.0。Windows ZIP 完整性及 SHA-256 校验完成；没有 Windows 实机，尚未进行该平台运行验收。应用未签名，Windows 使用原 Electron 可执行文件元信息。
- 设置与问答截图保存在同一发布目录。截图使用本地测试接口和 3 维测试向量，实际默认维度为 1024，不应照抄截图中的接口或维度。
