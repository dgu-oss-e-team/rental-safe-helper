// PART 5. 통합 테스트: 진짜 PDF 파일(가상 등기부·계약서)을 5개 파트에 처음부터 끝까지 통과시킨다.
// 샘플 PDF는 scripts/make-sample-pdfs.mjs로 만든다. 이름·번호·주소는 모두 가짜다.
// (빈 파일 = Mock 데이터를 쓰는 다른 테스트와 달리, 여기서는 PART 1이 실제로 PDF를 읽는다)
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDocuments, prepareForAi, recheckPeople } from '../src/app/pipeline.js';
import { MASKING_PURPOSE, DOCUMENT_TYPE, SOURCE_TYPE, RISK_STATUS, isValidBBox } from '../src/shared/document-model.js';

const samplePdf = (name) =>
  new File([readFileSync(new URL(`../public/samples/${name}.pdf`, import.meta.url))], `${name}.pdf`, {
    type: 'application/pdf',
  });

/** 샘플 PDF에 들어 있는 가짜 개인정보. AI 프롬프트에 하나라도 남으면 안 된다. */
const FAKE_PERSONAL_INFO = [
  '김철수', // 소유자·임대인·예금주 이름
  'NGUYEN VAN A', // 임차인 이름
  '박영수', // 예전 소유자 이름 (소유권보존 → 2026년 8월 김철수에게 이전)
  '700101-1', // 예전 소유자 주민등록번호
  '800101-1', // 소유자 주민등록번호
  '750315-1', // 임대인 주민등록번호
  '990505-5', // 임차인 외국인등록번호
  '010-0000-0000', // 연락처
  '000-000000-00000', // 계좌번호
  '0000-0000-000000', // 등기 고유번호
  '필동로', // 도로명 이하 상세 주소 (목적에 따라 시·구까지만 남거나 전부 가림)
];

/** @type {any} */
let analysis;
/** 역할로 personId 찾기 */
const roleId = (role) => analysis.personGroups.find((g) => g.roles.includes(role)).personId;

beforeAll(async () => {
  const r = await analyzeDocuments({ files: [samplePdf('sample-registry'), samplePdf('sample-lease')] });
  if (!r.ok) throw new Error(`analyzeDocuments stopped at ${r.step}: ${r.error.code}`);
  analysis = r.data;
});

describe('PART 5 통합: 샘플 PDF → ① 읽기·판별', () => {
  it('두 PDF를 글자 PDF로 읽고, 등기부와 계약서로 판별한다', () => {
    expect(analysis.documents.map((d) => d.documentType)).toEqual([DOCUMENT_TYPE.REGISTRY, DOCUMENT_TYPE.LEASE_CONTRACT]);
    for (const d of analysis.documents) expect(d.sourceType).toBe(SOURCE_TYPE.TEXT_PDF);
  });

  it('한글 단어가 글자마다 띄어지지 않는다 (예: "김 철 수" ✗)', () => {
    const text = analysis.documents.flatMap((d) => d.pages.flatMap((p) => p.blocks.map((b) => b.text))).join('\n');
    expect(text).toContain('주택임대차표준계약서');
    expect(text).toContain('임대인 김철수');
  });

  it('글자마다 실제 위치(bbox)가 있다 (페이지 전체 좌표 ✗) → 마스킹 PDF가 필요한 곳만 가린다', () => {
    for (const d of analysis.documents)
      for (const b of d.pages.flatMap((p) => p.blocks)) {
        expect(isValidBBox(b.bbox)).toBe(true);
        expect(b.bbox.width * b.bbox.height).toBeLessThan(0.5);
      }
  });
});

