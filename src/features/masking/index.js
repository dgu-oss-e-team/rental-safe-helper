// @ts-check
/**
 * PART 4. 인물 판별 및 목적 기반 마스킹
 * 담당: docs/OWNERS.md 참고
 *
 * 공개 함수
 *   matchPeople(fields)                                  → Result<PersonGroup[]>
 *   createMaskingPlan(findings, personGroups, purpose)   → Result<MaskingPlan>
 *   applyMaskingPlan(documents, plan, findings, personGroups) → Result<{ maskedText, legend }>   (PART 3 프롬프트용)
 *   validateMaskedText(maskedText, findings, plan)       → Result<{ checked: number }>     (외부 전달 전 검사)
 *
 * 규칙: 고유식별정보(주민·외국인등록번호, 여권번호)는 모든 목적에서 가린다.
 *       같은 사람 = 같은 가명, 동명이인 = 다른 가명. 생년월일은 판정에만 쓰고 AI로 보내지 않는다.
 *
 * 구현 상태
 *   완료: matchPeople() 이름 + 생년월일 판정 (person-matcher.js, alias-manager.js)
 *   TODO(PART 4): Fuse.js 이름 유사도, 목적별 마스킹 규칙(masking-policy.json) 정리,
 *                 createMaskingPlan/applyMaskingPlan 파일 분리.
 *   완료: 주소 시·구(동)까지 남기기 (coarsenAddress)
 *   TODO(PART 4): Fuse.js 이름 유사도, createMaskingPlan/applyMaskingPlan 파일 분리, masking-review-ui.
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
import policy from '../../config/masking/masking-policy.json';

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

/**
 * 주소에서 시·도, 시·군·구, 동·읍·면까지만 남기고 번지·호수는 지운다.
 * (최종 제안서 목적별 가림 표: 사기 위험 확인 → "시·구(동)만 남김")
 *
 * 예: "서울특별시 중구 필동로 00, 101호"        → "서울특별시 중구"
 *     "경기도 성남시 분당구 정자동 178-1"       → "경기도 성남시 분당구 정자동"
 *     "경기도 성남시 분당구 불정로 6 (정자동)"  → "경기도 성남시 분당구 정자동"
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
  // 1) 시·도, 시·군·구: "서울특별시", "경기도", "성남시", "분당구", "양평군"
  while (i < tokens.length && /^[가-힣]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/.test(tokens[i])) {
    kept.push(tokens[i]);
    i += 1;
  }
  if (kept.length === 0) return '';

  // 2) 바로 다음이 동·읍·면이면 하나 더 남긴다: "정자동", "필동2가", "봉담읍"
  //    숫자로 시작하는 "101동"(아파트 동 번호)은 집을 특정하므로 남기지 않는다.
  const next = tokens[i];
  if (next && /^[가-힣][가-힣0-9]*(동|가|읍|면)$/.test(next)) kept.push(next);
  else if (refDong) kept.push(refDong);

  return kept.join(' ');
}

/**
 * 목적에 맞는 마스킹 계획을 만든다.
 * @param {PiiFinding[]} findings
 * @param {PersonGroup[]} personGroups
 * @param {string} purpose  MASKING_PURPOSE 값
 */
export function createMaskingPlan(findings, personGroups, purpose) {
  if (!Object.values(MASKING_PURPOSE).includes(purpose)) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Unknown purpose.');
  }
  if (!Array.isArray(findings) || !Array.isArray(personGroups)) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Findings or person groups are missing.');
  }

  /** @type {Record<string, string>} */
  const rules = policy[/** @type {keyof typeof policy} */ (purpose)];
  /** @type {Map<string, string>} findingId → 가명 */
  const aliasByFinding = new Map();
  for (const group of personGroups) {
    for (const id of group.findingIds) aliasByFinding.set(id, group.alias);
  }

  const items = findings.map((f) => {
    let action = rules[f.type] ?? MASKING_ACTION.REDACT; // 모르는 종류는 안전하게 가림
    /** @type {string | null} */
    let replacement = REDACTED;

    if (action === MASKING_ACTION.REPLACE) {
      if (f.type === PII_TYPE.PERSON_NAME) {
        const alias = aliasByFinding.get(f.id);
        // 인물 판정이 없으면 가명을 붙일 수 없으므로 가린다
        if (alias) replacement = alias;
        else action = MASKING_ACTION.REDACT;
      } else if (f.type === PII_TYPE.ADDRESS) {
        const coarse = coarsenAddress(f.value);
        // 남길 부분을 못 찾으면 안전하게 통째로 가린다
        if (coarse) replacement = coarse;
        else action = MASKING_ACTION.REDACT;
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

  return ok({ purpose, items });
}

/**
 * 마스킹 계획을 문서 텍스트에 적용하고, 가명 범례를 만든다.
 * @param {DocumentModel[]} documents
 * @param {MaskingPlan} plan
 * @param {PiiFinding[]} findings
 * @param {PersonGroup[]} personGroups
 */
export function applyMaskingPlan(documents, plan, findings, personGroups) {
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
 * 외부로 보내기 전에, 가려야 하는 원본 값이 남아 있지 않은지 검사한다.
 * @param {Record<string, string>} maskedText
 * @param {PiiFinding[]} findings
 * @param {MaskingPlan} plan
 */
export function validateMaskedText(maskedText, findings, plan) {
  const all = Object.values(maskedText).join('\n');
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
      all.includes(f.value) ||
      (digitsOnly.length >= 6 && digitLines.some((line) => line.includes(digitsOnly)));
    if (leaked) {
      // 메시지에 실제 값을 넣지 않는다
      return fail(ERROR_CODE.INVALID_INPUT, `Masking check failed: a ${f.type} value is still visible.`);
    }
  }
  return ok({ checked });
}