/**
 * Type-level lock on the args a Node site passes with a registry id.
 * Compiled (not run) by `tsc -b`: the package's tsconfig includes `src/**`
 * and excludes `tests/`. Each `@ts-expect-error` is a call the registry's
 * types must refuse — a missing required arg, a form the id does not have,
 * an arg of the wrong type or one it does not declare — and fails this file
 * when it compiles, because the renderer would print an empty space for it.
 */
import { CANONICAL_KEY, DIAGNOSTICS_CAPPED } from './diagnostic-browser.generated.js';
import { szDiagnosticError, szDiagnosticMessage } from './diagnostic-error.js';
import { szRender, szReport } from './diagnostic-report.js';

szDiagnosticMessage('no-source-files', { pattern: 'src/**', root: '/app' });
szDiagnosticError('cli-option-invalid', { form: 'mode', value: 'fast' });
// An optional arg may be left out.
szDiagnosticError('cli-option-invalid', { form: 'parser-mode' });

// @ts-expect-error `root` is required.
szDiagnosticMessage('no-source-files', { pattern: 'src/**' });
// @ts-expect-error `speed` is not a form of `cli-option-invalid`.
szDiagnosticError('cli-option-invalid', { form: 'speed', value: 'fast' });
// @ts-expect-error `where` is a string.
szDiagnosticError('internal-error', { where: 3, detail: 'x' });
// @ts-expect-error `cause` is not an arg of `internal-error`.
szDiagnosticError('internal-error', { where: 'x', detail: 'y', cause: 'z' });
// @ts-expect-error `nestedKeys` is a list.
szDiagnosticMessage('property-object', { key: 'p', nestedKeys: 'a, b' });

// The browser reporter checks the same way, by the id it is handed; on a
// development branch, as every call of it sits (`dev-warning-guard.test.ts`).
if (process.env.NODE_ENV !== 'production') {
    szRender({ diagnostic: CANONICAL_KEY, args: { form: 'alias', key: 'bgColor' } });
    // @ts-expect-error `key` is required.
    szRender({ diagnostic: CANONICAL_KEY, args: { form: 'alias' } });
    // @ts-expect-error `spelling` is not a form of `canonical-key`.
    szReport({ diagnostic: CANONICAL_KEY, args: { form: 'spelling', key: 'bgColor' } });
    // @ts-expect-error `count` is a number.
    szReport({ diagnostic: DIAGNOSTICS_CAPPED, args: { form: 'unknown-keys', count: '200' } });
}

// An id that takes no args takes none: `{}` would let any object through.
szDiagnosticMessage('unresolvable-spread', {});
// @ts-expect-error `unresolvable-spread` declares no args.
szDiagnosticMessage('unresolvable-spread', { name: 'x' });
