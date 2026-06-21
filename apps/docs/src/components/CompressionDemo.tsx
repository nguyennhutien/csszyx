import { Panel } from './Panel.tsx';

/**
 * Static 3-column panel showing the sz → Tailwind → mangled class pipeline.
 * In production builds, this component's own classes are mangled — proving
 * the product works by dogfooding it in the docs.
 */
export function CompressionDemo() {
    return (
        <Panel>
            <p
                sz={{
                    fontFamily: '--ds-font-ui',
                    text: 'xs',
                    tracking: 'widest',
                    textTransform: 'uppercase',
                    color: '--ds-text-subtle',
                    mb: 4,
                }}
            >
                COMPRESSION CHAMBER
            </p>
            <div
                sz={{
                    display: 'grid',
                    gridCols: 3,
                    gap: 4,
                    items: 'start',
                }}
            >
                {/* INPUT */}
                <div>
                    <p
                        sz={{
                            fontFamily: '--ds-font-ui',
                            text: 'xs',
                            textTransform: 'uppercase',
                            color: '--ds-primary',
                            mb: 2,
                        }}
                    >
                        INPUT
                    </p>
                    <pre
                        sz={{
                            bg: '--ds-bg-alt',
                            p: 3,
                            rounded: 'sm',
                            text: 'xs',
                            color: '--ds-text',
                            fontFamily: '--ds-font-code',
                            overflow: 'auto',
                        }}
                    >
                        {`sz={{\n  p: 4,\n  bg: 'blue-500',\n  hover: {\n    bg: 'blue-600'\n  }\n}}`}
                    </pre>
                </div>

                {/* ARROW */}
                <div
                    sz={{
                        display: 'flex',
                        items: 'center',
                        justify: 'center',
                        pt: 6,
                    }}
                >
                    <span
                        sz={{
                            text: '2xl',
                            color: '--ds-primary',
                            fontFamily: '--ds-font-ui',
                        }}
                    >
                        →
                    </span>
                </div>

                {/* OUTPUT */}
                <div>
                    <p
                        sz={{
                            fontFamily: '--ds-font-ui',
                            text: 'xs',
                            textTransform: 'uppercase',
                            color: '--ds-primary',
                            mb: 2,
                        }}
                    >
                        OUTPUT
                    </p>
                    <pre
                        sz={{
                            bg: '--ds-bg-alt',
                            p: 3,
                            rounded: 'sm',
                            text: 'xs',
                            color: '--ds-text',
                            fontFamily: '--ds-font-code',
                            overflow: 'auto',
                        }}
                    >
                        {'class='}{'"z y x"'}
                    </pre>
                </div>
            </div>
        </Panel>
    );
}
