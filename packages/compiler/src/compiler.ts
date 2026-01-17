import { init, transform_sz, version as getWasmVersion } from '@csszyx/core';

import type { SzObject } from './transform.js';
import { transform as jsTransform } from './transform.js';

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
        if (this.wasmLoaded) {return;}

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
            try {
                return transform_sz(sz);
            } catch (error) {
                console.warn(
                    '[csszyx] WASM transformation failed, using JS fallback',
                    error,
                );
                return jsTransform(sz).className;
            }
        }
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
                const { generate_token } = require('@csszyx/core');
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

        // JS Fallback - deterministic hash (temporary until WASM Phase 3)
        // TODO(Phase 3): Replace with WASM generate_token when available
        const str = `${metadata.component}:${metadata.filePath}:${metadata.line}:${metadata.column}:${metadata.mode}:${metadata.buildId}`;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(16).padStart(12, '0').slice(0, 12);
    }
}
