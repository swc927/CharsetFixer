// Charset Fixer by SWC v2 with robust CSV parsing
const el = (s) => document.querySelector(s);
el("#processBtn").addEventListener("click", async () => {
  const file = el("#fileInput").files[0];
  if (!file) return alert("Please choose a CSV file first");
  const flatten = el("#flatten").checked;
  el("#status").textContent = "Reading file...";
  const text = await readFileAsText(file, "utf-8");
  el("#status").textContent = "Parsing CSV...";
  const rows = parseCSV_RFC4180(text);
  if (!rows || rows.length === 0) {
    el("#status").textContent = "Parsed zero rows. Check the file.";
    return;
  }
  // First row is header
  const header = rows[0];
  const outRows = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = r[j] ?? "";
    }
    outRows.push(obj);
  }
  const csvText = toCSV(outRows, { flattenNewlines: flatten });
  el("#status").textContent = "Encoding and downloading...";
  downloadCSV(
    safeName(file.name.replace(/\.csv$/i, "") + "_fixed.csv"),
    csvText
  );
  el("#status").textContent = "Done";
});

function safeName(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}

function readFileAsText(file, encoding = "utf-8") {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsText(file, encoding);
  });
}

/* Robust RFC4180 parser that handles quotes and newlines inside fields */
function parseCSV_RFC4180(text) {
  const rows = [];
  let field = "";
  let row = [];
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          // escaped quote
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i += 1;
          continue;
        }
      } else {
        field += c;
        i += 1;
        continue;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i += 1;
        continue;
      } else if (c === ",") {
        row.push(field);
        field = "";
        i += 1;
        continue;
      } else if (c === "\r") {
        // look ahead for \n
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        if (text[i + 1] === "\n") {
          i += 2;
        } else {
          i += 1;
        }
        continue;
      } else if (c === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i += 1;
        continue;
      } else {
        field += c;
        i += 1;
        continue;
      }
    }
  }
  // last field
  row.push(field);
  rows.push(row);
  return rows;
}

/* Normalise HTML and whitespace */
function normaliseRichText(input) {
  if (input == null) return "";
  let s = String(input);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p\s*>/gi, "\n");
  s = s.replace(/<p[^>]*>/gi, "");
  s = s.replace(/<div[^>]*>/gi, "");
  s = s.replace(/<\/div\s*>/gi, "\n");
  s = s.replace(/\r?\n+/g, "\n");
  return s.trim();
}

/* Escape for CSV fields */
function csvEscape(field, opts = {}) {
  let s = field == null ? "" : String(field);
  if (opts.flattenNewlines) s = s.replace(/\r?\n/g, "; ");
  if (s.includes('"')) s = s.replace(/"/g, '""');
  if (/[",\r\n]/.test(s)) s = '"' + s + '"';
  return s;
}

/* Create CSV text from array of objects */
function toCSV(rows, opts = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const header = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((k) => set.add(k));
      return set;
    }, new Set())
  );
  const lines = [];
  lines.push(header.map((h) => csvEscape(h, opts)).join(","));
  for (const r of rows) {
    const vals = header.map((key) =>
      csvEscape(normaliseRichText(r[key]), opts)
    );
    lines.push(vals.join(","));
  }
  return lines.join("\r\n");
}

/* Download with UTF-8 BOM and CRLF */
function downloadCSV(filename, csvText) {
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csvText], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename || "export.csv";
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
}
