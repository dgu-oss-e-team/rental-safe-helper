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
