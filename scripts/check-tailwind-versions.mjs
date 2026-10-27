#!/usr/bin/env node

/**
 * Gate csszyx's own output across every Tailwind v4 it serves.
 *
 * One csszyx release serves Tailwind 4.0 → latest (ADR 0023), so what both
 * lanes write must not depend on the Tailwind a project installed
 * (PROJECT-RULES §4). This repository pins one Tailwind, and every other gate
 * compiles against it (ADR 0012: the repo's gate pins). This one installs each
 * version in {@link TAILWIND_VERSIONS} into a scratch directory — never the
 * workspace, never the lockfile — lowers every sz key × value shape once
 * (`packages/tailwind-oracle/tests/sz-capability-cases.ts`, the differential
 * test's case set), and asks each version's design system about the classes,
 * through the same oracle the build uses (ADR 0017: the gate runs the tool,
 * not a rewrite of it). It fails on:
 *
 * - `regressed`: a case one version serves and a later version does not —
 *   Tailwind dropped a spelling csszyx still writes;
 * - `dead`: a case the pin serves and this version does not — a spelling the
 *   lanes adopted from a newer Tailwind, or a utility this version lacks;
 * - `spelling`: a convention-table spelling (`-mt-2`, `cursor-[inherit]`) dead
 *   on a version that serves the utility's plain value (`mt-2`) — a spelling
 *   the lanes must not use there;
 * - `table`: the capability generator, run against this version, disagrees
 *   with the pinned table on a key whose utility exists in this version;
 * - `variant`: a state name (`hidden`, `checked`, or an HTML attribute the
 *   table leaves out because the pin serves it, `inert`) this version serves
 *   as a bare variant and the pin does not, or the other way round — the
 *   runtime reports `unserved-variant` from the table measured on the pin.
 *
 * Each list, per version, is a ratchet baseline in
 * `packages/tailwind-oracle/tests/fixtures/tailwind-versions-baseline.json`:
 * a finding not listed fails, and a listed one that no longer holds fails until
 * it is removed, so the lists only shrink. Rewrite it with `--update` (or
 * `CSSZYX_UPDATE_TAILWIND_VERSIONS_BASELINE=1`) and read the diff.
 *
 * None of this is a verdict about a project's class: that comes from the
 * project's own Tailwind at build (ADR 0012/0022/0026).
 *
 * Installs are cached by version under `$CSSZYX_TAILWIND_VERSIONS_DIR`, else
 * `$RUNNER_TEMP/csszyx-tailwind-versions` (private to the CI job), else
 * `node_modules/.cache/csszyx-tailwind-versions`. Not the shared OS temp
 * directory: another user there could plant the folder an install trusts. Each is
 * an `npm pack` of the exact version whose sha512 must match the one pinned
 * below, unpacked with `tar`; `tailwindcss` v4 has no dependencies to install.
 *
 * Usage:
 *   node --import tsx/esm scripts/check-tailwind-versions.mjs [--update]
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
    HTML_STATE_ATTRIBUTES,
    htmlOnlyStateNames,
    servedStateVariants,
    stateVariantDifferences,
} from './gen-state-variants.mjs';
import { COLUMN_PROBES, COLUMNS, measureCapabilities } from './gen-sz-capabilities.mjs';

/**
 * The Tailwind versions the gate asks, each with the sha512 of its npm
 * tarball. Extend with one line: `npm view tailwindcss@<version> dist.integrity`
 * prints the second field. The version this repository pins must be listed.
 *
 * @type {ReadonlyArray<readonly [version: string, integrity: string]>}
 */
