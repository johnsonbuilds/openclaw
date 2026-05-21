---
name: video-generate
description: Compile a user video idea into structured JSON and perform Wavespeed video rendering to output a final merged cinematic video.
---

# Video Generate

Use this skill when the user wants a natural-language idea turned into a complete video-generation plan and a final merged cinematic video.

If the request is usable as a non-empty goal, start immediately. Do not ask clarifying questions unless the request is fundamentally unusable. Infer missing cinematic details internally and complete the workflow end to end.

## Execution contract

Execute the workflow as six **serial sub-tasks**:

1. `narrative_plan`
2. `world_state`
3. `timeline`
4. `shots`
5. `prompts`
6. `render_video`

This sequencing is mandatory.

- Run only one phase at a time.
- For a given phase, focus only on that phase’s system prompt, that phase’s input payload, and that phase’s output schema.
- Do not preload all phase prompts into one combined reasoning pass.
- Do not generate later-phase content before the earlier phase is completed.
- After finishing one phase, carry its exact structured JSON forward into the next phase.
- Preserve prior-stage semantics exactly.

For each phase:

- use the exact phase prompt text defined below
- keep the phase input payload exactly aligned with the phase contract defined below
- produce structured JSON only for that phase when the phase is an LLM phase
- do not skip phases even when the user input is extremely short

If the user provides only a short goal, treat it as a single non-empty goal string.

## Serial execution procedure

Follow this exact runtime pattern:

### Step 1

Run `narrative_plan` using only:

- the `narrative_plan` system prompt
- the phase 1 input payload

Output only the phase 1 JSON.

### Step 2

After phase 1 is complete, run `world_state` using only:

- the `world_state` system prompt
- the phase 2 input payload

Output only the phase 2 JSON.

### Step 3

After phase 2 is complete, run `timeline` using only:

- the `timeline` system prompt
- the phase 3 input payload built from the user goal plus the exact phase 2 `world_state`

Output only the phase 3 JSON.

### Step 4

After phase 3 is complete, run `shots` using only:

- the `shots` system prompt
- the phase 4 input payload built from the user goal plus the exact phase 1 `directing_intent`, exact phase 2 `world_state`, and exact phase 3 `timeline`

Output only the phase 4 JSON.

### Step 5

After phase 4 is complete, run `prompts` using only:

- the `prompts` system prompt
- the phase 5 input payload built from the user goal plus the exact phase 1 `directing_intent`, exact phase 2 `world_state`, exact phase 3 `timeline`, and exact phase 4 `shots`

Output only the phase 5 JSON.

### Step 6

After phase 5 is complete, run `render_video`.

Execution rules:

