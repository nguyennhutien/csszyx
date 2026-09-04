/**
 * The package's only runtime export.
 *
 * Everything else `@csszyx/types` ships is erased at compile time, which is why
 * it had no suite: there was nothing to run. `VERSION` is the exception, and it
 * read the literal `0.0.0` in every release up to 0.16.0 — three packages each
 * declared the constant by hand and nothing kept any of them in step with the
 * manifest, so anything branching on it read a version csszyx has never
 * shipped.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { VERSION } from '../src/index.js';

describe('VERSION', () => {
    it('is the version this package was published as', () => {
        const manifest = JSON.parse(
            readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'),
        ) as { version: string };
        expect(VERSION).toBe(manifest.version);
    });
});
