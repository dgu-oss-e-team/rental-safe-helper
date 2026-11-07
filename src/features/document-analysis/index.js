// @ts-check
/**
 * PART 2. 문서 분석 및 개인정보 탐지
 * 담당: docs/OWNERS.md 참고
 *
 * 공개 함수
 *   classifyDocument(document)          → Result<{ documentId, documentType, score }>
 *   detectPII(document)                 → Result<PiiFinding[]>
 *   extractFields(documents, findings)  → Result<ExtractedFields>   (비교용 추출 데이터, PART 3·4가 사용)
 *
 * 지금은 Mock 단계.
 * TODO(PART 2): src/config/templates/의 YAML 템플릿 기반 판별, 정규식 탐지(pii-patterns.js),
 *               항목 추출(field-extractor.js), 이름 탐지(name-detector.js)로 Mock을 교체한다.
 */

import { ok, fail, ERROR_CODE, DOCUMENT_TYPE } from '../../shared/document-model.js';
import {
  mockRegistryFindings,
  mockLeaseFindings,
  mockExtractedFields,
} from '../../shared/mock-data.js';

/** @typedef {import('../../shared/document-model.js').DocumentModel} DocumentModel */
/** @typedef {import('../../shared/document-model.js').PiiFinding} PiiFinding */

/** 판별 키워드 (TODO(PART 2): src/config/templates/*.yaml로 옮기기) */
const KEYWORDS = {
  [DOCUMENT_TYPE.REGISTRY]: ['등기사항', '갑 구', '을 구', '갑구', '을구', '고유번호'],
  [DOCUMENT_TYPE.LEASE_CONTRACT]: ['임대차', '임대인', '임차인', '보증금', '특약'],
};

/**
 * @param {DocumentModel} document
 * @returns {string}
 */
function fullText(document) {
  return document.pages.flatMap((p) => p.blocks.map((b) => b.text)).join('\n');
}

/**
 * 등기부인지 계약서인지 판별한다.
 * @param {DocumentModel} document
 */
export function classifyDocument(document) {
  if (!document?.pages) return fail(ERROR_CODE.INVALID_INPUT, 'Document is missing.');

  const text = fullText(document);
  const scores = Object.entries(KEYWORDS).map(([type, words]) => ({
    type,
    score: words.filter((w) => text.includes(w)).length,
  }));
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const documentType = best.score > 0 ? best.type : DOCUMENT_TYPE.UNKNOWN;

  return ok({ documentId: document.documentId, documentType, score: best.score });
}

/**
 * 문서에서 개인정보를 찾는다.
 * @param {DocumentModel} document
 */
export function detectPII(document) {
  if (!document?.pages) return fail(ERROR_CODE.INVALID_INPUT, 'Document is missing.');

  // TODO(PART 2): 실제 탐지로 교체
  /** @type {Record<string, PiiFinding[]>} */
  const mockByDocument = {
    DOC_REGISTRY: mockRegistryFindings,
    DOC_LEASE: mockLeaseFindings,
  };
  return ok(structuredClone(mockByDocument[document.documentId] ?? []));
}

/**
 * 위험 점검·인물 판별에 필요한 항목(소유자, 임대인, 소재지, 보증금 등)을 뽑는다.
 * 노션 함수 표에는 없지만 assessRisks()의 입력("비교용 추출 데이터")을 만들기 위해 추가한 함수 (docs/INTERFACES.md 참고)
 * @param {DocumentModel[]} documents
 * @param {PiiFinding[]} findings
 */
// eslint-disable-next-line no-unused-vars
export function extractFields(documents, findings) {
  if (!Array.isArray(documents)) return fail(ERROR_CODE.INVALID_INPUT, 'Documents are missing.');
  // TODO(PART 2): 템플릿의 항목 자리 규칙으로 실제 추출
  return ok(structuredClone(mockExtractedFields));
}
