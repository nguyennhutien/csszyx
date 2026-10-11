/**
 * The jest transform reads `csszyx.config` itself when no Next command has
 * resolved it into `.csszyx/diagnostic-policy.json`, or resolved an older
 * version of it: a jest-only run honours the levels the file sets.
 *
 * The config is loaded by the built `dist/diagnostics.mjs` in a child process,
 * so these cases need `pnpm --filter @csszyx/unplugin build` first.
 */
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    diagnosticPolicyStatePath,
    loadDiagnosticPolicy,
    writeDiagnosticPolicyState,
} from '../src/csszyx-config-file.js';
import { createDiagnosticPolicy } from '../src/diagnostic-policy.js';
import { diagnosticPolicyInputs } from '../src/diagnostic-policy-inputs.js';
import { createTransformer } from '../src/jest-transform.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

const UNKNOWN = "export const A = () => <div sz={{ workBreak: 'all' }} />;\n";
const PRECEDENCE =
    'export const A = ({ className }: { className?: string }) => <div className={className} sz={{ p: 4 }} />;\n';
const OFF = 'export default { diagnostics: { rules: { "unknown-key": "off" } } };\n';
const ATOMIC = 'export default { diagnostics: { preset: "atomic" } };\n';
const MISSPELT = 'export default { diagnostics: { rules: { "unknown-keyy": "off" } } };\n';

/**
 * A project with `src/A.tsx` and a `csszyx.config.mjs`.
 *
 * @param source - `src/A.tsx`.
 * @param config - `csszyx.config.mjs`.
 * @returns The root and the file.
 */
function project(source: string, config: string): { root: string; file: string } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-jest-config-')));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{ "name": "app" }\n');
    const file = join(root, 'src/A.tsx');
    writeFileSync(file, source);
    writeFileSync(join(root, 'csszyx.config.mjs'), config);
    return { root, file };
}

/**
 * Transform the file the way jest does, once per transformer.
 *
 * @param input - The project and how many transformers run in the worker.
 * @param input.root - The project root.
 * @param input.file - `src/A.tsx`.
 * @param input.source - Its text.
 * @param input.transformers - Transformers created in the same worker.
 * @returns Every csszyx line printed.
 */
function jest(input: { root: string; file: string; source: string; transformers?: number }) {
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    });
    for (let n = 0; n < (input.transformers ?? 1); n++) {
        createTransformer({
            root: input.root,
            cacheRoot: join(input.root, `no-cache-${n}`),
        }).process(input.source, input.file);
    }
    return lines.filter(line => line.includes('[csszyx]'));
}

describe('the jest transform with csszyx.config and no state file', () => {
    it('drops a kind the config sets to off', () => {
        expect(jest({ ...project(UNKNOWN, OFF), source: UNKNOWN })).toEqual([]);
    });

    it('prints a note the config raises', () => {
        expect(jest({ ...project(PRECEDENCE, ATOMIC), source: PRECEDENCE }).join('\n')).toContain(
            'takes precedence over the runtime "className"',
        );
    });

    it('prints the config problems once per worker, in the text the other lanes print', () => {
        const lines = jest({ ...project(UNKNOWN, MISSPELT), source: UNKNOWN, transformers: 2 });
        const problems = lines.filter(line => line.includes('csszyx.config.mjs has 1 problem(s)'));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('unknown-keyy');
        expect(problems[0]).toContain('Each one is ignored; the rest of the file applies.');
    });

    it('passes on what the child printed and keeps the defaults when it does not finish', () => {
        const exits = 'process.stderr.write("[csszyx] config side effect\\n");\nprocess.exit(3);\n';
        const lines = jest({ ...project(UNKNOWN, exits), source: UNKNOWN }).join('\n');
        expect(lines).toContain('[csszyx] config side effect');
        expect(lines).toContain('Unknown property');
    });
});

describe('a config that does more than export its levels', () => {
    it('applies the levels of a config that logs while it loads', () => {
        // A `console.log`, or a dotenv banner, lands on the child's stdout
        // beside the result; reading the whole stream as JSON broke every file.
        const logs = `console.log("loading csszyx config");\n${OFF}`;
        expect(jest({ ...project(UNKNOWN, logs), source: UNKNOWN })).toEqual([]);
    });

    it('says the levels were not read, and keeps the defaults, when the loader prints no result', () => {
        const ends = 'process.exit(0);\nexport default {};\n';
        const lines = jest({ ...project(UNKNOWN, ends), source: UNKNOWN }).join('\n');
        expect(lines).toContain(
            '[csszyx] jest could not read the levels csszyx.config.mjs sets: the config loader printed no result.',
        );
        expect(lines).toContain('Unknown property');
    });

    it('stops waiting for a config that never finishes loading', () => {
        vi.stubEnv('CSSZYX_JEST_CONFIG_TIMEOUT_MS', '300');
        const hangs =
            'setInterval(() => {}, 1000);\nawait new Promise(() => {});\nexport default {};\n';
        const lines = jest({ ...project(UNKNOWN, hangs), source: UNKNOWN }).join('\n');
        expect(lines).toContain(
            '[csszyx] jest could not read the levels csszyx.config.mjs sets: it did not finish loading within 0.3 s.',
        );
        expect(lines).toContain('Unknown property');
    }, 30_000);

    it('keeps the defaults when the marked result line does not parse', () => {
        // A child cut off mid-write leaves the mark and half a result.
        const cut =
            'process.stdout.write("\\n@@csszyx-jest-config-result@@{\\"state\\":");\nprocess.exit(0);\nexport default {};\n';
        const lines = jest({ ...project(UNKNOWN, cut), source: UNKNOWN }).join('\n');
        expect(lines).toContain('the config loader printed no result.');
        expect(lines).toContain('Unknown property');
    });

    it('stops reading a config that prints more than a worker keeps', () => {
        const floods = 'process.stdout.write("x".repeat(17 * 1024 * 1024));\nexport default {};\n';
        const lines = jest({ ...project(UNKNOWN, floods), source: UNKNOWN }).join('\n');
        expect(lines).toContain(
            '[csszyx] jest could not read the levels csszyx.config.mjs sets: spawnSync',
        );
        expect(lines).toContain('ENOBUFS');
        expect(lines).toContain('Unknown property');
    }, 30_000);
});

