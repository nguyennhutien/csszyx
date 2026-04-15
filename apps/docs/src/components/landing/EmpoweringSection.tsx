export default function EmpoweringSection() {
  return (
    <section
      id="visionaries"
      sz={{
        maxW: '1536px',
        mx: 'auto',
        relative: true,
        pt: 20,
        pb: 32,
        minH: '90vh',
        flex: true,
        flexDir: 'col',
        justify: 'center',
      }}
    >
      {/* Section Header */}
      <div sz={{ mb: 20, flex: true, flexDir: 'col', md: { flexDir: 'row' }, items: 'end', justify: 'between', gap: 8 }}>
        <div sz={{ flex: '1' }}>
          <h2
            className="reveal-item"
            sz={{ text: '5xl', fontWeight: 'black', mb: 6, leading: 'tight', tracking: 'tighter', delay: '0ms' }}
          >
            Built for <br />
            <span sz={{ color: 'transparent', bgClip: 'text', bgImg: { gradient: 'linear', dir: 'to-r' }, from: 'primary', to: 'primary-thin' }}>
              Visionaries
            </span>
          </h2>
          <p
            className="reveal-item"
            sz={{ color: 'slate-600', dark: { color: 'slate-400' }, maxW: 'xl', text: 'lg', fontWeight: 'light', leading: 'relaxed', delay: '150ms' }}
          >
            Built from the ground up to support the demanding, hyper-dynamic workflows of Form Renderers, CMS platforms, and Enterprise Design Systems.
          </p>
        </div>
      </div>

      {/* Bento Grid */}
      <div sz={{ grid: true, gridCols: 1, md: { gridCols: 6 }, gap: 8 }}>

        {/* For Form Renderers */}
        <div
          className="glow-card reveal-item group"
          sz={{
            flex: true,
            md: { colSpan: 6, p: 14 },
            lg: { colSpan: 3 },
            relative: true,
            overflow: 'hidden',
            p: 10,
            border: true,
            borderColor: { color: 'black', op: 5 },
            dark: { borderColor: { color: 'white', op: 5 }, bg: '#0d0d12' },
            bg: 'white',
            rounded: '3xl',
            hover: { borderColor: { color: 'black', op: 10 } },
          }}
        >
          <div sz={{ relative: true, z: 20 }}>
            <h3 sz={{ text: '3xl', fontWeight: 'black', tracking: 'tighter', color: 'neutral-900', dark: { color: 'white' }, mb: 4 }}>
              For Form Renderers
            </h3>
            <p sz={{ color: 'neutral-700', dark: { color: 'slate-400' }, text: 'lg', fontWeight: 'light', leading: 'relaxed', maxW: 'lg' }}>
              Bring Tailwind into your data-driven components. Style dynamic form fields directly from JSON schemas without bloating user stylesheets with duplicate rules.{' '}
              <span sz={{ fontWeight: 'medium', color: 'neutral-900', dark: { color: 'slate-300' } }}>Zero duplicated CSS.</span>
            </p>
          </div>
        </div>

        {/* The End of Safelisting */}
        <div
          className="glow-card reveal-item group"
          sz={{
            flex: true,
            md: { colSpan: 6, p: 14 },
            lg: { colSpan: 3 },
            relative: true,
            overflow: 'hidden',
            p: 10,
            border: true,
            borderColor: { color: 'black', op: 5 },
            dark: { borderColor: { color: 'white', op: 5 }, bg: '#0d0d12' },
            bg: 'white',
            rounded: '3xl',
            hover: { borderColor: { color: 'black', op: 10 } },
          }}
        >
          <div sz={{ relative: true, z: 20 }}>
            <h3 sz={{ text: '3xl', fontWeight: 'black', tracking: 'tighter', color: 'neutral-900', dark: { color: 'white' }, mb: 4 }}>
              The End of Safelisting
            </h3>
            <p sz={{ color: 'neutral-700', dark: { color: 'slate-400' }, fontWeight: 'light', leading: 'relaxed', mb: 10, text: 'lg' }}>
              Stop fighting Tailwind's compiler just to toggle a dynamic <code>width</code> or <code>padding</code> on scroll. Inject precise CSS states dynamically via true JS variables—without ever having to pre-define static string concatenations or bloated safelists in your config.
            </p>
          </div>
        </div>

        {/* True Dynamic Styling */}
        <div
          className="glow-card reveal-item group"
          sz={{
            md: { colSpan: 6, p: 12 },
            lg: { colSpan: 6, flexDir: 'row' },
            relative: true,
            overflow: 'hidden',
            p: 8,
            border: true,
            borderColor: { color: 'black', op: 5 },
            dark: { borderColor: { color: 'white', op: 5 }, bg: '#0d0d12' },
            bg: 'white',
            rounded: '3xl',
            hover: { borderColor: { color: 'black', op: 8 } },
            flex: true,
            flexDir: 'col',
            gap: 12,
            items: 'center',
          }}
        >
          {/* Text */}
          <div sz={{ relative: true, z: 20, flex: '1', spaceY: 6 }}>
            <h3 sz={{ text: '3xl', fontWeight: 'black', color: 'neutral-900', dark: { color: 'white' }, tracking: 'tighter' }}>True Dynamic Styling</h3>
            <p sz={{ color: 'neutral-700', dark: { color: 'slate-400' }, text: 'lg', leading: 'relaxed', maxW: 'xl', fontWeight: 'light' }}>
              The biggest pain point in Tailwind is the inability to dynamically compute classes at runtime. Stop concatenating messy strings or compiling bloated safelists just to handle a scroll header or a user-selected theme. With CSSzyx, you inject the exact CSS state you need via JS variables, entirely on demand.
            </p>
          </div>

          {/* Code Preview */}
          <div
            sz={{
              relative: true,
              z: 20,
              flex: '1',
              w: 'full',
              maxW: 'xl',
              bg: 'slate-50',
              dark: { bg: { color: '#0a0a0f', op: 50 }, borderColor: '#25252f', color: 'slate-300' },
              border: true,
              borderColor: { color: 'black', op: 5 },
              rounded: 'xl',
              p: 6,
              fontFamily: 'mono',
              text: '13px',
              leading: 'loose',
              color: 'neutral-900',
              transition: 'transform',
              duration: 500,
              overflow: 'hidden',
            }}
            style={{ WebkitBackdropFilter: 'blur(16px)', backdropFilter: 'blur(16px)' }}
          >
            {/* Mac title bar */}
            <div sz={{ absolute: true, top: 0, insetX: 0, h: 10, bg: 'slate-100', dark: { bg: '#14141a', borderColor: '#25252f' }, borderB: true, borderColor: { color: 'black', op: 5 }, flex: true, items: 'center', px: 4, gap: 2 }}>
              <div sz={{ w: 3, h: 3, rounded: 'full', bg: { color: 'rose-500', op: 80 } }} />
              <div sz={{ w: 3, h: 3, rounded: 'full', bg: { color: 'amber-500', op: 80 } }} />
              <div sz={{ w: 3, h: 3, rounded: 'full', bg: { color: 'emerald-500', op: 80 } }} />
              <div sz={{ ml: 4, text: '10px', color: 'slate-500', fontFamily: 'mono', tracking: 'widest' }}>Header.tsx</div>
            </div>

            {/* Code content */}
            <div sz={{ pt: 8, opacity: 90 }}>
              <div>
                <span sz={{ color: 'pink-600', dark: { color: 'pink-400' } }}>import</span>{' '}
                {'{ '}<span sz={{ color: 'sky-500', dark: { color: 'sky-300' } }}>useSz</span>{' }'}
                {' '}<span sz={{ color: 'pink-600', dark: { color: 'pink-400' } }}>from</span>{' '}
                <span sz={{ color: 'amber-500', dark: { color: 'amber-300' } }}>'@csszyx/dynamic/react'</span>;
              </div>
              <br />
              <div>
                <span sz={{ color: 'pink-600', dark: { color: 'pink-400' } }}>export function</span>{' '}
                <span sz={{ color: 'primary-thin', dark: { color: 'primary-thin' } }}>Header</span>
                {'({ '}
                <span sz={{ color: 'orange-500', dark: { color: 'orange-300' } }}>isScrolled</span>
                {', '}
                <span sz={{ color: 'orange-500', dark: { color: 'orange-300' } }}>themeColor</span>
                {' }) {'}
              </div>
              <div sz={{ pl: 6 }}>
                <span sz={{ color: 'pink-600', dark: { color: 'pink-400' } }}>const</span>{' '}
                {'{ '}<span sz={{ color: 'sky-500', dark: { color: 'sky-300' } }}>sz</span>{' }'}{' = '}
                <span sz={{ color: 'sky-500', dark: { color: 'sky-300' } }}>useSz</span>();
              </div>
              <br />
              <div sz={{ pl: 6 }}>
                <span sz={{ color: 'slate-400', dark: { color: 'slate-500' } }}>{'// 💥 ZERO predefined classes. ZERO safelists.'}</span>
              </div>
              <div sz={{ pl: 6 }}>
                <span sz={{ color: 'pink-600', dark: { color: 'pink-400' } }}>const</span>{' classes = '}
                <span sz={{ color: 'sky-500', dark: { color: 'sky-300' } }}>sz</span>
                {'({'}
              </div>
              <div sz={{ pl: 12, color: 'sky-600', dark: { color: 'sky-200' } }}>
                bg: <span sz={{ color: 'neutral-900', dark: { color: 'white' } }}>themeColor</span>,
                {' '}<span sz={{ color: 'slate-400', dark: { color: 'slate-500' } }}>{'// CMS / API Hex'}</span>
              </div>
              <div sz={{ pl: 12, color: 'sky-600', dark: { color: 'sky-200' } }}>
                py: <span sz={{ color: 'neutral-900', dark: { color: 'white' } }}>isScrolled ? </span>
                <span sz={{ color: 'orange-500', dark: { color: 'orange-300' } }}>4</span>
                <span sz={{ color: 'neutral-900', dark: { color: 'white' } }}> : </span>
                <span sz={{ color: 'orange-500', dark: { color: 'orange-300' } }}>12</span>,
              </div>
              <div sz={{ pl: 12, color: 'sky-600', dark: { color: 'sky-200' } }}>
                shadow: <span sz={{ color: 'neutral-900', dark: { color: 'white' } }}>isScrolled ? </span>
                <span sz={{ color: 'amber-500', dark: { color: 'amber-300' } }}>'md'</span>
                <span sz={{ color: 'neutral-900', dark: { color: 'white' } }}> : </span>
                <span sz={{ color: 'amber-500', dark: { color: 'amber-300' } }}>'none'</span>
              </div>
              <div sz={{ pl: 6 }}>{'});'}</div>
              <br />
              <div sz={{ pl: 6 }}>
                <span sz={{ color: 'pink-600', dark: { color: 'pink-400' } }}>return</span> (
              </div>
              <div sz={{ pl: 12 }}>
                {'<'}
                <span sz={{ color: 'emerald-500', dark: { color: 'emerald-400' } }}>nav</span>{' '}
                <span sz={{ color: 'sky-600', dark: { color: 'sky-200' } }}>className</span>
                {'='}
                <span sz={{ color: 'sky-500', dark: { color: 'sky-300' } }}>{'{'}</span>
                <span sz={{ color: 'neutral-900', dark: { color: 'white' } }}>classes</span>
                <span sz={{ color: 'sky-500', dark: { color: 'sky-300' } }}>{'}'}</span>
                {'>'}
              </div>
              <div sz={{ pl: 16 }}>
                {'<'}
                <span sz={{ color: 'emerald-500', dark: { color: 'emerald-400' } }}>Logo</span>{' '}
                <span sz={{ color: 'sky-600', dark: { color: 'sky-200' } }}>sz</span>
                {'='}
                <span sz={{ color: 'sky-500', dark: { color: 'sky-300' } }}>{'{'}</span>
                {'{ color: '}
                <span sz={{ color: 'amber-500', dark: { color: 'amber-300' } }}>'white'</span>
                {' }'}
                <span sz={{ color: 'sky-500', dark: { color: 'sky-300' } }}>{'}'}</span>
                {' />'}
              </div>
              <div sz={{ pl: 12 }}>
                {'</'}
                <span sz={{ color: 'emerald-500', dark: { color: 'emerald-400' } }}>nav</span>
                {'>'}
              </div>
              <div sz={{ pl: 6 }}>);</div>
              <div>{'}'}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
