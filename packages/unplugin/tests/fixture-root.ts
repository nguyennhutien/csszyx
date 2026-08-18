/**
 * Project roots for suites that drive the plugin through its real lifecycle.
 *
 * These suites hand the plugin a `root` and let it derive everything from it,
 * including `<root>/.csszyx/cache/transform`. Nothing emptied that directory
 * between runs, so a suite could read a transform result an EARLIER run wrote
 * and assert against it — green or red depending on what the machine happened
 * to hold, and never reproducible in CI, which always starts clean.
 *
 * The roots live under the user cache rather than a temp dir on purpose: the
 * bundlers resolve `node_modules` through these paths, and a temp dir behind a
 * symlink has broken that resolution before.
 *
 * NOT a `.test.ts` file, like `engine-parity-harness.ts`: vitest must not collect
 * it as a suite.
 */
import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * Resolve a suite's project root and empty it first.
 *
 * @param name - Directory name for the suite, unique per suite.
 * @returns Absolute path to the emptied root.
 */
export function freshFixtureRoot(name: string): string {
    const root = resolve(homedir(), '.cache/csszyx-tests', name);
    rmSync(root, { recursive: true, force: true });
    return root;
}
