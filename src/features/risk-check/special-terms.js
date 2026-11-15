// @ts-check
/**
 * 위험 특약 문구 점검 (RISKY_SPECIAL_TERM).
 * 계약서 특약(contract.specialTerms)에서 임차인에게 불리할 수 있는 문구를 키워드로 찾는다.
 *
 * 규칙 (docs/INTERFACES.md 5번 null 규칙)
 *  - specialTerms가 null(특약 칸을 못 찾았거나 못 읽음)이면 "없음"이 아니라 UNVERIFIABLE
 *  - specialTerms가 [](특약 칸을 읽었는데 비어 있음)이면 NO_FLAG
 *  - 키워드에 걸린 특약이 하나라도 있으면 CHECK (STOP이 아니다: 키워드만으로는 불리한지 확정할 수 없다)
 *  - 읽었는데 키워드에 걸리는 특약이 없으면 NO_FLAG ("안전하다"는 뜻이 아니다)
 *
 * 개인정보
 *  - 설명(explanation)과 행동 안내(action)에는 특약 원문을 넣지 않는다. 특약 문장에 실제 이름이 있을 수 있고,
 *    설명은 AI 프롬프트에 그대로 들어가기 때문이다. 어떤 문구가 걸렸는지는 키워드 파일의 label로 알려 준다.
 *  - 걸린 특약 원문은 화면 근거 칸(evidence)에만 넣는다. 근거 칸은 프롬프트에 들어가지 않는다.
 *
 * 키워드는 src/config/rules/special-term-keywords.yaml 에 있다. 문구는 risk-rules.yaml 의 RISKY_SPECIAL_TERM.
 */

import { load } from 'js-yaml';
// @ts-ignore  Vite의 "?raw" 가져오기: 파일 내용을 문자열로 읽는다 (브라우저와 Vitest 모두 지원)
import keywordsText from '../../config/rules/special-term-keywords.yaml?raw';
import { ok, fail, ERROR_CODE, RISK_STATUS } from '../../shared/document-model.js';
import { buildRiskResult } from './risk-explanations.js';

const RULE_ID = 'RISKY_SPECIAL_TERM';

/** 근거 칸에 보여 줄 특약 한 줄의 최대 글자 수 (너무 길면 화면이 길어진다) */
const MAX_EVIDENCE_CHARS = 200;

/**
 * @typedef {Object} KeywordCategory
 * @property {string} id
 * @property {string} label
 * @property {string} reason
 * @property {string[][][]} expressions  키워드 하나 = 칸(&)들의 목록, 칸 하나 = 대안(|)들의 목록
 */

/** 비교할 때 무시하는 글자: 띄어쓰기, 가운뎃점, 마침표, 쉼표 */
const IGNORED = /[\s·ㆍ.,]/g;

/** @param {string} text */
export function normalizeTerm(text) {
  return text.normalize('NFC').replace(IGNORED, '');
}

/**
 * 키워드 한 줄("전입|확정일자 & 금지|불가")을 칸과 대안으로 나눈다. 빈 칸이 있으면 null.
 * @param {unknown} expression
 * @returns {string[][] | null}
 */
function parseExpression(expression) {
  if (typeof expression !== 'string') return null;
  const parts = expression.split('&').map((part) =>
    part
      .split('|')
      .map((alt) => normalizeTerm(alt))
      .filter((alt) => alt !== ''),
  );
  return parts.every((alts) => alts.length > 0) ? parts : null;
}

/**
 * 키워드 YAML 문자열을 검사해서 목록으로 바꾼다.
 * @param {string} text
 * @returns {import('../../shared/document-model.js').Result<KeywordCategory[]>}
 */
export function parseSpecialTermKeywords(text) {
  let doc;
  try {
    doc = load(text);
  } catch {
    return fail(ERROR_CODE.INVALID_INPUT, 'Special term keywords file is not valid YAML.');
  }

  const categories = /** @type {any} */ (doc)?.categories;
  if (!categories || typeof categories !== 'object' || Object.keys(categories).length === 0) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Special term keywords file has no "categories" section.');
  }

  /** @type {KeywordCategory[]} */
  const result = [];
  for (const [id, category] of Object.entries(categories)) {
    const { label, reason, keywords } = /** @type {any} */ (category) ?? {};
    if (typeof label !== 'string' || typeof reason !== 'string' || !Array.isArray(keywords) || keywords.length === 0) {
      return fail(ERROR_CODE.INVALID_INPUT, `Special term category ${id} needs a label, a reason and keywords.`);
    }
    const expressions = [];
    for (const keyword of keywords) {
      const parsed = parseExpression(keyword);
      if (!parsed) return fail(ERROR_CODE.INVALID_INPUT, `Special term category ${id} has an empty keyword.`);
      expressions.push(parsed);
    }
    result.push({ id, label: label.trim(), reason: reason.trim(), expressions });
  }
  return ok(result);
}

