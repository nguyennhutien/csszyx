/**
 * What the build-time manifest actually buys a `dynamic()` app.
 *
 * `csszyx-manifest.json` ships on every production build. Only `@csszyx/dynamic`
 * fetches it, and it answers one question per class: "is this already in the
 * built CSS?" A yes means `dynamic()` reuses the existing rule; a no — or no
 * manifest at all — means it generates and injects one.
 *
 * So the file is a wager: pay its transfer size once, to avoid injecting rules
 * for classes the stylesheet already has. This measures both sides of that
 * wager at several hit rates, because the answer is a crossover, not a verdict.
 *
 * Runs the real `@csszyx/dynamic` against the mock CSSOM its own suite uses, so
 * the injected byte counts are the ones a browser would receive.
 *
 * Usage: `pnpm bench:dynamic-manifest`
 */

import { gzipSync } from 'node:zlib';

/** One measured scenario. */
interface Scenario {
    /** Human-readable label. */
    name: string;
    /** Fraction of requested classes the manifest already covers. */
    hitRate: number;
    /** Whether a manifest is served at all. */
    manifest: boolean;
    /** Render BEFORE the manifest resolves, which is what an app that never
     * calls `preloadManifest` actually does: the fetch is async and `dynamic()`
     * is not, so the first paint asks a manifest that has not arrived. */
    lateArrival?: boolean;
    /** Extra classes the app has but `dynamic()` never asks for.
     *
     * The decisive variable, and the one a same-size comparison hides: the
     * manifest lists EVERY class the build emitted, while `dynamic()` only asks
     * about the handful it renders. A real app pays for the whole census to
     * answer a few questions. */
    padClasses?: number;
}

/** Result of one scenario run. */
interface Measurement {
    name: string;
    manifestBytes: number;
    manifestGzip: number;
    injectedRules: number;
    injectedBytes: number;
    injectedGzip: number;
    /** Manifest transfer plus injected CSS, both gzipped — what the user pays. */
    totalGzip: number;
    microseconds: number;
}

/** A rule store standing in for the browser's constructable stylesheets. */
class MockSheet {
    cssRules: Array<{ cssText: string }> = [];
    /**
     * Insert one rule at a position, as CSSOM does.
     *
     * @param text - Rule text.
     * @param index - Insert position.
     */
    insertRule(text: string, index: number): void {
        this.cssRules.splice(index, 0, { cssText: text });
    }
}

/**
 * Install the mock CSSOM globals `@csszyx/dynamic` writes through.
 *
 * @returns The sheets the injector will adopt.
 */
function installMockCssom(): MockSheet[] {
    const sheets: MockSheet[] = [];
    let adopted: MockSheet[] = [];
    const doc = {
        get adoptedStyleSheets() {
            return adopted;
        },
        set adoptedStyleSheets(value: MockSheet[]) {
            adopted = value;
            sheets.length = 0;
            sheets.push(...value);
        },
    };
    const globals = globalThis as Record<string, unknown>;
    globals.CSSStyleSheet = MockSheet;
    globals.document = doc;
    globals.window = { document: doc };
    return sheets;
}

/**
 * The sz objects the benchmark drives through `dynamic()`.
 *
 * Shaped like a real component sheet rather than a synthetic list: a few dozen
 * distinct utilities, some variants, some arbitrary values.
 *
 * @param count - How many objects to build.
 * @returns One sz object per simulated component.
 */
function buildSzObjects(count: number): Array<Record<string, unknown>> {
    const palettes = ['blue', 'red', 'green', 'amber', 'slate'];
    const objects: Array<Record<string, unknown>> = [];
    for (let index = 0; index < count; index += 1) {
        const palette = palettes[index % palettes.length];
        objects.push({
            p: (index % 8) + 1,
            bg: `${palette}-${((index % 9) + 1) * 100}`,
            rounded: index % 2 === 0 ? 'lg' : 'md',
            hover: { bg: `${palette}-${((index % 8) + 2) * 100}` },
        });
    }
    return objects;
}

/**
 * A plausible utility class name for census padding.
 *
 * Drawn from the same vocabulary a build emits, so the padding gzips like the
 * real thing rather than like a counter.
 *
 * @param index - Sequence number.
 * @returns One class name.
 */
function paddingClassName(index: number): string {
    const prefixes = ['mt', 'mb', 'ml', 'mr', 'pt', 'pb', 'gap', 'w', 'h', 'text', 'border'];
    const variants = ['', 'hover:', 'md:', 'lg:', 'dark:', 'focus:'];
    const prefix = prefixes[index % prefixes.length];
    const variant = variants[Math.floor(index / prefixes.length) % variants.length];
    return `${variant}${prefix}-${(index % 96) + 1}`;
}

/**
 * Total bytes of every rule the injector added.
 *
 * @param sheets - Adopted mock sheets.
 * @returns Rule count and concatenated CSS.
 */
function injectedCss(sheets: readonly MockSheet[]): { rules: number; css: string } {
    let rules = 0;
    let css = '';
    for (const sheet of sheets) {
        for (const rule of sheet.cssRules) {
            rules += 1;
            css += rule.cssText;
        }
    }
    return { rules, css };
}

