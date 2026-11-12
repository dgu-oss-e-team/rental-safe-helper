import { describe, it, expect } from 'vitest';
import { detectPII, extractFields } from '../src/features/document-analysis/index.js';
import { REVIEW_STATUS } from '../src/shared/document-model.js';
import { mockRegistryDocument, mockLeaseDocument } from '../src/shared/mock-data.js';

// 모든 이름과 번호는 가짜다.

/**
 * 테스트용 계약서: 한 줄이 블록 하나
 * @param {string[]} lines
 */
function leaseDoc(lines) {
  return {
    documentId: 'DOC_T',
    pages: [
      {
        pageIndex: 0,
        blocks: lines.map((text, i) => ({
          blockId: `T_${i}`,
          text,
          bbox: { x: 0, y: i / 10, width: 1, height: 0.02 },
          confidence: null,
        })),
      },
    ],
  };
}

describe('PART 2 extractFields 사람 정보·주소', () => {
  const docs = [mockRegistryDocument, mockLeaseDocument];
  const fields = extractFields(docs, []).data;

  it('PART 4에 약속한 사람 정보를 그대로 만든다', () => {
    expect(fields.registry.owners).toEqual([
      { findingId: 'PII_DOC_REGISTRY_003', name: '김철수', birthDate: '800101', role: 'OWNER' },
    ]);
    expect(fields.contract.landlords).toEqual([
      { findingId: 'PII_DOC_LEASE_002', name: '김철수', birthDate: '750315', role: 'LANDLORD' },
    ]);
    expect(fields.contract.tenants).toEqual([
      { findingId: 'PII_DOC_LEASE_004', name: 'NGUYEN VAN A', birthDate: '990505', role: 'TENANT' },
    ]);
    expect(fields.contract.accountHolders).toEqual([
      { findingId: 'PII_DOC_LEASE_008', name: '김철수', birthDate: null, role: 'ACCOUNT_HOLDER' },
    ]);
  });

  it('사람 정보의 findingId가 detectPII() 결과의 id와 맞는다', () => {
    const ids = docs.flatMap((d) => detectPII(d).data.map((f) => f.id));
    const people = [
      ...fields.registry.owners,
      ...fields.contract.landlords,
      ...fields.contract.tenants,
      ...fields.contract.accountHolders,
    ];
    for (const p of people) expect(ids).toContain(p.findingId);
  });

  it('주소를 실제 문서에서 가져온다', () => {
    expect(fields.registry.address).toBe('서울특별시 중구 필동로 00, 101호');
    expect(fields.contract.address).toBe('서울특별시 중구 필동로 00, 101호');
  });

  it('임대인 본인 주소가 먼저 나와도 소재지 주소를 고른다', () => {
    const r = extractFields(
      [leaseDoc(['주택임대차계약서 보증금 특약', '임대인 주소 경기도 수원시 팔달구 효원로 00', '소재지 서울특별시 중구 필동로 00, 101호'])],
      [],
    );
    expect(r.data.contract.address).toBe('서울특별시 중구 필동로 00, 101호');
  });

  it('같은 역할·같은 이름이 다시 나오면 생년월일을 채워 준다 (서명란)', () => {
    const r = extractFields([leaseDoc(['주택임대차계약서 보증금 특약', '임대인 김철수 750315-1******', '임대인 김철수 (인)'])], []);
    expect(r.data.contract.landlords.map((p) => p.birthDate)).toEqual(['750315', '750315']);
  });

  it('역할이 다르면 이름이 같아도 생년월일을 채우지 않는다 (추측 금지)', () => {
    const r = extractFields([leaseDoc(['주택임대차계약서 보증금 특약', '임대인 김철수 750315-1******', '예금주 김철수'])], []);
    expect(r.data.contract.accountHolders[0].birthDate).toBeNull();
  });

  it('같은 이름인데 생년월일이 서로 다르면 채우지 않는다', () => {
    const r = extractFields(
      [leaseDoc(['주택임대차계약서 보증금 특약', '임대인 김철수 750315-1******', '임대인 김철수 800101-1******', '임대인 김철수 (인)'])],
      [],
    );
    expect(r.data.contract.landlords[2].birthDate).toBeNull();
  });

  it('서명란이 블록으로 나뉘어도 "성명" 칸이 위 블록의 역할을 이어받는다', () => {
    const r = extractFields(
      [
        leaseDoc([
          '주택임대차계약서 보증금 특약',
          '임 대 인',
          '주소 서울특별시 중구 필동로 00',
          '주민등록번호 750315-1****** 전화 010-0000-0000 성명 김철수',
          '임 차 인',
          '외국인등록번호 990505-5****** 성명 NGUYEN VAN A',
        ]),
      ],
      [],
    );
    expect(r.data.contract.landlords.map((p) => p.name)).toEqual(['김철수']);
    expect(r.data.contract.tenants.map((p) => p.name)).toEqual(['NGUYEN VAN A']);
  });

  it('역할을 모르는 "성명" 칸 이름은 사람 목록에는 없지만 detectPII에서는 찾는다 (가리기 우선)', () => {
    const doc = leaseDoc(['주택임대차계약서 보증금 특약', '성명 김철수 서명또는날인']);
    const r = extractFields([doc], []);
    expect(r.data.contract.landlords).toEqual([]);
    expect(detectPII(doc).data.some((f) => f.type === 'PERSON_NAME' && f.value === '김철수')).toBe(true);
  });

  it('사용자가 해제(REJECTED)한 이름은 사람 목록에서 뺀다', () => {
    const findings = detectPII(mockLeaseDocument).data.map((f) =>
      f.id === 'PII_DOC_LEASE_002' ? { ...f, reviewStatus: REVIEW_STATUS.REJECTED } : f,
    );
    const r = extractFields([mockLeaseDocument], findings);
    expect(r.data.contract.landlords).toEqual([]);
    expect(r.data.contract.tenants).toHaveLength(1);
  });

  it('문서가 없으면 그 문서 항목은 null(못 읽음), 사람이 없으면 [](없음)', () => {
    const r = extractFields([leaseDoc(['주택임대차계약서 보증금 특약 임대차'])], []);
    expect(r.data.registry.owners).toBeNull();
    expect(r.data.contract.landlords).toEqual([]);
  });

  it('문서 목록이 없으면 오류', () => {
    expect(extractFields(undefined, []).ok).toBe(false);
  });
});

