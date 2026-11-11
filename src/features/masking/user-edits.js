// @ts-check
/**
 * PART 4. 사용자 수정(edits) 규칙 적용 (docs/INTERFACES.md 8번 "사용자 수정")
 *
 * edits = { remove: [findingId...], add: [{ id, documentId, blockId, value, pageIndex?, bbox? }] }
 *   remove: 사용자가 "안 가려도 돼요" 한 것 → KEEP
 *   add:    사용자가 더 가린 글자 → 항상 REDACT
 *
 * 규칙
 *   1) 해제할 수 없는 종류(주민·외국인등록번호, 여권번호, 전화번호, 계좌번호)는 remove를 무시한다.
 *   2) 두 줄 주소는 같은 groupId 조각 전체를 함께 해제한다.
 *   3) 이름은 같은 사람(personGroup) 전체를 함께 해제한다. (한 곳만 풀면 가명이 누구인지 드러남)
 *
 * edits에는 원본 글자(value)가 들어 있으므로 로그·오류 메시지에 넣지 않는다.
 */

import { MASKING_ACTION, PII_TYPE, isValidBBox } from '../../shared/document-model.js';

/** @typedef {import('../../shared/document-model.js').PiiFinding} PiiFinding */
/** @typedef {{ personId: string, alias: string, roles: string[], findingIds: string[], status: string }} PersonGroup */
/** @typedef {{ x: number, y: number, width: number, height: number }} BBox */
/** @typedef {{ id: string, documentId: string, blockId: string, value: string, pageIndex: number, bbox: BBox }} AddEdit */
/** @typedef {{ remove?: string[], add?: AddEdit[] }} MaskingEdits */

const REDACTED = '[REDACTED]';

/** 사용자가 해제할 수 없는 개인정보 종류 */
export const NON_REMOVABLE_TYPES = new Set([
  PII_TYPE.RESIDENT_ID,
  PII_TYPE.FOREIGNER_ID,
  PII_TYPE.PASSPORT_ID,
  PII_TYPE.PHONE_NUMBER,
  PII_TYPE.BANK_ACCOUNT,
]);

/**
 * remove 목록에 규칙 1~3을 적용해, 실제로 해제(KEEP)할 findingId 모음을 만든다.
 * @param {PiiFinding[]} findings
 * @param {PersonGroup[]} personGroups
 * @param {MaskingEdits | undefined} edits
 * @returns {Set<string>}
 */
export function resolveRemovals(findings, personGroups, edits) {
  const keep = new Set();
  const byId = new Map(findings.map((f) => [f.id, f]));

  for (const id of edits?.remove ?? []) {
    const f = byId.get(id);
    if (!f) continue; // 없는 id는 무시
    if (NON_REMOVABLE_TYPES.has(f.type)) continue; // 규칙 1

    if (f.type === PII_TYPE.ADDRESS && f.groupId) {
      // 규칙 2: 같은 groupId 조각 전체
      for (const g of findings) if (g.groupId === f.groupId) keep.add(g.id);
    } else if (f.type === PII_TYPE.PERSON_NAME) {
      // 규칙 3: 같은 사람 전체
      const person = personGroups.find((p) => p.findingIds.includes(f.id));
      for (const pid of person ? person.findingIds : [f.id]) keep.add(pid);
    } else {
      keep.add(f.id);
    }
  }
  return keep;
}

/**
 * PDF 위치(pageIndex, bbox)가 없거나 잘못된 add가 있는지 확인한다.
 * 이런 항목을 빼 버리면 AI 글에서는 가려지는데 PDF에서는 안 가려지므로, 호출하는 쪽에서 실패로 돌려준다.
 * @param {MaskingEdits | undefined} edits
 */
export function hasInvalidAddPosition(edits) {
  return validAdds(edits).some((a) => !Number.isInteger(a.pageIndex) || a.pageIndex < 0 || !isValidBBox(a.bbox));
}

/**
 * add 목록 → 마스킹 계획 항목 (항상 REDACT)
 * 먼저 hasInvalidAddPosition()으로 위치를 확인한 뒤 부른다.
 * @param {MaskingEdits | undefined} edits
 */
export function addEditsToItems(edits) {
  return validAdds(edits).map((a) => ({
    findingId: a.id,
    action: MASKING_ACTION.REDACT,
    replacement: REDACTED,
    documentId: a.documentId,
    pageIndex: a.pageIndex,
    bbox: { ...a.bbox },
  }));
}

/**
 * block 글자에서 사용자가 더 가린 글자를 가린다.
 * @param {string} text
 * @param {string} documentId
 * @param {string} blockId
 * @param {MaskingEdits | undefined} edits
 */
export function maskAddsInBlock(text, documentId, blockId, edits) {
  let out = text;
  for (const a of validAdds(edits)) {
    if (a.documentId !== documentId || a.blockId !== blockId) continue;
    out = out.split(a.value).join(REDACTED);
  }
  return out;
}

/**
 * 값이 있는 add만 고른다. (빈 글자는 가릴 것이 없음)
 * @param {MaskingEdits | undefined} edits
 * @returns {AddEdit[]}
 */
export function validAdds(edits) {
  return (edits?.add ?? []).filter((a) => a && typeof a.value === 'string' && a.value.trim() !== '');
}
