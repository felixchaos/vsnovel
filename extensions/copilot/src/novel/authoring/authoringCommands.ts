/*---------------------------------------------------------------------------------------------
 *  VS Novel — recording facts and foreshadowing from the editor.
 *--------------------------------------------------------------------------------------------*/

/**
 * The commands that let an author build the records without writing JSON.
 *
 * The whole consistency layer reads `.novel/facts/*.json` and
 * `.novel/foreshadow/*.json`, and those files contain computed fields — a
 * content fingerprint, a derived narrative position, an anchor chosen to survive
 * editing. None of that is writable by hand, and the stated audience is a
 * novelist who has not used an editor like this before. Without these commands
 * the checks are features that exist and are never used.
 *
 * Everything the author is asked for is intent; everything else is derived. The
 * prompts below ask for the payoff plan and the state being asserted, because
 * those are decisions only they can make, and compute the rest silently.
 */

import * as vscode from 'vscode';
import { IExtensionContribution } from '../../extension/common/contributions';
import { ILogService } from '../../platform/log/common/logService';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import type { Fact } from '../facts/fact';
import { parseFactsFile, parseForeshadowFile } from '../facts/factFile';
import type { Foreshadow } from '../foreshadow/foreshadow';
import { chapterNumberOf, CHAPTER_STRIDE, recordFact, recordForeshadow } from './recordFact';

const FACTS_DIR = '.novel/facts';
const FORESHADOW_DIR = '.novel/foreshadow';

/** Dimensions offered by name. Free text is always allowed alongside. */
const DIMENSIONS: readonly { label: string; value: string; detail: string }[] = [
	{ label: '生死', value: 'life', detail: 'alive / injured / missing / dead' },
	{ label: '所在', value: 'location', detail: vscode.l10n.t('Where they are') },
	{ label: '持有', value: 'possession', detail: vscode.l10n.t('Who holds an item') },
	{ label: '关系', value: 'relationship', detail: vscode.l10n.t('How two characters stand') },
];

export class AuthoringCommandsContrib extends Disposable implements IExtensionContribution {
	readonly id = 'novel.authoringCommands';

	constructor(@ILogService private readonly _logService: ILogService) {
		super();
		this._register(vscode.commands.registerCommand('novel.recordFact', () => this.recordFact()));
		this._register(vscode.commands.registerCommand('novel.plantForeshadow', () => this.plantForeshadow()));
		this._register(vscode.commands.registerCommand('novel.payOffForeshadow', () => this.payOffForeshadow()));
	}

