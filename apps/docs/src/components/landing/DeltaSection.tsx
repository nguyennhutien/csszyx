function BeamEdge({ color, delay1, delay2 }: { color: string; delay1: string; delay2: string }) {
  const gradient = `linear-gradient(to right,transparent,${color} 35%,${color} 65%,transparent)`;
  const shadow = color.startsWith('rgba(34') ? '0 0 28px 2px rgba(34,211,238,0.5)' : color.startsWith('rgba(45') ? '0 0 28px 2px rgba(45,213,151,0.5)' : '0 0 28px 2px rgba(139,92,246,0.5)';

  return (
    <div className="beam-wrapper" sz={{ position: 'absolute', inset: 0, z: 20, pointerEvents: 'none', rounded: '3xl', overflow: 'hidden' }}>
      <div sz={{ position: 'absolute', top: 0, insetX: 0, h: '1px', roundedTl: '3xl', roundedTr: '3xl' }}>
        <div sz={{ position: 'absolute', top: 0, h: 'full', w: 24, animate: 'beam-sweep-h 5s ease-in-out infinite' }} style={{ background: gradient, boxShadow: shadow, animationDelay: delay1 }} />
      </div>
      <div sz={{ position: 'absolute', bottom: 0, insetX: 0, h: '1px', roundedBl: '3xl', roundedBr: '3xl' }}>
        <div sz={{ position: 'absolute', top: 0, h: 'full', w: 24, animate: 'beam-sweep-h 5s ease-in-out infinite' }} style={{ background: gradient, boxShadow: shadow, animationDelay: delay2 }} />
      </div>
    </div>
  );
}


