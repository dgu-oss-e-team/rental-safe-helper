// @ts-check
/**
 * PART 5. 도전 목표 ②: AI 답변의 가명을 이 브라우저 안에서만 원래 이름으로 보여 주기 (#394)
 *
 * - "가명 → 원래 이름" 표는 마스킹 계획(PART 4)에서 이름을 가명으로 바꾼 항목(REPLACE)만 읽어서 만든다.
 *   PART 4 코드는 고치지 않는다. 주소·번호·생년월일 등은 복원하지 않는다.
 * - 가명 찾기는 대소문자·띄어쓰기·밑줄만 정리해서 정확히 같은 가명만 바꾼다.
 *   [Landlord_B], Landlord_B, Landlord B, landlord b ✔ / "the landlord", "Landlord" ✘
 *   대괄호가 없을 때는 끝 글자가 대문자여야 한다 (영어 "landlord a ..." 같은 말을 바꾸지 않게).
 * - 확인 안 된 같은 이름 가명([Owner_A?])은 대괄호 안에 ?가 있을 때만 그것으로 본다
 *   (문장 끝 물음표 "Is it Owner_A?"는 확인된 가명).
 * - 결과는 글 조각 목록으로 돌려준다. 화면은 이것을 글자 노드로 그린다 (innerHTML을 쓰지 않음).
 * - 원래 이름은 저장·전송·콘솔 출력하지 않는다.
 */

import { MASKING_ACTION, PII_TYPE } from '../shared/document-model.js';

/** 가명 모양: [Landlord_B], [AccountHolder_C?] (alias-manager.js, create-masking-plan.js의 unconfirmedAlias) */
const ALIAS_SHAPE = /^\[([A-Za-z]+)_([A-Z])(\?)?\]$/;

/**
 * @typedef {Object} RestoreEntry
 * @property {string} alias  예: "[Landlord_B]"
 * @property {string} name  원래 이름 (글자가 조금 다른 것이 여럿이면 " / "로 잇는다)
 * @property {boolean} unconfirmed  같은 이름이지만 같은 사람인지 확인하지 않은 가명
 */

/**
 * @typedef {{ text: string } | { text: string, alias: string, name: string, unconfirmed: boolean }} RestoreSegment
 *   text: 화면에 보일 글. alias가 있으면 가명을 바꾼 조각이고 text는 AI 답변에 있던 그대로의 글이다
 */

/** 비교용 열쇠: 대소문자·띄어쓰기·밑줄을 뺀다 */
const keyOf = (/** @type {string} */ label, /** @type {string} */ letter, unconfirmed = false) =>
  `${label.replace(/[\s_]/g, '').toLowerCase()}_${letter.toLowerCase()}${unconfirmed ? '?' : ''}`;

/** 이름 비교용: 띄어쓰기를 정리한다 */
const tidyName = (/** @type {string} */ s) => s.replace(/\s+/g, ' ').trim();

/**
 * 마스킹 계획에서 "가명 → 원래 이름" 표를 만든다.
 * @param {import('../shared/document-model.js').MaskingPlan | null | undefined} plan
 * @param {{ id: string, type: string, value: string }[] | null | undefined} findings
 * @returns {Map<string, RestoreEntry>}  열쇠는 keyOf()
 */
export function buildRestoreTable(plan, findings) {
  /** @type {Map<string, RestoreEntry>} */
  const table = new Map();
  if (!plan?.items || !findings) return table;
  const byId = new Map(findings.map((f) => [f.id, f]));
  /** @type {Map<string, { alias: string, unconfirmed: boolean, names: string[] }>} */
  const found = new Map();
  for (const item of plan.items) {
    if (item.action !== MASKING_ACTION.REPLACE || typeof item.replacement !== 'string') continue;
    const m = ALIAS_SHAPE.exec(item.replacement);
    if (!m) continue;
    const f = byId.get(item.findingId);
    if (!f || f.type !== PII_TYPE.PERSON_NAME) continue;
    const name = tidyName(String(f.value ?? ''));
    if (!name) continue;
    const key = keyOf(m[1], m[2], Boolean(m[3]));
    const entry = found.get(key) ?? { alias: item.replacement, unconfirmed: Boolean(m[3]), names: [] };
    if (!entry.names.includes(name)) entry.names.push(name);
    found.set(key, entry);
  }
  for (const [key, e] of found) table.set(key, { alias: e.alias, name: e.names.join(' / '), unconfirmed: e.unconfirmed });
  return table;
}

