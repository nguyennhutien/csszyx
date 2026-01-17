# CSSZYX Specification Index

This document serves as the central index for the CSSZYX specification. The detailed mappings and rules have been split into focused snippet files for better maintainability.

## 🧩 Component Specifications

All explicit property mappings between `sz` objects and Tailwind v4 classes are defined in the `snippets/` directory.

### Core & Layout

- [Core Concepts](snippets/core-concepts.md) - Utility classes, state modifiers, arbitrary values
- [Layout](snippets/layout.md) - Aspect ratio, columns, breakage, box sizing, display, floats, positioning, visibility, z-index
- [Flexbox & Grid](snippets/flex-grid.md) - Flex containers, items, grid templates, auto-flow, alignment
- [Spacing](snippets/spacing.md) - Padding, margin, space-between
- [Sizing](snippets/sizing.md) - Width, height, min/max dimensions
- [Typography](snippets/typography.md) - Fonts, size, weight, tracking, leading, alignment, color, decoration

### Visuals

- [Backgrounds](snippets/backgrounds.md) - Color, images, gradients, clipping, attachment
- [Borders](snippets/borders.md) - Radius, width, color, style, dividers, outlines
- [Effects](snippets/effects.md) - Box shadow, opacity, mix-blend-mode
- [Filters](snippets/filters.md) - Blur, brightness, contrast, drop-shadow, grayscale, hue-rotate, invert, saturate, sepia (including backdrop filters)

### Interaction & Animation

- [Interactivity](snippets/interactivity.md) - Accent color, appearance, cursor, pointer-events, resize, scroll behavior, touch action, user select
- [Transitions & Animation](snippets/transitions.md) - Properties, duration, timing, delay, keyframe animations
- [Transforms](snippets/transforms.md) - Rotate, scale, skew, translate, transform origin

### Miscellaneous

- [Tables](snippets/tables.md) - Border collapse, spacing, table layout
- [SVG & Accessibility](snippets/misc.md) - Fill, stroke, forced-color-adjust

## 🧪 Test Generation

These snippets are used by the `scripts/spec-to-tests.ts` script to generate canonical test cases in `tests/generated/`.
