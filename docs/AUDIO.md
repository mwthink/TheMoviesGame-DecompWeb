# Audio: `.lug` sound banks, the radio and the timeline announcements

Status: read from the decompile. The `.lug` reader (`web/src/formats/Lug.ts`) is checked against the six shipped banks; the audio states and their stack are
ported (`web/src/sim/audio/AudioStates.ts`) and drive the web app's music (`web/src/audio/AudioManager.ts`); nothing is checked against a running game yet.
The codec libraries the audio engine is built on (libogg, libvorbis, zlib, the Lionhead `PK*` / `LLA` / `LHA` layers) are described in
`LIBRARIES.md`; this page covers the game's own formats and logic.

## The files

`Data/Audio/` holds: six banks (`soundbank_01.lug`, 290 MB, 2,430 samples, mostly UI and gameplay effects; `MM_soundbank_02.lug`, 221; `add_on_soundbank_john.lug`, 99;
`awards_ambience.lug`, 37; `starmaker.lug`, 11 UI clicks; `world.lug`, 277 ambience clips, grouped by era); `music/` (103 stereo Ogg Vorbis files, plain `.ogg`);
`trackinfo.csv` (per track: first and last year it plays, volume about 0.45, a weight per genre, "Put on Radio", "Play in Random Mode", "Play these songs first in
new game"); `radiostinginfo.csv` (the DJ for each era, with an intro and a random clip each); `radioeffect.ini` (the radio's band-pass: frequency 1548, Q 5, make-up
gain 1.6; the tannoy's delay, wet and dry mix and filter; `fadetime = 1200`); and the folders `EN-UK/` (speech banks: DJ, news, tannoy, director, tutorial,
lip sync), `Atmosphere/` (per-facility banks) and `LipsSync/`. File names are not consistently cased (`Tuning_Up.ogg` is `tuning_up.ogg` on disk). The menu's
background movie `Data/intro/frontend_loop.wmv` (57 s) and `frontend_intro.wmv` carry stereo WMA audio.

## Audio states

The audio manager (`Audio_GetInstance`, `DAT_0104B0E4`) is a small state machine. `AudioStates_DefineAll` (`004F7890`) builds seven state records with
`AudioState_Define` (`004F7550`); each is 0x164 bytes from manager `+0xEC`. A state holds an optional music file and the voices for it. Only the current state
(`+0xAA8`) is audible; the (state, owner) pairs the callers registered are a list at `+0xAB0..+0xAB4`.

| State | Music file | Set by |
|---|---|---|
| 0 | none | the game object's constructor (`Game_Constructor`), the front end's quiet moments; the fallback when the list is empty |
| 1 | `Tuning_Up.ogg`, looped | loading: `Game_ConstructSystems` sets 2 (owner: the game) and then 1; `SaveLoad_PumpRequests` while loading or saving |
| 2 | none: the in-game radio | a game in progress; `Game_DestroySystems` removes it |
| 3 | none | the shot fiddler (`WShotFiddler_Constructor`); the trailer editor removes it |
| 4 | none: the front end's own player, which plays `Relaxing_By_The_Sea` (see "Not known", "Menu music") | `WFrontEnd` (tier < 2), `WFrontEnd_Tick` |
| 5 | `Relaxing_By_The_Sea.ogg`, looped | the release screens and the reviews page |
| 6 | `Movies_Intro.ogg`, looped | the splash screen (`WSplashScreen_Tick` removes it) |

- `Audio_SetState(state, owner, networked)` (`004F98F0`): if `state` is already current, nothing happens (the pair is not recorded either). Otherwise the previous
  state is suspended (`AudioState_SetSuspended`, `004F9190`: fade out, pause its voices), the new one becomes current, is started (`AudioState_Start`, `004F77D0`)
  and resumed, and the pair is pushed. The radio (state 2) is skipped while a game flag (`*(DAT_00F87B04 + 9)`) is set.
- `Audio_RemoveState` (`004F9B70`): removes the pair; if it was the current state the one at the end of the list becomes current and is resumed (state 0 when the
  list is empty); a state that was not current is stopped and its voice released. So loading music (1) sits over the radio (2) and removing it brings the radio back.
- With `networked` set and a network game running, both calls record the request as a message instead of acting (`FUN_004F8E10`), and `Audio_Update` replays
  recorded requests (`Audio_ReplayQueuedStateRequests`, `004F9EE0`) when no network game is on. The messages are not decoded.
- `Audio_Update` (`004FB1C0`, once per frame from the main loop): unless audio is off (`DAT_0105CC29`), replays queued requests, releases a finished voice
  (`AudioState_ReleaseFinishedVoice`, `004F3400`), runs the current state's music tick by its mode word (`+0x60 + state*0x14`; 1 `AudioState_UpdateRadioMusic`
  `004F8AE0`, 2 `AudioState_UpdateFrontEndMusic` `004F5E80`), then the ambience (`Audio_UpdateAmbience`, `004F6960`, see "Ambience") and the clip queues (`RadioChannel_SelectNextClip`).
