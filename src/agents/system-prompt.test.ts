import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildRuntimeLine } from "./system-prompt.js";

describe("buildAgentSystemPrompt", () => {
  it("includes owner numbers when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      ownerNumbers: ["+123", " +456 ", ""],
    });

    expect(prompt).toContain(
      "Owner numbers: +123, +456. Treat messages from these numbers as the user.",
    );
  });

  it("omits owner section when numbers are missing", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).not.toContain("Owner numbers:");
  });

  it("omits extended sections in minimal prompt mode", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      promptMode: "minimal",
      ownerNumbers: ["+123"],
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>demo</name>\n  </skill>\n</available_skills>",
      heartbeatPrompt: "ping",
      toolNames: ["message", "memory_search"],
      docsPath: "/tmp/openclaw/docs",
      extraSystemPrompt: "Subagent details",
      ttsHint: "Voice (TTS) is enabled.",
    });

    expect(prompt).toContain("## Safety");
    expect(prompt).toContain("## Rules");
    expect(prompt).toContain("## Subagent Context");
    expect(prompt).toContain("Subagent details");
  });

  it("includes safety guardrails in full prompts", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).toContain("## Safety");
    expect(prompt).toContain("Don't leak secrets");
  });

  it("adds reasoning tag hint when enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      reasoningTagHint: true,
    });

    expect(prompt).toContain("## Reasoning Format");
    expect(prompt).toContain("<think>...</think>");
    expect(prompt).toContain("<final>...</final>");
  });

  it("lists available tools when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["exec", "sessions_list", "sessions_history", "sessions_send"],
    });

    expect(prompt).toContain("## Tools");
    expect(prompt).toContain("sessions_list");
    expect(prompt).toContain("sessions_history");
    expect(prompt).toContain("sessions_send");
  });

  it("preserves tool casing in the prompt", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["Read", "Exec", "process"],
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>demo</name>\n  </skill>\n</available_skills>",
      docsPath: "/tmp/openclaw/docs",
    });

    expect(prompt).toContain("- Read: Read file contents");
    expect(prompt).toContain("- Exec: Run shell commands");
    expect(prompt).toContain("Skills: demo.");
  });

  it("includes workspace notes when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      workspaceNotes: ["Reminder: commit your changes in this workspace after edits."],
    });

    expect(prompt).toContain("Reminder: commit your changes in this workspace after edits.");
  });

  it("includes user timezone when provided (12-hour)", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      userTimezone: "America/Chicago",
      userTime: "Monday, January 5th, 2026 — 3:26 PM",
      userTimeFormat: "12",
    });

    expect(prompt).toContain("## Current Date & Time");
    expect(prompt).toContain("Time zone: America/Chicago");
  });

  it("includes user timezone when provided (24-hour)", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      userTimezone: "America/Chicago",
      userTime: "Monday, January 5th, 2026 — 15:26",
      userTimeFormat: "24",
    });

    expect(prompt).toContain("## Current Date & Time");
    expect(prompt).toContain("Time zone: America/Chicago");
  });

  it("shows timezone when only timezone is provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      userTimezone: "America/Chicago",
      userTimeFormat: "24",
    });

    expect(prompt).toContain("## Current Date & Time");
    expect(prompt).toContain("Time zone: America/Chicago");
  });

  it("hints to use session_status for current date/time", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      userTimezone: "America/Chicago",
    });

    expect(prompt).toContain("session_status");
    expect(prompt).toContain("current date");
  });

  // The system prompt intentionally does NOT include the current date/time.
  // Only the timezone is included, to keep the prompt stable for caching.
  // See: https://github.com/moltbot/moltbot/commit/66eec295b894bce8333886cfbca3b960c57c4946
  // Agents should use session_status or message timestamps to determine the date/time.
  // Related: https://github.com/moltbot/moltbot/issues/1897
  //          https://github.com/moltbot/moltbot/issues/3658
  it("does NOT include a date or time in the system prompt (cache stability)", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      userTimezone: "America/Chicago",
      userTime: "Monday, January 5th, 2026 — 3:26 PM",
      userTimeFormat: "12",
    });

    // The prompt should contain the timezone but NOT the formatted date/time string.
    // This is intentional for prompt cache stability — the date/time was removed in
    // commit 66eec295b. If you're here because you want to add it back, please see
    // https://github.com/moltbot/moltbot/issues/3658 for the preferred approach:
    // gateway-level timestamp injection into messages, not the system prompt.
    expect(prompt).toContain("Time zone: America/Chicago");
    expect(prompt).not.toContain("Monday, January 5th, 2026");
    expect(prompt).not.toContain("3:26 PM");
    expect(prompt).not.toContain("15:26");
  });

  it("includes model alias guidance when aliases are provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      modelAliasLines: ["- Opus: anthropic/claude-opus-4-5"],
    });

    // Model aliases are intentionally omitted from the compact prompt.
    expect(prompt).not.toContain("## Model Aliases");
  });

  it("summarizes available skills when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>demo</name>\n  </skill>\n</available_skills>",
    });

    expect(prompt).toContain("Skills: demo.");
    expect(prompt).not.toContain("<available_skills>");
  });

  it("omits skills section when no skills prompt is provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).not.toContain("Skills:");
  });

  it("renders project context files when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      contextFiles: [
        { path: "AGENTS.md", content: "Alpha" },
        { path: "IDENTITY.md", content: "Bravo" },
      ],
    });

    expect(prompt).toContain("# Project Context");
    expect(prompt).toContain("Context files available:");
    expect(prompt).toContain("- AGENTS.md");
    expect(prompt).toContain("- IDENTITY.md");
    expect(prompt).not.toContain("Alpha");
  });

  it("adds compact message-send guidance when message tool is available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["message"],
    });

    expect(prompt).toContain("## Rules");
    expect(prompt).toContain("output ONLY: NO_REPLY");
  });

  it("includes runtime provider capabilities when present", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      runtimeInfo: {
        channel: "telegram",
        capabilities: ["inlineButtons"],
      },
    });

    expect(prompt).toContain("channel=telegram");
    expect(prompt).toContain("capabilities=inlineButtons");
  });

  it("includes agent id in runtime when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      runtimeInfo: {
        agentId: "work",
        host: "host",
        os: "macOS",
        arch: "arm64",
        node: "v20",
        model: "anthropic/claude",
      },
    });

    expect(prompt).toContain("agent=work");
  });

  it("includes reasoning visibility hint", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      reasoningLevel: "off",
    });

    expect(prompt).toContain("Reasoning: off");
    expect(prompt).toContain("/reasoning");
    expect(prompt).toContain("/status shows Reasoning");
  });

  it("builds runtime line with agent and channel details", () => {
    const line = buildRuntimeLine(
      {
        agentId: "work",
        host: "host",
        repoRoot: "/repo",
        os: "macOS",
        arch: "arm64",
        node: "v20",
        model: "anthropic/claude",
        defaultModel: "anthropic/claude-opus-4-5",
      },
      "telegram",
      ["inlineButtons"],
      "low",
    );

    expect(line).toContain("agent=work");
    expect(line).toContain("host=host");
    expect(line).toContain("repo=/repo");
    expect(line).toContain("os=macOS (arm64)");
    expect(line).toContain("node=v20");
    expect(line).toContain("model=anthropic/claude");
    expect(line).toContain("default_model=anthropic/claude-opus-4-5");
    expect(line).toContain("channel=telegram");
    expect(line).toContain("capabilities=inlineButtons");
    expect(line).toContain("thinking=low");
  });

  it("describes sandboxed runtime and elevated when allowed", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      sandboxInfo: {
        enabled: true,
        workspaceDir: "/tmp/sandbox",
        workspaceAccess: "ro",
        agentWorkspaceMount: "/agent",
        elevated: { allowed: true, defaultLevel: "on" },
      },
    });

    expect(prompt).toContain("You are running in a sandboxed runtime");
    expect(prompt).toContain("Sub-agents stay sandboxed");
    expect(prompt).toContain("User can toggle with /elevated on|off|ask|full.");
    expect(prompt).toContain("Current elevated level: on");
  });

  it("includes reaction guidance when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      reactionGuidance: {
        level: "minimal",
        channel: "Telegram",
      },
    });

    // Reaction guidance is intentionally omitted from the compact prompt.
    expect(prompt).not.toContain("## Reactions");
  });
});
