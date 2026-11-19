// PART 5. 마스킹 PDF 다시 검사 (노션 10장: 생성된 PDF를 다시 OCR하여 개인정보가 보이는지 확인)
// OCR 대신, 다시 읽은 결과(DocumentModel)를 직접 만들어 비교 로직을 검사한다. 가짜 데이터만 사용.
import { describe, it, expect, vi } from 'vitest';
import { findVisiblePii, unverifiable, CHECK_STATUS, partlyCheckedText, PII_TYPE_TEXT } from '../src/app/double-check.js';
import { PII_TYPE } from '../src/shared/document-model.js';

// pipeline의 readDocument(PART 1)를 가짜로 바꿔, OCR 성공·실패를 흉내 낸다
vi.mock('../src/features/document-input/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readDocument: vi.fn(),
}));
const { readDocument } = await import('../src/features/document-input/index.js');
const { doubleCheckPdfs } = await import('../src/app/pipeline.js');

/** 다시 읽은 페이지 (줄마다 글자) */
const ocrDoc = (...lines) => ({
  documentId: 'OCR',
  documentType: 'UNKNOWN',
  sourceType: 'image_pdf',
  pages: [
    {
      pageIndex: 0,
      width: 1000,
      height: 1414,
      blocks: lines.map((text, i) => ({ blockId: `b${i}`, text, bbox: { x: 0.1, y: 0.1 * i, width: 0.5, height: 0.03 }, confidence: 0.9 })),
    },
  ],
});

const finding = (id, type, value) => ({ id, type, value, documentId: 'DOC_A', pageIndex: 0, blockId: 'b', bbox: { x: 0, y: 0, width: 0.1, height: 0.1 }, confidence: null, reviewStatus: 'DETECTED' });
const findings = [
  finding('F_NAME', 'PERSON_NAME', '김철수'),
  finding('F_RRN', 'RESIDENT_ID', '750315-1******'),
  finding('F_PHONE', 'PHONE_NUMBER', '010-0000-0000'),
  finding('F_ADDR', 'ADDRESS', '서울특별시 중구 필동로 00, 101호'),
];
const plan = (keep = []) => ({
  purpose: 'FRAUD_CHECK',
  items: findings.map((f) => ({ findingId: f.id, action: keep.includes(f.id) ? 'KEEP' : 'REDACT', replacement: '[REDACTED]', documentId: 'DOC_A', pageIndex: 0, bbox: f.bbox })),
});