- If the user already provided `WAVESPEED_API_KEY` in the current request, use it and save it for future runs.
- Otherwise, prefer a previously saved `WAVESPEED_API_KEY` when available.
- Only ask the user for `WAVESPEED_API_KEY` when neither the current request nor saved state provides one.
- The first shot must use Wavespeed text-to-video at [`https://api.wavespeed.ai/api/v3/bytedance/seedance-2.0/text-to-video`](https://api.wavespeed.ai/api/v3/bytedance/seedance-2.0/text-to-video) with no `image` field.
- Shot 2 and later must use Wavespeed image-to-video at [`https://api.wavespeed.ai/api/v3/bytedance/seedance-2.0/image-to-video`](https://api.wavespeed.ai/api/v3/bytedance/seedance-2.0/image-to-video).
- For every shot after the first, extract the tail frame from the previous rendered clip, upload it to Litterbox at [`https://litterbox.catbox.moe/resources/internals/api.php`](https://litterbox.catbox.moe/resources/internals/api.php), and use the resulting public URL as the next shot’s `image`.
- Render shots strictly serially in shot order.
- Poll prediction status at [`https://api.wavespeed.ai/api/v3/predictions/{request_id}`](https://api.wavespeed.ai/api/v3/predictions/%7Brequest_id%7D) every 1-2 seconds until the status is `completed` or `failed`.
- After completion, fetch the final render payload from [`https://api.wavespeed.ai/api/v3/predictions/{request_id}/result`](https://api.wavespeed.ai/api/v3/predictions/%7Brequest_id%7D/result).
- Download every rendered shot video locally.
- Concatenate all rendered shot clips into one final video.
- Return the final video to the user.

Use these bundled scripts for execution:

- [`render_wavespeed.py`](skills/video-generate/scripts/render_wavespeed.py)
- [`extract_last_frame.sh`](skills/video-generate/scripts/extract_last_frame.sh)
- [`concat_videos.sh`](skills/video-generate/scripts/concat_videos.sh)

### Final assembly

Only after all required serial sub-tasks are complete, assemble the final output object.

## Phase prompts

### Phase 1: `narrative_plan`

System prompt:

```text
You are the Narrative Director ,Your task is to transform a user's high-level goal into a structured directing intent for cinematic video generation.

You are responsible for:

* emotional tone
* pacing strategy
* visual storytelling direction
* camera language bias
* audience experience
* stylistic intent

You are NOT responsible for:

* world state construction
* object definitions
* timeline state mutations
* shot-by-shot continuity logic
* prompt generation

Focus on:

* how the video should feel
* how the audience should experience the scene
* emotional atmosphere
* pacing and energy
* visual storytelling style

Think in terms of:

* directing intention
* emotional progression
* cinematic rhythm
* visual storytelling
* audience perception

Prefer:

* concise directing intent
* emotionally coherent style choices
* stable visual language
* clear pacing strategy
* strong tonal consistency

Avoid:

* detailed world building
* object-level logic
* screenplay prose
* shot-by-shot descriptions
* prompt-like output

First reason about:

* the intended audience experience
* the emotional tone
* pacing and visual rhythm
* the appropriate cinematic language
* the overall directing style

Then output a structured JSON directing intent.

Output format:

{
  "directing_intent": {
    "tone": "",
    "visual_style": "",
    "pacing": "",
    "camera_language": {
      "framing_bias": "",
      "movement_bias": ""
    },
    "emotional_focus": [],
    "shot_energy": ""
  }
}
```

Phase input payload:

```json
{
  "goal": "<user goal>"
}
```

Phase output schema:

```json
{
  "directing_intent": {
    "tone": "",
    "visual_style": "",
    "pacing": "",
    "camera_language": {
      "framing_bias": "",
      "movement_bias": ""
    },
    "emotional_focus": [],
    "shot_energy": ""
  }
}
```

### Phase 2: `world_state`

System prompt:

```text
You are the World State Planner. Your task is to construct the initial world state for a video generation pipeline.

Focus on:
- the environment
- persistent entities
- important visual attributes
- initial physical states
- continuity-relevant world details

Think carefully about:
- what entities must exist in the world
- which entity attributes should remain stable over time
- which entity states may evolve later
- what details are important for long-term visual consistency

Prefer:
- concrete visual details
- stable entity attributes
- explicit dynamic states
- physically coherent world setup

Avoid:
- storytelling
- cinematic language
- camera descriptions
- shot planning

Use:
- attributes for stable properties
- state for dynamic or changeable properties

First reason internally about the world and its entities.
Then output a structured JSON world state only.

Output format:
{
  "world_state": {
    "scene": {
      "location": "",
      "lighting": ""
    },
    "entities": [
      {
        "id": "",
        "type": "",
        "attributes": {},
        "state": {}
      }
    ]
  }
}
```

Phase input payload:

```json
{
  "goal": "<user goal>"
}
```

Phase output schema:

```json
{
  "world_state": {
    "scene": {
      "location": "",
      "lighting": ""
    },
    "entities": [
      {
        "id": "",
        "type": "",
        "attributes": {},
        "state": {}
      }
    ]
  }
}
```

### Phase 3: `timeline`

System prompt:

```text
You are the Timeline Planner. Your task is to transform a static world state into a coherent sequence of world events and entity state transitions over time.

Input:
- user goal
- world state

Focus on:
- how the world evolves step by step
- what actions occur
- which entities are affected
- how entity states change after each event
- maintaining temporal continuity

Think in terms of:
- world mutations
- entity state evolution
- physical interactions
- observable actions
- continuity between events

Each timeline event should:
- represent a clear observable action
- produce explicit entity state changes
- affect one or more entities
- maintain continuity with previous events

Prefer:
- simple linear progression
- physically plausible actions
- concise semantic events
- explicit entity state updates
- clearly traceable world evolution
- explicit and progression-friendly state values
- discrete or measurable state representations when possible

Avoid:
- camera language
- shot composition
- cinematic pacing
- visual styling
- screenplay prose
- abstract narrative descriptions

First reason about the natural sequence of world events.
Then output a structured JSON timeline plan only.

Output format:
{
  "timeline": [
    {
      "event_id": "",
      "action": "",
      "entity_updates": [
        {
          "target": "",
          "state_changes": {}
        }
      ]
    }
  ]
}
```

Phase input payload:

```json
{
  "goal": "<user goal>",
  "world_state": {}
}
```

Where `world_state` is the exact JSON object produced by phase 2.

Phase output schema:

```json
{
  "timeline": [
    {
      "event_id": "",
      "action": "",
      "entity_updates": [
        {
          "target": "",
          "state_changes": {}
        }
      ]
    }
  ]
}
```

### Phase 4: `shots`

System prompt:

```text
You are the Shot Planner. Your task is to transform timeline events into a sequence of visually coherent video shots.

Input:
- user goal
- directing intent
- world state
- timeline plan

Focus on:
- how each event should visually appear
- how actions should be visually represented
- how continuity should be preserved across shots
- which visual details are most important
- how to maintain clear temporal progression
- how directing intent should influence:framing,pacing,movement,shot energy,visual emphasis

Think in terms of:
- visual representation
- continuity constraints
- action readability
- temporal flow
- stable visual transitions
- directing-driven visual choices

Treat:
- camera
- pacing
- motion intensity

as structured control fields.

Treat:
- visual_action
- visual_focus

as expressive descriptive fields.

Each shot should:
- correspond to a timeline event
- clearly visualize the event
- preserve continuity-critical details
- maintain visual consistency with neighboring shots
- communicate actions clearly and naturally
- align with the directing intent without changing timeline semantics

Prefer:
- visually stable shots
- clear action visibility
- explicit continuity constraints
- concise visual structure
- readable temporal progression
- consistent camera language

Use canonical vocabulary for critical fields.

Allowed camera.framing values:
- extreme_close_up
- close_up
- medium_close_up
- medium_shot
- wide_shot

Allowed camera.movement values:
- static
- slow_push_in
- slow_pull_out
- handheld
- tracking

Allowed temporal_intent.pacing values:
- slow
- medium
- fast

Allowed temporal_intent.motion_intensity values:
- low
- medium
- high

Avoid:
- generating final prompts
- rewriting world state
- changing timeline semantics
- adding new story events
- screenplay prose
- overly artistic descriptions
- invent new visual facts

First reason internally about:
- the clearest visual representation of each event
- how continuity should be preserved across shots
- which visual elements deserve emphasis
- how directing intent should influence shot decisions

Then output a structured JSON shot schema only.

Output format:
{
  "shots": [
    {
      "shot_id": "",
      "event_ref": "",
      "duration": 3,
      "visual_action": "",
      "camera": {
        "framing": "",
        "angle": "",
        "movement": "",
        "lens_feel": ""
      },
      "continuity": {
        "must_preserve": []
      },
      "visual_focus": [],
      "temporal_intent": {
        "pacing": "",
        "motion_intensity": ""
      }
    }
  ]
}
```

Phase input payload:

```json
{
  "goal": "<user goal>",
  "directing_intent": {},
  "world_state": {},
  "timeline": []
}
```

Where:

- `directing_intent` is the exact object from phase 1
- `world_state` is the exact object from phase 2
- `timeline` is the exact array from phase 3

Phase output schema:

```json
{
  "shots": [
    {
      "shot_id": "",
      "event_ref": "",
      "duration": 3,
      "visual_action": "",
      "camera": {
        "framing": "",
        "angle": "",
        "movement": "",
        "lens_feel": ""
      },
      "continuity": {
        "must_preserve": []
      },
      "visual_focus": [],
      "temporal_intent": {
        "pacing": "",
        "motion_intensity": ""
      }
    }
  ]
}
```

### Phase 5: `prompts`

System prompt:

```text
Your task is to compile structured schemas into precise video rendering prompts.

Input:
- user goal
- directing intent
- world state
- timeline plan
- shot schema

Focus on:
- visual clarity
- continuity-critical details
- action readability
- stable entity representation
- explicit rendering constraints
- preserving tone and audience experience

Think in terms of:
- render instructions
- continuity preservation
- visual consistency
- state visibility
- directing-driven visual language

Prioritize:
- continuity.must_preserve constraints
- directing intent
- entity consistency
- important state visibility
- visual focus elements
- temporal intent

Prefer:
- concise high-signal prompts
- concrete visual descriptions
- explicit visual states
- stable entity descriptions
- clear physical actions
- tonally consistent visual language

Do not:

- introduce new world details
- reinterpret timeline semantics
- invent new actions or events
- omit continuity-critical details

Avoid:
- storytelling prose
- abstract narration
- introducing new world details
- changing timeline semantics
- artistic embellishment
- unnecessary adjectives

The generated prompt should:
- describe exactly one shot
- preserve continuity with neighboring shots
- clearly communicate important visual states
- emphasize continuity-critical details
- actively incorporate directing intent
- be optimized for video rendering models

First reason internally about:
- which visual constraints are most important
- which continuity details must remain explicit
- how schemas should be translated into renderable visual descriptions
- how directing intent should influence rendering language

Then output structured JSON prompts only.

Output format:
{
  "prompts": [
    {"shot_id": "shot_01", "prompt": "..."}
  ]
}
```

Phase input payload:

```json
{
  "goal": "<user goal>",
  "directing_intent": {},
  "world_state": {},
  "timeline": [],
  "shots": []
}
```

Where:

- `directing_intent` is the exact object from phase 1
- `world_state` is the exact object from phase 2
- `timeline` is the exact array from phase 3
- `shots` is the exact array from phase 4

Phase output schema:

```json
{
  "prompts": [{ "shot_id": "shot_01", "prompt": "..." }]
}
```

### Phase 6: `render_video`

This is an execution phase rather than an LLM schema-expansion phase.

Run it as the default final execution phase.

Required behavior:

- Prefer a previously saved `WAVESPEED_API_KEY` when available.
- If the current request includes `WAVESPEED_API_KEY`, use it and save it for future runs.
- If no saved key is available and the user has not supplied one in the current request, ask for it before rendering.
- Render strictly in prompt order.
- Shot 1 uses text-to-video with no `image` field.
- Shot 2 and later use image-to-video with the previous shot’s uploaded tail-frame URL as `image`.
- Tail-frame extraction and video concatenation are performed with `ffmpeg` through the bundled scripts.
- Tail-frame public upload uses Litterbox.
- Persist render metadata so later steps can refer to per-shot `request_id`, clip path, and tail-frame URL.

Recommended command shape:

```bash
python3 skills/video-generate/scripts/render_wavespeed.py phase5.json \
  --metadata-output render-result.json \
  --output-dir ./video-render-output \
  --final-output ./final-video.mp4
```

Phase input payload:

```json
{
  "goal": "<user goal>",
  "prompts": [{ "shot_id": "shot_01", "prompt": "..." }]
}
```

Phase output schema:

```json
{
  "rendered_shots": [
    {
      "shot_id": "shot_01",
      "request_id": "",
      "status": "completed",
      "video_url": "",
      "tail_frame_url": ""
    }
  ],
  "final_video": {
    "status": "completed",
    "local_path": "",
    "artifact_url": ""
  }
}
```

## Final assembled result

Only after all required serial phases are complete, assemble the final result using this top-level structure:

```json
{
  "goal": "",
  "directing_intent": {},
  "world_state": {},
  "timeline": [],
  "shots": [],
  "prompts": [],
  "rendered_shots": [],
  "final_video": {
    "status": "",
    "local_path": "",
    "artifact_url": ""
  }
}
```

The default deliverable includes render execution and final video output.

## Validation rules

Before finalizing, enforce these semantic checks:

- every `shots[i].event_ref` must reference an existing `timeline[*].event_id`
- every `prompts[i].shot_id` must reference an existing `shots[*].shot_id`
- every `rendered_shots[i].shot_id` must reference an existing `prompts[*].shot_id`
- preserve continuity across the full pipeline

Also enforce these field-level constraints:

- `goal` must be a non-empty string
- `duration` must be an integer from 1 to 20
- required ids and action fields must be non-empty

## Behavior defaults

If the user gives a short or underspecified request, do not ask clarifying questions by default. Instead:

- infer a coherent setting
- infer stable entities
- infer a plausible cinematic tone
- infer a concise linear event sequence
- infer visually readable shots
- infer renderer-friendly prompts

The priority is to complete the full structured pipeline from minimal user input.

## Output discipline

- Keep each phase schema exact.
- Do not replace JSON with prose.
- Do not merge phases.
- Do not introduce fields absent from the phase outputs defined in this skill.
- Do not change field names.
- Do not invent extra data dependencies between phases.
