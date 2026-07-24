# 简体中文界面

界面翻译，走 VS Code 自己的 `contributes.localizations` 贡献点。

**为什么是一个语言包而不是改源码。** VSCodium 式的汉化会去改核心里的字符串，代价是 330 个文件、9470 行 patch，以及每次跟进上游都要重新处理一遍冲突 —— 那份 patch 集在 22 个月里修了 240 次。语言包不碰任何上游文件：核心自己按 key 查表，**查不到就回落英文**，所以一份不完整的翻译是可用的，而不是坏的。跟进上游的成本因此是零。

这也决定了维护方式：**不要为了「翻译完整」去补每一个 key**。补那些作者真的会看到的 —— 命令面板里的动作、菜单、通知、设置说明。核心里那些面向扩展开发者的字符串留英文，反而更少误导。

## 翻译文件

`translations/main.i18n.json` —— 核心。结构是 `contents["<bundle 路径>"]["<key>"]`，bundle 路径就是源文件去掉扩展名的路径。找一个 key 的办法：在核心源码里搜 `nls.localize('<key>'`。

`translations/copilot.i18n.json` —— 内置聊天扩展。同一份贡献点，多一条 `{ id: "GitHub.copilot-chat" }`（id 就是 `publisher.name`，见 `extensionsScannerService.ts:835`）。这个文件有**两个 bag、两套 key**：

| bag | key 是什么 | 谁读它 |
|---|---|---|
| `contents.package` | `package.nls.json` 里的符号 key | `extensionsScannerService.ts:851`，缺的回落 `package.nls.json` |
| `contents.bundle` | **英文原文本身**，不是符号 | `extHostLocalizationService.ts:41`，`key = message`（若 `l10n.t` 传了 comment，再接 `/` + comment） |

第二个是会坑人的那个：匹配是整句逐字符比对，差一个句号就静默回落英文，而回落看起来跟「还没译」一模一样。**把文本从 `l10n.t()` 里复制出来，不要手打。**

### 品牌为什么不能全靠语言包

`extensionsScannerService` 只替换 `%key%`。清单里写死的字面量它碰不到，而**命令面板打印 `category: title`**，那六条行内补全命令的 `category` 恰恰是写死的 `"GitHub Copilot"`。所以它们在 `extensions/copilot/package.json` 里被改成了 `%novel.category%` / `%novel.command.*%` 引用（英文侧落在 `package.nls.json` 末尾，中文侧在这里），登记在 guard 白名单与 data seam 里。

清单里另外 78 条带品牌的字面量**故意不动**：它们属于 Copilot CLI、云端 agent、GitHub 仓库检索这些本产品不发布的功能。把它们改成中文品牌文案会更糟 —— 那等于让一个不工作的功能看起来像我们自己的。**那是功能收口的事，不是语言包的事。**

版本对齐 1.129.1。上游改了 key 名，旧条目会静默失效并回落英文 —— 不会报错，所以跟进后值得抽查几个高频界面。

## 现状与续做

核心 337 条 / 95 个 bundle，扩展 23 条，全部经 `scripts/novel-i18n-check.js` 核对在源码里确实声明。

### 「328 处品牌文案」这个数字是错的

实测下来，源码里带 Copilot / GitHub 字样的用户可见字符串是 **124 条 `package.nls.json` + 77 条 `l10n.t()`**，而其中 **77 条里只有 36 条真的进了 `dist/extension.js`** —— 另外 41 条在 `src/extension/chatSessions/`，那棵子树已被排除出构建，字符串哪儿都不渲染。**译它们会让覆盖率好看，同时什么都没修。** 所以 `novel-i18n-check.js` 对 `contents.bundle` 的每一条都要求它在 `dist/extension.js` 里出现得到，源码里有、产物里没有一样报错。

命令面板那一层更具体：144 条命令里带品牌字样的 52 条，其中 **34 条已被 `when: false` 挡在面板外，真正会出现在作者眼前的是 18 条**。这 18 条里 6 条是行内补全（我们的功能，已改名），12 条属于 Copilot CLI / NES 采集 / 云端 agent（不是我们的功能，该收口而不是改名）。

已覆盖作者会碰到的主要几层：资源管理器、文件与保存、编辑器拆分与快速切换、查找替换、搜索、通知、设置、活动栏、命令面板、状态栏、最近打开、输出面板、对话框、主题、自动换行、剪贴板、面板与侧边栏、本地历史、链接、编辑器标签、行操作、多光标、更新、日志、帮助、扩展安装、折叠、行内建议、缩略图、空编辑器水印、空状态提示、操作面板、快捷键编辑器、命令面板分组、账户菜单、视图导航、差异对比、次侧边栏、退出确认、路径导航、快速跳转、大纲、时间线、粘性滚动、选区操作。

**续做的方法**（不要凭记忆写 key，这是本文件唯一的硬纪律）：

```bash
# 从一个界面文件里抽出真实的 key 与英文原文
python3 - <<'PY'
import re
pat = re.compile(r"""localize2?\(\s*(?:\{[^}]*key:\s*)?['"]([\w.\-]+)['"]\s*,\s*["']([^"'\\]{1,45})["']""")
src = 'src/vs/workbench/contrib/<某个界面>.ts'
for k, v in pat.findall(open(src, encoding='utf8').read()):
    print(f'{k} :: {v}')
PY

# 填进 translations/main.i18n.json 之后，必须跑
node scripts/novel-i18n-check.js
```

**翻译时的判断**，比覆盖率重要：

- 状态词说人话。`dirty` 是「有未保存的改动」，不是「脏」—— 那是作者最怕看到的状态，术语化等于把警告藏起来。
- 破坏性操作说清「谁覆盖谁」。冲突解决的两个按钮译成「保留你的改动，覆盖文件内容」/「放弃你的改动，还原为文件内容」，而不是直译。对着可能丢稿的按钮，清楚比漂亮重要。
- 面向扩展开发者的字符串**留英文**。翻译它们不会帮到作者，只会让「翻译过的」和「没翻译的」界限更模糊。
