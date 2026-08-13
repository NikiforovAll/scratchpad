# Themes & shortcuts

## 17 color themes

Click the sun/moon toggle for dark/light/system, and the settings gear to pick a theme:

`ember` (default) · `gruvbox` · `catppuccin` · `tokyo-night` · `solarized` · `dracula` · `nord` · `rose-pine` · `everforest` · `kanagawa` · `one-dark` · `night-owl` · `monokai` · `github` · `ayu` · `vitesse` · `synthwave`

Every theme has both a dark and a light variant. Your choice **persists across launches** (`~/.config/scratchpad/config.json`) — and an export can pin its appearance for every reader with `--theme` / `--mode`.

## Keyboard shortcuts

Press `?` in the viewer for the full list. Highlights:

| Key | Action |
|-----|--------|
| `↑` / `↓` | next / previous file |
| `j` / `k` / `d` / `u` / `g` / `G` | vim-style scrolling |
| `v` | raw ↔ rendered markdown |
| `o` | table of contents |
| `t` | toggle theme |
| `c` | toggle comments |
| `[` / `]` | toggle sidebar / top bar |
| `Ctrl+S` | save / export a copy (keeps your comments) |
| `Ctrl+Alt+C` | copy this file's comments (JSON) |
| `r` | reload from disk (live viewer) |
| `Ctrl+Tab` | next file, wrapping (native window) |
| `Ctrl` `+` / `−` / `0` | zoom |

## Sidebar niceties

- Files sharing a `--group` are listed together under a header (see this pad's sidebar).
- **Unregistered** files in the pad dir still show up, dimmed — nothing hides from you.
- Entries marked `hidden` stay registered but leave the list (`h` reveals them).
