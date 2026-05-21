#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <input-video> <output-image>" >&2
  exit 1
fi

input_video="$1"
output_image="$2"

ffmpeg -y -sseof -0.1 -i "$input_video" -vframes 1 "$output_image" >/dev/null 2>&1
