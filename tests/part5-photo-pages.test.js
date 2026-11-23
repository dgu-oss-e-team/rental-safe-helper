// PART 5. 서류 칸 하나에 사진 여러 장 올리기 (#268). 가상 파일만 사용한다.
import { describe, it, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  addPicked,
  removePhoto,
  pageSizeFor,
  buildPhotoPdf,
  slotToFile,
  slotToSource,
  mergePdfFiles,
  isPhoto,
  MAX_PHOTOS,
  PHOTO_NOTICE,
} from '../src/app/photo-pages.js';

const photo = (name, type = 'image/jpeg') => new File(['x'], name, { type });
const pdf = (name) => new File(['x'], name, { type: 'application/pdf' });
const names = (v) => (Array.isArray(v) ? v.map((f) => f.name) : v?.name ?? null);

// 1×1 흰색 PNG
const TINY_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

describe('PART 5 사진 여러 장: 칸에 더하기 (#268)', () => {
  it('사진은 고를 때마다 뒤에 덧붙는다 (바꿔치기 하지 않음)', () => {
    const one = addPicked(null, [photo('p1.jpg')]);
    expect(names(one.value)).toEqual(['p1.jpg']);
    const two = addPicked(one.value, [photo('p2.jpg')]);
    expect(names(two.value)).toEqual(['p1.jpg', 'p2.jpg']);
    // 갤러리에서 한 번에 여러 장
    const many = addPicked(two.value, [photo('p3.png', 'image/png'), photo('p4.jpg')]);
    expect(names(many.value)).toEqual(['p1.jpg', 'p2.jpg', 'p3.png', 'p4.jpg']);
    expect(many.notice).toBeNull();
  });

  it('빈 칸에 PDF 한 개를 고르면 PDF 한 개(File)로 둔다', () => {
    const a = pdf('a.pdf');
    expect(addPicked(null, [a])).toEqual({ value: a, notice: null });
  });

  it('PDF가 있는 칸에 PDF·사진을 더 고르면 바꾸지 않고 뒤에 덧붙인다 (특약 별지, #298)', () => {
    expect(names(addPicked(pdf('lease.pdf'), [pdf('terms.pdf')]).value)).toEqual(['lease.pdf', 'terms.pdf']);
    expect(names(addPicked(pdf('lease.pdf'), [photo('terms.jpg')]).value)).toEqual(['lease.pdf', 'terms.jpg']);
    expect(names(addPicked([photo('p1.jpg')], [pdf('a.pdf')]).value)).toEqual(['p1.jpg', 'a.pdf']);
  });

  it('PDF와 사진, PDF 여러 개를 한 번에 골라도 고른 순서대로 담는다 (#298)', () => {
    const r = addPicked([photo('p1.jpg')], [pdf('a.pdf'), photo('p2.jpg'), pdf('b.pdf')]);
    expect(r).toEqual({ value: expect.any(Array), notice: null });
    expect(names(r.value)).toEqual(['p1.jpg', 'a.pdf', 'p2.jpg', 'b.pdf']);
    expect(names(addPicked(null, [pdf('a.pdf'), pdf('b.pdf')]).value)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('removePhoto(): 하나를 빼고 PDF 한 개만 남으면 PDF 한 개로, 다 빠지면 null (#298)', () => {
    const a = pdf('a.pdf');
    expect(removePhoto([a, photo('t.jpg')], 1)).toBe(a);
    expect(names(removePhoto([a, photo('t.jpg'), photo('u.jpg')], 0))).toEqual(['t.jpg', 'u.jpg']);
    expect(removePhoto([a], 0)).toBeNull();
  });

  it('PDF·JPG·PNG가 아닌 파일이 있으면 그대로 두고 안내한다', () => {
    const current = [photo('p1.jpg')];
    expect(addPicked(current, [pdf('a.pdf'), new File(['x'], 'a.docx', { type: 'application/msword' })])).toEqual({
      value: current,
      notice: PHOTO_NOTICE.UNSUPPORTED,
    });
    expect(addPicked(current, [new File(['x'], 'a.heic', { type: 'image/heic' })])).toEqual({
      value: current,
      notice: PHOTO_NOTICE.UNSUPPORTED,
    });
  });

  it(`사진은 서류 하나에 ${MAX_PHOTOS}장까지 (넘으면 앞에서부터 ${MAX_PHOTOS}장만 두고 안내)`, () => {
    const nine = Array.from({ length: 9 }, (_, i) => photo(`p${i + 1}.jpg`));
    const r = addPicked(nine, [photo('p10.jpg'), photo('p11.jpg')]);
    expect(r.value).toHaveLength(MAX_PHOTOS);
    expect(names(r.value).at(-1)).toBe('p10.jpg');
    expect(r.notice).toBe(PHOTO_NOTICE.TOO_MANY);
  });

  it('같은 사진(이름·크기·수정 시각이 같음)은 다시 넣지 않고 안내한다 (#287)', () => {
    const same = (name) => new File(['xx'], name, { type: 'image/jpeg', lastModified: 1 });
    const p1 = same('p1.jpg');
    // 이미 있는 사진을 다시 고름
    const again = addPicked([p1], [same('p1.jpg')]);
    expect(names(again.value)).toEqual(['p1.jpg']);
    expect(again.notice).toBe(PHOTO_NOTICE.DUPLICATE);
    // 새 사진과 같이 고르면 새 사진만 들어간다
    const mixed = addPicked([p1], [same('p1.jpg'), same('p2.jpg')]);
    expect(names(mixed.value)).toEqual(['p1.jpg', 'p2.jpg']);
    expect(mixed.notice).toBe(PHOTO_NOTICE.DUPLICATE);
    // 한 번에 같은 사진을 두 번 골라도 한 장
    expect(names(addPicked(null, [same('p3.jpg'), same('p3.jpg')]).value)).toEqual(['p3.jpg']);
    // 이름만 같고 다른 사진(크기·시각이 다름)은 넣는다
    const other = new File(['yyyy'], 'p1.jpg', { type: 'image/jpeg', lastModified: 2 });
    expect(addPicked([p1], [other]).value).toHaveLength(2);
  });

  it('빈 선택(고르기 창 취소)은 아무것도 바꾸지 않는다', () => {
    const current = [photo('p1.jpg')];
    expect(addPicked(current, [])).toEqual({ value: current, notice: null });
  });

  it('removePhoto(): 한 장만 빼고, 다 빠지면 null', () => {
    const list = [photo('p1.jpg'), photo('p2.jpg'), photo('p3.jpg')];
    expect(names(removePhoto(list, 1))).toEqual(['p1.jpg', 'p3.jpg']);
    expect(removePhoto([photo('p1.jpg')], 0)).toBeNull();
  });

  it('isPhoto(): 형식이 비어 있어도 이름(.jpg, .jpeg, .png)으로 안다', () => {
    expect(isPhoto(new File(['x'], 'IMG_0001.JPG'))).toBe(true);
    expect(isPhoto(new File(['x'], 'scan.pdf'))).toBe(false);
  });
});

describe('PART 5 사진 여러 장 → PDF 하나 (#268)', () => {
  it('쪽 크기: 사진 1px = 72/150pt (사진 해상도 가정과 같음)', () => {
    expect(pageSizeFor(1500, 2000)).toEqual({ width: 720, height: 960 });
  });

  it('사진마다 한 쪽, 순서 그대로, 문서 정보(만든 프로그램·날짜)는 넣지 않는다', async () => {
    const bytes = await buildPhotoPdf([
      { bytes: TINY_PNG, format: 'png', width: 1000, height: 1400 },
      { bytes: TINY_PNG, format: 'png', width: 1200, height: 1600 },
      { bytes: TINY_PNG, format: 'png', width: 1400, height: 1800 },
    ]);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([480, 576, 672]);
    expect(doc.getProducer()).toBeUndefined();
    expect(doc.getCreator()).toBeUndefined();
    expect(doc.getCreationDate()).toBeUndefined();
  });

  it('slotToFile(): PDF는 그대로, 사진은 1장이어도 보정해서 PDF로 만든다 (#272), 빈 칸은 null', async () => {
    const toPdf = vi.fn(async (_photos, name) => pdf(name));
    const a = pdf('a.pdf');
    expect(await slotToFile(a, 'x.pdf', toPdf)).toBe(a);
    expect(await slotToFile(null, 'x.pdf', toPdf)).toBeNull();
    expect(await slotToFile([], 'x.pdf', toPdf)).toBeNull();
    expect(toPdf).not.toHaveBeenCalled();
    const p1 = photo('p1.jpg');
    expect((await slotToFile([p1], 'lease-photos.pdf', toPdf))?.name).toBe('lease-photos.pdf');
    const merged = await slotToFile([p1, photo('p2.jpg')], 'registry-photos.pdf', toPdf);
    expect(merged?.name).toBe('registry-photos.pdf');
    expect(toPdf).toHaveBeenCalledTimes(2);
    expect(names(toPdf.mock.calls[0][0])).toEqual(['p1.jpg']);
    expect(names(toPdf.mock.calls[1][0])).toEqual(['p1.jpg', 'p2.jpg']);
  });
});

describe('PART 5 칸에 PDF·사진 섞기 → 따로 읽을 조각 (#298)', () => {
  const toPdfMock = () => vi.fn(async (photos, name) => pdf(name));
  const mergeMock = () => vi.fn(async (_pdfs, name) => pdf(name));

  it('PDF 한 개면 그 파일이 그릴 PDF이자 조각 하나다 (합치지 않음)', async () => {
    const merge = mergeMock();
    const a = pdf('a.pdf');
    expect(await slotToSource(a, 'lease.pdf', { merge })).toEqual({ file: a, parts: [a], items: [[0]] });
    expect(merge).not.toHaveBeenCalled();
    expect(await slotToSource(null, 'lease.pdf', { merge })).toBeNull();
  });

  it('사진만이면 사진 PDF 하나 (예전과 같음)', async () => {
    const toPdf = toPdfMock();
    const merge = mergeMock();
    const r = await slotToSource([photo('p1.jpg'), photo('p2.jpg')], 'lease.pdf', { toPdf, merge });
    expect(r?.file.name).toBe('lease.pdf');
    expect(r?.parts).toEqual([r?.file]);
    expect(r?.items).toEqual([[0, 1]]);
    expect(merge).not.toHaveBeenCalled();
  });

  it('PDF + 사진: 이어진 사진끼리 묶어 PDF로 만들고, 조각을 순서대로 합친 PDF로 그린다', async () => {
    const toPdf = toPdfMock();
    const merge = mergeMock();
    const lease = pdf('my-lease.pdf');
    const terms = pdf('terms.pdf');
    const r = await slotToSource([lease, photo('t1.jpg'), photo('t2.jpg'), terms, photo('t3.jpg')], 'lease.pdf', { toPdf, merge });
    expect(toPdf).toHaveBeenCalledTimes(2);
    expect(names(toPdf.mock.calls[0][0])).toEqual(['t1.jpg', 't2.jpg']);
    expect(names(toPdf.mock.calls[1][0])).toEqual(['t3.jpg']);
    // 사진 PDF 이름에 원래 파일 이름(개인정보일 수 있음)을 쓰지 않는다
    expect(names(r?.parts)).toEqual(['my-lease.pdf', 'lease-photos-2.pdf', 'terms.pdf', 'lease-photos-4.pdf']);
    expect(merge).toHaveBeenCalledTimes(1);
    expect(merge.mock.calls[0][0]).toEqual(r?.parts);
    expect(r?.file.name).toBe('lease.pdf');
    // 조각마다 칸 목록의 몇 번째 파일들인지 (② 화면 "File 2" 안내용, #305)
    expect(r?.items).toEqual([[0], [1, 2], [3], [4]]);
  });

  it('mergePdfFiles(): 쪽을 순서대로 이어 붙이고 문서 정보를 넣지 않는다', async () => {
    const make = async (sizes, name) => {
      const d = await PDFDocument.create({ updateMetadata: false });
      for (const w of sizes) d.addPage([w, 800]);
      return new File([await d.save()], name, { type: 'application/pdf' });
    };
    const merged = await mergePdfFiles([await make([500, 510], 'a.pdf'), await make([520], 'b.pdf')], 'lease.pdf');
    expect(merged.name).toBe('lease.pdf');
    expect(merged.type).toBe('application/pdf');
    const doc = await PDFDocument.load(new Uint8Array(await merged.arrayBuffer()), { updateMetadata: false });
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([500, 510, 520]);
    expect(doc.getProducer()).toBeUndefined();
    expect(doc.getCreator()).toBeUndefined();
  });
});
