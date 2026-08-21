/**
 * A project's theme declarations, with the line each one sits on.
 *
 * The collision report lands at the declaration, so a name is not enough — the
 * author needs somewhere to go. `parseThemeBlocks` already owns the question of
 * which names a stylesheet declares, and restating that parse here would be a
 * second copy free to disagree with the build. This adds only the position, by
 * locating the declaration the shared parser named.
 *
 * @module
 */
import { parseThemeBlocks } from '@csszyx/unplugin';

import type { ThemeNamespace } from './sibling-keyword.js';
import type { DeclaredToken } from './theme-collision.js';

/** Where each guarded namespace's names come from, and how they are spelled. */
const NAMESPACES: ReadonlyArray<{
    namespace: ThemeNamespace;
    /** Field on the shared parser's result. */
    field: 'colors' | 'textSizes' | 'fonts' | 'fontWeights';
    /** CSS custom-property prefix the declaration uses. */
    prefix: string;
}> = [
    { namespace: 'colors', field: 'colors', prefix: '--color-' },
    { namespace: 'textSizes', field: 'textSizes', prefix: '--text-' },
    // Families and weights both spell their declaration `--font-…`; the
    // shared parser is what tells them apart, which is the reason to read its
    // fields rather than prefix-match the CSS again here.
    { namespace: 'fontWeights', field: 'fontWeights', prefix: '--font-weight-' },
    { namespace: 'fontFamilies', field: 'fonts', prefix: '--font-' },
];

/**
 * Read the theme tokens one stylesheet declares, with their lines.
 *
 * @param css - Stylesheet contents.
 * @param file - Project-relative path, carried into each token.
 * @returns The declarations, in source order.
 */
export function declaredThemeTokens(css: string, file: string): DeclaredToken[] {
    const parsed = parseThemeBlocks(css);
    const lines = css.split('\n');
    const tokens: DeclaredToken[] = [];
    for (const { namespace, field, prefix } of NAMESPACES) {
        for (const name of parsed[field]) {
            const declaration = `${prefix}${name}`;
            const index = lines.findIndex(line => line.includes(`${declaration}:`));
            // A name the shared parser found always has a declaration to point
            // at; falling back to line 1 rather than dropping it keeps a
            // reformatted stylesheet reported instead of silently exempt.
            tokens.push({ namespace, name, file, line: index === -1 ? 1 : index + 1 });
        }
    }
    return tokens.sort((a, b) => a.line - b.line);
}
