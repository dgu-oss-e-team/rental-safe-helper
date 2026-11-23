// @ts-check
/**
 * PART 5. 서류 칸 하나에 사진 여러 장 올리기 (#268)
 *
 * 휴대폰으로 서류를 한 쪽씩 찍으면 사진이 여러 장이 된다. 사진을 순서대로 한 쪽씩 PDF 하나로 합쳐서 읽는다.
 * - 합친 PDF는 "그림만 있는 PDF" 흐름(쪽마다 그림 → OCR)을 그대로 탄다. PART 1 코드·DocumentModel은 그대로다.
 * - 모두 브라우저 안에서 한다. 사진은 어디에도 보내지 않는다.
 * - 사진을 다시 그려서 넣으므로 사진의 위치(GPS)·기기 정보(EXIF)는 PDF에 들어가지 않는다.
 * - 다시 그릴 때 종이만 잘라내고 그림자를 지운다 (photo-enhance.js, #272). 사진 1장도 같은 방법으로 처리한다.
 *
 * 칸에 담기는 값: PDF 한 개(File) 또는 사진 목록(File[], 1장 이상) 또는 null
 */

import { enhancePhoto } from './photo-enhance.js';

/** 서류 하나에 올릴 수 있는 사진 수 (등기부·계약서는 보통 10쪽 이하) */
export const MAX_PHOTOS = 10;

/** 사진을 다시 그릴 때 가장 긴 변의 최대 픽셀 (OCR에 충분하고 휴대폰 메모리에 부담이 적다) */
export const MAX_PHOTO_PIXELS = 2000;

/** 사진 1px = 72/150pt (render-pages.js의 사진 해상도 가정과 같다). 2000px → 960pt, 2배로 그리면 1920px */
const POINTS_PER_PIXEL = 72 / 150;

/** @typedef {File | File[] | null} SlotValue */

/**
 * 사진(JPG·PNG)인지
 * @param {File} file
 */
export function isPhoto(file) {
  const type = file.type ?? '';
  if (type === 'image/jpeg' || type === 'image/png') return true;
  return /\.(jpe?g|png)$/i.test(file.name ?? '');
}

/**
 * PDF인지
 * @param {File} file
 */
export function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '');
}

/** 화면 안내 (개인정보 없음, 정해진 문구만) */
export const PHOTO_NOTICE = {
  MIXED: 'Choose either one PDF or photos, not both. Your earlier choice is kept.',
  ONE_PDF: 'Choose one PDF at a time. Your earlier choice is kept.',
  UNSUPPORTED: 'Only PDF, JPG and PNG files work. Your earlier choice is kept.',
  TOO_MANY: `You can add up to ${MAX_PHOTOS} photos for one document. Only the first ${MAX_PHOTOS} were kept.`,
};

/**
 * 칸에 새로 고른 파일을 더한 결과
 * - PDF 한 개: 칸을 그 PDF로 바꾼다 (전에 있던 사진·PDF는 없어진다)
 * - 사진: 전에 사진이 있으면 뒤에 덧붙이고, PDF가 있었으면 사진으로 바꾼다
 * - PDF와 사진을 섞거나, PDF를 여러 개 고르거나, 다른 형식이면 그대로 두고 안내한다
 * @param {SlotValue} current
 * @param {File[]} picked
 * @returns {{ value: SlotValue, notice: string | null }}
 */
export function addPicked(current, picked) {
  if (picked.length === 0) return { value: current, notice: null };
  if (picked.some((f) => !isPhoto(f) && !isPdf(f))) return { value: current, notice: PHOTO_NOTICE.UNSUPPORTED };
  const pdfs = picked.filter(isPdf);
  if (pdfs.length > 0) {
    if (pdfs.length < picked.length) return { value: current, notice: PHOTO_NOTICE.MIXED };
    if (pdfs.length > 1) return { value: current, notice: PHOTO_NOTICE.ONE_PDF };
    return { value: pdfs[0], notice: null };
  }
  const before = Array.isArray(current) ? current : [];
  const all = [...before, ...picked];
  if (all.length > MAX_PHOTOS) return { value: all.slice(0, MAX_PHOTOS), notice: PHOTO_NOTICE.TOO_MANY };
  return { value: all, notice: null };
}

