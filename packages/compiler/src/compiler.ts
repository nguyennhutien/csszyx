import { generate_token, version as getWasmVersion, init, transform_sz } from '@csszyx/core';

import { stripInvalidColorStrings } from './color-validation.js';
import type { SzObject } from './transform-core.js';
import { transform as jsTransform } from './transform-core.js';

/**
 * Fold one UTF-16 code unit into the legacy signed-int32 recovery hash.
 *
 * @param hash Current signed-int32 hash.
 * @param codeUnit UTF-16 code unit to append.
 * @returns Updated signed-int32 hash.
 */
function foldRecoveryHash(hash: number, codeUnit: number): number {
    return Math.imul(Math.imul(hash, 31) + codeUnit, 1);
}

/**
 * Fold a Unicode code point as the one or two UTF-16 units used by the legacy hash.
 *
 * @param hash Current signed-int32 hash.
 * @param codePoint Unicode code point to append.
 * @returns Updated signed-int32 hash.
 */
function foldRecoveryCodePoint(hash: number, codePoint: number): number {
    if (codePoint <= 0xffff) {
        return foldRecoveryHash(hash, codePoint);
    }
    const supplementary = codePoint - 0x10000;
    const highSurrogate = Math.floor(supplementary / 0x400) + 0xd800;
    const lowSurrogate = (supplementary % 0x400) + 0xdc00;
    return foldRecoveryHash(foldRecoveryHash(hash, highSurrogate), lowSurrogate);
}

/**
 * Core Compiler class for csszyx.
 *
 * This class manages the WASM lifecycle and provides high-performance
 * transformation methods. It falls back to JavaScript if WASM is not available.
 */
export class CsszyxCompiler {
    private static instance: CsszyxCompiler;
    private wasmLoaded = false;

    /**
     * Private constructor to enforce singleton pattern.
     */
    private constructor() {}

    /**
     * Gets the singleton instance of the compiler.
     *
     * @returns {CsszyxCompiler} The compiler instance.
     */
    public static getInstance(): CsszyxCompiler {
        if (!CsszyxCompiler.instance) {
            CsszyxCompiler.instance = new CsszyxCompiler();
        }
        return CsszyxCompiler.instance;
    }

    /**
     * Initializes the WASM core.
     *
     * @returns {Promise<void>} Resolves when WASM is ready.
     */
    public async init(): Promise<void> {
        if (this.wasmLoaded) {
            return;
        }

        try {
            // Named init call for @csszyx/core
            init();
            this.wasmLoaded = true;
            console.info(`[csszyx] WASM Core initialized (v${getWasmVersion()})`);
        } catch (error) {
            console.warn(
                '[csszyx] Failed to initialize WASM core, falling back to JavaScript transformer',
                error,
            );
            this.wasmLoaded = false;
        }
    }

    /**
     * Transforms an sz object into Tailwind classes.
     *
     * @param {SzObject} sz - The object to transform.
     * @returns {string} The transformed class string.
     */
    public transform(sz: SzObject): string {
        if (this.wasmLoaded) {
            // Pre-validate: Rust WASM cannot emit warnings, so we must warn here
            // before handing off to transform_sz. stripInvalidColorStrings returns
            // a clean object with invalid/slash-opacity color strings removed.
            const cleaned = stripInvalidColorStrings(sz as Record<string, unknown>);
            try {
                return transform_sz(cleaned);
            } catch (error) {
                console.warn('[csszyx] WASM transformation failed, using JS fallback', error);
                // JS path handles its own warnings internally
                return jsTransform(sz).className;
            }
        }
        // JS path: transform-core.ts handles validation and warnings internally
        return jsTransform(sz).className;
    }

    /**
     * Checks if the WASM core is currently active.
     *
     * @returns {boolean} True if WASM is loaded.
     */
    public isWasmActive(): boolean {
        return this.wasmLoaded;
    }

    /**
     * Generates a recovery token using WASM or JS fallback.
     *
     * @param {object} metadata - Token metadata
     * @param metadata.component - Component name
     * @param metadata.filePath - File path source
     * @param metadata.line - Line number
     * @param metadata.column - Column number
     * @param metadata.mode - Build mode (dev/prod)
     * @param metadata.buildId - Unique build identifier
     * @returns {string} The generated token
     */
    public generateRecoveryToken(metadata: {
        component: string;
        filePath: string;
        line: number;
        column: number;
        mode: 'csr' | 'dev-only';
        buildId: string;
    }): string {
        if (this.wasmLoaded) {
            try {
                return generate_token(
                    metadata.component,
                    metadata.filePath,
                    metadata.line,
                    metadata.column,
                    metadata.mode,
                    metadata.buildId,
                );
            } catch (error) {
                console.warn('[csszyx] WASM token generation failed', error);
            }
        }

        // Deterministic JS hash, used while the WASM core exposes no
        // generate_token — the value only has to be stable, not identical to what
        // the core would produce.
        const str = `${metadata.component}:${metadata.filePath}:${metadata.line}:${metadata.column}:${metadata.mode}:${metadata.buildId}`;
        let hash = 0;
        for (const character of str) {
            hash = foldRecoveryCodePoint(hash, character.codePointAt(0) ?? 0);
        }
        return Math.abs(hash).toString(16).padStart(12, '0').slice(0, 12);
    }
}
