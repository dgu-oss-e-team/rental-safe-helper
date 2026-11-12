import { describe, it, expect } from 'vitest';
import {
  assessTrust,
  assessSeizure,
  assessMortgage,
  assessOwnershipTransfer,
  assessRegistryRisks,
  parseIsoDate,
  subtractMonths,
} from '../src/features/risk-check/assess-risks.js';
import { assessRisks } from '../src/features/risk-check/index.js';
import { parseRiskRules } from '../src/features/risk-check/risk-rules.js';
import { mockExtractedFields, mockPersonGroups } from '../src/shared/mock-data.js';
import { RISK_STATUS } from '../src/shared/document-model.js';

const { STOP, CHECK, NO_FLAG, UNVERIFIABLE } = RISK_STATUS;

/** 테스트마다 원본 Mock을 건드리지 않도록 복사해서 쓴다 */
const fields = () => structuredClone(mockExtractedFields);
const withRights = (rights) => {
  const f = fields();
  f.registry.rights = rights;
  return f;
};
const withDates = (lastTransferDate, contractDate) => {
  const f = fields();
  f.registry.lastTransferDate = lastTransferDate;
  f.contract.contractDate = contractDate;
  return f;
};
const right = (kind, cancelled = false, maxClaimAmount = null) => ({
  kind,
  maxClaimAmount,
  cancelled,
  receivedAt: null,
});

describe('PART 3 근저당 + 보증금 비교 (MORTGAGE_EXISTS)', () => {
  it('Mock 등기부에서 근저당이 점검 결과로 나오고, 두 금액이 같이 표시된다', () => {
    const r = assessMortgage(fields());
    expect(r.ok).toBe(true);
    expect(r.data.ruleId).toBe('MORTGAGE_EXISTS');
    expect(r.data.status).toBe(CHECK);
    expect(r.data.explanation).toContain('KRW 120,000,000');
    expect(r.data.explanation).toContain('KRW 50,000,000');
    expect(r.data.evidence.left.value).toBe('KRW 120,000,000');
    expect(r.data.evidence.right.value).toBe('KRW 50,000,000');
  });

  it('근저당이 여러 건이면 채권최고액을 합산한다', () => {
    const f = withRights([right('MORTGAGE', false, 100000000), right('MORTGAGE', false, 30000000)]);
    expect(assessMortgage(f).data.evidence.left.value).toBe('KRW 130,000,000');
  });

  it('말소된 근저당은 점검에서 뺀다 (없으면 NO_FLAG)', () => {
    const f = withRights([right('MORTGAGE', true, 120000000)]);
    expect(assessMortgage(f).data.status).toBe(NO_FLAG);
  });

  it('말소 여부를 모르는 근저당은 CHECK (말소됐는지 확인 필요)', () => {
    const r = assessMortgage(withRights([right('MORTGAGE', null, 120000000)]));
    expect(r.data.status).toBe(CHECK);
    expect(r.data.explanation).toContain('could not tell whether it has been cancelled');
  });

  it('rights가 null이면 "없음"이 아니라 UNVERIFIABLE', () => {
    expect(assessMortgage(withRights(null)).data.status).toBe(UNVERIFIABLE);
  });

  it('rights가 빈 배열이면 NO_FLAG', () => {
    expect(assessMortgage(withRights([])).data.status).toBe(NO_FLAG);
  });

  it('보증금이 null이면 채권최고액과 비교하지 않는다 (근저당이 있다는 사실은 CHECK로 알린다)', () => {
    const f = fields();
    f.contract.deposit = null;
    const r = assessMortgage(f);
    expect(r.data.status).toBe(CHECK);
    expect(r.data.explanation).toContain('did not compare');
    expect(r.data.explanation).not.toContain('50,000,000');
    expect(r.data.evidence.right.value).toBe('—');
  });

  it('보증금 항목이 아예 없어도(undefined) 같은 방식으로 처리한다', () => {
    const f = fields();
    delete f.contract.deposit;
    expect(assessMortgage(f).data.explanation).toContain('did not compare');
  });

  it('계약서가 없어도(contract: null) 근저당은 점검하고 비교는 하지 않는다', () => {
    const f = fields();
    f.contract = null;
    const r = assessMortgage(f);
    expect(r.data.status).toBe(CHECK);
    expect(r.data.explanation).toContain('did not compare');
  });

  it('채권최고액을 못 읽으면(null) 비교하지 않고 이유를 알린다', () => {
    const r = assessMortgage(withRights([right('MORTGAGE', false, null)]));
    expect(r.data.status).toBe(CHECK);
    expect(r.data.explanation).toContain('could not read the maximum secured amount');
  });

  it('등기부가 없으면 UNVERIFIABLE', () => {
    const f = fields();
    f.registry = null;
    expect(assessMortgage(f).data.status).toBe(UNVERIFIABLE);
  });
});

