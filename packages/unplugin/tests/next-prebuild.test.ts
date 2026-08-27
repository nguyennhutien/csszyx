import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { readNextGenerationManifest } from '../src/next-generation-manifest.js';
import { type NextPrebuildOptions, runNextPrebuild } from '../src/next-prebuild.js';
import { SAFELIST_HEADER } from '../src/safelist-format.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Next Turbopack prebuild core', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-prebuild-'));
        tempDirs.push(dir);
        return dir;
    }

    function writeSource(root: string, relative: string, source: string): string {
        const filename = join(root, relative);
        mkdirSync(join(filename, '..'), { recursive: true });
        writeFileSync(filename, source, 'utf8');
        return filename;
    }

    function baseOptions(root: string, files: readonly string[]): NextPrebuildOptions {
        return {
            files,
            explicitRoot: root,
            cwd: root,
            parserMode: 'auto',
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            compilerVersion: '0.9.0',
            nativeVersion: '0.9.0-test',
            writeOptions: { retryDelayMs: 0 },
        };
    }

    it('safelists a class the loader will only emit from an imported style object', () => {
        // The loader compiles `sz={cardSz}` into a class name; this pass is
        // what puts that name where Tailwind reads it. Resolve differently
        // here and the page ships a class whose rule was never generated —
        // strictly worse than neither of them compiling it, which is why the
        // two share one resolver and one opt-in.
        const root = tempRoot();
        writeSource(root, 'app/styles.ts', 'export const cardSz = { p: 7 };\n');
        const page = writeSource(
            root,
            'app/page.tsx',
            "import { cardSz } from './styles';\nexport default () => <div sz={cardSz} />;\n",
        );

        const result = runNextPrebuild({
            ...baseOptions(root, [page]),
            importedStaticSz: true,
        });

        expect(readFileSync(result.safelistOutputPath, 'utf8')).toContain('p-7');
    });

    it('leaves the class out when the setting is turned off', () => {
        // Turning it off is the supported way back to file-local behaviour, so
        // it has to actually withdraw the class from the safelist — not merely
        // stop the loader compiling it.
        const root = tempRoot();
        writeSource(root, 'app/styles.ts', 'export const cardSz = { p: 7 };\n');
        const page = writeSource(
            root,
            'app/page.tsx',
            "import { cardSz } from './styles';\nexport default () => <div sz={cardSz} />;\n",
        );

        const result = runNextPrebuild({
            ...baseOptions(root, [page]),
            importedStaticSz: false,
        });

        expect(readFileSync(result.safelistOutputPath, 'utf8')).not.toContain('p-7');
    });

    it('transforms each file, writes per-file shards, and materializes a completed manifest', () => {
        const root = tempRoot();
        const fileA = writeSource(
            root,
            'src/A.tsx',
            'export const A=()=> <div sz={{ p: 4, bg: "emerald-500" }} />;',
        );
        const fileB = writeSource(
            root,
            'src/B.tsx',
            'export const B=()=> <div sz={{ m: 2, color: "white" }} />;',
        );

        const result = runNextPrebuild(baseOptions(root, [fileA, fileB]));

        expect(result.scannedCount).toBe(2);
        expect(result.transformedCount).toBe(2);
        expect(result.skippedMissingCount).toBe(0);
        expect(result.files.map(file => file.filename).sort()).toEqual([fileA, fileB].sort());

        for (const entry of result.files) {
            expect(entry.shardPath && existsSync(entry.shardPath)).toBe(true);
            expect(entry.classCount).toBeGreaterThan(0);
        }

        expect(existsSync(result.manifestPath)).toBe(true);
        const manifest = readNextGenerationManifest(result.manifestPath);
        expect(manifest?.completed).toBe(true);
        expect(manifest?.mode).toBe('production');
        expect(manifest?.sourceCount).toBe(2);

        const safelist = readFileSync(result.safelistOutputPath, 'utf8');
        expect(safelist).toContain('p-4');
        expect(safelist).toContain('bg-emerald-500');
        expect(safelist).toContain('m-2');
        expect(safelist).toContain('text-white');
        expect(result.classCount).toBeGreaterThanOrEqual(4);
        expect(result.sourceCount).toBe(2);
    });

    it('counts missing files separately and still finalizes the safelist', () => {
        const root = tempRoot();
        const present = writeSource(
            root,
            'src/Present.tsx',
            'export const P=()=> <div sz={{ p: 4 }} />;',
        );
        const missing = join(root, 'src/Missing.tsx');

        const result = runNextPrebuild(baseOptions(root, [present, missing]));

        expect(result.scannedCount).toBe(2);
        expect(result.transformedCount).toBe(1);
        expect(result.skippedMissingCount).toBe(1);
        expect(result.files).toHaveLength(1);
        expect(result.files[0]?.filename).toBe(present);
        expect(existsSync(result.safelistOutputPath)).toBe(true);
        expect(readFileSync(result.safelistOutputPath, 'utf8')).toContain('p-4');
        expect(readNextGenerationManifest(result.manifestPath)?.completed).toBe(true);
    });

    it('deduplicates the input file list so a repeated path is scanned once', () => {
        const root = tempRoot();
        const filename = writeSource(
            root,
            'src/Dup.tsx',
            'export const D=()=> <div sz={{ p: 1 }} />;',
        );

        const result = runNextPrebuild(baseOptions(root, [filename, filename]));

        expect(result.scannedCount).toBe(1);
        expect(result.transformedCount).toBe(1);
        expect(result.files).toHaveLength(1);
    });

    it('records a transformed file with zero classes as an empty shard', () => {
        const root = tempRoot();
        const filename = writeSource(root, 'src/Plain.tsx', 'export const P=()=> <div />;');

        const result = runNextPrebuild(baseOptions(root, [filename]));

        expect(result.transformedCount).toBe(1);
        expect(result.files).toHaveLength(1);
        expect(result.files[0]?.classCount).toBe(0);
        expect(result.files[0]?.shardPath && existsSync(result.files[0].shardPath)).toBe(true);
        expect(result.sourceCount).toBe(1);
        expect(result.classCount).toBe(0);
    });

    it('removes stale classes when a file no longer contains sz syntax', () => {
        const root = tempRoot();
        const filename = writeSource(
            root,
            'src/App.tsx',
            'export const App=()=> <div sz={{ p: 4 }} />;',
        );

        const first = runNextPrebuild(baseOptions(root, [filename]));
        expect(readFileSync(first.safelistOutputPath, 'utf8')).toContain('p-4');

        writeFileSync(filename, 'export const App=()=> <div />;', 'utf8');
        const second = runNextPrebuild(baseOptions(root, [filename]));

        expect(second.classCount).toBe(0);
        expect(second.sourceCount).toBe(1);
        expect(readdirSync(second.context.safelist.shardsDir)).toHaveLength(1);
        expect(readFileSync(second.safelistOutputPath, 'utf8')).toBe(SAFELIST_HEADER);
    });

    it('rejects production CSS variable mangling unless explicitly opted in', () => {
        const root = tempRoot();
        const filename = writeSource(
            root,
            'src/Mangle.tsx',
            'export const M=()=> <div sz={{ color: "red" }} />;',
        );

        expect(() =>
            runNextPrebuild({
                ...baseOptions(root, [filename]),
                mode: 'production',
                compilerOptions: { mangleVars: true },
            }),
        ).toThrow(/does not support production CSS variable mangling/);
    });

    it('runs with no csszyx config at all, the way an unconfigured app starts', () => {
        // Every other case pins a config, so the shape a project gets before it
        // has one goes untested — and that shape still has to reach the
        // generation identity, or the loader and the prebuild disagree from the
        // first build.
        const root = tempRoot();
        const filename = writeSource(
            root,
            'src/A.tsx',
            'export const A = () => <div sz={{ p: 4 }} />;',
        );
        const { config: _config, ...withoutConfig } = baseOptions(root, [filename]);

        const result = runNextPrebuild(withoutConfig);

        expect(readFileSync(result.safelistOutputPath, 'utf8')).toContain('p-4');
    });

    it('fails closed if the source still contains csszyx sz syntax after transform', () => {
        const root = tempRoot();
        // Force-fail by feeding the babel transformer an input that triggers a
        // parser error inside a region that still mentions `sz=`. A bare invalid
        // JSX expression keeps `sz=` in the surviving code, which is exactly what
        // the source transformer's pass-through guard rejects.
        const filename = writeSource(root, 'src/Broken.tsx', '<<<not jsx>>> sz= "still here"');

        expect(() => runNextPrebuild(baseOptions(root, [filename]))).toThrow();
    });
});
