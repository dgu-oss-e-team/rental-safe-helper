// @ts-check
/**
 * 위험 특약 문구 점검 (RISKY_SPECIAL_TERM).
 * 계약서 특약(contract.specialTerms)에서 임차인에게 불리할 수 있는 문구를 키워드로 찾는다.
 *
 * 규칙 (docs/INTERFACES.md 5번 null 규칙)
 *  - specialTerms가 null(특약 칸을 못 찾았거나 못 읽음)이면 "없음"이 아니라 UNVERIFIABLE
 *  - specialTerms가 [](특약 칸을 읽었는데 비어 있음)이면 NO_FLAG
 *  - 키워드에 걸린 특약이 하나라도 있으면 CHECK (키워드만으로는 불리한지 확정할 수 없다)
 *  - 단, severity가 STOP인 분류(전입신고·확정일자 금지)는 부정문("금지하지 않는다")이 아닌 특약에 걸리면 STOP (#278)
 *    부정문은 negation 문구로 알아보고, 그런 특약만 걸렸으면 CHECK로 남긴다.
 *  - 읽었는데 키워드에 걸리는 특약이 없으면 NO_FLAG ("안전하다"는 뜻이 아니다)
 *
 * 개인정보
 *  - 설명(explanation)과 행동 안내(action)에는 특약 원문을 넣지 않는다. 특약 문장에 실제 이름이 있을 수 있고,
 *    설명은 AI 프롬프트에 그대로 들어가기 때문이다. 어떤 문구가 걸렸는지는 키워드 파일의 label로 알려 준다.
 *  - 걸린 특약 원문은 화면 근거 칸(evidence)에만 넣는다. 근거 칸은 프롬프트에 들어가지 않는다.
 *    근거 칸에는 "Special term 3: 문구"처럼 몇 번째 특약인지 같이 보여 준다. (#278)
 *
 * 특약 나누기 (#278)
 *  - specialTerms는 줄 목록이다. 번호로 시작하는 줄("1.", "2)", "(3)", "①")은 새 특약의 시작이라서, 앞뒤 줄과 이어 붙여 보지 않는다.
 *    ("1. 중개보수는 임차인이 …"의 "임차인"과 "2. … 도배 비용 …"이 합쳐져 걸리는 오탐을 막는다)
 *  - 번호 없이 줄만 넘어간 문장은 앞 줄이 마침표 등으로 끝나지 않았을 때만 이어서 본다.
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
 * @property {string[]} except  예외 문구(띄어쓰기 등을 없앤 상태). 키워드에 걸린 글에 이 문구가 있으면 이 분류는 걸지 않는다.
 * @property {'STOP' | 'CHECK'} severity  걸렸을 때의 상태. 파일에 없으면 CHECK
 * @property {string[]} negation  부정문 문구(띄어쓰기 등을 없앤 상태). severity가 STOP인 분류에서, 걸린 글에 이 문구가 있으면 STOP이 아니라 CHECK로 남긴다.
 * @property {RegExp[]} stopPatterns  severity가 STOP인 분류에서 STOP으로 볼 구절의 모양(정규식, 띄어쓰기 없앤 글에 적용). 비어 있으면 키워드에 걸린 구절이면 STOP
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
    // except는 선택 항목이다. 있으면 글자 목록이어야 하고, 비교용으로 다듬은 뒤 비어 있으면 안 된다.
    const rawExcept = /** @type {any} */ (category).except ?? [];
    if (!Array.isArray(rawExcept)) {
      return fail(ERROR_CODE.INVALID_INPUT, `Special term category ${id} has an except that is not a list.`);
    }
    const except = [];
    for (const phrase of rawExcept) {
      const normalized = typeof phrase === 'string' ? normalizeTerm(phrase) : '';
      if (normalized === '') return fail(ERROR_CODE.INVALID_INPUT, `Special term category ${id} has an empty except phrase.`);
      except.push(normalized);
    }
    // severity는 선택이다. STOP 또는 CHECK만 쓸 수 있고, 없으면 CHECK다. (#278)
    const rawSeverity = /** @type {any} */ (category).severity ?? 'CHECK';
    if (rawSeverity !== 'STOP' && rawSeverity !== 'CHECK') {
      return fail(ERROR_CODE.INVALID_INPUT, `Special term category ${id} has a severity that is not STOP or CHECK.`);
    }
    // negation도 선택이다. except와 같은 규칙(글자 목록, 다듬은 뒤 비어 있으면 안 됨)이다.
    const rawNegation = /** @type {any} */ (category).negation ?? [];
    if (!Array.isArray(rawNegation)) {
      return fail(ERROR_CODE.INVALID_INPUT, `Special term category ${id} has a negation that is not a list.`);
    }
        const negation = [];
    for (const phrase of rawNegation) {
      const normalized = typeof phrase === 'string' ? normalizeTerm(phrase) : '';
      if (normalized === '') return fail(ERROR_CODE.INVALID_INPUT, `Special term category ${id} has an empty negation phrase.`);
      negation.push(normalized);
    }
    // stop_patterns도 선택이다. 글자 목록이어야 하고, 올바른 정규식이어야 한다. (#336 리뷰)
    const rawStopPatterns = /** @type {any} */ (category).stop_patterns ?? [];
    if (!Array.isArray(rawStopPatterns)) {
      return fail(ERROR_CODE.INVALID_INPUT, `Special term category ${id} has a stop_patterns that is not a list.`);
    }
    const stopPatterns = [];
    for (const source of rawStopPatterns) {
      if (typeof source !== 'string' || source === '') {
        return fail(ERROR_CODE.INVALID_INPUT, `Special term category ${id} has an empty stop pattern.`);
      }
      try {
        stopPatterns.push(new RegExp(source));
      } catch {
        return fail(ERROR_CODE.INVALID_INPUT, `Special term category ${id} has a stop pattern that is not a valid regular expression.`);
      }
    }
    result.push({ id, label: label.trim(), reason: reason.trim(), expressions, except, severity: rawSeverity, negation, stopPatterns });
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
 * 키워드만 보고 걸리는가. (예외 문구는 보지 않는다)
 * @param {string} normalized  normalizeTerm()을 거친 문장
 * @param {KeywordCategory} category
 */
