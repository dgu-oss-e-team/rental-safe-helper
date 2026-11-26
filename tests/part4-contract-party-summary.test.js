// PART 4. 계약서 인적사항 칸 요약: 가린 원문에서 인적사항 칸 줄만 요약으로 바꾼다. 예시는 모두 가짜 값이다.
// 범위는 PART 2 contract.personalInfoRange(한 칸, #352) 또는 personalInfoRanges(여러 칸) 둘 다 받는다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildContractPartySummary, createMaskingPlan, applyMaskingPlan, validateMaskedText } from '../src/features/masking/index.js';
import { normalizeRanges } from '../src/features/masking/contract-party-summary.js';
import { analyzeDocuments } from '../src/app/pipeline.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

const { FRAUD_CHECK, CLAUSE_EXPLANATION, CONTRACT_EXPLANATION } = MASKING_PURPOSE;

// 가린 계약서 글 (applyMaskingPlan 결과 모양): 0~1 제목, 2~8 인적사항 칸, 9~11 본문, 12~13 서명 칸
const MASKED = [
  '민간임대주택 표준임대차계약서',
  '1. 계약 당사자',
  '임대사업자 성명 [Owner_A]',
  '주민등록번호 [REDACTED] 전화번호 [REDACTED]',
  '주소 서울특별시 [REDACTED] 가상로 30, 2층 204호',
  '임차인 성명 [Tenant_B]',
  '주소 [REDACTED]',
  '개업공인중개사 대표자 성명 김삿갓',
  '중개사무소 소재지 [REDACTED]',
  '제1조 임대보증금 금 50,000,000원',
  '계좌번호 [REDACTED] 은행 가상은행 예금주 [AccountHolder_C]',
  '제2조 임차인은 계약기간 중 전입신고를 하지 않는다.',
  '임대사업자 [Owner_A] (서명 또는 인)',
  '임차인 [Tenant_B] (서명 또는 인)',
].join('\n');

const GROUPS = [
  { personId: 'P1', alias: '[Owner_A]', roles: ['OWNER', 'LANDLORD'], findingIds: ['PII_R01', 'PII_L01'], status: 'CONFIRMED' },
  { personId: 'P2', alias: '[Tenant_B]', roles: ['TENANT'], findingIds: ['PII_L02'], status: 'CONFIRMED' },
  { personId: 'P3', alias: '[AccountHolder_C]', roles: ['ACCOUNT_HOLDER'], findingIds: ['PII_L03'], status: 'CONFIRMED' },
];
const LEGEND = { '[Owner_A]': 'owner on the register, landlord on the contract', '[Tenant_B]': 'tenant', '[AccountHolder_C]': 'account holder' };

/** @param {object} [over] */
const contract = (over = {}) => ({
  documentId: 'DOC_LEASE',
  landlords: [{ findingId: 'PII_L01', name: '홍길동', role: 'LANDLORD' }],
  tenants: [{ findingId: 'PII_L02', name: '왕리웨이', role: 'TENANT' }],
  accountHolders: [{ findingId: 'PII_L03', name: '김철수', role: 'ACCOUNT_HOLDER' }],
  landlordCompanies: [],
  personalInfoRange: { startLine: 1, endLine: 8 },
  ...over,
});

/** @param {object} [over] @param {string} [purpose] @param {any} [extra] */
const run = (over, purpose = FRAUD_CHECK, extra = {}) => {
  const r = buildContractPartySummary({ maskedText: MASKED, contractFields: contract(over), personGroups: GROUPS, purpose, legend: LEGEND, ...extra });
  expect(r.ok).toBe(true);
  return /** @type {{ documentId: string, text: string, replaced: boolean, lineBlocks?: (string | null)[] }} */ (r.data);
};

