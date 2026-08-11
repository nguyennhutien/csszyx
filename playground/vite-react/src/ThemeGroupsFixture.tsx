// Deliberately the `csszyx` umbrella rather than `@csszyx/runtime`: the docs
// teach this import for app code, and it once could not be bundled at all
// because the main entry reaches the compiler. Keeping the playground on it
// means a real Vite production build re-proves the browser entry every run.
import { szcn } from 'csszyx';

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
