// @ts-check
/**
 * PART 5. 업로드 칸과 서류 종류가 다를 때 안내 (#186, 11/17 실제 서류 점검 보고서 "발표 전까지")
 *
 * ① 화면은 등기부 칸과 계약서 칸이 따로 있다. 파일마다 올린 칸(slot)을 기억해 두었다가
 * PART 2가 판별한 종류(documentType)와 비교해서, 다르면 ② 결과 화면에 안내한다.
 * - 판별은 서류 내용으로 하므로 결과는 그대로 쓴다. 멈추지 않고 안내만 한다.
 * - 칸만 바뀐 경우(두 서류가 서로의 칸에 있음): 결과에는 영향이 없다고 알린다.
 * - 칸이 달라서 등기부나 계약서가 빠진 경우: 그 서류가 필요한 점검은 "Could not check"라고 알리고 올리라고 안내한다.
 * - 한 칸만 올렸고 종류가 맞으면 안내하지 않는다. (사용자가 고른 것)
 * - 종류를 모르는 서류(UNKNOWN)는 결과 화면이 따로 안내하므로 여기서는 비교하지 않는다.
 * "safe", "no risk" 같은 말은 쓰지 않는다. 개인정보는 넣지 않는다 (정해진 문구만).
 */

import { DOCUMENT_TYPE } from '../shared/document-model.js';

/** @typedef {'registry' | 'lease'} UploadSlot */

/** 칸 → 그 칸에 와야 하는 서류 종류 */
const SLOT_TYPE = /** @type {const} */ ({
  registry: DOCUMENT_TYPE.REGISTRY,
  lease: DOCUMENT_TYPE.LEASE_CONTRACT,
});

/** 화면 이름 (① 화면의 칸 이름과 같은 말) */
const SLOT_TEXT = { registry: 'property register', lease: 'lease contract' };
const TYPE_TEXT = {
  [DOCUMENT_TYPE.REGISTRY]: 'a property register',
  [DOCUMENT_TYPE.LEASE_CONTRACT]: 'a lease contract',
};
/** 빠진 서류 안내 */
const MISSING_TEXT = {
  [DOCUMENT_TYPE.REGISTRY]:
    'No property register was checked, so the checks that compare with the register show "Could not check". To check them, upload the property register (등기부등본) in the property register box.',
  [DOCUMENT_TYPE.LEASE_CONTRACT]:
    'No lease contract was checked, so the checks that compare with the contract show "Could not check". To check them, upload the lease contract (임대차계약서) in the lease contract box.',
};

/**
 * 분석할 파일 목록과, 파일마다 올린 칸 (빈 칸은 뺀다)
 * @param {{ registry: File | null, lease: File | null }} files
 * @returns {{ files: File[], slots: UploadSlot[] }}
 */
export function filesWithSlots({ registry, lease }) {
  /** @type {{ files: File[], slots: UploadSlot[] }} */
  const out = { files: [], slots: [] };
  if (registry) {
    out.files.push(registry);
    out.slots.push('registry');
  }
  if (lease) {
    out.files.push(lease);
    out.slots.push('lease');
  }
  return out;
}

/**
 * 칸과 판별 결과를 비교해서 안내 문구를 만든다. 문제가 없으면 빈 목록.
 * @param {{ documentType: string }[]} documents  documents[i]는 slots[i] 칸에 올린 파일
 * @param {UploadSlot[] | null | undefined} slots  시연 샘플처럼 칸이 없으면 null
 * @returns {string[]}
 */
