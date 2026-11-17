// @ts-check
/**
 * PART 5. 마스킹 PDF 다시 검사 (노션 10장 "개인정보 보호 및 PDF 검증 기준")
 *   "시각적인 마스킹 결과도 검증한다. 생성된 PDF를 다시 OCR하여 개인정보가 눈에 보이게 남아 있지 않은지 확인"
 *
 * 마스킹 PDF를 OCR로 다시 읽은 글자(DocumentModel)에서, 처음에 탐지한 개인정보 값이 보이는지 찾는다.
 * (OCR은 pipeline.js에서 PART 1 readDocument()로 한다. 이 파일은 비교만 하므로 테스트하기 쉽다)
 *
 * 결과는 "안전하다"고 말하지 않는다.
 *   NOT_FOUND       탐지한 개인정보를 페이지 그림에서 찾지 못함 (탐지하지 못한 정보까지 보장하지는 않음)
 *   PARTLY_CHECKED  읽은 부분에서는 찾지 못했지만, 흐려서 확인하지 못한 줄이 있음 (그 줄은 직접 보라고 안내, #146)
 *   MAYBE_VISIBLE   보일 수 있음 (종류·페이지만 알려 주고 값은 보여 주지 않는다)
 *   UNVERIFIABLE    확인 불가 (PDF를 못 만들었거나, OCR로 못 읽었거나, 흐린 줄이 너무 많음)
 *
 * 흐린 줄 기준은 PART 1과 같다: 숫자가 있는 줄은 줄마다 0.8 미만이면 흐린 줄, 나머지 줄은 페이지 평균이 0.6 미만이면 확인 불가.
 * (숫자가 없는 줄을 하나씩 세면 표 선 조각("ㅣ ㅣ")까지 흐린 줄로 세어서, 시연 샘플도 "흐린 줄 있음"이 된다)
 * PART 1은 처음 읽을 때 흐린 줄이 하나라도 있으면 멈추지만, 다시 검사에서 그렇게 하면 작은 글씨·표가 많은 실제 서류는
 * 항상 "확인 불가"가 된다(#146 실험: 해상도를 올려도 같음). 그래서 끝까지 읽고, 흐린 줄은 "확인하지 못함"으로 따로 알린다.
 *
 * 한계: 숫자가 없는 흐린 줄은 "확인하지 못한 줄"로 세지 않는다. 그래서 이름처럼 글자만 있는 개인정보가 흐리게 읽혀
 * 정확히 일치하지 않으면 놓칠 수 있다. (이름은 정확히 같을 때만 찾는다. 숫자 번호는 흐린 줄에서 1개 다른 것까지 찾는다)
 * 결과 문구가 "탐지한 것만, PDF를 한 번 직접 보라"고 안내하는 이유다.
 */

import { MASKING_ACTION, PII_TYPE } from '../shared/document-model.js';
import { MIN_OCR_CONFIDENCE, MIN_DIGIT_LINE_CONFIDENCE } from '../features/document-input/index.js';

export const CHECK_STATUS = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',
  PARTLY_CHECKED: 'PARTLY_CHECKED',
  MAYBE_VISIBLE: 'MAYBE_VISIBLE',
  UNVERIFIABLE: 'UNVERIFIABLE',
});

/** 흐린 줄이 이 비율보다 많으면 "부분 확인"이 아니라 "확인 불가"로 둔다 (거의 못 읽은 페이지를 확인했다고 하지 않게) */
export const MAX_UNCLEAR_RATIO = 0.5;

/** 흐린 줄 안의 숫자열이 개인정보 번호와 이 개수 이하로만 다르면 "보일 수 있음"으로 본다 (OCR이 숫자를 몇 개 틀려도 잡게) */
const MAX_DIGIT_MISMATCH = 1;

/**
 * "거의 같은 숫자"는 서로 다른 숫자가 이만큼 이상 있는 번호에만 쓴다.
 * "000-000000-00000"처럼 같은 숫자가 반복되는 번호는 아무 0 줄과도 "거의 같다"가 되어 뜻이 없다 (가짜 데이터에서 확인, #146)
 */
const MIN_DISTINCT_DIGITS_FOR_NEAR = 3;

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
 * @property {'NOT_FOUND' | 'PARTLY_CHECKED' | 'MAYBE_VISIBLE' | 'UNVERIFIABLE'} status
 * @property {{ type: string, pageIndex: number }[]} hits  보일 수 있는 개인정보 (종류·페이지만)
 * @property {string | null} reason  UNVERIFIABLE일 때 오류 코드
 * @property {{ count: number, pages: number[] }} [unclear]  흐려서 확인하지 못한 줄 수와 페이지 (0부터)
 */

/**
 * PART 1과 같은 기준으로 흐린 숫자 줄인지
 * @param {{ text: string, confidence?: number | null }} block
 */