/** 표에 있는 가명의 이름 부분 (예: "AccountHolder" → "Account[ _]*Holder"). 줄바꿈은 넘지 않는다 */
const labelPattern = (/** @type {string} */ label) =>
  label
    .split(/(?=[A-Z])/)
    .map((w) => w.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean)
    .join('[ _]*');

/**
 * AI 답변에서 표에 있는 가명을 찾아 원래 이름 조각으로 나눈다.
 * @param {string} answer  사용자가 붙여 넣은 AI 답변
 * @param {Map<string, RestoreEntry>} table  buildRestoreTable() 결과
 * @returns {{ segments: RestoreSegment[], replaced: number }}
 */
export function restoreAliases(answer, table) {
  const text = String(answer ?? '');
  if (!text || table.size === 0) return { segments: text ? [{ text }] : [], replaced: 0 };

  const labels = new Set();
  for (const e of table.values()) {
    const m = ALIAS_SHAPE.exec(e.alias);
    if (m) labels.add(labelPattern(m[1]));
  }
  // [ Landlord _ B ? ]  /  Landlord B  /  landlord_b
  // 역할 이름과 글자 사이는 띄어쓰기·밑줄만 (줄바꿈은 안 됨: "Owner" 다음 줄이 "A ..."로 시작해도 가명이 아니다, #395 리뷰)
  const pattern = new RegExp(
    `(\\[\\s*)?(?<![A-Za-z])(${[...labels].join('|')})[ _]+([A-Za-z])(?![A-Za-z0-9])(?:(\\s*\\?)?(\\s*\\]))?`,
    'gid',
  );

  /** @type {RestoreSegment[]} */
  const segments = [];
  let last = 0;
  let replaced = 0;
  for (const m of text.matchAll(pattern)) {
    const [, open, label, letter, question, close] = m;
    const bracketed = Boolean(open && close);
    // 대괄호가 없으면 끝 글자는 대문자만 (영어 관사 "a" 등과 헷갈리지 않게)
    if (!bracketed && letter !== letter.toUpperCase()) continue;
    const unconfirmed = bracketed && Boolean(question);
    // AI가 [Owner_A?]의 ?를 빼고 "Owner_A"로 쓰는 일이 있다. 확인된 [Owner_A]가 표에 없으면 이 글자는 [Owner_A?]밖에
    // 가리킬 수 없으므로 그것으로 바꾸되, 화면에는 "확인 안 된 같은 이름"으로 표시해 같은 사람이라고 오해하지 않게 한다
    const entry =
      table.get(keyOf(label, letter, unconfirmed)) ?? (unconfirmed ? undefined : table.get(keyOf(label, letter, true)));
    if (!entry) continue;
    // 바꿀 범위: 대괄호가 양쪽 다 있으면 대괄호까지, 아니면 가명 글자만 (한쪽 대괄호·문장 끝 물음표는 글로 남긴다)
    const at = /** @type {[number, number][]} */ (/** @type {any} */ (m).indices);
    const start = bracketed ? at[0][0] : at[2][0];
    const end = bracketed ? at[0][1] : at[3][1];
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({ text: text.slice(start, end), alias: entry.alias, name: entry.name, unconfirmed: entry.unconfirmed });
    last = end;
    replaced += 1;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return { segments, replaced };
}
