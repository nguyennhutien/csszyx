import { useEffect, useRef } from 'react';

import { highlightSzTokens } from '../../utils/highlight-sz-tokens.js';

import { compileData } from './hero-compile-data.js';
import { mangledClassList } from './hero-mangle.js';

const mangleChars = 'zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJIHGFEDCBA';
let mangleIdx = 0;
function getNextMangle(): string {
  const i = mangleIdx++;
  return i < mangleChars.length
    ? mangleChars[i]
    : mangleChars[i % mangleChars.length] + Math.floor(i / mangleChars.length);
}

function highlightSz(text: string): string {
  return highlightSzTokens(text, '');
}

class TextScrambler {
  el: HTMLElement;
  chars = String.raw`!<>-_\/[]{}—=+*^?#________`;
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
      this.el.getBoundingClientRect();
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

interface HeroOpeningElements {
  container: HTMLElement;
  cursor: HTMLElement | null;
  label: HTMLElement | null;
  mangleRow: HTMLElement | null;
  opening: HTMLElement | null;
  sz: HTMLElement | null;
  tailwindRow: HTMLElement | null;
}

function waitForOpeningStep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function typeOpeningSz(element: HTMLElement | null, text: string, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    let typed = 0;
    const interval = setInterval(() => {
      if (signal.aborted) {
        clearInterval(interval);
        resolve();
        return;
      }

      if (element) element.innerHTML = highlightSzTokens(text.slice(0, ++typed), 'ho-');
      if (typed >= text.length) {
        clearInterval(interval);
        resolve();
      }
    }, 32);
  });
}

async function runHeroOpening(
  elements: HeroOpeningElements,
  signal: AbortSignal,
  markReady: () => void,
): Promise<void> {
  await waitForOpeningStep(250);
  if (signal.aborted) return;
  if (elements.label) elements.label.style.opacity = '1';

  await waitForOpeningStep(250);
  await typeOpeningSz(
    elements.sz,
    "sz={{\n  p: 4,\n  bg: 'blue-500',\n  hover: {\n    bg: 'blue-600',\n  },\n}}",
    signal,
  );
  if (signal.aborted) return;
  if (elements.cursor) {
    elements.cursor.style.animation = 'none';
    elements.cursor.style.opacity = '0';
  }

  await waitForOpeningStep(380);
  if (signal.aborted) return;
  if (elements.tailwindRow) elements.tailwindRow.style.opacity = '1';

  await waitForOpeningStep(550);
  if (signal.aborted) return;
  if (elements.mangleRow) elements.mangleRow.style.opacity = '1';
  elements.container.classList.add('start-anim');
  elements.container.style.opacity = '1';
  markReady();

  await waitForOpeningStep(900);
  if (signal.aborted || !elements.opening) return;
  elements.opening.style.transition = 'opacity 0.8s ease';
  elements.opening.style.opacity = '0';
}

interface PositionedAnimationItem {
  xPos: number;
}

function waitForItemPosition(
  item: PositionedAnimationItem,
  target: number,
  activeItems: readonly PositionedAnimationItem[],
): Promise<void> {
  return new Promise(resolve => {
    function checkPosition() {
      if (!activeItems.includes(item) || item.xPos >= target) {
        resolve();
        return;
      }
      requestAnimationFrame(checkPosition);
    }
    checkPosition();
  });
}