describe('PART 2 extractFields 보증금·월세·특약·등기부 권리', () => {
  const HEAD = '주택임대차계약서 보증금 특약';
  const REGISTRY_HEAD = '등기사항전부증명서 고유번호 0000-0000-000000';
  const GAP = '【 갑 구 】 (소유권에 관한 사항)';
  const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';

  it('Mock 문서에서 보증금·월세·특약·권리를 실제로 읽는다', () => {
    const r = extractFields([mockRegistryDocument, mockLeaseDocument], []);
    expect(r.data.registry.rights).toEqual([
      { kind: 'MORTGAGE', maxClaimAmount: 120000000, cancelled: false, receivedAt: null },
    ]);
    expect(r.data.contract.deposit).toBe(50000000);
    expect(r.data.contract.monthlyRent).toBe(500000);
    expect(r.data.contract.specialTerms).toEqual(['월세는 현금으로 지급한다.']);
  });

  it('계약서에 적힌 값을 그대로 읽는다 (Mock 값이 아니다)', () => {
    const r = extractFields(
      [leaseDoc([HEAD, '보증금 금70,000,000원 월세 금300,000원', '특약사항: 반려동물을 키울 수 없다.'])],
      [],
    );
    expect(r.data.contract.deposit).toBe(70000000);
    expect(r.data.contract.monthlyRent).toBe(300000);
    expect(r.data.contract.specialTerms).toEqual(['반려동물을 키울 수 없다.']);
  });

  it('한 블록 안에서 줄이 나뉘어 있어도 줄마다 읽는다', () => {
    const r = extractFields(
      [leaseDoc([HEAD, '특약사항\n월세는 현금으로 지급한다.\n본 계약을 증명하기 위하여 서명한다.'])],
      [],
    );
    expect(r.data.contract.specialTerms).toEqual(['월세는 현금으로 지급한다.']);
  });

  it('계약서에 금액·특약이 없으면 null (못 읽음)', () => {
    const r = extractFields([leaseDoc([HEAD])], []);
    expect(r.data.contract.deposit).toBeNull();
    expect(r.data.contract.monthlyRent).toBeNull();
    expect(r.data.contract.specialTerms).toBeNull();
  });

  it('계약서가 없으면 보증금·월세·특약은 null', () => {
    const r = extractFields([mockRegistryDocument], []);
    expect(r.data.contract.deposit).toBeNull();
    expect(r.data.contract.monthlyRent).toBeNull();
    expect(r.data.contract.specialTerms).toBeNull();
  });

  it('등기부가 없으면 권리는 null (압류 없음으로 보이지 않게)', () => {
    const r = extractFields([mockLeaseDocument], []);
    expect(r.data.registry.rights).toBeNull();
  });

  it('갑구 제목만 읽히면 권리는 null이다', () => {
    const r = extractFields([leaseDoc([REGISTRY_HEAD, GAP, '1 압류'])], []);
    expect(r.data.registry.rights).toBeNull();
  });

  it('갑구·을구를 둘 다 읽고 권리가 없으면 [] (없음)', () => {
    const r = extractFields([leaseDoc([REGISTRY_HEAD, GAP, EUL])], []);
    expect(r.data.registry.rights).toEqual([]);
  });

  it('별도 줄의 말소는 해당 권리를 cancelled: true로 바꾼다', () => {
    const r = extractFields(
      [leaseDoc([REGISTRY_HEAD, GAP, '2 가압류', '3 2번가압류등기말소', EUL, '1 근저당권설정 채권최고액 금100,000,000원'])],
      [],
    );
    expect(r.data.registry.rights).toEqual([
      { kind: 'PROVISIONAL_SEIZURE', maxClaimAmount: null, cancelled: true, receivedAt: null },
      { kind: 'MORTGAGE', maxClaimAmount: 100000000, cancelled: false, receivedAt: null },
    ]);
  });

  it('어느 권리가 말소됐는지 모르면 그 구의 권리는 cancelled: null (확인 필요)', () => {
    const r = extractFields([leaseDoc([REGISTRY_HEAD, GAP, '2 압류', '가압류등기말소', EUL])], []);
    expect(r.data.registry.rights.map((x) => [x.kind, x.cancelled])).toEqual([['SEIZURE', null]]);
  });
});

