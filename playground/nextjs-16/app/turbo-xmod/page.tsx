import { xmodCardSz } from '@/app/turbo-xmod/styles';

export default function CrossModuleIsolatedPage() {
    return (
        <main sz={{ p: 4 }}>
            <h1 sz={{ text: 'lg', weight: 'bold' }}>Cross-module provider, isolated lane</h1>
            {/* Compiled, the padding comes from a Tailwind rule this route's own
                stylesheet safelisted. Left to the runtime, the element still
                carries the class and no rule defines it — so the padding is what
                says which of the two happened. */}
            <div data-testid="xmod-card" sz={xmodCardSz}>
                isolated
            </div>
        </main>
    );
}
