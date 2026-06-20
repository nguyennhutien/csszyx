import { useRef, useEffect, useState } from 'react';

function BeamEdge({ delay1, delay2 }: { delay1: string; delay2: string }) {
  const gradient = 'linear-gradient(to right,transparent,rgba(152,109,254,0.9) 35%,rgba(152,109,254,0.9) 65%,transparent)';
  const shadow = '0 0 28px 2px rgba(139,92,246,0.5)';
  return (
    <div className="beam-wrapper" sz={{ group: { footerCtaBtn: { hover: { opacity: 0 } } },position: 'absolute', inset: 0, z: 20, pointerEvents: 'none', rounded: '3xl', overflow: 'hidden' }}>
      <div sz={{ position: 'absolute', top: 0, insetX: 0, h: '1px', roundedTl: '3xl', roundedTr: '3xl' }}>
        <div sz={{ position: 'absolute', top: 0, h: 'full', w: 24, animate: 'beam-sweep-h 5s ease-in-out infinite' }} style={{ background: gradient, boxShadow: shadow, animationDelay: delay1 }} />
      </div>
      <div sz={{ position: 'absolute', bottom: 0, insetX: 0, h: '1px', roundedBl: '3xl', roundedBr: '3xl' }}>
        <div sz={{ position: 'absolute', top: 0, h: 'full', w: 24, animate: 'beam-sweep-h 5s ease-in-out infinite' }} style={{ background: gradient, boxShadow: shadow, animationDelay: delay2 }} />
      </div>
    </div>
  );
}