describe('PART 2 extractFields 등기부 소유자는 지금 소유자만', () => {
  const REGISTRY_HEAD = '등기사항전부증명서 고유번호 0000-0000-000000';
  const GAP = '【 갑 구 】 (소유권에 관한 사항)';
  const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';
  const ownerNames = (/** @type {string[]} */ lines) =>
    extractFields([leaseDoc(lines)], []).data.registry.owners?.map((/** @type {any} */ p) => p.name) ?? null;

  it('갑구의 예전 소유자(이미 판 사람)는 빼고 지금 소유자만 넣는다', () => {
    const lines = [
      REGISTRY_HEAD,
      GAP,
      '2 소유권이전 2018년6월1일 제2000호 매매 소유자 박영수 700101-1******',
      '3 소유권이전 2024년5월10일 제5555호 매매 소유자 김철수 800101-1******',
      EUL,
    ];
    expect(ownerNames(lines)).toEqual(['김철수']);
  });

  it('예전 소유자 이름도 탐지 결과에는 남아서 가려진다', () => {
    const lines = [REGISTRY_HEAD, GAP, '2 소유권이전 2018년6월1일 소유자 박영수', '3 소유권이전 2024년5월10일 소유자 김철수', EUL];
    const names = detectPII(leaseDoc(lines)).data.filter((f) => f.type === 'PERSON_NAME').map((f) => f.value);
    expect(names).toEqual(['박영수', '김철수']);
  });

  it('지금 기록의 공유자는 여러 줄에 있어도 모두 넣는다', () => {
    const lines = [
      REGISTRY_HEAD,
      GAP,
      '2 소유권이전 2018년6월1일 소유자 박영수',
      '3 소유권이전 2024년5월10일 제5555호 매매',
      '공유자 지분 2분의 1 김철수 800101-1******',
      '공유자 지분 2분의 1 이영희 790202-2******',
      EUL,
    ];
    expect(ownerNames(lines)).toEqual(['김철수', '이영희']);
  });

  it('지금 소유자를 정할 수 없으면 null (일부 이전, 신탁처럼 소유자 이름이 없는 기록)', () => {
    expect(
      ownerNames([REGISTRY_HEAD, GAP, '2 소유권이전 2018년6월1일 공유자 박영수', '3 박영수지분전부이전 2024년1월1일 공유자 이영희', EUL]),
    ).toBeNull();
    expect(
      ownerNames([REGISTRY_HEAD, GAP, '2 소유권이전 2018년6월1일 소유자 박영수', '3 소유권이전 2024년7월7일 신탁 수탁자 ○○신탁', EUL]),
    ).toBeNull();
  });

  it('순위번호가 없는 등기부(Mock)는 지금처럼 소유자를 전부 넣는다', () => {
    expect(extractFields([mockRegistryDocument], []).data.registry.owners.map((/** @type {any} */ p) => p.name)).toEqual(['김철수']);
  });
});

