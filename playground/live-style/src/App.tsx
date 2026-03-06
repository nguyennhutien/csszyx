import { useState } from 'react';
import { FormPreview } from './FormPreview';
import { ConfigPanel } from './ConfigPanel';
import { defaultConfig, type FormConfig } from './config';

export function App() {
    const [config, setConfig] = useState<FormConfig>(defaultConfig);

    const patch = (p: Partial<FormConfig>) => setConfig((c) => ({ ...c, ...p }));

    return (
        <div sz={{ h: 'screen', flex: true, flexDir: 'col', bg: 'gray-950', color: 'white', overflow: 'hidden' }}>
            {/* Header */}
            <header sz={{ flex: true, items: 'center', justify: 'between', px: 6, py: 3, borderB: true, borderColor: 'gray-800' }}>
                <div sz={{ flex: true, items: 'center', gap: 3 }}>
                    <span sz={{ text: 'sm', fontFamily: 'mono', color: 'indigo-400', fontWeight: 'semibold' }}>
                        @csszyx/vars
                    </span>
                    <span sz={{ text: 'xs', color: 'gray-600' }}>—</span>
                    <span sz={{ text: 'sm', color: 'gray-400' }}>
                        JSON-driven form styling via CSS variables
                    </span>
                </div>
                <div sz={{ flex: true, items: 'center', gap: 2 }}>
                    <span sz={{ text: 'xs', color: 'gray-600', fontFamily: 'mono' }}>No rebuild.</span>
                    <span sz={{ text: 'xs', color: 'gray-600', fontFamily: 'mono' }}>No reload.</span>
                    <span sz={{ text: 'xs', color: 'indigo-400', fontFamily: 'mono' }}>Instant.</span>
                </div>
            </header>

            {/* Split layout */}
            <div sz={{ flex: true, grow: true, overflow: 'hidden' }}>
                {/* Left: Form preview */}
                <div sz={{ grow: true, bg: 'gray-900', overflow: 'auto' }}>
                    <FormPreview config={config} />
                </div>

                {/* Divider */}
                <div sz={{ w: 'px', bg: 'gray-800', shrink: 0 }} />

                {/* Right: Config panel */}
                <div sz={{ w: '72', shrink: 0, bg: 'gray-950', overflow: 'auto' }}>
                    <ConfigPanel config={config} onChange={patch} />
                </div>
            </div>
        </div>
    );
}
