// Legge il testo OCR di uno scontrino italiano e ne ricava totale, data, esercente, righe e categoria suggerita.
const AMOUNT = /(\d{1,5}\s?[.,]\s?\d{2})(?!\d)/g;
const toCents = (s) => Math.round(parseFloat(s.replace(/\s/g, "").replace(",", ".")) * 100);
const SKIP_ITEM = /(TOTALE|SUBTOTALE|SUB-TOTALE|IVA|RESTO|CONTANT|PAGAMENTO|IMPORTO|SCONTO|ARROTOND|CARTA|BANCOMAT|POS|ELETTRONIC|NON RISCOSSO|DI CUI|PREZZO|IMPONIBILE|CODICE|TEL)/i;
const CATS = [
  [/(CONAD|COOP|CARREFOUR|LIDL|EUROSPIN|MD |SUPERMERCAT|ALIMENTAR|MACELLERIA|PANETTERIA|FORNO|ORTOFRUTTA|DESPAR|PENNY|TODIS|SIGMA|FAMILA|PAM |IPER|ALIMENT)/i, "Alimentari"],
  [/(FARMACIA|PARAFARMAC|OTTIC|CLINICA|AMBULATORIO|MEDIC)/i, "Salute"],
  [/(ENI |Q8|TAMOIL|ESSO|CARBURANT|DISTRIBUTORE|STAZIONE DI SERVIZIO|AUTOLAVAGGIO|IP |API )/i, "Auto"],
  [/(RISTORANTE|PIZZERIA|TRATTORIA|OSTERIA|BAR |CAFFE|CAFFÈ|GELATERIA|PASTICCERIA|PUB |SUSHI|BIRRERIA|PANINOTECA)/i, "Ristoranti e bar"],
  [/(AUTOSTRAD|TELEPASS|TRENITALIA|ITALO|TAXI|PARCHEGGIO|PARCHEGGI|BIGLIETT|ATM |AMT )/i, "Trasporti"],
  [/(CINEMA|TEATRO|MUSEO|LIBRERIA|GIOCATTOL)/i, "Svago"],
];
export function parseReceipt(text, categoryNames = []) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // totale: righe con TOTALE / DA PAGARE / IMPORTO PAGATO (non SUBTOTALE), con importo sulla riga o sulla successiva
  const cands = [];
  lines.forEach((l, i) => {
    if (/SUB\s?-?TOTALE|TOTALE\s+IVA|IMPOSTA/i.test(l)) return;
    if (/(TOTALE|DA PAGARE|IMPORTO PAGATO|PAGAMENTO ELETTRONICO|TOTALE EURO)/i.test(l)) {
      const own = [...l.matchAll(AMOUNT)].map((m) => toCents(m[1]));
      const next = own.length ? [] : [...(lines[i + 1] || "").matchAll(AMOUNT)].map((m) => toCents(m[1]));
      const v = (own.length ? own : next);
      if (v.length) cands.push({ cents: Math.max(...v), strong: /TOTALE\s*(COMPLESSIVO|EURO)?\b|DA PAGARE/i.test(l), i });
    }
  });
  let total = null;
  if (cands.length) {
    const strong = cands.filter((c) => c.strong);
    const pool = strong.length ? strong : cands;
    total = pool[pool.length - 1].cents; // l'ultimo "totale" e' quello finale
  }
  // data
  let date = null;
  for (const l of lines) {
    const m = l.match(/(\d{1,2})\s?[\/.\-]\s?(\d{1,2})\s?[\/.\-]\s?(\d{2,4})/);
    if (!m) continue;
    let [_, d, mo, y] = m; d = +d; mo = +mo; y = +y; if (y < 100) y += 2000;
    if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) { date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; break; }
  }
  // esercente: prima riga "da nome"
  let merchant = null;
  for (const l of lines.slice(0, 6)) {
    const letters = (l.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (letters >= 4 && letters >= l.length * 0.5 && !/(SCONTRINO|DOCUMENTO|FISCALE|P\.?\s?IVA|PARTITA|VIA |V\.LE|VIALE|PIAZZA|TEL)/i.test(l)) { merchant = l.replace(/[^A-Za-zÀ-ÿ0-9 '&.\-]/g, "").trim().slice(0, 60); break; }
  }
  // righe
  const items = [];
  for (const l of lines) {
    if (SKIP_ITEM.test(l)) continue;
    const m = l.match(/^(.*?[A-Za-zÀ-ÿ].*?)\s+(-?\d{1,5}[.,]\d{2})\s*[A-Z]?$/);
    if (m) items.push({ name: m[1].slice(0, 60), cents: toCents(m[2]) });
  }
  const sum = items.reduce((s, i) => s + i.cents, 0);
  const sumOk = total != null && items.length ? Math.abs(sum - total) <= 2 : null;
  let category = null;
  const hay = (merchant || "") + " " + lines.slice(0, 5).join(" ");
  for (const [re, name] of CATS) if (re.test(hay) && (!categoryNames.length || categoryNames.includes(name))) { category = name; break; }
  return { total_cents: total, date, merchant, items, items_sum_cents: items.length ? sum : null, sum_ok: sumOk, category };
}
