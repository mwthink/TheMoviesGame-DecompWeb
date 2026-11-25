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
| 4 | none: the front end's own player | `WFrontEnd` (tier < 2), `WFrontEnd_Tick` |
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
  (year range, genre weights, volume, the first-songs flag) is not decoded.
- Levels: `AudioOptions_LoadMixerLevels` (`004F52E0`) reads the registry values `Volume 0`, `Volume 1`, `Volume 2` (default 1.0) with `Config_GetOrCreateFloat`
  (`00541AE0`) and applies each with `Audio_SetChannelVolume` (`009B1000`); channel 1 is music and 2 is sound effects (`FRONTEND.md`), 0 is not identified. Then `DJLevel`.

The web port: `AUDIO_STATES` and `AudioStateMachine` (pure, tested), `AudioManager` (Web Audio: a music bus and a sound bus at the settings' volumes, a voice per music
state with a 1.2 s fade). The screens hold the states above (`main.ts`), except that the menu screens hold state 6 instead of 4. The front-end player is not built, so state 4 is silent (the menu's soundtrack is a WMA stream a browser cannot play, see "Not known"); a browser
only allows sound after a click or key press, so the splash music starts on the first click, which also leaves the splash.

## The music library and the radio's playlist

`trackinfo.csv` (102 rows, 60 with "Put on Radio") is read into 200-byte track records by `TrackInfo_LoadCsv`. **[read]** The radio's playlist is built for a game year:
`RadioPlayer_SetYear` (`0049AA30`) purges tracks the year has passed (`RadioPlaylist_PurgeOutOfYear`, `00487220`) and fills in the ones that now fit
(`RadioPlaylist_Fill`, `00487420`: year inside the record's Start..End, "Put on Radio" set, not queued yet; the "play first in new game" flag restricts the fill on a
new game). `AudioState_UpdateRadioMusic` notices a year change (`Audio_OnYearChanged`, `004F6310`, stored at manager `+0xAD0`) and calls it. How the next
entry is drawn from the playlist is **[inferred]** from the sibling code that draws DJ-sting indices at random and removes them (`FUN_0043D980`): a random pick
that is then removed, so a track does not repeat until the others have played. The per-genre weights, the "random mode" flag, and the DJ and news clips that
play between tracks are not decoded.

`music/cues/<track>.cue` (102 files, CRLF text): `//` comments and `"NEXT_MUSIC_START" = <n>` and/or `"DJ_STING" = <n>` lines. **[inferred]** The numbers are
milliseconds: `NEXT_MUSIC_START` is 2.5 to 5 s before the end of each track checked (adagio: 107369 of 109894 ms) and `DJ_STING` is 5 to 7 s in. The first is when the
next track starts over the old one; the second is when the DJ's sting can play.

The web port's radio (`sim/audio/Radio.ts`, `audio/RadioPlayer.ts`): a shuffle bag over the tracks that fit the game's year, a new game opening with the track
flagged first, each track at its CSV volume, the next one starting at `NEXT_MUSIC_START` with a crossfade. The DJ and news are in the section below; there is no genre weighting.

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

The clips are RIFF/WAVE files packed back to back in the wave-data segment. **[data]** In the six shipped banks every clip is mono 16-bit PCM (22,050 or 44,100 Hz);
the RIFF size inside each clip plus 8 equals the record's size. Aliases (`world.lug`: one 1.8 MB bell clip under several era groups) share their target's data offset.
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
the current voice (`+0x22C`). A clip in the forced voice (`+0x230`) has the current clip dropped to `min(0.1, DAT_0104B0B4)`. The global `DAT_00E51CD8` = 1000 ms is the
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
96 tags, 48 events with a clip and its `_FUTURE` twin; 30 of the events are in `timeline.csv`. `Timeline_OnRadioClipFinished` (`007994F0`) lights the event's icon when its clip ends.

The web port (`sim/audio/RadioSpeech.ts`, `audio/SpeechPlayer.ts`): the same schedule, the same windows, the five-in-six roll, one clip at a time with the 5 s gap, picks a
random clip of the tag, plays it through the radio filter from `radioeffect.ini` (band-pass 1548 Hz, Q 5, gain 1.6) and lowers the music while it plays [guess: to 0.3].
Each tag's clips come out as a shuffle bag (`RadioSting_LoadCurrentClipList` `0043DBE0` lists the indices, `RadioSting_TakeClipIndex` `0043D980` removes one at random: no repeat until the others have played; the port's `ClipBag`). The DJ schedule is a list of 100-byte entries (`RadioSting_GetEntry` `0043D780`; years at `+0x58`/`+0x5C`, the tag at `+0x38`, the Random flag at `+0x60`). The DJ's sign-off and introduction play when the year passes into a new DJ's term. The speech levels are fixed at 3 (no options yet), the tannoy is not done, and the news
needs the dev server like the rest.

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
`Timeline_OnRadioClipFinished` (`007994f0`) compares the finished clip's name with each timeline event's name, and with that name plus `"_FUTURE"`, and on a
match calls `FUN_007a3110` on the event's icon.

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

## Not known

- How the radio picks tracks exactly (genre weights, random mode), what makes the `_INTRO` flag (`+0x24C`) set, and what the front end plays in state 4 (the `frontend_loop.wmv` soundtrack is the likely source).
- **Menu music does not work in the web app, because of the format:** `frontend_loop.wmv` and `frontend_intro.wmv` hold WMV3 video with WMA (`wmav2`) stereo audio, which
  browsers cannot decode. The only way in is to transcode the soundtrack (for example `ffmpeg` to Ogg Vorbis) into gitignored storage; that is not done, so state 4 is
  silent. As a stand-in the web app keeps the splash's music (state 6, looped) playing through the menu, options, load, gallery and viewer screens until a game loads.
  (The tutorial `.wmv` clips in `Data/Tutorials/` have the same format problem.)
- The tannoy's trigger rules (`tannoy.csv` and the callers of `Audio_QueueTannoy`) and the other speech categories.
- The META Data `.lug` route, the RLM parameters, the rest of the sample record.
- Which banks the game loads when, and the game-side engine classes (`LHAudioSystem_*`, `CEngine`, event triggers, atmosphere groups, the driver classes
  in `0x00bf3000`-`0x00c02000` and `0x00bc0000`-`0x00bc9000`): mostly unnamed (`LIBRARIES.md`).
