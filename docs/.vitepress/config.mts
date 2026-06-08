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
  themeConfig: {
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
