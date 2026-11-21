// @ts-check
/**
 * PART 5. 오류를 사용자가 이해할 수 있는 안내로 바꾼다. (화면 문구는 영어, 제안서 기준)
 *
 * 각 파트의 오류 메시지는 개발자용이라("Numeric OCR confidence is too low…") 그대로 보여 주지 않고,
 * 오류 코드(ERROR_CODE)와 멈춘 단계(step)를 보고 "무슨 일인지 + 무엇을 하면 되는지"를 보여 준다.
 * 개인정보는 넣지 않는다 (정해진 문구만 쓴다).
 */

import { ERROR_CODE } from '../shared/document-model.js';

/**
 * @typedef {Object} ErrorHelp
 * @property {string} title  무슨 일인지 (한 줄)
 * @property {string} help   무엇을 하면 되는지
 */

/** 오류 코드별 안내 */
/** @type {Record<string, ErrorHelp>} */
const BY_CODE = {
  [ERROR_CODE.UNSUPPORTED_FILE]: {
    title: 'This file type is not supported.',
    help: 'Please upload a PDF, JPG, or PNG file.',
  },
  [ERROR_CODE.PDF_READ_FAILED]: {
    title: 'We could not open this PDF.',
    help: 'The file may be damaged or password-protected. Try downloading the document again, or upload a clear photo instead.',
  },
  [ERROR_CODE.OCR_FAILED]: {
    title: 'We could not read the text in this image.',
    help: 'The reading tool is downloaded the first time you use it. Check your internet connection and try again.',
  },
  [ERROR_CODE.LOW_CONFIDENCE]: {
    title: 'Some text could not be read clearly.',
    help: 'To protect your personal information, we stopped instead of guessing. Upload the original PDF file if you have it, or take a clearer photo: flat paper, good light, no shadows.',
  },
  [ERROR_CODE.MISSING_REQUIRED_FIELD]: {
    title: 'Some required information is missing from the document.',
    help: 'Check that you uploaded the whole document, including every page.',
  },
  [ERROR_CODE.COORDINATE_INVALID]: {
    title: 'We could not place the hidden areas correctly.',
    help: 'Please try again. If it happens again, start over with the original file.',
  },
  [ERROR_CODE.PDF_EXPORT_FAILED]: {
    title: 'We could not create the masked PDF.',
    help: 'You can still copy the AI prompt. Try again later, or use a computer browser.',
  },
  // 사진 여러 장을 PDF 하나로 합치다가 실패 (#268)
  PHOTO_READ_FAILED: {
    title: 'We could not prepare one of your photos.',
    help: 'Remove that photo and take it again, or upload one PDF with all pages.',
  },
  LOAD_FAILED: {
    title: 'We could not load what we need.',
    help: 'Please check your internet connection and try again.',
  },
};

/**
 * 같은 코드라도 단계에 따라 뜻이 달라지는 경우 (INVALID_INPUT은 여러 단계에서 쓰인다)
 * @type {Record<string, ErrorHelp>}
 */
const BY_STEP = {
  input: {
    title: 'No file was chosen.',
    help: 'Choose your property register and/or lease contract, or try the sample documents.',
  },
  // 위험 점검이 전부 실패하면(규칙 파일 오류 등) 결과를 하나도 보여 주지 않는다 (#120, PART 3 #117 "전부 아니면 전무").
  // 결과가 없다고 위험이 없는 것이 아니므로 그렇게 읽히지 않게 쓰고, 서류 탓이 아닐 수 있어서 "다른 파일"을 권하지 않는다.
  assessRisks: {
    title: 'We could not finish the risk check, so no results are shown.',
    help: 'This does not mean there are no warning signs. Please try again. If it happens again, check the register and the contract yourself before you sign, or ask someone you trust for help.',
  },
  // "같은 사람인가요?" 답으로 다시 점검하다 실패하면(#126) 이전 결과가 화면에 그대로 남아 있으므로 그렇다고 알려 준다.
  // 남은 결과에는 답이 반영되지 않았다는 점을 밝히고, "no warning"·"no risk"·"safe"는 쓰지 않는다.
  recheckRisks: {
    title: 'We could not update the results with your answer.',
    help: 'This answer was not applied. The results on this page are from before this answer. Please choose your answer again. If it happens again, check the register and the contract yourself before you sign, or ask someone you trust for help.',
  },
  // "같은 사람인가요?" 답이 맞지 않을 때 (#171). 무엇이 그대로인지 + 바로 할 수 있는 일 (모르면 "Not sure yet")
  applyPersonAnswers: {
    title: 'We could not use this answer about who is who.',
    help: 'Nothing changed: your earlier answers and the results on this page are the same as before. Please choose the answer again. If you are not sure, choose "Not sure yet" and compare the names on the register and the contract yourself.',
  },
  // 수정이 검사에 걸리면 PART 5가 이미 이전 상태로 되돌린다. 처음 가릴 때 걸리는 경우도 있어서 "되돌리라"고 하지 않는다.
  validateMaskedText: {
    title: 'Some personal information might still be visible, so we stopped.',
    help: 'Nothing was shared. If you just changed what is hidden, that change was not applied.',
  },
  createMaskingPlan: {
    title: 'That change could not be applied.',
    help: 'Your previous settings are kept. Please try a different change, or start over.',
  },
  applyMaskingPlan: {
    title: 'That change could not be applied.',
    help: 'Your previous settings are kept. Please try a different change, or start over.',
  },
};

/** 모르는 오류일 때 */
const FALLBACK = {
  title: 'Something went wrong.',
  help: 'Please try again. If it happens again, start over.',
};

/**
 * 오류 → 사용자 안내
 * @param {{ step?: string, code?: string } | null | undefined} error
 * @returns {ErrorHelp}
 */
export function errorHelp(error) {
  if (!error) return FALLBACK;
  // 코드가 구체적이면(LOW_CONFIDENCE 등) 코드 안내를 먼저 쓰고, INVALID_INPUT처럼 넓은 코드는 단계로 나눈다
  if (error.code && error.code !== ERROR_CODE.INVALID_INPUT && BY_CODE[error.code]) return BY_CODE[error.code];
  if (error.step && BY_STEP[error.step]) return BY_STEP[error.step];
  return (error.code && BY_CODE[error.code]) || FALLBACK;
}
