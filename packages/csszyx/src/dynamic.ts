/**
 * csszyx/dynamic — Runtime CSS injection engine.
 *
 * Re-exports @csszyx/dynamic for use via the umbrella package.
 *
 * @example
 * import { dynamic, preloadManifest } from 'csszyx/dynamic';
 * import { useSz } from 'csszyx/dynamic/react';
 */
export type { CSSManifest, SzObject, Tier } from '@csszyx/dynamic';
export { cleanup, dynamic, preloadManifest } from '@csszyx/dynamic';
