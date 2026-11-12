// @ts-check
/**
 * PART 4. 인물 판별 및 목적 기반 마스킹
 * 담당: docs/OWNERS.md 참고
 *
 * 공개 함수
 *   matchPeople(fields)                                  → Result<PersonGroup[]>
 *   createMaskingPlan(findings, personGroups, purpose, edits?)   → Result<MaskingPlan>
 *   applyMaskingPlan(documents, plan, findings, personGroups, edits?) → Result<{ maskedText, legend }>   (PART 3 프롬프트용)
 *   validateMaskedText(maskedText, findings, plan, edits?)       → Result<{ checked: number }>     (외부 전달 전 검사)
 *   edits(사용자 수정) 규칙은 user-edits.js
 *   renderMaskingReview({ analysis, prepared, edits, onChange }) → HTMLElement  (④ 확인 화면, PART 5 slots.js에 연결)
 *
 * 규칙: 고유식별정보(주민·외국인등록번호, 여권번호)는 모든 목적에서 가린다.
 *       같은 사람 = 같은 가명, 동명이인 = 다른 가명. 생년월일은 판정에만 쓰고 AI로 보내지 않는다.
 *
 * 구현 상태
 *   완료: matchPeople() 이름 + 생년월일 판정 (person-matcher.js, alias-manager.js)
 *   완료: 주소 시·구(동)까지 남기기 (coarsenAddress, 줄임말, 두 줄 주소 groupId)
 *   완료: 사용자 수정 edits (remove 규칙 3가지, add 가리기·검사)
 *   완료: 확인 화면 1단계 (가린 항목 목록, 해제, 범례, 미리보기)
 *   완료: 확인 화면 2단계 (미리보기에서 글자 골라 더 가리기, 취소)
 *   TODO(PART 4): Fuse.js 이름 유사도, createMaskingPlan/applyMaskingPlan 파일 분리, "같은 사람인가요?".
*/

import {
  ok,
  fail,
  ERROR_CODE,
  MASKING_ACTION,
  MASKING_PURPOSE,
  PII_TYPE,
} from '../../shared/document-model.js';
import { collectPeople, groupPeople } from './person-matcher.js';
import { assignAliases } from './alias-manager.js';
import { resolveRemovals, addEditsToItems, hasInvalidAddPosition, maskAddsInBlock, validAdds } from './user-edits.js';
import policy from '../../config/masking/masking-policy.json';
// 시·도 이름 목록 (정식 이름 + 줄임말). PART 2가 관리하는 설정 파일을 같이 읽는다.
import personLabels from '../../config/templates/person-labels.json';

// ④ 확인 화면 (PART 5 slots.js의 maskingReview 자리)
export { renderMaskingReview } from './masking-review-ui.js';

/** @typedef {import('../../shared/document-model.js').PiiFinding} PiiFinding */
/** @typedef {import('../../shared/document-model.js').MaskingPlan} MaskingPlan */
/** @typedef {import('../../shared/document-model.js').DocumentModel} DocumentModel */
/** @typedef {{ personId: string, alias: string, roles: string[], findingIds: string[], status: string }} PersonGroup */

const REDACTED = '[REDACTED]';

/** 범례 문장 (AI가 가명의 뜻을 알 수 있게) */
const ROLE_MEANING = {
  OWNER: 'owner on the register',
  LANDLORD: 'landlord on the contract',
  TENANT: 'tenant on the contract',
  ACCOUNT_HOLDER: 'holder of the payment account on the contract',
};

/**
 * 같은 사람끼리 묶고 역할 가명을 붙인다.
 * @param {object} fields  extractFields() 결과
 */
export function matchPeople(fields) {
  if (!fields) return fail(ERROR_CODE.INVALID_INPUT, 'Extracted fields are missing.');
  const people = collectPeople(fields);
  const groups = groupPeople(people);
  return ok(assignAliases(groups));
}

/** 시·도 이름 목록 (person-labels.json의 addressRegions) */
const ADDRESS_REGIONS = new Set(personLabels.addressRegions ?? []);
/** 목록에 없더라도 정식 시·도 이름 모양이면 인정 */
const REGION_PATTERN = /^[가-힣]+(특별시|광역시|특별자치시|특별자치도|도|시)$/;

