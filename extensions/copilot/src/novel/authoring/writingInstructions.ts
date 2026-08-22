/*---------------------------------------------------------------------------------------------
 *  VS Novel — a way in to the instructions that ride along with every request.
 *--------------------------------------------------------------------------------------------*/

/**
 * The custom-instructions mechanism is inherited whole and needs no work: the
 * extension already reads `.github/copilot-instructions.md` for the workspace,
 * `.copilot/copilot-instructions.md` for the person, `*.instructions.md` by
 * glob, and a settings array besides. What it does not have is a way for the
 * stated audience to find any of that.
 *
 * A novelist who has never opened an editor like this one does not know that
 * `.github` is a directory, that a leading dot hides it, or that the command
 * palette exists. Upstream's own entry point is a gear in the chat title bar
 * labelled "Open Customizations", which opens a generic editor listing five
 * kinds of file they have no reason to distinguish. The feature is therefore
 * present and unused, which is the same as absent.
 *
 * So this contributes one command that does the whole thing: find the file,
 * create it with a scaffold if it is missing, open it. The path stops mattering
 * because nobody has to type it.
 *
 * The scaffold is craft only — voice, person, names, pacing, the author's own
 * forbidden constructions. It is written as headed blanks rather than filled-in
 * advice: an author who deletes prose we invented is worse off than one who
 * fills in six short sections, and every sentence in this file is spent on every
 * request the model ever sees.
 */

import * as vscode from 'vscode';
import { IExtensionContribution } from '../../extension/common/contributions';
import { ILogService } from '../../platform/log/common/logService';
import { Disposable } from '../../util/vs/base/common/lifecycle';

/**
 * Where the workspace-wide instructions live. Spelled here rather than imported
 * from `promptTypes.ts` on purpose — that constant is upstream's, and matching
 * it is a fact this file should assert rather than inherit silently. The test
 * pins the two together, so a rename upstream fails loudly instead of leaving
 * this command writing to a file nothing reads.
 */
export const WORKSPACE_INSTRUCTIONS_PATH = '.github/copilot-instructions.md';

/**
 * The starting file.
 *
 * Chinese literal rather than `l10n.t`, matching the domain labels already in
 * `authoringCommands.ts`: this is document content, not UI chrome, and routing
 * a thirty-line template through a translation key would make the key the
 * document.
 */
export const INSTRUCTIONS_SCAFFOLD = `# 本作品的写作指令

<!-- 这个文件里的每一句话，都会跟着你的每一次请求一起发给模型。
     所以：只写你反复要纠正的那几条。越短越管用，一屏之内最佳。
     保存即生效，不用重启。用不上的段落直接删掉。 -->

## 这是什么书

<!-- 一句话。类型、篇幅、写给谁看。 -->

## 视角与时态

<!-- 例：第三人称限知，全程跟着主角；过去时；不写其他人的内心活动。 -->

## 文风

<!-- 举例比形容管用得多。可以直接贴一段你自己写的、最像你的文字，
     并说明你要它学的是哪一点（句子长短？留白？对白的节奏？）。 -->

## 称呼与专名

<!-- 人名、地名、招式与器物的正式写法。不许自行改译名、起别名或加称号。 -->

## 节奏

<!-- 单章字数；一章推进多少件事；对白与叙述大致的比例。 -->

## 别这么写

<!-- 你的雷区。写得越具体越有效，例如：
     - 不要用「当……时」起句
     - 不要在段尾总结人物情绪
     - 不要写「他知道，一切都将不同」这类预告句 -->
`;

export class WritingInstructionsContrib extends Disposable implements IExtensionContribution {
	readonly id = 'novel.writingInstructions';

	constructor(@ILogService private readonly _logService: ILogService) {
		super();
		this._register(vscode.commands.registerCommand('novel.openWritingInstructions', () => this.open()));
	}

	private async open(): Promise<void> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			// Not an error state to recover from silently: without a folder there
			// is nowhere to put the file, and the author's next move is the same
			// one they need for everything else this product does.
			const openFolder = vscode.l10n.t('Open Folder');
			const choice = await vscode.window.showInformationMessage(
				vscode.l10n.t('Open the folder your book lives in first — the writing instructions are saved inside it.'),
				openFolder
			);
			if (choice === openFolder) {
				await vscode.commands.executeCommand('workbench.action.files.openFolder');
			}
			return;
		}

		const uri = vscode.Uri.joinPath(folder.uri, ...WORKSPACE_INSTRUCTIONS_PATH.split('/'));

		let created = false;
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			try {
				await vscode.workspace.fs.writeFile(uri, Buffer.from(INSTRUCTIONS_SCAFFOLD, 'utf8'));
				created = true;
			} catch (err) {
				this._logService.error(err as Error, 'novel.openWritingInstructions: could not create the instructions file');
				void vscode.window.showErrorMessage(
					vscode.l10n.t('Could not create the writing instructions file: {0}', String(err))
				);
				return;
			}
		}

		const document = await vscode.workspace.openTextDocument(uri);
		const editor = await vscode.window.showTextDocument(document);

		if (created) {
			// Land on the first blank rather than the title. The author's job here
			// is to fill in sections, and a cursor at line 1 invites them to edit
			// the heading instead.
			const firstBlank = this.firstFillableLine(document);
			if (firstBlank !== undefined) {
				const at = new vscode.Position(firstBlank, 0);
				editor.selection = new vscode.Selection(at, at);
				editor.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenter);
			}
		}
	}

	/**
	 * The line after the first comment block that closes under a heading — where
	 * an author's own first sentence belongs.
	 */
	private firstFillableLine(document: vscode.TextDocument): number | undefined {
		let seenHeading = false;
		for (let line = 0; line < document.lineCount; line++) {
			const text = document.lineAt(line).text;
			if (text.startsWith('## ')) {
				seenHeading = true;
				continue;
			}
			if (seenHeading && text.trimEnd().endsWith('-->')) {
				return Math.min(line + 1, document.lineCount - 1);
			}
		}
		return undefined;
	}
}
