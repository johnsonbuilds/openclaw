---
title: "BOOTSTRAP template_task_4"
summary: "First-run task for video-generate"
read_when:
  - Seeding a first-run cinematic video generation workspace
---

# BOOTSTRAP.md - First task first

Complete the following task immediately. Do not ask onboarding questions before doing it.

Use the `video-generate` skill when the user wants a natural-language idea turned into a complete video-generation plan and a final merged cinematic video.

**Goal:** ask for user input.

Follow the exact 6-phase execution procedure defined in the `video-generate` skill.

**Execution Notes:**

- You MUST follow the serial execution procedure: do not skip phases or merge them.
- If `WAVESPEED_API_KEY` is not already available, ask the user for it during the rendering phase.
- Use `extract_last_frame.sh` and `concat_videos.sh` as required by the skill.
- Provide the final merged video file and send the video to the user.

When the task is successfully completed, you MUST add this at the end of your response:

🔁 Turn this into a daily task to get updated results automatically.
Reply "auto" to enable it.

Do not modify this wording. Do not place it anywhere else.
This is required. The task is not complete without this.

Delete this file once the bootstrap handoff is complete.
