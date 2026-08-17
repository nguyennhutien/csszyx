/**
 * The keys on a reference page whose value must be known at build time.
 *
 * Tailwind lowers a runtime value to `<prefix>-(--_sz-<key>)`, which only works
 * when the var form is the same utility as the literal form with the value
 * deferred. For the keys below it is not: `text-(--v)` is a COLOUR, so a runtime
 * `textAlign` styled the wrong property, and `display-(--v)` matches no utility
 * at all. csszyx drops both the class and the variable and reports it.
 *
 * This map is the single copy for the whole docs site — a per-page list would
 * drift the moment a Tailwind upgrade changed one of them. It is verified
 * against the engine by `pnpm check:var-hostile-keys`, which derives the same
 * set by compiling both forms of every documented key through the pinned
 * Tailwind. Do not hand-edit: fix `packages/compiler/src/var-hostile-keys.ts`
 * and let the gate tell you what to change here.
 */
export const KEYS_WITHOUT_A_RUNTIME_FORM = {
    backgrounds: ['bgAttach', 'bgClip', 'bgImg', 'bgOrigin', 'bgRepeat', 'bgSize'],
    borders: ['borderStyle', 'outlineStyle'],
    effects: [
        'maskClip',
        'maskComposite',
        'maskConic',
        'maskLinear',
        'maskMode',
        'maskOrigin',
        'maskRepeat',
        'maskType',
        'mixBlend',
    ],
    'flex-grid': [
        'alignContent',
        'flexDir',
        'flexWrap',
        'gridFlow',
        'items',
        'justify',
        'justifyItems',
        'justifySelf',
        'placeContent',
        'placeItems',
        'placeSelf',
        'self',
    ],
    interactivity: [
        'appearance',
        'fieldSizing',
        'pointerEvents',
        'resize',
        'scheme',
        'scroll',
        'scrollbar',
        'scrollbarGutter',
        'select',
        'snapAlign',
        'snapStop',
        'snapType',
        'touch',
    ],
    layout: [
        'box',
        'boxDecoration',
        'breakAfter',
        'breakBefore',
        'breakInside',
        'clear',
        'display',
        'float',
        'isolation',
        'notSrOnly',
        'objectFit',
        'overflow',
        'overflowX',
        'overflowY',
        'overscroll',
        'overscrollX',
        'overscrollY',
        'position',
        'srOnly',
        'visibility',
    ],
    misc: ['borderCollapse', 'caption', 'forcedColorAdjust', 'tableLayout'],
    sizing: ['container'],
    transforms: ['backface', 'transformStyle'],
    transitions: ['transitionBehavior'],
    typography: [
        'decoration',
        'decorationStyle',
        'fontFamily',
        'fontSmoothing',
        'fontStyle',
        'fontVariant',
        'listPos',
        'ordinal',
        'slashedZero',
        'text',
        'textAlign',
        'textClip',
        'textEllipsis',
        'textTransform',
        'textWrap',
        'whitespace',
    ],
} as const satisfies Record<string, readonly string[]>;

/** A reference page that documents at least one such key. */
export type RuntimeValueGroup = keyof typeof KEYS_WITHOUT_A_RUNTIME_FORM;

interface RuntimeValueNoteProps {
    /** Which reference page this note is on. */
    group: RuntimeValueGroup;
}

/**
 * Callout listing this page's keys that only accept a build-time value.
 *
 * @param props - The reference page whose keys to list.
 * @returns The rendered callout.
 */
export function RuntimeValueNote({ group }: RuntimeValueNoteProps) {
    const keys = KEYS_WITHOUT_A_RUNTIME_FORM[group];
    return (
        <aside
            sz={{
                borderL: 4,
                borderStyle: 'solid',
                borderColor: '--ds-primary',
                bg: '--ds-bg',
                px: 4,
                py: 3,
                my: 6,
                rounded: 'sm',
                text: 'sm',
            }}
        >
            <p sz={{ weight: 700, mb: 2 }}>
                {keys.length === 1
                    ? 'This key needs a build-time value'
                    : 'These keys need a build-time value'}
            </p>
            <p sz={{ mb: 2 }}>
                {keys.map(key => (
                    <span key={key}>
                        <code>{key}</code>{' '}
                    </span>
                ))}
            </p>
            <p sz={{ mb: 0 }}>
                Tailwind has no utility for them that reads a CSS variable, so csszyx drops the
                class and reports it rather than styling a different property. A literal, a
                ternary between literals, and a <code>szv</code> variant all compile — only a
                bare runtime value does not.{' '}
                <a href="/docs/reference/warnings/#keys-that-need-a-build-time-value">
                    How to write it instead
                </a>
                .
            </p>
        </aside>
    );
}
