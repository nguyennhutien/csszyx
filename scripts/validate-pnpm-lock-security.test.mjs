import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePnpmLockSecurity } from './validate-pnpm-lock-security.mjs';

const validLockfile = `lockfileVersion: '9.0'
packages:
  example@1.0.0:
    resolution: {integrity: sha512-YWJjZA==}
`;

test('accepts content-addressed pnpm registry resolutions', () => {
    assert.deepEqual(validatePnpmLockSecurity(validLockfile), []);
});

test('rejects cleartext package URLs', () => {
    const source = `${validLockfile}\nmetadata: http://registry.npmjs.org/example`;
    assert.match(validatePnpmLockSecurity(source).join('\n'), /cleartext HTTP/);
});

test('rejects custom tarball resolutions even over HTTPS', () => {
    const source = validLockfile.replace(
        '{integrity: sha512-YWJjZA==}',
        '{tarball: https://example.com/package.tgz, integrity: sha512-YWJjZA==}',
    );
    assert.match(validatePnpmLockSecurity(source).join('\n'), /custom tarball/);
});

test('rejects resolutions without SHA-512 integrity', () => {
    const source = validLockfile.replace('sha512-YWJjZA==', 'sha1-YWJjZA==');
    assert.match(validatePnpmLockSecurity(source).join('\n'), /missing SHA-512/);
});

test('rejects malformed SHA-512 integrity and multiline tarballs', () => {
    const malformed = validLockfile.replace('sha512-YWJjZA==', 'sha512-YWJjZA==suffix');
    assert.match(validatePnpmLockSecurity(malformed).join('\n'), /missing SHA-512/);

    const multiline = `lockfileVersion: '9.0'
packages:
  example@1.0.0:
    resolution:
      tarball: https://example.com/package.tgz
      integrity: sha512-YWJjZA==
`;
    const errors = validatePnpmLockSecurity(multiline).join('\n');
    assert.match(errors, /custom multiline tarball/);
    assert.match(errors, /missing SHA-512/);
});

test('rejects unsupported or empty lockfiles', () => {
    assert.deepEqual(validatePnpmLockSecurity("lockfileVersion: '8.0'"), [
        'Expected a pnpm v9 lockfile.',
        'Lockfile contains no package resolutions.',
    ]);
});
