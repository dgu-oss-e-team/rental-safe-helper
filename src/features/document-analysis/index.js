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
 * 현재 상태: detectPII()는 정규식 탐지(pii-patterns.js) 사용. 이름·주소는 이슈 ④ 전까지 Mock 보충.
 *           classifyDocument()는 키워드 개수 비교(띄어쓰기 무시, 동점이면 UNKNOWN), extractFields()는 아직 Mock.
 * TODO(PART 2): src/config/templates/의 YAML 템플릿 기반 판별, 정규식 탐지(pii-patterns.js),
 *               항목 추출(field-extractor.js), 이름 탐지(name-detector.js)로 Mock을 교체한다.
 */

import { ok, fail, ERROR_CODE, DOCUMENT_TYPE, PII_TYPE, REVIEW_STATUS } from '../../shared/document-model.js';
import { findPatternPII } from './pii-patterns.js';
import {
  mockRegistryFindings,
  mockLeaseFindings,
  mockExtractedFields,
} from '../../shared/mock-data.js';

/** @typedef {import('../../shared/document-model.js').DocumentModel} DocumentModel */
/** @typedef {import('../../shared/document-model.js').PiiFinding} PiiFinding */

/**
 * 판별 키워드 (TODO(PART 2): src/config/templates/*.yaml로 옮기기)
 * 띄어쓰기를 지우고 비교하므로 '갑 구'와 '갑구'를 따로 넣지 않는다(두 번 세어짐).
 * 키워드·띄어쓰기 처리 참고: PR #18 (Garid1016)
 */
const KEYWORDS = {
  [DOCUMENT_TYPE.REGISTRY]: ['등기사항', '등기부등본', '표제부', '갑구', '을구', '고유번호'],
  [DOCUMENT_TYPE.LEASE_CONTRACT]: ['임대차', '부동산임대차계약서', '임대인', '임차인', '보증금', '특약'],
};

/** @param {string} s */
const removeSpaces = (s) => s.replace(/\s+/g, '');

/**
 * @param {DocumentModel} document
 * @returns {string}
 */
function fullText(document) {
  return document.pages.flatMap((p) => p.blocks.map((b) => b.text)).join('\n');
}

/**
 * 등기부인지 계약서인지 판별한다.
 * 문서 종류별 키워드가 몇 개 들어 있는지 세서 더 많은 쪽으로 정한다.
 * 계약서에 "등기사항전부증명서 확인"이 들어가도 계약서 키워드가 더 많으면 계약서가 된다.
 * OCR이 "갑 구"처럼 띄어 읽어도 잡히도록 띄어쓰기를 지우고 비교한다.
 * 개수가 같으면(0개 포함) 어느 쪽인지 알 수 없으므로 UNKNOWN.
 * @param {DocumentModel} document
 */
export function classifyDocument(document) {
  if (!document?.pages) return fail(ERROR_CODE.INVALID_INPUT, 'Document is missing.');

  const text = removeSpaces(fullText(document));
  const scores = Object.entries(KEYWORDS).map(([type, words]) => ({
    type,
    score: words.filter((w) => text.includes(removeSpaces(w))).length,
  }));
  scores.sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  const isTie = best.score === second.score;
  const documentType = best.score > 0 && !isTie ? best.type : DOCUMENT_TYPE.UNKNOWN;

  return ok({ documentId: document.documentId, documentType, score: best.score });
}

/** OCR 신뢰도가 이 값보다 낮으면 사용자 확인이 필요하다고 표시한다. */
const LOW_CONFIDENCE = 0.8;

/**
 * 아직 PART 2가 직접 찾지 못하는 개인정보 종류.
 * TODO(PART 2 이슈 ④): 이름·주소 탐지를 만들면 이 목록과 아래 Mock 보충을 지운다.
 */
/** @type {string[]} */
const NOT_YET_DETECTED_TYPES = [PII_TYPE.PERSON_NAME, PII_TYPE.ADDRESS];

/**
 * 문서에서 개인정보를 찾는다.
 * @param {DocumentModel} document
 */
export function detectPII(document) {
  if (!document?.pages) return fail(ERROR_CODE.INVALID_INPUT, 'Document is missing.');

  /** @type {PiiFinding[]} */
  const findings = [];
  let seq = 0;

  // 1. 글자 블록마다 정규식 탐지를 돌린다.
  for (const page of document.pages) {
    for (const block of page.blocks) {
      for (const hit of findPatternPII(block.text)) {
        seq += 1;
        const lowConfidence = block.confidence !== null && block.confidence < LOW_CONFIDENCE;
        findings.push({
          id: `PII_${document.documentId}_${String(seq).padStart(3, '0')}`,
          type: hit.type,
          value: hit.value,
          documentId: document.documentId,
          pageIndex: page.pageIndex,
          blockId: block.blockId,
          // TODO(PART 2): PART 1이 단어 단위 좌표(words)를 주면 개인정보 부분만 가리도록 좁힌다.
          // 지금은 블록 전체 좌표를 쓴다. 더 넓게 가리는 쪽이라 개인정보가 새지 않는다.
          bbox: { ...block.bbox },
          confidence: block.confidence,
          reviewStatus:
            hit.uncertain || lowConfidence ? REVIEW_STATUS.NEEDS_REVIEW : REVIEW_STATUS.DETECTED,
        });
      }
    }
  }

  // 2. 이름·주소는 이슈 ④ 전까지 Mock 결과로 보충한다. (데모와 PART 4 연결 유지)
  /** @type {Record<string, PiiFinding[]>} */
  const mockByDocument = {
    DOC_REGISTRY: mockRegistryFindings,
    DOC_LEASE: mockLeaseFindings,
  };
  const pending = (mockByDocument[document.documentId] ?? []).filter((f) =>
    NOT_YET_DETECTED_TYPES.includes(f.type),
  );
  findings.push(...structuredClone(pending));

  return ok(findings);
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
