#!/usr/bin/env node
/**
 * Merge the outcomes.json of every mutation shard into one report.
 *
 * The weekly sweep splits ~2600 mutants across a job matrix, so no single
 * shard knows the engine-wide score. This reads each shard's outcomes.json
 * and prints a GitHub step summary: the totals, and every surviving mutant
 * grouped by file so a reader can see where the suite is blind.
 *
 * Deliberately does NOT exit non-zero on survivors. The weekly run reports;
 * it does not gate. Turning it into a gate is a separate decision that needs
 * a known baseline first — see .agent/rules/categories/tdd.md (TDD-5).
 *
 * Usage: node scripts/mutants-report.mjs <dir-of-shard-artifacts>
 */
import { globSync, readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const root = argv[2];
if (!root) {
    console.error('usage: node scripts/mutants-report.mjs <artifacts-dir>');
    exit(2);
}

const files = globSync(`${root}/**/outcomes.json`);
if (files.length === 0) {
    console.error(`[mutants-report] No outcomes.json under ${root}.`);
    exit(1);
}

const totals = { total_mutants: 0, caught: 0, missed: 0, timeout: 0, unviable: 0 };
/** @type {Map<string, string[]>} */
const survivorsByFile = new Map();

for (const file of files) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    for (const key of Object.keys(totals)) totals[key] += data[key] ?? 0;

    for (const outcome of data.outcomes ?? []) {
        // A survivor is a mutant no test noticed. Timeouts are NOT survivors:
        // the mutated loop never terminates, and a hung job fails CI too.
        if (outcome.summary !== 'MissedMutant') continue;
        const mutant = outcome.scenario?.Mutant;
        if (!mutant) continue;
        const list = survivorsByFile.get(mutant.file) ?? [];
        list.push(mutant.name);
        survivorsByFile.set(mutant.file, list);
    }
}

// Mutants that ran and were killed, over mutants that ran at all. Unviable
// ones never compiled, so they say nothing about test quality and are
// excluded from the denominator rather than counted as wins.
const scored = totals.caught + totals.missed + totals.timeout;
const score = scored === 0 ? 0 : ((totals.caught + totals.timeout) / scored) * 100;

const lines = [
    '## Mutation testing — weekly engine sweep',
    '',
    `**Score: ${score.toFixed(1)}%** (${totals.caught + totals.timeout} killed of ${scored} viable)`,
    '',
    '| Outcome | Count |',
    '| --- | --- |',
    `| Caught | ${totals.caught} |`,
    `| **Survived** | **${totals.missed}** |`,
    `| Timeout (counted as killed) | ${totals.timeout} |`,
    `| Unviable (did not compile) | ${totals.unviable} |`,
    `| Total | ${totals.total_mutants} |`,
    '',
    `Merged from ${files.length} shard${files.length === 1 ? '' : 's'}.`,
    '',
];

if (survivorsByFile.size === 0) {
    lines.push('No survivors. Every viable mutant was killed by a test.');
} else {
    lines.push('### Survivors — a test should have gone red here and did not', '');
    for (const [file, mutants] of [...survivorsByFile].sort((a, b) => b[1].length - a[1].length)) {
        lines.push(`<details><summary><code>${file}</code> — ${mutants.length}</summary>`, '');
        for (const name of mutants) lines.push(`- \`${name}\``);
        lines.push('', '</details>', '');
    }
    lines.push(
        'Treat each one as a bug: write the failing test first, then re-run',
        '`pnpm mut:file <path>` to confirm it dies.',
    );
}

console.log(lines.join('\n'));
