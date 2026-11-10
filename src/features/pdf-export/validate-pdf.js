// @ts-check
/**
 * PART 5. 만든 PDF 검증
 *
 * 만든 PDF를 pdf.js로 다시 열어서 확인한다.
 *   1) 어떤 페이지에서도 글자가 추출되지 않는다 (복사·검색으로 원문이 나오지 않음)
 *   2) 문서 정보(제목·작성자·주제·키워드·만든 프로그램)가 비어 있다
 * 하나라도 어기면 실패를 돌려준다. 메시지에는 실제 값을 넣지 않는다.
 */

import { pdfjsLib } from './pdfjs.js';
import { ok, fail, ERROR_CODE } from '../../shared/document-model.js';

const INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'];

/**
 * @param {Uint8Array} pdfBytes
 * @returns {Promise<import('../../shared/document-model.js').Result<{ pageCount: number }>>}
 */
export async function validateMaskedPdf(pdfBytes) {
  // pdf.js가 버퍼를 넘겨받아 비울 수 있으므로 복사본을 넘긴다
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
  const pdf = await loadingTask.promise;
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const hasText = content.items.some((item) => 'str' in item && item.str.trim() !== '');
      if (hasText) {
        return fail(ERROR_CODE.PDF_EXPORT_FAILED, `Text was found on page ${i} of the masked PDF.`);
      }
    }

    const { info } = await pdf.getMetadata();
    const filled = INFO_KEYS.filter((key) => {
      const value = /** @type {Record<string, unknown>} */ (info ?? {})[key];
      return typeof value === 'string' && value.trim() !== '';
    });
    if (filled.length > 0) {
      return fail(ERROR_CODE.PDF_EXPORT_FAILED, `Document info is not empty: ${filled.join(', ')}.`);
    }
    return ok({ pageCount: pdf.numPages });
  } finally {
    // pdf.js 6: 문서는 loadingTask로 닫는다
    await loadingTask.destroy();
  }
}
