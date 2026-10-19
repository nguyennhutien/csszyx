/**
 * A dev server and a webpack watch read `csszyx.config` again when it changes.
 *
 * The file is where diagnostic levels live, and the moment a developer edits
 * it is the moment they want to see the effect: a level raised to `error` to
 * find every site, a rule turned `off` to quiet a noisy one. A session that
 * kept the levels it started with answered that edit with nothing, and the
 * only way to learn the edit worked was to restart.
 *
 * Each case drives the real bundler and its real watcher; what counts is what
 * reached the console.
 */
import { rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import webpack from 'webpack';

import { vitePlugin, webpackPlugin } from '../src/unplugin.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const servers: ViteDevServer[] = [];

afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
    removeTailwindProjects();
    vi.restoreAllMocks();
});

const UNKNOWN = "export const A = () => <div sz={{ workBreak: 'all' }} />;\n";
const UNKNOWN_LINE = '`workBreak` is not an sz property.';
const UNKNOWN_OFF = 'export default { diagnostics: { rules: { "unknown-key": "off" } } };\n';
const UNKNOWN_WARN = 'export default { diagnostics: { rules: { "unknown-key": "warn" } } };\n';
const DEAD_OFF = 'export default { diagnostics: { rules: { "dead-class": "off" } } };\n';
const DEAD_LINE = '`break-bogus` (sz key `break`) is emitted by an sz prop';

/** An `sz` object whose later key covers an earlier one: the merge removes `pb-2`. */
const COVERED = 'export const C = () => <div sz={{ pb: 2, p: 4 }} />;\n';
const MERGE_OFF = 'export default { diagnostics: { rules: { "merge-covered-key": "off" } } };\n';
const MERGE_WARN = 'export default { diagnostics: { rules: { "merge-covered-key": "warn" } } };\n';
const MERGE_LINE = 'src/C.tsx:1: `pb` (`pb-2`) removed: a later key in the same `sz` object';

/** A config whose levels live in a module it imports. */
const LEVELS = 'csszyx.levels.mjs';
const LEVELS_CONFIG = `import rules from './${LEVELS}';\nexport default { diagnostics: { rules } };\n`;
const LEVELS_OFF = 'export default { "unknown-key": "off" };\n';
const LEVELS_WARN = 'export default { "unknown-key": "warn" };\n';

/**
 * Write a file with an mtime no earlier write in the test can share, so a
 * loader keyed on it never serves the text it replaced.
 *
 * @param file - Absolute path.
 * @param text - The new text.
 */
function rewrite(file: string, text: string): void {
    writeFileSync(file, text, 'utf8');
    const later = new Date(Date.now() + 5_000 + Math.floor(Math.random() * 10_000));
    utimesSync(file, later, later);
}

/**
 * Poll until a condition holds.
 *
 * @param check - The condition; run once per tick, and may do work of its own.
 * @param what - What is waited on, for the failure.
 * @param timeoutMs - Budget.
 */
