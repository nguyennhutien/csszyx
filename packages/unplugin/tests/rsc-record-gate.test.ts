/**
 * When the transform hook builds RSC module records at all.
 *
 * The records feed one check: at build end, no Server Component may reach a
 * browser-only runtime helper through its imports. Building them meant a
 * regex import scan of every module - 1.7 s of an 18 000-file build - on
 * projects with no Server Component anywhere. The prescan walk reads every
 * file before the first transform, so a one-shot production build knows by
 * then whether a server module exists; when none does, there is nothing the
 * graph could be walked from and the records are skipped. A watch build and
 * the lanes with no prescan keep building them: a module can turn into a
 * server module after the walk there.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRSCModuleRecord } from '../src/rsc-boundary.js';
import { vitePlugin } from '../src/unplugin.js';

vi.mock('../src/rsc-boundary.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/rsc-boundary.js')>();
    return { ...actual, createRSCModuleRecord: vi.fn(actual.createRSCModuleRecord) };
});

type PrePlugin = {
    configResolved?: (c: { root: string; command: string; build?: { watch?: unknown } }) => void;
    transform(this: { warn(m: string): void }, code: string, id: string): unknown;
};

const tempDirs: string[] = [];
const CLIENT_MODULE = 'export const Card = () => <div sz={{ p: 4 }} />;\n';

/**
 * @param files - Relative path to source.
 * @returns A project root holding them.
 */
function project(files: Record<string, string>): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-rsc-gate-')));
    tempDirs.push(root);
    for (const [file, source] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), source);
    }
    return root;
}

/**
 * Run a one-shot vite build's config hook, then transform one client module.
 *
 * @param root - Project root.
 * @param build - The build section of the resolved config.
 * @param build.watch - Set for a watch build, which keeps building records.
 */
function buildThenTransform(root: string, build: { watch?: unknown } = {}): void {
    const [pre] = vitePlugin({ build: { cache: false } }) as unknown as [PrePlugin];
    pre.configResolved?.({ root, command: 'build', build });
    pre.transform.call({ warn() {} }, CLIENT_MODULE, path.join(root, 'src/Card.tsx'));
}

afterEach(() => {
    vi.mocked(createRSCModuleRecord).mockClear();
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('a one-shot build whose walk saw no server module', () => {
    it('builds no records', () => {
        const root = project({ 'src/Card.tsx': CLIENT_MODULE, 'src/Other.tsx': CLIENT_MODULE });

        buildThenTransform(root);

        expect(createRSCModuleRecord).not.toHaveBeenCalled();
    });
});

describe('a one-shot build whose walk saw a server module', () => {
    it('builds records when a file carries `use server`', () => {
        const root = project({
            'src/Card.tsx': CLIENT_MODULE,
            'src/actions.ts': "'use server';\nexport async function save() {}\n",
        });

        buildThenTransform(root);

        expect(createRSCModuleRecord).toHaveBeenCalledTimes(1);
    });

    it('builds records when an App Router entry is present', () => {
        const root = project({
            'src/Card.tsx': CLIENT_MODULE,
            'app/page.tsx': 'export default function Page() { return <div />; }\n',
        });

        buildThenTransform(root);

        expect(createRSCModuleRecord).toHaveBeenCalledTimes(1);
    });
});

describe('builds where a server module can still appear after the walk', () => {
    it('keeps building records in a watch build', () => {
        const root = project({ 'src/Card.tsx': CLIENT_MODULE });

        buildThenTransform(root, { watch: {} });

        expect(createRSCModuleRecord).toHaveBeenCalledTimes(1);
    });

    it('keeps building records when no config hook ran at all', () => {
        // The rollup and esbuild lanes reach the transform hook with no walk
        // before it, so nothing has answered the question yet.
        const [pre] = vitePlugin({ build: { cache: false } }) as unknown as [PrePlugin];

        pre.transform.call({ warn() {} }, CLIENT_MODULE, '/repo/src/Card.tsx');

        expect(createRSCModuleRecord).toHaveBeenCalledTimes(1);
    });
});
