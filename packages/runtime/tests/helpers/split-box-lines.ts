/**
 * The development lines `splitBox`, `splitBoxSz` and the `has`/`pick`/`omit`
 * toolkit print, spelled out from the registry's words so a suite pins the
 * bytes the user reads.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite.
 */
import { runtimeMessage } from '../../../compiler/tests/engine-message.js';

/**
 * `split-box-unclassified`, class form: a token the fallback placed.
 *
 * @param token - The token.
 * @param node - The node the fallback sent it to.
 * @returns The line.
 */
export function unclassifiedLine(token: string, node: 'frame' | 'content'): string {
    const side = node === 'frame' ? 'inner' : 'outer';
    return runtimeMessage(
        'split-box-unclassified',
        `\`${token}\` is not a utility csszyx knows, so it went to the ${node} node with everything else it could not classify.`,
        `help: if it belongs on the other node, place it there with \`{ ${side}: ['${token}'] }\`; a custom \`@utility\` that sets properties of both nodes has no correct side, so split it into two utilities.`,
    );
}

/**
 * `split-box-unclassified`, raw-css form: the `css` key the fallback placed.
 *
 * @param node - The node the fallback sent it to.
 * @returns The line.
 */
export function unclassifiedCssLine(node: 'frame' | 'content'): string {
    const side = node === 'frame' ? 'inner' : 'outer';
    return runtimeMessage(
        'split-box-unclassified',
        `The \`css\` key holds raw CSS \`splitBoxSz\` does not classify, so it went to the ${node} node with everything else it could not classify.`,
        `help: if its declarations belong on the other node, place it yourself with \`{ ${side}: ['css'] }\`.`,
    );
}

/**
 * `split-box-placement-variant`: a placement written with a variant or marker.
 *
 * @param selector - The placement as written.
 * @param side - The option it was given in.
 * @param base - The class name it reduces to.
 * @returns The line.
 */
export function placementVariantLine(selector: string, side: string, base: string): string {
    return runtimeMessage(
        'split-box-placement-variant',
        `A \`splitBox\` placement list names a class by its base, so \`${selector}\` never matches: the variant prefix and the \`!\` or \`-\` marker are stripped before the comparison.`,
        `help: write \`{ ${side}: ['${base}'] }\`; it places every variant of \`${base}\`.`,
    );
}

/**
 * `split-box-peer-on-frame`: a peer class kept on the frame.
 *
 * @param token - The token.
 * @param base - Its base.
 * @param reaching - The variant that reaches the content from the frame.
 * @returns The line.
 */
export function peerOnFrameLine(token: string, base: string, reaching: string): string {
    return runtimeMessage(
        'split-box-peer-on-frame',
        `\`splitBox\` keeps \`${token}\` on the frame although \`${base}\` belongs inside, because a peer rule reaches siblings and the content node is a child of the frame, where it could never match.`,
        `help: target the content from the frame instead: \`${reaching}\`.`,
    );
}

/**
 * `split-box-unbounded-scroll`: a scroller nothing bounds.
 *
 * @param scroller - The scrolling class.
 * @returns The line.
 */
export function unboundedScrollLine(scroller: string): string {
    return runtimeMessage(
        'split-box-unbounded-scroll',
        `\`splitBox\` put \`${scroller}\` on the content node, but nothing bounds the height of either node, so the content grows instead of scrolling.`,
        'help: give the className a height bound such as `h-64`, `max-h-96` or `h-full`, or put `flex flex-col min-h-0` on the frame and `flex-1 min-h-0` on the content.',
    );
}

/** `split-box-unclipped-corners`: a rounded frame that does not clip. */
export const UNCLIPPED_CORNERS_LINE = runtimeMessage(
    'split-box-unclipped-corners',
    'The `splitBox` frame is rounded and the content scrolls, but the frame does not clip, so scrolled content paints over the corners.',
    'help: add `overflow-hidden` to the frame.',
);

/**
 * `split-box-hidden-content`: a hiding class on the content node.
 *
 * @param hidden - The class.
 * @returns The line.
 */
export function hiddenContentLine(hidden: string): string {
    return runtimeMessage(
        'split-box-hidden-content',
        `\`splitBox\` put \`${hidden}\` on the content node, so the frame keeps its background, border and size and stays visible.`,
        "help: pass `{ outer: ['hidden'] }` if the whole box should disappear.",
    );
}

/**
 * `split-box-unknown-category`: a selector name csszyx does not know.
 *
 * @param name - The name.
 * @param hint - The category it likely means, if any.
 * @param property - Whether the name is also a property the qualified form can name.
 * @returns The line.
 */
export function unknownCategoryLine(name: string, hint?: string, property = false): string {
    let help = "help: call `classify('<a class>')` to see the category a class belongs to.";
    if (hint !== undefined) {
        help = property
            ? `help: use the category \`${hint}\`, or \`${hint}:${name}\` to match that property only.`
            : `help: use the category \`${hint}\`.`;
    }
    return runtimeMessage(
        'split-box-unknown-category',
        `\`${name}\` is not a category or class prefix csszyx knows, so it matches nothing.`,
        help,
    );
}

/** The sentence and advice of each `split-box-selector-invalid` form. */
export const SELECTOR_INVALID = {
    array: runtimeMessage(
        'split-box-selector-invalid',
        '`has`, `pick` and `omit` take one selector, so an array matches nothing.',
        'help: pass the selectors one at a time; `splitBox` takes a list in `inner` and `outer`.',
    ),
    empty: runtimeMessage(
        'split-box-selector-invalid',
        'The empty selector `{}` names no category, so it matches nothing.',
        'help: name a category and a value, such as `{ overflow: "hidden" }`.',
    ),
    multi: (categories: readonly string[]): string =>
        runtimeMessage(
            'split-box-selector-invalid',
            `An object selector names one category and value, so \`{ ${categories.join(', ')} }\` can never match a single token.`,
            'help: pass one selector per category.',
        ),
    property: (property: string, selector: string, properties: readonly string[]): string =>
        runtimeMessage(
            'split-box-selector-invalid',
            `\`${property}\` is not a property csszyx tells apart, so \`${selector}\` matches nothing.`,
            `help: use one of \`${properties.join('`, `')}\`; \`classify('<a class>')\` shows the one a class carries.`,
        ),
    szQualified: (selector: string, name: string): string =>
        runtimeMessage(
            'split-box-selector-invalid',
            `\`${selector}\` names a property, and \`hasSz\`, \`pickSz\` and \`omitSz\` match an sz key by category only, so it matches nothing.`,
            `help: pass \`${name}\`.`,
        ),
};
