import { h } from "vue";
import { withBase } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "./custom.css";

export default {
  extends: DefaultTheme,
  // Make the hero preview clickable — open the full-size screenshot in a new tab.
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "home-hero-image": () =>
        h(
          "a",
          {
            href: withBase("/demo.png"),
            target: "_blank",
            rel: "noopener",
            "aria-label": "Open the full-size preview",
          },
          [
            h("img", {
              class: "VPImage image-src",
              src: withBase("/demo.png"),
              alt: "scratch viewer",
            }),
          ],
        ),
    });
  },
};
