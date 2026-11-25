# Audio: `.lug` sound banks, the radio and the timeline announcements

Status: read from the decompile. Nothing here is checked against a running game yet, and no `.lug` reader exists in the tools or the web app.
The codec libraries the audio engine is built on (libogg, libvorbis, zlib, the Lionhead `PK*` / `LLA` / `LHA` layers) are described in
`LIBRARIES.md`; this page covers the game's own formats and logic.

## `.lug` sound banks

A `.lug` file is a Lionhead segment container: the 8-byte magic `"LiOnHeAd"`, then segments of `char[32]` name (zero padded), `u32` size and
the payload, to the end of the file. The same container is used by *Black & White*'s `LHFile` and *Fable*'s banks (`LIBRARIES.md`). The reader is
`CLHSegmentReader` (`LH_DecodeSegmentStructure`, `00c0a430`: checks the header with `LH_VerifyLUGHeader`, reads each segment with
`LH_GetFirstSegmentInfo`, `00c0a370`, and records offset and size in a 0x28-byte directory node).

`LH_LoadLUGAsset` (`00c009c0`) loads a bank. An auto-detecting entry point, `LH_LoadLUGAsset_AutoDetectFormat` (`00bd2b70`), reads the first
segment; if it is not the classic bank-info segment it takes a newer single-blob "META Data" route (`LH_LoadMetFile`,
`LH_DeserializeMetaDataSegment`, `00c05390`) that is not decoded.

### Load order

Each step checks `LH_CheckLoadStatus`.

1. `LH_DecodeSegmentStructure`: builds the segment directory.
2. `LH_LoadGlobalProperties` (`00bff9d0`): segment `LHAudioBankGlobalProps`, read with `LH_SerializeGlobalProperties`. A missing segment means defaults.
3. `LH_ValidateFileBank` (`00bffb00`): the bank-info segment `LHFileSegmentBankInfo`. `LH_GetFileSegmentBankInfo` (`00bd1ef0`) seeks to **offset 0x208**
   in it and reads a `u32` version, which must be 0 (a "normal LUG"). The 0x208 bytes before it are the bank title. `LH_IsNormalLUG` also requires the
   wave-data and sample-table segments.
