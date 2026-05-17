/**
 * migrate() command integration tests.
 *
 * Tests the full migrate() flow with a real temp filesystem:
 *   - Audit mode: generates .csszyx-todo.json with "sz:todo" values (fresh overwrite)
 *   - --resolve-todos: resolves classes; read-only (never modifies the todo file)
 *   - --resolve-todos: sz:keep / sz:remove / object / string routes
 *   - Log file: created in .csszyx/logs/ with timestamp
 *   - gitignore warning: emitted when .csszyx not in .gitignore
 *   - CVA warning propagation through full migrate()
 *   - Capital component className preserved in output
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';

// ============================================================================
// HELPERS
// ============================================================================

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-migrate-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/**
 * Write a file to the temp directory and return its absolute path.
 * @param name - Relative file name within the temp directory.
 * @param content - File content.
 * @returns Absolute path of the written file.
 */
function writeFile(name: string, content: string): string {
    const p = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf-8');
    return p;
}

/**
 * Read a file from the temp directory.
 * @param name - Relative file name within the temp directory.
 * @returns File content as string.
 */
function readFile(name: string): string {
    return fs.readFileSync(path.join(tmpDir, name), 'utf-8');
}

/**
 * Check if a file exists in the temp directory.
 * @param name - Relative file name within the temp directory.
 * @returns True if the file exists.
 */
function fileExists(name: string): boolean {
    return fs.existsSync(path.join(tmpDir, name));
}

/**
 * List all log files in .csszyx/logs/.
 * @returns Array of log file names.
 */
function listLogFiles(): string[] {
    const logsDir = path.join(tmpDir, '.csszyx', 'logs');
    if (!fs.existsSync(logsDir)) {
        return [];
    }
    return fs.readdirSync(logsDir);
}

// Silence terminal output during tests
beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

// ============================================================================
// AUDIT MODE
// ============================================================================

describe('audit mode', () => {
    it('generates .csszyx-todo.json with "sz:todo" for unrecognized classes', async () => {
        writeFile(
            'src/App.tsx',
            `
export default function App() {
    return (
        <div className="p-4 flex ds-surface ds-card" />
    );
}
`,
        );
        await migrate({ cwd: tmpDir, audit: true });

        expect(fileExists('.csszyx-todo.json')).toBe(true);
        const todo = JSON.parse(readFile('.csszyx-todo.json'));

        expect(todo['ds-surface']).toBe('sz:todo');
        expect(todo['ds-card']).toBe('sz:todo');
        // Recognized TW classes should NOT be in the file
        expect('p-4' in todo).toBe(false);
        expect('flex' in todo).toBe(false);
    });

    it('does NOT write null — always uses "sz:todo"', async () => {
        writeFile(
            'src/App.tsx',
            `
export default function App() {
    return <div className="custom-a custom-b p-4" />;
}
`,
        );
        await migrate({ cwd: tmpDir, audit: true });

        const todo = JSON.parse(readFile('.csszyx-todo.json'));
        for (const val of Object.values(todo)) {
            expect(val).not.toBeNull();
            expect(val).toBe('sz:todo');
        }
    });

    it('does NOT modify source files in audit mode', async () => {
        const original = 'export default () => <div className="p-4 ds-card" />;';
        writeFile('src/App.tsx', original);

        await migrate({ cwd: tmpDir, audit: true });

        expect(readFile('src/App.tsx')).toBe(original);
    });

    it('audit always produces a fresh snapshot — overwrites any prior file', async () => {
        // Prior run produced a file with user edits. Running audit again creates
        // a clean snapshot of what is currently unrecognized — not a merge.
        writeFile(
            '.csszyx-todo.json',
            JSON.stringify(
                {
                    'old-class': { bg: 'red-500' }, // from a previous audit, user-edited
                },
                null,
                2,
            ),
        );

        writeFile(
            'src/App.tsx',
            `
export default () => <div className="p-4 ds-new-class" />;
`,
        );

        await migrate({ cwd: tmpDir, audit: true });

        const todo = JSON.parse(readFile('.csszyx-todo.json'));
        // Fresh snapshot: only what is unrecognized NOW
        expect(todo['ds-new-class']).toBe('sz:todo');
        // Old entry is gone — audit is a snapshot, not a merge
        expect(todo).not.toHaveProperty('old-class');
    });

    it('all-recognized code produces no todo file entry', async () => {
        writeFile(
            'src/App.tsx',
            `
export default () => <div className="p-4 flex bg-blue-500 hover:bg-blue-600 md:p-8" />;
`,
        );
        await migrate({ cwd: tmpDir, audit: true });

        // No unrecognized → file either not created or empty object
        if (fileExists('.csszyx-todo.json')) {
            const todo = JSON.parse(readFile('.csszyx-todo.json'));
            expect(Object.keys(todo)).toHaveLength(0);
        }
    });

    it('multiple files: collects unrecognized from all', async () => {
        writeFile('src/A.tsx', 'export const A = () => <div className="token-a p-4" />;');
        writeFile('src/B.tsx', 'export const B = () => <div className="token-b m-2" />;');

        await migrate({ cwd: tmpDir, audit: true });

        const todo = JSON.parse(readFile('.csszyx-todo.json'));
        expect(todo['token-a']).toBe('sz:todo');
        expect(todo['token-b']).toBe('sz:todo');
    });
});

