import { describe, it, expect } from 'vitest';
import {
  compareOwnerAndLandlord,
  compareAccountHolderAndLandlord,
  compareAddresses,
  normalizeAddress,
} from '../src/features/risk-check/compare-documents.js';
import { assessRisks, buildPrompt } from '../src/features/risk-check/index.js';
import { parseRiskRules } from '../src/features/risk-check/risk-rules.js';
import { mockExtractedFields, mockPersonGroups } from '../src/shared/mock-data.js';
import { RISK_STATUS, MASKING_PURPOSE } from '../src/shared/document-model.js';

/** 테스트마다 원본 Mock을 건드리지 않도록 복사해서 쓴다 */
const fields = () => structuredClone(mockExtractedFields);
const groups = () => structuredClone(mockPersonGroups);

/** 소유자와 임대인이 같은 사람이 되도록 그룹을 합친다 (P1 = 소유자 + 임대인) */
function mergeOwnerAndLandlord(list) {
  const owner = list.find((g) => g.personId === 'P1');
  const landlord = list.find((g) => g.personId === 'P2');
  owner.roles.push('LANDLORD');
  owner.findingIds.push(...landlord.findingIds);
  return list.filter((g) => g.personId !== 'P2');
}

/** 예금주(P4)를 임대인(P2)과 같은 사람으로 확정한다 */
function confirmAccountHolderIsLandlord(list) {
  const landlord = list.find((g) => g.personId === 'P2');
  const holder = list.find((g) => g.personId === 'P4');
  landlord.roles.push('ACCOUNT_HOLDER');
  landlord.findingIds.push(...holder.findingIds);
  return list.filter((g) => g.personId !== 'P4');
}

