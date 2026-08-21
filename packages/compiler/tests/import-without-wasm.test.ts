/**
 * Importing `@csszyx/compiler` must not pull the wasm core into the graph.
 *
 * `@csszyx/core` resolves to a wasm module. A field report hit this under jest,
 * where importing anything from `@csszyx/compiler` failed outright — and the
 * eight platforms that ship a native binary paid for it too, loading a fallback
 * nothing was ever going to call.
 *
 * The wasm parser lane already got this right and says why: it requires its
 * module lazily so a process that never transforms never instantiates a wasm
 * runtime. One module did not get the treatment, and there was nothing to notice
 * when the edge came back — which is what this test is. It runs in a child
 * process because the poisoning has to be in place before the first import, and
 * a module already in this process's cache would make it vacuous.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The wasm entry, and only it.
 *
 * `@csszyx/core` resolves to the wasm module; `@csszyx/core/native` is a plain
 * JavaScript shim that requires its binding lazily, so it costs a process
 * nothing to have in the graph. Poisoning the whole namespace would fail on the
 * shim and prove nothing about wasm.
 */
const WASM_ENTRY = '@csszyx/core';

/** Prelude that makes the wasm entry unresolvable in the child. */
const POISON = `
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === ${JSON.stringify(WASM_ENTRY)}) {
            throw new Error('poisoned: ' + request);
        }
        return load.call(this, request, parent, isMain);
    };
`;

/**
 * Load a module in a child process where the wasm entry cannot resolve.
 *
 * Poisoning the resolution rather than the file reproduces the reported failure
 * without depending on how any one runner fails to read wasm.
 *
 * @param specifier - Path to require, relative to the package.
 * @returns Whatever the child printed on stdout.
 */
function requireWithoutCore(specifier: string): string {
    const script = `
        ${POISON}
        require(${JSON.stringify(path.join(PACKAGE, specifier))});
        process.stdout.write('loaded');
    `;
    return execFileSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        cwd: PACKAGE,
    });
}

describe('the package entry, with the wasm core unresolvable', () => {
    it('loads', () => {
        // The built CJS entry is what a jest project resolves, so it is the
        // artifact under test rather than the TypeScript source.
        expect(() => requireWithoutCore('dist/index.cjs')).not.toThrow();
    });

    it('still exports what it exported', () => {
        // A lazy edge that quietly dropped an export would pass the load test
        // and break every consumer, so the surface is checked in the same
        // child.
        const script = `
            ${POISON}
            const api = require(${JSON.stringify(path.join(PACKAGE, 'dist/index.cjs'))});
            process.stdout.write(
                ['CsszyxCompiler', 'transform', 'generateRecoveryToken']
                    .filter(name => typeof api[name] === 'undefined')
                    .join(',') || 'all-present',
            );
        `;
        const missing = execFileSync(process.execPath, ['-e', script], {
            encoding: 'utf8',
            cwd: PACKAGE,
        });

        expect(missing).toBe('all-present');
    });
});

describe('the wasm core, when it is available', () => {
    it('is still reachable — the edge is deferred, not removed', () => {
        // The point is WHEN the module loads, not whether it can. A change that
        // made the core unreachable would also pass the tests above.
        expect(() => require('@csszyx/core')).not.toThrow();
    });
});
