import { AdvancedCases } from '@/components/advanced-cases';
import { ClientCounter } from '@/components/client-counter';
import { CssVarFixture } from '@/components/css-var-fixture';
import { EdgeCaseTests } from '@/components/edge-cases';
import { HydrationTest } from '@/components/hydration-test';
import { ServerCard } from '@/components/server-card';

export default function Home() {
    return (
        <main sz={{ minH: 'screen', p: 8, bgImg: { gradient: 'linear', dir: 'to-b' }, from: 'slate-900', to: 'slate-800' }}>
            <div sz={{ maxW: '4xl', mx: 'auto' }}>
                <h1 sz={{ text: '4xl', fontWeight: 'bold', color: 'white', mb: 8, textAlign: 'center' }}>
                    csszyx Next.js SSR Playground
                </h1>

                <p sz={{ color: 'slate-300', textAlign: 'center', mb: 12 }}>
                    Testing SSR Hydration Guard and Webpack integration with App Router
                </p>

                {/* Server Component Section */}
                <section sz={{ mb: 12 }}>
                    <h2 sz={{ text: '2xl', fontWeight: 'semibold', color: 'white', mb: 4 }}>
                        Server Components (RSC)
                    </h2>
                    <p sz={{ color: 'slate-400', mb: 4, text: 'sm' }}>
                        These components are rendered on the server. The sz prop is
                        transformed at build time.
                    </p>
                    <div sz={{ grid: true, gridCols: 1, md: { gridCols: 2 }, gap: 4 }}>
                        <ServerCard
                            title="Static Card"
                            description="This card is rendered entirely on the server."
                        />
                        <ServerCard
                            title="Another Card"
                            description="Server Components have zero JS overhead."
                        />
                    </div>
                </section>

                {/* Client Component Section */}
                <section sz={{ mb: 12 }}>
                    <h2 sz={{ text: '2xl', fontWeight: 'semibold', color: 'white', mb: 4 }}>
                        Client Components
                    </h2>
                    <p sz={{ color: 'slate-400', mb: 4, text: 'sm' }}>
                        These components hydrate on the client. The Hydration Guard ensures
                        class consistency.
                    </p>
                    <ClientCounter />
                </section>

                {/* Hydration Test Section */}
                <section sz={{ mb: 12 }}>
                    <h2 sz={{ text: '2xl', fontWeight: 'semibold', color: 'white', mb: 4 }}>
                        Hydration Guard Test
                    </h2>
                    <p sz={{ color: 'slate-400', mb: 4, text: 'sm' }}>
                        This component tests the SSR → CSR hydration consistency.
                    </p>
                    <HydrationTest />
                </section>

                {/* Edge Case Tests */}
                <section sz={{ mb: 12 }}>
                    <EdgeCaseTests />
                </section>

                {/* CSS Variable Mangling */}
                <section sz={{ mb: 12 }}>
                    <CssVarFixture />
                </section>

                {/* Advanced Cases */}
                <section sz={{ mb: 12 }}>
                    <AdvancedCases />
                </section>

                {/* Conditional Styling Test */}
                <section sz={{ mb: 12 }}>
                    <h2 sz={{ text: '2xl', fontWeight: 'semibold', color: 'white', mb: 4 }}>
                        Conditional Styling (_szIf)
                    </h2>
                    <p sz={{ color: 'slate-400', mb: 4, text: 'sm' }}>
                        Testing conditional class application with sz prop.
                    </p>
                    <div sz={{ flex: true, gap: 4 }}>
                        <div sz={{ p: 4, rounded: 'lg', bg: { color: 'green-500', op: 20 }, borderColor: 'green-500', border: true }}>
                            <span sz={{ color: 'green-400' }}>Active State</span>
                        </div>
                        <div sz={{ p: 4, rounded: 'lg', bg: { color: 'slate-500', op: 20 }, borderColor: 'slate-500', border: true }}>
                            <span sz={{ color: 'slate-400' }}>Inactive State</span>
                        </div>
                    </div>
                </section>

                {/* Footer */}
                <footer sz={{ textAlign: 'center', color: 'slate-500', text: 'sm', pt: 8, borderT: true, borderColor: 'slate-700' }}>
                    <p>csszyx SSR Playground - Webpack Integration Demo</p>
                </footer>
            </div>
        </main>
    );
}