describe('PART 5 통합: ② 개인정보 탐지·위험 점검', () => {
  it('이름·번호·주소를 모두 찾는다', () => {
    const types = new Set(analysis.findings.map((f) => f.type));
    for (const t of ['PERSON_NAME', 'RESIDENT_ID', 'FOREIGNER_ID', 'PHONE_NUMBER', 'BANK_ACCOUNT', 'ADDRESS', 'REGISTRY_ID'])
      expect(types).toContain(t);
  });

  const statusOf = (risks, ruleId) => risks.find((r) => r.ruleId === ruleId)?.status;

  it('시연 시나리오: 소유자와 임대인은 이름이 같지만 생년월일이 달라서 STOP', () => {
    expect(statusOf(analysis.riskResults, 'OWNER_MISMATCH')).toBe(RISK_STATUS.STOP);
  });

  it('지금 소유자와 예전 소유자를 나눠 읽는다 (김철수 / 박영수)', () => {
    expect(analysis.fields.registry.owners.map((o) => o.name)).toEqual(['김철수']);
    expect(analysis.fields.registry.previousOwners.map((o) => o.name)).toEqual(['박영수']);
  });

  it('최근 소유권 이전: 이전 접수일(2026-08-03)이 계약일(2026-11-01) 6개월 안이라 CHECK', () => {
    expect(analysis.fields.registry.lastTransferDate).toBe('2026-08-03');
    expect(analysis.fields.contract.contractDate).toBe('2026-11-01');
    expect(statusOf(analysis.riskResults, 'RECENT_OWNERSHIP_CHANGE')).toBe(RISK_STATUS.CHECK);
  });

  it('등기부 권리: 근저당(채권최고액 1억 2천만 원)은 CHECK, 신탁·압류는 없음', () => {
    expect(statusOf(analysis.riskResults, 'MORTGAGE_EXISTS')).toBe(RISK_STATUS.CHECK);
    expect(statusOf(analysis.riskResults, 'TRUST_REGISTERED')).toBe(RISK_STATUS.NO_FLAG);
    expect(statusOf(analysis.riskResults, 'SEIZURE_ACTIVE')).toBe(RISK_STATUS.NO_FLAG);
  });

  it('예금주는 생년월일이 없어 확인 불가 → "같은 사람인가요?"에서 임대인이라고 답하면 NO_FLAG (STOP은 그대로)', () => {
    expect(statusOf(analysis.riskResults, 'ACCOUNT_HOLDER_MISMATCH')).toBe(RISK_STATUS.UNVERIFIABLE);
    const r = recheckPeople(analysis, { [roleId('ACCOUNT_HOLDER')]: roleId('LANDLORD') });
    expect(r.ok).toBe(true);
    expect(statusOf(r.data.riskResults, 'ACCOUNT_HOLDER_MISMATCH')).toBe(RISK_STATUS.NO_FLAG);
    expect(statusOf(r.data.riskResults, 'OWNER_MISMATCH')).toBe(RISK_STATUS.STOP);
  });
});

describe('PART 5 통합: ③~⑤ 목적별 마스킹·프롬프트', () => {
  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 프롬프트와 가린 글에 가짜 개인정보가 하나도 남지 않는다`, () => {
      const r = prepareForAi(analysis, purpose);
      expect(r.ok, r.ok ? '' : `stopped at ${r.step}: ${r.error.code}`).toBe(true);
      const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      for (const secret of FAKE_PERSONAL_INFO) expect(shared, `"${secret}" is still visible`).not.toContain(secret);
    });

    it(`${purpose}: PDF용 마스킹 계획의 위치가 모두 올바른 서류·페이지 안에 있다`, () => {
      const plan = prepareForAi(analysis, purpose).data.maskingPlan;
      const pagesByDoc = new Map(analysis.documents.map((d) => [d.documentId, d.pages.length]));
      for (const item of plan.items.filter((i) => i.action !== 'KEEP')) {
        expect(pagesByDoc.has(item.documentId)).toBe(true);
        expect(item.pageIndex).toBeLessThan(pagesByDoc.get(item.documentId));
        expect(isValidBBox(item.bbox)).toBe(true);
      }
    });
  }

  it('"같은 사람"으로 답해서 가명을 합쳐도 프롬프트에 가짜 개인정보가 남지 않는다', () => {
    const checked = recheckPeople(analysis, { [roleId('ACCOUNT_HOLDER')]: roleId('LANDLORD') }).data;
    const merged = { ...analysis, personGroups: checked.personGroups, riskResults: checked.riskResults };
    const r = prepareForAi(merged, MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.data.legend)).not.toContain('[AccountHolder_D]');
    for (const secret of FAKE_PERSONAL_INFO) expect(r.data.prompt, `"${secret}" is still visible`).not.toContain(secret);
  });
});
