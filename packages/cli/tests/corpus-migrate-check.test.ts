/**
 * What `csszyx migrate` writes must pass `csszyx check`.
 *
 * The combo round-trip (`corpus-combo.test.ts`) proves the classes survive:
 * `outlineColor: 'hidden'` lowers to `outline-hidden` just as the source had
 * it. It cannot see that the key is wrong, which is what `check` reports to the
 * person who just migrated — a sibling-key finding for a value the migration
 * put there, or an unknown key it invented. Every real element of the combo
 * corpus is migrated into one project, and `check` must find nothing to say
 * about the sz it produced.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { type CheckReport, check } from '../src/commands/check.js';
import { classNameToSzObject } from '../src/migrate.js';
import { removeTailwindProjects, tailwindProject } from './helpers/tailwind-project.js';

const COMBO_DIR = path.resolve(import.meta.dirname, '../../../scripts/corpus-combo');
const IDENTIFIER = /^[a-z_$][\w$]*$/i;

/**
 * Print a migrated sz value as source.
 *
 * @param value - Any value migrate produces.
 * @returns A JavaScript literal.
 */
function literal(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
    const entries = Object.entries(value as Record<string, unknown>).map(
        ([key, inner]) => `${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${literal(inner)}`,
    );
    return `{ ${entries.join(', ')} }`;
}

/**
 * One component per corpus file, one element per migrated line.
 *
 * @returns Project-relative source files.
 */
function migratedCorpus(): Record<string, string> {
    const files: Record<string, string> = { 'src/app.css': '@import "tailwindcss";' };
    for (const name of readdirSync(COMBO_DIR).filter(file => file.endsWith('.txt'))) {
        const elements = readFileSync(path.join(COMBO_DIR, name), 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line !== '' && !line.startsWith('#'))
            .map(line => {
                const { szObject } = classNameToSzObject(line);
                return Object.keys(szObject).length === 0
                    ? ''
                    : `<div sz={${literal(szObject)}} />`;
            });
        files[`src/${path.basename(name, '.txt')}.tsx`] =
            `export const C = () => (\n    <>\n        ${elements.join('\n        ')}\n    </>\n);\n`;
    }
    return files;
}

afterAll(removeTailwindProjects);

describe('the combo corpus after migrate', () => {
    it('gives check nothing to report about the sz migrate wrote', async () => {
        const cwd = tailwindProject(migratedCorpus());
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd, json: true, rule: ['sz-diagnostic', 'sibling-keyword'] });

        const report = JSON.parse(
            log.mock.calls.map(call => call.join(' ')).join('\n'),
        ) as CheckReport;
        vi.restoreAllMocks();
        process.exitCode = undefined;
        expect(report.findings.map(finding => finding.message)).toEqual([]);
    }, 60_000);
});
