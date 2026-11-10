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

describe('PART 2 extractFields 사람 정보 (④-2)', () => {
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
