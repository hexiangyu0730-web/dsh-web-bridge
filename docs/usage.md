# 使用与集成说明 / Usage and integration

## 数据去向

浏览、读取：本机 DSH Host 使用你的登录 Token 请求 `chat.deepseek.com`。前端通过本机同源接口读取结果，不直接把 Token 交给文件 CDN。

网页聊天：提示词、附件、重答和会话管理操作作用于 DeepSeek 网页账号。工作区导入：读取网页历史及附件，创建独立的本地 DSH 会话，后续使用 DSH 默认模型。

Context injection into an existing local session is text-only (maximum 200,000 characters). Importing a workspace/new session migrates supported attachments and preserves reasoning and source references. The web chat retains parallel answer branches; import and Markdown use the web session's selected mainline rather than flattening sibling answers into one conversation.

## 附件保存在哪里

- 工作区原文件：`<workspace>/deepseek-web-attachments/<web-session-id>-<random-suffix>/`。每次导入新建子目录，同名文件避让，不覆盖已有文件；消息记录相对路径。
- DSH 原生附件：`$DSH_HOME/attachments/v1`（默认 `~/.dsh/attachments/v1`），由 DSH 服务管理，消息和模型通过本地引用使用它们。图片可能受原生格式、尺寸及规范化策略影响。
- 两侧单独报告结果。过期、只读目录、网络或存储失败不会悄悄被视为成功；可保留成功的部分并查看失败原因。
- 卸载插件、删除网页会话不会清理上述副本。需要删除本地文件时请先确认没有本地会话仍在引用。

## 模型可见工具

| Tool | Purpose |
| --- | --- |
| `deepseek_web_sessions` | List web conversations. |
| `deepseek_web_read` | Read a conversation as Markdown. |
| `deepseek_web_import` | Import into a new DSH session/workspace, or inject text into the current session. |
| `deepseek_web_continue` | Send to a web conversation; omitting `sessionId` creates one. |
| `deepseek_web_workspaces` | List DSH workspaces for an import destination. |

Tool registration and UI use the same Host implementation. No background timer generates web messages. File-metadata reads use bounded retries and a shared per-account pacing queue; writes are not automatically replayed.

## 环境变量

| Variable | Default / meaning |
| --- | --- |
| `DEEPSEEK_WEB_TOKEN` | Optional credential source instead of the DSH credential reference. Treat it as a secret. |
| `DSH_DEEPSEEK_WEB_BASE_URL` | `https://chat.deepseek.com`; development override. Do not point it at an untrusted service: authenticated requests go there. |
| `DSH_DEEPSEEK_WEB_ALLOW_REMOTE` | Off. Set to `1` only when intentionally allowing remote access to the plugin endpoints. |

Remote opt-in is **not authentication**. DSH's web surface must be protected separately; never expose it on the public internet without appropriate access controls. Local access checks do not sandbox other plugins or the local user.

## 插件结构

- `cordis.patch.yml`: a top-level YAML patch array inserting row `deepseek-web`. The relative Host path is anchored to the bundle patch, allowing old local aliases to resolve after the npm rename.
- `lib/index.js`: Node Host with injected DSH services; no imports of DSH singleton packages.
- `lib/client.js`: browser factory registered as `@xueray/dsh-web-bridge`, matching the package name. Uses React and native DSH primitives supplied by the client runtime.
- `locale/`: public metadata. UI registers Chinese/English strings with DSH's locale service.
- Existing `dsh-deepseek-web.*` browser storage keys and `/deepseek-web` routes deliberately remain stable for migration. These are internal compatibility identifiers, not the public npm package name.

The UI uses documented `settings.section`, `sidebar.footer.action`, `conversation.input.left` and main-panel slots. It does not patch the official DOM or rewrite user profile configuration. The sidebar slot is not an extension point inside the native workspace list itself.

## 协议依据与排错

This package implements an unofficial client, not a stable API contract. DSH integration follows its [packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) and [client module architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.md). Protocol research references and upstream attribution are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

遇到接口 404、功能缺失或版本不一致，先完全退出 DSH（含托盘）再启动，检查设置里的插件版本。断流后刷新网页历史，不要依赖本地停止按钮判断上游是否已完成。报错时提供 DSH/插件版本、已脱敏错误和最小复现步骤即可，不要提交 Token、凭据文件、真实会话导出或临时签名地址。
