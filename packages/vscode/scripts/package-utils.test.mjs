import { describe, expect, it } from 'vitest';

import { resolveVsceArguments } from './package-utils.mjs';

describe('VS Code package argument policy', () => {
    it('builds fixed package and publish argv', () => {
        expect(resolveVsceArguments([])).toEqual({
            isPublish: false,
            commandArgs: ['@vscode/vsce', 'package', '--no-dependencies'],
        });
        expect(resolveVsceArguments(['--publish', 'patch'])).toEqual({
            isPublish: true,
            commandArgs: ['@vscode/vsce', 'publish', '--no-dependencies', 'patch'],
        });
    });

    it.each([
        ['--publish', '--pre-release'],
        ['--publish', '--packagePath', 'outside.vsix'],
        ['--publish', 'patch', '--no-verify'],
        ['--publish', '--publish'],
        ['--help'],
    ])('rejects unsupported or option-like arguments: %s', (...args) => {
        expect(() => resolveVsceArguments(args)).toThrow();
    });
});
