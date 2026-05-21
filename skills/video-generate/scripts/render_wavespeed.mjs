#!/usr/bin/env node
/**
 * Orchestrate Wavespeed shot rendering, tail-frame handoff, and final concatenation.
 *
 * Expected input is a JSON file with at least:
 * - goal
 * - prompts: [{shot_id, prompt, ...}]
 *
 * Optional fields/args:
 * - --api-key: Wavespeed API key (defaults to WAVESPEED_API_KEY env)
 * - --output-dir: Working directory (default: ./video-render-output)
 * - --final-output: Merged output video path (default: ./final-video.mp4)
 * - --duration: Default duration for each shot (default: 5)
 * - --resolution: Default Wavespeed resolution (default: "720p")
 * - --enable-web-search: Default false
 * - --no-generate-audio: Default false
 * - --metadata-output: Write render metadata JSON to this file path
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WAVESPEED_POLL_INTERVAL_MS = 1500;
const WAVESPEED_PREDICTION_BASE = "https://api.wavespeed.ai/api/v3/predictions";
const WAVESPEED_TEXT_TO_VIDEO = "https://api.wavespeed.ai/api/v3/bytedance/seedance-2.0/text-to-video";
const WAVESPEED_IMAGE_TO_VIDEO = "https://api.wavespeed.ai/api/v3/bytedance/seedance-2.0/image-to-video";
const LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php";

function printUsageAndExit() {
  console.error(`
Usage: node render_wavespeed.mjs <input.json> [options]

Options:
  --api-key <key>          Wavespeed API key (or set WAVESPEED_API_KEY env)
  --output-dir <path>      Working directory for clips and frames (default: ./video-render-output)
  --final-output <path>    Merged output video path (default: ./final-video.mp4)
  --duration <number>      Default duration in seconds (default: 5)
  --resolution <string>    Default resolution (default: 720p)
  --enable-web-search      Enable web search in generation
  --no-generate-audio      Disable audio generation
  --metadata-output <path> Output file for execution metadata JSON
`);
  process.exit(1);
}

// Simple CLI parser
function parseArgs(args) {
  const parsed = {
    input: null,
    apiKey: process.env.WAVESPEED_API_KEY || null,
    outputDir: './video-render-output',
    finalOutput: './final-video.mp4',
    duration: 5,
    resolution: '720p',
    enableWebSearch: false,
    generateAudio: true,
    metadataOutput: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printUsageAndExit();
    } else if (arg === '--api-key') {
      parsed.apiKey = args[++i];
    } else if (arg === '--output-dir') {
      parsed.outputDir = args[++i];
    } else if (arg === '--final-output') {
      parsed.finalOutput = args[++i];
    } else if (arg === '--duration') {
      parsed.duration = parseInt(args[++i], 10);
    } else if (arg === '--resolution') {
      parsed.resolution = args[++i];
    } else if (arg === '--enable-web-search') {
      parsed.enableWebSearch = true;
    } else if (arg === '--no-generate-audio') {
      parsed.generateAudio = false;
    } else if (arg === '--metadata-output') {
      parsed.metadataOutput = args[++i];
    } else if (!arg.startsWith('-') && !parsed.input) {
      parsed.input = arg;
    }
  }

  if (!parsed.input) {
    printUsageAndExit();
  }

  return parsed;
}

function checkRequiredBinaries() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch (err) {
    console.error('Error: ffmpeg binary is required but not found in PATH.');
    process.exit(1);
  }
}

async function requestJson(url, method, token, payload = null) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const options = {
    method,
    headers,
  };

  if (payload) {
    options.body = JSON.stringify(payload);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} from ${url}: ${text}`);
  }
  return res.json();
}

async function pollPrediction(token, requestId) {
  const statusUrl = `${WAVESPEED_PREDICTION_BASE}/${requestId}`;
  while (true) {
    const status = await requestJson(statusUrl, 'GET', token);
    const state = status.status;
    if (state === 'completed' || state === 'failed') {
      return status;
    }
    await new Promise(resolve => setTimeout(resolve, WAVESPEED_POLL_INTERVAL_MS));
  }
}

async function fetchPredictionResult(token, requestId) {
  const resultUrl = `${WAVESPEED_PREDICTION_BASE}/${requestId}/result`;
  return requestJson(resultUrl, 'GET', token);
}

async function submitWavespeed(token, { prompt, duration, resolution, enableWebSearch, generateAudio, image, useTextToVideo }) {
  const payload = {
    duration,
    enable_web_search: enableWebSearch,
    generate_audio: generateAudio,
    prompt,
    resolution,
  };
  if (image) {
    payload.image = image;
  }
  const endpoint = useTextToVideo ? WAVESPEED_TEXT_TO_VIDEO : WAVESPEED_IMAGE_TO_VIDEO;
  return requestJson(endpoint, 'POST', token, payload);
}

function extractVideoUrl(response) {
  for (const key of ['video_url', 'url', 'download_url']) {
    if (response[key]) return response[key];
  }
  if (response.data) {
    for (const key of ['video_url', 'url', 'download_url']) {
      if (response.data[key]) return response.data[key];
    }
  }
  throw new Error(`Unable to find video URL in Wavespeed result: ${JSON.stringify(response)}`);
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buffer));
}

function extractTailFrame(videoPath, framePath) {
  const cmd = `ffmpeg -y -sseof -0.1 -i "${videoPath}" -vframes 1 "${framePath}"`;
  execSync(cmd, { stdio: 'ignore' });
}

async function uploadLitterbox(filePath) {
  const boundary = `----openclaw-${Math.random().toString(36).substring(2)}`;
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const payloadHeader = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="reqtype"',
    '',
    'fileupload',
    `--${boundary}`,
    'Content-Disposition: form-data; name="time"',
    '',
    '1h',
    `--${boundary}`,
    `Content-Disposition: form-data; name="fileToUpload"; filename="${fileName}"`,
    'Content-Type: image/jpeg',
    '',
    ''
  ].join('\r\n');

  const payloadFooter = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(payloadHeader, 'utf-8'),
    fileBuffer,
    Buffer.from(payloadFooter, 'utf-8')
  ]);

  const res = await fetch(LITTERBOX_API, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Litterbox upload failed: HTTP ${res.status}: ${errText}`);
  }

  const responseText = await res.text();
  const stripped = responseText.trim();
  if (stripped.startsWith('http')) {
    return stripped;
  }

  try {
    const parsed = JSON.parse(stripped);
    for (const key of ['url', 'file', 'data']) {
      if (parsed[key] && parsed[key].startsWith('http')) {
        return parsed[key];
      }
    }
  } catch (err) {
    // Ignore JSON parse error and throw
  }

  throw new Error(`Unexpected response from Litterbox: ${stripped}`);
}

function concatVideos(videoPaths, outputPath) {
  const tmpdir = fs.mkdtempSync(path.join(path.dirname(outputPath), 'concat-'));
  const listFile = path.join(tmpdir, 'concat.txt');
  const fileLines = videoPaths.map(p => `file '${path.resolve(p)}'`).join('\n') + '\n';
  fs.writeFileSync(listFile, fileLines, 'utf-8');

  try {
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outputPath}"`;
    execSync(cmd, { stdio: 'ignore' });
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (!parsed.apiKey) {
    console.error('Error: missing WAVESPEED_API_KEY. Provide via --api-key or set environment variable.');
    process.exit(1);
  }

  checkRequiredBinaries();

  const payload = JSON.parse(fs.readFileSync(parsed.input, 'utf-8'));
  const prompts = payload.prompts;
  if (!Array.isArray(prompts) || prompts.length === 0) {
    console.error('Error: input JSON must contain a non-empty prompts array');
    process.exit(1);
  }

  const outputDir = path.resolve(parsed.outputDir);
  const clipsDir = path.join(outputDir, 'clips');
  const framesDir = path.join(outputDir, 'tail-frames');

  fs.mkdirSync(clipsDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const rendered = [];
  const clipPaths = [];
  let prevTailUrl = null;

  for (let index = 0; index < prompts.length; index++) {
    const item = prompts[index];
    const shotId = item.shot_id;
    const prompt = item.prompt;

    if (!shotId || !prompt) {
      console.error(`Error: prompt item at index ${index} must contain shot_id and prompt`);
      process.exit(1);
    }

    const useTextToVideo = index === 0;
    const imageUrl = useTextToVideo ? null : prevTailUrl;

    if (!useTextToVideo && !imageUrl) {
      console.error(`Error: missing tail-frame URL for non-first shot (${shotId})`);
      process.exit(1);
    }

    console.log(`[${index + 1}/${prompts.length}] Submitting shot ${shotId}...`);
    const prediction = await submitWavespeed(parsed.apiKey, {
      prompt,
      duration: item.duration || parsed.duration,
      resolution: item.resolution || parsed.resolution,
      enableWebSearch: item.enable_web_search !== undefined ? item.enable_web_search : parsed.enableWebSearch,
      generateAudio: item.generate_audio !== undefined ? item.generate_audio : parsed.generateAudio,
      image: imageUrl,
      useTextToVideo,
    });

    const requestId = prediction.id || prediction.request_id || prediction.prediction_id;
    if (!requestId) {
      console.error(`Error: failed to get request ID from response: ${JSON.stringify(prediction)}`);
      process.exit(1);
    }

    console.log(`[${index + 1}/${prompts.length}] Shot ${shotId} prediction ID: ${requestId}. Polling status...`);
    const status = await pollPrediction(parsed.apiKey, requestId);
    if (status.status !== 'completed') {
      console.error(`Error: Wavespeed rendering failed or was canceled for shot ${shotId}:`, status);
      process.exit(1);
    }

    console.log(`[${index + 1}/${prompts.length}] Shot ${shotId} rendering complete. Retrieving result URL...`);
    const result = await fetchPredictionResult(parsed.apiKey, requestId);
    const videoUrl = extractVideoUrl(result);

    const clipPath = path.join(clipsDir, `${shotId}.mp4`);
    console.log(`[${index + 1}/${prompts.length}] Downloading shot ${shotId} clip...`);
    await downloadFile(videoUrl, clipPath);
    clipPaths.push(clipPath);

    const tailFramePath = path.join(framesDir, `${shotId}.jpg`);
    console.log(`[${index + 1}/${prompts.length}] Extracting tail frame from shot ${shotId}...`);
    extractTailFrame(clipPath, tailFramePath);

    console.log(`[${index + 1}/${prompts.length}] Uploading tail frame to Litterbox...`);
    prevTailUrl = await uploadLitterbox(tailFramePath);
    console.log(`[${index + 1}/${prompts.length}] Tail frame uploaded: ${prevTailUrl}`);

    rendered.push({
      shot_id: shotId,
      request_id: requestId,
      status: 'completed',
      video_url: videoUrl,
      local_clip: clipPath,
      tail_frame_local: tailFramePath,
      tail_frame_url: prevTailUrl,
    });
  }

  console.log(`Merging all clips into final output: ${parsed.finalOutput}`);
  concatVideos(clipPaths, parsed.finalOutput);
  console.log('Merge complete!');

  const result = {
    rendered_shots: rendered,
    final_video: {
      status: 'completed',
      local_path: path.resolve(parsed.finalOutput),
      artifact_url: '',
    },
  };

  if (parsed.metadataOutput) {
    fs.writeFileSync(parsed.metadataOutput, JSON.stringify(result, null, 2) + '\n', 'utf-8');
    console.log(`Metadata written to ${parsed.metadataOutput}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error('Fatal error occurred:', err);
  process.exit(1);
});
