// PART 4. 같은 서류에서 같은 역할로 똑같은 이름이 또 나오면 같은 사람으로 묶는다 (#165)
import { describe, it, expect } from 'vitest';
import { matchPeople } from '../src/features/masking/index.js';

/** 테스트용 추출 데이터 */
const makeFields = ({ owners = [], landlords = [], tenants = [], accountHolders = [] }) => ({
  registry: { documentId: 'DOC_R', owners, previousOwners: [] },
  contract: { documentId: 'DOC_L', landlords, tenants, accountHolders },
});
const person = (findingId, name, birthDate, role) => ({ findingId, name, birthDate, role });

describe('PART 4 같은 서류·같은 역할·같은 이름', () => {
  it('계약서에 두 번 나오는 임차인(둘 다 생년월일 없음)은 가명 하나로 묶고, 질문 대상도 아니다', () => {
    const fields = makeFields({ tenants: [person('T1', '성춘향', null, 'TENANT'), person('T2', '성춘향', null, 'TENANT')] });
    const groups = matchPeople(fields).data;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ alias: '[Tenant_A]', roles: ['TENANT'], findingIds: ['T1', 'T2'], status: 'CONFIRMED' });
  });

  it('한쪽에만 생년월일이 있어도 묶는다', () => {
    const fields = makeFields({ tenants: [person('T1', '성춘향', null, 'TENANT'), person('T2', '성춘향', '990101', 'TENANT')] });
    expect(matchPeople(fields).data.map((g) => g.findingIds)).toEqual([['T1', 'T2']]);
  });

  it('같은 역할이라도 생년월일이 서로 다르면 묶지 않는다 (동명이인)', () => {
    const fields = makeFields({ tenants: [person('T1', '성춘향', '990101', 'TENANT'), person('T2', '성춘향', '880202', 'TENANT')] });
    expect(matchPeople(fields).data).toHaveLength(2);
  });

  it('역할이 다르면(임대인·예금주) 지금처럼 묶지 않고 묻는다', () => {
    const fields = makeFields({
      landlords: [person('L1', '김철수', '750315', 'LANDLORD')],
      accountHolders: [person('H1', '김철수', null, 'ACCOUNT_HOLDER')],
    });
    const groups = matchPeople(fields).data;
    expect(groups).toHaveLength(2);
    expect(groups[1].status).toBe('AMBIGUOUS');
  });

  it('서류가 다르면(등기부 소유자·계약서 임대인) 생년월일 없이 묶지 않는다', () => {
    const fields = makeFields({
      owners: [person('O1', '김철수', null, 'OWNER')],
      landlords: [person('L1', '김철수', null, 'LANDLORD')],
    });
    const groups = matchPeople(fields).data;
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.status === 'AMBIGUOUS')).toBe(true);
  });
});
