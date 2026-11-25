// movie-calc: estimates a movie's quality, success and box office from plain inputs, and compares marketing levels.
//
//   npm run movie-calc -- --script 0.6 --stars 0.7,0.5 --hype 0.3 --marketing 3
//   npm run movie-calc -- --quality 0.62 --hype 0.31 --compare-marketing --tech --stars 0.94
//
// The tuning comes from the game's own data files when the game is found (OTM_GAME_DIR, see local.env.example), else the built-in defaults, which are
// the shipped values. --defaults forces the defaults. Run with --help for the options.
import { readdirSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ByteSource } from "../src/assets/ByteSource.ts";
import { PakIndex } from "../src/assets/Pak.ts";
import { newReport } from "../src/sim/core/Tuning.ts";
import { compareMarketingLevels, estimateInput, estimateMovie, type EstimateInput, type EstimateResult } from "../src/sim/movie/MovieEstimate.ts";
import { buildMovieTuning, emptySources, loadMovieTuning } from "../src/sim/movie/TuningLoader.ts";
import { PAK_DIR } from "../localPaths.ts";

const USAGE = `usage: npm run movie-calc -- [options]
quality:  --script S        script quality 0..1 (default 0.6)
          --cast-perf P     mean actor performance (default 1.0)
          --chemistry C     mean relationship between cast stars 0..1 (default 0.5)
          --no-stars        the movie has no stars (relationship factor 0.8)
          --set-repair R    0..1 (default 1)      --crew M   mean crew 'Movies' trait (default 0.5 = neutral)
          --preprod N       pre-production updates (default 3000 = full weight; 10 per second)
          --quality Q       skip the quality chain and use Q as the movie's quality
market:   --stars a,b,c     the cast stars' ratings (default none)
          --trend T         audience taste for the genre 0..1 (default 0.5)
          --saturation S    genre saturation 0..1 (default 0)     --trendsetter   Trendsetter bonus active
          --sets a,b,c      boredom of each set (default one fresh set)
          --cast-boredom a,b  boredom of each cast member and the director
          --tech            a moviemaking technology is ahead of its time (x1.1)
          --hype H          accumulated PR hype 0..1 (default 0)   --on-the-radar   On The Radar bonus active
          --marketing L     marketing level 0..5 (default 1: none)
          --symmetric-imbalance   read the hype/marketing imbalance as |hype - D| (the older notes' reading)
other:    --compare-marketing     table of levels 1..5        --defaults   use the built-in tuning, not the game's files`;

