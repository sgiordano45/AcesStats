// js/data/board.js
// Board of Directors: decisions, appointed officers and documents.
//
//   Firestore  boardDecisions/{auto}
//     { title, summary, category, outcome, decidedOn ('YYYY-MM-DD'),
//       votesFor, votesAgainst, abstain (numbers or null when not recorded),
//       published, createdBy, createdByName, createdAt, updatedAt }
//
// board.html lists the published ones; league staff post and edit them in
// admin/content.html?tab=board (content-board.js). Rules: anyone can read a
// published decision, canManageContent() reads drafts and writes.
//
//   Firestore  boardOfficers/{auto}
//     { name, title, description, duties: [string], order, active,
//       updatedAt, updatedByName }
//   Appointed, non-voting officers. Active ones show on board.html by order;
//   league staff manage them in admin/content.html?tab=board
//   (content-board-officers.js). Rules: anyone reads, canManageContent() writes.
//
//   Board documents are leagueDocuments with category 'board' (uploaded in
//   admin/content.html?tab=docs). The Rules page leaves them off.

import { db, collection, getDocs, query, where, orderBy } from '../core/firebase.js';

export const BOARD_COLLECTION = 'boardDecisions';
export const OFFICERS_COLLECTION = 'boardOfficers';
export const BOARD_DOC_CATEGORY = 'board';

/** [value, label, icon] */
export const DECISION_CATEGORIES = [
  ['rules', 'Rules', 'scale'],
  ['rosters', 'Rosters', 'users'],
  ['discipline', 'Discipline', 'whistle'],
  ['schedule', 'Schedule', 'calendar'],
  ['fields', 'Fields', 'field'],
  ['policy', 'Policy', 'book'],
  ['other', 'Other', 'flag']
];

/** [value, label, badge class] */
export const DECISION_OUTCOMES = [
  ['approved', 'Approved', 'is-win'],
  ['rejected', 'Rejected', 'is-loss'],
  ['tabled', 'Tabled', 'is-outline'],
  ['announced', 'Announcement', 'is-brand']
];

export const categoryOf = (v) => DECISION_CATEGORIES.find(([k]) => k === v) || ['other', 'Other', 'flag'];
export const outcomeOf = (v) => DECISION_OUTCOMES.find(([k]) => k === v) || DECISION_OUTCOMES[0];

/** 'YYYY-MM-DD' -> local Date (never new Date(string), which reads it as UTC). */
export function parseDecisionDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function formatDecisionDate(s) {
  const d = parseDecisionDate(s);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

/** "4-1", "4-0-1" with abstentions, or '' when no vote was recorded. */
export function voteLine(d) {
  const n = (v) => (Number.isFinite(v) ? v : null);
  const f = n(d.votesFor), a = n(d.votesAgainst), x = n(d.abstain);
  if (f === null && a === null) return '';
  return `${f ?? 0}-${a ?? 0}${x ? `-${x}` : ''}`;
}

const newestFirst = (a, b) => String(b.decidedOn || '').localeCompare(String(a.decidedOn || ''));

/** Published decisions, newest first (sorted here, so no composite index). */
export async function getPublishedDecisions() {
  const snap = await getDocs(query(collection(db, BOARD_COLLECTION), where('published', '==', true)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst);
}

/** Every decision including drafts, newest first (league staff only). */
export async function getAllDecisions() {
  const snap = await getDocs(collection(db, BOARD_COLLECTION));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst);
}

const byOrder = (a, b) => (Number(a.order) || 99) - (Number(b.order) || 99) || String(a.name || '').localeCompare(String(b.name || ''));

/** Active appointed officers, by display order. */
export async function getActiveOfficers() {
  const snap = await getDocs(query(collection(db, OFFICERS_COLLECTION), where('active', '==', true)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byOrder);
}

/** Every appointed officer including hidden ones (admin). */
export async function getAllOfficers() {
  const snap = await getDocs(collection(db, OFFICERS_COLLECTION));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byOrder);
}

/** Active board documents (the charter etc.), by display order. Same query as
 *  the Rules page, filtered here so no new index is needed. */
export async function getBoardDocuments() {
  const snap = await getDocs(query(collection(db, 'leagueDocuments'), where('active', '==', true), orderBy('order', 'asc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.category === BOARD_DOC_CATEGORY);
}
