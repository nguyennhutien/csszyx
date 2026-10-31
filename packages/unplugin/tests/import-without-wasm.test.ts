/**
 * Importing the plugin builds no WebAssembly module.
 *
 * `@csszyx/core` resolves to the wasm module, which compiles and instantiates
 * itself on import. The plugin reached it for the class-name encoder and the
 * mangle map's checksum, so every build process on a platform with a native
 * binary paid for a fallback nothing was going to call. Both now come from
 * `@csszyx/compiler/engine`, on the artifact the build runs on.
 *
 * Counted, not poisoned by name: a child process wraps every way to build a
 * module and imports an entry, so any route to the wasm, through any
 * specifier or path, shows. It runs in a child because the wrap has to be in
 * place before the first import.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Prelude that counts every WebAssembly module and instance the child builds. */
const COUNT = `
    let built = 0;
    for (const name of ['Module', 'Instance']) {
        WebAssembly[name] = new Proxy(WebAssembly[name], {
            construct(target, args, newTarget) {
                built++;
                return Reflect.construct(target, args, newTarget);
            },
        });
    }
    for (const name of ['compile', 'instantiate', 'compileStreaming', 'instantiateStreaming']) {
        const original = WebAssembly[name];
        if (original) {
            WebAssembly[name] = function (...args) {
                built++;
                return original.apply(this, args);
            };
        }
    }
`;

/**
 * How many WebAssembly modules a child builds running `script` after the count
 * is in place.
 *
 * @param script - CommonJS run in the child; it calls `done()` when finished.
 * @returns The count.
 */
function built(script: string): number {
    const out = execFileSync(
        process.execPath,
        ['-e', `${COUNT}\nconst done = () => process.stdout.write(String(built));\n${script}`],
        { encoding: 'utf8', cwd: PACKAGE },
    );
    return Number(out);
}

/** Every entry the package exports, as built. */
const ENTRIES = Object.values(
    JSON.parse(readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')).exports as Record<
        string,
        string | { import?: string | { default?: string }; default?: string }
    >,
).map(target => {
    if (typeof target === 'string') return target;
    const esm = target.import;
    return (typeof esm === 'string' ? esm : esm?.default) ?? (target.default as string);
});

describe('the plugin entries', () => {
    it('counts what the wasm core builds, so a zero below means something', () => {
        expect(built("import('@csszyx/core').then(done);")).toBeGreaterThan(0);
    });

    it.each(ENTRIES)('%s builds no WebAssembly module on import', entry => {
        expect(built(`import(${JSON.stringify(path.join(PACKAGE, entry))}).then(done);`)).toBe(0);
    });

    // The encoder and the checksum load the wasm only when the build names it.
    it.each([
        ['rust', 0],
        ['wasm', 1],
    ] as const)(
        'encodes and checksums on %s building that many modules or more',
        (parser, least) => {
            const count = built(`
            import('@csszyx/compiler/engine').then(engine => {
                engine.classNameEncoder({ parser: '${parser}' })(52);
                engine.computeMangleChecksum({ a: 'b' }, { parser: '${parser}' });
                done();
            });
        `);
            if (least === 0) expect(count).toBe(0);
            else expect(count).toBeGreaterThanOrEqual(least);
        },
    );
});
