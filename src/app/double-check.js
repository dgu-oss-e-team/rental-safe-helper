// @ts-check
/**
 * PART 5. 마스킹 PDF 다시 검사 (노션 10장 "개인정보 보호 및 PDF 검증 기준")
 *   "시각적인 마스킹 결과도 검증한다. 생성된 PDF를 다시 OCR하여 개인정보가 눈에 보이게 남아 있지 않은지 확인"
 *
 * 마스킹 PDF를 OCR로 다시 읽은 글자(DocumentModel)에서, 처음에 탐지한 개인정보 값이 보이는지 찾는다.
 * (OCR은 pipeline.js에서 PART 1 readDocument()로 한다. 이 파일은 비교만 하므로 테스트하기 쉽다)
 *
 * 결과는 "안전하다"고 말하지 않는다.
 *   NOT_FOUND     탐지한 개인정보를 페이지 그림에서 찾지 못함 (탐지하지 못한 정보까지 보장하지는 않음)
 *   MAYBE_VISIBLE 보일 수 있음 (종류·페이지만 알려 주고 값은 보여 주지 않는다)
 *   UNVERIFIABLE  확인 불가 (PDF를 못 만들었거나 OCR로 못 읽음)
 */

import { MASKING_ACTION, PII_TYPE } from '../shared/document-model.js';

export const CHECK_STATUS = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',
  MAYBE_VISIBLE: 'MAYBE_VISIBLE',
  UNVERIFIABLE: 'UNVERIFIABLE',
});

/** 개인정보 종류 → 화면 이름 (값 대신 이것만 보여 준다) */
export const PII_TYPE_TEXT = {
  [PII_TYPE.PERSON_NAME]: 'Name',
  [PII_TYPE.RESIDENT_ID]: 'Resident registration number',
  [PII_TYPE.FOREIGNER_ID]: 'Foreigner registration number',
  [PII_TYPE.PASSPORT_ID]: 'Passport number',
  [PII_TYPE.PHONE_NUMBER]: 'Phone number',
  [PII_TYPE.BANK_ACCOUNT]: 'Bank account',
  [PII_TYPE.ADDRESS]: 'Address',
  [PII_TYPE.REGISTRY_ID]: 'Registry number',
};

/** 이 길이 이상의 숫자열은 하이픈·공백을 빼고 숫자만으로도 비교한다 (OCR이 기호를 틀리게 읽어도 잡도록) */
const MIN_DIGITS = 6;

/** 띄어쓰기 차이를 없앤다 (OCR은 띄어쓰기를 자주 틀린다) */
const compact = (/** @type {string} */ s) => s.replace(/\s+/g, '');
const digitsOf = (/** @type {string} */ s) => s.replace(/[^0-9]/g, '');

/**
 * @typedef {Object} DoubleCheckResult
 * @property {'NOT_FOUND' | 'MAYBE_VISIBLE' | 'UNVERIFIABLE'} status
 * @property {{ type: string, pageIndex: number }[]} hits  보일 수 있는 개인정보 (종류·페이지만)
 * @property {string | null} reason  UNVERIFIABLE일 때 오류 코드
 */

/**
 * 다시 읽은 글자에서 탐지했던 개인정보가 보이는지 찾는다.
 * - 사용자가 "AI에게 보여 주기"로 해제한 항목(KEEP)은 일부러 보이는 것이므로 빼고 찾는다.
 * - 가명으로 바꾼 이름, 시·구만 남긴 주소도 원래 값 전체가 보이면 안 된다.
 * @param {import('../shared/document-model.js').DocumentModel} ocrDocument  마스킹 PDF를 다시 읽은 결과
 * @param {import('../shared/document-model.js').PiiFinding[]} findings  이 서류에서 처음 탐지한 개인정보
 * @param {import('../shared/document-model.js').MaskingPlan} plan
 * @returns {DoubleCheckResult}
 */
export function findVisiblePii(ocrDocument, findings, plan) {
  const shown = new Set(plan.items.filter((i) => i.action === MASKING_ACTION.KEEP).map((i) => i.findingId));
  const lines = ocrDocument.pages.flatMap((page) =>
    page.blocks.map((b) => ({ pageIndex: page.pageIndex, text: compact(b.text), digits: digitsOf(b.text) })),
  );

  /** @type {Map<string, { type: string, pageIndex: number }>} */
  const hits = new Map();
  for (const f of findings) {
    if (shown.has(f.id) || typeof f.value !== 'string') continue;
    const value = compact(f.value);
    const digits = digitsOf(f.value);
    if (value.length < 2) continue;
    for (const line of lines) {
      const seen = line.text.includes(value) || (digits.length >= MIN_DIGITS && line.digits.includes(digits));
      if (seen) hits.set(`${f.type}@${line.pageIndex}`, { type: f.type, pageIndex: line.pageIndex });
    }
  }

  const list = [...hits.values()];
  return {
    status: list.length > 0 ? CHECK_STATUS.MAYBE_VISIBLE : CHECK_STATUS.NOT_FOUND,
    hits: list,
    reason: null,
  };
}

/**
 * 확인할 수 없을 때의 결과
 * @param {string} code  오류 코드 (PDF_EXPORT_FAILED, LOW_CONFIDENCE, OCR_FAILED 등)
 * @returns {DoubleCheckResult}
 */
export function unverifiable(code) {
  return { status: CHECK_STATUS.UNVERIFIABLE, hits: [], reason: code };
}
