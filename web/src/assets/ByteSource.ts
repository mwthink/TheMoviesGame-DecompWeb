/** Random access to a big binary file, without loading all of it. Pak archives are hundreds of MB, so everything reads ranges. */
export interface ByteSource {
  readonly name: string;
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** A File or Blob chosen by the user (file picker, directory handle). Reads slices lazily. */
export class BlobSource implements ByteSource {
  readonly name: string;
  readonly size: number;
  private readonly blob: Blob;

  constructor(name: string, blob: Blob) {
    this.name = name;
    this.blob = blob;
    this.size = blob.size;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(this.size, offset + length);
    return new Uint8Array(await this.blob.slice(offset, end).arrayBuffer());
  }
}

/** A file served over HTTP with Range support (the dev server's local-files endpoint). */
export class HttpSource implements ByteSource {
  readonly name: string;
  readonly size: number;
  private readonly url: string;

  private constructor(name: string, url: string, size: number) {
    this.name = name;
    this.url = url;
    this.size = size;
  }

  static async open(name: string, url: string): Promise<HttpSource> {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return new HttpSource(name, url, Number(res.headers.get("content-length")));
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(this.size, offset + length) - 1;
    const res = await fetch(this.url, { headers: { Range: `bytes=${offset}-${end}` } });
    if (!res.ok) throw new Error(`${this.url}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
