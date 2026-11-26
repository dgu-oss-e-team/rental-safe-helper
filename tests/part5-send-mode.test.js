// PART 5. 목적별로 AI에 보낼 서류 고르기 + 등기부 요약 연결 (#360). 가짜 샘플 PDF만 사용.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDocuments, prepareForAi } from '../src/app/pipeline.js';
import { DOCUMENT_TEXT } from '../src/app/document-names.js';
import { sendingNotes } from '../src/app/screens/done.js';
import { DOCUMENT_TYPE, MASKING_PURPOSE } from '../src/shared/document-model.js';

const REGISTRY = DOCUMENT_TEXT[DOCUMENT_TYPE.REGISTRY];
const LEASE = DOCUMENT_TEXT[DOCUMENT_TYPE.LEASE_CONTRACT];
const SUMMARY_HEAD = 'Extracted items from the property register';

const samplePdf = (name) =>
  new File([readFileSync(new URL(`../public/samples/${name}.pdf`, import.meta.url))], `${name}.pdf`, { type: 'application/pdf' });

/** 프롬프트에서 "### 제목" 아래 글 (다음 "### "까지) */
function section(prompt, title) {
  const start = prompt.indexOf(`### ${title}\n`);
  if (start < 0) return null;
  const body = prompt.slice(start + title.length + 5);
  const end = body.indexOf('\n### ');
  return end < 0 ? body : body.slice(0, end);
}

/** 가린 원문에서 요약에는 없는 긴 줄들 (원문이 프롬프트에 들어갔는지 보는 데 쓴다) */
const longLines = (text) => text.split('\n').filter((l) => l.trim().length >= 12);

describe('PART 5 prepareForAi(): 목적별로 보낼 서류 (#360)', () => {
  /** @type {any} */
  let analysis;
  /** @type {any} */
  let registry;
  beforeAll(async () => {
    const a = await analyzeDocuments({ files: [samplePdf('sample-registry'), samplePdf('sample-lease')] });
    analysis = a.data;
    registry = analysis.documents.find((d) => d.documentType === DOCUMENT_TYPE.REGISTRY);
  }, 20000);

  it('사기 위험 확인: 등기부는 요약만, 가린 원문 줄은 프롬프트에 없다. 계약서는 가린 원문', () => {
    const r = prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.ok).toBe(true);
    const reg = section(r.data.prompt, REGISTRY);
    expect(reg).toContain(SUMMARY_HEAD);
    for (const line of longLines(r.data.maskedText[registry.documentId])) expect(reg).not.toContain(line);
    expect(r.data.sending.find((s) => s.documentId === registry.documentId)).toMatchObject({ mode: 'SUMMARY', hiddenCount: 0 });
    expect(r.data.sentText[registry.documentId]).toContain(SUMMARY_HEAD);
    expect(section(r.data.prompt, LEASE)).toContain('--- page 1 ---');
  });

  it('요약한 등기부에는 쪽 표시를 넣지 않고, 가린 원문 서류에는 지금처럼 넣는다', () => {
    const r = prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK);
    expect(section(r.data.prompt, REGISTRY)).not.toContain('--- page');
    expect(section(r.data.prompt, LEASE)).toContain('--- page 1 ---');
  });

  it('조항·용어 설명: 두 서류 모두 가린 원문 (지금과 같음)', () => {
    const r = prepareForAi(analysis, MASKING_PURPOSE.CLAUSE_EXPLANATION);
    expect(r.ok).toBe(true);
    expect(section(r.data.prompt, REGISTRY)).not.toContain(SUMMARY_HEAD);
    expect(section(r.data.prompt, REGISTRY)).toContain('--- page 1 ---');
    expect(r.data.sending.map((s) => s.mode)).toEqual(['MASKED_TEXT', 'MASKED_TEXT']);
  });

  it('계약 조건 설명: 등기부는 보내지 않고, 까닭(PURPOSE)을 남긴다', () => {
    const r = prepareForAi(analysis, MASKING_PURPOSE.CONTRACT_EXPLANATION);
    expect(r.ok).toBe(true);
    expect(section(r.data.prompt, REGISTRY)).toBeNull();
    expect(section(r.data.prompt, LEASE)).not.toBeNull();
    expect(r.data.sentText[registry.documentId]).toBeUndefined();
    expect(r.data.sending.find((s) => s.documentId === registry.documentId)).toMatchObject({ mode: 'OMIT', reason: 'PURPOSE' });
  });

  it('보내지 않는 서류도 ④ 화면·PDF용 maskedText와 마스킹 계획에는 그대로 있다', () => {
    const r = prepareForAi(analysis, MASKING_PURPOSE.CONTRACT_EXPLANATION);
    expect(Object.keys(r.data.maskedText).sort()).toEqual(analysis.documents.map((d) => d.documentId).sort());
    expect(r.data.maskingPlan.items.some((i) => i.documentId === registry.documentId)).toBe(true);
  });

  it('등기부 요약을 못 만들면 등기부를 빼고 보낸다. 가린 원문으로 돌아가지 않는다', () => {
    const broken = { ...analysis, fields: { ...analysis.fields, registry: null } };
    const r = prepareForAi(broken, MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.ok).toBe(true);
    expect(section(r.data.prompt, REGISTRY)).toBeNull();
    for (const line of longLines(r.data.maskedText[registry.documentId])) {
      if (!r.data.maskedText[analysis.documents.find((d) => d !== registry).documentId].includes(line)) {
        expect(r.data.prompt).not.toContain(line);
      }
    }
    expect(r.data.sending.find((s) => s.documentId === registry.documentId)).toMatchObject({ mode: 'OMIT', reason: 'SUMMARY_FAILED' });
  });

  it('추출 데이터가 다른 등기부의 것이면(등기부를 두 개 올림) 그 등기부도 원문 대신 뺀다', () => {
    const other = { ...analysis, fields: { ...analysis.fields, registry: { ...analysis.fields.registry, documentId: 'OTHER_DOC' } } };
    const r = prepareForAi(other, MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.ok).toBe(true);
    expect(section(r.data.prompt, REGISTRY)).toBeNull();
    expect(r.data.sending.find((s) => s.documentId === registry.documentId)?.reason).toBe('SUMMARY_FAILED');
  });

  it('등기부만 올리고 계약 조건 설명을 고르면, 멈추지 않고 프롬프트 없이 진행한다 (마스킹 PDF는 만들 수 있게)', () => {
    const only = {
      ...analysis,
      documents: [registry],
      files: [analysis.files[analysis.documents.indexOf(registry)]],
      findings: analysis.findings.filter((f) => f.documentId === undefined || f.documentId === registry.documentId),
    };
    const r = prepareForAi(only, MASKING_PURPOSE.CONTRACT_EXPLANATION);
    expect(r.ok).toBe(true);
    expect(r.data.prompt).toBe('');
    expect(r.data.sentText).toEqual({});
    expect(r.data.maskingPlan.items.length).toBeGreaterThan(0);
  });
});

