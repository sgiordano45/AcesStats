// js/admin/stats-pdf.js
// Reads a scoresheet PDF into stat rows for admin/submit-stats.html.
// Moved unchanged from the old page: PDF.js text extraction, the
// GameChanger box-score parser, the generic column parser, and the fuzzy
// name match against the team roster. Needs pdf.min.js loaded on the page.
//
// parsePdf(file, roster) -> { rows, gameChanger }
//   rows: [{ pdfName, matchedPlayer, matchScore, ab, h, r, bb, '2b', '3b', hr, rbi, ip, ra }]

const WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Fuzzy matching

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) { dp[i] = [i]; }
  for (let j = 0; j <= n; j++) { dp[0][j] = j; }
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

export function fuzzyScore(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
}

export function bestRosterMatch(pdfName, roster) {
  if (!roster || roster.length === 0) return { player: null, score: 0 };
  let best = null, bestScore = 0;
  const pdfLower = pdfName.toLowerCase().trim();
  for (const player of roster) {
    const full = (player.name || '').toLowerCase();
    const parts = full.split(' ');
    const last = parts[parts.length - 1] || '';
    const first = parts[0] || '';
    const lastFirst = `${last} ${first}`.trim();
    // Cut-off names ("k delledo" for "Kevin Delledonne"): first initial plus the start of the rest
    const initialPrefix = pdfLower.length >= 5 && first && `${first[0]} ${parts.slice(1).join(' ')}`.startsWith(pdfLower) ? 0.8 : 0;
    const score = Math.max(
      initialPrefix,
      fuzzyScore(pdfLower, full),
      fuzzyScore(pdfLower, last) * 0.85,
      fuzzyScore(pdfLower, first) * 0.80,
      fuzzyScore(pdfLower, lastFirst) * 0.95
    );
    if (score > bestScore) { bestScore = score; best = player; }
  }
  return { player: best, score: bestScore };
}

// Text extraction

async function extractPdfLines(file) {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('The PDF reader did not load. Refresh the page and try again.');
  lib.GlobalWorkerOptions.workerSrc = WORKER;
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const yGroups = new Map();
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      if (!yGroups.has(y)) yGroups.set(y, []);
      yGroups.get(y).push({ x: item.transform[4], str: item.str });
    }
    const sortedYs = [...yGroups.keys()].sort((a, b) => b - a);
    for (const y of sortedYs) {
      const items = yGroups.get(y).sort((a, b) => a.x - b.x);
      const line = items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (line) allLines.push(line);
    }
  }
  return allLines;
}

// GameChanger box scores

