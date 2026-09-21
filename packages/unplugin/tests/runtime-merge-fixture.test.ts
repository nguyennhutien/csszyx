/**
 * Generates, and guards, the merge table the runtime suites register.
 *
 * The runtime cannot compile CSS, so its merge suites read a table from disk.
 * This suite is where that table comes from: every class spelled in those
 * suites is asked of the project's real Tailwind, and the answer is compared
 * with the file. A Tailwind upgrade that changes what a class compiles to turns
 * this red instead of leaving the runtime suites asserting on stale evidence.
 *
 * Regenerate with:
 *   UPDATE_MERGE_FIXTURE=1 pnpm --filter @csszyx/unplugin exec vitest run tests/runtime-merge-fixture.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createMergeSignatureTable } from '../src/merge-signature.js';
import { openProjectStyleModel } from '../src/project-style-model.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const RUNTIME_TESTS = fileURLToPath(new URL('../../runtime/tests/', import.meta.url));
const FIXTURE = join(RUNTIME_TESTS, 'fixtures/tailwind-merge-signatures.json');

/** The runtime suites whose expectations rest on compiled CSS. */
const SUITES = [
    'concatenate.test.ts',
    'mangle-registry.test.ts',
    'merge-classes.test.ts',
    'merge-classes-branches.test.ts',
    'merge-color-vs-size-prefixes.test.ts',
    'merge-gap-and-scroll-coverage.test.ts',
    'merge-groups.test.ts',
    'merge-keyword-families.test.ts',
    'merge-offset-and-directional.test.ts',
    'split-box-css-role.test.ts',
    'split-box-tailwind-vocabulary.test.ts',
    'szcn-roundtrip.test.ts',
    'szcn-size-shorthand.test.ts',
];

/**
 * Every whitespace-separated word of every string literal in a suite.
 *
 * Far more than the classes — test titles are strings too — and that is fine:
 * a word Tailwind compiles to nothing has no signature and never reaches the
 * table. Literals are matched one line at a time: a backtick in a doc comment
 * has no partner on its line, and matched across lines it would swallow the
 * code below it into one word with its punctuation attached. O(n) in the size
 * of the suites.
 *
 * @param source - One suite's text.
 * @returns The words, unsorted and with duplicates.
 */
function spelledWords(source: string): string[] {
    const words: string[] = [];
    for (const line of source.split('\n')) {
        for (const literal of line.matchAll(/'([^']*)'|"([^"]*)"|`([^`$]*)`/g)) {
            const text = literal[1] ?? literal[2] ?? literal[3] ?? '';
            for (const word of text.split(/\s+/)) if (word !== '') words.push(word);
        }
    }
    return words;
}

afterAll(removeTailwindProjects);

describe('the merge table the runtime suites register', () => {
    it('is what the project Tailwind compiles those classes to', async () => {
        const root = tailwindProject('csszyx-runtime-merge-fixture-', {
            'app.css': '@import "tailwindcss";',
        });
        const model = await openProjectStyleModel(root, [join(root, 'app.css')]);
        const words = SUITES.flatMap(suite =>
            spelledWords(readFileSync(join(RUNTIME_TESTS, suite), 'utf8')),
        );
        const table = createMergeSignatureTable(words, word => model.signature(word));
        // Compared as data, not bytes: the repository formatter owns the file's
        // layout, and the table's own byte determinism is pinned where it is
        // emitted (`merge-signature-artifact.test.ts`).
        if (process.env.UPDATE_MERGE_FIXTURE === '1') {
            writeFileSync(FIXTURE, `${JSON.stringify(table, null, 4)}\n`);
        }
        expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(
            JSON.parse(JSON.stringify(table)),
        );
    }, 120_000);
});
