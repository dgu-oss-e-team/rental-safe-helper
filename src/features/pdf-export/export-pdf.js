// @ts-check
/**
 * PART 5. 마스킹된 페이지 이미지로 새 PDF를 만든다. (pdf-lib, 브라우저·Node 모두 동작)
 *
 * 원본 PDF를 고치는 것이 아니라 "이미지만 들어 있는 새 PDF"를 만든다.
 * 그래서 원본의 글자 정보(텍스트 레이어)·첨부·스크립트가 새 PDF로 넘어오지 않는다.
 */

import { PDFDocument } from 'pdf-lib';
import { cleanMetadata } from './metadata-cleaner.js';

/**
 * @typedef {Object} PageImage
 * @property {Uint8Array} bytes  JPEG 또는 PNG
 * @property {'jpeg' | 'png'} format
 * @property {number} widthPt  PDF 페이지 너비 (포인트)
 * @property {number} heightPt  PDF 페이지 높이 (포인트)
 */

/**
 * 페이지 이미지 목록으로 새 PDF를 만든다.
 * @param {PageImage[]} pages
 * @returns {Promise<Uint8Array>}
 */
export async function buildImageOnlyPdf(pages) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('NO_PAGES');

  // updateMetadata: false → pdf-lib가 Producer/Creator/날짜를 자동으로 넣지 않는다
  const pdf = await PDFDocument.create({ updateMetadata: false });
  for (const p of pages) {
    const image = p.format === 'png' ? await pdf.embedPng(p.bytes) : await pdf.embedJpg(p.bytes);
    const page = pdf.addPage([p.widthPt, p.heightPt]);
    page.drawImage(image, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
  }
  cleanMetadata(pdf);
  return pdf.save({ updateFieldAppearances: false });
}
