import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { resolveAppCompositionGeometry } from "@/lib/app-studio/composition";

const execFileAsync = promisify(execFile);
// Pinned binary resolution
let ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
let ffprobePath = process.env.FFPROBE_PATH || "ffprobe";

if (ffmpegStatic && typeof ffmpegStatic === "string" && fs.existsSync(ffmpegStatic)) ffmpegPath = ffmpegStatic;
if (ffprobeInstaller?.path && fs.existsSync(ffprobeInstaller.path)) ffprobePath = ffprobeInstaller.path;

/**
 * Pinned FFmpeg & FFprobe Runner.
 * Section 19 Compliance: Array arguments, no shell interpolation, H.264/AAC MP4 encoding.
 */

export async function runFfprobe(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`FFprobe target file does not exist: ${filePath}`);
  }

  const args = [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];

  try {
    const { stdout } = await execFileAsync(ffprobePath, args, { timeout: 15000 });
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`FFPROBE_FAILED: ${err.message}`);
  }
}

export async function extractVerificationFrames(filePath, outputDirectory, frameCount = 4) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const pattern = `${outputDirectory}/frame_%02d.jpg`;
  const args = ["-v", "error", "-i", filePath, "-vf", `fps=1/3,scale=480:-2`, "-frames:v", String(frameCount), "-q:v", "3", "-y", pattern];
  try {
    await execFileAsync(ffmpegPath, args, { timeout: 30000 });
  } catch (error) {
    throw new Error(`KEYFRAME_EXTRACTION_FAILED: ${error.message}`);
  }
  return fs.readdirSync(outputDirectory).filter((name) => /^frame_\d+\.jpg$/.test(name)).sort().map((name) => `${outputDirectory}/${name}`);
}

export async function composeExactBroll({ baseVideoPath, brollInputs, outputPath, durationSeconds, width, height, composition = "INSERT" }) {
  if (!brollInputs.length) return baseVideoPath;
  const normalizedComposition = ["PIP", "SIDE_BY_SIDE", "INSERT", "FULL_SCREEN"].includes(composition) ? composition : "INSERT";
  const args = ["-v", "error", "-i", baseVideoPath];
  for (const input of brollInputs) {
    if (input.isVideo) args.push("-stream_loop", "-1", "-i", input.path);
    else args.push("-loop", "1", "-i", input.path);
  }
  const firstStart = Math.max(0.8, durationSeconds * 0.25);
  const availableDuration = Math.max(0.6, durationSeconds - firstStart - 0.5);
  const segmentLength = Math.min(2, availableDuration / brollInputs.length);
  const filters = [];
  let previous = "0:v";
  brollInputs.forEach((_input, index) => {
    const start = firstStart + index * segmentLength;
    const end = Math.min(durationSeconds - 0.5, start + segmentLength);
    const prepared = `b${index}`;
    const output = `v${index}`;
    const { targetWidth, targetHeight, overlayX, overlayY } = resolveAppCompositionGeometry(normalizedComposition, width, height);
    filters.push(`[${index + 1}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,setpts=PTS-STARTPTS+${start}/TB[${prepared}]`);
    filters.push(`[${previous}][${prepared}]overlay=${overlayX}:${overlayY}:enable='between(t,${start},${end})':eof_action=pass[${output}]`);
    previous = output;
  });
  args.push("-filter_complex", filters.join(";"), "-map", `[${previous}]`, "-map", "0:a?", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", String(durationSeconds), "-y", outputPath);
  try {
    await execFileAsync(ffmpegPath, args, { timeout: 120000 });
    return outputPath;
  } catch (error) {
    throw new Error(`HYBRID_COMPOSITION_FAILED: ${error.message}`);
  }
}

export async function renderAppStudioVideo({
  screenRecordingPath,
  voiceoverAudioPath = null,
  outputPath,
  aspectRatio = "9:16",
  mode = "FULL_SCREEN",
}) {
  const args = [];

  // Input 1: Screen recording / base image
  if (screenRecordingPath && fs.existsSync(screenRecordingPath)) {
    args.push("-i", screenRecordingPath);
  } else {
    args.push("-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30");
  }

  // Input 2: Audio voiceover
  if (voiceoverAudioPath && fs.existsSync(voiceoverAudioPath)) {
    args.push("-i", voiceoverAudioPath);
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
  }

  const scaleFilter =
    aspectRatio === "9:16"
      ? "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2"
      : "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2";

  args.push(
    "-vf",
    scaleFilter,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-t",
    "5",
    "-y",
    outputPath
  );

  const sanitizedCmd = `${ffmpegPath} ${args.join(" ")}`;

  try {
    const { stdout, stderr } = await execFileAsync(ffmpegPath, args, { timeout: 45000 });
    return {
      sanitizedCmd,
      outputPath,
      stdout,
      stderr,
    };
  } catch (err) {
    throw new Error(`APP_STUDIO_RENDER_FAILED: ${err.message}`);
  }
}
