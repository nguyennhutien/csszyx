/**
 * `CSSZYX_MIGRATE_ENGINE=rust` routes migrate through the native core.
 *
 * The port's parity with the TypeScript is proven in packages/core and
 * packages/compiler; this pins the CLI seam: the switch is read, a single
 * source goes through, and a whole run sends its JSX files as one batch and
 * writes the same files the TypeScript engine writes.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isRustMigrateAvailable } from '@csszyx/compiler/migrate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';
import {
    migrateEngine,
    transformHtmlSourceSimple,
    transformSource,
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

    it('selects the TypeScript engine unless asked for rust', () => {
        expect(migrateEngine()).toBe('ts');
        vi.stubEnv('CSSZYX_MIGRATE_ENGINE', 'rust');
        expect(migrateEngine()).toBe('rust');
        vi.stubEnv('CSSZYX_MIGRATE_ENGINE', 'RUST');
        expect(migrateEngine()).toBe('ts');
    });

    it.skipIf(!isRustMigrateAvailable())(
        'transforms one source identically under either engine',
        () => {
            const source = FILES['src/Dynamic.tsx'] as string;
            const expected = transformSource(source, 'Dynamic.tsx', { injectTodos: true });
            vi.stubEnv('CSSZYX_MIGRATE_ENGINE', 'rust');
            expect(transformSource(source, 'Dynamic.tsx', { injectTodos: true })).toEqual(expected);
            const html = FILES['public/page.html'] as string;
            vi.unstubAllEnvs();
            const expectedHtml = transformHtmlSourceSimple(html, { injectRuntime: 'cdn' });
            vi.stubEnv('CSSZYX_MIGRATE_ENGINE', 'rust');
            expect(transformHtmlSourceSimple(html, { injectRuntime: 'cdn' })).toEqual(expectedHtml);
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