export default function CTASection() {
  const [activePkg, setActivePkg] = useState<'npm' | 'pnpm'>('npm');
  const containerRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLAnchorElement>(null);
  const mousePos = useRef({ x: 0, y: 0 });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const cta = ctaRef.current;
    if (!container || !cta) return;

    const onMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mousePos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const createParticle = () => {
      const p = document.createElement('div');
      p.className = 'cta-particle';
      const angle = Math.random() * Math.PI * 2;
      const dist = 24;
      p.style.left = (mousePos.current.x + Math.cos(angle) * dist) + 'px';
      p.style.top  = (mousePos.current.y + Math.sin(angle) * dist) + 'px';
      p.style.setProperty('--dx', (Math.cos(angle) * 100) + 'px');
      p.style.setProperty('--dy', (Math.sin(angle) * 100) + 'px');
      container.appendChild(p);
      setTimeout(() => p.remove(), 2000);
    };

    const onEnter = () => { intervalRef.current = setInterval(createParticle, 80); };
    const onLeave = () => { if (intervalRef.current) clearInterval(intervalRef.current); };

    container.addEventListener('mousemove', onMove);
    cta.addEventListener('mouseenter', onEnter);
    cta.addEventListener('mouseleave', onLeave);
    return () => {
      container.removeEventListener('mousemove', onMove);
      cta.removeEventListener('mouseenter', onEnter);
      cta.removeEventListener('mouseleave', onLeave);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const pkgCommands = {
    npm:  { main: 'npm install csszyx', dyn: 'npm install @csszyx/dynamic' },
    pnpm: { main: 'pnpm add csszyx',    dyn: 'pnpm add @csszyx/dynamic' },
  };

  const cmds = pkgCommands[activePkg];

  return (
    <section
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
        px: 6,
      }}
    >
      <h2
        className="reveal-item"
        sz={{ text: '5xl', fontWeight: 'black', mb: 6, tracking: 'tighter', textAlign: 'center', color: 'neutral-900', dark: { color: 'white' }, delay: '0ms' }}
      >
        Ready to style from data?
      </h2>
      <p
        className="reveal-item"
        sz={{ color: 'slate-600', dark: { color: 'slate-400' }, text: 'lg', fontWeight: 'light', mb: 16, textAlign: 'center', delay: '150ms' }}
      >
        Start with zero-runtime compilation.<br />
        Add @csszyx/dynamic when you need it.<br />
        <span sz={{ fontWeight: 'medium', color: 'neutral-900', dark: { color: 'slate-300' } }}>No lock-in. Pure Tailwind output.</span>
      </p>

      {/* Install block */}
      <div
        sz={{
          bg: { color: 'white', op: 90 },
          dark: { bg: { color: '#1e1e2aff', op: 40 }, borderColor: { color: 'white', op: 5 } },
          backdropBlur: 'xl',
          border: true,
          borderColor: { color: 'black', op: 5 },
          rounded: '3xl',
          overflow: 'hidden',
          textAlign: 'left',
          mx: 'auto',
          maxW: '2xl',
          w: 'full',
          position: 'relative',
        }}
      >
        {/* Title bar */}
        <div
          sz={{
            position: 'absolute',
            insetX: 0,
            top: 0,
            h: 12,
            borderB: true,
            borderColor: { color: 'black', op: 5 },
            dark: { borderColor: { color: 'white', op: 5 }, bg: { color: '#1e1e2aff', op: 45 } },
            display: 'flex',
            justify: 'between',
            items: 'center',
            px: 6,
            bg: { color: 'slate-50', op: 50 },
          }}
        >
          <div sz={{ display: 'flex', gap: 2 }}>
            <div sz={{ w: 3, h: 3, rounded: 'full', bg: { color: 'rose-500', op: 80 } }} />
            <div sz={{ w: 3, h: 3, rounded: 'full', bg: { color: 'amber-500', op: 80 } }} />
            <div sz={{ w: 3, h: 3, rounded: 'full', bg: { color: 'emerald-500', op: 80 } }} />
          </div>

          {/* Package manager tabs */}
          <div sz={{ display: 'flex', fontFamily: 'mono', text: '10px', color: 'slate-500', tracking: 'wider', gap: 1 }}>
            {(['npm', 'pnpm'] as const).map(pkg => (
              <button
                key={pkg}
                className="pkg-tab"
                data-active={activePkg === pkg ? '' : undefined}
                sz={{ px: 3, py: 1, rounded: 'md', transition: 'colors', cursor: 'pointer' }}
                onClick={() => setActivePkg(pkg)}
              >
                {pkg}
              </button>
            ))}
          </div>
        </div>

        {/* Commands */}
        <div sz={{ p: 10, pt: 20, pb: 16, fontFamily: 'mono', text: '13px', leading: 'loose' }}>
          <div sz={{ display: 'flex', items: 'center', gap: 4, mb: 4 }}>
            <span sz={{ color: 'primary', opacity: 50 }}>$</span>
            <span sz={{ color: 'neutral-900', dark: { color: 'white' } }}>{cmds.main}</span>
            <span sz={{ color: 'slate-400', dark: { color: 'slate-600' }, ml: 'auto', display: 'none', sm: { display: 'inline' } }}># build-time only</span>
          </div>
          <div sz={{ display: 'flex', items: 'center', gap: 4 }}>
            <span sz={{ color: 'primary', opacity: 50 }}>$</span>
            <span sz={{ color: 'neutral-900', dark: { color: 'white' } }}>{cmds.dyn}</span>
            <span sz={{ color: 'slate-400', dark: { color: 'slate-600' }, ml: 'auto', display: 'none', sm: { display: 'inline' } }}># + runtime delta injection</span>
          </div>
        </div>
      </div>

      {/* CTA button with particles */}
      <div
        ref={containerRef}
        id="footer-cta-container"
        sz={{ display: 'flex', position: 'relative', justify: 'center', mt: 40 }}
      >
        <a
          ref={ctaRef}
          href="/docs/sz-props"
          sz={{
            group: 'footerCtaBtn',
            px: 10,
            py: 5,
            gap: 3,
            display: 'inline-flex',
            items: 'center',
            bg: 'white',
            dark: {
              bg: { color: 'secondary', op: 10 },
              dropShadow: '0 0 40px rgba(128, 74, 255, 1)',
              borderColor: 'secondary',
              color: 'white',
              hover: { bg: 'primary', color: 'neutral-900', borderColor: 'primary', dropShadow: 'none' },
            },
            hover: { bg: 'slate-50', color: 'primary-thin', tracking: 'widest', shadow: '0 0 50px var(--color-primary)' },
            backdropBlur: 'xl',
            border: true,
            borderColor: 'neutral-200',
            color: 'neutral-900',
            rounded: '2xl',
            fontFamily: 'display',
            transition: 'all',
            duration: 500,
            ease: 'ease-in-out',
            cursor: 'pointer',
          }}
        >
          <BeamEdge delay1="2.4s" delay2="4.9s" />
          Read the Documentation
          <span className="material-symbols-outlined" sz={{ text: 'base' }}>arrow_forward</span>
        </a>
      </div>
    </section>
  );
}