/**
 * Run one scenario end to end and measure both sides of the wager.
 *
 * @param scenario - Scenario under test.
 * @param objects - sz objects to render.
 * @param everyClass - Every class the objects can produce, in discovery order.
 * @returns The measurement.
 */
async function measure(
    scenario: Scenario,
    objects: ReadonlyArray<Record<string, unknown>>,
    everyClass: readonly string[],
): Promise<Measurement> {
    const sheets = installMockCssom();
    // The package's own `cleanup()` is the reset, not a fresh import: a query
    // string only busts the entry module, and the injector it pulls in resolves
    // to one shared URL — so the first scenario's injected set would answer for
    // every scenario after it, and the whole table would read zero. Measured
    // that mistake before catching it.
    const csszyx = await import('../packages/dynamic/src/index.ts');
    csszyx.cleanup();

    let manifestBytes = 0;
    let manifestGzip = 0;
    if (scenario.manifest) {
        const covered = [
            ...everyClass.slice(0, Math.round(everyClass.length * scenario.hitRate)),
            // Padding stands in for the rest of the app's census: real class
            // names, so the payload compresses the way a real one does.
            ...Array.from({ length: scenario.padClasses ?? 0 }, (_, index) =>
                paddingClassName(index),
            ),
        ];
        const payload = JSON.stringify({
            version: '0.4.0',
            buildId: 'bench',
            classes: covered,
        });
        manifestBytes = Buffer.byteLength(payload);
        manifestGzip = gzipSync(payload).length;
        // Serve it through the real fetch path rather than reaching into module
        // state: the point is to measure what the shipped code does, and a
        // bench-only seam in production source would be measuring something
        // else.
        (globalThis as Record<string, unknown>).fetch = () =>
            Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(payload)) });
        if (!scenario.lateArrival) await csszyx.preloadManifest();
        else void csszyx.preloadManifest();
    }

    const started = process.hrtime.bigint();
    for (const object of objects) {
        csszyx.dynamic(object);
    }
    const elapsed = Number(process.hrtime.bigint() - started) / 1000;

    const { rules, css } = injectedCss(sheets);
    const injectedGzip = css.length > 0 ? gzipSync(css).length : 0;
    return {
        name: scenario.name,
        manifestBytes,
        manifestGzip,
        injectedRules: rules,
        injectedBytes: Buffer.byteLength(css),
        injectedGzip,
        totalGzip: manifestGzip + injectedGzip,
        microseconds: elapsed,
    };
}

/**
 * Render one measurement row.
 *
 * @param row - The measurement.
 * @returns Table row text.
 */
function formatRow(row: Measurement): string {
    const cells = [
        row.name.padEnd(26),
        `${row.manifestGzip.toString().padStart(7)}`,
        `${row.injectedRules.toString().padStart(6)}`,
        `${row.injectedGzip.toString().padStart(8)}`,
        `${row.totalGzip.toString().padStart(9)}`,
        `${row.microseconds.toFixed(0).padStart(8)}`,
    ];
    return `| ${cells.join(' | ')} |`;
}

/**
 * Build sz objects whose classes never repeat.
 *
 * Each object contributes four fresh classes, so the rendered class count grows
 * strictly with the number of objects. An earlier version cycled through a fixed
 * palette, and past ninety objects it stopped producing anything new — the table
 * then showed injected bytes flat from 50% upward, which read like a finding and
 * was an artefact.
 *
 * @param targetClasses - How many distinct classes the app census should hold.
 * @returns One sz object per simulated component.
 */
function buildCensusObjects(targetClasses: number): Array<Record<string, unknown>> {
    const objects: Array<Record<string, unknown>> = [];
    for (let index = 0; index < Math.ceil(targetClasses / 4); index += 1) {
        objects.push({
            // Arbitrary values keyed on the index: unique by construction, and
            // the shape a runtime-computed style actually takes.
            p: `${index + 1}px`,
            w: `${index + 3}rem`,
            bg: `#${(index * 7919).toString(16).padStart(6, '0').slice(-6)}`,
            hover: { mt: `${index + 5}px` },
        });
    }
    return objects;
}

/**
 * The dynamic-ratio matrix: how much of the app's own census goes through
 * `dynamic()` at runtime, from none of it to all of it.
 *
 * The manifest always lists the WHOLE census, because that is what the build
 * emits; only the runtime side varies. Where the two columns cross is the
 * entire decision.
 *
 * @param census - Objects covering the app's full class vocabulary.
 * @param everyClass - The census's distinct classes.
 */
