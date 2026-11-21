import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildImageOnlyPdf } from '../src/features/pdf-export/export-pdf.js';
import { validateMaskedPdf } from '../src/features/pdf-export/validate-pdf.js';
import { exportMaskedPDF, previewMaskedPages, pagesWithText } from '../src/features/pdf-export/index.js';
import { mockLeaseDocument } from '../src/shared/mock-data.js';
import {
  toPixelRect,
  planRedactions,
  textBoxesOf,
  fitFontSize,
  drawRedactions,
  PAD_X_RATIO,
  PAD_Y_RATIO,
  PAD_MIN,
} from '../src/features/pdf-export/apply-redactions.js';
// 1×1 흰색 PNG (테스트용 페이지 이미지)
const TINY_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

const page = { documentId: 'DOC_A', pageIndex: 0, width: 1000, height: 2000 };
const item = (over) => ({
  findingId: 'F1',
  action: 'REDACT',
  replacement: '[REDACTED]',
  documentId: 'DOC_A',
  pageIndex: 0,
  bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
  ...over,
});

describe('PART 5 좌표 변환 (toPixelRect)', () => {
  it('0~1 좌표를 픽셀로 바꾸고 여유를 조금 더한다', () => {
    const r = toPixelRect({ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }, 1000, 2000);
    expect(r.x).toBeLessThanOrEqual(100);
    expect(r.y).toBeLessThanOrEqual(400);
    expect(r.x + r.width).toBeGreaterThanOrEqual(400);
    expect(r.y + r.height).toBeGreaterThanOrEqual(500);
  });

  it('페이지 밖으로 나가지 않는다', () => {
    const r = toPixelRect({ x: 0, y: 0, width: 1, height: 1 }, 1000, 2000);
    expect(r).toEqual({ x: 0, y: 0, width: 1000, height: 2000 });
    // 가장자리에 붙은 작은 상자도 잘린다
    const edge = toPixelRect({ x: 0.99, y: 0.995, width: 0.01, height: 0.005 }, 1000, 2000);
    expect(edge.x + edge.width).toBeLessThanOrEqual(1000);
    expect(edge.y + edge.height).toBeLessThanOrEqual(2000);
  });
});

describe('PART 5 상자 여유는 줄 높이에 맞춘다 (#139)', () => {
  /** 상자 위·왼쪽 여유 (px) */
  const padOf = (bbox, w, h) => {
    const r = toPixelRect(bbox, w, h);
    return { top: bbox.y * h - r.y, left: bbox.x * w - r.x };
  };
  const A4 = [2480, 3508];

  it('글자가 클수록 여유도 커진다 (위아래 줄 높이의 20%, 좌우 25%)', () => {
    expect([PAD_Y_RATIO, PAD_X_RATIO]).toEqual([0.2, 0.25]);
    const small = padOf({ x: 0.3, y: 0.3, width: 0.2, height: 0.01 }, ...A4); // 줄 높이 약 35px
    const big = padOf({ x: 0.3, y: 0.3, width: 0.2, height: 0.02 }, ...A4); // 약 70px
    expect(big.top).toBeGreaterThan(small.top);
    expect(big.left).toBeGreaterThan(small.left);
    expect(small.top).toBeCloseTo(35.08 * PAD_Y_RATIO, 0);
    expect(small.left).toBeCloseTo(35.08 * PAD_X_RATIO, 0);
  });

  it('작은 휴대폰 사진에서도 여유가 이전(페이지의 0.2%, 2~3px)보다 넉넉하다', () => {
    // 1000×1414 사진, 줄 높이 30px → 위아래 6px, 좌우 7.5px
    const pad = padOf({ x: 0.1, y: 0.4, width: 0.5, height: 30 / 1414 }, 1000, 1414);
    expect(pad.top).toBeGreaterThanOrEqual(6);
    expect(pad.left).toBeGreaterThanOrEqual(7);
  });

  it('아주 작은 글자도 이전 여유(페이지의 0.2%)보다 작아지지 않는다', () => {
    const pad = padOf({ x: 0.3, y: 0.3, width: 0.1, height: 0.001 }, ...A4);
    expect(pad.top).toBeGreaterThanOrEqual(0.002 * 3508 - 1);
    expect(pad.left).toBeGreaterThanOrEqual(0.002 * 2480 - 1);
  });

  it('여러 줄 묶음처럼 큰 상자는 여유가 페이지 긴 변의 1%를 넘지 않는다', () => {
    const pad = padOf({ x: 0.2, y: 0.2, width: 0.5, height: 0.3 }, ...A4);
    expect(pad.top).toBeLessThanOrEqual(0.01 * 3508 + 1);
    expect(pad.left).toBeLessThanOrEqual(0.01 * 3508 + 1);
  });

  it('줄 사이 간격이 줄 높이의 절반이면 위아래 줄 상자가 겹치지 않는다 (옆 줄 글자를 덮지 않음)', () => {
    const upper = toPixelRect({ x: 0.1, y: 0.3, width: 0.5, height: 0.02 }, ...A4);
    const lower = toPixelRect({ x: 0.1, y: 0.33, width: 0.5, height: 0.02 }, ...A4); // 간격 0.01 = 줄 높이의 50%
    expect(upper.y + upper.height).toBeLessThanOrEqual(lower.y);
  });
});