- Two playlist players back states 2 and 4: `Audio_GetRadioPlayer` (`0049AB70`, `DAT_0104A718`) and `Audio_GetFrontEndPlayer` (`004465F0`, `DAT_00F87EF4`). The music
  library is read from `data/audio/trackinfo.csv` by `TrackInfo_LoadDefault` / `TrackInfo_LoadCsv` (`00488E70`, `00487EF0`). How a player picks the next track
  is in "The music library and the radio's playlist".
- Levels: `AudioOptions_LoadMixerLevels` (`004F52E0`) reads the registry values `Volume 0`, `Volume 1`, `Volume 2` (default 1.0) with `Config_GetOrCreateFloat`
  (`00541AE0`) and applies each with `Audio_SetChannelVolume` (`009B1000`); channel 1 is music and 2 is sound effects (`FRONTEND.md`), 0 is not identified. Then `DJLevel`.

The web port: `AUDIO_STATES` and `AudioStateMachine` (pure, tested), `AudioManager` (Web Audio: a music bus and a sound bus at the settings' volumes, a voice per music
state with a 1.2 s fade). The screens hold the states above (`main.ts`); the menu screens hold state 4, whose player (`RadioPlayer` in `frontEnd` mode) plays `Relaxing_By_The_Sea`; a browser
only allows sound after a click or key press, so the splash music starts on the first click, which also leaves the splash.

## The music library and the radio's playlist

`trackinfo.csv` (102 rows, 60 with "Put on Radio") is read into 200-byte track records by `TrackInfo_LoadCsv`. **[read]** The record: first and last year at `+0x80`/`+0x84`,
"Put on Radio" at `+0x88`, the eight genre weights at `+0x90..+0xAC`, the track's length in ms at `+0xB0`, the `NEXT_MUSIC_START` fraction at `+0xB4`, the `DJ_STING` fraction
at `+0xB8`, the volume at `+0xBC`, the play counter of its last start at `+0xC0` (-1 = never), "in the queue" at `+0xC4`, "Play in Random Mode" at `+0xC5` and "Play these songs
first in new game" at `+0xC6`. All players share one queue of tracks (`DAT_0104A59C`) and one play counter (`DAT_0104A5A8`).

**Filling.** `RadioPlaylist_Fill(mode, year, firstOnly)` (`00487420`) queues every track not queued yet whose years include `year` (any year when it is -1), whose flag for the
mode is set (mode 0: "Put on Radio"; 1: "Play in Random Mode"; 2: all) and, when `firstOnly`, that has the first-in-new-game flag. `RadioPlayer_SetYear` (`0049AA30`) purges
the tracks the year has passed (`RadioPlaylist_PurgeOutOfYear`, `00487220`) and fills (mode 0); `AudioState_UpdateRadioMusic` notices a year change (`Audio_OnYearChanged`,
`004F6310`, stored at manager `+0xAD0`) and calls it. A new game's first fill is the `firstOnly` one (flag at manager `+0xAF0`, cleared after the first use).

**Picking.** `RadioPlayer_PickNextTrack` (`0049AB80`) refills the queue when it is empty, then `RadioPlaylist_PickNext(separation)` (`00487530`) takes **a uniformly random queue
entry**; if that track's `+0xC0` is not -1 and the play counter minus `+0xC0` is below `separation`, it is dropped from this call's candidates and another is drawn; if no
candidate is left it returns nothing and no music plays on that frame. The pick leaves the queue, `+0xC0` is set to the counter and the counter goes up. So a track does not
repeat until the queue has emptied *and* `separation` other tracks have started. The radio's separation is `DAT_00E50E8C`, **7** in the data section and never written by any code; the
front end's is `DAT_00F87EDC`, 0. **quirk:** a year with seven or fewer radio tracks could starve the original (every queued track too recent: silence until the year changes). The
shipped library has eight in 1920 to 1929 and more later, so it cannot happen in a game.

**The genre weights are never read [read].** The eight values are parsed into `+0x90..+0xAC` and nothing uses them: the only functions that touch the track vector are
`TrackInfo_LoadCsv`, the by-name lookup `FUN_00486820` (called by `AudioState_Define` and the loader) and the queue code above; the audio manager reads from a track only its
length, cue fractions, volume and `+0xC0`/`+0xC4`; and a search of every decompiled function between `0x00430000` and `0x00500000` for reads of `+0x90..+0xAC` floats finds no
track record. Possibly a leftover of Fable's tooling; the web port ignores them as well.

**Random mode [read].** The front end's player (`FrontEndPlayer_PickNextTrack`, `00446600`, started by `AudioState_Start` for state 4) fills with mode 1 and year -1, so "Play in
Random Mode" means "a track for the menus". Only `Relaxing_By_The_Sea` has it. See "Menu music".

`music/cues/<track>.cue` (102 files, CRLF text): `//` comments and `"NEXT_MUSIC_START" = <n>` and/or `"DJ_STING" = <n>` lines. **[inferred]** The numbers are
milliseconds: `NEXT_MUSIC_START` is 2.5 to 5 s before the end of each track checked (adagio: 107369 of 109894 ms) and `DJ_STING` is 5 to 7 s in. **[read]** `TrackInfo_LoadCsv`
divides each by the track's length in ms (`+0xB0`) to make a fraction, 1.0 for a track without the cue. The next track starts when the playback fraction passes the first
(`AudioState_UpdateRadioMusic`; without the cue, when the voice ends); the DJ's window is between the second and one half (the float at `0x00D1694C` is 0.5), so a track with
no `DJ_STING` never gets a DJ.

