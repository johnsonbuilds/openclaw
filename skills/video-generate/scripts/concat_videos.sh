#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <output-video> <input-video-1> [input-video-2 ...]" >&2
  exit 1
fi

output_video="$1"
shift

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
list_file="$tmpdir/concat.txt"

: > "$list_file"
for video in "$@"; do
  printf "file '%s'\n" "$video" >> "$list_file"
done

ffmpeg -y -f concat -safe 0 -i "$list_file" -c copy "$output_video" >/dev/null 2>&1