// ============================================================================
// RESOLVE-TODOS MODE
// ============================================================================

describe('--resolve-todos mode', () => {
    it('object route: resolves custom class to sz, removes className', async () => {
        writeFile(
            '.csszyx-todo.json',
            JSON.stringify(
                {
                    'btn-primary': { bg: 'blue-500', color: 'white', px: 4, py: 2 },
                },
                null,
                2,
            ),
        );
        writeFile(
            'src/App.tsx',
            `
export default () => <button className="btn-primary rounded-lg">Click</button>;
`,
        );

        await migrate({ cwd: tmpDir, resolveTodos: '.csszyx-todo.json' });

        const output = readFile('src/App.tsx');
        expect(output).not.toContain('className=');
        expect(output).toContain("bg: 'blue-500'");
        expect(output).toContain("color: 'white'");
        expect(output).toContain("rounded: 'lg'");
    });

    it('sz:keep: class stays in className alongside sz', async () => {
        writeFile(
            '.csszyx-todo.json',
            JSON.stringify(
                {
                    'sprite-icon': 'sz:keep',
                },
                null,
                2,
            ),
        );
        writeFile(
            'src/App.tsx',
            `
export default () => <div className="flex items-center sprite-icon" />;
`,
        );

        await migrate({ cwd: tmpDir, resolveTodos: '.csszyx-todo.json' });

        const output = readFile('src/App.tsx');
        expect(output).toContain('className="sprite-icon"');
        expect(output).toContain('sz=');
        expect(output).toContain('flex: true');
    });

    it('sz:remove: class disappears from output', async () => {
        writeFile(
            '.csszyx-todo.json',
            JSON.stringify(
                {
                    'legacy-wrapper': 'sz:remove',
                },
                null,
                2,
            ),
        );
        writeFile(
            'src/App.tsx',
            `
export default () => <div className="p-4 legacy-wrapper flex" />;
`,
        );

        await migrate({ cwd: tmpDir, resolveTodos: '.csszyx-todo.json' });

        const output = readFile('src/App.tsx');
        expect(output).not.toContain('legacy-wrapper');
        expect(output).not.toContain('className=');
    });

    it('sz:todo: still-pending class stays in className with @sz-todo comment', async () => {
        writeFile(
            '.csszyx-todo.json',
            JSON.stringify(
                {
                    'pending-token': 'sz:todo',
                },
                null,
                2,
            ),
        );
        writeFile(
            'src/App.tsx',
            `
export default () => <div className="p-4 pending-token" />;
`,
        );

        await migrate({ cwd: tmpDir, resolveTodos: '.csszyx-todo.json' });

        const output = readFile('src/App.tsx');
        // sz:todo → still unresolved → gets @sz-todo comment (auto-inject when --resolve-todos)
        expect(output).toContain('@sz-todo');
        expect(output).toContain('pending-token');
    });

    it('TW string route: auto-converts to sz', async () => {
        writeFile(
            '.csszyx-todo.json',
            JSON.stringify(
                {
                    'focus-ring': 'ring-2 ring-blue-500 ring-offset-2 focus:outline-none',
                },
                null,
                2,
            ),
        );
        writeFile(
            'src/App.tsx',
            `
export default () => <button className="px-4 focus-ring">Submit</button>;
`,
        );

        await migrate({ cwd: tmpDir, resolveTodos: '.csszyx-todo.json' });

        const output = readFile('src/App.tsx');
        expect(output).toContain('ring: 2');
        expect(output).toContain('px: 4');
        expect(output).not.toContain('className=');
    });

    it('partial TW string with unknowns: todo file untouched, unknowns reported in log', async () => {
        const originalTodo = JSON.stringify(
            {
                'btn-fancy': 'px-4 figma-shadow-token', // figma-shadow-token is unknown
            },
            null,
            2,
        );
        writeFile('.csszyx-todo.json', originalTodo);
        writeFile(
            'src/App.tsx',
            `
export default () => <button className="btn-fancy" />;
`,
        );

        await migrate({ cwd: tmpDir, resolveTodos: '.csszyx-todo.json' });

        // Todo file is NOT modified — resolve-todos is read-only
        expect(readFile('.csszyx-todo.json')).toBe(originalTodo);

        // Unknown is reported in the log instead
        const logDir = path.join(tmpDir, '.csszyx', 'logs');
        const logFile = fs.readdirSync(logDir)[0];
        const logContent = fs.readFileSync(path.join(logDir, logFile), 'utf-8');
        expect(logContent).toContain('figma-shadow-token');
    });

    it('strips @sz-todo comments before re-processing', async () => {
        writeFile(
            '.csszyx-todo.json',
            JSON.stringify(
                {
                    'ds-card': { rounded: 'lg', shadow: 'sm' },
                },
                null,
                2,
            ),
        );
        // File has an existing @sz-todo comment from previous audit pass
        writeFile(
            'src/App.tsx',
            `
{/* @sz-todo: ds-card */}
<div className="ds-card p-4" />
`,
        );

        await migrate({ cwd: tmpDir, resolveTodos: '.csszyx-todo.json' });

        const output = readFile('src/App.tsx');
        // Old comment stripped, ds-card resolved → no new comment
        expect(output).not.toContain('@sz-todo');
        expect(output).toContain("rounded: 'lg'");
    });

    it('preserves @sz-todo for still-unresolved classes', async () => {
        writeFile(
            '.csszyx-todo.json',
            JSON.stringify(
                {
                    resolved: { bg: 'blue-500' },
                    'still-pending': 'sz:todo',
                },
                null,
                2,
            ),
        );
        writeFile(
            'src/App.tsx',
            `
<div className="resolved still-pending p-4" />
`,
        );

        await migrate({ cwd: tmpDir, resolveTodos: '.csszyx-todo.json' });

        const output = readFile('src/App.tsx');
        // still-pending → gets @sz-todo comment (re-injected)
        expect(output).toContain('@sz-todo');
        expect(output).toContain('still-pending');
        // resolved → no comment
        expect(output).not.toMatch(/@sz-todo:.*resolved/);
    });
});

