// A plugin module with NO default export. Real ESM, so importing it yields a
// namespace whose `default` is undefined — the shape `@plugin` still has to
// work with, because a module's namespace IS the plugin when it exports the
// `{ handler }` pair directly.
export function handler({ addUtilities }) {
    addUtilities({ '.esm-plugin-made-this': { padding: '5px' } });
}
