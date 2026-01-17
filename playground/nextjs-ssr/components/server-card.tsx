/**
 * Server Component - Rendered entirely on the server
 * No "use client" directive = Server Component by default in App Router
 */

interface ServerCardProps {
    title: string;
    description: string;
}

export function ServerCard({ title, description }: ServerCardProps) {
    // This runs only on the server
    const serverTime = new Date().toISOString();

    return (
        <div data-testid="server-card" sz="p-6 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors">
            <h3 sz="text-lg font-semibold text-white mb-2">{title}</h3>
            <p sz="text-slate-400 text-sm mb-4">{description}</p>
            <div sz="text-xs text-slate-500">
                <span sz="font-mono">Server rendered at: {serverTime}</span>
            </div>
            {/* Test complex Tailwind classes */}
            <div sz="mt-4 flex items-center gap-2">
                <span sz="px-2 py-1 text-xs rounded-full bg-blue-500/20 text-blue-400">
                    RSC
                </span>
                <span sz="px-2 py-1 text-xs rounded-full bg-purple-500/20 text-purple-400">
                    No JS
                </span>
            </div>
        </div>
    );
}
