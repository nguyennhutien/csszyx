/**
 * Which engine migrate runs on.
 *
 * The Rust port is the default now, but the TypeScript is still here and
 * still correct, so a machine with no platform binary keeps working instead
 * of failing. That fallback is silent: both engines write the same bytes —
 * held to it by the corpora in packages/core and by
 * `pnpm fuzz:migrate-engine-parity` — so which one ran is an implementation
 * detail, not something to interrupt a migration about. It is recorded in
 * the run's log file for when someone asks why a run was slow.
 *
 * Asking for an engine by name is different from taking the default: a run
 * that says `CSSZYX_MIGRATE_ENGINE=rust` and silently gets the TypeScript
 * would make a parity check meaningless, so that one fails instead.
 */
import { describe, expect, it } from 'vitest';

import { migrateEngine } from '../src/migrate/ast-transformer.js';

const available = () => true;
const missing = () => false;

describe('migrateEngine', () => {
    it('takes the native engine when nothing is asked for and it is there', () => {
        expect(migrateEngine(undefined, available)).toBe('rust');
    });

    it('falls back to the TypeScript engine when the platform has no binary', () => {
        expect(migrateEngine(undefined, missing)).toBe('ts');
        expect(migrateEngine('', missing)).toBe('ts');
    });

    it('honours an explicit choice of the TypeScript engine', () => {
        expect(migrateEngine('ts', available)).toBe('ts');
        expect(migrateEngine('ts', missing)).toBe('ts');
    });

    it('honours an explicit choice of the native engine', () => {
        expect(migrateEngine('rust', available)).toBe('rust');
    });

    it('refuses to quietly substitute an engine that was asked for by name', () => {
        expect(() => migrateEngine('rust', missing)).toThrow(
            /CSSZYX_MIGRATE_ENGINE=rust.*no native binary/s,
        );
    });

    it('names the values it accepts when given something else', () => {
        expect(() => migrateEngine('native', available)).toThrow(
            /CSSZYX_MIGRATE_ENGINE.*'rust'.*'ts'/s,
        );
    });
});
