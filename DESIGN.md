---
name: Vitals (Paseo native surface)
description: Know at a glance whether the machine is coping; when it is not, find the agent, container or process using it in one step.
typography:
  host-title:
    fontSize: "19px"
    fontWeight: 600
    lineHeight: "25px"
  reading:
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "22px"
    fontFeature: "tnum"
  title:
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "21px"
  section:
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "18px"
  label:
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "18px"
  body:
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "19px"
  meta:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "17px"
    fontFeature: "tnum"
  group:
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    fontFeature: "tnum"
  footer-reading:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    fontFeature: "tnum"
  small:
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "15px"
    fontFeature: "tnum"
  chip:
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "16px"
    fontFeature: "tnum"
  button:
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "16px"
    fontFeature: "tnum"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  column: "1px"
  swatch: "2px"
  bar: "4px"
  control: "6px"
  tile: "8px"
  card: "10px"
  pill: "999px"
spacing:
  column-gap: "1px"
  segment-gap: "2px"
  inline: "8px"
  row-gap: "12px"
  card-x: "14px"
  popover-stack: "18px"
  instrument-gap: "20px"
  section: "24px"
  gutter-compact: "16px"
  gutter: "28px"
components:
  card:
    rounded: "{rounded.card}"
  button:
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 11px"
    typography: "{typography.button}"
  button-compact:
    rounded: "{rounded.tile}"
    height: "44px"
    padding: "0 14px"
  icon-button:
    rounded: "{rounded.control}"
    size: "28px"
  icon-button-compact:
    rounded: "{rounded.control}"
    size: "44px"
  count-chip:
    rounded: "{rounded.pill}"
    padding: "1px 6px"
    typography: "{typography.chip}"
  instrument-row:
    padding: "12px 14px"
  instrument-row-narrow:
    padding: "11px 14px"
  history-trace:
    rounded: "{rounded.column}"
    height: "30px"
  history-trace-narrow:
    rounded: "{rounded.column}"
    height: "22px"
  meter:
    rounded: "{rounded.pill}"
    height: "6px"
  meter-footer:
    rounded: "{rounded.pill}"
    height: "5px"
  composition-bar:
    rounded: "{rounded.bar}"
    height: "14px"
  ink-bar:
    rounded: "{rounded.swatch}"
    height: "4px"
    width: "72px"
  swatch:
    rounded: "{rounded.swatch}"
    size: "9px"
  ranked-row:
    padding: "9px 14px"
    typography: "{typography.body}"
  ranked-row-compact:
    padding: "10px 14px"
  process-row:
    padding: "7px 12px"
    typography: "{typography.mono}"
  footer-meters:
    rounded: "{rounded.tile}"
    height: "28px"
    padding: "4px 8px"
    typography: "{typography.footer-reading}"
  history-popover:
    width: "320px"
    padding: "14px"
  pressure-popover:
    width: "360px"
    padding: "14px"
  trace-tooltip:
    rounded: "{rounded.bar}"
    padding: "0 5px"
    typography: "{typography.chip}"
---

# Design System: Vitals

## Overview

**Creative North Star: "The Bedside Monitor"**

Vitals is a patient monitor for the machine, not a wall of cards. One status sentence says whether the host is coping ("Running fine", "RAM is running low", "RAM and disk are almost out"). Under it, one card holds the instrument lines: CPU, RAM and swap each carry five minutes of trace as thin columns, disk is a single bar because it moves slowly. The signature is the memory composition bar, which splits used RAM into agents, Paseo, Docker and everything else. Ranked lists of agents, containers and processes follow, each one a row with a number column and a thin ink bar.

It lives inside Paseo and owns no colour, no font and no chrome. It uses the host's ground, ink and system sans, plus the plugin family's kit: raised cards, tinted count chips, a 97% press and neutral selection. Magnitude and identity are drawn in foreground ink at stepped opacities, so a chart reads the same in light and dark. Amber and red appear only when a resource crosses a threshold.

The density is that of a working instrument. The largest text is the 19px host name, readings are 17px, and everything else is 11–15px. Every number is tabular, so digits change without moving the line.

**Key Characteristics:**

- Host theme tokens only; every derived colour is a token at an alpha through `client/theme.ts` and `ink()` in `client/charts.tsx`.
- Healthy values are ink. Amber and red mark a crossed threshold, judged on the shown, rounded number.
- Charts are Views: history columns, meters, the composition bar, ink bars. There is no SVG and no line chart.
- One instrument order everywhere: CPU, RAM, Swap (only when the host has swap), Disk.
- Every figure says what it counts; numbers are tabular, and process names are set in mono.

