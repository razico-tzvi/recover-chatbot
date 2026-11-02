// Client-side exports for the Context and Conversations tabs.

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const cell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
};

export function toCsv(rows: Record<string, unknown>[], columns?: string[]) {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.map(cell).join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

export function downloadRows(name: string, format: "csv" | "json", rows: Record<string, unknown>[], columns?: string[]) {
  if (format === "csv") download(`${name}.csv`, toCsv(rows, columns), "text/csv");
  else download(`${name}.json`, JSON.stringify(rows, null, 2), "application/json");
}

// Text context blocks export as one row per "## " topic (CSV) or the raw text (JSON).
export function textBlockRows(text: string) {
  const parts = text.split(/\n(?=## )/).map((s) => s.trim()).filter(Boolean);
  return parts.map((p) => {
    const m = /^##\s+(.+)\n?([\s\S]*)$/.exec(p);
    return m ? { topic: m[1].trim(), content: m[2].trim() } : { topic: "", content: p };
  });
}

export const stamp = () => new Date().toISOString().slice(0, 10);

// Pages through a Gadget findMany (250 per page) up to `max` records.
export async function fetchAll(model: any, options: Record<string, unknown>, max = 5000) {
  const out: any[] = [];
  let page = await model.findMany({ ...options, first: 250 });
  for (;;) {
    out.push(...page);
    if (out.length >= max || !page.hasNextPage) return out.slice(0, max);
    page = await page.nextPage();
  }
}