describe('PART 5 상자 여유: 옆에 가리지 않는 글자가 있으면 간격의 절반까지만 (#139)', () => {
  const A4 = [2480, 3508];
  const line = { x: 0.1, y: 0.3, width: 0.4, height: 0.02 }; // 줄 높이 약 70px → 기본 위아래 여유 14px
  const px = (b) => ({ l: b.x * 2480, t: b.y * 3508, r: (b.x + b.width) * 2480, b: (b.y + b.height) * 3508 });

  it('바로 아래 줄이 가까우면(간격 10px) 아래 여유는 5px까지만, 위는 그대로', () => {
    const below = { x: 0.1, y: 0.32 + 20 / 3508, width: 0.4, height: 0.02 };
    const r = toPixelRect(line, ...A4, [below]);
    expect(r.y + r.height).toBeLessThanOrEqual(px(below).t);
    expect(r.y + r.height - px(line).b).toBeLessThanOrEqual(11);
    expect(px(line).t - r.y).toBeGreaterThanOrEqual(13);
  });

  it('바로 오른쪽 칸 글자가 가까우면(간격 14px) 오른쪽 여유는 7px까지만', () => {
    const right = { x: 0.5 + 14 / 2480, y: 0.3, width: 0.1, height: 0.02 };
    const r = toPixelRect(line, ...A4, [right]);
    expect(r.x + r.width).toBeLessThanOrEqual(px(right).l);
    expect(r.x + r.width - px(line).r).toBeLessThanOrEqual(8);
  });

  it('옆 글자가 거의 붙어 있어도 가장 작은 여유(페이지의 0.2%)는 지킨다 (덜 가려서 새지 않게, #140 리뷰)', () => {
    const minY = PAD_MIN * 3508; // 약 7px
    const minX = PAD_MIN * 2480; // 약 5px
    const touching = [
      { x: 0.1, y: 0.32, width: 0.4, height: 0.02 }, // 바로 아래 줄, 간격 0
      { x: 0.1, y: 0.28 - 2 / 3508, width: 0.4, height: 0.02 }, // 바로 위 줄, 간격 2px
      { x: 0.5, y: 0.3, width: 0.1, height: 0.02 }, // 바로 오른쪽 칸, 간격 0
    ];
    const r = toPixelRect(line, ...A4, touching);
    expect(r.y + r.height - px(line).b).toBeGreaterThanOrEqual(minY);
    expect(px(line).t - r.y).toBeGreaterThanOrEqual(minY);
    expect(r.x + r.width - px(line).r).toBeGreaterThanOrEqual(minX);
  });

  it('멀리 있는 글자나 다른 열의 글자는 여유에 영향이 없다', () => {
    const far = { x: 0.1, y: 0.6, width: 0.4, height: 0.02 };
    const otherColumn = { x: 0.8, y: 0.33, width: 0.1, height: 0.02 }; // 아래쪽이지만 옆 열
    expect(toPixelRect(line, ...A4, [far, otherColumn])).toEqual(toPixelRect(line, ...A4));
  });

  it('planRedactions: 가릴 줄은 이웃으로 보지 않고, 가리지 않는 줄만 피한다', () => {
    const masked = { x: 0.1, y: 0.3, width: 0.4, height: 0.02 };
    const free = { x: 0.1, y: 0.32 + 20 / 3508, width: 0.4, height: 0.02 };
    const plan = { purpose: 'FRAUD_CHECK', items: [item({ bbox: masked })] };
    const pg = { documentId: 'DOC_A', pageIndex: 0, width: 2480, height: 3508 };
    const [box] = planRedactions(plan, { ...pg, textBoxes: [masked, free] });
    expect(box.rect.y + box.rect.height).toBeLessThanOrEqual(px(free).t);
    // 가릴 줄 자신만 있으면 기본 여유 그대로
    const [alone] = planRedactions(plan, { ...pg, textBoxes: [masked] });
    expect(alone.rect).toEqual(toPixelRect(masked, ...A4));
  });
});

