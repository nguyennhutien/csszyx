const benchmarks = [
  { value: '<1', unit: 'µs', label: 'Manifest lookup', delay: '100ms' },
  { value: '<2', unit: 'ms', label: 'First inject, 50 classes', delay: '200ms' },
  { value: '<8', unit: 'KB', label: '@csszyx/dynamic', delay: '300ms' },
  { value: '100', unit: '%', label: 'Deterministic logic', delay: '400ms' },
];

export default function BenchmarksSection() {
  return (
    <section
      id="benchmarks"
      sz={{
        relative: true,
        py: 40,
        minH: '90vh',
        flex: true,
        flexDir: 'col',
        justify: 'center',
        bg: 'slate-50',
        dark: { bg: { color: '--color-background-light', op:35 } },
        overflow: 'hidden',
      }}
    >
      <div sz={{ maxW: '1536px', mx: 'auto', px: 6, lg: { px: 20 }, relative: true, z: 10, w: 'full' }}>

        <div sz={{ textAlign: 'center', mb: 24 }}>
          <h2
            className="reveal-item"
            sz={{ text: '5xl', fontWeight: 'black', mb: 6, color: 'neutral-900', dark: { color: 'white' }, leading: 'tight', tracking: 'tighter', delay: '0ms' }}
          >
            Performance so fast,<br />it feels{' '}
            <span sz={{ color: 'transparent', bgClip: 'text', bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'primary', to: 'primary-thin' }}>instant.</span>
          </h2>
          <p
            className="reveal-item"
            sz={{ color: 'slate-500', dark: { color: 'slate-400' }, fontFamily: 'mono', text: 'xs', tracking: 'widest', uppercase: true, mt: 6, delay: '150ms' }}
          >
            Benchmarks run on Node.js 22 &amp; Chromium 124.
          </p>
        </div>

        <div sz={{ grid: true, gridCols: 1, sm: { gridCols: 2 }, lg: { gridCols: 4 }, gap: 6 }}>
          {benchmarks.map(({ value, unit, label, delay }) => (
            <div
              key={label}
              className="group reveal-item"
              sz={{
                p: 12,
                bg: 'white',
                dark: {
                  bg: { color: '#1e1e2a', op: 50 },
                  borderColor: { color: 'white', op: 5 },
                  hover: {
                    borderColor: { color: '#b491ff', op: 15 },
                    dropShadow: '0 0 40px rgba(128, 74, 255, 0.4)'
                  },
                },
                backdropBlur: 'xl',
                border: true,
                borderColor: { color: 'black', op: 5 },
                rounded: '3xl',
                textAlign: 'center',
                hover: { borderColor: { color: 'black', op: 10 } },
                transition: 'all',
                delay,
              }}
            >
              <div
                className="reveal-item__benchmark"
                sz={{
                  text: '6xl',
                  fontWeight: 'light',
                  fontFamily: 'display',
                  color: 'neutral-900',
                  dark: { color: 'white' },
                  mb: 4,
                  group: { hover: { color: 'primary-thin' } },
                  transition: 'colors',
                }}
              >
                {value}<span sz={{ text: '3xl' }}>{unit}</span>
              </div>
              <div sz={{
                text: '13px', color: 'slate-500', dark: { color: 'slate-400' }, fontWeight: 'light', tracking: 'wide',
                group: { hover: { color: { color: 'white', op: 95 }, } },
                transition: 'colors',
              }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
