#!/usr/bin/env python3
"""
Orchestrate Wavespeed shot rendering, tail-frame handoff, and final concatenation.

Expected input is a JSON file with at least:
- goal
- prompts: [{"shot_id": "...", "prompt": "...", ...}]

Optional fields/args:
- --api-key: Wavespeed API key (defaults to WAVESPEED_API_KEY env)
- --output-dir: Working directory (default: ./video-render-output)
- --final-output: Merged output video path (default: ./final-video.mp4)
- --duration: Default duration for each shot (default: 5)
- --resolution: Default Wavespeed resolution (default: "720p")
- --enable-web-search: Default false
- --no-generate-audio: Default false
- --metadata-output: Write render metadata JSON to this file path
"""

import os
import sys
import json
import time
import argparse
import subprocess
import tempfile
import urllib.request
import urllib.error

WAVESPEED_POLL_INTERVAL_S = 1.5
WAVESPEED_PREDICTION_BASE = "https://api.wavespeed.ai/api/v3/predictions"
WAVESPEED_TEXT_TO_VIDEO = "https://api.wavespeed.ai/api/v3/bytedance/seedance-2.0/text-to-video"
WAVESPEED_IMAGE_TO_VIDEO = "https://api.wavespeed.ai/api/v3/bytedance/seedance-2.0/image-to-video"
LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Orchestrate Wavespeed shot rendering, tail-frame handoff, and final concatenation."
    )
    parser.add_argument("input", help="Input JSON file path")
    parser.add_argument(
        "--api-key",
        default=os.environ.get("WAVESPEED_API_KEY"),
        help="Wavespeed API key (or set WAVESPEED_API_KEY env)",
    )
    parser.add_argument(
        "--output-dir",
        default="./video-render-output",
        help="Working directory for clips and frames",
    )
    parser.add_argument(
        "--final-output",
        default="./final-video.mp4",
        help="Merged output video path",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=5,
        help="Default duration in seconds",
    )
    parser.add_argument(
        "--resolution",
        default="720p",
        help="Default resolution",
    )
    parser.add_argument(
        "--enable-web-search",
        action="store_true",
        help="Enable web search in generation",
    )
    parser.add_argument(
        "--no-generate-audio",
        action="store_true",
        help="Disable audio generation",
    )
    parser.add_argument(
        "--metadata-output",
        help="Output file for execution metadata JSON",
    )

    return parser.parse_args()