async function until(
    check: () => boolean | Promise<boolean>,
    what: string,
    timeoutMs = 20_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${what}.`);
}

/**
 * Keep every line printed to `console.warn` as it arrives.
 *
 * @returns The live list.
 */
function consoleLines(): string[] {
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    });
    return lines;
}

/** A dev session over one module. */
interface DevSession {
    root: string;
    server: ViteDevServer;
    /** Everything csszyx and the server's logger printed. */
    lines: string[];
    /** The payloads the server sent the page. */
    sent: unknown[];
    /** Ask for the module the way a reloaded page does. */
    request: () => Promise<void>;
    /** Tell the server a file at the root changed, as its watcher does. */
    announce: (event: 'change' | 'add' | 'unlink', name: string) => void;
}

/**
 * Start a dev server over `src/A.tsx`, with an optional config.
 *
 * @param config - `csszyx.config.mjs`, when the case starts with one.
 * @param extra - More files at the root, by name.
 * @returns The session.
 */
async function devSession(
    config?: string,
    extra: Record<string, string> = {},
): Promise<DevSession> {
    const root = tailwindProject('csszyx-config-reload-vite-', {
        'package.json': '{ "name": "app" }\n',
        'src/A.tsx': UNKNOWN,
        ...(config === undefined ? {} : { 'csszyx.config.mjs': config }),
        ...extra,
    });
    const lines = consoleLines();
    const record = (message: string): void => {
        lines.push(message);
    };
    const server = await createServer({
        root,
        configFile: false,
        logLevel: 'silent',
        server: { middlewareMode: true, watch: null },
        customLogger: {
            info() {},
            warn: record,
            warnOnce: record,
            error: record,
            clearScreen() {},
            hasErrorLogged: () => false,
            hasWarned: false,
        } as never,
        plugins: [vitePlugin({ build: { cache: false }, production: { mangle: false } }) as never],
    });
    servers.push(server);
    const sent: unknown[] = [];
    const send = server.ws.send.bind(server.ws) as (payload: unknown) => void;
    server.ws.send = ((payload: unknown) => {
        sent.push(payload);
        send(payload);
    }) as typeof server.ws.send;
    const request = async (): Promise<void> => {
        try {
            await server.transformRequest('/src/A.tsx');
        } catch {
            /* the runtime import does not resolve here; the transform ran */
        }
    };
    await request();
    return {
        root,
        server,
        lines,
        sent,
        request,
        announce: (event, name) => {
            server.watcher.emit(event, join(root, name));
        },
    };
}

/**
 * How many printed lines contain a text.
 *
 * @param lines - The lines.
 * @param text - The text.
 * @returns The count.
 */
function count(lines: readonly string[], text: string): number {
    return lines.filter(line => line.includes(text)).length;
}

describe('a Vite dev server', () => {
    it('reads an edited config and lists a finding it no longer turns off', async () => {
        const dev = await devSession(UNKNOWN_OFF);
        expect(count(dev.lines, UNKNOWN_LINE)).toBe(0);

        rewrite(join(dev.root, 'csszyx.config.mjs'), UNKNOWN_WARN);
        dev.announce('change', 'csszyx.config.mjs');

        await until(async () => {
            await dev.request();
            return count(dev.lines, UNKNOWN_LINE) > 0;
        }, 'the finding at its new level');
        expect(count(dev.lines, UNKNOWN_LINE)).toBe(1);
        expect(dev.sent).toContainEqual(expect.objectContaining({ type: 'full-reload' }));
        expect(dev.lines.join('\n')).toContain(
            '[csszyx] csszyx.config.mjs changed: read its levels again, recompiled every module and reloaded the page.',
        );
    }, 60_000);

    it('lists a finding again at the level an edit gives it', async () => {
        const dev = await devSession(UNKNOWN_WARN);
        expect(count(dev.lines, UNKNOWN_LINE)).toBe(1);

        rewrite(join(dev.root, 'csszyx.config.mjs'), DEAD_OFF);
        dev.announce('change', 'csszyx.config.mjs');

        await until(async () => {
            await dev.request();
            return count(dev.lines, UNKNOWN_LINE) > 1;
        }, 'the finding said again');
        expect(count(dev.lines, UNKNOWN_LINE)).toBe(2);
    }, 60_000);

    it('falls back to the defaults when the config is deleted', async () => {
        const dev = await devSession(UNKNOWN_OFF);
        expect(count(dev.lines, UNKNOWN_LINE)).toBe(0);

        rmSync(join(dev.root, 'csszyx.config.mjs'));
        dev.announce('unlink', 'csszyx.config.mjs');

        await until(async () => {
            await dev.request();
            return count(dev.lines, UNKNOWN_LINE) > 0;
        }, 'the finding at its default level');
    }, 60_000);

    it('reads a config created during the session', async () => {
        const dev = await devSession();
        expect(count(dev.lines, UNKNOWN_LINE)).toBe(1);

        rewrite(join(dev.root, 'csszyx.config.mjs'), UNKNOWN_OFF);
        dev.announce('add', 'csszyx.config.mjs');

        // Vite answers a created file with a reload of its own; the config's
        // read is the one that says so.
        await until(() => count(dev.lines, '[csszyx] csszyx.config.mjs changed:') > 0, 'the read');
        expect(dev.sent).toContainEqual(expect.objectContaining({ type: 'full-reload' }));
        await dev.request();
        expect(count(dev.lines, UNKNOWN_LINE)).toBe(1);
    }, 60_000);

    it('says a dead class again at its new level once the page holds the table', async () => {
        // The dead-class report runs when the merge table is settled, which a
        // page loading the table does; the edit settles it again at once.
        const root = tailwindProject('csszyx-config-reload-dead-', {
            'package.json': '{ "name": "app", "type": "module" }\n',
            'app.css': '@import "tailwindcss";\n',
            'src/B.tsx': "export const B = () => <div sz={{ break: 'bogus', p: 4 }} />;\n",
            'csszyx.config.mjs': DEAD_OFF,
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const lines = consoleLines();
        const server = await createServer({
            root,
            configFile: false,
            logLevel: 'silent',
            server: { middlewareMode: true, watch: null },
            plugins: [vitePlugin({ build: { cache: false }, production: { mangle: false } })],
        });
        servers.push(server);
        await server.ssrLoadModule('virtual:csszyx/unserved');
        expect(count(lines, DEAD_LINE)).toBe(0);

        rewrite(join(root, 'csszyx.config.mjs'), 'export default {};\n');
        server.watcher.emit('change', join(root, 'csszyx.config.mjs'));

        await until(() => count(lines, DEAD_LINE) > 0, 'the dead class at its default level');
        expect(count(lines, DEAD_LINE)).toBe(1);
    }, 60_000);

    it('reads the config again when a module it imports is edited', async () => {
        const dev = await devSession(LEVELS_CONFIG, { [LEVELS]: LEVELS_OFF });
        expect(count(dev.lines, UNKNOWN_LINE)).toBe(0);

        rewrite(join(dev.root, LEVELS), LEVELS_WARN);
        dev.announce('change', LEVELS);

        await until(async () => {
            await dev.request();
            return count(dev.lines, UNKNOWN_LINE) > 0;
        }, 'the finding at the level the imported module now sets');
        expect(dev.lines.join('\n')).toContain(`[csszyx] ${LEVELS} changed:`);
    }, 60_000);

    it('reads the modules a config imports as they are now, not as this process first loaded them', async () => {
        // Node keeps an imported module by URL: a reload in this process sees
        // the config's own edit and every module it imports as first read.
        const dev = await devSession(LEVELS_CONFIG, { [LEVELS]: LEVELS_OFF });
        expect(count(dev.lines, UNKNOWN_LINE)).toBe(0);

        rewrite(join(dev.root, LEVELS), LEVELS_WARN);
        rewrite(join(dev.root, 'csszyx.config.mjs'), `${LEVELS_CONFIG}// edited\n`);
        dev.announce('change', 'csszyx.config.mjs');

        await until(async () => {
            await dev.request();
            return count(dev.lines, UNKNOWN_LINE) > 0;
        }, 'the finding at the level the imported module now sets');
    }, 60_000);

    it('lists the classes the merge removed once an edit raises their level', async () => {
        const dev = await devSession(MERGE_OFF, {
            'src/index.css': '@import "tailwindcss";\n',
            'src/C.tsx': COVERED,
        });
        expect(count(dev.lines, MERGE_LINE)).toBe(0);

        rewrite(join(dev.root, 'csszyx.config.mjs'), MERGE_WARN);
        dev.announce('change', 'csszyx.config.mjs');

        await until(() => count(dev.lines, MERGE_LINE) > 0, 'the removal at its new level');
        expect(count(dev.lines, MERGE_LINE)).toBe(1);
    }, 60_000);

    it('reads an atomic save once: the delete and the create it is made of are one edit', async () => {
        // An editor that saves by replacing the file reports a delete and a
        // create; each read alone printed its own line and reloaded the page.
        const dev = await devSession(LEVELS_CONFIG, { [LEVELS]: LEVELS_OFF });
        const saved = '[csszyx] csszyx.config.mjs changed:';
        dev.announce('unlink', 'csszyx.config.mjs');
        dev.announce('add', 'csszyx.config.mjs');
        await until(() => count(dev.lines, saved) > 0, 'the save read');
        // A later edit is its own read, and is said after the save's.
        rewrite(join(dev.root, LEVELS), LEVELS_WARN);
        dev.announce('change', LEVELS);
        await until(() => count(dev.lines, `[csszyx] ${LEVELS} changed:`) > 0, 'the edit read');
        expect(count(dev.lines, saved)).toBe(1);
    }, 60_000);

    it('ignores a file beside the config that is not one', async () => {
        const dev = await devSession(UNKNOWN_OFF);
        writeFileSync(join(dev.root, 'csszyx.config.mjs.bak'), UNKNOWN_WARN);
        dev.announce('change', 'csszyx.config.mjs.bak');
        dev.announce('change', 'src/csszyx.config.mjs');
        await dev.request();
        expect(dev.sent).not.toContainEqual(expect.objectContaining({ type: 'full-reload' }));
        expect(count(dev.lines, UNKNOWN_LINE)).toBe(0);
    }, 60_000);
});

