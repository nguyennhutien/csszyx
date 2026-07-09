import type ts from 'typescript/lib/tsserverlibrary';

import { buildSzKeyEntries, buildSzValueEntries } from './completions';
import type { PluginConfig } from './config';
import { getSzContext } from './context';

/** Compute csszyx entries without mutating the base language service.
 * @param tsMod - TypeScript instance injected by the host.
 * @param languageService - Project language service.
 * @param fileName - Requested source file.
 * @param position - UTF-16 source offset.
 * @param config - Immutable project configuration.
 * @param deadline - Monotonic request deadline.
 * @param isCancellationRequested - Host cancellation check.
 * @returns Bounded csszyx entries, or an empty list outside proven contexts.
 */
export function computeSzEntries(
    tsMod: typeof ts,
    languageService: ts.LanguageService,
    fileName: string,
    position: number,
    config: PluginConfig,
    deadline: number,
    isCancellationRequested: () => boolean = () => false,
): ts.CompletionEntry[] {
    const shouldStop = (): boolean => isCancellationRequested() || performance.now() > deadline;
    if (!config.enabled || shouldStop()) return [];
    const program = languageService.getProgram();
    const sourceFile = program?.getSourceFile(fileName);
    if (!program || !sourceFile || shouldStop()) return [];
    const context = getSzContext(
        tsMod,
        sourceFile,
        position,
        () => program.getTypeChecker(),
        shouldStop,
    );
    if (!context || shouldStop()) return [];
    if (context.kind === 'value') {
        return config.values
            ? buildSzValueEntries(
                  tsMod,
                  context.property,
                  config.maxEntries,
                  context.replacementSpan,
                  context.quoted,
                  shouldStop,
              )
            : [];
    }
    return buildSzKeyEntries(tsMod, config.maxEntries, context.replacementSpan, shouldStop);
}
