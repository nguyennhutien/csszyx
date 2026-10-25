/**
 * Which `@csszyx/compiler` answers, and which one the project has.
 *
 * The server answers with the compiler it was installed with; it does not load
 * the project's, whose internals change between releases. The two agree when
 * the server is a devDependency beside the compiler, which the README's setup
 * does. When they do not, every reply says so first, in the text the
 * assistant reads, instead of giving advice the project's build contradicts.
 *
 * @module
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The answering compiler's version and the project's; null where none is installed. */
export interface CompilerVersions {
    answering: string | null;
    project: string | null;
}

/**
 * The version of the `@csszyx/compiler` Node resolves from `dir`: the nearest
 * `node_modules` at or above it that holds one.
 *
 * @param dir - Where to start.
 * @returns The version, or null when none is installed or its manifest
 *          cannot be read: the server reads this at startup, and a version
 *          note is not worth refusing to start for.
 */
export function installedCompilerVersion(dir: string): string | null {
    for (let current = path.resolve(dir); ; current = path.dirname(current)) {
        const manifest = path.join(current, 'node_modules', '@csszyx', 'compiler', 'package.json');
        if (existsSync(manifest)) return manifestVersion(manifest);
        if (path.dirname(current) === current) return null;
    }
}

/**
 * The `version` a package manifest names.
 *
 * @param manifest - The manifest's path.
 * @returns The version, or null when the file is no manifest with one.
 */
function manifestVersion(manifest: string): string | null {
    try {
        const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown };
        return typeof version === 'string' ? version : null;
    } catch {
        return null;
    }
}

/**
 * The sentence a reply leads with when the project has another compiler.
 *
 * @param versions - Both versions.
 * @returns The sentence, or null when they agree or the project has none.
 */
export function versionSkewNote(versions: CompilerVersions): string | null {
    const { answering, project } = versions;
    if (answering === null || project === null || answering === project) return null;
    return (
        `csszyx: these answers come from @csszyx/compiler ${answering}, and this project has ` +
        `${project}; install @csszyx/mcp-server@${project} beside it so the two agree.`
    );
}

/**
 * The server's instructions: the skew note, or which compiler answers.
 *
 * @param versions - Both versions.
 * @returns The instructions.
 */
export function compilerInstructions(versions: CompilerVersions): string {
    return (
        versionSkewNote(versions) ??
        `csszyx answers come from @csszyx/compiler ${versions.answering ?? 'unknown'}.`
    );
}

/**
 * A tool reply with both versions in its `_meta`, led by the skew note when
 * there is one.
 *
 * @param reply - The tool's reply.
 * @param versions - Both versions.
 * @returns The reply to send.
 */
export function withCompilerVersions<T extends { content: Array<{ type: 'text'; text: string }> }>(
    reply: T,
    versions: CompilerVersions,
): T & { _meta: { compilerVersion: string | null; projectCompilerVersion: string | null } } {
    const note = versionSkewNote(versions);
    return {
        ...reply,
        ...(note === null
            ? {}
            : { content: [{ type: 'text' as const, text: note }, ...reply.content] }),
        _meta: { compilerVersion: versions.answering, projectCompilerVersion: versions.project },
    };
}
