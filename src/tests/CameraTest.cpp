// Checks the gameplay camera port (game/camera/GameCamera.cpp, docs/CAMERA.md) against numbers worked out by hand from the decompile, and
// reads the real Data\ui\camera.ini when $OTM_GAME_DATA holds it (exit 77 for that part when it does not, after the inline checks pass).
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "core/Ini.hpp"
#include "game/camera/GameCamera.hpp"

using namespace otm::camera;

static int g_failures = 0;
#define CHECK(cond)                                             \
    do {                                                        \
        if (!(cond)) {                                          \
            std::printf("FAIL line %d: %s\n", __LINE__, #cond); \
            ++g_failures;                                       \
        }                                                       \
    } while (0)
static bool Near(float a, float b, float eps = 1e-3f) { return std::fabs(a - b) <= eps; }

static const char* kIni = R"(wheelscale = 10
pushdistance = 10
[normal]
	startfocus = -0.68345982,13.165312,1.6000000
	heading = 0.0, 57.0,-70.0
	fov = 0.8
	zoomcurve = 2.0
	cameraspeed = 300
	rotationspeed = 0.4
	zoomspeed = 0.5
	acceleration = 150
	maxvelocity = 40
	damping = 0.001
	startzoom = 0.25
)";

static GameCamera Make(std::vector<std::string>& problems) {
    const auto ini = otm::core::IniFile::Parse(kIni);
    // CLot_ComputeWorldBoundsFromTier for the Quick Start lot: x -164.6 .. 148.75, y 2.2 .. 222.2 (docs/WEB.md)
    Bounds b{-164.6f, 2.2f, 148.75f, 222.2f};
    return GameCamera(ParseState(ini, "normal", problems), ParseGlobals(ini, problems), b);
}

