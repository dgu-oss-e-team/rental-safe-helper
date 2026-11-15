// @ts-check
/**
 * PART 3. 사기 위험 점검 및 AI 상담 프롬프트
 * 담당: docs/OWNERS.md 참고
 *
 * 공개 함수
 *   assessRisks(fields, personGroups)                          → Result<RiskResult[]>
 *   buildPrompt({ purpose, riskResults, maskedText, legend })  → Result<string>
 *   getRecommendedQuestions(purpose)                           → string[] | null
 *
 * 규칙: 프롬프트에는 PART 4가 만든 "마스킹 완료 텍스트"와 범례만 넣는다. 원본 개인정보를 다시 넣지 않는다.
 *
 * 구현 상태
 *   완료: 소유자·임대인 / 예금주·임대인 / 소재지 비교 (compare-documents.js)
 *         신탁, 압류·가압류, 근저당, 최근 소유권 이전 (assess-risks.js)
 *         위험 특약 문구 (special-terms.js, 키워드는 src/config/rules/special-term-keywords.yaml)
 *         프롬프트 (prompt-builder.js), 추천 질문 (recommended-questions.js)
 *   TODO(PART 3): 위험 결과 카드 UI. 값이 없으면 반드시 UNVERIFIABLE.
 */

import { ok, fail, ERROR_CODE } from '../../shared/document-model.js';
import { compareDocuments } from './compare-documents.js';
import { assessRegistryRisks } from './assess-risks.js';
import { assessSpecialTerms } from './special-terms.js';

export { buildPrompt } from './prompt-builder.js';
export { getRecommendedQuestions } from './recommended-questions.js';

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

  return ok([...compared.data, ...registryRisks.data, specialTerms.data]);
}