describe('PART 5 findVisiblePii(): 다시 읽은 글자에서 개인정보 찾기', () => {
  it('제대로 가려졌으면(가명·시·구만) NOT_FOUND', () => {
    const r = findVisiblePii(ocrDoc('임대인 [Landlord_B]', '소재지 서울특별시 중구', '연락처'), findings, plan());
    expect(r).toEqual({ status: CHECK_STATUS.NOT_FOUND, hits: [], reason: null, unclear: { count: 0, pages: [] } });
  });

  it('이름이 그대로 보이면 MAYBE_VISIBLE, 종류와 페이지만 알려 준다 (값은 없음)', () => {
    const r = findVisiblePii(ocrDoc('임대인 김철수'), findings, plan());
    expect(r.status).toBe(CHECK_STATUS.MAYBE_VISIBLE);
    expect(r.hits).toEqual([{ type: 'PERSON_NAME', pageIndex: 0 }]);
    expect(JSON.stringify(r)).not.toContain('김철수');
  });

  it('OCR이 띄어쓰기를 틀려도 찾는다 ("김 철 수", 주소 띄어쓰기)', () => {
    const r = findVisiblePii(ocrDoc('임대인 김 철 수', '서울특별시중구 필동로00, 101호'), findings, plan());
    expect(r.hits.map((h) => h.type).sort()).toEqual(['ADDRESS', 'PERSON_NAME']);
  });

  it('번호는 하이픈·기호를 잘못 읽어도 숫자만으로 찾는다 ("010 0000.0000")', () => {
    const r = findVisiblePii(ocrDoc('연락처 010 0000.0000'), findings, plan());
    expect(r.hits).toEqual([{ type: 'PHONE_NUMBER', pageIndex: 0 }]);
  });

  it('사용자가 "AI에게 보여 주기"로 해제한 항목(KEEP)은 보여도 문제로 보지 않는다', () => {
    const r = findVisiblePii(ocrDoc('임대인 김철수'), findings, plan(['F_NAME']));
    expect(r.status).toBe(CHECK_STATUS.NOT_FOUND);
  });

  describe('흐린 줄이 있을 때 (부분 확인, #146)', () => {
    /** 줄마다 [글자, 신뢰도] */
    const ocrWith = (...rows) => {
      const doc = ocrDoc(...rows.map(([text]) => text));
      doc.pages[0].blocks.forEach((b, i) => (b.confidence = rows[i][1]));
      return doc;
    };

    it('읽은 부분에 개인정보가 없고 흐린 줄이 있으면 PARTLY_CHECKED, 흐린 줄 수와 페이지를 알려 준다', () => {
      const r = findVisiblePii(
        ocrWith(['임대인 [Landlord_B]', 0.95], ['보증금 금50,000,000원', 0.7], ['계약일 2026년 11월 1일', 0.95], ['특약사항', 0.9]),
        findings,
        plan(),
      );
      expect(r).toEqual({ status: CHECK_STATUS.PARTLY_CHECKED, hits: [], reason: null, unclear: { count: 1, pages: [0] } });
    });

    it('흐린 줄 기준은 PART 1과 같다: 숫자 줄은 줄마다 0.8 미만, 글자만 있는 줄은 페이지 평균으로 본다', () => {
      // 숫자 없는 줄 하나가 0.5여도(표 선 조각 등) 흐린 줄로 세지 않는다
      const ok = findVisiblePii(ocrWith(['ㅣ ㅣ', 0.5], ['2026년', 0.85], ['특약사항', 0.9]), findings, plan());
      expect(ok.status).toBe(CHECK_STATUS.NOT_FOUND);
      const digit = findVisiblePii(ocrWith(['특약사항', 0.9], ['2026년', 0.79], ['계약일', 0.9]), findings, plan());
      expect(digit.status).toBe(CHECK_STATUS.PARTLY_CHECKED);
      // 페이지 평균이 0.6 미만이면 확인 불가
      const low = findVisiblePii(ocrWith(['특약사항', 0.4], ['계약일', 0.5], ['서명', 0.6]), findings, plan());
      expect(low).toMatchObject({ status: CHECK_STATUS.UNVERIFIABLE, reason: 'LOW_CONFIDENCE' });
    });

    it('흐린 줄의 숫자가 개인정보 번호와 거의 같으면(1개만 다름) "보일 수 있음"으로 본다', () => {
      // 750315-1******을 OCR이 750815-1로 잘못 읽은 경우
      const r = findVisiblePii(ocrWith(['주민등록번호 750815-1', 0.5], ['특약사항', 0.9], ['계약일', 0.9]), findings, plan());
      expect(r.status).toBe(CHECK_STATUS.MAYBE_VISIBLE);
      expect(r.hits).toEqual([{ type: 'RESIDENT_ID', pageIndex: 0 }]);
    });

    it('또렷한 줄은 거의 같은 숫자로 판단하지 않는다 (가리지 않은 다른 번호를 개인정보로 오해하지 않게)', () => {
      const r = findVisiblePii(ocrWith(['주민등록번호 750815-1', 0.95]), findings, plan());
      expect(r.status).toBe(CHECK_STATUS.NOT_FOUND);
    });

    it('같은 숫자가 반복되는 번호(010-0000-0000)는 "거의 같은 숫자"로 비교하지 않는다 (아무 0 줄과도 맞아서 뜻이 없음)', () => {
      const r = findVisiblePii(ocrWith(['보증금 금50,000,000원 000', 0.5], ['특약사항', 0.9], ['계약일', 0.9]), findings, plan());
      expect(r.status).toBe(CHECK_STATUS.PARTLY_CHECKED);
    });

    it('흐린 숫자 줄이 절반보다 많으면 "부분 확인"이 아니라 확인 불가', () => {
      const r = findVisiblePii(ocrWith(['보증금 50,000,000', 0.7], ['계약일 2026', 0.7], ['특약사항', 0.9]), findings, plan());
      expect(r).toMatchObject({ status: CHECK_STATUS.UNVERIFIABLE, reason: 'LOW_CONFIDENCE', unclear: { count: 2 } });
    });

    it('"부분 확인" 문구: 줄·쪽이 하나면 단수, 여럿이면 복수 (#150 리뷰)', () => {
      expect(partlyCheckedText({ count: 1, pages: [0] })).toContain('1 line on page 1 could not be read clearly, so we could not check it. Please look at that page');
      const many = partlyCheckedText({ count: 3, pages: [0, 1] });
      expect(many).toContain('3 lines on pages 1, 2 could not be read clearly, so we could not check them. Please look at those pages');
      expect(`${many}`).not.toMatch(/\b(safe|no risk|no warning)\b/i);
    });

    it('신뢰도가 없는 줄(글자 PDF)은 흐린 줄로 세지 않는다', () => {
      const r = findVisiblePii(ocrWith(['임대인 [Landlord_B]', null], ['2026년', null]), findings, plan());
      expect(r.status).toBe(CHECK_STATUS.NOT_FOUND);
    });
  });

  it('확인할 수 없으면 UNVERIFIABLE과 이유 코드', () => {
    expect(unverifiable('LOW_CONFIDENCE')).toEqual({ status: CHECK_STATUS.UNVERIFIABLE, hits: [], reason: 'LOW_CONFIDENCE' });
  });
});

