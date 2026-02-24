'use client';

export function AdvancedCases() {
    return (
        <section sz={{ p: 4, bg: 'slate-900', rounded: 'lg' }}>
            <h2 sz={{ text: '2xl', fontWeight: 'bold', mb: 4, color: 'white' }}>
                Advanced Cases
            </h2>
            <p sz={{ color: 'slate-400', mb: 4, text: 'sm' }}>
                Testing group/peer, data attributes, ARIA, RTL, container queries, and more.
            </p>

            <div sz={{ grid: true, gridCols: 2, md: { gridCols: 3 }, gap: 4 }}>
                {/* Case 21: Group hover — parent group, child reacts */}
                <div sz={{ group: true, p: 4, bg: 'gray-700', rounded: 'md' }}>
                    <span
                        data-case="21-group-hover"
                        sz={{ color: 'gray-400', group: { hover: { color: 'white' } }, transition: 'colors' }}
                    >
                        Group Hover
                    </span>
                </div>

                {/* Case 22: Named group — group/sidebar scope */}
                <div sz={{ group: 'sidebar', p: 4, bg: 'gray-700', rounded: 'md' }}>
                    <span
                        data-case="22-named-group"
                        sz={{ opacity: 50, 'group-hover/sidebar': { opacity: 100 }, transition: 'opacity' }}
                    >
                        Named Group
                    </span>
                </div>

                {/* Case 23: Peer — checkbox controls sibling */}
                <div sz={{ p: 4, bg: 'gray-700', rounded: 'md' }}>
                    <label sz={{ flex: true, items: 'center', gap: 2 }}>
                        <input type="checkbox" sz={{ peer: true }} />
                        <span
                            data-case="23-peer"
                            sz={{ color: 'gray-400', peer: { checked: { color: 'green-400' } }, transition: 'colors' }}
                        >
                            Peer Checked
                        </span>
                    </label>
                </div>

                {/* Case 24: Named peer */}
                <div sz={{ p: 4, bg: 'gray-700', rounded: 'md' }}>
                    <input
                        type="text"
                        placeholder="Focus me..."
                        sz={{ peer: 'search', bg: 'gray-600', color: 'white', px: 2, py: 1, rounded: 'md', text: 'sm', w: 'full' }}
                    />
                    <span
                        data-case="24-named-peer"
                        sz={{ invisible: true, 'peer-focus/search': { visible: true }, color: 'blue-400', text: 'xs', mt: 1, block: true }}
                    >
                        Named Peer Focus
                    </span>
                </div>

                {/* Case 25: Data attribute */}
                <div
                    data-case="25-data-attr"
                    data-active="true"
                    sz={{ p: 4, bg: 'gray-500', data: { active: { bg: 'green-500' } }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    data-[active]
                </div>

                {/* Case 26: !important modifier */}
                <div
                    data-case="26-important"
                    sz={{ p: 4, color: 'red-500!', bg: 'blue-500!', rounded: 'md', text: 'sm' }}
                >
                    !important
                </div>

                {/* Case 27: ARIA states */}
                <button
                    data-case="27-aria"
                    aria-expanded="true"
                    sz={{ p: 4, bg: 'gray-500', aria: { expanded: { bg: 'blue-500' } }, rounded: 'md', color: 'white', text: 'sm' }}
                >
                    ARIA Expanded
                </button>

                {/* Case 28: RTL support */}
                <div
                    data-case="28-rtl"
                    dir="rtl"
                    sz={{ p: 2, bg: 'indigo-500', color: 'white', rounded: 'md', text: 'sm', rtl: { mr: 4 }, ltr: { ml: 4 } }}
                >
                    RTL/LTR
                </div>

                {/* Case 29: Container query */}
                <div sz={{ '@container': true }}>
                    <div
                        data-case="29-container"
                        sz={{ p: 2, bg: 'gray-600', rounded: 'md', color: 'white', text: 'sm', '@md': { p: 4, bg: 'teal-500' }, '@lg': { p: 6, bg: 'emerald-500' } }}
                    >
                        Container Query
                    </div>
                </div>

                {/* Case 30: Has selector — contains img so :has(img) matches */}
                <div
                    data-case="30-has"
                    sz={{ p: 4, bg: 'gray-600', rounded: 'md', color: 'white', text: 'sm', has: { img: { p: 0 } } }}
                >
                    <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect fill='%2360a5fa' width='24' height='24' rx='4'/%3E%3C/svg%3E" alt="demo" sz={{ w: 6, h: 6, rounded: 'md' }} />
                    :has(img) — no padding
                </div>
            </div>
        </section>
    );
}
