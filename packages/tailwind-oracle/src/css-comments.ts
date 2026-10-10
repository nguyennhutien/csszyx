/**
 * CSS comment handling shared by every pass that reads stylesheet text.
 *
 * @module
 */

/**
 * Strip CSS block comments in a single linear pass. The regex form
 * (`/\/\*[\s\S]*?\*\//`) is polynomial-ReDoS on adversarial input such as an
 * unterminated `/*` followed by many `a/*` repetitions (CodeQL
 * js/polynomial-redos), so scan by hand: O(n), no backtracking, copying only
 * the whole non-comment spans.
 *
 * @param code - CSS source that may contain block comments.
 * @returns the source with every block comment removed.
 */
export function stripCssBlockComments(code: string): string {
    const SLASH = 47;
    const STAR = 42;
    let out = '';
    let last = 0;
    let i = 0;
    const n = code.length;
    while (i < n) {
        if (code.codePointAt(i) === SLASH && code.codePointAt(i + 1) === STAR) {
            out += code.slice(last, i);
            i += 2;
            while (i < n && !(code.codePointAt(i) === STAR && code.codePointAt(i + 1) === SLASH)) {
                i++;
            }
            i += 2; // skip past the closing */ (or past EOF if unterminated)
            last = i;
        } else {
            i++;
        }
    }
    return out + code.slice(last);
}
