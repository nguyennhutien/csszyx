// Imports szv catalogs from a plain `.ts` module and resolves them via `_sz` to
// a className string. No `sz=` and no szv declaration in THIS file — the catalogs
// live in flexVariants.ts. Verifies the cross-module / code-split shape: the
// safelisting comes from the `.ts` module, the `.tsx` only consumes the factory.
import { _sz } from '@csszyx/runtime';
import { cardSz, stackSz } from './flexVariants';

export function SzvFromTs() {
    const cardClass = _sz(cardSz({ pad: 'loose' }), cardSz({ size: 'a' }), cardSz({ radius: 'big' }));
    const stackClass = _sz(stackSz({ gap: 'xl' }), stackSz({ gap: 'num' }));

    return (
        <section data-testid="szv-from-ts" className="border border-gray-300">
            <div data-testid="szv-ts-card" className={cardClass}>
                catalog imported from a .ts module
            </div>
            <div data-testid="szv-ts-stack" className={stackClass}>
                large gap from a .ts module
            </div>
        </section>
    );
}
