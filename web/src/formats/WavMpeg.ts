/**
 * The speech banks' clips are RIFF/WAVE files whose format tag is 0x50, MPEG-1 Layer II (`CodecFormat_DetectFromHeader`, orig: 0x00BBA8C0; docs/AUDIO.md,
 * "Codec detection"). Browsers decode PCM WAVE but not that, so the raw MPEG frames in the `data` chunk are taken out here for a decoder. Plain bytes, no browser APIs.
 */

export interface WavInfo {
  /** The `fmt ` chunk's format tag: 1 PCM, 0x50 MPEG Layer II, 0x69 Xbox ADPCM. */
  formatTag: number;
  channels: number;
  sampleRate: number;
  /** Where the `data` chunk's bytes start and how many there are. */
  dataOffset: number;
  dataSize: number;
}

/** Read a RIFF/WAVE file's format and the position of its sample data, or null when it is not one. */
export function readWav(b: Uint8Array): WavInfo | null {
  if (b.byteLength < 12) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const id = (o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
  if (id(0) !== "RIFF" || id(8) !== "WAVE") return null;
  let formatTag = 0, channels = 0, sampleRate = 0;
  let o = 12;
  while (o + 8 <= b.byteLength) {
    const size = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id(o) === "fmt " && body + 8 <= b.byteLength) {
      formatTag = dv.getUint16(body, true);
      channels = dv.getUint16(body + 2, true);
      sampleRate = dv.getUint32(body + 4, true);
    } else if (id(o) === "data") {
      return { formatTag, channels, sampleRate, dataOffset: body, dataSize: Math.min(size, b.byteLength - body) };
    }
    o = body + size + (size & 1); // chunks are padded to an even size
  }
  return null;
}

export interface DecodedAudio {
  /** One array of samples (-1..1) per channel. */
  channelData: Float32Array[];
  sampleRate: number;
}

type Mpeg = { ready: Promise<void>; reset(): Promise<void>; decode(data: Uint8Array): DecodedAudio & { samplesDecoded: number } };
let decoder: Promise<Mpeg> | null = null;

/** Decode a clip whose format tag is 0x50 (MPEG Layer II) with `mpg123-decoder` (WebAssembly; the one decoder is kept and reset between clips). Null for anything else. */
export async function decodeWavMpeg(b: Uint8Array): Promise<DecodedAudio | null> {
  const info = readWav(b);
  if (!info || info.formatTag !== 0x50) return null;
  decoder ??= (async () => {
    const { MPEGDecoder } = await import("mpg123-decoder");
    const d = new MPEGDecoder() as unknown as Mpeg;
    await d.ready;
    return d;
  })();
  const d = await decoder;
  await d.reset();
  const out = d.decode(b.subarray(info.dataOffset, info.dataOffset + info.dataSize));
  if (!out.samplesDecoded) throw new Error("the MPEG decoder found no audio in the clip");
  // the decoder always writes two channels; a mono clip's second is a copy of the first
  const channels = info.channels > 0 ? Math.min(info.channels, out.channelData.length) : out.channelData.length;
  return { channelData: out.channelData.slice(0, channels), sampleRate: out.sampleRate };
}
