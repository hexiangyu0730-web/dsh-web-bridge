# 发布清单

包名：`@xueray/dsh-web-bridge`。仓库：`SaiSenBox/dsh-web-bridge`。
源码先上传 GitHub；npm、GitHub Release 与收录 PR 单独发布。本清单不代表这些步骤已经完成。

## 发布前

1. 审查 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`，确认有权发布所有代码、图片和修改。PolyForm Noncommercial 不是 OSI 开源协议；不要标成 MIT，也不要承诺允许一般商业使用。
2. 建立公开 GitHub 仓库，添加 `dsh-plugin` topic；核对 package 的 author/repository/homepage/bugs。不要上传 `output/`、`.playwright-cli/`、凭据或真实聊天记录。
3. 用演示数据生成截图，逐张检查文字、文件名、路径、Token、浏览器栏和图片内容，再更新根目录 `screenshots.json`。截图仅演示 UI，不应冒充真实账号实测。
4. 运行 `npm run check`、`npm test`、`npm run verify:package`。CI 在 Ubuntu/Windows、Node 22.19/24 上执行相同检查。
5. 保持 `package.json`、Host `VERSION`、Client `FALLBACK_VERSION` 与 CHANGELOG 版本一致；在隔离 profile 验证真实 DSH 加载和卸载。不要拿日用 profile 做破坏性测试。
6. npm 发布后核对中英文 README 的安装命令、线上版本与包内容一致。

## npm

先运行 `npm whoami`，确认登录了有权发布 `@xueray/dsh-web-bridge` 的 npm 账号。本包使用 npm 账号 `xueray` 的作用域，GitHub 作者署名仍为 SaiSenBox；两者不必相同。登录过期时使用 `npm login`；需要二次认证时按浏览器/通行密钥提示操作，不要把 Token 写进仓库或聊天。

```sh
npm publish --access public
```

`prepublishOnly` 会重跑语法、离线测试和真实 tarball 安装检查；失败就停止。发布后核对：

```sh
npm view @xueray/dsh-web-bridge version license dist.integrity
dsh plugin --profile bridge-smoke add @xueray/dsh-web-bridge
dsh --profile bridge-smoke --dump-config
```

`bridge-smoke` 是新建的专用验证 profile，不要替换成已有日用 profile。Dump-config 只验证组合配置，不等同于完成 UI/网络实测。

## GitHub Release

将审查过的代码推送到计划仓库后，为相同提交打版本 tag（如 `v0.4.5`），不要重新用该版本发布不同代码。GitHub Release 应附上从同一提交 `npm pack --ignore-scripts` 得到的 `.tgz` 和校验值；不要只给源码 zip，却让用户猜哪一个能安装。

可在 Release 上传固定文件名 `dsh-web-bridge.tgz`，便于使用 `releases/latest/download/dsh-web-bridge.tgz`。它必须是同一份 npm tarball 的副本，而不是另外打包的内容。CI 的 package artifact 可用于复核，但不能代替 npm/GitHub 发布。

## Awesome DSH Plugin 收录

按[当前贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)，只新增：

`data/plugins/SaiSenBox__dsh-web-bridge.yml`

内容模板在 [submission/SaiSenBox__dsh-web-bridge.yml](submission/SaiSenBox__dsh-web-bridge.yml)。**不要手改对方的 README**。仓库需公开、创建满 1 天、包含真实可用代码和 `dsh.bundle`，并添加 `dsh-plugin` topic。截图清单放在我们自己的仓库。

指南没有列出必须使用 MIT/OSI 协议的硬性要求，但非商业许可、非公开接口和功能重叠仍应如实说明，是否收录由维护者决定。不要把通过本地检查说成已经通过官方审查。