describe('PART 5 같은 줄의 옆 칸 글자 조각 피하기 (#256)', () => {
  const A4 = [2480, 3508];
  const minX = PAD_MIN * 2480; // 약 5px
  // 줄 하나 = [번호 칸][개인정보][다음 칸]. 글자 상자는 2px씩 겹친다 (글자 PDF의 글자 폭 때문에 생김)
  const lineY = { y: 0.3, height: 0.02 };
  const pii = { x: 0.3, width: 0.2, ...lineY };
  const leftCell = { x: 0.2, width: 0.1 + 2 / 2480, ...lineY };
  const rightCell = { x: 0.5 - 2 / 2480, width: 0.1, ...lineY };
  const px = (b) => ({ l: b.x * 2480, r: (b.x + b.width) * 2480 });

  it('textBoxesOf(): 글자 PDF 블록은 spans 위치, spans가 없는 블록(OCR)은 블록 위치', () => {
    const page = {
      blocks: [
        {
          bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.02 },
          spans: [
            { start: 0, end: 2, bbox: leftCell },
            { start: 3, end: 5, bbox: pii },
          ],
        },
        { bbox: rightCell },
        { bbox: rightCell, spans: [] },
      ],
    };
    expect(textBoxesOf(page)).toEqual([leftCell, pii, rightCell, rightCell]);
    expect(textBoxesOf(undefined)).toEqual([]);
  });

  it('살짝 겹친 옆 칸은 그 글자 끝에서 가장 작은 여유까지만 넘어가고, 개인정보 글자는 다 덮는다', () => {
    const r = toPixelRect(pii, ...A4, [leftCell, rightCell]);
    // 개인정보 글자는 다 덮는다
    expect(r.x).toBeLessThanOrEqual(px(pii).l);
    expect(r.x + r.width).toBeGreaterThanOrEqual(px(pii).r);
    // 옆 칸 안으로는 가장 작은 여유(+반올림 1px)보다 깊게 들어가지 않는다
    expect(px(leftCell).r - r.x).toBeLessThanOrEqual(minX + 1);
    expect(r.x + r.width - px(rightCell).l).toBeLessThanOrEqual(minX + 1);
    // 옆 칸을 보지 않으면 더 깊게 들어간다 (이 검사가 의미가 있다는 확인)
    const loose = toPixelRect(pii, ...A4);
    expect(px(leftCell).r - loose.x).toBeGreaterThan(minX + 1);
  });

  it('겹친 양이 가장 작은 여유보다 커도 상자는 개인정보 글자 안쪽으로 줄지 않는다', () => {
    const deep = { x: 0.2, width: 0.1 + 30 / 2480, ...lineY }; // 30px 겹침, 가운데는 바깥
    const r = toPixelRect(pii, ...A4, [deep]);
    expect(r.x).toBeLessThanOrEqual(px(pii).l);
  });

  it('가운데가 개인정보 글자 안에 있는 글자는 피할 수 없으니 여유를 바꾸지 않는다', () => {
    const inside = { x: 0.35, width: 0.05, ...lineY };
    expect(toPixelRect(pii, ...A4, [inside])).toEqual(toPixelRect(pii, ...A4));
  });

  it('planRedactions: 같은 블록의 다른 span은 옆 칸으로 보고, 가릴 span은 이웃으로 보지 않는다', () => {
    const plan = { purpose: 'FRAUD_CHECK', items: [item({ bbox: pii })] };
    const pg = { documentId: 'DOC_A', pageIndex: 0, width: 2480, height: 3508 };
    const block = {
      bbox: { x: 0.2, width: 0.4, ...lineY },
      spans: [{ bbox: leftCell }, { bbox: pii }, { bbox: rightCell }],
    };
    const [box] = planRedactions(plan, { ...pg, textBoxes: textBoxesOf({ blocks: [block] }) });
    expect(box.rect).toEqual(toPixelRect(pii, ...A4, [leftCell, rightCell]));
    // 블록 전체만 넘기면(이전) 자기 블록이라 옆 칸을 모른다
    const [old] = planRedactions(plan, { ...pg, textBoxes: [block.bbox] });
    expect(old.rect).toEqual(toPixelRect(pii, ...A4));
  });
});