export default function DeltaSection() {
  return (
    <section
      id="how-it-works"
      sz={{
        maxW: '1536px',
        mx: 'auto',
        mb: 32,
        pt: 32,
        pb: 32,
        minH: '90vh',
        display: 'flex',
        flexDir: 'col',
        justify: 'center',
      }}
    >
      {/* Heading */}
      <div sz={{ mb: 24, display: 'flex', flexDir: 'col', items: 'center', textAlign: 'center' }}>
        <h2
          className="reveal-item"
          sz={{ text: '5xl', fontWeight: 'black', mb: 6, leading: 'tight', tracking: 'tighter', delay: '0ms' }}
        >
          The elegant architecture<br />of{' '}
          <span sz={{ color: 'transparent', bgClip: 'text', bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'primary', to: 'primary-thin' }}>
            Delta injection.
          </span>
        </h2>
      </div>

      {/* 3-card grid */}
      <div sz={{ display: 'grid', gridCols: 1, md: { gridCols: 3 }, gap: 8, position: 'relative', mt: 12, w: 'full', z: 10 }}>

        {/* Card 1 — Build Time */}
        <div
          className="reveal-item"
          sz={{
            position: 'relative',
            z: 10,
            bg: { color: 'white', op: 90 },
            dark: { bg: { color: '#1e1e2a', op: 50 }, borderColor: { color: 'white', op: 5 } },
            backdropBlur: 'xl',
            border: true,
            borderColor: { color: 'black', op: 5 },
            rounded: '3xl',
            p: 10,
            hover: { translateY: -1, dropShadow: '0 0 40px rgba(0, 163, 175, 0.3)' },
            transition: 'transform',
            duration: 500,
            delay: '100ms',
            dropShadow: '0 0 100px rgba(34,211,238,0.085)',
          }}
        >
          <BeamEdge color="rgba(34,211,238,1)" delay1="0s" delay2="2.5s" />

          <div sz={{ text: '10px', fontFamily: 'mono', color: 'cyan-500', mb: 8, tracking: 'widest', textTransform: 'uppercase', display: 'flex', items: 'center', gap: 2 }}>
            01 / Build
          </div>
          <h3 sz={{ text: '2xl', fontWeight: 'bold', fontFamily: 'display', color: 'neutral-900', dark: { color: 'white' }, mb: 4 }}>Compilation</h3>
          <p sz={{ color: 'slate-600', dark: { color: 'slate-400' }, leading: 'relaxed', fontWeight: 'light', mb: 8 }}>
            sz props compile to Tailwind classes before JIT runs. Zero overhead at runtime — just standard CSS selectors.
          </p>
          <div sz={{ bg: 'slate-50', dark: { bg: '--color-background-light', borderColor: { color: 'white', op: 5 } }, border: true, rounded: 'xl', p: 5, fontFamily: 'mono', text: '13px', overflowX: 'auto', position: 'relative', z: 30 }}>
            {'<'}<span sz={{ color: 'emerald-500', dark: { color: 'emerald-400' } }}>Field</span>{' '}
            <span sz={{ color: 'sky-500', dark: { color: 'sky-200' } }}>sz</span>
            {'={'}<span sz={{ color: 'sky-600', dark: { color: 'sky-300' } }}>{'{'}</span>
            {'{ '}<span sz={{ color: 'sky-500', dark: { color: 'sky-200' } }}>p</span>
            {': '}<span sz={{ color: 'orange-500', dark: { color: 'orange-300' } }}>4</span>
            {', '}<span sz={{ color: 'sky-500', dark: { color: 'sky-200' } }}>bg</span>
            {': '}<span sz={{ color: 'amber-500', dark: { color: 'amber-300' } }}>"white"</span>
            {' }'}<span sz={{ color: 'sky-600', dark: { color: 'sky-300' } }}>{'}'}</span>{' />'}<br />
            <span sz={{ color: 'slate-400', dark: { color: 'slate-500' }, mt: 2, display: 'block' }}>{'/* Outputs: .p-4, .bg-white */'}</span>
          </div>
        </div>

        {/* Card 2 — Manifest */}
        <div
          className="reveal-item"
          sz={{
            position: 'relative',
            z: 10,
            bg: { color: 'white', op: 90 },
            dark: { bg: { color: '#1e1e2a', op: 50 }, borderColor: { color: 'white', op: 5 } },
            backdropBlur: 'xl',
            border: true,
            borderColor: { color: 'black', op: 5 },
            rounded: '3xl',
            p: 10,
            hover: { translateY: -1, dropShadow: '0 0 40px rgba(0, 150, 70, 0.3)' },
            transition: 'transform',
            duration: 500,
            delay: '300ms',
            dropShadow: '0 0 100px rgba(45,213,151,0.085)',
          }}
        >
          <BeamEdge color="rgba(45,213,151,1)" delay1="1.2s" delay2="3.7s" />

          <div sz={{ text: '10px', fontFamily: 'mono', color: 'primary', mb: 8, tracking: 'widest', textTransform: 'uppercase', display: 'flex', items: 'center', gap: 2 }}>
            02 / Index
          </div>
          <h3 sz={{ text: '2xl', fontWeight: 'bold', fontFamily: 'display', color: 'neutral-900', dark: { color: 'white' }, mb: 4 }}>Manifest</h3>
          <p sz={{ color: 'slate-600', dark: { color: 'slate-400' }, leading: 'relaxed', fontWeight: 'light', mb: 8 }}>
            Every class in your built CSS is recorded into a map. Giving you O(1) instantaneous lookup.
          </p>
          <div sz={{ bg: 'slate-50', dark: { bg: '--color-background-light', borderColor: { color: 'white', op: 5 }, color: 'white' }, border: true, rounded: 'xl', p: 5, fontFamily: 'mono', text: '13px', color: 'neutral-900', overflowX: 'auto', position: 'relative', z: 30 }}>
            <span sz={{ color: 'slate-400', dark: { color: 'slate-500' } }}>{'// csszyx-manifest.json'}</span><br />
            {'{'}<br />
            &nbsp;&nbsp;<span sz={{ color: 'sky-500', dark: { color: 'sky-200' } }}>"classes"</span>
            {': ['}
            <span sz={{ color: 'amber-500', dark: { color: 'amber-300' } }}>"p-4"</span>
            {', '}
            <span sz={{ color: 'amber-500', dark: { color: 'amber-300' } }}>"bg-white"</span>
            {']'}<br />
            {'}'}
          </div>
        </div>

        {/* Card 3 — Runtime Delta */}
        <div
          className="reveal-item"
          sz={{
            position: 'relative',
            z: 10,
            bg: 'white',
            dark: { bg: { color: '#1e1e2a', op: 50 }, borderColor: { color: 'secondary', op: 20 } },
            border: true,
            borderColor: { color: 'primary', op: 10 },
            rounded: '3xl',
            p: 10,
            hover: { translateY: -1, dropShadow: '0 0 40px rgba(128, 74, 255, 0.3)' },
            transition: 'all',
            duration: 500,
            delay: '500ms',
            dropShadow: '0 0 100px rgba(152,109,254,0.085)',
          }}
        >
          <BeamEdge color="rgba(152,109,254,0.9)" delay1="2.4s" delay2="4.9s" />

          <div sz={{ text: '10px', fontFamily: 'mono', mb: 8, tracking: 'widest', textTransform: 'uppercase', display: 'flex', items: 'center', gap: 2 }} style={{ color: '#b491ff' }}>
            03 / Runtime
          </div>
          <h3 sz={{ text: '2xl', fontWeight: 'bold', fontFamily: 'display', color: 'neutral-900', dark: { color: 'white' }, mb: 4 }}>Delta Injection</h3>
          <p sz={{ color: 'slate-600', dark: { color: 'slate-400' }, leading: 'relaxed', fontWeight: 'light', mb: 8 }}>
            Unknown styles are detected and injected automatically on demand. Never duplicated.
          </p>
          <div sz={{ bg: 'slate-50', dark: { bg: '--color-background-light', borderColor: { color: 'white', op: 5 } }, border: true, rounded: 'xl', p: 5, fontFamily: 'mono', text: '13px', overflowX: 'auto', position: 'relative', z: 30 }}>
            <span sz={{ color: 'pink-600', dark: { color: 'pink-400' } }}>const</span>
            {' { sz } = '}
            <span sz={{ color: 'sky-500', dark: { color: 'sky-300' } }}>useSz</span>
            {'();'}<br /><br />
            <span sz={{ color: 'slate-400', dark: { color: 'slate-600' } }}>{'// Dynamic API styles'}</span><br />
            <span sz={{ color: 'pink-600', dark: { color: 'pink-400' } }}>const</span>
            {' cls = sz({ bg: api.color });'}
          </div>
        </div>
      </div>
    </section>
  );
}
