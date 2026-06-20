'use client';

import { useEffect, useMemo, useState } from 'react';

type SortKey = 'original' | 'mangled' | 'savings';
type SortDir = 'asc' | 'desc';

interface MangleEntry {
    original: string;
    mangled: string;
    savings: number;
}

declare global {
    interface Window {
        __csszyx?: {
            mangleMap: Record<string, string>;
            checksum: string;
            decode(mangled: string): string | undefined;
            encode(original: string): string | undefined;
            decodeAll(element: HTMLElement): string[];
        };
    }
}

export function MangleMapViewer() {
    const [mangleMap, setMangleMap] = useState<Record<string, string> | null>(null);
    const [checksum, setChecksum] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('savings');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    useEffect(() => {
        const helper = window.__csszyx;
        if (helper) {
            setMangleMap(helper.mangleMap);
            setChecksum(helper.checksum);
        }
    }, []);

    const entries = useMemo<MangleEntry[]>(() => {
        if (!mangleMap) return [];
        return Object.entries(mangleMap).map(([original, mangled]) => ({
            original,
            mangled,
            savings: original.length - mangled.length,
        }));
    }, [mangleMap]);

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        const list = q
            ? entries.filter(e => e.original.toLowerCase().includes(q) || e.mangled.toLowerCase().includes(q))
            : entries;

        return list.sort((a, b) => {
            const mul = sortDir === 'asc' ? 1 : -1;
            if (sortKey === 'savings') return (a.savings - b.savings) * mul;
            return a[sortKey].localeCompare(b[sortKey]) * mul;
        });
    }, [entries, search, sortKey, sortDir]);

    const totalSaved = useMemo(() => entries.reduce((sum, e) => sum + Math.max(0, e.savings), 0), [entries]);

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const sortIndicator = (key: SortKey) => {
        if (sortKey !== key) return '';
        return sortDir === 'asc' ? ' ↑' : ' ↓';
    };

    if (!mangleMap) {
        return (
            <div sz={{ p: 8, textAlign: 'center' }}>
                <h1 sz={{ text: '3xl', fontWeight: 'bold', color: 'white', mb: 4 }}>Mangle Map Viewer</h1>
                <p sz={{ color: 'slate-400', text: 'lg' }}>
                    No mangle map found. Make sure the app is running in development mode
                    with mangling enabled.
                </p>
                <p sz={{ color: 'slate-500', text: 'sm', mt: 2 }}>
                    Expected: <code sz={{ color: 'amber-400' }}>window.__csszyx</code>
                </p>
            </div>
        );
    }

    return (
        <div>
            <h1 sz={{ text: '3xl', fontWeight: 'bold', color: 'white', mb: 2 }}>Mangle Map Viewer</h1>

            {/* Stats */}
            <div sz={{ display: 'flex', gap: 4, mb: 6, flexWrap: 'wrap' }}>
                <div sz={{ bg: 'slate-800', rounded: 'lg', p: 4, display: 'flex', flexDir: 'col' }}>
                    <span sz={{ color: 'slate-400', text: 'xs', fontWeight: 'medium' }}>Total Classes</span>
                    <span sz={{ color: 'white', text: '2xl', fontWeight: 'bold' }}>{entries.length}</span>
                </div>
                <div sz={{ bg: 'slate-800', rounded: 'lg', p: 4, display: 'flex', flexDir: 'col' }}>
                    <span sz={{ color: 'slate-400', text: 'xs', fontWeight: 'medium' }}>Total Bytes Saved</span>
                    <span sz={{ color: 'green-400', text: '2xl', fontWeight: 'bold' }}>{totalSaved} bytes</span>
                </div>
                {checksum && (
                    <div sz={{ bg: 'slate-800', rounded: 'lg', p: 4, display: 'flex', flexDir: 'col' }}>
                        <span sz={{ color: 'slate-400', text: 'xs', fontWeight: 'medium' }}>Checksum (SHA-256)</span>
                        <code sz={{ color: 'amber-400', text: 'sm', fontFamily: 'mono' }}>{checksum}</code>
                    </div>
                )}
            </div>

            {/* Search */}
            <div sz={{ mb: 4 }}>
                <input
                    type="text"
                    placeholder="Search classes..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    sz={{ w: 'full', bg: 'slate-800', color: 'white', px: 4, py: 2, rounded: 'lg', borderColor: 'slate-700', text: 'sm' }}
                />
            </div>

            {/* Table */}
            <div sz={{ overflow: 'auto', rounded: 'lg', borderColor: 'slate-700' }}>
                <table sz={{ w: 'full', text: 'sm' }}>
                    <thead>
                        <tr sz={{ bg: 'slate-800' }}>
                            <th
                                onClick={() => toggleSort('original')}
                                sz={{ textAlign: 'left', px: 4, py: 3, color: 'slate-300', fontWeight: 'medium', cursor: 'pointer' }}
                            >
                                Original Class{sortIndicator('original')}
                            </th>
                            <th
                                onClick={() => toggleSort('mangled')}
                                sz={{ textAlign: 'left', px: 4, py: 3, color: 'slate-300', fontWeight: 'medium', cursor: 'pointer' }}
                            >
                                Mangled{sortIndicator('mangled')}
                            </th>
                            <th
                                onClick={() => toggleSort('savings')}
                                sz={{ textAlign: 'right', px: 4, py: 3, color: 'slate-300', fontWeight: 'medium', cursor: 'pointer' }}
                            >
                                Length Saved{sortIndicator('savings')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(entry => (
                            <tr key={entry.original} sz={{ borderT: true, borderColor: 'slate-700', hover: { bg: { color: 'slate-800', op: 50 } } }}>
                                <td sz={{ px: 4, py: 2 }}>
                                    <code sz={{ color: 'sky-400' }}>{entry.original}</code>
                                </td>
                                <td sz={{ px: 4, py: 2 }}>
                                    <code sz={{ color: 'emerald-400', fontWeight: 'bold' }}>{entry.mangled}</code>
                                </td>
                                <td sz={{ px: 4, py: 2, textAlign: 'right' }}>
                                    <span sz={{ color: entry.savings > 0 ? 'green-400' : 'slate-500' }}>
                                        {entry.savings > 0 ? `${entry.savings} bytes` : '—'}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p sz={{ color: 'slate-500', text: 'xs', mt: 4, textAlign: 'center' }}>
                Showing {filtered.length} of {entries.length} classes
            </p>
        </div>
    );
}