async function ratioMatrix(
    census: ReadonlyArray<Record<string, unknown>>,
    everyClass: readonly string[],
): Promise<void> {
    const manifestGzip = gzipSync(
        JSON.stringify({ version: '0.4.0', buildId: 'bench', classes: everyClass }),
    ).length;

    console.log(
        `\nC. How much of the app runs through dynamic() — ` +
            `${everyClass.length}-class census, manifest ${manifestGzip} B gz\n`,
    );
    console.log('| dynamic share | classes | with manifest | without | cheaper     |');
    console.log('| ------------- | ------- | ------------- | ------- | ----------- |');

    for (const ratio of [0, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1]) {
        const rendered = census.slice(0, Math.round(census.length * ratio));
        const csszyx = await import('../packages/dynamic/src/index.ts');
        csszyx.cleanup();
        const sheets = installMockCssom();
        const classes = new Set<string>();
        for (const object of rendered) {
            for (const name of csszyx.dynamic(object).split(' ')) if (name) classes.add(name);
        }
        const { css } = injectedCss(sheets);
        const withoutManifest = css.length > 0 ? gzipSync(css).length : 0;
        csszyx.cleanup();

        // With a manifest the app pays its transfer and injects nothing: every
        // class it renders is one the build already emitted.
        const cheaper = manifestGzip < withoutManifest ? 'manifest' : 'no manifest';
        console.log(
            `| ${`${(ratio * 100).toFixed(0)}%`.padStart(13)} | ${String(classes.size).padStart(7)} | ` +
                `${String(manifestGzip).padStart(13)} | ${String(withoutManifest).padStart(7)} | ` +
                `${cheaper.padEnd(11)} |`,
        );
    }
    console.log(
        '\nThe manifest only wins once most of the app is rendered through dynamic(), which\n' +
            'is the shape csszyx exists to avoid — and even then only if the app awaits\n' +
            'preloadManifest before its first render. Otherwise it pays both columns.',
    );
}

/**
 * Entry point.
 */
async function main(): Promise<void> {
    const objects = buildSzObjects(120);
    // Discover the full class vocabulary through a throwaway run, so the
    // manifest fixtures contain exactly the classes the app will ask for.
    installMockCssom();
    const probe = await import('../packages/dynamic/src/index.ts');
    const everyClass = [
        ...new Set(objects.flatMap(object => probe.dynamic(object).split(' '))),
    ].filter(Boolean);
    probe.cleanup();

    /**
     * Measure a scenario list and print it as one table.
     *
     * @param title - Table heading.
     * @param scenarios - Scenarios in display order.
     * @returns The measurements, in the same order.
     */
    const table = async (title: string, scenarios: Scenario[]): Promise<Measurement[]> => {
        const rows: Measurement[] = [];
        for (const scenario of scenarios) rows.push(await measure(scenario, objects, everyClass));
        console.log(`\n${title}\n`);
        console.log(
            '| scenario                   | manifest gz | rules | inject gz | total gz | time µs |',
        );
        console.log(
            '| -------------------------- | ----------- | ----- | --------- | -------- | ------- |',
        );
        for (const row of rows) console.log(formatRow(row));
        return rows;
    };

    const sameSize = await table(
        `A. Manifest lists exactly what dynamic() asks for` +
            ` — ${objects.length} components, ${everyClass.length} classes`,
        [
            { name: 'no manifest', hitRate: 0, manifest: false },
            { name: 'manifest, 0% covered', hitRate: 0, manifest: true },
            { name: 'manifest, 50% covered', hitRate: 0.5, manifest: true },
            { name: 'manifest, 100% covered', hitRate: 1, manifest: true },
        ],
    );

    // Padding chosen from real builds: apps/docs emits 668 classes, the
    // vite-react playground 151. An app of that size using dynamic() for a
    // couple of dozen classes is the ordinary case.
    const realistic = await table(
        `B. Manifest carries the whole app census — same ${everyClass.length} dynamic classes`,
        [
            { name: 'no manifest', hitRate: 0, manifest: false },
            { name: '100% covered, +150 app', hitRate: 1, manifest: true, padClasses: 150 },
            { name: '100% covered, +600 app', hitRate: 1, manifest: true, padClasses: 600 },
            { name: '100% covered, +2000 app', hitRate: 1, manifest: true, padClasses: 2000 },
            {
                name: '+600 app, arrives late',
                hitRate: 1,
                manifest: true,
                padClasses: 600,
                lateArrival: true,
            },
        ],
    );

    // The decisive axis, on a census the size a real app emits.
    installMockCssom();
    const censusObjects = buildCensusObjects(668);
    const censusProbe = await import('../packages/dynamic/src/index.ts');
    censusProbe.cleanup();
    installMockCssom();
    const censusClasses = [
        ...new Set(censusObjects.flatMap(object => censusProbe.dynamic(object).split(' '))),
    ].filter(Boolean);
    censusProbe.cleanup();
    await ratioMatrix(censusObjects, censusClasses);

    const none = sameSize[0];
    console.log(
        `\nInjecting every class costs ${none.injectedGzip} B gz, so a manifest is only ` +
            `worth its transfer\nwhile it stays under that. Break-even census size, at full ` +
            `coverage:`,
    );
    for (const row of realistic.slice(1)) {
        const delta = row.totalGzip - none.totalGzip;
        console.log(
            `  ${row.name.padEnd(24)} ${delta >= 0 ? '+' : ''}${delta} B gz ` +
                `${delta >= 0 ? '(costs more than it saves)' : '(saves)'}`,
        );
    }
}

await main();
