import { useState } from 'react';
import type { FormConfig } from './config';
import { configToVars } from './config';

interface ConfigPanelProps {
    config: FormConfig;
    onChange: (patch: Partial<FormConfig>) => void;
}

export function ConfigPanel({ config, onChange }: ConfigPanelProps) {
    const [jsonOpen, setJsonOpen] = useState(false);

    return (
        <div sz={{ h: 'full', overflow: 'auto', p: 6, display: 'flex', flexDir: 'col', gap: 6 }}>
            <div>
                <h2 sz={{ text: 'sm', weight: 'semibold', tracking: 'widest', textTransform: 'uppercase', color: 'gray-400', mb: 4 }}>
                    Style Config
                </h2>

                <Section label="Form Container">
                    <ColorRow label="Background" value={config.formBg} onChange={(v) => onChange({ formBg: v })} />
                    <ColorRow label="Border" value={config.formBorderColor} onChange={(v) => onChange({ formBorderColor: v })} />
                    <SliderRow label="Padding" value={parseInt(config.formPadding)} min={8} max={64} unit="px" onChange={(v) => onChange({ formPadding: `${v}px` })} />
                    <SliderRow label="Radius" value={parseInt(config.formRadius)} min={0} max={32} unit="px" onChange={(v) => onChange({ formRadius: `${v}px` })} />
                </Section>

                <Section label="Input Fields">
                    <ColorRow label="Background" value={config.inputBg} onChange={(v) => onChange({ inputBg: v })} />
                    <ColorRow label="Border" value={config.inputBorderColor} onChange={(v) => onChange({ inputBorderColor: v })} />
                    <ColorRow label="Focus border" value={config.inputFocusBorderColor} onChange={(v) => onChange({ inputFocusBorderColor: v })} />
                    <ColorRow label="Text" value={config.inputTextColor} onChange={(v) => onChange({ inputTextColor: v })} />
                    <SliderRow label="Radius" value={parseInt(config.inputRadius)} min={0} max={20} unit="px" onChange={(v) => onChange({ inputRadius: `${v}px` })} />
                </Section>

                <Section label="Submit Button">
                    <ColorRow label="Background" value={config.btnBg} onChange={(v) => onChange({ btnBg: v })} />
                    <ColorRow label="Hover bg" value={config.btnHoverBg} onChange={(v) => onChange({ btnHoverBg: v })} />
                    <ColorRow label="Text" value={config.btnColor} onChange={(v) => onChange({ btnColor: v })} />
                    <SliderRow label="Radius" value={parseInt(config.btnRadius)} min={0} max={32} unit="px" onChange={(v) => onChange({ btnRadius: `${v}px` })} />
                </Section>

                <Section label="Labels">
                    <ColorRow label="Color" value={config.labelColor} onChange={(v) => onChange({ labelColor: v })} />
                    <SliderRow label="Font size" value={parseInt(config.labelSize)} min={10} max={20} unit="px" onChange={(v) => onChange({ labelSize: `${v}px` })} />
                </Section>
            </div>

            {/* JSON representation — what this would look like from an API */}
            <div sz={{ mt: 'auto' }}>
                <button
                    sz={{ display: 'flex', items: 'center', justify: 'between', w: 'full', text: 'xs', color: 'gray-400', fontFamily: 'mono', py: 2 }}
                    onClick={() => setJsonOpen((o) => !o)}
                >
                    <span>JSON Config</span>
                    <span>{jsonOpen ? '▲' : '▼'}</span>
                </button>
                {jsonOpen && (
                    <pre sz={{ text: 'xs', color: 'gray-400', bg: 'gray-950', p: 3, rounded: 'md', overflow: 'auto', maxH: '48' }}>
                        {JSON.stringify(configToVars(config), null, 2)}
                    </pre>
                )}
            </div>
        </div>
    );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div sz={{ mb: 5 }}>
            <p sz={{ text: 'xs', color: 'gray-500', weight: 'medium', mb: 2 }}>{label}</p>
            <div sz={{ display: 'flex', flexDir: 'col', gap: 2 }}>
                {children}
            </div>
        </div>
    );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <div sz={{ display: 'flex', items: 'center', justify: 'between', gap: 3 }}>
            <span sz={{ text: 'sm', color: 'gray-300' }}>{label}</span>
            <div sz={{ display: 'flex', items: 'center', gap: 2 }}>
                <span sz={{ text: 'xs', color: 'gray-500', fontFamily: 'mono' }}>{value}</span>
                <input
                    type="color"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    style={{ width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer', padding: 2, background: 'transparent' }}
                />
            </div>
        </div>
    );
}

function SliderRow({ label, value, min, max, unit, onChange }: {
    label: string; value: number; min: number; max: number; unit: string;
    onChange: (v: number) => void;
}) {
    return (
        <div sz={{ display: 'flex', items: 'center', justify: 'between', gap: 3 }}>
            <span sz={{ text: 'sm', color: 'gray-300' }}>{label}</span>
            <div sz={{ display: 'flex', items: 'center', gap: 2 }}>
                <input
                    type="range"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                    style={{ width: 80, accentColor: '#6366f1' }}
                />
                <span sz={{ text: 'xs', color: 'gray-500', fontFamily: 'mono', w: '10', textAlign: 'right' }}>
                    {value}{unit}
                </span>
            </div>
        </div>
    );
}
