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
            // TS type-aware (Biome cannot do these — no type inference)
            '@typescript-eslint/explicit-function-return-type': [
                'error',
                {
                    allowExpressions: true,
                    allowTypedFunctionExpressions: true,
                },
            ],
            '@typescript-eslint/explicit-module-boundary-types': 'error',

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