describe('PART 2 extractFields 예전 소유자 (registry.previousOwners)', () => {
  const REGISTRY_HEAD = '등기사항전부증명서 고유번호 0000-0000-000000';
  const GAP = '【 갑 구 】 (소유권에 관한 사항)';
  const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';
  const registryOf = (/** @type {string[]} */ lines) => extractFields([leaseDoc(lines)], []).data.registry;

  it('갑구의 예전 소유자를 role PREVIOUS_OWNER로 따로 넣는다 (owners에는 지금 소유자만)', () => {
    const r = registryOf([
      REGISTRY_HEAD,
      GAP,
      '1 소유권보존 2015년1월20일 소유자 최민수 650505-1******',
      '2 소유권이전 2018년6월1일 매매 소유자 박영수 700101-1******',
      '3 소유권이전 2024년5월10일 매매 소유자 김철수 800101-1******',
      EUL,
    ]);
    expect(r.owners.map((/** @type {any} */ p) => [p.name, p.role])).toEqual([['김철수', 'OWNER']]);
    expect(r.previousOwners.map((/** @type {any} */ p) => [p.name, p.birthDate, p.role])).toEqual([
      ['최민수', '650505', 'PREVIOUS_OWNER'],
      ['박영수', '700101', 'PREVIOUS_OWNER'],
    ]);
  });

  it('예전 소유자의 findingId는 탐지 결과의 id와 같다 (PART 4가 가명을 붙일 수 있게)', () => {
    const doc = leaseDoc([REGISTRY_HEAD, GAP, '2 소유권이전 2018년6월1일 소유자 박영수', '3 소유권이전 2024년5월10일 소유자 김철수', EUL]);
    const prev = extractFields([doc], []).data.registry.previousOwners;
    const finding = detectPII(doc).data.find((f) => f.value === '박영수');
    expect(prev.map((/** @type {any} */ p) => p.findingId)).toEqual([finding?.id]);
  });

  it('사용자가 해제(REJECTED)한 예전 소유자는 넣지 않는다', () => {
    const doc = leaseDoc([REGISTRY_HEAD, GAP, '2 소유권이전 2018년6월1일 소유자 박영수', '3 소유권이전 2024년5월10일 소유자 김철수', EUL]);
    const findings = detectPII(doc).data.map((f) =>
      f.value === '박영수' ? { ...f, reviewStatus: REVIEW_STATUS.REJECTED } : f,
    );
    expect(extractFields([doc], findings).data.registry.previousOwners).toEqual([]);
  });

  it('소유권 기록이 하나뿐이면 [] (예전 소유자 없음)', () => {
    expect(registryOf([REGISTRY_HEAD, GAP, '1 소유권보존 2015년1월20일 소유자 최민수', EUL]).previousOwners).toEqual([]);
  });

  it('지금 소유자를 정할 수 없으면 owners·previousOwners 둘 다 null', () => {
    const r = registryOf([REGISTRY_HEAD, GAP, '2 소유권이전 2018년6월1일 소유자 박영수', '3 소유권이전 2024년7월7일 신탁 수탁자 ○○신탁', EUL]);
    expect(r.owners).toBeNull();
    expect(r.previousOwners).toBeNull();
  });

  it('순위번호가 없는 등기부(Mock)·등기부가 없으면 previousOwners는 null', () => {
    expect(extractFields([mockRegistryDocument], []).data.registry.previousOwners).toBeNull();
    expect(extractFields([], []).data.registry.previousOwners).toBeNull();
  });
});

