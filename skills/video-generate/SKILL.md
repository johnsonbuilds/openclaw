---
name: video-generate
description: Generate a single video from a text prompt (and optional image) using Wavespeed AI video generation models.
---

# Video Generate

Generate a video from a user's natural-language description using Wavespeed AI. The skill handles prompt generation, API submission, polling, and delivering the final video to the user.

## Workflow

1. **Understand the request** — If the user provides only a short goal, expand it into a detailed video generation prompt. Infer cinematic details (scene, mood, action, style) from context. Do not ask clarifying questions unless the request is fundamentally unusable.

2. **Determine parameters** — Extract or infer:
   - **Model** — User can specify a model; default is `bytedance/seedance-2.0/text-to-video` for text-to-video or `bytedance/seedance-2.0/image-to-video` for image-to-video.
   - **Prompt** — The text description for generation.
   - **Image (optional)** — If the user provides an image URL or file, use it as input for image-to-video.
   - **Duration** — Video length (default: 5 seconds, range: 1-20).
   - **Resolution** — Default: `720p`. Options typically include `480p`, `720p`, `1080p`.
   - **Negative prompt (optional)** — Things to avoid in the video.
   - **Seed (optional)** — For reproducible results.
   - **Webhook URL (optional)** — For async delivery.

3. **Save API key** — If the user provides a `WAVESPEED_API_KEY`, save it. Prefer previously saved keys. Only ask when none is available.

4. **Submit task** — Call Wavespeed API to submit the generation task.

5. **Poll for results** — Check status every 1-2 seconds until `completed` or `failed`.

6. **Retrieve and deliver** — Download the generated video and send it to the user.

## API Reference

### Models

The `{model-id}` path segment determines the model. Common video models:

| Model | Model ID |
|-------|----------|
| Seedance 2.0 (text-to-video) | `bytedance/seedance-2.0/text-to-video` |
| Seedance 2.0 (image-to-video) | `bytedance/seedance-2.0/image-to-video` |

Users can specify other models by providing the full model ID string (e.g., `bytedance/seedance-1.5-pro/text-to-video`).

When the user provides an image (URL or uploaded file), use the image-to-video variant of the model. Without an image, use text-to-video.

### Submit Task

```
POST https://api.wavespeed.ai/api/v3/{model-id}
Headers:
  Authorization: Bearer ${WAVESPEED_API_KEY}
  Content-Type: application/json

Body:
{
  "prompt": "A cinematic shot of a cyberpunk city at night with neon lights",
  "duration": 5,
  "resolution": "720p",
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

2. **Build the prompt**: If the user gives a short idea ("a cat in space"), expand it into a detailed, render-friendly prompt with scene, lighting, camera movement, and mood.

3. **Submit** the task to the appropriate Wavespeed endpoint.

4. **Poll** `api.wavespeed.ai/api/v3/predictions/{task-id}` every 1-2 seconds until status is `completed` or `failed`.

5. **Download** the video from `data.outputs[0]` to a local file.

6. **Send** the video file to the user.

## Error Handling

- **401**: Invalid API key — notify user and ask for a new one.
- **403**: Account/credit issue — notify user.
- **429**: Rate limited — wait and retry.
- **500**: Server error — retry once, then fail gracefully.
- **Polling timeout**: If not completed after 5 minutes, notify user and offer to retry or use a different model.
