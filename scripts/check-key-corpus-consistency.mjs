#!/usr/bin/env node

// Cross-consistency gate between the two snippet-derived artefacts:
//   - packages/cli/tests/generated/sz-key-cases.json (the per-key TS matrix fixture)
//   - packages/core/tests/fixtures/parity-corpus.json (the TS<->Rust parity corpus)
//
// The Rust default engine's correctness is transitive: parity proves Rust == TS,
// the per-key matrix proves TS == the documented class. That chain only holds if
// EVERY forward case the matrix tests is also present in the parity corpus — i.e.
// the corpus actually covers the matrix. The two `gen:*:check` gates only verify
// each file is internally fresh against its own generator; neither checks that
// the corpus covers the matrix, so a generator change that silently dropped some
// keys would leave both green while Rust quietly lost coverage for those keys.
//
// This asserts matrix-forward ⊆ corpus (subset, not equality — the corpus also
// carries hand-curated edge cases the matrix does not). Membership uses the exact
// `JSON.stringify(sz)` key the parity generator dedups by
// (scripts/gen-rust-parity-corpus.mjs), so the comparison is apples-to-apples.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const keyCasesFile = path.resolve(here, '../packages/cli/tests/generated/sz-key-cases.json');
const corpusFile = path.resolve(here, '../packages/core/tests/fixtures/parity-corpus.json');

const keyCases = JSON.parse(readFileSync(keyCasesFile, 'utf8'));
const corpus = JSON.parse(readFileSync(corpusFile, 'utf8'));

// The corpus stores each input as a pre-serialized `sz` string; the parity
// generator builds that string with JSON.stringify(sz), so match on the same.
const corpusKeys = new Set(corpus.map(record => record.sz));

const missing = [];
for (const [key, entry] of Object.entries(keyCases.keys)) {
    for (const { sz } of entry.forward ?? []) {
        const serialized = JSON.stringify(sz);
        if (!corpusKeys.has(serialized)) {
            missing.push({ key, sz: serialized });
        }
    }
}

if (missing.length > 0) {
    console.error(
        `[check-key-corpus] ${missing.length} per-key forward case(s) are missing from the Rust parity corpus.`,
    );
    console.error(
        'The Rust engine is not gated for these keys. Regenerate the corpus (pnpm gen:parity-corpus) or fix the generator:',
    );
    for (const { key, sz } of missing) {
        console.error(`  ${key}: ${sz}`);
    }
    process.exit(1);
}

console.log(
    `[check-key-corpus] OK — all ${corpusKeys.size} corpus inputs cover every per-key forward case.`,
);
