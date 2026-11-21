// @ts-check
/**
 * PART 5. 평가 지표 계산 (#251, 지도 교수님 피드백 ②)
 *
 * 정답표(tests/eval/truth/*.json)와 서비스 결과를 비교하는 순수 함수들이다. 서비스 코드는 부르지 않는다.
 * 실행은 tests/eval/run-eval.test.js (npm run eval)가 한다.
 *
 * 정답 항목 하나 = 서류에 나오는 개인정보 값 하나 (같은 서류에 같은 값이 여러 번 나와도 한 항목)
 *   - value:  서류에 적힌 그대로의 값
 *   - secret: AI 글에 남으면 안 되는 부분 (없으면 value). 주소는 시·군·구 뒤의 자세한 부분이다.
 *             사기 위험 확인 목적은 주소를 시·구까지 남기므로, 그 앞부분은 남아도 새는 것이 아니다.
 *             여러 개면 하나라도 보이면 "보임"이다.
 * 글자는 띄어쓰기·줄바꿈을 지우고 비교한다. 뒷자리가 *로 가려진 번호의 *는 뺀다.
 */

/** @typedef {{ type: string, value: string, secret?: string | string[] }} TruthItem */
/** @typedef {{ document: string, file: string, documentType: string, form: string, pii: TruthItem[] }} TruthDoc */

/** 띄어쓰기·줄바꿈을 지운다 */
export const compact = (/** @type {string} */ s) => String(s ?? '').replace(/\s+/g, '');

/**
 * 정답 항목에서 AI 글에 남으면 안 되는 글자들 (띄어쓰기 없앰, * 뺌)
 * @param {TruthItem} item
 * @returns {string[]}
 */
export function secretsOf(item) {
  const raw = item.secret ?? item.value;
  return (Array.isArray(raw) ? raw : [raw]).map((s) => compact(s).replace(/\*+/g, '')).filter((s) => s.length >= 2);
}

/**
 * 정답 항목이 글에 그대로 보이는지
 * @param {TruthItem} item
 * @param {string} text
 */
export function isVisible(item, text) {
  const haystack = compact(text);
  return secretsOf(item).some((s) => haystack.includes(s));
}

/**
 * 두 글자열에 함께 들어 있는 가장 긴 연속 글자 수
 * @param {string} a @param {string} b
 */
export function longestCommon(a, b) {
  let best = 0;
  /** @type {number[]} */
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/** 탐지 값의 이 비율 이상이 정답 값과 이어서 겹치면 "개인정보를 가린 것"으로 본다 */
export const MIN_OVERLAP = 0.5;

/**
 * 탐지 결과 하나가 어느 정답 항목과도 충분히 겹치지 않는지 (= 과잉 마스킹)
 * - 두 줄로 나뉜 주소는 조각으로 탐지된다 → 조각이 정답 값 안에 들어 있으면 겹침
 * - 표 옆 칸 글자가 붙은 주소("…가상로3길 2층")는 대부분이 정답이면 겹침,
 *   "…성동구 22층 공동주택(아파트)"처럼 시·구 말고는 옆 칸 글자면 과잉
 * 기준: 탐지 값(띄어쓰기 없앰)의 MIN_OVERLAP 이상이 한 정답 값과 이어서 같아야 한다.
 * @param {{ value?: string }} finding
 * @param {TruthItem[]} truth
 */
export function isFalsePositive(finding, truth) {
  const v = compact(finding.value ?? '').replace(/\*+/g, '');
  if (v.length < 2) return false;
  return !truth.some((t) => {
    const tv = compact(t.value).replace(/\*+/g, '');
    return tv.includes(v) || v.includes(tv) || longestCommon(v, tv) >= v.length * MIN_OVERLAP;
  });
}

/**
 * 비율 (분모가 0이면 null)
 * @param {number} n @param {number} d
 */
export const rate = (n, d) => (d === 0 ? null : n / d);

/** @param {number | null} r */
export const percent = (r) => (r === null ? '-' : `${(r * 100).toFixed(1)}%`);

/**
 * 유형별로 정답 수·놓친 수를 센다
 * @param {{ item: TruthItem, missed: boolean }[]} rows
 * @returns {Record<string, { total: number, missed: number }>}
 */
export function countByType(rows) {
  /** @type {Record<string, { total: number, missed: number }>} */
  const out = {};
  for (const { item, missed } of rows) {
    const c = (out[item.type] ??= { total: 0, missed: 0 });
    c.total += 1;
    if (missed) c.missed += 1;
  }
  return out;
}

/**
 * 정답표 형식 검사 (잘못 쓴 정답표로 숫자가 틀리지 않게)
 * @param {TruthDoc} doc
 * @param {string[]} types  허용하는 개인정보 종류 (PII_TYPE 값)
 * @returns {string[]} 문제 목록 (없으면 [])
 */
export function checkTruthDoc(doc, types) {
  const problems = [];
  if (!doc.document || !doc.file || !doc.documentType || !doc.form) problems.push('document/file/documentType/form 중 빈 칸');
  if (!Array.isArray(doc.pii) || doc.pii.length === 0) problems.push('pii가 비어 있음');
  const seen = new Set();
  for (const item of doc.pii ?? []) {
    if (!types.includes(item.type)) problems.push(`모르는 종류: ${item.type}`);
    if (secretsOf(item).length === 0) problems.push(`비교할 글자가 없음: ${item.type}`);
    const key = `${item.type}|${compact(item.value)}`;
    if (seen.has(key)) problems.push(`같은 항목이 두 번: ${item.type}`);
    seen.add(key);
  }
  return problems;
}
