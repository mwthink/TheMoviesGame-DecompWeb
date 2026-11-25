// The in-lot gameplay camera ("normal" mode of the game's camera manager).
//
// Reimplemented from the decompile and the disassembly of MoviesSE.exe. The manager is one object (size 0x33C, global
// DAT_00f87aa0, constructor FUN_0041B730) holding a state machine; each state is a record of settings read from the section of
// Data\ui\camera.ini that has its name, plus a handful of callbacks. This file ports state 0x462 "normal" only, which is the
// camera the player has while managing the studio. Derivation, field map, open questions: docs/CAMERA.md.
//
//   Camera_StateMachine_Transition   0x0041A610   builds a state record and registers its callbacks (case 0x462 = normal)
//   Camera_RegisterDebugStates       0x0041C240   state-name table MT_CAMERA_CASE_*
//   FUN_0041B730                     0x0041B730   the manager's constructor: initial focus, eye, zoom; wheelscale, pushdistance
//   FUN_00417010                     0x00417010   reads one camera.ini section into a state record (ParseState here)
//   FUN_00419E50                     0x00419E50   the per-frame tick (GameCamera::Tick)
//   FUN_00414060                     0x00414060   keyboard scroll / rotate / zoom
//   FUN_00418FE0                     0x00418FE0   mouse: edge scroll, drag rotate, wheel zoom and field of view
//   FUN_00414260                     0x00414260   the four extra scroll keys (codes 0x7D..0x80)
//   FUN_004198A0                     0x004198A0   combines the inputs, x3 with the "fast" modifier
//   FUN_004149F0 / LAB_004128A0 / LAB_00414BF0 / FUN_00414C90   the pan, zoom, rotate and reset callbacks of the normal state
//   LAB_00412750                     0x00412750   applies this frame's pan to eye and focus
//   FUN_004162C0                     0x004162C0   places the eye from focus, heading, zoom, zoomcurve and angle
//   LAB_004167B0 / FUN_004166A0      0x004167B0   keeps the camera inside the lot rectangle
//   FUN_00414F90                     0x00414F90   field of view, look-at and near plane
//   FUN_00414360                     0x00414360   rotate a point about an axis through another point (quaternion)
//
// It owns no window, input device or lot: the caller passes in what it observed (Input) and the lot rectangle (Bounds), and reads
// back the eye, the focus and the projection numbers. Nothing here has been compared with the running game.
#pragma once

#include <string>
#include <vector>

#include "core/Ini.hpp"

