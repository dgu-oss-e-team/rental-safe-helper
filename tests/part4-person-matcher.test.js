import { describe, it, expect } from 'vitest';
import { matchPeople } from '../src/features/masking/index.js';
import { normalizeName } from '../src/features/masking/person-matcher.js';
import { mockExtractedFields, mockPersonGroups } from '../src/shared/mock-data.js';

/** 테스트용 추출 데이터를 간단히 만드는 도우미 */
const makeFields = ({ owners = [], landlords = [], tenants = [], accountHolders = [] }) => ({
  registry: { documentId: 'DOC_R', owners },
  contract: { documentId: 'DOC_L', landlords, tenants, accountHolders },
});

describe('PART 4 동일 인물 판별 matchPeople()', () => {
  it('mock 데이터로 예상 결과(mockPersonGroups)와 똑같이 나온다', () => {
    const r = matchPeople(mockExtractedFields);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual(mockPersonGroups);
  });

  it('이름과 생년월일이 같으면 같은 사람, 같은 가명', () => {
    const fields = makeFields({
      owners: [{ findingId: 'A', name: '김철수', birthDate: '800101', role: 'OWNER' }],
      landlords: [{ findingId: 'B', name: '김철수', birthDate: '800101', role: 'LANDLORD' }],
    });
    const groups = matchPeople(fields).data;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ roles: ['OWNER', 'LANDLORD'], findingIds: ['A', 'B'], status: 'CONFIRMED' });
  });

  it('동명이인(생년월일 다름)은 다른 가명', () => {
    const fields = makeFields({
      owners: [{ findingId: 'A', name: '김철수', birthDate: '800101', role: 'OWNER' }],
      landlords: [{ findingId: 'B', name: '김철수', birthDate: '750315', role: 'LANDLORD' }],
    });
    const [g1, g2] = matchPeople(fields).data;
    expect(g1.alias).not.toBe(g2.alias);
    expect(g1.personId).not.toBe(g2.personId);
  });

  it('생년월일이 없으면(null) 판정 보류 AMBIGUOUS', () => {
    const fields = makeFields({
      landlords: [{ findingId: 'B', name: '김철수', birthDate: '750315', role: 'LANDLORD' }],
      accountHolders: [{ findingId: 'C', name: '김철수', birthDate: null, role: 'ACCOUNT_HOLDER' }],
    });
    const groups = matchPeople(fields).data;
    expect(groups.find((g) => g.findingIds.includes('C')).status).toBe('AMBIGUOUS');
  });

  it('띄어쓰기가 달라도 같은 이름으로 본다', () => {
    expect(normalizeName('김 철수')).toBe(normalizeName('김철수'));
    expect(normalizeName('Nguyen Van A')).toBe('NGUYENVANA');
  });

  it('목록이 null(읽지 못함)이어도 오류 없이 나머지 사람만 판정한다', () => {
    const fields = makeFields({
      owners: [{ findingId: 'A', name: '김철수', birthDate: '800101', role: 'OWNER' }],
      accountHolders: null,
    });
    const r = matchPeople(fields);
    expect(r.ok).toBe(true);
    expect(r.data).toHaveLength(1);
  });

  it('결과에 이름과 생년월일이 들어가지 않는다', () => {
    const text = JSON.stringify(matchPeople(mockExtractedFields).data);
    expect(text).not.toContain('김철수');
    expect(text).not.toContain('800101');
  });

  it('입력이 없으면 오류', () => {
    expect(matchPeople(null).ok).toBe(false);
  });
});