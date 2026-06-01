---
name: video-generate
description: Generate a single video from a text prompt (and optional image) using Wavespeed AI video generation models.
---

# Video Generate

Generate a video from a user's natural-language description using Wavespeed AI. The skill handles prompt generation, user confirmation, API submission, polling, and returning the video URL to the user.

## Workflow

1. **Understand the request** — If the user provides only a short goal, expand it into a detailed video generation prompt. Infer cinematic details (scene, mood, action, style) from context. Do not ask clarifying questions unless the request is fundamentally unusable.

2. **Determine parameters** — Extract or infer:
   - **Model** — User can specify a model by name (e.g., "seedance 2.0" or "wan 2.7"). Look up the exact model ID by calling `GET https://api.wavespeed.ai/api/v3/models` and matching the user's name. Default is `bytedance/seedance-2.0/text-to-video` for text-to-video or `bytedance/seedance-2.0/image-to-video` for image-to-video.
   - **Prompt** — Act as a professional AI video director. Generate a high-quality prompt containing the following elements:
     - **Camera Language (镜头语言)** — Specify framing and movement (e.g., `Low-angle tracking shot`, `Close-up`, `Drone cinematic shot`).
     - **Subject Details (主体细节)** — Use concrete nouns for appearance and materials. Avoid vague adjectives (e.g., `a futuristic astronaut with a weathered white spacesuit`).
     - **Core Action (核心动作)** — Use dynamic verbs; control the intensity of motion (e.g., `walking with heavy steps`, `water splashing violently`).
     - **Environment & Lighting (环境与光影)** — Specify time of day and dramatic lighting (e.g., `sunset, dramatic side lighting`, `neon-lit cyberpunk street`).
     - **Style & Quality (画质与风格)** — Set cinematic feel and film texture (e.g., `35mm film texture`, `cinematic photorealistic`, `8K`, `cinematic lighting`).
   - **Image (optional)** — If the user provides an image URL or file, use it as input for image-to-video.
   - **Duration** — Video length (default: 5 seconds, range: 1-20).
   - **Resolution** — Do **not** change resolution unless the user explicitly specifies it. Default: `480p`. Options: `480p`, `720p`, `1080p`.
   - **Negative prompt (optional)** — Things to avoid in the video.
   - **Seed (optional)** — For reproducible results.
   - **Aspect ratio (optional)** — e.g., `16:9`, `9:16`, `4:3`. Default: `16:9`.
   - **Webhook URL (optional)** — For async delivery.

3. **Save API key** — If the user provides a `WAVESPEED_API_KEY`, save it. Prefer previously saved keys. Only ask when none is available.

4. **Present a summary and ask for confirmation** — Before submitting the task, present a clear summary of:
   - The generated prompt
   - Model
   - Resolution (note it as 480p default unless user specified otherwise)
   - Duration
   - Cost estimate (if calculated)

   Ask the user to confirm ("Looks good? Reply OK to submit"). Only proceed after the user confirms.

5. **Submit task** — Call Wavespeed API to submit the generation task.

6. **Poll for results** — Check status every 1-2 seconds until `completed` or `failed`.

7. **Retrieve and deliver** — Return the video URL from `data.outputs[0]` to the user. **Do not download the video locally** — just return the URL so the user can download it directly.

## Cost Inquiry

If the user asks about the cost of generating a video:

1. Fetch the pricing page for the specific model being used. The URL follows this pattern:
   `https://wavespeed.ai/docs/docs-api/{provider}/{model-id-with-hyphens}-{generation-type}`

   For example, for `bytedance/seedance-2.0/text-to-video`:
   `https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedance-2.0-text-to-video`

   Rules for building the URL:
   - `{provider}`: the first segment of the model ID (e.g., `bytedance`)
   - `{model-id-with-hyphens}`: the full model ID with `/` replaced by `-` (e.g., `bytedance-seedance-2.0`)
   - `{generation-type}`: the last segment (e.g., `text-to-video`)

2. Parse the pricing information from the page content.

3. Calculate the exact cost based on the user's configured parameters (resolution, duration, reference images, etc.).

4. Present the cost breakdown to the user clearly.

## Deduplication

**Do not re-submit the same prompt for the same user within the same session** unless the user explicitly asks to retry or make a new video. If the user's request produces the same prompt as a previous generation, return the existing result URL instead of creating a new task. This avoids unnecessary costs.

## API Reference

### Models

The `{model-id}` path segment determines the model. To look up model IDs, call:

