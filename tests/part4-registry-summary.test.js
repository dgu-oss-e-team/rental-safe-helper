// PART 4. 등기부 요약 (원문 대신 뽑은 항목만 AI로) + 목적별로 보낼 방식. 예시는 모두 가짜 값이다.
// 필드 이름은 docs/INTERFACES.md 5번 (PART 2 #347: holder, holderIsCompany, cause, unknownActiveCount)
import { describe, it, expect } from 'vitest';
import { buildRegistrySummary, getSendMode, SEND_MODE, validateMaskedText } from '../src/features/masking/index.js';
import { cleanCause } from '../src/features/masking/registry-summary.js';
import { DOCUMENT_TYPE, MASKING_PURPOSE } from '../src/shared/document-model.js';

const GROUPS = [
  { personId: 'P1', alias: '[Owner_A]', roles: ['OWNER', 'LANDLORD'], findingIds: ['PII_R01', 'PII_L01'], status: 'CONFIRMED' },
  { personId: 'P2', alias: '[PrevOwner_B]', roles: ['PREVIOUS_OWNER'], findingIds: ['PII_R02'], status: 'CONFIRMED' },
];
const LEGEND = { '[Owner_A]': 'owner on the register, landlord on the contract', '[PrevOwner_B]': 'previous owner on the register' };

/** @param {object} [over] */
const registry = (over = {}) => ({
  documentId: 'DOC_REGISTRY',
  address: '서울특별시 중구 가상로 30, 2층 204호(가상동)',
  roadAddress: null,
  owners: [{ findingId: 'PII_R01', name: '홍길동', birthDate: '690812', role: 'OWNER' }],
  previousOwners: [{ findingId: 'PII_R02', name: '김선달', birthDate: '760423', role: 'PREVIOUS_OWNER' }],
  rights: [
    { kind: 'MORTGAGE', maxClaimAmount: 168000000, cancelled: false, receivedAt: '2026-08-25', holder: '주식회사가상은행', holderIsCompany: true, cause: '설정계약' },
    { kind: 'PROVISIONAL_SEIZURE', maxClaimAmount: null, cancelled: true, receivedAt: '2023-02-06', holder: '주식회사가상캐피탈', holderIsCompany: true, cause: '가압류결정(2023카단1234)' },
  ],
  unknownActiveCount: 0,
  lastTransferDate: '2024-05-10',
  ownerCompanies: [],
  ...over,
});

/** @param {object} [over] */
const summarize = (over) => {
  const r = buildRegistrySummary(registry(over), GROUPS, LEGEND);
  expect(r.ok).toBe(true);
  return /** @type {{ documentId: string, text: string, hiddenCount: number }} */ (r.data);
};

describe('PART 4 목적별로 보낼 방식 (getSendMode)', () => {
  it('표: 사기 점검의 등기부만 요약, 계약 조건 설명은 등기부를 보내지 않는다, 계약서는 인적사항 칸만 요약', () => {
    const { FRAUD_CHECK, CLAUSE_EXPLANATION, CONTRACT_EXPLANATION } = MASKING_PURPOSE;
    const { REGISTRY, LEASE_CONTRACT } = DOCUMENT_TYPE;
    expect(getSendMode(FRAUD_CHECK, REGISTRY)).toBe(SEND_MODE.SUMMARY);
    expect(getSendMode(FRAUD_CHECK, LEASE_CONTRACT)).toBe(SEND_MODE.PARTY_SUMMARY);
    expect(getSendMode(CLAUSE_EXPLANATION, REGISTRY)).toBe(SEND_MODE.MASKED_TEXT);
    expect(getSendMode(CLAUSE_EXPLANATION, LEASE_CONTRACT)).toBe(SEND_MODE.PARTY_SUMMARY);
    expect(getSendMode(CONTRACT_EXPLANATION, REGISTRY)).toBe(SEND_MODE.OMIT);
    expect(getSendMode(CONTRACT_EXPLANATION, LEASE_CONTRACT)).toBe(SEND_MODE.PARTY_SUMMARY);
  });

  it('설정에 없는 목적·서류 종류는 지금처럼 가린 원문', () => {
    expect(getSendMode(MASKING_PURPOSE.FRAUD_CHECK, DOCUMENT_TYPE.UNKNOWN)).toBe(SEND_MODE.MASKED_TEXT);
    expect(getSendMode('NO_SUCH_PURPOSE', DOCUMENT_TYPE.REGISTRY)).toBe(SEND_MODE.MASKED_TEXT);
  });
});