## Colors

The palette is the host's. Vitals owns no hex values, so the frontmatter carries no colour tokens. Use only `surface0`, `surface1`, `surface2`, `border`, `foreground`, `foregroundMuted`, `statusWarning` and `statusDanger`, through `withAlpha`, `tint` (12% light / 16% dark), `raised`, `isLight` and `ink(strength)`. `ink(strength)` is `foreground` at that alpha, multiplied by 1.1 on light grounds.

### Primary

- **No accent.** Vitals has no primary action. Its buttons ("Open Host vitals", "Try again") are secondary, and accent appears only inside the host's own settings switches. Charts, selection, hover and live state never use the accent.

### Status

- **Amber** (`statusWarning`): a resource at its warning threshold. RAM, swap, disk and CPU turn amber at 90% (swap at 80%). This colours the reading, the meter fill, the history column, the footer icon and number, the pill icon, the status sentence, and the dashboard's collection warnings.
- **Red** (`statusDanger`): RAM, swap and disk at 95%, the critical pill icon (OctagonAlert), and a failed read ("Couldn't read processes…", settings save errors). CPU never turns red: a busy CPU slows agents, but a full RAM or disk kills them.

### Neutral

- **Ground** (`surface0`): the dashboard and agent panel, and card fill.
- **Lifted** (`surface1`): the desktop history popover ground, row and ghost hover, secondary button rest.
- **Pressed** (`surface2`): row press, footer hover and press, secondary button hover and press, the trace tooltip, and an icon button toggled on.
- **Hairline** (`border`): row dividers inside cards, column-head rules, "Show all" dividers, and the Kbd outline.
- **Ink** (`foreground`): titles, values, the status sentence when fine, byte columns (500), and every chart through `ink()`. Steps: history backdrop 0.045, composition track 0.06, empty column and ink-bar track 0.08, meter track 0.10, skeleton 0.07–0.12, process-tree elbow 0.30, healthy column 0.32, ink-bar fill 0.60, latest or hovered column 0.72, healthy meter 0.78. The composition segments are agents 0.82, Paseo 0.52, Docker 0.32 and everything else 0.20.
- **Muted Ink** (`foregroundMuted`): meta, small footnotes, column heads, group labels, idle footer icons, and icon-button glyphs.

### Named Rules

**The Quiet When Fine Rule.** A healthy value is ink, never green. Colour is reserved for a resource that is actually short.

**The One Number One Colour Rule.** Levels are judged on the shown whole percent (`shownPercent`: 99.6% shows as 99%, and only full shows as 100%). So a displayed "95%" is red on every surface, never amber on one.