describe('PART 2 extractFields 최근 소유권이전 접수일·계약일', () => {
  const HEAD = '주택임대차계약서 보증금 특약';
  const REGISTRY_HEAD = '등기사항전부증명서 고유번호 0000-0000-000000';
  const GAP = '【 갑 구 】 (소유권에 관한 사항)';
  const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';

  it('등기부의 마지막 소유권이전 접수일과 계약서의 계약일을 YYYY-MM-DD로 읽는다', () => {
    const registry = leaseDoc([REGISTRY_HEAD, GAP, '2 소유권이전 2024년5월10일 제5555호 2024년4월1일 매매', EUL]);
    const lease = leaseDoc([HEAD, '계약일 2025년 3월 5일', '잔금 2025년 4월 1일']);
    const r = extractFields([registry, lease], []);
    expect(r.data.registry.lastTransferDate).toBe('2024-05-10');
    expect(r.data.contract.contractDate).toBe('2025-03-05');
  });

  it('Mock 문서에는 날짜가 없어서 둘 다 null (못 읽음)', () => {
    const r = extractFields([mockRegistryDocument, mockLeaseDocument], []);
    expect(r.data.registry.lastTransferDate).toBeNull();
    expect(r.data.contract.contractDate).toBeNull();
  });

  it('문서가 없으면 둘 다 null', () => {
    const r = extractFields([], []);
    expect(r.data.registry.lastTransferDate).toBeNull();
    expect(r.data.contract.contractDate).toBeNull();
  });
});

describe('PART 2 두 줄 주소 (groupId)', () => {
  const HEAD = '주택임대차계약서 보증금 특약';
  /** @param {string[]} lines */
  const addressesOf = (lines) =>
    detectPII(leaseDoc(lines)).data.filter((f) => f.type === 'ADDRESS');

  it('한 줄 주소에는 groupId가 없다', () => {
    const a = detectPII(mockLeaseDocument).data.filter((f) => f.type === 'ADDRESS');
    expect(a).toHaveLength(1);
    expect(a[0].groupId).toBeUndefined();
  });

  it('다음 블록의 동·호수도 찾고, 같은 groupId를 붙인다 (블록마다 결과 하나)', () => {
    const a = addressesOf([HEAD, '소재지 서울특별시 중구 필동로 00,', '101동 1001호']);
    expect(a.map((f) => [f.value, f.blockId])).toEqual([
      ['서울특별시 중구 필동로 00,', 'T_1'],
      ['101동 1001호', 'T_2'],
    ]);
    expect(a[0].groupId).toBeDefined();
    expect(a[1].groupId).toBe(a[0].groupId);
  });

  it('같은 블록 안에서 줄이 바뀐 동·호수도 찾는다', () => {
    const a = addressesOf([HEAD, '소재지 서울특별시 중구 필동로 00,\n제2층 제201호']);
    expect(a.map((f) => f.value)).toEqual(['서울특별시 중구 필동로 00,', '제2층 제201호']);
    expect(a[1].groupId).toBe(a[0].groupId);
  });

  it('시·도 이름만 있는 줄 → 시·군·구 → 동·호수로 이어지는 주소를 모두 찾는다', () => {
    const a = addressesOf([HEAD, '소재지 서울특별시', '중구 필동로 00', '101동 1001호']);
    expect(a.map((f) => f.value)).toEqual(['서울특별시', '중구 필동로 00', '101동 1001호']);
    expect(new Set(a.map((f) => f.groupId)).size).toBe(1);
  });

  it('도로명이 다음 줄로 넘어가도 찾는다', () => {
    const a = addressesOf([HEAD, '소재지 서울특별시 중구', '필동로 00, 101호']);
    expect(a.map((f) => f.value)).toEqual(['서울특별시 중구', '필동로 00, 101호']);
  });

  it('주소 뒤에 괄호(동 이름)가 있어도 다음 줄과 잇는다', () => {
    const a = addressesOf([HEAD, '소재지 서울특별시 중구 필동로 00 (필동)', '101동 1001호']);
    expect(a.map((f) => f.value)).toEqual(['서울특별시 중구 필동로 00', '101동 1001호']);
  });

  it('주소가 아닌 다음 줄과는 잇지 않는다', () => {
    const a = addressesOf([HEAD, '소재지 서울특별시 중구 필동로 00', '임대인 김철수']);
    expect(a).toHaveLength(1);
    expect(a[0].groupId).toBeUndefined();
  });

  it('주소가 줄 끝까지 오지 않으면 다음 줄과 잇지 않는다', () => {
    const a = addressesOf([HEAD, '서울특별시 중구 필동로 00 소재 주택을 임대한다', '101호']);
    expect(a).toHaveLength(1);
  });

  it('시·도 이름으로 끝난 줄 다음이 시·군·구가 아니면 시·도 이름을 잡지 않는다', () => {
    expect(addressesOf([HEAD, '주소지 서울', '특약사항'])).toHaveLength(0);
  });

  it('ID는 문서 순서대로 붙는다 (나중에 확정된 시·도 조각도 제자리)', () => {
    const findings = detectPII(leaseDoc([HEAD, '소재지 서울특별시', '중구 필동로 00', '임대인 김철수'])).data;
    expect(findings.map((f) => `${f.id}:${f.value}`)).toEqual([
      'PII_DOC_T_001:서울특별시',
      'PII_DOC_T_002:중구 필동로 00',
      'PII_DOC_T_003:김철수',
    ]);
  });

  it('extractFields의 집 주소는 조각을 이어 붙인 전체 주소다 (PART 3 비교용)', () => {
    const r = extractFields([leaseDoc([HEAD, '소재지 서울특별시 중구 필동로 00,', '101동 1001호'])], []);
    expect(r.data.contract.address).toBe('서울특별시 중구 필동로 00, 101동 1001호');
  });
});

