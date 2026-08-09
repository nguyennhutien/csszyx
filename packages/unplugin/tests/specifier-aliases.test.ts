/**
 * How a project's alias declarations become a probe table.
 *
 * Two independent sources feed it and each has a shape the other does not:
 * vite hands an array, webpack an object with `$` and fallback lists,
 * TypeScript a `paths` map whose targets are relative to a `baseUrl` that may
 * not be there. Reading any of them wrong resolves `@/styles` to a path the
 * project never meant — which costs only the optimization, but silently, so
 * the parsing rules are pinned here rather than inferred from a build.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    aliasedSpecifierBases,
    aliasesFromResolveConfig,
    aliasesFromTsconfig,
    collectSpecifierAliases,
} from '../src/specifier-aliases.js';

const roots: string[] = [];

/**
 * Create a throwaway project root holding the given config files.
 *
 * @param files - Filename to contents.
 * @returns The root directory.
 */
function projectWith(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-alias-'));
    roots.push(root);
    for (const [name, contents] of Object.entries(files)) {
        writeFileSync(join(root, name), contents);
    }
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('a bundler resolve.alias', () => {
    it('reads the array form vite normalizes to', () => {
        expect(aliasesFromResolveConfig('/app', [{ find: '@', replacement: '/app/src' }])).toEqual([
            { find: '@', replacement: '/app/src', exact: false },
        ]);
    });

    it('reads the object form webpack keeps', () => {
        expect(aliasesFromResolveConfig('/app', { '@': './src' })).toEqual([
            { find: '@', replacement: '/app/src', exact: false },
        ]);
    });

    it("treats webpack's trailing $ as an exact match", () => {
        expect(aliasesFromResolveConfig('/app', { '@styles$': './src/styles.ts' })).toEqual([
            { find: '@styles', replacement: '/app/src/styles.ts', exact: true },
        ]);
    });

    it('keeps every fallback in an array value, in order', () => {
        expect(aliasesFromResolveConfig('/app', { '@': ['./src', './legacy'] })).toEqual([
            { find: '@', replacement: '/app/src', exact: false },
            { find: '@', replacement: '/app/legacy', exact: false },
        ]);
    });

    it('skips what it cannot honour rather than guessing', () => {
        // A RegExp find and webpack's `false` (meaning "unresolvable") both
        // describe something a literal prefix table cannot express. Inventing
        // an entry for either would resolve specifiers the project did not map.
        expect(
            aliasesFromResolveConfig('/app', [{ find: /^@(.*)$/, replacement: '/app/src/$1' }]),
        ).toEqual([]);
        expect(aliasesFromResolveConfig('/app', { '@missing': false })).toEqual([]);
        expect(aliasesFromResolveConfig('/app', undefined)).toEqual([]);
    });
});

describe('tsconfig paths', () => {
    it('resolves targets against baseUrl', () => {
        const root = projectWith({
            'tsconfig.json': JSON.stringify({
                compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
            }),
        });
        expect(aliasesFromTsconfig(root)).toEqual([
            { find: '@/', replacement: `${root}/src/`, exact: false },
        ]);
    });

    it('falls back to the config directory when baseUrl is absent', () => {
        // TypeScript 5 allows `paths` with no `baseUrl`, and the scaffolds that
        // ship that shape are exactly the modern ones. Requiring baseUrl would
        // read those projects as having no aliases at all.
        const root = projectWith({
            'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
        });
        expect(aliasesFromTsconfig(root)[0]?.replacement).toBe(`${root}/src/`);
    });

    it('reads a config carrying comments and a trailing comma', () => {
        const root = projectWith({
            'tsconfig.json':
                '{\n  // scaffolded\n  "compilerOptions": {\n' +
                '    /* paths */\n    "paths": { "@/*": ["./src/*"] },\n  }\n}\n',
        });
        expect(aliasesFromTsconfig(root)[0]?.find).toBe('@/');
    });

    it('does not mistake a comment marker inside a string for a comment', () => {
        const root = projectWith({
            'tsconfig.json': JSON.stringify({
                compilerOptions: { paths: { '@/*': ['./sr//c/*'] } },
            }),
        });
        expect(aliasesFromTsconfig(root)[0]?.replacement).toBe(`${root}/sr/c/`);
    });

    it('does not let an escaped quote end a string early', () => {
        // The escape is the other half of what a regex sweep gets wrong: after
        // `\"` the string is still open, so a `//` that follows is content and
        // not a comment. Cutting there would truncate the path being declared.
        const root = projectWith({
            'tsconfig.json':
                '{ "compilerOptions": { "paths": { "@/*": ["./s\\"//rc/*"] } }, "x": "y" }\n',
        });
        expect(aliasesFromTsconfig(root)[0]?.replacement).toBe(`${root}/s"/rc/`);
    });

    it('reads a config whose block comment is never closed', () => {
        // Malformed, and the scan must not invent a terminator: everything from
        // the opener on is comment, and `JSON.parse` reports the truncation.
        // Throwing from the scan instead would blame the wrong thing.
        const root = projectWith({
            'tsconfig.json':
                '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }\n/* trailing\n',
        });
        expect(aliasesFromTsconfig(root)[0]?.find).toBe('@/');
    });

    it('gives up on a config whose slash is neither a comment nor content', () => {
        // A lone `/` outside a string starts no comment, so it survives the
        // strip and `JSON.parse` rejects the file. Treating it as a comment
        // opener instead would silently swallow the rest of the config.
        const root = projectWith({
            'tsconfig.json': '{ "compilerOptions": { "paths": {} } } / stray\n',
        });
        expect(aliasesFromTsconfig(root)).toEqual([]);
    });

    it('follows a relative extends to the config that declares paths', () => {
        const root = projectWith({
            'tsconfig.base.json': JSON.stringify({
                compilerOptions: { paths: { '@/*': ['./src/*'] } },
            }),
            'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json' }),
        });
        expect(aliasesFromTsconfig(root)[0]?.replacement).toBe(`${root}/src/`);
    });

    it('keeps every target of one pattern as its own probe', () => {
        const root = projectWith({
            'tsconfig.json': JSON.stringify({
                compilerOptions: { paths: { '@/*': ['./src/*', './legacy/*'] } },
            }),
        });
        expect(aliasesFromTsconfig(root).map(alias => alias.replacement)).toEqual([
            `${root}/src/`,
            `${root}/legacy/`,
        ]);
    });

    it('maps a wildcard-free pattern as an exact match', () => {
        const root = projectWith({
            'tsconfig.json': JSON.stringify({
                compilerOptions: { paths: { '@styles': ['./src/styles.ts'] } },
            }),
        });
        expect(aliasesFromTsconfig(root)).toEqual([
            { find: '@styles', replacement: `${root}/src/styles.ts`, exact: true },
        ]);
    });

    it('skips a pattern whose wildcard is not last', () => {
        // A prefix table cannot express text after the wildcard, and treating
        // `@/*/styles` as the prefix `@/` would claim specifiers the project
        // mapped somewhere else entirely.
        const root = projectWith({
            'tsconfig.json': JSON.stringify({
                compilerOptions: { paths: { '@/*/styles': ['./src/*/styles'] } },
            }),
        });
        expect(aliasesFromTsconfig(root)).toEqual([]);
    });

    it('reports no aliases for a project without a readable config', () => {
        expect(aliasesFromTsconfig(projectWith({}))).toEqual([]);
        expect(aliasesFromTsconfig(projectWith({ 'tsconfig.json': '{ not json' }))).toEqual([]);
    });
});