describe('PART 4 등기부 요약 (buildRegistrySummary)', () => {
  it('원래 이름·생년월일·상세 주소·사건번호는 없고, 가명·시·구 주소·권리 항목만 있다', () => {
    const { documentId, text, hiddenCount } = summarize();
    expect(documentId).toBe('DOC_REGISTRY');
    expect(hiddenCount).toBe(0);
    for (const secret of ['홍길동', '김선달', '690812', '760423', '가상로 30', '204호', '2023카단1234']) expect(text).not.toContain(secret);
    expect(text).toContain('Address: 서울특별시 중구');
    expect(text).toContain('Current owner: [Owner_A]');
    expect(text).toContain('Previous owners: [PrevOwner_B]');
    expect(text).toContain('Last ownership transfer: 2024-05-10');
    expect(text).toContain('- Mortgage (근저당권): received 2026-08-25, cause 설정계약, max claim 168,000,000 KRW, holder 주식회사가상은행, active');
    expect(text).toContain('- Provisional seizure (가압류): received 2023-02-06, cause 가압류결정, holder 주식회사가상캐피탈, cancelled (말소)');
  });

  it('새 권리 종류(가처분·가등기·경매개시결정)도 이름을 붙여 넣는다', () => {
    const { text } = summarize({
      rights: [
        { kind: 'PROVISIONAL_DISPOSITION', cancelled: false, receivedAt: '2025-01-02', holder: '주식회사가상건설', holderIsCompany: true, cause: '가처분결정(2025카합55)' },
        { kind: 'PROVISIONAL_REGISTRATION', cancelled: false, receivedAt: '2025-02-03', holder: '주식회사가상개발', holderIsCompany: true, cause: '매매예약' },
        { kind: 'AUCTION', cancelled: false, receivedAt: '2025-03-04', holder: '주식회사가상은행', holderIsCompany: true, cause: '임의경매개시결정(2025타경555)' },
      ],
    });
    expect(text).toContain('- Provisional disposition (가처분): received 2025-01-02, cause 가처분결정');
    expect(text).toContain('- Provisional registration (가등기): received 2025-02-03, cause 매매예약');
    expect(text).toContain('- Auction started (경매개시결정): received 2025-03-04, cause 경매개시결정');
    expect(text).not.toMatch(/카합|타경/);
  });

  it('개인 권리자는 가명. 소유자와 같은 이름이면 소유자 가명, 아니면 [Holder_1]부터 (같은 이름은 같은 가명)', () => {
    const { text } = summarize({
      rights: [
        { kind: 'MORTGAGE', maxClaimAmount: 50000000, cancelled: false, receivedAt: '2025-05-02', holder: '이가상', holderIsCompany: false, cause: '설정계약' },
        { kind: 'PROVISIONAL_SEIZURE', cancelled: false, receivedAt: '2025-06-01', holder: '홍 길동', holderIsCompany: false, cause: '가압류결정' },
        { kind: 'SEIZURE', cancelled: false, receivedAt: '2025-07-01', holder: '이가상', holderIsCompany: false, cause: '압류' },
      ],
    });
    expect(text).not.toContain('이가상');
    expect(text).toContain('holder [Holder_1] (an individual), active');
    expect(text).toContain('cause 가압류결정, holder [Owner_A] (an individual)');
    expect(text.match(/\[Holder_1\]/g)).toHaveLength(2);
    expect(text).not.toContain('[Holder_2]');
  });

  it('회사인지 애매한 권리자(holderIsCompany: null)는 가명', () => {
    const { text } = summarize({
      rights: [{ kind: 'MORTGAGE', maxClaimAmount: 30000000, cancelled: false, receivedAt: '2025-05-02', holder: '가상상사', holderIsCompany: null, cause: '설정계약' }],
    });
    expect(text).not.toContain('가상상사');
    expect(text).toContain('holder [Holder_1] (an individual)');
  });

  it('못 읽은 값은 말없이 빼지 않고 "Could not read"로 적는다', () => {
    const { text } = summarize({
      address: null,
      owners: null,
      previousOwners: null,
      rights: [{ kind: 'MORTGAGE', maxClaimAmount: null, cancelled: null, receivedAt: null, holder: null, holderIsCompany: null, cause: null }],
    });
    expect(text).toContain('Address: Could not read');
    expect(text).toContain('Current owner: Could not read');
    expect(text).toContain('Previous owners: Could not read');
    expect(text).toContain('- Mortgage (근저당권): received Could not read, max claim Could not read, holder Could not read, cancellation unclear, check the original');
  });

  it('권리 목록을 못 읽은 것(null)과 권리가 없는 것([])을 구분한다', () => {
    expect(summarize({ rights: null }).text).toContain('Rights and restrictions: Could not read');
    expect(summarize({ rights: [] }).text).toContain('Rights and restrictions: none recorded');
  });

  it('알아보지 못한 유효한 등기 줄은 개수와 "원본 확인"을 적는다. 갑구·을구를 못 찾으면(null) 그렇다고 적는다', () => {
    expect(summarize({ unknownActiveCount: 2 }).text).toContain('Unconfirmed register records: 2 (could not read what they are, check the original register)');
    expect(summarize({ unknownActiveCount: null }).text).toContain('Other register records: could not check, check the original register');
    expect(summarize({ unknownActiveCount: 0 }).text).not.toMatch(/Unconfirmed|Other register records/);
  });

  it('지금 소유자가 회사면 회사 이름은 넣지 않고 회사라는 것만 적는다 (ownerCompanies는 화면 전용)', () => {
    const { text } = summarize({ owners: [], ownerCompanies: ['가상부동산신탁주식회사'] });
    expect(text).toContain('Current owner: a company (name not sent)');
    expect(text).not.toMatch(/Current owner:.*가상부동산신탁/);
  });

  it('요약에 같은 이름이 확인 안 된 가명만 범례에 있으면 그 가명을 쓴다 (가린 원문과 같은 글자)', () => {
    const r = buildRegistrySummary(registry(), GROUPS, { '[Owner_A]': 'owner', '[PrevOwner_B?]': 'same name as [PrevOwner_B]' });
    expect(r.ok && r.data.text).toContain('Previous owners: [PrevOwner_B?]');
  });

  it('검사에 걸리면 그 값만 [hidden]으로 바꾸고, 원래 값은 남기지 않는다', () => {
    // 회사 이름 칸에 주소·전화번호가 붙어 읽힌 경우
    const { text, hiddenCount } = summarize({
      rights: [
        { kind: 'MORTGAGE', maxClaimAmount: 50000000, cancelled: false, receivedAt: '2025-05-02', holder: '주식회사가상은행 010-1234-5678', holderIsCompany: true, cause: '설정계약' },
      ],
    });
    expect(hiddenCount).toBe(1);
    expect(text).not.toContain('010-1234-5678');
    expect(text).toContain('- Mortgage (근저당권): received 2025-05-02, cause 설정계약, max claim 50,000,000 KRW, holder [hidden], active');
    expect(text).toContain('1 item hidden (check the original register)');
  });

  it('회사 이름 안에 개인 이름이 들어 있어도 그 값을 가린다', () => {
    const { text, hiddenCount } = summarize({
      rights: [{ kind: 'MORTGAGE', maxClaimAmount: 1, cancelled: false, receivedAt: '2025-05-02', holder: '홍길동부동산주식회사', holderIsCompany: true, cause: '설정계약' }],
    });
    expect(hiddenCount).toBe(1);
    expect(text).not.toContain('홍길동');
  });

  it('값을 가려도 걸리면 그 줄을 통째로 뺀다 (원문으로 돌아가지 않음)', () => {
    // 접수일 칸에 휴대폰 번호가 읽힌 경우: 바꿀 수 있는 값(권리자)을 가려도 남는다
    const { text, hiddenCount } = summarize({
      rights: [
        { kind: 'MORTGAGE', maxClaimAmount: 50000000, cancelled: false, receivedAt: '010-9876-5432', holder: '주식회사가상은행', holderIsCompany: true, cause: '설정계약' },
        { kind: 'TRUST', cancelled: false, receivedAt: '2024-09-23', holder: '가상부동산신탁주식회사', holderIsCompany: true, cause: '신탁' },
      ],
    });
    expect(hiddenCount).toBe(1);
    expect(text).not.toContain('010-9876-5432');
    expect(text).not.toContain('Mortgage');
    expect(text).toContain('- Trust (신탁): received 2024-09-23, cause 신탁, holder 가상부동산신탁주식회사, active');
    expect(text).toContain('1 item hidden (check the original register)');
  });

  it('등기부 데이터가 없으면 실패한다', () => {
    expect(buildRegistrySummary(null, GROUPS, LEGEND).ok).toBe(false);
    expect(buildRegistrySummary(registry({ documentId: null }), GROUPS, LEGEND).ok).toBe(false);
  });
});

