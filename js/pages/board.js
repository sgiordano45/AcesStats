// js/pages/board.js
// board.html: the board seats are in the page. This loads the published
// board decisions and the category filter.
//
// URL: board.html?cat=rules#decisions
// Data: boardDecisions (published == true), see js/data/board.js.

import { initPage, pageReady } from '../core/app.js';
import { escapeHtml as esc, pluralize } from '../ui/format.js';
import { icon } from '../ui/icons.js';
import {
  getPublishedDecisions, DECISION_CATEGORIES, categoryOf, outcomeOf,
  formatDecisionDate, voteLine
} from '../data/board.js';

const $ = (id) => document.getElementById(id);
const S = { all: [], cat: new URLSearchParams(location.search).get('cat') || '' };

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
