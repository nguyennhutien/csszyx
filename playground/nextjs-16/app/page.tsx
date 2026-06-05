export default function Home() {
    return (
        <main sz={{ minH: 'screen', bg: 'slate-50', p: 8 }}>
            <section
                sz={{
                    maxW: '3xl',
                    mx: 'auto',
                    bg: 'white',
                    rounded: 'xl',
                    border: true,
                    borderColor: 'slate-200',
                    shadow: 'lg',
                    p: 8,
                }}
            >
                <p sz={{ text: 'sm', fontWeight: 'semibold', color: 'blue-600', mb: 2 }}>
                    Next.js 16 Webpack mode
                </p>
                <h1 sz={{ text: '4xl', fontWeight: 'bold', color: 'slate-950', mb: 4 }}>
                    csszyx Next.js 16 Playground
                </h1>
                <p sz={{ text: 'lg', color: 'slate-600', mb: 8 }}>
                    This route is the risk-zero Next.js 16 path: csszyx runs through
                    the existing Webpack adapter with production hydration metadata.
                </p>

                <div
                    data-testid="next16-card"
                    sz={{
                        p: 6,
                        rounded: 'lg',
                        bg: 'blue-50',
                        border: true,
                        borderColor: 'blue-200',
                        color: 'blue-950',
                    }}
                >
                    <span data-testid="next16-card-label" sz={{ fontWeight: 'semibold' }}>
                        sz prop transformed and styled
                    </span>
                </div>
            </section>
        </main>
    );
}