describe('the combined table', () => {
    it('puts the bundler first, because that is what actually resolves', () => {
        const root = projectWith({
            'tsconfig.json': JSON.stringify({
                compilerOptions: { paths: { '@/*': ['./types/*'] } },
            }),
        });
        expect(collectSpecifierAliases(root, { '@/': './src/' })).toEqual([
            { find: '@/', replacement: `${root}/src/`, exact: false },
            { find: '@/', replacement: `${root}/types/`, exact: false },
        ]);
    });
});

describe('expanding a specifier', () => {
    const aliases = [
        { find: '@/', replacement: '/app/src/', exact: false },
        { find: '@styles', replacement: '/app/src/styles', exact: true },
    ];

    it('expands a prefix match and keeps the rest of the specifier', () => {
        expect(aliasedSpecifierBases('@/ui/card', aliases)).toEqual(['/app/src/ui/card']);
    });

    it('expands an exact alias only when the specifier equals it', () => {
        expect(aliasedSpecifierBases('@styles', aliases)).toEqual(['/app/src/styles']);
        expect(aliasedSpecifierBases('@styles/deep', aliases)).toEqual([]);
    });

    it('expands nothing for a specifier no alias claims', () => {
        expect(aliasedSpecifierBases('react', aliases)).toEqual([]);
        expect(aliasedSpecifierBases('./local', [])).toEqual([]);
    });
});