4. `LH_OpenWavSegment`: opens `LHAudioWaveData` and gets its base offset.
5. `LH_LoadSampleBankTable` (`00bffe70`): segment `LHAudioBankSampleTable`. A `u32` count masked to 16 bits (at most 65,535 samples), then `count`
   records of **0x28c bytes**. (Fable's files have a second `u16` after the count that nobody has explained; the mask ignores it.)
6. `LH_ExtractResources` (`00c00480`): a 0x24-byte `LH_ResourceHeader` per sample record. Records with id 0 are skipped; a duplicate id logs
   `"Resource collision, id (...)"` and is dropped.
7. `LH_BuildDriverTable` (`00c00660`): a driver entry per sample (below).
8. `LH_LoadRLMParams`: an optional RLM-parameters segment, applied by `FUN_00bffdd0`.
9. `LH_LoadBankCriteriaInfo` (`00c00080`): segment `LHAudioBankCriteiaInfo`. **The missing "r" is in the shipped data**, so a reader or writer must keep
   it. Layout: `u32` count, then per entry a `u32` length and a tag string (`00bbfe60`) and a `u32` count with that many sample ids (`00c03440`). The tags are
   semicolon-joined event criteria (Fable's example: `SI_HERO;SE_FOOTSTEP;MATERIAL_GRASS`). `LH_BuildTriggersFromCriteria` turns them into triggers.

All of these go through one bidirectional archive object (field `+4` is 0 when loading, `LH_Archive_IsLoading`), so the same serializer reads and
writes. The write side is `LH_BuildLUGAsset` (`00bd34d0`) with matching `LH_Save*` functions.

### Sample record (0x28c bytes)

| Offset | Meaning |
|---|---|
| 0x000 | name (up to 0x104 bytes) |
| 0x104 | resource id; the record is skipped when 0 |
| 0x108 | wave id: equal to the id for a real clip; a different value makes the record an alias of another clip, and aliases are not extracted again |
| 0x10c | uncompressed (RIFF) size |
| 0x110 | data offset inside the wave-data segment (the loader adds the segment base) |
| 0x124 | wave format tag (`u16`) |
| 0x126 | channel count (`u16`) |
| 0x128 | sample rate (`u32`) |
| 0x138, 0x13c | loop start and end (-1 = no loop in Fable's files) |
| 0x140 | group / category name, 256 bytes |
| 0x240-0x27c | the parameter block, below |

The clips are RIFF/WAVE files packed back to back in the wave-data segment.

### Parameter block (`LH_BuildDriverTable`)

Each sample record becomes a 0x48-byte driver object. The `u32` at `+0x244` is a flags word saying which optional fields are present. What each field
does during playback is inferred from how it is used, not confirmed; the values in brackets are what Fable's files hold there.

| Record offset | Used as |
|---|---|
| 0x104 / 0x108 | driver +4 / +8: id and wave id |
| 0x118 | two words: the low one to driver word 0xb, the high one to word 0xa [`0x10000`, `0`, `40000`] |
| 0x140 | the group name, copied into the driver |
| 0x240 | `u32`, default 1 when 0; a priority or weight [1, 300, 1000] |
| 0x244 | flags word |
| 0x248 | `u32`, used if flag `0x40` |
| 0x250, 0x254 | words, used if flags `0x4` and `0x8` |
| 0x258 | bits 1 and 2 become driver flags 1 and 2, if flag `0x10` |
| 0x25c, 0x25e | a range: both words if flags `0x20` and `0x1000`, one word for both ends if only one flag, 0x7f..0x7f if neither; swapped so low <= high |
| 0x260 | word if flag `0x1`, otherwise 100 |
| 0x264 | word, always copied |
| 0x268 | `f32` if flag `0x80`: a minimum distance [3.0, 5.0] |
| 0x26c | `f32` if flag `0x100`: a maximum distance [25.0, 35.0] |
| 0x270, 0x272 | two words to driver words 0 and 1; percentages up to 140 |
| 0x274 | with flag `0x400` and value 2, clears driver flag 8 (otherwise set) |
| 0x278 | non-zero sets driver flag 4 |
| 0x27c | `u32`, default 1 when -1 [4000, 800, 10000] |

### Codec detection

`CodecFormat_DetectFromHeader` (`00bba8c0`) looks at the first 4 bytes of a clip: `"OggS"` selects Ogg Vorbis, `"RIFF"` selects MPEG-2 Layer II (format tag
`0x50`) or Xbox ADPCM (`0x69`), and `0x75b22630` selects WMA.

## The radio

`RadioChannel_PlayClip` (`004f4860`) and `RadioChannel_SelectNextClip` (`004f6ed0`):

- The radio object holds several channels; the current channel index is at `+0xaa8`, and each channel is a 0x164-byte record.
- A clip's category is at clip `+0x44`: 0 DJ, 1 News, 2 Tannoy, other Speech (the debug log prefixes played clips with `"DJ,"`, `"News,"`, `"Tannoy,"`,
  `"Speech,"`). Category 0 clips also fetch a value from a global object through `FUN_0049ab70`.
- Each channel keeps four priority queues (5-dword records from channel `+0x1c8`, priorities 1 to 4). `SelectNextClip` takes the next clip from the
  lowest-numbered non-empty queue into the current-clip slot (`+0x22c`), skipping clips whose per-category "played" flag is set, and only if a per-category
  counter (`DAT_0104b09c[category]`) is at least the queue's priority.
- A non-empty "forced" queue (`+0x1d8`) plays into slot `+0x230` instead, and the current clip drops to volume `min(0.1, DAT_0104b0b4)`: ducking under speech.
- A clip starts only once the gap since the last one (`DAT_00e51cd4`) has passed.
- `"DJ_STING"` and `"RADIO_DJ_MCDUFF_INTRO"` are clip names used from code.

## Timeline announcements

The timeline UI (`Timeline_Constructor`, `0079f4f0`; `WTimeline_Tick`; the event, movie, award and research-pack icons `WTimeline*Icon_*`) is tied to the radio:
`Timeline_OnRadioClipFinished` (`007994f0`) compares the finished clip's name with each timeline event's name, and with that name plus `"_FUTURE"`, and on a
match calls `FUN_007a3110` on the event's icon.

`Timeline_InterpolateGenreColumnsAtDate` (`00a1db90`) loads a per-genre `.sm` data file next to the timeline entry and builds display values from it
(`field[0x2d]*47+18`, `(1-field[5])*0.5*40+60`, and about 20 more fields). What the fields mean is not known.

## Not known

- How the DJ for an era is chosen, and where the clip-name to event-name mapping is loaded from.
- The META Data `.lug` route, the RLM parameters, the rest of the sample record.
- Which banks the game loads when, and the game-side engine classes (`LHAudioSystem_*`, `CEngine`, event triggers, atmosphere groups, the driver classes
  in `0x00bf3000`-`0x00c02000` and `0x00bc0000`-`0x00bc9000`): mostly unnamed (`LIBRARIES.md`).
