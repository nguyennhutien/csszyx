import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { hasSiblingDeclaration } from '../src/global-var-postcss.js';

describe('global variable PostCSS helpers', () => {
    it('reports no sibling for a detached declaration', () => {
        const declaration = postcss.decl({ prop: '--brand', value: 'red' });

        expect(hasSiblingDeclaration(declaration, '--brand')).toBe(false);
    });
});
