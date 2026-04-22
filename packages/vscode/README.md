# CSSzyx Extension for VS Code

Official extension for **CSSzyx** - IntelliSense, hover previews, and diagnostics for `sz` props.

## Features

- **Autocomplete & IntelliSense**: Full autocompletion for `sz` props, Tailwind classes, and variants.
- **Hover Previews**: Hover over any `sz` prop to see the exact generated CSS and Tailwind classes.
- **Diagnostics**: Get warnings directly in your editor if you use an unknown prop or an invalid configuration.
- **Syntax Highlighting**: Embedded TextMate grammar to highlight `sz` objects in TSX/JSX/HTML perfectly.

## Requirements

You must be in a project that has `@csszyx/compiler` or `@csszyx/unplugin` installed.

## Extension Settings

This extension contributes the following settings:

- `csszyx.enableDiagnostics`: Report unknown sz props as warnings (default: `true`).
- `csszyx.enableHover`: Show generated Tailwind classes on hover (default: `true`).

## Links

- [CSSzyx Documentation](https://csszyx.com)
- [GitHub Repository](https://github.com/nguyennhutien/csszyx)
