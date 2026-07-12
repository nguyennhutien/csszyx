/**
 * The migrate command wrapper end-to-end over a temp project: dry-run, real
 * write, and audit mode — the paths the parser/codegen unit suites never run.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';

const tempDirs: string[] = [];
function fixture(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'csszyx-migrate-'));
    tempDirs.push(cwd);
    mkdirSync(join(cwd, 'src'));
    writeFileSync(
        join(cwd, 'src/App.tsx'),
        'export const App = () => <div className="p-4 bg-blue-500">hi</div>;\n',
    );
    return cwd;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

function mute(): string[] {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        logs.push(parts.join(' '));
    });
    return logs;
}

describe('migrate command', () => {
    it('dry-run reports the conversion without touching the file', async () => {
        const logs = mute();
        const cwd = fixture();
        const before = readFileSync(join(cwd, 'src/App.tsx'), 'utf8');
        await migrate({ cwd, dryRun: true });
        expect(readFileSync(join(cwd, 'src/App.tsx'), 'utf8')).toBe(before);
        expect(logs.join('\n').length).toBeGreaterThan(0);
    });

    it('rewrites className into an sz prop on a real run', async () => {
        mute();
        const cwd = fixture();
        await migrate({ cwd });
        const after = readFileSync(join(cwd, 'src/App.tsx'), 'utf8');
        expect(after).toContain('sz={{');
        expect(after).toContain("bg: 'blue-500'");
        expect(after).not.toContain('className="p-4');
    });

    it('audit mode forces dry-run and writes the todo map for unknown classes', async () => {
        mute();
        const cwd = fixture();
        writeFileSync(
            join(cwd, 'src/Custom.tsx'),
            'export const C = () => <div className="p-4 btn-custom">x</div>;\n',
        );
        const before = readFileSync(join(cwd, 'src/Custom.tsx'), 'utf8');
        await migrate({ cwd, audit: true });
        expect(readFileSync(join(cwd, 'src/Custom.tsx'), 'utf8')).toBe(before);
    });
});

describe('migrate todo workflow', () => {
    it('audits unknown classes, then resolves them from the todo map', async () => {
        mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        const file = join(cwd, 'src/Custom.tsx');
        writeFileSync(file, 'export const C = () => <div className="p-4 btn-custom">x</div>;\n');
        await migrate({ cwd, audit: true });

        // The user fills the audited map, then resolves against the pristine file.
        writeFileSync(join(cwd, '.csszyx-todo.json'), JSON.stringify({ 'btn-custom': { p: 8 } }));
        await migrate({ cwd, resolveTodos: '.csszyx-todo.json' });
        const resolved = readFileSync(file, 'utf8');
        expect(resolved).toContain('sz={{ p: 8 }}');
        expect(resolved).not.toContain('btn-custom');
    });

    it('warns and stops when the resolve map is missing or invalid', async () => {
        const logs = mute();
        const cwd = fixture();
        await migrate({ cwd, resolveTodos: 'missing.json' });
        expect(logs.join('\n')).toContain('Could not load resolve map');
    });
});
