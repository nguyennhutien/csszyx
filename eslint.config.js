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
            '**/dist/**',
            '**/build/**',
            '**/.next/**',
            '**/.astro/**',
            '**/coverage/**',
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
            // `[/\\]+$`) that `no-super-linear-backtracking` misses. Closes the gap
            // that was previously CodeQL-only.
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
