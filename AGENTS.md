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
- Do not restart the Paseo daemon. Use `paseo plugin reload paseo-vitals` for an installed development copy.
- Publish only from a clean `main`, after confirming the packed file list and auditing it for secrets.
- Tag the exact release commit as `vX.Y.Z` and push the tag. `.github/workflows/publish-npm.yml` verifies that the tag matches `package.json`, reruns the release checks, inspects the package, and publishes through npm Trusted Publishing. Do not run `npm publish` manually except to recover from a diagnosed workflow failure.
- Wait for the publish workflow and npm registry propagation before creating the GitHub release and updating an installed copy. Never move a published tag.

## Automated publishing recovery

The npm release workflow supports `workflow_dispatch` with an existing `tag` for recovery without rewriting tags. It checks that the checked-out tag is on `main` and matches package versions. Use Node 24 and npm 11.20.0 with GitHub OIDC; do not set `registry-url` on setup-node or configure token-placeholder authentication. Retrying an already-published package requires its registry integrity to match the packed snapshot. A new publish is verified against the registry before downstream release steps continue.