describe('PART 5 sendingNotes(): 완료 화면 안내 (#360)', () => {
  it('가린 원문 그대로인 서류는 따로 말하지 않는다', () => {
    expect(sendingNotes([{ documentId: 'A', documentType: DOCUMENT_TYPE.LEASE_CONTRACT, mode: 'MASKED_TEXT' }])).toEqual([]);
    expect(sendingNotes(undefined)).toEqual([]);
  });

  it('요약: 원문이 아니라는 안내, 가린 항목이 있으면 개수까지', () => {
    expect(sendingNotes([{ documentId: 'A', documentType: DOCUMENT_TYPE.REGISTRY, mode: 'SUMMARY', hiddenCount: 0 }])).toEqual([
      `${REGISTRY}: only a short list of extracted items is in the prompt, not the full text.`,
    ]);
    const two = sendingNotes([{ documentId: 'A', documentType: DOCUMENT_TYPE.REGISTRY, mode: 'SUMMARY', hiddenCount: 2 }]);
    expect(two).toHaveLength(2);
    expect(two[1]).toContain('2 items were hidden');
    expect(sendingNotes([{ documentId: 'A', documentType: DOCUMENT_TYPE.REGISTRY, mode: 'SUMMARY', hiddenCount: 1 }])[1]).toContain('1 item was hidden');
  });

  it('뺀 서류: 목적 때문인지, 요약을 못 만들어서인지 나눠 말한다. 안전하다는 말은 쓰지 않는다', () => {
    const purpose = sendingNotes([{ documentId: 'A', documentType: DOCUMENT_TYPE.REGISTRY, mode: 'OMIT', reason: 'PURPOSE' }]);
    const failed = sendingNotes([{ documentId: 'A', documentType: DOCUMENT_TYPE.REGISTRY, mode: 'OMIT', reason: 'SUMMARY_FAILED' }]);
    expect(purpose[0]).toContain('this purpose does not need it');
    expect(failed[0]).toContain('could not prepare its summary');
    expect(failed[0]).toContain('never shared instead');
    for (const text of [...purpose, ...failed]) expect(text.toLowerCase()).not.toContain('safe');
  });
});
