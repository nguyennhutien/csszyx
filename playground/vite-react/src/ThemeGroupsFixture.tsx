// The runtime package directly, not the `csszyx` umbrella: the umbrella's
// main entry re-exports the COMPILER, which pulls the native binding and
// cannot resolve under browser conditions.
import { szcn } from '@csszyx/runtime';

/**
 * Prints what `szcn` does with two custom `@theme` colour tokens.
 *
 * Both are colours, so the later one wins — but only when the build's token
 * scan actually reached the runtime registry. When it did not, or when it went
 * stale after a stylesheet edit, `szcn` cannot tell the two classes apart and
 * keeps both. The rendered string is therefore a direct read-out of whether the
 * registry is current, which is what `vite-react-theme-groups.spec.ts` asserts
 * before and after removing a token.
 */
export function ThemeGroupsFixture() {
    return (
        <div sz={{ p: 8 }}>
            <div data-testid="vite-theme-groups-merge">
                {szcn('text-vite-base', 'text-vite-live')}
            </div>
        </div>
    );
}

export default ThemeGroupsFixture;
