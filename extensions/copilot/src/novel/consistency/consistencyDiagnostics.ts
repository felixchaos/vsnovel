/*---------------------------------------------------------------------------------------------
 *  VS Novel — consistency and foreshadowing in the Problems panel.
 *--------------------------------------------------------------------------------------------*/

/**
 * Publishes manuscript-level findings to Problems.
 *
 * Unlike the name check, this is not a per-keystroke diagnostic. Its inputs are
 * the fact and foreshadowing records, which change when a chapter is finished
 * rather than when a word is typed, and its findings are about the book as a
 * whole — "this promise is forty chapters overdue" is not a remark about the
 * sentence under the cursor. So it recomputes when those records change, and
 * publishes against the manuscript files the records point at.
 *
 * Where a finding lands matters as much as whether it is raised:
 *
 *  - A fact with a live anchor is reported **in the chapter**, at the sentence
 *    it was drawn from. That is where the author can act on it.
 *  - A fact whose anchor no longer resolves is reported **in the record**, not
 *    the chapter — the sentence it described is gone, so there is nowhere in the
 *    prose that is honestly "the place". Silently dropping it instead would let
 *    the record drift away from the manuscript with nothing ever saying so.
 *  - Overdue threads are reported at the plant site when it still resolves,
 *    because the promise is what the reader remembers, not the deadline.
 */

import * as vscode from 'vscode';
import { IExtensionContribution } from '../../extension/common/contributions';
import { ILogService } from '../../platform/log/common/logService';
import { Disposable, MutableDisposable } from '../../util/vs/base/common/lifecycle';
import { Anchor, Fact, resolveAnchor } from '../facts/fact';
import { parseFactsFile, parseForeshadowFile } from '../facts/factFile';
import { Foreshadow, overdue } from '../foreshadow/foreshadow';
import { checkFacts, ConsistencyFinding } from './factConsistency';

const FACTS_GLOB = '.novel/facts/*.json';
const FORESHADOW_GLOB = '.novel/foreshadow/*.json';
const RECORD_GLOB = '.novel/{facts,foreshadow}/*.json';

/** Records change when a chapter is finished, not when a word is typed. */
const DEBOUNCE_MS = 1200;

const SOURCE = 'VS Novel';

export class ConsistencyDiagnosticsContrib extends Disposable implements IExtensionContribution {
	readonly id = 'novel.consistencyDiagnostics';

	private readonly _collection = this._register(vscode.languages.createDiagnosticCollection('novel-consistency'));
	private readonly _pending = this._register(new MutableDisposable());

	constructor(@ILogService private readonly _logService: ILogService) {
		super();

		const watcher = this._register(vscode.workspace.createFileSystemWatcher(RECORD_GLOB));
		const schedule = () => this.schedule();
		this._register(watcher.onDidCreate(schedule));
		this._register(watcher.onDidChange(schedule));
		this._register(watcher.onDidDelete(schedule));
		this._register(vscode.workspace.onDidChangeWorkspaceFolders(schedule));
		// A chapter being saved can move or delete an anchored sentence, which
		// changes whether a fact still resolves.
		this._register(vscode.workspace.onDidSaveTextDocument(doc => {
			if (doc.languageId === 'markdown' || doc.languageId === 'plaintext') {
				this.schedule();
			}
		}));

		this.schedule();
	}

	private schedule(): void {
		const timer = setTimeout(() => void this.run(), DEBOUNCE_MS);
		this._pending.value = { dispose: () => clearTimeout(timer) };
	}

	private async run(): Promise<void> {
		try {
			const facts = await this.load(FACTS_GLOB, parseFactsFile);
			const threads = await this.load(FORESHADOW_GLOB, parseForeshadowFile);
			if (facts.entries.length === 0 && threads.entries.length === 0) {
				this._collection.clear();
				return;
			}

			// How far the manuscript has come. Taken from the records rather than
			// from a chapter count so a work in progress is measured by what has
			// actually been written down about it.
			const position = Math.max(
				0,
				...facts.entries.map(f => f.narrativeOrder),
				...threads.entries.map(t => t.paidOffAt ?? t.plantedAt),
			);

			const byFile = new Map<string, vscode.Diagnostic[]>();
			const push = (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
				const key = uri.toString();
				const bucket = byFile.get(key);
				if (bucket) {
					bucket.push(diagnostic);
				} else {
					byFile.set(key, [diagnostic]);
				}
			};

			for (const [uri, problems] of [...facts.problems, ...threads.problems]) {
				for (const problem of problems) {
					push(uri, this.recordDiagnostic(vscode.l10n.t('Entry {0}: {1}', problem.at, problem.message)));
				}
			}

			for (const finding of checkFacts(facts.entries)) {
				await this.publishFinding(finding, facts.sourceOf(finding.fact.id), push);
			}

			for (const late of overdue(threads.entries, { position, facts: facts.entries })) {
				const message = late.blockedBy.length === 0
					? vscode.l10n.t('"{0}" is overdue and nothing is blocking it.', late.entry.title)
					: vscode.l10n.t('"{0}" is overdue, still waiting on {1} condition(s).', late.entry.title, late.blockedBy.length);
				await this.publishAnchored(
					late.entry.anchor,
					threads.sourceOf(late.entry.id),
					message,
					vscode.DiagnosticSeverity.Information,
					push,
				);
			}

			this._collection.clear();
			for (const [key, diagnostics] of byFile) {
				this._collection.set(vscode.Uri.parse(key), diagnostics);
			}
		} catch (error) {
			// A crash here would leave the last set of marks on screen forever,
			// which is worse than no marks: they would describe a manuscript that
			// has since changed.
			this._logService.warn(`[novel-consistency] check failed: ${error}`);
			this._collection.clear();
		}
	}

