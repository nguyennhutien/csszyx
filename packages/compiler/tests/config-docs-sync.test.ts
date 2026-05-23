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
        const parserDefault = parserDefaultMatch![1];

        expect(parserDefault).toBeDefined();
        expect(configDocs).toContain(`| \`parser\`         | \`'${parserDefault}'\``);
        expect(typesConfig).toContain(`@default "${parserDefault}"`);
        expect(typesConfig).toContain(`\`${parserDefault}\` is the default parser.`);
        expect(unpluginReadme).toContain(`The default \`${parserDefault}\` path`);
    });
});
