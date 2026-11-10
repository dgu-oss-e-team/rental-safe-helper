// @ts-check
/**
 * 규칙 id + 상태 + 역할 가명으로 RiskResult 한 건을 만든다.
 * 문구는 YAML에서 가져오고, {owner} 같은 자리에 역할 가명을 채운다.
 */

import { ok, fail, ERROR_CODE } from '../../shared/document-model.js';
import { getRiskRules } from './risk-rules.js';

/** 읽지 못한 값을 화면에 표시할 때 쓰는 문자 */
const EMPTY = '—';

/**
 * @param {string} ruleId
 * @param {string} status  RISK_STATUS 값
 * @param {{ aliases?: Record<string, string>, values?: { left?: string | null, right?: string | null } }} [options]
 *   aliases: 문구의 {자리}에 들어갈 역할 가명 (예: { owner: '[Owner_A]' })
 *   values:  화면 근거 칸에 보여 줄 실제 값. 프롬프트에는 들어가지 않는다.
 * @returns {import('../../shared/document-model.js').Result<import('../../shared/document-model.js').RiskResult>}
 */
export function buildRiskResult(ruleId, status, { aliases = {}, values } = {}) {
  const rules = getRiskRules();
  if (!rules.ok) return rules;

  const rule = rules.data[ruleId];
  const text = rule?.results?.[status];
  if (!rule || !text) {
    return fail(ERROR_CODE.INVALID_INPUT, `No text for rule ${ruleId} with status ${status}.`);
  }

  /** @param {string} s */
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, key) => aliases[key] ?? 'an unidentified person');

  /** @type {import('../../shared/document-model.js').RiskResult} */
  const result = {
    ruleId,
    status,
    title: rule.title,
    explanation: fill(text.explanation),
    action: fill(text.action),
  };

  if (values && rule.evidence) {
    result.evidence = {
      left: { label: rule.evidence.left, value: values.left ?? EMPTY },
      right: { label: rule.evidence.right, value: values.right ?? EMPTY },
    };
  }
  return ok(result);
}