describe('PART 4 계약서 인적사항 칸 요약 (buildContractPartySummary)', () => {
  it('인적사항 칸 줄은 빼고 요약으로 바꾸고, 본문·특약은 가린 원문 그대로 둔다', () => {
    const { documentId, text, replaced } = run();
    expect(documentId).toBe('DOC_LEASE');
    expect(replaced).toBe(true);
    // 칸 안의 원문(놓친 이름·주소 조각 포함)은 나가지 않는다
    for (const line of ['김삿갓', '가상로 30, 2층 204호', '주민등록번호', '중개사무소 소재지']) expect(text).not.toContain(line);
    expect(text).toContain('Personal information section of the contract: extracted items (the original lines are not sent).');
    // 본문·특약·칸 밖 줄은 그대로
    expect(text).toContain('제1조 임대보증금 금 50,000,000원');
    expect(text).toContain('제2조 임차인은 계약기간 중 전입신고를 하지 않는다.');
    expect(text.split('\n')[0]).toBe('민간임대주택 표준임대차계약서');
  });

  it('사기 점검: 역할마다 가명과 관계를 적는다', () => {
    const { text } = run();
    expect(text).toContain('Landlord: [Owner_A] (same person as the owner on the register)');
    expect(text).toContain('Tenant: [Tenant_B]');
    expect(text).toContain('Payment account holder: [AccountHolder_C] (a different person from the landlord)');
    // 칸 이름만 보고 붙이므로 "등록된 중개사 있음"이 아니라 "중개사 칸이 있음"으로 적는다 (#357 리뷰)
    expect(text).toContain('Real estate agent: a section for the agent is present (details hidden)');
  });

  it('사기 점검: 임대인과 예금주가 같은 사람, 소유자와 다른 임대인, 확인 안 된 사람', () => {
    const groups = [
      { personId: 'P1', alias: '[Owner_A]', roles: ['OWNER'], findingIds: ['PII_R01'], status: 'CONFIRMED' },
      { personId: 'P2', alias: '[Landlord_B]', roles: ['LANDLORD', 'ACCOUNT_HOLDER'], findingIds: ['PII_L01', 'PII_L03'], status: 'CONFIRMED' },
      { personId: 'P3', alias: '[Tenant_C]', roles: ['TENANT'], findingIds: ['PII_L02'], status: 'CONFIRMED' },
    ];
    const r = buildContractPartySummary({ maskedText: MASKED, contractFields: contract(), personGroups: groups, purpose: FRAUD_CHECK });
    expect(r.ok && r.data.text).toContain('Landlord: [Landlord_B] (a different person from the owner on the register)');
    expect(r.ok && r.data.text).toContain('Payment account holder: [Landlord_B] (same person as the landlord)');

    const ambiguous = groups.map((g) => (g.personId === 'P2' ? { ...g, roles: ['LANDLORD'], findingIds: ['PII_L01'], status: 'AMBIGUOUS' } : g));
    ambiguous.push({ personId: 'P4', alias: '[AccountHolder_D]', roles: ['ACCOUNT_HOLDER'], findingIds: ['PII_L03'], status: 'AMBIGUOUS' });
    const r2 = buildContractPartySummary({ maskedText: MASKED, contractFields: contract(), personGroups: ambiguous, purpose: FRAUD_CHECK });
    expect(r2.ok && r2.data.text).toContain('Landlord: [Landlord_B] (not confirmed whether this is the owner on the register)');
    expect(r2.ok && r2.data.text).toContain('Payment account holder: [AccountHolder_D] (not confirmed whether this is the landlord)');
  });

  it('사기 점검: 확인 안 된(AMBIGUOUS) 그룹은 소유자·임대인 역할이 합쳐져 있어도 "같은 사람"이라고 하지 않는다 (#357 리뷰)', () => {
    const groups = [
      { personId: 'P1', alias: '[Owner_A]', roles: ['OWNER', 'LANDLORD', 'ACCOUNT_HOLDER'], findingIds: ['PII_R01', 'PII_L01', 'PII_L03'], status: 'AMBIGUOUS' },
      { personId: 'P2', alias: '[Tenant_B]', roles: ['TENANT'], findingIds: ['PII_L02'], status: 'CONFIRMED' },
    ];
    const r = buildContractPartySummary({ maskedText: MASKED, contractFields: contract(), personGroups: groups, purpose: FRAUD_CHECK });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.text).not.toContain('same person');
    expect(r.data.text).toContain('Landlord: [Owner_A] (not confirmed whether this is the owner on the register)');
    expect(r.data.text).toContain('Payment account holder: [Owner_A] (not confirmed whether this is the landlord)');
  });

  it('사기 점검: 등기부가 없으면(소유자 없음) 소유자 관계는 적지 않는다', () => {
    const groups = GROUPS.map((g) => ({ ...g, roles: g.roles.filter((r) => r !== 'OWNER') }));
    const r = buildContractPartySummary({ maskedText: MASKED, contractFields: contract(), personGroups: groups, purpose: FRAUD_CHECK });
    expect(r.ok && r.data.text).toMatch(/Landlord: \[Owner_A\]\n/);
  });

  it('임대인이 회사면 회사 이름은 넣지 않는다 (landlordCompanies는 화면 전용)', () => {
    const { text } = run({ landlords: [], landlordCompanies: ['주식회사가상리츠'] });
    expect(text).toContain('Landlord: a company (name not sent), while the owner on the register is an individual');
    expect(text).not.toContain('가상리츠');
  });

  it('임대인·소유자가 둘 다 회사면 등기부 데이터로 같은 회사인지 적는다. 같다는 말은 완전히 같을 때만 (#357 리뷰)', () => {
    const groups = [{ personId: 'P2', alias: '[Tenant_B]', roles: ['TENANT'], findingIds: ['PII_L02'], status: 'CONFIRMED' }];
    /** @param {string} landlordCompany @param {any} registryFields */
    const landlordLine = (landlordCompany, registryFields) => {
      const r = buildContractPartySummary({
        maskedText: MASKED,
        contractFields: contract({ landlords: [], landlordCompanies: [landlordCompany], accountHolders: [] }),
        personGroups: groups,
        purpose: FRAUD_CHECK,
        registryFields,
      });
      return r.ok ? r.data.text.split('\n').find((l) => l.startsWith('Landlord:')) : null;
    };
    const SAME = 'Landlord: a company (name not sent), the same company as the owner on the register';
    const NO_MATCH = 'Landlord: a company (name not sent), the company name does not match the owner on the register (check the original)';
    expect(landlordLine('주식회사 가상리츠', { ownerCompanies: ['주식회사가상리츠'] })).toBe(SAME);
    // 회사 형태 표기만 다른 같은 회사 (#357 2차 리뷰)
    expect(landlordLine('(주)가상부동산신탁', { ownerCompanies: ['가상부동산신탁주식회사'] })).toBe(SAME);
    // 한쪽이 다른 쪽을 품는 다른 회사는 같다고 하지 않고, 다르다고 단정하지도 않는다 (#357 2차 리뷰)
    expect(landlordLine('가상건설산업 주식회사', { ownerCompanies: ['가상건설주식회사'] })).toBe(NO_MATCH);
    expect(landlordLine('주식회사 가상리츠', { ownerCompanies: ['가상부동산신탁주식회사'] })).toBe(NO_MATCH);
    // 등기부를 안 줬으면 비교하지 않았다고, 등기부는 있는데 소유자 정보가 없으면 확인 안 됨이라고 적는다
    expect(landlordLine('주식회사 가상리츠', undefined)).toBe('Landlord: a company (name not sent), no register provided, so not compared');
    expect(landlordLine('주식회사 가상리츠', { ownerCompanies: [] })).toBe(
      'Landlord: a company (name not sent), not confirmed whether this is the owner on the register',
    );
  });

  it('임대인을 못 읽었으면 예금주를 "임대인과 다른 사람"이라고 하지 않는다 (#357 2차 리뷰)', () => {
    const { text } = run({ landlords: null, landlordCompanies: [] });
    expect(text).toContain('Landlord: Could not read');
    expect(text).toContain('Payment account holder: [AccountHolder_C] (the landlord could not be read, so not compared)');
    expect(text).not.toContain('a different person from the landlord');
  });

  it('사기 점검: 소유자가 회사이고 임대인이 개인이면 그 관계를 적는다 (소유자 그룹이 없어도 관계가 빠지지 않게, #357 리뷰)', () => {
    const groups = GROUPS.map((g) => ({ ...g, roles: g.roles.filter((r) => r !== 'OWNER') }));
    const r = buildContractPartySummary({
      maskedText: MASKED,
      contractFields: contract(),
      personGroups: groups,
      purpose: FRAUD_CHECK,
      registryFields: { ownerCompanies: ['가상부동산신탁주식회사'] },
    });
    expect(r.ok && r.data.text).toContain('Landlord: [Owner_A] (an individual, while the owner on the register is a company)');
  });

  it('못 읽은 사람은 "Could not read"', () => {
    const { text } = run({ landlords: null, tenants: null, accountHolders: null });
    expect(text).toContain('Landlord: Could not read');
    expect(text).toContain('Tenant: Could not read');
  });

  it('예금주를 못 읽었으면(null) "Could not read", 읽었는데 없으면([]) "none found"로 적는다 (#357 리뷰)', () => {
    expect(run({ accountHolders: null }).text).toContain('Payment account holder: Could not read');
    expect(run({ accountHolders: [] }).text).toContain('Payment account holder: none found');
  });

  it.each([CLAUSE_EXPLANATION, CONTRACT_EXPLANATION])('%s: 가명 없이 어떤 역할 칸이 있는지만 적는다', (purpose) => {
    const { text } = run({}, purpose);
    expect(text).toContain('Parties listed: landlord, tenant, real estate agent (names, addresses and contact details hidden)');
    expect(text).not.toMatch(/Landlord:|Tenant:|Payment account holder:/);
  });

  it('여러 칸(personalInfoRanges): 첫 칸은 요약, 나머지 칸(서명 칸)은 "내용 가림" 한 줄', () => {
    const { text } = run({ personalInfoRange: undefined, personalInfoRanges: [{ startLine: 12, endLine: 13 }, { startLine: 1, endLine: 8 }] });
    const lines = text.split('\n');
    expect(lines[1]).toBe('Personal information section of the contract: extracted items (the original lines are not sent).');
    expect(lines[lines.length - 1]).toBe('Personal information section of the contract (for example signatures): contents hidden.');
    expect(text).not.toContain('(서명 또는 인)');
  });

  it('범위를 못 찾았거나(null) 줄 수가 안 맞으면 바꾸지 않고 가린 원문 그대로', () => {
    expect(run({ personalInfoRange: null })).toMatchObject({ text: MASKED, replaced: false });
    expect(run({ personalInfoRange: { startLine: 3, endLine: 99 } })).toMatchObject({ text: MASKED, replaced: false });
    expect(run({ personalInfoRange: { startLine: 5, endLine: 2 } })).toMatchObject({ text: MASKED, replaced: false });
  });

  it('document를 주었는데 가린 글의 줄 수가 서류 줄 수와 다르면(쪽 표시가 먼저 들어간 글 등) 바꾸지 않는다 (#357 리뷰)', () => {
    const lines = MASKED.split('\n');
    const document = { documentId: 'DOC_LEASE', pages: [{ blocks: lines.map((t, i) => ({ blockId: `b${i}`, text: t })) }] };
    // 줄 수가 같으면 바꾼다
    expect(run({}, FRAUD_CHECK, { document }).replaced).toBe(true);
    // 쪽 표시 한 줄이 맨 앞에 들어가 줄 순서가 밀린 글
    const paged = ['--- page 1 ---', ...lines].join('\n');
    const r = buildContractPartySummary({ maskedText: paged, contractFields: contract(), personGroups: GROUPS, purpose: FRAUD_CHECK, document });
    expect(r.ok && r.data).toMatchObject({ text: paged, replaced: false });
  });

  it('lineBlocks를 주면 바꾼 글의 줄 순서에 맞춰 돌려준다 (요약 줄은 null, 멈춘 줄 위치를 맞추려고)', () => {
    const blocks = MASKED.split('\n').map((_, i) => `b${i}`);
    const { text, lineBlocks } = run({}, FRAUD_CHECK, { lineBlocks: blocks });
    const lines = text.split('\n');
    expect(lineBlocks).toHaveLength(lines.length);
    expect(lineBlocks?.[0]).toBe('b0');
    expect(lineBlocks?.[1]).toBeNull();
    expect(lineBlocks?.[lines.indexOf('제1조 임대보증금 금 50,000,000원')]).toBe('b9');
  });

  it('계약서 데이터나 가린 글이 없으면 실패한다', () => {
    expect(buildContractPartySummary({ maskedText: MASKED, contractFields: null, personGroups: GROUPS, purpose: FRAUD_CHECK }).ok).toBe(false);
    expect(buildContractPartySummary({ maskedText: /** @type {any} */ (null), contractFields: contract(), personGroups: GROUPS, purpose: FRAUD_CHECK }).ok).toBe(false);
  });
});

