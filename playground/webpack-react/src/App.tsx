import React from 'react';

const App: React.FC = () => {
    return (
        <div sz={{
            minH: '100vh',
            bg: 'slate-900',
            color: 'white',
            p: 8,
            fontFamily: 'sans'
        }}>
            <div sz={{ maxW: '2xl', mx: 'auto' }}>
                <h1 sz={{ text: '4xl', textAlign: 'center', color: 'blue-400', weight: 'bold', mb: 6 }}>
                    Welcome to csszyx + Webpack (Object Syntax)
                </h1>

                <div sz={{ display: 'grid', gridCols: 1, md: { gridCols: 2 }, gap: 6 }}>
                    <div sz={{
                        p: 6,
                        bg: 'slate-800',
                        rounded: 'xl',
                        borderColor: 'slate-700',
                        border: true,
                        hover: { borderColor: 'blue-500' },
                        transition: 'colors'
                    }}>
                        <h2 sz={{ text: 'xl', weight: 'semibold', mb: 3 }}>Feature 1</h2>
                        <p sz={{ color: 'slate-400' }}>
                            This card uses object syntax for styles.
                        </p>
                    </div>

                    <div sz={{
                        p: 6,
                        bg: 'slate-800',
                        rounded: 'xl',
                        borderColor: 'slate-700',
                        border: true,
                        hover: { borderColor: 'purple-500' },
                        transition: 'colors'
                    }}>
                        <h2 sz={{ text: 'xl', weight: 'semibold', mb: 3 }}>Feature 2</h2>
                        <p sz={{ color: 'slate-400' }}>
                            Webpack HMR and bundling should work seamlessly.
                        </p>
                    </div>
                </div>

                {/* New Features Showcase */}
                <div sz={{ mt: 12 }}>
                    <h2 sz={{ text: '2xl', weight: 'semibold', mb: 6, textAlign: 'center' }}>
                        New Features
                    </h2>
                    <div sz={{ display: 'grid', gridCols: 1, md: { gridCols: 3 }, gap: 6 }}>
                        {/* Text/Leading shorthand */}
                        <div sz={{ p: 6, bg: 'slate-800', rounded: 'xl', border: true, borderColor: 'slate-700' }}>
                            <h3 sz={{ text: 'lg', weight: 'semibold', color: 'emerald-400', mb: 3 }}>Text/Leading</h3>
                            <p sz={{ text: 'lg', leading: 7, color: 'slate-300' }}>
                                text-lg/7 merged shorthand
                            </p>
                            <p sz={{ text: 'sm', leading: 'tight', color: 'slate-400', mt: 2 }}>
                                text-sm/tight keyword
                            </p>
                        </div>

                        {/* Explicit keys */}
                        <div sz={{ p: 6, bg: 'slate-800', rounded: 'xl', border: true, borderColor: 'slate-700' }}>
                            <h3 sz={{ text: 'lg', weight: 'semibold', color: 'blue-400', mb: 3 }}>Explicit Keys</h3>
                            <p sz={{ weight: 'bold', color: 'slate-300' }}>fontWeight: bold</p>
                            <p sz={{ fontFamily: 'mono', color: 'slate-300' }}>fontFamily: mono</p>
                            <p sz={{ fontFamily: 'serif', color: 'slate-300' }}>fontFamily: serif</p>
                        </div>

                        {/* Shadow color opacity */}
                        <div sz={{ p: 6, bg: 'slate-800', rounded: 'xl', border: true, borderColor: 'slate-700' }}>
                            <h3 sz={{ text: 'lg', weight: 'semibold', color: 'purple-400', mb: 3 }}>Shadow Opacity</h3>
                            <div sz={{ p: 3, bg: 'slate-700', rounded: 'md', shadow: 'lg', shadowColor: { color: 'blue-500', op: 50 }, mb: 2 }}>
                                shadow-blue-500/50
                            </div>
                            <div sz={{ p: 3, bg: 'slate-700', rounded: 'md', insetShadow: 'sm', insetShadowColor: { color: 'purple-500', op: 40 } }}>
                                inset-shadow-purple-500/40
                            </div>
                        </div>
                    </div>
                </div>

                <div sz={{ mt: 12, textAlign: 'center' }}>
                    <button sz={{
                        px: 6,
                        py: 3,
                        bg: 'blue-600',
                        hover: { bg: 'blue-700' },
                        rounded: 'lg',
                        weight: 'medium',
                        transition: 'colors'
                    }}>
                        Click Me
                    </button>
                </div>
            </div>
        </div>
    );
};

export default App;
