import { defineConfig } from "vitepress";

export default defineConfig({
  title: "scratch",
  description:
    "CLI-first tool to organize temporary agent knowledge into scratchpads — a folder + manifest, with a read-only visual viewer.",
  base: "/scratchpad/",
  cleanUrls: true,
  ignoreDeadLinks: true,
  appearance: "dark",
  // PUBLISHING.md is a maintainer runbook, not a public docs page.
  srcExclude: ["PUBLISHING.md"],
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/scratchpad/logo.svg" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "scratch — a home for temporary agent knowledge" }],
    ["meta", { property: "og:description", content: "Organize session notes, snippets & artifacts into scratchpads — a folder + manifest, with a read-only visual viewer." }],
    ["meta", { property: "og:url", content: "https://nikiforovall.blog/scratchpad/" }],
    ["meta", { property: "og:image", content: "https://nikiforovall.blog/scratchpad/og.png" }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:title", content: "scratch — a home for temporary agent knowledge" }],
    ["meta", { name: "twitter:description", content: "Organize session notes, snippets & artifacts into scratchpads — a folder + manifest, with a read-only visual viewer." }],
    ["meta", { name: "twitter:image", content: "https://nikiforovall.blog/scratchpad/og.png" }],
  ],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide" },
      { text: "Viewer", link: "/viewer" },
      { text: "Integrations", link: "/integrations" },
      { text: "CLI Reference", link: "/cli-reference" },
      { text: "Demo", link: "/demo" },
      { text: "npm", link: "https://www.npmjs.com/package/@nikiforovall/scratchpad" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Overview", link: "/" },
          { text: "User Guide", link: "/guide" },
          { text: "Viewer", link: "/viewer" },
          { text: "Integrations", link: "/integrations" },
          { text: "CLI Reference", link: "/cli-reference" },
          { text: "Demo", link: "/demo" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/nikiforovall/scratchpad" },
    ],
    editLink: {
      pattern: "https://github.com/nikiforovall/scratchpad/edit/main/docs/:path",
    },
    search: { provider: "local" },
  },
});
