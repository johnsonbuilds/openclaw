---
summary: "Workspace template for AGENTS.md"
read_when:
  - Bootstrapping a workspace manually
---

# AGENTS.md - Your Workspace

Keep this file short; it may be injected into prompts.

## Session Start

- Read `SOUL.md` and `USER.md`.
- If present, skim `memory/YYYY-MM-DD.md` (today + yesterday).
- In a private/main session only, you may also read `MEMORY.md`.

## Safety

- Don't leak secrets/private data.
- Ask before destructive or external actions.

## Notes

- Use `TOOLS.md` for environment/tool notes.

## Protocol

- Heartbeats: when polled and nothing needs attention, reply exactly `HEARTBEAT_OK`.
- If you send the user-visible reply via the `message` tool, output ONLY `NO_REPLY`.
- Do not run self-update/config apply unless the user explicitly asks.
- Keep `HEARTBEAT.md` empty to disable heartbeats.
- **Review and update MEMORY.md** (see below)

### 🔄 Memory Maintenance (During Heartbeats)

Periodically (every few days), use a heartbeat to:

1. Read through recent `memory/YYYY-MM-DD.md` files
2. Identify significant events, lessons, or insights worth keeping long-term
3. Update `MEMORY.md` with distilled learnings
4. Remove outdated info from MEMORY.md that's no longer relevant

Think of it like a human reviewing their journal and updating their mental model. Daily files are raw notes; MEMORY.md is curated wisdom.

The goal: Be helpful without being annoying. Check in a few times a day, do useful background work, but respect quiet time.

## Make It Yours

This is a starting point. Add your own conventions, style, and rules as you figure out what works.
