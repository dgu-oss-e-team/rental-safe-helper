// @ts-check
/**
 * PART 4. 마스킹 계획을 서류 글에 적용하기
 *
 *   applyMaskingPlan(documents, plan, findings, personGroups, edits?) → Result<{ maskedText, legend }>  (PART 3 프롬프트용)
 */

import { ok, fail, ERROR_CODE, MASKING_ACTION, PII_TYPE } from '../../shared/document-model.js';
import personLabels from '../../config/templates/person-labels.json';
import { maskAddsInBlock } from './user-edits.js';
import { REDACTED, unconfirmedAlias } from './create-masking-plan.js';

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

/*
 * 고유식별번호 바로 앞의 이름 가리기 (실제 양식 서류 점검에서 발견)
 * 등기부 "공유자" 라벨 다음 줄의 "홍길동 800101-*******"처럼, 번호는 탐지됐는데 바로 앞 이름은 탐지되지 않으면
 * 가린 글에 "홍길동 [REDACTED]"처럼 이름만 남는다. 번호 모양이 없어서 보내기 전 검사로도 막을 수 없다.
 * 그래서 주민·외국인등록번호, 여권번호 바로 앞의 한글 2~4자 낱말은 이름으로 보고 같이 가린다.
 * - 역할 라벨(임대인·소유자·공유자·예금주·채무자 등), 이름 칸 이름(성명), 이름이 아닌 단어(notNames)는 빼고 (person-labels.json)
 * - 다른 탐지 결과에 들어 있는 글자(이미 가명·주소 등으로 바뀌는 글자)는 건드리지 않는다.
 * - PDF는 번호가 있는 줄 전체를 덮으므로(탐지 결과의 bbox = 줄의 bbox), 글에서만 가리면 된다.
 * - 멈추지 않고 가리는 이유: 이 검사에서 멈추면 ④ 확인 화면으로 갈 수 없어 사용자가 고칠 방법이 없다.
 */
const ID_TYPES = new Set([PII_TYPE.RESIDENT_ID, PII_TYPE.FOREIGNER_ID, PII_TYPE.PASSPORT_ID]);
/** 번호 앞에 와도 이름이 아닌 낱말 */
const NOT_NAME_BEFORE_ID = new Set([
  ...(personLabels.persons ?? []).flatMap((p) => p.labels),
  ...(personLabels.otherPersonLabels ?? []),
  ...(personLabels.nameFieldWords ?? []),
  ...(personLabels.notNames ?? []),
]);
/** 번호 바로 앞의 한글 2~4자 낱말 (앞에 한글이 더 붙어 있으면 낱말이 아님, "홍길동(800101-…)"처럼 괄호가 있어도) */
const WORD_BEFORE = /(?<![가-힣])([가-힣]{2,4})[\s,:(（]*$/;

/**
 * 줄에서 고유식별번호 바로 앞에 있는, 탐지되지 않은 이름을 찾는다.
 * @param {string} text  줄의 원래 글
 * @param {PiiFinding[]} blockFindings  이 줄의 탐지 결과
 * @returns {string[]}  가릴 낱말
 */
export function findNamesBeforeIds(text, blockFindings) {
  const names = [];
  for (const f of blockFindings) {
    if (!ID_TYPES.has(f.type)) continue;
    for (let at = text.indexOf(f.value); at !== -1; at = text.indexOf(f.value, at + 1)) {
      const word = WORD_BEFORE.exec(text.slice(0, at))?.[1];
      if (!word || NOT_NAME_BEFORE_ID.has(word)) continue;
      if (blockFindings.some((other) => other.value.includes(word))) continue;
      names.push(word);
    }
  }
  return names;
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
        const blockFindings = findings.filter((f) => f.blockId === block.blockId && f.documentId === doc.documentId);
        // 번호 바로 앞의 탐지되지 않은 이름을 먼저 가린다 (위 설명)
        for (const name of findNamesBeforeIds(text, blockFindings)) text = text.split(name).join(REDACTED);
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
    const meaning = group.roles.map((r) => ROLE_MEANING[/** @type {keyof typeof ROLE_MEANING} */ (r)] ?? r).join(', ');
    if (usedAliases.has(group.alias)) legend[group.alias] = meaning;
    // 이름만 같은 사람 (역할 없는 이름, create-masking-plan.js): 같은 사람인지 확인하지 않았다고 적는다
    const unconfirmed = unconfirmedAlias(group.alias);
    if (usedAliases.has(unconfirmed)) {
      legend[unconfirmed] = `same name as ${group.alias} (${meaning}), not confirmed to be the same person`;
    }
  }

  return ok({ maskedText, legend });
}