describe('PART 2 extractFields 주소 정식 이름', () => {
  const HEAD = '주택임대차계약서 보증금 특약';

  it('fields의 주소는 시·도 정식 이름으로 바꾸고, findings의 주소 값은 원문 그대로다', () => {
    const doc = leaseDoc([HEAD, '소재지 서울 중구 필동로 00, 101호']);
    const r = extractFields([doc], []);
    expect(r.data.contract.address).toBe('서울특별시 중구 필동로 00, 101호');
    const found = detectPII(doc).data.filter((f) => f.type === 'ADDRESS');
    expect(found.map((f) => f.value)).toEqual(['서울 중구 필동로 00, 101호']);
  });

  it('붙여 쓴 주소도 탐지해서 가리고, fields에는 띄어 쓴 정식 이름으로 넣는다 (이슈 #72)', () => {
    const doc = leaseDoc([HEAD, '소재지 서울특별시중구 필동로 00, 101호']);
    const found = detectPII(doc).data.filter((f) => f.type === 'ADDRESS');
    expect(found.map((f) => f.value)).toEqual(['서울특별시중구 필동로 00, 101호']);
    expect(extractFields([doc], []).data.contract.address).toBe('서울특별시 중구 필동로 00, 101호');
  });

  it('"서울 친구"는 주소가 아니라서 가리지도, 집 주소로 고르지도 않는다 (이슈 #72)', () => {
    const doc = leaseDoc([HEAD, '임차인은 서울 친구 집에서 지낸다', '소재지 부산광역시 해운대구 해운대로 00']);
    const found = detectPII(doc).data.filter((f) => f.type === 'ADDRESS');
    expect(found.map((f) => f.value)).toEqual(['부산광역시 해운대구 해운대로 00']);
    expect(extractFields([doc], []).data.contract.address).toBe('부산광역시 해운대구 해운대로 00');
  });

  it('두 줄 주소의 윗줄이 줄임말 시·도 이름뿐이어도 이어 붙인 뒤 정식 이름으로 바꾼다', () => {
    const r = extractFields([leaseDoc([HEAD, '소재지 서울', '중구 필동로 00, 101호'])], []);
    expect(r.data.contract.address).toBe('서울특별시 중구 필동로 00, 101호');
  });

  it('옛 이름과 광주도 바꾼다', () => {
    const a = extractFields([leaseDoc([HEAD, '소재지 강원도 춘천시 00'])], []);
    expect(a.data.contract.address).toBe('강원특별자치도 춘천시 00');
    const b = extractFields([leaseDoc([HEAD, '소재지 광주 북구 용봉로 00'])], []);
    expect(b.data.contract.address).toBe('광주광역시 북구 용봉로 00');
  });

  it('조사가 붙은 주소도 찾아서 조사 앞까지 정식 이름으로 만든다', () => {
    const r = extractFields([leaseDoc([HEAD, '임차인은 서울 강남구에서 산다'])], []);
    expect(r.data.contract.address).toBe('서울특별시 강남구');
  });

  it('시·군·구가 없는 광주 주소는 주소로 잡지 않으므로 null이다 (추측해서 바꾸지 않는다)', () => {
    const r = extractFields([leaseDoc([HEAD, '소재지 광주 필동로 00'])], []);
    expect(r.data.contract.address).toBeNull();
  });
});
