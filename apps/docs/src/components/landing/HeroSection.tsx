import { useEffect, useRef } from 'react';

// ── Compiler animation data ────────────────────────────────────────
const compileData: [string, string][] = [
    // Common
    ["{flex: true}", "flex"],
    ["{shrink: 0}", "shrink-0"],
    ["{grayscale: true}", "grayscale"],
    ["{firstLine: {uppercase: true}}", "first-line:uppercase"],
    ["{bg: 'sky-500'}", "bg-sky-500"],
    ["{fontFamily: 'mono'}", "font-mono"],
    ["{bgRepeat: 'no-repeat'}", "bg-no-repeat"],

    // Complex deep nesting resulting in single classes
    ["{peer: {hover: {color: 'white'}}}", "peer-hover:text-white"],
    ["{selection: {bg: 'highlight-bg'}}", "selection:bg-highlight-bg"],
    ["{selection: {text: 'highlight-fb'}}", "selection:text-highlight-fb"],
    ["{insetShadowColor: { color: 'red-500', op: 30 }}", "inset-shadow-red-500/30"],
    ["{hover: {active: {focus: {bg: 'blue-600'}}}", "hover:active:focus:bg-blue-600"],
    ["{disabled: {hover: {opacity: 80}}}", "disabled:hover:opacity-80"],
    ["{md: {dark: {text: {color: 'white', op: 90}}}", "md:dark:text-white/90"],
    ["{groupHover: {last: {border: {b: 2}}}}", "group-hover:last:border-b-2"],
    ["{sm: {focusWithin: {ring: {offset: {color: 'primary'}}}}}", "sm:focus-within:ring-offset-primary"],
    ["{lg: {peerChecked: {scale: 105}}}", "lg:peer-checked:scale-105"],
    ["{ariaExpanded: {flex: 1}}", "aria-expanded:flex-1"],
    ["{in: {'.group.is-published': {bg: 'green-50'}}}", "in-[.group.is-published]:bg-green-50"],
    ["{has: {':checked': {text: 'blue-900'}}}", "has-[:checked]:text-blue-900"],
    ["{supports: {grid: {grid: {cols: 2}}}}", "supports-[display:grid]:grid-cols-2"],
    ["{motionReduce: {transition: 'none'}}", "motion-reduce:transition-none"],
    ["{bgImg: { gradient: 'conic', dir: 'at 50% 75%' }}", "bg-conic-[at_50%_75%]"],

    // Abstract property combinations
    ["{'[&>span]': {color: 'blue'}}", "[&>span]:text-blue"], // Note: single class focus
    ["{before: {content: '\"\"', block: true}}", "before:content-['']"], // Note: single class focus
    ["{xl: {portrait: {bg: {gradient: 'to-r'}}}}", "xl:portrait:bg-gradient-to-r"],
    ["{lg: {landscape: {w: 'full'}}}", "lg:landscape:w-full"],
    ["{print: {hidden: true}}", "print:hidden"],
    ["{selection: {bg: 'fuchsia-300'}}", "selection:bg-fuchsia-300"],
    ["{marker: {text: 'sky-400'}}", "marker:text-sky-400"],
    ["{file: {border: 0, bg: 'transparent'}}", "file:border-0"],
    ["{placeholder: {text: 'slate-400'}}", "placeholder:text-slate-400"],

    // Arbitrary values and variants
    ["{maxW: '1200px'}", "max-w-[1200px]"],
    ["{w: 'calc(100vh-2rem)'}", "w-[calc(100vh-2rem)]"],
    ["{grid: {cols: '200px_minmax(900px,_1fr)_100px'}}", "grid-cols-[200px_minmax(900px,_1fr)_100px]"],
    ["{bg: {image: 'url(…)'}}", "bg-[url(…)]"],
    ["{text: '#50d71e'}", "text-[#50d71e]"],
    ["{animate: 'spin_3s_linear_infinite'}", "animate-[spin_3s_linear_infinite]"],
    ["{dropShadow: '0 0 15px rgba(255,255,255,0.02)'}", "drop-shadow-[0_0_15px_rgba(255,255,255,0.02)]"],

    // Specific edge cases
    ["{bgImg: {gradient: 'conic', dir: -145}}", "-bg-conic-145"],
    ["{focusVisible: {ring: {2: true, color: 'rose-500'}}}", "focus-visible:ring-rose-500"],
    ["{data: {'state=open': {animate: 'slide-down'}}}", "data-[state=open]:animate-slide-down"],
    ["{even: {bg: 'slate-100'}}", "even:bg-slate-100"],
    ["{only: {flex: 1}}", "only:flex-1"],

    // Spacing utilities
    ["{p: 4}", "p-4"],
    ["{px: 6}", "px-6"],
    ["{m: 'auto'}", "m-auto"],
    ["{gap: 6}", "gap-6"],

    // Sizing
    ["{w: 'full'}", "w-full"],
    ["{h: 'screen'}", "h-screen"],
    ["{maxW: '2xl'}", "max-w-2xl"],

    // Layout
    ["{overflow: 'hidden'}", "overflow-hidden"],
    ["{z: 10}", "z-10"],
    ["{absolute: true}", "absolute"],
    ["{inlineFlex: true}", "inline-flex"],

    // Flexbox & Grid
    ["{flexDir: 'col'}", "flex-col"],
    ["{items: 'center'}", "items-center"],
    ["{justify: 'between'}", "justify-between"],
    ["{gridCols: 3}", "grid-cols-3"],
    ["{grow: true}", "grow"],

    // Typography
    ["{text: 'xl'}", "text-xl"],
    ["{fontWeight: 'bold'}", "font-bold"],
    ["{tracking: 'tight'}", "tracking-tight"],
    ["{truncate: true}", "truncate"],

    // Borders & Effects
    ["{rounded: 'full'}", "rounded-full"],
    ["{ring: 2}", "ring-2"],
    ["{shadow: 'lg'}", "shadow-lg"],
    ["{opacity: 50}", "opacity-50"],
    ["{blur: 'sm'}", "blur-sm"],

    // Transforms
    ["{rotate: 45}", "rotate-45"],
    ["{scale: 105}", "scale-105"],

    // Backgrounds
    ["{bg: {color: 'blue-500', op: 50}}", "bg-blue-500/50"],
    ["{from: 'blue-500'}", "from-blue-500"],
    ["{to: 'purple-500'}", "to-purple-500"],
];

