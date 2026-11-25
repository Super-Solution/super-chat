// Tables as text, for the clipboard.
//
// One implementation for every table the kit shows: the `table` card hands it formatted cells,
// and a table inside rendered Markdown hands it the text of its cells. Cells arrive already as
// the strings a reader sees; nothing here formats a value.

/** Tabs and line breaks inside a cell become a space: TSV has no way to escape them. */
const flatten = (cell: string) => cell.replace(/[\t\r\n]+/g, " ");

/** Header row and data rows, tab-separated — what a spreadsheet pastes into cells. */
export function tableToTsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => cells.map(flatten).join("\t");
  return [line(header), ...rows.map(line)].join("\n");
}

/** A GitHub-flavoured Markdown table. A pipe in a cell is escaped; a line break becomes a space. */
export function tableToMarkdown(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  align: readonly ("left" | "center" | "right" | null)[] = [],
): string {
  const cell = (c: string) => flatten(c).replace(/\|/g, "\\|").trim();
  const rule = header.map((_, i) => {
    const a = align[i];
    return a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---";
  });
  const line = (cells: readonly string[]) => `| ${header.map((_, i) => cell(cells[i] ?? "")).join(" | ")} |`;
  return [line(header), `| ${rule.join(" | ")} |`, ...rows.map(line)].join("\n");
}
