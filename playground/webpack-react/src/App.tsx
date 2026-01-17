import React from 'react';

const App: React.FC = () => {
    return (
        <div sz={{
            minH: '100vh',
            bg: 'slate-900',
            text: 'white',
            p: 8,
            font: 'sans'
        }}>
            <div sz={{ maxW: '2xl', mx: 'auto' }}>
                <h1 sz={{ text: '4xl', textAlign: 'center', color: 'blue-400', font: 'bold', mb: 6 }}>
                    Welcome to csszyx + Webpack (Object Syntax)
                </h1>

                <div sz={{ grid: true, gridCols: 1, md: { gridCols: 2 }, gap: 6 }}>
                    <div sz={{
                        p: 6,
                        bg: 'slate-800',
                        rounded: 'xl',
                        border: 'slate-700',
                        hover: { border: 'blue-500' },
                        transition: 'colors'
                    }}>
                        <h2 sz={{ text: 'xl', font: 'semibold', mb: 3 }}>Feature 1</h2>
                        <p sz={{ text: 'slate-400' }}>
                            This card uses object syntax for styles.
                        </p>
                    </div>

                    <div sz={{
                        p: 6,
                        bg: 'slate-800',
                        rounded: 'xl',
                        border: 'slate-700',
                        hover: { border: 'purple-500' },
                        transition: 'colors'
                    }}>
                        <h2 sz={{ text: 'xl', font: 'semibold', mb: 3 }}>Feature 2</h2>
                        <p sz={{ text: 'slate-400' }}>
                            Webpack HMR and bundling should work seamlessly.
                        </p>
                    </div>
                </div>

                <div sz={{ mt: 12, textAlign: 'center' }}>
                    <button sz={{
                        px: 6,
                        py: 3,
                        bg: 'blue-600',
                        hover: { bg: 'blue-700' },
                        rounded: 'lg',
                        font: 'medium',
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
