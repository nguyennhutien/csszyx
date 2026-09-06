// Slim ESLint config — Biome (biome.json) covers formatting + most lint rules.
// ESLint stays for two specific responsibilities Biome does not handle:
//   1. JSDoc validation (eslint-plugin-jsdoc) — csszyx requires JSDoc on every
//      function/class/interface; Biome only has 1 minimal jsdoc rule in nursery.
//   2. TypeScript type-aware rules that need full TS inference — Biome runs a
//      syntax-only parser, so `@typescript-eslint/explicit-function-return-type`
//      and `@typescript-eslint/explicit-module-boundary-types` stay here.
//
// Everything else (formatting, import sort, basic lint, JSON formatting,
// React/hooks core rules) is owned by Biome via biome.json.
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import jsdoc from 'eslint-plugin-jsdoc';
import regexp from 'eslint-plugin-regexp';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';

const repoRoot = import.meta.dirname;

export default [
    // Ignore patterns — Biome owns everything ESLint used to lint, so this
    // config only runs on .ts/.tsx where it adds value over Biome.
    {
        ignores: [
            '**/node_modules/**',
            '**/.pnpm-store/**',
            // Private AI-docs tree (gitignored): may hold third-party source
            // samples that are not part of any tsconfig project.
            '.agent/**',
            '**/dist/**',
            // Where `tsc -b` emits, since it stopped sharing dist with the
            // bundler. Declaration output belongs to no tsconfig project, so
            // the type-aware parser rejects every file: leaving it out of this
            // list makes `eslint .` pass or fail on whether a type-check has
            // run yet.
            '**/.tsout/**',
            '**/build/**',
            '**/.next/**',
            '**/.astro/**',
            '**/coverage/**',
            '**/fuzz/seed_corpus/**', // fuzzer input samples, not project source
            '**/examples/**',
            '**/pkg/**',
            '**/pkg-node/**',
            '**/.turbo/**',
            '**/test-results/**',
            '**/playwright-report/**',
            'docs/**',
            'apps/**',
            'playground/**',
            '**/benchmarks/**',
            '**/*.cjs',
            '**/*.mjs',
            '**/*.js',
            '**/*.jsx',
            // …except the hand-written JavaScript a package SHIPS. Sonar reads
            // `packages/**` whatever the extension, so ignoring these left a
            // directory the server checks and nothing here does — which is how
            // a default parameter in the wrong position reached a pull request
            // as a new issue with no local run able to have caught it.
            '!packages/*/native/**/*.js',
        ],
    },

    // Security: detect unsafe regex, eval, new Function, child_process patterns
    {
        files: ['**/*.ts', '**/*.tsx'],
        ...security.configs.recommended,
        rules: {
            ...security.configs.recommended.rules,
            'security/detect-object-injection': 'off',
            'security/detect-non-literal-fs-filename': 'off',
            'security/detect-unsafe-regex': 'off',
        },
    },

    // Regexp: catch ReDoS, polynomial backtracking, unmatchable patterns.
    // Supersedes security/detect-unsafe-regex with deeper analysis.
    {
        files: ['**/*.ts', '**/*.tsx'],
        ...regexp.configs['flat/recommended'],
        rules: {
            ...regexp.configs['flat/recommended'].rules,
            'regexp/no-unused-capturing-group': 'off',
            // Polynomial-ReDoS gate: catches quadratic-by-search patterns (e.g.
            // `[/\\]+$`) that `no-super-linear-backtracking` misses.
            //
            // KNOWN LIMIT: neither rule (nor any of this plugin's 82 rules, at any
            // option level) detects the rejecting-suffix class where a non-dotAll
            // `.*` before `$` fails on a newline — `/\.[tj]sx?(?:\?.*)?$/` was
            // measurably quadratic (`'.js?'.repeat(n) + '\n'`) and passed this
            // config. That class is now caught by the recheck-backed
            // `pnpm lint:redos` gate (eslint.redos.config.mjs), which runs in CI
            // and verify-like-ci; CodeQL's js/polynomial-redos remains the cloud
            // backstop. Keep this rule too — it is instant and runs in the editor,
            // where the slow recheck pass does not.
            'regexp/no-super-linear-move': 'error',
        },
    },

    // JSDoc + TS type-aware rules
    {
        files: ['**/*.ts', '**/*.tsx'],
        plugins: {
            '@typescript-eslint': typescript,
            jsdoc,
        },
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: ['./tsconfig.eslint.json'],
                tsconfigRootDir: repoRoot,
            },
        },
        rules: {
            // Dead stores. Cheap, and it found two on the day it went in. Note
            // what it is NOT: the same-named CodeQL query catches shapes this
            // rule walks past — measured on a loop whose declarations were all
            // overwritten before any read, which CodeQL reported and this
            // stayed silent on. It runs here for its own yield, not as cover
            // for that one.
            'no-useless-assignment': 'error',

            // TS type-aware (Biome cannot do these — no type inference)
            '@typescript-eslint/explicit-function-return-type': [
                'error',
                {
                    allowExpressions: true,
                    allowTypedFunctionExpressions: true,
                },
            ],
            '@typescript-eslint/explicit-module-boundary-types': 'error',

            // SonarCloud reports this as S6551, and nothing here reported it:
            // a value read off a JSON file on disk is `unknown`, and putting it
            // through `String()` turns an object into `[object Object]` — which
            // sorted above every real timestamp and made a damaged cache entry
            // win. Type-aware, so only this block can run it.
            '@typescript-eslint/no-base-to-string': 'error',

            // JSDoc enforcement (csszyx convention)
            'jsdoc/require-jsdoc': [
                'error',
                {
                    require: {
                        FunctionDeclaration: true,
                        MethodDefinition: true,
                        ClassDeclaration: true,
                    },
                    contexts: [
                        'TSInterfaceDeclaration',
                        'TSTypeAliasDeclaration',
                        'TSEnumDeclaration',
                    ],
                },
            ],
            'jsdoc/check-alignment': 'error',
            'jsdoc/check-param-names': 'error',
            'jsdoc/check-tag-names': 'error',
            'jsdoc/check-types': 'error',
            'jsdoc/require-param': 'error',
            'jsdoc/require-param-description': 'error',
            'jsdoc/require-returns': 'error',
            'jsdoc/require-returns-description': 'error',
            // TS types make these redundant
            'jsdoc/require-param-type': 'off',
            'jsdoc/require-returns-type': 'off',
        },
    },

    // Ban bare `.sort()` in shipped source — it coerces elements to strings and
    // silently mis-orders numbers. Sort strings via `sortStrings()` (type-checked
    // to reject non-string arrays) or pass an explicit comparator for other types.
    // Scoped to src (not tests/scripts, where sort inputs are test data/tooling).
    {
        files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "CallExpression[callee.type='MemberExpression'][callee.property.name='sort'][arguments.length=0]",
                    message:
                        'Bare .sort() mis-orders numbers. Use sortStrings() for strings, or pass an explicit comparator.',
                },
            ],
        },
    },

    // Two rules SonarCloud reports on the pull request, run here instead. This
    // is SonarSource's own plugin, so the finding is the same one rather than a
    // lookalike: on the code that first triggered them it reproduced Sonar's
    // exact complexity numbers and its exact wording.
    //
    // Scoped to what `sonar.sources` covers, so a report here means a report
    // there. `scripts/` is outside it, and the argument parsers living there
    // advance the loop index on purpose to consume the value after a flag.
    {
        files: ['packages/**/*.ts', 'packages/**/*.tsx'],
        ignores: ['packages/e2e/**', '**/generated/**', '**/*.d.ts', '**/*.type-test.ts'],
        plugins: { sonarjs, unicorn },
        rules: {
            // S5843. A pattern past this size stops being checkable against the
            // grammar it encodes, one rule at a time.
            'sonarjs/regex-complexity': 'error',

            // S3358. Reported on a pull request while nothing here had a word
            // to say: a ternary inside a ternary reads as one expression and is
            // two decisions, and the one that triggered this sat inside the
            // argument of a method call, which is where it is hardest to see.
            'sonarjs/no-nested-conditional': 'error',
            // S2310. A counter the body rewrites is no longer a counter, and
            // where the next step lands stops being readable from the header.
            'sonarjs/updated-loop-counter': 'error',
            // S5906. `expect(a === b).toBe(true)` fails as "expected false to
            // be true"; the dedicated matcher fails with both sides named.
            'sonarjs/prefer-specific-assertions': 'error',
            // S4624. A template inside a template reads as two strings at once;
            // SonarCloud flagged one on a pull request that the local lint let
            // through, and the whole tree has no other instance.
            'sonarjs/no-nested-template-literals': 'error',
            // S7778, which `eslint-plugin-sonarjs` does not implement at all:
            // nothing local could report it, and the drift report filed it in
            // the bucket it used to count without naming. SonarCloud found it
            // on a pull request whose local run was green.
            //
            // Two pushes in a row are one append written twice, and the pair
            // reads as two separate decisions about the array. The rule named
            // after the Sonar one, `no-array-push-push`, is a deprecated stub
            // in this version of the plugin and reports nothing; this is the
            // one that still runs, with the same message.
            'unicorn/prefer-single-call': 'error',
        },
    },

    // S7780, the other Sonar rule with no `eslint-plugin-sonarjs` rule behind
    // it. `String.raw` says a backslash is a backslash; the escaped spelling
    // has to be decoded by the reader to see the same thing.
    //
    // Production code only, unlike the block above. The two rules are not the
    // same width: SonarCloud reports no S7780 anywhere in this repository,
    // while `unicorn/prefer-string-raw` reports 105 — every one of them in a
    // test file, where Sonar treats the code as test code and does not run the
    // rule. Widening this to tests would not close a gap, it would adopt a
    // stricter rule than the server runs and rewrite 105 string literals
    // nobody was asked to touch. Production code has none today, and is where
    // the finding that put this rule here arrived.
    {
        files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
        ignores: ['**/generated/**', '**/*.d.ts', '**/*.type-test.ts'],
        plugins: { unicorn },
        rules: { 'unicorn/prefer-string-raw': 'error' },
    },

    // S1788, under the name ESLint's core gives it. `eslint-plugin-sonarjs`
    // does not implement this one, so the drift report files it under "no
    // local rule" while a local rule exists in the box — the report can only
    // match what publishes an RSPEC id. Reaches the shipped JavaScript as well
    // as TypeScript, because Sonar reads `packages/**` by extension.
    {
        files: ['packages/**/*.ts', 'packages/**/*.tsx', 'packages/*/native/**/*.js'],
        ignores: ['packages/e2e/**', '**/generated/**', '**/*.d.ts', '**/*.type-test.ts'],
        rules: {
            'default-param-last': 'error',
        },
    },

    // Relax in tests + dev tooling
    {
        files: [
            '**/tests/**/*.ts',
            '**/*.test.ts',
            '**/*.test.tsx',
            '**/*.spec.ts',
            'packages/cli/**/*.ts',
            'packages/dev-tools/**/*.ts',
            'packages/e2e/**/*.ts',
            '**/scripts/**/*.ts',
            'scripts/**/*.ts',
        ],
        rules: {
            'jsdoc/require-jsdoc': 'off',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
        },
    },
];
