#!/usr/bin/env node
/**
 * The survivor baseline: what the sweep is already known to report.
 *
 * A raw survivor list is not a to-do list. Some entries can never be killed —
 * an equivalent mutant rewrites a value with the one already there, and no
 * output can tell it apart — and others sit in code the sweep's feature set
 * compiles out, so they report as missed while measuring nothing. Re-reading
 * those every run buries the entries that are real work.
 *
 * This file records a verdict for each known survivor, so the report can
 * answer the only question that changes between runs: what is NEW.
 *
 * Verdicts:
 *   todo       — a real gap. Write the test.
 *   equivalent — provably unkillable. Carries the reason it cannot die.
 *   unmeasured — the code is not compiled under the sweep's features, so the
 *                mutant never ran. Says nothing about the tests either way.
 *
 * Usage:
 *   node scripts/mutants-baseline.mjs seed <dir-of-shard-artifacts>
 *   node scripts/mutants-baseline.mjs list [todo|equivalent|unmeasured]
 */
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

export const BASELINE_PATH = new URL('../.cargo/mutants-baseline.json', import.meta.url);

/**
 * A key stable across line drift.
 *
 * cargo-mutants names a mutant `<file>:<line>:<col>: <description>`, and the
 * line moves whenever anything above it does. The description already names
 * the function, so dropping the position leaves an identifier that survives an
 * unrelated edit. Identical descriptions repeat within one function — five
 * `i += 1` in one scanner produce five identical names — so the baseline
 * stores a COUNT per key rather than pretending each one is distinguishable.
 */
export function mutantKey(mutant) {
    const description = mutant.name.slice(mutant.name.indexOf(': ') + 2);
    return `${mutant.file} ${description}`;
}

export function readBaseline() {
    if (!existsSync(BASELINE_PATH)) return { entries: {} };
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

/** Survivor counts observed in a directory of shard outcomes. */
export function observedSurvivors(root) {
    const files = globSync(`${root}/**/outcomes.json`);
    if (files.length === 0) throw new Error(`No outcomes.json under ${root}.`);
    const seen = new Map();
    for (const file of files) {
        for (const outcome of JSON.parse(readFileSync(file, 'utf8')).outcomes ?? []) {
            if (outcome.summary !== 'MissedMutant') continue;
            const mutant = outcome.scenario?.Mutant;
            if (!mutant) continue;
            const key = mutantKey(mutant);
            const prior = seen.get(key);
            if (prior) prior.count += 1;
            else seen.set(key, { count: 1, mutant });
        }
    }
    return { seen, shardCount: files.length };
}

function seed(root) {
    const { seen } = observedSurvivors(root);
    const existing = readBaseline();
    const entries = {};
    let kept = 0;
    for (const key of [...seen.keys()].sort()) {
        const prior = existing.entries[key];
        if (prior) kept += 1;
        entries[key] = {
            count: seen.get(key).count,
            verdict: prior?.verdict ?? 'todo',
            ...(prior?.why ? { why: prior.why } : {}),
        };
    }
    const dropped = Object.keys(existing.entries).filter(key => !(key in entries));
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ entries }, null, 4)}\n`);
    console.log(`[baseline] ${Object.keys(entries).length} keys written.`);
    console.log(`[baseline] ${kept} verdicts carried over, ${dropped.length} no longer observed.`);
    for (const key of dropped) console.log(`  gone: ${key}`);
}

function list(filter) {
    const { entries } = readBaseline();
    const rows = Object.entries(entries).filter(([, value]) => !filter || value.verdict === filter);
    for (const [key, value] of rows) {
        const separator = key.indexOf(' ');
        const file = key.slice(0, separator);
        const description = key.slice(separator + 1);
        const count = String(value.count).padStart(3);
        console.log(`${value.verdict.padEnd(11)} ${count}  ${file}  ${description}`);
    }
    console.log(`\n${rows.length} entries${filter ? ` with verdict ${filter}` : ''}.`);
}

const [, script, command, argument] = argv;
if (import.meta.url === `file://${script}`) {
    if (command === 'seed') {
        if (!argument) {
            console.error('usage: mutants-baseline.mjs seed <artifacts-dir>');
            exit(2);
        }
        seed(argument);
    } else if (command === 'list') {
        list(argument);
    } else {
        console.error('usage: mutants-baseline.mjs {seed <artifacts-dir>|list [verdict]}');
        exit(2);
    }
}
