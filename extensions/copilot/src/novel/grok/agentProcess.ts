/*---------------------------------------------------------------------------------------------
 *  VS Novel — finding and running the author's `grok` binary.
 *--------------------------------------------------------------------------------------------*/

/**
 * The agent is xAI's own CLI, running locally as the author.
 *
 * That is the whole point of this route: the credential belongs to `grok`, is
 * obtained through xAI's own sign-in, and never passes through this editor. We
 * start the process and speak the protocol they document for exactly this
 * (`grok agent stdio`).
 *
 * The hard part is not starting it — it is *finding* it, and saying something
 * useful when it is not there.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { accessSync, constants } from 'fs';
import { homedir } from 'os';
import { delimiter, join } from 'path';

/** Where the binary came from, so the UI can say something specific. */
export type GrokBinary =
	| { readonly found: true; readonly path: string; readonly source: 'setting' | 'path' | 'well-known' }
	| { readonly found: false; readonly searched: readonly string[] };

/**
 * Directories the installer is known or likely to use, checked after `PATH`.
 *
 * This list exists because of a failure mode with no visible cause: on macOS an
 * app launched from Finder inherits a minimal `PATH` — typically `/usr/bin:/bin`
 * — not the one the author's shell has. So `grok` works in their terminal, the
 * editor cannot find it, and nothing on screen explains the difference. Looking
 * in the places installers actually write turns that into a working feature for
 * most people, and the setting below covers the rest.
 */
function wellKnownDirectories(home: string): string[] {
	return [
		join(home, '.grok', 'bin'),
		join(home, '.local', 'bin'),
		join(home, 'bin'),
		'/opt/homebrew/bin',
		'/usr/local/bin',
		'/usr/bin',
	];
}

function executableName(): string {
	return process.platform === 'win32' ? 'grok.exe' : 'grok';
}

function isExecutable(candidate: string): boolean {
	try {
		accessSync(candidate, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Locate the binary.
 *
 * `configured` is the author's explicit override (a setting), which wins over
 * everything — it is the escape hatch for an install this code has never heard
 * of, and it must not be second-guessed.
 */
export function findGrokBinary(configured?: string, env: NodeJS.ProcessEnv = process.env): GrokBinary {
	const searched: string[] = [];

	if (configured?.trim()) {
		const explicit = configured.trim();
		searched.push(explicit);
		if (isExecutable(explicit)) {
			return { found: true, path: explicit, source: 'setting' };
		}
		// A configured path that does not work is reported as not-found rather
		// than quietly falling back: the author told us where it is, and
		// silently using a different one hides a typo forever.
		return { found: false, searched };
	}

	const name = executableName();
	for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
		const candidate = join(dir, name);
		searched.push(candidate);
		if (isExecutable(candidate)) {
			return { found: true, path: candidate, source: 'path' };
		}
	}

	for (const dir of wellKnownDirectories(env.HOME || homedir())) {
		const candidate = join(dir, name);
		if (searched.includes(candidate)) {
			continue;
		}
		searched.push(candidate);
		if (isExecutable(candidate)) {
			return { found: true, path: candidate, source: 'well-known' };
		}
	}

	return { found: false, searched };
}

/** What a running agent exposes to the rest of this module. */
export interface GrokAgentProcess {
	/** Framed lines the agent wrote. */
	onLine(listener: (line: string) => void): void;
	/** The agent stopped, for whatever reason. */
	onExit(listener: (reason: string) => void): void;
	write(line: string): void;
	kill(): void;
}

export interface SpawnOptions {
	readonly binary: string;
	readonly cwd: string;
	readonly env?: NodeJS.ProcessEnv;
	/** Human-readable diagnostics the agent writes to stderr. */
	readonly log: (message: string) => void;
}

/**
 * Start `grok agent stdio`.
 *
 * stderr is forwarded to the log rather than parsed. It carries the agent's own
 * diagnostics — including, when the author has not signed in, the sentence that
 * says so — and that sentence is worth more in a log the author can be pointed
 * at than any message this code could invent.
 */
export function spawnGrokAgent(options: SpawnOptions): GrokAgentProcess {
	const child: ChildProcessWithoutNullStreams = spawn(
		options.binary,
		['agent', 'stdio'],
		{
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ['pipe', 'pipe', 'pipe'],
		}
	);

	const lineListeners: Array<(line: string) => void> = [];
	const exitListeners: Array<(reason: string) => void> = [];
	let exited = false;

	const announceExit = (reason: string) => {
		if (exited) {
			return;
		}
		exited = true;
		for (const listener of exitListeners) {
			listener(reason);
		}
	};

	child.stdout.setEncoding('utf8');
	child.stdout.on('data', (chunk: string) => {
		for (const listener of lineListeners) {
			listener(chunk);
		}
	});

	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk: string) => options.log(`[grok] ${chunk.trimEnd()}`));

	// `error` fires instead of `exit` when the binary cannot be executed at all
	// — a path that stopped existing between the check and the spawn. Both have
	// to reach the same place, or that case hangs.
	child.on('error', err => announceExit(`the grok agent could not start: ${err.message}`));
	child.on('exit', (code, signal) => announceExit(
		signal
			? `the grok agent was stopped (${signal})`
			: `the grok agent exited with code ${code ?? 'unknown'}`
	));

	return {
		onLine: listener => void lineListeners.push(listener),
		onExit: listener => void exitListeners.push(listener),
		write: line => {
			if (!exited && child.stdin.writable) {
				child.stdin.write(line + '\n');
			}
		},
		kill: () => {
			if (!exited) {
				child.kill();
			}
		},
	};
}
