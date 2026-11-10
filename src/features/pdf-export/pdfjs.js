// @ts-check
/**
 * PART 5 안에서 쓰는 pdf.js 준비 (render-pages.js, validate-pdf.js가 함께 사용)
 * 브라우저에서는 worker 파일을 우리 사이트에서 제공한다 (Vite "?url", 외부 CDN 사용 안 함).
 * Node(테스트)에서는 pdf.js가 알아서 worker 없이 동작한다.
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// @ts-ignore
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

export { pdfjsLib };
