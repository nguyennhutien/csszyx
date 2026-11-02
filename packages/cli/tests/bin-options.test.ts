import { afterEach, expect, it, vi } from 'vitest';

const command = vi.hoisted(() => ({
    migrate: vi.fn(),
    nextPrebuild: vi.fn(),
    check: vi.fn(),
    manifest: '',
}));
vi.mock('../src/commands/migrate.js', () => ({ migrate: command.migrate }));
vi.mock('../src/commands/next-prebuild.js', () => ({
    nextPrebuild: command.nextPrebuild,
}));
vi.mock('../src/commands/check.js', () => ({ check: command.check }));
vi.mock('node:fs', async original => {
    const actual = await original<typeof import('node:fs')>();
    return {
        ...actual,
        readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
            if (args[0] instanceof URL && args[0].pathname.endsWith('/cli/package.json')) {
                if (command.manifest === 'error') throw new Error('manifest unreadable');
                if (command.manifest === 'missing') return '{}';
            }
            return actual.readFileSync(...args);
        },
    };
});

const argv = process.argv;
afterEach(() => {
    process.argv = argv;
    command.manifest = '';
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.resetModules();
});

it.each(['local', 'none'])(
    'dispatches runtime injection %s and defaults to --cwd',
    async runtime => {
        process.argv = [
            'node',
            'csszyx',
            'migrate',
            '--cwd',
            '/project',
            '--inject-runtime',
            runtime,
        ];
        await import('../src/bin.js');
        await vi.waitFor(() => expect(command.migrate).toHaveBeenCalled());
        expect(command.migrate).toHaveBeenCalledWith(
            expect.objectContaining({
                cwd: '/project',
                injectRuntime: runtime === 'local' ? 'local' : false,
            }),
        );
    },
);

it('preserves repeated file arguments and exits with a failed prebuild status', async () => {
    process.argv = ['node', 'csszyx', 'check', '--files', 'a.tsx', '--files', 'b.tsx'];
    await import('../src/bin.js');
    await vi.waitFor(() => expect(command.check).toHaveBeenCalled());
    expect(command.check).toHaveBeenCalledWith(
        expect.objectContaining({ files: ['a.tsx', 'b.tsx'] }),
    );
    vi.resetModules();
    command.nextPrebuild.mockResolvedValueOnce(1);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    process.argv = ['node', 'csszyx', 'next-prebuild'];
    await import('../src/bin.js');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
});

it.each(['error', 'missing'])('prints a fallback version for a %s manifest', async manifest => {
    command.manifest = manifest;
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) =>
        output.push(args.join(' ')),
    );
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) =>
        output.push(args.join(' ')),
    );
    process.argv = ['node', 'csszyx', '--version'];
    await import('../src/bin.js');
    expect(output.join(' ')).toContain('0.0.0');
});
