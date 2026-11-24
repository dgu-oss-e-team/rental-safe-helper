// PART 4. 보내기 전 검사가 멈출 때 걸린 줄의 위치(where)를 같이 돌려준다 (PART 5 #316: 멈춘 줄을 보여 주고 더 가리기)
// 위치에는 값을 넣지 않는다. 예시는 모두 가짜 값이다.
import { describe, it, expect } from 'vitest';
import { validateMaskedText } from '../src/features/masking/masking-validator.js';
import { applyMaskingPlan, createMaskingPlan } from '../src/features/masking/index.js';
import { MASKING_ACTION, MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

const BOX = { x: 0.1, y: 0.1, width: 0.8, height: 0.01 };
const name = (id, value, blockId, documentId = 'D') => ({ id, type: PII_TYPE.PERSON_NAME, value, documentId, blockId, pageIndex: 0, bbox: BOX });
const plan = (items) => ({ purpose: MASKING_PURPOSE.FRAUD_CHECK, items });

describe('PART 4 보내기 전 검사: 멈춘 곳 위치(where)', () => {
  it('탐지 값이 남은 줄의 서류·blockId·줄 번호를 준다', () => {
    const r = validateMaskedText(
      { D: '임대인 [REDACTED]\n임대인 홍길동 (서명)' },
      [name('N1', '홍길동', 'b1')],
      plan([{ findingId: 'N1', action: MASKING_ACTION.REDACT, replacement: '[REDACTED]' }]),
      undefined,
      { lineBlocks: { D: ['b0', 'b1'] } },
    );
    expect(r.ok).toBe(false);
    expect(r.where).toEqual([{ documentId: 'D', blockId: 'b1', lineIndex: 1 }]);
    // 메시지·위치에 값이 없다
    expect(JSON.stringify(r)).not.toContain('홍길동');
  });

  it('여러 곳이 걸리면 서류가 달라도 전부 준다 (한 줄은 한 번만, 메시지는 처음 걸린 검사)', () => {
    const r = validateMaskedText(
      {
        D: '임대인 홍길동\n제목\n주민등록번호 760423-******',
        P: '주택 소재지 가상시 203호(가상동) |',
      },
      [name('N1', '홍길동', 'b0')],
      plan([{ findingId: 'N1', action: MASKING_ACTION.REDACT, replacement: '[REDACTED]' }]),
      undefined,
      { photoDocumentIds: ['P'], lineBlocks: { D: ['b0', 'b1', 'b2'], P: ['p0'] } },
    );
    expect(r.ok).toBe(false);
    expect(r.error.message).toContain('PERSON_NAME');
    expect(r.where).toEqual([
      { documentId: 'D', blockId: 'b0', lineIndex: 0 },
      { documentId: 'D', blockId: 'b2', lineIndex: 2 },
      { documentId: 'P', blockId: 'p0', lineIndex: 0 },
    ]);
  });

  it('lineBlocks가 없으면 서류와 줄 번호만 준다', () => {
    const r = validateMaskedText({ D: '첫 줄\n주민등록번호 760423-#xwssnr' }, [], plan([]));
    expect(r.where).toEqual([{ documentId: 'D', blockId: undefined, lineIndex: 1 }]);
  });

  it('통과하면 where가 없다', () => {
    const r = validateMaskedText({ D: '임대인 [REDACTED]' }, [], plan([]));
    expect(r).toEqual({ ok: true, data: { checked: 0 } });
  });

  it('applyMaskingPlan은 줄마다 blockId(lineBlocks)를 준다', () => {
    const doc = { documentId: 'D', pages: [{ pageIndex: 0, width: 1, height: 1, blocks: [
      { blockId: 'b0', text: '첫 줄', bbox: BOX, confidence: null },
      { blockId: 'b1', text: '둘째 줄', bbox: BOX, confidence: null },
    ] }, { pageIndex: 1, width: 1, height: 1, blocks: [
      { blockId: 'p1_b0', text: '다음 쪽', bbox: BOX, confidence: null },
    ] }] };
    const r = applyMaskingPlan([doc], createMaskingPlan([], [], MASKING_PURPOSE.FRAUD_CHECK).data, [], []);
    expect(r.data.lineBlocks).toEqual({ D: ['b0', 'b1', 'p1_b0'] });
  });
});