**The Ink Magnitude Rule.** Size and identity are foreground at stepped strength, strongest for agents (the plugin's subject). No series gets its own hue.

## Typography

**Body Font:** the host's system sans (no family set)
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` at 12px, for process names only (Largest processes, the agent panel's tree)

**Character:** One system face over a narrow range. Hierarchy comes from weight (400 / 500 / 600) and ink strength. Every number is tabular.

### Hierarchy

- **Host title** (600, 19px, 25px): the hostname at the top of the dashboard.
- **Reading** (600, 17px, 22px, tabular): an instrument's value at wide width and an agent-panel trace value. It drops to 13px / 18px on narrow instruments.
- **Title** (600, 15px, 21px): the popover hostname, the pressure headline in its level colour, the agent-panel title.
- **Section** (600, 14px): dashboard section titles (Memory in use, Agents, Containers, Largest processes), followed by a count chip.
- **Label** (600, 13px, 18px): instrument names, legend byte values, pressure resource names.
- **Body** (400, 13px, 19px): ranked-row titles at 500, consumer names, error lines.
- **Meta** (400, 12px, 17px, tabular, muted): instrument details, section meta, the status line, CPU columns, and byte columns (foreground, 500).
- **Group** (600, 12px, 16px, muted): "Processes" and "Using the most RAM". These are sentence-case labels for what follows.
- **Small** (400, 11px, 15px, tabular, muted): row sub-lines, column heads (CPU, Memory), updated time, and one-line footnotes that say what a figure counts.
- **Footer reading** (400, 12px, 16px, tabular): footer percentages in a fixed 32px right-aligned box.

### Named Rules

**The Fixed Digit Rule.** Every changing number is tabular and sits in a fixed-width right-aligned column (32px footer, 44/56px CPU, 64px memory, 64px wide reading), so ticking values never shift the line.

**The Mono Is For Process Names Rule.** Mono marks a kernel process name. Agent titles, container names and hosts stay in the sans.

## Layout

- **Dashboard:** a centred column at most 980px wide, with 28px sides and 24px top (16 / 16 compact). Sections are 24px apart. The header, instrument card and trace note stack at 14px.
- **Width modes, from the screen's own width:** compact below 640px (or the host's `layout.compact`), wide from 760px. Wide instruments put the label and detail in a 230px column, the trace in `flex 1` and the value at the right, with 20px gaps. Otherwise the label, detail and value share the top line and the trace sits 3px below.
- **Ranked rows:** 14px sides and 9px vertical (10 compact), with 12px gaps across title | CPU (56 / 44px) | ink bar (72px) | memory (64px) | accessory (28 / 44px). In compact the ink bar is dropped and titles wrap to two lines, sub-lines to three. Rows without an accessory reserve its slot so the columns line up. At most 8 rows show before "Show all N".
- **Composition legend:** four columns at 25%, or two at 50% compact, with a 9px swatch, label in meta and value in label, and 10px row gaps.
- **History popover:** 320px on `surface1`, 14px padding, 18px stack. On phones the sheet is the surface (4px sides, no inner card).
- **Pressure popover:** 360px with 14px padding. The body scrolls inside 300px and the "Open Host vitals" button stays pinned below.
- **Agent panel:** 20px padding (16 compact), 18px stack. The two traces sit side by side at a 20px gap, stacked at 14px in compact. Process rows are 7 × 12px, indented 12px per depth level up to 6.
- **Footer meters:** a full-width row, 28px tall, with 4 × 8px padding and 10px between readings. Meters show from 236px wide; below 150px disk is dropped and only CPU and RAM remain.

The rhythm is 1–3px inside charts, 7–12px inside rows, 14–18px between blocks, and 24–28px at section and gutter scale.

## Elevation & Depth

Mostly tonal: `surface0` → `surface1` → `surface2`, plus the family's `raised` ring on cards and secondary buttons. Charts are flat. Popovers and sheets belong to the host.

### Shadow Vocabulary

- **Raised, light** (`box-shadow: 0px 0px 0px 1px rgba(0,0,0,0.07), 0px 1px 2px -1px rgba(0,0,0,0.06), 0px 2px 6px 0px rgba(0,0,0,0.04)`): cards and secondary buttons on light grounds.
- **Raised, dark** (`box-shadow: 0px 0px 0px 1px rgba(255,255,255,0.08)`): the same on dark grounds.

### Named Rules

**The One Card Per Group Rule.** Each group of rows sits inside one raised card and divides with `border` hairlines. Rows are flat, with hover `surface1` and press `surface2`.

## Shapes

Soft rectangles at a few steps:

- 10px for cards.
- 8px for the footer hit area and compact buttons.
- 6px for buttons and icon buttons.
- 4px for the composition bar, the trace tooltip, skeletons and Kbd keys.
- 2px for swatches and ink-bar ends.
- 1px top corners on history columns.

Meters are fully rounded (radius = height / 2) and keep a 2px sliver above zero. Count chips are pills. The agent panel's tree elbow is an 8px L with a 2px corner at 30% ink.

## Components

### Instrument line (signature)

One per resource, in the order CPU, RAM, Swap, Disk. Each has a label, a meta detail ("8 cores · load 2.61", "20 GiB of 32 GiB · 12 GiB free") and the value at the right in ink, or in the level hue past a threshold. CPU, RAM and swap draw a **history trace**, and disk draws a **meter** sitting at the trace's baseline. Swap colours only while RAM is at 85% or more, because a full swap with free RAM is normal on Linux.

### History trace

60 equal columns 1px apart, oldest at the left. A young history grows in from the right instead of stretching. Each slot has a faint full-height backdrop (ink 0.045) so low readings still sit inside a box. A healthy column is ink 0.32 and the latest column is 0.72. A column past a threshold takes its level hue, and an empty slot shows a 1px stub. Height is 30px wide and 22px narrow; the agent panel uses 26px with up to 36 slots. On the web, hovering a column shows a tooltip at the top-left (`surface2`, 4px corners, 11px tabular text) with its time and value.

### Meter

A 6px track (5px in the footer) at ink 0.10 with the used share filled at ink 0.78, or amber or red past a threshold. It carries the `progressbar` role and value.

### Composition bar (signature)

A 14px track as wide as all RAM (ink 0.06, 4px corners, clipped), holding segments for agents, Paseo, Docker and everything else in descending ink strength, with 2px gaps. Its legend sits underneath. A small footnote says how much file cache was left out, and when shared pages made the parts overflow, that they were scaled to fit.

### Ranked rows

Used for Agents, Containers and Largest processes. Each row has a title (body 500) with a small sub-line, a CPU column, a 72 × 4px **ink bar** relative to the largest row (track 0.08, fill 0.60), and bytes in foreground 500. Column heads (CPU, Memory) sit in small type over a hairline. Agent rows open the agent and carry a 28px ListTree icon button for the process panel. A stopped container is the same row at 60% opacity with dashes.

### Buttons

- **Secondary** (the only kind Vitals uses): `surface1` with the raised ring, `surface2` on hover and press, 32px with 6px corners (44px with 8px corners compact), 14px icon, 500 text. It grows to full width on phones.
- **Icon button:** 28px (44px compact), with a muted 15px glyph, `surface1` hover and `surface2` press. Used for Refresh, Open Host vitals and Processes.
- **Disabled:** 45% opacity (40% for icon buttons). Refresh is disabled while a fetch is in flight.

### Chips

- **Count chip:** a muted hue at its tint, 11px 600 tabular, 6 × 1px padding, pill-shaped, placed after a section title.

### Footer meters

Three readings (CPU, RAM, Disk). Each has a 14px Lucide icon, a 5px meter when there is room, and a fixed 32px percentage. Icons are muted when fine, and the icon and number take the level hue when not. The whole row is one button (8px corners, `surface2` hover) that opens the history popover. It renders nothing until the first sample arrives.

### History popover

Shows the hostname title, a meta line led by the pressure sentence in its hue (only when not fine), and then the four instruments in narrow form. Below them: "Last five minutes, every five seconds." and a secondary "Open Host vitals".

### Pressure pill

Appears on every open composer, only while RAM, swap or disk is at a warning level or above. It shows a TriangleAlert icon in amber (OctagonAlert in red) and a label such as "RAM 94%" or "RAM 94% · Disk 91%". The popover has:

- the headline in the level hue;
- each short resource with a label, its percentage and a meter;
- one plain consequence line;
- "Using the most RAM" with the top three consumers on 56px ink bars;
- a pinned "Open Host vitals".

### Agent panel

The agent title, a meta line ("6 processes · 9% of RAM in use") and an icon button to the dashboard. Below are two traces: Memory against 125% of its own peak, and CPU. Then comes the process tree in a card, with mono names, small PIDs, elbows per depth, CPU, and a 60px ink bar with bytes.

### Motion

Motion uses one ease, `cubic-bezier(0.16, 1, 0.3, 1)`, and animates only opacity and transform. None of it runs under reduced motion.

- PressScale eases to 0.97 in 140ms.
- Reveal rises 6px over 280ms when the snapshot sections first arrive.
- Skeleton bars breathe from 55% to 100% on an 800ms ease-in-out loop.

Charts update in place and are never animated.

## Do's and Don'ts

### Do:

- **Do** use only host theme tokens, and alphas derived from them through `client/theme.ts` and `ink()`.
- **Do** keep healthy values in ink. Use amber at 90% and red at 95% for RAM, swap and disk; CPU turns amber at 90% and never red.
- **Do** judge a level on the shown, rounded percent, through `levelOf` and `shownPercent` in `shared/pressure.ts`, on every surface.
- **Do** draw magnitude as foreground ink at stepped strength, strongest for agents.
- **Do** keep the instrument order CPU, RAM, Swap, Disk, and drop swap where the host has none.
- **Do** set every changing number tabular, in a fixed-width right-aligned column.
- **Do** pair pressure with who is using it: the pill and its popover name the top consumers.
- **Do** say what each figure counts in one small footnote (RSS, cache left out, scaled parts).
- **Do** drop ink bars and wrap titles at compact widths rather than truncating.
- **Do** honour reduced motion in every animation.

### Don't:

- **Don't** colour a healthy value, and never use green or the accent for "fine".
- **Don't** give a series, segment or resource its own hue.
- **Don't** let one displayed figure wear two colours on different surfaces.
- **Don't** turn CPU red.
- **Don't** build the dashboard as same-size stat cards; the instruments share one card as lines.
- **Don't** introduce a font family, or use mono for agent, container or host names.
