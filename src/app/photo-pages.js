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
 * 칸에 PDF 여러 개, PDF와 사진을 함께 담을 수도 있다 (#298). 공식 계약서 서식에는 특약 칸이 없어서
 * 특약은 별지로 따로 오기 때문이다 (계약서 PDF + 특약 별지 PDF·사진).
 * - 글자 PDF와 사진을 PDF 하나로 합치면 PART 1이 전체를 글자 PDF로 보고 사진 쪽을 읽지 않는다(글자 0줄).
 *   그래서 읽기는 파일(조각)마다 따로 하고(pipeline.js readDocuments의 parts), 읽은 결과를 한 서류로 잇는다(merge-documents.js).
 *   합친 PDF는 마스킹 PDF·미리 보기를 그릴 때만 쓴다.
 *
 * 칸에 담기는 값: PDF 한 개(File) 또는 파일 목록(File[]: 사진·PDF, 1개 이상) 또는 null
 */

import { enhancePhoto } from './photo-enhance.js';

/** 서류 하나에 올릴 수 있는 파일 수 (사진·PDF 합쳐서. 등기부·계약서는 보통 10쪽 이하) */
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
  UNSUPPORTED: 'Only PDF, JPG and PNG files work. Your earlier choice is kept.',
  TOO_MANY: `You can add up to ${MAX_PHOTOS} files for one document. Only the first ${MAX_PHOTOS} were kept.`,
  DUPLICATE: 'A file you chose was already added, so it was not added again.',
};

/**
 * 같은 사진인지 (이름·크기·수정 시각이 모두 같음, #287)
 * 내용까지 비교하지는 않는다. 다른 사진이 세 가지가 모두 같을 일은 거의 없다.
 * @param {File} a
 * @param {File} b
 */
export const isSamePhoto = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * 칸에 새로 고른 파일을 더한 결과: 고른 순서대로 뒤에 덧붙인다 (사진·PDF 섞어도 됨, #298)
 * - 빈 칸에 PDF 한 개면 지금처럼 PDF 한 개(File)로 둔다
 * - PDF·JPG·PNG가 아닌 파일이 있으면 칸을 그대로 두고 안내한다. 같은 파일은 다시 넣지 않는다 (#287)
 * @param {SlotValue} current
 * @param {File[]} picked
 * @returns {{ value: SlotValue, notice: string | null }}
 */
export function addPicked(current, picked) {
  if (picked.length === 0) return { value: current, notice: null };
  if (picked.some((f) => !isPhoto(f) && !isPdf(f))) return { value: current, notice: PHOTO_NOTICE.UNSUPPORTED };
  if (!current && picked.length === 1 && isPdf(picked[0])) return { value: picked[0], notice: null };
  const before = Array.isArray(current) ? current : current ? [current] : [];
  // 이미 있는 사진(또는 이번에 두 번 고른 사진)은 다시 넣지 않는다 (#287)
  /** @type {File[]} */
  const all = [...before];
  let duplicate = false;
  for (const photo of picked) {
    if (all.some((f) => isSamePhoto(f, photo))) duplicate = true;
    else all.push(photo);
  }
  // PDF 한 개만 남으면 지금처럼 PDF 한 개로 둔다
  const tidy = (/** @type {File[]} */ list) => (list.length === 1 && isPdf(list[0]) ? list[0] : list);
  if (all.length > MAX_PHOTOS) return { value: tidy(all.slice(0, MAX_PHOTOS)), notice: PHOTO_NOTICE.TOO_MANY };
  if (duplicate) return { value: all.length > 0 ? tidy(all) : current, notice: PHOTO_NOTICE.DUPLICATE };
  return { value: tidy(all), notice: null };
}

/**
 * 파일 하나를 뺀 결과 (다 빠지면 null, PDF 한 개만 남으면 PDF 한 개로)
 * @param {File[]} files
 * @param {number} index
 * @returns {SlotValue}
 */
export function removePhoto(files, index) {
  const rest = files.filter((_, i) => i !== index);
  if (rest.length === 0) return null;
  return rest.length === 1 && isPdf(rest[0]) ? rest[0] : rest;
}

/**
 * PDF 여러 개를 순서대로 하나로 합친다 (쪽을 그대로 복사, Node에서도 동작). 문서 정보는 넣지 않는다.
 * @param {File[]} pdfs
 * @param {string} name
 * @returns {Promise<File>}
 */
export async function mergePdfFiles(pdfs, name) {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const f of pdfs) {
    const src = await PDFDocument.load(new Uint8Array(await f.arrayBuffer()), { updateMetadata: false });
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  }
  return new File([await out.save()], name, { type: 'application/pdf' });
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
 * 칸 값을 분석에 넘길 모양으로 바꾼다 (#298)
 * - file: 마스킹 PDF·미리 보기를 그릴 PDF 하나 (조각을 순서대로 합친 것)
 * - parts: 따로 읽을 조각. 이어진 사진들은 보정해서 PDF 하나로(#272), PDF는 그대로
 * - items: 조각마다 칸 목록의 몇 번째 파일들인지 (0부터). ② 화면에서 "File 2"처럼 알려 줄 때 쓴다 (#305)
 * PDF 한 개면 { file, parts: [file] }, 사진만이면 사진 PDF 하나, 섞였으면 조각마다 따로 읽고 그릴 때만 합친다.
 * @param {SlotValue} value
 * @param {string} name  합친 PDF 이름 (개인정보 없는 이름, 예 "lease.pdf")
 * @param {{ toPdf?: (photos: File[], name: string) => Promise<File>, merge?: (pdfs: File[], name: string) => Promise<File> }} [deps]  테스트에서 바꿔 끼운다
 * @returns {Promise<{ file: File, parts: File[], items: number[][] } | null>}
 */
export async function slotToSource(value, name, deps = {}) {
  const toPdf = deps.toPdf ?? photosToPdfFile;
  const merge = deps.merge ?? mergePdfFiles;
  if (!value) return null;
  if (!Array.isArray(value)) return { file: value, parts: [value], items: [[0]] };
  if (value.length === 0) return null;
  // 사진만이면 예전처럼 사진 PDF 하나 (이름 그대로)
  if (!value.some(isPdf)) {
    const file = await toPdf(value, name);
    return { file, parts: [file], items: [value.map((_, i) => i)] };
  }
  const base = name.replace(/\.pdf$/i, '');
  /** @type {File[]} */
  const parts = [];
  /** @type {number[][]} */
  const items = [];
  /** @type {File[]} */
  let photos = [];
  /** @type {number[]} */
  let photoItems = [];
  const flush = async () => {
    if (photos.length === 0) return;
    parts.push(await toPdf(photos, `${base}-photos-${parts.length + 1}.pdf`));
    items.push(photoItems);
    photos = [];
    photoItems = [];
  };
  for (const [i, f] of value.entries()) {
    if (isPdf(f)) {
      await flush();
      parts.push(f);
      items.push([i]);
    } else {
      photos.push(f);
      photoItems.push(i);
    }
  }
  await flush();
  if (parts.length === 1) return { file: parts[0], parts, items };
  return { file: await merge(parts, name), parts, items };
}

/**
 * 예전 방식: 칸 값을 PDF 하나로 (사진만 있는 칸에서는 slotToSource와 같다)
 * @param {SlotValue} value
 * @param {string} name
 * @param {(photos: File[], name: string) => Promise<File>} [toPdf]
 * @returns {Promise<File | null>}
 */
export async function slotToFile(value, name, toPdf = photosToPdfFile) {
  return (await slotToSource(value, name, { toPdf }))?.file ?? null;
}
