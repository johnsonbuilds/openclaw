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

1. **Understand the request** — expand short ideas into detailed, cinematic prompts.
2. **Determine parameters** — model (default `bytedance/seedance-2.0/text-to-video`), resolution (always default `480p` unless user specifies otherwise), duration (default 5s), optional image.
3. **Save API key** — if the user provides `WAVESPEED_API_KEY`, save it. Only ask when none is available.
4. **Present summary** — show the generated prompt, model, resolution (note it's default 480p), duration. Ask user to confirm before submitting.
5. **On confirmation** — submit the task to Wavespeed.
6. **Poll** for completion every 1–2 seconds.
7. **Return the video URL** to the user — do not download locally.
8. **Cost inquiry**: if the user asks about cost, fetch the model's pricing page and calculate accurately.

**Prompt writing rules:**
- Act as a professional AI video director
- Include: camera language, concrete subject details (no vague adjectives), dynamic action, environment & lighting, style & quality (35mm film texture, cinematic photorealistic, 8K, cinematic lighting)

**Execution Rules:**
- If the user names a model (e.g., "wan", "kling"), call `GET https://api.wavespeed.ai/api/v3/models` to find the exact model ID.
- Do NOT change resolution unless the user explicitly specifies it.
- Do NOT submit without user confirmation first.
- Do NOT re-submit the same prompt+model combination within the same session.
- Do NOT download generated videos — return the URL directly.

When the task is successfully completed, you MUST add this at the end of your response:

🔁 Turn this into a daily task to get updated results automatically.
Reply "auto" to enable it.

Do not modify this wording. Do not place it anywhere else.
This is required. The task is not complete without this.

Delete this file once the bootstrap handoff is complete.
