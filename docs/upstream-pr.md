# 上游 PR 记录

- 上游仓库：<https://github.com/SaiSenBox/dsh-web-bridge>
- PR：**[#1](https://github.com/SaiSenBox/dsh-web-bridge/pull/1)** — `feat: 网页对话输入框支持粘贴与拖放附件`
- 提交来源：`hexiangyu0730-web:pr-attach`（fork `hexiangyu0730-web/dsh-web-bridge-fork`）
- 基线：`b5531f2`（上游 v0.4.5）
- 改动：1 个提交、1 个文件（`lib/client.js`）、`+68 −1`

## PR 正文（原文）

## 背景

在网页对话里发图片或文件，目前只能点输入框左下角的 **+** 再选文件。截图之后最顺手的是直接 Ctrl+V，把文件拖进聊天窗口也是常见做法，但现在这两种操作都没有任何反应：`textarea` 默认忽略非文本内容，面板上也没有接收拖放的区域。

## 改动

只改 `lib/client.js` 的网页对话面板（`WebChatPanel`），不新增接口、不新增依赖、不改上传链路：

1. **输入框加 `onPaste`**：从 `clipboardData.files` / `items` 取文件，交给现有的 `addFiles()`。仅当剪贴板里**没有文字**时接管，所以复制带内嵌图片的富文本仍然按文本粘贴，不会突然变成附件。
2. **面板根节点加拖放**：`dragenter/dragover/dragleave/drop`，用深度计数器抵消子元素冒泡（移入子元素会再次触发 enter），拖入文件时加 `dsweb-drop-active`，输入框显示虚线高亮，松手后交给 `addFiles()`。
3. 拖放在发送中、历史加载中、回答分支异常时不接收，与 **+** 按钮的 disabled 条件一致。

两者沿用原有上传链路：最多 10 个附件、单个 ≤ 20 MiB、沿用原有缩略图与失败提示。

## 边界

- 拖放只在 `DataTransfer.types` 含 `Files` 时接管，不影响侧栏把网页会话拖进工作区导入的既有交互。
- 深度计数在 `drop` 或最后一个 `dragleave` 归零，不会残留高亮。
- 改动约 68 行，集中在 `WebChatPanel` 内的三处，见下方 diff。

## 测试

- `npm run check`：通过。
- `npm test`：通过（`retry-lifetime` 需要在环境里起子进程，我这边环境跑不了，CI 会覆盖）。
- 同一改动的 CI（`check` / `npm test` / `verify:package`）已在我的仓库上通过：<https://github.com/hexiangyu0730-web/dsh-web-bridge>。

## 其他

- 本补丁为原创改动，按项目 PolyForm Noncommercial 1.0.0 提交，未引入第三方代码。
- 如果只想收「粘贴」而不想要拖放，或者想拆成两个 PR，我可以随时调整。

## 状态

- 已创建，处于 open。
- GitHub 显示 `action_required`：来自 fork 的首次贡献需要维护者批准后才会运行 workflow，这是 GitHub 的默认策略，不是构建失败。
- 等待维护者审核/批准 CI；如需调整（只收粘贴、或拆成两个 PR），在原 PR 上回复即可。
