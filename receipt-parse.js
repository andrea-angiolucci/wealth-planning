// Legge il testo OCR di uno scontrino italiano e ne ricava totale, data, esercente, righe e categoria suggerita.
const AMOUNT = /(\d{1,5}\s?[.,]\s?\d{2})(?!\d)(?!\s?%)/g;
const toCents = (s) => Math.round(parseFloat(s.replace(/\s/g, "").replace(",", ".")) * 100);
const SKIP_ITEM = /(TOTALE|SUBTOTALE|SUB-TOTALE|IVA|RESTO|CONTANT|PAGAMENTO|IMPORTO|SCONTO|ARROTOND|CARTA|BANCOMAT|POS|ELETTRONIC|NON RISCOSSO|DI CUI|PREZZO|IMPONIBILE|CODICE|TEL)/i;
const CATS = [
  [/(SUPERSTORE|DECO|CONAD|COOP|CARREFOUR|LIDL|EUROSPIN|MD |SUPERMERCAT|ALIMENTAR|MACELLERIA|PANETTERIA|FORNO|ORTOFRUTTA|DESPAR|PENNY|TODIS|SIGMA|FAMILA|PAM |IPER|ALIMENT)/i, "Alimentari"],
  [/(FARMACIA|PARAFARMAC|OTTIC|CLINICA|AMBULATORIO|MEDIC)/i, "Salute"],
  [/(ENI |Q8|TAMOIL|ESSO|CARBURANT|DISTRIBUTORE|STAZIONE DI SERVIZIO|AUTOLAVAGGIO|IP |API )/i, "Auto"],
  [/(RISTORANTE|PIZZERIA|TRATTORIA|OSTERIA|BAR |CAFFE|CAFFÈ|GELATERIA|PASTICCERIA|PUB |SUSHI|BIRRERIA|PANINOTECA)/i, "Ristoranti e bar"],
  [/(AUTOSTRAD|TELEPASS|TRENITALIA|ITALO|TAXI|PARCHEGGIO|PARCHEGGI|BIGLIETT|ATM |AMT )/i, "Trasporti"],
  [/(CINEMA|TEATRO|MUSEO|LIBRERIA|GIOCATTOL)/i, "Svago"],
];
const numLine = (l) => ((String(l || "").match(/[A-Za-zÀ-ÿ]/g) || []).length <= 3 ? String(l || "") : "");
const occurrences = (text, cents) => (String(text).match(new RegExp("(?:^|[^\\d,.])" + (cents / 100).toFixed(2).replace(".", "\\s?[.,]\\s?") + "(?!\\d)", "g")) || []).length;
export function parseReceipt(text, categoryNames = []) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // totale: righe con TOTALE / DA PAGARE / IMPORTO PAGATO (non SUBTOTALE), con importo sulla riga o sulla successiva
  const cands = [];
  lines.forEach((l, i) => {
    if (/SUB\s?-?TOTALE|TOTALE\s+IVA|IMPOSTA/i.test(l)) return;
    if (/(TOTALE|DA PAGARE|IMPORTO PAGATO|PAGAMENTO ELETTRONICO|TOTALE EURO)/i.test(l)) {
      const own = [...l.matchAll(AMOUNT)].map((m) => toCents(m[1]));
      const next = own.length ? [] : [...numLine(lines[i + 1]).matchAll(AMOUNT), ...numLine(lines[i + 2]).matchAll(AMOUNT)].map((m) => toCents(m[1]));
      const v = (own.length ? own : next);
      if (v.length) cands.push({ cents: Math.max(...v), strong: /TOTALE\s*(COMPLESSIVO|EURO)?\b|DA PAGARE/i.test(l), i });
    }
  });
  // altri indizi quando "TOTALE" e' illeggibile: SUBTOTALE, "TOTALE COMPLESS...", importo che si ripete
  const soft = [];
  lines.forEach((l, i) => {
    if (/SUB\s?-?TOTALE|COMPLESS|PLESSIV|T[O0]TAL/i.test(l) && !/IVA|IMPOSTA/i.test(l)) {
      const own = [...l.matchAll(AMOUNT)].map((m) => toCents(m[1]));
      const next = own.length ? [] : [...numLine(lines[i + 1]).matchAll(AMOUNT), ...numLine(lines[i + 2]).matchAll(AMOUNT)].map((m) => toCents(m[1]));
      const v = own.length ? own : next;
      if (v.length) soft.push(Math.max(...v));
    }
  });
  const all = lines.filter((l) => !/IVA|%|PARTITA|CARTA N|DOCUMENTO/i.test(l)).flatMap((l) => [...l.matchAll(AMOUNT)].map((m) => toCents(m[1])));
  const freq = new Map(); all.forEach((c) => freq.set(c, (freq.get(c) || 0) + 1));
  const repeated = [...freq].filter(([c, n]) => n >= 2 && c > 0).map(([c]) => c);
  // scelta del totale: ogni valore candidato prende punti dalle volte in cui compare nel testo (due letture diverse
  // che concordano contano molto), dal tipo di riga (TOTALE > SUBTOTALE) e dalla somma dei prezzi accanto alle aliquote IVA
  // somma dei prezzi accanto alle aliquote IVA: se in una lettura sono leggibili almeno 3 righe, e' un controllo forte sul totale
  let rateSum = 0, rateCount = 0;
  for (const chunk of String(text).split("\n=====\n")) {
    let sm = 0, n = 0;
    for (const m of chunk.matchAll(/\d{1,2}\s?[.,]\s?[0OC]{2}\s?%\s*(\d{1,4}[.,]\d{2})(?!\d)/g)) { sm += toCents(m[1]); n++; }
    if (n >= 3 && n >= rateCount) { rateSum = sm; rateCount = n; }
  }
  let maxItem = 0;
  for (const m of String(text).matchAll(/\d{1,2}\s?[.,]\s?[0OC]{2}\s?%\s*(\d{1,4}[.,]\d{2})(?!\d)/g)) maxItem = Math.max(maxItem, toCents(m[1]));
  // somma delle forme di pagamento (elettronico + ticket/buono pasto + contanti + non riscosso), prima del dettaglio finale
  let paySum = 0;
  for (const chunk of String(text).split("\n=====\n")) {
    const seen = new Set(); let sm = 0;
    for (const l of chunk.split(/\r?\n/)) {
      if (/DETTAGLIO/i.test(l)) break;
      const kind = /ELETTRONIC|ELETTR0NIC/i.test(l) ? "e" : /CONTANT/i.test(l) ? "c" : /TICKE|BUON[OI]\s*PAST|NON RISCOSS/i.test(l) ? "t" : null;
      const am = [...l.matchAll(AMOUNT)].map((m) => toCents(m[1]));
      if (kind && am.length && !seen.has(kind)) { seen.add(kind); sm += am[am.length - 1]; }
    }
    if (seen.size >= 2 && sm > paySum) paySum = sm;
  }
  const pool = new Map();
  const add = (c, kind) => { const e = pool.get(c) || { strong: false, soft: false, rate: false, pay: false }; e[kind] = true; pool.set(c, e); };
  cands.forEach((c) => c.strong && add(c.cents, "strong"));
  if (rateSum) add(rateSum, "rate");
  if (paySum) add(paySum, "pay");
  soft.forEach((c) => add(c, "soft"));
  let total = null, totalGuess = false, support = 0;
  if (maxItem) { const big = [...pool.keys()].filter((c) => c < maxItem); if (big.length < pool.size) big.forEach((c) => pool.delete(c)); }
  if (pool.size) {
    let best = -1;
    for (const [c, e] of pool) {
      const occ = occurrences(text, c);
      // fonti indipendenti che indicano questo importo: riga TOTALE/SUBTOTALE, somma righe con IVA, somma pagamenti
      const n = (e.strong || e.soft ? 1 : 0) + (rateSum && Math.abs(rateSum - c) <= 2 ? 1 : 0) + (paySum && c === paySum ? 1 : 0);
      const sc = occ * 10 + n * 10 + (e.strong ? 3 : 0) + (e.soft ? 2 : 0) + (paySum && c === paySum ? 3 : 0);
      if (sc >= best) { best = sc; total = c; support = occ + n - (occ ? 0 : 0); totalGuess = occ < 2 && n < 2; }
    }
  }
  if (total == null && all.length) {
    // ultima risorsa: l'importo piu ripetuto (a parita' il piu alto); non e' un'ipotesi se compare almeno 3 volte (riga, totale, pagamento)
    let bestC = 0, bestN = 0;
    for (const [c, n] of freq) if (c > 0 && (n > bestN || (n === bestN && c > bestC))) { bestC = c; bestN = n; }
    total = bestN >= 2 ? bestC : Math.max(...all);
    support = bestN >= 2 ? bestN : 1; totalGuess = support < 3;
  }
  if (total == null && cands.length) { total = cands[cands.length - 1].cents; totalGuess = true; support = 1; }
  // data
  let date = null;
  for (const l of lines) {
    const m = l.match(/(\d{1,2})\s?[\/.\-]\s?(\d{1,2})\s?[\/.\-]\s?(\d{2,4})/);
    if (!m) continue;
    let [_, d, mo, y] = m; d = +d; mo = +mo; y = +y; if (y < 100) y += 2000;
    if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) { date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; break; }
  }
  if (!date) {
    const t = lines.join("\n").match(/(\d{1,2})[^\d\n]{0,2}(\d{1,2})[^\d\n]{0,2}(20[2-3]\d)/);
    if (t) { const d = +t[1], mo = +t[2], y = +t[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
  }
  // anno letto male dall'OCR (es. 2026 -> 2020): se con l'anno corrente la data cade negli ultimi 60 giorni, la correggo
  let dateFixed = false;
  if (date) {
    const now = new Date(), day = 86400000;
    const [y, mo, d] = date.split("-").map(Number);
    const diff = (now - new Date(y, mo - 1, d)) / day;
    if (diff > 60 || diff < -1) {
      for (const yy of [now.getFullYear(), now.getFullYear() - 1]) {
        const df = (now - new Date(yy, mo - 1, d)) / day;
        if (df >= -1 && df <= 60) { date = `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; dateFixed = true; break; }
      }
    }
  }
  // esercente: prima riga "da nome"
  let merchant = null;
  const corp = lines.slice(0, 12).find((l) => /\b(SRL|S\.?R\.?L\.?|SPA|S\.?P\.?A\.?|SNC|SAS)\b/i.test(l) && (l.match(/[A-Za-zÀ-ÿ]/g) || []).length >= 6);
  if (corp) merchant = corp.replace(/[^A-Za-zÀ-ÿ0-9 '&.\-]/g, "").trim().slice(0, 60);
  else for (const l of lines.slice(0, 6)) {
    const letters = (l.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (letters >= 4 && letters >= l.length * 0.5 && !/(SCONTRINO|DOCUMENTO|FISCALE|P\.?\s?IVA|PARTITA|VIA |V\.LE|VIALE|PIAZZA|TEL)/i.test(l)) { merchant = l.replace(/[^A-Za-zÀ-ÿ0-9 '&.\-]/g, "").trim().slice(0, 60); break; }
  }
  // righe
  const items = [];
  const firstPass = String(text || "").split("\n=====\n")[0].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const l of firstPass) {
    if (SKIP_ITEM.test(l)) continue;
    const m = l.match(/^(.*?[A-Za-zÀ-ÿ].*?)\s+(-?\d{1,5}[.,]\d{2})\s*[A-Z]?$/);
    if (m) items.push({ name: m[1].replace(/\s*\d{1,2}\s?[.,]\s?\d{2}\s?%/, "").slice(0, 60), cents: toCents(m[2]) });
  }
  const sum = items.reduce((s, i) => s + i.cents, 0);
  const sumOk = total != null && items.length ? Math.abs(sum - total) <= 2 : null;
  let category = null;
  const hay = (merchant || "") + " " + lines.slice(0, 5).join(" ");
  for (const [re, name] of CATS) if (re.test(hay) && (!categoryNames.length || categoryNames.includes(name))) { category = name; break; }
  const amounts = [...freq].filter(([c]) => c >= 50 && c < 1000000).sort((a, b) => b[1] - a[1] || b[0] - a[0]).slice(0, 6).map(([c]) => c);
  return { total_support: support, date_fixed: dateFixed, amounts, total_guess: totalGuess, total_cents: total, date, merchant, items, items_sum_cents: items.length ? sum : null, sum_ok: sumOk, category };
}
