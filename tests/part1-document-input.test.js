import { describe, it, expect } from 'vitest';
import { readDocument, isSupportedFile } from '../src/features/document-input/index.js';

describe('PART 1 readDocument()', () => {
  it('PDF를 받으면 DocumentModel 형식으로 돌려준다', async () => {
    const r = await readDocument(new File([''], 'sample-lease.pdf', { type: 'application/pdf' }));
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ documentId: expect.any(String), sourceType: expect.any(String) });
    expect(r.data.pages[0].blocks[0]).toHaveProperty('bbox');
  });

  it('지원하지 않는 파일은 UNSUPPORTED_FILE 오류를 돌려준다', async () => {
    const r = await readDocument(new File([''], 'notes.txt', { type: 'text/plain' }));
    expect(r).toEqual({ ok: false, error: { code: 'UNSUPPORTED_FILE', message: expect.any(String) } });
  });

  it('isSupportedFile은 PDF·JPG·PNG만 허용한다', () => {
    expect(isSupportedFile({ name: 'a.PNG' })).toBe(true);
    expect(isSupportedFile({ name: 'a.hwp' })).toBe(false);
  });

  // TODO(PART 1): 실제 PDF 텍스트 추출, OCR, 좌표 정규화 테스트 추가
});