export default function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isReadyRef = useRef(false);
  const readyTimeRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const openingController = new AbortController();

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
          if (i > 0) {
            const gap = items[i - 1].xPos - (item.xPos + iw);
            let target = items[i - 1].speed;
            if (gap > ANIM_CONFIG.minGapPct + 4) {
              target = (track as any).speed * ANIM_CONFIG.chaseAcceleration;
            } else if (gap < ANIM_CONFIG.minGapPct) {
              target = items[i - 1].speed * ANIM_CONFIG.brakeDeceleration;
            }
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
      await waitForItemPosition(item, twT, activeItems);
      if (!activeItems.includes(item)) return;
      await item.scrambler.setText(item.data.tw, 'phase-tw', true);
      const mgT = ANIM_CONFIG.mangleTriggerMin + Math.random() * ANIM_CONFIG.mangleTriggerRange;
      await waitForItemPosition(item, mgT, activeItems);
      if (!activeItems.includes(item)) return;
      const mangled = mangledClassList(item.data.tw, mangleCache, getNextMangle);
      await item.scrambler.setText(mangled, 'phase-mangle', true);
    }

    schedule();
    const handleVisibilityChange = () => {
      if (document.hidden) cancelAnimationFrame(rafHandle);
      else schedule();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // ── Hero typewriter sequence ───────────────────────────────────────
    const hoSzEl    = document.getElementById('ho-sz');
    const hoCursor  = document.getElementById('ho-cursor');
    const hoTwRow   = document.getElementById('ho-tw-row');
    const hoMgRow   = document.getElementById('ho-mg-row');
    const hoLabel   = document.getElementById('ho-label');
    const heroOpen  = document.getElementById('hero-opening');

    runHeroOpening(
      {
        container,
        cursor: hoCursor,
        label: hoLabel,
        mangleRow: hoMgRow,
        opening: heroOpen,
        sz: hoSzEl,
        tailwindRow: hoTwRow,
      },
      openingController.signal,
      () => {
        isReadyRef.current = true;
        readyTimeRef.current = Date.now();
      },
    ).catch(error => console.error('[csszyx docs] hero opening animation failed', error));

    return () => {
      openingController.abort();
      cancelAnimationFrame(rafHandle);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (<>
    {/* Dot Grid Background */}
    <div
      className="lp-dot-grid"
      sz={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
    <section
      sz={{
        position: 'relative',
        display: 'grid',
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
      <div sz={{ display: 'flex', flexDir: 'col', gap: 8 }}>
        <h1
          className="hero-in-1"
          sz={{ text: '5xl', lg: { text: '7xl' }, weight: 'black', leading: 'tight', color: 'neutral-800', dark: { color: 'white' }, tracking: 'tighter' }}
        >
          Style from data.<br />
          <span sz={{ color: 'primary' }}>Zero</span> wasted{' '}
          <span sz={{ color: 'primary' }}>CSS</span>
        </h1>

        <p
          className="hero-in-2"
          sz={{ color: 'neutral-900', dark: { color: 'slate-400' }, text: 'lg', maxW: 'lg', weight: 'light', leading: 'relaxed' }}
        >
          CSSzyx compiles sz props to Tailwind at build time.<br />
          For runtime UI states or dynamic API data — it injects only the exact CSS Delta you need.{' '}
          <span sz={{ weight: 'normal', color: 'neutral-900', dark: { color: 'slate-300' } }}>No more safelist bloat or pre-defined string concatenation.</span>
        </p>

        <div className="hero-in-3" sz={{ display: 'flex', gap: 4 }}>
          <a
            href="/docs/installation"
            sz={{
              bg: 'primary',
              hover: { bg: 'primary-thin', dropShadow: '0 0 15px rgba(45,213,151,0.5)' },
              transition: 'all',
              duration: 1200,
              color: 'neutral-900',
              weight: 'bold',
              py: 4,
              px: 10,
              rounded: '2xl',
              fontFamily: 'mono',
              textTransform: 'uppercase',
              tracking: 'widest',
              text: 'sm',
              display: 'flex',
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
              textTransform: 'uppercase',
              tracking: 'widest',
              display: 'flex',
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
      <div sz={{ position: 'relative' }}>
        <div sz={{ aspect: 'square', w: 'full', display: 'flex', items: 'center', justify: 'center', position: 'relative' }}>
          {/* Hero opening typewriter */}
          <div
            id="hero-opening"
            sz={{ position: 'absolute', inset: 0, display: 'flex', flexDir: 'col', items: 'center', justify: 'center', pointerEvents: 'none', z: 10, px: 8 }}
          >
            <div sz={{ w: 'full', maxW: 'xs', fontFamily: 'mono' }}>
              <div id="ho-label" sz={{ text: '9px', tracking: 'widest', color: { color: 'primary', op: 50 }, textTransform: 'uppercase', mb: 4 }} style={{ opacity: 0, transition: 'opacity 0.5s ease' }}>
                compiling...
              </div>
              <div sz={{ mb: 3, minH: '170px' }}>
                <span id="ho-sz" sz={{ color: 'slate-400', text: '11px', leading: 'snug', whitespace: 'pre-wrap' }} />
                <span id="ho-cursor" />
              </div>
              <div id="ho-tw-row" sz={{ display: 'flex', items: 'center', gap: 2, mb: 3 }} style={{ opacity: 0, transition: 'opacity 0.7s ease' }}>
                <span sz={{ color: 'slate-600', text: '10px', select: 'none', shrink: 0 }}>↓</span>
                <span sz={{ color: 'purple-400', text: '11px', weight: 'medium' }}>p-4 bg-blue-500 hover:bg-blue-600</span>
              </div>
              <div id="ho-mg-row" sz={{ display: 'flex', items: 'center', gap: 2 }} style={{ opacity: 0, transition: 'opacity 0.7s ease' }}>
                <span sz={{ color: 'slate-600', text: '10px', select: 'none', shrink: 0 }}>↓</span>
                <span sz={{ text: '11px', weight: 'bold' }} style={{ color: '#2dd597', textShadow: '0 0 14px rgba(45,213,151,0.9), 0 0 4px rgba(45,213,151,0.6)' }}>z&nbsp;&nbsp;y&nbsp;&nbsp;x</span>
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
