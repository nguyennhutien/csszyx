/**
 * The checksum on `<html>` attests the census in the same document.
 *
 * The checksum is a hash of the mangle map; the census is that map as the page
 * carries it. With `production.mangle` off — the default — the census ships
 * empty while the map was allocated anyway, so the attribute attested a payload
 * the page did not carry. The documented integrity check answered "map missing,
 * corrupted, or changed" on a perfectly healthy build.
 *
 * Allocating that map at all was the other half of the same defect: a token per
 * eligible class, an encoder call each, and with mangling off nothing reads the
 * result. The only observable effect of the work was the wrong checksum.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { buildViteApp, cleanupViteAppBuilds, readMangleMapFromHtml } from './vite-app-build.js';

afterAll(cleanupViteAppBuilds);

/** A fixture whose sz props give the build a non-empty owned-class set. */
const FILES: Record<string, string> = {
    'index.html': `<!doctype html>
<html><head></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
`,
    'src/main.ts': `
import './styles.css';
import { App } from './App.tsx';
document.body.textContent = JSON.stringify(App());
`,
    'src/App.tsx': `
export const App = () => (
    <div sz={{ p: 4, m: 3 }}>
        <span sz={{ mx: 4, color: 'red-500' }} />
    </div>
);
`,
    'src/styles.css': `
@import "tailwindcss" source(none);
`,
};

/**
 * The checksum the built HTML carries on `<html>`.
 *
 * @param html - The built document.
 * @returns The attribute value, under either spelling.
 */
function checksumOf(html: string): string | null {
    return /data-sz-c(?:hecksum|s)="([^"]+)"/.exec(html)?.[1] ?? null;
}

describe('a build with mangling off', () => {
    it('does not attest a census it did not ship', async () => {
        const off = await buildViteApp({
            name: 'census-off',
            files: FILES,
            plugin: { production: { mangle: false } },
        });
        const on = await buildViteApp({
            name: 'census-on',
            files: FILES,
            plugin: { production: { mangle: true } },
        });

        // No mangling, so no census at all — not an empty one.
        expect(readMangleMapFromHtml(off.html)).toBeNull();
        expect(Object.keys(readMangleMapFromHtml(on.html) ?? {}).length).toBeGreaterThan(0);

        // The two builds carry different censuses, so they must not carry the
        // same checksum. They did: the hash was taken over a map allocated
        // whether or not it shipped.
        expect(checksumOf(off.html)).not.toBe(checksumOf(on.html));
    }, 120_000);
});
