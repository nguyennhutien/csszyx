'use client';

import { useState } from 'react';

export function CssVarFixture() {
    const [pad, setPad] = useState(4);

    return (
        <section
            data-testid="next-css-var-fixture"
            sz={{ p: 4, rounded: 'xl', bg: { color: 'slate-800', op: 50 }, border: true, borderColor: 'slate-700' }}
        >
            <h3 sz={{ text: 'lg', fontWeight: 'semibold', color: 'white', mb: 3 }}>
                CSS Variable Mangling
            </h3>
            <button
                data-testid="next-css-var-button"
                onClick={() => setPad(value => value + 1)}
                sz={{ px: 4, py: 2, bg: 'cyan-600', color: 'white', rounded: 'md', mb: 4 }}
            >
                Increase var spacing
            </button>
            <div
                data-testid="next-css-var-card-a"
                sz={{ p: pad, bg: { color: 'cyan-500', op: 10 }, rounded: 'md' }}
            >
                Shared dynamic padding A
            </div>
            <span
                data-testid="next-css-var-card-b"
                sz={{ p: pad, display: 'block', bg: { color: 'emerald-500', op: 10 }, rounded: 'md', mt: 3 }}
            >
                Shared dynamic padding B
            </span>
            <div
                data-testid="next-css-var-scoped"
                sz={{ p: pad + 1, bg: { color: 'violet-500', op: 10 }, rounded: 'md', mt: 3 }}
            >
                Scoped dynamic padding
            </div>
        </section>
    );
}
