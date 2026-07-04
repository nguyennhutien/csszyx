// Dedicated ReDoS gate — kept OUT of the main eslint.config.js because
// `recheck` runs a per-regex analysis that is far slower than normal lint
// (seconds over the whole tree) and would make editor/`pnpm lint` sluggish.
// Run via `pnpm lint:redos` and in CI; it covers the polynomial /
// search-position ReDoS class that neither eslint-plugin-regexp rule detects
// (see the note in eslint.config.js).
//
// Scope: first-party package SOURCE only. Tests carry adversarial regexes on
// purpose (the ReDoS counterexamples), and generated / vendored code is not
// ours to fix.
import tsParser from '@typescript-eslint/parser';
import redos from 'eslint-plugin-redos';

export default [
    {
        files: ['packages/*/src/**/*.{ts,tsx,mts,cts,mjs,cjs,js}'],
        // Ignore inline eslint directives: this config only defines the redos
        // rule, so a `/* eslint-disable jsdoc/… */` in a source file would else
        // error as an unknown rule — and, deliberately, a ReDoS finding cannot
        // be silenced inline. A genuine false positive is handled in this
        // config file, in review, not with a scattered per-line suppression.
        linterOptions: { noInlineConfig: true },
        languageOptions: {
            parser: tsParser,
            parserOptions: { sourceType: 'module', ecmaFeatures: { jsx: true } },
        },
        plugins: { redos },
        rules: {
            // Flag any regex with worse-than-linear worst-case behaviour —
            // exponential AND polynomial (the class CodeQL flagged). No
            // `permittableComplexities`: a polynomial regex is exactly what
            // shipped the build-time DoS this gate exists to prevent.
            'redos/no-vulnerable': 'error',
        },
    },
];
