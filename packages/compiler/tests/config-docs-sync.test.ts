import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BUILD_CONFIG } from '@csszyx/types';
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
        const parserDefault = DEFAULT_BUILD_CONFIG.parser;

        expect(parserDefault).toBeDefined();
        expect(configDocs).toContain(`| \`parser\`         | \`'${parserDefault}'\``);
        expect(typesConfig).toContain(`@default "${parserDefault}"`);
        expect(typesConfig).toContain(`\`${parserDefault}\` is the default parser.`);
        expect(unpluginReadme).toContain(`The default \`${parserDefault}\` path`);
    });
});
