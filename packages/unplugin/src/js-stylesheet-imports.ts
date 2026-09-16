/**
 * Stylesheets a project reaches from JavaScript rather than from other CSS.
 *
 * A monorepo app often keeps no stylesheet of its own: `main.tsx` imports the
 * design system's `globals.css` from a package, and that file carries the
 * `@import "tailwindcss"` line. A walk over the project's `.css` files never
 * finds it, so the style model would read no prefix for a project that has
 * one. The imports come from the engine's own parser, so a commented-out or
 * string-embedded import is not read as one.
 *
 * @module
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { scanModuleLinks } from '@csszyx/compiler';
import { sortStrings } from './sort.js';
import { aliasedSpecifierBases, type SpecifierAlias } from './specifier-aliases.js';

/** One source module the prescan already read. */
export interface ScannedSource {
    /** Absolute module path. */
    filePath: string;
    /** Module text. */
    content: string;
}

/**
 * Whether source text can contain a stylesheet module request.
 *
 * For `N` source characters this gate costs `O(N)` time and `O(1)` space. A
 * backslash beside module syntax keeps escaped extensions on the parser path;
 * ordinary files without `.css` or escapes retain the cheap rejection path.
 *
 * @param content - JavaScript or TypeScript module text.
 * @returns Whether the parser must inspect its module requests.
 */
export function mayImportStylesheet(content: string): boolean {
    return content.includes('.css') || (content.includes('\\') && content.includes('import'));
}

/**
 * Where an imported stylesheet specifier lands on disk.
 *
 * @param specifier - The import specifier, query removed.
 * @param importer - Absolute path of the importing module.
 * @param aliases - The bundler's aliases, tsconfig paths included.
 * @returns The stylesheet path, or null when nothing resolves.
 */
function resolveImportedStylesheet(
    specifier: string,
    importer: string,
    aliases: readonly SpecifierAlias[],
): string | null {
    if (specifier.startsWith('.')) {
        const file = path.resolve(path.dirname(importer), specifier);
        return existsSync(file) ? file : null;
    }
    const aliased = aliasedSpecifierBases(specifier, aliases).find(file => existsSync(file));
    if (aliased !== undefined) return path.normalize(aliased);
    try {
        return createRequire(importer).resolve(specifier);
    } catch {
        // Not something this importer can reach; the bundler would fail on it too.
        return null;
    }
}

/**
 * The stylesheets these modules import, statically or through `import()`.
 *
 * A `?raw` import hands the text to JavaScript and never reaches Tailwind, so
 * it is left out; `?url` and `?inline` are compiled like a plain import.
 *
 * @param sources - Modules the prescan read.
 * @param aliases - The bundler's aliases, tsconfig paths included.
 * @returns Absolute stylesheet paths, sorted, each once.
 */
export function stylesheetsImportedBy(
    sources: readonly ScannedSource[],
    aliases: readonly SpecifierAlias[],
): string[] {
    const importing = sources.filter(source => mayImportStylesheet(source.content));
    if (importing.length === 0) return [];
    const links = scanModuleLinks(
        importing.map(source => ({ filename: source.filePath, source: source.content })),
    );
    const found = new Set<string>();
    importing.forEach((source, index) => {
        for (const request of links[index]?.cssImports ?? []) {
            const [specifier = '', query = ''] = request.split('?');
            if (new URLSearchParams(query).has('raw')) continue;
            const file = resolveImportedStylesheet(specifier, source.filePath, aliases);
            if (file !== null) found.add(file);
        }
    });
    return sortStrings([...found]);
}
