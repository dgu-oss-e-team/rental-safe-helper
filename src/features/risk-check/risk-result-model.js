// @ts-check
/**
 * PART 3. 위험 결과 카드 UI에 쓰는 계산 (화면 없이 테스트할 수 있게 UI와 분리)
 *
 * 규칙
 *  - 상태를 알 수 없는 값은 "문제 없음"이 아니라 UNVERIFIABLE(확인 불가)로 다룬다.
 *  - STOP → CHECK → UNVERIFIABLE → NO_FLAG 순서로 보여 준다. (STOP이 맨 위)
 */

import { RISK_STATUS } from '../../shared/document-model.js';

/** @typedef {import('../../shared/document-model.js').RiskResult} RiskResult */

/** 보여 주는 순서 (STOP이 맨 위) */
export const STATUS_ORDER = [RISK_STATUS.STOP, RISK_STATUS.CHECK, RISK_STATUS.UNVERIFIABLE, RISK_STATUS.NO_FLAG];

/** 상태를 사용자에게 보여 줄 말. "Safe"라는 말은 쓰지 않는다. */
export const STATUS_TEXT = {
  [RISK_STATUS.STOP]: 'Stop',
  [RISK_STATUS.CHECK]: 'Check',
  [RISK_STATUS.UNVERIFIABLE]: 'Could not check',
  [RISK_STATUS.NO_FLAG]: 'No warning found',
};

/** 기본으로 접어 두는 상태 (화면 길이를 줄이려고) */
export const COLLAPSED_STATUSES = [RISK_STATUS.UNVERIFIABLE, RISK_STATUS.NO_FLAG];

/**
 * 알 수 없는 상태는 UNVERIFIABLE로 바꾼다.
 * @param {string} status
 * @returns {string}
 */
export function normalizeStatus(status) {
  return STATUS_ORDER.includes(status) ? status : RISK_STATUS.UNVERIFIABLE;
}

/**
 * 결과를 상태별로 나눈다. 같은 상태 안에서는 들어온 순서를 지킨다.
 * @param {RiskResult[]} riskResults
 * @returns {Record<string, RiskResult[]>}
 */
export function groupRiskResults(riskResults) {
  /** @type {Record<string, RiskResult[]>} */
  const groups = Object.fromEntries(STATUS_ORDER.map((s) => [s, []]));
  if (!Array.isArray(riskResults)) return groups;
  for (const r of riskResults) {
    if (r && typeof r === 'object') groups[normalizeStatus(r.status)].push(r);
  }
  return groups;
}

/**
 * 고른 상태 필터가 지금 결과에 맞는지 확인한다.
 * 고른 상태의 결과가 없으면(예: 서류를 새로 분석함) 전체 보기(null)로 돌아간다.
 * @param {Record<string, RiskResult[]>} groups
 * @param {string | null} filter
 * @returns {string | null}
 */
export function validFilter(groups, filter) {
  return filter && groups[filter]?.length > 0 ? filter : null;
}
/**
 * 결과 화면 맨 위 결론 배너에 쓸 내용 (#377)
 * 우선순위: STOP > CHECK > (읽은 게 없음) > 경고 없음.
 * "경고 없음"이어도 안전하다고 단정하지 않는다.
 * UNVERIFIABLE이 있으면 어떤 경우에도 "확인하지 못한 항목이 있다"를 함께 알린다.
 * @param {RiskResult[]} riskResults
 * @returns {{ level: 'stop' | 'check' | 'unverifiable' | 'no_flag', title: string, message: string, unverifiableNote: string | null }}
 */
export function getConclusion(riskResults) {
  const groups = groupRiskResults(riskResults);
  const stop = groups[RISK_STATUS.STOP].length;
  const check = groups[RISK_STATUS.CHECK].length;
  const noFlag = groups[RISK_STATUS.NO_FLAG].length;
  const unverifiable = groups[RISK_STATUS.UNVERIFIABLE].length;
  const unverifiableNote = unverifiable > 0 ? 'Some items could not be checked. Treat them as not confirmed.' : null;

  if (stop > 0) {
    return {
      level: 'stop',
      title: 'Do not sign yet',
      message: 'We found a serious warning. Solve it first, before you sign or send any money.',
      unverifiableNote,
    };
  }
  if (check > 0) {
    return {
      level: 'check',
      title: 'Check these items before you sign',
      message: 'Some items need to be confirmed first. See the cards below.',
      unverifiableNote,
    };
  }
  if (noFlag === 0) {
    // 결과가 없거나 전부 확인 불가: "문제 없음"으로 읽히면 안 된다
    return {
      level: 'unverifiable',
      title: 'We could not check this yet',
      message: 'We could not read enough to check this contract. Please check the documents yourself.',
      unverifiableNote: null,
    };
  }
  return {
    level: 'no_flag',
    title: 'No warning found in the parts we could read',
    message: 'This does not mean the home is safe. Please still read the contract and the registry yourself.',
    unverifiableNote,
  };
}
