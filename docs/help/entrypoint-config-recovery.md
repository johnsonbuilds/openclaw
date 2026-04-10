# Entrypoint config recovery notes

This note records the `entrypoint.sh` change that adds startup-time recovery for invalid persisted OpenClaw configs in the SaaS container flow.

## What changed

The entrypoint now validates the persisted config before the wrapper starts.

### New behavior

- When an existing config is present, the entrypoint validates `OPENCLAW_CONFIG_PATH` before any in-place LLM update.
- If the current config is invalid, the entrypoint checks `${OPENCLAW_CONFIG_PATH}.bak`.
- Recovery happens only when:
  - the current config is invalid, and
  - the `.bak` file exists, and
  - the `.bak` file is valid.
- Before restoring, the invalid current config is copied to a timestamped file:
  - `openclaw.json.invalid.<UTC timestamp>`
- After restore, the entrypoint validates the restored config again.
- If restore validation fails, startup stops.
- If no valid backup exists, startup stops.

### Validation stages

The recovery guard runs at three points:

1. `pre-update`
   - before updating LLM fields on an existing config
2. `post-update`
   - after updating LLM fields on an existing config
3. `post-generate`
   - after generating a new config from env vars

### Log format

The entrypoint now emits recovery logs in a machine-readable style:

- `status=current-invalid`
- `status=backup-missing`
- `status=backup-invalid`
- `status=restored`
- `status=restore-invalid`

These logs are intended to be easy for the SaaS backend or container log pipeline to detect.

## Why this was added

In the SaaS flow, users or bots may accidentally write an invalid `openclaw.json` that prevents startup. OpenClaw itself fails closed on invalid config, which is correct for the core product, but the container entrypoint now adds a product-layer safety net:

- preserve the last known good config when possible
- avoid bringing the whole instance down for a recoverable bad edit
- keep the bad config for debugging

## Runtime assumptions

This recovery uses OpenClaw's own config validation logic via built runtime output under `dist/`. That matches the production container expectation where the image contains built artifacts.

## How to test

### 1. Syntax check

From the repo root:

- run `sh -n entrypoint.sh`

Expected result:

- no output
- exit code `0`

### 2. Happy path with valid existing config

Prepare:

- a valid `openclaw.json`
- a valid `.bak`

Run the container/startup flow with the normal persisted volume.

Expected result:

- startup succeeds
- no recovery log with `status=current-invalid`

### 3. Invalid current config, valid `.bak`

Prepare:

- keep a valid `openclaw.json.bak`
- intentionally break `openclaw.json`, for example by writing an invalid schema key such as top-level `web.brave`

Run startup.

Expected result:

- log contains `status=current-invalid`
- log contains `status=restored`
- a file named like `openclaw.json.invalid.20260410T120000Z` is created
- startup continues successfully

### 4. Invalid current config, missing `.bak`

Prepare:

- invalid `openclaw.json`
- no `.bak`

Run startup.

Expected result:

- log contains `status=current-invalid`
- log contains `status=backup-missing`
- startup fails

### 5. Invalid current config, invalid `.bak`

Prepare:

- invalid `openclaw.json`
- invalid `openclaw.json.bak`

Run startup.

Expected result:

- log contains `status=current-invalid`
- log contains `status=backup-invalid`
- startup fails

### 6. Existing config update path

Prepare:

- persisted valid config
- set `LLM_PROVIDER` to one of `openrouter`, `openai`, `anthropic`, or `custom`
- set the required accompanying env vars

Run startup.

Expected result:

- `pre-update` validation runs before the in-place LLM edit
- `post-update` validation runs after the edit
- startup succeeds with the updated LLM fields

### 7. New config generation path

Prepare:

- remove the persisted config
- provide the required env vars for initial config generation

Run startup.

Expected result:

- config is generated
- `post-generate` validation runs
- startup succeeds

## Operational note

This is a startup-time safety net, not a replacement for controlled config writes. It reduces customer-facing outages from bad edits, but it does not replace upstream validation in your SaaS settings flow.
