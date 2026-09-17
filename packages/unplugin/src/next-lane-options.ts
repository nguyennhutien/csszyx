/**
 * The options every Next Turbopack lane takes.
 *
 * The loader and the prebuild have to resolve these the same way: the prebuild
 * safelists the classes the loader emits, and both build the generation
 * identity from them. Declared once, so a field added for one lane cannot be
 * forgotten on the other.
 *
 * @module
 */
import type { TransformSourceCodeOptions } from '@csszyx/compiler';

import type { JsonLike } from './next-cache-identity.js';
import type { AtomicWriteOptions } from './next-safelist-state.js';
import type { NextSourceParserMode } from './next-source-transformer.js';

/** Options the Next Turbopack loader and prebuild share. */
export interface NextLaneOptions {
    cacheDir?: string;
    safelistOutputFile?: string;
    parserMode?: NextSourceParserMode;
    compilerOptions?: TransformSourceCodeOptions;
    /** The stylesheets the app loads, when the project also holds others. */
    tailwindStylesheet?: string | string[];
    config?: JsonLike;
    env?: Record<string, string | undefined>;
    envKeys?: readonly string[];
    nextVersion?: string;
    csszyxVersion?: string;
    compilerVersion?: string;
    nativeVersion?: string;
    mode?: 'development' | 'production';
    astBudget?: number;
    allowProductionMangling?: boolean;
    writeOptions?: AtomicWriteOptions;
}
