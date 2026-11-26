# Third-party notices

Material from other projects that is committed here, with its source and license.

## FableDecomp

- **Source:** `BuffJesus/FableDecomp` (https://github.com/BuffJesus/FableDecomp), read by `tools/match_fable.py` from a local clone.
- **What is copied:** the function names and automatic-naming notes in `fable_matches.csv` (`fable_name`, `fable_label_note`) and in the `fable_hint`
  column of `library_map.csv`. See `docs/LIBRARIES.md` for how they were matched.
- **License:** MIT, reproduced below.

```
MIT License

Copyright (c) 2026 FableDecomp contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## three.js

`viewer/vendor/three.core.js` and `viewer/vendor/three.module.js` are three.js (MIT, Copyright 2010-2026 Three.js Authors); the license header is kept
in each file.

## mpg123-decoder

- **Source:** the `mpg123-decoder` npm package (https://github.com/eshaz/wasm-audio-decoders), a WebAssembly build of mpg123, with its dependency `@wasm-audio-decoders/common`.
- **Use:** a runtime dependency of `web/` (installed from npm, not copied into this repository), used to decode the MPEG Layer II speech clips (`web/src/formats/WavMpeg.ts`).
- **License:** the packages are MIT; the decoder inside is mpg123 (LGPL-2.1), used unmodified.
