import { aliasCardSz } from '@/app/alias-import/styles';

export default function AliasImportPage() {
    return (
        <main sz={{ p: 4 }}>
            <h1 sz={{ text: 'lg', weight: 'bold' }}>Aliased cross-module import</h1>
            {/* Compiled, the padding comes from a Tailwind rule the build
                safelisted. Left to the runtime, this element still carries the
                class and no rule defines it — so the padding is what says
                which of the two happened. */}
            <div data-testid="alias-card" sz={aliasCardSz}>
                aliased
            </div>
        </main>
    );
}
