/**
 * Async Server Component - Simulates data fetching
 * Tests SSR with async data and class mangling
 */

async function fetchData(): Promise<{ title: string; items: string[] }> {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
        title: 'Async Loaded Data',
        items: ['Item 1', 'Item 2', 'Item 3', 'Item 4'],
    };
}

export async function AsyncDataLoader() {
    const data = await fetchData();

    return (
        <div sz="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
            <h3 sz="text-lg font-semibold text-white mb-4">{data.title}</h3>
            <p sz="text-slate-400 text-sm mb-4">
                This data was fetched on the server asynchronously.
            </p>
            <ul sz="space-y-2">
                {data.items.map((item, index) => (
                    <li
                        key={index}
                        sz="flex items-center gap-3 p-3 rounded-lg bg-slate-900/50"
                    >
                        <span sz="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-xs text-white">
                            {index + 1}
                        </span>
                        <span sz="text-slate-300">{item}</span>
                    </li>
                ))}
            </ul>
            <div sz="mt-4 text-xs text-slate-500">
                Fetched at: {new Date().toISOString()}
            </div>
        </div>
    );
}
