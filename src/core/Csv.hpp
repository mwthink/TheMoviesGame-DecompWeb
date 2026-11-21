// Reader for the game's .csv data files (Data\rule\timeline.csv, aistudios.csv).
// Comma separated, optional "double quoted" fields with "" for a quote, CRLF or LF. Fields are not trimmed. Empty lines
// give empty rows so that row numbers match the file.
#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace otm::core {

using CsvRow = std::vector<std::string>;

std::vector<CsvRow> ParseCsv(std::string_view text);
bool LoadCsv(const std::string& path, std::vector<CsvRow>& out);

}  // namespace otm::core
