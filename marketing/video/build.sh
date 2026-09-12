#!/usr/bin/env bash
# ArcTools explainer (<= 60 s, 1280x720, 24 fps): robot intro -> real site screenshots with slow push-in -> robot outro.
# Timings follow the narration transcript (captions.json). Hard cuts only.
set -euo pipefail
cd "$(dirname "$0")"
FONT="/home/.hermes/skills/video-montage/scripts/fonts"
FPS=24
mkdir -p seg

# still -> Ken Burns clip. args: src dur out zoom_dir(in|out)
kb() {
  local src=$1 dur=$2 out=$3 dir=${4:-in}
  local z
  if [ "$dir" = in ]; then z="(1+0.05*t/$dur)"; else z="(1.05-0.05*t/$dur)"; fi
  # sub-pixel smooth: rescale the still every frame with a fractional factor, then center-crop; no zoompan rounding
  ffmpeg -y -loglevel error -loop 1 -framerate $FPS -i "$src" -f lavfi -i anullsrc=r=48000:cl=stereo \
    -vf "scale=1280:720:flags=lanczos,scale=w='trunc(1280*$z/2)*2':h='trunc(720*$z/2)*2':eval=frame:flags=bicubic,crop=1280:720:(iw-1280)/2:(ih-720)/2,format=yuv420p" \
    -t "$dur" -c:v libx264 -preset veryfast -crf 18 -c:a aac -b:a 128k -shortest "$out"
}
# robot clip -> 1280x720, own ambient audio at low volume, optional freeze-tail to reach dur
rb() {
  local src=$1 dur=$2 out=$3
  ffmpeg -y -loglevel error -i "$src" \
    -vf "scale=1280:720,fps=$FPS,tpad=stop_mode=clone:stop_duration=3,format=yuv420p" \
    -af "volume=0.35,apad=pad_dur=3" -t "$dur" -c:v libx264 -preset veryfast -crf 18 -c:a aac -b:a 128k -ar 48000 -ac 2 "$out"
}

rb robot1.mp4 5.44 seg/01.mp4
kb shots/trade.png     10.60 seg/02.mp4 in
kb shots/token.png      9.18 seg/03.mp4 out
kb shots/insiders.png   3.82 seg/04.mp4 in
kb shots/intel.png      5.00 seg/05.mp4 out
kb shots/feed.png       3.52 seg/06.mp4 in
kb shots/launchpad.png  5.94 seg/07.mp4 out
rb robot2.mp4 7.00 seg/08.mp4

: > seg/list.txt; for i in 01 02 03 04 05 06 07 08; do echo "file '$PWD/seg/$i.mp4'" >> seg/list.txt; done
ffmpeg -y -loglevel error -f concat -safe 0 -i seg/list.txt -c copy seg/visual.mp4

# narration on top (VO starts at 0), site watermark bottom-right, end card in the last 3 s
ffmpeg -y -loglevel error -i seg/visual.mp4 -i vo.wav \
  -filter_complex "[1:a]aresample=48000,volume=1.0[vo];[0:a][vo]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a];\
[0:v]drawtext=fontfile=$FONT/Metropolis-Bold.ttf:text='arctools.fun':fontsize=26:fontcolor=white@0.85:x=w-tw-28:y=h-th-24:enable='between(t,5.4,47)',\
drawtext=fontfile=$FONT/Metropolis-ExtraBold.ttf:text='ARCTOOLS.FUN':fontsize=88:fontcolor=white:borderw=2:bordercolor=black@0.6:x=(w-tw)/2:y=h*0.62:enable='gte(t,47.4)',\
drawtext=fontfile=$FONT/Metropolis-Bold.ttf:text='Trade the whole chain':fontsize=34:fontcolor=#2f7ff5:x=(w-tw)/2:y=h*0.62+100:enable='gte(t,48.1)'[v]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 160k -movflags +faststart final_nocap.mp4

# captions: captions.ass (lower-third bar, generated from captions.json)
ffmpeg -y -loglevel error -i final_nocap.mp4 -vf "ass=captions.ass:fontsdir=$FONT" -c:v libx264 -preset medium -crf 18 -c:a copy -movflags +faststart arctools-explainer.mp4
ffprobe -v error -show_entries format=duration:stream=width,height -of csv=p=0 arctools-explainer.mp4
