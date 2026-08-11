import { turboCardSz } from '@/app/turbo-csszyx/styles';

export default function TurboCsszyxPage() {
    return (
        <main sz={{ minH: 'screen', bg: 'white', p: 8 }}>
            <div
                data-testid="next16-csszyx-loader-target"
                sz={{
                    p: 10,
                    bg: 'emerald-500',
                    color: 'white',
                    rounded: 'lg',
                    weight: 'semibold',
                }}
            >
                csszyx Turbopack loader transformed this route.
            </div>
            {/* HMR baseline target — edited at runtime by nextjs-16-turbo-csszyx-loader-hmr.spec.ts.
                The literal `sz={{ p: 4 }}` below must stay on its own line so the spec can
                regex-replace it deterministically. */}
            {/* Compiled, the padding comes from a rule the prebuild safelisted.
                Left to the runtime the class is still applied and no rule
                defines it, so the padding is what says which happened. */}
            <div data-testid="next16-csszyx-cross-module" sz={turboCardSz}>
                Imported style object.
            </div>
            <div
                data-testid="next16-csszyx-hmr-target"
                sz={{ p: 4, bg: 'sky-500', color: 'white', rounded: 'md', weight: 'semibold' }}
            >
                HMR baseline target.
            </div>
        </main>
    );
}
