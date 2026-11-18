// @ts-check
/**
 * PART 5 안에서 쓰는 pdf.js 준비 (render-pages.js, validate-pdf.js가 함께 사용)
 * 브라우저에서는 worker 파일을 우리 사이트에서 제공한다 (Vite "?url", 외부 CDN 사용 안 함).
 * Node(테스트)에서는 pdf.js가 알아서 worker 없이 동작한다.
 *
 * PDF를 열 때는 PART 1과 같은 설정(CMap·표준 글꼴·wasm·ICC를 우리 사이트에서 제공)을 쓴다. (#213, #214)
 * 글꼴이 들어 있지 않은 한글 PDF는 CMap이 없으면 그림에서 한글이 빠질 수 있다.
 * PART 1이 글자를 읽은 것과 PART 5가 그린 페이지가 같아야 마스킹 위치도 맞는다.
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { buildPdfDocumentParams } from '../document-input/pdf-reader.js';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

/**
 * PDF 바이트로 pdf.js를 연다. (PART 1과 같은 getDocument 설정)
 * @param {ArrayBuffer} buffer  pdf.js가 넘겨받아 비울 수 있으니, 원본을 계속 써야 하면 복사본을 넘긴다
 */
export function openPdf(buffer) {
  return pdfjsLib.getDocument(buildPdfDocumentParams(buffer));
}

export { pdfjsLib };
