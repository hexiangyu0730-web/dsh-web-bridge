# 修改说明（fork）

本仓库是 **非官方修改版**，基于 SaiSenBox 的 [`@xueray/dsh-web-bridge`](https://github.com/SaiSenBox/dsh-web-bridge) 0.4.5。

- 原作者：SaiSenBox（<https://github.com/SaiSenBox>），上游仓库：<https://github.com/SaiSenBox/dsh-web-bridge>
- 本版本的改动**未经原作者审核**，不代表原作者意见，也不是 DeepSeek 官方产品。
- 仅限**非商业用途**。许可证为 PolyForm Noncommercial 1.0.0（见 [LICENSE](LICENSE)），分发时必须保留许可全文与文件顶部的 Required Notice；商业授权请联系原作者。
- 本仓库保留了上游的测试与 CI 配置；`docs/`、`assets/`、截图等仍来自上游。

## 本版本改了什么

代码改动只在 `lib/client.js` 的网页对话面板（`WebChatPanel`）内，共三处：

1. **粘贴附件**：输入框新增 `onPaste`。从 `clipboardData.files` / `items` 取出文件交给原有的 `addFiles()`；仅当剪贴板没有文字时接管，复制富文本仍按文本粘贴。
2. **拖放附件**：聊天面板根节点绑定 `dragenter/dragover/dragleave/drop`，用计数器避免子元素抖动；拖入文件时加 `dsweb-drop-active` 类。发送中、历史加载中或回答分支异常时不接收。
3. **样式与版本**：新增 `.dsweb-chat.dsweb-drop-active .dsweb-chat-composer` 虚线高亮；`FALLBACK_VERSION` / `VERSION` / `package.json` 版本改为 `0.4.5-fork.1`。

两者都复用原有上传链路，限制不变：最多 10 个附件，单个 ≤ 20 MiB；输入框文本上限仍为 8000 字符。

## 安装

需要 DSH `>=0.2.1-rc.2 <0.3.0`。

```sh
# 从你自己的 GitHub 账号安装（把 USER 换成你的用户名）
dsh plugin --profile desktop add github:USER/dsh-web-bridge

# 本地目录安装
dsh plugin --profile desktop add ./dsh-web-bridge
```

安装或更新后**完全退出 DSH（包括托盘进程）**再打开，只刷新页面不会重新加载 Host 接口和前端包。

已经装过上游 `@xueray/dsh-web-bridge` 的话，先移除旧包再装本版本，不要两份同时启用：

```sh
dsh plugin --profile desktop remove @xueray/dsh-web-bridge
```

## 发布前的检查清单

1. 在 GitHub 新建仓库（不建议直接 fork 后改名，容易和上游混淆；单独建库更清楚，但需保留本文件与 LICENSE）。
2. 按需改 `package.json` 的 `repository` / `homepage` / `bugs` 指向你自己的仓库；`author` 保持 SaiSenBox 署名。
3. 仓库设为 **public**，并保留 LICENSE 与 Required Notice；不要改成 MIT 等其它许可。
4. 不要把 `DEEPSEEK_WEB_TOKEN`、`.credentials.yaml`、日志或截图里的 token 提交上去。
5. 不要发布到 npm 的 `@xueray` 作用域（不属于你）；如需分发，用 GitHub 安装方式。

## 推送到 GitHub

仓库地址预设为 `https://github.com/hexiangyu0730-web/dsh-web-bridge.git`（`origin`），`upstream` 指向原作者。

```powershell
# 1. 在 GitHub 上新建一个空仓库：dsh-web-bridge，不要勾选 README / .gitignore / license
# 2. 首次推送，浏览器会弹出 Git Credential Manager 登录
git push -u origin main
```

推送成功后安装：

```sh
dsh plugin --profile desktop remove @xueray/dsh-web-bridge
dsh plugin --profile desktop add github:hexiangyu0730-web/dsh-web-bridge
```

## 与上游的关系

- 上游更新后，本仓库不会自动同步。合并上游时重点看 `lib/client.js` 的 `WebChatPanel`、`addFiles` 和版本常量三处，容易冲突。
- 想回到上游原版：`dsh plugin --profile desktop remove` 本仓库版本后重新安装 `@xueray/dsh-web-bridge`。

## 风险

上游使用的是 DeepSeek 网页端的非公开接口，没有稳定性承诺，可能被限流或改变；发送、重答、删除等操作会修改网页账号。请自行确认使用方式符合服务条款。
