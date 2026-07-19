import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LOCKFILE_URL = new URL('../pnpm-lock.yaml', import.meta.url);
const RESOLUTION_LINE = /^\s+resolution:\s*(.*)$/;
const SHA512_INTEGRITY = /\bintegrity:\s*sha512-[A-Za-z0-9+/]+={0,2}(?=[,}\s])/;

/**
 * Validate the security properties available in a pnpm v9 lockfile.
 * Registry packages must be content-addressed and custom download locations
 * require explicit review instead of silently entering the dependency graph.
 *
 * @param {string} source lockfile source
 * @returns {string[]} validation errors
 */
export function validatePnpmLockSecurity(source) {
    const errors = [];
    if (!/^lockfileVersion:\s*['"]?9(?:\.\d+)?['"]?\s*$/m.test(source)) {
        errors.push('Expected a pnpm v9 lockfile.');
    }
    if (/\bhttp:\/\//i.test(source)) {
        errors.push('Lockfile contains a cleartext HTTP URL.');
    }
    if (/^\s+tarball:/m.test(source)) {
        errors.push('Lockfile uses a custom multiline tarball resolution.');
    }

    const resolutions = source
        .split('\n')
        .map((line, index) => ({ index: index + 1, value: line.match(RESOLUTION_LINE)?.[1] }))
        .filter(entry => entry.value !== undefined);
    if (resolutions.length === 0) {
        errors.push('Lockfile contains no package resolutions.');
    }

    for (const resolution of resolutions) {
        if (resolution.value.includes('tarball:')) {
            errors.push(`Line ${resolution.index} uses a custom tarball resolution.`);
        } else if (!SHA512_INTEGRITY.test(resolution.value)) {
            errors.push(`Line ${resolution.index} is missing SHA-512 integrity.`);
        }
    }
    return errors;
}

function main() {
    const errors = validatePnpmLockSecurity(readFileSync(LOCKFILE_URL, 'utf8'));
    if (errors.length > 0) {
        throw new Error(`pnpm lockfile security validation failed:\n- ${errors.join('\n- ')}`);
    }
    console.log('pnpm lockfile security validation passed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