function isUnclear(block) {
  if (typeof block.confidence !== 'number') return false; // 글자 PDF처럼 신뢰도가 없으면 흐린 줄이 아니다
  return /[0-9]/.test(block.text) && block.confidence < MIN_DIGIT_LINE_CONFIDENCE;
}

/**
 * 페이지 평균 신뢰도가 PART 1 기준보다 낮은지 (신뢰도가 있는 줄만 본다)
 * @param {{ confidence?: number | null }[]} blocks
 */
function isLowConfidencePage(blocks) {
  const scores = blocks.map((b) => b.confidence).filter((c) => typeof c === 'number');
  if (scores.length === 0) return false;
  return scores.reduce((sum, c) => sum + /** @type {number} */ (c), 0) / scores.length < MIN_OCR_CONFIDENCE;
}

/**
 * 숫자열 haystack 안에 needle과 거의 같은(다른 숫자가 MAX_DIGIT_MISMATCH개 이하) 부분이 있는지
 * @param {string} haystack
 * @param {string} needle
 */
function containsNearly(haystack, needle) {
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let diff = 0;
    for (let j = 0; j < needle.length && diff <= MAX_DIGIT_MISMATCH; j += 1) {
      if (haystack[i + j] !== needle[j]) diff += 1;
    }
    if (diff <= MAX_DIGIT_MISMATCH) return true;
  }
  return false;
}

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
    page.blocks.map((b) => ({
      pageIndex: page.pageIndex,
      text: compact(b.text),
      digits: digitsOf(b.text),
      unclear: isUnclear(b),
    })),
  );

  /** @type {Map<string, { type: string, pageIndex: number }>} */
  const hits = new Map();
  for (const f of findings) {
    if (shown.has(f.id) || typeof f.value !== 'string') continue;
    const value = compact(f.value);
    const digits = digitsOf(f.value);
    if (value.length < 2) continue;
    const longNumber = digits.length >= MIN_DIGITS;
    const nearComparable = longNumber && new Set(digits).size >= MIN_DISTINCT_DIGITS_FOR_NEAR;
    for (const line of lines) {
      const seen =
        line.text.includes(value) ||
        (longNumber && line.digits.includes(digits)) ||
        // 흐린 줄은 OCR이 숫자를 틀렸을 수 있으므로 거의 같은 숫자열도 "보일 수 있음"으로 본다 (안전한 쪽)
        (nearComparable && line.unclear && containsNearly(line.digits, digits));
      if (seen) hits.set(`${f.type}@${line.pageIndex}`, { type: f.type, pageIndex: line.pageIndex });
    }
  }

  const list = [...hits.values()];
  const unclearLines = lines.filter((l) => l.unclear);
  const unclear = { count: unclearLines.length, pages: [...new Set(unclearLines.map((l) => l.pageIndex))] };
  if (list.length > 0) return { status: CHECK_STATUS.MAYBE_VISIBLE, hits: list, reason: null, unclear };
  // 거의 못 읽은 서류는 "일부 확인"이라고 하지 않는다 (줄이 없음, 페이지 평균이 낮음, 흐린 숫자 줄이 절반 넘음)
  const lowPage = ocrDocument.pages.some((p) => isLowConfidencePage(p.blocks));
  if (lines.length === 0 || lowPage || unclearLines.length / lines.length > MAX_UNCLEAR_RATIO) {
    return { ...unverifiable('LOW_CONFIDENCE'), unclear };
  }
  if (unclearLines.length > 0) return { status: CHECK_STATUS.PARTLY_CHECKED, hits: [], reason: null, unclear };
  return { status: CHECK_STATUS.NOT_FOUND, hits: [], reason: null, unclear };
}

/**
 * "부분 확인" 결과 문구 (서류 이름 뒤에 붙는다). 쪽이 여럿이면 "pages"로 쓴다.
 * @param {{ count: number, pages: number[] } | undefined} unclear  pages는 0부터
 */
export function partlyCheckedText(unclear) {
  const count = unclear?.count ?? 0;
  const pages = unclear?.pages ?? [];
  const lines = count === 1 ? '1 line' : `${count} lines`;
  const where = `${pages.length > 1 ? 'pages' : 'page'} ${pages.map((p) => p + 1).join(', ')}`;
  return (
    'in the parts we could read, none of the personal information we detected was found. ' +
    `${lines} on ${where} could not be read clearly, so we could not check ${count === 1 ? 'it' : 'them'}. ` +
    `Please look at ${pages.length > 1 ? 'those pages' : 'that page'} of the PDF yourself.`
  );
}

/**
 * 확인할 수 없을 때의 결과
 * @param {string} code  오류 코드 (PDF_EXPORT_FAILED, LOW_CONFIDENCE, OCR_FAILED 등)
 * @returns {DoubleCheckResult}
 */
export function unverifiable(code) {
  return { status: CHECK_STATUS.UNVERIFIABLE, hits: [], reason: code };
}