function matchesKeywords(normalized, category) {
  return category.expressions.some((parts) => parts.every((alts) => alts.some((alt) => normalized.includes(alt))));
}

/**
 * 예외 문구(except)가 들어 있는가. 있으면 불리하지 않은 문장일 가능성이 커서 이 분류는 걸지 않는다.
 * @param {string} normalized  normalizeTerm()을 거친 문장
 * @param {KeywordCategory} category
 */
function hasException(normalized, category) {
  return category.except.some((phrase) => normalized.includes(phrase));
}

/**
 * 예외 문구(except)가 두 줄의 경계에 걸쳐 있는가. (앞줄 끝 + 뒷줄 시작에 걸쳐 있을 때만 true)
 * 예외 문구가 앞줄 또는 뒷줄 안에 통째로 있으면 false다. 그 문구는 그 줄 자신의 일이라서,
 * 마침표 없이 이어진 옆 줄의 위험 특약까지 가려 버리면 안 되기 때문이다.
 * @param {string} left   앞줄 (normalizeTerm()을 거친 문장)
 * @param {string} right  뒷줄 (normalizeTerm()을 거친 문장)
 * @param {KeywordCategory} category
 */
function hasExceptionAcross(left, right, category) {
  const joined = left + right;
  return category.except.some((phrase) => {
    for (let at = joined.indexOf(phrase); at !== -1; at = joined.indexOf(phrase, at + 1)) {
      if (at < left.length && at + phrase.length > left.length) return true;
    }
    return false;
  });
}

/**
 * 특약 한 덩어리가 이 분류에 걸리는가. (키워드에 걸리고, 예외 문구가 없을 때)
 * @param {string} normalized  normalizeTerm()을 거친 문장
 * @param {KeywordCategory} category
 */
function matchesCategory(normalized, category) {
  return matchesKeywords(normalized, category) && !hasException(normalized, category);
}

/** 문장이 끝난 줄인가. 끝나지 않았으면 다음 줄이 이어지는 문장일 수 있다. */
const SENTENCE_END = /[.!?。…]\s*$/;

/**
 * 줄 맨 앞의 특약 번호: "1.", "2)", "(3)", "①". (#278)
 * "2025. 3. 5."나 "3.5%"처럼 번호가 아닌 숫자는 걸리지 않게, 숫자는 1~2자리이고 "." 바로 뒤에 숫자가 오지 않아야 한다.
 */
const NUMBER_MARKER = /^\s*(?:(\d{1,2})\s*[.)](?!\d)(?!\s*\d{1,4}\s*\.)|\((\d{1,2})\)|([①-⑳]))/;

