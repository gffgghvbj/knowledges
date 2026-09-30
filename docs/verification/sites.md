# 首批网站验证

日期：2026-09-30。使用 Electron 44.5.0，在临时资料目录中仅采集用户提供的两篇样例，未启动整站下载。

| 样例 | 正文提取 | 下载图片 | 结果 |
|---|---:|---:|---|
| 小林 coding Redis 面试题 | 44,950 个 Markdown 字符 | 43 | complete |
| JavaGuide JVM 垃圾回收 | 18,980 个 Markdown 字符 | 20 | complete |

运行命令：`npm run test:e2e -- --config=playwright.live.config.ts`，2/2 通过。界面截图和结果 JSON 在被 Git 忽略的 `test-results/` 中。

正文选择器：小林 coding `.theme-default-content`；JavaGuide `[vp-content]`。离线解析原始 HTML 时分别发现 50/31 个同源候选链接。这是样例页面的发现结果，不是整站文章总数或完整覆盖率。

两篇样例在本次访问中均公开可读。实际第三方账号、扫码流程、付费内容及其他登录限制尚未验证。登录会话复用通过本地受保护测试站验证：登录前任务暂停，用户在隔离窗口登录后继续扫描，远程窗口不能访问本地应用桥接接口。

真实测试发现并修复了 Electron 网络层两个兼容点：

- `Response.url` 不可靠：按同源边界手动跟踪重定向。
- 手写 `Referer` 头使跨源图片请求返回 `ERR_BLOCKED_BY_CLIENT`：标准 `referrer` 参数正常返回 PNG，修复后 63 张图片全部保存。

公开页面成功不代表所有页面都可采集。动态页面、付费遮罩、跨域登录及其他站点仍须按真实访问行为验证。
