// PART 5. 서류 칸 하나에 사진 여러 장 올리기 (#268). 가상 파일만 사용한다.
import { describe, it, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  addPicked,
  removePhoto,
  pageSizeFor,
  buildPhotoPdf,
  slotToFile,
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

  it('PDF 한 개를 고르면 칸이 그 PDF로 바뀐다 (사진·이전 PDF는 없어짐)', () => {
    expect(names(addPicked([photo('p1.jpg')], [pdf('a.pdf')]).value)).toBe('a.pdf');
    expect(names(addPicked(pdf('old.pdf'), [pdf('new.pdf')]).value)).toBe('new.pdf');
  });

  it('PDF가 있던 칸에 사진을 고르면 사진으로 바뀐다', () => {
    expect(names(addPicked(pdf('a.pdf'), [photo('p1.jpg')]).value)).toEqual(['p1.jpg']);
  });

  it('PDF와 사진을 섞거나, PDF를 여러 개 고르거나, 다른 형식이면 그대로 두고 안내한다', () => {
    const current = [photo('p1.jpg')];
    expect(addPicked(current, [pdf('a.pdf'), photo('p2.jpg')])).toEqual({ value: current, notice: PHOTO_NOTICE.MIXED });
    expect(addPicked(current, [pdf('a.pdf'), pdf('b.pdf')])).toEqual({ value: current, notice: PHOTO_NOTICE.ONE_PDF });
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

  it('slotToFile(): PDF·사진 1장은 그대로, 여러 장만 PDF로 합친다, 빈 칸은 null', async () => {
    const toPdf = vi.fn(async (_photos, name) => pdf(name));
    const a = pdf('a.pdf');
    expect(await slotToFile(a, 'x.pdf', toPdf)).toBe(a);
    const p1 = photo('p1.jpg');
    expect(await slotToFile([p1], 'x.pdf', toPdf)).toBe(p1);
    expect(await slotToFile(null, 'x.pdf', toPdf)).toBeNull();
    expect(toPdf).not.toHaveBeenCalled();
    const merged = await slotToFile([p1, photo('p2.jpg')], 'registry-photos.pdf', toPdf);
    expect(merged?.name).toBe('registry-photos.pdf');
    expect(toPdf).toHaveBeenCalledTimes(1);
    expect(names(toPdf.mock.calls[0][0])).toEqual(['p1.jpg', 'p2.jpg']);
  });
});
