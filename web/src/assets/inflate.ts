import { unzlibSync } from "fflate";

/**
 * Inflate a zlib stream (RFC 1950), as used by pak chunks and `zcmp` files. The streams in the paks are followed by padding, which the
 * browser's built-in DecompressionStream rejects, so this uses fflate (small, synchronous, ignores trailing bytes).
 * `size`, when known, lets it allocate the output once.
 */
export function inflate(data: Uint8Array, size?: number): Uint8Array {
  return size === undefined ? unzlibSync(data) : unzlibSync(data, { out: new Uint8Array(size) });
}

/** Many game files (meshes, animations) are wrapped as "zcmp" + 16 bytes + a zlib stream. Plain files pass through. */
export function unwrapZcmp(data: Uint8Array): Uint8Array {
  if (data.length > 20 && data[0] === 0x7a && data[1] === 0x63 && data[2] === 0x6d && data[3] === 0x70) {
    return inflate(data.subarray(20));
  }
  return data;
}
