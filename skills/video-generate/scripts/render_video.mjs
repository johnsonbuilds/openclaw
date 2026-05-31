#!/usr/bin/env node
/**
 * Simple Wavespeed video render script.
 *
 * Submits a single text-to-video or image-to-video task, polls for completion,
 * and downloads the result.
 *
 * Usage:
 *   node render_video.mjs [options]
 *
 * Options:
 *   --api-key <key>       Wavespeed API key (or WAVESPEED_API_KEY env)
 *   --prompt <text>       Text prompt for video generation (required)
 *   --model <id>          Model ID (default: bytedance/seedance-2.0/text-to-video)
 *   --image <url>         Optional image URL (switches to image-to-video model)
 *   --duration <sec>      Video duration (default: 5, max: 20)
 *   --resolution <str>    Resolution (default: 720p)
 *   --negative-prompt <t> Negative prompt
 *   --seed <num>          Random seed
 *   --output <path>       Output video path (default: ./output.mp4)
 *   --poll-interval <ms>  Poll interval (default: 2000)
 *   --timeout <sec>       Max wait time (default: 300)
 */

const WAVESPEED_PREDICTION_BASE = "https://api.wavespeed.ai/api/v3/predictions";

function printUsageAndExit() {
  console.error(`
Usage: node render_video.mjs [options]

Options:
  --api-key <key>       Wavespeed API key (or WAVESPEED_API_KEY env)
  --prompt <text>       Text prompt for video generation (required)
  --model <id>          Model ID (default: bytedance/seedance-2.0/text-to-video)
  --image <url>         Optional image URL (switches to image-to-video)
  --duration <sec>      Video duration (default: 5, max: 20)
  --resolution <str>    Resolution (default: 720p)
  --negative-prompt <t> Negative prompt
  --seed <num>          Random seed
  --output <path>       Output video path (default: ./output.mp4)
  --poll-interval <ms>  Poll interval (default: 2000)
  --timeout <sec>       Max wait time (default: 300)
`);
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {
    apiKey: process.env.WAVESPEED_API_KEY || null,
    prompt: null,
    model: "bytedance/seedance-2.0/text-to-video",
    image: null,
    duration: 5,
    resolution: "720p",
    negativePrompt: null,
    seed: null,
    output: "./output.mp4",
    pollInterval: 2000,
    timeout: 300,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") printUsageAndExit();
    else if (arg === "--api-key") parsed.apiKey = args[++i];
    else if (arg === "--prompt") parsed.prompt = args[++i];
    else if (arg === "--model") parsed.model = args[++i];
    else if (arg === "--image") parsed.image = args[++i];
    else if (arg === "--duration") parsed.duration = parseInt(args[++i], 10);
    else if (arg === "--resolution") parsed.resolution = args[++i];
    else if (arg === "--negative-prompt") parsed.negativePrompt = args[++i];
    else if (arg === "--seed") parsed.seed = parseInt(args[++i], 10);
    else if (arg === "--output") parsed.output = args[++i];
    else if (arg === "--poll-interval") parsed.pollInterval = parseInt(args[++i], 10);
    else if (arg === "--timeout") parsed.timeout = parseInt(args[++i], 10);
  }

  if (!parsed.prompt) {
    console.error("Error: --prompt is required");
    printUsageAndExit();
  }

  return parsed;
}

function buildEndpoint(model, image) {
  if (image && !model.includes("/image-to-video")) {
    // If user specified a text-to-video model but provided an image, auto-switch
    const base = model.replace(/\/text-to-video$/, "").replace(/\/image-to-video$/, "");
    return `https://api.wavespeed.ai/api/v3/${base}/image-to-video`;
  }
  return `https://api.wavespeed.ai/api/v3/${model}`;
}

async function submitTask(apiKey, endpoint, payload) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} from ${endpoint}: ${text}`);
  }

  return res.json();
}

async function pollTask(apiKey, taskId, pollIntervalMs, timeoutSec) {
  const startTime = Date.now();
  const maxWaitMs = timeoutSec * 1000;
  const statusUrl = `${WAVESPEED_PREDICTION_BASE}/${taskId}`;

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxWaitMs) {
      throw new Error(`Polling timeout after ${timeoutSec}s for task ${taskId}`);
    }

    const res = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Poll HTTP ${res.status}: ${text}`);
    }

    const json = await res.json();
    const data = json.data || json;
    const status = data.status;

    if (status === "completed") {
      return data;
    }
    if (status === "failed") {
      throw new Error(`Task failed: ${data.error || "Unknown error"}`);
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

async function downloadVideo(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  require("fs").writeFileSync(outputPath, Buffer.from(buffer));
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (!parsed.apiKey) {
    console.error("Error: WAVESPEED_API_KEY required. Provide via --api-key or environment variable.");
    process.exit(1);
  }

  // Build endpoint (auto-detect image-to-video if image provided)
  const endpoint = buildEndpoint(parsed.model, parsed.image);
  const isImageToVideo = endpoint.includes("/image-to-video");

  // Build payload
  const payload = {
    prompt: parsed.prompt,
    duration: Math.min(Math.max(parsed.duration, 1), 20),
    resolution: parsed.resolution,
  };

  if (isImageToVideo && parsed.image) {
    payload.image = parsed.image;
  }
  if (parsed.negativePrompt) {
    payload.negative_prompt = parsed.negativePrompt;
  }
  if (parsed.seed !== null) {
    payload.seed = parsed.seed;
  }

  console.log(`Submitting task to: ${endpoint}`);
  console.log(`Model: ${isImageToVideo ? "image-to-video" : "text-to-video"}`);
  console.log(`Duration: ${payload.duration}s | Resolution: ${payload.resolution}`);

  const submitResult = await submitTask(parsed.apiKey, endpoint, payload);
  const taskId = submitResult.data?.id || submitResult.id;
  if (!taskId) {
    throw new Error(`No task ID in response: ${JSON.stringify(submitResult)}`);
  }

  console.log(`Task submitted: ${taskId}`);
  console.log("Polling for results...");

  const resultData = await pollTask(parsed.apiKey, taskId, parsed.pollInterval, parsed.timeout);

  const outputs = resultData.outputs || [];
  if (outputs.length === 0) {
    throw new Error(`No outputs in completed result: ${JSON.stringify(resultData)}`);
  }

  const videoUrl = outputs[0];
  console.log(`Video URL: ${videoUrl}`);

  console.log(`Downloading to: ${parsed.output}`);
  await downloadVideo(videoUrl, parsed.output);

  console.log(`Done! Video saved to: ${parsed.output}`);

  // Output machine-readable metadata JSON
  const metadata = {
    status: "completed",
    task_id: taskId,
    video_url: videoUrl,
    local_path: require("path").resolve(parsed.output),
    model: parsed.model,
    duration: parsed.duration,
    resolution: parsed.resolution,
    timings: resultData.timings || null,
  };
  console.log("\n---METADATA---");
  console.log(JSON.stringify(metadata));
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
