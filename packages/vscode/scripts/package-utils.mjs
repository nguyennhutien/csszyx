const VERSION_BUMPS = new Set(['major', 'minor', 'patch']);

/**
 * Converts the documented packaging CLI into a fixed vsce argv.
 *
 * @param {string[]} args User-provided process arguments.
 * @returns {{ isPublish: boolean; commandArgs: string[] }}
 */
export function resolveVsceArguments(args) {
    const publishIndexes = args.flatMap((arg, index) => (arg === '--publish' ? [index] : []));
    if (publishIndexes.length > 1) {
        throw new Error('--publish may only be specified once.');
    }

    const isPublish = publishIndexes.length === 1;
    const remaining = args.filter(arg => arg !== '--publish');
    if (!isPublish && remaining.length > 0) {
        throw new Error('Package mode does not accept additional arguments.');
    }
    if (
        isPublish &&
        (remaining.length > 1 || (remaining[0] !== undefined && !VERSION_BUMPS.has(remaining[0])))
    ) {
        throw new Error('Publish mode only accepts an optional major, minor, or patch bump.');
    }

    // Dependency detection stays ON: vsce must pack the bundled @csszyx/ts-plugin
    // (the extension's one production dependency) into the vsix so the
    // typescriptServerPlugins contribution can resolve it. Every other
    // dependency is inlined into dist/extension.js by esbuild.
    return {
        isPublish,
        commandArgs: ['@vscode/vsce', isPublish ? 'publish' : 'package', ...remaining],
    };
}

/**
 * Chooses how a publish authenticates. With `VSCE_AZURE_CREDENTIAL=true` it
 * adds `--azure-credential` and drops `VSCE_PAT` from vsce's environment: vsce
 * fills `--pat` from that variable and prefers it to the Entra token, so a PAT
 * still set beside Entra would be the one used.
 *
 * @param {{ isPublish: boolean; commandArgs: string[] }} invocation From `resolveVsceArguments`.
 * @param {NodeJS.ProcessEnv} env The environment to start vsce with.
 * @returns {{ commandArgs: string[]; env: NodeJS.ProcessEnv }}
 */
export function resolveVsceCredential({ isPublish, commandArgs }, env) {
    if (!isPublish || env.VSCE_AZURE_CREDENTIAL !== 'true') {
        return { commandArgs, env };
    }
    const { VSCE_PAT: _pat, ...withoutPat } = env;
    return { commandArgs: [...commandArgs, '--azure-credential'], env: withoutPat };
}

/**
 * Starts vsce for one package or publish run, with the arguments and the
 * environment the two helpers above choose. `exec` is `execFileSync` in
 * `package.mjs`; taking it as a parameter lets a test see the environment
 * vsce would actually start with.
 *
 * @param {string[]} argv The script's own arguments.
 * @param {NodeJS.ProcessEnv} env The script's environment.
 * @param {{ cwd: string; exec: (file: string, args: string[], options: object) => unknown }} target
 *     Where vsce runs, and how it is started.
 * @returns {{ isPublish: boolean }} Whether this run publishes.
 */
export function runVsce(argv, env, { cwd, exec }) {
    const invocation = resolveVsceArguments(argv);
    const { commandArgs, env: childEnv } = resolveVsceCredential(invocation, env);
    exec('npx', commandArgs, { cwd, stdio: 'inherit', env: childEnv });
    return { isPublish: invocation.isPublish };
}
