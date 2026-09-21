/**
 * The merge table a real Tailwind build produces for the classes these suites
 * merge.
 *
 * `szcn` deletes a class only when compiled CSS proved a later class sets
 * everything it sets, so a suite that expects a merge has to bring that proof.
 * The fixture is generated from the project's own Tailwind by
 * `packages/unplugin/tests/runtime-merge-fixture.test.ts`, which also fails when
 * the file on disk no longer matches what that Tailwind emits.
 *
 * @module
 */
import { afterEach, beforeEach } from 'vitest';
import {
    __resetMergeSignaturesForTests,
    type MergeSignatureTable,
    registerMergeSignatures,
} from '../../src/merge-signatures.js';
import fixture from '../fixtures/tailwind-merge-signatures.json';

/**
 * Register the generated table before each test of the calling suite, and
 * clear it afterwards so a suite about the unregistered state stays clean.
 */
export function useTailwindMergeTable(): void {
    const table = fixture as unknown as MergeSignatureTable;
    beforeEach(() => registerMergeSignatures(table));
    afterEach(__resetMergeSignaturesForTests);
}