	private async publishFinding(
		finding: ConsistencyFinding,
		recordUri: vscode.Uri | undefined,
		push: (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => void,
	): Promise<void> {
		const message = describeFinding(finding);
		const severity = finding.kind === 'unknownState'
			? vscode.DiagnosticSeverity.Information
			: vscode.DiagnosticSeverity.Warning;
		await this.publishAnchored(finding.fact.anchor, recordUri, message, severity, push);
	}

	/**
	 * Puts a message where the author can act on it.
	 *
	 * Falls back to the record only when the anchor cannot be resolved — see the
	 * class comment for why that is reported rather than dropped.
	 */
	private async publishAnchored(
		anchor: Anchor | undefined,
		recordUri: vscode.Uri | undefined,
		message: string,
		severity: vscode.DiagnosticSeverity,
		push: (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => void,
	): Promise<void> {
		if (anchor) {
			const target = await this.resolveInWorkspace(anchor);
			if (target) {
				const diagnostic = new vscode.Diagnostic(target.range, message, severity);
				diagnostic.source = SOURCE;
				push(target.uri, diagnostic);
				return;
			}
			if (recordUri) {
				push(recordUri, this.recordDiagnostic(
					vscode.l10n.t('{0} (the anchored text is no longer in {1})', message, anchor.file),
					severity,
				));
				return;
			}
		}
		if (recordUri) {
			push(recordUri, this.recordDiagnostic(message, severity));
		}
	}

	private async resolveInWorkspace(anchor: Anchor): Promise<{ uri: vscode.Uri; range: vscode.Range } | undefined> {
		const [uri] = await vscode.workspace.findFiles(anchor.file, undefined, 1);
		if (!uri) {
			return undefined;
		}
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			const resolved = resolveAnchor(anchor, document.getText());
			if (resolved.status === 'lost' || resolved.offset === undefined) {
				return undefined;
			}
			return {
				uri,
				range: new vscode.Range(
					document.positionAt(resolved.offset),
					document.positionAt(resolved.offset + anchor.snippet.length),
				),
			};
		} catch {
			return undefined;
		}
	}

	private recordDiagnostic(message: string, severity = vscode.DiagnosticSeverity.Warning): vscode.Diagnostic {
		const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), message, severity);
		diagnostic.source = SOURCE;
		return diagnostic;
	}

	/** Loads every record file, remembering which file each entry came from. */
	private async load<T extends { id: string }>(
		glob: string,
		parse: (text: string) => { entries: T[]; problems: { at: number; message: string }[] },
	): Promise<{
		entries: T[];
		problems: [vscode.Uri, { at: number; message: string }[]][];
		sourceOf: (id: string) => vscode.Uri | undefined;
	}> {
		const entries: T[] = [];
		const problems: [vscode.Uri, { at: number; message: string }[]][] = [];
		const source = new Map<string, vscode.Uri>();

		for (const uri of await vscode.workspace.findFiles(glob)) {
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				const result = parse(new TextDecoder().decode(bytes));
				for (const entry of result.entries) {
					entries.push(entry);
					source.set(entry.id, uri);
				}
				if (result.problems.length > 0) {
					problems.push([uri, result.problems]);
				}
			} catch (error) {
				this._logService.warn(`[novel-consistency] could not read ${uri.toString()}: ${error}`);
			}
		}
		return { entries, problems, sourceOf: id => source.get(id) };
	}
}

function describeFinding(finding: ConsistencyFinding): string {
	switch (finding.kind) {
		case 'illegalLifeTransition':
			return vscode.l10n.t('{0} was already dead here ({1}).', finding.subject, finding.detail ?? '');
		case 'deadCharacterActs':
			return vscode.l10n.t('{0} appears here ({1}) at a story time after they died.', finding.subject, finding.detail ?? '');
		case 'contradictionAtSameTime':
			return vscode.l10n.t('{0} has two values at one moment — {1}.', finding.subject, finding.detail ?? '');
		case 'unknownState':
			return vscode.l10n.t('"{0}" is not a state word this check recognises.', finding.detail ?? '');
	}
}

/** Re-exported for the contribution list. */
export type { Fact, Foreshadow };
