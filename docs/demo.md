---
title: Demo
sidebar: false
aside: false
layout: page
---

<script setup>
import { watch, onMounted } from "vue";
import { withBase, useData } from "vitepress";

// The exported viewer boots its theme from localStorage (same origin as the
// docs site), so mirror VitePress's light/dark into it: seed the key BEFORE
// the iframe loads, then just write it on toggle — the viewer listens for the
// same-origin storage event and switches live, no reload.
const { isDark } = useData();
const sync = (dark) => { try { localStorage.setItem("scratch.themeMode", dark ? "dark" : "light"); } catch {} };
onMounted(() => {
  sync(isDark.value);
  document.getElementById("demoFrame").src = withBase("/demo-pad.html");
});
watch(isDark, sync);
</script>

<p class="demo-caption">
  A live <code>scratch export</code> of a feature-tour pad — every file demonstrates one feature —
  <a href="/scratchpad/demo-pad.html" target="_blank" rel="noopener">open in a new tab ↗</a>
</p>

<iframe
  id="demoFrame"
  class="demo-frame"
  title="scratch viewer — exported demo pad"
></iframe>