	/** The chapter, selection and workspace context every command needs. */
	private context(): { editor: vscode.TextEditor; folder: vscode.Uri; file: string; text: string; start: number; end: number; chapter?: number } | undefined {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.selection.isEmpty) {
			void vscode.window.showInformationMessage(vscode.l10n.t('Select the sentence to record first.'));
			return undefined;
		}
		const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
		if (!folder) {
			void vscode.window.showInformationMessage(vscode.l10n.t('Open the manuscript as a folder to keep records alongside it.'));
			return undefined;
		}
		const text = editor.document.getText();
		const file = vscode.workspace.asRelativePath(editor.document.uri, false);
		return {
			editor,
			folder: folder.uri,
			file,
			text,
			start: editor.document.offsetAt(editor.selection.start),
			end: editor.document.offsetAt(editor.selection.end),
			chapter: chapterNumberOf(file, text),
		};
	}

	private async recordFact(): Promise<void> {
		const context = this.context();
		if (!context) {
			return;
		}

		const subject = await vscode.window.showInputBox({
			title: vscode.l10n.t('Record a fact'),
			prompt: vscode.l10n.t('Who or what is this about? (the character id, e.g. a character file name)'),
			ignoreFocusOut: true,
		});
		if (!subject?.trim()) {
			return;
		}

		const picked = await vscode.window.showQuickPick(
			[...DIMENSIONS.map(d => ({ label: d.label, description: d.value, detail: d.detail })),
			{ label: vscode.l10n.t('Other…'), description: '', detail: vscode.l10n.t('Name your own dimension') }],
			{ title: vscode.l10n.t('Which dimension?'), ignoreFocusOut: true },
		);
		if (!picked) {
			return;
		}
		const dimension = picked.description || (await vscode.window.showInputBox({
			title: vscode.l10n.t('Dimension name'), ignoreFocusOut: true,
		}))?.trim();
		if (!dimension) {
			return;
		}

		const value = await vscode.window.showInputBox({
			title: vscode.l10n.t('What is asserted?'),
			prompt: dimension === 'life'
				? vscode.l10n.t('e.g. 身亡, injured, 行方不明 — written any of the three languages')
				: vscode.l10n.t('The value, e.g. a place or an owner'),
			ignoreFocusOut: true,
		});
		if (!value?.trim()) {
			return;
		}

		// Story time is optional, and saying so matters: it is the axis that keeps
		// flashbacks from being reported as contradictions, but a fact without it
		// is still useful and must not be blocked on.
		const dayInput = await vscode.window.showInputBox({
			title: vscode.l10n.t('Story time (optional)'),
			prompt: vscode.l10n.t('Day number inside the story. Leave blank if unknown — the check simply says less.'),
			ignoreFocusOut: true,
			validateInput: v => (!v.trim() || /^\d+$/.test(v.trim()) ? undefined : vscode.l10n.t('A whole number, or blank')),
		});
		if (dayInput === undefined) {
			return;
		}

		const existing = await this.load(context.folder, FACTS_DIR, parseFactsFile);
		const { fact, anchorIsUnique } = recordFact({
			file: context.file, text: context.text, start: context.start, end: context.end, chapter: context.chapter,
			subject: subject.trim(), dimension, value: value.trim(),
			storyTime: dayInput.trim() ? { day: Number(dayInput.trim()) } : undefined,
			existingIds: new Set(existing.map(f => f.id)),
		});

		await this.append(context.folder, FACTS_DIR, context.chapter, fact);
		await this.reportAnchor(anchorIsUnique, vscode.l10n.t('Fact recorded.'));
	}

	private async plantForeshadow(): Promise<void> {
		const context = this.context();
		if (!context) {
			return;
		}

		const title = await vscode.window.showInputBox({
			title: vscode.l10n.t('Plant a thread'),
			prompt: vscode.l10n.t('What is being promised to the reader?'),
			ignoreFocusOut: true,
		});
		if (title === undefined) {
			return;
		}

		// The deadline is what makes a thread reportable as overdue. Blank means
		// the author has promised no deadline, and nothing will ever call it late.
		const deadline = await vscode.window.showInputBox({
			title: vscode.l10n.t('Pay off by which chapter? (optional)'),
			prompt: vscode.l10n.t('Leave blank and it is never reported as overdue.'),
			ignoreFocusOut: true,
			validateInput: v => (!v.trim() || /^\d+$/.test(v.trim()) ? undefined : vscode.l10n.t('A chapter number, or blank')),
		});
		if (deadline === undefined) {
			return;
		}

		const existing = await this.load(context.folder, FORESHADOW_DIR, parseForeshadowFile);
		const { entry, anchorIsUnique } = recordForeshadow({
			file: context.file, text: context.text, start: context.start, end: context.end, chapter: context.chapter,
			title, existingIds: new Set(existing.map(e => e.id)),
			window: deadline.trim() ? { to: Number(deadline.trim()) * CHAPTER_STRIDE } : undefined,
		});

		await this.append(context.folder, FORESHADOW_DIR, context.chapter, entry);
		await this.reportAnchor(anchorIsUnique, vscode.l10n.t('Thread planted.'));
	}

	/**
	 * Marks a thread paid off.
	 *
	 * Deliberately an explicit act. Detecting a payoff from the prose is the
	 * inference this whole design refuses to make — the author is the only one
	 * who knows whether the scene they just wrote is the one they promised.
	 */
	private async payOffForeshadow(): Promise<void> {
		const context = this.context();
		if (!context) {
			return;
		}
		const open = (await this.load(context.folder, FORESHADOW_DIR, parseForeshadowFile))
			.filter(entry => entry.paidOffAt === undefined);
		if (open.length === 0) {
			void vscode.window.showInformationMessage(vscode.l10n.t('No open threads.'));
			return;
		}

		const picked = await vscode.window.showQuickPick(
			open.map(entry => ({ label: entry.title, description: entry.id, entry })),
			{ title: vscode.l10n.t('Which thread does this pay off?'), ignoreFocusOut: true },
		);
		if (!picked) {
			return;
		}

		const paidOffAt = (context.chapter ?? 0) * CHAPTER_STRIDE;
		await this.rewrite(context.folder, FORESHADOW_DIR, parseForeshadowFile, entries =>
			entries.map(entry => (entry.id === picked.entry.id ? { ...entry, paidOffAt } : entry)));
		void vscode.window.showInformationMessage(vscode.l10n.t('"{0}" marked as paid off.', picked.entry.title));
	}

	private async reportAnchor(unique: boolean, success: string): Promise<void> {
		if (unique) {
			void vscode.window.showInformationMessage(success);
			return;
		}
		// Not an error, but the author has to know: the anchor will not reliably
		// point back at this passage, and a link that lands in the wrong place is
		// worse than no link.
		void vscode.window.showWarningMessage(vscode.l10n.t(
			'{0} The selected wording repeats in this chapter, so the link back to it may be ambiguous — select a longer, more distinctive passage to fix that.',
			success,
		));
	}

	/** Reads every record of one kind across the workspace. */
	private async load<T>(
		folder: vscode.Uri,
		dir: string,
		parse: (text: string) => { entries: T[] },
	): Promise<T[]> {
		const pattern = new vscode.RelativePattern(folder, `${dir}/*.json`);
		const entries: T[] = [];
		for (const uri of await vscode.workspace.findFiles(pattern)) {
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				entries.push(...parse(new TextDecoder().decode(bytes)).entries);
			} catch (error) {
				this._logService.warn(`[novel-authoring] could not read ${uri.toString()}: ${error}`);
			}
		}
		return entries;
	}

	/**
	 * Appends one record to the file for its chapter.
	 *
	 * One file per chapter rather than one big file: it keeps a diff readable,
	 * and it means two chapters edited in parallel never touch the same file.
	 */
	private async append(folder: vscode.Uri, dir: string, chapter: number | undefined, record: Fact | Foreshadow): Promise<void> {
		const uri = vscode.Uri.joinPath(folder, dir, `${chapter === undefined ? 'unplaced' : `ch${String(chapter).padStart(3, '0')}`}.json`);
		let existing: unknown[] = [];
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const parsed = JSON.parse(new TextDecoder().decode(bytes));
			if (Array.isArray(parsed)) {
				existing = parsed;
			}
		} catch {
			// No file yet, which is the ordinary case for a chapter's first record.
		}
		existing.push(record);
		await this.write(uri, existing);
	}

	private async rewrite<T>(
		folder: vscode.Uri,
		dir: string,
		parse: (text: string) => { entries: T[] },
		transform: (entries: T[]) => T[],
	): Promise<void> {
		const pattern = new vscode.RelativePattern(folder, `${dir}/*.json`);
		for (const uri of await vscode.workspace.findFiles(pattern)) {
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				const { entries } = parse(new TextDecoder().decode(bytes));
				await this.write(uri, transform(entries));
			} catch (error) {
				this._logService.warn(`[novel-authoring] could not rewrite ${uri.toString()}: ${error}`);
			}
		}
	}

	private async write(uri: vscode.Uri, value: unknown): Promise<void> {
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
		// Two-space JSON with a trailing newline: these files are read in diffs as
		// often as by the tool, and a one-line blob makes every change look total.
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(`${JSON.stringify(value, undefined, 2)}\n`));
	}
}
