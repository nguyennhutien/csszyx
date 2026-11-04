import { describe, expect, it } from 'vitest';

import { resolveVsceArguments, resolveVsceCredential, runVsce } from './package-utils.mjs';

describe('VS Code package argument policy', () => {
    it('builds fixed package and publish argv', () => {
        expect(resolveVsceArguments([])).toEqual({
            isPublish: false,
            commandArgs: ['@vscode/vsce', 'package'],
        });
        expect(resolveVsceArguments(['--publish', 'patch'])).toEqual({
            isPublish: true,
            commandArgs: ['@vscode/vsce', 'publish', 'patch'],
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

describe('VS Code publish credential', () => {
    const publish = { isPublish: true, commandArgs: ['@vscode/vsce', 'publish'] };

    it('publishes with the Entra token and hides a PAT that would win over it', () => {
        // vsce reads `--pat` from VSCE_PAT and prefers it to --azure-credential,
        // so an expired PAT left in the secrets failed the 0.18.0 publish.
        const env = { PATH: '/bin', VSCE_AZURE_CREDENTIAL: 'true', VSCE_PAT: 'expired' };
        const { commandArgs, env: childEnv } = resolveVsceCredential(publish, env);
        expect(commandArgs).toEqual(['@vscode/vsce', 'publish', '--azure-credential']);
        expect(childEnv).toEqual({ PATH: '/bin', VSCE_AZURE_CREDENTIAL: 'true' });
        expect(env.VSCE_PAT).toBe('expired');
    });

    it('keeps the PAT when Entra is not configured', () => {
        const env = { VSCE_AZURE_CREDENTIAL: '', VSCE_PAT: 'pat' };
        expect(resolveVsceCredential(publish, env)).toEqual({
            commandArgs: ['@vscode/vsce', 'publish'],
            env,
        });
    });

    it('leaves packaging alone', () => {
        const pack = { isPublish: false, commandArgs: ['@vscode/vsce', 'package'] };
        const env = { VSCE_AZURE_CREDENTIAL: 'true', VSCE_PAT: 'pat' };
        expect(resolveVsceCredential(pack, env)).toEqual({ commandArgs: pack.commandArgs, env });
    });
});

describe('VS Code vsce run', () => {
    it('starts vsce with the environment the credential policy chose', () => {
        const calls = [];
        const exec = (file, args, options) => calls.push({ file, args, options });
        const env = { PATH: '/bin', VSCE_AZURE_CREDENTIAL: 'true', VSCE_PAT: 'expired' };
        expect(runVsce(['--publish'], env, { cwd: '/stage', exec })).toEqual({ isPublish: true });
        expect(calls).toEqual([
            {
                file: 'npx',
                args: ['@vscode/vsce', 'publish', '--azure-credential'],
                options: {
                    cwd: '/stage',
                    stdio: 'inherit',
                    env: { PATH: '/bin', VSCE_AZURE_CREDENTIAL: 'true' },
                },
            },
        ]);
    });
});
