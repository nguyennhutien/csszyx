/**
 * Reading a project's theme declarations with the line each sits on.
 *
 * The report lands at the declaration, so a name alone is not enough — the
 * author needs the line to go to. `parseThemeBlocks` in the unplugin already
 * knows which names a stylesheet declares and is the one place that logic
 * lives; this adds only the position, by locating the declaration it named.
 */
import { describe, expect, it } from 'vitest';

import { declaredThemeTokens } from '../src/scanner/theme-declarations.js';

describe('declaredThemeTokens', () => {
    it('reads a colour token with its line', () => {
        const css = '@import "tailwindcss";\n@theme {\n  --color-brand: #0af;\n}\n';

        expect(declaredThemeTokens(css, 'src/app.css')).toEqual([
            { namespace: 'colors', name: 'brand', file: 'src/app.css', line: 3 },
        ]);
    });

    it('covers all four namespaces the collision check guards', () => {
        const css = [
            '@theme {',
            '  --color-brand: #0af;',
            '  --text-huge: 4rem;',
            '  --font-display: serif;',
            '  --font-weight-chunky: 850;',
            '}',
        ].join('\n');

        expect(
            declaredThemeTokens(css, 'a.css')
                .map(token => token.namespace)
                .sort(),
        ).toEqual(['colors', 'fontFamilies', 'fontWeights', 'textSizes']);
    });

    it('does not read a font weight as a font family', () => {
        // `--font-weight-chunky` starts with `--font-`, so a prefix match
        // alone would file it under families and check it against the wrong
        // set of classes.
        const css = '@theme {\n  --font-weight-chunky: 850;\n}\n';

        expect(declaredThemeTokens(css, 'a.css')).toEqual([
            { namespace: 'fontWeights', name: 'chunky', file: 'a.css', line: 2 },
        ]);
    });

    it('gives each declaration its own line', () => {
        const css = '@theme {\n  --color-a: #000;\n  --color-b: #fff;\n}\n';

        expect(declaredThemeTokens(css, 'a.css').map(token => token.line)).toEqual([2, 3]);
    });

    it('reports nothing for a stylesheet that declares no theme', () => {
        expect(declaredThemeTokens('@import "tailwindcss";\n', 'a.css')).toEqual([]);
    });
});
