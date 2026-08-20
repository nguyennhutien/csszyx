/**
 * The binary must not load a command it was not asked to run.
 *
 * Every command used to be imported at the top of `bin.ts`, so `csszyx check`
 * in a pre-commit hook paid to load the file watcher, the process spawner and
 * the prompt library it never calls. Measured on this repository: 130ms of
 * startup before the command did any work, against 20ms once the imports moved
 * into the actions.
 *
 * It was also a coupling nobody chose. A command whose dependency failed to
 * load took the whole binary down, including the commands that did not use it —
 * which is exactly how nine unrelated tests here fail on a Node old enough to
 * lack `Set.prototype.union`, through `execa` reached from `init`.
 *
 * Asserted against the source rather than by timing, because a timing threshold
 * on a shared machine is a flake generator, and the property that matters is
 * structural: no command module is reachable before an action runs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const BIN = readFileSync(path.join(import.meta.dirname, '../src/bin.ts'), 'utf8');

describe('bin.ts command loading', () => {
    it('imports no command module statically', () => {
        const statics = [...BIN.matchAll(/^import[^;]*from\s*'\.\/commands\/[^']+'/gm)];

        expect(statics.map(match => match[0])).toEqual([]);
    });

    it('still reaches every command, through a dynamic import', () => {
        // The guard above passes trivially if the commands stop being wired at
        // all, so the count is checked too.
        const dynamic = [...BIN.matchAll(/await import\('\.\/commands\/([^']+)\.js'\)/g)];
        const modules = new Set(dynamic.map(match => match[1]));

        expect(modules).toEqual(
            new Set([
                'audit',
                'check',
                'doctor',
                'explain',
                'generate-types',
                'init',
                'migrate',
                'next-prebuild',
                'next-watch',
                'scan-collisions',
            ]),
        );
    });
});
