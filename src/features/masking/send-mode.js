// @ts-check
/**
 * PART 4. 목적 x 서류 종류별로 AI에 무엇을 보낼지 (src/config/masking/send-mode.json)
 *  - SUMMARY: 뽑은 항목 요약만 (등기부는 buildRegistrySummary). 원문은 나가지 않는다.
 *  - PARTY_SUMMARY: 가린 원문에서 인적사항 칸만 요약으로 바꾼다 (계약서, buildContractPartySummary)
 *  - MASKED_TEXT: 가린 원문 (applyMaskingPlan)
 *  - OMIT: 보내지 않음 (질문에 안 쓰이는 서류)
 */

import sendModes from '../../config/masking/send-mode.json';

export const SEND_MODE = Object.freeze({
  SUMMARY: 'SUMMARY',
  PARTY_SUMMARY: 'PARTY_SUMMARY',
  MASKED_TEXT: 'MASKED_TEXT',
  OMIT: 'OMIT',
});

const VALID = new Set(Object.values(SEND_MODE));

/**
 * 이 목적에서 이 서류를 어떻게 보낼지. 설정에 없는 목적·서류 종류(종류를 모르는 서류 등)는 지금처럼 가린 원문.
 * @param {string} purpose  MASKING_PURPOSE 값
 * @param {string} documentType  DOCUMENT_TYPE 값
 * @returns {'SUMMARY' | 'PARTY_SUMMARY' | 'MASKED_TEXT' | 'OMIT'}
 */
export function getSendMode(purpose, documentType) {
  const byType = /** @type {Record<string, Record<string, string>>} */ (/** @type {unknown} */ (sendModes))[purpose];
  const mode = byType && typeof byType === 'object' ? byType[documentType] : undefined;
  return /** @type {any} */ (VALID.has(/** @type {any} */ (mode)) ? mode : SEND_MODE.MASKED_TEXT);
}