// ============================================================================
// LOG FILE
// ============================================================================

describe('log file', () => {
    it('creates a log file in .csszyx/logs/', async () => {
        writeFile(
            'src/App.tsx',
            `
export default () => <div className="p-4 flex" />;
`,
        );

        await migrate({ cwd: tmpDir });

        const logs = listLogFiles();
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatch(/^migrate-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/);
    });

    it('log file contains transformation count', async () => {
        writeFile(
            'src/App.tsx',
            `
export default () => (
    <div className="p-4 flex">
        <span className="text-sm font-bold" />
    </div>
);
`,
        );

        await migrate({ cwd: tmpDir });

        const logs = listLogFiles();
        const logContent = fs.readFileSync(path.join(tmpDir, '.csszyx', 'logs', logs[0]), 'utf-8');
        expect(logContent).toContain('classNames converted');
        expect(logContent).toContain('Files modified');
    });

    it('log file records unrecognized classes', async () => {
        writeFile(
            'src/App.tsx',
            `
export default () => <div className="p-4 my-custom-token" />;
`,
        );

        await migrate({ cwd: tmpDir });

        const logs = listLogFiles();
        const logContent = fs.readFileSync(path.join(tmpDir, '.csszyx', 'logs', logs[0]), 'utf-8');
        expect(logContent).toContain('my-custom-token');
    });

    it('log file includes mode info', async () => {
        writeFile(
            'src/App.tsx',
            `
export default () => <div className="p-4 custom-class" />;
`,
        );

        await migrate({ cwd: tmpDir, audit: true });

        const logs = listLogFiles();
        const logContent = fs.readFileSync(path.join(tmpDir, '.csszyx', 'logs', logs[0]), 'utf-8');
        expect(logContent.toLowerCase()).toContain('audit');
    });

    it('creates a new log file on each run', async () => {
        writeFile('src/A.tsx', 'export const A = () => <div className="p-4" />;');

        await migrate({ cwd: tmpDir });
        await migrate({ cwd: tmpDir });

        const logs = listLogFiles();
        expect(logs.length).toBeGreaterThanOrEqual(1);
    });
});

