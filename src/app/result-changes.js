// @ts-check
/**
 * "같은 사람인가요?"에 답한 뒤 위험 점검 결과가 어떻게 바뀌었는지 (개선 목록 5번)
 *
 * 답하면 위험 점검을 다시 하고 결과 화면을 통째로 다시 그린다. 화면만 보면 무엇이 바뀌었는지 알기 어려워서
 * (예: Stop 1 → 2), 답하기 전과 뒤의 결과를 규칙(ruleId)마다 비교해 바뀐 것만 돌려준다.
 * 계산만 하고 화면은 그리지 않는다. 이름은 다루지 않는다 (규칙 id·제목·상태만).
 */

import { RISK_STATUS } from '../shared/document-model.js';

/** 상태 이름 (PART 3 결과 카드와 같은 말. 다른 파트 내부 파일을 가져오지 않으려고 여기에 둔다) */
const STATUS_TEXT = {
  [RISK_STATUS.STOP]: 'Stop',
  [RISK_STATUS.CHECK]: 'Check',
  [RISK_STATUS.UNVERIFIABLE]: 'Could not check',
  [RISK_STATUS.NO_FLAG]: 'No warning found',
};

/**
 * @typedef {{ ruleId: string, title: string, from: string | null, to: string | null }} ResultChange
 *   from: 답하기 전 상태 (없던 결과면 null), to: 답한 뒤 상태 (사라진 결과면 null)
 */

/**
 * 답하기 전과 뒤의 위험 점검 결과를 비교한다. 상태가 바뀌었거나, 새로 생겼거나, 사라진 규칙만 돌려준다.
 * 결과 순서는 답한 뒤 결과 순서 (사라진 것은 맨 뒤).
 * @param {{ ruleId: string, status: string, title: string }[] | null | undefined} before
 * @param {{ ruleId: string, status: string, title: string }[] | null | undefined} after
 * @returns {ResultChange[]}
 */
export function diffRiskResults(before, after) {
  const prev = new Map((before ?? []).map((r) => [r.ruleId, r]));
  const next = new Map((after ?? []).map((r) => [r.ruleId, r]));
  /** @type {ResultChange[]} */
  const changes = [];
  for (const r of after ?? []) {
    const old = prev.get(r.ruleId);
    if (!old) changes.push({ ruleId: r.ruleId, title: r.title, from: null, to: r.status });
    else if (old.status !== r.status) changes.push({ ruleId: r.ruleId, title: r.title, from: old.status, to: r.status });
  }
  for (const r of before ?? []) {
    if (!next.has(r.ruleId)) changes.push({ ruleId: r.ruleId, title: r.title, from: r.status, to: null });
  }
  return changes;
}

/** @param {string | null} status */
const statusText = (status) => (status ? (/** @type {Record<string, string>} */ (STATUS_TEXT)[status] ?? status) : '');

/**
 * 바뀐 결과 한 줄 글: "Owner and landlord check: Check → Stop"
 * @param {ResultChange} c
 */
export function changeText(c) {
  if (c.from === null) return `${c.title}: new (${statusText(c.to)})`;
  if (c.to === null) return `${c.title}: no longer shown`;
  return `${c.title}: ${statusText(c.from)} → ${statusText(c.to)}`;
}
