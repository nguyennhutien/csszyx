'use client';

import { useState } from 'react';

export function EdgeCaseTests() {
    const [dynamicValue, setDynamicValue] = useState(4);
    const [isActive, setIsActive] = useState(false);

    return (
        <section sz={{ p: 4, bg: 'slate-900', rounded: 'lg' }}>
            <h2 sz={{ text: '2xl', font: 'bold', mb: 4, color: 'white' }}>Edge Case Tests</h2>

            {/* Dynamic value control */}
            <div sz={{ mb: 4, flex: true, gap: 2 }}>
                <button
                    data-testid="edge-increase"
                    onClick={() => setDynamicValue(v => v + 1)}
                    sz={{ px: 4, py: 2, bg: 'blue-600', color: 'white', rounded: 'md', font: 'medium' }}
                >
                    Increase ({dynamicValue})
                </button>
                <button
                    data-testid="edge-toggle"
                    onClick={() => setIsActive(!isActive)}
                    sz={{ px: 4, py: 2, bg: 'purple-600', color: 'white', rounded: 'md', font: 'medium' }}
                >
                    Toggle ({isActive ? 'ON' : 'OFF'})
                </button>
            </div>

            {/* Test grid */}
            <div sz={{ grid: true, gridCols: 2, md: { gridCols: 4 }, gap: 4 }}>
                {/* Case 1: Dynamic spacing */}
                <div
                    data-case="1-dynamic-spacing"
                    sz={{ p: dynamicValue, bg: 'blue-500', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    p-{dynamicValue}
                </div>

                {/* Case 2: Arbitrary value */}
                <div
                    data-case="2-arbitrary"
                    sz={{ w: '[100px]', h: '[60px]', bg: 'purple-500', rounded: 'md', color: 'white', text: 'sm', flex: true, items: 'center', justify: 'center' }}
                >
                    100x60px
                </div>

                {/* Case 3: Dynamic opacity */}
                <div
                    data-case="3-opacity"
                    sz={{ p: 4, bg: { color: 'red-500', op: `${String(dynamicValue * 10)}%` }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    Opacity {dynamicValue * 10}%
                </div>

                {/* Case 4: Negative value */}
                <div
                    data-case="4-negative"
                    sz={{ mt: -2, p: 4, bg: 'green-500', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    -mt-2
                </div>

                {/* Case 5: Fraction */}
                <div
                    data-case="5-fraction"
                    sz={{ w: '1/2', p: 4, bg: 'yellow-500', rounded: 'md', color: 'black', text: 'sm' }}
                >
                    w-1/2
                </div>

                {/* Case 6: Responsive */}
                <div
                    data-case="6-responsive"
                    sz={{ p: 2, bg: 'gray-500', md: { p: 4, bg: 'blue-500' }, lg: { p: 6, bg: 'green-500' }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    Responsive
                </div>

                {/* Case 7: Hover */}
                <div
                    data-case="7-hover"
                    sz={{ p: 4, bg: 'gray-500', hover: { bg: 'gray-700', scale: 105 }, transition: 'all', rounded: 'md', cursor: 'pointer', color: 'white', text: 'sm' }}
                >
                    Hover me
                </div>

                {/* Case 8: Conditional */}
                <div
                    data-case="8-conditional"
                    sz={isActive
                        ? { p: 4, bg: 'green-500', rounded: 'md', color: 'white', text: 'sm' }
                        : { p: 4, bg: 'red-500', rounded: 'md', color: 'white', text: 'sm' }
                    }
                >
                    {isActive ? 'Active' : 'Inactive'}
                </div>
            </div>

            {/* Background Image / Gradient cases */}
            <h3 sz={{ text: 'lg', font: 'semibold', mt: 6, mb: 3, color: 'white' }}>Background Image Tests</h3>
            <div sz={{ grid: true, gridCols: 2, md: { gridCols: 4 }, gap: 4 }}>
                {/* Case 9: Linear gradient to-r (object syntax per spec) */}
                <div
                    data-case="9-gradient-r"
                    sz={{ bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'blue-500', to: 'purple-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-linear-to-r
                </div>

                {/* Case 10: Linear gradient to-b */}
                <div
                    data-case="10-gradient-b"
                    sz={{ bgImg: { gradient: 'linear', dir: 'to-b' }, from: 'green-400', to: 'blue-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-linear-to-b
                </div>

                {/* Case 11: Gradient with via color stop */}
                <div
                    data-case="11-gradient-via"
                    sz={{ bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'red-500', via: 'yellow-500', to: 'green-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    gradient via
                </div>

                {/* Case 12: Radial gradient */}
                <div
                    data-case="12-radial"
                    sz={{ bgImg: { gradient: 'radial' }, from: 'white', to: 'blue-500', p: 4, rounded: 'md', color: 'black', text: 'sm' }}
                >
                    bg-radial
                </div>

                {/* Case 13: Conic gradient (no dir → bg-conic) */}
                {/* Note: fromPos: 0 required to work around TW v4 @property bug —
                    --tw-gradient-from-position initial-value: 0 types as 0px (length),
                    but conic gradients need angle|percentage for stop positions */}
                <div
                    data-case="13-conic"
                    sz={{ bgImg: { gradient: 'conic' }, from: 'red-500', fromPos: 0, via: 'blue-500', to: 'green-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-conic
                </div>

                {/* Case 13b: Conic gradient with position */}
                <div
                    data-case="13b-conic-pos"
                    sz={{ bgImg: { gradient: 'conic', dir: 'at 50% 75%' }, from: 'yellow-400', fromPos: 0, via: 'pink-500', to: 'indigo-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-conic at 50% 75%
                </div>

                {/* Case 14: Linear gradient with interpolation */}
                <div
                    data-case="14-gradient-interp"
                    sz={{ bgImg: { gradient: 'linear', dir: 'to-r', in: 'oklch' }, from: 'blue-500', to: 'red-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-linear/oklch
                </div>

                {/* Case 15: bgSize + bgPos + bgRepeat (with gradient to show effect) */}
                <div
                    data-case="15-bg-props"
                    sz={{ bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'cyan-400', to: 'blue-500', bgSize: 'cover', bgPos: 'center', bgRepeat: 'no-repeat', p: 4, rounded: 'md', color: 'white', text: 'sm', h: 16 }}
                >
                    bg-cover + gradient
                </div>

                {/* Case 16: bgClip text + gradient */}
                <div
                    data-case="16-bg-clip"
                    sz={{ bgClip: 'text', bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'pink-500', to: 'violet-500', text: '2xl', font: 'bold', color: 'transparent', p: 4 }}
                >
                    bg-clip-text
                </div>

                {/* Case 17: bgAttachment (with gradient to show effect) */}
                <div
                    data-case="17-bg-attach"
                    sz={{ bgAttach: 'fixed', bgImg: { gradient: 'linear', dir: 'to-b' }, from: 'indigo-600', to: 'purple-600', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-fixed + gradient
                </div>

                {/* Case 18: bgImg none — removes gradient, keeps color */}
                <div
                    data-case="18-bg-none"
                    sz={{ bgImg: 'none', p: 4, rounded: 'md', color: 'slate-400', text: 'sm', border: 'slate-600' }}
                >
                    bg-none (no bg)
                </div>

                {/* Case 19: w-1/2 fraction */}
                <div
                    data-case="19-fraction-w"
                    sz={{ w: '1/2', bg: 'amber-500', p: 4, rounded: 'md', color: 'black', text: 'sm' }}
                >
                    w-1/2 (50%)
                </div>

                {/* Case 20: h-1/3 fraction */}
                <div
                    data-case="20-fraction-h"
                    sz={{ h: '1/3', bg: 'teal-500', p: 4, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    h-1/3 (33.3%)
                </div>
            </div>

            {/* CSS Variable Auto-Compile Tests */}
            <h3 sz={{ text: 'lg', font: 'semibold', mt: 6, mb: 3, color: 'white' }}>CSS Variable Auto-Compile Tests</h3>
            <div sz={{ grid: true, gridCols: 2, md: { gridCols: 4 }, gap: 4 }}>
                {/* Case 21: Dynamic spacing */}
                <div
                    data-case="21-css-var-spacing"
                    sz={{ p: dynamicValue, bg: 'indigo-500', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    p-{'{'}dynamic{'}'}={dynamicValue}
                </div>

                {/* Case 22: Mixed static + dynamic */}
                <div
                    data-case="22-mixed-static-dynamic"
                    sz={{ p: dynamicValue, bg: 'blue-500', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    dynamic p + static bg
                </div>

                {/* Case 23: Static color+opacity (object form) */}
                <div
                    data-case="23-color-opacity-object"
                    sz={{ p: 4, bg: { color: 'red-500', op: 40 }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-red-500/40
                </div>

                {/* Case 24: Different opacity values */}
                <div
                    data-case="24-color-opacity-high"
                    sz={{ p: 4, bg: { color: 'emerald-500', op: 80 }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-emerald-500/80
                </div>

                {/* Case 25: Responsive opacity override */}
                <div
                    data-case="25-responsive-opacity"
                    sz={{ p: 4, bg: { color: 'blue-500', op: 20 }, md: { bg: { color: 'blue-500', op: 80 } }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-blue-500/20 md:80
                </div>

                {/* Case 26: CSS variable opacity */}
                <div
                    data-case="26-css-var-opacity"
                    sz={{ p: 4, bg: { color: 'purple-500', op: '--my-alpha' }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    bg-purple-500/(--my-alpha)
                </div>

                {/* Case 27: will-change transform */}
                <div
                    data-case="27-will-change"
                    sz={{ p: 4, bg: 'pink-500', willChange: 'transform', rounded: 'md', color: 'white', text: 'sm', hover: { scale: 110 }, transition: 'all' }}
                >
                    will-change-transform
                </div>

                {/* Case 28: will-change scroll-position */}
                <div
                    data-case="28-will-change-scroll"
                    sz={{ p: 4, bg: 'amber-600', willChange: 'scroll', rounded: 'md', color: 'white', text: 'sm' }}
                >
                    will-change-scroll-position
                </div>
            </div>
        </section>
    );
}
