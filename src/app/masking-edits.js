// @ts-check
/**
 * PART 5. 사용자 수정(edits) 다루기 (docs/INTERFACES.md 8번 "사용자 수정")
 *
 * 화면(app-state)과 처리 흐름(pipeline) 둘 다 쓰므로, 화면 파일에 두지 않고 따로 둔다.
 * 규칙(해제 금지 종류, 묶음 단위 해제, add 가리기)은 PART 4가 적용한다. PART 5는 모양만 맞춰 보관·전달한다.
 * value에 원본 글자가 들어가므로 메모리에만 두고 로그·오류 메시지에 넣지 않는다.
 */

/**
 * ④ 보내기 전 확인 화면에서 사용자가 바꾼 내용
 * @typedef {Object} MaskingEdits
 * @property {string[]} remove  사용자가 해제한 findingId
 * @property {{ id: string, documentId: string, blockId: string, value: string, pageIndex?: number, bbox?: { x: number, y: number, width: number, height: number } }[]} add  사용자가 더 가린 글자 (항상 REDACT)
 */

/** @returns {MaskingEdits} */
export function emptyEdits() {
  return { remove: [], add: [] };
}

/**
 * PART 4 UI가 넘긴 값을 정해진 모양으로 맞춘다. (빠진 칸은 빈 배열, 다른 칸은 버림)
 * @param {any} edits
 * @returns {MaskingEdits}
 */
export function normalizeEdits(edits) {
  return {
    remove: Array.isArray(edits?.remove) ? [...edits.remove] : [],
    add: Array.isArray(edits?.add) ? edits.add.map((a) => ({ ...a })) : [],
  };
}

/**
 * 목적을 바꾸면: 더 가린 것(add)은 유지하고, 해제(remove)는 새 목적에서 다시 고르게 비운다.
 * @param {MaskingEdits} edits
 * @returns {MaskingEdits}
 */
export function editsAfterPurposeChange(edits) {
  return { remove: [], add: normalizeEdits(edits).add };
}

/**
 * 보내기 전 검사가 멈춘 줄을 더 가린다 (#316). 항상 REDACT이고, PDF에서는 그 줄 위치(bbox) 전체를 가린다.
 * AI 글에서는 그 줄에 남은 글자 조각(values)을 가린다. (조각이 없으면 원래 줄 글자를 쓴다)
 * 이미 넣은 조각은 다시 넣지 않는다. 해제(remove)는 그대로 둔다.
 * @param {MaskingEdits} edits
 * @param {{ documentId: string, blockId: string, pageIndex: number, bbox: { x: number, y: number, width: number, height: number }, text: string, values?: string[] }[]} lines
 * @returns {MaskingEdits}
 */
export function addLineEdits(edits, lines) {
  const next = normalizeEdits(edits);
  for (const line of lines) {
    const values = (line.values ?? [line.text]).filter((v) => typeof v === 'string' && v.trim() !== '');
    values.forEach((value, k) => {
      const id = `line:${line.documentId}:${line.blockId}:${k}`;
      if (next.add.some((a) => a.id === id || (a.documentId === line.documentId && a.blockId === line.blockId && a.value === value))) return;
      next.add.push({ id, documentId: line.documentId, blockId: line.blockId, value, pageIndex: line.pageIndex, bbox: { ...line.bbox } });
    });
  }
  return next;
}
