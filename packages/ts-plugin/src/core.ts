import type ts from 'typescript/lib/tsserverlibrary';

import {
    buildFormKeyEntries,
    buildMemberValueEntries,
    buildSzKeyEntries,
    buildSzValueEntries,
} from './completions';
import type { PluginConfig } from './config';
import { getSzContext } from './context';
import {
    EMPTY_THEME_SNAPSHOT,
    themeSnapshotForProgram,
    themeValuesForProperty,
} from './theme-values';

/** Inputs for one bounded completion computation. */
export interface ComputeSzEntriesOptions {
    readonly tsMod: typeof ts;
    readonly languageService: ts.LanguageService;
    readonly fileName: string;
    readonly position: number;
    readonly config: PluginConfig;
    readonly deadline: number;
    readonly projectRoot: string;
    readonly isCancellationRequested?: () => boolean;
}

/** Compute csszyx entries without mutating the base language service.
 * @param options - Host service, request, project, and safety bounds.
 * @returns Bounded csszyx entries, or an empty list outside proven contexts.
 */
export function computeSzEntries(options: ComputeSzEntriesOptions): ts.CompletionEntry[] {
    const {
        tsMod,
        languageService,
        fileName,
        position,
        config,
        deadline,
        projectRoot,
        isCancellationRequested = () => false,
    } = options;
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
    const theme = config.themeValues
        ? themeSnapshotForProgram({ tsMod, program, projectRoot, shouldStop })
        : EMPTY_THEME_SNAPSHOT;
    if (context.kind === 'value') {
        if (!config.values) return [];
        // A structured-form member (bg's { color, op }, bgImg's gradient
        // members) carries its own curated values.
        if (context.member) {
            return buildMemberValueEntries({
                tsMod,
                member: context.member,
                limit: config.maxEntries,
                replacementSpan: context.replacementSpan,
                quoted: context.quoted,
                shouldStop,
                additionalValues: themeValuesForProperty(theme, context.member.name),
            });
        }
        return buildSzValueEntries({
            tsMod,
            property: context.property,
            limit: config.maxEntries,
            replacementSpan: context.replacementSpan,
            quoted: context.quoted,
            shouldStop,
            additionalValues: themeValuesForProperty(theme, context.property),
        });
    }
    if (context.form) {
        return buildFormKeyEntries({
            tsMod,
            form: context.form,
            replacementSpan: context.replacementSpan,
            exclude: new Set(context.siblings),
            prefix: context.prefix,
        });
    }
    return buildSzKeyEntries({
        tsMod,
        limit: config.maxEntries,
        replacementSpan: context.replacementSpan,
        shouldStop,
        exclude: new Set(context.siblings),
        prefix: context.prefix,
        additionalNames: theme.breakpoints,
    });
}
