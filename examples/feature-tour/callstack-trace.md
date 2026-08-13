# Call stacks

A fenced code block tagged `callstack` renders a hand-drawn **call tree** with colored annotations — for when the *path* through the code is the point. Mermaid draws the shape of a system; a call stack draws one walk through it.

Here is the real path behind the page you are reading — what `scratch export` does:

```callstack
cmdExport(args, io)                                src/commands.ts
├─ resolveRoot(args.dir)                           → root: --dir > $SCRATCH_DIR > cwd
├─ selectPads(args, root, io)                      → the pad(s) to bake
├─ buildView(sel.pads)
│  └─ scanPadFiles(pad, metas)                     ← reads every file concurrently
│     ├─ classify(ext)                             → markdown | code | image | binary
│     └─ embedInlineAssets(content, dir)           ← bakes ![](diagram.html) embeds in
├─ renderHtml(view, label, ui, { exportMode })
│  ├─ payloadJson(view, rootLabel)                 → the embedded data island
│  └─ bundleNeeds(view)                            → which vendor libs the page loads
└─ Bun.write(outPath, html)                        → one self-contained .html
```

## Annotations

A note after `←` colors by its first character: `+` added (green), `-` removed (red), `~` changed (amber), none = neutral. That makes the block a natural way to show **what a change did** along a path — here, the recent GFM-alerts feature traced through the markdown renderer:

```callstack
renderMarkdown(src)
└─ renderBlocks(lines, base)
   ├─ fence run                                    → <pre><code> · mermaid · callstack
   ├─ blockquote run                               ← ~now sniffs [!NOTE|TIP|…] first line
   │  ├─ alertIcon(type)                           ← +octicon title row, colored per type
   │  └─ renderBlocks(body, base + start + 1)      ← recursion keeps checkboxes writable
   └─ mdInline(text)                               → links, code spans, emphasis, math
```

No syntax to learn beyond the tree characters — you draw it, the viewer colors it.
