import { useEffect, useRef } from 'react';

// ── Compiler animation data ────────────────────────────────────────
// Object form is intentional: property values sit after `:` in the bundle, which is
// outside the lookbehind of the mangler's Pass 3 regex (?<=(?:[,(]|&&)\s*).
// Array tuple form `[sz, tw]` would place the `tw` string after `,` → Pass 3 would
// mangle it, replacing e.g. "flex" with the minified token "z".
interface CompileEntry { sz: string; tw: string; }
const compileData: CompileEntry[] = [
    // Common
    { sz: "{flex: true}", tw: "flex" },
    { sz: "{shrink: 0}", tw: "shrink-0" },
    { sz: "{grayscale: true}", tw: "grayscale" },
    { sz: "{firstLine: {uppercase: true}}", tw: "first-line:uppercase" },
    { sz: "{bg: 'sky-500'}", tw: "bg-sky-500" },
    { sz: "{fontFamily: 'mono'}", tw: "font-mono" },
    { sz: "{bgRepeat: 'no-repeat'}", tw: "bg-no-repeat" },

    // Complex deep nesting resulting in single classes
    { sz: "{peer: {hover: {color: 'white'}}}", tw: "peer-hover:text-white" },
    { sz: "{selection: {bg: 'highlight-bg'}}", tw: "selection:bg-highlight-bg" },
    { sz: "{selection: {text: 'highlight-fb'}}", tw: "selection:text-highlight-fb" },
    { sz: "{insetShadowColor: { color: 'red-500', op: 30 }}", tw: "inset-shadow-red-500/30" },
    { sz: "{hover: {active: {focus: {bg: 'blue-600'}}}", tw: "hover:active:focus:bg-blue-600" },
    { sz: "{disabled: {hover: {opacity: 80}}}", tw: "disabled:hover:opacity-80" },
    { sz: "{md: {dark: {text: {color: 'white', op: 90}}}", tw: "md:dark:text-white/90" },
    { sz: "{groupHover: {last: {border: {b: 2}}}}", tw: "group-hover:last:border-b-2" },
    { sz: "{sm: {focusWithin: {ring: {offset: {color: 'primary'}}}}}", tw: "sm:focus-within:ring-offset-primary" },
    { sz: "{lg: {peerChecked: {scale: 105}}}", tw: "lg:peer-checked:scale-105" },
    { sz: "{ariaExpanded: {flex: 1}}", tw: "aria-expanded:flex-1" },
    { sz: "{in: {'.group.is-published': {bg: 'green-50'}}}", tw: "in-[.group.is-published]:bg-green-50" },
    { sz: "{has: {':checked': {text: 'blue-900'}}}", tw: "has-[:checked]:text-blue-900" },
    { sz: "{supports: {grid: {grid: {cols: 2}}}}", tw: "supports-[display:grid]:grid-cols-2" },
    { sz: "{motionReduce: {transition: 'none'}}", tw: "motion-reduce:transition-none" },
    { sz: "{bgImg: { gradient: 'conic', dir: 'at 50% 75%' }}", tw: "bg-conic-[at_50%_75%]" },

    // Abstract property combinations
    { sz: "{'[&>span]': {color: 'blue'}}", tw: "[&>span]:text-blue" },
    { sz: "{before: {content: '\"\"', block: true}}", tw: "before:content-['']" },
    { sz: "{xl: {portrait: {bg: {gradient: 'to-r'}}}}", tw: "xl:portrait:bg-gradient-to-r" },
    { sz: "{lg: {landscape: {w: 'full'}}}", tw: "lg:landscape:w-full" },
    { sz: "{print: {hidden: true}}", tw: "print:hidden" },
    { sz: "{selection: {bg: 'fuchsia-300'}}", tw: "selection:bg-fuchsia-300" },
    { sz: "{marker: {text: 'sky-400'}}", tw: "marker:text-sky-400" },
    { sz: "{file: {border: 0, bg: 'transparent'}}", tw: "file:border-0" },
    { sz: "{placeholder: {text: 'slate-400'}}", tw: "placeholder:text-slate-400" },

    // Arbitrary values and variants
    { sz: "{maxW: '1200px'}", tw: "max-w-[1200px]" },
    { sz: "{w: 'calc(100vh-2rem)'}", tw: "w-[calc(100vh-2rem)]" },
    { sz: "{grid: {cols: '200px_minmax(900px,_1fr)_100px'}}", tw: "grid-cols-[200px_minmax(900px,_1fr)_100px]" },
    { sz: "{bg: {image: 'url(…)'}}", tw: "bg-[url(…)]" },
    { sz: "{text: '#50d71e'}", tw: "text-[#50d71e]" },
    { sz: "{animate: 'spin_3s_linear_infinite'}", tw: "animate-[spin_3s_linear_infinite]" },
    { sz: "{dropShadow: '0 0 15px rgba(255,255,255,0.02)'}", tw: "drop-shadow-[0_0_15px_rgba(255,255,255,0.02)]" },

    // Specific edge cases
    { sz: "{bgImg: {gradient: 'conic', dir: -145}}", tw: "-bg-conic-145" },
    { sz: "{focusVisible: {ring: {2: true, color: 'rose-500'}}}", tw: "focus-visible:ring-rose-500" },
    { sz: "{data: {'state=open': {animate: 'slide-down'}}}", tw: "data-[state=open]:animate-slide-down" },
    { sz: "{even: {bg: 'slate-100'}}", tw: "even:bg-slate-100" },
    { sz: "{only: {flex: 1}}", tw: "only:flex-1" },

    // Spacing utilities
    { sz: "{p: 4}", tw: "p-4" },
    { sz: "{px: 6}", tw: "px-6" },
    { sz: "{m: 'auto'}", tw: "m-auto" },
    { sz: "{gap: 6}", tw: "gap-6" },

    // Sizing
    { sz: "{w: 'full'}", tw: "w-full" },
    { sz: "{h: 'screen'}", tw: "h-screen" },
    { sz: "{maxW: '2xl'}", tw: "max-w-2xl" },

    // Layout
    { sz: "{overflow: 'hidden'}", tw: "overflow-hidden" },
    { sz: "{z: 10}", tw: "z-10" },
    { sz: "{absolute: true}", tw: "absolute" },
    { sz: "{inlineFlex: true}", tw: "inline-flex" },

    // Flexbox & Grid
    { sz: "{flexDir: 'col'}", tw: "flex-col" },
    { sz: "{items: 'center'}", tw: "items-center" },
    { sz: "{justify: 'between'}", tw: "justify-between" },
    { sz: "{gridCols: 3}", tw: "grid-cols-3" },
    { sz: "{grow: true}", tw: "grow" },

    // Typography
    { sz: "{text: 'xl'}", tw: "text-xl" },
    { sz: "{fontWeight: 'bold'}", tw: "font-bold" },
    { sz: "{tracking: 'tight'}", tw: "tracking-tight" },
    { sz: "{truncate: true}", tw: "truncate" },

    // Borders & Effects
    { sz: "{rounded: 'full'}", tw: "rounded-full" },
    { sz: "{ring: 2}", tw: "ring-2" },
    { sz: "{shadow: 'lg'}", tw: "shadow-lg" },
    { sz: "{opacity: 50}", tw: "opacity-50" },
    { sz: "{blur: 'sm'}", tw: "blur-sm" },

    // Transforms
    { sz: "{rotate: 45}", tw: "rotate-45" },
    { sz: "{scale: 105}", tw: "scale-105" },

    // Backgrounds
    { sz: "{bg: {color: 'blue-500', op: 50}}", tw: "bg-blue-500/50" },
    { sz: "{from: 'blue-500'}", tw: "from-blue-500" },
    { sz: "{to: 'purple-500'}", tw: "to-purple-500" },
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
    /("[^"]*"|'[^']*')|([a-zA-Z0-9_]+)(?=\s*:)|(:\s*)(true|false)|(:\s*)([-0-9.]+)|([{}[\],:])/g,
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
          textEl.innerText = data.sz;
          const wPct = ((el.offsetWidth || w * 0.3) / Math.max(w, 1)) * 100;
          textEl.innerText = '';
          const startX = last ? last.xPos - wPct - 2 : -wPct - 1;
          const item: any = {
            el, textEl, track, widthPct: wPct, xPos: startX,
            speed: track.speed, scrambler: new TextScrambler(textEl),
            data: { sz: data.sz, tw: data.tw },
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
      /("[^"]*"|'[^']*')|([a-zA-Z0-9_]+)(?=\s*:)|(:\s*)(true|false)|(:\s*)([-0-9.]+)|([{}[\],:])/g,
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
