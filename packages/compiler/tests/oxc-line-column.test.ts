/**
 * Position lookup used by every oxc diagnostic.
 *
 * The lookup switched from rescanning the source prefix per call to a cached
 * line-start table, which is what keeps diagnostics from costing O(N·L) on a
 * file that reports many of them. `offsetToLineColumn` is module-private, so
 * these drive it through the diagnostics it feeds and assert the reported
 * positions stay exact — including across a source switch, which must
 * invalidate the cache rather than answer from the previous file.
 */
import { describe, expect, it } from 'vitest';
import { transformOxc } from '../src/transform-oxc.js';

/**
 * Extract every `line:column` pair a transform reported.
 *
 * @param code - Source to transform.
 * @param filename - Filename passed to the transform.
 * @returns Reported positions in diagnostic order.
 */
function reportedPositions(code: string, filename = '/p/t.tsx'): string[] {
    const result = transformOxc(code, filename);
    return (result.diagnostics ?? []).flatMap(message =>
        [...String(message).matchAll(/at (\d+):(\d+)/g)].map(m => `${m[1]}:${m[2]}`),
    );
}

describe('oxc diagnostic positions', () => {
    it('reports the true line for a fallback deep in the file', () => {
        const filler = '// filler\n'.repeat(200);
        const code = `${filler}export const A = () => <div sz={cfg.x} />;\n`;

        // 200 filler lines then the fallback: line 201, not line 1.
        expect(reportedPositions(code)).toEqual(['201:33']);
    });

    it('keeps every position exact when one file reports many', () => {
        const lines = Array.from(
            { length: 5 },
            (_, i) => `export const A${i} = () => <div sz={cfg${i}.x} />;`,
        );
        const positions = reportedPositions(`${lines.join('\n')}\n`);

        // One per line, in order — a stale table would repeat or drift.
        expect(positions).toEqual(['1:34', '2:34', '3:34', '4:34', '5:34']);
    });

    it('does not answer a second file from the first file table', () => {
        const first = `${'// filler\n'.repeat(50)}export const A = () => <div sz={cfg.x} />;\n`;
        const second = `export const B = () => <div sz={cfg.y} />;\n`;

        expect(reportedPositions(first)).toEqual(['51:33']);
        // Same offsets exist in both sources; a cache keyed on the wrong thing
        // would report line 51 here.
        expect(reportedPositions(second, '/p/u.tsx')).toEqual(['1:33']);
        expect(reportedPositions(first)).toEqual(['51:33']);
    });

    it('handles multi-byte characters before the reported position', () => {
        const code = `const label = 'héllo 你好';\nexport const A = () => <div sz={cfg.x} />;\n`;
        expect(reportedPositions(code)).toEqual(['2:33']);
    });
});