namespace otm::camera {

// Game coordinates: right-handed, z up, ground in x and y.
struct Vec3 {
    float x = 0, y = 0, z = 0;
};

// One [section] of Data\ui\camera.ini as FUN_00417010 reads it. Offsets are in the state record. A key that is missing or 0 takes
// the default the reader substitutes (listed per field); fov, cameraspeed, ... default only when 0, zoomcurve has no default.
struct StateParams {
    Vec3 heading{0, 57, -70};       // +0x20  "heading": the vector from the eye to the focus at zoom 0
    Vec3 startFocus{0, 0, 0};       // +0x2C  "startfocus"
    float fov = 1.0f;               // +0x40  "fov", radians, HORIZONTAL (the projection's half width is tan(fov/2) * near); 0 -> 1.0
    float cameraSpeed = 300.0f;     // +0x44  "cameraspeed"; 0 -> 300. Read, and only used as the default of acceleration
    float rotationSpeed = 2.0f;     // +0x48  "rotationspeed"; 0 -> 2.0. Multiplies the frame's rotation-velocity accumulator (see Tick)
    float zoomSpeed = 2.0f;         // +0x4C  "zoomspeed"; 0 -> 2.0. Multiplies the frame's zoom input before it is added to the zoom
    float wheelSpeed = 1.0f;        // +0x50  "wheelspeed"; 0 -> 1.0. Multiplies the wheel accumulator
    float zoomCurve = 0.0f;         // +0x54  "zoomcurve": exponent of the eye-height curve (no default; 0 gives a flat eye height)
    bool exclusive = false;         // +0x58  "exclusive" (used by the debug states; not by normal)
    float acceleration = 300.0f;    // +0x5C  "acceleration"; 0 -> cameraSpeed
    float maxVelocity = 30.0f;      // +0x60  "maxvelocity"; 0 -> 30
    float damping = 0.2f;           // +0x64  "damping"; 0 -> 0.2. Per second: velocity *= pow(damping, dt) when nothing pushes
    float startZoom = 0.0f;         // +0x78  "startzoom" (0 is a valid value)
};

// Reads [section] (e.g. "normal"). Missing keys are appended to `problems` and take the defaults above.
StateParams ParseState(const core::IniFile& ini, const char* section, std::vector<std::string>& problems);

// The manager's two globals read from the top of camera.ini by FUN_0041B730.
struct Globals {
    float wheelScale = 10.0f;       // "wheelscale"; the code keeps 1000 / wheelscale (DAT_00E4E410)
    float pushDistance = 10.0f;     // "pushdistance"; the code keeps its square (DAT_00E4E414)
};
Globals ParseGlobals(const core::IniFile& ini, std::vector<std::string>& problems);

// The lot rectangle the camera is kept inside: CLot +0x44C (minX), +0x450 (minY), +0x454 (maxX), +0x458 (maxY), filled by
// CLot_ComputeWorldBoundsFromTier (0x00467260): minX = lot.x + anchorA.x - (n / 2) * 20 where n = the number of front-wall segments
// ((tierWidth - (anchorB.x - anchorA.x) + 0.5) * 0.05, truncated); maxX = minX + tierWidth; minY = lot.y + 2.0; maxY = minY + tierDepth.
struct Bounds {
    float minX = -1e9f, minY = -1e9f, maxX = 1e9f, maxY = 1e9f;
};

// What the caller observed this frame.
struct Input {
    float dt = 0.0f;                // FUN_00990AA0: seconds since the previous frame (Tick clamps it to within 0.05 of the previous one)
    // Keyboard. The first four are the actions 2..5 of the key-binding table (default keys: arrows and A D W S; docs/CAMERA.md).
    bool left = false, right = false, forward = false, back = false;
    bool rotateModifier = false;    // engine key 0x38 or 0x39 held: the scroll keys rotate (left/right) and zoom (forward/back) instead
    bool fastModifier = false;      // engine key 0x3A or 0x3B held: every scroll, rotate and zoom input is tripled
    bool altLeft = false, altRight = false, altForward = false, altBack = false;   // engine keys 0x7F, 0x80, 0x7D, 0x7E
    // Mouse, in pixels with the origin at the top left of the viewport.
    float mouseX = 0, mouseY = 0;
    float mouseRelX = 0, mouseRelY = 0;   // the pointer's motion this frame (DAT_0104CCE8/EC)
    float viewportW = 800, viewportH = 600;
    bool windowFocused = true;      // FUN_00553F60
    bool edgeScrollEnabled = true;  // DAT_00E4E41C (an option)
    bool rotateDrag = false;        // engine key 0x75 held (a mouse button; docs/CAMERA.md says which)
    float wheel = 0.0f;             // wheel units this frame; the code takes them as they come (unit unconfirmed: 120 per notch assumed)
    bool wheelOverUi = false;       // LAB_004128A0 skips the zoom input when FUN_00640A80(FUN_00642110()) is true (a window under the pointer)
    bool resetRequested = false;    // the reset callback FUN_00414C90's flag
};

// Orbit and zoom state of the manager and its derived projection numbers.
class GameCamera {
public:
    GameCamera(const StateParams& normal, const Globals& globals, const Bounds& bounds);

    // FUN_0041B730's initial values: focus = startfocus, eye = focus - heading, zoom = startzoom, angle 0, fov scale 1.
    void Reset();
    // Puts the camera where a saved game had it: CLot's SL_CamFoc (focus), SL_CamRot (angle) and SL_CamZoo (zoom). SL_CamPos (the eye) is
    // implied by them: FUN_004162C0 gives, for a save's values, the saved eye to within float rounding (CameraTest).
    void Restore(const Vec3& focus, float angle, float zoom);
    // One frame: FUN_00419E50 for the normal state.
    void Tick(const Input& in);

