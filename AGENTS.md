# Repository Guidelines (compact)

Keep this file short; it may be injected into prompts.

- Repo: https://github.com/openclaw/openclaw
- Runtime baseline: Node 22+; package manager: `pnpm` (Bun supported).
- Key commands: `pnpm install`, `pnpm build`, `pnpm check`, `pnpm test`.

## Structure

- Source: `src/`
- Extensions/plugins: `extensions/*` (keep plugin-only deps inside the extension).
- Docs: `docs/` (Mintlify at https://docs.openclaw.ai)

## Extensions deps

- Runtime deps must live in the extension's `dependencies`.
- Avoid `workspace:*` in extension `dependencies` (npm install breaks).
- Put `openclaw` in `peerDependencies` or `devDependencies` for extensions.

## Docs links

- In `docs/**`: internal links are root-relative, no `.md`.
- For GitHub/README or when asked for links: use full `https://docs.openclaw.ai/...` URLs.

## Safety

- Don’t commit secrets or private tokens.
- Ask before destructive commands or external actions.
