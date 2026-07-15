type HighlightPrefix = '' | 'ho-';

interface TokenRule {
    pattern: RegExp;
    render: (match: RegExpExecArray, prefix: HighlightPrefix) => string;
}

const TOKEN_RULES: TokenRule[] = [
    {
        pattern: /^"[^"]*"/,
        render: (match, prefix) => `<span class="${prefix}string">${match[0]}</span>`,
    },
    {
        pattern: /^'[^']*'/,
        render: (match, prefix) => `<span class="${prefix}string">${match[0]}</span>`,
    },
    {
        pattern: /^[a-zA-Z0-9_]+(?=\s*:)/,
        render: (match, prefix) => `<span class="${prefix}key">${match[0]}</span>`,
    },
    {
        pattern: /^(:\s*)(true|false)/,
        render: (match, prefix) =>
            `${match[1]}<span class="${prefix}boolean">${match[2]}</span>`,
    },
    {
        pattern: /^(:\s*)([-0-9.]+)/,
        render: (match, prefix) =>
            `${match[1]}<span class="${prefix}number">${match[2]}</span>`,
    },
    {
        pattern: /^[{}[\],:]/,
        render: (match, prefix) =>
            prefix
                ? `<span class="${prefix}symbol">${match[0]}</span>`
                : `<span style="color:light-dark(#94a3b8,#475569)">${match[0]}</span>`,
    },
];

/**
 * Render sz object source with syntax-highlight span markup.
 * @param text - Partial or complete sz object source.
 * @param classPrefix - Optional animated-hero class prefix.
 * @returns Highlighted HTML string.
 */
export function highlightSzTokens(text: string, classPrefix: HighlightPrefix): string {
    let highlighted = '';
    let index = 0;
    while (index < text.length) {
        const source = text.slice(index);
        const rule = TOKEN_RULES.find(candidate => candidate.pattern.test(source));
        if (!rule) {
            highlighted += text[index];
            index++;
            continue;
        }

        const match = rule.pattern.exec(source);
        if (!match) continue;
        highlighted += rule.render(match, classPrefix);
        index += match[0].length;
    }
    return highlighted;
}
