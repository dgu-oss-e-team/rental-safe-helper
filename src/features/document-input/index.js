// @ts-check
/**
 * PART 1. 문서 입력 및 OCR
 * 담당: docs/OWNERS.md 참고
 *
 * 공개 함수: readDocument(file) → Result<DocumentModel>
 *
 * 지금은 Mock 단계: 파일 형식만 검사하고, 파일 이름에 따라 가짜 등기부/계약서를 돌려준다.
 * TODO(PART 1): pdf.js 텍스트 추출, 이미지형 PDF 렌더링, OpenCV.js 보정, Tesseract.js OCR,
 *               좌표 0~1 정규화, OCR 결과 수정 화면을 구현해 Mock을 교체한다.
 *               계획한 파일: file-reader.js, pdf-reader.js, image-preprocess.js, ocr.js,
 *               ocr-editor.js, document-normalizer.js
 */

import { ok, fail, ERROR_CODE } from '../../shared/document-model.js';
import { mockRegistryDocument, mockLeaseDocument } from '../../shared/mock-data.js';

/** @typedef {import('../../shared/document-model.js').DocumentModel} DocumentModel */

const SUPPORTED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const SUPPORTED_EXT = ['.pdf', '.jpg', '.jpeg', '.png'];

/**
 * 지원하는 파일인지 확인한다.
 * @param {{ name?: string, type?: string } | null | undefined} file
 * @returns {boolean}
 */
export function isSupportedFile(file) {
  if (!file || typeof file.name !== 'string') return false;
  const name = file.name.toLowerCase();
  const byExt = SUPPORTED_EXT.some((ext) => name.endsWith(ext));
  const byMime = typeof file.type === 'string' && SUPPORTED_MIME.includes(file.type);
  return byExt || byMime;
}

/**
 * PDF 또는 이미지 파일을 읽어 DocumentModel로 만든다.
 * @param {File} file
 * @returns {Promise<import('../../shared/document-model.js').Result<DocumentModel>>}
 */
export async function readDocument(file) {
  if (!isSupportedFile(file)) {
    return fail(ERROR_CODE.UNSUPPORTED_FILE, 'Please upload a PDF, JPG, or PNG file.');
  }

  // TODO(PART 1): 아래 Mock 선택을 실제 읽기 결과로 교체
  console.log('Processing file:', file.name, file.type);
  
  const name = file.name.toLowerCase();
  const looksLikeRegistry = /registry|register|등기/.test(name);
  const mock = looksLikeRegistry ? mockRegistryDocument : mockLeaseDocument;
  return ok(structuredClone(mock));
}