let cached = null;

/** 키워드 파일을 한 번만 읽어서 재사용한다. */
export function getSpecialTermKeywords() {
  if (!cached) cached = parseSpecialTermKeywords(keywordsText);
  return cached;
}

/**
 * 특약 한 덩어리가 이 분류의 키워드에 걸리는가.
 * @param {string} normalized  normalizeTerm()을 거친 문장
 * @param {KeywordCategory} category
 */
function matchesCategory(normalized, category) {
  return category.expressions.some((parts) => parts.every((alts) => alts.some((alt) => normalized.includes(alt))));
}

/**
 * 특약 목록에서 키워드에 걸린 분류와 특약 줄 번호를 찾는다.
 * PDF·OCR은 한 문장이 두 줄로 갈라질 수 있어서, 한 줄로 안 걸리면 바로 다음 줄과 이어 붙여서 한 번 더 본다.
 * @param {string[]} terms
 * @param {KeywordCategory[]} categories
 * @returns {{ matched: KeywordCategory[], indexes: number[] }}
 */
export function findRiskyTerms(terms, categories) {
  const normalized = terms.map(normalizeTerm);
  const matched = [];
  const indexes = new Set();

  for (const category of categories) {
    let found = false;
    normalized.forEach((current, i) => {
      if (matchesCategory(current, category)) {
        found = true;
        indexes.add(i);
        return;
      }
      const next = normalized[i + 1];
      if (next !== undefined && !matchesCategory(next, category) && matchesCategory(current + next, category)) {
        found = true;
        indexes.add(i);
        indexes.add(i + 1);
      }
    });
    if (found) matched.push(category);
  }
  return { matched, indexes: [...indexes].sort((a, b) => a - b) };
}

/** @param {string} text */
const clip = (text) => (text.length > MAX_EVIDENCE_CHARS ? `${text.slice(0, MAX_EVIDENCE_CHARS)}…` : text);

/** @param {number} count */
const termCountText = (count) => `${count} special term${count === 1 ? '' : 's'} read`;

/**
 * 위험 특약 점검.
 * @param {any} fields  extractFields() 결과
 * @returns {import('../../shared/document-model.js').Result<import('../../shared/document-model.js').RiskResult>}
 */
export function assessSpecialTerms(fields) {
  const keywords = getSpecialTermKeywords();
  if (!keywords.ok) return keywords;

  const terms = fields?.contract?.specialTerms;
  // 특약 칸을 못 찾았거나 형식이 이상하면 "특약이 없다"가 아니라 확인 불가
  if (!Array.isArray(terms)) {
    return buildRiskResult(RULE_ID, RISK_STATUS.UNVERIFIABLE, { values: { left: null, right: null } });
  }
  if (terms.length === 0) {
    return buildRiskResult(RULE_ID, RISK_STATUS.NO_FLAG, { variant: 'no_terms', values: { left: termCountText(0), right: null } });
  }

  const texts = terms.filter((t) => typeof t === 'string' && t.trim() !== '');
  // 읽은 특약이 하나도 글자가 아니면(깨진 값) 읽은 것으로 보지 않는다
  if (texts.length === 0) {
    return buildRiskResult(RULE_ID, RISK_STATUS.UNVERIFIABLE, { values: { left: null, right: null } });
  }

  const { matched, indexes } = findRiskyTerms(texts, keywords.data);
  if (matched.length === 0) {
    return buildRiskResult(RULE_ID, RISK_STATUS.NO_FLAG, { values: { left: termCountText(texts.length), right: null } });
  }

  return buildRiskResult(RULE_ID, RISK_STATUS.CHECK, {
    // label·reason은 키워드 파일에 있는 문구다. 특약 원문이 아니므로 설명에 넣어도 된다.
    params: {
      matched: matched.map((c) => c.label).join('; '),
      reasons: matched.map((c) => c.reason).join(' '),
    },
    // 특약 원문(실제 이름이 있을 수 있음)은 화면 근거 칸에만 넣는다.
    values: { left: termCountText(texts.length), right: indexes.map((i) => clip(texts[i].trim())).join(' / ') },
  });
}
