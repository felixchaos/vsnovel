/*---------------------------------------------------------------------------------------------
 *  VS Novel — tests for locating the grok binary.
 *--------------------------------------------------------------------------------------------*/

import { chmodSync, mkdirSync, writeFileSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { findGrokBinary } from '../agentProcess';

const root = mkdtempSync(join(tmpdir(), 'novel-grok-'));

function makeExecutable(dir: string, name = process.platform === 'win32' ? 'grok.exe' : 'grok'): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, '#!/bin/sh\nexit 0\n');
	chmodSync(path, 0o755);
	return path;
}

afterAll(() => {
	// Left in the OS temp dir on purpose; removing it races the sandbox on CI
	// and the files are a few bytes.
});

describe('finding the binary', () => {
	it('takes PATH first', () => {
		const dir = join(root, 'onpath');
		const expected = makeExecutable(dir);
		const found = findGrokBinary(undefined, { PATH: dir, HOME: root });
		expect(found).toEqual({ found: true, path: expected, source: 'path' });
	});

	it('falls back to where installers put it when PATH does not have it', () => {
		// The case with no visible cause: an editor launched from Finder gets a
		// minimal PATH, so `grok` works in the author's terminal and not here.
		const home = join(root, 'home-wellknown');
		const expected = makeExecutable(join(home, '.grok', 'bin'));
		const found = findGrokBinary(undefined, { PATH: '/nowhere', HOME: home });
		expect(found).toEqual({ found: true, path: expected, source: 'well-known' });
	});

	it('lets an explicit setting win over both', () => {
		const configured = makeExecutable(join(root, 'custom'), 'grok-custom');
		const onPath = join(root, 'onpath2');
		makeExecutable(onPath);
		const found = findGrokBinary(configured, { PATH: onPath, HOME: root });
		expect(found).toEqual({ found: true, path: configured, source: 'setting' });
	});

	it('reports a broken setting instead of quietly using another binary', () => {
		// Falling back here would hide a typo forever: the author believes the
		// editor is running the build they pointed at, and it is not.
		const onPath = join(root, 'onpath3');
		makeExecutable(onPath);
		const found = findGrokBinary(join(root, 'does-not-exist'), { PATH: onPath, HOME: root });
		expect(found.found).toBe(false);
	});

	it('reports what it looked at when it finds nothing', () => {
		// The list is what makes "install it" actionable rather than a shrug.
		const found = findGrokBinary(undefined, { PATH: join(root, 'empty-a') + delimiter + join(root, 'empty-b'), HOME: join(root, 'empty-home') });
		expect(found.found).toBe(false);
		if (!found.found) {
			expect(found.searched.length).toBeGreaterThan(2);
			expect(found.searched.some(p => p.includes('empty-a'))).toBe(true);
		}
	});

	it('does not treat a non-executable file as the binary', () => {
		const dir = join(root, 'notexec');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, process.platform === 'win32' ? 'grok.exe' : 'grok'), 'text');
		chmodSync(join(dir, process.platform === 'win32' ? 'grok.exe' : 'grok'), 0o644);
		const found = findGrokBinary(undefined, { PATH: dir, HOME: join(root, 'empty-home') });
		expect(found.found).toBe(false);
	});
});
