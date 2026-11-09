// @ts-check
/**
 * PART 3. 사기 위험 점검 및 AI 상담 프롬프트
 * 담당: docs/OWNERS.md 참고
 *
 * 공개 함수
 *   assessRisks(fields, personGroups)                          → Result<RiskResult[]>
 *   buildPrompt({ purpose, riskResults, maskedText, legend })  → Result<string>
 *
 * 규칙: 프롬프트에는 PART 4가 만든 "마스킹 완료 텍스트"와 범례만 넣는다. 원본 개인정보를 다시 넣지 않는다.
 *
 * TODO(PART 3): src/config/rules/의 YAML 규칙으로 실제 점검 구현 (소유자·소재지·예금주 비교, 신탁, 압류,
 *               근저당, 최근 소유권 이전, 위험 특약). 값이 없으면 반드시 UNVERIFIABLE.
 *               추천 질문은 recommended-questions.js로 분리.
 */

 /* 구현 상태
 *   완료: 소유자·임대인 / 예금주·임대인 / 소재지 비교 (compare-documents.js)
 *   TODO(PART 3): 신탁, 압류, 근저당, 최근 소유권 이전 (assess-risks.js), 위험 특약,
 *                 추천 질문(recommended-questions.js)·프롬프트(prompt-builder.js) 분리.
 *   값이 없으면 반드시 UNVERIFIABLE.
*/

import { ok, fail, ERROR_CODE, MASKING_PURPOSE, RISK_STATUS } from '../../shared/document-model.js';
import { compareDocuments } from './compare-documents.js';

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

  // TODO(PART 3): 신탁·압류·근저당·소유권 이전 점검(#11)을 여기에 이어 붙인다.
  return ok([...compared.data]);
}

/** 목적별 추천 질문 (TODO(PART 3): 팀이 HUG 안내 자료를 참고해 다듬기) */
const RECOMMENDED_QUESTIONS = {
  [MASKING_PURPOSE.CLAUSE_EXPLANATION]: [
    'Explain each section of these documents and the legal terms in simple English.',
  ],
  [MASKING_PURPOSE.FRAUD_CHECK]: [
    'Based on the check results, which risks should I resolve before signing?',
    'Is the mortgage excessive compared to my deposit?',
  ],
  [MASKING_PURPOSE.CONTRACT_EXPLANATION]: [
    'Summarize the deposit, rent, contract period, and special terms, and point out anything unfavorable to me.',
  ],
};

const STATUS_LABEL = {
  [RISK_STATUS.STOP]: 'STOP',
  [RISK_STATUS.CHECK]: 'CHECK',
  [RISK_STATUS.NO_FLAG]: 'NO FLAG',
  [RISK_STATUS.UNVERIFIABLE]: 'UNVERIFIABLE',
};

/**
 * AI 상담용 프롬프트를 만든다.
 * @param {{ purpose: string, riskResults: RiskResult[], maskedText: Record<string, string>,
 *           legend: Record<string, string> }} input
 */
export function buildPrompt({ purpose, riskResults, maskedText, legend }) {
  if (!RECOMMENDED_QUESTIONS[purpose]) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Unknown purpose.');
  }
  if (!maskedText || Object.keys(maskedText).length === 0) {
    return fail(ERROR_CODE.MISSING_REQUIRED_FIELD, 'Masked text is missing.');
  }

  const isFraudCheck = purpose === MASKING_PURPOSE.FRAUD_CHECK;
  const lines = [
    'I am an international student in Korea checking housing documents before signing a lease.',
    'Personal information has been removed or replaced with role names.',
    '',
  ];

  if (isFraudCheck && legend && Object.keys(legend).length > 0) {
    lines.push('## Role legend');
    for (const [alias, meaning] of Object.entries(legend)) lines.push(`- ${alias} = ${meaning}`);
    lines.push('');
  }

  if (isFraudCheck && riskResults?.length) {
    lines.push('## Automatic check results');
    for (const r of riskResults) lines.push(`- [${STATUS_LABEL[r.status] ?? r.status}] ${r.title}: ${r.explanation}`);
    lines.push('');
  }

  lines.push('## Documents (masked)');
  for (const [documentId, text] of Object.entries(maskedText)) {
    lines.push(`### ${documentId}`, text, '');
  }

  lines.push('## Questions');
  for (const q of RECOMMENDED_QUESTIONS[purpose]) lines.push(`- ${q}`);
  lines.push('', 'Please answer in English.');

  return ok(lines.join('\n'));
}
