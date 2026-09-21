/**
 * Whether a package sits inside a workspace.
 *
 * Shared by the unscoped-content warning and the style model, which both have
 * to know when Tailwind's automatic detection reaches past the package.
 *
 * @module
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Whether `root` is a package INSIDE a monorepo — an ancestor directory is a
 * workspace root (`pnpm-workspace.yaml`, a `package.json` with a `workspaces`
 * field, or an nx/lerna marker). In that case Tailwind v4 automatic content
 * detection would otherwise climb to the workspace root. Synchronous and cheap
 * (a handful of stat calls up the tree); intended to be memoized per build.
 * Mirrors `isInsideWorkspace` in the CLI's `init` command.
 *
 * @param root - the project/package root directory.
 * @returns true when an ancestor is a workspace root.
 */
export function isMonorepoPackage(root: string): boolean {
    let dir = path.dirname(path.resolve(root));
    const { root: fsRoot } = path.parse(dir);
    while (dir !== fsRoot) {
        if (
            fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
            fs.existsSync(path.join(dir, 'nx.json')) ||
            fs.existsSync(path.join(dir, 'lerna.json'))
        ) {
            return true;
        }
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                if ('workspaces' in (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as object)) {
                    return true;
                }
            } catch {
                // Malformed package.json — ignore and keep walking up.
            }
        }
        dir = path.dirname(dir);
    }
    return false;
}
