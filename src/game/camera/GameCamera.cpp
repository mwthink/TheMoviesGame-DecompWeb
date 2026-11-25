// See GameCamera.hpp and docs/CAMERA.md.
#include "game/camera/GameCamera.hpp"

#include <algorithm>
#include <cmath>

#include "core/IniRead.hpp"
#include "core/Strings.hpp"

namespace otm::camera {

namespace {

constexpr float kPi = 3.14159265358979f;
constexpr float kTwoPi = 6.28318530717959f;

Vec3 Sub(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
Vec3 Add(const Vec3& a, const Vec3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
Vec3 Mul(const Vec3& a, float s) { return {a.x * s, a.y * s, a.z * s}; }
float Dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec3 Cross(const Vec3& a, const Vec3& b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
float Len(const Vec3& a) { return std::sqrt(Dot(a, a)); }
// FUN_00412E20: normalise in place, returns the old length (0 and no change for the zero vector).
float Normalize(Vec3& v) {
    const float l = Len(v);
    if (l == 0.0f) return 0.0f;
    v = Mul(v, 1.0f / l);
    return l;
}

// "x, y, z" as read by FUN_005584E0 + FUN_00567E30.
bool ParseVec3(const std::string& s, Vec3& out) {
    const auto parts = core::Split(s, ',');
    if (parts.size() < 3) return false;
    const auto x = core::ParseDouble(parts[0]), y = core::ParseDouble(parts[1]), z = core::ParseDouble(parts[2]);
    if (!x || !y || !z) return false;
    out = {static_cast<float>(*x), static_cast<float>(*y), static_cast<float>(*z)};
    return true;
}

// What the original does when the camera's matrices are current: the world point of a viewport pixel on the near plane, then the point
// where the ray from the eye through it meets the plane z = planeZ (TMInWorld_RayToPlane 0x00538EF0 on top of FUN_009A1A20).
struct View {
    Vec3 eye, forward, right, up;
    float halfW, halfH, w, h;   // near-plane half extents at distance `near`; viewport size
    float nearD;
};

View MakeView(const Vec3& eye, const Vec3& focus, float fov, float nearD, float w, float h) {
    View v;
    v.eye = eye;
    Vec3 f = Sub(focus, eye);
    // FUN_009A2830: a view that is exactly vertical is nudged so that the right vector exists.
    if (std::fabs(f.x) < 0.001f && std::fabs(f.y) < 0.001f) f.x = f.x <= 0.0f ? -0.001f : 0.001f;
    Normalize(f);
    v.forward = f;
    Vec3 r = Cross(f, Vec3{0, 0, 1});
    Normalize(r);
    v.right = r;
    v.up = Cross(r, f);
    v.nearD = nearD;
    v.w = w;
    v.h = h;
    v.halfW = std::tan(fov * 0.5f) * nearD;      // FUN_009A6070: +0x100 = tan(fov/2) * near
    v.halfH = v.halfW / (w / h);                 // +0x104 = that / aspect (+0x108; aspect = w / h assumed)
    return v;
}

Vec3 RayToPlane(const View& v, float px, float py, float planeZ) {
    const float cx = v.w * 0.5f, cy = v.h * 0.5f;
    const float camX = (v.halfW / cx) * (px - cx);
    const float camZ = (v.halfH / cy) * (cy - py);
    const Vec3 p = Add(Add(Add(v.eye, Mul(v.right, camX)), Mul(v.forward, v.nearD)), Mul(v.up, camZ));
    const float dz = p.z - v.eye.z;
    const float t = (planeZ - v.eye.z) / dz;
    if (t > 0.0001f) return Add(v.eye, Mul(Sub(p, v.eye), t));   // 0.0001 = DAT_00D231B8
    return p;
}

}  // namespace

StateParams ParseState(const core::IniFile& ini, const char* section, std::vector<std::string>& problems) {
    StateParams s;
    auto f = [&](const char* key, float& dst, float def) {
        dst = def;
        const auto v = ini.GetDouble(section, key);
        if (!v) {
            if (!ini.Has(section, key)) return;   // every key of the reader is optional; only a malformed value is a problem
            problems.push_back(std::string("camera.ini [") + section + "] " + key + ": not a number");
            return;
        }
        dst = static_cast<float>(*v);
    };
    auto vec = [&](const char* key, Vec3& dst) {
        const auto v = ini.GetString(section, key);
        if (!v || !ParseVec3(*v, dst)) problems.push_back(std::string("camera.ini [") + section + "] " + key + ": missing or not x,y,z");
    };
    vec("heading", s.heading);
    vec("startfocus", s.startFocus);
    f("startzoom", s.startZoom, 0.0f);
    f("fov", s.fov, 0.0f);
    if (s.fov == 0.0f) s.fov = 1.0f;
    f("cameraspeed", s.cameraSpeed, 0.0f);
    if (s.cameraSpeed == 0.0f) s.cameraSpeed = 300.0f;
    f("acceleration", s.acceleration, 0.0f);
    if (s.acceleration == 0.0f) s.acceleration = s.cameraSpeed;
    f("maxvelocity", s.maxVelocity, 0.0f);
    if (s.maxVelocity == 0.0f) s.maxVelocity = 30.0f;
    f("damping", s.damping, 0.0f);
    if (s.damping == 0.0f) s.damping = 0.2f;
    f("rotationspeed", s.rotationSpeed, 0.0f);
    if (s.rotationSpeed == 0.0f) s.rotationSpeed = 2.0f;
    f("zoomspeed", s.zoomSpeed, 0.0f);
    if (s.zoomSpeed == 0.0f) s.zoomSpeed = 2.0f;
    f("wheelspeed", s.wheelSpeed, 0.0f);
    if (s.wheelSpeed == 0.0f) s.wheelSpeed = 1.0f;
    f("zoomcurve", s.zoomCurve, 0.0f);
    s.exclusive = ini.GetInt(section, "exclusive").value_or(0) != 0;
    return s;
}

Globals ParseGlobals(const core::IniFile& ini, std::vector<std::string>& problems) {
    Globals g;
    core::ReadFloat(ini, "camera.ini", "", "wheelscale", g.wheelScale, problems);
    core::ReadFloat(ini, "camera.ini", "", "pushdistance", g.pushDistance, problems);
    return g;
}

// orig: 0x004012C0
float GameCamera::WrapAngle(float a) {
    // Wraps to (-pi, pi]: subtract a whole number of turns (rounded to nearest), then once more if still above pi.
    float r = a - std::nearbyint(a / kTwoPi) * kTwoPi;
    if (r > kPi) r -= kTwoPi;
    return r;
}

// orig: 0x00414360
Vec3 GameCamera::RotateAbout(const Vec3& point, const Vec3& pivot, const Vec3& axis, float angle) {
    if (angle == 0.0f) return point;
    Vec3 v = Sub(pivot, point);                       // from the point to the pivot
    // FUN_009A9BB0: q = (axis / |axis| * sin(a/2), cos(a/2))
    const float s = std::sin(angle * 0.5f) / Len(axis);
    const float qx = axis.x * s, qy = axis.y * s, qz = axis.z * s, qw = std::cos(angle * 0.5f);
    // v' = q v q^-1 (Hamilton product, FUN_00413B10)
    const float tx = 2 * (qy * v.z - qz * v.y), ty = 2 * (qz * v.x - qx * v.z), tz = 2 * (qx * v.y - qy * v.x);
    const Vec3 r{v.x + qw * tx + (qy * tz - qz * ty), v.y + qw * ty + (qz * tx - qx * tz), v.z + qw * tz + (qx * ty - qy * tx)};
    return Sub(pivot, r);
}

// orig: 0x004166A0
void GameCamera::ClampPush(const Bounds& b, float x, float y, float margin, float& pushX, float& pushY) {
    float px = 0.0f;
    const float minX = b.minX + 1.5f, maxX = b.maxX - 1.5f, maxY = b.maxY - 1.5f;
    const float minYm = (b.minY + 1.5f) - margin;
    if (x < minX) px = minX - x;
    else if (maxX < x) px = maxX - x;
    float py = 0.0f;
    if (margin >= 0.0f && y < minYm) py = minYm - y;
    else if (maxY < y) py = maxY - y;
    // The larger push wins, per axis; a tie keeps the one already there.
    if (!(std::fabs(px) <= std::fabs(pushX))) pushX = px;
    if (!(std::fabs(py) <= std::fabs(pushY))) pushY = py;
}

// orig: 0x0041B730 (the part that sets the view)
GameCamera::GameCamera(const StateParams& normal, const Globals& globals, const Bounds& bounds) : p_(normal), g_(globals), b_(bounds) { Reset(); }

void GameCamera::Reset() {
    focus_ = p_.startFocus;
    eye_ = Sub(focus_, p_.heading);
    view_ = Sub(focus_, eye_);
    fov_ = p_.fov;
    fovScale_ = 1.0f;
    nearLimit_ = 15.0f;
    zoom_ = p_.startZoom;
    angle_ = 0.0f;
    keyVelX_ = keyVelY_ = edgeVelX_ = edgeVelY_ = 0;
    panInX_ = panInY_ = zoomKey_ = zoomWheel_ = zoomIn_ = rotKey_ = rotMouse_ = rotIn_ = 0;
    edgeActive_ = false;
    PlaceEye();
    view_ = Sub(focus_, eye_);
}

void GameCamera::Restore(const Vec3& focus, float angle, float zoom) {
    focus_ = focus;
    angle_ = WrapAngle(angle);
    zoom_ = std::min(std::max(zoom, 0.0f), kMaxZoom);
    PlaceEye();
    view_ = Sub(focus_, eye_);
}

// orig: 0x00414060
void GameCamera::Keyboard(const Input& in) {
    float dx = 0, dy = 0;
    if (in.left) dx = -dt_;
    else if (in.right) dx = dt_;
    if (in.forward) dy = dt_;
    else if (in.back) dy = -dt_;
    if (dx == 0.0f && dy == 0.0f) {
        const float k = std::pow(p_.damping, dt_);
        keyVelX_ *= k;
        keyVelY_ *= k;
        return;
    }
    if (in.rotateModifier) {
        // Rotate modifier: the keys steer rotation (x) and zoom (y); the scroll velocity only decays.
        const float k = std::pow(p_.damping, dt_);
        keyVelX_ *= k;
        keyVelY_ *= k;
        rotKey_ += dx * 60.0f;
        zoomKey_ += dy * 50.0f;
        return;
    }
    keyVelX_ += dx * p_.acceleration;
    keyVelY_ += dy * p_.acceleration;
    if (p_.maxVelocity < std::sqrt(keyVelX_ * keyVelX_ + keyVelY_ * keyVelY_)) {
        const float l = std::sqrt(keyVelX_ * keyVelX_ + keyVelY_ * keyVelY_);
        keyVelX_ = keyVelX_ / l * p_.maxVelocity;
        keyVelY_ = keyVelY_ / l * p_.maxVelocity;
    }
}

// orig: 0x00414260
void GameCamera::ExtraKeys(const Input& in) {
    float x = 0, y = 0;
    if (in.altLeft) x = -1.0f;
    else if (in.altRight) x = 1.0f;
    if (in.altForward) y = 1.0f;
    else if (in.altBack) y = -1.0f;
    keyVelX_ += x;
    keyVelY_ += y;
}

// orig: 0x00418FE0
void GameCamera::MouseAndWheel(const Input& in) {
    bool pushing = false;
    const float onX = in.mouseX, onY = in.mouseY;
    const bool atEdge = onX <= 0.0f || onX >= in.viewportW || onY <= 0.0f || onY >= in.viewportH;
    bool active = false;
    if (in.windowFocused && in.edgeScrollEnabled && atEdge) {
        const float push2 = g_.pushDistance * g_.pushDistance;
        if (push2 < in.mouseRelX * in.mouseRelX + in.mouseRelY * in.mouseRelY) edgeActive_ = true;
        active = edgeActive_;
        if (active) {
            float dx = onX - in.viewportW * 0.5f, dy = onY - in.viewportH * 0.5f;
            const float l = std::sqrt(dx * dx + dy * dy);
            if (l != 0.0f) { dx /= l; dy /= l; }
            const float g = dt_ * p_.acceleration;
            edgeVelX_ += dx * g;
            edgeVelY_ += -dy * g;
            if (p_.maxVelocity < std::sqrt(edgeVelX_ * edgeVelX_ + edgeVelY_ * edgeVelY_)) {
                const float n = std::sqrt(edgeVelX_ * edgeVelX_ + edgeVelY_ * edgeVelY_);
                edgeVelX_ = edgeVelX_ / n * p_.maxVelocity;
                edgeVelY_ = edgeVelY_ / n * p_.maxVelocity;
            }
            pushing = true;
        }
    }
    if (!active) edgeActive_ = false;
    if (!pushing) {
        const float k = std::pow(p_.damping, dt_);
        edgeVelX_ *= k;
        edgeVelY_ *= k;
    }

    // Dragging with the rotate button: the pointer's horizontal motion turns the view (vertical motion only matters in the debug states).
    if (in.rotateDrag) {
        const float dx = -in.mouseRelX;   // the original also adds (anchor - pointer), which is 0 while the pointer is held at the anchor
        rotMouse_ += (dx / (in.viewportW * 0.1f)) * 0.5f;
    }

    // Wheel. The original keeps a running total and consumes it all in one frame (+0x224 = 1), so a frame's wheel units are used once.
    const float w = in.wheel;
    if (!in.fastModifier) {
        if (w != 0.0f) {
            zoomWheel_ += (w / (1000.0f / g_.wheelScale)) * 0.1f;
            zoomWheel_ *= p_.wheelSpeed;
        }
        fovScale_ = fovScale_ < 1.0f ? std::min(fovScale_ + 0.5f, 1.0f) : 1.0f;   // the lens relaxes back to 1 when the wheel is not used for it
    } else if (w != 0.0f) {
        fovScale_ = std::max(fovScale_ - w * 0.0005f, 0.05f);
        fovScale_ = std::min(fovScale_, 1.0f);
    }
}

// orig: 0x004198A0
void GameCamera::Combine(const Input& in) {
    float kx = keyVelX_, ky = keyVelY_, ex = edgeVelX_, ey = edgeVelY_;
    if (in.fastModifier) {
        kx *= 3; ky *= 3; ex *= 3; ey *= 3;
        zoomKey_ *= 3; zoomWheel_ *= 3; rotKey_ *= 3; rotMouse_ *= 3;
    }
    panInX_ = dt_ * (ex + kx) * fovScale_;
    panInY_ = (ey + ky) * dt_ * fovScale_;
    zoomIn_ = dt_ * zoomKey_ + zoomWheel_;
    rotIn_ = (dt_ * rotKey_ + rotMouse_) * fovScale_;
}

// orig: 0x004162C0
void GameCamera::PlaceEye() {
    const Vec3& h = p_.heading;
    eye_ = Sub(focus_, h);
    eye_ = Add(eye_, Mul(h, zoom_));
    const float fz = focus_.z - h.z;
    const float eyeAbove = eye_.z - focus_.z;
    focus_.z = 1.6f;
    const float ratio = eyeAbove / fz;
    eye_.z = static_cast<float>(std::pow(ratio, p_.zoomCurve)) * fz + 1.6f - 2.7f;
    eye_ = RotateAbout(eye_, focus_, Vec3{0, 0, 1}, angle_);
    // Pull the eye towards the focus when it is low: factor = (eye.z - 1.6) * 0.05 + 0.1, at most 1.
    const float f = std::min((eye_.z - 1.6f) * 0.05f + 0.1f, 1.0f);
    eye_ = Add(Mul(Sub(eye_, focus_), f), focus_);
    float s = (eye_.z - 1.6f) / (fz - 1.6f);
    s = std::max(s, 1.0f - fovScale_ * fovScale_);
    nearLimit_ = std::min(std::max(s * 14.0f + 1.0f, 1.0f), 15.0f);
}

// orig: 0x00414F90
void GameCamera::UpdateNear() {
    // The near plane is the distance, along the view axis, to the ground point at the bottom centre of the viewport; +0xF0 keeps the
    // smallest value seen since FUN_004162C0 last set it, never below 0.01, and the projection takes at least 0.1 (FUN_009A6070).
    const View v = MakeView(eye_, focus_, fov(), near_, vw_, vh_);
    const Vec3 hit = RayToPlane(v, vw_ * 0.5f, vh_, 0.0f);
    Vec3 d = Sub(focus_, eye_);
    Normalize(d);
    float depth = Dot(Sub(hit, eye_), d);
    if (nearLimit_ < depth) depth = nearLimit_;
    nearLimit_ = std::max(depth, 0.01f);
    near_ = std::max(nearLimit_, 0.1f);
}

// orig: 0x004167B0
void GameCamera::KeepInsideLot() {
    UpdateNear();
    // Three ground points that the view shows: the two lower screen corners, found where the rays meet the plane z = 1.53, and the
    // top centre, on the ground. Each is tested against the lot rectangle (ClampPush); the largest push per axis moves eye and focus.
    Vec3 n = view_;
    Normalize(n);
    const float a = n.z + 1.0f;
    float nx = n.x, ny = n.y;
    const float l2 = std::sqrt(nx * nx + ny * ny);
    if (l2 != 0.0f) { nx /= l2; ny /= l2; }
    // 0.5 * max(0, view.y * (eye.z - 1.6)): how far past the front edge the lower corners may go when looking along +y.
    const float back = 0.5f * std::max(0.0f, (ny * 1.0f + 0.0f * nx) * (eye_.z - 1.6f));
    const View v = MakeView(eye_, focus_, fov(), near_, vw_, vh_);
    float pushX = 0, pushY = 0;
    const float rowY = vh_ * (a * 0.25f + 0.75f);
    Vec3 r = RayToPlane(v, vw_ * (0.5f - a * 0.4f), rowY, 1.53f);
    ClampPush(b_, r.x, r.y, back, pushX, pushY);
    r = RayToPlane(v, vw_ * (a * 0.4f + 0.5f), rowY, 1.53f);
    ClampPush(b_, r.x, r.y, back, pushX, pushY);
    r = RayToPlane(v, vw_ * 0.5f, vh_ * a, 0.0f);
    ClampPush(b_, r.x, r.y, -1.0f, pushX, pushY);
    focus_.x += pushX; focus_.y += pushY;
    eye_.x += pushX; eye_.y += pushY;
    dbg_.pushX = pushX; dbg_.pushY = pushY;
}

void GameCamera::Tick(const Input& in) {
    // The tick's frame time: the measured one, but never more than 0.05 away from the previous frame's (DAT_00F87A90).
    float dt = in.dt;
    if (std::fabs(dt - dt_) > 0.05f) dt = dt > dt_ ? dt_ + 0.05f : dt_ - 0.05f;
    dt_ = dt;
    dbg_.dt = dt_;

    Keyboard(in);
    MouseAndWheel(in);
    ExtraKeys(in);
    Combine(in);

    if (in.resetRequested) {
        // FUN_00414C90 (the reset callback) goes back to the state's own start values.
        Reset();
    }

    // The pan callback FUN_004149F0: the input is turned to follow the heading (angle of the view direction minus 90 degrees) and scaled
    // by (1 - zoom): the closer in, the slower it scrolls.
    float panX = 0, panY = 0;
    if (panInX_ != 0.0f || panInY_ != 0.0f) {
        const float heading = std::atan2(view_.y, view_.x) - kPi * 0.5f;
        const float c = std::cos(heading), s = std::sin(heading);
        const float scale = 1.0f - zoom_;
        panX = (c * panInX_ - s * panInY_) * scale;
        panY = (c * panInY_ + s * panInX_) * scale;
    }
    // The zoom callback LAB_004128A0 ignores a wheel over a window.
    float zoomAdd = 0;
    if (zoomIn_ != 0.0f && !in.wheelOverUi) zoomAdd = zoomIn_;
    // The rotate callback LAB_00414BF0, then wrapping to [-pi, pi].
    angle_ += rotIn_;
    if (angle_ < -kPi) angle_ += kTwoPi;
    else if (angle_ > kPi) angle_ -= kTwoPi;

    zoomAdd *= p_.zoomSpeed;
    zoom_ = std::min(zoom_ + zoomAdd, kMaxZoom);
    zoom_ = std::max(zoom_, 0.0f);

    dbg_.keyVelX = keyVelX_; dbg_.keyVelY = keyVelY_; dbg_.edgeVelX = edgeVelX_; dbg_.edgeVelY = edgeVelY_;
    dbg_.edgeActive = edgeActive_; dbg_.panX = panX; dbg_.panY = panY; dbg_.zoomInput = zoomIn_; dbg_.rotateInput = rotIn_;

    // The accumulators are per frame.
    panInX_ = panInY_ = zoomIn_ = rotIn_ = 0;
    zoomKey_ = zoomWheel_ = rotKey_ = rotMouse_ = 0;

    // LAB_00412750: move eye and focus by the pan, then FUN_004162C0 re-derives the eye from the focus.
    focus_.x += panX; focus_.y += panY;
    eye_.x += panX; eye_.y += panY;
    PlaceEye();
    view_ = Sub(focus_, eye_);

    // LAB_004167B0 (which starts with FUN_00414F90): projection, then the lot clamp.
    vw_ = in.viewportW;
    vh_ = in.viewportH;
    KeepInsideLot();
    view_ = Sub(focus_, eye_);
}

}  // namespace otm::camera
