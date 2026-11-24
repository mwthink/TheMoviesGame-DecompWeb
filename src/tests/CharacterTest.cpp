// Tests for game/character: the zlib reader, the star file, the makeup / hair / iris rules and the .fan reader always run on inline values
// (two real info.sm files from the StarMaker editor). The rest needs extracted game files in $OTM_GAME_DATA/sm_assets (tools/pak_extract.py:
// mannequin_sm.anm, sm_generic.msh, generic_facialskin.msh, fe_m_white_joe.anm, starmaker.ini) and saved stars in $OTM_STAR_DIR
// (Documents/The Movies/StarMaker); each part is skipped when its files are missing (the test exits 77 only if every file part was skipped).
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dirent.h>

#include "core/File.hpp"
#include "core/Inflate.hpp"
#include "game/character/Appearance.hpp"
#include "game/character/FaceRig.hpp"
#include "game/character/StarFile.hpp"
#include "tests/CharacterFixtures.hpp"

using namespace otm::character;

static int g_failures = 0;
#define CHECK(cond)                                             \
    do {                                                        \
        if (!(cond)) {                                          \
            std::printf("FAIL line %d: %s\n", __LINE__, #cond); \
            ++g_failures;                                       \
        }                                                       \
    } while (0)
#define NEAR(a, b, tol)                                                                                   \
    do {                                                                                                  \
        const double va_ = (a), vb_ = (b);                                                                \
        if (std::fabs(va_ - vb_) > (tol)) {                                                               \
            std::printf("FAIL line %d: %s = %.6f, want %.6f (+-%g)\n", __LINE__, #a, va_, vb_, (double)(tol)); \
            ++g_failures;                                                                                 \
        }                                                                                                 \
    } while (0)

static std::string FromHex(const char* h) {
    std::string out;
    for (size_t i = 0; h[i] && h[i + 1]; i += 2) out.push_back(static_cast<char>(std::strtol(std::string(h + i, 2).c_str(), nullptr, 16)));
    return out;
}

static void TestInflate() {
    const std::string z = FromHex(kZlibSample);
    std::vector<uint8_t> out;
    CHECK(otm::core::ZlibInflate(reinterpret_cast<const uint8_t*>(z.data()), z.size(), out));
    std::string want;
    for (int i = 0; i < 40; ++i) want += "face rig ";
    for (int i = 0; i < 256; ++i) want.push_back(static_cast<char>(i));
    CHECK(std::string(out.begin(), out.end()) == want);
    std::string bad = z;
    bad[5] ^= 0x55;
    CHECK(!otm::core::ZlibInflate(reinterpret_cast<const uint8_t*>(bad.data()), 3, out));
}

static void TestStarFile() {
    StarInfo dave, base;
    CHECK(ParseInfoSm(FromHex(kDaveJohnInfoSm), dave));
    CHECK(ParseInfoSm(FromHex(kBaselineInfoSm), base));
    // DaveJohn, set up in the editor: head shape slider 0, skin tone 1, age 41, eyebrows 30, eye makeup 7, colour 10, facial hair 4, lipstick 0
    CHECK(dave.name == u"DaveJohn");
    CHECK(dave.gender == 1);
    CHECK(dave.head0 == "head_m_white_hero2.hd" && dave.head1 == "head_m_indian_man2.hd" && dave.hair == "hair_20s_m5.msh");
    NEAR(dave.headBlend, 0.0, 1e-6);
    NEAR(dave.skinBlend, 1.0, 1e-6);
    NEAR(AgeYearsFromSlider(dave.ageSlider), 41.0, 0.5);
    CHECK(dave.eyebrow == 30 && dave.eyeMakeup == 7 && dave.makeupColour == 10 && dave.beard == 4 && dave.lipstick == 0);
    NEAR(dave.attributes[kLooks], 0.3, 1e-6);
    NEAR(dave.attributes[kTrimness], 1.0, 1e-6);
    NEAR(dave.sliders[0], 0.5, 1e-6);
    // Baseline: everything at its default
    CHECK(base.name == u"Baseline" && base.head1.empty());
    NEAR(base.headBlend, 0.5, 1e-6);
    NEAR(base.skinBlend, 0.5, 1e-6);
    CHECK(base.eyebrow == 1 && base.eyeMakeup == 0 && base.makeupColour == 1 && base.beard == 0 && base.lipstick == 0);
    // the writer reproduces the files byte for byte
    CHECK(BuildInfoSm(dave) == FromHex(kDaveJohnInfoSm));
    CHECK(BuildInfoSm(base) == FromHex(kBaselineInfoSm));
    CHECK(FromHex(kDaveJohnInfoSm).size() == kInfoSmFixedSize + 2 * dave.name.size());
    // an unsupported version is rejected
    std::string v3 = FromHex(kBaselineInfoSm);
    v3[0] = 3;
    StarInfo x;
    CHECK(!ParseInfoSm(v3, x));
}

static void TestAppearance() {
    CHECK(MakeupLayerFileName(MakeupCategory::MaleEyebrow, 0).empty());
    CHECK(MakeupLayerFileName(MakeupCategory::MaleEyebrow, 1) == "mup_meyebrow_v00.dds");
    CHECK(MakeupLayerFileName(MakeupCategory::MaleEyebrow, 30) == "mup_meyebrow_v29.dds");
    CHECK(MakeupLayerFileName(MakeupCategory::Beard, 4) == "mup_beard_v03.dds");
    CHECK(MakeupLayerFileName(MakeupCategory::Lips, 11) == "mup_lips_v10.dds");
    CHECK(MakeupLayerFileName(MakeupCategory::EyeMakeupShape, 7) == "mup_eyes_v06.dds");
    CHECK(MakeupLayerFileName(MakeupCategory::EyeMakeupColour, 10) == "mup_eyes_v09.dds");
    CHECK(MakeupCategoryForParamType(2) == 1 && MakeupCategoryForParamType(3) == 0 && MakeupCategoryForParamType(4) == 2 &&
          MakeupCategoryForParamType(5) == 3 && MakeupCategoryForParamType(10) == 5 && MakeupCategoryForParamType(11) == 6 &&
          MakeupCategoryForParamType(12) == 7 && MakeupCategoryForParamType(13) == 4 && MakeupCategoryForParamType(6) == 8);
    CHECK(MakeupOptionCount(13) == 14);
    CHECK(std::strcmp(HairColourSuffix(0), "") == 0 && std::strcmp(HairColourSuffix(3), "_rd") == 0 && std::strcmp(HairColourSuffix(5), "_px") == 0);
    CHECK(HairTextureFile("hair_20s_f1", 2) == "hair_20s_f1_bk.dds");
    NEAR(IrisUvOffset(0).u, 0.0, 1e-9);
    NEAR(IrisUvOffset(6).u, 0.5, 1e-9);
    NEAR(IrisUvOffset(6).v, 0.25, 1e-9);
    NEAR(AgeMorphFromYears(18), 0.0, 1e-9);
    NEAR(AgeMorphFromYears(41), 0.275, 1e-6);
    NEAR(AgeMorphFromYears(80), 1.0, 1e-9);
    CHECK(GreyOverlayAlpha(0.0f) == 0 && GreyOverlayAlpha(1.0f) == 255);
    CHECK(ExpressionAnimationFile("head_m_white_joe.hd") == "fe_m_white_joe.anm");
    CHECK(ExpressionAnimationFile("head_f_white_jane.hd") == "fe_f_white_jane.anm");
    CHECK(ExpressionAnimationFile("hair_20s_m5.msh").empty());
    NEAR(ExpressionEnvelope(100), 0.5, 1e-6);
    NEAR(ExpressionEnvelope(200), 1.0, 1e-6);
    NEAR(ExpressionEnvelope(300), 0.5, 1e-6);
    NEAR(ExpressionEnvelope(500), 0.0, 1e-6);

    // DaveJohn's face layer plan: eye pair, no lipstick, beard 4 with the age grey, eyebrows 30, the hair as a texture layer
    StarInfo dave;
    CHECK(ParseInfoSm(FromHex(kDaveJohnInfoSm), dave));
    const std::vector<FaceLayer> plan = BuildFaceLayerPlan(dave, true);
    CHECK(plan.size() == 4);
    if (plan.size() == 4) {
        CHECK(plan[0].file == "mup_eyes_v06.dds" && plan[0].colourFile == "mup_eyes_v09.dds");
        CHECK(plan[1].file == "mup_beard_v03.dds" && plan[1].greyFile == "mup_beard_v03_gy.dds");
        CHECK(plan[1].greyAlpha == 67);       // age 41 -> morph 0.264 (the slider is 0.48...), x 255
        CHECK(plan[2].file == "mup_meyebrow_v29.dds");
        CHECK(plan[3].file == "hair_20s_m5.dds" && plan[3].greyFile == "hair_20s_m5_gy.dds");
    }
    StarInfo base;
    CHECK(ParseInfoSm(FromHex(kBaselineInfoSm), base));
    const std::vector<FaceLayer> plan0 = BuildFaceLayerPlan(base, true);
    CHECK(plan0.size() == 2);      // eyebrow 1 (v00) and the hair layer; no makeup, beard or lipstick; the colour alone draws nothing

    // .fan: kiss is frame 14 at intensity 1.0, kiss_50 the same frame at 0.5
    unsigned char fan[28] = {1, 0, 0, 0, 0, 0, 0, 0, 14, 0, 0, 0, 0, 0, 0, 0x3f, 0, 0, 0, 0, 0x0e, 0x27, 0, 0, 0, 0, 0, 0};
    FanFile f;
    CHECK(ParseFan(std::string(reinterpret_cast<char*>(fan), 28), f));
    CHECK(f.entries == 1 && f.frame == 14 && f.flagWord == 9998);
    NEAR(f.intensity, 0.5, 1e-9);
}

static void TestHdMorph() {
    HeadFile a, b;
    for (HeadFile* h : {&a, &b}) {
        h->a.assign(kHeadVertexCount, HeadVertex{{1, 2, 3}, {0, 0, 1}});
        h->b.assign(kHeadVertexCount, HeadVertex{{0.1f, 0, 0}, {0, 0, 0}});
        h->c.assign(kHeadVertexCount, HeadVertex{{0, 0.2f, 0}, {0, 0, 0}});
    }
    b.a.assign(kHeadVertexCount, HeadVertex{{3, 2, 1}, {0, 0, 1}});
    std::vector<HeadVertex> out;
    ApplyHdMorph(a, nullptr, 0, 0.5f, 1.0f, out);                     // A + weight * B + age * C
    NEAR(out[7].pos[0], 1.05, 1e-6);
    NEAR(out[7].pos[1], 2.2, 1e-6);
    NEAR(out[7].pos[2], 3.0, 1e-6);
    ApplyHdMorph(a, &b, 0.25f, 0, 0, out);                            // (1 - mix) * first + mix * second
    NEAR(out[0].pos[0], 1.5, 1e-6);
    NEAR(out[0].pos[2], 2.5, 1e-6);
    NEAR(out[0].normal[2], 1.0, 1e-6);                                // normals renormalised
}

static std::string DataDir() {
    const char* d = std::getenv("OTM_GAME_DATA");
    return std::string(d ? d : "data/game_data") + "/sm_assets/";
}

static bool Load(const std::string& path, std::string& out) { return otm::core::ReadFile(path, out); }

// The sliders reproduced from the game's own data against saved stars (docs/STARMAKER.md section 7): the same vertices move, to 0.1 mm.
static bool TestSliders(const std::string& starDir) {
    std::string anmBytes, mshBytes, iniText;
    if (!Load(DataDir() + "mannequin_sm.anm", anmBytes) || !Load(DataDir() + "sm_generic.msh", mshBytes) || !Load(DataDir() + "starmaker.ini", iniText)) return false;
    AnmFile anm;
    MshFile msh;
    std::string err;
    CHECK(AnmFile::Parse(anmBytes, anm, &err));
    CHECK(MshFile::Parse(mshBytes, msh, &err));
    CHECK(anm.frameCount == 134 && anm.channelCount == 108);
    CHECK(msh.bones.size() == 108 && msh.primitives.size() == 3);
    CHECK(msh.primitives[0].vertices.size() == 760 && msh.primitives[1].vertices.size() == 58 && msh.primitives[2].vertices.size() == 178);
    FaceRig rig;
    CHECK(rig.Init(msh, anm, &err));
    CHECK(rig.VertexCount() == kHeadVertexCount);
    const std::vector<SliderDef> defs = ParseSliderIni(iniText);
    CHECK(defs.size() == 43);
    CHECK(defs[0].name == "nose_length" && defs[0].firstFrame == 1 && defs[0].axis == 2);
    CHECK(defs[22].name == "teeth_move_in_out" && defs[22].firstFrame == 130);
    NEAR(SliderFrame(defs[0], 0.5f), 1.995, 1e-5);
    NEAR(SliderFrame(defs[0], 1.0f), 2.99, 1e-5);

    // find the saved stars by the name inside their info.sm
    struct Found { StarInfo info; HeadFile hd; };
    Found baseline, crazy;
    bool haveBase = false, haveCrazy = false;
    if (DIR* dir = opendir(starDir.c_str())) {
        while (dirent* e = readdir(dir)) {
            if (e->d_name[0] == '.') continue;
            std::string info, hd;
            if (!Load(starDir + "/" + e->d_name + "/info.sm", info) || !Load(starDir + "/" + e->d_name + "/star.hd", hd)) continue;
            StarInfo si;
            HeadFile h;
            if (!ParseInfoSm(info, si) || !HeadFile::Parse(hd, h)) continue;
            if (si.name == u"Baseline") { baseline = {si, h}; haveBase = true; }
            if (si.name == u"CrazySliders") { crazy = {si, h}; haveCrazy = true; }
        }
        closedir(dir);
    }
    if (!haveBase || !haveCrazy) return false;
    std::vector<Vec3> start;
    for (const HeadVertex& v : baseline.hd.a) start.push_back({v.pos[0], v.pos[1], v.pos[2]});
    const std::vector<Vec3> predicted = ApplyFaceSliders(rig, defs, crazy.info.sliders.data(), start, SliderMode::DeltaFromNeutral);
    double sumSq = 0, maxErr = 0, sumObs = 0;
    int moved = 0, predictedMoved = 0;
    for (int i = 0; i < kHeadVertexCount; ++i) {
        double e2 = 0, o2 = 0, p2 = 0;
        for (int j = 0; j < 3; ++j) {
            const double obs = crazy.hd.a[i].pos[j] - baseline.hd.a[i].pos[j];
            const double pred = predicted[i][j] - start[i][j];
            e2 += (obs - pred) * (obs - pred);
            o2 += obs * obs;
            p2 += pred * pred;
        }
        sumSq += e2;
        sumObs += o2;
        if (std::sqrt(e2) > maxErr) maxErr = std::sqrt(e2);
        if (std::sqrt(o2) > 1e-5) ++moved;
        if (std::sqrt(p2) > 1e-5) ++predictedMoved;
    }
    const double rms = std::sqrt(sumSq / kHeadVertexCount), rmsObs = std::sqrt(sumObs / kHeadVertexCount);
    std::printf("CrazySliders: %d vertices moved (predicted %d), rms signal %.5f, rms error %.5f, max error %.5f\n", moved, predictedMoved, rmsObs, rms, maxErr);
    CHECK(moved == 457 && predictedMoved == 457);
    CHECK(rmsObs > 0.004);
    CHECK(rms < 0.0001);          // 0.1 mm
    CHECK(maxErr < 0.0003);
    // the editor's own rule (each pass replaces the positions) applied to the head the Baseline was made from reproduces it to about 1.2 mm
    // (a nearly constant ~1 mm shift is left over; see docs/STARMAKER.md section 10)
    std::string joeBytes;
    HeadFile joe;
    if (Load(std::string(std::getenv("OTM_GAME_DATA") ? std::getenv("OTM_GAME_DATA") : "data/game_data") + "/people/data/heads/head_m_white_joe.hd", joeBytes) &&
        HeadFile::Parse(joeBytes, joe)) {
        std::vector<Vec3> p;
        for (const HeadVertex& v : joe.a) p.push_back({v.pos[0], v.pos[1], v.pos[2]});
        p = ApplyFaceSliders(rig, defs, baseline.info.sliders.data(), p, SliderMode::Replace);
        double s2 = 0;
        for (int i = 0; i < kHeadVertexCount; ++i)
            for (int j = 0; j < 3; ++j) s2 += (p[i][j] - baseline.hd.a[i].pos[j]) * (p[i][j] - baseline.hd.a[i].pos[j]);
        const double r = std::sqrt(s2 / (kHeadVertexCount * 3));
        std::printf("Baseline from head_m_white_joe.hd with 43 neutral passes: rms %.5f\n", r);
        CHECK(r < 0.0015);
    }
    return true;
}

// Facial expressions: the frames move the bones the names say (docs/STARMAKER.md section 8).
static bool TestExpressions() {
    std::string anmBytes, mshBytes;
    if (!Load(DataDir() + "fe_m_white_joe.anm", anmBytes) || !Load(DataDir() + "generic_facialskin.msh", mshBytes)) return false;
    AnmFile anm;
    MshFile msh;
    std::string err;
    CHECK(AnmFile::Parse(anmBytes, anm, &err));
    CHECK(MshFile::Parse(mshBytes, msh, &err));
    CHECK(anm.frameCount == kExpressionFrameCount && anm.channelCount == 35);
    CHECK(msh.bones.size() == 65);
    FaceRig rig;
    CHECK(rig.Init(msh, anm, &err));
    const std::vector<Vec3> bind = rig.BindPositions();
    const std::vector<Vec3> smile = ApplyExpression(rig, bind, 1, 1.0f);
    const std::vector<Vec3> blinkRight = ApplyExpression(rig, bind, 29, 1.0f);
    const std::vector<Vec3> half = ApplyExpression(rig, bind, 1, 0.5f);
    // face vertices: mouth region (z 1.64..1.67, |y| < 0.06) moves with a smile; with intensity 0.5 it moves half as much
    double smileMove = 0, halfMove = 0, blinkLeftSide = 0, blinkRightSide = 0;
    for (size_t i = 0; i < bind.size(); ++i) {
        const double ds = std::fabs(smile[i][2] - bind[i][2]) + std::fabs(smile[i][0] - bind[i][0]) + std::fabs(smile[i][1] - bind[i][1]);
        const double dh = std::fabs(half[i][2] - bind[i][2]) + std::fabs(half[i][0] - bind[i][0]) + std::fabs(half[i][1] - bind[i][1]);
        if (bind[i][2] > 1.60 && bind[i][2] < 1.68 && std::fabs(bind[i][1]) < 0.07) { smileMove += ds; halfMove += dh; }
        const double db = std::fabs(blinkRight[i][2] - bind[i][2]) + std::fabs(blinkRight[i][1] - bind[i][1]) + std::fabs(blinkRight[i][0] - bind[i][0]);
        if (bind[i][2] > 1.70) { if (bind[i][1] < -0.01) blinkRightSide += db; else if (bind[i][1] > 0.01) blinkLeftSide += db; }
    }
    std::printf("expressions: smile mouth move %.4f (half %.4f), blinkright eye-side move %.4f vs other side %.4f\n", smileMove, halfMove, blinkRightSide, blinkLeftSide);
    CHECK(smileMove > 0.01);
    NEAR(halfMove, smileMove / 2, smileMove * 0.02);
    CHECK(blinkRightSide > 5 * blinkLeftSide);      // blinkright (frame 29) closes only the right eyelid (negative y)
    return true;
}

int main() {
    TestInflate();
    TestStarFile();
    TestAppearance();
    TestHdMorph();
    const char* stars = std::getenv("OTM_STAR_DIR");
    const bool sl = stars ? TestSliders(stars) : false;
    const bool ex = TestExpressions();
    if (!sl) std::printf("skipped: sliders (needs the extracted game files and OTM_STAR_DIR with the saved stars)\n");
    if (!ex) std::printf("skipped: expressions (needs the extracted game files)\n");
    if (g_failures == 0) std::printf("character: all checks passed%s\n", (sl && ex) ? "" : " (some file checks skipped)");
    return g_failures == 0 ? 0 : 1;
}