function isGameChangerFormat(lines) {
  // "AB R H RBI BB SO" (R before H, no HR column) is specific to GameChanger box scores
  const hasColHeader = lines.some(l => /\bAB\s+R\s+H\s+RBI\s+BB\s+SO\b/.test(l));
  const hasJersey = lines.some(l => /#\d+/.test(l));
  const hasBatting = lines.some(l => /\bBATTING\b/i.test(l));
  return hasColHeader && (hasJersey || hasBatting);
}

function parseHitTypeFromNotes(notesText, hitType) {
  const map = {};
  const stopMarkers = '2B|3B|HR|TB|SF|LOB|HBP|GDP|SB|CS|PITCHING';
  const rx = new RegExp(`\\b${hitType}\\s*:\\s*([\\s\\S]+?)(?=\\s*\\b(?:${stopMarkers})\\s*:|$)`, 'i');
  const m = rx.exec(notesText);
  if (!m) return map;
  const parts = m[1].split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const nm = part.match(/^([A-Za-z][A-Za-z\s.']+?)(?:\s+(\d+))?\s*$/);
    if (!nm) continue;
    const name = nm[1].trim().toLowerCase();
    const count = parseInt(nm[2]) || 1;
    if (/^(tb|sf|lob|hbp|gdp|totals|pitching)$/.test(name)) continue;
    if (name.length < 2) continue;
    map[name] = (map[name] || 0) + count;
  }
  return map;
}

// Row reading helpers for jersey-anchored rows

const HEADER_WORDS = new Set(['ab', 'r', 'h', 'rbi', 'bb', 'so', 'totals', 'total', 'red', 'blue',
  'aces', 'batting', 'pitching', 'ip', 'er', 'hr', 'away', 'home', 'fall', 'summer', 'spring']);

// After "#N": skip a position like "(3B)" or a stray wrapped letter, then read the
// six numbers AB R H RBI BB SO. Returns null if the text is not a stat row.
function readStatTail(text, pos) {
  const tokRx = /\s*(\S+)/y;
  tokRx.lastIndex = pos;
  const junkRx = /^\([^)]*\)?,?$|^[^()\s]{1,4}\)$|^[A-Za-z]{1,2}$/;
  const nums = [];
  let junk = 0, t;
  while (nums.length < 6 && (t = tokRx.exec(text))) {
    const tok = t[1];
    if (/^\d+$/.test(tok)) nums.push(parseInt(tok));
    else if (nums.length === 0 && junk < 4 && junkRx.test(tok)) junk++;
    else return null;
  }
  return nums.length === 6 ? { nums, end: tokRx.lastIndex } : null;
}

// Name = the words just before the "#N", back to the first initial. Stray lowercase
// letters and ellipses are dropped; column headings and the other team's numbers end the name.
function nameBefore(text) {
  const toks = text.trim().split(/\s+/);
  const out = [];
  for (let i = toks.length - 1; i >= 0 && out.length < 4; i--) {
    // GameChanger cuts long names short with an ellipsis ("Paszk..."): drop it, keep the letters
    const t = toks[i].replace(/(?:\u2026|\.{3})+$/, '');
    if (!t) continue;
    if (/^[a-z]$/.test(t)) continue;
    if (/^[A-Z]\.?$/.test(t)) { out.unshift(t); break; }
    if (!/^[A-Za-z][A-Za-z.'\-]*$/.test(t) || HEADER_WORDS.has(t.toLowerCase())) break;
    out.unshift(t);
  }
  return out.join(' ');
}

function parseGameChangerFormat(lines, roster) {
  const results = [];
  const seenNames = new Set();
  const fullText = lines.join(' ');
  // Two kinds of rows:
  //   1) "Name #N (POS)  AB R H RBI BB SO"   jersey-anchored. The name and the stats
  //      are found separately, so cut-off names and stray wrapped letters ("d", "n")
  //      between the name, position and numbers cannot make a row disappear.
  //   2) "F Lastname  AB R H RBI BB SO"       (no jersey; a first initial plus 1-3
  //      words that each contain a lowercase letter, so header text can't be swallowed)
  // A row is always returned, even when the name matches nobody on the roster.
  const consumed = [];
  const overlaps = (a, b) => consumed.some(([s, e]) => a < e && b > s);

  function pushRow(name, nums) {
    const key = name.toLowerCase();
    if (!name || /^totals?$/i.test(name) || seenNames.has(key)) return;
    seenNames.add(key);
    const [ab, r, h, rbi, bb] = nums;
    const { player, score } = bestRosterMatch(name, roster);
    results.push({ pdfName: name, matchedPlayer: player, matchScore: score,
      ab: ab || 0, h: h || 0, r: r || 0, bb: bb || 0, '2b': 0, '3b': 0, hr: 0, rbi: rbi || 0, ip: 0, ra: 0 });
  }

  // 1) Jersey rows
  const jerseyRx = /#\d+/g;
  let jm;
  while ((jm = jerseyRx.exec(fullText)) !== null) {
    const tail = readStatTail(fullText, jm.index + jm[0].length);
    if (!tail) continue;
    const name = nameBefore(fullText.slice(Math.max(0, jm.index - 80), jm.index));
    consumed.push([jm.index, tail.end]);
    pushRow(name, tail.nums);
    jerseyRx.lastIndex = tail.end;
  }

  // 2) Rows with no jersey number
  const plainRx = /\b([A-Z]\.?\s+(?=[A-Za-z'.\-]*[a-z])[A-Za-z][A-Za-z'.\-]*(?:\s+(?=[A-Za-z'.\-]*[a-z])[A-Za-z][A-Za-z'.\-]*){0,2})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/g;
  let m;
  while ((m = plainRx.exec(fullText)) !== null) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    pushRow(m[1].trim(), m.slice(2, 8).map(n => parseInt(n)));
  }

  // The notes block often wraps onto lines with no "2B:/3B:/HR:" marker, so take
  // everything from the first marker line down to the PITCHING section.
  const notesStart = lines.findIndex(l => /\b(2B|3B|HR)\s*:/i.test(l));
  if (notesStart >= 0) {
    let notesEnd = lines.findIndex((l, i) => i > notesStart && /^(PITCHING|BATTING)\b/i.test(l));
    if (notesEnd < 0) notesEnd = lines.length;
    const notesText = lines.slice(notesStart, notesEnd).join(' ');
    const doublesMap = parseHitTypeFromNotes(notesText, '2B');
    const triplesMap = parseHitTypeFromNotes(notesText, '3B');
    const homeRunsMap = parseHitTypeFromNotes(notesText, 'HR');
    for (const row of results) {
      const rowName = row.pdfName.toLowerCase();
      for (const [n, c] of Object.entries(doublesMap)) { if (fuzzyScore(rowName, n) >= 0.72) row['2b'] += c; }
      for (const [n, c] of Object.entries(triplesMap)) { if (fuzzyScore(rowName, n) >= 0.72) row['3b'] += c; }
      for (const [n, c] of Object.entries(homeRunsMap)) { if (fuzzyScore(rowName, n) >= 0.72) row.hr += c; }
    }
  }
  return results;
}

// Generic fallback

const PDF_SKIP_WORDS = new Set([
  'totals', 'total', 'team', 'opponent', 'game', 'date', 'season', 'player', 'name',
  'innings', 'stats', 'batting', 'pitching', 'lineup', 'ab', 'h', 'r', 'bb', 'hr', 'ip', 'ra',
  'rbi', 'so', 'sb', 'avg', 'obp', 'slg', 'era', 'g', 'gs'
]);

function parseGenericFormat(lines, roster) {
  function detectColumnMap() {
    for (const line of lines) {
      if (!/\bab\b/i.test(line)) continue;
      const tokens = line.split(/\s+/);
      const map = {};
      tokens.forEach((t, i) => {
        const tl = t.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (['ab', 'atbat', 'atbats'].includes(tl)) map.ab = i;
        else if (['h', 'hits'].includes(tl) && map.h === undefined) map.h = i;
        else if (['r', 'runs', 'rs'].includes(tl) && map.r === undefined) map.r = i;
        else if (['bb', 'walks', 'walk'].includes(tl)) map.bb = i;
        else if (['hr', 'homerun', 'homeruns'].includes(tl)) map.hr = i;
        else if (['rbi', 'rbis'].includes(tl)) map.rbi = i;
        else if (['2b', 'doubles'].includes(tl)) map['2b'] = i;
        else if (['3b', 'triples'].includes(tl)) map['3b'] = i;
        else if (['ip', 'innings'].includes(tl)) map.ip = i;
        else if (['ra', 'runsallowed'].includes(tl)) map.ra = i;
        else if (['er', 'earnedruns'].includes(tl)) map.er = i;
      });
      if (map.ab !== undefined || (map.h !== undefined && map.r !== undefined)) return map;
    }
    return null;
  }

  const colMap = detectColumnMap();
  const simpleRx = /^([A-Za-z][A-Za-z'.\-\s]{1,28}?)\s+(\d+(?:\.\d)?)\s+(\d+)\s+(\d+)(?:\s+(\d+))?(?:\s+(\d+))?(?:\s+(\d+))?/;
  const rawResults = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 4 || /^\d/.test(trimmed)) continue;
    const firstWord = trimmed.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
    if (PDF_SKIP_WORDS.has(firstWord)) continue;
    const m = simpleRx.exec(trimmed);
    if (!m) continue;
    const namePart = m[1].trim();
    if (namePart.length < 2 || PDF_SKIP_WORDS.has(namePart.toLowerCase().replace(/[^a-z]/g, ''))) continue;
    // All-caps short strings are team abbreviations ("ACSR"), not player names
    if (namePart.length <= 6 && namePart === namePart.toUpperCase() && /^[A-Z]+$/.test(namePart)) continue;

    const rawNums = trimmed.slice(namePart.length).trim().split(/\s+/).map(n => parseFloat(n)).filter(n => !isNaN(n));
    if (rawNums.length < 2 || rawNums[0] > 20) continue;

    let ab = 0, h = 0, r = 0, bb = 0, hr = 0, ip = 0, ra = 0, doubles = 0, triples = 0, rbi = 0;
    if (colMap && colMap.ab !== undefined) {
      const tokens = trimmed.split(/\s+/);
      let fni = tokens.findIndex(t => /^\d+\.?\d*$/.test(t));
      if (fni < 0) fni = 1;
      const off = (colMap.ab ?? fni) - fni;
      const gc = (col) => col !== undefined ? (parseFloat(tokens[col - off]) || 0) : 0;
      ab = gc(colMap.ab); h = gc(colMap.h); r = gc(colMap.r); bb = gc(colMap.bb);
      hr = gc(colMap.hr); ip = gc(colMap.ip);
      ra = gc(colMap.ra) || gc(colMap.er);
      doubles = gc(colMap['2b']); triples = gc(colMap['3b']); rbi = gc(colMap.rbi);
    } else {
      [ab = 0, h = 0, r = 0, bb = 0, hr = 0] = rawNums;
    }
    if (ab > 0 && h > ab) h = ab;

    const { player, score } = bestRosterMatch(namePart, roster);
    rawResults.push({ pdfName: namePart, matchedPlayer: player, matchScore: score,
      ab, h, r, bb, '2b': doubles, '3b': triples, hr, rbi, ip, ra });
  }

  const byKey = new Map();
  for (const row of rawResults) {
    const key = row.matchedPlayer?.legacyId || `__pdf__${row.pdfName}`;
    const prev = byKey.get(key);
    if (!prev || prev.matchScore < row.matchScore) byKey.set(key, row);
  }
  return [...byKey.values()];
}

export async function parsePdf(file, roster) {
  const lines = await extractPdfLines(file);
  const gameChanger = isGameChangerFormat(lines);
  const rows = gameChanger ? parseGameChangerFormat(lines, roster) : parseGenericFormat(lines, roster);
  return { rows, gameChanger };
}
