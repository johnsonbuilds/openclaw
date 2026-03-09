# Tooling Notes

## Fork upstream sync workflow

Use this workflow when syncing this fork with `openclaw/openclaw` upstream.

- Default to merging `upstream/main` into local `main` in one pass after fetching and checking divergence; do not split the sync into staged or batch merges just because upstream is far ahead.
- If conflicts appear, summarize the conflicted files and ask only for policy choices that change local behavior.
- Conflict policy for this fork:
  - GitHub workflows: prefer upstream workflow logic, but keep `workflow_dispatch` on conflicted workflows because this fork primarily uses manual runs and a custom Docker publish flow rather than upstream CI defaults.
  - `Dockerfile`: keep the fork’s wrapper and `entrypoint.sh` runtime/deployment behavior, but absorb upstream build-stage hardening and compatibility fixes where possible.
  - Gateway startup: preserve the local `AGENT_GATEWAY_READY_NOTIFY_URL` ready-ping behavior while keeping the upstream startup/update-check structure.
  - Telegram: preserve the local first-DM-sender auto-allowlist behavior, but port it into the upstream Telegram access-control structure/tests instead of reverting whole upstream files.
  - If upstream deleted a file and the fork does not currently depend on it, accept the upstream deletion.
- After conflict resolution, run targeted validation for touched high-risk areas. For Telegram merge conflicts, run `corepack pnpm vitest run src/telegram/bot.test.ts`.
- Before committing, ensure `git diff --name-only --diff-filter=U` is empty.
- If the merge commit is blocked only because the repo pre-commit hook re-runs `git add` on upstream-tracked paths that are locally ignored, `git commit --no-edit --no-verify` is acceptable only after conflicts are resolved and targeted tests pass.
