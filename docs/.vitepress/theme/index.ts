import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import "./custom.css";

// Hero visual: a CSS-animated terminal playing the agent loop —
// create → write → register → browse → feedback. No screenshot to go stale.
const TERMINAL_HTML = `
<div class="term" aria-hidden="true">
  <div class="term-bar">
    <span class="term-dot td-r"></span><span class="term-dot td-y"></span><span class="term-dot td-g"></span>
    <span class="term-title">agent session</span>
  </div>
  <div class="term-body">
    <p class="tl" style="--d:0.3s"><span class="tp">$</span> scratch new "research-auth" --dir _scratchpads</p>
    <p class="tl t-ok" style="--d:0.9s">✓ created _scratchpads/research-auth/</p>
    <p class="tl t-dim" style="--d:1.6s"># agent writes findings.md, snippets, output…</p>
    <p class="tl" style="--d:2.4s"><span class="tp">$</span> scratch add research-auth findings.md --desc "OAuth flow decision"</p>
    <p class="tl t-ok" style="--d:3s">✓ registered "findings.md" in research-auth</p>
    <p class="tl" style="--d:3.7s"><span class="tp">$</span> scratch ui research-auth</p>
    <p class="tl t-view" style="--d:4.3s">▸ viewer opened — markdown · mermaid · inline comments</p>
    <p class="tl t-dim" style="--d:5s"># you review, tick boxes, leave comments…</p>
    <p class="tl" style="--d:5.7s"><span class="tp">$</span> scratch comments research-auth --json<span class="term-cursor"></span></p>
  </div>
</div>`;

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "home-hero-image": () => h("div", { class: "hero-terminal", innerHTML: TERMINAL_HTML }),
    });
  },
};
