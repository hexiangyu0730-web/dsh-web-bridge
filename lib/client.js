// @xueray/dsh-web-bridge — browser-side DeepSeek web conversation bridge.
//
// Native-style settings, inline sidebar group, browsing/import page and web chat.
// The chat stays on the web account; dragging to a workspace imports a local copy.
//
// Loaded through window.__ModuleLoader__ (id === package name). No JSX and no
// external assets: React.createElement only, plus one injected <style> block that
// uses --dsw-* theme tokens so light/dark and accent colors follow the app.
window.__ModuleLoader__.load({
	id: "@xueray/dsh-web-bridge",
	factory: function (require) {
		var React = require("react");
		var R = React.createElement;
		var Primitives = {};
		try { Primitives = require("@deepseek-ai/dsh-client-ui-primitives"); } catch (_) { /* Older clients retain the plain React fallback. */ }

		var LOCALE_NS = "@xueray/dsh-web-bridge";
		var API_BASE = "/deepseek-web";
		var FALLBACK_VERSION = "0.4.5";
		var MAX_TOKEN_LENGTH = 4096;
		var MAX_PROMPT_LENGTH = 8000;
		var MAX_TEXT_CHARS = 20000;
		var MAX_SEARCH_RESULTS = 100;
		var REQUEST_TIMEOUT_MS = 60000;
		var CONTINUE_TIMEOUT_MS = 240000;

		// ------------------------------------------------------------------ locale
		var messages = {
			zh: {
				sectionTitle: "DeepSeek 会话桥",
				searchConversations: "搜索网页会话…",
				searchToggle: "搜索网页对话",
				closeSearch: "收起搜索",
				searchNoResults: "没有匹配的网页会话",
				manageConversations: "浏览与导入会话",
				openWebChat: "打开网页对话",
				connectionHelpTitle: "如何获取 Token",
				continueStop: "停止等待",
				continueStopped: "已停止等待回复，请刷新会话确认发送结果。",
				uploadFiles: "上传附件",
				fileUploading: "上传并解析中…",
				fileReady: "已就绪",
				fileRemove: "移除附件 {name}",
				fileRetry: "重新上传 {name}",
				fileLimit: "每条消息最多 10 个附件，单个文件不能超过 20 MiB，且不能为空。",
				hostRestartRequired: "上传接口尚未加载。请完全退出 DSH（包括托盘进程）并重新打开，再重试上传。",
				imagePreview: "查看图片 {name}",
				imageDialog: "图片预览",
				imageClose: "关闭图片预览",
				imageFailed: "图片加载失败",
				imageLoading: "图片加载中…",
				attachmentsImported: "附件已保存到本地：{count}/{total}",
				attachmentsFailed: "未导入：{name}（{message}）",
				workspaceFilesSaved: "原文件已保存到工作区：{count}/{total}",
				workspaceFileFailed: "未保存到工作区：{name}（{message}）",
				deleteWebChat: "删除网页对话",
				renameWebChat: "重命名网页对话",
				renameWebChatNamed: "重命名网页对话 {title}",
				renameTitle: "重命名网页对话",
				renameLabel: "会话标题",
				renameSave: "保存",
				renamePending: "正在保存…",
				renameFailed: "重命名未完成：{message}",
				closeImportResult: "关闭导入提示",
				deleteWebChatNamed: "删除网页对话 {title}",
				deleteTitle: "删除这条网页对话？",
				deleteDescription: "将从 DeepSeek 网页账号永久删除「{title}」，此操作不可恢复。已导入的本地会话和工作区文件不受影响。",
				deleteConfirm: "永久删除",
				deletePending: "正在删除…",
				deleteFailed: "删除未完成：{message}。请刷新列表确认结果后再操作。",
				cancel: "取消",
				openImportedSession: "打开已导入会话",
				streamInterrupted: "回复连接提前中断，请刷新网页会话确认结果后再继续。",
				imageRetry: "重新加载图片 {name}",
				newWebChat: "新建网页对话",
				refreshRequired: "发送状态尚未确认，请先刷新会话再继续。",
				settingsWorkflows: "网页会话",
				destination: "目标工作区",
				copyContent: "复制",
				regenerate: "重新回答",
				regenerateFailed: "重新回答失败：{message}",
				previousAnswer: "上一个回答",
				nextAnswer: "下一个回答",
				answerVersions: "回答 {index} / {count}",
				previousQuestion: "上一个提问分支",
				nextQuestion: "下一个提问分支",
				questionVersions: "提问分支 {index} / {count}",
				regenerateHostRestartRequired: "重新回答接口尚未加载，请完全退出 DSH（包括托盘）并重新打开。",
				branchInvalid: "会话分支数据不完整，请刷新会话后再继续。",
				copyMessageFailed: "复制失败，请手动选中内容复制。",
				webSources: "网页搜索 · {count} 个来源",
				processThought: "已思考",
				processTimed: "已思考 {duration}",
				processThinking: "正在思考…",
				processSearch: "正在搜索网页…",
				processOpen: "正在浏览网页…",
				processDone: "处理过程",
				processStopped: "处理未完成",
				processHostRestartRequired: "后台仍是旧版，暂时无法还原思考与搜索的交错顺序。请完全退出 DSH（包括托盘）并重新打开，再刷新会话。",
				processSearchStep: "网页搜索",
				processOpenStep: "浏览网页",
				processSeconds: "{seconds}秒",
				processMinutes: "{minutes}分{seconds}秒",
				processHours: "{hours}小时{minutes}分",
				clockMD: "{m}月{d}日",
				clockYMD: "{y}年{m}月{d}日",
				sidebarListLabel: "DeepSeek 网页",
				sidebarListToggle: "DeepSeek 网页会话列表",
				sidebarListPanelTitle: "DeepSeek 网页对话",
				sidebarListHint: "单击＝在 DSH 内继续该网页对话（临时，不保存到本地）；拖到左侧栏工作区行＝复制到该工作区",
				sidebarListDragHint: "松手到左侧栏工作区行，即可导入到该工作区",
				webChatBadge: "DeepSeek 网页对话",
				webChatNoToken: "尚未配置网页端 token。",
				webChatNoTokenHint: "请到 设置 → DeepSeek 网页对话 填写 token 后再继续。",
				webChatEmpty: "这个网页对话还没有消息。",
				webChatClose: "关闭临时对话",
				webChatRefresh: "刷新网页对话",
				sidebarListNoToken: "尚未配置网页端 token。",
				sidebarListTokenHint: "粘贴 token 后保存即可读取网页会话，或到设置 → DeepSeek 网页对话 中配置。",
				sidebarListEmpty: "没有读取到网页会话。",
				sidebarListClose: "收起列表",
				sidebarListImported: "已导入到工作区「{title}」",
				panelTitle: "DeepSeek 网页对话",
				panelSubtitle: "浏览 chat.deepseek.com 上的会话，预览内容，导入为 DSH 会话，或把新的提问写回网页端继续。",
				pageSubtitle: "拖拽会话到工作区即可复制到本地继续。",

				tokenHeading: "网页端 Token",
				tokenHelp: "在浏览器登录 chat.deepseek.com，打开开发者工具控制台，执行下面的命令，把返回的字符串粘贴到这里。",
				tokenCommand: "JSON.parse(localStorage.getItem('userToken')).value",
				tokenConfigured: "已配置",
				tokenMissing: "未配置",
				tokenInputLabel: "Token",
				tokenPlaceholder: "粘贴 userToken 的值…",
				tokenSave: "保存 Token",
				tokenSaving: "保存中…",
				tokenClear: "清除",
				tokenClearing: "清除中…",
				tokenShow: "显示",
				tokenHide: "隐藏",
				tokenHintPrefix: "掩码：",
				tokenSaved: "Token 已保存，正在重新读取网页端会话。",
				tokenCleared: "Token 已清除。",
				tokenEmpty: "请先粘贴 token 再保存。",
				tokenTooLong: "Token 过长，请检查是否粘贴了完整且正确的内容。",
				tokenNote: "Token 只保存在本机 DSH 凭据文件中，不会随会话记录发送给模型。",

				statusLoading: "正在读取插件状态…",
				statusError: "无法读取插件状态：{message}",
				retry: "重试",

				sessionsHeading: "网页端会话",
				refresh: "刷新",
				loading: "加载中…",
				sessionsNeedToken: "配置 token 后，这里会列出你网页端的会话。",
				sessionsEmpty: "没有读取到会话。",
				sessionsError: "读取会话失败：{message}",
				loadMore: "加载更多",
				allLoaded: "已经到底了",
				pinned: "置顶",
				untitledSession: "未命名会话",

				previewHeading: "预览",
				previewNeedSelection: "在上方会话列表中选一个会话即可预览。",
				previewLoading: "正在加载会话内容…",
				previewError: "加载会话内容失败：{message}",
				previewMessages: "{count} 条消息",
				previewEmpty: "这个会话没有可显示的消息。",

				actionsHeading: "导入与续聊",
				includeThinking: "导入时包含思考过程",
				importNew: "导入到新 DSH 会话",
				importCurrent: "导入到当前会话",
				importing: "导入中…",
				importCurrentDisabled: "当前没有打开的 DSH 会话",
				importFailed: "导入失败：{message}",
				importNewSuccess: "已导入为新 DSH 会话（{count} 条消息）",
				importCurrentSuccess: "已导入当前 DSH 会话（{count} 条消息）",
				importSeedHint: "在侧边栏打开新会话继续对话。会话 ID：{id}",
				importContextHint: "内容已作为当前会话的上下文注入，直接继续提问即可。",
				workspacesHeading: "工作区",
				workspacesHint: "点击卡片可设为导入目标；也可以把会话拖到卡片或左侧栏的工作区行上直接导入。",
				workspacesEmpty: "没有可用的工作区。请先在 DSH 中打开一个项目目录。",
				workspacesError: "读取工作区失败：{message}",
				workspaceSessions: "{count} 个会话",
				untitledWorkspace: "未命名工作区",
				dragBanner: "松手到左侧栏的工作区行，或本页工作区卡片，即可复制到该工作区",
				importTargetLabel: "导入到：",
				importTargetHint: "默认依次取：上次选择的工作区 → 当前 DSH 会话所在工作区 → 第一个工作区。",
				rowImportHint: "点击会话标题即可导入并进入对话；点「预览」只看内容，不导入。",
				previewAction: "预览",
				previewActionTitle: "只展开预览，不导入",
				rowImporting: "导入中…",
				dropCancel: "没有拖到工作区行，已取消导入。",
				workspaceSelected: "目标",
				importNeedsWorkspace: "先选择一个工作区，再导入网页会话。",
				importWorkspaceSuccess: "已导入到工作区「{title}」（{count} 条消息）",
				importWorkspaceHint: "已在新会话中打开：{id}",
				importWorkspaceOpenFailed: "已导入，但自动打开会话失败：{message}",
				importWorkspaceNoOpen: "已导入。请在侧边栏打开新会话继续。",

				currentSessionLabel: "当前 DSH 会话：",
				currentSessionNone: "未检测到当前 DSH 会话",
				copyId: "复制 ID",
				copied: "已复制",
				copyFailed: "复制失败，请手动选择。",

				continueHeading: "在网页端继续",
				continuePlaceholder: "发消息…",
				continueThinking: "思考模式",
				continueSearch: "联网搜索",
				continueSend: "发送",
				continueSending: "发送中…",
				continueNeedSelection: "先选择一个网页端会话，才能继续。",
				continueEmpty: "请先输入要发送的内容。",
				continueSuccess: "已写回 DeepSeek 网页端，回复已追加到预览。",
				continueFailed: "续聊失败：{message}",

				userLabel: "我",
				assistantLabel: "DeepSeek",
				thinkingLabel: "思考过程",
				searchLabel: "搜索引用",
				emptyMessage: "（空消息）",

				footerVersion: "版本 {version}",
				footerDisclaimer: "接口非官方，可能随网页端更新而失效；频繁调用也可能触发风控。请仅用于自己的账号并保持合理频率。",

				boundaryError: "面板渲染出错，已阻止影响设置页其余部分。",
				boundaryDetail: "可以关闭设置后重新打开；若持续出现，请查看浏览器控制台。",

				errorTimeout: "请求超时，请稍后重试。",
				errorNetwork: "请求未送达（可能 DSH 未就绪或插件未加载）。",
				errorUnknown: "未知错误",

				timeJustNow: "刚刚",
				timeMinutes: "{count} 分钟前",
				timeHours: "{count} 小时前",
				timeDays: "{count} 天前"
			},
			en: {
				sectionTitle: "DeepSeek Web Bridge",
				searchConversations: "Search web conversations…",
				searchToggle: "Search web conversations",
				closeSearch: "Collapse search",
				searchNoResults: "No matching conversations",
				manageConversations: "Browse and import conversations",
				openWebChat: "Open web conversation",
				connectionHelpTitle: "How to get your token",
				continueStop: "Stop waiting",
				continueStopped: "Stopped waiting for the reply. Refresh the conversation to confirm what was sent.",
				uploadFiles: "Upload attachments",
				fileUploading: "Uploading and parsing…",
				fileReady: "Ready",
				fileRemove: "Remove attachment {name}",
				fileRetry: "Upload {name} again",
				fileLimit: "Up to 10 attachments per message. Each file must be non-empty and no larger than 20 MiB.",
				hostRestartRequired: "The upload endpoint is not loaded. Fully quit DSH (including the tray process), reopen it, then retry.",
				imagePreview: "View image {name}",
				imageDialog: "Image preview",
				imageClose: "Close image preview",
				imageFailed: "Image could not be loaded",
				imageLoading: "Loading image…",
				attachmentsImported: "Attachments saved locally: {count}/{total}",
				attachmentsFailed: "Not imported: {name} ({message})",
				workspaceFilesSaved: "Original files saved to workspace: {count}/{total}",
				workspaceFileFailed: "Not saved to workspace: {name} ({message})",
				deleteWebChat: "Delete web conversation",
				renameWebChat: "Rename web conversation",
				renameWebChatNamed: "Rename web conversation {title}",
				renameTitle: "Rename web conversation",
				renameLabel: "Conversation title",
				renameSave: "Save",
				renamePending: "Saving…",
				renameFailed: "Renaming not confirmed: {message}",
				closeImportResult: "Dismiss import result",
				deleteWebChatNamed: "Delete web conversation {title}",
				deleteTitle: "Delete this web conversation?",
				deleteDescription: "Permanently delete “{title}” from your DeepSeek web account? This cannot be undone. Imported local sessions and workspace files will not be affected.",
				deleteConfirm: "Delete permanently",
				deletePending: "Deleting…",
				deleteFailed: "Deletion not confirmed: {message}. Refresh the list to check the result before trying again.",
				cancel: "Cancel",
				openImportedSession: "Open imported session",
				streamInterrupted: "The reply stream ended early. Refresh the web conversation before continuing.",
				imageRetry: "Reload image {name}",
				newWebChat: "New web conversation",
				refreshRequired: "Sending could not be confirmed. Refresh the conversation before continuing.",
				settingsWorkflows: "Web conversations",
				destination: "Destination workspace",
				copyContent: "Copy",
				regenerate: "Regenerate answer",
				regenerateFailed: "Could not regenerate: {message}",
				previousAnswer: "Previous answer",
				nextAnswer: "Next answer",
				answerVersions: "Answer {index} / {count}",
				previousQuestion: "Previous question branch",
				nextQuestion: "Next question branch",
				questionVersions: "Question branch {index} / {count}",
				regenerateHostRestartRequired: "The regenerate endpoint is not loaded. Fully quit DSH (including the tray) and reopen it.",
				branchInvalid: "The conversation branch is incomplete. Refresh it before continuing.",
				copyMessageFailed: "Copy failed. Please select and copy the text manually.",
				webSources: "Web search · {count} sources",
				processThought: "Thought",
				processTimed: "Thought for {duration}",
				processThinking: "Thinking…",
				processSearch: "Searching the web…",
				processOpen: "Opening a page…",
				processDone: "Process",
				processStopped: "Process interrupted",
				processHostRestartRequired: "The older backend cannot preserve the order of thinking and searches. Fully quit DSH (including the tray), reopen it, then refresh this conversation.",
				processSearchStep: "Web search",
				processOpenStep: "Open page",
				processSeconds: "{seconds}s",
				processMinutes: "{minutes}m {seconds}s",
				processHours: "{hours}h {minutes}m",
				clockMD: "{m}/{d}",
				clockYMD: "{y}-{m}-{d}",
				sidebarListLabel: "DeepSeek Web",
				sidebarListToggle: "DeepSeek web conversation list",
				sidebarListPanelTitle: "DeepSeek Web Conversations",
				sidebarListHint: "Click to continue this web conversation inside DSH (temporary, not saved locally); drag onto a sidebar workspace row to copy it into that workspace.",
				sidebarListDragHint: "Drop onto a sidebar workspace row to import it into that workspace",
				webChatBadge: "DeepSeek web conversation",
				webChatNoToken: "No web token is configured yet.",
				webChatNoTokenHint: "Configure it in Settings → DeepSeek Web, then come back.",
				webChatEmpty: "This web conversation has no messages yet.",
				webChatClose: "Close temporary chat",
				webChatRefresh: "Refresh web conversation",
				sidebarListNoToken: "No web token is configured yet.",
				sidebarListTokenHint: "Paste a token and save to load your web conversations, or configure it in Settings → DeepSeek Web.",
				sidebarListEmpty: "No web conversations were returned.",
				sidebarListClose: "Collapse list",
				sidebarListImported: "Imported into workspace “{title}”",
				panelTitle: "DeepSeek Web Conversations",
				panelSubtitle: "Browse conversations from chat.deepseek.com, preview them, import them as DSH sessions, or write new prompts back to the web account.",
				pageSubtitle: "Drag a conversation onto a workspace to copy it locally and continue there.",

				tokenHeading: "Web token",
				tokenHelp: "Sign in to chat.deepseek.com, open the browser developer console, run the command below, and paste the returned string here.",
				tokenCommand: "JSON.parse(localStorage.getItem('userToken')).value",
				tokenConfigured: "Configured",
				tokenMissing: "Not configured",
				tokenInputLabel: "Token",
				tokenPlaceholder: "Paste the userToken value…",
				tokenSave: "Save token",
				tokenSaving: "Saving…",
				tokenClear: "Clear",
				tokenClearing: "Clearing…",
				tokenShow: "Show",
				tokenHide: "Hide",
				tokenHintPrefix: "Masked: ",
				tokenSaved: "Token saved. Reloading web conversations.",
				tokenCleared: "Token cleared.",
				tokenEmpty: "Paste a token before saving.",
				tokenTooLong: "This token is too long; check that you pasted the complete, correct value.",
				tokenNote: "The token is stored only in this machine's DSH credential file and is never sent to the model with the conversation.",

				statusLoading: "Reading plugin status…",
				statusError: "Cannot read plugin status: {message}",
				retry: "Retry",

				sessionsHeading: "Web conversations",
				refresh: "Refresh",
				loading: "Loading…",
				sessionsNeedToken: "Configure a token to list your web conversations here.",
				sessionsEmpty: "No conversations were returned.",
				sessionsError: "Could not load conversations: {message}",
				loadMore: "Load more",
				allLoaded: "You have reached the end",
				pinned: "Pinned",
				untitledSession: "Untitled conversation",

				previewHeading: "Preview",
				previewNeedSelection: "Pick a conversation above to preview it.",
				previewLoading: "Loading conversation…",
				previewError: "Could not load the conversation: {message}",
				previewMessages: "{count} messages",
				previewEmpty: "This conversation has no displayable messages.",

				actionsHeading: "Import and continue",
				includeThinking: "Include reasoning when importing",
				importNew: "Import to new DSH session",
				importCurrent: "Import to current session",
				importing: "Importing…",
				importCurrentDisabled: "No DSH session is open",
				importFailed: "Import failed: {message}",
				importNewSuccess: "Imported as a new DSH session ({count} messages)",
				importCurrentSuccess: "Imported into the current DSH session ({count} messages)",
				importSeedHint: "Open the new session from the sidebar to continue. Session ID: {id}",
				importContextHint: "The content was injected as context for the current session; just keep asking.",
				workspacesHeading: "Workspaces",
				workspacesHint: "Click a card to set the import target; drag a conversation onto a card or a sidebar workspace row to import directly.",
				workspacesEmpty: "No workspaces are available. Open a project directory in DSH first.",
				workspacesError: "Could not load workspaces: {message}",
				workspaceSessions: "{count} sessions",
				untitledWorkspace: "Untitled workspace",
				dragBanner: "Drop onto a sidebar workspace row or a card here to copy it into that workspace",
				importTargetLabel: "Import to:",
				importTargetHint: "Defaults to: the last selected workspace → the current DSH session's workspace → the first workspace.",
				rowImportHint: "Click a conversation title to import and open it; use Preview to read it without importing.",
				previewAction: "Preview",
				previewActionTitle: "Preview only, do not import",
				rowImporting: "Importing…",
				dropCancel: "Not dropped on a workspace row; the import was cancelled.",
				workspaceSelected: "Target",
				importNeedsWorkspace: "Select a workspace before importing a web conversation.",
				importWorkspaceSuccess: "Imported into workspace “{title}” ({count} messages)",
				importWorkspaceHint: "Opened in a new session: {id}",
				importWorkspaceOpenFailed: "Imported, but opening the session automatically failed: {message}",
				importWorkspaceNoOpen: "Imported. Open the new session from the sidebar to continue.",

				currentSessionLabel: "Current DSH session: ",
				currentSessionNone: "No current DSH session detected",
				copyId: "Copy ID",
				copied: "Copied",
				copyFailed: "Copy failed; select the ID manually.",

				continueHeading: "Continue on the web",
				continuePlaceholder: "Send a message…",
				continueThinking: "Thinking mode",
				continueSearch: "Web search",
				continueSend: "Send",
				continueSending: "Sending…",
				continueNeedSelection: "Select a web conversation before continuing.",
				continueEmpty: "Type something to send first.",
				continueSuccess: "Written back to DeepSeek web; the reply was appended to the preview.",
				continueFailed: "Could not continue on the web: {message}",

				userLabel: "You",
				assistantLabel: "DeepSeek",
				thinkingLabel: "Reasoning",
				searchLabel: "Search references",
				emptyMessage: "(empty message)",

				footerVersion: "Version {version}",
				footerDisclaimer: "Unofficial endpoint: it may break whenever the web app changes, and heavy use may trigger rate limits. Use it only with your own account and at a reasonable rate.",

				boundaryError: "The panel crashed; the rest of the settings page is unaffected.",
				boundaryDetail: "Close and reopen settings; if it keeps happening, check the browser console.",

				errorTimeout: "The request timed out. Try again later.",
				errorNetwork: "The request did not arrive (DSH may not be ready, or the plugin is not loaded).",
				errorUnknown: "Unknown error",

				timeJustNow: "just now",
				timeMinutes: "{count} min ago",
				timeHours: "{count} h ago",
				timeDays: "{count} d ago"
			}
		};

		var activeLocale = "zh";
		var boundTranslate = null;
		var localeListeners = [];

		function formatMessage(value, params) {
			return String(value).replace(/\{([a-zA-Z0-9_]+)\}/g, function (_, key) {
				return params && Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : "{" + key + "}";
			});
		}

		function t(key, params) {
			var value;
			try {
				if (boundTranslate) value = boundTranslate(key, params);
			} catch (error) {
				value = null;
			}
			if (value == null || value === key) {
				var dict = messages[activeLocale] || messages.zh;
				value = dict[key] != null ? dict[key] : messages.en[key] != null ? messages.en[key] : key;
			}
			return formatMessage(value, params);
		}

		function localeSnapshot() {
			return activeLocale;
		}

		function subscribeLocale(listener) {
			localeListeners.push(listener);
			return function () {
				var index = localeListeners.indexOf(listener);
				if (index >= 0) localeListeners.splice(index, 1);
			};
		}

		function setActiveLocale(value) {
			var next = String(value || "").toLowerCase().indexOf("en") === 0 ? "en" : "zh";
			if (next === activeLocale) return;
			activeLocale = next;
			localeListeners.slice().forEach(function (listener) {
				try {
					listener();
				} catch (error) {
					/* one broken subscriber must not block the rest */
				}
			});
		}

		// ------------------------------------------------------------------ styles
		var css = [
			".dsweb-panel{box-sizing:border-box;width:100%;max-width:760px;min-width:0;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}",
			".dsweb-header{display:flex;flex-direction:column;gap:4px}",
			".dsweb-title{margin:0;font-size:16px;font-weight:650;line-height:24px;letter-spacing:-.01em}",
			".dsweb-subtitle{margin:0;font-size:13px;font-weight:650;line-height:20px}",
			".dsweb-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}",
			".dsweb-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}",
			".dsweb-card{box-sizing:border-box;min-width:0;display:flex;flex-direction:column;gap:10px;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1));background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2));border-radius:var(--dsw-radius-xl,12px);padding:12px}",
			".dsweb-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;flex-wrap:wrap}",
			".dsweb-card-title{margin:0;font-size:14px;font-weight:650;line-height:22px;min-width:0}",
			".dsweb-row{display:flex;align-items:center;gap:8px;min-width:0}",
			".dsweb-row-wrap{flex-wrap:wrap}",
			".dsweb-row-center{justify-content:center}",
			".dsweb-field{display:flex;flex-direction:column;gap:5px;min-width:0}",
			".dsweb-label{font-size:12px;font-weight:550;line-height:18px}",
			".dsweb-code{display:block;box-sizing:border-box;max-width:100%;overflow-x:auto;background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1)));color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 9px;font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:12px;line-height:18px;white-space:pre;user-select:all}",
			".dsweb-code-inline{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsweb-input,.dsweb-textarea{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,9px);outline:none;padding:8px 11px;font:inherit;font-size:13px;line-height:20px}",
			".dsweb-input:focus,.dsweb-textarea:focus{border-color:var(--dsw-alias-brand-primary);outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,transparent);outline-offset:1px}",
			".dsweb-input::placeholder,.dsweb-textarea::placeholder{color:var(--dsw-alias-label-tertiary);opacity:1}",
			".dsweb-input:disabled,.dsweb-textarea:disabled{cursor:not-allowed;opacity:.6}",
			".dsweb-textarea{min-height:84px;resize:vertical;font-family:inherit}",
			".dsweb-token-row{display:flex;align-items:center;gap:8px;min-width:0}",
			".dsweb-token-row .dsweb-input{flex:1 1 auto;min-width:0}",
			".dsweb-button{box-sizing:border-box;min-height:34px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,9px);background:transparent;color:var(--dsw-alias-label-primary);padding:6px 12px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}",
			".dsweb-button:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3))}",
			".dsweb-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}",
			".dsweb-button[data-primary='1']{border-color:var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground,#fff)}",
			".dsweb-button[data-primary='1']:hover{border-color:var(--dsw-alias-button-primary-hover);background:var(--dsw-alias-button-primary-hover)}",
			".dsweb-button[data-danger='1']{color:var(--dsw-alias-state-error-primary)}",
			".dsweb-button:disabled{cursor:not-allowed;opacity:.45}",
			".dsweb-button:disabled:hover{background:transparent}",
			".dsweb-check{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer;user-select:none}",
			".dsweb-check input{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary)}",
			".dsweb-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
			".dsweb-status[data-state='on']{color:var(--dsw-alias-brand-primary)}",
			".dsweb-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-tertiary)}",
			".dsweb-dot[data-state='on']{background:var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary))}",
			".dsweb-session-list{display:flex;flex-direction:column;gap:4px;min-width:0;max-height:min(34vh,300px);overflow:auto;scrollbar-gutter:stable}",
			".dsweb-session{box-sizing:border-box;width:100%;position:relative;display:flex;align-items:center;gap:10px;border:1px solid transparent;border-radius:var(--dsw-radius-md,9px);background:transparent;color:inherit;padding:7px 9px;text-align:left;font:inherit;cursor:pointer;user-select:none}",
			".dsweb-session:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3))}",
			".dsweb-session:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dsweb-session[aria-disabled='true']{cursor:not-allowed;opacity:.6}",
			".dsweb-session[data-selected='1']{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}",
			".dsweb-session-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}",
			".dsweb-session-title{font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsweb-session-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}",
			".dsweb-tag{background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1));border-radius:4px;padding:0 5px;font-size:10px;line-height:16px}",
			".dsweb-pinned{color:var(--dsw-alias-brand-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);border-radius:4px;padding:0 5px;font-size:10px;line-height:15px}",
			".dsweb-preview{display:flex;flex-direction:column;gap:10px;min-width:0;max-height:min(46vh,420px);overflow:auto;scrollbar-gutter:stable;padding-right:2px}",
			".dsweb-message{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;min-width:0;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:9px 11px}",
			".dsweb-message[data-role='user']{border-color:transparent;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1))}",
			".dsweb-message-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
			".dsweb-role{font-size:11px;font-weight:650;line-height:17px;color:var(--dsw-alias-brand-primary)}",
			".dsweb-message[data-role='assistant'] .dsweb-role{color:var(--dsw-alias-label-secondary)}",
			".dsweb-time{font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
			".dsweb-message-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:21px}",
			".dsweb-thinking{border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1)) 60%,transparent);padding:4px 8px}",
			".dsweb-thinking summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;user-select:none}",
			".dsweb-thinking-body{margin-top:4px;max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}",
			".dsweb-search{display:flex;flex-direction:column;gap:4px}",
			".dsweb-search-title{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary)}",
			".dsweb-search-list{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:2px}",
			".dsweb-search-item{font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
			".dsweb-search-item a{color:var(--dsw-alias-brand-primary);text-decoration:none}",
			".dsweb-search-item a:hover{text-decoration:underline}",
			".dsweb-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:20px 14px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}",
			".dsweb-state{display:flex;align-items:center;gap:8px;padding:6px 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
			".dsweb-notice{box-sizing:border-box;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:8px 10px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}",
			".dsweb-notice[data-tone='error']{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,var(--dsw-alias-border-l1))}",
			".dsweb-notice[data-tone='success']{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,var(--dsw-alias-border-l1))}",
			".dsweb-notice-body{min-width:0}",
			".dsweb-result{display:flex;flex-direction:column;gap:6px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 32%,var(--dsw-alias-border-l1));border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,transparent);padding:9px 11px}",
			".dsweb-result-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;line-height:18px}",
			".dsweb-result-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}",
			".dsweb-divider{height:1px;margin:2px 0;background:var(--dsw-alias-border-l1)}",
			".dsweb-footer{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:2px 2px 6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}",
			".dsweb-spinner{display:inline-block;width:12px;height:12px;flex:0 0 auto;border:1.5px solid color-mix(in srgb,currentColor 30%,transparent);border-top-color:currentColor;border-radius:50%;animation:dsweb-spin .8s linear infinite}",
			"@keyframes dsweb-spin{to{transform:rotate(360deg)}}",
			".dsweb-page{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:16px 20px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow:hidden}",
			".dsweb-page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}",
			".dsweb-page-head{display:flex;flex-direction:column;gap:2px;min-width:0}",
			".dsweb-page-title{margin:0;font-size:18px;font-weight:650;line-height:26px;letter-spacing:-.01em}",
			".dsweb-page-subtitle{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
			".dsweb-page-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}",
			".dsweb-page-token{border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:0 10px}",
			".dsweb-page-token summary{display:flex;align-items:center;gap:8px;padding:7px 0;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;user-select:none}",
			".dsweb-page-token-body{padding:0 0 10px}",
			".dsweb-page-token-body .dsweb-card{border:0;background:transparent;padding:0 0 6px}",
			".dsweb-page-body{flex:1 1 auto;min-height:0;display:flex;gap:12px;align-items:stretch}",
			".dsweb-page-col{min-width:0;min-height:0;display:flex;flex-direction:column;gap:10px}",
			".dsweb-page-left{flex:0 0 clamp(240px,30%,360px)}",
			".dsweb-page-right{flex:1 1 auto;overflow:auto;scrollbar-gutter:stable;padding-right:2px}",
			".dsweb-card-fill{flex:1 1 auto;min-height:0}",
			".dsweb-session-list-fill{flex:1 1 auto;max-height:none;min-height:80px}",
			".dsweb-preview-fill{flex:1 1 auto;max-height:none;min-height:120px}",
			".dsweb-workspaces{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;max-height:min(24vh,210px);overflow:auto;scrollbar-gutter:stable;padding:2px}",
			".dsweb-workspace{box-sizing:border-box;min-width:0;position:relative;display:flex;flex-direction:column;gap:2px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:8px 10px;text-align:left;font:inherit;color:inherit;cursor:pointer}",
			".dsweb-workspace:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}",
			".dsweb-workspace:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dsweb-workspace:disabled{cursor:not-allowed;opacity:.55}",
			".dsweb-workspace[data-over='1']{border-style:solid;border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}",
			".dsweb-workspace-title{font-size:12px;font-weight:600;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsweb-workspace-path{font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsweb-workspace-meta{font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary)}",
			".dsweb-drag-banner{display:flex;align-items:center;gap:8px;border:1px dashed var(--dsw-alias-brand-primary);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent);color:var(--dsw-alias-brand-primary);padding:7px 10px;font-size:12px;line-height:18px}",
			".dsweb-sidebar-icon{display:block}",
			".dsweb-session[draggable='true']{cursor:grab}",
			".dsweb-session[data-dragging='1']{opacity:.5}",
			".dsweb-session-actions{flex:0 0 auto;display:flex;align-items:center;gap:4px}",
			".dsweb-session-preview{box-sizing:border-box;height:24px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);padding:0 7px;font:inherit;font-size:11px;line-height:16px;cursor:pointer;opacity:0;transition:opacity .12s ease}",
			".dsweb-session:hover .dsweb-session-preview,.dsweb-session:focus-within .dsweb-session-preview,.dsweb-session:focus-visible .dsweb-session-preview{opacity:1}",
			".dsweb-session-preview:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-label-primary)}",
			".dsweb-session-preview:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dsweb-session-preview:disabled{cursor:not-allowed;opacity:.4}",
			".dsweb-session-status{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-brand-primary);font-size:11px;line-height:17px;white-space:nowrap}",
			".dsweb-import-target{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:8px 10px}",
			".dsweb-select{box-sizing:border-box;height:30px;max-width:min(260px,45vw);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,9px);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);padding:0 8px;font:inherit;font-size:12px;line-height:18px;cursor:pointer}",
			".dsweb-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dsweb-select:disabled{cursor:not-allowed;opacity:.55}",
			".dsweb-target-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;min-width:0}",
			".dsweb-workspace[data-selected='1']{border-style:solid;border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}",
			".dsweb-workspace-badge{position:absolute;top:6px;right:8px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);padding:0 6px;font-size:10px;line-height:16px;font-weight:600}",
			".dsweb-workspace[data-busy='1']{opacity:.7}",
			".dsweb-page-footer{flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}",
			".dsweb-footer-action{box-sizing:border-box;width:100%;display:inline-flex;align-items:center;gap:8px;border:0;border-radius:var(--dsw-radius-md,9px);background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 8px;font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}",
			".dsweb-footer-action:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-label-primary)}",
			".dsweb-footer-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dsweb-footer-action[data-active='1']{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}",
			".dsweb-footer-action[data-wide='0']{justify-content:center;padding:6px}",
			".dsweb-footer-action-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsweb-sidebar-group{box-sizing:border-box;flex:1;min-width:0;max-width:100%;display:flex;flex-direction:column;margin:6px 0}.dsweb-group-toggle{height:34px;color:var(--dsw-alias-label-secondary);font-weight:500}.dsweb-group-toggle .dsweb-footer-action-label{flex:1;text-align:left}.dsweb-group-toggle[data-active='1']{background:transparent;color:var(--dsw-alias-label-primary)}.dsweb-group-toggle[data-active='1']:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dsweb-sidebar-list{box-sizing:border-box;width:100%;min-width:0;max-height:min(38vh,340px);display:flex;flex-direction:column;gap:6px;background:transparent;border:0;padding:0 0 4px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;overflow:hidden}",
			".dsweb-sidebar-list-head{display:flex;align-items:center;gap:6px;min-width:0}",
			".dsweb-sidebar-list-title{flex:1 1 auto;min-width:0;font-size:13px;font-weight:650;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsweb-sidebar-list-icon{box-sizing:border-box;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid transparent;border-radius:var(--dsw-radius-md,9px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:16px;cursor:pointer}",
			".dsweb-sidebar-list-icon:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-label-primary)}",
			".dsweb-sidebar-list-icon:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dsweb-sidebar-list-icon:disabled{cursor:not-allowed;opacity:.45}",
			".dsweb-sidebar-list-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow-wrap:anywhere}",
			".dsweb-sidebar-list-content{display:flex;flex-direction:column;gap:8px;min-height:0;flex:1 1 auto}",
			".dsweb-sidebar-list-target{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}",
			".dsweb-sidebar-list-target .dsweb-select{flex:1 1 auto;max-width:100%;height:28px;min-width:0}",
			".dsweb-sidebar-list-body{flex:1 1 auto;min-height:60px;overflow:auto;display:flex;flex-direction:column;gap:2px;scrollbar-gutter:stable}",
			".dsweb-sidebar-list-body .dsweb-session{padding:6px 7px;gap:6px}",
			".dsweb-sidebar-list-body .dsweb-session-title{font-size:12px;line-height:18px}",
			".dsweb-sidebar-list-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;padding:14px 10px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px}",
			".dsweb-sidebar-list-token{display:flex;flex-direction:column;gap:6px;min-width:0}",
			".dsweb-sidebar-list-token .dsweb-token-row{flex-wrap:wrap}",
			".dsweb-sidebar-list-token .dsweb-input{min-height:30px;font-size:12px}",
			".dsweb-sidebar-list .dsweb-button{min-height:28px;padding:4px 9px}",
			".dsweb-drag-ghost{position:fixed;z-index:70;pointer-events:none;max-width:220px;box-sizing:border-box;padding:5px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;box-shadow:var(--dsw-elevation-prominent,var(--dsw-shadow-lv3));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.95}",
			// Match the native conversation's width contract and InputBar geometry.
			".dsweb-chat{--dsh-chat-content-width:var(--dsh-chat-user-width,clamp(680px,calc(var(--dsh-conversation-column-width,0px)*.64),920px));--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);--dsh-composer-text-max-height:336px;box-sizing:border-box;height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));overflow:hidden;container-type:inline-size}",
			".dsweb-chat-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none;padding:10px 20px;border-bottom:.5px solid var(--dsw-alias-border-l2)}.dsweb-chat-heading{flex:1;min-width:0}.dsweb-chat-title{margin:0;font-size:14px;line-height:22px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsweb-chat-actions{display:flex;align-items:center;gap:6px;flex:none}",
			".dsweb-chat-main{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}.dsweb-chat-messages{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable both-edges}.dsweb-chat-thread{box-sizing:border-box;width:calc(100% - 48px);max-width:var(--dsh-chat-content-width);margin:auto;padding:24px 0;display:flex;flex-direction:column;gap:28px;min-width:0}.dsweb-chat-empty{padding:20px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px}",
			".dsweb-composer-root{flex:none;display:flex;flex-direction:column;align-items:center;padding:0 16px 12px;gap:6px}.dsweb-chat-composer{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-panel,24px);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-soft);font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));border:0;display:flex;flex-direction:column;gap:12px;padding-top:8px;min-width:0}",
			".dsweb-chat .dsweb-chat-input{box-sizing:border-box;width:calc(100% - 4px);min-height:36px;max-height:var(--dsh-composer-text-max-height);resize:none;overflow:auto;border:0;outline:0;border-radius:0;background:transparent;box-shadow:none;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);font:inherit;line-height:inherit;white-space:pre-wrap;overflow-wrap:anywhere;padding:4px 8px 0 14px}.dsweb-chat .dsweb-chat-input:focus{outline:0;box-shadow:none}.dsweb-chat-input::placeholder{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary))}.dsweb-composer-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px}.dsweb-composer-tools,.dsweb-composer-trailing{display:flex;align-items:center;gap:12px;min-width:0}.dsweb-composer-trailing{margin-left:auto;flex:none}.dsweb-composer-add{display:grid;place-items:center;flex:none;width:28px;height:28px;border:0;border-radius:999px;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);cursor:pointer}.dsweb-composer-add:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}",
			".dsweb-composer-mode,.dsweb-model-trigger{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;max-width:100%;min-width:0;padding:0 6px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:500;cursor:pointer}.dsweb-composer-mode:hover,.dsweb-model-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsweb-composer-mode[aria-pressed='true']{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary,var(--dsw-alias-interactive-bg-hover))}.dsweb-model-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsweb-model-mode{color:var(--dsw-alias-label-tertiary)}.dsweb-model-trigger[aria-expanded='true']>svg:last-child{transform:rotate(180deg)}.dsweb-chat-send{display:grid;place-items:center;flex:none;width:34px;height:34px;transform:translateY(-2px);border:0;border-radius:999px;background:var(--dsw-alias-button-info-fill);color:#fff;cursor:pointer;transition:background-color .1s}.dsweb-chat-send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}.dsweb-chat-send:disabled{opacity:.4;cursor:default}.dsweb-composer-mode:disabled,.dsweb-model-trigger:disabled{opacity:.5;cursor:default}.dsweb-composer-root button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}.dsweb-chat-option-row{display:flex;align-items:center;justify-content:space-between;gap:28px;min-width:200px;padding:8px 10px;font-size:13px}.dsweb-chat-options{max-width:calc(100vw - 24px)}.dsweb-chat-recovery{width:100%;max-width:var(--dsh-composer-card-max-width)}",
			".dsweb-search-field{position:relative;min-width:0;flex:none;display:flex;align-items:center;color:var(--dsw-alias-label-tertiary)}.dsweb-search-field>svg{position:absolute;left:10px;pointer-events:none}.dsweb-search-field .dsweb-input{height:34px;padding:0 10px 0 32px;border:.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));background:var(--dsw-alias-bg-layer-1);font-size:12px}.dsweb-input:focus,.dsweb-textarea:focus{border-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline:0;box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary)) 18%,transparent)}",
			".dsweb-icon-button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.dsweb-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsweb-icon-button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}.dsweb-icon-button:disabled{opacity:.45;cursor:not-allowed}",
			".dsweb-settings .dsweb-card{padding:16px;gap:14px}.dsweb-settings-row{flex-direction:row;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.dsweb-settings-row>.dsweb-field{flex:1 1 260px}.dsweb-token-help{color:var(--dsw-alias-label-secondary);font-size:12px}.dsweb-token-help summary{cursor:pointer;padding:4px 0}.dsweb-token-help[open]{display:flex;flex-direction:column;gap:8px}.dsweb-settings .dsweb-footer{margin-top:4px}",
			".dsweb-sidebar-list-head{padding:0 4px 0 8px;flex:none}.dsweb-sidebar-list-title{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary)}.dsweb-sidebar-list-icon{width:24px;height:24px;border:0;border-radius:var(--dsw-radius-sm,8px)}.dsweb-sidebar-list .dsweb-search-field{margin:0 4px}.dsweb-sidebar-list-body{padding:0 2px;overscroll-behavior:contain;scrollbar-gutter:auto;min-height:0}.dsweb-sidebar-list .dsweb-session{min-height:32px;height:32px;border:0;padding:0 8px 0 16px;gap:6px}.dsweb-sidebar-list .dsweb-session-main{flex-direction:row;align-items:center;gap:6px}.dsweb-sidebar-list .dsweb-session-title{flex:1;min-width:0;font-size:13px;line-height:20px}.dsweb-sidebar-list .dsweb-session-meta{flex:none;font-size:10px}.dsweb-sidebar-list .dsweb-session-meta .dsweb-tag,.dsweb-sidebar-list .dsweb-pinned{display:none}.dsweb-session[data-selected='1']{border-color:transparent;background:var(--dsw-alias-interactive-bg-hover)}.dsweb-sidebar-list .dsweb-notice{margin:0 4px}.dsweb-sidebar-list-token{padding:6px 8px}.dsweb-sidebar-list .dsweb-input{min-width:0}",
			".dsweb-library{height:100%;min-height:0;min-width:0;box-sizing:border-box;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}.dsweb-library-header{padding:16px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}.dsweb-library-body{display:flex;flex:1;min-height:0;min-width:0}.dsweb-library-list{box-sizing:border-box;flex:0 0 280px;min-width:0;display:flex;flex-direction:column;gap:12px;padding:16px 12px;border-right:.5px solid var(--dsw-alias-border-l2)}.dsweb-library-list>.dsweb-card{background:transparent;border:0;padding:0;min-height:0}.dsweb-library-list .dsweb-session-list{max-height:none;flex:1;min-height:0}.dsweb-library-detail{box-sizing:border-box;flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:auto;padding:20px 24px;gap:16px}.dsweb-library-detail>.dsweb-card{background:transparent;border:0;padding:0}.dsweb-library-detail .dsweb-preview{max-height:none;flex:1;min-height:0}.dsweb-library-actions{display:flex;flex-direction:column;gap:12px;flex:none;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l2)}.dsweb-library-connect{padding:24px;max-width:680px}.dsweb-library .dsweb-select{flex:1;min-width:0;max-width:100%}",
			".dsweb-message-text[data-markdown='1']{white-space:normal}.dsweb-chat .dsweb-message{border:0;border-radius:0;background:transparent;padding:0;gap:10px;min-width:0}.dsweb-chat .dsweb-message[data-role='user']{align-self:flex-end;max-width:min(calc(var(--dsh-chat-content-width)*.702),82%);padding:10px 16px;border-radius:var(--dsw-radius-xl,20px);background:var(--dsw-specific-bubble)}.dsweb-chat .dsweb-message[data-role='assistant']{width:100%}.dsweb-chat .dsweb-message-text{font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px))}.dsweb-chat .dsweb-message-head{display:none}.dsweb-thinking{border:0;border-left:2px solid var(--dsw-alias-border-l2);border-radius:0;background:transparent;padding:0 10px}.dsweb-thinking summary{font-size:12px;line-height:22px}.dsweb-chat-token{flex:1;min-height:0;padding:24px;box-sizing:border-box;width:100%;max-width:680px;overflow:auto;display:flex;flex-direction:column;gap:8px}",
			"@media(max-width:760px){.dsweb-library-body{flex-direction:column;overflow:auto}.dsweb-library-list{flex:none;border-right:0;border-bottom:.5px solid var(--dsw-alias-border-l2);max-height:32vh}.dsweb-library-detail{flex:1 0 auto;overflow:visible;padding:16px}.dsweb-library-header{padding:12px 16px}.dsweb-chat-head{padding:10px 14px}}@container(width<=560px){.dsweb-composer-tools,.dsweb-composer-trailing{gap:8px}.dsweb-model-mode{display:none}.dsweb-chat-thread{width:calc(100% - 32px)}}@container(width<=320px){.dsweb-composer-row{gap:6px}.dsweb-composer-tools,.dsweb-composer-trailing{gap:4px}.dsweb-model-trigger{max-width:120px}}",
			"@media(max-width:900px){.dsweb-page{height:auto;min-height:100%;overflow:visible}.dsweb-page-body{flex-direction:column}.dsweb-page-left,.dsweb-page-right{flex:1 1 auto;overflow:visible}.dsweb-session-list-fill{max-height:min(38vh,320px)}.dsweb-preview-fill{max-height:min(46vh,420px)}.dsweb-workspaces{max-height:none}}",
			"@media(max-width:640px){.dsweb-panel{max-width:none}.dsweb-session{min-height:44px}.dsweb-button{min-height:38px}.dsweb-preview{max-height:none}.dsweb-session-preview{opacity:1;height:28px}.dsweb-select{max-width:100%;flex:1 1 180px}}",
			".dsweb-files{display:flex;flex-wrap:wrap;gap:8px;min-width:0}.dsweb-chat-composer>.dsweb-files{padding:2px 12px 0}.dsweb-file{box-sizing:border-box;display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;width:240px;padding:8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-interactive-bg-hover)}.dsweb-file-kind{display:grid;place-items:center;flex:none;width:30px;height:34px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-interactive-bg-hover);font-size:9px;font-weight:600;color:var(--dsw-alias-label-secondary)}.dsweb-file-detail{display:flex;flex-direction:column;flex:1;min-width:0;line-height:18px}.dsweb-file-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsweb-file-state{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;line-height:16px}.dsweb-file[data-error='1'] .dsweb-file-state{color:var(--dsw-alias-state-error-primary)}.dsweb-model-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);font-weight:500}.dsweb-composer-add:disabled{opacity:.5;cursor:default}",
			".dsweb-composer-mode{white-space:nowrap;flex:none}.dsweb-composer-mode>svg{flex:none}@container(width<=320px){.dsweb-composer-tools{flex-wrap:wrap}.dsweb-mode-label,.dsweb-composer-trailing>.dsweb-model-label{display:none}.dsweb-composer-mode{min-width:28px;padding:0 6px}}",
			".dsweb-file{flex-direction:column;align-items:stretch}.dsweb-file-info{display:flex;align-items:center;gap:8px;min-width:0}.dsweb-file[data-image='1']{width:320px}.dsweb-image-open{box-sizing:border-box;display:block;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);overflow:hidden;background:transparent;cursor:zoom-in;width:100%;min-width:0}.dsweb-image-open img{display:block;object-fit:contain;max-width:100%;max-height:240px;margin:auto;border-radius:inherit}.dsweb-chat-composer .dsweb-file[data-image='1']{width:200px}.dsweb-chat-composer .dsweb-image-open img{max-height:110px}.dsweb-image-failed{display:flex;align-items:center;justify-content:center;gap:8px;min-height:80px;padding:12px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.dsweb-image-open:focus-visible,.dsweb-image-failed:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}",
			".dsweb-image-loading{display:flex;align-items:center;justify-content:center;gap:8px;min-height:80px;color:var(--dsw-alias-label-secondary);font-size:12px}.dsweb-attachment-result{min-width:0;overflow-wrap:anywhere}.dsweb-attachment-result .dsweb-hint{margin:6px 0}.dsweb-sidebar-list .dsweb-result{padding:8px}",
			".dsweb-delete-action:not(:disabled){color:var(--dsw-alias-state-error-primary)}.dsweb-session-actions{display:none;flex:none;align-items:center;gap:15px}.dsweb-session:hover .dsweb-session-actions,.dsweb-session:focus-within .dsweb-session-actions,.dsweb-session[data-importing='1'] .dsweb-session-actions{display:inline-flex}.dsweb-sidebar-list .dsweb-session:hover .dsweb-session-meta,.dsweb-sidebar-list .dsweb-session:focus-within .dsweb-session-meta{display:none}.dsweb-row-delete,.dsweb-row-rename{width:16px;height:16px;padding:0;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);flex:none}.dsweb-row-delete:hover,.dsweb-row-rename:hover{background:transparent;color:var(--dsw-alias-label-primary)}.dsweb-rename-input{box-sizing:border-box;width:100%;height:44px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);color:var(--dsw-alias-label-primary);background:transparent;padding:7px 14px;font:inherit;font-size:14px;outline:none}.dsweb-rename-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}.dsweb-result-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.dsweb-result-heading>.dsweb-result-title{flex:1;min-width:0;overflow-wrap:anywhere}@media(hover:none){.dsweb-session-actions{display:inline-flex}}",
			".dsweb-sidebar-list-head{height:36px;min-height:36px;justify-content:flex-end;gap:4px;overflow:hidden}.dsweb-workspace-search-slot{box-sizing:border-box;min-width:0;max-width:28px;flex:1;display:flex;align-items:center;margin-left:auto;transition:max-width .18s var(--ds-ease-in-out)}.dsweb-workspace-search-slot[data-expanded='1']{max-width:100%}.dsweb-workspace-search{box-sizing:border-box;border-radius:var(--dsw-radius-sm);cursor:text;width:100%;height:28px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;display:flex;align-items:center;flex:none;gap:0;padding:0;margin:0;overflow:hidden;transition:width .18s var(--ds-ease-in-out),padding .18s var(--ds-ease-in-out),border-color .18s var(--ds-ease-in-out),background-color .18s var(--ds-ease-in-out)}.dsweb-workspace-search[data-expanded='1']{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);width:calc(100% + 4px);height:30px;color:var(--dsw-alias-label-caption);margin-inline:-2px;padding:0 4px 0 0}.dsweb-workspace-search-button{width:28px;height:28px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:inherit;display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0;cursor:pointer}.dsweb-workspace-search-button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsweb-workspace-search[data-expanded='1'] .dsweb-workspace-search-button:hover{background:transparent}.dsweb-workspace-search-input{opacity:0;pointer-events:none;width:0;min-width:0;flex:1;background:transparent;border:0;outline:none;color:var(--dsw-alias-label-primary);-webkit-text-fill-color:currentColor;font:inherit;font-size:13px;line-height:18px;transition:opacity .12s var(--ds-ease-in-out)}.dsweb-workspace-search[data-expanded='1'] .dsweb-workspace-search-input{opacity:1;pointer-events:auto;margin-left:-2px}.dsweb-workspace-search-input::placeholder{color:var(--dsw-alias-label-tertiary);-webkit-text-fill-color:var(--dsw-alias-label-tertiary)}.dsweb-workspace-search-clear{width:24px;height:24px}.dsweb-workspace-header-actions{display:flex;align-items:center;flex:none;gap:4px;max-width:92px;opacity:1;visibility:visible;overflow:hidden;transition:max-width .18s var(--ds-ease-in-out),opacity .12s var(--ds-ease-in-out),visibility 0s}.dsweb-workspace-header-actions[data-hidden='1']{max-width:0;opacity:0;visibility:hidden;pointer-events:none;transition-delay:0s,0s,.18s}.dsweb-workspace-search-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}@media(prefers-reduced-motion:reduce){.dsweb-workspace-search-slot,.dsweb-workspace-search,.dsweb-workspace-search-input,.dsweb-workspace-header-actions{transition:none!important}}",
			".dsweb-message-body{display:flex;flex-direction:column;gap:10px;min-width:0}.dsweb-chat .dsweb-message[data-role='user']{padding:0;background:transparent;border-radius:0}.dsweb-chat .dsweb-message[data-role='user']>.dsweb-message-body{padding:10px 16px;border-radius:var(--dsw-radius-xl,20px);background:var(--dsw-specific-bubble)}.dsweb-chat .dsweb-message[data-role='assistant']>.dsweb-message-body{gap:16px}.dsweb-message-footer{height:calc(28px + var(--dsh-content-font-delta,0px));display:flex;align-items:center;gap:8px;min-width:0;color:var(--dsw-alias-label-tertiary)}.dsweb-message[data-role='user']>.dsweb-message-footer{align-self:flex-end}.dsweb-message[data-role='assistant']>.dsweb-message-footer{margin-top:6px;margin-left:-6px}.dsweb-message-action{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);border:0;padding:6px;display:inline-flex;align-items:center;justify-content:center;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none}.dsweb-message-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.dsweb-message-action:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}.dsweb-message-action:disabled{opacity:.4;cursor:default}.dsweb-message-clock{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(24px + var(--dsh-content-font-delta,0px));white-space:nowrap;color:var(--dsw-alias-label-tertiary)}[data-clock='start']>.dsweb-message-clock{font-size:var(--dsh-content-font-size-secondary,13px);padding-right:12px}[data-clock='end']>.dsweb-message-clock{margin-left:8px}.dsweb-copy-error{color:var(--dsw-alias-state-error-primary);font-size:12px}.dsweb-native-disclosure{border:0!important;padding:0!important;background:transparent!important;min-width:0}.dsweb-disclosure-title{font-weight:400!important}.dsweb-disclosure-summary{margin-left:8px;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px)}.dsweb-disclosure-body{padding:4px 0 4px calc(22px + var(--dsh-content-font-delta,0px));min-width:0;color:var(--dsw-alias-label-secondary)}.dsweb-sources-body{margin:0;padding:4px 0 4px 38px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:22px;overflow-wrap:anywhere}.dsweb-sources-body a{color:var(--dsw-alias-link)}",
			".dsweb-process{min-width:0;display:flex;flex-direction:column}.dsweb-process-header{box-sizing:border-box;width:100%;min-width:0;height:calc(33px + var(--dsh-content-font-delta,0px));border:0;border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--dsh-content-font-size,14px);cursor:pointer;text-align:left;background:transparent;display:flex;align-items:center;padding:0 0 8px;transition:color .1s}.dsweb-process-header:hover{color:var(--dsw-alias-label-secondary)}.dsweb-process-header:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}.dsweb-process-label{min-width:0;font-size:inherit;line-height:calc(24px + var(--dsh-content-font-delta,0px));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}.dsweb-process-header>svg{flex:none;margin-left:4px}.dsweb-process-children{display:flex;flex-direction:column;gap:8px;padding:8px 0 0;min-width:0}.dsweb-process-children[hidden]{display:none}.dsweb-process-step{min-width:0}",
			".dsweb-message[data-role='assistant']>.dsweb-message-footer{width:100%;height:auto;min-height:calc(28px + var(--dsh-content-font-delta,0px));flex-wrap:wrap;gap:4px}.dsweb-answer-versions{display:inline-flex;align-items:center;gap:2px;flex:none;color:var(--dsw-alias-label-tertiary)}.dsweb-answer-count{min-width:34px;text-align:center;white-space:nowrap;font-size:12px;font-variant-numeric:tabular-nums}.dsweb-answer-versions .dsweb-message-action{width:24px;padding:4px}.dsweb-regenerate{margin-left:auto}",
			"@media(prefers-reduced-motion:reduce){.dsweb-spinner{animation:none}.dsweb-panel *{transition:none!important;scroll-behavior:auto!important}}"
		].join("\n");

		// ------------------------------------------------------------------- utils
		function toMillis(value) {
			if (typeof value === "number" && isFinite(value)) return value;
			if (typeof value === "string" && value) {
				var parsed = Date.parse(value);
				if (!isNaN(parsed)) return parsed;
				var numeric = Number(value);
				if (isFinite(numeric)) return numeric;
			}
			return 0;
		}

		function formatRelative(value) {
			var millis = toMillis(value);
			if (!millis) return "";
			var diff = Date.now() - millis;
			if (diff < 0) diff = 0;
			var minute = 60000;
			var hour = 3600000;
			var day = 86400000;
			if (diff < minute) return t("timeJustNow");
			if (diff < hour) return t("timeMinutes", { count: Math.floor(diff / minute) });
			if (diff < day) return t("timeHours", { count: Math.floor(diff / hour) });
			if (diff < day * 7) return t("timeDays", { count: Math.floor(diff / day) });
			try {
				return new Date(millis).toLocaleDateString();
			} catch (error) {
				return "";
			}
		}

		function clipText(value, max) {
			var text = typeof value === "string" ? value : "";
			if (!max || text.length <= max) return text;
			return text.slice(0, max) + "…";
		}

		// Message text may arrive as a string or as content blocks; keep only text.
		function toTextValue(value) {
			if (typeof value === "string") return value;
			if (Array.isArray(value)) {
				var parts = [];
				for (var i = 0; i < value.length; i++) {
					var part = toTextValue(value[i]);
					if (part) parts.push(part);
				}
				return parts.join("\n");
			}
			if (value && typeof value === "object") {
				if (typeof value.text === "string") return value.text;
				if (typeof value.content === "string") return value.content;
				if (typeof value.value === "string") return value.value;
				if (value.content != null) return toTextValue(value.content);
			}
			return "";
		}

		function sanitizeHttpUrl(value) {
			var raw = typeof value === "string" ? value.trim() : "";
			if (!raw || !/^https?:\/\//i.test(raw)) return "";
			return raw.slice(0, 2048);
		}

		function normalizeSearchResults(value) {
			if (!Array.isArray(value)) return [];
			var results = [];
			for (var i = 0; i < value.length && results.length < MAX_SEARCH_RESULTS; i++) {
				var item = value[i];
				if (typeof item === "string") {
					var textOnly = item.trim();
					if (textOnly) results.push({ title: clipText(textOnly, 200), url: "" });
					continue;
				}
				if (!item || typeof item !== "object") continue;
				var url = sanitizeHttpUrl(item.url || item.link || item.href || item.siteUrl);
				var title = toTextValue(item.title || item.name || item.site_name || item.snippet || item.content || "").trim();
				if (!title && !url) continue;
				results.push({ title: clipText(title || url, 200), url: url });
			}
			return results;
		}

		function normalizeMessages(values) {
			if (!Array.isArray(values)) return [];
			var messages = [];
			for (var i = 0; i < values.length; i++) {
				var item = values[i];
				if (!item || typeof item !== "object") continue;
				var role = item.role === "user" ? "user" : "assistant";
				var text = toTextValue(item.text != null ? item.text : item.content);
				var thinking = toTextValue(item.thinking != null ? item.thinking : item.reasoning);
				messages.push({
					id: item.id == null || item.id === "" ? "legacy-" + i : String(item.id),
					parentId: item.parentId == null ? null : String(item.parentId),
					role: role,
					status: String(item.status || ""), banRegenerate: item.banRegenerate === true,
					text: text,
					thinking: thinking,
					searchResults: normalizeSearchResults(item.searchResults),
					processSteps: normalizeProcessSteps(item.processSteps),
					thinkingMs: typeof item.thinkingMs === "number" && Number.isFinite(item.thinkingMs) && item.thinkingMs >= 0 ? item.thinkingMs : undefined,
					files: Array.isArray(item.files) ? item.files : [],
					insertedAt: item.insertedAt,
					timeLabel: formatRelative(item.insertedAt)
				});
			}
			// Older hosts/fixtures have no parent links at all. Keep their linear
			// history readable; never synthesize links when real tree edges exist.
			var ids = new Set(messages.map(function (item) { return item.id; }));
			if (!messages.some(function (item) { return item.parentId != null && ids.has(item.parentId); })) {
				messages.forEach(function (item, index) { if (index) item.parentId = messages[index - 1].id; });
			}
			return messages;
		}

		function buildBranchView(items, choices, currentMessageId) {
			var byId = new Map(), children = new Map(), defaults = {}, root = "@root";
			items.forEach(function (item) { byId.set(item.id, item); });
			items.forEach(function (item) {
				var parent = item.parentId != null && byId.has(String(item.parentId)) ? String(item.parentId) : root;
				if (!children.has(parent)) children.set(parent, []);
				children.get(parent).push(item);
			});
			var cursor = byId.get(String(currentMessageId)) || items[items.length - 1], seen = new Set();
			while (cursor && !seen.has(cursor.id)) {
				seen.add(cursor.id);
				var parent = cursor.parentId != null && byId.has(String(cursor.parentId)) ? String(cursor.parentId) : root;
				defaults[parent] = cursor.id; cursor = byId.get(parent);
			}
			var rows = [], parent = root; seen = new Set();
			while (children.has(parent) && rows.length < items.length) {
				var siblings = children.get(parent), wanted = choices[parent] || defaults[parent];
				var selected = siblings.find(function (item) { return item.id === wanted; }) || siblings.find(function (item) { return item.id === defaults[parent]; }) || siblings[siblings.length - 1];
				if (seen.has(selected.id)) break;
				seen.add(selected.id);
				rows.push({ message: selected, parentKey: parent, siblings: siblings, index: siblings.indexOf(selected) });
				parent = selected.id;
			}
			return { rows: rows, tail: rows.length ? rows[rows.length - 1].message : null, valid: !items.length || rows.length > 0 && !children.has(parent) };
		}
		function readBranchChoices(sessionId) {
			try {
				var value = JSON.parse(window.sessionStorage.getItem("dsh-deepseek-web.branch." + sessionId) || "{}");
				return value && typeof value === "object" && !Array.isArray(value) ? value : {};
			} catch (_) { return {}; }
		}
		function remapBranchId(choices, from, to) {
			if (!to || from === to) return choices;
			var next = {};
			Object.keys(choices).forEach(function (key) { next[key === from ? to : key] = choices[key] === from ? to : choices[key]; });
			return next;
		}

		function normalizeProcessSteps(values) {
			if (!Array.isArray(values)) return [];
			return values.filter(function (item) { return item && ["thinking", "search"].includes(item.type); }).map(function (item, index) {
				return { id: String(item.id == null ? index : item.id), type: item.type, action: item.action === "open" ? "open" : "search",
					text: clipText(item.text || "", 200000), query: clipText(item.query || "", 1000), searchResults: normalizeSearchResults(item.searchResults),
					elapsedMs: typeof item.elapsedMs === "number" && Number.isFinite(item.elapsedMs) && item.elapsedMs >= 0 ? item.elapsedMs : undefined };
			});
		}
		function processDuration(steps) {
			var thinking = steps.filter(function (step) { return step.type === "thinking"; });
			return thinking.length && thinking.every(function (step) { return Number.isFinite(step.elapsedMs); }) ?
				thinking.reduce(function (sum, step) { return sum + step.elapsedMs; }, 0) : undefined;
		}
		function processDurationText(ms, tt) {
			var seconds = Math.max(0, Math.round(ms / 1000));
			if (seconds < 60) return tt("processSeconds", { seconds: seconds });
			if (seconds < 3600) return tt("processMinutes", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
			return tt("processHours", { hours: Math.floor(seconds / 3600), minutes: Math.floor(seconds / 60) % 60 });
		}

		function normalizeSessions(values) {
			if (!Array.isArray(values)) return [];
			var sessions = [];
			for (var i = 0; i < values.length; i++) {
				var item = values[i];
				if (!item || item.id == null || deletedWebIds.has(String(item.id))) continue;
				if (renamedWebTitles.get(String(item.id)) === item.title) renamedWebTitles.delete(String(item.id));
				sessions.push({
					id: String(item.id),
					title: renamedWebTitles.get(String(item.id)) || (typeof item.title === "string" ? item.title : ""),
					pinned: item.pinned === true,
					modelType: item.modelType == null ? "" : String(item.modelType),
					updatedAt: item.updatedAt
				});
			}
			return sessions;
		}

		function mergeSessions(previous, incoming) {
			var seen = Object.create(null);
			var merged = [];
			var all = previous.concat(incoming);
			for (var i = 0; i < all.length; i++) {
				var item = all[i];
				if (!item || !item.id || seen[item.id]) continue;
				seen[item.id] = true;
				merged.push(item);
			}
			return merged;
		}

		function normalizeWorkspaces(values) {
			if (!Array.isArray(values)) return [];
			var workspaces = [];
			for (var i = 0; i < values.length; i++) {
				var item = values[i];
				if (!item || item.id == null) continue;
				var sessionCount = Number(item.sessionCount);
				workspaces.push({
					id: String(item.id),
					title: typeof item.title === "string" ? item.title : "",
					path: typeof item.path === "string" ? item.path : "",
					sessionCount: isFinite(sessionCount) && sessionCount >= 0 ? sessionCount : 0,
					sessionIds: Array.isArray(item.sessionIds) ? item.sessionIds.map(String) : []
				});
			}
			return workspaces;
		}

		// Last two path segments, so a card can show "project/sub" instead of a long absolute path.
		function workspacePathTail(path) {
			var segments = String(path || "")
				.split(/[\\/]+/)
				.filter(function (segment) {
					return segment.length > 0;
				});
			if (!segments.length) return "";
			return segments.slice(-2).join("/");
		}

		function normalizeImportResult(payload, target, workspace) {
			return {
				target: target,
				workspaceId: workspace && workspace.id ? String(workspace.id) : "",
				workspaceTitle: workspace && workspace.title || payload.workspaceTitle || "",
				dshSessionId: String(payload.dshSessionId || ""),
				messageCount: Number(payload.messageCount) || 0,
				title: String(payload.title || ""),
				mode: typeof payload.mode === "string" ? payload.mode : "",
				attachmentReport: payload.attachmentReport || null
			};
		}
		function importHasWarnings(result) {
			var report = result && result.attachmentReport;
			return !!(report && ((report.failures || []).length || (report.workspaceFailures || []).length));
		}

		// Best-effort navigation after a workspace import: refresh the Host's session list
		// (a plugin-created session can be missing from the Client's cached list) and then
		// open the new DSH session.
		function refreshSessionList() {
			try {
				var scope = clientContext;
				var sessions = scope && typeof scope.get === "function" ? scope.get("sessions") : null;
				if (sessions && typeof sessions.refresh === "function") {
					var done = sessions.refresh();
					if (done && typeof done.then === "function") done.then(undefined, function () {});
				}
			} catch (error) {
				/* the sidebar may simply update on its next poll */
			}
		}

		function openDshSession(sessionId) {
			if (!sessionId) return "";
			refreshSessionList();
			try {
				var scope = clientContext;
				var workspace = scope && typeof scope.get === "function" ? scope.get("uiWorkspace") : null;
				if (!workspace || typeof workspace.openSession !== "function") return "";
				var outcome = workspace.openSession(sessionId);
				if (outcome && typeof outcome.then === "function") {
					outcome.then(undefined, function () {
						/* navigation failure is reported by the caller through the session id hint */
					});
				}
				return "";
			} catch (error) {
				return errorText(error);
			}
		}

		// Best-effort refresh of the DSH session list after an import, so the new
		// session row shows up immediately in the official sidebar.
		function refreshDshSessionList() {
			try {
				var scope = clientContext;
				var sessions = scope && typeof scope.get === "function" ? scope.get("sessions") : null;
				if (sessions && typeof sessions.refresh === "function") {
					sessions.refresh();
					return;
				}
			} catch (error) {
				/* ignore */
			}
			try {
				var otherScope = clientContext;
				var workspace = otherScope && typeof otherScope.get === "function" ? otherScope.get("uiWorkspace") : null;
				if (workspace && workspace.sessions && typeof workspace.sessions.refresh === "function") {
					workspace.sessions.refresh();
				}
			} catch (error) {
				/* ignore */
			}
		}

		// Persisted import target on the page. A missing/unknown id falls back through
		// the documented default order (see resolveCurrentWorkspaceId and the page).
		var TARGET_STORAGE_KEY = "dsh-deepseek-web.import-target";

		function readStoredWorkspaceId() {
			try {
				return String(window.localStorage.getItem(TARGET_STORAGE_KEY) || "");
			} catch (error) {
				return "";
			}
		}

		function storeWorkspaceId(workspaceId) {
			try {
				if (workspaceId) window.localStorage.setItem(TARGET_STORAGE_KEY, String(workspaceId));
				else window.localStorage.removeItem(TARGET_STORAGE_KEY);
			} catch (error) {
				/* storage may be unavailable; the in-memory target still works */
			}
		}

		function workspaceIdForSession(controller, sessionId) {
			try {
				var list = controller && controller.list;
				var snapshot = list && typeof list.getSnapshot === "function" ? list.getSnapshot() : null;
				var items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
				for (var i = 0; i < items.length; i++) {
					var workspace = items[i];
					if (!workspace || !Array.isArray(workspace.sessionIds)) continue;
					if (workspace.sessionIds.indexOf(sessionId) >= 0 && workspace.workspaceId) return String(workspace.workspaceId);
				}
			} catch (error) {
				return "";
			}
			return "";
		}

		// The current DSH session's workspace, read-only from the ui-workspace client
		// service (whose `workspaces.list` snapshot groups session ids per workspace).
		function resolveCurrentWorkspaceId(sessionId) {
			if (!sessionId) return "";
			try {
				var scope = clientContext;
				var service = scope && typeof scope.get === "function" ? scope.get("uiWorkspace") : null;
				var fromService = workspaceIdForSession(service && service.workspaces, sessionId);
				if (fromService) return fromService;
			} catch (error) {
				/* fall through to the pure controller service name */
			}
			try {
				var otherScope = clientContext;
				var pure = otherScope && typeof otherScope.get === "function" ? otherScope.get("workspaces") : null;
				return workspaceIdForSession(pure, sessionId);
			} catch (error) {
				return "";
			}
		}

		// Sidebar list expanded state, shared by the footer action and the overlay.
		// Default collapsed; the preference survives reloads through localStorage.
		var SIDEBAR_LIST_STORAGE_KEY = "dsh-deepseek-web.sidebar-list";

		function readStoredSidebarList() {
			try {
				return window.localStorage.getItem(SIDEBAR_LIST_STORAGE_KEY) === "1";
			} catch (error) {
				return false;
			}
		}

		var sidebarListExpanded = readStoredSidebarList();
		var sidebarListListeners = [];

		function sidebarListSnapshot() {
			return sidebarListExpanded;
		}

		function subscribeSidebarList(listener) {
			sidebarListListeners.push(listener);
			return function () {
				var index = sidebarListListeners.indexOf(listener);
				if (index >= 0) sidebarListListeners.splice(index, 1);
			};
		}

		function setSidebarListExpanded(value) {
			var next = value === true;
			if (next === sidebarListExpanded) return;
			sidebarListExpanded = next;
			try {
				if (next) window.localStorage.setItem(SIDEBAR_LIST_STORAGE_KEY, "1");
				else window.localStorage.removeItem(SIDEBAR_LIST_STORAGE_KEY);
			} catch (error) {
				/* storage may be unavailable; the in-memory state still works */
			}
			var listeners = sidebarListListeners.slice();
			for (var i = 0; i < listeners.length; i++) {
				try {
					listeners[i]();
				} catch (error) {
					/* one broken subscriber must not block the rest */
				}
			}
		}

		// Temporary web conversation shown in the main area. The store holds only
		// { sessionId, title } for a chat.deepseek.com conversation; no DSH session is
		// created and no local log is written for it.
		var webChatStore = { current: null, listeners: [] };
		var webDraftSequence = 0;

		function webChatSnapshot() {
			return webChatStore.current;
		}

		function subscribeWebChat(listener) {
			webChatStore.listeners.push(listener);
			return function () {
				var index = webChatStore.listeners.indexOf(listener);
				if (index >= 0) webChatStore.listeners.splice(index, 1);
			};
		}

		function setWebChatCurrent(value) {
			var next = null;
			if (value && (value.sessionId || value.isNew)) {
				next = {
					sessionId: value.sessionId ? String(value.sessionId) : "",
					isNew: value.isNew === true,
					draftKey: value.isNew ? ++webDraftSequence : 0,
					title: value.title ? String(value.title) : ""
				};
			}
			webChatStore.current = next;
			var listeners = webChatStore.listeners.slice();
			for (var i = 0; i < listeners.length; i++) {
				try {
					listeners[i]();
				} catch (error) {
					/* one broken subscriber must not block the rest */
				}
			}
		}

		function newWebConversation() {
			setWebChatCurrent({ isNew: true, title: t("newWebChat") });
			selectMainPanel("deepseek-web-chat");
		}

		// Ask the layout service to switch the main area to a keyed panel (or back to
		// the normal conversation with `null`).
		function selectMainPanel(key) {
			try {
				var scope = clientContext;
				var layout = scope && typeof scope.get === "function" ? scope.get("layout") : null;
				if (layout && typeof layout.selectPanel === "function") {
					layout.selectPanel(key);
					if (key !== "deepseek-web-chat" && webChatSnapshot()) setWebChatCurrent(null);
					return true;
				}
			} catch (error) {
				return false;
			}
			return false;
		}

		// Shared drag helpers: read our MIME (or the tracked id fallback) and hit-test
		// the official sidebar workspace rows read-only.
		function readDraggedSessionId(fallbackId, event) {
			var sessionId = fallbackId;
			try {
				if (event && event.dataTransfer) {
					var transferred = event.dataTransfer.getData("text/deepseek-web-session") || event.dataTransfer.getData("text/plain");
					if (transferred) sessionId = String(transferred);
				}
			} catch (error) {
				/* keep the tracked dragging id */
			}
			return sessionId ? String(sessionId) : "";
		}

		function sidebarWorkspaceIdAt(event) {
			var row = null;
			try {
				var node =
					typeof document !== "undefined" && typeof document.elementFromPoint === "function" && event
						? document.elementFromPoint(event.clientX, event.clientY)
						: null;
				if (node && typeof node.closest === "function") row = node.closest('[data-row-key^="workspace:"]');
				if (!row && event && event.target && typeof event.target.closest === "function") {
					row = event.target.closest('[data-row-key^="workspace:"]');
				}
			} catch (error) {
				row = null;
			}
			if (!row || typeof row.getAttribute !== "function") return "";
			var key = String(row.getAttribute("data-row-key") || "");
			var prefix = "workspace:";
			return key.indexOf(prefix) === 0 ? key.slice(prefix.length).trim() : "";
		}

		// While one of our rows is dragged, capture-phase document listeners allow the
		// drop and resolve a real sidebar workspace row through `data-row-key`. The
		// caller owns the handlers; nothing outside this component is written.
		function useSidebarWorkspaceDrop(dragId, handlersRef) {
			React.useEffect(function () {
				if (!dragId) return undefined;
				function onDragOverCapture(event) {
					try {
						event.preventDefault();
						if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
					} catch (error) {
						/* ignore */
					}
				}
				function onDropCapture(event) {
					var element = event && event.target;
					// A page workspace card handles its own drop through React.
					if (element && typeof element.closest === "function" && element.closest(".dsweb-workspace")) return;
					try {
						if (event) event.preventDefault();
					} catch (error) {
						/* ignore */
					}
					var handlers = handlersRef && handlersRef.current ? handlersRef.current : {};
					var sessionId = "";
					var workspaceId = "";
					try {
						sessionId = typeof handlers.readSessionId === "function" ? handlers.readSessionId(event) : "";
					} catch (error) {
						sessionId = "";
					}
					try {
						workspaceId = typeof handlers.sidebarWorkspaceIdAt === "function" ? handlers.sidebarWorkspaceIdAt(event) : sidebarWorkspaceIdAt(event);
					} catch (error) {
						workspaceId = "";
					}
					try {
						if (typeof handlers.onDragSettled === "function") handlers.onDragSettled();
					} catch (error) {
						/* ignore */
					}
					if (!workspaceId) {
						if (typeof handlers.onMiss === "function") handlers.onMiss();
						return;
					}
					if (typeof handlers.onDropWorkspace === "function") handlers.onDropWorkspace(workspaceId, sessionId);
				}
				try {
					document.addEventListener("dragover", onDragOverCapture, true);
					document.addEventListener("drop", onDropCapture, true);
				} catch (error) {
					return undefined;
				}
				return function () {
					try {
						document.removeEventListener("dragover", onDragOverCapture, true);
						document.removeEventListener("drop", onDropCapture, true);
					} catch (error) {
						/* ignore */
					}
				};
			}, [dragId, handlersRef]);
		}

		// Shared import-target resolution for the page and the sidebar list:
		//   last selected workspace -> current session's workspace -> first workspace.
		// The current workspace is resolved from the ui-workspace snapshot first and
		// then from the Host /workspaces payload's sessionIds.
		function useWorkspaceTarget(workspaces, currentSessionId) {
			var state = React.useState(function () {
				return readStoredWorkspaceId();
			});
			var targetId = state[0];
			var setTargetId = state[1];

			React.useEffect(function () {
				if (!workspaces || workspaces.phase !== "ready") return;
				var items = workspaces.items || [];
				if (!items.length) {
					if (targetId) setTargetId("");
					return;
				}
				var has = function (workspaceId) {
					for (var i = 0; i < items.length; i++) if (items[i].id === workspaceId) return true;
					return false;
				};
				if (targetId && has(targetId)) return;
				var stored = readStoredWorkspaceId();
				if (stored && has(stored)) {
					setTargetId(stored);
					return;
				}
				var anchor = currentSessionId || readLastKnownSessionId();
				var fromService = resolveCurrentWorkspaceId(anchor);
				if (fromService && has(fromService)) {
					setTargetId(fromService);
					return;
				}
				for (var index = 0; index < items.length; index += 1) {
					var candidate = items[index];
					if (anchor && candidate.sessionIds && candidate.sessionIds.indexOf(anchor) >= 0) {
						setTargetId(candidate.id);
						return;
					}
				}
				setTargetId(items[0].id);
			}, [workspaces, targetId, currentSessionId]);

			function selectTarget(workspaceId, persist) {
				if (!workspaceId) return;
				setTargetId(workspaceId);
				if (persist !== false) storeWorkspaceId(workspaceId);
			}

			return { targetId: targetId, selectTarget: selectTarget };
		}

		function errorText(error) {
			if (!error) return t("errorUnknown");
			if (error.name === "AbortError") return t("errorTimeout");
			var message = error && error.message ? String(error.message) : "";
			if (!message) return t("errorUnknown");
			if (error instanceof TypeError && /fetch/i.test(message)) return t("errorNetwork");
			return message;
		}

		async function readReplyStream(response, onDelta) {
			if (!response.body) throw new Error(t("streamInterrupted"));
			var reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }), pending = "";
			function frame(line) {
				if (!line.trim()) return null;
				var value;
				try { value = JSON.parse(line); } catch (_) { throw new Error(t("streamInterrupted")); }
				if (value.type === "error") { var failure = new Error(String(value.error || t("streamInterrupted"))); failure.code = value.code; throw failure; }
				if (value.type === "delta") {
					if (value.delta && value.delta.type === "process-step" && value.delta.step && ["thinking", "search"].includes(value.delta.step.type)) { onDelta(value.delta); return null; }
					if (value.delta && value.delta.type === "process-reset" && Array.isArray(value.delta.steps)) { onDelta(value.delta); return null; }
					if (value.delta && value.delta.type === "process-text" && typeof value.delta.id === "string" && typeof value.delta.text === "string") { onDelta(value.delta); return null; }
					if (value.delta && value.delta.type === "search" && Array.isArray(value.delta.results)) { onDelta(value.delta); return null; }
					if (!value.delta || !["text", "thinking"].includes(value.delta.type) || typeof value.delta.text !== "string") throw new Error(t("streamInterrupted"));
					onDelta(value.delta);
				}
				if (value.type === "done") {
					if (value.ok !== true || typeof value.reply !== "string" || typeof value.thinking !== "string") throw new Error(t("streamInterrupted"));
					return value;
				}
				return null;
			}
			try {
				for (;;) {
					var chunk = await reader.read();
					pending += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
					if (pending.length > 4 * 1024 * 1024) throw new Error(t("streamInterrupted"));
					var newline;
					while ((newline = pending.indexOf("\n")) >= 0) {
						var result = frame(pending.slice(0, newline)); pending = pending.slice(newline + 1);
						if (result) return result;
					}
					if (chunk.done) { if (pending.trim()) { var tail = frame(pending); if (tail) return tail; } throw new Error(t("streamInterrupted")); }
				}
			} finally { await reader.cancel().catch(function () {}); reader.releaseLock(); }
		}

		// Same-origin Host API. Any non-2xx answer, or an explicit {ok:false}, is a failure.
		function request(path, body, options) {
			options = options || {};
			var init = { credentials: "same-origin", cache: "no-store" };
			if (body === undefined) {
				init.method = "GET";
			} else {
				init.method = "POST";
				init.headers = options.uploadHeaders || { "content-type": "application/json" };
				init.body = options.uploadHeaders ? body : JSON.stringify(body);
			}
			if (options.onDelta) init.headers = Object.assign({}, init.headers, { accept: "application/x-ndjson" });
			var controller = null;
			var timer = null;
			try {
				if (typeof AbortController === "function") {
					controller = new AbortController();
					init.signal = controller.signal;
				}
			} catch (error) {
				controller = null;
			}
			var externalSignal = options.signal;
			function abortExternal() { if (controller) controller.abort(); }
			if (externalSignal && controller) {
				if (externalSignal.aborted) abortExternal();
				else externalSignal.addEventListener("abort", abortExternal, { once: true });
			}
			if (controller && typeof window.setTimeout === "function") {
				timer = window.setTimeout(function () {
					try {
						controller.abort();
					} catch (error) {
						/* already settled */
					}
				}, path === "/upload" ? 210000 : path === "/continue" ? CONTINUE_TIMEOUT_MS : path === "/import" ? 600000 : REQUEST_TIMEOUT_MS);
			}
			function settle() {
				if (externalSignal) externalSignal.removeEventListener("abort", abortExternal);
				if (timer) {
					window.clearTimeout(timer);
					timer = null;
				}
			}
			return window.fetch(API_BASE + path, init).then(async function (response) {
				if (response.ok && options.onDelta && /application\/x-ndjson/i.test(response.headers.get("content-type") || "")) return readReplyStream(response, options.onDelta);
				var payload = await response.json().catch(function () { return {}; });
				if (!response.ok || !payload || payload.ok === false) {
					var message = payload && payload.error ? String(payload.error) :
						path === "/upload" && response.status === 404 ? t("hostRestartRequired") : "HTTP " + response.status;
					var failure = new Error(message); failure.status = response.status; throw failure;
				}
				return payload;
			}).finally(settle);
		}

		// --------------------------------------------------------- current session
		// The settings page itself is root-scoped (no session props), so the current
		// DSH session is observed from two safe, read-only sources:
		//   a) the session-scoped composer slot, whose props carry `sessionId`
		//      (the same mechanism dsh-prompt-manager uses for its composer control);
		//   b) the ui-session client service's main-view binding, when composed.
		// Missing both simply disables "import into the current session".
		var clientContext = null;
		var sessionTracker = { id: "", listeners: [] };
		// The probe slot unmounts while a non-conversation main panel is open, so keep
		// the last real session id: the page's default import target still resolves to
		// that session's workspace instead of falling back to the first workspace.
		var lastKnownSessionId = "";
		var accountRevision = 0;
		var deletedWebIds = new Set(), renamedWebTitles = new Map(), deleteTarget = null, deleteListeners = [];
		function deletionSnapshot() { return deleteTarget; }
		function subscribeDeletion(listener) {
			deleteListeners.push(listener);
			return function () { deleteListeners = deleteListeners.filter(function (entry) { return entry !== listener; }); };
		}
		function setDeletion(value) { deleteTarget = value; deleteListeners.slice().forEach(function (listener) { listener(); }); }
		function askDelete(item) {
			if (!item || !item.id || deleteTarget && deleteTarget.busy) return;
			setDeletion({ kind: "delete", id: String(item.id), title: item.title || t("untitledSession"), account: accountRevision, busy: false, error: "" });
		}
		function askRename(item) {
			if (!item || !item.id || deleteTarget && deleteTarget.busy) return;
			setDeletion({ kind: "rename", id: String(item.id), title: item.title || t("untitledSession"), account: accountRevision, busy: false, error: "" });
		}
		function confirmRename(value) {
			var target = deleteTarget, title = String(value || "").trim();
			if (!target || target.kind !== "rename" || target.busy || target.account !== accountRevision || !title || title.length > 200) return;
			setDeletion(Object.assign({}, target, { busy: true, error: "" }));
			request("/rename", { sessionId: target.id, title: title }).then(function (payload) {
				if (target.account !== accountRevision) return;
				renamedWebTitles.set(target.id, payload.title || title);
				setDeletion(null);
				var current = webChatSnapshot();
				if (current && current.sessionId === target.id) setWebChatCurrent(Object.assign({}, current, { title: payload.title || title }));
				refreshWebLists();
			}, function (error) {
				if (target.account === accountRevision) setDeletion(Object.assign({}, target, { busy: false, error: errorText(error) }));
			});
		}
		function confirmDeletion() {
			var target = deleteTarget;
			if (!target || target.kind !== "delete" || target.busy || target.account !== accountRevision) return;
			setDeletion(Object.assign({}, target, { busy: true, error: "" }));
			request("/delete", { sessionId: target.id, confirm: true }).then(function () {
				if (target.account !== accountRevision) return;
				deletedWebIds.add(target.id);
				setDeletion(null);
				var current = webChatSnapshot();
				if (current && current.sessionId === target.id) { setWebChatCurrent(null); selectMainPanel("deepseek-web"); }
				refreshWebLists();
			}, function (error) {
				if (target.account === accountRevision) setDeletion(Object.assign({}, target, { busy: false, error: errorText(error) }));
			});
		}
		var accountListeners = [];
		var webListRevision = 0, webListListeners = [];
		function webListSnapshot() { return webListRevision; }
		function subscribeWebList(listener) {
			webListListeners.push(listener);
			return function () { webListListeners = webListListeners.filter(function (item) { return item !== listener; }); };
		}
		function refreshWebLists() { webListRevision += 1; webListListeners.slice().forEach(function (listener) { listener(); }); }
		function accountSnapshot() { return accountRevision; }
		function subscribeAccount(listener) {
			accountListeners.push(listener);
			return function () { accountListeners = accountListeners.filter(function (item) { return item !== listener; }); };
		}
		function publishAccountChange() {
			accountRevision += 1;
			try {
				Object.keys(window.sessionStorage).filter(function (key) { return key.indexOf("dsh-deepseek-web.branch.") === 0; }).forEach(function (key) { window.sessionStorage.removeItem(key); });
			} catch (_) { /* Storage may be unavailable. */ }
			deletedWebIds.clear();
			renamedWebTitles.clear();
			setDeletion(null);
			accountListeners.slice().forEach(function (listener) { listener(); });
		}

		function readLastKnownSessionId() {
			return lastKnownSessionId;
		}

		function sessionTrackerSnapshot() {
			return sessionTracker.id;
		}

		function subscribeSessionTracker(listener) {
			sessionTracker.listeners.push(listener);
			return function () {
				var index = sessionTracker.listeners.indexOf(listener);
				if (index >= 0) sessionTracker.listeners.splice(index, 1);
			};
		}

		function publishSessionTracker(value) {
			var next = typeof value === "string" ? value : value == null ? "" : String(value);
			if (next === sessionTracker.id) return;
			sessionTracker.id = next;
			if (next) lastKnownSessionId = next;
			var listeners = sessionTracker.listeners.slice();
			for (var i = 0; i < listeners.length; i++) {
				try {
					listeners[i]();
				} catch (error) {
					/* one broken subscriber must not block the rest */
				}
			}
		}

		function readBindingSessionId(binding) {
			if (!binding || typeof binding !== "object") return "";
			if (binding.key) return String(binding.key);
			if (binding.props && binding.props.sessionId) return String(binding.props.sessionId);
			return "";
		}

		function readUiSessionId() {
			try {
				var scope = clientContext;
				var service = scope && typeof scope.get === "function" ? scope.get("uiSession") : null;
				var source = service && service.adapter && service.adapter.current;
				if (!source || typeof source.getSnapshot !== "function") return "";
				return readBindingSessionId(source.getSnapshot());
			} catch (error) {
				return "";
			}
		}

		// Headless probe: mounted only inside an open conversation, renders nothing.
		function SessionProbe(props) {
			var sessionId = "";
			try {
				sessionId = props && props.sessionId ? String(props.sessionId) : "";
			} catch (error) {
				sessionId = "";
			}
			React.useEffect(function () {
				if (!sessionId) return undefined;
				publishSessionTracker(sessionId);
				return function () {
					if (sessionTrackerSnapshot() === sessionId) publishSessionTracker("");
				};
			}, [sessionId]);
			return null;
		}

		// --------------------------------------------------------------- components
		function UiIcon(props) {
			var nativeNames = { chevronLeft: "IconChevronLeftOutlineRegular", chevronRight: "IconChevronRightOutlineRegular", chevronDown: "IconChevronDownOutlineRegular", chevronUp: "IconChevronUpOutlineRegular",
				refresh: "IconRefreshOutlineRegular", search: "IconSearchOutlineRegular", arrowUp: "IconArrowUpOutlineRegular",
				close: "IconCloseOutlineRegular", copy: "IconCopyOutlineRegular", open: "IconExternalLinkOutlineRegular",
				plus: "IconPlusOutlineMedium", globe: "IconGlobeOutlineRegular", think: "IconThinkOutlineRegular", check: "IconCheckOutlineRegular" };
			var NativeIcon = Primitives[nativeNames[props.name]];
			if (NativeIcon) return R(NativeIcon, { size: props.size || 16, "aria-hidden": true });
			var paths = {
				chevronLeft: "m10 4-4 4 4 4", chevronRight: "m6 4 4 4-4 4", chevronDown: "m4 6 4 4 4-4", chevronUp: "m4 10 4-4 4 4",
				refresh: "M13 6a5 5 0 1 0 .1 4M13 2v4H9",
				search: "M10.5 10.5 14 14M12 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
				arrowUp: "M8 13V3m-4 4 4-4 4 4", close: "m4 4 8 8M12 4l-8 8",
				open: "M6 3H3v10h10v-3M9 2h5v5M8 8l6-6",
				copy: "M6 5V2h8v9h-3M2 5h9v9H2Z", plus: "M8 3v10M3 8h10",
				globe: "M1 8h14M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 0c4 4 4 10 0 14C4 11 4 5 8 1Z",
				think: "M8 3C6 0 3 2 3 5c-3 1-2 5 0 5 0 3 3 5 5 2 2 3 5 1 5-2 2 0 3-4 0-5 0-3-3-5-5-2Zm0 0v9M3 5l2 1m8-1-2 1M3 10l2-1m8 1-2-1",
				trash: "M2 4h12M6 2h4M4 4l1 10h6l1-10M7 6v5m2-5v5",
				edit: "m10 3 3 3M2 14l1-4 8-8 3 3-8 8-4 1Z",
				check: "m3 8 3 3 7-7"
			};
			return R("svg", { width: props.size || 16, height: props.size || 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
				R("path", { d: paths[props.name] || paths.open, stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round", strokeLinejoin: "round" }));
		}

		function SearchField(props) {
			return R("div", { className: "dsweb-search-field" }, R(UiIcon, { name: "search" }),
				R("input", { type: "search", className: "dsweb-input", value: props.value, placeholder: t("searchConversations"),
					ref: props.inputRef, autoFocus: props.autoFocus === true, onKeyDown: props.onKeyDown,
					"aria-label": t("searchConversations"), onChange: function (event) { props.onChange(event.target.value); } }));
		}

		function Spinner() {
			return R("span", { className: "dsweb-spinner", "aria-hidden": "true" });
		}

		function DeleteConversationDialog() {
			React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
			var target = React.useSyncExternalStore(subscribeDeletion, deletionSnapshot, deletionSnapshot);
			var draftState = React.useState(""), draft = draftState[0], setDraft = draftState[1];
			React.useEffect(function () { setDraft(target ? target.title : ""); }, [target && target.id, target && target.kind]);
			React.useEffect(function () {
				if (!target || Primitives.Modal) return;
				if (target.kind === "rename") {
					var value = window.prompt(t("renameLabel"), target.title);
					if (value != null && value.trim()) confirmRename(value); else setDeletion(null);
					return;
				}
				if (window.confirm(t("deleteDescription", { title: target.title }))) confirmDeletion();
				else setDeletion(null);
			}, [target && target.id, target && target.kind]);
			if (!target || !Primitives.Modal) return null;
			var rename = target.kind === "rename";
			function close() { if (!target.busy) setDeletion(null); }
			var Button = Primitives.Button || "button";
			return R(Primitives.Modal, { open: true, onClose: close, closeLabel: t("cancel"), title: t(rename ? "renameTitle" : "deleteTitle"),
				description: rename ? undefined : t("deleteDescription", { title: target.title }), footer: R(React.Fragment, null,
					R(Button, { type: "button", variant: "outline", disabled: target.busy, onClick: close }, t("cancel")),
					R(Button, { type: "button", variant: "outline", className: rename ? undefined : "dsweb-delete-action", disabled: target.busy || rename && !draft.trim(),
						onClick: rename ? function () { confirmRename(draft); } : confirmDeletion }, t(rename ? "renameSave" : "deleteConfirm"))) },
				rename ? R("input", { type: "text", className: "dsweb-rename-input", "aria-label": t("renameLabel"), autoFocus: true, value: draft,
					maxLength: 200, disabled: target.busy, onChange: function (event) { setDraft(event.target.value); },
					onKeyDown: function (event) {
						if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); confirmRename(draft); }
					} }) : null,
				target.busy ? R("p", { role: "status" }, t(rename ? "renamePending" : "deletePending")) : null,
				target.error ? R(Notice, { tone: "error", text: t(rename ? "renameFailed" : "deleteFailed", { message: target.error }) }) : null);
		}

		function Notice(props) {
			var tone = props.tone || "info";
			return R(
				"div",
				{ className: "dsweb-notice", "data-tone": tone, role: tone === "error" ? "alert" : "status" },
				R("div", { className: "dsweb-notice-body" }, props.children != null ? props.children : props.text),
				props.onRetry
					? R("button", { type: "button", className: "dsweb-button", onClick: props.onRetry }, props.retryLabel || t("retry"))
					: null,
				props.onDismiss ? R("button", { type: "button", className: "dsweb-icon-button", title: t("closeImportResult"), "aria-label": t("closeImportResult"),
					onClick: props.onDismiss }, R(UiIcon, { name: "close", size: 14 })) : null
			);
		}

		function Checkbox(props) {
			return R(
				"label",
				{ className: "dsweb-check" },
				R("input", {
					type: "checkbox",
					checked: props.checked === true,
					disabled: props.disabled === true,
					onChange: function (event) {
						if (typeof props.onChange === "function") props.onChange(event.target.checked === true);
					}
				}),
				R("span", null, props.label)
			);
		}

		function SessionRow(props) {
			var item = props.item;
			var selected = props.selected === true;
			var disabled = props.disabled === true;
			var importing = props.importing === true;
			var attrs = {
				className: "dsweb-session",
				role: "button",
				tabIndex: disabled ? -1 : 0,
				"data-selected": selected ? "1" : "0",
				"data-importing": importing ? "1" : "0",
				"aria-pressed": selected ? "true" : "false",
				"aria-disabled": disabled ? "true" : "false",
				title: item.title || props.t("untitledSession"),
				onClick: function () {
					if (disabled) return;
					if (typeof props.onSelect === "function") props.onSelect();
				},
				onKeyDown: function (event) {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					if (disabled) return;
					if (typeof props.onSelect === "function") props.onSelect();
				}
			};
			if (props.draggable === true && !disabled) {
				attrs.draggable = true;
				attrs["data-dragging"] = props.dragging === true ? "1" : "0";
				attrs.onDragStart = function (event) {
					if (typeof props.onDragStart === "function") props.onDragStart(item.id, event);
				};
				attrs.onDragEnd = function (event) {
					if (typeof props.onDragEnd === "function") props.onDragEnd(event);
				};
			}
			if (typeof props.onPointerDown === "function") {
				attrs.onPointerDown = function (event) {
					if (disabled) return;
					props.onPointerDown(item.id, event);
				};
			}
			var action = null;
			if (importing) {
				action = R("span", { className: "dsweb-session-status" }, R(Spinner, null), props.t("rowImporting"));
			} else if (typeof props.onPreview === "function") {
				action = R(
					"button",
					{
						type: "button",
						className: "dsweb-session-preview",
						title: props.previewTitle || props.t("previewActionTitle"),
						"aria-label": props.t("previewActionTitle"),
						disabled: disabled,
						onClick: function (event) {
							if (event && event.stopPropagation) event.stopPropagation();
							if (event && event.preventDefault) event.preventDefault();
							if (disabled) return;
							props.onPreview();
						},
						onKeyDown: function (event) {
							if (event && event.stopPropagation) event.stopPropagation();
						}
					},
					props.t("previewAction")
				);
			}
			return R(
				"div",
				attrs,
				R(
					"span",
					{ className: "dsweb-session-main" },
					R("span", { className: "dsweb-session-title" }, item.title || props.t("untitledSession")),
					R(
						"span",
						{ className: "dsweb-session-meta" },
						props.updatedLabel ? R("span", null, props.updatedLabel) : null,
						item.modelType ? R("span", { className: "dsweb-tag" }, item.modelType) : null,
						item.pinned ? R("span", { className: "dsweb-pinned" }, props.t("pinned")) : null
					)
				),
				R("span", { className: "dsweb-session-actions" }, action,
					R("button", { type: "button", className: "dsweb-icon-button dsweb-row-rename", disabled: disabled || importing,
						title: props.t("renameWebChat"), "aria-label": props.t("renameWebChatNamed", { title: item.title || props.t("untitledSession") }),
						onPointerDown: function (event) { event.stopPropagation(); }, onKeyDown: function (event) { event.stopPropagation(); },
						onClick: function (event) { event.preventDefault(); event.stopPropagation(); askRename(item); } }, R(UiIcon, { name: "edit", size: 14 })),
					R("button", { type: "button", className: "dsweb-icon-button dsweb-row-delete", disabled: disabled || importing,
						title: props.t("deleteWebChat"), "aria-label": props.t("deleteWebChatNamed", { title: item.title || props.t("untitledSession") }),
						onPointerDown: function (event) { event.stopPropagation(); },
						onKeyDown: function (event) { event.stopPropagation(); },
						onClick: function (event) { event.preventDefault(); event.stopPropagation(); askDelete(item); } }, R(UiIcon, { name: "trash", size: 14 })))
			);
		}

		function ThinkingBlock(props) {
			var openState = React.useState(false), open = openState[0], setOpen = openState[1];
			var summary = String(props.text || "").split(/\r?\n/).find(function (line) { return line.trim(); }) || "";
			var body = R("div", { className: "dsweb-disclosure-body" }, R(MessageBody, { text: props.text, compact: true, streaming: props.streaming }));
			if (Primitives.DisclosureRow) return R("div", { className: "dsweb-thinking dsweb-native-disclosure", "data-variant": "think" },
				R(Primitives.DisclosureRow, { icon: R(UiIcon, { name: "think", size: 14 }), title: props.t("thinkingLabel"),
					open: open, running: !!props.streaming, expandable: true, expandOnRowClick: true, titleClassName: "dsweb-disclosure-title",
					onToggle: function () { setOpen(!open); }, collapsedContent: R("span", { className: "dsweb-disclosure-summary" },
						Primitives.TextShimmer ? R(Primitives.TextShimmer, null, summary.replace(/\*\*/g, "")) : summary) }, body));
			return R(
				"details",
				{ className: "dsweb-thinking", open: props.streaming ? true : undefined },
				R("summary", null, props.t("thinkingLabel")),
				R("div", { className: "dsweb-thinking-body" }, R(MessageBody, { text: props.text, compact: true, streaming: props.streaming }))
			);
		}

		function SearchResults(props) {
			var openState = React.useState(false), open = openState[0], setOpen = openState[1];
			var items = props.items || [];
			if (!items.length && !props.process) return null;
			if (Primitives.DisclosureRow) return R("div", { className: "dsweb-search dsweb-native-disclosure " + (props.process ? "dsweb-process-search" : "dsweb-sources-summary") },
				R(Primitives.DisclosureRow, { icon: R(UiIcon, { name: props.action === "open" ? "open" : "globe", size: 14 }),
					title: props.process ? props.t(props.action === "open" ? "processOpenStep" : "processSearchStep") : props.t("webSources", { count: items.length }),
					collapsedContent: props.process && props.query ? R("span", { className: "dsweb-disclosure-summary" }, props.query) : undefined,
					open: open, expandable: !!items.length, expandOnRowClick: true, titleClassName: "dsweb-disclosure-title", onToggle: function () { setOpen(!open); } },
					R("ol", { className: "dsweb-sources-body" }, items.map(function (item, index) {
						return R("li", { key: index }, item.url ? R("a", { href: item.url, target: "_blank", rel: "noreferrer noopener" }, item.title || item.url) : item.title);
					}))));
			return R(
				"div",
				{ className: "dsweb-search" },
				R("div", { className: "dsweb-search-title" }, props.t("searchLabel")),
				R(
					"ul",
					{ className: "dsweb-search-list" },
					items.map(function (item, index) {
						return R(
							"li",
							{ key: "dsweb-sr-" + index, className: "dsweb-search-item" },
							item.url
								? R("a", { href: item.url, target: "_blank", rel: "noreferrer noopener" }, item.title || item.url)
								: R("span", null, item.title || item.url)
						);
					})
				)
			);
		}

		function MessageBody(props) {
			var labels = React.useMemo(function () {
				return { code: { copyLabel: t("copyContent"), copiedLabel: t("copied"), toolbarLabels: {
					codeLabel: "Code", wrapLabel: activeLocale === "en" ? "Wrap" : "自动换行", unwrapLabel: activeLocale === "en" ? "No wrap" : "取消换行"
				} }, footnotes: activeLocale === "en" ? "References" : "参考资料" };
			}, [activeLocale]);
			return Primitives.MarkdownText
				? R(Primitives.MarkdownText, { text: props.text, labels: labels, streaming: props.streaming === true, variant: props.compact ? "compact" : "body" })
				: props.text;
		}

		function AttachmentImage(props) {
			var file = props.file;
			var srcState = React.useState(""), src = srcState[0], setSrc = srcState[1];
			var phaseState = React.useState("loading"), phase = phaseState[0], setPhase = phaseState[1];
			var openState = React.useState(false), open = openState[0], setOpen = openState[1];
			var retryState = React.useState(0), attempt = retryState[0], setAttempt = retryState[1];
			var local = file.file && (/^image\/(png|jpeg|gif|webp|bmp)$/i.test(file.file.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name));
			var source = local ? file.file : file.id;
			var viewportRef = React.useRef(null), seenState = React.useState(!!local || typeof window.IntersectionObserver !== "function");
			var seen = seenState[0], setSeen = seenState[1];
			React.useEffect(function () {
				if (local || typeof window.IntersectionObserver !== "function") { setSeen(true); return; }
				var observer = new IntersectionObserver(function (entries) {
					if (entries.some(function (entry) { return entry.isIntersecting; })) { setSeen(true); observer.disconnect(); }
				}, { rootMargin: "480px" });
				if (viewportRef.current) observer.observe(viewportRef.current);
				return function () { observer.disconnect(); };
			}, [source]);
			React.useEffect(function () {
				if (!seen) return;
				var active = true, controller = new AbortController(), url = "", probe = null, timer = null, wake = null;
				setPhase("loading"); setOpen(false); setSrc("");
				(async function () {
					for (var retry = 0; retry < 4 && active; retry++) {
						try {
							var blob;
							if (local) blob = file.file;
							else {
								if (!file.id) { setPhase("failed"); return; }
								var response = await window.fetch(API_BASE + "/image?fileId=" + encodeURIComponent(file.id) + "&retry=" + (attempt * 4 + retry), {
									credentials: "same-origin", cache: "no-store", signal: controller.signal });
								if (!response.ok) throw Object.assign(new Error("HTTP " + response.status), {
									permanent: response.status < 500 && ![408, 425, 429].includes(response.status) });
								blob = await response.blob();
								if (blob.size > 12 * 1024 * 1024 || !/^image\/(png|jpeg|gif|webp)$/i.test(blob.type)) throw new Error("Invalid image");
							}
							if (!active) return;
							url = URL.createObjectURL(blob);
							probe = new Image();
							probe.src = url;
							await probe.decode();
							if (active) { setSrc(url); setPhase("ready"); }
							return;
						} catch (failure) {
							if (url) { URL.revokeObjectURL(url); url = ""; }
							if (!active || controller.signal.aborted) return;
							if (retry === 3 || local || failure.permanent) { setPhase("failed"); return; }
							await new Promise(function (resolve) { wake = resolve; timer = window.setTimeout(resolve, [1000, 2500, 5000][retry]); });
						}
					}
				})();
				return function () { active = false; controller.abort(); if (timer) window.clearTimeout(timer); if (wake) wake(); if (probe) probe.src = ""; if (url) URL.revokeObjectURL(url); };
			}, [source, attempt, seen]);
			var label = t("imagePreview", { name: file.name });
			return R("div", { className: "dsweb-image-target", ref: viewportRef },
				phase === "ready" && src ? R("button", { type: "button", className: "dsweb-image-open", "aria-label": label, title: label,
					onClick: function () { setOpen(true); } }, R("img", { key: src, src: src, alt: file.name || t("imageDialog"), loading: "lazy", decoding: "async",
					referrerPolicy: "no-referrer" })) :
				phase === "failed" ? R("button", { type: "button", className: "dsweb-image-failed", "aria-label": t("imageRetry", { name: file.name }),
					onClick: function () { setAttempt(attempt + 1); } }, t("imageFailed"), R(UiIcon, { name: "refresh", size: 14 })) :
				R("div", { className: "dsweb-image-loading", role: "status" }, R(Spinner), t("imageLoading")),
				open && src && Primitives.ImageLightbox ? R(Primitives.ImageLightbox, { src: src, alt: file.name || "",
					labels: { dialog: t("imageDialog"), close: t("imageClose") }, onClose: function () { setOpen(false); } }) : null);
		}

		function FileCards(props) {
			if (!props.files || !props.files.length) return null;
			return R("div", { className: "dsweb-files" }, props.files.map(function (file) {
				var name = file.name || "Attachment";
				return R("div", { key: file.key || file.id, className: "dsweb-file", "data-image": file.isImage ? "1" : "0", "data-error": file.status === "error" ? "1" : "0" },
					file.isImage ? R(AttachmentImage, { file: file }) : null,
					R("div", { className: "dsweb-file-info" },
					R("span", { className: "dsweb-file-kind", "aria-hidden": true }, name.indexOf(".") >= 0 ? name.split(".").pop().slice(0, 5).toUpperCase() : "FILE"),
					R("div", { className: "dsweb-file-detail" }, R("span", { className: "dsweb-file-name", title: name }, name),
						R("span", { className: "dsweb-file-state", role: file.status === "error" ? "alert" : undefined },
							file.status === "uploading" ? t("fileUploading") : file.error || (file.size ? Math.ceil(file.size / 1024) + " KB" : t("fileReady")))),
					file.status === "uploading" ? R(Spinner) : null,
					file.status === "error" && props.onRetry ? R("button", { type: "button", className: "dsweb-icon-button", disabled: props.disabled,
						title: t("fileRetry", { name: name }), "aria-label": t("fileRetry", { name: name }), onClick: function () { props.onRetry(file.key); } }, R(UiIcon, { name: "refresh" })) : null,
					props.onRemove ? R("button", { type: "button", className: "dsweb-icon-button", disabled: props.disabled,
						title: t("fileRemove", { name: name }), "aria-label": t("fileRemove", { name: name }), onClick: function () { props.onRemove(file.key); } }, R(UiIcon, { name: "close", size: 14 })) : null));
			}));
		}

		function MessageItem(props) {
			var message = props.message || {};
			var isUser = message.role === "user";
			var text = clipText(message.text, props.fullText ? 200000 : MAX_TEXT_CHARS);
			var thinking = clipText(message.thinking, props.fullText ? 200000 : MAX_TEXT_CHARS);
			return R(
				"article",
				{ className: "dsweb-message", "data-message-id": message.id, "data-role": isUser ? "user" : "assistant", "data-streaming": message.streaming ? "1" : "0" },
				R(
					"header",
					{ className: "dsweb-message-head" },
					R("span", { className: "dsweb-role" }, isUser ? props.t("userLabel") : props.t("assistantLabel")),
					message.timeLabel ? R("span", { className: "dsweb-time" }, message.timeLabel) : null
				),
				R("div", { className: "dsweb-message-body" },
				!isUser ? R(MessageProcess, { message: message, thinking: thinking, tt: props.t }) : null,
				R(FileCards, { files: message.files }),
				isUser && message.files && message.files.length && (!text || text === "（仅附件，无文字）") ? null :
				R("div", { className: "dsweb-message-text", "data-markdown": isUser ? "0" : "1" }, isUser ? text :
					message.streaming && !text ? !thinking ? R("span", { role: "status", "aria-label": props.t("continueSending") }, R(Spinner)) : null :
					R(MessageBody, { text: text || props.t("emptyMessage"), streaming: message.streaming })),
				R(SearchResults, { items: normalizeSearchResults(message.searchResults), t: props.t })),
				props.fullText && (!message.streaming || props.branch?.siblings.length > 1) ? R(MessageActions, { text: message.files?.length && message.text === "（仅附件，无文字）" ? "" : String(message.text || ""), time: message.streaming ? null : message.insertedAt, isUser: isUser, tt: props.t, streaming: message.streaming,
					branch: props.branch, onSelectAnswer: props.onSelectAnswer, onRegenerate: props.onRegenerate, disabled: props.disabled, regenerateDisabled: props.regenerateDisabled }) : null
			);
		}

		function MessageProcess(props) {
			var message = props.message, tt = props.tt, steps = normalizeProcessSteps(message.processSteps);
			if (!steps.length) {
				if (props.thinking) steps.push({ id: "legacy-think", type: "thinking", text: props.thinking, elapsedMs: message.thinkingMs });
				if (message.searchResults?.length) steps.push({ id: "legacy-search", type: "search", searchResults: normalizeSearchResults(message.searchResults) });
			}
			var openState = React.useState(!!message.streaming), open = openState[0], setOpen = openState[1];
			var wasStreaming = React.useRef(!!message.streaming), bodyId = React.useId();
			React.useEffect(function () {
				if (wasStreaming.current && !message.streaming) setOpen(false);
				wasStreaming.current = !!message.streaming;
			}, [message.streaming]);
			if (!steps.length) return null;
			var duration = Number.isFinite(message.thinkingMs) ? message.thinkingMs : processDuration(steps);
			var active = message.streaming && !message.text, last = steps[steps.length - 1];
			var label = message.incomplete ? tt("processStopped") : active ?
				tt(last.type === "thinking" ? "processThinking" : last.action === "open" ? "processOpen" : "processSearch") :
				Number.isFinite(duration) ? tt("processTimed", { duration: processDurationText(duration, tt) }) :
				tt(steps.some(function (step) { return step.type === "thinking"; }) ? "processThought" : "processDone");
			return R("section", { className: "dsweb-process" },
				R("button", { type: "button", className: "dsweb-process-header", "aria-expanded": open, "aria-controls": bodyId,
					"data-open": open ? "1" : "0", onClick: function () { setOpen(!open); } },
					R("span", { className: "dsweb-process-label" }, Primitives.TextShimmer ? R(Primitives.TextShimmer, { active: !!active }, label) : label),
					R(UiIcon, { name: open ? "chevronUp" : "chevronDown", size: 14 })),
				R("div", { className: "dsweb-process-children", id: bodyId, hidden: !open }, steps.map(function (step, index) {
					return R("div", { key: step.id, className: "dsweb-process-step", "data-type": step.type, "data-action": step.action },
						step.type === "thinking" ? R(ThinkingBlock, { text: step.text, t: tt, streaming: active && index === steps.length - 1 }) :
						R(SearchResults, { items: step.searchResults || [], t: tt, process: true, action: step.action, query: step.query }));
				})));
		}

		function MessageActions(props) {
			var state = React.useState(""), copied = state[0], setCopied = state[1];
			var alive = React.useRef(true), pending = React.useRef(false), timer = React.useRef(null);
			React.useEffect(function () { alive.current = true; return function () { alive.current = false; if (timer.current) window.clearTimeout(timer.current); }; }, []);
			function copy() {
				if (pending.current || copied === "ok") return;
				pending.current = true;
				var job = Primitives.writeClipboard ? Primitives.writeClipboard(props.text) :
					window.navigator.clipboard ? window.navigator.clipboard.writeText(props.text).then(function () { return true; }) : Promise.resolve(false);
				Promise.resolve(job).then(function (ok) {
					if (!alive.current) return;
					pending.current = false; setCopied(ok ? "ok" : "error");
					if (ok) timer.current = window.setTimeout(function () { if (alive.current) setCopied(""); }, 1000);
				}, function () { pending.current = false; if (alive.current) setCopied("error"); });
			}
			var stamp = toMillis(props.time); if (stamp > 0 && stamp < 1000000000000) stamp *= 1000;
			var date = new Date(stamp), now = new Date(), clock = null;
			if (stamp > 0 && Number.isFinite(date.getTime())) {
				var label = ("0" + date.getHours()).slice(-2) + ":" + ("0" + date.getMinutes()).slice(-2);
				if (date.toDateString() !== now.toDateString()) label = props.tt(date.getFullYear() === now.getFullYear() ? "clockMD" : "clockYMD", {
					y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate()
				}) + " " + label;
				clock = R("time", { className: "dsweb-message-clock", dateTime: date.toISOString(), title: date.toLocaleString(activeLocale === "en" ? "en-US" : "zh-CN", { hour12: false }) }, label);
			}
			var label = props.tt(copied === "ok" ? "copied" : "copyContent");
			var button = R("button", { type: "button", className: "dsweb-message-action", "aria-label": label, title: label,
				disabled: props.streaming || !props.text.trim(), onClick: copy }, R(UiIcon, { name: copied === "ok" ? "check" : "copy", size: props.isUser ? 15 : 17 }));
			return R("footer", { className: "dsweb-message-footer", "data-clock": props.isUser ? "start" : "end" },
				props.branch && props.branch.siblings.length > 1 ? R("div", { className: "dsweb-answer-versions", role: "group",
					"aria-label": props.tt(props.isUser ? "questionVersions" : "answerVersions", { index: props.branch.index + 1, count: props.branch.siblings.length }) },
					R("button", { type: "button", className: "dsweb-message-action", title: props.tt(props.isUser ? "previousQuestion" : "previousAnswer"), "aria-label": props.tt(props.isUser ? "previousQuestion" : "previousAnswer"), disabled: props.disabled || props.branch.index === 0,
						onClick: function () { props.onSelectAnswer(props.branch, props.branch.index - 1); } }, R(UiIcon, { name: "chevronLeft", size: 16 })),
					R("span", { className: "dsweb-answer-count", "aria-live": "polite" }, (props.branch.index + 1) + " / " + props.branch.siblings.length),
					R("button", { type: "button", className: "dsweb-message-action", title: props.tt(props.isUser ? "nextQuestion" : "nextAnswer"), "aria-label": props.tt(props.isUser ? "nextQuestion" : "nextAnswer"), disabled: props.disabled || props.branch.index === props.branch.siblings.length - 1,
						onClick: function () { props.onSelectAnswer(props.branch, props.branch.index + 1); } }, R(UiIcon, { name: "chevronRight", size: 16 }))) : null,
				props.isUser ? clock : null, Primitives.Tooltip ? R(Primitives.Tooltip, { label: label, side: "bottom" }, button) : button,
				!props.isUser ? clock : null, copied === "error" ? R("span", { role: "alert", className: "dsweb-copy-error" }, props.tt("copyMessageFailed")) : null,
				!props.isUser && props.onRegenerate ? R("button", { type: "button", className: "dsweb-message-action dsweb-regenerate", title: props.tt("regenerate"), "aria-label": props.tt("regenerate"),
					disabled: props.disabled || props.regenerateDisabled, onClick: props.onRegenerate }, R(UiIcon, { name: "refresh", size: 17 })) : null);
		}

		// Shared surfaces used by both the settings.section panel and the main page,
		// so token handling, session pagination, preview rendering, and the web
		// continuation composer behave identically in both places.
		function TokenCard(props) {
			var c = props.controller;
			var tt = props.tt || t;
			var idPrefix = props.idPrefix || "dsweb";
			var compact = props.compact === true;
			var hasToken = c.hasToken;
			var statusData = c.statusData;
			var draft = c.draft;
			var tokenUi = c.tokenUi;
			var busy = tokenUi.busy;
			var canSave = draft.trim().length > 0 && !busy;
			var canClear = hasToken && !busy;
			return R(
				"section",
				{ className: "dsweb-card" + (compact ? " dsweb-token-card" : "") },
				R(
					"div",
					{ className: "dsweb-card-head" },
					R("h3", { className: "dsweb-card-title" }, tt("tokenHeading")),
					R(
						"span",
						{ className: "dsweb-status", "data-state": hasToken ? "on" : "off" },
						R("span", { className: "dsweb-dot", "data-state": hasToken ? "on" : "off" }),
						hasToken ? tt("tokenConfigured") : tt("tokenMissing")
					)
				),
				R(
					"div",
					{ className: "dsweb-field" },
					R("label", { className: "dsweb-label", htmlFor: idPrefix + "-input" }, tt("tokenInputLabel")),
					R(
						"div",
						{ className: "dsweb-token-row" },
						R("input", {
							id: idPrefix + "-input",
							className: "dsweb-input",
							type: tokenUi.show ? "text" : "password",
							value: draft,
							placeholder: tt("tokenPlaceholder"),
							autoComplete: "off",
							spellCheck: false,
							maxLength: MAX_TOKEN_LENGTH,
							disabled: !!busy,
							onChange: function (event) {
								var value = event.target.value;
								c.setDraft(value);
								c.setTokenUi(function (previous) {
									return {
										show: previous.show,
										busy: previous.busy,
										error: "",
										notice: null
									};
								});
							}
						}),
						R(
							"button",
							{
								type: "button",
								className: "dsweb-button",
								disabled: !!busy,
								onClick: function () {
									c.setTokenUi(function (previous) {
										return {
											show: !previous.show,
											busy: previous.busy,
											error: previous.error,
											notice: previous.notice
										};
									});
								}
							},
							tokenUi.show ? tt("tokenHide") : tt("tokenShow")
						)
					)
				),
				R(
					"div",
					{ className: "dsweb-row dsweb-row-wrap" },
					R(
						"button",
						{ type: "button", className: "dsweb-button", "data-primary": "1", disabled: !canSave, onClick: c.saveToken },
						busy === "save" ? R(Spinner, null) : null,
						busy === "save" ? tt("tokenSaving") : tt("tokenSave")
					),
					R(
						"button",
						{ type: "button", className: "dsweb-button", "data-danger": "1", disabled: !canClear, onClick: c.clearToken },
						busy === "clear" ? R(Spinner, null) : null,
						busy === "clear" ? tt("tokenClearing") : tt("tokenClear")
					),
					hasToken && statusData && statusData.tokenHint
						? R("span", { className: "dsweb-muted" }, tt("tokenHintPrefix") + statusData.tokenHint)
						: null
				),
				tokenUi.error ? R(Notice, { tone: "error", text: tokenUi.error }) : null,
				tokenUi.notice ? R(Notice, { tone: "success", text: tt(tokenUi.notice.key, tokenUi.notice.params) }) : null,
				compact ? null : R("details", { className: "dsweb-token-help" },
					R("summary", null, tt("connectionHelpTitle")),
					R("p", { className: "dsweb-hint" }, tt("tokenHelp")), R("code", { className: "dsweb-code" }, tt("tokenCommand")),
					R("p", { className: "dsweb-hint" }, tt("tokenNote")))
			);
		}

		function SessionsCard(props) {
			var c = props.controller;
			var tt = props.tt || t;
			var sessions = c.sessions;
			var hasToken = c.hasToken;
			var phase = sessions.phase;
			var busy = phase === "loading" || phase === "loadingMore";
			var list = sessions.items;
			var fill = props.fill === true;
			var dragEnabled = props.dragEnabled === true;
			var draggingId = props.draggingId || "";
			var importingId = props.importingId || "";
			var rowsDisabled = props.rowsDisabled === true;
			var onActivate = typeof props.onActivate === "function" ? props.onActivate : function (sessionId) { c.selectSession(sessionId); };
			var onPreview = typeof props.onPreview === "function" ? props.onPreview : null;
			return R(
				"section",
				{ className: "dsweb-card" + (fill ? " dsweb-card-fill" : "") },
				R(
					"div",
					{ className: "dsweb-card-head" },
					R("h3", { className: "dsweb-card-title" }, tt("sessionsHeading")),
					R(
						"button",
						{
							type: "button",
							className: "dsweb-button",
							disabled: !hasToken || busy,
							onClick: function () {
								c.loadSessions(false);
							}
						},
						phase === "loading" ? R(Spinner, null) : null,
						tt("refresh")
					)
				),
				phase === "loading" ? R("div", { className: "dsweb-state" }, R(Spinner, null), tt("loading")) : null,
				props.hint ? R("p", { className: "dsweb-hint" }, props.hint) : null,
				sessions.error
					? R(Notice, {
							tone: "error",
							text: tt("sessionsError", { message: sessions.error }),
							onRetry: function () {
								c.loadSessions(false);
							},
							retryLabel: tt("retry")
						})
					: null,
				!hasToken ? R("div", { className: "dsweb-empty" }, tt("sessionsNeedToken")) : null,
				hasToken && !sessions.error && phase !== "loading" && list.length === 0
					? R("div", { className: "dsweb-empty" }, tt("sessionsEmpty"))
					: null,
				list.length
					? R(
							"div",
							{ className: "dsweb-session-list" + (fill ? " dsweb-session-list-fill" : "") },
							list.map(function (item) {
								return R(SessionRow, {
									key: item.id,
									item: item,
									selected: item.id === c.selectedId,
									updatedLabel: formatRelative(item.updatedAt),
									t: tt,
									draggable: dragEnabled && !rowsDisabled,
									dragging: item.id === draggingId,
									disabled: rowsDisabled,
									importing: item.id === importingId,
									onSelect: function () {
										onActivate(item.id);
									},
									onPreview: onPreview
										? function () {
												onPreview(item.id);
											}
										: null,
									onDragStart: dragEnabled ? props.onDragStart : null,
									onDragEnd: dragEnabled ? props.onDragEnd : null
								});
							})
						)
					: null,
				list.length && sessions.hasMore
					? R(
							"div",
							{ className: "dsweb-row dsweb-row-center" },
							R(
								"button",
								{
									type: "button",
									className: "dsweb-button",
									disabled: busy,
									onClick: function () {
										c.loadSessions(true);
									}
								},
								phase === "loadingMore" ? R(Spinner, null) : null,
								tt("loadMore")
							)
						)
					: null
			);
		}

		function PreviewCard(props) {
			var c = props.controller;
			var tt = props.tt || t;
			var phase = c.history.phase;
			var list = c.history.messages;
			var fill = props.fill === true;
			return R(
				"section",
				{ className: "dsweb-card" + (fill ? " dsweb-card-fill" : "") },
				R(
					"div",
					{ className: "dsweb-card-head" },
					R("h3", { className: "dsweb-card-title" }, c.previewTitle || tt("previewHeading")),
					R("span", { className: "dsweb-muted" }, list.length ? tt("previewMessages", { count: list.length }) : "")
				),
				!c.selectedId ? R("div", { className: "dsweb-empty" }, tt("previewNeedSelection")) : null,
				c.selectedId && phase === "loading" ? R("div", { className: "dsweb-state" }, R(Spinner, null), tt("previewLoading")) : null,
				c.selectedId && phase === "error"
					? R(Notice, {
							tone: "error",
							text: tt("previewError", { message: c.history.error || tt("errorUnknown") }),
							onRetry: function () {
								c.loadHistory(c.selectedId);
							},
							retryLabel: tt("retry")
						})
					: null,
				c.selectedId && phase === "ready" && list.length === 0
					? R("div", { className: "dsweb-empty" }, tt("previewEmpty"))
					: null,
				list.length
					? R(
							"div",
							{ className: "dsweb-preview" + (fill ? " dsweb-preview-fill" : ""), ref: c.previewRef },
							list.map(function (message, index) {
								return R(MessageItem, {
									key: message.id || "dsweb-msg-" + index,
									message: message,
									t: tt
								});
							})
						)
					: null
			);
		}

		function ContinueForm(props) {
			var c = props.controller;
			var tt = props.tt || t;
			var cont = c.cont;
			var selected = !!c.selectedId;
			return R(
				"div",
				{ className: "dsweb-field" },
				R("textarea", {
					className: "dsweb-textarea",
					value: cont.prompt,
					maxLength: MAX_PROMPT_LENGTH,
					placeholder: tt("continuePlaceholder"),
					disabled: cont.busy,
					onChange: function (event) {
						var value = event.target.value;
						c.setCont(function (previous) {
							return {
								prompt: value,
								thinking: previous.thinking,
								search: previous.search,
								busy: previous.busy,
								error: "",
								notice: previous.notice
							};
						});
					},
					onKeyDown: function (event) {
						if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
						event.preventDefault();
						c.sendContinue();
					}
				}),
				R(
					"div",
					{ className: "dsweb-row dsweb-row-wrap" },
					R(Checkbox, {
						checked: cont.thinking,
						disabled: cont.busy,
						label: tt("continueThinking"),
						onChange: function (checked) {
							c.setCont(function (previous) {
								return {
									prompt: previous.prompt,
									thinking: checked,
									search: previous.search,
									busy: previous.busy,
									error: previous.error,
									notice: previous.notice
								};
							});
						}
					}),
					R(Checkbox, {
						checked: cont.search,
						disabled: cont.busy,
						label: tt("continueSearch"),
						onChange: function (checked) {
							c.setCont(function (previous) {
								return {
									prompt: previous.prompt,
									thinking: previous.thinking,
									search: checked,
									busy: previous.busy,
									error: previous.error,
									notice: previous.notice
								};
							});
						}
					}),
					R(
						"button",
						{
							type: "button",
							className: "dsweb-button",
							"data-primary": "1",
							disabled: cont.busy || !selected || !cont.prompt.trim(),
							title: !selected ? tt("continueNeedSelection") : tt("continueSend"),
							"aria-label": tt("continueSend"),
							onClick: c.sendContinue
						},
						cont.busy ? R(Spinner, null) : null,
						cont.busy ? tt("continueSending") : tt("continueSend")
					)
				),
				!selected ? R("p", { className: "dsweb-hint" }, tt("continueNeedSelection")) : null,
				cont.error ? R(Notice, { tone: "error", text: tt("continueFailed", { message: cont.error }) }) : null,
				cont.notice ? R(Notice, { tone: "success", text: tt(cont.notice.key, cont.notice.params) }) : null
			);
		}

		function ImportResult(props) {
			var tt = props.tt || t;
			var result = props.result;
			var openState = React.useState(""), openError = openState[0], setOpenError = openState[1];
			React.useEffect(function () { setOpenError(""); }, [result && result.dshSessionId]);
			if (!result) return null;
			var workspaceImport = result.target === "workspace";
			var isContext = result.mode === "context";
			var title = workspaceImport
				? tt("importWorkspaceSuccess", { title: props.workspaceTitle || result.workspaceTitle || tt("untitledWorkspace"), count: result.messageCount })
				: tt(isContext ? "importCurrentSuccess" : "importNewSuccess", { count: result.messageCount });
			return R(
				"div",
				{ className: "dsweb-result", role: "status" },
				R("div", { className: "dsweb-result-heading" }, R(
					"div",
					{ className: "dsweb-result-title" },
					R("span", { className: "dsweb-dot", "data-state": "on" }),
					title
				), props.onDismiss ? R("button", { type: "button", className: "dsweb-icon-button", title: tt("closeImportResult"),
					"aria-label": tt("closeImportResult"), onClick: props.onDismiss }, R(UiIcon, { name: "close", size: 14 })) : null),
				R(AttachmentImportResult, { report: result.attachmentReport, tt: tt }),
				workspaceImport && importHasWarnings(result) ?
					R("button", { type: "button", className: "dsweb-button", onClick: function () { setOpenError(openDshSession(result.dshSessionId)); } }, tt("openImportedSession")) : null,
				props.openError || openError ? R(Notice, { tone: "error", text: tt("importWorkspaceOpenFailed", { message: props.openError || openError }) }) : null
			);
		}

		function AttachmentImportResult(props) {
			var report = props.report, tt = props.tt || t;
			if (!report || !report.found) return null;
			return R("div", { className: "dsweb-attachment-result" },
				R("p", { className: "dsweb-hint" }, tt("attachmentsImported", { count: report.imported, total: report.found })),
				typeof report.workspaceSaved === "number" ? R("p", { className: "dsweb-hint" }, tt("workspaceFilesSaved", { count: report.workspaceSaved, total: report.found }),
					report.workspaceDirectory ? R("br") : null, report.workspaceDirectory || null) : null,
				(report.workspaceFailures || []).map(function (file, index) { return R(Notice, { key: "workspace-" + index, tone: "error",
					text: tt("workspaceFileFailed", { name: file.name, message: file.error }) }); }),
				(report.failures || []).map(function (file, index) { return R(Notice, { key: index, tone: "error",
					text: tt("attachmentsFailed", { name: file.name, message: file.error }) }); }));
		}

		// Sidebar entry icon: the sidebar owner handles activation/click and passes
		// owner props (`size`, `active`); this component only draws the glyph.
		function SidebarPanelIcon(props) {
			var size = typeof props.size === "number" && props.size > 0 ? Math.round(props.size) : 20;
			var active = props.active === true;
			var color = active ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-label-secondary)";
			return R(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 24 24",
					fill: "none",
					focusable: "false",
					"aria-hidden": "true",
					className: "dsweb-sidebar-icon",
					style: { color: color }
				},
				R("path", {
					d: "M4.8 5.2h10.2a2.2 2.2 0 0 1 2.2 2.2v5.4a2.2 2.2 0 0 1-2.2 2.2H9.6l-3.8 2.7v-2.7a2.2 2.2 0 0 1-1-1.9V7.4a2.2 2.2 0 0 1 2-2.2Z",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinejoin: "round"
				}),
				R("path", {
					d: "M16.2 9.9h1.8a2.2 2.2 0 0 1 2.2 2.2v3.1c0 .8-.4 1.5-1 1.9v2.4l-3.4-2.3h-2.6",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinejoin: "round"
				}),
				R("path", {
					d: "M8.6 15.6l3.3-3.3M8.6 12.3h3.3v3.3",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			);
		}

		// ----------------------------------------------------------------- controller
		// One controller instance per mounted surface (settings section or main page):
		// it owns status/token, the paginated conversation list, the selected history,
		// imports, and web continuation, so both surfaces share identical behavior.
		function useClientController(options) {
			options = options || {};
			React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
			var accountVersion = React.useSyncExternalStore(subscribeAccount, accountSnapshot, accountSnapshot);
			var webListVersion = React.useSyncExternalStore(subscribeWebList, webListSnapshot, webListSnapshot);
			var trackedSessionId = React.useSyncExternalStore(
				subscribeSessionTracker,
				sessionTrackerSnapshot,
				sessionTrackerSnapshot
			);

			var statusState = React.useState(function () {
				return { phase: "loading", data: null, error: "" };
			});
			var status = statusState[0];
			var setStatus = statusState[1];

			var draftState = React.useState("");
			var draft = draftState[0];
			var setDraft = draftState[1];

			var tokenUiState = React.useState(function () {
				return { show: false, busy: "", error: "", notice: null };
			});
			var tokenUi = tokenUiState[0];
			var setTokenUi = tokenUiState[1];

			var sessionsState = React.useState(function () {
				return { phase: "idle", items: [], hasMore: false, nextCursor: null, error: "" };
			});
			var sessions = sessionsState[0];
			var setSessions = sessionsState[1];

			var selectedState = React.useState("");
			var selectedId = selectedState[0];
			var setSelectedId = selectedState[1];

			var historyState = React.useState(function () {
				return { phase: "idle", sessionId: "", title: "", messages: [], error: "", markdown: "" };
			});
			var history = historyState[0];
			var setHistory = historyState[1];

			var includeThinkingState = React.useState(true);
			var includeThinking = includeThinkingState[0];
			var setIncludeThinking = includeThinkingState[1];

			var importState = React.useState(function () {
				return { target: "", workspaceId: "", workspaceTitle: "", busy: false, error: "", result: null, openError: "" };
			});
			var importUi = importState[0];
			var setImport = importState[1];

			var contState = React.useState(function () {
				return { prompt: "", thinking: false, search: false, busy: false, error: "", notice: null };
			});
			var cont = contState[0];
			var setCont = contState[1];

			var copyState = React.useState(function () {
				return { ok: null };
			});
			var copyUi = copyState[0];
			var setCopyUi = copyState[1];

			var aliveRef = React.useRef(true);
			var statusSeq = React.useRef(0);
			var sessionsSeq = React.useRef(0);
			var historySeq = React.useRef(0);
			var importSeq = React.useRef(0);
			var continueSeq = React.useRef(0);
			var nextCursorRef = React.useRef(null);
			var autoLoadRef = React.useRef(false);
			var defaultsRef = React.useRef(false);
			var previewRef = React.useRef(null);
			var scrollNextRef = React.useRef(false);

			var statusData = status.data;
			var hasToken = !!(statusData && statusData.hasToken);
			var version = (statusData && statusData.version) || FALLBACK_VERSION;
			var currentSessionId = trackedSessionId || readUiSessionId();
			var selectedItem = null;
			for (var si = 0; si < sessions.items.length; si++) {
				if (sessions.items[si].id === selectedId) {
					selectedItem = sessions.items[si];
					break;
				}
			}
			var previewTitle = (selectedItem && selectedItem.title) || history.title || "";

			// Status: once on mount; again after token changes.
			React.useEffect(function () {
				aliveRef.current = true;
				resetSessionViews();
				loadStatus();
				return function () {
					aliveRef.current = false;
				};
			}, [accountVersion]);

			// Apply the Host-reported thinking/search defaults exactly once.
			React.useEffect(function () {
				if (status.phase !== "ready" || !status.data || defaultsRef.current) return;
				defaultsRef.current = true;
				var thinking = status.data.thinkingDefault === true;
				var search = status.data.searchDefault === true;
				setCont(function (previous) {
					return {
						prompt: previous.prompt,
						thinking: thinking,
						search: search,
						busy: previous.busy,
						error: previous.error,
						notice: previous.notice
					};
				});
			}, [status]);

			// First conversation page: only once per token, and only after status says it exists.
			React.useEffect(function () {
				if (options.loadSessions === false) return;
				if (status.phase !== "ready" || !status.data || !status.data.hasToken) return;
				if (autoLoadRef.current) return;
				if (sessions.phase !== "idle") return;
				autoLoadRef.current = true;
				loadSessions(false);
			}, [status, sessions.phase]);
			React.useEffect(function () {
				if (selectedId && deletedWebIds.has(selectedId)) {
					historySeq.current += 1;
					setSelectedId("");
					setHistory({ phase: "idle", sessionId: "", title: "", messages: [], error: "" });
				}
				if (webListVersion > 0 && options.loadSessions !== false && hasToken) loadSessions(false);
			}, [webListVersion]);

			// Selecting a conversation loads its history once.
			React.useEffect(function () {
				if (!selectedId) return;
				if (history.phase === "ready" && history.sessionId === selectedId) return;
				loadHistory(selectedId);
			}, [selectedId]);

			// After a web continuation, reveal the appended reply.
			React.useEffect(function () {
				var node = previewRef.current;
				if (!node || !scrollNextRef.current) return;
				scrollNextRef.current = false;
				try {
					node.scrollTop = node.scrollHeight;
				} catch (error) {
					/* non-fatal */
				}
			}, [history.messages.length]);

			// Reset the transient copy feedback.
			React.useEffect(function () {
				if (copyUi.ok == null) return undefined;
				var timer = window.setTimeout(function () {
					setCopyUi({ ok: null });
				}, 2500);
				return function () {
					window.clearTimeout(timer);
				};
			}, [copyUi]);

			function loadStatus() {
				var seq = ++statusSeq.current;
				setStatus(function (previous) {
					return { phase: previous.data ? "ready" : "loading", data: previous.data, error: "" };
				});
				request("/status").then(
					function (payload) {
						if (!aliveRef.current || seq !== statusSeq.current) return;
						setStatus({
							phase: "ready",
							error: "",
							data: {
								hasToken: payload.hasToken === true,
								tokenHint: typeof payload.tokenHint === "string" ? payload.tokenHint : "",
								thinkingDefault: payload.thinkingDefault === true,
								searchDefault: payload.searchDefault === true,
								version: typeof payload.version === "string" ? payload.version : "",
								capabilities: payload.capabilities || {},
								baseUrl: typeof payload.baseUrl === "string" ? payload.baseUrl : ""
							}
						});
					},
					function (error) {
						if (!aliveRef.current || seq !== statusSeq.current) return;
						setStatus(function (previous) {
							return { phase: previous.data ? "ready" : "error", data: previous.data, error: errorText(error) };
						});
					}
				);
			}

			function resetSessionViews() {
				sessionsSeq.current += 1;
				historySeq.current += 1;
				importSeq.current += 1;
				continueSeq.current += 1;
				nextCursorRef.current = null;
				autoLoadRef.current = false;
				setSessions({ phase: "idle", items: [], hasMore: false, nextCursor: null, error: "" });
				setSelectedId("");
				setHistory({ phase: "idle", sessionId: "", title: "", messages: [], error: "", markdown: "" });
				setImport({ target: "", workspaceId: "", workspaceTitle: "", busy: false, error: "", result: null, openError: "" });
				setCont(function (previous) {
					return {
						prompt: previous.prompt,
						thinking: previous.thinking,
						search: previous.search,
						busy: false,
						error: "",
						notice: null
					};
				});
			}

			function applyTokenState(payload) {
				var data = status.data || {};
				setStatus({
					phase: "ready",
					error: "",
					data: {
						hasToken: payload.hasToken === true,
						tokenHint: typeof payload.tokenHint === "string" ? payload.tokenHint : "",
						thinkingDefault: data.thinkingDefault === true,
						searchDefault: data.searchDefault === true,
						version: data.version || "",
						capabilities: data.capabilities || {},
						baseUrl: data.baseUrl || ""
					}
				});
				resetSessionViews();
				publishAccountChange();
			}

			function loadSessions(append) {
				var seq = ++sessionsSeq.current;
				var cursor = append ? nextCursorRef.current : null;
				setSessions(function (previous) {
					return {
						phase: append ? "loadingMore" : "loading",
						items: append ? previous.items : [],
						hasMore: append ? previous.hasMore : false,
						nextCursor: append ? previous.nextCursor : null,
						error: ""
					};
				});
				var query = cursor == null ? "" : "?cursor=" + encodeURIComponent(String(cursor));
				request("/sessions" + query).then(
					function (payload) {
						if (!aliveRef.current || seq !== sessionsSeq.current) return;
						var incoming = normalizeSessions(payload.sessions);
						var nextCursor = payload.nextCursor == null ? null : payload.nextCursor;
						nextCursorRef.current = nextCursor;
						setSessions(function (previous) {
							return {
								phase: "ready",
								items: append ? mergeSessions(previous.items, incoming) : mergeSessions([], incoming),
								hasMore: payload.hasMore === true && nextCursor != null,
								nextCursor: nextCursor,
								error: ""
							};
						});
					},
					function (error) {
						if (!aliveRef.current || seq !== sessionsSeq.current) return;
						setSessions(function (previous) {
							return {
								phase: append ? "ready" : "error",
								items: previous.items,
								hasMore: previous.hasMore,
								nextCursor: previous.nextCursor,
								error: errorText(error)
							};
						});
					}
				);
			}

			function loadHistory(sessionId) {
				var seq = ++historySeq.current;
				setHistory({ phase: "loading", sessionId: sessionId, title: "", messages: [], error: "", markdown: "" });
				request("/history?sessionId=" + encodeURIComponent(sessionId)).then(
					function (payload) {
						if (!aliveRef.current || seq !== historySeq.current) return;
						var session = payload.session || {};
						setHistory({
							phase: "ready",
							sessionId: sessionId,
							title: String(session.title || ""),
							messages: normalizeMessages(Array.isArray(payload.activeMessageIds) ? (payload.messages || []).filter(function (item) { return payload.activeMessageIds.includes(String(item.id)); }) : payload.messages),
							error: "",
							markdown: typeof payload.markdown === "string" ? payload.markdown : ""
						});
					},
					function (error) {
						if (!aliveRef.current || seq !== historySeq.current) return;
						setHistory({
							phase: "error",
							sessionId: sessionId,
							title: "",
							messages: [],
							error: errorText(error),
							markdown: ""
						});
					}
				);
			}

			function selectSession(sessionId) {
				if (!sessionId || sessionId === selectedId) return;
				setSelectedId(sessionId);
				setImport({ target: "", workspaceId: "", workspaceTitle: "", busy: false, error: "", result: null, openError: "" });
				setCont(function (previous) {
					return {
						prompt: previous.prompt,
						thinking: previous.thinking,
						search: previous.search,
						busy: previous.busy,
						error: "",
						notice: null
					};
				});
			}

			function saveToken() {
				var value = String(draft || "").trim();
				if (tokenUi.busy) return;
				if (!value) {
					setTokenUi({ show: tokenUi.show, busy: "", error: t("tokenEmpty"), notice: null });
					return;
				}
				if (value.length > MAX_TOKEN_LENGTH) {
					setTokenUi({ show: tokenUi.show, busy: "", error: t("tokenTooLong"), notice: null });
					return;
				}
				setTokenUi({ show: tokenUi.show, busy: "save", error: "", notice: null });
				request("/token", { token: value }).then(
					function (payload) {
						if (!aliveRef.current) return;
						setTokenUi({ show: false, busy: "", error: "", notice: { key: "tokenSaved" } });
						setDraft("");
						applyTokenState(payload);
					},
					function (error) {
						if (!aliveRef.current) return;
						setTokenUi({ show: tokenUi.show, busy: "", error: errorText(error), notice: null });
					}
				);
			}

			function clearToken() {
				if (tokenUi.busy || !hasToken) return;
				setTokenUi({ show: tokenUi.show, busy: "clear", error: "", notice: null });
				request("/token", { token: "" }).then(
					function (payload) {
						if (!aliveRef.current) return;
						setTokenUi({ show: false, busy: "", error: "", notice: { key: "tokenCleared" } });
						setDraft("");
						applyTokenState(payload);
					},
					function (error) {
						if (!aliveRef.current) return;
						setTokenUi({ show: tokenUi.show, busy: "", error: errorText(error), notice: null });
					}
				);
			}

			function runImport(target) {
				if (!selectedId || importUi.busy) return;
				if (target === "current" && !currentSessionId) return;
				var seq = ++importSeq.current;
				setImport({
					target: target,
					workspaceId: "",
					workspaceTitle: "",
					busy: true,
					error: "",
					result: null,
					openError: ""
				});
				var body = { sessionId: selectedId, includeThinking: includeThinking === true, target: target };
				if (target === "current" && currentSessionId) body.dshSessionId = currentSessionId;
				request("/import", body).then(
					function (payload) {
						if (!aliveRef.current || seq !== importSeq.current) return;
						setImport({
							target: target,
							workspaceId: "",
							workspaceTitle: "",
							busy: false,
							error: "",
							result: normalizeImportResult(payload, target, null),
							openError: ""
						});
					},
					function (error) {
						if (!aliveRef.current || seq !== importSeq.current) return;
						setImport({
							target: target,
							workspaceId: "",
							workspaceTitle: "",
							busy: false,
							error: errorText(error),
							result: null,
							openError: ""
						});
					}
				);
			}

			function sendContinue() {
				var prompt = String(cont.prompt || "").trim();
				if (!selectedId || cont.busy) return;
				if (!prompt) {
					setCont(function (previous) {
						return {
							prompt: previous.prompt,
							thinking: previous.thinking,
							search: previous.search,
							busy: false,
							error: t("continueEmpty"),
							notice: null
						};
					});
					return;
				}
				var seq = ++continueSeq.current;
				var thinking = cont.thinking === true;
				var search = cont.search === true;
				setCont(function (previous) {
					return {
						prompt: previous.prompt,
						thinking: previous.thinking,
						search: previous.search,
						busy: true,
						error: "",
						notice: null
					};
				});
				request("/continue", {
					sessionId: selectedId,
					prompt: prompt,
					thinking: thinking,
					search: search
				}).then(
					function (payload) {
						if (!aliveRef.current || seq !== continueSeq.current) return;
						var reply = String(payload.reply || "");
						var replyThinking = String(payload.thinking || "");
						var userMessage = {
							id: "dsweb-local-" + Date.now() + "-user",
							parentId: null,
							role: "user",
							text: prompt,
							thinking: "",
							searchResults: [],
							insertedAt: new Date().toISOString(),
							timeLabel: formatRelative(Date.now())
						};
						var assistantMessage = {
							id: payload.messageId ? String(payload.messageId) : "dsweb-local-" + Date.now() + "-assistant",
							parentId: null,
							role: "assistant",
							text: reply,
							thinking: replyThinking,
							searchResults: [],
							insertedAt: new Date().toISOString(),
							timeLabel: formatRelative(Date.now())
						};
						scrollNextRef.current = true;
						setHistory(function (previous) {
							if (previous.sessionId !== selectedId) return previous;
							return {
								phase: "ready",
								sessionId: previous.sessionId,
								title: previous.title,
								messages: previous.messages.concat([userMessage, assistantMessage]),
								error: "",
								markdown: previous.markdown
							};
						});
						setSessions(function (previous) {
							return {
								phase: previous.phase,
								items: previous.items.map(function (item) {
									return item.id === selectedId ? { id: item.id, title: item.title, pinned: item.pinned, modelType: item.modelType, updatedAt: new Date().toISOString() } : item;
								}),
								hasMore: previous.hasMore,
								nextCursor: previous.nextCursor,
								error: previous.error
							};
						});
						setCont(function (previous) {
							return {
								prompt: "",
								thinking: previous.thinking,
								search: previous.search,
								busy: false,
								error: "",
								notice: { key: "continueSuccess" }
							};
						});
					},
					function (error) {
						if (!aliveRef.current || seq !== continueSeq.current) return;
						setCont(function (previous) {
							return {
								prompt: previous.prompt,
								thinking: previous.thinking,
								search: previous.search,
								busy: false,
								error: errorText(error),
								notice: null
							};
						});
					}
				);
			}

			function copyText(value) {
				var text = String(value || "");
				if (!text) return;
				try {
					if (window.navigator && window.navigator.clipboard && typeof window.navigator.clipboard.writeText === "function") {
						window.navigator.clipboard.writeText(text).then(
							function () {
								if (aliveRef.current) setCopyUi({ ok: true });
							},
							function () {
								if (aliveRef.current) setCopyUi({ ok: false });
							}
						);
						return;
					}
				} catch (error) {
					/* fall through to the failure state */
				}
				setCopyUi({ ok: false });
			}

			// Import one web conversation into a workspace (new DSH session whose cwd is
			// the workspace path). Opens the new session when the workspace service exists.
			function importToWorkspace(webSessionId, workspace) {
				if (!webSessionId || !workspace || !workspace.id || importUi.busy) return;
				var seq = ++importSeq.current;
				var workspaceId = String(workspace.id);
				var workspaceTitle = workspace.title || "";
				setImport({
					target: "workspace",
					workspaceId: workspaceId,
					workspaceTitle: workspaceTitle,
					busy: true,
					error: "",
					result: null,
					openError: ""
				});
				var importBody = { sessionId: webSessionId, target: "new", workspaceId: workspaceId, includeThinking: true };
				// The current DSH session lets the Host derive a workspace fallback too.
				if (currentSessionId) importBody.dshSessionId = currentSessionId;
				request("/import", importBody).then(
					function (payload) {
						if (!aliveRef.current || seq !== importSeq.current) return;
						var result = normalizeImportResult(payload, "workspace", workspace);
						// Publish the success state first, then navigate to the new session.
						setImport({
							target: "workspace",
							workspaceId: workspaceId,
							workspaceTitle: workspaceTitle,
							busy: false,
							error: "",
							result: result,
							openError: ""
						});
						// Do not navigate away before the user can read partial-import warnings.
						if (importHasWarnings(result)) {
							refreshSessionList();
							return;
						}
						var openError = openDshSession(result.dshSessionId);
						if (openError) {
							setImport(function (previous) {
								if (previous.target !== "workspace" || !previous.result) return previous;
								return {
									target: previous.target,
									workspaceId: previous.workspaceId,
									workspaceTitle: previous.workspaceTitle,
									busy: previous.busy,
									error: previous.error,
									result: previous.result,
									openError: openError
								};
							});
						}
					},
					function (error) {
						if (!aliveRef.current || seq !== importSeq.current) return;
						setImport({
							target: "workspace",
							workspaceId: workspaceId,
							workspaceTitle: workspaceTitle,
							busy: false,
							error: errorText(error),
							result: null,
							openError: ""
						});
					}
				);
			}

			return {
				status: status,
				accountVersion: accountVersion,
				statusData: statusData,
				hasToken: hasToken,
				version: version,
				currentSessionId: currentSessionId,
				previewTitle: previewTitle,
				selectedId: selectedId,
				setSelectedId: setSelectedId,
				draft: draft,
				setDraft: setDraft,
				tokenUi: tokenUi,
				setTokenUi: setTokenUi,
				saveToken: saveToken,
				clearToken: clearToken,
				sessions: sessions,
				loadSessions: loadSessions,
				selectSession: selectSession,
				history: history,
				previewRef: previewRef,
				loadHistory: loadHistory,
				includeThinking: includeThinking,
				setIncludeThinking: setIncludeThinking,
				importUi: importUi,
				runImport: runImport,
				importToWorkspace: importToWorkspace,
				dismissImportResult: function () { setImport(function (previous) { return Object.assign({}, previous, { result: null, error: "", openError: "" }); }); },
				cont: cont,
				setCont: setCont,
				sendContinue: sendContinue,
				copyUi: copyUi,
				copyText: copyText,
				loadStatus: loadStatus
			};
		}

		// Settings-section surface: the original full panel, now rendered from the
		// shared controller plus the shared cards above.
		function Panel() {
			var c = useClientController({ loadSessions: false });
			return R("div", { className: "dsweb-panel dsweb-settings" },
				R("header", { className: "dsweb-header" },
					R("h2", { className: "dsweb-title" }, t("sectionTitle"))),
				c.status.error ? R(Notice, { tone: "error", text: c.status.error, onRetry: c.loadStatus }) : null,
				R(TokenCard, { controller: c, tt: t, idPrefix: "dsweb-settings-token" }),
				R("section", { className: "dsweb-card dsweb-settings-row" },
					R("div", { className: "dsweb-field" },
						R("h3", { className: "dsweb-card-title" }, t("settingsWorkflows"))),
					R("button", { type: "button", className: "dsweb-button", onClick: function () {
						selectMainPanel("deepseek-web");
						if (Primitives.closeTopModal) Primitives.closeTopModal(document);
					} }, t("manageConversations"), R(UiIcon, { name: "open", size: 14 }))),
				R("footer", { className: "dsweb-footer" }, t("footerVersion", { version: c.version }))
			);
		}

		// Error boundary: a crash inside this panel must never blank the settings page.
		class SafePanel extends React.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}

			static getDerivedStateFromError(error) {
				return { error: error };
			}

			componentDidCatch(error, info) {
				try {
					console.error("[dsh-deepseek-web] settings panel crashed", error, info);
				} catch (ignored) {
					/* console may be unavailable */
				}
			}

			render() {
				if (this.state.error) {
					return R(
						"div",
						{ className: "dsweb-panel" },
						R(Notice, { tone: "error", text: t("boundaryError") }),
						R("p", { className: "dsweb-hint" }, t("boundaryDetail"))
					);
				}
				return R(Panel, this.props);
			}
		}

		// ---------------------------------------------------------------------- page
		// Main-area page behind the sidebar icon. Left column: web conversations
		// (draggable). Right column: workspace drop targets, import feedback, preview,
		// and the web continuation composer. Requests happen on open or on refresh
		// only; no polling.
		function DeepSeekWebPage() {
			var c = useClientController();
			var queryState = React.useState("");
			var query = queryState[0], setQuery = queryState[1];
			var workspaceState = React.useState({ phase: "loading", items: [], error: "" });
			var workspaces = workspaceState[0], setWorkspaces = workspaceState[1];
			var target = useWorkspaceTarget(workspaces, c.currentSessionId);
			React.useEffect(function () {
				var active = true;
				request("/workspaces").then(function (payload) {
					if (active) setWorkspaces({ phase: "ready", items: normalizeWorkspaces(payload.workspaces), error: "" });
				}, function (error) {
					if (active) setWorkspaces({ phase: "error", items: [], error: errorText(error) });
				});
				return function () { active = false; };
			}, []);
			var selected = c.sessions.items.find(function (item) { return item.id === c.selectedId; });
			var workspace = workspaces.items.find(function (item) { return item.id === target.targetId; });
			var queryText = query.trim().toLocaleLowerCase();
			var filtered = c.sessions.items.filter(function (item) { return !queryText || item.title.toLocaleLowerCase().indexOf(queryText) >= 0; });
			var filteredController = Object.assign({}, c, { sessions: Object.assign({}, c.sessions, { items: filtered }) });
			function openChat() {
				if (!selected) return;
				setWebChatCurrent({ sessionId: selected.id, title: selected.title });
				selectMainPanel("deepseek-web-chat");
			}
			return R("div", { className: "dsweb-library" },
				R("header", { className: "dsweb-library-header" },
					R("div", { className: "dsweb-header" },
						R("h2", { className: "dsweb-title" }, t("sessionsHeading"))),
					R("button", { type: "button", className: "dsweb-button", onClick: newWebConversation }, R(UiIcon, { name: "plus", size: 14 }), t("newWebChat")),
					R("button", { type: "button", className: "dsweb-icon-button", title: t("webChatClose"),
						"aria-label": t("webChatClose"), onClick: function () { selectMainPanel(null); } }, R(UiIcon, { name: "close" }))),
				!c.hasToken ? R("div", { className: "dsweb-library-connect" },
					c.status.phase === "loading" ? R("div", { className: "dsweb-state" }, R(Spinner), t("statusLoading")) :
					R(TokenCard, { controller: c, tt: t, idPrefix: "dsweb-library-token" })) :
				R("div", { className: "dsweb-library-body" },
					R("aside", { className: "dsweb-library-list" },
						R(SearchField, { value: query, onChange: setQuery }),
						queryText && !filtered.length ? R("p", { className: "dsweb-hint" }, t("searchNoResults")) : null,
						R(SessionsCard, { controller: filteredController, tt: t, fill: true })),
					R("section", { className: "dsweb-library-detail" },
						R(PreviewCard, { controller: c, tt: t, fill: true }),
						selected ? R("div", { className: "dsweb-library-actions" },
							R("div", { className: "dsweb-row dsweb-row-wrap" },
								R("label", { className: "dsweb-label", htmlFor: "dsweb-import-workspace" }, t("destination")),
								R("select", { id: "dsweb-import-workspace", className: "dsweb-select", value: target.targetId, disabled: c.importUi.busy,
									onChange: function (event) { target.selectTarget(event.target.value); } },
									workspaces.items.length ? workspaces.items.map(function (item) {
										return R("option", { key: item.id, value: item.id }, item.title || workspacePathTail(item.path));
									}) : R("option", { value: "" }, t("workspacesEmpty")))),
							R(Checkbox, { checked: c.includeThinking, disabled: c.importUi.busy, label: t("includeThinking"), onChange: c.setIncludeThinking }),
							workspaces.error ? R(Notice, { tone: "error", text: workspaces.error }) : null,
							R("div", { className: "dsweb-row dsweb-row-wrap" },
								R("button", { type: "button", className: "dsweb-button", "data-primary": "1", onClick: openChat }, t("openWebChat")),
								R("button", { type: "button", className: "dsweb-button", disabled: c.importUi.busy || !workspace,
									onClick: function () { c.importToWorkspace(selected.id, workspace); } }, c.importUi.busy ? R(Spinner) : null, t("importNew")),
								R("button", { type: "button", className: "dsweb-button", disabled: c.importUi.busy || !c.currentSessionId,
									title: !c.currentSessionId ? t("importCurrentDisabled") : undefined, onClick: function () { c.runImport("current"); } }, t("importCurrent"))),
							c.importUi.error ? R(Notice, { tone: "error", text: c.importUi.error, onDismiss: c.dismissImportResult }) : null,
							c.importUi.result ? R(ImportResult, { result: c.importUi.result, workspaceTitle: c.importUi.workspaceTitle,
								onDismiss: c.dismissImportResult,
								openError: c.importUi.openError, copyUi: c.copyUi, onCopy: c.copyText, tt: t }) : null
						) : null))
			);
		}

		// Error boundary for the main page, mirroring SafePanel.
		class SafePage extends React.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}

			static getDerivedStateFromError(error) {
				return { error: error };
			}

			componentDidCatch(error, info) {
				try {
					console.error("[dsh-deepseek-web] page crashed", error, info);
				} catch (ignored) {
					/* console may be unavailable */
				}
			}

			render() {
				if (this.state.error) {
					return R(
						"div",
						{ className: "dsweb-page" },
						R(Notice, { tone: "error", text: t("boundaryError") }),
						R("p", { className: "dsweb-hint" }, t("boundaryDetail"))
					);
				}
				return R(DeepSeekWebPage, this.props);
			}
		}

		// ------------------------------------------ sidebar footer action + list panel
		// The footer action toggles an in-sidebar conversation list. Both components
		// share the module-level expanded store; the list body only mounts while open,
		// so it requests data on expand/refresh only (no polling).

		function SidebarFooterAction(props) {
			React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
			var expanded = React.useSyncExternalStore(subscribeSidebarList, sidebarListSnapshot, sidebarListSnapshot);
			var wide = props && props.wide === true;
			return R("section", { className: "dsweb-sidebar-group", "aria-label": t("sidebarListLabel") }, R(
				"button",
				{
					type: "button",
					className: "dsweb-footer-action dsweb-group-toggle",
					"data-wide": wide ? "1" : "0",
					"data-active": expanded ? "1" : "0",
					"aria-expanded": expanded ? "true" : "false",
					"aria-controls": wide ? "dsweb-sidebar-conversations" : undefined,
					"aria-label": t("sidebarListToggle"),
					title: t("sidebarListToggle"),
					onClick: function () {
						if (wide) setSidebarListExpanded(!expanded);
						else selectMainPanel("deepseek-web");
					}
				},
				R(SidebarPanelIcon, { size: wide ? 16 : 18, active: expanded }),
				wide ? R("span", { className: "dsweb-footer-action-label" }, t("sidebarListLabel")) : null,
				wide ? R(UiIcon, { name: expanded ? "chevronDown" : "chevronRight", size: 14 }) : null
			), wide && expanded ? R(SafeSidebarListBody) : null, R(DeleteConversationDialog));
		}

		class SafeFooterAction extends React.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}

			static getDerivedStateFromError(error) {
				return { error: error };
			}

			componentDidCatch(error, info) {
				try {
					console.error("[dsh-deepseek-web] sidebar footer action crashed", error, info);
				} catch (ignored) {
					/* console may be unavailable */
				}
			}

			render() {
				if (this.state.error) return null;
				return R(SidebarFooterAction, this.props);
			}
		}

		class SafeSidebarListBody extends React.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}

			static getDerivedStateFromError(error) {
				return { error: error };
			}

			componentDidCatch(error, info) {
				try {
					console.error("[dsh-deepseek-web] sidebar list crashed", error, info);
				} catch (ignored) {
					/* console may be unavailable */
				}
			}

			render() {
				if (this.state.error) {
					return R(
						"div",
						{ className: "dsweb-sidebar-list", role: "dialog", "aria-label": t("sidebarListPanelTitle") },
						R(Notice, { tone: "error", text: t("boundaryError") }),
						R("p", { className: "dsweb-sidebar-list-hint" }, t("boundaryDetail"))
					);
				}
				return R(SidebarListBody, this.props);
			}
		}

		function SidebarListBody() {
			var c = useClientController();
			var currentWebChat = React.useSyncExternalStore(subscribeWebChat, webChatSnapshot, webChatSnapshot);
			var queryState = React.useState("");
			var query = queryState[0], setQuery = queryState[1];
			var searchState = React.useState(false), searchOpen = searchState[0], setSearchOpen = searchState[1];
			var searchToggleRef = React.useRef(null);
			var searchRootRef = React.useRef(null), searchInputRef = React.useRef(null);
			React.useLayoutEffect(function () {
				if (searchOpen && searchInputRef.current) searchInputRef.current.focus({ preventScroll: true });
			}, [searchOpen]);
			React.useEffect(function () {
				if (!searchOpen) return;
				function outside(event) {
					if (searchRootRef.current && searchRootRef.current.contains(event.target)) return;
					if (searchInputRef.current) searchInputRef.current.blur();
					if (!query.trim()) setSearchOpen(false);
				}
				document.addEventListener("click", outside);
				return function () { document.removeEventListener("click", outside); };
			}, [searchOpen, query]);
			var tt = t;

			var importingState = React.useState("");
			var importingRowId = importingState[0];
			var setImportingRowId = importingState[1];

			var hintState = React.useState("");
			var hint = hintState[0];
			var setHint = hintState[1];

			var dragState = React.useState(function () {
				return { active: false, sessionId: "", title: "", x: 0, y: 0 };
			});
			var drag = dragState[0];
			var setDrag = dragState[1];

			var aliveRef = React.useRef(true);
			var pointerRef = React.useRef(null);
			var pointerListenersRef = React.useRef(null);
			var suppressClickRef = React.useRef(false);
			var refreshedSessionRef = React.useRef("");

			React.useEffect(function () {
				aliveRef.current = true;
				return function () {
					aliveRef.current = false;
				};
			}, []);

			// After a workspace import settles, refresh the official DSH session list so
			// the newly created session row appears immediately.
			React.useEffect(function () {
				var result = c.importUi.result;
				if (!result || result.target !== "workspace" || !result.dshSessionId) return;
				if (refreshedSessionRef.current === result.dshSessionId) return;
				refreshedSessionRef.current = result.dshSessionId;
				refreshDshSessionList();
			}, [c.importUi.result]);

			// Clean up any in-flight pointer drag when the panel unmounts or collapses.
			React.useEffect(function () {
				return function () {
					detachPointerListeners();
					restoreTextSelection();
					var state = pointerRef.current;
					pointerRef.current = null;
					if (state) releasePointerCapture(state);
				};
			}, []);

			// Clear the per-row progress marker once the import settles.
			React.useEffect(function () {
				if (!c.importUi.busy) setImportingRowId("");
			}, [c.importUi.busy]);

			function importSession(sessionId, workspaceId) {
				if (!sessionId || !workspaceId) return;
				if (c.importUi.busy) return;
				setHint("");
				setImportingRowId(sessionId);
				c.importToWorkspace(sessionId, { id: workspaceId, title: "" });
			}

			function openTempChat(sessionId, title) {
				if (!sessionId) return;
				setQuery(""); setSearchOpen(false);
				// Same DSH UI, temporary chat: no local session, no /import.
				setWebChatCurrent({ sessionId: sessionId, title: title || "" });
				selectMainPanel("deepseek-web-chat");
			}

			function handleRowClick(sessionId, title) {
				if (suppressClickRef.current) {
					suppressClickRef.current = false;
					return;
				}
				openTempChat(sessionId, title);
			}

			function releasePointerCapture(state) {
				try {
					if (state && state.element && typeof state.element.releasePointerCapture === "function" && state.pointerId != null) {
						state.element.releasePointerCapture(state.pointerId);
					}
				} catch (error) {
					/* the pointer may already be released */
				}
			}

			function disableTextSelection() {
				try {
					document.body.style.userSelect = "none";
				} catch (error) {
					/* ignore */
				}
			}

			function restoreTextSelection() {
				try {
					document.body.style.userSelect = "";
				} catch (error) {
					/* ignore */
				}
			}

			function detachPointerListeners() {
				var handlers = pointerListenersRef.current;
				pointerListenersRef.current = null;
				if (!handlers) return;
				try {
					document.removeEventListener("pointermove", handlers.move, true);
					document.removeEventListener("pointerup", handlers.up, true);
					document.removeEventListener("pointercancel", handlers.cancel, true);
				} catch (error) {
					/* ignore */
				}
			}

			function attachPointerListeners() {
				detachPointerListeners();
				var handlers = {
					move: function (event) {
						onDocumentPointerMove(event);
					},
					up: function (event) {
						onDocumentPointerUp(event);
					},
					cancel: function (event) {
						onDocumentPointerCancel(event);
					}
				};
				pointerListenersRef.current = handlers;
				try {
					document.addEventListener("pointermove", handlers.move, true);
					document.addEventListener("pointerup", handlers.up, true);
					document.addEventListener("pointercancel", handlers.cancel, true);
				} catch (error) {
					pointerListenersRef.current = null;
				}
			}

			function scheduleClickReset() {
				try {
					window.setTimeout(function () {
						suppressClickRef.current = false;
					}, 0);
				} catch (error) {
					/* ignore */
				}
			}

			function beginPointerDrag(sessionId, title, event) {
				if (!event || c.importUi.busy) return;
				if (event.button != null && event.button !== 0) return;
				var element = event.currentTarget || event.target;
				try {
					if (element && typeof element.setPointerCapture === "function" && event.pointerId != null) {
						element.setPointerCapture(event.pointerId);
					}
				} catch (error) {
					/* capture is best-effort */
				}
				pointerRef.current = {
					sessionId: sessionId,
					title: title || "",
					startX: event.clientX,
					startY: event.clientY,
					pointerId: event.pointerId,
					element: element,
					active: false
				};
				setHint("");
				attachPointerListeners();
			}

			function onDocumentPointerMove(event) {
				var state = pointerRef.current;
				if (!state) return;
				var dx = event.clientX - state.startX;
				var dy = event.clientY - state.startY;
				if (!state.active) {
					if (Math.sqrt(dx * dx + dy * dy) <= 5) return;
					state.active = true;
					disableTextSelection();
				}
				try {
					if (event.cancelable) event.preventDefault();
				} catch (error) {
					/* ignore */
				}
				setDrag({ active: true, sessionId: state.sessionId, title: state.title, x: event.clientX, y: event.clientY });
			}

			function finishPointerDrag() {
				var state = pointerRef.current;
				pointerRef.current = null;
				detachPointerListeners();
				restoreTextSelection();
				setDrag({ active: false, sessionId: "", title: "", x: 0, y: 0 });
				if (state) releasePointerCapture(state);
				return state;
			}

			function onDocumentPointerUp(event) {
				var state = pointerRef.current;
				if (!state) return;
				var wasActive = state.active;
				suppressClickRef.current = true;
				scheduleClickReset();
				var workspaceId = wasActive ? sidebarWorkspaceIdAt(event) : "";
				finishPointerDrag();
				if (!wasActive) {
					// The 5px threshold was never crossed: treat it as a click and open
					// the temporary in-DSH conversation view.
					openTempChat(state.sessionId, state.title);
					return;
				}
				if (!workspaceId) {
					setHint(tt("dropCancel"));
					return;
				}
				importSession(state.sessionId, workspaceId);
			}

			function onDocumentPointerCancel() {
				suppressClickRef.current = true;
				scheduleClickReset();
				finishPointerDrag();
			}

			function refresh() {
				c.loadSessions(false);
			}

			function collapse() {
				setSidebarListExpanded(false);
			}

			function renderHead() {
				var sessionsLoading = c.sessions.phase === "loading";
				function closeSearch() {
					setQuery(""); setSearchOpen(false);
					if (searchToggleRef.current) searchToggleRef.current.focus();
				}
				return R(
					"div",
					{ className: "dsweb-sidebar-list-head" },
					R("div", { className: "dsweb-workspace-search-slot", "data-expanded": searchOpen ? "1" : "0" },
						R("div", { className: "dsweb-workspace-search", ref: searchRootRef, "data-expanded": searchOpen ? "1" : "0",
							onClick: function () { setSearchOpen(true); if (searchInputRef.current) searchInputRef.current.focus(); } },
							R("button", { type: "button", className: "dsweb-workspace-search-button", ref: searchToggleRef, title: tt("searchToggle"),
								"aria-label": tt("searchToggle"), "aria-expanded": searchOpen, disabled: !c.hasToken,
								onClick: function () { setSearchOpen(true); } }, R(UiIcon, { name: "search", size: searchOpen ? 11 : 14 })),
							R("input", { type: "text", ref: searchInputRef, className: "dsweb-workspace-search-input", value: query,
								placeholder: tt("searchConversations"), "aria-label": tt("searchConversations"), "aria-hidden": !searchOpen,
								tabIndex: searchOpen ? 0 : -1, maxLength: 200, onChange: function (event) { setQuery(event.target.value.replace(/[\u0000-\u001f\u007f]/g, " ")); },
								onKeyDown: function (event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSearch(); } } }),
							searchOpen ? R("button", { type: "button", className: "dsweb-workspace-search-button dsweb-workspace-search-clear",
								title: tt("closeSearch"), "aria-label": tt("closeSearch"), onClick: function (event) { event.stopPropagation(); closeSearch(); } }, R(UiIcon, { name: "close", size: 14 })) : null)),
					R("div", { className: "dsweb-workspace-header-actions", "data-hidden": searchOpen ? "1" : "0", "aria-hidden": searchOpen },
					R("button", { type: "button", className: "dsweb-sidebar-list-icon", title: tt("newWebChat"), "aria-label": tt("newWebChat"), onClick: newWebConversation }, R(UiIcon, { name: "plus", size: 14 })),
					R(
						"button",
						{
							type: "button",
							className: "dsweb-sidebar-list-icon",
							title: tt("refresh"),
							"aria-label": tt("refresh"),
							disabled: !c.hasToken || sessionsLoading,
							onClick: refresh
						},
						sessionsLoading ? R(Spinner, null) : R(UiIcon, { name: "refresh", size: 14 })
					),
					R(
						"button",
						{
							type: "button",
							className: "dsweb-sidebar-list-icon",
							title: tt("manageConversations"),
							"aria-label": tt("manageConversations"),
							onClick: function () { selectMainPanel("deepseek-web"); }
						},
						R(UiIcon, { name: "open", size: 14 })
					))
				);
			}

			function renderTokenPrompt() {
				var saving = c.tokenUi.busy === "save";
				return R(
					"div",
					{ className: "dsweb-sidebar-list-token" },
					R("p", { className: "dsweb-sidebar-list-hint" }, tt("sidebarListNoToken")),
					R(
						"div",
						{ className: "dsweb-token-row" },
						R("input", {
							className: "dsweb-input",
							type: "password",
							value: c.draft,
							placeholder: tt("tokenPlaceholder"),
							autoComplete: "off",
							spellCheck: false,
							maxLength: MAX_TOKEN_LENGTH,
							disabled: saving,
							onChange: function (event) {
								c.setDraft(event.target.value);
							}
						}),
						R(
							"button",
							{
								type: "button",
								className: "dsweb-button",
								"data-primary": "1",
								disabled: saving || !c.draft.trim(),
								onClick: c.saveToken
							},
							saving ? R(Spinner, null) : null,
							tt("tokenSave")
						)
					),
					c.tokenUi.error ? R(Notice, { tone: "error", text: c.tokenUi.error }) : null
				);
			}

			function renderBody() {
				var sessions = c.sessions;
				var sessionsLoading = sessions.phase === "loading";
				var busy = c.importUi.busy;
				var filteredItems = sessions.items.filter(function (item) { return !query.trim() || item.title.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()) >= 0; });
				return R(
					"div",
					{ className: "dsweb-sidebar-list-content" },
					R(
						"div",
						{ className: "dsweb-sidebar-list-body" },
						sessionsLoading ? R("div", { className: "dsweb-state" }, R(Spinner, null), tt("loading")) : null,
						sessions.error
							? R(Notice, {
									tone: "error",
									text: tt("sessionsError", { message: sessions.error }),
									onRetry: function () {
										c.loadSessions(false);
									},
									retryLabel: tt("retry")
								})
							: null,
						!sessions.error && !sessionsLoading && sessions.items.length === 0
							? R("div", { className: "dsweb-sidebar-list-empty" }, tt("sidebarListEmpty"))
							: null,
						query.trim() && sessions.items.length && !filteredItems.length ? R("div", { className: "dsweb-sidebar-list-empty" }, tt("searchNoResults")) : null,
						filteredItems.map(function (item) {
							return R(SessionRow, {
								key: item.id,
								item: item,
								selected: !!currentWebChat && currentWebChat.sessionId === item.id,
								updatedLabel: formatRelative(item.updatedAt),
								t: tt,
								disabled: busy,
								importing: importingRowId === item.id,
								onSelect: function () {
									handleRowClick(item.id, item.title);
								},
								onPointerDown: function (sessionId, event) {
									beginPointerDrag(sessionId, item.title, event);
								}
							});
						}),
						sessions.items.length && sessions.hasMore
							? R(
									"div",
									{ className: "dsweb-row dsweb-row-center" },
									R(
										"button",
										{
											type: "button",
											className: "dsweb-button",
											disabled: busy || sessionsLoading,
											onClick: function () {
												c.loadSessions(true);
											}
										},
										sessions.phase === "loadingMore" ? R(Spinner, null) : null,
										tt("loadMore")
									)
								)
							: null
					),
					hint ? R(Notice, { tone: "error", text: hint }) : null,
					c.importUi.error ? R(Notice, { tone: "error", text: tt("importFailed", { message: c.importUi.error }), onDismiss: c.dismissImportResult }) : null,
					c.importUi.target === "workspace" && c.importUi.result
						? R(ImportResult, { result: c.importUi.result, workspaceTitle: c.importUi.workspaceTitle, onDismiss: c.dismissImportResult, tt: tt })
						: null
				);
			}

			return R(
				"div",
				{ className: "dsweb-sidebar-list", id: "dsweb-sidebar-conversations", role: "region", "aria-label": tt("sidebarListPanelTitle") },
				renderHead(),
				drag.active ? R("p", { className: "dsweb-sidebar-list-hint" }, tt("sidebarListDragHint")) : null,
				!c.hasToken ? renderTokenPrompt() : renderBody(),
				drag.active
					? R(
							"div",
							{ className: "dsweb-drag-ghost", style: { left: drag.x + 14 + "px", top: drag.y + 14 + "px" } },
							drag.title || tt("untitledSession")
						)
					: null
			);
		}

		// --------------------------------------------- temporary web chat panel
		// Opened only from the sidebar list row click. Shows the web conversation
		// read-only with a composer that continues it on the web; nothing is written
		// to a DSH session or to localStorage.
		function WebChatShell() {
			React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
			var current = React.useSyncExternalStore(subscribeWebChat, webChatSnapshot, webChatSnapshot);
			// Older clients without panelInfo still clear selection when this panel leaves.
			var mounted = React.useRef(false);
			React.useEffect(function () {
				mounted.current = true;
				return function () {
					mounted.current = false;
					var leaving = webChatSnapshot();
					queueMicrotask(function () { if (!mounted.current && webChatSnapshot() === leaving) setWebChatCurrent(null); });
				};
			}, []);
			if (!current) return null;
			return R(WebChatPanel, { key: current.isNew ? "draft:" + current.draftKey : current.sessionId,
				sessionId: current.sessionId, title: current.title, isNew: current.isNew, draftKey: current.draftKey });
		}

		class SafeWebChat extends React.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}

			static getDerivedStateFromError(error) {
				return { error: error };
			}

			componentDidCatch(error, info) {
				try {
					console.error("[dsh-deepseek-web] temporary chat crashed", error, info);
				} catch (ignored) {
					/* console may be unavailable */
				}
			}

			render() {
				if (this.state.error) {
					return R(
						"div",
						{ className: "dsweb-chat" },
						R(Notice, { tone: "error", text: t("boundaryError") }),
						R("p", { className: "dsweb-hint" }, t("boundaryDetail"))
					);
				}
				return R(WebChatShell, this.props);
			}
		}

		function WebChatPanel(props) {
			var c = useClientController({ loadSessions: false });
			var tt = t;
			var sessionId = props.sessionId;
			var initialTitle = props.title || "";

			var titleState = React.useState(initialTitle);
			var title = titleState[0];
			var setTitle = titleState[1];

			var messagesState = React.useState([]);
			var messages = messagesState[0];
			var setMessages = messagesState[1];
			var choicesState = React.useState(function () { return readBranchChoices(sessionId); });
			var branchChoices = choicesState[0], setBranchChoices = choicesState[1];
			var tipState = React.useState(""), currentMessageId = tipState[0], setCurrentMessageId = tipState[1];
			var branchView = React.useMemo(function () { return buildBranchView(messages, branchChoices, currentMessageId); }, [messages, branchChoices, currentMessageId]);
			React.useEffect(function () {
				if (!sessionId) return;
				try { window.sessionStorage.setItem("dsh-deepseek-web.branch." + sessionId, JSON.stringify(branchChoices)); } catch (_) { /* Storage may be disabled. */ }
			}, [branchChoices, sessionId]);

			var phaseState = React.useState("idle");
			var phase = phaseState[0];
			var setPhase = phaseState[1];

			var errorState = React.useState("");
			var error = errorState[0];
			var setError = errorState[1];

			var promptState = React.useState("");
			var prompt = promptState[0];
			var setPrompt = promptState[1];

			var thinkingState = React.useState(false);
			var thinking = thinkingState[0];
			var setThinking = thinkingState[1];

			var searchState = React.useState(false);
			var search = searchState[0];
			var setSearch = searchState[1];

			var sendingState = React.useState(false);
			var sending = sendingState[0];
			var setSending = sendingState[1];

			var sendErrorState = React.useState("");
			var sendError = sendErrorState[0];
			var setSendError = sendErrorState[1];
			var sendKindState = React.useState(false), regenerateError = sendKindState[0], setRegenerateError = sendKindState[1];

			var aliveRef = React.useRef(true);
			var historySeq = React.useRef(0);
			var sendSeq = React.useRef(0);
			var sessionIdRef = React.useRef(sessionId);
			var sendAbortRef = React.useRef(null);
			var recoveryState = React.useState(false);
			var recoveryRequired = recoveryState[0], setRecoveryRequired = recoveryState[1];
			var scrollRef = React.useRef(null);
			var threadRef = React.useRef(null), followRef = React.useRef(true);
			var rootRef = React.useRef(null);
			var inputRef = React.useRef(null);
			var fileInputRef = React.useRef(null);
			var filesState = React.useState([]), files = filesState[0], setFiles = filesState[1];
			var fileErrorState = React.useState(""), fileError = fileErrorState[0], setFileError = fileErrorState[1];
			var filesRef = React.useRef([]), uploadEpoch = React.useRef(0), fileSequence = React.useRef(0);
			var uploadControllers = React.useRef(new Map()), uploadQueue = React.useRef(Promise.resolve());
			function updateFiles(transform) {
				var next = transform(filesRef.current);
				filesRef.current = next;
				setFiles(next);
			}
			function cancelUploads() {
				uploadEpoch.current += 1;
				uploadControllers.current.forEach(function (controller) { controller.abort(); });
				uploadControllers.current.clear();
			}
			React.useEffect(function () {
				cancelUploads();
				updateFiles(function () { return []; });
				setFileError("");
				setPrompt("");
				return cancelUploads;
			}, [sessionId, props.draftKey, c.accountVersion]);
			function queueUploads(items) {
				var epoch = uploadEpoch.current;
				uploadQueue.current = uploadQueue.current.then(async function () {
					for (var item of items) {
						if (!aliveRef.current || epoch !== uploadEpoch.current) return;
						if (!filesRef.current.some(function (file) { return file.key === item.key; })) continue;
						var controller = new AbortController();
						uploadControllers.current.set(item.key, controller);
						try {
							var payload = await request("/upload", item.file, { signal: controller.signal, uploadHeaders: {
								"content-type": "application/octet-stream", "x-file-name": encodeURIComponent(item.name),
								"x-file-type": item.file.type || "application/octet-stream", "x-thinking-enabled": String(thinking)
							} });
							if (!payload.file || !payload.file.id || payload.file.status !== "SUCCESS") throw new Error(t("fileUploading"));
							if (aliveRef.current && epoch === uploadEpoch.current) updateFiles(function (list) {
								return list.map(function (file) { return file.key === item.key ? Object.assign({}, file, { id: String(payload.file.id), status: "ready", error: "" }) : file; });
							});
						} catch (failure) {
							if (aliveRef.current && epoch === uploadEpoch.current && !controller.signal.aborted) updateFiles(function (list) {
								return list.map(function (file) { return file.key === item.key ? Object.assign({}, file, { status: "error", error: errorText(failure) }) : file; });
							});
						} finally { uploadControllers.current.delete(item.key); }
					}
				});
			}
			function addFiles(selected) {
				var picked = Array.from(selected || []), available = 10 - filesRef.current.length;
				var valid = picked.filter(function (file) { return file.size > 0 && file.size <= 20 * 1024 * 1024; }).slice(0, Math.max(0, available));
				setFileError(valid.length !== picked.length ? tt("fileLimit") : "");
				var added = valid.map(function (file) { return { key: "upload-" + (++fileSequence.current), name: file.name,
					size: file.size, file: file, isImage: /^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name), status: "uploading" }; });
				updateFiles(function (list) { return list.concat(added); });
				queueUploads(added);
			}
			function removeFile(key) {
				var controller = uploadControllers.current.get(key);
				if (controller) controller.abort();
				updateFiles(function (list) { return list.filter(function (file) { return file.key !== key; }); });
				setFileError("");
			}
			function retryFile(key) {
				var item = filesRef.current.find(function (file) { return file.key === key; });
				if (!item || item.status !== "error") return;
				updateFiles(function (list) { return list.map(function (file) { return file.key === key ? Object.assign({}, file, { status: "uploading", error: "" }) : file; }); });
				queueUploads([item]);
			}
			React.useLayoutEffect(function () {
				var node = rootRef.current;
				if (!node) return;
				function measure() { node.style.setProperty("--dsh-conversation-column-width", node.clientWidth + "px"); }
				measure();
				if (typeof ResizeObserver === "undefined") return;
				var observer = new ResizeObserver(measure);
				observer.observe(node);
				return function () { observer.disconnect(); };
			}, []);
			React.useLayoutEffect(function () {
				var node = inputRef.current;
				if (!node) return;
				function resize() { node.style.height = "0px"; node.style.height = Math.max(36, node.scrollHeight) + "px"; }
				resize();
				if (typeof ResizeObserver === "undefined") return;
				var width = node.clientWidth;
				var observer = new ResizeObserver(function () {
					if (node.clientWidth !== width) { width = node.clientWidth; resize(); }
				});
				observer.observe(node);
				return function () { observer.disconnect(); };
			}, [prompt, c.hasToken]);

			sessionIdRef.current = sessionId;

			React.useEffect(function () {
				aliveRef.current = true;
				return function () {
					aliveRef.current = false;
					if (sendAbortRef.current) sendAbortRef.current.abort();
				};
			}, []);

			// The web side is the source of truth: reload when the panel opens, when
			// its session changes, or once a token becomes available.
			React.useEffect(function () {
				setTitle(initialTitle);
				loadHistory();
			}, [sessionId, props.draftKey, c.hasToken, c.accountVersion, initialTitle]);

			React.useLayoutEffect(function () {
				var node = scrollRef.current;
				if (node && followRef.current) node.scrollTop = node.scrollHeight;
			}, [messages]);
			React.useEffect(function () {
				if (!threadRef.current || typeof ResizeObserver === "undefined") return;
				var observer = new ResizeObserver(function () {
					var node = scrollRef.current;
					if (node && followRef.current) node.scrollTop = node.scrollHeight;
				});
				observer.observe(threadRef.current);
				return function () { observer.disconnect(); };
			}, [c.hasToken]);

			function loadHistory() {
				followRef.current = true;
				if (sendAbortRef.current) sendAbortRef.current.abort();
				sendAbortRef.current = null;
				historySeq.current += 1;
				sendSeq.current += 1;
				setSending(false);
				setMessages([]);
				setBranchChoices(readBranchChoices(sessionId));
				if (props.isNew && c.hasToken) {
					setPhase("ready");
					setError("");
					setSendError("");
					setRecoveryRequired(false);
					return;
				}
				if (!sessionId) {
					setPhase("idle");
					return;
				}
				if (!c.hasToken) {
					setPhase("idle");
					return;
				}
				var seq = historySeq.current;
				setPhase("loading");
				setError("");
				request("/history?sessionId=" + encodeURIComponent(sessionId)).then(
					function (payload) {
						if (!aliveRef.current || seq !== historySeq.current) return;
						var session = payload.session || {};
						if (session.title) setTitle(String(session.title));
						setCurrentMessageId(session.currentMessageId == null ? "" : String(session.currentMessageId));
						setMessages(normalizeMessages(payload.messages));
						setPhase("ready");
						setSendError("");
						setRecoveryRequired(false);
					},
					function (failure) {
						if (!aliveRef.current || seq !== historySeq.current) return;
						setPhase("error");
						setError(errorText(failure));
					}
				);
			}

			function refresh() {
				if (phase === "loading") return;
				loadHistory();
			}

			function close() {
				setWebChatCurrent(null);
				selectMainPanel(null);
			}

			function selectAnswer(row, index) {
				if (sending || sendAbortRef.current || !row.siblings[index]) return;
				followRef.current = false;
				setBranchChoices(function (previous) { return Object.assign({}, previous, { [row.parentKey]: row.siblings[index].id }); });
			}

			function sendMessage(answer) {
				var regenerating = !!answer && answer.role === "assistant";
				setRegenerateError(regenerating);
				if (regenerating && !(c.statusData?.capabilities?.regenerate)) { setSendError(tt("regenerateHostRestartRequired")); return; }
				var text = String(prompt || "").trim();
				var attachments = filesRef.current;
				if (!branchView.valid || !regenerating && ((!text && !attachments.length) || attachments.some(function (file) { return file.status !== "ready"; })) || sending || sendAbortRef.current || (!sessionId && !props.isNew) || phase !== "ready" || recoveryRequired) return;
				if (regenerating && (!Number.isSafeInteger(Number(answer.id)) || Number(answer.id) <= 0 || answer.banRegenerate)) return;
				var mySend = ++sendSeq.current;
				followRef.current = true;
				var activeSession = sessionId;
				var assistantId = "pending-assistant-" + mySend + "-" + Date.now(), now = new Date().toISOString();
				var pendingUserId = "pending-user-" + mySend + "-" + Date.now();
				var parent = branchView.tail?.role === "assistant" ? branchView.tail.id : null;
				var previousChoices = branchChoices, receivedOutput = false, finalAssistantId = assistantId;
				var liveText = "", liveThinking = "", liveSearch = [], liveProcess = [], liveThinkingMs, flushTimer = null;
				function stillActive() { return aliveRef.current && mySend === sendSeq.current && sessionIdRef.current === activeSession; }
				function flush(terminal) {
					if (flushTimer) window.clearTimeout(flushTimer);
					flushTimer = null;
					if (!stillActive()) return;
					setMessages(function (previous) { return previous.map(function (message) {
						return message.id === assistantId ? Object.assign({}, message, { text: liveText, thinking: liveThinking, searchResults: liveSearch,
							processSteps: liveProcess, thinkingMs: Number.isFinite(liveThinkingMs) ? liveThinkingMs : processDuration(liveProcess) }, terminal || {}) : message;
					}); });
				}
				setMessages(function (previous) { return previous.concat(regenerating ? [
					{ id: assistantId, renderKey: assistantId, parentId: answer.parentId, role: "assistant", text: "", thinking: "", searchResults: [], insertedAt: now, streaming: true }
				] : [
					{ id: pendingUserId, renderKey: pendingUserId, parentId: parent, role: "user", text: text, files: attachments.map(function (file) {
						return { id: file.id, name: file.name, size: file.size, isImage: file.isImage, file: file.file };
					}), thinking: "", searchResults: [], insertedAt: now },
					{ id: assistantId, renderKey: assistantId, parentId: pendingUserId, role: "assistant", text: "", thinking: "", searchResults: [], insertedAt: now, streaming: true }
				]); });
				setBranchChoices(function (previous) { return regenerating ? Object.assign({}, previous, { [answer.parentId]: assistantId }) :
					Object.assign({}, previous, { [parent || "@root"]: pendingUserId, [pendingUserId]: assistantId }); });
				if (!regenerating) { setPrompt(""); updateFiles(function () { return []; }); }
				setSending(true);
				setSendError("");
				var controller = new AbortController();
				sendAbortRef.current = controller;
				request(regenerating ? "/regenerate" : "/continue", {
					sessionId: activeSession,
					...(regenerating ? { childMessageId: answer.id } : { prompt: text,
						parentMessageId: Number.isSafeInteger(Number(parent)) && Number(parent) > 0 ? parent : undefined,
						fileIds: attachments.map(function (file) { return file.id; }) }),
					thinking: thinking === true,
					search: search === true,
					stream: true,
					includeProcess: true
				}, { signal: controller.signal, onDelta: function (delta) {
					if (!stillActive()) return;
					receivedOutput = true;
					if (delta.type === "process-reset") liveProcess = normalizeProcessSteps(delta.steps);
					else if (delta.type === "process-step") {
						var existing = liveProcess.find(function (step) { return step.id === String(delta.step.id); });
						var next = normalizeProcessSteps([Object.assign({}, existing || {}, delta.step)])[0];
						liveProcess = existing ? liveProcess.map(function (step) { return step.id === next.id ? next : step; }) : liveProcess.concat(next);
					} else if (delta.type === "process-text") liveProcess = liveProcess.map(function (step) {
						return step.id === delta.id ? Object.assign({}, step, { text: delta.replace === true ? delta.text : step.text + delta.text }) : step;
					});
					else if (delta.type === "search") liveSearch = normalizeSearchResults(delta.results);
					else if (delta.type === "thinking") liveThinking += delta.text;
					else liveText += delta.text;
					if (!flushTimer) flushTimer = window.setTimeout(function () { flush(); }, 40);
				} }).then(
					function (payload) {
						if (!stillActive()) return;
						liveText = String(payload.reply || ""); liveThinking = String(payload.thinking || "");
						if (Array.isArray(payload.searchResults)) liveSearch = normalizeSearchResults(payload.searchResults);
						if (Array.isArray(payload.processSteps)) liveProcess = normalizeProcessSteps(payload.processSteps);
						if (Number.isFinite(payload.thinkingMs)) liveThinkingMs = payload.thinkingMs;
						var realUserId = !regenerating && payload.requestMessageId ? String(payload.requestMessageId) : pendingUserId;
						finalAssistantId = payload.messageId ? String(payload.messageId) : assistantId;
						flush({ streaming: false, id: finalAssistantId, parentId: regenerating ? answer.parentId : realUserId, messageId: payload.messageId, insertedAt: new Date().toISOString() });
						if (!regenerating && realUserId !== pendingUserId) setMessages(function (previous) { return previous.map(function (message) { return message.id === pendingUserId ? Object.assign({}, message, { id: realUserId }) : message; }); });
						setBranchChoices(function (previous) { return remapBranchId(remapBranchId(previous, pendingUserId, realUserId), assistantId, finalAssistantId); });
						setCurrentMessageId(finalAssistantId);
						setSending(false);
						sendAbortRef.current = null;
						// Some web builds only publish sources after committing the history row.
						if (search && !liveSearch.length && payload.sessionId && payload.messageId != null && !props.isNew) {
							request("/history?sessionId=" + encodeURIComponent(payload.sessionId)).then(function (history) {
								if (!stillActive()) return;
								var reply = (history.messages || []).find(function (item) { return item.role === "assistant" && String(item.id) === String(payload.messageId); });
								if (!reply) return;
								var refs = normalizeSearchResults(reply.searchResults);
								if (refs.length) setMessages(function (previous) { return previous.map(function (item) {
									return item.id === finalAssistantId ? Object.assign({}, item, { searchResults: refs,
										...(reply.processSteps?.length ? { processSteps: normalizeProcessSteps(reply.processSteps), thinkingMs: reply.thinkingMs } : {}) }) : item;
								}); });
							}, function () { /* Metadata failure never replays the send or hides its reply. */ });
						}
						if (props.isNew && payload.sessionId) {
							setWebChatCurrent({ sessionId: String(payload.sessionId), title: text.slice(0, 80) || tt("untitledSession") });
							refreshWebLists();
						}
					},
					function (failure) {
						if (!stillActive()) return;
						flush({ streaming: false, incomplete: true });
						if (regenerating && !receivedOutput) {
							setMessages(function (previous) { return previous.filter(function (message) { return message.id !== assistantId; }); });
							setBranchChoices(previousChoices);
						}
						if (!regenerating) setPrompt(text);
						setSending(false);
						setSendError(controller.signal.aborted ? tt("continueStopped") : errorText(failure));
						setRecoveryRequired(true);
						sendAbortRef.current = null;
					}
				).finally(function () { if (flushTimer) window.clearTimeout(flushTimer); });
			}

			function renderTokenState() {
				return R(
					"div",
					{ className: "dsweb-chat-token" },
					R("p", { className: "dsweb-hint" }, tt("webChatNoToken")),
					R(TokenCard, { controller: c, tt: tt, compact: true, idPrefix: "dsweb-chat-token" })
				);
			}

			function renderConversation() {
				return R(
					"div",
					{ className: "dsweb-chat-main" },
					R(
						"div",
						{ className: "dsweb-chat-messages", ref: scrollRef, onScroll: function (event) {
							var node = event.currentTarget;
							followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
						} },
						R("div", { className: "dsweb-chat-thread", ref: threadRef },
						phase === "loading" ? R("div", { className: "dsweb-state" }, R(Spinner, null), tt("previewLoading")) : null,
						phase === "error"
							? R(Notice, {
									tone: "error",
									text: tt("previewError", { message: error || tt("errorUnknown") }),
									onRetry: loadHistory,
									retryLabel: tt("retry")
								})
							: null,
						phase === "ready" && messages.length === 0 && !props.isNew ? R("div", { className: "dsweb-chat-empty" }, tt("webChatEmpty")) : null,
						branchView.rows.map(function (row, index) {
							var message = row.message;
							return R(MessageItem, {
								key: message.renderKey || message.id || "dsweb-chat-msg-" + index,
								message: message,
								fullText: true,
								t: tt, branch: row, onSelectAnswer: selectAnswer, disabled: sending,
								onRegenerate: message.role === "assistant" && Number.isSafeInteger(Number(message.id)) && Number(message.id) > 0 && message.parentId ? function () { sendMessage(message); } : null,
								regenerateDisabled: !branchView.valid || recoveryRequired || message.banRegenerate || ["WIP", "CONTENT_FILTER", "CONTEXT_LENGTH_EXCEEDED"].includes(message.status)
							});
						}))
					),
					R("div", { className: "dsweb-composer-root" },
						!branchView.valid ? R("div", { className: "dsweb-chat-recovery" }, R(Notice, { tone: "error", text: tt("branchInvalid"), onRetry: loadHistory })) : null,
						c.statusData && c.statusData.version && !(c.statusData.capabilities && c.statusData.capabilities.processSteps) &&
						messages.some(function (message) { return message.thinking && message.searchResults?.length && !message.processSteps?.length; }) ?
							R("div", { className: "dsweb-chat-recovery dsweb-process-compat" }, R(Notice, { text: tt("processHostRestartRequired") })) : null,
						fileError ? R("div", { className: "dsweb-chat-recovery" }, R(Notice, { tone: "error", text: fileError })) : null,
						sendError ? R("div", { className: "dsweb-chat-recovery" }, R(Notice, { tone: "error",
							text: tt(regenerateError ? "regenerateFailed" : "continueFailed", { message: sendError }), onRetry: props.isNew ? function () { refreshWebLists(); selectMainPanel("deepseek-web"); } : loadHistory,
							retryLabel: tt(props.isNew ? "manageConversations" : "refresh") })) : null,
						R("div", { className: "dsweb-chat-composer" },
							R(FileCards, { files: files, disabled: sending, onRemove: removeFile, onRetry: retryFile }),
							R("textarea", {
								ref: inputRef, rows: 1, className: "dsweb-chat-input",
								value: prompt,
								maxLength: MAX_PROMPT_LENGTH,
								placeholder: tt("continuePlaceholder"),
								disabled: sending || phase !== "ready" || recoveryRequired,
								"aria-label": tt("continuePlaceholder"),
								onChange: function (event) {
									setPrompt(event.target.value);
									setSendError("");
								},
								onKeyDown: function (event) {
									if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
									event.preventDefault();
									sendMessage();
								}
							}),
							R("div", { className: "dsweb-composer-row" },
								R("div", { className: "dsweb-composer-tools" },
									R("input", { ref: fileInputRef, type: "file", multiple: true, hidden: true, disabled: sending || phase !== "ready" || recoveryRequired,
										onChange: function (event) { addFiles(event.target.files); event.target.value = ""; } }),
									R("button", { type: "button", className: "dsweb-composer-add", title: tt("uploadFiles"), disabled: sending || phase !== "ready" || recoveryRequired,
										"aria-label": tt("uploadFiles"), onClick: function () {
											var data = c.statusData || {}, version = String(data.version || "").split(/[.-]/).map(Number);
											if (!(data.capabilities && data.capabilities.upload) && !(version[0] > 0 || version[0] === 0 && version[1] >= 4)) {
												setFileError(tt("hostRestartRequired")); return;
											}
											if (fileInputRef.current) fileInputRef.current.click();
										} }, R(UiIcon, { name: "plus", size: 14 })),
									R("button", { type: "button", className: "dsweb-composer-mode", "aria-pressed": thinking, disabled: sending,
										"aria-label": tt("continueThinking"), title: tt("continueThinking"), onClick: function () { setThinking(!thinking); } },
										R(UiIcon, { name: "think", size: 16 }), R("span", { className: "dsweb-mode-label" }, tt("continueThinking"))),
									R("button", { type: "button", className: "dsweb-composer-mode", "aria-pressed": search, disabled: sending,
										"aria-label": tt("continueSearch"), title: tt("continueSearch"), onClick: function () { setSearch(!search); } },
										R(UiIcon, { name: "globe", size: 16 }), R("span", { className: "dsweb-mode-label" }, tt("continueSearch")))),
								R("div", { className: "dsweb-composer-trailing" },
									R("span", { className: "dsweb-model-label" }, "DeepSeek"),
									R("button", { type: "button", className: "dsweb-chat-send", disabled: !sending && ((!prompt.trim() && !files.length) || files.some(function (file) { return file.status !== "ready"; }) || phase !== "ready" || recoveryRequired),
										title: tt(sending ? "continueStop" : "continueSend"), "aria-label": tt(sending ? "continueStop" : "continueSend"),
										onClick: function () { if (sending && sendAbortRef.current) sendAbortRef.current.abort(); else sendMessage(); } },
										sending ? R("svg", { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": true }, R("rect", { x: 3, y: 3, width: 10, height: 10, rx: 3, fill: "currentColor" })) :
										R("svg", { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": true }, R("path", { d: "M8 1 1.3 7.7l1.4 1.4L7 4.8V15h2V4.8l4.3 4.3 1.4-1.4L8 1Z", fill: "currentColor" })))))))
				);
			}

			return R(
				"div",
				{ className: "dsweb-chat", ref: rootRef, role: "region", "aria-label": tt("webChatBadge") },
				R(
					"header",
					{ className: "dsweb-chat-head" },
					R(
						"div",
						{ className: "dsweb-chat-heading" },
						R("h2", { className: "dsweb-chat-title" }, title || tt("untitledSession"))
					),
					R(
						"div",
						{ className: "dsweb-chat-actions" },
						!props.isNew ? R("button", { type: "button", className: "dsweb-icon-button", title: tt("renameWebChat"),
							"aria-label": tt("renameWebChat"), disabled: sending || !c.hasToken,
							onClick: function () { askRename({ id: sessionId, title: title }); } }, R(UiIcon, { name: "edit" })) : null,
						!props.isNew ? R("button", { type: "button", className: "dsweb-icon-button", title: tt("deleteWebChat"),
							"aria-label": tt("deleteWebChat"), disabled: sending || !c.hasToken,
							onClick: function () { askDelete({ id: sessionId, title: title }); } }, R(UiIcon, { name: "trash" })) : null,
						R("button", { type: "button", className: "dsweb-icon-button", title: tt("newWebChat"), "aria-label": tt("newWebChat"), disabled: sending,
							onClick: newWebConversation }, R(UiIcon, { name: "plus", size: 16 })),
						R(
							"button",
							{
								type: "button",
								className: "dsweb-icon-button",
								title: tt("webChatRefresh"),
								"aria-label": tt("webChatRefresh"),
								disabled: !c.hasToken || props.isNew || phase === "loading" || sending,
								onClick: refresh
							},
							phase === "loading" ? R(Spinner, null) : R(UiIcon, { name: "refresh", size: 16 })
						),
						R(
							"button",
							{
								type: "button",
								className: "dsweb-icon-button",
								title: tt("webChatClose"),
								"aria-label": tt("webChatClose"),
								onClick: close
							},
							R(UiIcon, { name: "close" })
						)
					)
				),
				!c.hasToken ? renderTokenState() : renderConversation()
			);
		}

		return {
			branching: { buildView: buildBranchView, normalizeMessages: normalizeMessages },
			inject: ["slots", "locale"],
			apply: function (ctx) {
				var styleElement = null;
				var localeRegistration = null;
				var localeUnsubscribe = null;
				var uiSessionOff = null;
				var panelInfoOff = null;
				clientContext = ctx;

				try {
					localeRegistration = ctx.locale.register(LOCALE_NS, { zh: messages.zh, en: messages.en });
				} catch (error) {
					// Re-registration (e.g. a client hot reload) must not disable localization.
					localeRegistration = null;
				}
				try {
					boundTranslate = ctx.locale.bind(LOCALE_NS);
					var localeValue = ctx.locale.getSnapshot();
					setActiveLocale(localeValue && (localeValue.active || localeValue.locale || localeValue.language || localeValue));
					localeUnsubscribe = ctx.locale.subscribe(function () {
						var next = ctx.locale.getSnapshot();
						setActiveLocale(next && (next.active || next.locale || next.language || next));
					});
				} catch (error) {
					boundTranslate = null;
				}

				try {
					styleElement = document.createElement("style");
					styleElement.setAttribute("data-dsh-deepseek-web", "");
					styleElement.textContent = css;
					document.head.appendChild(styleElement);
				} catch (error) {
					styleElement = null;
				}

				// Follow the actual main-panel selection, not the last clicked web row.
				// Workspace navigation can leave the web store intact while replacing main.
				try {
					var layout = ctx.get("layout");
					var panelInfo = layout && layout.panelInfo;
					if (panelInfo && typeof panelInfo.subscribe === "function" && typeof panelInfo.getSnapshot === "function") {
						var syncPanel = function () {
							var info = panelInfo.getSnapshot();
							if (info && info.activePanelId !== "deepseek-web-chat" && webChatSnapshot()) setWebChatCurrent(null);
						};
						syncPanel();
						panelInfoOff = panelInfo.subscribe(syncPanel);
					}
				} catch (_) { /* Old clients fall back to the panel's mount lifecycle. */ }

				// Secondary current-session source: the ui-session main-view binding.
				try {
					var uiSession = ctx.get("uiSession");
					var source = uiSession && uiSession.adapter && uiSession.adapter.current;
					if (source && typeof source.getSnapshot === "function" && typeof source.subscribe === "function") {
						var syncBinding = function () {
							try {
								var id = readBindingSessionId(source.getSnapshot());
								if (id) publishSessionTracker(id);
							} catch (ignored) {
								/* ignore a stale binding */
							}
						};
						syncBinding();
						uiSessionOff = source.subscribe(syncBinding);
					}
				} catch (error) {
					uiSessionOff = null;
				}

				// Primary current-session source: a headless probe in the session-scoped composer slot.
				try {
					ctx.slots.inject("conversation.input.left", function () {
						return ctx.slots.register(
							{
								name: "conversation.input.left",
								id: "deepseek-web-session-probe",
								order: 900,
								locale: LOCALE_NS,
								label: function () {
									return t("panelTitle");
								}
							},
							SessionProbe
						);
					});
				} catch (error) {
					console.error("[dsh-deepseek-web] session probe:", error);
				}

				try {
					ctx.slots.inject("settings.section", function () {
						return ctx.slots.register(
							{
								name: "settings.section",
								id: "deepseek-web",
								order: 130,
								locale: LOCALE_NS,
								label: function () {
									return t("sectionTitle");
								}
							},
							SafePanel
						);
					});
				} catch (error) {
					console.error("[dsh-deepseek-web] settings section:", error);
				}

				// The official extension below workspaces owns the inline web group.
				try {
					ctx.slots.inject("sidebar.footer.action", function () {
						return ctx.slots.register(
							{
								name: "sidebar.footer.action",
								id: "deepseek-web-list",
								order: 5,
								locale: LOCALE_NS,
								label: function () {
									return t("sidebarListLabel");
								}
							},
							SafeFooterAction
						);
					});
				} catch (error) {
					console.error("[dsh-deepseek-web] sidebar footer action:", error);
				}

				// Browsing/importing lives in a normal keyed main panel.
				ctx.slots.inject("main", function () {
					return ctx.slots.register({ name: "main", key: "deepseek-web" }, SafePage);
				});

				// Temporary web-chat panel: opened only from a sidebar list row click via
				// layout.selectPanel("deepseek-web-chat"); it never creates a DSH session.
				try {
					ctx.slots.inject("main", function () {
						return ctx.slots.register({ name: "main", key: "deepseek-web-chat" }, SafeWebChat);
					});
				} catch (error) {
					console.error("[dsh-deepseek-web] temporary chat panel:", error);
				}

				try {
					ctx.effect(function () {
						return function () {
							if (localeUnsubscribe) localeUnsubscribe();
							if (localeRegistration) localeRegistration();
							if (uiSessionOff) uiSessionOff();
							if (panelInfoOff) panelInfoOff();
							panelInfoOff = null;
							uiSessionOff = null;
							if (styleElement && styleElement.parentNode) styleElement.parentNode.removeChild(styleElement);
							styleElement = null;
						};
					});
				} catch (error) {
					/* teardown is best-effort */
				}
			}
		};
	}
});