describe('when the jest transform loads the config', () => {
    it('does not load it to compute a cache key, or for a file with nothing to report', () => {
        // A fully cached run never reports, so it must not pay for the child.
        const clean = 'export const A = () => <div sz={{ p: 4 }} />;\n';
        const { root, file } = project(clean, MISSPELT);
        const lines = jest({ root, file, source: clean });
        createTransformer({ root, cacheRoot: join(root, 'no-cache-key') }).getCacheKey(
            clean,
            file,
            { config: { rootDir: root } } as never,
        );
        expect(lines).toEqual([]);
    });
});

describe('the jest transform with a state file', () => {
    /**
     * Write the state file the way `csszyx next prebuild` does: the inputs
     * first, then the policy the config loads to.
     *
     * @param root - The project root.
     */
    async function prebuild(root: string): Promise<void> {
        const inputs = diagnosticPolicyInputs(root);
        writeDiagnosticPolicyState(root, (await loadDiagnosticPolicy(root)).policy, inputs);
    }

    /** A config whose levels live in a module it imports. */
    const IMPORTS_LEVELS =
        'import rules from "./levels.mjs";\nexport default { diagnostics: { rules } };\n';
    const SAYS_LOADED = 'process.stderr.write("[csszyx] config loaded\\n");\n';

    it('reads the config when it changed since the state was written', async () => {
        const { root, file } = project(UNKNOWN, OFF);
        await prebuild(root);
        writeFileSync(join(root, 'csszyx.config.mjs'), `${SAYS_LOADED}${OFF}`);
        expect(jest({ root, file, source: UNKNOWN })).toEqual(['[csszyx] config loaded\n']);
    });

    it('reads the config when a module it imports changed since the state was written', async () => {
        const { root, file } = project(UNKNOWN, IMPORTS_LEVELS);
        writeFileSync(join(root, 'levels.mjs'), 'export default { "unknown-key": "warn" };\n');
        await prebuild(root);
        // The config file itself is as the state records it; only its import moved.
        writeFileSync(join(root, 'levels.mjs'), 'export default { "unknown-key": "off" };\n');
        const later = new Date(Date.now() + 60_000);
        utimesSync(join(root, 'levels.mjs'), later, later);
        expect(jest({ root, file, source: UNKNOWN })).toEqual([]);
    });

    it('reads the state file, and loads nothing, while every file it records is unchanged', async () => {
        // The state says `recommended`; loading the config would print a line.
        const { root, file } = project(UNKNOWN, `${SAYS_LOADED}${IMPORTS_LEVELS}`);
        writeFileSync(join(root, 'levels.mjs'), 'export default {};\n');
        writeDiagnosticPolicyState(root, createDiagnosticPolicy(), diagnosticPolicyInputs(root));
        const lines = jest({ root, file, source: UNKNOWN }).join('\n');
        expect(lines).toContain('Unknown property');
        expect(lines).not.toContain('config loaded');
    });

    it('reads the config when the state file is of another format', () => {
        const { root, file } = project(UNKNOWN, OFF);
        writeDiagnosticPolicyState(root, createDiagnosticPolicy(), diagnosticPolicyInputs(root));
        const state = JSON.parse(readFileSync(diagnosticPolicyStatePath(root), 'utf8'));
        writeFileSync(diagnosticPolicyStatePath(root), JSON.stringify({ ...state, format: 1 }));
        // Said once, and the levels are the config's, which turns the finding off.
        expect(jest({ root, file, source: UNKNOWN })).toEqual([
            expect.stringContaining('diagnostic-policy.json is in format 1'),
        ]);
    });

    it('takes the defaults, and loads nothing, once the config the state records is gone', () => {
        const { root, file } = project(UNKNOWN, OFF);
        writeDiagnosticPolicyState(
            root,
            createDiagnosticPolicy({ rules: { 'unknown-key': 'off' } }),
            diagnosticPolicyInputs(root),
        );
        rmSync(join(root, 'csszyx.config.mjs'));
        expect(jest({ root, file, source: UNKNOWN }).join('\n')).toContain('Unknown property');
    });
});
