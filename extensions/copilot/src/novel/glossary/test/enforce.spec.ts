/*---------------------------------------------------------------------------------------------
 *  VS Novel — pinned renderings are enforced, not requested.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { Glossary, validateGlossary } from '../glossary';
import { enforceGlossary, findGlossaryViolations } from '../enforce';

const MULELIA: Glossary = {
	terms: [{
		source: 'Mulelia',
		target: '穆蕾莉亚',
		variants: ['穆雷利亚', '穆蕾利亚'],
		note: '蕾 for le, 莉 for li',
	}],
};

describe('enforcement', () => {

	it('replaces a wrong rendering with the pinned one', () => {
		const result = enforceGlossary('穆雷利亚站在城门下。', MULELIA);
		expect(result.text).toBe('穆蕾莉亚站在城门下。');
		expect(result.applied).toHaveLength(1);
		expect(result.applied[0].kind).toBe('variant');
	});

	it('replaces a source term left untranslated', () => {
		const result = enforceGlossary('Mulelia 没有回头。', MULELIA);
		expect(result.text).toBe('穆蕾莉亚 没有回头。');
		expect(result.applied[0].kind).toBe('untranslated');
	});

	it('leaves a correct rendering alone', () => {
		const correct = '穆蕾莉亚站在城门下。';
		expect(enforceGlossary(correct, MULELIA).text).toBe(correct);
		expect(enforceGlossary(correct, MULELIA).applied).toEqual([]);
	});

	it('replaces every occurrence, not only the first', () => {
		const result = enforceGlossary('穆雷利亚看着穆蕾利亚的画像。', MULELIA);
		expect(result.text).toBe('穆蕾莉亚看着穆蕾莉亚的画像。');
		expect(result.applied).toHaveLength(2);
	});

	// The offsets of later replacements survive earlier ones only because the
	// rewrite runs right to left. A left-to-right loop passes the single-hit
	// tests above and corrupts this one.
	it('keeps offsets valid when the replacement changes length', () => {
		const glossary: Glossary = { terms: [{ source: 'Al', target: '阿尔弗雷德', variants: ['阿尔'] }] };
		const result = enforceGlossary('阿尔走了，阿尔回来了，阿尔又走了。', glossary);
		expect(result.text).toBe('阿尔弗雷德走了，阿尔弗雷德回来了，阿尔弗雷德又走了。');
	});
});

describe('what enforcement refuses to touch', () => {

	// The failure that would be worst: a variant that is a substring of the very
	// target it is wrong for. Every correct occurrence contains it.
	it('does not rewrite correct text that contains a variant', () => {
		const glossary: Glossary = {
			terms: [{ source: 'Mulelia', target: '穆蕾莉亚', variants: ['穆蕾'] }],
		};
		const correct = '穆蕾莉亚站在城门下。';
		expect(enforceGlossary(correct, glossary).text).toBe(correct);
	});

	// Two names sharing a prefix. Replacing the shorter inside the longer would
	// produce a name that is neither.
	it('prefers the longer term where two overlap', () => {
		const glossary: Glossary = {
			terms: [
				{ source: 'Mu', target: '穆先生', variants: ['穆'] },
				{ source: 'Mulelia', target: '穆蕾莉亚', variants: ['穆雷利亚'] },
			],
		};
		expect(enforceGlossary('穆雷利亚走了。', glossary).text).toBe('穆蕾莉亚走了。');
	});

	// The lesson from the worldbook keys: a two-letter Latin term as a bare
	// substring appears inside ordinary English words.
	it('requires a word boundary for a Latin term', () => {
		const glossary: Glossary = { terms: [{ source: 'Al', target: '阿尔' }] };
		expect(enforceGlossary('Also, always, and metal.', glossary).applied).toEqual([]);
		expect(enforceGlossary('Al waited.', glossary).text).toBe('阿尔 waited.');
	});

	it('matches a Latin term regardless of case', () => {
		expect(enforceGlossary('mulelia waited.', MULELIA).text).toBe('穆蕾莉亚 waited.');
	});

	// CJK is written without separators, so a boundary rule finds nothing there.
	it('does not require a boundary for a CJK term', () => {
		const glossary: Glossary = { terms: [{ source: '穆雷利亚', target: '穆蕾莉亚' }] };
		expect(enforceGlossary('那时穆雷利亚还年轻。', glossary).text).toBe('那时穆蕾莉亚还年轻。');
	});
});

describe('the manuscript is only reported on', () => {

	// The asymmetry the whole module is built around. An author writing a variant
	// may be doing it on purpose; the model doing it is a defect.
	it('reports without changing anything', () => {
		const draft = '穆雷利亚站在城门下。';
		const violations = findGlossaryViolations(draft, MULELIA);
		expect(violations).toHaveLength(1);
		expect(violations[0].found).toBe('穆雷利亚');
		expect(violations[0].start).toBe(0);
		expect(violations[0].term.note).toBe('蕾 for le, 莉 for li');
	});

	it('reports nothing for a clean draft', () => {
		expect(findGlossaryViolations('穆蕾莉亚站在城门下。', MULELIA)).toEqual([]);
	});
});

describe('glossary validation', () => {

	it('accepts a sound glossary', () => {
		expect(validateGlossary(MULELIA)).toEqual([]);
	});

	it('catches one source pinned two ways', () => {
		const problems = validateGlossary({
			terms: [
				{ source: 'Mulelia', target: '穆蕾莉亚' },
				{ source: 'Mulelia', target: '穆雷利亚' },
			],
		});
		expect(problems[0].message).toMatch(/pinned to both/);
	});

	it('catches a variant that is the target itself', () => {
		const problems = validateGlossary({
			terms: [{ source: 'Mulelia', target: '穆蕾莉亚', variants: ['穆蕾莉亚'] }],
		});
		expect(problems[0].message).toMatch(/lists its own target/);
	});

	// Enforcement already refuses to act on it, so this is about telling the
	// author their entry does nothing rather than about preventing damage.
	it('catches a variant contained in its own target', () => {
		const problems = validateGlossary({
			terms: [{ source: 'Mulelia', target: '穆蕾莉亚', variants: ['穆蕾'] }],
		});
		expect(problems[0].message).toMatch(/can never be found on its own/);
	});

	it('catches a variant that is another term’s pinned rendering', () => {
		const problems = validateGlossary({
			terms: [
				{ source: 'Mu', target: '穆先生' },
				{ source: 'Mulelia', target: '穆蕾莉亚', variants: ['穆先生'] },
			],
		});
		expect(problems.some(p => /pinned rendering of another term/.test(p.message))).toBe(true);
	});

	it('reports a term missing half of itself', () => {
		expect(validateGlossary({ terms: [{ source: 'Mulelia', target: '  ' }] })[0].message)
			.toMatch(/needs both/);
	});
});
