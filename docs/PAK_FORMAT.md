# `.pak` archives

The game's data (inis, meshes, textures, animations, interface movies) is in the `.pak` archives under `<game>/Data/pak`. `tools/pak_extract.py`
lists and extracts them; `web/src/assets/Pak.ts` reads them in the browser, one entry at a time. Both read versions 5 and 6. The older version-4
archive (`premium_costumes`) is not supported.

## Layout (version 5, checked on the shipped archives)

```
header  u32 version (5), u32 end, u32 0, u32 file count, u32 256, u32 directory count, u32 ?, u32 0, u32 0, u32 0,
        u32 entry table offset (0x34), u32 directory index offset, u32 directory name table offset
entry   56 bytes at entry table + 56*i:
        u32 path hash, u32 second hash (not decoded), u32 chunk offset, u32 chunk compressed size, u32 uncompressed size, u32 flags,
        char name[32] (zero padded; names of 32 characters or more are cut)
chunk   at the chunk offset: u32 chunk size, u32 uncompressed size, u32, u32 stored flag (1: raw bytes follow, 0: a zlib stream)
```

**Directories.** The directory name table holds `directory count` NUL-separated names such as `data\textures\hair\`. An entry's first `u32` is the string
hash of its full path, `h = h*0x17 + (c & ~0x20)` over `directory + name` (the same hash as the saved-game variable tags, `SAVE_FORMAT.md`), so an entry's
directory is the name whose hash matches. Names are matched on the 32-character file name, so a name cut at 32 characters may not resolve.

**Same name, different directory.** Many names repeat: `hair_50s_m1.dds` is a 512 x 512 texture in `data\textures\hair\` and a 128 x 128 icon in
`data\textures\thumbs\hair\`. Archives override each other only for the same directory and name. `pak_extract.py` writes extra copies as `name.2`, `name.3`
in directory order, or `<out>/<directory>/<name>` with `--tree`; the web reader takes a directory with every lookup.

**Patch archives.** The `Addon_*` archives (the 2006 patch) override earlier files; when several archives hold the same entry, the newest one wins.

**zlib padding.** Chunks (and `zcmp` files inside them) carry padding after the zlib stream. Strict decoders such as the browser's `DecompressionStream`
reject that, so the web app uses fflate.

```
python3 tools/pak_extract.py list    "<game>/Data/pak" [glob]
python3 tools/pak_extract.py extract "<game>/Data/pak" data/game_data <glob> [<glob> ...] [--tree]
```

Extracted files are game assets: keep them under `data/` (gitignored).

## What the code adds

From the decompile (not needed to read the archives, but it explains the fields):

- **Discovery** (`PakFiles_Discover`): scans `data\Pak\*.*pak`, then `*.cpak` in the common application-data folder (`...\Lionhead Studios\TheMovies\`,
  CSIDL `0x23`). `.cpak` files are user content and go through their own loader (`FUN_00aafc30`).
- **Loading** (`PakSystem_AddPak`): at most 4,094 archives. Each gets a sequential index (`DAT_010b9360`) that is XORed into each entry's flags (bits 15 to 26,
  read back as `(flags >> 15) & 0xfff`), so an entry remembers its archive. The archive's `FILE*` stays open at `+0x28`; `+0x24` is 1, or 2 for version 6.
- **Header parse** (`PakHeader_Parse`, at least 0x34 bytes): versions 4, 5 and 6 are accepted. In version 4 the entry table, 8-byte table and string blob offsets
  are at 0x1c to 0x24; in 5 and 6 three more dwords come first and the offsets are at 0x28 to 0x30. `+0x10` is the count of 8-byte records in a second table.
- **Paths** (`PakPath_StripToDataRelative`, `FUN_00ab0150`): lower-cased and cut to the part after `data\`. A file-type check knows `.msh`, `.pak`, `.cpak`,
  `.exe`, `.avi`, `.wmv` and `.fnt`, and treats `head_` and `cos_` meshes with `_fat` and `_enh` suffixes specially (body-size and enhanced costume variants).
  Numbered archive names are built with `"%s\%s%s%04d.pak"`.

## Not known

- The second hash in an entry, the third `u32` of a chunk, the 8-byte table.
- The version-4 layout in detail, and the `.cpak` loader.
