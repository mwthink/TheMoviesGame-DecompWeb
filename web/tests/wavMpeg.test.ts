import assert from "node:assert/strict";
import { test } from "node:test";
import { readWav } from "../src/formats/WavMpeg.ts";

/** A RIFF/WAVE file with an MPEG-layout `fmt ` chunk (30 bytes, as the speech banks have it) and a `data` chunk. */
function wave(tag: number, data: number[], fmtSize = 30): Uint8Array {
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 255, v >> 8);
  const u32 = (v: number) => out.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  const text = (s: string) => out.push(...[...s].map((c) => c.charCodeAt(0)));
  text("RIFF"); u32(0); text("WAVE");
  text("fmt "); u32(fmtSize); u16(tag); u16(1); u32(44100); u32(16000); u16(1); u16(0);
  for (let i = 16; i < fmtSize; i++) out.push(0);
  if (fmtSize & 1) out.push(0);
  text("data"); u32(data.length); out.push(...data);
  return Uint8Array.from(out);
}

test("a speech clip's wave header: Layer II tag, mono 44.1 kHz, and where the MPEG frames are", () => {
  const info = readWav(wave(0x50, [0xff, 0xfd, 1, 2, 3]));
  assert.ok(info);
  assert.equal(info.formatTag, 0x50);
  assert.equal(info.channels, 1);
  assert.equal(info.sampleRate, 44100);
  assert.deepEqual([info.dataOffset, info.dataSize], [12 + 8 + 30 + 8, 5]);
});

test("an odd-sized chunk is padded, a short data chunk is clipped to the file, and a non-wave is refused", () => {
  assert.equal(readWav(wave(1, [1, 2], 17))?.dataSize, 2);
  const cut = wave(0x50, [1, 2, 3, 4]).subarray(0, 12 + 8 + 30 + 8 + 2);
  assert.equal(readWav(cut)?.dataSize, 2);
  assert.equal(readWav(new Uint8Array(40)), null);
});

// A real Layer II stream made by ffmpeg from a 440 Hz tone (our own signal, not game audio), wrapped as the speech banks wrap theirs.
import { spawnSync } from "node:child_process";
import { decodeWavMpeg } from "../src/formats/WavMpeg.ts";
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 ? false : "ffmpeg not installed";

test("a Layer II clip in a wave file decodes to the tone it was made from", { skip: ffmpeg }, async () => {
  const run = spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5:sample_rate=44100", "-ac", "1", "-c:a", "mp2", "-b:a", "64k", "-f", "mp2", "-"], { maxBuffer: 1 << 24 });
  const frames = Uint8Array.from(run.stdout);
  assert.ok(frames.length > 1000);
  const wav = wave(0x50, [...frames]);
  const out = await decodeWavMpeg(wav);
  assert.ok(out);
  assert.equal(out.sampleRate, 44100);
  assert.equal(out.channelData.length, 1);
  const s = out.channelData[0]!;
  assert.ok(s.length > 20000 && s.length < 24000, `${s.length} samples`);
  // count rising zero crossings in the steady part: 440 Hz is about 0.25 s x 440 = 110 of them in half a second
  let crossings = 0;
  for (let i = 4000; i < s.length - 1; i++) if (s[i]! < 0 && s[i + 1]! >= 0) crossings++;
  const seconds = (s.length - 4000) / 44100;
  assert.ok(Math.abs(crossings / seconds - 440) < 15, `${crossings / seconds} Hz`);
  // a second clip through the same decoder, and a PCM clip is left to the browser
  assert.ok(await decodeWavMpeg(wav));
  assert.equal(await decodeWavMpeg(wave(1, [0, 0, 0, 0])), null);
});