export const TAILWIND_VERSIONS = [
    [
        '4.0.0',
        'sha512-ULRPI3A+e39T7pSaf1xoi58AqqJxVCLg8F/uM5A3FadUbnyDTgltVnXJvdkTjwCOGA6NazqHVcwPJC5h2vRYVQ==',
    ],
    [
        '4.0.17',
        'sha512-OErSiGzRa6rLiOvaipsDZvLMSpsBZ4ysB4f0VKGXUrjw2jfkJRd6kjRKV2+ZmTCNvwtvgdDam5D7w6WXsdLJZw==',
    ],
    [
        '4.1.0',
        'sha512-vBYstoFnvUZCDxaauNGQQEvJNQgCd1vSMDRYuZZMH1xRRcTboOk1rJrW5yFkEabU9X6Yx1C4LQ+QvPOvQj4Daw==',
    ],
    [
        '4.1.18',
        'sha512-4+Z+0yiYyEtUVCScyfHCxOYP06L5Ne+JiHhY2IjR2KWMIWhJOYZKLSGZaP5HkZ8+bY0cxfzwDE5uOmzFXyIwxw==',
    ],
    [
        '4.2.0',
        'sha512-yYzTZ4++b7fNYxFfpnberEEKu43w44aqDMNM9MHMmcKuCH7lL8jJ4yJ7LGHv7rSwiqM0nkiobF9I6cLlpS2P7Q==',
    ],
    [
        '4.2.4',
        'sha512-HhKppgO81FQof5m6TEnuBWCZGgfRAWbaeOaGT00KOy/Pf/j6oUihdvBpA7ltCeAvZpFhW3j0PTclkxsd4IXYDA==',
    ],
    [
        '4.3.0',
        'sha512-y6nxMGB1nMW9R6k96e5gdIFzcfL/gTJRNaqGes1YvkLnPVXzWgbqFF2yLC0T8G774n24cx3Pe8XrKoniCOAH+Q==',
    ],
    [
        '4.3.3',
        'sha512-gOhV3P7ufE62QDGg1zVaTgCR+EtPv92k2nIhVcVKcLmxT1sUBsQGhnZj175j+MqRt4zLF7ic+sCYjfhxMxj7YQ==',
    ],
];

/** Version of the baseline file's shape. */
export const BASELINE_FORMAT = 1;

/** The finding lists, in the order they are reported. */
const KINDS = ['regressed', 'dead', 'spelling', 'table', 'variant'];

/**
 * Values besides the column probes' plain ones whose class, served, shows a
 * prefix has a utility at all in a version (`list-none`, `text-red-500`).
 */
const UTILITY_SAMPLES = ['auto', 'none', 'normal', '[normal]', 'red-500', 'sm', 'md'];

/**
 * Numeric order of two `major.minor.patch` versions.
 *
 * @param {string} left - A version.
 * @param {string} right - Another.
 * @returns {number} Negative, zero or positive.
 */
export function compareVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
    }
    return 0;
}

/**
 * Throw unless the bytes are the tarball the version is pinned to.
 *
 * @param {Buffer} bytes - The tarball.
 * @param {string} integrity - The pinned `sha512-…`.
 * @param {string} version - For the message.
 */
export function verifyIntegrity(bytes, integrity, version) {
    const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (actual !== integrity) {
        throw new Error(
            `tailwindcss@${version}: the tarball is not the pinned one (got ${actual}, pinned ${integrity})`,
        );
    }
}

/**
 * The cases every lane wrote something a Tailwind serves for.
 *
 * @param {ReadonlyArray<{ id: string, outputs: readonly string[] }>} cases - Each
 *        case with what each lane wrote.
 * @param {(token: string) => boolean} alive - Whether the Tailwind serves a class.
 * @returns {Set<string>} The ids of the served cases.
 */
export function servedCases(cases, alive) {
    return new Set(
        cases
            .filter(({ outputs }) =>
                outputs.every(output => {
                    const tokens = output.split(' ').filter(Boolean);
                    return tokens.length > 0 && tokens.every(alive);
                }),
            )
            .map(({ id }) => id),
    );
}

/**
 * Per version, the cases it does not serve that an earlier version did.
 *
 * @param {readonly string[]} versions - Ascending.
 * @param {ReadonlyMap<string, ReadonlySet<string>>} served - Served case ids by version.
 * @returns {Map<string, string[]>} Version to sorted case ids; a case is named
 *          at each version where it is dead after being served before.
 */
export function regressions(versions, served) {
    const seen = new Set();
    return new Map(
        versions.map(version => {
            const here = served.get(version) ?? new Set();
            const lost = [...seen].filter(id => !here.has(id)).sort();
            for (const id of here) seen.add(id);
            for (const id of lost) seen.delete(id);
            return [version, lost];
        }),
    );
}

/**
 * The written cases the pin serves and a version does not.
 *
 * @param {readonly string[]} written - Every case id.
 * @param {ReadonlySet<string>} here - Served on the version.
 * @param {ReadonlySet<string>} pin - Served on the pin.
 * @returns {string[]} Sorted case ids.
 */
export function deadBeyondPin(written, here, pin) {
    return written.filter(id => pin.has(id) && !here.has(id)).sort();
}

/**
 * Convention-table spellings a version does not serve on a utility whose
 * plain value it does serve.
 *
 * @param {Readonly<Record<string, string>>} propertyMap - sz key to prefix.
 * @param {Readonly<Record<string, string>>} pinned - The pinned table.
 * @param {(token: string) => boolean} alive - Whether the version serves a class.
 * @returns {string[]} One line per key and column, in key order.
 */
