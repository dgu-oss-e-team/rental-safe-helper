// PART 5. 사진·서류를 처리하는 동안 보여 줄 진행 문구 (사진 OCR은 쪽마다 몇 초씩 걸린다)
// 문구에 파일 이름이나 서류 내용은 넣지 않는다 (개인정보가 들어 있을 수 있음).

/** @type {Record<string, string>} */
const SLOT_NAME = { registry: 'the registry', lease: 'the lease' };

/**
 * 읽기 진행 문구
 * 예) "Reading the lease (2 of 2)…", "Reading the lease (2 of 2) · page 3 of 7…"
 * @param {import('./pipeline.js').ReadProgress} p
 * @param {(string | null)[] | null} [slots]  files[i]를 올린 칸 ('registry' | 'lease'), 모르면 null
 */
export function readingText(p, slots = null) {
  const what = SLOT_NAME[slots?.[p.docIndex] ?? ''] ?? 'document';
  let text = `Reading ${what}`;
  if (p.docCount > 1) text += ` (${p.docIndex + 1} of ${p.docCount})`;
  if (p.partCount > 1) text += ` · file ${p.partIndex + 1} of ${p.partCount}`;
  if (Number.isInteger(p.pageIndex) && Number.isInteger(p.pageCount) && /** @type {number} */ (p.pageCount) > 1) {
    text += ` · page ${/** @type {number} */ (p.pageIndex) + 1} of ${p.pageCount}`;
  }
  return `${text}…`;
}

/**
 * 사진 준비(보정해서 PDF로) 진행 문구. 예) "Preparing photo 3 of 10…"
 * @param {number} done  지금 준비하는 사진 번호 (0부터)
 * @param {number} total
 */
export function preparingText(done, total) {
  return total > 1 ? `Preparing photo ${done + 1} of ${total}…` : 'Preparing your files…';
}