describe('PART 5 그릴 목록 (planRedactions)', () => {
  it('검은 상자를 먼저, 가명 글자를 나중에 그린다 (겹쳐도 가명이 보이게)', () => {
    const plan = {
      purpose: 'FRAUD_CHECK',
      items: [
        item({ findingId: 'NAME', action: 'REPLACE', replacement: '[Owner_A]' }),
        item({ findingId: 'RRN', action: 'REDACT' }),
      ],
    };
    const list = planRedactions(plan, page);
    expect(list.map((d) => d.kind)).toEqual(['box', 'label']);
    expect(list[1].text).toBe('[Owner_A]');
  });

  it('다른 문서·다른 페이지·KEEP·잘못된 좌표는 그리지 않는다', () => {
    const plan = {
      purpose: 'FRAUD_CHECK',
      items: [
        item({ documentId: 'DOC_B' }),
        item({ pageIndex: 1 }),
        item({ action: 'KEEP', replacement: null }),
        item({ bbox: { x: 120, y: 0, width: 10, height: 10 } }),
        item({ findingId: 'OK' }),
      ],
    };
    expect(planRedactions(plan, page)).toHaveLength(1);
  });

  it('한 줄에 가명이 둘이면 겹쳐 그리지 않고 이어서 한 번만 그린다 (서명란 "임대인 … 임차인 …")', () => {
    const plan = {
      purpose: 'FRAUD_CHECK',
      items: [
        item({ findingId: 'LANDLORD', action: 'REPLACE', replacement: '[Landlord_A]' }),
        item({ findingId: 'RRN', action: 'REDACT' }),
        item({ findingId: 'TENANT', action: 'REPLACE', replacement: '[Tenant_B]' }),
      ],
    };
    const labels = planRedactions(plan, page).filter((d) => d.kind === 'label');
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('[Landlord_A] / [Tenant_B]');
  });

  it('같은 줄에 같은 사람이 두 번 나오면 가명도 한 번만 쓴다', () => {
    const plan = {
      purpose: 'FRAUD_CHECK',
      items: [
        item({ findingId: 'N1', action: 'REPLACE', replacement: '[Landlord_A]' }),
        item({ findingId: 'N2', action: 'REPLACE', replacement: '[Landlord_A]' }),
      ],
    };
    expect(planRedactions(plan, page).map((d) => d.text)).toEqual(['[Landlord_A]']);
  });

  it('다른 줄의 가명은 각자 따로 그린다', () => {
    const plan = {
      purpose: 'FRAUD_CHECK',
      items: [
        item({ findingId: 'N1', action: 'REPLACE', replacement: '[Owner_A]' }),
        item({ findingId: 'N2', action: 'REPLACE', replacement: '[Landlord_B]', bbox: { x: 0.1, y: 0.5, width: 0.3, height: 0.05 } }),
      ],
    };
    expect(planRedactions(plan, page).map((d) => d.text)).toEqual(['[Owner_A]', '[Landlord_B]']);
  });
});

