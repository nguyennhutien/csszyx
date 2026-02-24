import { Suspense } from 'react';
import Link from 'next/link';
import { AsyncDataLoader } from '@/components/async-data-loader';

/**
 * SSR Test Page - Tests various SSR scenarios with csszyx
 */
export default function SSRTestPage() {
    return (
        <main sz="min-h-screen p-8 bg-linear-to-b from-slate-900 to-slate-800">
            <div sz="max-w-4xl mx-auto">
                <h1 sz="text-4xl font-bold text-white mb-4 text-center">
                    SSR Test Page
                </h1>
                <p sz="text-slate-400 text-center mb-8">
                    Testing Server-Side Rendering with csszyx class mangling
                </p>

                {/* Static Server Content */}
                <section sz="mb-8">
                    <h2 sz="text-xl font-semibold text-white mb-4">
                        Static Server Content
                    </h2>
                    <div sz="grid grid-cols-3 gap-4">
                        <div sz="p-4 rounded-lg bg-red-500/20 border border-red-500">
                            <span sz="text-red-400 text-sm">Red Card</span>
                        </div>
                        <div sz="p-4 rounded-lg bg-green-500/20 border border-green-500">
                            <span sz="text-green-400 text-sm">Green Card</span>
                        </div>
                        <div sz="p-4 rounded-lg bg-blue-500/20 border border-blue-500">
                            <span sz="text-blue-400 text-sm">Blue Card</span>
                        </div>
                    </div>
                </section>

                {/* Async Server Content with Suspense */}
                <section sz="mb-8">
                    <h2 sz="text-xl font-semibold text-white mb-4">
                        Async Server Content (Suspense)
                    </h2>
                    {/* <Suspense
                        fallback={
                            <div sz="p-8 rounded-lg bg-slate-800 animate-pulse">
                                <div sz="h-4 bg-slate-700 rounded w-3/4 mb-4" />
                                <div sz="h-4 bg-slate-700 rounded w-1/2" />
                            </div>
                        }
                    >
                        <AsyncDataLoader />
                    </Suspense> */}
                </section>

                {/* Complex Class Combinations */}
                <section sz="mb-8">
                    <h2 sz="text-xl font-semibold text-white mb-4">
                        Complex Tailwind Classes
                    </h2>
                    <div sz="space-y-4">
                        {/* Responsive classes */}
                        <div sz="p-4 rounded-lg bg-slate-800 sm:bg-slate-700 md:bg-slate-600 lg:bg-slate-500">
                            <span sz="text-white text-sm">
                                Responsive: bg changes at sm/md/lg breakpoints
                            </span>
                        </div>

                        {/* Hover/Focus states */}
                        <div sz="p-4 rounded-lg bg-slate-800 hover:bg-indigo-500 focus:ring-2 focus:ring-indigo-400 transition-all cursor-pointer">
                            <span sz="text-white text-sm">
                                Interactive: hover and focus states
                            </span>
                        </div>

                        {/* Arbitrary values */}
                        <div sz="p-4 rounded-lg bg-[#1a1a2e] border-[2px] border-[#4a4a6a]">
                            <span sz="text-[#e0e0ff] text-sm">
                                Arbitrary values: custom colors
                            </span>
                        </div>

                        {/* Dark mode */}
                        <div sz="p-4 rounded-lg bg-white dark:bg-slate-800 text-black dark:text-white">
                            <span sz="text-sm">Dark mode: toggle system preference</span>
                        </div>
                    </div>
                </section>

                {/* Nested Components */}
                <section sz="mb-8">
                    <h2 sz="text-xl font-semibold text-white mb-4">
                        Nested Component Classes
                    </h2>
                    <div sz="p-6 rounded-xl bg-linear-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/50">
                        <div sz="flex items-center gap-4 mb-4">
                            <div sz="w-12 h-12 rounded-full bg-purple-500 flex items-center justify-center">
                                <span sz="text-white font-bold">A</span>
                            </div>
                            <div>
                                <h3 sz="text-white font-semibold">Nested Component</h3>
                                <p sz="text-purple-300 text-sm">Multiple levels of nesting</p>
                            </div>
                        </div>
                        <div sz="pl-16">
                            <div sz="p-4 rounded-lg bg-pink-500/20 border border-pink-500/30">
                                <span sz="text-pink-300 text-sm">
                                    Deeply nested content with unique classes
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Back Link */}
                <div sz="text-center mt-8">
                    <Link
                        href="/"
                        sz={{
                            color: 'blue-500',
                            hover: { color: 'blue-700', underline: true },
                        }}
                    >
                        &larr; Back to Home
                    </Link>
                </div>
            </div>
        </main>
    );
}
