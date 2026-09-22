# paseo-vitals

[![Paseo](https://img.shields.io/badge/Paseo-%E2%89%A5%200.8.0-8A63D2?style=for-the-badge)](https://paseo.sh)
[![npm downloads](https://img.shields.io/npm/dm/paseo-vitals?style=for-the-badge&color=cb3837)](https://www.npmjs.com/package/paseo-vitals)
[![License](https://img.shields.io/github/license/tomgrin10/paseo-vitals?style=for-the-badge&color=2563eb)](LICENSE)

A small Paseo sidebar dashboard for answering one question: how is this development VM doing?

It shows:

- host CPU, load, uptime, RAM detail, swap, and root-disk usage;
- Paseo daemon/plugin RSS separately from agent process trees;
- per-agent RSS, CPU, process count, provider, and status;
- Docker container CPU, cgroup memory, state, PIDs, network I/O, and block I/O;
- the host's largest processes by RSS.

The plugin reads Linux `/proc` directly and invokes `docker stats` at most once per cached refresh.
It reads only the `PASEO_AGENT_ID` environment entry needed to attribute a process tree; command
lines and other process environment values are never returned to the client.

## Install

Install from npm on Paseo 0.9.0 or newer:

```sh
paseo plugin install npm:paseo-vitals@0.1.0
```

Paseo 0.8 can install the same plugin from Git:

```sh
paseo plugin add tomgrin10/paseo-vitals --ref v0.1.0
```

For local development:

```sh
npm ci
npm run verify
paseo plugin install "$PWD"
```

Open **Host vitals** from Paseo's sidebar. The dashboard refreshes every five seconds while mounted.
Docker failure is non-fatal, and process-level detail degrades gracefully on non-Linux hosts.
