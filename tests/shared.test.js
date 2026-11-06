import { describe, it, expect } from 'vitest';
import { ok, fail, isValidBBox, ERROR_CODE } from '../src/shared/document-model.js';
import {
  mockRegistryDocument,
  mockLeaseDocument,
  mockRegistryFindings,
  mockLeaseFindings,
} from '../src/shared/mock-data.js';

describe('공통 규격 (src/shared)', () => {
  it('ok/fail은 정해진 반환 형식을 만든다', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(fail(ERROR_CODE.OCR_FAILED, 'Text recognition failed.')).toEqual({
      ok: false,
      error: { code: 'OCR_FAILED', message: 'Text recognition failed.' },
    });
  });

  it('isValidBBox는 0~1 정규화 좌표만 통과시킨다', () => {
    expect(isValidBBox({ x: 0.1, y: 0.2, width: 0.3, height: 0.05 })).toBe(true);
    expect(isValidBBox({ x: 120, y: 30, width: 50, height: 10 })).toBe(false); // 픽셀 좌표
    expect(isValidBBox({ x: 0.9, y: 0.2, width: 0.3, height: 0.05 })).toBe(false); // 페이지 밖
    expect(isValidBBox(null)).toBe(false);
  });

  it('Mock 문서와 탐지 결과의 좌표가 모두 규칙을 지킨다', () => {
    for (const doc of [mockRegistryDocument, mockLeaseDocument]) {
      for (const page of doc.pages) for (const b of page.blocks) expect(isValidBBox(b.bbox)).toBe(true);
    }
    for (const f of [...mockRegistryFindings, ...mockLeaseFindings]) expect(isValidBBox(f.bbox)).toBe(true);
  });
});
