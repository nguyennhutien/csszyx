/**
 * The digest of the engine's source: what `@csszyx/compiler` is built against
 * and what each engine artifact reports it was built from.
 *
 * The compiler's TypeScript and the engine are released together, but they
 * are installed apart: a lockfile, a cache or a stale local build can pair a
 * compiler with an engine from another commit. Version numbers cannot see two
 * builds of the same version, so the compiler also carries this digest and
 * refuses an engine whose own digest differs.
 *
 * Two implementations compute it and must agree: this one, read by the
 * compiler's build, and `packages/core/build.rs`, compiled into the engine.
 * `scripts/build-tests/engine-digest.test.mjs` holds them together.
 *
 * The digest covers the Rust files under `packages/core/src`,
 * `packages/core/Cargo.toml` and the root `Cargo.lock`: every file in byte
 * order of its repository-relative path, each fed to sha256 as
 * `<path>\0<content>\0` with the path in UTF-8, and CRLF read as LF so a
 * Windows checkout gets the same answer. It is the first 16 hex characters.
 *
 * Only `.rs` files whose name does not start with a dot count under `src`:
 * a `.DS_Store`, an editor's swap file or its `.#lock.rs` would otherwise
 * change the digest the compiler bakes in while turbo, which ignores them,
 * replays the engine built before they appeared.
 *
 * Run: node scripts/engine-digest.mjs
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The files the digest covers, besides everything under `packages/core/src`. */
export const DIGEST_FILES = ['packages/core/Cargo.toml', 'Cargo.lock'];

/**
 * Every Rust file under a directory, repository-relative with `/`, leaving out
 * names that start with a dot.
 *
 * @param {string} root - The repository root.
 * @param {string} directory - A repository-relative directory.
 * @returns {string[]} The files.
 */
function rustFilesUnder(root, directory) {
    const found = [];
    for (const name of readdirSync(path.join(root, directory))) {
        if (name.startsWith('.')) continue;
        const relative = `${directory}/${name}`;
        if (statSync(path.join(root, relative)).isDirectory())
            found.push(...rustFilesUnder(root, relative));
        else if (name.endsWith('.rs')) found.push(relative);
    }
    return found;
}

/**
 * The digest of the engine's source.
 *
 * @param {{ root?: string }} [options] - The repository to read; this one by default.
 * @returns {string} 16 lowercase hex characters.
 */
export function engineDigest({ root = ROOT } = {}) {
    const files = [...rustFilesUnder(root, 'packages/core/src'), ...DIGEST_FILES].sort((a, b) =>
        Buffer.compare(Buffer.from(a), Buffer.from(b)),
    );
    const hash = createHash('sha256');
    for (const file of files) {
        // Content as bytes: latin1 maps each byte to one code unit and back.
        const content = readFileSync(path.join(root, file))
            .toString('latin1')
            .replaceAll('\r\n', '\n');
        hash.update(Buffer.from(`${file}\0`, 'utf8'));
        hash.update(content, 'latin1');
        hash.update('\0', 'latin1');
    }
    return hash.digest('hex').slice(0, 16);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    console.log(engineDigest());
}