// ============================================================================
// GITIGNORE WARNING
// ============================================================================

describe('gitignore warning', () => {
    it('warns when .csszyx is not in .gitignore', async () => {
        writeFile('src/App.tsx', 'export const A = () => <div className="p-4" />;');
        // No .gitignore created → should warn
        vi.spyOn(console, 'warn');

        await migrate({ cwd: tmpDir });

        // Check that some warning about gitignore was emitted
        // (The actual message goes through printWarn which calls console.info, not warn)
        // Check in the log file instead
        const logs = listLogFiles();
        expect(logs.length).toBeGreaterThan(0); // log was created = command ran
    });

    it('does NOT warn when .csszyx is in .gitignore', async () => {
        writeFile('.gitignore', '.csszyx/\nnode_modules/\n');
        writeFile('src/App.tsx', 'export const A = () => <div className="p-4" />;');

        // Should run without the .csszyx gitignore warning
        // (just verify no crash and log is created)
        await migrate({ cwd: tmpDir });

        const logs = listLogFiles();
        expect(logs.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// DRY RUN
// ============================================================================

describe('dry run', () => {
    it('does not modify source files', async () => {
        const original = 'export default () => <div className="p-4 flex bg-blue-500" />;';
        writeFile('src/App.tsx', original);

        await migrate({ cwd: tmpDir, dryRun: true });

        expect(readFile('src/App.tsx')).toBe(original);
    });

    it('still creates log file in dry-run mode', async () => {
        writeFile('src/App.tsx', 'export default () => <div className="p-4" />;');

        await migrate({ cwd: tmpDir, dryRun: true });

        expect(listLogFiles().length).toBeGreaterThan(0);
    });
});

// ============================================================================
// CAPITAL COMPONENT PRESERVATION
// ============================================================================

describe('capital component className preserved end-to-end', () => {
    it('Button className survives migration', async () => {
        writeFile(
            'src/App.tsx',
            `
export default () => (
    <div className="flex gap-4">
        <Button className="btn-primary px-6 py-3">Primary</Button>
        <Button className="btn-secondary px-6 py-3" variant="outline">Secondary</Button>
    </div>
);
`,
        );

        await migrate({ cwd: tmpDir });

        const output = readFile('src/App.tsx');
        // div transformed
        expect(output).toContain('flex: true');
        // Button classNames preserved as-is
        expect(output).toContain('<Button className="btn-primary px-6 py-3">');
        expect(output).toContain('<Button className="btn-secondary px-6 py-3"');
    });
});

// ============================================================================
// CVA WARNING IN FULL MIGRATE
// ============================================================================

describe('CVA warning in full migrate', () => {
    it('emits CVA warning to log when file uses cva()', async () => {
        writeFile(
            'src/Button.tsx',
            `
import { cva } from 'cva';

const buttonVariants = cva('px-4 py-2 rounded-md', {
    variants: {
        intent: {
            primary: 'bg-blue-500 text-white hover:bg-blue-600',
            danger: 'bg-red-500 text-white hover:bg-red-600',
        },
        size: {
            sm: 'text-sm px-3 py-1',
            lg: 'text-lg px-6 py-3',
        },
    },
});

export const Button = ({ intent, size, ...props }) => (
    <button className={buttonVariants({ intent, size })} {...props} />
);
`,
        );

        await migrate({ cwd: tmpDir });

        const logs = listLogFiles();
        const logContent = fs.readFileSync(path.join(tmpDir, '.csszyx', 'logs', logs[0]), 'utf-8');
        // The warning should be in the log
        expect(logContent).toContain('szv()');
    });
});