describe('PART 4 인적사항 칸 범위 정리 (normalizeRanges)', () => {
  it('겹치거나 이어지는 칸은 합치고, 줄 순서대로', () => {
    const r = normalizeRanges({ personalInfoRanges: [{ startLine: 10, endLine: 12 }, { startLine: 2, endLine: 5 }, { startLine: 5, endLine: 7 }, { startLine: 13, endLine: 13 }] }, 20);
    expect(r).toEqual([{ startLine: 2, endLine: 7 }, { startLine: 10, endLine: 13 }]);
  });

  it('배열이 있으면 배열, 없으면 한 칸, 둘 다 없으면 빈 목록', () => {
    expect(normalizeRanges({ personalInfoRanges: [], personalInfoRange: { startLine: 1, endLine: 2 } }, 5)).toEqual([]);
    expect(normalizeRanges({ personalInfoRange: { startLine: 1, endLine: 2 } }, 5)).toEqual([{ startLine: 1, endLine: 2 }]);
    expect(normalizeRanges({}, 5)).toEqual([]);
    expect(normalizeRanges(null, 5)).toEqual([]);
  });
});

describe('PART 4 인적사항 칸 요약: 평가 세트 계약서로 확인', () => {
  const ROOT = new URL('../', import.meta.url);
  const readJson = (/** @type {string} */ p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

  it('가린 글의 줄 순서가 PART 2 줄 번호(linesOf)와 같아서, 칸 줄을 바꿔도 보내기 전 검사를 통과한다', async () => {
    const pair = readJson('tests/eval/set.json').pairs.find((/** @type {any} */ p) => p.id === 'set4');
    const files = pair.documents.map((/** @type {string} */ n) => {
      const t = readJson(`tests/eval/truth/${n}.json`);
      return new File([readFileSync(new URL(t.file, ROOT))], `${n}.pdf`, { type: 'application/pdf' });
    });
    const a = (await analyzeDocuments({ files })).data;
    const lease = a.documents.find((/** @type {any} */ d) => d.documentId === a.fields.contract.documentId);
    const linesOf = lease.pages.flatMap((/** @type {any} */ p) => p.blocks.flatMap((/** @type {any} */ b) => b.text.split('\n')));
    // 실제 서식의 맨 위 "1. 계약 당사자" 칸 (임대사업자·임차인, 다음 "2." 제목 앞까지)
    const top = { startLine: linesOf.findIndex((/** @type {string} */ l) => l.startsWith('1. 계약 당사자')), endLine: 0 };
    top.endLine = linesOf.findIndex((/** @type {string} */ l, /** @type {number} */ i) => i > top.startLine && /^2\./.test(l)) - 1;
    expect(top.startLine).toBeGreaterThan(0);
    expect(top.endLine).toBeGreaterThan(top.startLine);

    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const plan = createMaskingPlan(a.findings, a.personGroups, purpose).data;
      const masked = applyMaskingPlan(a.documents, plan, a.findings, a.personGroups).data;
      const text = masked.maskedText[lease.documentId];
      expect(text.split('\n')).toHaveLength(linesOf.length);
      const r = buildContractPartySummary({
        maskedText: text,
        contractFields: { ...a.fields.contract, personalInfoRanges: [top] },
        personGroups: a.personGroups,
        purpose,
        legend: masked.legend,
        lineBlocks: masked.lineBlocks[lease.documentId],
        registryFields: a.fields.registry,
        document: lease,
      });
      expect(r.ok && r.data.replaced, purpose).toBe(true);
      if (!r.ok) continue;
      // 범위 안의 원래 줄이 결과에 하나도 남지 않는다 (줄 단위 비교, #357 리뷰)
      // 같은 글자의 줄이 범위 밖에도 있으면(예: "주소", "임대사업자" 같은 칸 이름) 그 줄은 범위 밖에서 나온 것이라 뺀다
      const maskedLines = text.split('\n');
      const outside = new Set(maskedLines.filter((_, i) => i < top.startLine || i > top.endLine));
      const outLines = new Set(r.data.text.split('\n'));
      const inside = maskedLines.slice(top.startLine, top.endLine + 1).filter((l) => l.trim() !== '' && !outside.has(l));
      expect(inside.length, purpose).toBeGreaterThan(3);
      for (const line of inside) expect(outLines.has(line), `${purpose}: ${line}`).toBe(false);
      const check = validateMaskedText({ ...masked.maskedText, [lease.documentId]: r.data.text }, a.findings, plan, undefined, {
        lineBlocks: { ...masked.lineBlocks, [lease.documentId]: /** @type {string[]} */ (r.data.lineBlocks) },
      });
      expect(check.ok, purpose).toBe(true);
      // 조항·계약 설명은 이름을 REDACT해서 본문에도 가명이 없다. 그래서 요약에 역할만 적어도 가명과 역할의 연결을 잃지 않는다.
      // masking-policy.json이 바뀌면 이 테스트가 알려 준다 (#357 2차 리뷰)
      if (purpose !== MASKING_PURPOSE.FRAUD_CHECK) {
        expect(r.data.text, purpose).not.toMatch(/\[(?:Owner|Landlord|Tenant|AccountHolder|PrevOwner|Person)_[A-Z]\??\]/);
      }
    }
  }, 120000);
});
