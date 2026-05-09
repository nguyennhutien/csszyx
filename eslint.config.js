import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import jsdoc from 'eslint-plugin-jsdoc';
import jsonc from 'eslint-plugin-jsonc';
import oxlint from 'eslint-plugin-oxlint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import jsoncParser from 'jsonc-eslint-parser';

export default [
    // Ignore patterns
    {
        ignores: [
            '**/node_modules/**',
            '**/.pnpm-store/**',
            '**/dist/**',
            '**/build/**',
            '**/.next/**',
            '**/coverage/**',
            '**/examples/**',
            'docs/**',
            'apps/**',
            'playground/**',
            '**/pkg-node/**',
            '**/benchmarks/**',
            'vitest.workspace.ts',
            '**/*.cjs',
        ],
    },

    // Base config
    js.configs.recommended,

    // JavaScript files
    {
        files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],

        plugins: {
            react,
            'react-hooks': reactHooks,
            'simple-import-sort': simpleImportSort,
            jsdoc,
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                browser: true,
                node: true,
                es2021: true,
            },
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
        rules: {
            // Equality
            eqeqeq: 'error',

            // Brace style - 1TBS (One True Brace Style)
            'brace-style': ['error', '1tbs', { allowSingleLine: true }],

            // Commas
            'comma-dangle': ['warn', 'always-multiline'],
            'comma-spacing': 'error',

            // Braces & semicolons
            curly: 'error',
            semi: ['error', 'always'],
            'no-extra-semi': 'error',

            // Spacing
            'object-curly-spacing': ['error', 'always'],
            'space-in-parens': ['error', 'never'],
            'space-before-blocks': ['error', 'always'],
            'keyword-spacing': ['error'],
            'space-infix-ops': 'error',
            'space-unary-ops': ['error', { nonwords: false }],
            'key-spacing': ['error', { beforeColon: false, afterColon: true }],

            // Indentation - 4 spaces
            indent: [
                'error',
                4,
                {
                    SwitchCase: 1,
                    MemberExpression: 1,
                    flatTernaryExpressions: true,
                    offsetTernaryExpressions: false,
                    ObjectExpression: 'first',
                    VariableDeclarator: 'first',
                },
            ],

            // Quotes
            quotes: ['error', 'single', { avoidEscape: true }],

            // Line breaks
            'eol-last': 'error',
            'no-multiple-empty-lines': ['error', { max: 1 }],
            'no-trailing-spaces': ['error', { skipBlankLines: false }],
            'no-multi-spaces': 'error',

            // Console & debug
            'no-console': ['warn', { allow: ['error', 'warn', 'info'] }],
            'no-debugger': 'error',
            'no-alert': 'error',

            // Variables
            'no-unused-vars': ['warn', { args: 'none' }],
            'one-var': ['error', { uninitialized: 'always', initialized: 'never' }],
            'prefer-const': ['warn'],

            // Comments
            'spaced-comment': [
                'error',
                'always',
                {
                    line: {
                        exceptions: ['-', '+'],
                        markers: ['=', '!', '/', '*'],
                    },
                    block: {
                        exceptions: ['-', '+'],
                        markers: ['=', '!', ':', '::'],
                        balanced: true,
                    },
                },
            ],

            // Import sorting
            'simple-import-sort/imports': 'error',
            'simple-import-sort/exports': 'error',

            // JSDoc - REQUIRED for all functions/classes
            'jsdoc/require-jsdoc': [
                'error',
                {
                    require: {
                        FunctionDeclaration: true,
                        MethodDefinition: true,
                        ClassDeclaration: true,
                        ArrowFunctionExpression: true,
                        FunctionExpression: true,
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
            'jsdoc/require-param-type': 'error',
            'jsdoc/require-returns': 'error',
            'jsdoc/require-returns-description': 'error',
            'jsdoc/require-returns-type': 'error',

            // React
            ...react.configs.recommended.rules,
            ...reactHooks.configs.recommended.rules,
            'react/react-in-jsx-scope': 'off',
            'react/jsx-indent': ['error', 4],
            'react/jsx-indent-props': ['error', 4],
            'react/jsx-max-props-per-line': ['warn', { maximum: 1 }],
            'react/jsx-first-prop-new-line': ['warn', 'multiline-multiprop'],
        },
    },

    // TypeScript files
    {
        files: ['**/*.ts', '**/*.tsx'],
        plugins: {
            '@typescript-eslint': typescript,
            react,
            'react-hooks': reactHooks,
            'simple-import-sort': simpleImportSort,
            jsdoc,
        },
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                // tsconfig.eslint.json (if present) extends tsconfig.json to include tests/.
                // Packages without tsconfig.eslint.json fall back to tsconfig.json silently.
                project: ['./tsconfig.json', './tsconfig.eslint.json'],
            },
        },
        rules: {
            // Disable base rules that are handled by TS
            'no-undef': 'off',
            'no-unused-vars': 'off',

            // TypeScript specific
            '@typescript-eslint/no-unused-vars': ['warn', { args: 'none' }],
            '@typescript-eslint/explicit-function-return-type': [
                'error',
                {
                    allowExpressions: true,
                    allowTypedFunctionExpressions: true,
                },
            ],
            '@typescript-eslint/explicit-module-boundary-types': 'error',

            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-non-null-assertion': 'error',

            // JSDoc for TypeScript
            'jsdoc/require-param-type': 'off', // TS handles this
            'jsdoc/require-returns-type': 'off', // TS handles this
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

            // Import sorting
            'simple-import-sort/imports': 'error',
            'simple-import-sort/exports': 'error',

            // React
            'react/prop-types': 'off',
        },
    },

    // JSON files (exclude package.json — npm/pnpm enforce 2-space indent)
    {
        files: ['**/*.json', '**/*.jsonc', '**/*.json5'],
        ignores: ['**/package.json', '**/test-results/**', '.claude/**'],
        plugins: {
            jsonc: jsonc,
        },
        languageOptions: {
            parser: jsoncParser,
        },
        rules: {
            ...jsonc.configs['recommended-with-json'].rules,
            'jsonc/indent': ['error', 4],
            'jsonc/quotes': ['error', 'double'],
            'jsonc/comma-dangle': 'error',
            'jsonc/comma-style': ['error', 'last'],
            'jsonc/key-spacing': ['error', { beforeColon: false, afterColon: true }],
        },
    },

    // Node.js scripts — define process/console as globals (flat config does not auto-enable env globals)
    {
        files: ['scripts/**/*.mjs', 'scripts/**/*.js', 'packages/*/scripts/**/*.mjs', 'packages/*/scripts/**/*.js', '.github/scripts/**/*.mjs', '.github/scripts/**/*.js', '**/esbuild.mjs'],
        languageOptions: {
            globals: {
                process: 'readonly',
                console: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
            },
        },
        rules: {
            'no-console': 'off',
        },
    },

    // Allow console logs in CLI, tests, dev-tools, and scripts
    {
        files: [
            'packages/cli/**/*.ts',
            'packages/dev-tools/**/*.ts',
            'packages/e2e/**/*.ts',
            '**/tests/**/*.ts',
            '**/test-*.ts',
            '**/scripts/**/*.ts',
        ],
        rules: {
            'no-console': 'off',
        },
    },

    // Ignore patterns
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/lib/**',
            '**/pkg/**',
            '**/pkg-node/**',
            '**/.turbo/**',
            '**/coverage/**',
            '**/.next/**',
            '**/.cache/**',
            '**/target/**',
        ],
    },

    // Disable ESLint rules that oxlint already covers. Reads
    // .oxlintrc.json so any oxlint rule changes propagate
    // automatically — single source of truth for rule activation
    // is the oxlint config.
    //
    // MUST be last in the array. The plugin emits per-rule
    // "off" overrides; later entries win in flat config.
    ...oxlint.buildFromOxlintConfigFile('./.oxlintrc.json'),
];
