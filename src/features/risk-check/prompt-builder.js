// @ts-check
/**
 * AI 상담용 프롬프트를 만든다.
 *
 * 규칙
 *  - 프롬프트에는 PART 4가 만든 "마스킹 완료 텍스트"와 범례만 넣는다. 원본 개인정보를 다시 넣지 않는다.
 *  - 위험 설명의 evidence(화면용 실제 값)는 넣지 않는다. 제목과 설명만 넣는다.
 *  - 사용자가 이름 가림을 해제하면 그 가명은 범례에서 빠진다. 그런데 위험 설명에는 가명이 남아 있으므로,
 *    범례에 없는 가명은 역할 이름("the landlord" 등)으로 바꿔서 넣는다. (AI가 모르는 가명이 남지 않게)
 */

import { ok, fail, ERROR_CODE, MASKING_PURPOSE, RISK_STATUS } from '../../shared/document-model.js';
import { getRecommendedQuestions } from './recommended-questions.js';

/** @typedef {import('../../shared/document-model.js').RiskResult} RiskResult */

const STATUS_LABEL = {
  [RISK_STATUS.STOP]: 'STOP',
  [RISK_STATUS.CHECK]: 'CHECK',
  [RISK_STATUS.NO_FLAG]: 'NO FLAG',
  [RISK_STATUS.UNVERIFIABLE]: 'UNVERIFIABLE',
};

/** 가명 "[Landlord_B]"의 역할 부분 → 풀어 쓴 말 (PART 4 alias-manager의 ROLE_LABEL과 같은 이름) */
const ROLE_PHRASE = {
  Owner: 'the owner',
  Landlord: 'the landlord',
  Tenant: 'the tenant',
  AccountHolder: 'the account holder',
};

/** 역할을 알 수 없을 때 */
const UNKNOWN_ROLE_PHRASE = 'a person';

/** "[Landlord_B]" 같은 역할 가명 */
const ALIAS_PATTERN = /\[([A-Za-z]+)_[A-Z]\]/g;

/**
 * 범례에 없는 가명을 역할 이름으로 바꾼다.
 *  - "[Landlord_B] signs" → "The landlord signs" (문장 맨 앞이면 대문자)
 *  - "[Owner_A] and [Owner_E]" → "the owners" (같은 역할이 이어지면 복수로 합친다. 쉼표·셋 이상도 같다)
 * @param {string} text
 * @param {Record<string, string> | undefined} legend
 */
export function replaceUnlistedAliases(text, legend) {
  const known = legend ?? {};
  const replaced = text.replace(ALIAS_PATTERN, (alias, role, offset, whole) => {
    if (alias in known) return alias;
    const phrase = ROLE_PHRASE[/** @type {keyof typeof ROLE_PHRASE} */ (role)] ?? UNKNOWN_ROLE_PHRASE;
    const startsSentence = offset === 0 || /[.!?]\s+$/.test(whole.slice(0, offset));
    return startsSentence ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
  });
  // "the owner and the owner", "the owner, the owner and the owner" → "the owners"
  return replaced.replace(/\b([Tt]he) ([a-z ]+?)(?:(?:, and | and |, )the \2\b)+/g, (_, the, noun) => `${the} ${noun}s`);
}

/**
 * AI 상담용 프롬프트를 만든다.
 * @param {{ purpose: string, riskResults: RiskResult[], maskedText: Record<string, string>,
 *           legend: Record<string, string> }} input
 */
export function buildPrompt({ purpose, riskResults, maskedText, legend }) {
  const questions = getRecommendedQuestions(purpose);
  if (!questions) {
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
    for (const r of riskResults) {
      const title = replaceUnlistedAliases(r.title, legend);
      const explanation = replaceUnlistedAliases(r.explanation, legend);
      lines.push(`- [${STATUS_LABEL[r.status] ?? r.status}] ${title}: ${explanation}`);
    }
    lines.push('');
  }

  lines.push('## Documents (masked)');
  for (const [documentId, text] of Object.entries(maskedText)) {
    lines.push(`### ${documentId}`, text, '');
  }

  lines.push('## Questions');
  for (const q of questions) lines.push(`- ${q}`);
  lines.push('', 'Please answer in English.');

  return ok(lines.join('\n'));
}