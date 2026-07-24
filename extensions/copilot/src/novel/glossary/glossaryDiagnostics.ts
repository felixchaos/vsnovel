/*---------------------------------------------------------------------------------------------
 *  VS Novel — pinned renderings, reported in the manuscript.
 *--------------------------------------------------------------------------------------------*/

/**
 * The reporting half of the glossary.
 *
 * Enforcement rewrites what the model produced; this only ever tells the author
 * what it found in what *they* wrote, with a quick fix they choose to apply. The
 * distinction is the point — a translator who writes a name differently in one
 * scene may be doing it on purpose, and a tool that quietly normalises it has
 * destroyed the only evidence that they meant it.
 *
 * Warnings rather than errors: a manuscript is not broken by a name spelled two
 * ways, it is inconsistent, and the Problems panel already distinguishes those.
 */

import * as vscode from 'vscode';
import { IExtensionContribution } from '../../extension/common/contributions';
import { ILogService } from '../../platform/log/common/logService';
import { Disposable, MutableDisposable } from '../../util/vs/base/common/lifecycle';
import { findGlossaryViolations, GlossaryViolation } from './enforce';
import { validateGlossary } from './glossary';
import { glossaryOf, parseGlossaryFile } from './glossaryFile';

const GLOSSARY_GLOB = '.novel/glossary/*.json';
const CHAPTER_LANGUAGES = new Set(['markdown', 'plaintext']);
const DEBOUNCE_MS = 1200;

export const GLOSSARY_FIX_COMMAND = 'novel.applyPinnedRendering';

export class GlossaryDiagnosticsContrib extends Disposable implements IExtensionContribution {
	readonly id = 'novel.glossaryDiagnostics';

	private readonly _collection = this._register(vscode.languages.createDiagnosticCollection('novel-glossary'));
	private readonly _pending = this._register(new MutableDisposable());

	constructor(@ILogService private readonly _logService: ILogService) {
		super();

		const watcher = this._register(vscode.workspace.createFileSystemWatcher(GLOSSARY_GLOB));
		const schedule = () => this.schedule();
		this._register(watcher.onDidCreate(schedule));
		this._register(watcher.onDidChange(schedule));
		this._register(watcher.onDidDelete(schedule));
		this._register(vscode.workspace.onDidChangeWorkspaceFolders(schedule));
		this._register(vscode.workspace.onDidSaveTextDocument(doc => {
			if (CHAPTER_LANGUAGES.has(doc.languageId)) {
				this.schedule();
			}
		}));
		// A closed document keeps its diagnostics forever otherwise, and they go
		// stale the moment the file changes on disk.
		this._register(vscode.workspace.onDidCloseTextDocument(doc => this._collection.delete(doc.uri)));

		this._register(vscode.languages.registerCodeActionsProvider(
			[{ language: 'markdown' }, { language: 'plaintext' }],
			new PinnedRenderingFix(),
			{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
		));

		this.schedule();
	}

	private schedule(): void {
		const timer = setTimeout(() => void this.run(), DEBOUNCE_MS);
		this._pending.value = { dispose: () => clearTimeout(timer) };
	}

	private async run(): Promise<void> {
		try {
			const { glossary, problems } = await this.loadGlossary();
			this._collection.clear();

			for (const problem of problems) {
				this._logService.warn(`[novel.glossary] ${problem}`);
			}
			if (glossary.terms.length === 0) {
				return;
			}

			// Only open documents. Scanning every chapter on disk would read the
			// whole book on each keystroke-triggered save, and a violation the
			// author cannot see is a violation they cannot act on.
			for (const document of vscode.workspace.textDocuments) {
				if (!CHAPTER_LANGUAGES.has(document.languageId)) {
					continue;
				}
				const violations = findGlossaryViolations(document.getText(), glossary);
				if (violations.length > 0) {
					this._collection.set(document.uri, violations.map(v => toDiagnostic(document, v)));
				}
			}
		} catch (err) {
			// A glossary that cannot be read must not take the extension with it.
			this._logService.error(err instanceof Error ? err : new Error(String(err)), '[novel.glossary] failed to run');
		}
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

function toDiagnostic(document: vscode.TextDocument, violation: GlossaryViolation): vscode.Diagnostic {
	const range = new vscode.Range(document.positionAt(violation.start), document.positionAt(violation.end));
	const message = violation.kind === 'untranslated'
		? vscode.l10n.t('"{0}" is pinned to "{1}" and has been left untranslated.', violation.term.source, violation.term.target)
		: vscode.l10n.t('"{0}" is pinned to "{1}".', violation.term.source, violation.term.target);

	const diagnostic = new vscode.Diagnostic(
		range,
		violation.term.note ? `${message} (${violation.term.note})` : message,
		vscode.DiagnosticSeverity.Warning,
	);
	diagnostic.source = 'novel';
	diagnostic.code = { value: 'glossary', target: vscode.Uri.parse('https://novel-builder.invalid/glossary') };
	// Carried on the diagnostic so the quick fix does not have to reload the
	// glossary or re-run detection to know what to write.
	(diagnostic as vscode.Diagnostic & { novelTarget?: string }).novelTarget = violation.term.target;
	return diagnostic;
}

/** Replaces the span with the pinned rendering. One edit, no reformatting. */
class PinnedRenderingFix implements vscode.CodeActionProvider {
	provideCodeActions(document: vscode.TextDocument, _range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		for (const diagnostic of context.diagnostics) {
			const target = (diagnostic as vscode.Diagnostic & { novelTarget?: string }).novelTarget;
			if (!target || diagnostic.source !== 'novel') {
				continue;
			}
			const action = new vscode.CodeAction(
				vscode.l10n.t('Use the pinned rendering "{0}"', target),
				vscode.CodeActionKind.QuickFix,
			);
			action.diagnostics = [diagnostic];
			action.edit = new vscode.WorkspaceEdit();
			action.edit.replace(document.uri, diagnostic.range, target);
			actions.push(action);
		}
		return actions;
	}
}