/**
 * 주소에서 시·도, 시·군·구, 동·읍·면까지만 남기고 번지·호수는 지운다.
 * (최종 제안서 목적별 가림 표: 사기 위험 확인 → "시·구(동)만 남김")
 *
 * 예: "서울특별시 중구 필동로 00, 101호"        → "서울특별시 중구"
 *     "경기도 성남시 분당구 정자동 178-1"       → "경기도 성남시 분당구 정자동"
 *     "경기도 성남시 분당구 불정로 6 (정자동)"  → "경기도 성남시 분당구 정자동"
 *     "경기 수원시 팔달구 …"                  → "경기 수원시 팔달구" (줄임말도 인정)
 *
 * 남길 부분을 하나도 못 찾으면 빈 문자열을 돌려준다 (→ 호출하는 쪽에서 통째로 가림).
 * @param {string} address
 */
export function coarsenAddress(address) {
  const text = String(address ?? '');
  // 괄호 안 동 이름 (도로명 주소의 참고 항목) 따로 꺼내 두기: "(정자동)" → "정자동"
  const refDong = text.match(/\(([가-힣][가-힣0-9]*(?:동|가))[,)]/)?.[1] ?? null;
  const tokens = text.replace(/\(.*?\)/g, ' ').split(/[\s,]+/).filter(Boolean);

  const kept = [];
  let i = 0;
  // 1) 시·도: 정식 이름("서울특별시")이나 줄임말("서울", "경기") 모두 인정
  if (tokens[0] && (ADDRESS_REGIONS.has(tokens[0]) || REGION_PATTERN.test(tokens[0]))) {
    kept.push(tokens[0]);
    i = 1;
  }
  // 2) 시·군·구: "성남시", "분당구", "양평군"
  while (i < tokens.length && /^[가-힣]+(시|군|구)$/.test(tokens[i])) {
    kept.push(tokens[i]);
    i += 1;
  }
  if (kept.length === 0) return '';

  // 3) 바로 다음이 동·읍·면이면 하나 더 남긴다: "정자동", "필동2가", "봉담읍"
  //    "101동", "래미안101동"(아파트 동 번호)은 집을 특정하므로 남기지 않는다.
  //    → 한글 뒤에 숫자는 한 자리까지만 허용 ("역삼1동", "필동2가"는 남김)
  const next = tokens[i];
  if (next && /^[가-힣]+[0-9]?(동|가|읍|면)$/.test(next)) kept.push(next);
  else if (refDong) kept.push(refDong);

  return kept.join(' ');
}

/**
 * 목적에 맞는 마스킹 계획을 만든다.
 * @param {PiiFinding[]} findings
 * @param {PersonGroup[]} personGroups
 * @param {string} purpose  MASKING_PURPOSE 값
 * @param {import('./user-edits.js').MaskingEdits} [edits]  사용자 수정 (없으면 빈 값)
 */
