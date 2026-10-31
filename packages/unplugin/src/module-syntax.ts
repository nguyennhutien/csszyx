/**
 * Whether a module is an ES module or CommonJS.
 *
 * @module
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Whether a file is written as an ES module: a line that starts with `import`
 * or `export` as a statement. A CommonJS file (`module.exports = …`) has none.
 *
 * @param text - The file's text.
 * @returns True for ES-module syntax.
 */
export function hasModuleSyntax(text: string): boolean {
    return /^[ \t]*(?:import|export)[\s{*]/m.test(text);
}

/**
 * Whether the nearest `package.json` above a directory sets `"type": "module"`.
 *
 * @param dir - The directory to start from.
 * @returns True when Node reads a `.js` file there as an ES module.
 */
export function isModulePackage(dir: string): boolean {
    for (let current = dir; ; current = path.dirname(current)) {
        const manifest = path.join(current, 'package.json');
        if (existsSync(manifest)) {
            try {
                return JSON.parse(readFileSync(manifest, 'utf8')).type === 'module';
            } catch {
                return false;
            }
        }
        if (path.dirname(current) === current) return false;
    }
}

/**
 * The format a module is loaded in, read the way Node and a bundler settle it:
 * the extension first, then whether its parse found an `import` or `export`
 * statement or `import.meta`, then the package type. A module none of them
 * marks as an ES module is CommonJS.
 *
 * @param file - The module's path, when known.
 * @param moduleSyntax - Whether its parse found ES-module syntax; asked only
 *        when the extension does not settle it.
 * @returns `esm` or `cjs`.
 */
export function moduleFormatOf(
    file: string | undefined,
    moduleSyntax: () => boolean,
): 'esm' | 'cjs' {
    const extension = file === undefined ? '' : path.extname(file.split('?')[0] as string);
    if (extension === '.mjs' || extension === '.mts') return 'esm';
    if (extension === '.cjs' || extension === '.cts') return 'cjs';
    if (moduleSyntax()) return 'esm';
    return file !== undefined && isModulePackage(path.dirname(file)) ? 'esm' : 'cjs';
}