export function spellingFindings(propertyMap, pinned, alive) {
    const findings = [];
    for (const [key, prefix] of Object.entries(propertyMap)) {
        for (const [column, letter] of COLUMNS) {
            if (!(pinned[key] ?? '').includes(letter)) continue;
            const { probe, plain } = COLUMN_PROBES[column];
            const servedPlain = plain(prefix).find(alive);
            if (servedPlain !== undefined && !alive(probe(prefix))) {
                findings.push(`${key}: ${probe(prefix)} is dead, ${servedPlain} is served`);
            }
        }
    }
    return findings;
}

/**
 * Rows the generator measured on a version that differ from the pinned table,
 * on keys whose utility exists in that version.
 *
 * @param {Readonly<Record<string, string>>} propertyMap - sz key to prefix.
 * @param {Readonly<Record<string, string>>} pinned - The pinned table.
 * @param {ReadonlyMap<string, string>} measured - The version's rows.
 * @param {(prefix: string) => boolean} exists - Whether the version has the utility.
 * @returns {string[]} One line per key, in key order.
 */
export function tableFindings(propertyMap, pinned, measured, exists) {
    return [...measured]
        .filter(([key, columns]) => (pinned[key] ?? '') !== columns && exists(propertyMap[key]))
        .map(([key, columns]) => `${key}: pinned '${pinned[key] ?? ''}', measured '${columns}'`);
}

/**
 * What differs from a version's baseline: findings it does not list, and
 * listed ones that no longer hold.
 *
 * @param {Readonly<Record<string, readonly string[]>>} found - Findings by kind.
 * @param {Readonly<Record<string, readonly string[]>> | undefined} baseline - The version's baseline.
 * @returns {string[]} One line per difference, by kind.
 */
export function compareWithBaseline(found, baseline) {
    const lines = [];
    for (const kind of KINDS) {
        const now = found[kind] ?? [];
        const listed = new Set(baseline?.[kind] ?? []);
        for (const entry of now)
            if (!listed.has(entry)) lines.push(`${kind}: ${entry} (not in the baseline)`);
        const current = new Set(now);
        for (const entry of listed) {
            if (!current.has(entry))
                lines.push(`${kind}: ${entry} no longer found — remove it from the baseline`);
        }
    }
    return lines;
}

/**
 * The baseline file's text. Each list is written as an object of `entry: true`
 * rather than an array: the formatter folds a short array onto one line, so a
 * regenerated array would not be the formatted file, while an object written
 * one key per line stays as written.
 *
 * @param {string} pin - The pinned Tailwind version.
 * @param {Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>} found - Findings
 *        by version and kind.
 * @returns {string} JSON, with a trailing newline.
 */
export function renderBaseline(pin, found) {
    const versions = Object.fromEntries(
        Object.entries(found).map(([version, kinds]) => [
            version,
            Object.fromEntries(
                KINDS.map(kind => [
                    kind,
                    Object.fromEntries((kinds[kind] ?? []).map(entry => [entry, true])),
                ]),
            ),
        ]),
    );
    return `${JSON.stringify({ format: BASELINE_FORMAT, pin, versions }, null, 4)}\n`;
}

/**
 * Read the baseline file back into findings by version and kind.
 *
 * @param {string} text - The file.
 * @returns {{ format: number, pin?: string, versions: Record<string, Record<string, string[]>> }}
 *          The baseline, each list as an array.
 */
export function readBaseline(text) {
    const parsed = JSON.parse(text);
    return {
        ...parsed,
        versions: Object.fromEntries(
            Object.entries(parsed.versions ?? {}).map(([version, kinds]) => [
                version,
                Object.fromEntries(
                    Object.entries(kinds).map(([kind, entries]) => [kind, Object.keys(entries)]),
                ),
            ]),
        ),
    };
}

/**
 * The directory a version is installed in, installing it on a miss.
 *
 * The tarball is unpacked beside its final place and renamed in, so an
 * interrupted run leaves no half-installed version for the next one to trust.
 *
 * @param {string} root - The cache root.
 * @param {string} version - Exact version.
 * @param {string} integrity - Its pinned sha512.
 * @returns {{ dir: string, cached: boolean }} Where it resolves from, and whether it was there.
 */