describe('PART 3 소유자 ↔ 임대인 비교 (OWNER_MISMATCH)', () => {
  it('다른 사람이면 STOP, 문구에는 역할 가명만 쓴다', () => {
    const r = compareOwnerAndLandlord(fields(), groups());
    expect(r.ok).toBe(true);
    expect(r.data.ruleId).toBe('OWNER_MISMATCH');
    expect(r.data.status).toBe(RISK_STATUS.STOP);
    expect(r.data.explanation).toContain('[Owner_A]');
    expect(r.data.explanation).toContain('[Landlord_B]');
    expect(r.data.explanation).not.toContain('김철수');
  });

  it('같은 사람이면 NO_FLAG', () => {
    const r = compareOwnerAndLandlord(fields(), mergeOwnerAndLandlord(groups()));
    expect(r.data.status).toBe(RISK_STATUS.NO_FLAG);
    expect(r.data.explanation).toContain('[Owner_A]');
  });

  it('소유자를 못 읽었으면(null) UNVERIFIABLE', () => {
    const f = fields();
    f.registry.owners = null;
    expect(compareOwnerAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('임대인을 못 읽었으면(null) UNVERIFIABLE', () => {
    const f = fields();
    f.contract.landlords = null;
    expect(compareOwnerAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('등기부 문서 자체가 없어도 UNVERIFIABLE', () => {
    const f = fields();
    f.registry = null;
    expect(compareOwnerAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('인물 판정이 AMBIGUOUS면 STOP이 아니라 UNVERIFIABLE', () => {
    const g = groups();
    g.find((x) => x.personId === 'P2').status = 'AMBIGUOUS';
    expect(compareOwnerAndLandlord(fields(), g).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('personGroups에서 사람을 찾지 못하면 UNVERIFIABLE', () => {
    expect(compareOwnerAndLandlord(fields(), []).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('근거 칸(evidence)은 화면용 실제 값, 값이 없으면 —', () => {
    const r = compareOwnerAndLandlord(fields(), groups());
    expect(r.data.evidence.left).toEqual({ label: 'Registry owner', value: '김철수 (birth 800101)' });
    expect(r.data.evidence.right.value).toBe('김철수 (birth 750315)');

    const f = fields();
    f.registry.owners = null;
    expect(compareOwnerAndLandlord(f, groups()).data.evidence.left.value).toBe('—');
  });
});

describe('PART 3 예금주 ↔ 임대인 비교 (ACCOUNT_HOLDER_MISMATCH)', () => {
  it('Mock 시나리오: 예금주 판정이 AMBIGUOUS라 UNVERIFIABLE', () => {
    const r = compareAccountHolderAndLandlord(fields(), groups());
    expect(r.data.ruleId).toBe('ACCOUNT_HOLDER_MISMATCH');
    expect(r.data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('임대인과 같은 사람으로 확정되면 NO_FLAG', () => {
    const r = compareAccountHolderAndLandlord(fields(), confirmAccountHolderIsLandlord(groups()));
    expect(r.data.status).toBe(RISK_STATUS.NO_FLAG);
  });

  it('다른 사람으로 확정되면 STOP, 문구에는 역할 가명만 쓴다', () => {
    const g = groups();
    g.find((x) => x.personId === 'P4').status = 'CONFIRMED';
    const r = compareAccountHolderAndLandlord(fields(), g);
    expect(r.data.status).toBe(RISK_STATUS.STOP);
    expect(r.data.explanation).toContain('[AccountHolder_D]');
    expect(r.data.explanation).toContain('[Landlord_B]');
    expect(r.data.explanation).not.toContain('김철수');
  });

  it('예금주를 못 읽었으면(null) UNVERIFIABLE', () => {
    const f = fields();
    f.contract.accountHolders = null;
    expect(compareAccountHolderAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });
});

describe('PART 3 소재지 비교 (ADDRESS_MISMATCH)', () => {
  it('같은 주소면 NO_FLAG', () => {
    expect(compareAddresses(fields()).data.status).toBe(RISK_STATUS.NO_FLAG);
  });

  it('쓰는 방식만 다른 주소(공백·괄호·"제")는 같은 주소로 본다', () => {
    const f = fields();
    f.registry.address = '서울특별시 중구 필동로 45 필동빌라 제2층 제201호';
    f.contract.address = '서울특별시 중구 필동로 45 필동빌라(필동 123-4) 2층 201호';
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.NO_FLAG);
  });

  it('호수가 다르면 STOP', () => {
    const f = fields();
    f.contract.address = '서울특별시 중구 필동로 00, 102호';
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.STOP);
  });

  it('주소를 못 읽었으면(null) UNVERIFIABLE', () => {
    const f = fields();
    f.registry.address = null;
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    const f2 = fields();
    f2.contract.address = null;
    expect(compareAddresses(f2).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('normalizeAddress는 공백·쉼표·괄호·"제"를 정리한다', () => {
    expect(normalizeAddress('서울 중구 필동로 00, 제101호 (필동)')).toBe('서울중구필동로00101호');
  });
});

describe('PART 3 assessRisks() 연결', () => {
  it('Mock 입력으로 비교 규칙 3개가 STOP / UNVERIFIABLE / NO_FLAG로 나온다', () => {
    const r = assessRisks(fields(), groups());
    expect(r.ok).toBe(true);
    const byId = Object.fromEntries(r.data.map((x) => [x.ruleId, x.status]));
    expect(byId).toEqual({
      OWNER_MISMATCH: RISK_STATUS.STOP,
      ACCOUNT_HOLDER_MISMATCH: RISK_STATUS.UNVERIFIABLE,
      ADDRESS_MISMATCH: RISK_STATUS.NO_FLAG,
    });
  });

  it('title·explanation·action 어디에도 실제 이름이 없다', () => {
    const r = assessRisks(fields(), groups());
    for (const risk of r.data) {
      const text = [risk.title, risk.explanation, risk.action].join(' ');
      expect(text).not.toContain('김철수');
      expect(text).not.toContain('NGUYEN');
    }
  });

  it('evidence(실제 값)는 AI 프롬프트에 들어가지 않는다', () => {
    const r = assessRisks(fields(), groups());
    const p = buildPrompt({
      purpose: MASKING_PURPOSE.FRAUD_CHECK,
      riskResults: r.data,
      maskedText: { DOC_LEASE: '임대인 [Landlord_B]' },
      legend: { '[Landlord_B]': 'landlord on the contract' },
    });
    expect(p.ok).toBe(true);
    expect(p.data).not.toContain('김철수');
    expect(p.data).not.toContain('800101');
    expect(p.data).toContain('[Owner_A]');
  });

  it('입력이 없으면 INVALID_INPUT', () => {
    expect(assessRisks(null, []).ok).toBe(false);
    expect(assessRisks(fields(), null).ok).toBe(false);
  });
});

describe('PART 3 규칙 파일(YAML) 검사', () => {
  it('YAML 문법이 틀리면 실패', () => {
    expect(parseRiskRules('rules: [unclosed').ok).toBe(false);
  });

  it('rules 항목이 없으면 실패', () => {
    expect(parseRiskRules('other: 1').ok).toBe(false);
  });

  it('알 수 없는 상태값이나 빠진 문구가 있으면 실패', () => {
    const badStatus = 'rules:\n  X:\n    title: T\n    results:\n      DANGER:\n        explanation: e\n        action: a\n';
    expect(parseRiskRules(badStatus).ok).toBe(false);
    const noAction = 'rules:\n  X:\n    title: T\n    results:\n      STOP:\n        explanation: e\n';
    expect(parseRiskRules(noAction).ok).toBe(false);
  });
});