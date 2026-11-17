// Lettura di estratti conto in CSV (banche italiane, Revolut, Amex...): colonne riconosciute da sole, correggibili a mano.

export function decodeBytes(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return new TextDecoder("windows-1252").decode(buf); }
}

export function parseCsv(text) {
  text = String(text).replace(/^﻿/, "");
  const first = text.split(/\r?\n/).slice(0, 12).join("\n");
  const count = (ch) => (first.match(new RegExp(ch === "\t" ? "\\t" : "\\" + ch, "g")) || []).length;
  const delim = [";", ",", "\t"].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim())); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim()));
  return rows;
}

export function parseAmount(s) {
  if (s == null) return null;
  let t = String(s).replace(/[€$£\s]|EUR/gi, "");
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.endsWith("-")) { neg = true; t = t.slice(0, -1); }
  if (t.startsWith("-")) { neg = true; t = t.slice(1); } else if (t.startsWith("+")) t = t.slice(1);
  if (!/^[\d.,]+$/.test(t)) return null;
  const lastC = t.lastIndexOf(","), lastD = t.lastIndexOf(".");
  if (lastC > -1 && lastD > -1) { const dec = lastC > lastD ? "," : "."; t = dec === "," ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""); }
  else if (lastC > -1) { t = t.length - lastC - 1 === 3 && t.indexOf(",") === lastC ? t.replace(",", "") : t.replace(",", "."); }
  else if (lastD > -1 && t.split(".").length > 2) t = t.replace(/\./g, "");
  const n = parseFloat(t); if (!isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return neg ? -cents : cents;
}

export function parseDate(s) {
  if (!s) return null; const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return ok(y, +m[2], +m[1]); }
  m = t.match(/^(\d{1,2})\s+([A-Za-zàù]{3,})\.?\s+(\d{4})/);
  if (m) { const mi = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic", "jan", "may", "jun", "jul", "aug", "sep", "oct", "dec"].findIndex((x) => m[2].toLowerCase().startsWith(x)); if (mi >= 0) return ok(+m[3], (mi % 12) + 1, +m[1]); }
  return null;
  function ok(y, mo, d) { return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null; }
}

const HEAD = /(data|date|descrizion|description|causale|importo|amount|dare|avere|entrate|uscite|addebit|accredit|dettagli|operazione|valuta|saldo|balance)/i;

export function detectMapping(rows) {
  let h = rows.findIndex((r, i) => i < 15 && r.filter((c) => HEAD.test(c)).length >= 2 && r.filter((c) => c).length >= 3);
  const header = h >= 0 ? rows[h] : null;
  const data = rows.slice(h + 1);
  const ncol = Math.max(...rows.map((r) => r.length));
  const pick = (res, avoid) => { if (!header) return -1; let best = -1; for (const re of res) { const i = header.findIndex((c, k) => re.test(c) && !(avoid && avoid.test(c))); if (i >= 0) { best = i; break; } } return best; };
  const sample = data.slice(0, 200);
  const score = (col, fn) => sample.filter((r) => fn(r[col])).length;
  let dateCol = pick([/completed|data contabil|data operazione|data reg/i, /^data$|^date$/i, /data|date/i], /valuta|started|value/i);
  if (dateCol < 0 && header) dateCol = pick([/valuta|started/i]);
  let descCol = pick([/description|descrizione|causale|dettagli|motivo|esercente|operazione$/i]);
  let amountCol = pick([/^importo$|^amount$|^importo in euro|^valore$/i, /importo|amount/i], /fee|commission|saldo|balance/i);
  let debitCol = pick([/dare|uscite|addebit|debit/i]), creditCol = pick([/avere|entrate|accredit|credit/i]);
  if (amountCol >= 0) { debitCol = -1; creditCol = -1; }
  if (dateCol < 0) { let b = -1, bs = 0; for (let c = 0; c < ncol; c++) { const s = score(c, (v) => parseDate(v)); if (s > bs) { bs = s; b = c; } } dateCol = b; }
  if (amountCol < 0 && debitCol < 0 && creditCol < 0) { let b = -1, bs = 0; for (let c = ncol - 1; c >= 0; c--) { if (c === dateCol) continue; const s = score(c, (v) => parseAmount(v) !== null && /[.,]\d{2}\b/.test(v || "")); if (s > bs) { bs = s; b = c; } } amountCol = b; }
  if (descCol < 0) { let b = -1, bl = 0; for (let c = 0; c < ncol; c++) { if (c === dateCol || c === amountCol) continue; const l = sample.reduce((s, r) => s + (r[c] || "").length, 0); if (l > bl) { bl = l; b = c; } } descCol = b; }
  const stateCol = header ? header.findIndex((c) => /^state$|^stato$/i.test(c)) : -1;
  return { headerRow: h, header, dateCol, descCol, amountCol, debitCol, creditCol, stateCol };
}

// Restituisce movimenti {date, desc, cents} con l'importo gia' col segno giusto (negativo = spesa).
export function buildRows(rows, map, { flip = false } = {}) {
  const out = []; let skipped = 0;
  for (const r of rows.slice(map.headerRow + 1)) {
    const date = parseDate(r[map.dateCol]);
    let cents = null;
    if (map.amountCol >= 0) cents = parseAmount(r[map.amountCol]);
    else { const d = map.debitCol >= 0 ? parseAmount(r[map.debitCol]) : null, c = map.creditCol >= 0 ? parseAmount(r[map.creditCol]) : null; if (d != null || c != null) cents = (c != null ? Math.abs(c) : 0) - (d != null ? Math.abs(d) : 0); }
    if (!date || cents == null || cents === 0) { skipped++; continue; }
    if (map.stateCol >= 0 && /REVERT|PENDING|DECLINED|FAILED|ANNULL|RIFIUT/i.test(r[map.stateCol] || "")) { skipped++; continue; }
    out.push({ date, desc: (r[map.descCol] || "").replace(/\s+/g, " ").slice(0, 120), cents: flip ? -cents : cents });
  }
  return { rows: out, skipped };
}

export async function hashRow(accountId, row, n) {
  const data = new TextEncoder().encode([accountId, row.date, row.cents, row.desc.toLowerCase(), n].join("|"));
  const h = await crypto.subtle.digest("SHA-256", data);
  return "csv-" + [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Memoria "esercente -> categoria" dallo storico, per proporre la categoria in automatico.
export function guessCategory(desc, memory) {
  const d = desc.toLowerCase();
  if (memory.has(d)) return memory.get(d);
  for (const [k, v] of memory) if (k.length >= 4 && d.includes(k)) return v;
  return null;
}
