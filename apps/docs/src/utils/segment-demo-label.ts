export type DemoLabelSegment = { type: 'sz' | 'text'; value: string };

/**
 * Split brace-delimited sz fragments from a demo label without regex backtracking.
 * Empty braces stay plain text, matching the previous label-rendering behavior.
 * @param label - Demo label to segment.
 * @returns Ordered text and sz fragments.
 */
export function segmentDemoLabel(label: string): DemoLabelSegment[] {
    const segments: DemoLabelSegment[] = [];
    let cursor = 0;
    let searchFrom = 0;

    while (searchFrom < label.length) {
        const open = label.indexOf('{', searchFrom);
        if (open === -1) break;

        const close = label.indexOf('}', open + 1);
        if (close === -1) break;
        if (close === open + 1) {
            searchFrom = close + 1;
            continue;
        }

        if (open > cursor) {
            segments.push({ type: 'text', value: label.slice(cursor, open) });
        }
        segments.push({ type: 'sz', value: label.slice(open, close + 1) });
        cursor = close + 1;
        searchFrom = cursor;
    }

    if (cursor < label.length) {
        segments.push({ type: 'text', value: label.slice(cursor) });
    }
    return segments;
}
