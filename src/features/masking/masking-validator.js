// @ts-check
/**
 * PART 4. 외부로 보내기 전 검사 (masking-validator)
 *
 *   validateMaskedText(maskedText, findings, plan, edits?) → Result<{ checked: number }>
 *   가려야 하는 원본 값이 가린 글에 남아 있으면 실패한다. 실패 메시지에는 실제 값을 넣지 않는다.
 */

import { ok, fail, ERROR_CODE, MASKING_ACTION } from '../../shared/document-model.js';
import { validAdds } from './user-edits.js';

/** @typedef {import('../../shared/document-model.js').PiiFinding} PiiFinding */
/** @typedef {import('../../shared/document-model.js').MaskingPlan} MaskingPlan */

/**
 * text 안에서 words 각각이 나오는 모든 자리를 [시작, 끝] 목록으로 돌려준다.
 * @param {string} text
 * @param {string[]} words
 * @returns {[number, number][]}
 */
function findSpans(text, words) {
  /** @type {[number, number][]} */
  const spans = [];
  for (const word of words) {
    if (!word) continue;
    for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
      spans.push([at, at + word.length]);
    }
  }
  return spans;
}

/**
 * 외부로 보내기 전에, 가려야 하는 원본 값이 남아 있지 않은지 검사한다.
 * @param {Record<string, string>} maskedText
 * @param {PiiFinding[]} findings
 * @param {MaskingPlan} plan
 * @param {import('./user-edits.js').MaskingEdits} [edits]  사용자가 더 가린 글자(add)도 검사한다
 */
export function validateMaskedText(maskedText, findings, plan, edits) {
  const all = Object.values(maskedText).join('\n');
  // 일부러 남긴 글자(가명, 줄인 주소)가 있는 자리. 원래 값이 이 자리 "안에서만" 보이면 새어 나간 게 아니다.
  // 예: 두 줄 주소 조각 "서울특별시"는 줄인 주소 "서울특별시 중구" 안에 들어 있다.
  // 사용자가 해제한(KEEP) 값도 일부러 보이는 글자다. 같은 글자의 다른 항목(예: 동명이인)이 이 자리 때문에 걸리지 않게 한다.
  const findingById = new Map(findings.map((f) => [f.id, f]));
  const allowedTexts = plan.items.flatMap((i) => {
    if (i.action === MASKING_ACTION.REPLACE && i.replacement) return [String(i.replacement)];
    if (i.action === MASKING_ACTION.KEEP) return [findingById.get(i.findingId)?.value ?? ''];
    return [];
  });
  const allowedSpans = findSpans(all, allowedTexts);
  // 하이픈·공백을 뺀 숫자열로도 비교한다 (줄 단위로 비교해 다른 줄의 숫자가 이어 붙지 않게 함)
  const digitLines = all.split('\n').map((line) => line.replace(/[^0-9]/g, ''));
  const actionById = new Map(plan.items.map((i) => [i.findingId, i.action]));
  let checked = 0;
  for (const f of findings) {
    const action = actionById.get(f.id);
    if (action === MASKING_ACTION.KEEP) continue;
    checked += 1;
    const digitsOnly = f.value.replace(/[^0-9]/g, '');
    const leaked =
      findSpans(all, [f.value]).some(([a, b]) => !allowedSpans.some(([x, y]) => x <= a && b <= y)) ||
      (digitsOnly.length >= 6 && digitLines.some((line) => line.includes(digitsOnly)));
    if (leaked) {
      // 메시지에 실제 값을 넣지 않는다
      return fail(ERROR_CODE.INVALID_INPUT, `Masking check failed: a ${f.type} value is still visible.`);
    }
  }
  // 사용자가 더 가린 글자도 남아 있으면 안 된다
  for (const a of validAdds(edits)) {
    checked += 1;
    if (findSpans(all, [a.value]).some(([x0, x1]) => !allowedSpans.some(([x, y]) => x <= x0 && x1 <= y))) {
      return fail(ERROR_CODE.INVALID_INPUT, 'Masking check failed: a user-selected value is still visible.');
    }
  }
  return ok({ checked });
}