    const Vec3& eye() const { return eye_; }               // +0xD0
    const Vec3& focus() const { return focus_; }           // +0xDC
    float zoom() const { return zoom_; }                   // +0x21C   0 = far, kMaxZoom = close
    float angle() const { return angle_; }                 // +0x218   radians, wrapped to [-pi, pi]; 0 = the heading as configured
    float fov() const { return WrapAngle(fov_ * fovScale_); }         // horizontal radians: FUN_004012C0(+0xEC * +0xE8), wrapped to (-pi, pi]
    float fovScale() const { return fovScale_; }           // +0xEC   1.0 normally; the wheel with the fast modifier held shrinks it to 0.05
    float nearPlane() const { return near_; }              // set by FUN_00414F90 through FUN_009A6070 (at least 0.1 there; 0.01 before)
    float nearLimit() const { return nearLimit_; }         // +0xF0   1..15
    static constexpr float kFarPlane = 300.0f;             // DAT_00E4E418
    static constexpr float kMaxZoom = 0.8f;                // +0x29C
    const StateParams& params() const { return p_; }
    const Bounds& bounds() const { return b_; }

    // Last frame's intermediate values, for a debug display.
    struct Debug {
        float dt = 0;
        float keyVelX = 0, keyVelY = 0;     // +0x2A0/+0x2A4
        float edgeVelX = 0, edgeVelY = 0;   // +0x2A8/+0x2AC
        bool edgeActive = false;            // +0x228
        float panX = 0, panY = 0;           // the pan the callback added this frame
        float zoomInput = 0, rotateInput = 0;
        float pushX = 0, pushY = 0;         // what the lot clamp added to eye and focus
    };
    const Debug& debug() const { return dbg_; }

    // Exposed for the tests: the pieces of the pipeline that are pure functions.
    static Vec3 RotateAbout(const Vec3& point, const Vec3& pivot, const Vec3& axis, float angle);   // FUN_00414360
    static float WrapAngle(float a);                                                             // FUN_004012C0
    // FUN_004166A0: the push that brings point (x, y) back inside the lot, `margin` being the extra the caller leaves at the far edge.
    static void ClampPush(const Bounds& b, float x, float y, float margin, float& pushX, float& pushY);

private:
    void Keyboard(const Input& in);                         // FUN_00414060
    void MouseAndWheel(const Input& in);                    // FUN_00418FE0
    void ExtraKeys(const Input& in);                        // FUN_00414260
    void Combine(const Input& in);                          // FUN_004198A0
    void PlaceEye();                                        // FUN_004162C0
    void KeepInsideLot();                                   // LAB_004167B0 (calls UpdateNear first)
    void UpdateNear();                                      // FUN_00414F90

    StateParams p_;
    Globals g_;
    Bounds b_;

    Vec3 eye_, focus_, view_;      // +0xD0, +0xDC, +0x90 (view_ = focus - eye, refreshed at the end of every tick)
    float zoom_ = 0, angle_ = 0;
    float fov_ = 1, fovScale_ = 1, near_ = 0.1f, nearLimit_ = 15.0f;
    float dt_ = 0;                 // DAT_00F87A90
    float vw_ = 800, vh_ = 600;    // the viewport of the last Tick (DAT_0105C400/404)
    // Velocity members.
    float keyVelX_ = 0, keyVelY_ = 0;      // +0x2A0, +0x2A4
    float edgeVelX_ = 0, edgeVelY_ = 0;    // +0x2A8, +0x2AC
    float panInX_ = 0, panInY_ = 0;        // +0x2B8, +0x2BC   this frame's pan input
    float zoomKey_ = 0, zoomWheel_ = 0;    // +0x2C0, +0x2C8   (+0x2C4 is only written by debug states)
    float zoomIn_ = 0;                     // +0x2CC
    float rotKey_ = 0, rotMouse_ = 0;      // +0x2D0, +0x2D4
    float rotIn_ = 0;                      // +0x2D8
    bool edgeActive_ = false;              // +0x228
    Debug dbg_;
};

}  // namespace otm::camera
