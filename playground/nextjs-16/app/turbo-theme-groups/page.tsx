import { szcn } from '@csszyx/runtime';

/**
 * Prints what `szcn` does with two custom `@theme` colour tokens.
 *
 * Both are colours, so the later one wins — but only if the build's token scan
 * reached the runtime registry. On this lane that registration is a generated
 * file the loader writes and imports; when it is missing or stale, `szcn`
 * cannot tell the two classes apart and keeps both. The rendered string is
 * therefore a direct read-out of whether the registry is current.
 */
export default function TurboThemeGroupsPage() {
    return (
        <main sz={{ minH: 'screen', bg: 'white', p: 8 }}>
            <div data-testid="next16-theme-groups-merge">
                {szcn('text-csszyx-next', 'text-csszyx-live')}
            </div>
        </main>
    );
}
