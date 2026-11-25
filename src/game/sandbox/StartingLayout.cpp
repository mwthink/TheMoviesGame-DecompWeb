#include "game/sandbox/StartingLayout.hpp"

#include <cctype>

#include "core/Strings.hpp"

namespace otm::sandbox {

// orig: Campaign_Begin 0x004AF870
LayoutName StartingLayoutName(bool tutorial, int startYear, GameType type, bool emptyLotFlag) {
    LayoutName r;
    r.name = "savedefaults/";
    r.name += tutorial ? std::string("tutorial") : std::to_string(startYear);
    if (emptyLotFlag && (type == GameType::Sandbox || type == GameType::AddOnQuickStart)) {
        r.name += "_clean";
        r.clearEmptyLotFlag = true;
    }
    return r;
}

PlacedKind KindOfName(const std::string& name) {
    const std::string lower = core::ToLower(name);
    if (lower.rfind("facility/", 0) == 0) return PlacedKind::Facility;
    if (lower.rfind("set/", 0) == 0) return PlacedKind::Set;
    if (lower.rfind("ornament/", 0) == 0) return PlacedKind::Ornament;
    return PlacedKind::Other;
}

static std::optional<std::pair<double, double>> ParsePair(const std::string& s) {
    const auto parts = core::Split(s, ',');
    if (parts.size() != 2) return std::nullopt;
    const auto a = core::ParseDouble(parts[0]);
    const auto b = core::ParseDouble(parts[1]);
    if (!a || !b) return std::nullopt;
    return std::make_pair(*a, *b);
}

// orig: Lot_PlaceAssetsFromProperties 0x0046AF20, Lot_HireStartingStaff 0x0046AB70
StartingLayout ParseStartingLayout(const core::IniFile& ini) {
    StartingLayout out;
    if (const auto v = ini.GetDouble("", "size")) out.size = *v;
    if (const auto v = ini.GetInt("", "year")) out.year = static_cast<int>(*v);

    for (const std::string& section : ini.SectionNames()) {
        if (section.empty()) continue;
        if (section == "hired_staff") {
            out.staff.present = true;
            out.staff.builders = static_cast<int>(ini.GetInt(section, "builders").value_or(0));
            out.staff.janitors = static_cast<int>(ini.GetInt(section, "janitors").value_or(0));
            out.staff.crew = static_cast<int>(ini.GetInt(section, "crew").value_or(0));
            out.staff.writers = static_cast<int>(ini.GetInt(section, "writers").value_or(0));
            continue;
        }
        const auto name = ini.GetString(section, "name");
        if (!name) continue;                     // not a placement
        Placement p;
        p.section = section;
        p.name = *name;
        p.kind = KindOfName(p.name);
        if (const auto pos = ini.GetString(section, "position")) {
            if (const auto xz = ParsePair(*pos)) { p.x = xz->first; p.z = xz->second; }
        }
        p.angle = ini.GetDouble(section, "angle").value_or(0.0);
        if (const auto c = ini.GetInt(section, "cityobject")) p.cityObject = static_cast<int>(*c);
        out.placements.push_back(std::move(p));
    }
    return out;
}

}  // namespace otm::sandbox
