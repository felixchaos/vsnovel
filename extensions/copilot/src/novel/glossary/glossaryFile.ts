/*---------------------------------------------------------------------------------------------
 *  VS Novel — reading the glossary off disk.
 *--------------------------------------------------------------------------------------------*/

/**
 * One malformed entry costs that entry, never the file.
 *
 * Same rule as the facts record, for the same reason: a glossary of four hundred
 * terms that refuses to load because one entry has a typo takes every pinned
 * rendering with it, and the failure looks like a translation with nothing wrong
 * in it. Dropping the bad entry and saying which one keeps the other three
 * hundred and ninety-nine working.
 */

import type { LoadProblem, LoadResult } from '../facts/factFile';
import type { Glossary, GlossaryTerm } from './glossary';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strings only, blanks dropped — a blank variant would match every position. */
function readStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const strings = value.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean);
	return strings.length > 0 ? strings : undefined;
}

/**
 * Parses a glossary file.
 *
 * `source` and `target` are both required. An entry with only one of them pins
 * nothing, and leaving it in the glossary would show up in the prompt as a rule
 * with a hole in it.
 */
export function parseGlossaryFile(text: string): LoadResult<GlossaryTerm> {
	const entries: GlossaryTerm[] = [];
	const problems: LoadProblem[] = [];

	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		return { entries, problems: [{ at: -1, message: `not valid JSON: ${err instanceof Error ? err.message : String(err)}` }] };
	}

	// Accept both the bare array and the wrapped object. The wrapper is what the
	// authoring command writes, and the bare array is what someone converting a
	// spreadsheet produces; refusing the second buys nothing.
	const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.terms) ? raw.terms : undefined;
	if (!list) {
		return { entries, problems: [{ at: -1, message: 'expected an array of terms, or an object with a "terms" array' }] };
	}

	list.forEach((item, at) => {
		if (!isRecord(item)) {
			problems.push({ at, message: 'not an object' });
			return;
		}
		const source = typeof item.source === 'string' ? item.source.trim() : '';
		const target = typeof item.target === 'string' ? item.target.trim() : '';
		if (!source || !target) {
			problems.push({ at, message: 'needs both "source" and "target"' });
			return;
		}
		entries.push({
			source,
			target,
			variants: readStringArray(item.variants),
			note: typeof item.note === 'string' && item.note.trim() ? item.note.trim() : undefined,
		});
	});

	return { entries, problems };
}

export function glossaryOf(entries: readonly GlossaryTerm[]): Glossary {
	return { terms: entries };
}
