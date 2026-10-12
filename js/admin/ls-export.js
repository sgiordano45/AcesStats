// js/admin/ls-export.js
// The Stats export tab of admin/league-staff.html: one season's batting lines
// (or every season, for a career file) as an Excel download. Same columns as
// the old League Staff Admin export. Team-suffixed stat keys
// ('2025-fall-orange') roll up under their base season.

import { getAllPlayerStatsOptimized } from '../data/player-stats.js';
import { seasonLabel, sortSeasonIds } from '../domain/season-ids.js';
import { escapeHtml as esc } from '../ui/format.js';
import { showToast } from '../ui/toast.js';

const $ = (id) => document.getElementById(id);
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let players = null;

function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XLSX_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the spreadsheet writer'));
    document.head.appendChild(s);
  });
}

const n3 = (v) => (v != null ? Number(v).toFixed(3) : '');
const singles = (s) => (s.doubles != null ? (s.hits || 0) - (s.doubles || 0) - (s.triples || 0) - (s.homeRuns || 0) : '');
const bwar = (s) => ((s.bwar ?? s.bwarSimp) != null ? Number(s.bwar ?? s.bwarSimp).toFixed(2) : '');

function line(s, extra = {}) {
  return {
    ...extra,
    Team: s.team || '',
    G: s.games ?? '', AB: s.atBats ?? '', H: s.hits ?? '', R: s.runs ?? '', BB: s.walks ?? '',
    AVG: s.battingAverage != null ? n3(s.battingAverage) : '',
    OBP: s.onBasePercentage != null ? n3(s.onBasePercentage) : '',
    '1B': singles(s), '2B': s.doubles ?? '', '3B': s.triples ?? '', HR: s.homeRuns ?? '', RBI: s.rbi ?? '',
    bWAR: bwar(s)
  };
}

async function download() {
  const season = $('lxSeason').value;
  if (!players) return;
  const btn = $('lxDownload');
  btn.disabled = true;
  try {
    await loadXlsx();
    let rows = [], file, sheet;
    if (season === 'career') {
      players.forEach(p => Object.entries(p.seasons || {}).forEach(([key, s]) => rows.push(line(s, { 'Player Name': p.name || p.displayName || '', Season: key }))));
      rows.sort((a, b) => a['Player Name'].localeCompare(b['Player Name']) || a.Season.localeCompare(b.Season));
      file = 'aces-stats-career.xlsx';
      sheet = 'Career Stats';
    } else {
      players.forEach(p => Object.keys(p.seasons || {}).filter(k => k.startsWith(season)).forEach(k => {
        const s = p.seasons[k];
        const r = line(s, { 'Player Name': p.name || p.displayName || '' });
        // AcesBPI sits after OBP, as in the old export.
        const { '1B': one, '2B': two, '3B': three, HR, RBI, bWAR, ...head } = r;
        rows.push({ ...head, AcesBPI: s.acesBPI != null ? Number(s.acesBPI).toFixed(1) : '', '1B': one, '2B': two, '3B': three, HR, RBI, bWAR });
      }));
      // Hitters with 10+ AB first, by average; the rest after.
      rows.sort((a, b) => {
        const qa = (Number(a.AB) || 0) >= 10, qb = (Number(b.AB) || 0) >= 10;
        if (qa !== qb) return qa ? -1 : 1;
        return (parseFloat(b.AVG) || 0) - (parseFloat(a.AVG) || 0);
      });
      file = `aces-stats-${season}.xlsx`;
      sheet = season;
    }
    if (!rows.length) { showToast('No stats for that season.', 'warning'); return; }
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(rows), sheet);
    window.XLSX.writeFile(wb, file);
    $('lxStatus').textContent = `Downloaded ${file} (${rows.length} rows).`;
    showToast(`Downloaded ${file}`, 'success');
  } catch (err) {
    console.error('[export]', err);
    $('lxStatus').textContent = `Export failed: ${err.message || err}`;
    showToast(`Export failed: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

export async function mount() {
  $('lxDownload').addEventListener('click', download);
  $('lxStatus').textContent = 'Loading player stats...';
  try {
    players = await getAllPlayerStatsOptimized();
    const ids = sortSeasonIds([...new Set(players.flatMap(p => Object.keys(p.seasons || {}).map(k => k.split('-').slice(0, 2).join('-'))))]
      .filter(id => /^\d{4}-[a-z]+$/.test(id)));
    $('lxSeason').innerHTML = ids.map(id => `<option value="${esc(id)}">${esc(seasonLabel(id))}</option>`).join('') + '<option value="career">Every season (career file)</option>';
    $('lxDownload').disabled = false;
    $('lxStatus').textContent = `${players.length} players loaded.`;
  } catch (err) {
    console.error('[export] load', err);
    $('lxStatus').textContent = `Could not load player stats: ${err.message || err}`;
  }
}
