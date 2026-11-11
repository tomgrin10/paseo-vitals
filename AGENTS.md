# Repository instructions

## Project

- This is the trusted, unsandboxed Paseo plugin `paseo-vitals`.
- Keep `paseo-plugin.json`, `package.json`, the README compatibility badge, and install commands aligned.
- Read the current plugin docs at <https://paseo.sh/docs/plugins> and <https://paseo.sh/docs/plugins/reference> before changing runtime code.

## Code boundaries

- `index.client.tsx` and `index.server.ts` wire contributions and RPC handlers.
- `client/` is React Native UI, `server/` owns Linux `/proc` and Docker collection, and `shared/` contains cross-runtime contracts.
- The meters (footer, pill, popover) share one `client/live.ts` store per installation. On Paseo 0.16 (`client.subscribe` exists) it subscribes to `vitals.pulse-stream`. The daemon pushes a reading at once and one per 5 s sample. Watched means subscribed, and the last release ends it. A refused stream falls back to the 5 s `vitals.pulse` reads; a dropped one polls while it waits to subscribe again. 0.15 always reads.
- `server/pulse.ts` samples only while someone looks: a subscriber, or an RPC read in the last minute. It never idles out under a subscriber and stops as soon as the last one leaves. The stream contract is a plain `{ name, input, event }` object, because 0.14/0.15 have no `defineSubscription`.
- Treat process environment and command lines as sensitive. Return only the fields the UI needs.
- Paseo supplies SDK, React, React Native, TanStack Query, and Zod at runtime. Keep those packages in `devDependencies`.
- Never commit credentials, daemon state, logs, or local paths.

## Verification and release

- Run `npm ci`, `npm run verify`, and `npm pack --dry-run` after changes.
- Do not restart the Paseo daemon. Use `paseo plugin reload vitals` (the plugin id) for an installed development copy.
- Publish only from a clean `main`, after confirming the packed file list and auditing it for secrets.
- Releases need Tom's manual permission. Features and fixes ship as betas (`X.Y.Z-beta.N`, npm `beta` tag) by default. A stable version, npm `latest`, or a hotfix needs Tom's explicit OK for that exact version before it is tagged; never infer it from a plan.
- **Betas.** Bump `package.json` and its lockfile to `X.Y.Z-beta.N` and tag `vX.Y.Z-beta.N`. `publish-npm.yml` publishes any version containing `-` with `--tag beta` (`scripts/check-dist-tag.mjs`), then verifies after publishing, on the retry path too, that the expected dist-tag points at the version and that a prerelease is never `latest`. Mark the GitHub release as a prerelease (`gh release create vX.Y.Z-beta.N --prerelease --latest=false`). Install with `paseo plugin update vitals --version X.Y.Z-beta.N` (the plugin id, not the package name). `release-channel.test.mjs` guards the publish command and the post-publish check.
- `.github/workflows/verify.yml` runs `npm run verify` and `npm pack --dry-run` on every push and pull request.
- Tag the exact release commit as `vX.Y.Z` (or `vX.Y.Z-beta.N`) and push the tag. `.github/workflows/publish-npm.yml` verifies that the tag matches `package.json`, reruns the release checks, inspects the package, and publishes through npm Trusted Publishing. Do not run `npm publish` manually except to recover from a diagnosed workflow failure.
- Wait for the publish workflow and npm registry propagation before creating the GitHub release and updating an installed copy. Never move a published tag.

## Automated publishing recovery

The npm release workflow supports `workflow_dispatch` with an existing `tag` for recovery without rewriting tags. It checks that the checked-out tag is on `main` and matches package versions. Use Node 24 and npm 11.20.0 with GitHub OIDC; do not set `registry-url` on setup-node or configure token-placeholder authentication. Retrying an already-published package requires its registry integrity to match the packed snapshot. A new publish is verified against the registry before downstream release steps continue.

## Release notes

Every GitHub release, betas included, shows real notes in one shape across Tom's plugins. `scripts/release-notes.mjs`
(identical in each repo; keep the copies in sync) builds the body and the publish workflow creates the release with it:

```
<summary or "## What's new in X.Y.Z-beta.N">

### New        what a user can now do
### Improved   what got better
### Fixed      what stopped going wrong

## Install     the command for that channel, the Paseo minimum
```

- **Betas** are generated: the titles of the PRs merged since the previous tag, grouped by their prefix (`feat` is New,
  `fix` is Fixed, anything else user-visible is Improved). `docs`, `chore`, `ci`, `test`, `refactor` and `build`
  PRs, bots, merge lines and raw commit text never appear. So write PR titles as a sentence a user can read:
  `fix: remember which Follow-up plugin id answered`. No PR numbers, no em dashes.
- **Stable and rc** are curated: add `release-notes/<version>.md` (an rc uses its final version's file) before tagging. One
  summary sentence, then `### New`, `### Improved`, `### Fixed` with plain-words bullets for the person using the plugin,
  grouped by what they get and merged across every beta since the last stable. Omit empty groups. The publish workflow
  runs `node scripts/release-notes.mjs --check <tag>` first and fails a stable or rc tag that has no file, before anything
  is published.
- Releases that already exist: edit the body with `gh release edit <tag> --notes-file <file>`. Never touch the tag, assets
  or the prerelease/latest flags. In-app What's new popups stay major-only; this is GitHub only.
- `node --test scripts/release-notes.test.mjs` covers the generator and runs in `verify`.
