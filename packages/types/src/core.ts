/**
 * @csszyx/types - Core WASM Contract
 *
 * This file defines the strict interface between the Rust/WASM core
 * and the TypeScript world. This is the source of truth for "The Forge" workstream.
 */

/**
 *
 */
export interface CsszyxCoreWasm {
    /**
     * Encodes a numeric index into a compact tier-based class name (z, y, x...).
     */
    encode(index: number): string;

    /**
     * Generates a unique cryptographic recovery token for SSR hydration safety.
     */
    generate_token(
        componentName: string,
        filePath: string,
        line: number,
        column: number,
        recoveryMode: 'csr' | 'dev-only',
        buildId: string,
    ): string;

    /**
     * Verifies if a recovery token is valid for the given context.
     */
    verify_token(
        token: string,
        componentName: string,
        filePath: string,
        line: number,
        column: number,
        recoveryMode: 'csr' | 'dev-only',
        buildId: string,
    ): boolean;

    /**
     * Computes a dual-hash for a CSS class name to prevent collisions.
     */
    compute_dual_hash(className: string): string;

    /**
     * Returns the current version of the core engine.
     */
    version(): string;
}

/**
 * The expected structure of the WASM initialization output.
 */
export interface CsszyxCorePkg {
    default: () => Promise<void>;
    encode: (index: number) => string;
    generate_token: (
        componentName: string,
        filePath: string,
        line: number,
        column: number,
        recoveryMode: string,
        buildId: string,
    ) => string;
    verify_token: (
        token: string,
        componentName: string,
        filePath: string,
        line: number,
        column: number,
        recoveryMode: string,
        buildId: string,
    ) => boolean;
    compute_dual_hash: (className: string) => string;
    version: () => string;
}
