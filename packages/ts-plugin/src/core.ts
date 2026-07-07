/**
 * The testable core of the plugin: given a language service, a file, and a
 * position, return the csszyx completion entries to merge (empty when the
 * position is not an sz key slot). Kept separate from `index.ts` so it can be
 * unit-tested — `index.ts` is a CommonJS `export =` plugin entry and cannot carry
 * named exports.
 */
import type ts from 'typescript/lib/tsserverlibrary';

import { buildSzKeyEntries } from './completions';
import { getSzKeyContext } from './context';

/**
 * @param tsMod - the tsserver TypeScript module.
 * @param languageService - the underlying language service.
 * @param fileName - file under the cursor.
 * @param position - absolute offset.
 * @returns entries to append (possibly empty).
 */
export function computeSzEntries(
    tsMod: typeof ts,
    languageService: ts.LanguageService,
    fileName: string,
    position: number,
): ts.CompletionEntry[] {
    const program = languageService.getProgram();
    const sourceFile = program?.getSourceFile(fileName);
    if (!sourceFile) {
        return [];
    }
    if (getSzKeyContext(tsMod, sourceFile, position) !== 'key') {
        return [];
    }
    return buildSzKeyEntries(tsMod);
}
