/**
 * Conditional-spread fixture: csszyx statically expands the spread into a
 * ternary of class strings, which SolidJS compiles to ssrAttribute("class",
 * ...) on the server and setProperty(el, "className", ...) on the client.
 * Both forms must be rewritten by the bundle mangler (mangleCodeClassesSync
 * Pass 2.5) — a real-app integration test shipped unstyled SSR HTML when
 * they were missed.
 */
export default function ToneCallout(props: { tone: 'info' | 'warn'; message: string }) {
    return (
        <div
            sz={{
                my: 8,
                p: 6,
                rounded: 'lg',
                border: true,
                ...(props.tone === 'warn'
                    ? { bg: 'amber-100', borderColor: 'amber-400' }
                    : { bg: 'sky-100', borderColor: 'sky-400' }),
            }}
        >
            {props.message}
        </div>
    );
}
