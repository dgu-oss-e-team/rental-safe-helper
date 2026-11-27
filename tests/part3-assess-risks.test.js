import { describe, it, expect } from 'vitest';
import {
  assessTrust,
  hasTrustNotice,
  assessSeizure,
  assessProvisionalDisposition,
  assessAuction,
  assessProvisionalRegistration,
  assessMortgage,
  assessOwnershipTransfer,
  assessRegistryRisks,
  parseIsoDate,
  subtractMonths,
} from '../src/features/risk-check/assess-risks.js';
import { groupRiskResults, STATUS_ORDER } from '../src/features/risk-check/risk-result-model.js';
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
/** unknownActiveCount는 기본 0. 없음·null 등을 시험할 때는 registryExtra로 덮어쓴다 ({}면 필드 없음) */
const withRegistry = (rights, registryExtra = { unknownActiveCount: 0 }) => {
  const f = withRights(rights);
  Object.assign(f.registry, registryExtra);
  return f;
};

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

describe('PART 3 신탁 + 특약의 신탁 안내 (TRUST_REGISTERED, #175)', () => {
  /** 유효한 신탁 등기 + 계약서 특약 */
  const trustWithTerms = (specialTerms, rights = [right('TRUST')]) => {
    const f = withRights(rights);
    f.contract.specialTerms = specialTerms;
    return f;
  };
  /** 실제 계약서처럼 한 조항이 여러 줄로 나뉘어 넘어온 신탁 안내 (가짜 문장) */
  const NOTICE = [
    '제18조(신탁계약 안내) 이 주택은 신탁등기가 되어 있으며,',
    '수탁자의 동의를 받아 이 계약을 체결한다.',
    '보증금과 월 임대료는 아래 지정 계좌로 납부한다.',
  ];

  it('특약에 신탁 안내(신탁 + 수탁자/신탁회사/동의서)가 있으면 STOP이 아니라 CHECK', () => {
    const r = assessTrust(trustWithTerms(NOTICE));
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe(CHECK);
  });

  it('CHECK일 때 확인할 4가지(임대 권한 / 수탁자 동의 / 지정 계좌 / 보증금 반환)를 같이 보여 준다', () => {
    const { action } = assessTrust(trustWithTerms(NOTICE)).data;
    expect(action).toContain('right to lease');
    expect(action).toContain('agreed to the lease in writing');
    expect(action).toContain('account designated by the trust company');
    expect(action).toContain('return the deposit');
  });

  it('낮춰도 안전하다는 문구(NO_FLAG)는 쓰지 않는다', () => {
    const r = assessTrust(trustWithTerms(NOTICE)).data;
    expect(r.status).not.toBe(NO_FLAG);
    expect(r.explanation).toContain('does not prove');
  });

  it('특약에 신탁 안내가 없으면 STOP 유지', () => {
    expect(assessTrust(trustWithTerms(['월세는 현금으로 지급한다.'])).data.status).toBe(STOP);
  });

  it('"신탁"만 있고 수탁자·동의·계좌가 없는 문장은 STOP 유지', () => {
    expect(assessTrust(trustWithTerms(['이 건물은 신탁 부동산이다.'])).data.status).toBe(STOP);
  });

  it('"신탁"만 있는 문장에 흔한 낱말(동의·계좌)만 같이 있으면 안내로 보지 않아 STOP 유지 (#198 리뷰)', () => {
    expect(assessTrust(trustWithTerms(['신탁 등기가 있으면 계약을 해제한다.', '임차인은 위 내용에 동의한다.'])).data.status).toBe(STOP);
    expect(assessTrust(trustWithTerms(['신탁등기가 되어 있다.', '보증금은 임대인 계좌로 입금한다.'])).data.status).toBe(STOP);
  });

  it('"신탁 말소 후 잔금" 같은 조건은 안내로 보지 않아 STOP 유지 (#198 리뷰)', () => {
    expect(assessTrust(trustWithTerms(['잔금 전까지 신탁등기를 말소하고, 보증금은 임대인 계좌로 입금한다.'])).data.status).toBe(STOP);
    expect(assessTrust(trustWithTerms(['잔금 전까지 신탁등기를 말소한다.', '수탁자의 동의서를 받아 제출한다.'])).data.status).toBe(STOP);
  });

  it('신탁회사·동의서 낱말도 신탁 안내로 본다', () => {
    expect(assessTrust(trustWithTerms(['이 주택은 신탁등기가 되어 있다.', '신탁회사가 지정한 계좌로 납부한다.'])).data.status).toBe(CHECK);
    expect(assessTrust(trustWithTerms(['신탁 부동산이므로 임대차 동의서를 첨부한다.'])).data.status).toBe(CHECK);
  });

  it('위험 신호 문장은 신탁 안내로 보지 않아 STOP 유지 (#198 리뷰 2)', () => {
    // 낱말 하나("신탁회사")로 "신탁"과 안내 낱말 두 조건을 다 채우지 못한다
    expect(assessTrust(trustWithTerms(['보증금은 신탁회사가 아닌 임대인 개인 계좌로 입금한다.'])).data.status).toBe(STOP);
    // 부정 표현(않, 없이, 아닌)이 같이 있으면 안내가 아니다
    expect(assessTrust(trustWithTerms(['신탁 등기가 있으나 수탁자의 동의는 받지 않았다.'])).data.status).toBe(STOP);
    expect(assessTrust(trustWithTerms(['신탁 부동산이며 수탁자의 동의 없이 계약한다.'])).data.status).toBe(STOP);
  });

  it('서로 다른 조항이 한 묶음으로 합쳐져도 안내로 보지 않아 STOP 유지 (#198 리뷰 2)', () => {
    const terms = ['신탁 사실을 고지하였다.', '반려동물 금지.', '임대보증금 보증 미가입 동의서를 제출한다.'];
    expect(assessTrust(trustWithTerms(terms)).data.status).toBe(STOP);
    // 새 조항 시작("2.", "제N조")에서는 묶음을 끊는다
    expect(assessTrust(trustWithTerms(['신탁 사실을 고지하였다.', '2. 임대보증금 보증 미가입 동의서를 제출한다.'])).data.status).toBe(STOP);
    expect(assessTrust(trustWithTerms(['신탁 사실을 고지하였다.', '제19조 수탁자 동의서를 제출한다.'])).data.status).toBe(STOP);
  });

  it('수탁자·동의·계좌만 있고 "신탁"이 없으면 STOP 유지', () => {
    expect(assessTrust(trustWithTerms(['임대인의 동의 없이 전대할 수 없다.', '계좌로 입금한다.'])).data.status).toBe(STOP);
  });

  it('"신탁"과 다른 낱말이 멀리 떨어져 있으면 안내로 보지 않는다 (엉뚱한 문장으로 낮아지지 않음)', () => {
    const terms = ['이 건물은 신탁 부동산이다.', '관리비는 매월 말일까지 낸다.', '반려동물은 키울 수 없다.', '계좌로 입금한다.'];
    expect(assessTrust(trustWithTerms(terms)).data.status).toBe(STOP);
  });

  it('특약을 못 읽었으면(null) 또는 비어 있으면([]) STOP 유지', () => {
    expect(assessTrust(trustWithTerms(null)).data.status).toBe(STOP);
    expect(assessTrust(trustWithTerms([])).data.status).toBe(STOP);
  });

  it('말소된 신탁은 특약과 상관없이 NO_FLAG, 말소 여부를 모르면 CHECK(cancel_unknown) 그대로', () => {
    expect(assessTrust(trustWithTerms(NOTICE, [right('TRUST', true)])).data.status).toBe(NO_FLAG);
    const unclear = assessTrust(trustWithTerms(NOTICE, [right('TRUST', null)])).data;
    expect(unclear.status).toBe(CHECK);
    expect(unclear.explanation).toContain('could not tell whether it has been cancelled');
  });

  it('rights를 못 읽었으면(null) 특약에 신탁 안내가 있어도 UNVERIFIABLE', () => {
    expect(assessTrust(trustWithTerms(NOTICE, null)).data.status).toBe(UNVERIFIABLE);
  });

  it('hasTrustNotice: 띄어쓰기·줄바꿈이 달라도 찾고, 문자열이 아닌 값은 무시한다', () => {
    expect(hasTrustNotice(['신 탁 계약 안내', '수 탁 자 동의'])).toBe(true);
    expect(hasTrustNotice([null, 123, '신탁', '수탁자'])).toBe(true);
    expect(hasTrustNotice('신탁 수탁자')).toBe(false);
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

const NEW_RIGHT_RULES = [
  { name: '가처분', kind: 'PROVISIONAL_DISPOSITION', run: assessProvisionalDisposition, ruleId: 'PROVISIONAL_DISPOSITION_ACTIVE', activeStatus: STOP },
  { name: '경매개시결정', kind: 'AUCTION', run: assessAuction, ruleId: 'AUCTION_ACTIVE', activeStatus: STOP },
  { name: '가등기', kind: 'PROVISIONAL_REGISTRATION', run: assessProvisionalRegistration, ruleId: 'PROVISIONAL_REGISTRATION_ACTIVE', activeStatus: CHECK },
];

describe.each(NEW_RIGHT_RULES)('PART 3 $name ($ruleId) (#345)', ({ kind, run, ruleId, activeStatus }) => {
  it('말소되지 않은 기록이 있으면 해당 상태(STOP 또는 CHECK)', () => {
    const r = run(withRegistry([right(kind, false)]));
    expect(r.ok).toBe(true);
    expect(r.data.ruleId).toBe(ruleId);
    expect(r.data.status).toBe(activeStatus);
  });

  it('말소된 기록만 있으면 NO_FLAG', () => {
    expect(run(withRegistry([right(kind, true)])).data.status).toBe(NO_FLAG);
  });

  it('해당 권리가 아예 없으면(rights: []) NO_FLAG', () => {
    expect(run(withRegistry([])).data.status).toBe(NO_FLAG);
  });

  it('다른 종류 권리만 있으면 섞이지 않고 NO_FLAG', () => {
    const f = withRegistry([right('SEIZURE'), right('MORTGAGE', false, 100000000)]);
    expect(run(f).data.status).toBe(NO_FLAG);
  });

  it('cancelled: null만 있으면 UNVERIFIABLE (NO_FLAG도 CHECK도 아니다)', () => {
    const r = run(withRegistry([right(kind, null)]));
    expect(r.data.status).toBe(UNVERIFIABLE);
    expect(r.data.status).not.toBe(NO_FLAG);
  });

  it('rights: null이면 UNVERIFIABLE (NO_FLAG로 표시하지 않는다)', () => {
    expect(run(withRegistry(null)).data.status).toBe(UNVERIFIABLE);
  });

  it('같은 종류 2건 중 1건만 말소돼도 말소 안 된 기록이 있으면 해당 상태', () => {
    expect(run(withRegistry([right(kind, true), right(kind, false)])).data.status).toBe(activeStatus);
  });

  it('유효한 기록이 있으면 cancelled: null 기록이 같이 있어도 해당 상태', () => {
    expect(run(withRegistry([right(kind, false), right(kind, null)])).data.status).toBe(activeStatus);
  });

  it('holder·holderIsCompany·cause가 비어 있거나 아예 없어도 오류 없이 같은 결과', () => {
    const blank = { kind, cancelled: false, holder: null, holderIsCompany: null, cause: null };
    const missing = { kind, cancelled: false };
    for (const item of [blank, missing]) {
      const r = run(withRegistry([item]));
      expect(r.ok).toBe(true);
      expect(r.data.status).toBe(activeStatus);
    }
  });

  it('unknownActiveCount: 0이면 기존 결과(NO_FLAG)', () => {
    expect(run(withRegistry([], { unknownActiveCount: 0 })).data.status).toBe(NO_FLAG);
  });

  it('unknownActiveCount가 1 이상이면 NO_FLAG 대신 UNVERIFIABLE', () => {
    for (const n of [1, 3]) {
      const r = run(withRegistry([], { unknownActiveCount: n }));
      expect(r.data.status, String(n)).toBe(UNVERIFIABLE);
      expect(r.data.explanation).toContain('could not be read');
    }
  });

  it('unknownActiveCount가 없음·null·NaN·음수·소수면 확인 못 함 → UNVERIFIABLE', () => {
    for (const extra of [{}, { unknownActiveCount: null }, { unknownActiveCount: Number.NaN }, { unknownActiveCount: -1 }, { unknownActiveCount: 1.5 }]) {
      expect(run(withRegistry([], extra)).data.status, JSON.stringify(extra)).toBe(UNVERIFIABLE);
    }
  });

  it('유효한 기록이 있으면 unknownActiveCount가 1 이상이거나 없어도 STOP/CHECK 유지', () => {
    for (const extra of [{ unknownActiveCount: 2 }, { unknownActiveCount: null }, {}]) {
      expect(run(withRegistry([right(kind, false)], extra)).data.status).toBe(activeStatus);
    }
  });
});

describe('PART 3 가처분·경매개시결정·가등기 여러 규칙 동시 발생 (#345)', () => {
  const byIdOf = (f) => Object.fromEntries(assessRegistryRisks(f).data.map((x) => [x.ruleId, x.status]));

  it('규칙마다 따로 판정되고, 화면에서는 STOP > CHECK > UNVERIFIABLE > NO_FLAG 순서로 묶인다', () => {
    const f = withRegistry([
      right('PROVISIONAL_DISPOSITION', false),
      right('PROVISIONAL_REGISTRATION', false),
      right('AUCTION', null),
    ]);
    const r = assessRegistryRisks(f);
    expect(r.ok).toBe(true);
    const byId = byIdOf(f);
    expect(byId.PROVISIONAL_DISPOSITION_ACTIVE).toBe(STOP);
    expect(byId.PROVISIONAL_REGISTRATION_ACTIVE).toBe(CHECK);
    expect(byId.AUCTION_ACTIVE).toBe(UNVERIFIABLE);

    const groups = groupRiskResults(r.data);
    expect(STATUS_ORDER.filter((s) => groups[s].length > 0)).toEqual([STOP, CHECK, UNVERIFIABLE, NO_FLAG]);
  });

  it('다른 권리(압류)가 STOP이면 unknownActiveCount가 1 이상이어도 STOP 유지, 새 규칙만 UNVERIFIABLE', () => {
    const byId = byIdOf(withRegistry([right('SEIZURE', false)], { unknownActiveCount: 2 }));
    expect(byId.SEIZURE_ACTIVE).toBe(STOP);
    expect(byId.PROVISIONAL_DISPOSITION_ACTIVE).toBe(UNVERIFIABLE);
    expect(byId.AUCTION_ACTIVE).toBe(UNVERIFIABLE);
    expect(byId.PROVISIONAL_REGISTRATION_ACTIVE).toBe(UNVERIFIABLE);
  });

  it('기존 규칙(압류·신탁·근저당)은 unknownActiveCount와 상관없이 결과가 그대로다', () => {
    const a = byIdOf(withRegistry([right('MORTGAGE', false, 100000000)], { unknownActiveCount: 0 }));
    const b = byIdOf(withRegistry([right('MORTGAGE', false, 100000000)], { unknownActiveCount: 5 }));
    for (const id of ['TRUST_REGISTERED', 'SEIZURE_ACTIVE', 'MORTGAGE_EXISTS']) expect(b[id], id).toBe(a[id]);
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

  it('접수일이 계약일보다 늦으면 CHECK, 문구는 "계약일 뒤"로 따로 나온다', () => {
    const r = assessOwnershipTransfer(withDates('2025-08-01', '2025-07-10'));
    expect(r.data.status).toBe(CHECK);
    expect(r.data.explanation).toContain('after the contract date');
    expect(r.data.explanation).not.toContain('within');
  });

  it('접수일과 계약일이 같은 날이면 계약일 전 N개월 안으로 본다 (CHECK)', () => {
    const r = assessOwnershipTransfer(withDates('2025-07-10', '2025-07-10'));
    expect(r.data.status).toBe(CHECK);
    expect(r.data.explanation).toContain('within');
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
  it('Mock 입력으로 점검 결과 11개가 나오고, 근저당과 위험 특약은 CHECK다', () => {
    const r = assessRisks(fields(), mockPersonGroups);
    expect(r.ok).toBe(true);
    const byId = Object.fromEntries(r.data.map((x) => [x.ruleId, x.status]));
    expect(byId).toEqual({
      OWNER_MISMATCH: STOP,
      ACCOUNT_HOLDER_MISMATCH: UNVERIFIABLE,
      ADDRESS_MISMATCH: NO_FLAG,
      TRUST_REGISTERED: NO_FLAG,
      SEIZURE_ACTIVE: NO_FLAG,
      PROVISIONAL_DISPOSITION_ACTIVE: UNVERIFIABLE,
      AUCTION_ACTIVE: UNVERIFIABLE,
      PROVISIONAL_REGISTRATION_ACTIVE: UNVERIFIABLE,
      MORTGAGE_EXISTS: CHECK,
      RECENT_OWNERSHIP_CHANGE: UNVERIFIABLE,
      RISKY_SPECIAL_TERM: CHECK,
    });
  });

  it('rights가 null이면 신탁·압류·근저당 모두 UNVERIFIABLE (없음으로 나가지 않는다)', () => {
    const r = assessRegistryRisks(withRights(null));
    const byId = Object.fromEntries(r.data.map((x) => [x.ruleId, x.status]));
    expect(byId.TRUST_REGISTERED).toBe(UNVERIFIABLE);
    expect(byId.SEIZURE_ACTIVE).toBe(UNVERIFIABLE);
    expect(byId.MORTGAGE_EXISTS).toBe(UNVERIFIABLE);
    expect(byId.PROVISIONAL_DISPOSITION_ACTIVE).toBe(UNVERIFIABLE);
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

describe('PART 3 사진에서 읽지 못한 항목은 NO_FLAG가 아니라 UNVERIFIABLE (#275)', () => {
  it('계약서 주소(null)·갑구(소유자·이전일)·을구(rights)를 못 읽으면 해당 점검은 모두 UNVERIFIABLE', () => {
    const f = fields();
    f.contract.address = null; // PR #271: "주택 소재지"를 못 읽으면 집 주소를 비워 둔다
    f.registry.owners = null;
    f.registry.previousOwners = null;
    f.registry.lastTransferDate = null;
    f.registry.rights = null;
    const r = assessRisks(f, mockPersonGroups);
    expect(r.ok).toBe(true);
    const byId = Object.fromEntries(r.data.map((x) => [x.ruleId, x.status]));
    for (const ruleId of [
      'OWNER_MISMATCH',
      'ADDRESS_MISMATCH',
      'TRUST_REGISTERED',
      'SEIZURE_ACTIVE',
      'MORTGAGE_EXISTS',
      'RECENT_OWNERSHIP_CHANGE',
      'PROVISIONAL_DISPOSITION_ACTIVE',
      'AUCTION_ACTIVE',
      'PROVISIONAL_REGISTRATION_ACTIVE',
    ]) {
      expect(byId[ruleId], ruleId).toBe(UNVERIFIABLE);
    }
    expect(r.data.some((x) => x.ruleId === 'ADDRESS_MISMATCH' && x.status === STOP)).toBe(false);
  });
});
