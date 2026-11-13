import { describe, it, expect } from 'vitest';
import { matchPeople } from '../src/features/masking/index.js';
import { normalizeName, isSimilarName } from '../src/features/masking/person-matcher.js';
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

  it('순서가 바뀌어도 생년월일 없는 사람은 AMBIGUOUS (리뷰 2번)', () => {
    const fields = makeFields({
      owners: [{ findingId: 'C', name: '김철수', birthDate: null, role: 'OWNER' }],
      landlords: [{ findingId: 'B', name: '김철수', birthDate: '750315', role: 'LANDLORD' }],
    });
    const groups = matchPeople(fields).data;
    expect(groups.find((g) => g.findingIds.includes('C')).status).toBe('AMBIGUOUS');
  });

  it('성이 다르고 생년월일이 같으면 자동으로 합치지 않고 둘 다 AMBIGUOUS (예: 김철수 / 박철수)', () => {
    const fields = makeFields({
      owners: [{ findingId: 'A', name: '김철수', birthDate: '800101', role: 'OWNER' }],
      landlords: [{ findingId: 'B', name: '박철수', birthDate: '800101', role: 'LANDLORD' }],
    });
    const groups = matchPeople(fields).data;
    expect(groups.map((g) => g.status)).toEqual(['AMBIGUOUS', 'AMBIGUOUS']);
  });

  describe('Fuse.js 이름 유사도 (OCR 오타)', () => {
    it('오타 이름 + 생년월일 같음 → 자동으로 합치지 않고 둘 다 AMBIGUOUS (김철수 / 김철슈)', () => {
      const fields = makeFields({
        owners: [{ findingId: 'A', name: '김철수', birthDate: '800101', role: 'OWNER' }],
        landlords: [{ findingId: 'B', name: '김철슈', birthDate: '800101', role: 'LANDLORD' }],
      });
      const groups = matchPeople(fields).data;
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.status)).toEqual(['AMBIGUOUS', 'AMBIGUOUS']);
    });

    it('오타 이름 + 생년월일 다름 → 다른 사람', () => {
      const fields = makeFields({
        owners: [{ findingId: 'A', name: '김철수', birthDate: '800101', role: 'OWNER' }],
        landlords: [{ findingId: 'B', name: '김철슈', birthDate: '750315', role: 'LANDLORD' }],
      });
      expect(matchPeople(fields).data.map((g) => g.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
    });

    it('오타 이름 + 한쪽 생년월일 없음 → AMBIGUOUS (전에는 다른 사람으로 확정됐음)', () => {
      const fields = makeFields({
        landlords: [{ findingId: 'B', name: '김철수', birthDate: '750315', role: 'LANDLORD' }],
        accountHolders: [{ findingId: 'C', name: '김철슈', birthDate: null, role: 'ACCOUNT_HOLDER' }],
      });
      const groups = matchPeople(fields).data;
      expect(groups.find((g) => g.findingIds.includes('C')).status).toBe('AMBIGUOUS');
    });

    it('성이 다른 한글 이름 + 생년월일 없음 → 다른 사람 (비슷한 이름이 아님)', () => {
      const fields = makeFields({
        landlords: [{ findingId: 'B', name: '김철수', birthDate: '750315', role: 'LANDLORD' }],
        accountHolders: [{ findingId: 'C', name: '박철수', birthDate: null, role: 'ACCOUNT_HOLDER' }],
      });
      expect(matchPeople(fields).data.map((g) => g.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
    });

    it('영문 이름은 첫 글자 규칙 없이 전체로 비교한다 (생년월일 없는 예금주)', () => {
      const typo = makeFields({
        tenants: [{ findingId: 'T1', name: 'NGUYEN VAN A', birthDate: '990505', role: 'TENANT' }],
        accountHolders: [{ findingId: 'T2', name: 'NGUYEN VAN', birthDate: null, role: 'ACCOUNT_HOLDER' }],
      });
      expect(matchPeople(typo).data.find((g) => g.findingIds.includes('T2')).status).toBe('AMBIGUOUS');
      const other = makeFields({
        tenants: [{ findingId: 'T1', name: 'JOHN SMITH', birthDate: '990505', role: 'TENANT' }],
        accountHolders: [{ findingId: 'T2', name: 'JANE SMITH', birthDate: null, role: 'ACCOUNT_HOLDER' }],
      });
      expect(matchPeople(other).data.map((g) => g.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
    });

    it('isSimilarName: 한글은 성이 같아야, 영문은 전체가 아주 비슷해야 한다', () => {
      expect(isSimilarName('김철수', '김철슈')).toBe(true);
      expect(isSimilarName('김 철수', '김철수')).toBe(true);
      expect(isSimilarName('남궁민수', '남궁민슈')).toBe(true);
      expect(isSimilarName('김철수', '박철수')).toBe(false);
      expect(isSimilarName('김철수', '이영희')).toBe(false);
      expect(isSimilarName('김철수', '김영희')).toBe(false);
      expect(isSimilarName('NGUYEN VAN A', 'NGUYEN VAN')).toBe(true);
      expect(isSimilarName('NGUYEN VAN A', 'Nguyen Van A')).toBe(true);
      expect(isSimilarName('JOHN SMITH', 'JANE SMITH')).toBe(false);
      expect(isSimilarName('', '김철수')).toBe(false);
    });
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