def check_required_binaries():
    try:
        subprocess.run(
            ["ffmpeg", "-version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        print("Error: ffmpeg binary is required but not found in PATH.", file=sys.stderr)
        sys.exit(1)


def request_json(url, method, token, payload=None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            res_data = response.read().decode("utf-8")
            return json.loads(res_data)
    except urllib.error.HTTPError as e:
        err_data = e.read().decode("utf-8")
        raise RuntimeError(f"HTTP {e.code} from {url}: {err_data}")


def poll_prediction(token, request_id):
    status_url = f"{WAVESPEED_PREDICTION_BASE}/{request_id}"
    while True:
        status = request_json(status_url, "GET", token)
        state = status.get("status")
        if state in ("completed", "failed"):
            return status
        time.sleep(WAVESPEED_POLL_INTERVAL_S)


def fetch_prediction_result(token, request_id):
    result_url = f"{WAVESPEED_PREDICTION_BASE}/{request_id}/result"
    return request_json(result_url, "GET", token)


def submit_wavespeed(token, prompt, duration, resolution, enable_web_search, generate_audio, image, use_text_to_video):
    payload = {
        "duration": duration,
        "enable_web_search": enable_web_search,
        "generate_audio": generate_audio,
        "prompt": prompt,
        "resolution": resolution,
    }
    if image:
        payload["image"] = image

    endpoint = WAVESPEED_TEXT_TO_VIDEO if use_text_to_video else WAVESPEED_IMAGE_TO_VIDEO
    return request_json(endpoint, "POST", token, payload)


def extract_video_url(response):
    for key in ("video_url", "url", "download_url"):
        if response.get(key):
            return response[key]
    if "data" in response and isinstance(response["data"], dict):
        for key in ("video_url", "url", "download_url"):
            if response["data"].get(key):
                return response["data"][key]
    raise RuntimeError(f"Unable to find video URL in Wavespeed result: {json.dumps(response)}")


def download_file(url, dest_path):
    try:
        with urllib.request.urlopen(url) as response:
            with open(dest_path, "wb") as f:
                f.write(response.read())
    except Exception as e:
        raise RuntimeError(f"Failed to download {url}: {e}")


def extract_tail_frame(video_path, frame_path):
    cmd = ["ffmpeg", "-y", "-sseof", "-0.1", "-i", video_path, "-vframes", 1, frame_path]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def upload_litterbox(file_path):
    import random
    import string

    boundary = f"----openclaw-{''.join(random.choices(string.ascii_lowercase + string.digits, k=16))}"
    file_name = os.path.basename(file_path)

    with open(file_path, "rb") as f:
        file_buffer = f.read()

    payload_header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="reqtype"\r\n\r\n'
        f"fileupload\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="time"\r\n\r\n'
        f"1h\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="fileToUpload"; filename="{file_name}"\r\n'
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode("utf-8")

    payload_footer = f"\r\n--{boundary}--\r\n".encode("utf-8")

    body = payload_header + file_buffer + payload_footer

    req = urllib.request.Request(
        LITTERBOX_API,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode("utf-8").strip()
    except urllib.error.HTTPError as e:
        err_text = e.read().decode("utf-8")
        raise RuntimeError(f"Litterbox upload failed: HTTP {e.code}: {err_text}")

    if response_text.startswith("http"):
        return response_text

    try:
        parsed = json.loads(response_text)
        for key in ("url", "file", "data"):
            if parsed.get(key) and parsed[key].startswith("http"):
                return parsed[key]
    except Exception:
        pass

    raise RuntimeError(f"Unexpected response from Litterbox: {response_text}")


def concat_videos(video_paths, output_path):
    with tempfile.TemporaryDirectory() as tmpdir:
        list_file = os.path.join(tmpdir, "concat.txt")
        with open(list_file, "w", encoding="utf-8") as f:
            for p in video_paths:
                abs_p = os.path.abspath(p)
                # ffmpeg concat list escape single quotes
                escaped_p = abs_p.replace("'", "'\\''")
                f.write(f"file '{escaped_p}'\n")

        cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", output_path]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def main():
    args = parse_args()

    if not args.api_key:
        print("Error: missing WAVESPEED_API_KEY. Provide via --api-key or set environment variable.", file=sys.stderr)
        sys.exit(1)

    check_required_binaries()

    with open(args.input, "r", encoding="utf-8") as f:
        payload = json.load(f)

    prompts = payload.get("prompts")
    if not isinstance(prompts, list) or len(prompts) == 0:
        print("Error: input JSON must contain a non-empty prompts array", file=sys.stderr)
        sys.exit(1)

    output_dir = os.path.abspath(args.output_dir)
    clips_dir = os.path.join(output_dir, "clips")
    frames_dir = os.path.join(output_dir, "tail-frames")

    os.makedirs(clips_dir, exist_ok=True)
    os.makedirs(frames_dir, exist_ok=True)

    rendered = []
    clip_paths = []
    prev_tail_url = None

    for index, item in enumerate(prompts):
        shot_id = item.get("shot_id")
        prompt = item.get("prompt")

        if not shot_id or not prompt:
            print(f"Error: prompt item at index {index} must contain shot_id and prompt", file=sys.stderr)
            sys.exit(1)

        use_text_to_video = (index == 0)
        image_url = None if use_text_to_video else prev_tail_url

        if not use_text_to_video and not image_url:
            print(f"Error: missing tail-frame URL for non-first shot ({shot_id})", file=sys.stderr)
            sys.exit(1)

        print(f"[{index + 1}/{len(prompts)}] Submitting shot {shot_id}...")
        
        duration = item.get("duration", args.duration)
        resolution = item.get("resolution", args.resolution)
        
        enable_web_search = args.enable_web_search
        if "enable_web_search" in item:
            enable_web_search = item["enable_web_search"]
            
        generate_audio = not args.no_generate_audio
        if "generate_audio" in item:
            generate_audio = item["generate_audio"]

        prediction = submit_wavespeed(
            token=args.api_key,
            prompt=prompt,
            duration=duration,
            resolution=resolution,
            enable_web_search=enable_web_search,
            generate_audio=generate_audio,
            image=image_url,
            use_text_to_video=use_text_to_video,
        )

        request_id = prediction.get("id") or prediction.get("request_id") or prediction.get("prediction_id")
        if not request_id:
            print(f"Error: failed to get request ID from response: {json.dumps(prediction)}", file=sys.stderr)
            sys.exit(1)

        print(f"[{index + 1}/{len(prompts)}] Shot {shot_id} prediction ID: {request_id}. Polling status...")
        status = poll_prediction(args.api_key, request_id)
        if status.get("status") != "completed":
            print(f"Error: Wavespeed rendering failed or was canceled for shot {shot_id}:", status, file=sys.stderr)
            sys.exit(1)

        print(f"[{index + 1}/{len(prompts)}] Shot {shot_id} rendering complete. Retrieving result URL...")
        result = fetch_prediction_result(args.api_key, request_id)
        video_url = extract_video_url(result)

        clip_path = os.path.join(clips_dir, f"{shot_id}.mp4")
        print(f"[{index + 1}/{len(prompts)}] Downloading shot {shot_id} clip...")
        download_file(video_url, clip_path)
        clip_paths.push(clip_path) if hasattr(clip_paths, 'push') else clip_paths.append(clip_path)

        tail_frame_path = os.path.join(frames_dir, f"{shot_id}.jpg")
        print(f"[{index + 1}/{len(prompts)}] Extracting tail frame from shot {shot_id}...")
        extract_tail_frame(clip_path, tail_frame_path)

        print(f"[{index + 1}/{len(prompts)}] Uploading tail frame to Litterbox...")
        prev_tail_url = upload_litterbox(tail_frame_path)
        print(f"[{index + 1}/{len(prompts)}] Tail frame uploaded: {prev_tail_url}")

        rendered.append({
            "shot_id": shot_id,
            "request_id": request_id,
            "status": "completed",
            "video_url": video_url,
            "local_clip": clip_path,
            "tail_frame_local": tail_frame_path,
            "tail_frame_url": prev_tail_url,
        })

    final_output_path = os.path.abspath(args.final_output)
    print(f"Merging all clips into final output: {final_output_path}")
    concat_videos(clip_paths, final_output_path)
    print("Merge complete!")

    output_meta = {
        "rendered_shots": rendered,
        "final_video": {
            "status": "completed",
            "local_path": final_output_path,
            "artifact_url": "",
        },
    }

    if args.metadata_output:
        with open(args.metadata_output, "w", encoding="utf-8") as f:
            json.dump(output_meta, f, indent=2)
            f.write("\n")
        print(f"Metadata written to {args.metadata_output}")
    else:
        print(json.dumps(output_meta, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("Fatal error occurred:", e, file=sys.stderr)
        sys.exit(1)
