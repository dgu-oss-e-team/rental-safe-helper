// PART 2. 글자 조각 좌표(block.spans, PR #252)로 가림 상자를 개인정보 부분만큼 좁히기
// 실제 서류 점검: 신탁 등기부 갑구 "소유권이전(신탁)" 줄의 수탁자 법인번호 때문에 줄 전체(접수일·등기원인)가 가려졌다.
// 값은 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { detectPII, maskBoxFor } from '../src/features/document-analysis/index.js';
import { PII_TYPE } from '../src/shared/document-model.js';

/**
 * 글자 조각들로 블록을 만든다. 조각 사이에는 띄어쓰기 하나(어느 조각에도 속하지 않음, PDF 읽기와 같음).
 * 조각마다 x를 0.05씩 옮기고 글자 수만큼 넓게 둔다.
 * @param {string[]} items
 * @param {number} [y]
 */
function blockOf(items, y = 0.3) {
  let text = '';
  let x = 0.05;
  const spans = [];
  for (const item of items) {
    if (text) text += ' ';
    const start = text.length;
    text += item;
    const width = Number((item.length * 0.01).toFixed(4));
    spans.push({ start, end: text.length, bbox: { x: Number(x.toFixed(4)), y, width, height: 0.012 } });
    x += width + 0.01;
  }
  const last = spans[spans.length - 1].bbox;
  return {
    blockId: 'p0_b0',
    text,
    bbox: { x: 0.05, y, width: Number((last.x + last.width - 0.05).toFixed(4)), height: 0.012 },
    confidence: null,
    spans,
  };
}

/** @param {any[]} blocks */
const docOf = (blocks) => ({
  documentId: 'REG',
  fileName: 'REG.pdf',
  sourceType: 'TEXT_PDF',
  pages: [{ pageIndex: 0, width: 595, height: 842, blocks: blocks.map((b, i) => ({ ...b, blockId: `p0_b${i}` })) }],
});

const TRUST_LINE = ['2', '소유권이전', '2020년1월2일', '제12345호', '2020년1월2일', '신탁', '수탁자', '가상자산신탁주식회사', '110111-1234567'];

describe('PART 2 maskBoxFor(): 개인정보 글자와 겹치는 조각만 합친 상자', () => {
  const block = blockOf(['임대인', '성명', '김가상', '전화', '010-0000-1111']);
  const at = (/** @type {string} */ v) => block.text.indexOf(v);

  it('조각 하나 안의 값은 그 조각 상자', () => {
    const s = at('김가상');
    expect(maskBoxFor(block, s, s + 3, '김가상')).toEqual(block.spans[2].bbox);
  });

  it('여러 조각에 걸친 값은 조각 상자들을 합친다', () => {
    const s = at('김가상');
    const e = at('010-0000-1111') + '010-0000-1111'.length;
    const box = maskBoxFor(block, s, e, block.text.slice(s, e));
    const a = block.spans[2].bbox;
    const b = block.spans[4].bbox;
    expect(box.x).toBeCloseTo(a.x, 4);
    expect(box.x + box.width).toBeCloseTo(b.x + b.width, 4);
  });

  it('조각 일부만 겹쳐도 그 조각 전체를 가린다 (넓게 가리기)', () => {
    const glued = blockOf(['성명:김가상', '(서명)']);
    const s = glued.text.indexOf('김가상');
    expect(maskBoxFor(glued, s, s + 3, '김가상')).toEqual(glued.spans[0].bbox);
  });

  it.each([
    ['spans가 없음 (OCR)', { ...block, spans: undefined }],
    ['spans가 빈 배열', { ...block, spans: [] }],
    ['조각 위치가 글 길이를 넘음', { ...block, spans: [...block.spans, { start: 0, end: 999, bbox: block.bbox }] }],
    ['조각 좌표가 페이지 밖', { ...block, spans: block.spans.map((s, i) => (i === 2 ? { ...s, bbox: { ...s.bbox, x: 1.5 } } : s)) }],
    ['개인정보 글자가 어느 조각에도 없음', { ...block, spans: block.spans.filter((_, i) => i !== 2) }],
  ])('%s → 블록 전체', (_name, b) => {
    const s = at('김가상');
    expect(maskBoxFor(b, s, s + 3, '김가상')).toEqual(block.bbox);
  });

  it('소수점 넷째 자리로 맞출 때 상자가 줄어들지 않는다 (시작은 내림, 끝은 올림, #257 리뷰)', () => {
    const block = blockOf(['소유자', '김가상']);
    block.spans[1].bbox = { x: 0.123456, y: 0.300049, width: 0.030001, height: 0.012001 };
    const s = block.text.indexOf('김가상');
    const box = maskBoxFor(block, s, s + 3, '김가상');
    const b = block.spans[1].bbox;
    expect(box).toEqual({ x: 0.1234, y: 0.3, width: 0.0301, height: 0.0121 });
    expect(box.x).toBeLessThanOrEqual(b.x);
    expect(box.y).toBeLessThanOrEqual(b.y);
    expect(box.x + box.width).toBeGreaterThanOrEqual(b.x + b.width);
    expect(box.y + box.height).toBeGreaterThanOrEqual(b.y + b.height);
  });

  it('위치의 글자가 탐지한 값과 다르면 블록 전체 (글과 위치가 어긋난 경우)', () => {
    const s = at('김가상');
    expect(maskBoxFor(block, s, s + 3, '이가상')).toEqual(block.bbox);
    expect(maskBoxFor(block, undefined, undefined, '김가상')).toEqual(block.bbox);
  });
});

describe('PART 2 detectPII(): 신탁 등기부 갑구 줄 (실제 양식 모양, 가짜 값)', () => {
  const block = blockOf(TRUST_LINE);

  it('수탁자 법인번호만 가리고 접수일·등기원인 칸은 가리지 않는다', () => {
    const r = detectPII(docOf([block]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const number = r.data.find((f) => f.value === '110111-1234567');
    expect(number?.type).toBe(PII_TYPE.REGISTRY_ID);
    expect(number?.bbox).toEqual(block.spans[8].bbox);
    // 접수일·등기원인 조각과 겹치지 않는다
    for (const i of [1, 2, 3, 4, 5]) {
      const s = block.spans[i].bbox;
      expect(s.x + s.width <= /** @type {any} */ (number).bbox.x).toBe(true);
    }
  });

  it('spans가 없는 같은 줄은 지금처럼 블록 전체', () => {
    const r = detectPII(docOf([{ ...block, spans: undefined }]));
    if (!r.ok) throw new Error('detect failed');
    expect(r.data.find((f) => f.value === '110111-1234567')?.bbox).toEqual(block.bbox);
  });

  it('두 줄 주소의 조각도 각자 자기 블록에서 좁힌다', () => {
    const line1 = blockOf(['소재지', '서울특별시', '중구', '가상로', '12,'], 0.2);
    const line2 = blockOf(['101동', '1001호', '2020년1월2일', '등기'], 0.22);
    const r = detectPII(docOf([line1, line2]));
    if (!r.ok) throw new Error('detect failed');
    const pieces = r.data.filter((f) => f.type === PII_TYPE.ADDRESS);
    expect(pieces.map((f) => f.value)).toEqual(['서울특별시 중구 가상로 12,', '101동 1001호']);
    expect(pieces[0].bbox.x).toBeCloseTo(line1.spans[1].bbox.x, 4); // "소재지" 칸은 빼고
    const tail = pieces[1].bbox;
    expect(tail.x + tail.width).toBeCloseTo(line2.spans[1].bbox.x + line2.spans[1].bbox.width, 4); // 날짜 칸은 빼고
  });
});
