// @ts-check
/**
 * PART 4. 확인 화면(masking-review-ui)에 보여 줄 목록 만들기 (화면 없이 계산만 함)
 *
 * 화면은 "해제 단위"마다 한 줄을 보여 준다.
 *   - 이름: 같은 사람(personGroup)의 이름 전체가 한 줄 (한 곳만 풀면 가명이 누구인지 드러남)
 *   - 두 줄 주소: 같은 groupId 조각 전체가 한 줄
 *   - 나머지: 탐지 결과 하나가 한 줄
 * 줄마다 "AI에게 보여 주기" 체크를 켜고 끄면 edits.remove를 새로 만든다. (docs/INTERFACES.md 8번)
 */

import { MASKING_ACTION, PII_TYPE } from '../../shared/document-model.js';
import { NON_REMOVABLE_TYPES } from './user-edits.js';

/** @typedef {import('../../shared/document-model.js').PiiFinding} PiiFinding */
/** @typedef {import('../../shared/document-model.js').MaskingPlan} MaskingPlan */
/** @typedef {import('./user-edits.js').MaskingEdits} MaskingEdits */
/** @typedef {{ personId: string, alias: string, roles: string[], findingIds: string[], status: string }} PersonGroup */

/**
 * 확인 화면의 한 줄
 * @typedef {Object} ReviewRow
 * @property {string} key            줄 구분용 (같은 사람이면 personId, 두 줄 주소면 groupId, 아니면 findingId)
 * @property {string} type           개인정보 종류 (PII_TYPE)
 * @property {string[]} findingIds   이 줄을 해제하면 같이 풀리는 탐지 결과
 * @property {string[]} values       원본 글자 (화면에만 보여 줌, AI로 보내지 않음)
 * @property {string[]} documentIds  나온 서류
 * @property {'ALIAS' | 'HIDDEN' | 'PARTIAL' | 'SHOWN'} result  AI에게 어떻게 보이는지
 * @property {string | null} resultText  가명이나 줄인 주소 (ALIAS·PARTIAL일 때)
 * @property {boolean} locked        해제할 수 없는 종류인지
 * @property {boolean} shown         지금 해제되어(가리지 않고) 있는지
 */

/**
 * 탐지 결과와 마스킹 계획으로 확인 화면 목록을 만든다.
 * @param {{ findings: PiiFinding[], personGroups: PersonGroup[], plan: MaskingPlan }} input
 * @returns {ReviewRow[]}
 */
export function buildReviewRows({ findings, personGroups, plan }) {
  const itemById = new Map(plan.items.map((i) => [i.findingId, i]));
  const personByFinding = new Map();
  for (const p of personGroups) for (const id of p.findingIds) personByFinding.set(id, p);

  /** @type {Map<string, PiiFinding[]>} 줄 key → 그 줄의 탐지 결과 (나온 순서대로) */
  const units = new Map();
  for (const f of findings) {
    let key = f.id;
    if (f.type === PII_TYPE.PERSON_NAME && personByFinding.has(f.id)) key = `person:${personByFinding.get(f.id).personId}`;
    else if (f.type === PII_TYPE.ADDRESS && f.groupId) key = `address:${f.groupId}`;
    if (!units.has(key)) units.set(key, []);
    units.get(key)?.push(f);
  }

  return [...units.entries()].map(([key, list]) => {
    const items = list.map((f) => itemById.get(f.id));
    const shown = items.every((i) => i?.action === MASKING_ACTION.KEEP);
    const replaced = items.find((i) => i?.action === MASKING_ACTION.REPLACE);
    const type = list[0].type;

    /** @type {ReviewRow['result']} */
    let result = 'HIDDEN';
    if (shown) result = 'SHOWN';
    else if (replaced) result = type === PII_TYPE.PERSON_NAME ? 'ALIAS' : 'PARTIAL';

    return {
      key,
      type,
      findingIds: list.map((f) => f.id),
      values: [...new Set(list.map((f) => f.value))],
      documentIds: [...new Set(list.map((f) => f.documentId))],
      result,
      resultText: replaced?.replacement ?? null,
      locked: NON_REMOVABLE_TYPES.has(type),
      shown,
    };
  });
}

/**
 * 한 줄의 "AI에게 보여 주기"를 켜거나 끈 새 edits를 만든다. (원래 edits는 바꾸지 않음)
 * 해제할 수 없는 줄이면 그대로 돌려준다.
 * @param {MaskingEdits | undefined} edits
 * @param {ReviewRow} row
 * @param {boolean} show  true = 가리지 않기(해제), false = 다시 가리기
 * @returns {{ remove: string[], add: any[] }}
 */
export function setRowShown(edits, row, show) {
  const remove = new Set(edits?.remove ?? []);
  const add = (edits?.add ?? []).map((a) => ({ ...a }));
  if (row.locked) return { remove: [...remove], add };
  for (const id of row.findingIds) {
    if (show) remove.add(id);
    else remove.delete(id);
  }
  return { remove: [...remove], add };
}
