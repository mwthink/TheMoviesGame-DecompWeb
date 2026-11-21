#pragma once

#include <string>

namespace otm::core {

// Reads a whole file as bytes. Returns false if it cannot be opened or read.
bool ReadFile(const std::string& path, std::string& out);

}  // namespace otm::core