export function createMaskingPlan(findings, personGroups, purpose, edits) {
  if (!Object.values(MASKING_PURPOSE).includes(purpose)) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Unknown purpose.');
  }
  if (!Array.isArray(findings) || !Array.isArray(personGroups)) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Findings or person groups are missing.');
  }
  // 사용자가 더 가린 글자는 PDF 위치가 꼭 있어야 한다 (빼면 PDF에서 안 가려짐)
  if (hasInvalidAddPosition(edits)) {
    return fail(ERROR_CODE.COORDINATE_INVALID, 'A user-selected area has no valid position.');
  }

  /** @type {Record<string, string>} */
  const rules = policy[/** @type {keyof typeof policy} */ (purpose)];
  /** @type {Map<string, string>} findingId → 가명 */
  const aliasByFinding = new Map();
  for (const group of personGroups) {
    for (const id of group.findingIds) aliasByFinding.set(id, group.alias);
  }

  // 두 줄 주소: 같은 groupId 조각들의 값을 순서대로 이어 붙여 둔다. (INTERFACES.md 4번 groupId)
  /** @type {Map<string, { firstId: string, text: string }>} */
  const addressGroups = new Map();
  for (const f of findings) {
    if (f.type !== PII_TYPE.ADDRESS || !f.groupId) continue;
    const g = addressGroups.get(f.groupId);
    if (g) g.text += ` ${f.value}`;
    else addressGroups.set(f.groupId, { firstId: f.id, text: f.value });
  }

  // 사용자가 해제한 것 (규칙 적용 후)
  const keepIds = resolveRemovals(findings, personGroups, edits);

  const items = findings.map((f) => {
    let action = rules[f.type] ?? MASKING_ACTION.REDACT; // 모르는 종류는 안전하게 가림
    if (keepIds.has(f.id)) action = MASKING_ACTION.KEEP;
    /** @type {string | null} */
    let replacement = REDACTED;

    if (action === MASKING_ACTION.REPLACE) {
      if (f.type === PII_TYPE.PERSON_NAME) {
        const alias = aliasByFinding.get(f.id);
        // 인물 판정이 없으면 가명을 붙일 수 없으므로 가린다
        if (alias) replacement = alias;
        else action = MASKING_ACTION.REDACT;
      } else if (f.type === PII_TYPE.ADDRESS) {
        const group = f.groupId ? addressGroups.get(f.groupId) : undefined;
        if (group && group.firstId !== f.id) {
          // 두 줄 주소의 둘째 조각부터는 가린다 (줄인 주소는 첫 조각에만 넣음)
          action = MASKING_ACTION.REDACT;
        } else {
          const coarse = coarsenAddress(group ? group.text : f.value);
          // 남길 부분을 못 찾으면 안전하게 통째로 가린다
          if (coarse) replacement = coarse;
          else action = MASKING_ACTION.REDACT;
        }
      }
    } else if (action === MASKING_ACTION.KEEP) {
      replacement = null;
    }

    return {
      findingId: f.id,
      action,
      replacement,
      documentId: f.documentId,
      pageIndex: f.pageIndex,
      bbox: { ...f.bbox },
    };
  });

  // 사용자가 더 가린 글자는 항상 REDACT로 뒤에 붙인다
  items.push(...addEditsToItems(edits));

  return ok({ purpose, items });
}

/**
 * 마스킹 계획을 문서 텍스트에 적용하고, 가명 범례를 만든다.
 * @param {DocumentModel[]} documents
 * @param {MaskingPlan} plan
 * @param {PiiFinding[]} findings
 * @param {PersonGroup[]} personGroups
 * @param {import('./user-edits.js').MaskingEdits} [edits]  사용자가 더 가린 글자(add)도 가린다
 */
export function applyMaskingPlan(documents, plan, findings, personGroups, edits) {
  if (!Array.isArray(documents) || !plan?.items) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Documents or masking plan are missing.');
  }
  const findingById = new Map(findings.map((f) => [f.id, f]));

  /** @type {Record<string, string>} */
  const maskedText = {};
  for (const doc of documents) {
    const lines = [];
    for (const page of doc.pages) {
      for (const block of page.blocks) {
        let text = block.text;
        for (const item of plan.items) {
          const f = findingById.get(item.findingId);
          if (!f || f.blockId !== block.blockId || f.documentId !== doc.documentId) continue;
          if (item.action === MASKING_ACTION.KEEP) continue;
          text = text.split(f.value).join(item.replacement ?? REDACTED);
        }
        text = maskAddsInBlock(text, doc.documentId, block.blockId, edits);
        lines.push(text);
      }
    }
    maskedText[doc.documentId] = lines.join('\n');
  }

  /** @type {Record<string, string>} */
  const legend = {};
  const usedAliases = new Set(plan.items.map((i) => i.replacement));
  for (const group of personGroups) {
    if (!usedAliases.has(group.alias)) continue;
    legend[group.alias] = group.roles.map((r) => ROLE_MEANING[/** @type {keyof typeof ROLE_MEANING} */ (r)] ?? r).join(', ');
  }

  return ok({ maskedText, legend });
}

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