const mangleChars = 'zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJIHGFEDCBA';
let mangleIdx = 0;
function getNextMangle(): string {
  const i = mangleIdx++;
  return i < mangleChars.length
    ? mangleChars[i]
    : mangleChars[i % mangleChars.length] + Math.floor(i / mangleChars.length);
}

function highlightSz(text: string): string {
  return text.replace(
    /(\"[^\"]*\"|'[^']*')|([a-zA-Z0-9_]+)(?=\s*:)|(:\s*)(true|false)|(:\s*)([-0-9.]+)|([{}\[\],:])/g,
    (match, s, k, cb, b, cn, n, sym) => {
      if (s)   return `<span class="string">${s}</span>`;
      if (k)   return `<span class="key">${k}</span>`;
      if (b)   return `${cb}<span class="boolean">${b}</span>`;
      if (n)   return `${cn}<span class="number">${n}</span>`;
      if (sym) return `<span style="color:light-dark(#94a3b8,#475569)">${sym}</span>`;
      return match;
    }
  );
}

class TextScrambler {
  el: HTMLElement;
  chars = '!<>-_\\/[]{}—=+*^?#________';
  queue: Array<{ from: string; to: string; start: number; end: number; char?: string }> = [];
  frame = 0;
  frameRequest = 0;
  resolve: (() => void) = () => {};

  constructor(el: HTMLElement) { this.el = el; }

  setText(newText: string, className: string, useScramble: boolean, highlighted?: string): Promise<void> {
    const oldText = this.el.innerText || '';
    const length = Math.max(oldText.length, newText.length);
    const promise = new Promise<void>((r) => { this.resolve = r; });
    this.queue = Array.from({ length }, (_, i) => ({
      from: oldText[i] || '',
      to: newText[i] || '',
      start: Math.floor(Math.random() * 40),
      end: Math.floor(Math.random() * 40) + Math.floor(Math.random() * 40),
    }));
    cancelAnimationFrame(this.frameRequest);
    this.frame = 0;

    if (!useScramble) {
      if (className) this.el.className = className;
      this.el.innerHTML = highlighted || newText;
      this.el.style.opacity = '0';
      this.el.style.transition = 'opacity 0.8s ease-in-out';
      void this.el.offsetWidth;
      this.el.style.opacity = '1';
      this.resolve();
    } else {
      this.el.style.opacity = '1';
      this.el.style.transition = 'none';
      this.update(className, newText);
    }
    return promise;
  }

  update(className: string, plainText: string) {
    let output = '';
    let complete = 0;
    for (const { from, to, start, end, char } of this.queue.map((q, i) => ({ ...q, idx: i }))) {
      if (this.frame >= end) { complete++; output += to; }
      else if (this.frame >= start) {
        const c = char || this.chars[Math.floor(Math.random() * this.chars.length)];
        output += `<span style="opacity:0.5">${c}</span>`;
      } else {
        output += from;
      }
    }
    if (className) this.el.className = className;
    this.el.innerHTML = output;
    if (complete === this.queue.length) {
      this.resolve();
    } else {
      this.frame++;
      this.frameRequest = requestAnimationFrame(() => this.update(className, plainText));
    }
  }
}

const ANIM_CONFIG = {
  rowCount: 20, rowHeight: 16, rowGap: 8, maxCars: 240,
  spawnProbability: 0.3, speedMin: 0.024, speedVariation: 0.030,
  minGapPct: 4, chaseAcceleration: 2.5, brakeDeceleration: 0.75,
  twTriggerMin: 0, twTriggerRange: 35, mangleTriggerMin: 30, mangleTriggerRange: 25,
};

export default function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isReadyRef = useRef(false);
  const readyTimeRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const mangleCache = new Map<string, string>();
    const tracks: HTMLElement[] = [];
    const activeItems: any[] = [];
    const totalTracksHeight = (ANIM_CONFIG.rowCount * ANIM_CONFIG.rowHeight) + ((ANIM_CONFIG.rowCount - 1) * ANIM_CONFIG.rowGap);

    for (let i = 0; i < ANIM_CONFIG.rowCount; i++) {
      const track = document.createElement('div') as any;
      track.style.top = `calc(50% - ${totalTracksHeight / 2}px + ${i * (ANIM_CONFIG.rowHeight + ANIM_CONFIG.rowGap)}px)`;
      track.style.position = 'absolute';
      track.style.width = '100%';
      track.style.height = `${ANIM_CONFIG.rowHeight}px`;
      track.speed = ANIM_CONFIG.speedMin + Math.random() * ANIM_CONFIG.speedVariation;
      container.appendChild(track);
      tracks.push(track);
    }

    let rafHandle = 0;
    const schedule = () => { if (!document.hidden) rafHandle = requestAnimationFrame(animate); };

    function animate() {
      if (!isReadyRef.current) { schedule(); return; }
      const w = container!.offsetWidth || window.innerWidth;
      const warmup = (Date.now() - readyTimeRef.current) < 1500;
      const spawnChance = warmup ? 0.85 : ANIM_CONFIG.spawnProbability;

      if (Math.random() < spawnChance && activeItems.length < ANIM_CONFIG.maxCars) {
        const track = tracks[Math.floor(Math.random() * tracks.length)] as any;
        const onTrack = activeItems.filter(it => it.track === track);
        const last = onTrack[onTrack.length - 1];
        if (!last || last.xPos > 2) {
          const el = document.createElement('div');
          el.className = 'absolute whitespace-nowrap';
          el.style.left = '-300%';
          track.appendChild(el);
          const textEl = document.createElement('span');
          el.appendChild(textEl);
          const data = compileData[Math.floor(Math.random() * compileData.length)];
          textEl.className = 'phase-sz';
          textEl.innerText = data[0];
          const wPct = ((el.offsetWidth || w * 0.3) / Math.max(w, 1)) * 100;
          textEl.innerText = '';
          const startX = last ? last.xPos - wPct - 2 : -wPct - 1;
          const item: any = {
            el, textEl, track, widthPct: wPct, xPos: startX,
            speed: track.speed, scrambler: new TextScrambler(textEl),
            data: { sz: data[0], tw: data[1] },
          };
          activeItems.push(item);
          runPhases(item);
        }
      }

      const byTrack = new Map<HTMLElement, any[]>();
      activeItems.forEach(item => {
        if (!byTrack.has(item.track)) byTrack.set(item.track, []);
        byTrack.get(item.track)!.push(item);
      });

      for (const [track, items] of byTrack) {
        items.sort((a, b) => b.xPos - a.xPos);
        items.forEach((item, i) => {
          const iw = (item.el.offsetWidth / Math.max(w, 1)) * 100;
          let target = (track as any).speed;
          if (i > 0) {
            const gap = items[i - 1].xPos - (item.xPos + iw);
            if (gap > ANIM_CONFIG.minGapPct + 4) target = (track as any).speed * ANIM_CONFIG.chaseAcceleration;
            else if (gap < ANIM_CONFIG.minGapPct) target = items[i - 1].speed * ANIM_CONFIG.brakeDeceleration;
            else target = items[i - 1].speed;
            item.speed += (target - item.speed) * 0.1;
          } else { item.speed = (track as any).speed; }
          item.xPos += item.speed;
          item.el.style.left = `${item.xPos}%`;
        });
      }

      for (let i = activeItems.length - 1; i >= 0; i--) {
        if (activeItems[i].xPos > 120) {
          activeItems[i].el.remove();
          activeItems.splice(i, 1);
        }
      }
      schedule();
    }

    async function runPhases(item: any) {
      if (!activeItems.includes(item)) return;
      await item.scrambler.setText(item.data.sz, 'phase-sz', false, highlightSz(item.data.sz));
      const twT = ANIM_CONFIG.twTriggerMin + Math.random() * ANIM_CONFIG.twTriggerRange;
      await new Promise<void>(r => {
        const c = () => { if (!activeItems.includes(item)) return r(); if (item.xPos >= twT) return r(); requestAnimationFrame(c); };
        c();
      });
      if (!activeItems.includes(item)) return;
      await item.scrambler.setText(item.data.tw, 'phase-tw', true);
      const mgT = ANIM_CONFIG.mangleTriggerMin + Math.random() * ANIM_CONFIG.mangleTriggerRange;
      await new Promise<void>(r => {
        const c = () => { if (!activeItems.includes(item)) return r(); if (item.xPos >= mgT) return r(); requestAnimationFrame(c); };
        c();
      });
      if (!activeItems.includes(item)) return;
      const mangled = mangleCache.get(item.data.sz) || (() => { const m = getNextMangle(); mangleCache.set(item.data.sz, m); return m; })();
      await item.scrambler.setText(mangled, 'phase-mangle', true);
    }

    schedule();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(rafHandle);
      else schedule();
    });

    // ── Hero typewriter sequence ───────────────────────────────────────
    const hoSzEl    = document.getElementById('ho-sz');
    const hoCursor  = document.getElementById('ho-cursor');
    const hoTwRow   = document.getElementById('ho-tw-row');
    const hoMgRow   = document.getElementById('ho-mg-row');
    const hoLabel   = document.getElementById('ho-label');
    const heroOpen  = document.getElementById('hero-opening');

    const hoSzText = "sz={{\n  p: 4,\n  bg: 'blue-500',\n  hover: {\n    bg: 'blue-600',\n  },\n}}";
    let hoTyped = 0;

    const highlight = (text: string) => text.replace(
      /(\"[^\"]*\"|'[^']*')|([a-zA-Z0-9_]+)(?=\s*:)|(:\s*)(true|false)|(:\s*)([-0-9.]+)|([{}\[\],:])/g,
      (m, s, k, cb, b, cn, n, sym) => {
        if (s)   return `<span class="ho-string">${s}</span>`;
        if (k)   return `<span class="ho-key">${k}</span>`;
        if (b)   return `${cb}<span class="ho-boolean">${b}</span>`;
        if (n)   return `${cn}<span class="ho-number">${n}</span>`;
        if (sym) return `<span class="ho-symbol">${sym}</span>`;
        return m;
      }
    );

    setTimeout(() => { if (hoLabel) hoLabel.style.opacity = '1'; }, 250);
    setTimeout(() => {
      const iv = setInterval(() => {
        if (hoSzEl) hoSzEl.innerHTML = highlight(hoSzText.slice(0, ++hoTyped));
        if (hoTyped >= hoSzText.length) {
          clearInterval(iv);
          if (hoCursor) { hoCursor.style.animation = 'none'; hoCursor.style.opacity = '0'; }
          setTimeout(() => {
            if (hoTwRow) hoTwRow.style.opacity = '1';
            setTimeout(() => {
              if (hoMgRow) hoMgRow.style.opacity = '1';
              if (container) {
                container.classList.add('start-anim');
                container.style.opacity = '1';
              }
              isReadyRef.current = true;
              readyTimeRef.current = Date.now();
              setTimeout(() => {
                if (heroOpen) { heroOpen.style.transition = 'opacity 0.8s ease'; heroOpen.style.opacity = '0'; }
              }, 900);
            }, 550);
          }, 380);
        }
      }, 32);
    }, 500);

    return () => { cancelAnimationFrame(rafHandle); };
  }, []);

  return (<>
    {/* Dot Grid Background */}
    <div
      className="lp-dot-grid"
      sz={{
        fixed: true,
        inset: 0,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
    <section
      sz={{
        relative: true,
        grid: true,
        mx: 'auto',
        px: 6,
        lg: { gridCols: 2, px: 20 },
        gap: 16,
        items: 'center',
        alignContent: 'center',
        minH: '100svh',
        maxW: 'screen-2xl',
      }}
    >
      {/* Left column */}
      <div sz={{ flex: true, flexDir: 'col', gap: 8 }}>
        <h1
          className="hero-in-1"
          sz={{ text: '5xl', lg: { text: '7xl' }, fontWeight: 'black', leading: 'tight', color: 'neutral-800', dark: { color: 'white' }, tracking: 'tighter' }}
        >
          Style from data.<br />
          <span sz={{ color: 'primary' }}>Zero</span> wasted{' '}
          <span sz={{ color: 'primary' }}>CSS</span>
        </h1>

        <p
          className="hero-in-2"
          sz={{ color: 'neutral-900', dark: { color: 'slate-400' }, text: 'lg', maxW: 'lg', fontWeight: 'light', leading: 'relaxed' }}
        >
          CSSzyx compiles sz props to Tailwind at build time.<br />
          For runtime UI states or dynamic API data — it injects only the exact CSS Delta you need.{' '}
          <span sz={{ fontWeight: 'normal', color: 'neutral-900', dark: { color: 'slate-300' } }}>No more safelist bloat or pre-defined string concatenation.</span>
        </p>

        <div className="hero-in-3" sz={{ flex: true, gap: 4 }}>
          <a
            href="/docs/installation"
            sz={{
              bg: 'primary',
              hover: { bg: 'primary-thin', dropShadow: '0 0 15px rgba(45,213,151,0.5)' },
              transition: 'all',
              duration: 1200,
              color: 'neutral-900',
              fontWeight: 'bold',
              py: 4,
              px: 10,
              rounded: '2xl',
              fontFamily: 'mono',
              uppercase: true,
              tracking: 'widest',
              text: 'sm',
              flex: true,
              items: 'center',
              gap: 3,
              cursor: 'pointer',
            }}
          >
            Get started
            <span className="material-symbols-outlined">arrow_right_alt</span>
          </a>
          <a
            href="/docs/sz-props"
            sz={{
              border: true,
              borderColor: { color: 'secondary', op: 10 },
              dark: { borderColor: 'secondary', hover: { bg: 'secondary' }, color: 'white' },
              hover: { bg: { color: 'black', op: 5 } },
              transition: 'all',
              duration: 1200,
              color: 'neutral-900',
              py: 4,
              px: 10,
              rounded: '2xl',
              fontFamily: 'mono',
              text: 'sm',
              uppercase: true,
              tracking: 'widest',
              flex: true,
              items: 'center',
              gap: 3,
              dropShadow: '0 0 15px rgba(63,15,166,0.3)',
              cursor: 'pointer',
            }}
          >
            View Docs
            <span className="material-symbols-outlined">arrow_right_alt</span>
          </a>
        </div>
      </div>

      {/* Right column — compiler animation */}
      <div sz={{ relative: true }}>
        <div sz={{ aspect: 'square', w: 'full', flex: true, items: 'center', justify: 'center', relative: true }}>
          {/* Hero opening typewriter */}
          <div
            id="hero-opening"
            sz={{ absolute: true, inset: 0, flex: true, flexDir: 'col', items: 'center', justify: 'center', pointerEvents: 'none', z: 10, px: 8 }}
          >
            <div sz={{ w: 'full', maxW: 'xs', fontFamily: 'mono' }}>
              <div id="ho-label" sz={{ text: '9px', tracking: 'widest', color: { color: 'primary', op: 50 }, uppercase: true, mb: 4 }} style={{ opacity: 0, transition: 'opacity 0.5s ease' }}>
                compiling...
              </div>
              <div sz={{ mb: 3, minH: '170px' }}>
                <span id="ho-sz" sz={{ color: 'slate-400', text: '11px', leading: 'snug', whitespace: 'pre-wrap' }} />
                <span id="ho-cursor" />
              </div>
              <div id="ho-tw-row" sz={{ flex: true, items: 'center', gap: 2, mb: 3 }} style={{ opacity: 0, transition: 'opacity 0.7s ease' }}>
                <span sz={{ color: 'slate-600', text: '10px', select: 'none', shrink: 0 }}>↓</span>
                <span sz={{ color: 'purple-400', text: '11px', fontWeight: 'medium' }}>p-4 bg-blue-500 hover:bg-blue-600</span>
              </div>
              <div id="ho-mg-row" sz={{ flex: true, items: 'center', gap: 2 }} style={{ opacity: 0, transition: 'opacity 0.7s ease' }}>
                <span sz={{ color: 'slate-600', text: '10px', select: 'none', shrink: 0 }}>↓</span>
                <span sz={{ text: '11px', fontWeight: 'bold' }} style={{ color: '#2dd597', textShadow: '0 0 14px rgba(45,213,151,0.9), 0 0 4px rgba(45,213,151,0.6)' }}>z&nbsp;&nbsp;y&nbsp;&nbsp;x</span>
              </div>
            </div>
          </div>

          {/* Scramble animation container */}
          <div
            ref={containerRef}
            className="scramble-container"
            sz={{ opacity: 0 }}
          />
        </div>
      </div>
    </section>
  </>);
}