/** A file on disk read in ranges, as the archive reader asks for slices. */
class FileSource implements ByteSource {
  readonly name: string;
  readonly size: number;
  private readonly path: string;
  constructor(path: string, size: number) {
    this.name = path.split("/").pop()!;
    this.path = path;
    this.size = size;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    const fh = await open(this.path, "r");
    try {
      const buf = new Uint8Array(Math.min(length, this.size - offset));
      const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }
}

const list = (s: string) => s.split(",").map(Number).filter((x) => !Number.isNaN(x));
const fixed = (x: number, d: number, w = 0) => x.toFixed(d).padStart(w);

function printResult(input: EstimateInput, r: EstimateResult): void {
  console.log(`quality   shot ${fixed(r.shotQuality, 4)}   movie Qm ${fixed(r.finalQuality, 4)}`);
  console.log(
    `market    PI ${fixed(r.factors.publicInterest, 4)} (hype counted ${fixed(r.cappedHype, 3)}, marketing D ${fixed(r.marketingD, 3)}, coverage ${fixed(r.coverage, 3)})   ` +
      `SR ${fixed(r.factors.starRatings, 4)}   GP ${fixed(r.factors.genrePopularity, 4)}   BO ${fixed(r.factors.boredom, 4)}   TP ${fixed(r.factors.techPioneering, 2)}`,
  );
  console.log(`success   S ${fixed(r.success, 4)}   star rating ${fixed(r.starRating, 4)}`);
  console.log(
    `revenue   box office $${fixed(r.boxOffice, 0)}   marketing level ${input.marketingLevel} costs $${fixed(r.marketingCost, 0)}   net $${fixed(r.netBoxOffice, 0)}   ` +
      `${fixed(100 * r.firstYearShare, 0)}% paid in the first year`,
  );
}

async function main(argv: string[]): Promise<number> {
  const input = estimateInput();
  let compare = false;
  let defaults = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    const num = () => Number(next());
    switch (a) {
      case "--help": case "-h": console.log(USAGE); return 0;
      case "--script": input.scriptQuality = num(); break;
      case "--cast-perf": input.castPerformance = num(); break;
      case "--chemistry": input.chemistry = num(); break;
      case "--no-stars": input.hasStars = false; break;
      case "--set-repair": input.setRepair = num(); break;
      case "--crew": input.crewMoviesTrait = num(); break;
      case "--preprod": input.preProductionTicks = Math.trunc(num()); break;
      case "--quality": input.qualityOverride = num(); break;
      case "--stars": input.starRatings = list(next()); break;
      case "--trend": input.genreTrend = num(); break;
      case "--saturation": input.genreSaturation = num(); break;
      case "--trendsetter": input.trendsetter = true; break;
      case "--sets": input.setBoredom = list(next()); break;
      case "--cast-boredom": input.castBoredom = list(next()); break;
      case "--tech": input.techPioneer = true; break;
      case "--hype": input.hype = num(); break;
      case "--on-the-radar": input.onTheRadar = true; break;
      case "--marketing": input.marketingLevel = Math.trunc(num()); break;
      case "--symmetric-imbalance": input.symmetricImbalance = true; break;
      case "--compare-marketing": compare = true; break;
      case "--defaults": defaults = true; break;
      default: console.error(`unknown option ${a} (try --help)`); return 2;
    }
  }

  let tuning = buildMovieTuning(emptySources());
  let paks: string[] = [];
  try {
    paks = PAK_DIR && !defaults ? readdirSync(PAK_DIR).filter((n) => n.toLowerCase().endsWith(".pak")) : [];
  } catch {
    // no game here: the defaults
  }
  if (paks.length) {
    const sources = await Promise.all(paks.map(async (n) => new FileSource(join(PAK_DIR!, n), (await stat(join(PAK_DIR!, n))).size)));
    const report = newReport();
    tuning = await loadMovieTuning(await PakIndex.open(sources), report);
    for (const p of report.problems) console.error(`tuning: ${p}`);
    console.log("tuning from the game's data files");
  } else console.log("tuning: built-in defaults (the shipped values)");

  if (!compare) {
    printResult(input, estimateMovie(input, tuning.success, tuning.quality));
    return 0;
  }
  const levels = compareMarketingLevels(input, tuning.success, tuning.quality);
  console.log(`Qm ${fixed(levels[0]!.finalQuality, 4)}   hype counted ${fixed(levels[0]!.cappedHype, 3)}`);
  console.log("level  cost       D      PI      S       box office   net of cost   vs level 1");
  let best = 0;
  levels.forEach((r, i) => {
    const vs = r.netBoxOffice - levels[0]!.netBoxOffice;
    console.log(
      `${String(i + 1).padStart(5)}  ${fixed(r.marketingCost, 0, 8)}  ${fixed(r.marketingD, 3)}  ${fixed(r.factors.publicInterest, 4)}  ${fixed(r.success, 4)}  ` +
        `${fixed(r.boxOffice, 0, 11)}  ${fixed(r.netBoxOffice, 0, 12)}  ${((vs >= 0 ? "+" : "") + vs.toFixed(0)).padStart(10)}`,
    );
    if (r.netBoxOffice > levels[best]!.netBoxOffice) best = i;
  });
  console.log(`best level: ${best + 1}`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(String(e));
    process.exit(2);
  },
);
