import { describe, expect, it } from 'vitest';

import {
    BOOLEAN_SHORTHANDS,
    PROPERTY_MAP,
} from '../../compiler/src/transform-core.js';
import { PROPERTY_MAPPINGS } from '../src/generator/type-generator.js';

/**
 * `csszyx generate-types` writes each `PROPERTY_MAPPINGS[].prop` verbatim as a
 * user-facing sz key into the generated `.d.ts`. If a `prop` is not a real sz
 * key, the generated type blesses a key the compiler does not understand —
 * autocomplete that produces no/wrong CSS. This locks every emitted key to the
 * single canonical surface so that drift (e.g. `font` for font-weight instead of
 * `weight`, or `text` typed as a color instead of `color`) fails CI.
 */
describe('generate-types emits only canonical sz keys', () => {
    const canonical = new Set([
        ...Object.keys(PROPERTY_MAP),
        ...BOOLEAN_SHORTHANDS,
    ]);

    it.each(PROPERTY_MAPPINGS.map((m) => m.prop))(
        'prop "%s" is a canonical sz key',
        (prop) => {
            expect(canonical.has(prop)).toBe(true);
        },
    );

    it('does not advertise removed/non-canonical keys', () => {
        const props = PROPERTY_MAPPINGS.map((m) => m.prop);
        // Regression guards for the specific drifts that were fixed.
        expect(props).toContain('weight'); // font-weight (not `font`)
        expect(props).toContain('color'); // text color (not `text`)
        expect(props).not.toContain('font');
        expect(props).not.toContain('fontSize');
        expect(props).not.toContain('borderW');
        expect(props).not.toContain('grid');
    });
});
