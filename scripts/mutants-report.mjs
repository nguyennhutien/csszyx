#!/usr/bin/env node
/**
 * Merge the outcomes.json of every mutation shard into one report.
 *
 * The monthly sweep splits ~2300 mutants across a job matrix, so no single
 * shard knows the engine-wide score. This reads each shard's outcomes.json and
 * prints a GitHub step summary.
 *
 * The report is diffed against the committed baseline in
 * .cargo/mutants-baseline.json, because a raw survivor list is not a to-do
 * list: some entries can never be killed, and re-reading them every run buries
 * the ones that are real work. What changes between runs — a survivor that is
 * NEW, or one that is finally gone — is what this prints first.
 *
 * Deliberately does NOT exit non-zero. The sweep reports; the per-change
 * signal is the diff-scoped job in rust-check, which runs on the lines a pull
 * request actually touched.
 *
 * Usage: node scripts/mutants-report.mjs <dir-of-shard-artifacts>
 */
import { globSync, readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { mutantKey, readBaseline } from './mutants-baseline.mjs';

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
/** @type {Map<string, {count: number, file: string, description: string}>} */
const observed = new Map();

for (const file of files) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    for (const key of Object.keys(totals)) totals[key] += data[key] ?? 0;

    for (const outcome of data.outcomes ?? []) {
        // A survivor is a mutant no test noticed. Timeouts are NOT survivors:
        // the mutated loop never terminates, and a hung job fails CI too.
        if (outcome.summary !== 'MissedMutant') continue;
        const mutant = outcome.scenario?.Mutant;
        if (!mutant) continue;
        const key = mutantKey(mutant);
        const prior = observed.get(key);
        if (prior) {
            prior.count += 1;
        } else {
            observed.set(key, {
                count: 1,
                file: mutant.file,
                description: mutant.name.slice(mutant.name.indexOf(': ') + 2),
            });
        }
    }
}

const baseline = readBaseline().entries;

// A key can appear more times than the baseline records without being wholly
// new, so the surplus is what counts as new rather than the whole key.
const appeared = [];
const resolved = [];
for (const [key, entry] of observed) {
    const known = baseline[key]?.count ?? 0;
    if (entry.count > known) appeared.push({ ...entry, extra: entry.count - known, known });
}
for (const [key, entry] of Object.entries(baseline)) {
    const now = observed.get(key)?.count ?? 0;
    if (now < entry.count) {
        const separator = key.indexOf(' ');
        resolved.push({
            file: key.slice(0, separator),
            description: key.slice(separator + 1),
            gone: entry.count - now,
            verdict: entry.verdict,
        });
    }
}

const verdicts = { todo: 0, equivalent: 0, unmeasured: 0 };
for (const entry of Object.values(baseline)) {
    if (entry.verdict in verdicts) verdicts[entry.verdict] += entry.count;
}

// Mutants that ran and were killed, over mutants that ran at all. Unviable
// ones never compiled, so they say nothing about test quality and are excluded
// from the denominator rather than counted as wins.
const scored = totals.caught + totals.missed + totals.timeout;
const score = scored === 0 ? 0 : ((totals.caught + totals.timeout) / scored) * 100;

const lines = [
    '## Mutation testing — monthly engine sweep',
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
    '### Against the baseline',
    '',
    '| Baseline verdict | Survivors |',
    '| --- | --- |',
    `| \`todo\` — a real gap, write the test | ${verdicts.todo} |`,
    `| \`equivalent\` — provably unkillable | ${verdicts.equivalent} |`,
    `| \`unmeasured\` — not compiled under these features | ${verdicts.unmeasured} |`,
    '',
];

if (appeared.length === 0) {
    lines.push('**No new survivors.** Every one this run is already in the baseline.', '');
} else {
    const total = appeared.reduce((sum, row) => sum + row.extra, 0);
    lines.push(
        `### ${total} NEW survivor${total === 1 ? '' : 's'} — not in the baseline`,
        '',
        'These are the actionable ones. Write the failing test first, then re-run',
        '`pnpm mut:file <path>` to confirm it dies.',
        '',
    );
    for (const row of appeared.sort((a, b) => b.extra - a.extra)) {
        const suffix = row.known === 0 ? '' : ` (baseline had ${row.known})`;
        lines.push(`- \`${row.file}\` — ${row.description} ×${row.extra}${suffix}`);
    }
    lines.push('');
}

if (resolved.length > 0) {
    lines.push(
        `### ${resolved.length} baseline entr${resolved.length === 1 ? 'y is' : 'ies are'} gone`,
        '',
        'Re-seed so the baseline stops claiming them:',
        '`node scripts/mutants-baseline.mjs seed <artifacts-dir>`',
        '',
    );
    for (const row of resolved) {
        lines.push(`- \`${row.file}\` — ${row.description} ×${row.gone} (was \`${row.verdict}\`)`);
    }
    lines.push('');
}

lines.push(
    'The full list of known survivors, with a verdict on each, lives in',
    '`.cargo/mutants-baseline.json`.',
);

console.log(lines.join('\n'));