```
GET https://api.wavespeed.ai/api/v3/models
Headers:
  Authorization: Bearer ${WAVESPEED_API_KEY}
```

When the user names a model (e.g., "Seedance", "Wan", "Kling"), search the models API response to find the matching model ID. Extract the `name` field from each model entry. Common video models include:

| User says | Likely model ID |
|-----------|----------------|
| seedance 2.0 / seedance | `bytedance/seedance-2.0/text-to-video` |
| wan / wan 2.7 | (look up via API, e.g. `wavespeed-ai/wan-2.7/text-to-video`) |
| kling | (look up via API) |

When the user provides an image (URL or uploaded file), use the image-to-video variant of the model. Without an image, use text-to-video.

### Submit Task

```
POST https://api.wavespeed.ai/api/v3/{model-id}
Headers:
  Authorization: Bearer ${WAVESPEED_API_KEY}
  Content-Type: application/json

Body:
{
  "prompt": "Low-angle tracking shot of a futuristic astronaut with a weathered white spacesuit walking with heavy steps across a neon-lit cyberpunk street at sunset. Cinematic photorealistic, 35mm film texture, 8K, dramatic side lighting.",
  "duration": 5,
  "resolution": "480p",
  "image": "https://..."  // optional, for image-to-video
}
```

**Response:**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "pred_abc123",
    "model": "bytedance/seedance-2.0/text-to-video",
    "status": "created",
    "urls": {
      "get": "https://api.wavespeed.ai/api/v3/predictions/pred_abc123"
    },
    "created_at": "2024-01-01T12:00:00.000Z"
  }
}
```

### Poll Status

```
GET https://api.wavespeed.ai/api/v3/predictions/{task-id}
Headers:
  Authorization: Bearer ${WAVESPEED_API_KEY}
```

**Processing response:**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "pred_abc123",
    "status": "processing",
    "outputs": [],
    "created_at": "2024-01-01T12:00:00.000Z"
  }
}
```

**Completed response:**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "pred_abc123",
    "status": "completed",
    "outputs": ["https://cdn.wavespeed.ai/generated/video123.mp4"],
    "timings": { "inference": 45000 },
    "created_at": "2024-01-01T12:00:00.000Z"
  }
}
```

**Failed response:**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "pred_abc123",
    "status": "failed",
    "error": "Error message here",
    "created_at": "2024-01-01T12:00:00.000Z"
  }
}
```

### Status Values

| Status | Meaning | Action |
|--------|---------|--------|
| `created` | Task queued | Continue polling |
| `processing` | Generation in progress | Continue polling |
| `completed` | Success | Retrieve outputs |
| `failed` | Error occurred | Check error field |

## Execution

1. **Save API key** if provided. Use previously saved key when available. Ask only if none is available.

2. **Determine model**: If user names a model (like "wan" or "kling"), call `GET https://api.wavespeed.ai/api/v3/models` to find the exact model ID. Default is `bytedance/seedance-2.0/text-to-video`.

3. **Build the prompt**: Act as a professional AI video director. Take the user's idea and generate a detailed prompt incorporating:
   - Camera Language & Movement (景别与运动)
   - Concrete Subject Details (主体细节, no vague adjectives)
   - Dynamic Core Action (核心动作)
   - Environment & Lighting (环境与光影)
   - Style & Quality (画质与风格: 35mm film texture, cinematic photorealistic, 8K, cinematic lighting)

4. **Check for duplicates**: If the identical prompt + model + image combination was already submitted in this session, return the existing result URL instead of submitting again.

5. **Present summary and ask for confirmation**: Show the user the generated prompt, model, resolution (480p unless user specified otherwise), duration, and cost estimate. Ask "Looks good? Reply OK to submit."

6. **Only on user confirmation**: Submit the task to the appropriate Wavespeed endpoint.

7. **Poll** `api.wavespeed.ai/api/v3/predictions/{task-id}` every 1-2 seconds until status is `completed` or `failed`.

8. **Return the URL**: Give the user the video URL from `data.outputs[0]`. Do not download locally.

9. **If user asks about cost**: Fetch `https://wavespeed.ai/docs/docs-api/{provider}/{model-id-with-hyphens}-{generation-type}`, parse pricing, and calculate the exact cost based on resolution and duration.

## Error Handling

- **401**: Invalid API key — notify user and ask for a new one.
- **403**: Account/credit issue — notify user.
- **429**: Rate limited — wait and retry.
- **500**: Server error — retry once, then fail gracefully.
- **Polling timeout**: If not completed after 5 minutes, notify user and offer to retry or use a different model.