describe('PART 5 새 PDF 만들기와 검증', () => {
  it('이미지만 들어간 PDF는 글자가 없고 문서 정보가 비어 있다', async () => {
    const bytes = await buildImageOnlyPdf([{ bytes: TINY_PNG, format: 'png', widthPt: 595, heightPt: 842 }]);
    const check = await validateMaskedPdf(bytes);
    expect(check).toEqual({ ok: true, data: { pageCount: 1 } });
  });

  it('글자가 남은 PDF는 검증에서 실패한다 (검증이 실제로 동작하는지 확인)', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([595, 842]).drawText('800101-1234567', { x: 50, y: 700, font, size: 12 });
    const check = await validateMaskedPdf(await pdf.save());
    expect(check).toMatchObject({ ok: false, error: { code: 'PDF_EXPORT_FAILED' } });
    expect(check.error.message).not.toContain('800101'); // 오류 메시지에 실제 값이 들어가지 않는다
  });

  it('문서 정보가 남은 PDF도 검증에서 실패한다', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    pdf.setAuthor('Kim Cheolsu');
    const check = await validateMaskedPdf(await pdf.save());
    expect(check).toMatchObject({ ok: false, error: { code: 'PDF_EXPORT_FAILED' } });
  });
});

describe('PART 5 exportMaskedPDF() 안전장치', () => {
  const plan = { purpose: 'FRAUD_CHECK', items: [] };

  it('글자를 하나도 읽지 못한 문서는 PDF를 만들지 않는다 (LOW_CONFIDENCE)', async () => {
    const scanned = structuredClone(mockLeaseDocument);
    scanned.pages[0].blocks = [{ blockId: 'B', text: '  ', bbox: { x: 0, y: 0, width: 1, height: 1 }, confidence: null }];
    const r = await exportMaskedPDF(scanned, plan);
    expect(r).toMatchObject({ ok: false, error: { code: 'LOW_CONFIDENCE' } });
  });

  it('좌표가 규칙을 벗어나면 COORDINATE_INVALID', async () => {
    const bad = { purpose: 'FRAUD_CHECK', items: [item({ bbox: { x: 100, y: 0, width: 10, height: 10 } })] };
    const r = await exportMaskedPDF(structuredClone(mockLeaseDocument), bad);
    expect(r).toMatchObject({ ok: false, error: { code: 'COORDINATE_INVALID' } });
  });

  it('그릴 수 없는 환경(캔버스 없음)에서도 오류를 던지지 않고 PDF_EXPORT_FAILED를 돌려준다', async () => {
    const r = await exportMaskedPDF(structuredClone(mockLeaseDocument), plan);
    expect(r).toMatchObject({ ok: false, error: { code: 'PDF_EXPORT_FAILED' } });
  });

  it('pagesWithText()는 글자가 있는 페이지만 돌려준다', () => {
    expect([...pagesWithText(mockLeaseDocument)]).toEqual([0]);
  });
});

