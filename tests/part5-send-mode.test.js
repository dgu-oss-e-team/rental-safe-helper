// PART 5. 목적별로 AI에 보낼 서류 고르기 + 등기부 요약 연결 (#360). 가짜 샘플 PDF만 사용.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDocuments, prepareForAi } from '../src/app/pipeline.js';
import { DOCUMENT_TEXT } from '../src/app/document-names.js';
import { withPageMarksByBlocks } from '../src/app/page-marks.js';
import { sendingNotes } from '../src/app/screens/done.js';
import { DOCUMENT_TYPE, MASKING_PURPOSE } from '../src/shared/document-model.js';

const REGISTRY = DOCUMENT_TEXT[DOCUMENT_TYPE.REGISTRY];
const LEASE = DOCUMENT_TEXT[DOCUMENT_TYPE.LEASE_CONTRACT];
const SUMMARY_HEAD = 'Extracted items from the property register';

const samplePdf = (name) =>
  new File([readFileSync(new URL(`../public/samples/${name}.pdf`, import.meta.url))], `${name}.pdf`, { type: 'application/pdf' });

/** 프롬프트에서 "### 제목" 아래 글 (다음 "### " 또는 "## " 제목까지) */
function section(prompt, title) {
  const start = prompt.indexOf(`### ${title}\n`);
  if (start < 0) return null;
  const body = prompt.slice(start + title.length + 5);
  const end = body.search(/\n#{2,3} /);
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

  it('조항·용어 설명: 등기부는 요약이 아니라 가린 원문, 계약서는 인적사항 칸만 요약 (PART 2가 찾은 범위)', () => {
    const r = prepareForAi(analysis, MASKING_PURPOSE.CLAUSE_EXPLANATION);
    expect(r.ok).toBe(true);
    expect(section(r.data.prompt, REGISTRY)).not.toContain(SUMMARY_HEAD);
    expect(section(r.data.prompt, REGISTRY)).toContain('--- page 1 ---');
    expect(r.data.sending.map((s) => s.mode)).toEqual(['MASKED_TEXT', 'PARTY_SUMMARY']);
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

describe('PART 5 prepareForAi(): 계약서 인적사항 칸 요약 연결 (#360, PART 4 #357)', () => {
  /** @type {any} */
  let analysis;
  /** @type {any} */
  let lease;
  /** 가짜 샘플 계약서의 인적사항 칸 (가린 글 28~33번 줄: 임대인·임차인 주소·번호·성명). PART 2 personalInfoRanges(#352) 대신 정해 둔 범위 */
  const RANGE = { startLine: 28, endLine: 33 };
  /** @param {any} a @param {any[]} ranges */
  const withRanges = (a, ranges) => ({ ...a, fields: { ...a.fields, contract: { ...a.fields.contract, personalInfoRanges: ranges } } });
  const withRange = (a, range = RANGE) => withRanges(a, [range]);
  const stripMarks = (text) => text.split('\n').filter((l) => !/^--- page \d+ ---$/.test(l)).join('\n');

  beforeAll(async () => {
    const a = await analyzeDocuments({ files: [samplePdf('sample-registry'), samplePdf('sample-lease')] });
    analysis = a.data;
    lease = analysis.documents.find((d) => d.documentType === DOCUMENT_TYPE.LEASE_CONTRACT);
  }, 20000);

  it('범위가 있으면 세 목적 모두 인적사항 칸만 요약으로 바뀌고, 본문·특약은 가린 원문 그대로', () => {
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const r = prepareForAi(withRange(analysis), purpose);
      expect(r.ok, purpose).toBe(true);
      const text = section(r.data.prompt, LEASE);
      expect(text, purpose).toContain('Personal information section of the contract');
      expect(text, purpose).not.toContain('주민등록번호 [REDACTED]');
      expect(text, purpose).not.toContain('외국인등록번호 [REDACTED]');
      expect(text, purpose).toContain('[특약사항]');
      expect(r.data.sending.find((s) => s.documentId === lease.documentId)?.mode, purpose).toBe('PARTY_SUMMARY');
    }
  });

  it('사기 점검에서는 역할마다 가명과 관계가 들어간다', () => {
    const r = prepareForAi(withRange(analysis), MASKING_PURPOSE.FRAUD_CHECK);
    expect(section(r.data.prompt, LEASE)).toMatch(/Landlord: \[Landlord_B\]/);
    expect(section(r.data.prompt, LEASE)).toMatch(/Tenant: \[Tenant_C\]/);
  });

  it('쪽 표시도 그대로 들어가고, 쪽 표시를 빼면 검사한 글과 똑같다', () => {
    const r = prepareForAi(withRange(analysis), MASKING_PURPOSE.FRAUD_CHECK);
    const text = section(r.data.prompt, LEASE);
    expect(text).toContain('--- page 1 ---');
    expect(text).toContain('--- page 2 ---');
    expect(text.indexOf('--- page 2 ---')).toBeLessThan(text.indexOf('Personal information section'));
    expect(stripMarks(text).trimEnd()).toBe(r.data.sentText[lease.documentId]);
  });

  it('PART 2가 실제로 찾은 범위(#352)로도 인적사항 칸이 요약되고 임대인 주민등록번호 줄이 프롬프트에서 빠진다', () => {
    expect(Array.isArray(analysis.fields.contract.personalInfoRanges)).toBe(true);
    expect(analysis.fields.contract.personalInfoRanges.length).toBeGreaterThan(0);
    const r = prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK);
    const text = section(r.data.prompt, LEASE);
    expect(text).toContain('Personal information section of the contract');
    expect(text).not.toContain('주민등록번호 [REDACTED]');
    // 임차인의 "외국인등록번호 … 성명" 줄은 PART 2 범위에 아직 안 들어간다 (칸 이름 목록에 외국인등록번호가 없음, PART 2에 부탁).
    // 그 줄도 가린 원문이라 개인정보는 남지 않는다.
    expect(text).toContain('[특약사항]');
    expect(r.data.sending.find((s) => s.documentId === lease.documentId)?.mode).toBe('PARTY_SUMMARY');
  });

  it('범위가 없으면(PART 2 범위를 못 찾음) 가린 원문 그대로 보낸다', () => {
    const r = prepareForAi(withRanges(analysis, []), MASKING_PURPOSE.FRAUD_CHECK);
    expect(section(r.data.prompt, LEASE)).not.toContain('Personal information section');
    expect(r.data.sending.find((s) => s.documentId === lease.documentId)?.mode).toBe('MASKED_TEXT');
  });

  it('추출 데이터가 다른 계약서의 것이면(특약 별지 등) 그 서류는 가린 원문', () => {
    const other = withRange(analysis);
    other.fields.contract = { ...other.fields.contract, documentId: 'OTHER_DOC' };
    const r = prepareForAi(other, MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.data.sending.find((s) => s.documentId === lease.documentId)?.mode).toBe('MASKED_TEXT');
  });

  it('범위가 서류 줄 수를 넘으면 바꾸지 않는다', () => {
    const r = prepareForAi(withRange(analysis, { startLine: 28, endLine: 999 }), MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.data.sending.find((s) => s.documentId === lease.documentId)?.mode).toBe('MASKED_TEXT');
  });

  it('④ 화면·PDF용 maskedText는 요약으로 바뀌지 않는다', () => {
    const r = prepareForAi(withRange(analysis), MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.data.maskedText[lease.documentId]).not.toContain('Personal information section');
    expect(r.data.maskedText[lease.documentId]).toContain('주민등록번호 [REDACTED]');
  });
});

describe('PART 5 withPageMarksByBlocks(): 요약을 넣은 글의 쪽 표시 (#360)', () => {
  const doc = {
    documentId: 'D',
    pages: [
      { pageIndex: 0, blocks: [{ blockId: 'A' }, { blockId: 'B' }] },
      { pageIndex: 1, blocks: [{ blockId: 'C' }] },
    ],
  };

  it('쪽이 바뀌는 곳에 표시를 넣고, 요약 줄(null)은 앞 줄의 쪽을 따른다', () => {
    expect(withPageMarksByBlocks(doc, 'a\nb\nS1\nc', ['A', 'B', null, 'C'])).toBe('--- page 1 ---\na\nb\nS1\n--- page 2 ---\nc');
  });

  it('맨 앞 요약 줄은 다음 원문 줄의 쪽을 따른다', () => {
    expect(withPageMarksByBlocks(doc, 'S1\nc', [null, 'C'])).toBe('--- page 2 ---\nS1\nc');
  });

  it('줄 수가 안 맞거나, 모르는 blockId가 있거나, 원문 줄이 없으면 받은 글 그대로', () => {
    expect(withPageMarksByBlocks(doc, 'a\nb', ['A'])).toBe('a\nb');
    expect(withPageMarksByBlocks(doc, 'a\nx', ['A', 'X'])).toBe('a\nx');
    expect(withPageMarksByBlocks(doc, 'S1', [null])).toBe('S1');
    expect(withPageMarksByBlocks(undefined, 'a', ['A'])).toBe('a');
  });
});

describe('PART 5 sendingNotes(): 완료 화면 안내 (#360)', () => {
  it('인적사항 칸 요약: 그 칸만 바뀌고 나머지는 가린 원문이라는 안내', () => {
    const notes = sendingNotes([{ documentId: 'A', documentType: DOCUMENT_TYPE.LEASE_CONTRACT, mode: 'PARTY_SUMMARY' }]);
    expect(notes).toEqual([`${LEASE}: the section with the parties' personal details is replaced by a short list of roles. The rest is the masked text.`]);
  });

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
