/**
 * Virtual module system for csszyx mangle map.
 *
 * Provides a virtual module that exposes the mangle map at runtime,
 * enabling SSR/CSR hydration verification.
 *
 * @module virtual-modules
 */

/**
 * Virtual module ID for mangle map.
 */
export const VIRTUAL_MODULE_ID = 'virtual:csszyx/mangle-map';

/**
 * Resolved virtual module ID (with null byte prefix for unplugin).
 */
export const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

/**
 * Virtual module ID for checksum only.
 */
export const VIRTUAL_CHECKSUM_ID = 'virtual:csszyx/checksum';

/**
 * Resolved virtual checksum module ID.
 */
export const RESOLVED_VIRTUAL_CHECKSUM_ID = '\0' + VIRTUAL_CHECKSUM_ID;

/**
 * Creates the mangle map virtual module content.
 *
 * @param {Record<string, string>} mangleMap - The mangle map (original -> mangled)
 * @param {string} checksum - SHA-256 checksum of the mangle map
 * @returns {string} Module source code
 *
 * @example
 * ```typescript
 * const source = createMangleMapModule(
 *   { 'p-4': 'z', 'bg-red-500': 'y' },
 *   'a1b2c3d4e5f67890'
 * );
 * // Returns:
 * // export const mangleMap = {"p-4":"z","bg-red-500":"y"};
 * // export const checksum = "a1b2c3d4e5f67890";
 * ```
 */
export function createMangleMapModule(
    mangleMap: Record<string, string>,
    checksum: string,
): string {
    return `/**
 * Auto-generated mangle map for csszyx.
 * This module is generated at build time and contains the mapping
 * from original class names to mangled class names.
 *
 * @generated
 */

export const mangleMap = ${JSON.stringify(mangleMap, null, 2)};

export const checksum = ${JSON.stringify(checksum)};

export default {
  mangleMap,
  checksum,
};
`;
}

/**
 * Creates the checksum-only virtual module content.
 *
 * @param {string} checksum - SHA-256 checksum of the mangle map
 * @returns {string} Module source code
 */
export function createChecksumModule(checksum: string): string {
    return `/**
 * Auto-generated checksum for csszyx mangle map.
 *
 * @generated
 */

export const checksum = ${JSON.stringify(checksum)};

export default checksum;
`;
}

/**
 * Checks if a module ID is a csszyx virtual module.
 *
 * @param {string} id - Module ID to check
 * @returns {boolean} True if it's a csszyx virtual module
 */
export function isVirtualModule(id: string): boolean {
    return id === VIRTUAL_MODULE_ID || id === VIRTUAL_CHECKSUM_ID;
}

/**
 * Resolves a virtual module ID to its prefixed version.
 *
 * @param {string} id - Module ID to resolve
 * @returns {string | undefined} Resolved ID or undefined if not a virtual module
 */
export function resolveVirtualModule(id: string): string | undefined {
    if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
    }
    if (id === VIRTUAL_CHECKSUM_ID) {
        return RESOLVED_VIRTUAL_CHECKSUM_ID;
    }
    return undefined;
}
