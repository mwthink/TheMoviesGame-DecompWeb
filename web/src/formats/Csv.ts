/**
 * The game's .csv data files (Data\rule\timeline.csv, aistudios.csv): comma separated, optional "double quoted" fields with "" for a quote, CRLF or
 * LF. Fields are not trimmed. Empty lines give empty rows, so row numbers match the file.
 */
export type CsvRow = string[];

export function parseCsv(text: string): CsvRow[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: CsvRow[] = [];
  let row: CsvRow = [];
  let field = "";
  let quoted = false;
  let any = false; // something was read on this line
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    if (any) endField();
    rows.push(row);
    row = [];
    any = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
      any = true;
    } else if (c === ",") {
      endField();
      any = true;
    } else if (c === "\r") {
      // ignored: the \n ends the line (a lone \r does not)
    } else if (c === "\n") endRow();
    else {
      field += c;
      any = true;
    }
  }
  if (any) endRow();
  return rows;
}
