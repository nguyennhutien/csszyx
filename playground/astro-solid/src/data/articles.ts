export interface Article {
    id: string;
    title: string;
    category: string;
    summary: string;
    minutes: number;
    featured?: boolean;
}

export const articles: Article[] = [
    {
        id: 'solid-islands',
        title: 'Solid islands keep the homepage interactive without a full SPA',
        category: 'Frontend',
        summary: 'Astro renders the shell while Solid hydrates only the search and ticker controls.',
        minutes: 4,
        featured: true,
    },
    {
        id: 'rust-parser',
        title: 'CSSzyx 0.9 ships the native parser as the default transform path',
        category: 'Release',
        summary: 'The news layout uses static sz objects so the generated page has no styling runtime.',
        minutes: 3,
    },
    {
        id: 'astro-content',
        title: 'Content collections can stay server-first for editorial workflows',
        category: 'CMS',
        summary: 'The production app can move article data to Astro content once the UI contract is proven.',
        minutes: 5,
    },
];
