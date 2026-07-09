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