export function uploadSlotNotices(documents, slots) {
  if (!slots || slots.length !== documents.length) return [];
  const known = (/** @type {string} */ t) => t === DOCUMENT_TYPE.REGISTRY || t === DOCUMENT_TYPE.LEASE_CONTRACT;
  const wrong = documents
    .map((d, i) => ({ type: d.documentType, slot: slots[i] }))
    .filter((x) => known(x.type) && x.type !== SLOT_TYPE[x.slot]);
  if (wrong.length === 0) return [];

  const types = new Set(documents.map((d) => d.documentType));
  // 두 서류가 서로의 칸에 있음: 둘 다 있으니 결과에는 영향이 없다
  if (wrong.length === 2 && types.has(DOCUMENT_TYPE.REGISTRY) && types.has(DOCUMENT_TYPE.LEASE_CONTRACT)) {
    return [
      'Your two files were in each other\'s boxes: the property register in the lease contract box, and the lease contract in the property register box. We checked each file by what it contains, so the results below are not affected.',
    ];
  }

  /** @type {string[]} */
  const notices = wrong.map(
    (x) =>
      `The file in the ${SLOT_TEXT[x.slot]} box looks like ${TYPE_TEXT[/** @type {keyof typeof TYPE_TEXT} */ (x.type)]}, so we checked it as ${TYPE_TEXT[/** @type {keyof typeof TYPE_TEXT} */ (x.type)]}.`,
  );
  // 칸이 달라서 빠진 서류: 그 서류가 필요한 점검은 확인 불가
  for (const type of [DOCUMENT_TYPE.REGISTRY, DOCUMENT_TYPE.LEASE_CONTRACT]) {
    if (!types.has(type)) notices.push(MISSING_TEXT[/** @type {keyof typeof MISSING_TEXT} */ (type)]);
  }
  return notices;
}

/**
 * @typedef {{ types: string[], items: number[][] }} UploadParts
 *   한 칸에 함께 올린 파일 조각들 (#305). types[k]: 조각 k를 판별한 종류, items[k]: 조각 k가 칸 목록의 몇 번째 파일들인지(0부터)
 */

/** "File 2", "Files 2–3" (칸 목록 번호는 1부터) */
function fileLabel(/** @type {number[]} */ items) {
  const first = items[0] + 1;
  const last = items[items.length - 1] + 1;
  return items.length === 1 ? `File ${first}` : `Files ${first}–${last}`;
}

/**
 * 한 칸에 여러 파일을 올렸을 때, 칸과 다른 서류가 섞였으면 안내한다 (#305, #299 리뷰)
 * 예: 계약서 칸에 계약서 PDF + 등기부 PDF → 등기부는 계약서와 한 서류로 합쳐져서 등기부로 점검되지 않는다.
 * - 종류를 모르는 조각(특약 별지 한 장 등)은 안내하지 않는다. 별지는 계약서 칸에 있는 게 맞다.
 * - 막지 않고 안내만 한다. 지우는 방법(Remove)과 올릴 칸을 알려 준다. 파일 이름은 넣지 않는다 (몇 번째 파일인지만).
 * @param {(UploadParts | null)[] | null | undefined} parts  parts[i]는 slots[i] 칸 (조각이 하나면 null)
 * @param {UploadSlot[] | null | undefined} slots
 * @returns {string[]}
 */
export function uploadPartNotices(parts, slots) {
  if (!parts || !slots) return [];
  /** @type {string[]} */
  const notices = [];
  for (const [i, slot] of slots.entries()) {
    const p = parts[i];
    if (!p) continue;
    for (const [k, type] of p.types.entries()) {
      if (type !== DOCUMENT_TYPE.REGISTRY && type !== DOCUMENT_TYPE.LEASE_CONTRACT) continue;
      if (type === SLOT_TYPE[slot]) continue;
      const label = fileLabel(p.items[k] ?? [k]);
      const other = slot === 'registry' ? 'lease' : 'registry';
      notices.push(
        `${label} in the ${SLOT_TEXT[slot]} box looks like ${TYPE_TEXT[/** @type {keyof typeof TYPE_TEXT} */ (type)]}. ` +
          'Files in one box are checked together as one document, so the results below may be incomplete or wrong. ' +
          `If you added it by mistake, go back, remove it from this box, and upload it in the ${SLOT_TEXT[other]} box.`,
      );
    }
  }
  return notices;
}
