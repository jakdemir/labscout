# Labscout — Design

**World: the card catalog.** Source: the user's reference mock (spinout watchlist). Ranked students are index cards in a drawer; each card's tab shows `ID · Name · Score`. The open card has a heavy name, a dark score panel with a big score, a momentum line and a yellow REACH OUT button, and a 4-cell stage meter of filled squares. Light grey paper, ink outlines, one yellow highlighter. This brief overrides generic craft defaults (mono labels, the big-score panel and the momentum line are the user's chosen world).

## Tokens (public/assets/labscout.css)
| Token | Value | Use |
|---|---|---|
| `--paper` | `#E3E3DE` | page |
| `--sheet` | `#F4F4EF` | cards |
| `--ink` | `#111111` | text, 1.5px outlines, active pills/tabs |
| `--ink-2` / `--ink-3` | `#3A3A36` / `#5E5E58` | secondary / meta |
| `--dark` | `#121212` | score panel, code, emphasized meter |
| `--on-dark` / `--on-dark-2` | `#F4F4EF` / `#B9B9B2` | text on dark |
| `--hi` | `#F2E96B` | yellow highlighter: primary CTA, drawer label, `<em>` highlight, focus halo |
| `--ok` | `#1F6B45` | live / verified current student only |
| `--bw` | `1.5px` | every outline |

Type: **Inter Tight 700** tight (-0.045em) for names, headlines, scores · **JetBrains Mono** for labels (uppercase, +0.12em), tabs, pills, data, buttons · Inter Tight 400 for body. Radius 8–10px cards, 999px filter pills, 4px tags.

## Components
`.ls-tab` filter-pill tabs (active = black) · `.ftab` index-card tab (`ID  Name  Score`, selected = black) · `.panel-dark` + `.score-xl` · `.btn.hi` yellow REACH OUT · `.meters/.meter/.sq(.on)` 4-stage meter, last cell `.dark` (spinout intent ×weight) · `.tag-hi` yellow label · `.drawer` + `.handle` · `.label` mono caps · `.chip` mono outline pill.

## Cabinet behavior
- Selecting a tab lifts that card above the cabinet. Its tab keeps its horizontal position.
- The card's slot stays empty. Every other card keeps its place; the page scroll holds the cabinet still.
- Motion: one FLIP glide (.55s, `--ease`); off under `prefers-reduced-motion`.

## Rules
- Outlines are 1.5px ink. No soft grey cards, no gradients, no emoji icons (LS.icon).
- Yellow only for the one primary action per view, the drawer label and highlights.
- Green only means live/verified.
- Every number links to or explains its source.
