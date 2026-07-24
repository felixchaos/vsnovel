/*---------------------------------------------------------------------------------------------
 *  VS Novel — fact and foreshadow file loading.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reads `.novel/facts/*.json` and `.novel/foreshadow/*.json`.
 *
 * JSON rather than frontmatter because these are records the tool writes as
 * often as the author does — extraction appends facts, the author corrects them
 * — and a format with one unambiguous serialisation keeps those two writers from
 * fighting over whitespace in every diff.
 *
 * Validation reports and skips; it never throws. One malformed entry in a file
 * of four hundred must cost that entry, not the file, and certainly not the
 * check. The alternative fails in the worst possible way: the whole consistency
 * pass goes quiet and looks like a manuscript with no problems in it.
 */

import type { Foreshadow } from '../foreshadow/foreshadow';
import type { Anchor, Fact, StoryTime } from './fact';

export interface LoadProblem {
	/** Index within the file, so the author can find the entry. */
	readonly at: number;
	readonly message: string;
}

export interface LoadResult<T> {
	readonly entries: T[];
	readonly problems: LoadProblem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAnchor(value: unknown): Anchor | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const { file, snippet, snippetHash, line } = value;
	if (typeof file !== 'string' || typeof snippet !== 'string' || typeof snippetHash !== 'string') {
		return undefined;
	}
	return { file, snippet, snippetHash, line: typeof line === 'number' ? line : undefined };
}

function readStoryTime(value: unknown): StoryTime | undefined {
	if (!isRecord(value) || typeof value.day !== 'number') {
		return undefined;
	}
	return { day: value.day, era: typeof value.era === 'string' ? value.era : undefined };
}

/**
 * Parses a facts file.
 *
 * `subject`, `dimension` and `value` are required: a fact missing any of them
 * asserts nothing and would sit in the record looking like coverage that is not
 * there.
 */
export function parseFactsFile(text: string): LoadResult<Fact> {
	const entries: Fact[] = [];
	const problems: LoadProblem[] = [];

	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		return { entries, problems: [{ at: -1, message: `not valid JSON: ${error}` }] };
	}
	if (!Array.isArray(raw)) {
		return { entries, problems: [{ at: -1, message: 'expected an array of facts' }] };
	}

	raw.forEach((item, at) => {
		if (!isRecord(item)) {
			problems.push({ at, message: 'expected an object' });
			return;
		}
		const { id, narrativeOrder, subject, dimension, value } = item;
		if (typeof id !== 'string' || !id) {
			problems.push({ at, message: 'id is required' });
			return;
		}
		if (typeof narrativeOrder !== 'number') {
			problems.push({ at, message: `${id}: narrativeOrder must be a number` });
			return;
		}
		if (typeof subject !== 'string' || typeof dimension !== 'string' || typeof value !== 'string') {
			problems.push({ at, message: `${id}: subject, dimension and value are all required` });
			return;
		}
		entries.push({
			id,
			narrativeOrder,
			subject,
			dimension,
			value,
			storyTime: readStoryTime(item.storyTime),
			anchor: readAnchor(item.anchor),
		});
	});

	return { entries, problems };
}

/**
 * Parses a foreshadowing file.
 *
 * Conditions are carried through unvalidated beyond having a `kind`. A condition
 * this build does not recognise must survive the round trip — it evaluates to
 * false and shows up as an unmet prerequisite, which is the conservative
 * reading — rather than being dropped and silently turning a blocked thread into
 * a firable one.
 */
export function parseForeshadowFile(text: string): LoadResult<Foreshadow> {
	const entries: Foreshadow[] = [];
	const problems: LoadProblem[] = [];

	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		return { entries, problems: [{ at: -1, message: `not valid JSON: ${error}` }] };
	}
	if (!Array.isArray(raw)) {
		return { entries, problems: [{ at: -1, message: 'expected an array of foreshadowing entries' }] };
	}

	raw.forEach((item, at) => {
		if (!isRecord(item)) {
			problems.push({ at, message: 'expected an object' });
			return;
		}
		const { id, title, plantedAt } = item;
		if (typeof id !== 'string' || !id) {
			problems.push({ at, message: 'id is required' });
			return;
		}
		if (typeof plantedAt !== 'number') {
			problems.push({ at, message: `${id}: plantedAt must be a number` });
			return;
		}
		const window = isRecord(item.window)
			? {
				from: typeof item.window.from === 'number' ? item.window.from : undefined,
				to: typeof item.window.to === 'number' ? item.window.to : undefined,
			}
			: undefined;

		entries.push({
			id,
			title: typeof title === 'string' && title ? title : id,
			plantedAt,
			anchor: readAnchor(item.anchor),
			prerequisites: Array.isArray(item.prerequisites)
				? item.prerequisites.filter((c): c is Record<string, unknown> & { kind: string } =>
					isRecord(c) && typeof c.kind === 'string')
				: undefined,
			window,
			paidOffAt: typeof item.paidOffAt === 'number' ? item.paidOffAt : undefined,
		});
	});

	return { entries, problems };
}