int main() {
    std::vector<std::string> problems;
    const auto ini = otm::core::IniFile::Parse(kIni);

    // ---- the settings reader (FUN_00417010) ----
    const StateParams p = ParseState(ini, "normal", problems);
    CHECK(problems.empty());
    CHECK(Near(p.heading.y, 57) && Near(p.heading.z, -70) && Near(p.startFocus.x, -0.68346f) && Near(p.startFocus.z, 1.6f));
    CHECK(Near(p.fov, 0.8f) && Near(p.zoomCurve, 2.0f) && Near(p.acceleration, 150) && Near(p.maxVelocity, 40) && Near(p.damping, 0.001f));
    CHECK(Near(p.rotationSpeed, 0.4f) && Near(p.zoomSpeed, 0.5f) && Near(p.startZoom, 0.25f));
    CHECK(Near(p.wheelSpeed, 1.0f));   // missing -> 1.0
    const StateParams plan = ParseState(otm::core::IniFile::Parse("[plan]\nheading = 0,200,-300\nstartfocus=0,0,0\nzoomcurve=0.4\n"), "plan", problems);
    CHECK(Near(plan.fov, 1.0f) && Near(plan.cameraSpeed, 300) && Near(plan.acceleration, 300) && Near(plan.maxVelocity, 30) && Near(plan.damping, 0.2f));
    CHECK(Near(plan.rotationSpeed, 2.0f) && Near(plan.zoomSpeed, 2.0f));
    const Globals g = ParseGlobals(ini, problems);
    CHECK(Near(g.wheelScale, 10) && Near(g.pushDistance, 10));

    // ---- pure helpers ----
    // rotating the point (-1,0,0) about the origin and +z by 90 degrees: the vector point->pivot (1,0,0) turns to (0,1,0), the point to (0,-1,0)
    const Vec3 r = GameCamera::RotateAbout({-1, 0, 0}, {0, 0, 0}, {0, 0, 1}, 1.57079633f);
    CHECK(Near(r.x, 0) && Near(r.y, -1) && Near(r.z, 0));
    CHECK(GameCamera::RotateAbout({3, 4, 5}, {0, 0, 0}, {0, 0, 1}, 0.0f).x == 3);
    CHECK(Near(GameCamera::WrapAngle(7.0f), 7.0f - 6.2831853f));
    CHECK(Near(GameCamera::WrapAngle(-7.0f), -7.0f + 6.2831853f));
    CHECK(Near(GameCamera::WrapAngle(1.0f), 1.0f));
    // FUN_004166A0 with the rectangle x -10..10, y 0..20 (so the limits are x -8.5..8.5, y 1.5..18.5)
    const Bounds bb{-10, 0, 10, 20};
    float px = 0, py = 0;
    GameCamera::ClampPush(bb, 0, 10, 0, px, py);
    CHECK(px == 0 && py == 0);
    GameCamera::ClampPush(bb, -20, 10, 0, px, py);
    CHECK(Near(px, 11.5f) && py == 0);
    px = py = 0;
    GameCamera::ClampPush(bb, 0, -3, 2.0f, px, py);           // y limit is 1.5 - 2 = -0.5
    CHECK(px == 0 && Near(py, 2.5f));
    px = py = 0;
    GameCamera::ClampPush(bb, 0, -3, -1.0f, px, py);          // a negative margin skips the low-y test
    CHECK(py == 0);
    px = py = 0;
    GameCamera::ClampPush(bb, 0, 30, -1.0f, px, py);
    CHECK(Near(py, -11.5f));
    px = 5; py = 0;
    GameCamera::ClampPush(bb, -20, 10, 0, px, py);            // keeps the larger of the old and new push
    CHECK(Near(px, 11.5f));
    px = -20; py = 0;
    GameCamera::ClampPush(bb, -20, 10, 0, px, py);
    CHECK(Near(px, -20));

    // ---- the start state: focus = startfocus, eye derived from heading, zoom 0.25 ----
    {
        GameCamera c = Make(problems);
        CHECK(Near(c.focus().x, -0.68346f) && Near(c.focus().y, 13.165312f) && Near(c.focus().z, 1.6f));
        CHECK(Near(c.zoom(), 0.25f) && Near(c.angle(), 0) && Near(c.fov(), 0.8f));
        // eye.x = focus.x; eye.y = 13.165 - 57 + 0.25 * 57 = -29.585; eye.z: ratio (1-0.25)*70/71.6 = 0.7331, squared 0.5375 * 71.6 + 1.6 - 2.7 = 37.39
        CHECK(Near(c.eye().x, -0.68346f, 1e-2f) && Near(c.eye().y, -29.585f, 1e-2f) && Near(c.eye().z, 37.39f, 0.05f));
    }

    // ---- against the game's own numbers: the camera a save stores (CLot SL_CamPos / SL_CamFoc / SL_CamRot / SL_CamZoo, from
    //      "quick film studios22 January 1960"): given the focus, angle and zoom, the eye must come out as saved ----
    {
        GameCamera c = Make(problems);
        c.Restore({-46.27315140f, 15.34938335f, 1.6f}, 0.0f, 0.005999999586f);
        CHECK(Near(c.eye().x, -46.27315140f, 1e-3f));
        CHECK(Near(c.eye().y, -41.30861664f, 1e-3f));
        CHECK(Near(c.eye().z, 66.51699829f, 1e-3f));
        // a close zoom, where the low-eye pull-in factor (eye.z - 1.6) * 0.05 + 0.1 drops below 1 ("quick film studios3 May 1960")
        c.Restore({71.15304565f, 55.86415100f, 1.6f}, 0.0f, 0.5820001960f);
        CHECK(Near(c.eye().x, 71.15304565f, 1e-3f) && Near(c.eye().y, 42.45326996f, 1e-3f) && Near(c.eye().z, 6.810667992f, 1e-3f));
        // and the far zoom 0 of "quick film studios7 April 1960"
        c.Restore({54.17318344f, 27.63374137f, 1.6f}, 0.0f, 0.0f);
        CHECK(Near(c.eye().z, 67.33575439f, 1e-3f) && Near(c.eye().y, -29.36614f, 0.01f));
    }

    // ---- no input: the camera stays put ----
    {
        GameCamera c = Make(problems);
        Input in; in.dt = 1.0f / 60;
        const Vec3 f0 = c.focus(); const float z0 = c.zoom();
        for (int i = 0; i < 120; ++i) c.Tick(in);
        CHECK(Near(c.focus().x, f0.x, 1e-3f) && Near(c.focus().y, f0.y, 1e-3f) && Near(c.zoom(), z0, 1e-6f));
    }

    // ---- forward key: the focus moves along the view's ground direction (+y), at most maxvelocity ----
    {
        GameCamera c = Make(problems);
        Input in; in.dt = 1.0f / 60; in.forward = true;
        const float y0 = c.focus().y;
        for (int i = 0; i < 60; ++i) c.Tick(in);
        CHECK(c.focus().y > y0 + 5.0f);
        CHECK(Near(c.focus().x, -0.68346f, 1e-2f));
        // velocity is capped at maxvelocity 40 units/s (a pan of velocity * dt * (1 - zoom) per frame)
        CHECK(c.debug().keyVelY <= 40.0001f);
        in.forward = false;
        const float y1 = c.focus().y;
        for (int i = 0; i < 60; ++i) c.Tick(in);
        const float y2 = c.focus().y;
        CHECK(y2 - y1 > 2.0f && y2 - y1 < 6.0f);   // it coasts about 4 units (40 * dt * 0.75 summed with a 0.891 decay per frame) ...
        for (int i = 0; i < 60; ++i) c.Tick(in);
        CHECK(c.focus().y - y2 < 0.01f);           // ... and has stopped a second later (damping 0.001 per second)
    }

    // ---- wheel zoom: 120 units = 0.12 * wheelspeed, times zoomspeed 0.5 = 0.06 per notch; clamped to 0..0.8 ----
    {
        GameCamera c = Make(problems);
        Input in; in.dt = 1.0f / 60; in.wheel = 120;
        c.Tick(in);
        CHECK(Near(c.zoom(), 0.25f + 0.06f, 1e-4f));
        in.wheel = 120 * 50;
        c.Tick(in);
        CHECK(Near(c.zoom(), GameCamera::kMaxZoom));
        in.wheel = -120 * 100;
        c.Tick(in);
        CHECK(Near(c.zoom(), 0.0f));
        // a wheel over a window is ignored
        in.wheel = 120; in.wheelOverUi = true;
        const float z = c.zoom();
        c.Tick(in);
        CHECK(Near(c.zoom(), z));
    }

    // ---- the lot clamp: push the focus far outside and the view comes back inside ----
    {
        GameCamera c = Make(problems);
        Input in; in.dt = 1.0f / 60; in.left = true;
        for (int i = 0; i < 60 * 30; ++i) c.Tick(in);
        // left edge: the lower corners and top centre stay inside x >= -164.6 + 1.5 (the focus is nearer the middle of the view)
        CHECK(c.focus().x > -164.6f);
        CHECK(c.focus().x < -100.0f);   // it did travel a long way left
    }

    // ---- the real file ----
    const char* dir = std::getenv("OTM_GAME_DATA");
    if (!dir) { std::printf("game files not found (set OTM_GAME_DATA): skipping the check against the real camera.ini\n"); return g_failures ? 1 : 77; }
    otm::core::IniFile real;
    const std::string path = std::string(dir) + "/olt/data/ui/camera.ini";
    if (!otm::core::IniFile::Load(path, real)) { std::printf("%s not found: skipping\n", path.c_str()); return g_failures ? 1 : 77; }
    std::vector<std::string> pr;
    const StateParams n = ParseState(real, "normal", pr);
    CHECK(pr.empty());
    CHECK(Near(n.startFocus.y, 13.165312f) && Near(n.heading.z, -70) && Near(n.zoomCurve, 2.0f) && Near(n.maxVelocity, 40));
    const StateParams fr = ParseState(real, "freecam", pr);
    CHECK(Near(fr.maxVelocity, 0.15f) && Near(fr.wheelSpeed, 10.0f));
    if (g_failures) std::printf("%d failures\n", g_failures);
    else std::printf("camera: all checks passed\n");
    return g_failures ? 1 : 0;
}