describe('PART 5 previewMaskedPages() 미리보기 (PDF와 같은 안전장치)', () => {
  const plan = { purpose: 'FRAUD_CHECK', items: [] };

  it('서류나 계획이 없으면 INVALID_INPUT', async () => {
    expect(await previewMaskedPages(null, plan)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('글자를 하나도 읽지 못한 문서는 미리보기도 만들지 않는다 (LOW_CONFIDENCE)', async () => {
    const scanned = structuredClone(mockLeaseDocument);
    scanned.pages[0].blocks = [{ blockId: 'B', text: '  ', bbox: { x: 0, y: 0, width: 1, height: 1 }, confidence: null }];
    expect(await previewMaskedPages(scanned, plan)).toMatchObject({ ok: false, error: { code: 'LOW_CONFIDENCE' } });
  });

  it('좌표가 규칙을 벗어나면 COORDINATE_INVALID', async () => {
    const bad = { purpose: 'FRAUD_CHECK', items: [item({ bbox: { x: 100, y: 0, width: 10, height: 10 } })] };
    const r = await previewMaskedPages(structuredClone(mockLeaseDocument), bad);
    expect(r).toMatchObject({ ok: false, error: { code: 'COORDINATE_INVALID' } });
  });

  it('그릴 수 없는 환경(캔버스 없음)에서도 오류를 던지지 않는다', async () => {
    const r = await previewMaskedPages(structuredClone(mockLeaseDocument), plan);
    expect(r).toMatchObject({ ok: false, error: { code: 'PDF_EXPORT_FAILED' } });
  });
});

describe('PART 5 가명 글자 크기 (fitFontSize)', () => {
  it('넓은 상자는 높이 기준(70%)으로 정한다', () => {
    expect(fitFontSize(5, { width: 1000, height: 40 })).toBe(28);
  });

  it('좁은 상자는 글자 길이에 맞게 줄인다 (눌리지 않게)', () => {
    // 1px당 길이 8 → 너비 100에 맞추려면 약 11px
    const size = fitFontSize(8, { width: 100, height: 40 });
    expect(size).toBeLessThan(28);
    expect(size * 8).toBeLessThanOrEqual(100);
  });

  it('상자가 낮으면 10px보다 작아져도 상자 밖으로 나가지 않는다', () => {
    expect(fitFontSize(5, { width: 1000, height: 9 })).toBeLessThanOrEqual(9 * 0.7);
  });

  it('너무 작아지면 0 → 가명 대신 검은 상자', () => {
    expect(fitFontSize(20, { width: 40, height: 8 })).toBe(0);
  });
});

describe('PART 5 마스킹 그리기 (drawRedactions)', () => {
  /** 캔버스 대신 "어떤 색으로 무엇을 그렸는지"만 기록한다 (Node에는 캔버스가 없음) */
  function fakeContext() {
    const calls = [];
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textBaseline: '',
      measureText: (text) => ({ width: text.length * 60 }), // 100px일 때 글자당 60px로 가정
      fillRect: (...r) => calls.push(['fillRect', ctx.fillStyle, ...r]),
      strokeRect: (...r) => calls.push(['strokeRect', ctx.strokeStyle, ...r]),
      fillText: (text) => calls.push(['fillText', ctx.fillStyle, text]),
    };
    return { ctx, calls };
  }

  it('가명이 들어가는 상자는 흰 상자 + 테두리 + 가명', () => {
    const { ctx, calls } = fakeContext();
    drawRedactions(ctx, [{ kind: 'label', rect: { x: 0, y: 0, width: 600, height: 40 }, text: '[Landlord_A]' }]);
    expect(calls.map((c) => c.slice(0, 2))).toEqual([
      ['fillRect', '#ffffff'],
      ['strokeRect', '#1f5fbf'],
      ['fillText', '#1f5fbf'],
    ]);
  });

  it('가명이 안 들어가는 작은 상자는 검은 상자로 가린다 (흰 상자만 남지 않게)', () => {
    const { ctx, calls } = fakeContext();
    drawRedactions(ctx, [{ kind: 'label', rect: { x: 0, y: 0, width: 40, height: 8 }, text: '[AccountHolder_D]' }]);
    expect(calls).toEqual([['fillRect', '#000000', 0, 0, 40, 8]]);
  });
});