describe('PART 5 doubleCheckPdfs(): 서류마다 PDF를 다시 읽어 검사', () => {
  const analysis = { findings };
  const pdfOk = { documentId: 'DOC_A', documentType: 'LEASE_CONTRACT', result: { ok: true, data: { blob: new Blob(['%PDF']), fileName: 'masked-lease-contract.pdf', pageCount: 1 } } };

  it('다시 읽은 글자에 개인정보가 없으면 NOT_FOUND', async () => {
    vi.mocked(readDocument).mockResolvedValueOnce({ ok: true, data: ocrDoc('임대인 [Landlord_B]') });
    const [r] = await doubleCheckPdfs(analysis, plan(), [pdfOk]);
    expect(r).toMatchObject({ documentId: 'DOC_A', documentType: 'LEASE_CONTRACT', status: CHECK_STATUS.NOT_FOUND });
  });

  it('흐린 줄이 있어도 끝까지 읽도록 PART 1에 allowLowConfidence를 넘긴다 (#146)', async () => {
    vi.mocked(readDocument).mockClear();
    vi.mocked(readDocument).mockResolvedValueOnce({ ok: true, data: ocrDoc('임대인 [Landlord_B]') });
    await doubleCheckPdfs(analysis, plan(), [pdfOk]);
    expect(readDocument).toHaveBeenCalledWith(expect.any(File), { allowLowConfidence: true });
  });

  it('OCR이 실패하면(LOW_CONFIDENCE) "괜찮다"가 아니라 확인 불가', async () => {
    vi.mocked(readDocument).mockResolvedValueOnce({ ok: false, error: { code: 'LOW_CONFIDENCE', message: 'x' } });
    const [r] = await doubleCheckPdfs(analysis, plan(), [pdfOk]);
    expect(r).toMatchObject({ status: CHECK_STATUS.UNVERIFIABLE, reason: 'LOW_CONFIDENCE' });
  });

  it('PDF를 만들지 못한 서류도 확인 불가로 둔다', async () => {
    const failed = { documentId: 'DOC_B', documentType: 'REGISTRY', result: { ok: false, error: { code: 'PDF_EXPORT_FAILED', message: 'x' } } };
    const [r] = await doubleCheckPdfs(analysis, plan(), [failed]);
    expect(r).toMatchObject({ status: CHECK_STATUS.UNVERIFIABLE, reason: 'PDF_EXPORT_FAILED' });
  });

  it('다른 서류의 개인정보와는 비교하지 않는다', async () => {
    vi.mocked(readDocument).mockResolvedValueOnce({ ok: true, data: ocrDoc('임대인 김철수') });
    const other = { ...pdfOk, documentId: 'DOC_OTHER' };
    const [r] = await doubleCheckPdfs(analysis, plan(), [other]);
    expect(r.status).toBe(CHECK_STATUS.NOT_FOUND);
  });
});

describe('PART 5 다시 검사 결과의 종류 이름', () => {
  it('모든 개인정보 종류에 화면 이름이 있다 (값 대신 이것만 보여 준다)', () => {
    for (const type of Object.values(PII_TYPE)) expect(PII_TYPE_TEXT[type], type).toBeTruthy();
  });

  it('REGISTRY_ID는 등기·법인·임대사업자 번호를 모두 담는 "Other registration number"로 쓴다 (#197, #220)', () => {
    expect(PII_TYPE_TEXT[PII_TYPE.REGISTRY_ID]).toBe('Other registration number');
  });

  it('종류 이름이 서로 겹치지 않는다 (주민·외국인등록번호와 헷갈리지 않게)', () => {
    const names = Object.values(PII_TYPE).map((type) => PII_TYPE_TEXT[type]);
    expect(new Set(names).size).toBe(names.length);
  });
});
