# 第一阶段验收记录

此文件保留第一阶段记录。当前 v0.2 状态见 [第二阶段验收](phase2.md)。

日期：2026-09-30。

## 已通过

- TypeScript 类型检查：`npm run typecheck`。
- 单元/领域测试：`npm test`，25/25 通过，覆盖存储版本、图片相对路径、恢复、来源识别、扫描与重试、限流等待、中文搜索、合并及恶意备份校验。
- 开发版桌面端到端：`npm run test:e2e`，3/3 通过。
- 真实公开样例：小林 coding Redis、JavaGuide JVM，2/2 通过，分别下载 43/20 张图片，结果均为 complete。详情见 [网站验证](sites.md)。
- macOS arm64 本地应用包生成成功：`release/mac-arm64/拾知.app`。
- Windows x64 无签名测试包生成成功：`release/Shizhi-Windows-x64-0.1.0.zip`，解压完整目录后运行 `拾知.exe`。PE 头确认目标为 x86-64，尚未真机运行。
- 直接使用 macOS 打包产物运行相同桌面测试，3/3 通过：启动/桥接隔离；扫描→采集→中文搜索→正文与本地图片阅读；登录会话复用。
- 独立只读代码审查完成，四项重要发现均修复并有回归测试；额外修复 Retry-After 处理。详见 [实施决定与审查记录](implementation-notes.md)。

## 平台与交付限制

- macOS：已验证当前 macOS 15.5 / Apple Silicon 环境。未验证 Intel Mac。应用使用默认 Electron 图标，未签名、未公证；这是本地测试应用包，不是正式发行安装器。
- Windows：官方运行时下载受网络超时阻断后，改用公开镜像；其 SHA-256 与官方 Electron npm 包随附校验值严格一致后才用于打包。使用自定义已校验运行时目录，并禁用签名/可执行文件元信息编辑，生成本地测试包。没有 Windows 真机环境，尚未验证安装、运行、路径与双机互导，不将跨平台验收标记为完成。
- 备份双资料库合并通过同机独立目录测试，不等同于 macOS↔Windows 双机验收。
- 两个第三方网站的登录/付费页面尚未用真实账号验证。受保护内容流程在本地 HTTP 测试站验证。
- 未做真实断电、磁盘写满或超大资料库性能验收。当前恢复测试验证已有版本重建 current.md，不把它表述为所有故障均已验证。

## 使用与后续

打开 `release/mac-arm64/拾知.app` 可使用桌面应用，或在项目目录运行 `npm start`。

Windows 网络与测试环境可用后运行：

```bash
npm ci
npm run typecheck
npm test
npm run test:e2e
npm run dist:win -- --x64
```

随后执行实际安装/运行、中文用户目录、两设备备份合并及重复导入检查，再完成第一阶段的 Windows 验收。

Windows 本次运行时校验值：`b3405d8847bc5054cd16272f538d22ba5b73032945e85cef26241f7135035278`。发行 ZIP 自身的校验值另存于 `release/SHA256SUMS.txt`。打包命令增加 `-c.electronDist=/tmp/shizhi-electron-win-runtime -c.win.signAndEditExecutable=false`；该临时目录不是运行应用所需依赖。

知识库问答、简历/JD 导入、模拟面试和评分属于后续阶段，当前界面仅标注“待开发”，没有伪装为可用功能。
