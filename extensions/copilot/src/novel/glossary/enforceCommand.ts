/*---------------------------------------------------------------------------------------------
 *  VS Novel — applying the glossary to a chapter, on purpose.
 *--------------------------------------------------------------------------------------------*/

/**
 * The formatter, not a hidden rewrite.
 *
 * The pattern this comes from — pin a constant in the prompt and overwrite the
 * field after the model answers — was built for structured extraction, where the
 * model's output is data nobody reads before it is stored. Prose is not that:
 * every edit an agent makes arrives as a diff the author accepts or rejects, and
 * a wrong rendering is already reported by the diagnostic and findable by
 * `novel_check`. Rewriting silently on top of all that would be the one step
 * nobody asked for.
 *
 * What the translation case really needs is different, and simpler: a chapter
 * translated in one pass can carry the same name forty times, and asking the
 * author — or the agent — to fix forty occurrences one diagnostic at a time is
 * the wrong shape of work. So this is a command, the way Format Document is a
 * command: unconditional when you run it, never run on its own, and one entry in
 * the undo history.
 */

import * as vscode from 'vscode';
import { IExtensionContribution } from '../../extension/common/contributions';
import { ILogService } from '../../platform/log/common/logService';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { enforceGlossary } from './enforce';
import { validateGlossary } from './glossary';
import { glossaryOf, parseGlossaryFile } from './glossaryFile';

const GLOSSARY_GLOB = '.novel/glossary/*.json';
const CHAPTER_LANGUAGES = new Set(['markdown', 'plaintext']);

export const ENFORCE_GLOSSARY_COMMAND = 'novel.enforceGlossary';

export class GlossaryCommandsContrib extends Disposable implements IExtensionContribution {
	readonly id = 'novel.glossaryCommands';

	constructor(@ILogService private readonly _logService: ILogService) {
		super();
		this._register(vscode.commands.registerCommand(ENFORCE_GLOSSARY_COMMAND, () => this.enforce()));
	}

	private async enforce(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !CHAPTER_LANGUAGES.has(editor.document.languageId)) {
			void vscode.window.showInformationMessage(
				vscode.l10n.t('Open a chapter to apply the glossary to it.'));
			return;
		}

		const { glossary, problems } = await this.loadGlossary();
		for (const problem of problems) {
			this._logService.warn(`[novel.glossary] ${problem}`);
		}
		if (glossary.terms.length === 0) {
			void vscode.window.showInformationMessage(
				vscode.l10n.t('No pinned renderings found. Add one under .novel/glossary/.'));
			return;
		}

		const original = editor.document.getText();
		const { text, applied } = enforceGlossary(original, glossary);
		if (applied.length === 0) {
			void vscode.window.showInformationMessage(
				vscode.l10n.t('Every pinned rendering already matches.'));
			return;
		}

		// One replacement of the whole document rather than one edit per
		// occurrence: forty separate undo steps is not what the author asked for
		// when they ran this once.
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			editor.document.uri,
			new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(original.length)),
			text,
		);
		if (!await vscode.workspace.applyEdit(edit)) {
			void vscode.window.showWarningMessage(vscode.l10n.t('The chapter could not be edited.'));
			return;
		}

		// Named, not counted. "3 replacements" does not tell the author whether
		// the tool understood their book; "穆雷利亚 → 穆蕾莉亚" does.
		const summary = [...new Set(applied.map(a => `${a.found} → ${a.term.target}`))];
		void vscode.window.showInformationMessage(
			vscode.l10n.t('Applied {0} pinned rendering(s): {1}', applied.length, summary.join('，')));
	}

	private async loadGlossary() {
		const files = await vscode.workspace.findFiles(GLOSSARY_GLOB);
		const terms = [];
		const problems: string[] = [];
		for (const file of files) {
			const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
			const parsed = parseGlossaryFile(text);
			terms.push(...parsed.entries);
			problems.push(...parsed.problems.map(p => `${file.path} entry ${p.at}: ${p.message}`));
		}
		const glossary = glossaryOf(terms);
		problems.push(...validateGlossary(glossary).map(p => `${p.term}: ${p.message}`));
		return { glossary, problems };
	}
}
