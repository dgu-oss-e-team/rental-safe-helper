// @ts-check
/**
 * PART 3. 사기 위험 점검 및 AI 상담 프롬프트
 * 담당: docs/OWNERS.md 참고
 *
 * 공개 함수
 *   assessRisks(fields, personGroups)                          → Result<RiskResult[]>
 *   buildPrompt({ purpose, riskResults, maskedText, legend, monthlyRent?, registry? })  → Result<string>
 *   getRecommendedQuestions(purpose, riskResults?)             → string[] | null
 *   renderRiskResults(riskResults)                             → HTMLElement  (slots.js riskResults)
 *
 * 규칙: 프롬프트에는 PART 4가 만든 "마스킹 완료 텍스트"와 범례만 넣는다. 원본 개인정보를 다시 넣지 않는다.
 *
 * 구현 상태
 *   완료: 소유자·임대인 / 예금주·임대인 / 소재지 비교 (compare-documents.js)
 *         신탁, 압류·가압류, 근저당, 최근 소유권 이전 (assess-risks.js)
 *         위험 특약 문구 (special-terms.js, 키워드·예외 문구는 src/config/rules/special-term-keywords.yaml)
 *         프롬프트 (prompt-builder.js), 추천 질문 (recommended-questions.js)
 *         위험 결과 카드 UI (risk-result-ui.js, slots.js에 연결 #63)
 */

import { ok, fail, ERROR_CODE, RISK_STATUS } from '../../shared/document-model.js';
import { compareDocuments } from './compare-documents.js';
import { assessRegistryRisks } from './assess-risks.js';
import { assessSpecialTerms } from './special-terms.js';
import { buildRiskResult } from './risk-explanations.js';

export { buildPrompt } from './prompt-builder.js';
export { getRecommendedQuestions } from './recommended-questions.js';
export { renderRiskResults } from './risk-result-ui.js';

/** @typedef {import('../../shared/document-model.js').RiskResult} RiskResult */

/**
 * 등기부와 계약서를 비교해 위험을 점검한다.
 * @param {object} fields  extractFields() 결과
 * @param {object[]} personGroups  matchPeople() 결과
 */
export function assessRisks(fields, personGroups) {
  if (!fields || !Array.isArray(personGroups)) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Extracted fields or person groups are missing.');
  }

  // 소유자·임대인, 예금주·임대인, 소재지 비교
  const compared = compareDocuments(fields, personGroups);
  if (!compared.ok) return compared;

  // 신탁, 압류·가압류, 근저당, 최근 소유권 이전
  const registryRisks = assessRegistryRisks(fields);
  if (!registryRisks.ok) return registryRisks;

  // 위험 특약 문구 (특약을 못 읽었으면 UNVERIFIABLE)
  const specialTerms = assessSpecialTerms(fields);
  if (!specialTerms.ok) return specialTerms;

  return ok(markMissingRegistry(fields, [...compared.data, ...registryRisks.data, specialTerms.data]));
}

/** 등기부가 필요한 규칙 (예금주·특약 규칙은 등기부가 필요 없다) */
const REGISTRY_RULES = new Set([
  'OWNER_MISMATCH', 'ADDRESS_MISMATCH', 'TRUST_REGISTERED', 'SEIZURE_ACTIVE',
  'PROVISIONAL_DISPOSITION_ACTIVE', 'AUCTION_ACTIVE', 'PROVISIONAL_REGISTRATION_ACTIVE',
  'MORTGAGE_EXISTS', 'RECENT_OWNERSHIP_CHANGE',
]);

/**
 * 등기부를 안 넣어서 확인하지 못한 카드는 "읽지 못함"이 아니라 "등기부 없음"으로 안내한다.
 * documentId가 null이면(안 넣었거나 종류를 못 알아본 경우) 바꾼다. 읽지 못한 경우는 기존 문구 그대로.
 * @param {any} fields
 * @param {RiskResult[]} results
 */
function markMissingRegistry(fields, results) {
  if (fields?.registry?.documentId !== null) return results;
  return results.map((r) => {
    if (r.status !== RISK_STATUS.UNVERIFIABLE || !REGISTRY_RULES.has(r.ruleId)) return r;
    const t = buildRiskResult(r.ruleId, RISK_STATUS.UNVERIFIABLE, { variant: 'no_registry' });
    return t.ok ? { ...r, explanation: t.data.explanation, action: t.data.action } : r;
  });
}