/**
 * Every engine diagnostic is headed by its code.
 *
 * A CI gate that wants "typo'd keys fail, precedence advisories do not" reads
 * the code: `issues[i].code`, or the `[csszyx] <code>:` token that heads the
 * message (ADR 0031 item 12). Each code below is pinned by source the real
 * engines diagnose, and every message must carry the code of the issue it
 * renders, so a renderer that dropped or swapped the header fails here
 * instead of in a user's pipeline. The runtime lane's lines are compared with
 * the engine's in `runtime-engine-diagnostic-differential.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { CODE_SOURCES } from './diagnostic-code-sources.js';
import { ENGINES } from './engine-parity-harness.js';
import { szCodeOf } from './helpers/sz-console-line.js';

/** One source per code, each diagnosed by the engines themselves. */
const ENGINE_SOURCES: Readonly<Record<string, string>> = {
    'unknown-key': 'export const A = () => <div sz={{ xyzzy: 4 }} />;',
    'canonical-key': "export const A = () => <div sz={{ backgroundColor: 'red-500' }} />;",
    'removed-key': "export const A = () => <div sz={{ maskFrom: '10%' }} />;",
    'numeric-key': "export const A = () => <div sz={{ 0: 'x' }} />;",
    'closed-enum-value': "export const A = () => <div sz={{ display: 'bogus' }} />;",
    'slash-opacity-string': "export const A = () => <div sz={{ bg: 'red-500/50' }} />;",
    'color-slash-opacity':
        "export const A = () => <div sz={{ bg: { color: 'red-500/50', op: 20 } }} />;",
    'off-scale-value': 'export const A = () => <div sz={{ p: 1.3 }} />;',
    'numeric-font-weight': "export const A = () => <div sz={{ weight: '700' }} />;",
    'per-side-border-style':
        "export const A = () => <div sz={{ hover: { borderT: 'dashed' } }} />;",
    'property-object': 'export const A = () => <div sz={{ p: { x: 4 } }} />;',
    'non-variant-object': 'export const A = () => <div sz={{ container: { x: 1 } }} />;',
    'unknown-field': 'export const A = () => <div sz={{ maskLinear: { zzz: 1 } }} />;',
    'moved-value':
        "export const A = () => <div sz={{ touchAction: 'pan-y', hover: { mask: 'linear-45' } }} />;",
    'runtime-value': 'export const A = ({ v }) => <div sz={{ alignContent: v }} />;',
    'unresolvable-spread': 'export const A = (props) => <div sz={{ ...props.x, p: 4 }} />;',
    'style-override':
        'export const A = ({ width, props }) => <div sz={{ w: width }} {...props} />;',
    'szs-slot-map': 'export const A = () => <div szs={{ a: { p: 4 } }} />;',
    'sz-recover': 'export const A = ({ m }) => <div szRecover={m} sz={{ p: 4 }} />;',
    'class-precedence':
        'export const A = (props) => <div className={props.className} sz={{ p: 4 }} />;',
    'duplicate-sz': 'export const A = () => <div sz={{ p: 4 }} sz={{ m: 2 }} />;',
    'spread-split-class': 'export const A = (r) => <div className="card" {...r} sz={{ p: 4 }} />;',
};

describe.each(ENGINES)('diagnostic codes — %s', (_name, transform) => {
    it.each(Object.entries(ENGINE_SOURCES))('reports %s from its source', (code, source) => {
        const result = transform(source, { filename: '/p/src/A.tsx' });

        expect((result.issues ?? []).map(issue => issue.code)).toContain(code);
    });

    /**
     * Whether every message of a run is headed by its own issue's code.
     *
     * @param result - One transform's result.
     */
    const expectHeaded = (result: ReturnType<typeof transform>) => {
        expect(result.diagnostics?.length).toBe(result.issues?.length);
        for (const [index, message] of (result.diagnostics ?? []).entries()) {
            expect(szCodeOf(message), message).toBe(result.issues?.[index]?.code);
        }
    };

    it.each(Object.entries(ENGINE_SOURCES))(
        'heads every %s message with the code of its issue',
        (_code, source) => {
            expectHeaded(transform(source, { filename: '/p/src/A.tsx' }));
        },
    );

    it.each(CODE_SOURCES)(
        'heads every %s message from its code source with the code of its issue',
        (_code, source, options) => {
            expectHeaded(transform(source, { filename: '/p/src/A.tsx', ...options }));
        },
    );
});

describe.each(ENGINES)('removed keys, sugar or replaced — %s', (_name, transform) => {
    it.each([
        ['sugar', 'export const A = () => <div sz={{ absolute: true }} />;'],
        ['a replaced key', 'export const A = () => <div sz={{ tabularNums: true }} />;'],
    ])('reads removed-key from %s', (_label, source) => {
        const issues = transform(source, { filename: '/p/src/A.tsx' }).issues ?? [];

        expect(issues.map(issue => issue.code)).toEqual(['removed-key']);
    });
});
