// @ts-check
/**
 * 위험 점검 규칙(YAML)을 읽어서 JS 객체로 제공한다.
 * 규칙 파일: src/config/rules/risk-rules.yaml
 * 판정 로직은 여기에 없다 (compare-documents.js, assess-risks.js).
 */

import { load } from 'js-yaml';
// @ts-ignore  Vite의 "?raw" 가져오기: 파일 내용을 문자열로 읽는다 (브라우저와 Vitest 모두 지원)
import rulesText from '../../config/rules/risk-rules.yaml?raw';
import { ok, fail, ERROR_CODE, RISK_STATUS } from '../../shared/document-model.js';

/**
 * @typedef {Object} RuleText
 * @property {string} explanation
 * @property {string} action
 *
 * @typedef {Object} Rule
 * @property {string} title
 * @property {{ left: string, right: string }} [evidence]
 * @property {Record<string, RuleText>} results  상태별 문구
 */

/**
 * YAML 문자열을 규칙 객체로 바꾸고 형식을 검사한다.
 * @param {string} text
 * @returns {import('../../shared/document-model.js').Result<Record<string, Rule>>}
 */
export function parseRiskRules(text) {
  let doc;
  try {
    doc = load(text);
  } catch {
    return fail(ERROR_CODE.INVALID_INPUT, 'Risk rules file is not valid YAML.');
  }

  const rules = /** @type {any} */ (doc)?.rules;
  if (!rules || typeof rules !== 'object') {
    return fail(ERROR_CODE.INVALID_INPUT, 'Risk rules file has no "rules" section.');
  }

  const validStatuses = Object.values(RISK_STATUS);
  for (const [ruleId, rule] of Object.entries(rules)) {
    if (typeof rule?.title !== 'string' || !rule.results || typeof rule.results !== 'object') {
      return fail(ERROR_CODE.INVALID_INPUT, `Rule ${ruleId} needs a title and results.`);
    }
    for (const [status, text] of Object.entries(rule.results)) {
      if (!validStatuses.includes(status)) {
        return fail(ERROR_CODE.INVALID_INPUT, `Rule ${ruleId} has an unknown status.`);
      }
      if (typeof text?.explanation !== 'string' || typeof text?.action !== 'string') {
        return fail(ERROR_CODE.INVALID_INPUT, `Rule ${ruleId} (${status}) needs explanation and action.`);
      }
    }
  }
  return ok(rules);
}

let cached = null;

/** 규칙 파일을 한 번만 읽어서 재사용한다. */
export function getRiskRules() {
  if (!cached) cached = parseRiskRules(rulesText);
  return cached;
}