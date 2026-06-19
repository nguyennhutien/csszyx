## Common Props Reference

### Spacing

```tsx
{
  p: 4;
} // padding: 1rem        → p-4
{
  px: 4;
} // padding-inline       → px-4
{
  py: 2;
} // padding-block        → py-2
{
  m: "auto";
} // margin: auto         → m-auto
{
  m: -4;
} // margin: -1rem        → -m-4
{
  gap: 4;
} // gap: 1rem            → gap-4
{
  spaceX: 2;
} // space-x              → space-x-2
```

### Sizing

```tsx
{
  w: "full";
} // width: 100%          → w-full
{
  h: "screen";
} // height: 100vh        → h-screen
{
  size: 10;
} // width & height       → size-10
{
  maxW: "2xl";
} // max-width            → max-w-2xl
```

### Layout

```tsx
{
  display: "flex";
} // → flex
{
  display: "grid";
} // → grid
{
  display: "none";
} // → hidden
{
  position: "absolute";
} // → absolute
{
  position: "relative";
} // → relative
{
  overflow: "hidden";
} // overflow          → overflow-hidden
{
  z: 10;
} // z-index           → z-10
```

### Flexbox / Grid

```tsx
{
  flexDir: "col";
} // flex-col
{
  items: "center";
} // items-center
{
  justify: "between";
} // justify-between
{
  gridCols: 3;
} // grid-cols-3
{
  colSpan: 2;
} // col-span-2
{
  grow: true;
} // grow
{
  shrink: 0;
} // shrink-0
```

### Typography

```tsx
{
  text: "xl";
} // text-xl (size + leading)
{
  fontWeight: "bold";
} // font-bold
{
  fontFamily: "mono";
} // font-mono
{
  tracking: "tight";
} // tracking-tight
{
  leading: 7;
} // leading-7
{
  textAlign: "center";
} // text-center
{
  uppercase: true;
} // uppercase
{
  truncate: true;
} // truncate
```

### Backgrounds

```tsx
{ bg: 'blue-500' }                           // bg-blue-500
{ bg: { color: 'blue-500', op: 50 } }        // bg-blue-500/50
{ bgImg: { gradient: 'linear', dir: 'to-r' } } // bg-linear-to-r
{ from: 'blue-500', to: 'purple-500' }       // gradient stops
```

### Borders

```tsx
{
  border: true;
} // border (1px solid)
{
  border: 2;
} // border-2
{
  borderColor: "red-500";
} // border-red-500
{
  rounded: "lg";
} // rounded-lg
{
  rounded: "full";
} // rounded-full
{
  ring: 2;
} // ring-2
{
  outline: "none";
} // outline-none
```

### Effects & Filters

```tsx
{
  shadow: "lg";
} // shadow-lg
{
  opacity: 50;
} // opacity-50
{
  blur: "sm";
} // blur-sm
{
  grayscale: true;
} // grayscale
{
  transition: true;
} // transition (common props)
{
  duration: 300;
} // duration-300
{
  delay: 150;
} // delay-150 (transition-delay — NOT animation-delay)
{
  animate: "spin";
} // animate-spin
{
  animationDelay: 150;
} // [animation-delay:150ms] — no Tailwind utility, emits arbitrary CSS property
{
  animationDelay: "0.5s";
} // [animation-delay:0.5s]  — string passed through as-is
// Arbitrary drop shadow works in any variant context:
{
  hover: {
    dropShadow: "0 0 15px rgba(45,213,151,0.5)";
  }
}
// → hover:drop-shadow-[0_0_15px_rgba(45,213,151,0.5)]
```

### Transforms

```tsx
{
  rotate: 45;
} // rotate-45
{
  scale: 105;
} // scale-105
{
  translate: 4;
} // translate-4 (both axes shorthand)
{
  translate: "1/2";
} // translate-1/2
{
  translateX: 4;
} // translate-x-4
{
  translateX: "-1/2";
} // -translate-x-1/2
{
  origin: "center";
} // origin-center
{
  transform: "none";
} // transform-none
{
  transform: "gpu";
} // transform-gpu (GPU compositing)
{
  transform: "cpu";
} // transform-cpu (disable GPU compositing)
```