The web port's radio (`sim/audio/Radio.ts`, `audio/RadioPlayer.ts`): the same queue, fill, purge, separation of 7 and uniform pick (`RadioPlaylist`), a new game opening with the
track flagged first, each track at its CSV volume, the next one starting at `NEXT_MUSIC_START` with a crossfade. The DJ and news are in the section below. The front end's
player is the same class in `frontEnd` mode.

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
   in it and reads a `u32` version, which must be 0 (a "normal LUG"). **[data]** The shipped segment is exactly 0x208 bytes: a 512-byte title (`Bank title/description`)
   and nothing after it, so the version is not stored there; the reader does not check it. `LH_IsNormalLUG` also requires the wave-data and sample-table segments.
4. `LH_OpenWavSegment`: opens `LHAudioWaveData` and gets its base offset.
5. `LH_LoadSampleBankTable` (`00bffe70`): segment `LHAudioBankSampleTable`. A `u32` count masked to 16 bits (at most 65,535 samples), then `count`
   records of **0x28c bytes**. (The second `u16` after the count is 0 in `starmaker.lug` and equals the count in `world.lug`; the mask ignores it.)
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
| 0x124 | wave format tag (`u16`; 1 = PCM in every shipped bank) |
| 0x126 | channel count (`u16`) |
| 0x128 | sample rate (`u32`) |
| 0x12c | bytes per second (`u32`) |
| 0x130, 0x132 | block align and bits per sample (`u16` each): 0x124..0x133 is a `WAVEFORMATEX` copy |
| 0x138, 0x13c | loop start and end (-1 = no loop in Fable's files) |
| 0x140 | group / category name, 256 bytes |
| 0x240-0x27c | the parameter block, below |

The clips are RIFF/WAVE files packed back to back in the wave-data segment. **[data]** The record's format fields (`0x124`) describe the clip, but the speech banks'
clips (`EN-UK/speech_dj.lug` and the others: DJ, news, tannoy) are **MPEG-1 Layer II**, wave format tag `0x50`, mono 44.1 kHz (**[measured]** on a DJ clip: tag 0x50, no
bits per sample); browsers cannot decode that, so the port unwraps the frames (`formats/WavMpeg.ts`) and decodes them with `mpg123-decoder` (`audio/ClipDecoder.ts`). The
record's size is the RIFF size plus 8. The ambience bank was not measured; `ClipDecoder` sends PCM clips (tag 1) to the browser's decoder and Layer II to the WebAssembly one.
Aliases (`world.lug`: one 1.8 MB bell clip under several era groups) share their target's data offset.
Most banks also hold a `LHAudioBankMetaData` segment (the newer form, not decoded) and a `LHAudioBankRandomModulator` segment (8 bytes) next to the classic ones.

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

## The DJ, the news and the speech queue

A state record (0x164 bytes) has three voices for talk: `+0x22C` the current clip, `+0x230` a "forced" clip, `+0x234` a third; and five queues (priorities 0 to 4,
from state `+0x1D4`, 0x14 apart; each a ring buffer of pointers to 0x4C-byte clip records: tag, category string, volume, category index, age; `SpeechQueue_Push` `004F8650`, `SpeechQueue_Grow` `004F7DC0`). **[read]** What goes in:

- `Audio_QueueSpeech` (`004F87C0`; `(state, tag, category, priority, categoryIndex, volume, delay)`): the one entry point. It refuses a clip when the state's speech is
  off, the category is blocked, the category's **speech level** (`DAT_0104B09C[categoryIndex]`) is -1 or below the priority, news or tannoy (index 1, 2) while the
  game's first field is under 300 (the tick counter: 30 s of game time at 10 Hz), or the tag already waits in a queue. `Audio_QueueTannoy` (`004F8A00`) is the
  tannoy form (category `"tannoy"`, index 2, volume 0.5); many game systems call it (casting announcements, disrepair, income, shoot consequences).
- The speech levels are four ints (`Audio_SetSpeechLevel` / `Audio_GetSpeechLevel`, `004F3200` / `004F3220`), the registry values `DJLevel`, `NewsLevel` and two more,
  default 3 (the "MaxSpeechLevel" array, `VolumeControl`'s sibling). This is what the Options screen's PA assistance (the tannoy) and radio (all speech, DJ and news,
  DJ only, news only, information only, none) settings change: a clip plays when its priority is at most its category's level. *(An earlier version of this page
  called `DAT_0104B09C` a per-category counter; it is the level.)*
- Categories (clip `+0x44`, the debug log's `"DJ,"`, `"News,"`, `"Tannoy,"`, `"Speech,"`): 0 DJ, 1 News, 2 Tannoy, 3 Speech.

What comes out (`RadioChannel_SelectNextClip` `004F6ED0`, `RadioChannel_PlayClip` `004F4860`): once the gap since the last clip ended has passed
(`DAT_00E51CD4` = **5000 ms** **[data]**, read from the exe) and no clip is playing, the first clip of the lowest-numbered queue whose category level allows it goes to
the current voice (`+0x22C`). A clip in the forced voice (`+0x230`) has the current clip dropped to `min(0.1, DAT_0104B0B4)` (`DAT_0104B0B4` is the sound-effects channel's volume, see "Does the music duck?"). The global `DAT_00E51CD8` = 1000 ms is the
fade time of the state changes.

**The DJ.** `AudioState_UpdateRadioMusic` (`004F8AE0`): when a track's playback position is past its `DJ_STING` cue (as a fraction of the track [inferred]) and before one half,
once per track, it rolls `Random_IntInRange(0, 6)`: below 5 (five in six) and with the forced voice free, it queues the current DJ's tag (`RadioPlayer_GetCurrentDjTag`, `0049AC30`: the DJ schedule entry whose years cover the player's year;
category `"radio"`, priority 1, category 0, volume 1.0). The DJ for a year comes from `radiostinginfo.csv` (`RadioSting_LoadDefault` `0043E980`): `RADIO_DJ_MCDUFF` to 1940, `KRUNKLEBURGER`
1941-55, `MADDOG` 1956-69, `SHAW` 1970-77, `WRIGHT` 1978-90, `KRISTEN` 1991-2004, `HUGH` 2005-24, each with an `_INTRO` tag (one clip) and, for the last three, an `_OUTRO` valid
one year past their term. A flag (`+0x24C`) makes the first clip after a start the DJ's `_INTRO`. **[data]** `Data/Audio/EN-UK/speech_dj.lug` holds the tags: 90 to 150 chatter
clips per DJ (`TEXT_RADIO_DJ_<NAME>_<n>.wav`), single intro and outro clips.

**The news.** `WTimelineEventIcon_Update` (`007A3D60`), for each timeline event: once, when the date is within half a year after the event, it queues the event's name
(`TIMELINE_<NAME>`, from `timeline.csv`'s `timeline_<NAME>` rows) as category 1, priority 1; once, when the date is between two years and one and a half before the
event, it queues the name plus `_FUTURE`. The announcement is skipped while the timeline window is showing it (`FUN_007942d0`). **[data]** `speech_news.lug` has 95 clips under
96 tags, 48 events with a clip and its `_FUTURE` twin; 30 of the events are in `timeline.csv`. `Timeline_OnRadioClipFinished` (`007994F0`) lights the event's icon while its clip plays (see "Timeline icons: what they do").

The web port (`sim/audio/RadioSpeech.ts`, `audio/SpeechPlayer.ts`): the same schedule, the same windows, the five-in-six roll, one clip at a time with the 5 s gap, picks a
random clip of the tag, plays it through the radio filter from `radioeffect.ini` (band-pass 1548 Hz, Q 5, gain 1.6) and does not lower the music (the original's code never does; see "Does the music duck?").
Each tag's clips come out as a shuffle bag (`RadioSting_LoadCurrentClipList` `0043DBE0` lists the indices, `RadioSting_TakeClipIndex` `0043D980` removes one at random: no repeat until the others have played; the port's `ClipBag`). The DJ schedule is a list of 100-byte entries (`RadioSting_GetEntry` `0043D780`; years at `+0x58`/`+0x5C`, the tag at `+0x38`, the Random flag at `+0x60`). The DJ's sign-off and introduction play when the year passes into a new DJ's term. The speech levels are fixed at 3 (no options yet), the tannoy is not done, and the news
needs the dev server like the rest.

### Does the music duck?

**[read] No.** Nothing in the original's code lowers the music while a DJ or news clip plays. The voice volumes that code sets are speech voices only: `RadioChannel_SelectNextClip`
(`004F6ED0`) starts a clip at `min(DAT_0104B0B4, 0.1)` while a higher-priority voice (`Audio_SetOverridingVoice`, `004F30C0`, stored at state `+0x234`) is playing and restores
the speech level when it stops (`DAT_0104B0B4` is the sound-effects channel's volume, not a speech level or a music level: see below), and the music channel's volume (`Audio_SetChannelVolume`,
channel 1) is written only by the options screen, the trailer editor and `FUN_00752270`. The speech bank's own mixing (the "radio" category) was not examined, so a duck done by
the sound middleware cannot be excluded **[guess]**; the web port does the same: no duck (`DUCK_LEVEL` is 1; below 1 it would lower the music while a clip plays, 2/3 being speech 3 over music 2).

**How the original balances them [read].** `DAT_0104B0AC` is an array of three floats, the channel volumes `Volume 0..2` (`AudioOptions_LoadMixerLevels`, `Audio_SetChannelVolume`
writes `(&DAT_0104B0AC)[channel]`), so `DAT_0104B0B4` is `[2]`, the **sound-effects channel**. It is what scales the speech voices (`RadioChannel_SelectNextClip` sets a new clip's
voice to it, or to `min(0.1, it)` while a forced clip plays) and the ambience voices (`Audio_UpdateAmbienceVolumes`, each is this volume times a 0 to 1 fade by camera height). Music is channel 1 and is separate. So with
the options at their default of 1.0 a clip's voice is at full level while a track plays at its CSV volume (about 0.45): the voice is already about twice the music, with no duck, and
the options' sound slider moves voices and effects together against the music slider. The web port's speech goes through the sound bus, so it follows the same split. Its ambience has one extra stage, `DEFAULT_AMBIENCE_LEVEL` (0.1, set by ear, **[guess]**, the dev menu's "Ambience level" slider): the original has no level of its own for it, but at the sound-effects volume the birds covered the news. What the sound engine
does with the voice volume besides (the clip's own record volume, 1.0 for the DJ and 0.5 for the tannoy; `FUN_009B1860` starts the voice) was not followed [guess].

### The `_INTRO` flag

State `+0x24C` is set only by `AudioState_SetIntroPlayedFlag` (`004F3250`), whose single caller is the debug console's radio command (`SITT_DebugConsoleCommandDispatch`), which
plays `FANFARE4` and `RADIO_DJ_MCDUFF_INTRO` itself. With the flag set, the next DJ roll that would queue a tag containing `_INTRO` queues nothing and clears the flag. In a normal
game it is never set.

### The tannoy

The studio's PA: spoken notices that something needs attention or has happened. It is speech category 2 (volume 0.5), through the same queues, gap and levels as the DJ and news.

**Clips [data].** `EN-UK/speech_tannoy.lug` holds 70 tags (`TANNOY_CASTING_*`, `_SHOOTING_*`, `_MOVIE_ON_HOLD_*`, `_NON_ATTENDED_CEREMONY_*`, `_FIRST_TIMEMOVIEINTOPTEN_YOURS_<GENRE>`,
mood and need notices such as `_BADMOOD`, `_BORED`, `_STRESSED`, `_DRINK_ADDICTION`, rating warnings such as `_SANITATION_RATINGLOW`, tutorial unlocks, league tables, and so on) and
`Speech_TANNOY_addon.lug` the six stunt ones (`TANNOY_STUNT_*`). **[read]** The audio manager looks a tag up in both banks.

**The effect [config, read].** `radioeffect.ini` `[tannoy]`: `delay = 151`, `wet = 0.45`, `dry = 1.0`, band-pass `frequency = 1587`, `q = 1.8`. The audio start-up (`SoundSoakTest_Constructor`, `004FA7E0`: despite its name it is the audio manager's initialiser; it also registers the `snd_startsoaktest` and `snd_stopsoaktest` console commands) reads the file and hands the numbers to the sound engine as two command objects (`FUN_009B0DA0`, radio: frequency, Q, make-up gain; `FUN_009B0DF0`, tannoy: delay, wet, dry, frequency, Q), only when `DAT_0105BE08` is above 1 (a machine detail level that rendering code also reads) and the section exists. The filtering itself is done inside the engine's command executor, which was not followed, so **the order of the stages is not known**; the port echoes the band-passed voice [guess].

**Queuing [read].** `Audio_QueueTannoy(state, tag, priority, delay)` (`004F8A00`) is `Audio_QueueSpeech` with category `"tannoy"`, index 2, volume 0.5. A clip is refused while the
game is under 30 s old, when the PA level (Options, default 3) is below its priority, when the state has no speech, when the category is switched off (`tannoy.off` in the tutorials), or
when the tag already waits in any queue. **Every one of the 26 call sites passes its priority** (read from the pushes before each call; the earlier "default" was a decompiler
artefact): `TANNOY_CODE_PRIORITY` in `sim/audio/RadioSpeech.ts` has them (1: `CEREMONY_ABOUTTOSTART`; 2: the star, stunt, awards-coming and building-disrepair notices and the battery
warning; 3: the casting nags and `CASTING_COMPLETE`, the facility and set disrepair warnings, income, research pack and new studio; **4** for `NEW_PACKRESEARCHED_<PACK>`, which only
plays when the PA level is raised above the default 3). The fourth argument, a delay (5.0 for a researched pack, 10.0 for a new studio, 0 otherwise), is stored in the clip record as
a time stamp (`now - delay`); `RadioChannel_SelectNextClip` never reads it, so it has no effect **[read]**. `FUN_004F6E10` takes a waiting clip back out of the queues by its tag; the
casting code uses it to withdraw a nag once the role is filled **[read]**.

**What triggers it.** 26 call sites in 17 functions queue these tags (four of the sites are in code Ghidra never made into functions; they were found in the disassembly):

| Source | Tags | When |
|---|---|---|
| `CPhasePreProduction_UpdateCastingAnnouncements` (`005ABD10`) | `CASTING_ACTORSNEEDED` (`_01` to `_03` by how many actors are missing), `_DIRECTORNEEDED`, `_EXTRASNEEDED`, `_NOEXTRAS`, `_CREWNEEDED`, `_NOCREW`, `STUNT_DOUBLE_NEEDEDINCASTING` | a nag per missing role, re-armed every 60 (`DAT_00E54454`) and 90 (`DAT_00E54458`) clock units; withdrawn by `FUN_004F6E10` when fixed |
| `CPhasePreProduction_Update` | `CASTING_COMPLETE` | 30 days after the cast is complete, then every 60 (`MOVIE_QUALITY.md`) |
| `CProjectIncome_DailyTick` | `RELEASED_TIMETOARCHIVE` | the income pool is empty (`MOVIE_SUCCESS.md`) |
| `CAsset_UpdateConditionAndDisrepair` | `BUILDINGS_IN_DISREPAIR` | a building's condition drops below 0.05 |
| `CFacility_UpdateVisualsAndRunningCosts` | `DISREPAIR_WARNING_FACILITY` | not read in detail |
| code at `004CDBCA` (after `FUN_004CDA20`) | `DISREPAIR_WARNING_SET` | the same warning for a set; not read in detail |
| `FUN_004753A0` | `STARLEFTSTUDIO` | a star leaves the studio |
| `FUN_00514A10` | `STAR_JOINEDQUEUE` | a star joins the casting queue (needs the tick counter over 300) |
| `FUN_0057CD50` | `STUNT_PERSON_INJURED` | health below a threshold (`DAT_00E53304`), at most once per `0x4B0` ticks |
| `ShootController_ApplyStuntConsequences` | `STUNT_SCENE_SUCCESS` / `_FAILURE` | after a stunt scene (`STUNT_SYSTEM.md`) |
| code at `005B035A` (after `FUN_005AFEE0`) | `STUNT_SCENE_SHOOTING` | not read in detail |
| `FUN_0049DA60`, `FUN_004A2190` | `RESEARCH_PACK`, `NEW_PACKRESEARCHED_<PACK>` | research |
| `CStudioAI_CreateFromTemplateWithAnnouncement` | `NEW_STUDIOOPENED` | a rival studio opens |
| code at `0086058x` to `0086079E` (two sites) | `AWARDS_COMINGSOON` (2), `CEREMONY_ABOUTTOSTART` (1) | the awards ceremony is near / about to start |
| code at `0063A729` (after `FUN_0063A590`) | `INTEL_TANNOY_BATTERY_WARNING` | a laptop battery warning, with its own bank `INTEL_TANNOY_BATTERY_WARNING.lug` |

**The rule-driven tannoys [read, data].** `data\rule\tannoy.csv` (in `MISC0000.pak` and the add-on) has four rules, each firing an action when `movie_lifespan` is a multiple of 90 days; the
actions are in `data\sitt.ini` under `# TANNOY` as `[actions/a_tannoy_*]` with a `tannoy=<TAG>` and a `tannoy_priority`. The action loader (`FUN_008D2430`) reads `tannoy_priority` with a default of **3**.

| Rule (`tannoy.csv`) | Fires when | Tag | Priority |
|---|---|---|---|
| `tannoy_script_complete` | design phase, `movie_lifespan >= 90` | `TANNOY_SCRIPT_COMPLETE` | 2 |
| `tannoy_actors_missing_from_shoot` | shoot phase, `movie_lifespan >= 180`, actors missing | `TANNOY_SHOOTING_ACTORSNEEDEDONSET` | 3 |
| `tannoy_director_missing_from_shoot` | shoot phase, `>= 90`, director missing | `TANNOY_SHOOTING_DIRECTORNEEDEDONSET` | 3 |
| `tannoy_crew_missing_from_shoot` | shoot phase, `>= 90`, crew missing | `TANNOY_SHOOTING_CREWNEEDEDONSET` | 3 |
| (no rule) | `a_tannoy_ready_for_release` is defined but nothing fires it | `TANNOY_SHOOTING_COMPLETE_READYFORRELEASE` | 3 |

The tutorial scripts switch the category on and off with the commands `tannoy.on` / `tannoy.off` (`sitt.ini`), alongside `dj.on` and `news.on`.

**Unused tags [read, negative].** The bank's other tags (the moods `_BADMOOD`, `_BORED`, `_STRESSED`, the addictions, `_*_RATINGLOW`, `_MOVIE_ON_HOLD_*`, `_NON_ATTENDED_CEREMONY_*`,
`_FIRST_TIMEMOVIEINTOPTEN_YOURS_*`, the league-table, tutorial-unlock and `_STARRETIRED_*` ones) appear in no `.ini`, `.txt` or `.csv` in the archives and in no string of the executable,
and the 23 tags the code queues are the only `TANNOY_` strings in it. So they look like recorded but cut content, never played by the shipped game. (Other file types in the archives
were not searched; a prefix built at run time would also escape this test, and only `TANNOY_NEW_PACKRESEARCHED_<PACK>` does that.)

**The web port.** `SpeechPlayer.tannoy(tag, priority)` (and `AudioManager.tannoy`) queue a clip through the existing queue and play it with the echo and band-pass; nothing in the
game calls it yet, because the systems above (casting, shoots, buildings, research) are not running in the web app.

## Ambience

**[read]** `Audio_StartAmbienceLoops` (`004F5F90`) starts three looping voices for a running game (only while the current state is 2): the **lot**, the **street** and the
**global** ambience. Each tag is built by `Audio_BuildAmbienceTag` (`004F55B0`) as prefix + `_` + era, with the era (`+0xAD4`) set by `Audio_OnYearChanged` from the game year, and
falling back to prefix + `_2` when no bank has the tag. **[data]** `world.lug` holds exactly these as sample *groups* (the record's group name): `Lot_1920/1950/1970/1990` (about 18
clips each: birds), `Street_1920/1950/1970/1990` (church bells, car horns and alarms of the era: 30 to 50 clips) and `Global_1920/1950/1970/1990` (planes, later helicopters: 3 to 7).
The records carry no loop points; each group's records share a number in the high word of `+0x118` (5 for the lot, 11 for the street, 14 to 17 for the global layer) and a per-clip
number at `+0x27C` (450 to 4000).

`Audio_UpdateAmbienceVolumes` (`004F3B80`) sets the layers by `y = *(DAT_00F87AA0 + 0xE0)`. **[read]** `CAMERA.md` has the camera object's `+0xDC` as the *focus* (x, y, z), so
`+0xE0` is the focus's **y on the ground**, not a height. The lot layer is master level times `clamp((y - DAT_0104B0C8) / 60)` and the street layer times
`clamp((DAT_0104B0CC - y) / 60)` (60.0 is `DAT_00E51CDC`); the global layer stays at master. Nothing in the code writes the two edge values (they are in the zero-filled
part of `.data`), so both are 0: the lot fades in over the first 60 units of y, and the street is heard only where the focus has y below 0, beyond the lot's gate.
`Audio_UpdateAmbience` (`004F6960`) runs each frame and restarts any loop that stopped.

The web port (`sim/audio/Ambience.ts`, `audio/AmbiencePlayer.ts`): the same tags and levels. The engine's own scheduling of the clips inside a group was not read, so a layer plays a
random clip that is off its cooldown (`+0x27C` ms) and waits half to one and a half times its interval (`+0x118`'s high word, seconds) **[guess]**. The era is the latest of the four
not after the game year **[guess]**: the original rounds the year through a function pointer (`DAT_0105BEA4`) that was not followed. The layers run only while the radio does (state 2),
and are not positional.

## Timeline announcements

The timeline UI (`Timeline_Constructor`, `0079f4f0`; `WTimeline_Tick`; the event, movie, award and research-pack icons `WTimeline*Icon_*`) is tied to the radio:
`Timeline_OnRadioClipFinished` (`007994f0`) compares the clip's name with each timeline event's name, and with that name plus `"_FUTURE"`, and on a
match calls `WTimelineEventIcon_BeginHighlight` (`007a3110`) on the event's icon. **[read]** Despite the name it runs when a news clip *starts*: `RadioChannel_PlayClip` calls it
right after `FUN_009b1860` has started the voice, for category 1 (news), passing the voice handle.

`Timeline_InterpolateGenreColumnsAtDate` (`00a1db90`) loads a per-genre `.sm` data file next to the timeline entry and builds display values from it
(`field[0x2d]*47+18`, `(1-field[5])*0.5*40+60`, and about 20 more fields). What the fields mean is not known.

### Timeline icons: where they come from and where they sit

**Source [read].** Every icon is made from a `CNodule` kept in one global list (`DAT_0104e7c4`). `Timeline_CreateNoduleIcons` (`0079dc00`) and
`Timeline_UpdateNoduleIcons` (`007a14a0`) walk the list and make one icon per nodule by its class: `CNoduleEvent` gives `WTimelineEventIcon` (a world event),
`CNoduleMovie` the movie icon, `CNoduleResearchPack`, `CNodulePress`, `CNoduleQuit` and `CNoduleRetire` their own icons. The world events are the only ones
read from a file: `FUN_0078f5b0` loads `data/rule/timeline.csv`, and `FUN_0078f400` keeps the rows whose name starts `timeline_`, the date being the second
column. The other kinds are made by the game as things happen (releases, award dates, a star quitting or retiring, research packs). `CNoduleEvent_GetName`
(`0078f190`) upper-cases the row name into the `TIMELINE_<NAME>` bank tag.

**Position [read].** An icon's x depends only on its date, not on the order of the events. `CNoduleEvent_SpawnOrUpdateIcon` (`0079ef30`) sets it each update to
`FUN_00793f50(date) - 16`. With `y` the event date minus the current game time in years (`Time_ToYears` of `Time_Minus` against the global clock at
`DAT_00e4fa4c`, written when a game starts or loads and by the clock update), `x0 = 128 + L` (`L` the timeline window's left anchor value, `+0xC0`; the right
anchor value is `R`, `+0x108`; `CLASS_NOTES.md`):

- `y >= 0` (future): `f = (1 - (y+1)^-0.5) / (1 - 21^-0.5)` and `x = x0 + (R - x0) * f`.
- `y < 0` (past): `f = (1 - (1-y)^-0.5) / (1 - 2^-0.5)` and `x = x0 - (x0 - L) * f`.
- `f > 1` (more than 20 years ahead or 1 year back): no position; the function returns -1 and the icon is put at x = -32. The result is rounded to a whole pixel.

So "now" sits 128 px in from the left edge, the bar shows 1 year back and 20 years ahead, and the scale is not linear: the share of the future span used is 13.5%
at 0.25 years, 23.5% at 0.5, 37.5% at 1, 54% at 2, 64% at 3, 89% at 10. The news windows above (1.5 to 2 years ahead) fall at about 47% to 54% of the span.
**[inferred]** that the constants are years because the function is `Time_ToYears`; they were not logged from the running game.

The web port draws the strip on the game toolbar (`ui/GameToolbar.ts`, the curve in `sim/ui/TimelineScale.ts`): the `timeline.csv` world events only, as dots with the event name as a tooltip,
and a dot grows and glows while its news clip plays (`highlightNews`). The other icon kinds, the sparkle and the title and detail bubbles are not done.

### Timeline icons: what they do

**The kinds and their pictures [read].** `Timeline_CreateNoduleIcons` (`0079dc00`) makes one icon window per nodule that has none, by class; every icon is one row at y = 7
(`DAT_00E59BB0`, set from the float `DAT_00D50530` by `Timeline_UpdateNoduleIcons`) except the world event at 7 - 16 and the research pack at `_DAT_00E59C20`.

| Nodule | Icon class | Picture | Notes |
|---|---|---|---|
| `CNoduleMovie` (with a project, `+0xBC`) | `WTimelineMovieIcon` | `ui/timeline_film.dds`, with `ui/timeline_tail_cult.dds` | enabled while the project's phase is 4 or later (released), or while it is the project the editor has open; a hover shows a bubble |
| `CNoduleEvent` | `WTimelineEventIcon` | `ui/timeline_world.dds`, glow `ui/lifetimeawards_glow.dds` | the world events (above) |
| `CNoduleResearchPack` | research icon | `ui/timeline_re_costume.dds` | |
| `CNodulePress` | press icon | `ui/timeline_newsper.dds` | |
| `CNoduleQuit` | quit icon | `ui/timeline_quit.dds` | a star leaving |
| `CNoduleRetire` | retire icon | `ui/timeline_retire.dds` | a star retiring |
| awards | `WTimelineAwardsIcon` | `ui/timeline_award2.dds` once its date comes | the glow is a pulse near the ceremony date |

**What creates the non-event nodules was not decoded** (they are made by the game as things happen); the rows above are what the icon code shows.

**The world-event icon [read].** `WTimelineEventIcon_Update` (`007a3d60`), each frame while the game tier is 3 or more:

- *Hover:* the icon's window grows from 32 to 64 px and its image from 16 to 32, `HUD_TIMELINE_WORLD_EVENT_HIGHLIGHTED` plays once, and after the pointer has rested a title bubble
  opens (`<NAME>_TITLE`, 180 px wide); ten frames later a detail bubble adds `<NAME>_SUBTITLE` and `<NAME>_DESCRIPTION` (280 px wide).
- *News playing* (`WTimelineEventIcon_BeginHighlight`, `007a3110`): the voice handle is kept at `+0x36C`, the window goes to 64, the image to 24 px and the glow is shown. The glow
  rotates by 0.0002 rad per ms of frame time (each frame clamped to 100 ms) while the flag at `+0x370` is set (`UpdateSparkleAnimation`, `007a2f80`). When the voice is no longer playing
  (`Audio_IsVoicePlaying`) the flag clears and the sizes return to 64 / 16.
- *The announcements themselves.* Each icon queues its own clip (`"radio"`, priority 1, category 1), once each. The event's clip when the game date has reached the event's date and is
  no more than half a year past it (flag `+0x367`; also needs `DAT_0104D8E8` = 0); the `_FUTURE` clip when the date is between two years and one and a half years before the event
  (flag `+0x369`). Neither is queued while the timeline's flag at `+0x530` is set. This is what `NewsAnnouncer` ports; it is the icons, not the radio, that trigger the news,
  so a news clip only ever plays for an event that has an icon.

## Not known

- **Menu music [read, not yet heard in the original]:** state 4's player (`FrontEndPlayer_PickNextTrack`) plays the tracks flagged "Play in Random Mode", any year, and the only one is
  `Relaxing_By_The_Sea` (state 5, the release screens, plays the same file). So the menu soundtrack is that Ogg file, not the WMA video audio of `frontend_loop.wmv`, which a browser
  cannot decode and which is not needed for this. The web port's menu screens hold state 4 and play it. That the original's menu really sounds like this was not checked in the
  running game; the `frontend_loop.wmv` audio may play as well (its own path was not followed).
  (The tutorial `.wmv` clips in `Data/Tutorials/` have the WMA problem.)
- The order of the tannoy effect's stages (inside the sound engine's command executor); and the other speech categories (director, tutorial).
- The META Data `.lug` route, the RLM parameters, the rest of the sample record.
- Which banks the game loads when, and the game-side engine classes (`LHAudioSystem_*`, `CEngine`, event triggers, atmosphere groups, the driver classes
  in `0x00bf3000`-`0x00c02000` and `0x00bc0000`-`0x00bc9000`): mostly unnamed (`LIBRARIES.md`).
