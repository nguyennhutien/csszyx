import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');

describe('config docs sync', () => {
    it('keeps the documented build.parser default in sync with shared config', () => {
        const configDocs = readFileSync(
            join(REPO_ROOT, 'apps/docs/src/content/docs/docs/reference/config.mdx'),
            'utf8',
        );
        const typesConfig = readFileSync(join(REPO_ROOT, 'packages/types/src/config.ts'), 'utf8');
        const unpluginReadme = readFileSync(join(REPO_ROOT, 'packages/unplugin/README.md'), 'utf8');
        // Extract the source-of-truth value from packages/types/src/config.ts
        // by regex instead of importing @csszyx/types, because @csszyx/types
        // depends on @csszyx/compiler via jsx.d.ts type imports and the
        // runtime import would create a turbo task-graph cycle.
        const parserDefaultMatch = typesConfig.match(
            /export const DEFAULT_BUILD_CONFIG[^}]*parser:\s*'([^']+)'/,
        );
        expect(
            parserDefaultMatch,
            'DEFAULT_BUILD_CONFIG.parser must be a single-quoted literal',
        ).not.toBeNull();
        const parserDefault = parserDefaultMatch?.[1];

        expect(parserDefault).toBeDefined();
        expect(configDocs).toContain(`| \`parser\`         | \`'${parserDefault}'\``);
        expect(typesConfig).toContain(`@default "${parserDefault}"`);
        expect(typesConfig).toContain(`\`${parserDefault}\` is the default parser.`);
        expect(unpluginReadme).toContain(`The default \`${parserDefault}\` path`);
    });

    it('keeps the documented build.importedStaticSz default in sync with shared config', () => {
        // A setting that changes emitted output must not be able to move in the
        // config while the docs still describe the value it used to have —
        // whichever a reader believes, one of them would be lying.
        //
        // Deliberately agnostic about WHICH default is right: it reads the
        // literal and requires the other two sources to say the same thing, so
        // changing the default stays a two-file edit and cannot land half done.
        const configDocs = readFileSync(
            join(REPO_ROOT, 'apps/docs/src/content/docs/docs/reference/config.mdx'),
            'utf8',
        );
        const typesConfig = readFileSync(join(REPO_ROOT, 'packages/types/src/config.ts'), 'utf8');

        const defaultMatch = typesConfig.match(
            /export const DEFAULT_IMPORTED_STATIC_SZ = (true|false);/,
        );
        expect(defaultMatch, 'DEFAULT_IMPORTED_STATIC_SZ must be a boolean literal').not.toBeNull();
        const configured = defaultMatch?.[1];
        // The config object must carry that constant rather than repeating the
        // literal, or the two could drift and this gate would follow the wrong one.
        expect(typesConfig).toMatch(
            /export const DEFAULT_BUILD_CONFIG[^}]*importedStaticSz: DEFAULT_IMPORTED_STATIC_SZ/,
        );

        expect(typesConfig, 'the JSDoc @default must match the exported default').toContain(
            `* @default ${configured}`,
        );
        expect(configDocs, 'the config reference table must match the exported default').toContain(
            `| \`importedStaticSz\` | \`${configured}\``,
        );
    });

    it('keeps the documented production.mangle default in sync with shared config', () => {
        // The breaking flip to opt-in landed in the plugin first and missed
        // this exported default, so consumers merging DEFAULT_PRODUCTION_CONFIG
        // got mangling ON while every doc said it was off. Pin all three
        // surfaces to the same literal so a one-sided edit fails here.
        const configDocs = readFileSync(
            join(REPO_ROOT, 'apps/docs/src/content/docs/docs/reference/config.mdx'),
            'utf8',
        );
        const typesConfig = readFileSync(join(REPO_ROOT, 'packages/types/src/config.ts'), 'utf8');

        const mangleDefaultMatch = typesConfig.match(
            /export const DEFAULT_PRODUCTION_CONFIG[^}]*mangle:\s*(true|false)/,
        );
        expect(
            mangleDefaultMatch,
            'DEFAULT_PRODUCTION_CONFIG.mangle must be a boolean literal',
        ).not.toBeNull();
        const mangleDefault = mangleDefaultMatch?.[1];

        expect(mangleDefault).toBe('false');
        expect(typesConfig).toContain(`* @default ${mangleDefault}`);
        expect(configDocs).toContain(`opt-in, default ${mangleDefault}`);
        expect(configDocs).toContain('It is **off by\ndefault**');
    });
});
