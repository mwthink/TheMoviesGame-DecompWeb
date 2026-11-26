import { decodeWavMpeg } from "../formats/WavMpeg.ts";

/**
 * A speech or ambience clip as an `AudioBuffer`. The banks' clips are RIFF/WAVE, but the speech banks hold MPEG Layer II (format tag 0x50), which the browser's
 * own decoder refuses; those go through `mpg123-decoder`, the rest (PCM) through `decodeAudioData`.
 */
export async function decodeClip(context: BaseAudioContext, wav: Uint8Array): Promise<AudioBuffer> {
  const mpeg = await decodeWavMpeg(wav);
  if (!mpeg) return context.decodeAudioData(wav.slice().buffer);
  const frames = mpeg.channelData[0]?.length ?? 0;
  const buffer = context.createBuffer(mpeg.channelData.length, frames, mpeg.sampleRate);
  mpeg.channelData.forEach((samples, i) => buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, i));
  return buffer;
}
