import { CsszyxCompiler } from './compiler.js';

/**
 * Valid recovery modes for szRecover attribute.
 */
export type RecoveryMode = 'csr' | 'dev-only';

/**
 * Metadata for a recovery token.
 */
export interface TokenMetadata {
    /**
     * The recovery mode ('csr' or 'dev-only')
     */
    mode: RecoveryMode;

    /**
     * Component name where szRecover is used
     */
    component: string;

    /**
     * Absolute file path
     */
    filePath: string;

    /**
     * Line number in source file
     */
    line: number;

    /**
     * Column number in source file
     */
    column: number;

    /**
     * Build ID (git hash or timestamp)
     */
    buildId: string;
}

/**
 * Generated recovery token with metadata.
 */
export interface RecoveryToken {
    /**
     * The generated token string
     */
    token: string;

    /**
     * Token metadata
     */
    metadata: TokenMetadata;
}

/**
 * Validates if a value is a valid recovery mode.
 *
 * @param {unknown} value - The value to validate
 * @returns {value is RecoveryMode} True if valid recovery mode
 *
 * @example
 * ```typescript
 * isValidRecoveryMode('csr') // true
 * isValidRecoveryMode('dev-only') // true
 * isValidRecoveryMode('invalid') // false
 * ```
 */
export function isValidRecoveryMode(value: unknown): value is RecoveryMode {
    return value === 'csr' || value === 'dev-only';
}

/**
 * Generates a cryptographic token for a recovery declaration using WASM.
 *
 * @param {TokenMetadata} metadata - Token metadata
 * @returns {string} The generated token (Base62 format)
 */
export function generateRecoveryToken(metadata: TokenMetadata): string {
    return CsszyxCompiler.getInstance().generateRecoveryToken(metadata);
}

/**
 * Creates a recovery token with full metadata.
 *
 * @param {Omit<TokenMetadata, 'buildId'>} metadata - Token metadata without buildId
 * @param {string} buildId - Build ID to use
 * @returns {RecoveryToken} The generated token with metadata
 *
 * @example
 * ```typescript
 * const recovery = createRecoveryToken({
 *     mode: 'csr',
 *     component: 'Button',
 *     filePath: '/app/Button.tsx',
 *     line: 10,
 *     column: 5
 * }, 'build-123');
 * ```
 */
export function createRecoveryToken(
    metadata: Omit<TokenMetadata, 'buildId'>,
    buildId: string,
): RecoveryToken {
    const fullMetadata: TokenMetadata = {
        ...metadata,
        buildId,
    };

    const token = generateRecoveryToken(fullMetadata);

    return {
        token,
        metadata: fullMetadata,
    };
}

/**
 * Validates szRecover attribute value.
 *
 * Ensures the value is a static literal 'csr' or 'dev-only'.
 * Runtime expressions are not allowed.
 *
 * @param {unknown} value - The attribute value to validate
 * @param {string} componentName - Component name for error messages
 * @returns {{ valid: boolean; error?: string }} Validation result
 *
 * @example
 * ```typescript
 * validateSzRecover('csr', 'MyComponent')
 * // Returns: { valid: true }
 *
 * validateSzRecover('invalid', 'MyComponent')
 * // Returns: { valid: false, error: '...' }
 * ```
 */
export function validateSzRecover(
    value: unknown,
    componentName: string,
): { valid: boolean; error?: string } {
    if (!isValidRecoveryMode(value)) {
        return {
            valid: false,
            error: `szRecover in ${componentName} must be static literal "csr" or "dev-only", got: ${JSON.stringify(value)}`,
        };
    }

    return { valid: true };
}

/**
 * Injects recovery token into JSX attributes.
 *
 * Adds the data-sz-recovery-token attribute with the generated token.
 *
 * @param {Record<string, unknown>} attributes - JSX attributes object
 * @param {string} token - The recovery token to inject
 * @returns {Record<string, unknown>} Updated attributes with token
 *
 * @example
 * ```typescript
 * const attrs = { szRecover: 'csr', className: 'foo' };
 * const updated = injectRecoveryToken(attrs, 'abc123');
 * // Returns: { szRecover: 'csr', className: 'foo', 'data-sz-recovery-token': 'abc123' }
 * ```
 */
export function injectRecoveryToken(
    attributes: Record<string, unknown>,
    token: string,
): Record<string, unknown> {
    return {
        ...attributes,
        'data-sz-recovery-token': token,
    };
}
