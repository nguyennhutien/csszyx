import { useState, useEffect, useRef, useCallback } from 'react';

interface SearchResult {
    url: string;
    meta: { title: string };
    excerpt: string;
}

// Pagefind is a build-time artifact served at /pagefind/pagefind.js.
// It is not available in dev mode — we handle that gracefully.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pagefindApi: any = null;

// Use new Function to prevent Vite's import-analysis from resolving this path at
// transform time. Pagefind is a build-time artifact that doesn't exist in dev mode.
const dynamicImport = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>;

async function loadPagefind() {
    if (pagefindApi) return pagefindApi;
    try {
        pagefindApi = await dynamicImport('/pagefind/pagefind.js');
        await pagefindApi.init();
    } catch {
        pagefindApi = null;
    }
    return pagefindApi;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export default function SearchModal({ isOpen, onClose }: Props) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (isOpen) {
            requestAnimationFrame(() => inputRef.current?.focus());
        } else {
            setQuery('');
            setResults([]);
            setLoading(false);
            setUnavailable(false);
        }
    }, [isOpen]);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    // Lock body scroll while open — prevents the page behind the backdrop from
    // scrolling on wheel/touch. Preserves the caller's original overflow value.
    useEffect(() => {
        if (!isOpen) return;
        const { body } = document;
        const prevOverflow = body.style.overflow;
        body.style.overflow = 'hidden';
        return () => { body.style.overflow = prevOverflow; };
    }, [isOpen]);

    const doSearch = useCallback(async (q: string) => {
        if (!q.trim()) {
            setResults([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        setUnavailable(false);
        const api = await loadPagefind();
        if (!api) {
            setUnavailable(true);
            setLoading(false);
            return;
        }
        try {
            const search = await api.search(q);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data: SearchResult[] = await Promise.all(search.results.slice(0, 5).map((r: any) => r.data()));
            setResults(data);
        } catch {
            setResults([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const q = e.target.value;
        setQuery(q);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => doSearch(q), 220);
    };

    if (!isOpen) return null;

    return (
        <div
            className="search-overlay"
            sz={{ fixed: true, inset: 0, z: 100, flex: true, items: 'start', justify: 'center', pt: 24, px: 4 }}
            onClick={onClose}
        >
            <div
                className="search-modal"
                sz={{ w: 'full', maxW: '2xl', rounded: '2xl', overflow: 'hidden', shadow: '2xl' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Input row */}
                <div className="search-input-row" sz={{ flex: true, items: 'center', px: 4, gap: 3 }}>
                    <span
                        className="material-symbols-outlined search-icon"
                        sz={{ shrink: 0 }}
                    >search</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={handleChange}
                        placeholder="Search docs..."
                        className="search-input"
                    />
                    <kbd className="search-esc-key" onClick={onClose}>Esc</kbd>
                </div>

                {/* Results list */}
                {results.length > 0 && (
                    <ul className="search-results-list" sz={{ py: 1 }}>
                        {results.map((result, i) => (
                            <li key={i}>
                                <a
                                    href={result.url}
                                    className="search-result"
                                    sz={{ block: true, px: 4, py: 3 }}
                                    onClick={onClose}
                                >
                                    <div className="search-result-title">{result.meta.title}</div>
                                    <div
                                        className="search-result-excerpt"
                                        dangerouslySetInnerHTML={{ __html: result.excerpt }}
                                    />
                                </a>
                            </li>
                        ))}
                    </ul>
                )}

                {/* Loading */}
                {loading && (
                    <p className="search-state">Searching…</p>
                )}

                {/* No results */}
                {!loading && query.trim() && results.length === 0 && !unavailable && (
                    <p className="search-state">No results for &ldquo;{query}&rdquo;</p>
                )}

                {/* Pagefind not available (dev mode) */}
                {unavailable && (
                    <p className="search-state">Search is only available in the production build.</p>
                )}
            </div>
        </div>
    );
}
