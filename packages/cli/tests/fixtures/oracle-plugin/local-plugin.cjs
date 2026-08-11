// A hand-written Tailwind plugin, in the shape `@plugin` expects: the module's
// default export is the plugin function. Kept local so the fixture does not
// depend on a published plugin being installed.
module.exports = function csszyxFixturePlugin({ addUtilities }) {
    addUtilities({ '.plugin-made-this': { padding: '3px' } });
};
