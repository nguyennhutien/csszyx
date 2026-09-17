/**
 * Project roots carrying a real Tailwind, for suites that ask its design system.
 *
 * The plugin resolves `tailwindcss` and `@csszyx/runtime` from the root's own
 * `package.json`, and a root with neither takes the guard that skips the whole
 * feature -- silently and correctly, which is why a fixture without them
 * proves nothing. The packages are linked, not copied: a copy would be a
 * different `tailwindcss` than the one the oracle's own tests measure against.
 *
 * NOT a `.test.ts` file, like `fixture-root.ts`: vitest must not collect it as a
 * suite.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../../..');

const created: string[] = [];

/**
 * Create a project root with Tailwind and the runtime installed.
 *
 * @param prefix - Temporary directory prefix, unique per suite.
 * @param files - Files to write, keyed by path relative to the root.
 * @returns Absolute project root.
 */
export function tailwindProject(prefix: string, files: Record<string, string>): string {
    // realpath: macOS `tmpdir()` is a symlink and the plugin resolves through it.
    const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    created.push(root);
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content, 'utf8');
    }
    const require_ = createRequire(join(REPO, 'package.json'));
    mkdirSync(join(root, 'node_modules/@csszyx'), { recursive: true });
    symlinkSync(
        resolve(dirname(require_.resolve('tailwindcss')), '..'),
        join(root, 'node_modules/tailwindcss'),
        'dir',
    );
    symlinkSync(join(REPO, 'packages/runtime'), join(root, 'node_modules/@csszyx/runtime'), 'dir');
    return root;
}

/** Remove every root {@link tailwindProject} created; call from `afterEach`. */
export function removeTailwindProjects(): void {
    for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
}

/**
 * Drive a plugin array through its hooks the way a bundler would.
 *
 * @param plugins - The plugin objects `vitePlugin` returned.
 * @returns Caller that invokes one hook by name and awaits its result.
 */
export function callHooks(
    plugins: Record<string, unknown>[],
): (hookName: string, ...args: unknown[]) => Promise<unknown> {
    const ctx = { warn() {}, error() {}, emitFile() {}, addWatchFile() {} };
    return async (hookName, ...args) => {
        const plugin = plugins.find(p => p && hookName in p);
        const hook = plugin?.[hookName];
        const fn = (typeof hook === 'function' ? hook : (hook as { handler?: unknown })?.handler) as
            | ((...a: unknown[]) => unknown)
            | undefined;
        return fn ? await fn.apply(ctx, args) : undefined;
    };
}
