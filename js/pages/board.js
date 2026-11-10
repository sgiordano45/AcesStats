// js/pages/board.js
// board.html: the voting seats are in the page. This loads the appointed
// officers, the board documents, the published decisions and the category
// filter. Officers and documents stay hidden when there are none.
//
// URL: board.html?cat=rules#decisions
// Data: boardOfficers, leagueDocuments (category 'board'), boardDecisions;
// see js/data/board.js.

import { initPage, pageReady } from '../core/app.js';
import { escapeHtml as esc, pluralize } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import {
  getPublishedDecisions, getActiveOfficers, getBoardDocuments,
  DECISION_CATEGORIES, categoryOf, outcomeOf, formatDecisionDate, voteLine
} from '../data/board.js';

const $ = (id) => document.getElementById(id);
const S = { all: [], cat: new URLSearchParams(location.search).get('cat') || '' };

// ---------------------------------------------------------------------------
// Officers and documents
// ---------------------------------------------------------------------------

async function loadOfficers() {
  try {
    const list = await getActiveOfficers();
    if (!list.length) return;
    $('bdOfficers').innerHTML = list.map((o) => {
      const duties = (Array.isArray(o.duties) ? o.duties : []).filter(Boolean);
      const initial = String(o.name || '?').trim().charAt(0).toUpperCase();
      return `<li class="aces-card bd-seat is-officer">
        <span class="bd-mono" aria-hidden="true">${esc(initial)}</span>
        <div class="bd-seat-body">
          <h3 class="bd-name">${esc(o.name || '')}</h3>
          ${o.title ? `<p class="bd-title">${esc(o.title)}</p>` : ''}
          ${o.description ? `<p class="bd-role">${esc(o.description)}</p>` : ''}
          ${duties.length ? `<ul class="bd-duties">${duties.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        </div>
      </li>`;
    }).join('');
    $('bdOfficersBlock').hidden = false;
  } catch (err) {
    console.error('[board] officers', err);
  }
}

async function loadDocuments() {
  try {
    const list = await getBoardDocuments();
    if (!list.length) return;
    $('bdDocs').innerHTML = list.map((v) => {
      const when = v.uploadedAt?.toDate ? v.uploadedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      const url = /^https?:\/\//i.test(v.url || '') ? v.url : '';
      return `<li><a class="bd-doc" ${url ? `href="${esc(url)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>
        <span class="bd-doc-icon">${icon('book')}</span>
        <span class="bd-doc-body"><b>${esc(v.title || 'Document')}</b>
          ${v.description ? `<span>${esc(v.description)}</span>` : ''}
          ${when ? `<small>Updated ${esc(when)}</small>` : ''}</span>
        ${icon('external-link')}
      </a></li>`;
    }).join('');
    $('documents').hidden = false;
  } catch (err) {
    console.error('[board] documents', err);
  }
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

function renderFilters() {
  const counts = {};
  S.all.forEach((d) => { const k = categoryOf(d.category)[0]; counts[k] = (counts[k] || 0) + 1; });
  const used = DECISION_CATEGORIES.filter(([k]) => counts[k]);
  if (used.length < 2) { $('bdFilters').hidden = true; return; }
  $('bdFilters').hidden = false;
  $('bdFilters').innerHTML = `
    <button type="button" class="aces-chip" data-cat="" aria-pressed="${!S.cat}">All <small>${S.all.length}</small></button>
    ${used.map(([k, label, ic]) => `<button type="button" class="aces-chip" data-cat="${k}" aria-pressed="${S.cat === k}">${icon(ic)}${esc(label)} <small>${counts[k]}</small></button>`).join('')}`;
}

function decisionHtml(d) {
  const [, catLabel, catIcon] = categoryOf(d.category);
  const [, outLabel, outClass] = outcomeOf(d.outcome);
  const date = formatDecisionDate(d.decidedOn);
  const vote = voteLine(d);
  return `<li class="aces-card bd-decision">
    <div class="bd-decision-meta">
      ${date ? `<time datetime="${esc(d.decidedOn)}">${esc(date)}</time>` : ''}
      <span class="bd-cat">${icon(catIcon)}${esc(catLabel)}</span>
    </div>
    <div class="bd-decision-body">
      <h3>${esc(d.title || 'Board decision')}</h3>
      ${d.summary ? `<p>${esc(d.summary).replace(/\n+/g, '<br>')}</p>` : ''}
    </div>
    <div class="bd-decision-result">
      <span class="aces-badge ${outClass}">${esc(outLabel)}</span>
      ${vote ? `<span class="bd-vote" title="Votes for-against${d.abstain ? '-abstained' : ''}">Vote ${esc(vote)}</span>` : ''}
    </div>
  </li>`;
}

function renderDecisions() {
  const list = S.cat ? S.all.filter((d) => categoryOf(d.category)[0] === S.cat) : S.all;
  $('bdCount').textContent = S.all.length ? pluralize(S.all.length, 'decision') : '';
  if (!S.all.length) {
    $('bdDecisions').innerHTML = `<li class="aces-empty">${icon('scroll')}<span class="aces-empty-title">No decisions posted yet</span>Board decisions will be published here after each vote.</li>`;
    return;
  }
  $('bdDecisions').innerHTML = list.length
    ? list.map(decisionHtml).join('')
    : '<li class="aces-empty">No decisions in this category.</li>';
}

function setCat(cat) {
  S.cat = cat;
  const p = new URLSearchParams(location.search);
  if (cat) p.set('cat', cat); else p.delete('cat');
  const qs = p.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  renderFilters();
  renderDecisions();
}

async function main() {
  await initPage({ title: 'League Board' });
  pageReady();
  $('bdFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (b) setCat(b.dataset.cat);
  });
  loadOfficers();
  loadDocuments();
  try {
    S.all = await getPublishedDecisions();
    if (S.cat && !S.all.some((d) => categoryOf(d.category)[0] === S.cat)) S.cat = '';
    renderFilters();
    renderDecisions();
  } catch (err) {
    console.error('[board] decisions', err);
    $('bdFilters').hidden = true;
    $('bdDecisions').innerHTML = '<li class="aces-empty">Board decisions couldn\'t be loaded. Try again later.</li>';
  }
}

main();