describe('PART 4 등기부 요약과 보내기 전 검사', () => {
  it('요약 글은 validateMaskedText(사진 서류 안전망 포함)를 그대로 통과한다', () => {
    const { documentId, text } = summarize({
      rights: [
        ...registry().rights,
        { kind: 'MORTGAGE', maxClaimAmount: 50000000, cancelled: false, receivedAt: '2025-05-02', holder: '이가상', holderIsCompany: false, cause: '근저당권설정계약' },
      ],
      unknownActiveCount: 1,
    });
    const findings = [
      { id: 'PII_R01', documentId, type: 'PERSON_NAME', value: '홍길동', blockId: 'b1' },
      { id: 'PII_R02', documentId, type: 'PERSON_NAME', value: '김선달', blockId: 'b2' },
    ];
    const plan = {
      purpose: MASKING_PURPOSE.FRAUD_CHECK,
      items: [
        { findingId: 'PII_R01', action: 'REPLACE', replacement: '[Owner_A]', documentId },
        { findingId: 'PII_R02', action: 'REPLACE', replacement: '[PrevOwner_B]', documentId },
      ],
    };
    const r = validateMaskedText({ [documentId]: text }, /** @type {any} */ (findings), /** @type {any} */ (plan), undefined, {
      photoDocumentIds: [documentId],
    });
    expect(r.ok).toBe(true);
  });
});

describe('PART 4 등기원인 낱말 (cleanCause)', () => {
  it('목록에 있는 낱말만 남기고 괄호(사건번호)·띄어쓰기를 뺀다', () => {
    expect(cleanCause('근저당권설정계약')).toBe('설정계약');
    expect(cleanCause('가압류결정(2024카단1234)')).toBe('가압류결정');
    expect(cleanCause('임의경매개시결정 (2024타경555)')).toBe('경매개시결정');
    expect(cleanCause('압류(세무1과-1234)')).toBe('압류');
    expect(cleanCause('매매')).toBe('매매');
  });

  it('목록에 없거나 비어 있으면 넣지 않는다', () => {
    expect(cleanCause('가상세무서 처분')).toBeNull();
    expect(cleanCause('')).toBeNull();
    expect(cleanCause(null)).toBeNull();
  });
});
