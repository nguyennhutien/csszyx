'use client';

import { useState } from 'react';

/**
 * Client Component - Hydrates on the client
 * Tests interactive state with csszyx class mangling
 */
export function ClientCounter() {
    const [count, setCount] = useState(0);
    const isPositive = count > 0;
    const isNegative = count < 0;

    const counterSz = isPositive
        ? { text: '6xl', fontWeight: 'bold', transition: 'colors', color: 'green-400' }
        : isNegative
          ? { text: '6xl', fontWeight: 'bold', transition: 'colors', color: 'red-400' }
          : { text: '6xl', fontWeight: 'bold', transition: 'colors', color: 'white' };

    return (
        <div data-testid="client-counter" sz={{ p: 6, rounded: 'xl', bg: { color: 'slate-800', op: 50 }, borderColor: 'slate-700', border: true }}>
            <div sz={{ flex: true, items: 'center', justify: 'between', mb: 4 }}>
                <h3 sz={{ text: 'lg', fontWeight: 'semibold', color: 'white' }}>Interactive Counter</h3>
                <span sz={{ px: 2, py: 1, text: 'xs', rounded: 'full', bg: { color: 'green-500', op: 20 }, color: 'green-400' }}>
                    Client Component
                </span>
            </div>

            {/* Counter display with conditional styling */}
            <div sz={{ textAlign: 'center', py: 8 }}>
                <span
                    data-testid="count-value"
                    sz={counterSz}
                >
                    {count}
                </span>
            </div>

            {/* Control buttons */}
            <div sz={{ flex: true, justify: 'center', gap: 4 }}>
                <button
                    onClick={() => setCount((c) => c - 1)}
                    sz={{ px: 6, py: 3, rounded: 'lg', bg: { color: 'red-500', op: 20 }, color: 'red-400', hover: { bg: { color: 'red-500', op: 30 } }, transition: 'colors', fontWeight: 'semibold' }}
                >
                    - Decrease
                </button>
                <button
                    onClick={() => setCount(0)}
                    sz={{ px: 6, py: 3, rounded: 'lg', bg: { color: 'slate-500', op: 20 }, color: 'slate-400', hover: { bg: { color: 'slate-500', op: 30 } }, transition: 'colors', fontWeight: 'semibold' }}
                >
                    Reset
                </button>
                <button
                    onClick={() => setCount((c) => c + 1)}
                    sz={{ px: 6, py: 3, rounded: 'lg', bg: { color: 'green-500', op: 20 }, color: 'green-400', hover: { bg: { color: 'green-500', op: 30 } }, transition: 'colors', fontWeight: 'semibold' }}
                >
                    + Increase
                </button>
            </div>

            {/* State indicator */}
            <div sz={{ mt: 6, textAlign: 'center', text: 'sm', color: 'slate-500' }}>
                {isPositive && <span sz={{ color: 'green-400' }}>Positive value ↑</span>}
                {isNegative && <span sz={{ color: 'red-400' }}>Negative value ↓</span>}
                {count === 0 && <span sz={{ color: 'slate-400' }}>Zero - neutral</span>}
            </div>
        </div>
    );
}
