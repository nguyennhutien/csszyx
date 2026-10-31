/**
 * The SHA-256 of a source text, computed once per text a process holds.
 *
 * The prescan and the transform hash the same text for the transform cache,
 * the diagnostic limiter and the read-once memos: about five digests a file.
 * The digest depends on the text alone, so it is kept by the text itself,
 * never by path or modification time, and an edited file is a new text.
 *
 * @module content-digest
 */
import { createHash } from 'node:crypto';

/** A text's SHA-256, in the two encodings its readers use. */
export interface ContentDigest {
    readonly hex: string;
    readonly base64: string;
}

/**
 * Texts, and characters of source, one generation keeps; whichever fills
 * first starts the next. Two generations are kept, so a text read again
 * within that many others is hashed once, and the source the memo holds alive
 * stays bounded however long a dev server runs and however large its files.
 */
const GENERATION = 8192;
const GENERATION_CHARACTERS = 16 << 20;

let current = new Map<string, ContentDigest>();
let previous = new Map<string, ContentDigest>();
let currentCharacters = 0;
let previousCharacters = 0;

/**
 * The text's SHA-256.
 *
 * @param text - The source text.
 * @returns Its digest; the same object for the same text while it is kept.
 */
export function sha256Of(text: string): ContentDigest {
    const fresh = current.get(text);
    if (fresh !== undefined) return fresh;
    const digest = previous.get(text) ?? digestOf(text);
    // Every write goes through the bound, a text promoted from the older
    // generation included, so the two together never pass two generations.
    if (current.size >= GENERATION || currentCharacters >= GENERATION_CHARACTERS) {
        previous = current;
        previousCharacters = currentCharacters;
        current = new Map();
        currentCharacters = 0;
    }
    current.set(text, digest);
    currentCharacters += text.length;
    return digest;
}

/**
 * The text's SHA-256, computed.
 *
 * @param text - The source text.
 * @returns Its digest in both encodings.
 */
function digestOf(text: string): ContentDigest {
    const bytes = createHash('sha256').update(text).digest();
    return { hex: bytes.toString('hex'), base64: bytes.toString('base64') };
}

/**
 * What the memo holds now, for a test of its bounds.
 *
 * @returns The texts and their characters, across both generations.
 * @internal
 */
export function keptTexts(): { texts: number; characters: number } {
    return {
        texts: current.size + previous.size,
        characters: currentCharacters + previousCharacters,
    };
}
