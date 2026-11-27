// PART 5. AI 프롬프트의 서류 제목을 내부 ID 대신 서류 이름으로 (#240)
// 실제 서류 점검에서 프롬프트에 "### doc-1795…" 같은 내부 ID가 나갔다. 가짜 데이터만 사용.
import { describe, it, expect } from 'vitest';
import { analyzeDocuments, prepareForAi } from '../src/app/pipeline.js';
import { promptDocumentTitles, titledMaskedText, DOCUMENT_TEXT } from '../src/app/document-names.js';
import { DOCUMENT_TEXT as SLOT_DOCUMENT_TEXT } from '../src/app/slots.js';
import { DOCUMENT_TYPE, MASKING_PURPOSE } from '../src/shared/document-model.js';

const REGISTRY = DOCUMENT_TEXT[DOCUMENT_TYPE.REGISTRY];
const LEASE = DOCUMENT_TEXT[DOCUMENT_TYPE.LEASE_CONTRACT];

const sampleFiles = () => [
  new File([''], 'sample-registry.pdf', { type: 'application/pdf' }),
  new File([''], 'sample-lease.pdf', { type: 'application/pdf' }),
];

describe('PART 5 promptDocumentTitles(): 프롬프트에 쓸 서류 이름 (#240)', () => {
  it('등기부·계약서는 화면과 같은 이름', () => {
    const titles = promptDocumentTitles([
      { documentId: 'doc-a', documentType: DOCUMENT_TYPE.REGISTRY },
      { documentId: 'doc-b', documentType: DOCUMENT_TYPE.LEASE_CONTRACT },
    ]);
    expect([...titles]).toEqual([
      ['doc-a', 'Property register (등기부등본)'],
      ['doc-b', 'Lease contract (임대차계약서)'],
    ]);
  });

  it('같은 종류가 두 개면 뒤에 번호를 붙여 겹치지 않게 한다', () => {
    const titles = promptDocumentTitles([
      { documentId: 'doc-a', documentType: DOCUMENT_TYPE.LEASE_CONTRACT },
      { documentId: 'doc-b', documentType: DOCUMENT_TYPE.LEASE_CONTRACT },
    ]);
    expect([...titles.values()]).toEqual([LEASE, `${LEASE} 2`]);
  });

  it('종류를 모르는 서류는 올린 순서로 "Document N"', () => {
    const titles = promptDocumentTitles([
      { documentId: 'doc-a', documentType: DOCUMENT_TYPE.REGISTRY },
      { documentId: 'doc-b', documentType: DOCUMENT_TYPE.UNKNOWN },
      { documentId: 'doc-c' },
    ]);
    expect([...titles.values()]).toEqual([REGISTRY, 'Document 2', 'Document 3']);
  });

  it('titledMaskedText(): 키만 바꾸고 글과 순서는 그대로, 원래 객체는 바꾸지 않는다', () => {
    const maskedText = { 'doc-b': '계약서 글', 'doc-a': '등기부 글' };
    const documents = [
      { documentId: 'doc-a', documentType: DOCUMENT_TYPE.REGISTRY },
      { documentId: 'doc-b', documentType: DOCUMENT_TYPE.LEASE_CONTRACT },
    ];
    expect(Object.entries(titledMaskedText(maskedText, documents))).toEqual([
      [LEASE, '계약서 글'],
      [REGISTRY, '등기부 글'],
    ]);
    expect(Object.keys(maskedText)).toEqual(['doc-b', 'doc-a']);
  });

  it('documents에 없는 서류도 내부 ID를 쓰지 않는다', () => {
    const out = titledMaskedText({ 'doc-x': '글' }, []);
    expect(Object.keys(out)).toEqual(['Document 1']);
  });

  it('화면(slots.js)과 같은 이름표를 쓴다', () => {
    expect(SLOT_DOCUMENT_TEXT).toBe(DOCUMENT_TEXT);
  });
});

describe('PART 5 prepareForAi(): 프롬프트 서류 제목 (#240)', () => {
  it.each(Object.values(MASKING_PURPOSE))('%s: "### 서류 이름"으로 나가고 내부 ID는 나가지 않는다', async (purpose) => {
    const analyzed = (await analyzeDocuments({ files: sampleFiles() })).data;
    const prepared = prepareForAi(analyzed, purpose).data;
    // 계약 조건 설명에는 등기부를 보내지 않는다 (#360)
    if (purpose === MASKING_PURPOSE.CONTRACT_EXPLANATION) {
      // 계약 조건 설명에는 등기부를 보내지 않는다 (#360)
      expect(prepared.prompt).not.toContain(`### ${REGISTRY}\n`);
      expect(prepared.prompt).not.toContain('Registry (extracted)');
    } else if (purpose === MASKING_PURPOSE.FRAUD_CHECK) {
      // 등기부 요약은 이름표로 나간다 (#361)
      expect(prepared.prompt).toContain('### Registry (extracted)\n');
      expect(prepared.prompt).not.toContain(`### ${REGISTRY}\n`);
    } else {
      // 조항·용어 설명: 가린 원문이라 서류 이름 그대로
      expect(prepared.prompt).toContain(`### ${REGISTRY}\n`);
      expect(prepared.prompt).not.toContain('Registry (extracted)');
    }
    expect(prepared.prompt).toContain(`### ${LEASE}\n`);
    for (const doc of analyzed.documents) expect(prepared.prompt).not.toContain(doc.documentId);
  });

  it('④ 화면·PDF·검사에 쓰는 maskedText는 지금처럼 documentId 키를 유지한다', async () => {
    const analyzed = (await analyzeDocuments({ files: sampleFiles() })).data;
    const prepared = prepareForAi(analyzed, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(Object.keys(prepared.maskedText).sort()).toEqual(analyzed.documents.map((d) => d.documentId).sort());
  });
});
