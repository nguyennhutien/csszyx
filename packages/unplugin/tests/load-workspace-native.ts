/**
 * Load the native engine from the HOST platform's workspace package dir.
 *
 * The engine suites (parity, build diff, mangle round-trip, cache
 * equivalence) need the real Rust binding. Passing a hardcoded platform dir
 * (`core-linux-arm64-gnu`) worked on the arm64 devcontainer but failed on
 * x64 CI, where `native:build` populates `core-linux-x64-gnu` — the suites
 * never ran there. The default package-name resolution can't be used either:
 * in-workspace, the platform package resolves by directory, not by its npm
 * name. So resolve the workspace dir for the CURRENT platform through the
 * same mapping the loader itself uses.
 *
 * Failure stays loud (no skip): engine parity is an invariant gate, and CI
 * builds the host addon before the unit-test step — reaching these suites
 * without a binding means that step silently broke, which must fail the run.
 *
 * @module
 */
import { resolve } from 'node:path';

import { loadNativeBinding } from '../../core/native/index.js';
import {
    getNativePlatformKey,
    NATIVE_PLATFORM_PACKAGE_BY_KEY,
} from '../../core/native/platforms.js';

/** Loads the workspace native binding for the host platform (throws loudly). */
export function loadWorkspaceNativeBinding(): void {
    const entry = NATIVE_PLATFORM_PACKAGE_BY_KEY.get(getNativePlatformKey());
    // An unsupported platform leaves `entry` undefined; loadNativeBinding then
    // fails with its own descriptive unavailable error — intentionally loud.
    loadNativeBinding(resolve(__dirname, '../..', entry?.dirName ?? 'core-native-unsupported'));
}