function installVersion(root, version, integrity) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not an exact version: ${version}`);
    const dir = path.join(root, `tw-${version}`);
    const target = path.join(dir, 'node_modules', 'tailwindcss');
    const manifest = path.join(target, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).version === version) {
        return { dir, cached: true };
    }
    mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), '{ "private": true }\n');
    const [packed] = JSON.parse(
        execFileSync('npm', ['pack', `tailwindcss@${version}`, '--json', '--silent'], {
            cwd: dir,
            encoding: 'utf8',
        }),
    );
    const tarball = path.join(dir, packed.filename);
    try {
        verifyIntegrity(readFileSync(tarball), integrity, version);
        const staging = `${target}.partial-${process.pid}`;
        rmSync(staging, { recursive: true, force: true });
        mkdirSync(staging);
        execFileSync('tar', ['-xzf', tarball, '-C', staging, '--strip-components=1']);
        rmSync(target, { recursive: true, force: true });
        renameSync(staging, target);
    } finally {
        rmSync(tarball, { force: true });
    }
    return { dir, cached: false };
}

/**
 * The engine artifacts that load here. Under CI both must: a gate that ran on
 * one artifact would pass for the other.
 *
 * @returns {Promise<Array<readonly [string, Function]>>} Name and transform.
 */
async function loadEngines() {
    const {
        isRustTransformAvailable,
        transformRust,
        transformWasm,
        WasmTransformUnavailableError,
    } = await import('../packages/compiler/src/engine.js');
    const engines = [];
    const missing = [];
    try {
        transformWasm('export const A = () => <p />;', { filename: '/p/src/Probe.jsx' });
        engines.push(['wasm', transformWasm]);
    } catch (error) {
        // Only a missing artifact is a lane to skip; any other throw is the
        // probe or the engine failing, and would read as a missing build.
        if (!(error instanceof WasmTransformUnavailableError)) throw error;
        missing.push('wasm (`pnpm --filter @csszyx/core build`)');
    }
    if (isRustTransformAvailable()) engines.push(['rust', transformRust]);
    else missing.push('rust (`pnpm --filter @csszyx/core native:build -- --native-engine`)');
    if (missing.length > 0) {
        const message = `engine artifact unavailable: ${missing.join(', ')}`;
        if (process.env.CI) throw new Error(message);
        console.warn(`[check-tailwind-versions] ${message}; gating the lanes that loaded`);
    }
    return engines;
}

/** Run the gate. */
async function main() {
    const repoRoot = path.resolve(import.meta.dirname, '..');
    const baselinePath = path.join(
        repoRoot,
        'packages/tailwind-oracle/tests/fixtures/tailwind-versions-baseline.json',
    );
    const update =
        process.argv.includes('--update') ||
        process.env.CSSZYX_UPDATE_TAILWIND_VERSIONS_BASELINE === '1';
    const started = performance.now();
    const pin = JSON.parse(
        readFileSync(
            createRequire(path.join(repoRoot, 'package.json')).resolve('tailwindcss/package.json'),
            'utf8',
        ),
    ).version;
    const versions = TAILWIND_VERSIONS.map(([version]) => version);
    if (!versions.includes(pin)) {
        throw new Error(`the pinned tailwindcss ${pin} is not in TAILWIND_VERSIONS; add it`);
    }

    const { ARIA_STATES, PROPERTY_MAP } = await import(
        '../packages/compiler/src/transform-core.js'
    );
    const { SZ_CAPABILITIES } = await import(
        '../packages/compiler/src/sz-capabilities.generated.js'
    );
    const { SERVED_STATE_VARIANTS, STATE_VARIANT_FORMS } = await import(
        '../packages/compiler/src/state-variants.generated.js'
    );
    // The HTML attributes the table leaves out are served bare by the pin (its
    // generator fails otherwise), so a version that does not serve one differs.
    const htmlOnly = htmlOnlyStateNames(ARIA_STATES, HTML_STATE_ATTRIBUTES);
    const stateNames = [...Object.keys(STATE_VARIANT_FORMS), ...htmlOnly];
    const pinnedStates = [...SERVED_STATE_VARIANTS, ...htmlOnly];
    const { lowerEveryCase } = await import(
        '../packages/tailwind-oracle/tests/sz-capability-cases.js'
    );
    const engines = await loadEngines();
    const lowered = lowerEveryCase(engines).map(c => ({
        id: c.id,
        outputs: [
            ...new Set([c.runtime.className, ...c.engines.map(([, out]) => out.className)]),
        ].map(output => (output === '<throw>' ? '' : output)),
    }));
    const tokens = [
        ...new Set(lowered.flatMap(c => c.outputs.flatMap(o => o.split(' ')).filter(Boolean))),
    ];
    const prefixes = [...new Set(Object.values(PROPERTY_MAP))];
    const utilityOf = new Map(
        prefixes.map(prefix => [
            prefix,
            [
                ...Object.values(COLUMN_PROBES).flatMap(({ plain }) => plain(prefix)),
                ...UTILITY_SAMPLES.map(sample => `${prefix}-${sample}`),
            ],
        ]),
    );
    const probes = prefixes.flatMap(prefix =>
        Object.values(COLUMN_PROBES).map(({ probe }) => probe(prefix)),
    );
    const asked = [...new Set([...tokens, ...[...utilityOf.values()].flat(), ...probes])];
    const lowerMs = performance.now() - started;

    const root =
        process.env.CSSZYX_TAILWIND_VERSIONS_DIR ??
        (process.env.RUNNER_TEMP === undefined
            ? path.join(repoRoot, 'node_modules', '.cache', 'csszyx-tailwind-versions')
            : path.join(process.env.RUNNER_TEMP, 'csszyx-tailwind-versions'));
    const served = new Map();
    const perVersion = new Map();
    for (const [version, integrity] of TAILWIND_VERSIONS) {
        const t0 = performance.now();
        const { dir, cached } =
            version === pin
                ? { dir: repoRoot, cached: true }
                : installVersion(root, version, integrity);
        const t1 = performance.now();
        const {
            version: resolved,
            rows,
            oracle,
        } = await measureCapabilities({
            resolveFrom: dir,
            propertyMap: PROPERTY_MAP,
            tolerate: () => {},
        });
        if (resolved !== version)
            throw new Error(`asked for tailwindcss ${version}, got ${resolved}`);
        const dead = new Set(oracle.findDead(asked));
        const alive = token => !dead.has(token);
        served.set(version, servedCases(lowered, alive));
        const existing = new Set(prefixes.filter(prefix => utilityOf.get(prefix).some(alive)));
        perVersion.set(version, {
            spelling: spellingFindings(PROPERTY_MAP, SZ_CAPABILITIES, alive),
            table: tableFindings(PROPERTY_MAP, SZ_CAPABILITIES, rows, prefix =>
                existing.has(prefix),
            ),
            variant: stateVariantDifferences(
                servedStateVariants(stateNames, oracle.findDead),
                pinnedStates,
                stateNames,
            ),
            timing: { install: t1 - t0, ask: performance.now() - t1, cached },
        });
    }
    const lost = regressions(versions, served);
    const ids = lowered.map(c => c.id);
    const found = Object.fromEntries(
        versions.map(version => [
            version,
            {
                regressed: lost.get(version) ?? [],
                dead:
                    version === pin ? [] : deadBeyondPin(ids, served.get(version), served.get(pin)),
                spelling: perVersion.get(version).spelling,
                table: perVersion.get(version).table,
                variant: perVersion.get(version).variant,
            },
        ]),
    );

    if (update) writeFileSync(baselinePath, renderBaseline(pin, found));
    const baseline = existsSync(baselinePath)
        ? readBaseline(readFileSync(baselinePath, 'utf8'))
        : { format: BASELINE_FORMAT, versions: {} };
    const problems = [];
    if (baseline.format !== BASELINE_FORMAT) {
        problems.push(`baseline format ${baseline.format}; this gate reads ${BASELINE_FORMAT}`);
    }
    const ms = value => `${Math.round(value)} ms`;
    console.log(
        `[check-tailwind-versions] ${lowered.length} cases, ${tokens.length} classes, ` +
            `${engines.length} engine artifact(s), lowered in ${ms(lowerMs)}; pin ${pin}`,
    );
    for (const version of versions) {
        const { timing } = perVersion.get(version);
        const counts = KINDS.map(kind => `${kind} ${found[version][kind].length}`).join(', ');
        console.log(
            `  ${version}${version === pin ? ' (pin)' : ''}: ${counts} — ` +
                `${timing.cached ? 'cached' : `installed in ${ms(timing.install)}`}, asked in ${ms(timing.ask)}`,
        );
        for (const line of compareWithBaseline(found[version], baseline.versions?.[version])) {
            problems.push(`${version} ${line}`);
        }
    }
    for (const version of Object.keys(baseline.versions ?? {})) {
        if (!versions.includes(version))
            problems.push(`${version}: in the baseline, not in TAILWIND_VERSIONS`);
    }
    console.log(`[check-tailwind-versions] total ${ms(performance.now() - started)}`);
    if (problems.length > 0) {
        console.error(
            `[check-tailwind-versions] ${problems.length} difference(s) from the baseline:\n` +
                problems.map(line => `  ${line}`).join('\n') +
                '\nA spelling the lanes write must hold on every listed Tailwind (PROJECT-RULES §4). ' +
                'Fix the lowering, or rerun with --update and justify the baseline diff.',
        );
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
