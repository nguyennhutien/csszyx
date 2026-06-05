import { createMemo, createSignal, For, Show, splitProps } from 'solid-js';

import type { Article } from '../data/articles';

interface NewsAppProps {
    articles: Article[];
}

interface ArticleCardProps {
    article: Article;
}

export default function NewsApp(props: NewsAppProps) {
    const [query, setQuery] = createSignal('');
    const filteredArticles = createMemo(() => {
        const needle = query().trim().toLowerCase();
        if (!needle) {
            return props.articles;
        }
        return props.articles.filter(article =>
            `${article.title} ${article.category} ${article.summary}`.toLowerCase().includes(needle),
        );
    });

    return (
        <main
            sz={{
                minH: 'screen',
                bg: 'slate-950',
                color: 'slate-100',
                p: 4,
                md: { p: 8 },
            }}
        >
            <section
                sz={{
                    maxW: '6xl',
                    mx: 'auto',
                    display: 'grid',
                    gap: 6,
                }}
            >
                <header sz={{ display: 'grid', gap: 3 }}>
                    <p sz={{ text: 'sm', color: 'emerald-300', fontWeight: 'semibold' }}>
                        CSSzyx x Astro x SolidJS
                    </p>
                    <h1 sz={{ text: '4xl', md: { text: '6xl' }, fontWeight: 'bold' }}>
                        Astro Solid Demo
                    </h1>
                    <p sz={{ maxW: '2xl', color: 'slate-300', lineHeight: 'relaxed' }}>
                        A small platform playground for validating Solid JSX transforms, plugin
                        ordering, and static sz extraction.
                    </p>
                </header>

                <label sz={{ display: 'grid', gap: 2, maxW: 'xl' }}>
                    <span sz={{ text: 'sm', color: 'slate-400' }}>Search headlines</span>
                    <input
                        value={query()}
                        onInput={event => setQuery(event.currentTarget.value)}
                        placeholder="Try Solid, parser, Astro..."
                        sz={{
                            w: 'full',
                            rounded: 'lg',
                            border: true,
                            borderColor: 'slate-700',
                            bg: 'slate-900',
                            px: 4,
                            py: 3,
                            color: 'white',
                            outline: 'none',
                            focus: { borderColor: 'emerald-400' },
                        }}
                    />
                </label>

                <section sz={{ display: 'grid', gap: 4, md: { gridCols: 3 } }}>
                    <For each={filteredArticles()}>
                        {article => <ArticleCard article={article} />}
                    </For>
                </section>

                <Show when={filteredArticles().length === 0}>
                    <p sz={{ color: 'slate-400', border: true, borderColor: 'slate-800', p: 4 }}>
                        No articles matched this query.
                    </p>
                </Show>
            </section>
        </main>
    );
}

function ArticleCard(props: ArticleCardProps) {
    const [local] = splitProps(props, ['article']);
    return (
        <article
            sz={{
                display: 'grid',
                gap: 3,
                rounded: 'xl',
                border: true,
                borderColor: 'slate-800',
                bg: 'slate-900',
                p: 5,
                shadow: 'lg',
            }}
        >
            <div sz={{ display: 'flex', alignItems: 'center', justify: 'between', gap: 3 }}>
                <span sz={{ text: 'xs', color: 'emerald-300', fontWeight: 'semibold' }}>
                    {local.article.category}
                </span>
                <Show when={local.article.featured}>
                    <span sz={{ rounded: 'full', bg: 'emerald-400', color: 'slate-950', px: 2, py: 1, text: 'xs' }}>
                        Featured
                    </span>
                </Show>
            </div>
            <h2 sz={{ text: 'xl', fontWeight: 'bold', lineHeight: 'tight' }}>{local.article.title}</h2>
            <p sz={{ color: 'slate-300', lineHeight: 'relaxed' }}>{local.article.summary}</p>
            <footer sz={{ color: 'slate-500', text: 'sm' }}>{local.article.minutes} min read</footer>
        </article>
    );
}