/**
 * 줄 맨 앞의 특약 번호를 숫자로 돌려준다. 번호로 시작하지 않으면 null.
 * @param {string} text
 * @returns {number | null}
 */
function markerNumber(text) {
  const m = NUMBER_MARKER.exec(text);
  if (!m) return null;
  if (m[3]) return m[3].charCodeAt(0) - 0x2460 + 1;
  return Number(m[1] ?? m[2]);
}

/**
 * 두 줄을 이어서 한 문장으로 볼 수 있는가. (#278)
 * 뒷줄이 번호로 시작하면 새 특약이고, 앞줄이 문장을 끝냈으면 뒷줄은 다른 문장이다.
 * @param {string} left
 * @param {string} right
 */
function canJoin(left, right) {
  return markerNumber(right) === null && !SENTENCE_END.test(left.trim());
}

/**
 * 글 안에 문구(예: 부정문 negation) 중 하나라도 있는가.
 * @param {string} text  normalizeTerm()을 거친 글 (두 줄을 이어 붙인 글도 된다)
 * @param {string[]} phrases
 */
const hasPhrase = (text, phrases) => phrases.some((phrase) => text.includes(phrase));

/**
 * 구절을 나누는 곳: 쉼표, 문장 끝, "~하며/~하고/~지만" 같은 이음말.
 * ("전입신고"의 "고"처럼 단어 속 글자로는 나누지 않도록, 이음말은 뒤에 띄어쓰기가 올 때만 본다) (#336 리뷰)
 */
const CLAUSE_SPLIT = /[,;，、]|[.!?。](?=\s|$)|(?:하며|이며|으며|하고|이고|지만|으나|면서)(?=\s)/;

/**
 * 특약 한 덩어리(원문)가 STOP인가. 구절마다 따로 본다:
 * 구절 안에 stop_patterns 모양이 있고, 같은 구절에 부정문(negation)이 없을 때만 STOP이다.
 * 다른 구절의 "~하지 않"은 영향을 주지 않는다. (#336 리뷰)
 * @param {string} rawText  normalizeTerm()을 거치지 않은 글 (구절을 나누려면 쉼표·마침표가 필요하다)
 * @param {KeywordCategory} category
 */
function isStopTerm(rawText, category) {
  return rawText.split(CLAUSE_SPLIT).some((clause) => {
    const n = normalizeTerm(clause);
    if (n === '') return false;
    const risky =
      category.stopPatterns.length > 0
        ? category.stopPatterns.some((re) => re.test(n))
        : matchesKeywords(n, category);
    return risky && !hasPhrase(n, category.negation);
  });
}

/**
 * 특약 목록에서 키워드에 걸린 분류와 특약 줄 번호를 찾는다.
 * PDF·OCR은 한 문장이 두 줄로 갈라질 수 있어서, 한 줄로 안 걸리면 바로 다음 줄과 이어 붙여서 한 번 더 본다.
 * 단, 뒷줄이 번호로 시작하거나(새 특약) 앞줄이 문장을 끝냈으면 이어 붙이지 않는다. (#278)
 * 예외 문구(except)도 같은 단위로 본다: 한 줄 안에 있거나, 문장이 끝나지 않은 줄과 다음 줄을 이어 붙인 글 안에 있으면
 * 그 분류는 걸지 않는다. (문장이 끝난 줄은 다음 줄과 이어 보지 않는다. 서로 다른 특약의 예외 문구가 섞이지 않게)
 * stopIds: severity가 STOP인 분류 중, 걸린 특약에 STOP 구절(구절 단위로 판단)이 있는 분류의 id (#278, #336)
 * @param {string[]} terms
 * @param {KeywordCategory[]} categories
 * @returns {{ matched: KeywordCategory[], indexes: number[], stopIds: string[] }}
 */