describe('a webpack watch session', () => {
    it('reads an edited config on the next rebuild', async () => {
        const root = tailwindProject('csszyx-config-reload-webpack-', {
            'package.json': '{ "name": "app" }\n',
            'src/index.css': '@import "tailwindcss";\n',
            'src/index.js': 'export const ready = true;\n',
            // Walked by the prescan, never imported: only the config edit can
            // start the second build.
            'src/A.tsx': "export const A = () => <div sz={{ break: 'bogus', p: 4 }} />;\n",
            'csszyx.config.mjs': DEAD_OFF,
        });
        const settled = new Date(Date.now() - 60 * 60 * 1000);
        for (const file of ['src/index.css', 'src/index.js', 'src/A.tsx', 'csszyx.config.mjs']) {
            utimesSync(join(root, file), settled, settled);
        }
        const lines = consoleLines();
        const compiler = webpack({
            mode: 'development',
            devtool: false,
            context: root,
            entry: './src/index.js',
            output: { path: join(root, 'dist'), filename: 'bundle.js' },
            externals: { '@csszyx/runtime': 'commonjs @csszyx/runtime' },
            plugins: [webpackPlugin({ build: { cache: false }, production: { mangle: false } })],
        });
        const config = join(root, 'csszyx.config.mjs');
        const builds: number[] = [];
        await new Promise<void>((resolve, reject) => {
            let guard: NodeJS.Timeout | undefined;
            const finish = (): void => {
                clearTimeout(guard);
                watching.close(() => compiler.close(() => resolve()));
            };
            const watching = compiler.watch({ aggregateTimeout: 20, poll: 60 }, error => {
                if (error) {
                    reject(error);
                    return;
                }
                builds.push(count(lines, DEAD_LINE));
                if (builds.length === 1) {
                    writeFileSync(config, 'export default {};\n', 'utf8');
                    // A config the build does not depend on never rebuilds.
                    guard = setTimeout(finish, 15_000);
                    return;
                }
                if (count(lines, DEAD_LINE) > 0) finish();
            });
        });

        expect(builds[0]).toBe(0);
        expect(count(lines, DEAD_LINE)).toBe(1);
    }, 60_000);

    it('lists the classes the merge removed once an edit raises their level', async () => {
        const root = tailwindProject('csszyx-config-reload-webpack-merge-', {
            'package.json': '{ "name": "app" }\n',
            'src/index.css': '@import "tailwindcss";\n',
            'src/index.js': 'export const ready = true;\n',
            'src/C.tsx': COVERED,
            'csszyx.config.mjs': MERGE_OFF,
        });
        const settled = new Date(Date.now() - 60 * 60 * 1000);
        for (const file of ['src/index.css', 'src/index.js', 'src/C.tsx', 'csszyx.config.mjs']) {
            utimesSync(join(root, file), settled, settled);
        }
        const lines = consoleLines();
        const compiler = webpack({
            mode: 'development',
            devtool: false,
            context: root,
            entry: './src/index.js',
            output: { path: join(root, 'dist'), filename: 'bundle.js' },
            externals: { '@csszyx/runtime': 'commonjs @csszyx/runtime' },
            plugins: [webpackPlugin({ build: { cache: false }, production: { mangle: false } })],
        });
        const config = join(root, 'csszyx.config.mjs');
        const builds: number[] = [];
        await new Promise<void>((resolve, reject) => {
            let guard: NodeJS.Timeout | undefined;
            const finish = (): void => {
                clearTimeout(guard);
                watching.close(() => compiler.close(() => resolve()));
            };
            const watching = compiler.watch({ aggregateTimeout: 20, poll: 60 }, error => {
                if (error) {
                    reject(error);
                    return;
                }
                builds.push(count(lines, MERGE_LINE));
                if (builds.length === 1) {
                    writeFileSync(config, MERGE_WARN, 'utf8');
                    guard = setTimeout(finish, 15_000);
                    return;
                }
                finish();
            });
        });

        expect(builds).toEqual([0, 1]);
    }, 60_000);
});
