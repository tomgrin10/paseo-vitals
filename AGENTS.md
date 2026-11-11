# Repository instructions

## Project

- This is the trusted, unsandboxed Paseo plugin `paseo-vitals`.
- Keep `paseo-plugin.json`, `package.json`, the README compatibility badge, and install commands aligned.
- Read the current plugin docs at <https://paseo.sh/docs/plugins> and <https://paseo.sh/docs/plugins/reference> before changing runtime code.

## Code boundaries

- `index.client.tsx` and `index.server.ts` wire contributions and RPC handlers.
- `client/` is React Native UI, `server/` owns Linux `/proc` and Docker collection, and `shared/` contains cross-runtime contracts.
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
