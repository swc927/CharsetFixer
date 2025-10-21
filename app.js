const $ = (s) => document.querySelector(s);
const encodings = ["utf-8", "gbk", "big5", "windows-1252"];

const dropzone = $("#dropzone");
const fileInput = $("#fileInput");
const delimiterSel = $("#delimiter");
const encodingOverrideSel = $("#encodingOverride");
const outputFormatSel = $("#outputFormat");
const downloadBtn = $("#downloadBtn");
const summaryEl = $("#detectSummary");
const tabsEl = $("#tabs");

let current = {
  file: null,
  bytes: null,
  results: [],
  best: null,
  activeEncoding: null,
  parsed: null,
};

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () =>
  dropzone.classList.remove("dragover")
);
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});
fileInput.addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) handleFile(f);
});

delimiterSel.addEventListener("change", () => {
  if (current.activeEncoding) setActiveEncoding(current.activeEncoding);
});
encodingOverrideSel.addEventListener("change", () => {
  if (!current.bytes) return;
  const enc = encodingOverrideSel.value || current.best?.encoding;
  setActiveEncoding(enc);
});

downloadBtn.addEventListener("click", () => {
  if (!current.parsed) return;
  const ext = outputFormatSel.value;
  const rows = current.parsed;
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const content =
    ext === "csv" ? toCSV(rows) : rows.map((r) => r.join("\t")).join("\n");
  const blob = new Blob([bom, content], {
    type: ext === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8",
  });
  const a = document.createElement("a");
  const base = current.file?.name?.replace(/\.[^.]+$/, "") || "fixed";
  a.download = base + (ext === "csv" ? ".utf8.csv" : ".utf8.txt");
  a.href = URL.createObjectURL(blob);
  a.click();
  a.remove();
});

async function handleFile(file) {
  resetUI();
  current.file = file;
  const ab = await file.arrayBuffer();
  current.bytes = new Uint8Array(ab);

  const override = encodingOverrideSel.value;
  const tryList = override ? [override] : encodings;
  const results = [];
  for (const enc of tryList) {
    try {
      const dec = new TextDecoder(enc, { fatal: false });
      let text = dec.decode(current.bytes);
      text = stripBOM(text);
      const scoreInfo = scoreText(text);
      results.push({
        encoding: enc,
        text,
        score: scoreInfo.score,
        reason: scoreInfo.reason,
      });
    } catch {}
  }
  if (override) {
    for (const enc of encodings) {
      if (results.find((r) => r.encoding === enc)) continue;
      try {
        const dec = new TextDecoder(enc, { fatal: false });
        let text = dec.decode(current.bytes);
        text = stripBOM(text);
        const scoreInfo = scoreText(text);
        results.push({
          encoding: enc,
          text,
          score: scoreInfo.score,
          reason: scoreInfo.reason,
        });
      } catch {}
    }
  }

  results.sort((a, b) => b.score - a.score);
  current.results = results;
  current.best = results[0];
  summaryEl.textContent = `Best guess ${
    current.best.encoding
  }  score ${current.best.score.toFixed(2)}  ${current.best.reason}`;
  renderTabs(
    results.map((r) => r.encoding),
    current.best.encoding
  );
  setActiveEncoding(current.best.encoding);
}

function stripBOM(t) {
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

function scoreText(text) {
  const total = Math.max(text.length, 1);
  const bad = (text.match(/\uFFFD/g) || []).length;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const punct = (text.match(/[，。、《》！（）【】：「」“”；：]/g) || [])
    .length;
  const ctrl = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
  const score =
    2 * (cjk / total) +
    1 * (punct / total) -
    3 * (bad / total) -
    1.5 * (ctrl / total);
  const reason = `${cjk} Chinese, ${bad} replacement, ${ctrl} control`;
  return { score, reason };
}

function renderTabs(encs, active) {
  tabsEl.innerHTML = "";
  encs.forEach((enc) => {
    const b = document.createElement("button");
    b.className = "tab" + (enc === active ? " active" : "");
    b.textContent = enc.toUpperCase();
    b.onclick = () => setActiveEncoding(enc);
    tabsEl.appendChild(b);
  });
}

function setActiveEncoding(enc) {
  current.activeEncoding = enc;
  document
    .querySelectorAll(".tab")
    .forEach((t) =>
      t.classList.toggle("active", t.textContent.toLowerCase() === enc)
    );
  const res = current.results.find((r) => r.encoding === enc);
  if (!res) return;
  const delim = chooseDelimiter(res.text, delimiterSel.value);
  const rows = parseCSVLike(res.text, delim);
  current.parsed = rows;
  downloadBtn.disabled = false;
}

function chooseDelimiter(text, mode) {
  if (mode !== "auto") return mode === "\t" ? "\t" : mode;
  const sample = text.split(/\r?\n/).slice(0, 50).join("\n");
  const counts = {
    ",": (sample.match(/,/g) || []).length,
    ";": (sample.match(/;/g) || []).length,
    "\t": (sample.match(/\t/g) || []).length,
    "|": (sample.match(/\|/g) || []).length,
  };
  let best = ",";
  let bestCount = -1;
  for (const [k, v] of Object.entries(counts)) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return best === "\t" ? "\t" : best;
}

function parseCSVLike(text, delim) {
  const rows = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    const row = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (!inQ && ((delim === "\t" && ch === "\t") || ch === delim)) {
        row.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function toCSV(rows) {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          if (/[",\n]/.test(s)) return '"' + s.replace(/\"/g, '\\"') + '"';
          return s;
        })
        .join(",")
    )
    .join("\n");
}

function resetUI() {
  summaryEl.textContent = "";
  tabsEl.innerHTML = "";
  downloadBtn.disabled = true;
  current.parsed = null;
}

dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});
