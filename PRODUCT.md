# Vitals

<!-- impeccable:product-schema 1 -->

> Written during the November 2026 UI polish pass without a live interview. Facts come from the
> README, AGENTS.md, the code and the owner's written brief; lines marked _(inferred)_ are
> assumptions to confirm.

## Platform

adaptive

## Users

Developers who run many Paseo agents on one Linux machine, often a cloud VM shared with Docker
services, and need to know whether the machine is coping and which agent or container is eating it.
_(inferred)_ They glance at it while working, and open it in earnest when the machine feels slow or
an agent died.

## Product Purpose

Answer "how is this machine doing, and who is using it?" at a glance: host CPU, load, RAM, swap
and disk, how much of that is the Paseo daemon and plugins versus each agent's process tree, Docker
containers, and the largest processes. Success is a person who notices pressure before agents get
killed, and finds the agent or container responsible in one click.

## Positioning

Unlike generic host meters (host-monitor), Vitals attributes memory and CPU to Paseo agents by
their process trees, and shows Docker next to them. _(inferred)_

## Operating Context

- Entry points: the **Host vitals** sidebar row and screen, ⌘K, live meters in the sidebar footer
  with a history popover, a **Vitals** agent panel for one agent's processes, a composer pill that
  appears only while RAM or disk is running out, and the agent tool `vitals_host_snapshot`.
- Reads Linux `/proc` directly and runs `docker stats` at most once per dashboard refresh. Other
  platforms get host totals without per-process detail.
- Desktop and web first _(inferred)_; phones get the same screen in one column and sheets.

## Capabilities and Constraints

- Never returns command lines or environment values; from each process only `PASEO_AGENT_ID` is
  read, to attribute it.
- Refresh cost stays bounded: the light meter sampler reads two small files every 5 s only while
  someone is watching; the full snapshot (all of /proc plus Docker) runs only while the dashboard
  or a popover that needs it is open, cached 3 s.
- Monitoring only: Vitals never kills or changes processes. _(decision of this pass)_
- Paseo ≥ 0.14, host theme tokens only, no runtime dependencies.

## Brand Commitments

Part of Tom Gringauz's Paseo plugin family (Follow-up, Defer, Smart Session, Transcript Search,
Transfer, …): native to Paseo, host theme tokens only, the shared slate icon tile, plain short copy,
accent green only for primary actions and switches.

## Evidence on Hand

Real /proc data from the developer VM (not usable in media), an isolated harness daemon with demo
agents, and a fixture mode for synthetic host data. Registry installs: 16 at the time of this pass.

## Product Principles

1. Quiet when fine, loud only when the machine is actually short of something.
2. Every number says what it counts; overlapping figures (RSS, cache) say so once, briefly.
3. Attribute before you alarm: pressure always comes with who is using it.
4. Cheap to leave open: no new heavy polling, nothing runs when nobody is looking.
