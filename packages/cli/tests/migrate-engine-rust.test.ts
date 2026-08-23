/**
 * `CSSZYX_MIGRATE_ENGINE=rust` routes migrate through the native core.
 *
 * The port's parity with the TypeScript is proven in packages/core and
 * packages/compiler, and which engine a run picks is pinned in
 * migrate-engine-select.test.ts. This pins the CLI seam itself: a single
 * source goes through either engine the same, and a whole run sends its JSX
 * files as one batch and writes the same files the TypeScript engine writes.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isRustMigrateAvailable } from '@csszyx/compiler/migrate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';
import {
    transformHtmlSourceSimple,
    transformHtmlSourceTs,
    transformSource,
    transformSourceTs,
} from '../src/migrate/ast-transformer.js';

const FILES: Record<string, string> = {
    'src/Static.tsx': 'export const A = () => <div className="p-4 bg-blue-500 mystery" />;\n',
    'src/Dynamic.tsx':
        'import clsx from "clsx";\nexport const B = ({ on }) => <div className={clsx("p-4", on && "m-2")} />;\n',
    'src/Legacy.tsx': 'export const C = () => <div sz={{ padding: 4, flex: true }} />;\n',
    'public/page.html': '<html><head></head><body><div class="p-4 mystery">x</div></body></html>\n',
};

function fixture(): string {
    const cwd = mkdtempSync(path.join(tmpdir(), 'csszyx-migrate-engine-'));
    for (const [file, source] of Object.entries(FILES)) {
        const full = path.join(cwd, file);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, source);
    }
    return cwd;
}

async function runMigrate(engine: 'ts' | 'rust'): Promise<Record<string, string>> {
    const cwd = fixture();
    vi.stubEnv('CSSZYX_MIGRATE_ENGINE', engine);
    await migrate({ cwd, injectTodos: true });
    return Object.fromEntries(
        Object.keys(FILES).map(file => [file, readFileSync(path.join(cwd, file), 'utf8')]),
    );
}

describe('CSSZYX_MIGRATE_ENGINE', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it.skipIf(!isRustMigrateAvailable())(
        'transforms one source identically under either engine',
        () => {
            // The TypeScript side is named, not selected. `transformSource`
            // dispatches on the switch, and the native engine is the default
            // now, so asking it twice would compare the port with itself.
            const source = FILES['src/Dynamic.tsx'] as string;
            const expected = transformSourceTs(source, 'Dynamic.tsx', { injectTodos: true });
            vi.stubEnv('CSSZYX_MIGRATE_ENGINE', 'rust');
            expect(transformSource(source, 'Dynamic.tsx', { injectTodos: true })).toEqual(expected);
            const html = FILES['public/page.html'] as string;
            const expectedHtml = transformHtmlSourceTs(html, { injectRuntime: 'cdn' });
            expect(transformHtmlSourceSimple(html, { injectRuntime: 'cdn' })).toEqual(expectedHtml);
        },
    );

    it.skipIf(!isRustMigrateAvailable())(
        'the two entry points really are two implementations',
        () => {
            // A parser rejects this with its own wording. If these ever agree,
            // every comparison above is a mirror and passes for nothing.
            const source = '<div className="" /><span className="x" />';
            vi.stubEnv('CSSZYX_MIGRATE_ENGINE', 'rust');
            expect(transformSource(source, 'canary.tsx').warnings[0]).not.toBe(
                transformSourceTs(source, 'canary.tsx').warnings[0],
            );
        },
    );

    it.skipIf(!isRustMigrateAvailable())(
        'a whole run writes the same files under either engine',
        async () => {
            vi.spyOn(console, 'log').mockImplementation(() => {});
            vi.spyOn(console, 'info').mockImplementation(() => {});
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const viaTs = await runMigrate('ts');
            const viaRust = await runMigrate('rust');
            expect(viaRust).toEqual(viaTs);
            expect(viaTs['src/Static.tsx']).toContain('sz={');
            expect(viaTs['src/Static.tsx']).toContain('@sz-todo: mystery');
            expect(viaTs['src/Legacy.tsx']).toContain("display: 'flex'");
            expect(viaTs['public/page.html']).toContain('sz="');
        },
    );
});