export function findRiskyTerms(terms, categories) {
  const normalized = terms.map(normalizeTerm);
  const groups = groupTerms(terms);
  const matched = [];
  const indexes = new Set();
  const stopIds = [];

  for (const category of categories) {
    const hits = new Set(); // 이 분류에 걸린 줄 번호
    normalized.forEach((current, i) => {
      const next = normalized[i + 1];
      if (matchesKeywords(current, category)) {
        // 예외 문구가 두 줄에 걸쳐 있을 수 있다 ("…현금 지급은" / "받지 않는다.", "…임차인 여부와" / "관계없이 …").
        // 문장이 끝난 줄은 이어 보지 않고, 예외 문구가 옆 줄 안에 통째로 있는 것은 인정하지 않는다. (경계에 걸친 것만)
        const continues = next !== undefined && canJoin(terms[i], terms[i + 1]);
        const prev = normalized[i - 1];
        const followsPrev = prev !== undefined && canJoin(terms[i - 1], terms[i]);
        const excepted =
          hasException(current, category) ||
          (continues && hasExceptionAcross(current, next, category)) ||
          (followsPrev && hasExceptionAcross(prev, current, category));
        if (!excepted) hits.add(i);
        return;
      }
      if (
        next !== undefined &&
        canJoin(terms[i], terms[i + 1]) &&
        !matchesKeywords(next, category) &&
        matchesCategory(current + next, category)
      ) {
        hits.add(i);
        hits.add(i + 1);
      }
    });

    if (hits.size === 0) continue;
    matched.push(category);
    hits.forEach((i) => indexes.add(i));

    // STOP: 걸린 줄이 들어 있는 특약(번호·문장 단위로 묶은 것) 중 하나라도 STOP 구절을 가지면 STOP (#336)
    if (
      category.severity === 'STOP' &&
      groups.some(
        (g) => g.indexes.some((i) => hits.has(i)) && isStopTerm(g.indexes.map((i) => terms[i]).join(' '), category),
      )
    ) {
      stopIds.push(category.id);
    }
  }
  return { matched, indexes: [...indexes].sort((a, b) => a - b), stopIds };
}

/**
 * 줄을 특약 단위로 묶고, 각 특약에 번호를 붙인다. (#278)
 *  - 줄 목록에 번호로 시작하는 줄이 있으면, 번호로 시작하는 줄이 새 특약의 시작이다. (번호 없는 줄은 앞 특약에 이어진다)
 *  - 번호가 하나도 없으면, 앞 줄이 문장을 끝냈을 때 새 특약이 시작된다.
 *  - 번호로 시작하는 특약은 계약서에 적힌 번호를 그대로 쓴다. 번호가 없는 특약은 몇 번째인지 센 값을 쓴다.
 *    (번호가 있는 목록 안의 번호 없는 앞머리 문장은 번호 없이(null) 보여 준다. 계약서의 번호와 겹치지 않게)
 * @param {string[]} texts
 * @returns {{ label: number | null, indexes: number[] }[]}
 */
export function groupTerms(texts) {
  const numbered = texts.some((t) => markerNumber(t) !== null);
  /** @type {{ label: number | null, indexes: number[] }[]} */
  const groups = [];
  texts.forEach((text, i) => {
    const n = markerNumber(text);
    const startsNew = i === 0 || (numbered ? n !== null : SENTENCE_END.test(texts[i - 1].trim()));
    if (startsNew) groups.push({ label: n ?? (numbered ? null : groups.length + 1), indexes: [i] });
    else groups[groups.length - 1].indexes.push(i);
  });
  return groups;
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

  const { matched, indexes, stopIds } = findRiskyTerms(texts, keywords.data);
  if (matched.length === 0) {
    return buildRiskResult(RULE_ID, RISK_STATUS.NO_FLAG, { values: { left: termCountText(texts.length), right: null } });
  }

  // 걸린 줄을 특약 단위로 묶어서 "Special term 3: 문구"로 보여 준다. (#278)
  const hit = new Set(indexes);
  const evidence = groupTerms(texts)
    .map((group) => {
      // 줄 맨 앞의 번호("3.")는 "Special term 3"에 이미 있어서 문구에서는 뺀다
      const lines = group.indexes.filter((i) => hit.has(i)).map((i) => texts[i].replace(NUMBER_MARKER, '').trim());
      if (lines.length === 0) return null;
      const text = clip(lines.join(' '));
      return group.label === null ? text : `Special term ${group.label}: ${text}`;
    })
    .filter((line) => line !== null);

  return buildRiskResult(RULE_ID, stopIds.length > 0 ? RISK_STATUS.STOP : RISK_STATUS.CHECK, {
    // label·reason은 키워드 파일에 있는 문구다. 특약 원문이 아니므로 설명에 넣어도 된다.
    params: {
      matched: matched.map((c) => c.label).join('; '),
      reasons: matched.map((c) => c.reason).join(' '),
    },
    // 특약 원문(실제 이름이 있을 수 있음)은 화면 근거 칸에만 넣는다.
    values: { left: termCountText(texts.length), right: evidence.join(' / ') },
  });
}
