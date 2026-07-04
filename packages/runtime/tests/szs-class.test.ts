import { describe, expect, it } from 'vitest';

import { szsClass } from '../src/szs-class.js';

describe('szsClass', () => {
    it('passes a compiled slot string through', () => {
        expect(szsClass('text-lg font-medium')).toBe('text-lg font-medium');
    });

    it('returns undefined for an absent slot', () => {
        expect(szsClass(undefined)).toBeUndefined();
        expect(szsClass(null)).toBeUndefined();
    });

    it('never lets an uncompiled sz object coerce into a className', () => {
        // A misconfigured build (or a dynamic value the v1 szs contract
        // rejects) leaves the slot as an object — forwarding that would render
        // class="[object Object]".
        expect(szsClass({ text: 'lg' })).toBeUndefined();
    });
});