/**
 * 사진 한 장을 뺀 결과 (다 빠지면 null)
 * @param {File[]} photos
 * @param {number} index
 * @returns {File[] | null}
 */
export function removePhoto(photos, index) {
  const rest = photos.filter((_, i) => i !== index);
  return rest.length > 0 ? rest : null;
}

/**
 * 사진 크기(px)에 맞는 PDF 쪽 크기(pt)
 * @param {number} width
 * @param {number} height
 */
export function pageSizeFor(width, height) {
  return { width: width * POINTS_PER_PIXEL, height: height * POINTS_PER_PIXEL };
}

/**
 * 사진들(이미 다시 그린 JPEG·PNG 바이트)로 PDF를 만든다. 한 장 = 한 쪽, 순서 그대로. (Node에서도 동작)
 * 문서 정보(만든 프로그램·날짜 등)는 넣지 않는다.
 * @param {{ bytes: Uint8Array, format: 'jpg' | 'png', width: number, height: number }[]} pages
 * @returns {Promise<Uint8Array>}
 */
export async function buildPhotoPdf(pages) {
  // pdf-lib는 사진을 합칠 때만 불러온다 (첫 화면을 가볍게)
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create({ updateMetadata: false });
  for (const p of pages) {
    const image = p.format === 'png' ? await pdf.embedPng(p.bytes) : await pdf.embedJpg(p.bytes);
    const size = pageSizeFor(p.width, p.height);
    const page = pdf.addPage([size.width, size.height]);
    page.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
  }
  return pdf.save();
}

/**
 * 사진 한 장을 다시 그린다 (브라우저 전용)
 * - 휴대폰 사진의 회전 정보(EXIF)를 반영해서 바로 세운다 (createImageBitmap이 회전을 적용한다)
 * - 가장 긴 변을 MAX_PHOTO_PIXELS 이하로 줄인다
 * - JPEG로 다시 만들어서 사진의 위치·기기 정보가 남지 않는다
 * - 종이만 잘라내고 그림자를 지운 회색조로 만든다 (#272, OCR 정확도)
 * @param {File} file
 * @returns {Promise<{ bytes: Uint8Array, format: 'jpg', width: number, height: number }>}
 */
async function redrawPhoto(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = enhancePhoto(bitmap, MAX_PHOTO_PIXELS);
  const { width, height } = canvas;
  bitmap.close?.();
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PHOTO_ENCODE_FAILED'))), 'image/jpeg', 0.92),
  );
  canvas.width = 0;
  canvas.height = 0;
  return { bytes: new Uint8Array(await /** @type {Blob} */ (blob).arrayBuffer()), format: 'jpg', width, height };
}

/**
 * 사진(1장 이상)을 PDF 파일 하나로 합친다 (브라우저 전용)
 * @param {File[]} photos
 * @param {string} name  PDF 파일 이름 (개인정보 없는 이름)
 * @returns {Promise<File>}
 */
export async function photosToPdfFile(photos, name) {
  /** @type {{ bytes: Uint8Array, format: 'jpg', width: number, height: number }[]} */
  const pages = [];
  // 한 장씩 차례로 (휴대폰 메모리에 큰 사진을 한꺼번에 올리지 않게)
  for (const photo of photos) pages.push(await redrawPhoto(photo));
  const bytes = await buildPhotoPdf(pages);
  return new File([bytes], name, { type: 'application/pdf' });
}

/**
 * 칸 값을 분석에 넘길 파일 하나로 바꾼다
 * - PDF·null은 그대로, 사진은 1장이어도 보정해서 PDF 하나로 만든다 (#272: 1장과 여러 장을 같은 방법으로, #269 리뷰)
 * @param {SlotValue} value
 * @param {string} name  합친 PDF 이름
 * @param {(photos: File[], name: string) => Promise<File>} [toPdf]  테스트에서 바꿔 끼운다
 * @returns {Promise<File | null>}
 */
export async function slotToFile(value, name, toPdf = photosToPdfFile) {
  if (!value) return null;
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return null;
  return toPdf(value, name);
}
