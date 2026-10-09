/**
 * One engine-diagnosed source per diagnostic code.
 *
 * Shared by the suites that pin the codes (`diagnostic-codes.test.ts`) and the
 * kinds read from them (`sz-diagnostic-kind.test.ts`), so a new code needs
 * one source, written once.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite.
 */
import type { SzDiagnosticCode, TransformSourceCodeOptions } from '../src/index.js';

/** One source per code, with the options it needs to be diagnosed. */
export const CODE_SOURCES: ReadonlyArray<
    readonly [code: SzDiagnosticCode, source: string, options?: TransformSourceCodeOptions]
> = [
    ['unknown-key', 'export const A = () => <div sz={{ xyzzy: 4 }} />;'],
    ['canonical-key', "export const A = () => <div sz={{ backgroundColor: 'red-500' }} />;"],
    ['removed-key', "export const A = () => <div sz={{ maskFrom: '10%' }} />;"],
    ['numeric-key', "export const A = () => <div sz={{ 0: 'x' }} />;"],
    ['closed-enum-value', "export const A = () => <div sz={{ display: 'bogus' }} />;"],
    ['off-scale-value', 'export const A = () => <div sz={{ p: 1.3 }} />;'],
    ['numeric-font-weight', "export const A = () => <div sz={{ weight: '700' }} />;"],
    [
        'per-side-border-style',
        "export const A = () => <div sz={{ hover: { borderT: 'dashed' } }} />;",
    ],
    ['property-object', 'export const A = () => <div sz={{ p: { x: 4 } }} />;'],
    ['non-variant-object', 'export const A = () => <div sz={{ container: { x: 1 } }} />;'],
    ['unknown-field', 'export const A = () => <div sz={{ maskLinear: { zzz: 1 } }} />;'],
    ['runtime-value', 'export const A = ({ v }) => <div sz={{ alignContent: v }} />;'],
    ['unresolvable-spread', 'export const A = (props) => <div sz={{ ...props.x, p: 4 }} />;'],
    [
        'style-override',
        'export const A = ({ width, props }) => <div sz={{ w: width }} {...props} />;',
    ],
    ['szs-slot-map', 'export const A = () => <div szs={{ a: { p: 4 } }} />;'],
    ['sz-recover', 'export const A = ({ m }) => <div szRecover={m} sz={{ p: 4 }} />;'],
    [
        'class-precedence',
        'export const A = (props) => <div className={props.className} sz={{ p: 4 }} />;',
    ],
    ['duplicate-sz', 'export const A = () => <div sz={{ p: 4 }} sz={{ m: 2 }} />;'],
    [
        'spread-split-class',
        'export const A = (r) => <div className="card" {...r} sz={{ p: 4 }} />;',
    ],
    ['moved-value', "export const A = () => <div sz={{ touchAction: 'pan-y' }} />;"],
    [
        'global-before-group',
        "export const A = () => <div sz={{ contain: 'size', containPaint: true }} />;",
    ],
    [
        'runtime-family-conflict',
        "export const A = ({ c }) => <div sz={{ touch: 'none', touchPanX: c ? 'x' : undefined }} />;",
    ],
    ['fallback-missing-css', "import { s } from './s';\nexport const A = () => <div sz={s} />;"],
    ['fallback-nudge', 'export const A = ({ s }) => <div sz={s} />;'],
    [
        'merge-classifier-unavailable',
        'export const A = () => <div sz={{ p: 4 }} />;',
        { mergeTable: { format: 99, signatures: {}, coverage: [] } },
    ],
    ['parse-error', 'export const A = ({ c }) => <div sz={{ p: c ? 4 : 2 }} />;\nconst broken = ;'],
    ['nesting-depth', `export const A = () => ${'{'.repeat(70)}`],
    ['unsupported-dynamic-sz', 'export const A = () => <div sz />;'],
    [
        'ast-budget',
        'export const A = ({ c }) => <><div sz={{ p: c ? 4 : 2 }} /><span /><span /></>;',
        { astBudget: 3 },
    ],
    [
        'mangle-vars-hoist-skipped',
        'export const A = ({ c }) => <div sz={{ color: c }} />;\n' +
            'export const B = ({ c }) => <div sz={{ color: c }} />;',
        { mangleVars: true },
    ],
];