describe('PART 3 신탁 (TRUST_REGISTERED)', () => {
  it('유효한 신탁이 있으면 STOP', () => {
    expect(assessTrust(withRights([right('TRUST')])).data.status).toBe(STOP);
  });

  it('말소된 신탁은 뺀다 (NO_FLAG)', () => {
    expect(assessTrust(withRights([right('TRUST', true)])).data.status).toBe(NO_FLAG);
  });

  it('말소 여부를 모르는 신탁은 CHECK', () => {
    expect(assessTrust(withRights([right('TRUST', null)])).data.status).toBe(CHECK);
  });

  it('rights가 null이면 UNVERIFIABLE, 빈 배열이면 NO_FLAG', () => {
    expect(assessTrust(withRights(null)).data.status).toBe(UNVERIFIABLE);
    expect(assessTrust(withRights([])).data.status).toBe(NO_FLAG);
  });

  it('Mock 등기부(근저당만 있음)에는 신탁이 없어서 NO_FLAG', () => {
    expect(assessTrust(fields()).data.status).toBe(NO_FLAG);
  });
});

describe('PART 3 압류·가압류 (SEIZURE_ACTIVE)', () => {
  it('압류가 있으면 STOP', () => {
    expect(assessSeizure(withRights([right('SEIZURE')])).data.status).toBe(STOP);
  });

  it('가압류가 있으면 STOP', () => {
    expect(assessSeizure(withRights([right('PROVISIONAL_SEIZURE')])).data.status).toBe(STOP);
  });

  it('말소된 압류는 뺀다 (NO_FLAG)', () => {
    expect(assessSeizure(withRights([right('SEIZURE', true)])).data.status).toBe(NO_FLAG);
  });

  it('말소 여부를 모르는 압류만 있으면 CHECK', () => {
    expect(assessSeizure(withRights([right('SEIZURE', null)])).data.status).toBe(CHECK);
  });

  it('유효한 압류가 하나라도 있으면 말소 여부를 모르는 것이 있어도 STOP', () => {
    const f = withRights([right('SEIZURE', false), right('PROVISIONAL_SEIZURE', null)]);
    expect(assessSeizure(f).data.status).toBe(STOP);
  });

  it('rights가 null이면 UNVERIFIABLE, 빈 배열이면 NO_FLAG', () => {
    expect(assessSeizure(withRights(null)).data.status).toBe(UNVERIFIABLE);
    expect(assessSeizure(withRights([])).data.status).toBe(NO_FLAG);
  });

  it('근저당만 있으면 압류는 NO_FLAG (다른 종류와 섞이지 않는다)', () => {
    expect(assessSeizure(fields()).data.status).toBe(NO_FLAG);
  });

  it('근거 칸에 유효한 건수와 종류가 나온다', () => {
    const r = assessSeizure(withRights([right('SEIZURE'), right('PROVISIONAL_SEIZURE')]));
    expect(r.data.evidence.left.value).toBe('2 active (seizure, provisional seizure)');
  });
});

describe('PART 3 최근 소유권 이전 (RECENT_OWNERSHIP_CHANGE)', () => {
  it('Mock에는 날짜가 없어서(undefined) UNVERIFIABLE', () => {
    expect(assessOwnershipTransfer(fields()).data.status).toBe(UNVERIFIABLE);
  });

  it('둘 중 하나라도 null이면 UNVERIFIABLE', () => {
    expect(assessOwnershipTransfer(withDates(null, '2025-07-10')).data.status).toBe(UNVERIFIABLE);
    expect(assessOwnershipTransfer(withDates('2025-05-01', null)).data.status).toBe(UNVERIFIABLE);
  });

  it("'YYYY-MM-DD' 형식이 아니거나 없는 날짜면 UNVERIFIABLE", () => {
    expect(assessOwnershipTransfer(withDates('2025/05/01', '2025-07-10')).data.status).toBe(UNVERIFIABLE);
    expect(assessOwnershipTransfer(withDates('2025-02-30', '2025-07-10')).data.status).toBe(UNVERIFIABLE);
  });

  it('계약일 6개월 안에 소유권이 바뀌었으면 CHECK', () => {
    const r = assessOwnershipTransfer(withDates('2025-05-01', '2025-07-10'));
    expect(r.data.status).toBe(CHECK);
    expect(r.data.explanation).toContain('within 6 months');
  });

  it('6개월보다 오래됐으면 NO_FLAG', () => {
    expect(assessOwnershipTransfer(withDates('2020-03-15', '2025-07-10')).data.status).toBe(NO_FLAG);
  });

  it('경계: 정확히 6개월 전은 CHECK, 하루 더 전은 NO_FLAG', () => {
    expect(assessOwnershipTransfer(withDates('2025-01-10', '2025-07-10')).data.status).toBe(CHECK);
    expect(assessOwnershipTransfer(withDates('2025-01-09', '2025-07-10')).data.status).toBe(NO_FLAG);
  });

  it('접수일이 계약일보다 늦어도 최근으로 본다 (CHECK)', () => {
    expect(assessOwnershipTransfer(withDates('2025-08-01', '2025-07-10')).data.status).toBe(CHECK);
  });

  it('근거 칸에는 실제 날짜가 나오고, 설명에는 날짜가 없다', () => {
    const r = assessOwnershipTransfer(withDates('2025-05-01', '2025-07-10'));
    expect(r.data.evidence.left.value).toBe('2025-05-01');
    expect(r.data.evidence.right.value).toBe('2025-07-10');
    expect(r.data.explanation).not.toContain('2025');
  });

  it('parseIsoDate / subtractMonths', () => {
    expect(parseIsoDate('2025-02-28')).not.toBeNull();
    expect(parseIsoDate('2025-13-01')).toBeNull();
    expect(parseIsoDate(20250228)).toBeNull();
    expect(subtractMonths(parseIsoDate('2025-03-31'), 1).toISOString().slice(0, 10)).toBe('2025-02-28');
    expect(subtractMonths(parseIsoDate('2025-01-15'), 6).toISOString().slice(0, 10)).toBe('2024-07-15');
  });
});

