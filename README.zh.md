# VS Novel

[English](README.md) · **中文**

一个为小说作者打造的写作环境，基于 Visual Studio Code、并 fork 了 GitHub Copilot
Chat 扩展。它面向长篇小说与翻译——中文、日文、英文之间的起草、修订，以及维持一部
大部头稿件的内部一致性——而不是写代码。

它就是大多数人早已熟悉的那个编辑器，只是把准星重新对准了散文：一个直接在稿件里
写作和改稿的 AI 助手、一套关键词驱动的设定集、人名与事实一致性检查、伏笔追踪，
以及对全书的检索。

> VS Novel 是独立项目，与 Microsoft 或 GitHub 无隶属关系、未获其背书。
> 见 [NOTICE.zh.md](NOTICE.zh.md)。

## 它与后端的关系

编辑器是开源的。语言模型与计量运行在一个独立的托管服务上；使用内置模型需要该服务
的账户。你也可以自带 key（BYOK），让编辑器直连某个厂商（Anthropic、OpenAI、
DeepSeek、xAI、Moonshot/Kimi……），无需账户。

## 从源码构建

构建方式与 Code — OSS 相同，需要 [`.nvmrc`](.nvmrc) 里指定的 Node 版本。

```bash
npm install
npm run compile
./scripts/code.sh          # 从源码运行编辑器
```

小说写作相关功能在 `extensions/copilot/src/novel/`；其测试用
`cd extensions/copilot && npx vitest run src/novel` 运行。

## 更新

发布的构建会自我更新。编辑器轮询一个更新服务器（`update-server/`，一个小型
Cloudflare Worker），它把本仓库的 GitHub Releases 映射成 VS Code 的更新协议；
如何发版见该目录与 `scripts/vsnovel-release.sh`。

## 许可

MIT——见 [LICENSE.txt](LICENSE.txt) 与 [NOTICE.zh.md](NOTICE.zh.md)。本项目是
[Visual Studio Code](https://github.com/microsoft/vscode) 与
[GitHub Copilot Chat 扩展](https://github.com/microsoft/vscode-copilot-chat)
的 fork，二者均 © Microsoft Corporation、以 MIT 授权。
