// @ts-check
/**
 * PART 4. 마스킹 계획을 서류 글에 적용하기
 *
 *   applyMaskingPlan(documents, plan, findings, personGroups, edits?) → Result<{ maskedText, legend }>  (PART 3 프롬프트용)
 */

import { ok, fail, ERROR_CODE, MASKING_ACTION } from '../../shared/document-model.js';
import { maskAddsInBlock } from './user-edits.js';
import { REDACTED } from './create-masking-plan.js';

/** @typedef {import('../../shared/document-model.js').PiiFinding} PiiFinding */
/** @typedef {import('../../shared/document-model.js').MaskingPlan} MaskingPlan */
/** @typedef {import('../../shared/document-model.js').DocumentModel} DocumentModel */
/** @typedef {import('./index.js').PersonGroup} PersonGroup */

/** 범례 문장 (AI가 가명의 뜻을 알 수 있게) */
const ROLE_MEANING = {
  OWNER: 'owner on the register',
  LANDLORD: 'landlord on the contract',
  TENANT: 'tenant on the contract',
  ACCOUNT_HOLDER: 'holder of the payment account on the contract',
  PREVIOUS_OWNER: 'previous owner on the register',
};

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
