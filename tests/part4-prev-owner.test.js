import { describe, it, expect } from 'vitest';
import { matchPeople, createMaskingPlan, applyMaskingPlan } from '../src/features/masking/index.js';
import { MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

/** 테스트용 추출 데이터 (등기부에 예전 소유자 목록 previousOwners 추가) */
const makeFields = ({ owners = [], previousOwners = [], landlords = [], tenants = [], accountHolders = [] }) => ({
  registry: { documentId: 'DOC_R', owners, previousOwners },
  contract: { documentId: 'DOC_L', landlords, tenants, accountHolders },
});

const OWNER = { findingId: 'O1', name: '김철수', birthDate: '800101', role: 'OWNER' };
const LANDLORD = { findingId: 'L1', name: '김철수', birthDate: '750315', role: 'LANDLORD' };
const TENANT = { findingId: 'T1', name: 'NGUYEN VAN A', birthDate: '990505', role: 'TENANT' };
const HOLDER = { findingId: 'H1', name: '이영희', birthDate: '820202', role: 'ACCOUNT_HOLDER' };
const PREV = { findingId: 'P1', name: '박민수', birthDate: '700707', role: 'PREVIOUS_OWNER' };

describe('PART 4 예전 소유자 [PrevOwner_?]', () => {
  it('previousOwners가 null(읽지 못함)이어도 오류 없이 나머지 사람만 묶는다', () => {
    const fields = makeFields({ owners: [OWNER], previousOwners: null });
    const r = matchPeople(fields);
    expect(r.ok).toBe(true);
    expect(r.data).toHaveLength(1);
  });

  it('예전 소유자는 맨 뒤에 붙어서 [PrevOwner_E]가 되고, 기존 A~D 가명은 그대로다', () => {
    const fields = makeFields({
      owners: [OWNER], landlords: [LANDLORD], tenants: [TENANT], accountHolders: [HOLDER], previousOwners: [PREV],
    });
    const groups = matchPeople(fields).data;
    expect(groups.map((g) => g.alias)).toEqual([
      '[Owner_A]', '[Landlord_B]', '[Tenant_C]', '[AccountHolder_D]', '[PrevOwner_E]',
    ]);
    expect(groups[4]).toMatchObject({ personId: 'P5', roles: ['PREVIOUS_OWNER'], findingIds: ['P1'] });
  });

  it('마스킹하면 예전 소유자 이름이 가명으로 바뀌고 범례에 뜻이 적힌다', () => {
    const groups = matchPeople(makeFields({ owners: [OWNER], previousOwners: [PREV] })).data;
    const doc = {
      documentId: 'DOC_R',
      pages: [{ pageIndex: 0, width: 100, height: 100, blocks: [
        { blockId: 'B1', text: '소유권이전 박민수', bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 }, confidence: null },
      ] }],
    };
    const findings = [{
      id: 'P1', type: PII_TYPE.PERSON_NAME, value: '박민수', documentId: 'DOC_R', blockId: 'B1',
      pageIndex: 0, bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
    }];
    const plan = createMaskingPlan(findings, groups, MASKING_PURPOSE.FRAUD_CHECK).data;
    const masked = applyMaskingPlan([doc], plan, findings, groups).data;
    expect(masked.maskedText.DOC_R).toBe('소유권이전 [PrevOwner_B]');
    expect(masked.legend['[PrevOwner_B]']).toBe('previous owner on the register');
  });

  it('예전 소유자가 지금 소유자와 같은 사람(이름·생년월일 같음)이면 Owner 그룹으로 합쳐진다', () => {
    const samePerson = { ...PREV, name: OWNER.name, birthDate: OWNER.birthDate };
    const groups = matchPeople(makeFields({ owners: [OWNER], previousOwners: [samePerson] })).data;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ alias: '[Owner_A]', roles: ['OWNER', 'PREVIOUS_OWNER'], findingIds: ['O1', 'P1'] });
  });
});