describe('PART 3 assessRisks() 연결 (#11)', () => {
  it('Mock 입력으로 점검 결과 7개가 나오고, 근저당은 CHECK다', () => {
    const r = assessRisks(fields(), mockPersonGroups);
    expect(r.ok).toBe(true);
    const byId = Object.fromEntries(r.data.map((x) => [x.ruleId, x.status]));
    expect(byId).toEqual({
      OWNER_MISMATCH: STOP,
      ACCOUNT_HOLDER_MISMATCH: UNVERIFIABLE,
      ADDRESS_MISMATCH: NO_FLAG,
      TRUST_REGISTERED: NO_FLAG,
      SEIZURE_ACTIVE: NO_FLAG,
      MORTGAGE_EXISTS: CHECK,
      RECENT_OWNERSHIP_CHANGE: UNVERIFIABLE,
    });
  });

  it('rights가 null이면 신탁·압류·근저당 모두 UNVERIFIABLE (없음으로 나가지 않는다)', () => {
    const r = assessRegistryRisks(withRights(null));
    const byId = Object.fromEntries(r.data.map((x) => [x.ruleId, x.status]));
    expect(byId.TRUST_REGISTERED).toBe(UNVERIFIABLE);
    expect(byId.SEIZURE_ACTIVE).toBe(UNVERIFIABLE);
    expect(byId.MORTGAGE_EXISTS).toBe(UNVERIFIABLE);
  });

  it('모든 결과에 근거 칸(evidence)·설명·행동 안내가 있고, 설명에 실제 이름이 없다', () => {
    const r = assessRisks(withDates('2025-05-01', '2025-07-10'), mockPersonGroups);
    for (const risk of r.data) {
      expect(risk.evidence.left.label.length).toBeGreaterThan(0);
      expect(risk.explanation.length).toBeGreaterThan(0);
      expect(risk.action.length).toBeGreaterThan(0);
      const text = [risk.title, risk.explanation, risk.action].join(' ');
      expect(text).not.toContain('김철수');
      expect(text).not.toContain('{');
    }
  });

  it('입력이 비어 있어도(registry·contract가 null) 오류 없이 UNVERIFIABLE로 나온다', () => {
    const r = assessRegistryRisks({ registry: null, contract: null });
    expect(r.ok).toBe(true);
    for (const risk of r.data) expect(risk.status).toBe(UNVERIFIABLE);
  });
});

describe('PART 3 규칙 파일 변형 키 ("상태.변형")', () => {
  const yaml = (key) =>
    `rules:\n  X:\n    title: T\n    results:\n      ${key}:\n        explanation: e\n        action: a\n`;

  it('CHECK.cancel_unknown 같은 키는 통과한다', () => {
    expect(parseRiskRules(yaml('CHECK.cancel_unknown')).ok).toBe(true);
  });

  it('상태 이름이 틀리거나 변형 이름이 비어 있으면 실패', () => {
    expect(parseRiskRules(yaml('DANGER.x')).ok).toBe(false);
    expect(parseRiskRules(yaml('CHECK.')).ok).toBe(false);
    expect(parseRiskRules(yaml('CHECK.a.b')).ok).toBe(false);
  });
});