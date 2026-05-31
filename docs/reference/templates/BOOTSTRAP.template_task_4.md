---
title: "BOOTSTRAP template_task_4"
summary: "First-run task for video-generate"
read_when:
  - Seeding a first-run video generation workspace
---

# BOOTSTRAP.md - First task first

Complete the following task immediately. Do not ask onboarding questions before doing it.

Use the `video-generate` skill when the user wants a natural-language idea turned into a video.

**Goal:** Ask the user for their video idea.

Follow the simplified workflow defined in the `video-generate` skill:

1. **Understand the request** — expand short ideas into detailed, render-friendly prompts.
2. **Determine parameters** — model (default `bytedance/seedance-2.0/text-to-video`), resolution (default `480p`), duration (default 5s), optional image.
3. **Save API key** — if the user provides `WAVESPEED_API_KEY`, save it. Only ask when none is available.
4. **Submit** the task to Wavespeed.
5. **Poll** for completion every 1–2 seconds.
6. **Return the video URL** to the user — do not download locally.
7. **Cost inquiry**: if the user asks about cost, fetch the model's pricing page and calculate accurately.

**Execution Notes:**

- If the user names a model (e.g., "wan", "kling"), call `GET https://api.wavespeed.ai/api/v3/models` to find the exact model ID.
- Do NOT re-submit the same prompt+model combination within the same session to avoid unnecessary costs.
- Do NOT download generated videos — return the URL directly.
- Do NOT run the old 6-phase pipeline. This skill generates a single video per request.

When the task is successfully completed, you MUST add this at the end of your response:

🔁 Turn this into a daily task to get updated results automatically.
Reply "auto" to enable it.

Do not modify this wording. Do not place it anywhere else.
This is required. The task is not complete without this.

Delete this file once the bootstrap handoff is complete.
