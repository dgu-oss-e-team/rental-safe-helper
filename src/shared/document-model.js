// @ts-check
/**
 * 공통 데이터 규격 (docs/INTERFACES.md와 같은 내용)
 *
 * 모든 파트가 이 파일의 코드값과 형식을 그대로 사용한다.
 * 이 파일을 바꿀 때는 이 값을 쓰는 팀원에게 먼저 알리고, docs/INTERFACES.md도 함께 고친 뒤 PR로 리뷰를 받는다.
 */

/** 문서 종류 */
export const DOCUMENT_TYPE = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  REGISTRY: 'REGISTRY', // 등기사항전부증명서(등기부등본)
  LEASE_CONTRACT: 'LEASE_CONTRACT', // 주택임대차계약서
});

/** 입력 종류 */
export const SOURCE_TYPE = Object.freeze({
  TEXT_PDF: 'text_pdf',
  IMAGE_PDF: 'image_pdf',
  IMAGE: 'image',
});

/** 개인정보 종류 */
export const PII_TYPE = Object.freeze({
  PERSON_NAME: 'PERSON_NAME',
  RESIDENT_ID: 'RESIDENT_ID',
  FOREIGNER_ID: 'FOREIGNER_ID',
  PASSPORT_ID: 'PASSPORT_ID',
  PHONE_NUMBER: 'PHONE_NUMBER',
  BANK_ACCOUNT: 'BANK_ACCOUNT',
  ADDRESS: 'ADDRESS',
  REGISTRY_ID: 'REGISTRY_ID',
});

/** 개인정보 탐지 결과의 검토 상태 */
export const REVIEW_STATUS = Object.freeze({
  DETECTED: 'DETECTED', // 자동 탐지됨
  NEEDS_REVIEW: 'NEEDS_REVIEW', // OCR 신뢰도가 낮거나 애매함 → 사용자 확인 필요
  CONFIRMED: 'CONFIRMED', // 사용자가 확인함
  USER_ADDED: 'USER_ADDED', // 사용자가 직접 추가함
  REJECTED: 'REJECTED', // 사용자가 개인정보가 아니라고 해제함
});

/** 위험 점검 상태 */
export const RISK_STATUS = Object.freeze({
  STOP: 'STOP', // 위험
  CHECK: 'CHECK', // 확인 필요
  NO_FLAG: 'NO_FLAG', // 확인한 범위에서 위험 신호 없음 (안전하다는 뜻이 아님)
  UNVERIFIABLE: 'UNVERIFIABLE', // 확인 불가 (읽지 못한 정보는 반드시 이것)
});

/** 마스킹 목적 */
export const MASKING_PURPOSE = Object.freeze({
  CLAUSE_EXPLANATION: 'CLAUSE_EXPLANATION', // 조항·용어 설명
  FRAUD_CHECK: 'FRAUD_CHECK', // 사기 위험 확인
  CONTRACT_EXPLANATION: 'CONTRACT_EXPLANATION', // 계약 조건 설명
});

/** 마스킹 작업 */
export const MASKING_ACTION = Object.freeze({
  REDACT: 'REDACT', // 완전히 가리기
  REPLACE: 'REPLACE', // 역할 가명 등으로 교체
  KEEP: 'KEEP', // 유지
});

/** 오류 코드 */
export const ERROR_CODE = Object.freeze({
  UNSUPPORTED_FILE: 'UNSUPPORTED_FILE',
  PDF_READ_FAILED: 'PDF_READ_FAILED',
  OCR_FAILED: 'OCR_FAILED',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  COORDINATE_INVALID: 'COORDINATE_INVALID',
  PDF_EXPORT_FAILED: 'PDF_EXPORT_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
});

/**
 * 좌표: 페이지 왼쪽 위 기준, 0~1 정규화, 회전·보정이 끝난 페이지 기준
 * @typedef {{ x: number, y: number, width: number, height: number }} BBox
 */

/**
 * @typedef {Object} Block
 * @property {string} blockId
 * @property {string} text
 * @property {BBox} bbox
 * @property {number | null} confidence  PDF 텍스트 추출은 null
 */

/**
 * @typedef {Object} Page
 * @property {number} pageIndex  0부터 시작
 * @property {number} width  픽셀
 * @property {number} height  픽셀
 * @property {Block[]} blocks
 */

/**
 * PART 1이 반환하는 문서
 * @typedef {Object} DocumentModel
 * @property {string} documentId
 * @property {string} documentType  DOCUMENT_TYPE 값
 * @property {string} sourceType  SOURCE_TYPE 값
 * @property {Page[]} pages
 */

/**
 * PART 2가 반환하는 개인정보 탐지 결과 한 건
 * @typedef {Object} PiiFinding
 * @property {string} id
 * @property {string} type  PII_TYPE 값
 * @property {string} value
 * @property {string} documentId
 * @property {number} pageIndex
 * @property {string} blockId
 * @property {BBox} bbox
 * @property {number | null} confidence
 * @property {string} reviewStatus  REVIEW_STATUS 값
 */

/**
 * PART 3이 반환하는 위험 점검 결과 한 건
 * @typedef {Object} RiskResult
 * @property {string} ruleId
 * @property {string} status  RISK_STATUS 값
 * @property {string} title
 * @property {string} explanation
 * @property {string} action
 * @property {{ left: { label: string, value: string }, right: { label: string, value: string } }} [evidence]
 *   화면 근거 칸 전용(선택). 실제 이름·주소가 들어갈 수 있으므로 AI 프롬프트에 절대 넣지 않는다.
 */

/**
 * PART 4가 반환하는 마스킹 계획
 * @typedef {Object} MaskingPlan
 * @property {string} purpose  MASKING_PURPOSE 값
 * @property {Array<{ findingId: string, action: string, replacement: string | null,
 *   documentId: string, pageIndex: number, bbox: BBox }>} items
 */

/**
 * 모든 기능의 반환 형식
 * @template T
 * @typedef {{ ok: true, data: T } | { ok: false, error: { code: string, message: string } }} Result
 */

/**
 * 성공 결과를 만든다.
 * @template T
 * @param {T} data
 * @returns {{ ok: true, data: T }}
 */
export function ok(data) {
  return { ok: true, data };
}

/**
 * 실패 결과를 만든다. message에는 실제 개인정보를 절대 넣지 않는다.
 * @param {string} code  ERROR_CODE 값
 * @param {string} message  영어 안내 문장
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
export function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * 좌표가 규칙(0~1 정규화, 페이지 밖으로 나가지 않음)을 지키는지 확인한다.
 * @param {unknown} bbox
 * @returns {boolean}
 */
export function isValidBBox(bbox) {
  if (!bbox || typeof bbox !== 'object') return false;
  const { x, y, width, height } = /** @type {Record<string, unknown>} */ (bbox);
  const nums = [x, y, width, height];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  const [bx, by, bw, bh] = /** @type {number[]} */ (nums);
  return bx >= 0 && by >= 0 && bw > 0 && bh > 0 && bx + bw <= 1 && by + bh <= 1;
}
