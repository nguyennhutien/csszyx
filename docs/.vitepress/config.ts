/**
 * VitePress configuration for csszyx documentation.
 *
 * @see https://vitepress.dev/reference/site-config
 */

import { defineConfig } from "vitepress";

export default defineConfig({
  title: "csszyx",
  description: "CSS-in-JS with Tailwind object syntax",

  head: [["link", { rel: "icon", href: "/favicon.ico" }]],

  themeConfig: {
    logo: "/logo.svg",

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/compiler" },
      { text: "Examples", link: "/examples/vite-react" },
      { text: "Config", link: "/config/overview" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "What is csszyx?", link: "/guide/what-is-csszyx" },
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Installation", link: "/guide/installation" },
          ],
        },
        {
          text: "Core Concepts",
          items: [
            { text: "Object Syntax", link: "/guide/object-syntax" },
            { text: "Runtime Helpers", link: "/guide/runtime-helpers" },
            { text: "Build Pipeline", link: "/guide/build-pipeline" },
            { text: "SSR Safety", link: "/guide/ssr-safety" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API Reference",
          items: [
            { text: "Compiler", link: "/api/compiler" },
            { text: "Runtime", link: "/api/runtime" },
            { text: "Types", link: "/api/types" },
          ],
        },
      ],
      "/examples/": [
        {
          text: "Examples",
          items: [
            { text: "Vite + React", link: "/examples/vite-react" },
            { text: "Next.js", link: "/examples/nextjs" },
          ],
        },
      ],
      "/config/": [
        {
          text: "Configuration",
          items: [
            { text: "Overview", link: "/config/overview" },
            { text: "Development", link: "/config/development" },
            { text: "Production", link: "/config/production" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/nguyennhutien/csszyx" },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2024-present csszyx contributors",
    },

    search: {
      provider: "local",
    },
  },
});
