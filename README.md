# VS Novel

**English** · [中文](README.zh.md)

A writing environment for novelists, built on Visual Studio Code and a fork of
the GitHub Copilot Chat extension. It is aimed at long-form fiction and
translation across **Chinese, Japanese, and English** — drafting, revising, and
keeping a large manuscript internally consistent — rather than at code.

It is the editor most people already recognise, retargeted at prose: an AI
assistant that writes and edits *in the manuscript*, a keyword-driven story
bible, name- and fact-consistency checking, foreshadow tracking, and retrieval
over the whole book.

> VS Novel is an independent project. It is not affiliated with or
> endorsed by Microsoft or GitHub. See [NOTICE.md](NOTICE.md).

## How it relates to the backend

The editor is open source. The language models and metering run on a separate
hosted service; using the built-in models requires an account with that service.
You can also **bring your own key** (BYOK) and connect the editor directly to a
provider (Anthropic, OpenAI, DeepSeek, xAI, Moonshot/Kimi, …) with no account.

## Building from source

VS Novel builds like Code — OSS. You need the Node version in
[`.nvmrc`](.nvmrc).

```bash
npm install
npm run compile
./scripts/code.sh          # run the editor from source
```

The novel-writing features live in `extensions/copilot/src/novel/`; their tests
run with `cd extensions/copilot && npx vitest run src/novel`.

## Updates

Released builds update themselves. The editor polls an update server
(`update-server/`, a small Cloudflare Worker) that maps this repository's GitHub
Releases to VS Code's update protocol; see that directory and
`scripts/vsnovel-release.sh` for how a release is cut.

## License

MIT — see [LICENSE.txt](LICENSE.txt) and [NOTICE.md](NOTICE.md). This project is
a fork of [Visual Studio Code](https://github.com/microsoft/vscode) and the
[GitHub Copilot Chat extension](https://github.com/microsoft/vscode-copilot-chat),
both © Microsoft Corporation and MIT-licensed.
