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

  it('등기부 소유자가 null이거나 []이면 공동 소유 CHECK가 아니라 UNVERIFIABLE', () => {
    for (const owners of [null, []]) {
      const f = fields();
      f.registry.owners = owners;
      const r = compareOwnerAndLandlord(f, mergeOwnerAndLandlord(groups()));
      expect(r.data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    }
  });

  it('personGroups에서 사람을 찾지 못하면 UNVERIFIABLE', () => {
    expect(compareOwnerAndLandlord(fields(), []).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  describe('회사·신탁 (#175)', () => {
    const trustRight = { kind: 'TRUST', maxClaimAmount: null, cancelled: false, receivedAt: null };

    it('유효한 신탁이 있어도 소유자·임대인이 둘 다 사람 이름이고 다르면 STOP 유지 (#198 리뷰 2)', () => {
      // PART 2는 회사(수탁자) 이름을 소유자 명단에 넣지 않으므로, 명단의 사람은 보통 위탁자다.
      // 위탁자도 수탁자도 아닌 사람이 임대인이면 가장 강한 사기 신호라서 낮추지 않는다.
      const f = fields();
      f.registry.rights = [trustRight];
      const r = compareOwnerAndLandlord(f, groups());
      expect(r.ok).toBe(true);
      expect(r.data.status).toBe(RISK_STATUS.STOP);
    });

    it('유효한 신탁이 있고 비교를 못 했으면(소유자 null) NO_FLAG가 아니라 UNVERIFIABLE', () => {
      const f = fields();
      f.registry.rights = [trustRight];
      f.registry.owners = null;
      const r = compareOwnerAndLandlord(f, groups());
      expect(r.data.status).toBe(RISK_STATUS.UNVERIFIABLE);
      expect(r.data.explanation).toContain('company or a trust');
    });

    it('말소된 신탁은 회사·신탁으로 보지 않아 기존 판정(STOP) 그대로', () => {
      const f = fields();
      f.registry.rights = [{ ...trustRight, cancelled: true }];
      expect(compareOwnerAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.STOP);
    });

    it('임대인 이름이 회사 이름이고 소유자와 다르면 CHECK', () => {
      const f = fields();
      f.contract.landlords = [{ findingId: 'PII_L02', name: '가상주택리츠 주식회사', birthDate: null, role: 'LANDLORD' }];
      expect(compareOwnerAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.CHECK);
    });

    it('소유자 이름이 회사 이름이고 임대인을 못 읽었으면 UNVERIFIABLE', () => {
      const f = fields();
      f.registry.owners = [{ findingId: 'PII_R03', name: '(주)가상신탁', birthDate: null, role: 'OWNER' }];
      f.contract.landlords = null;
      expect(compareOwnerAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    });

    it('신탁이 있어도 소유자와 임대인이 같은 사람으로 확인되면 NO_FLAG 그대로', () => {
      const f = fields();
      f.registry.rights = [trustRight];
      expect(compareOwnerAndLandlord(f, mergeOwnerAndLandlord(groups())).data.status).toBe(RISK_STATUS.NO_FLAG);
    });

    it('문구에는 실제 이름을 넣지 않고, 근거 칸에만 화면용 값을 보여 준다', () => {
      const f = fields();
      f.contract.landlords = [{ findingId: 'PII_L02', name: '가상주택리츠 주식회사', birthDate: null, role: 'LANDLORD' }];
      const r = compareOwnerAndLandlord(f, groups());
      expect(r.data.explanation).not.toContain('김철수');
      expect(r.data.evidence.left.value).toContain('김철수');
    });
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

  it('같은 형식(지번)에서 호수가 다르면 STOP, 같으면 NO_FLAG', () => {
    const f = fields();
    f.registry.address = '서울특별시 중구 필동 123-4, 101호';
    f.contract.address = '서울특별시 중구 필동 123-4, 102호';
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.STOP);
    f.contract.address = '서울특별시 중구 필동 123-4, 101호';
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.NO_FLAG);
  });

  it('한쪽이 정식 시·도 이름으로 시작하지 않으면 STOP이 아니라 UNVERIFIABLE', () => {
    const f = fields();
    f.contract.address = '서울 중구 필동로 00, 102호';
    const r = compareAddresses(f);
    expect(r.data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    expect(r.data.explanation).toContain('full city or province name');
  });

  it('양쪽 다 줄임말이면 글자가 같아도 비교하지 않는다', () => {
    const f = fields();
    f.registry.address = '서울 중구 필동로 00, 101호';
    f.contract.address = '서울 중구 필동로 00, 101호';
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('시·도 이름으로 시작하는 다른 단어("서울대로")는 시·도 이름으로 보지 않는다', () => {
    const f = fields();
    f.contract.address = '서울대로 00, 101호';
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('도로명 주소와 지번 주소가 섞여 있으면 STOP이 아니라 UNVERIFIABLE', () => {
    const f = fields();
    f.contract.address = '서울특별시 중구 필동 123-4, 101호';
    const r = compareAddresses(f);
    expect(r.data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    expect(r.data.explanation).toContain('different styles');
  });

  it('형식을 알 수 없고 글자가 다르면 UNVERIFIABLE', () => {
    const f = fields();
    f.registry.address = '서울특별시 중구';
    f.contract.address = '서울특별시 종로구';
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('괄호 안 지번은 형식 판정에 쓰지 않는다 (도로명 주소로 본다)', () => {
    const f = fields();
    f.registry.address = '서울특별시 중구 필동로 45 필동빌라(필동 123-4) 제201호';
    f.contract.address = '서울특별시 중구 필동로 45 필동빌라 제202호';
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

  describe('호수 앞의 층 정리 (#141, #143)', () => {
    const REGISTRY = '서울특별시 중구 가상로 12, 가상아파트 제3동 제7층 제702호'; // dense 등기부 맨 위 주소

    it('등기부 "제7층 제702호" ↔ 계약서 "3동 702호"는 같은 주소 (NO_FLAG)', () => {
      const f = fields();
      f.registry.address = REGISTRY;
      f.contract.address = '서울특별시 중구 가상로 12, 가상아파트 3동 702호';
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.NO_FLAG);
    });

    it('반대로 계약서에 층이 있고 등기부에 없어도 같다', () => {
      const f = fields();
      f.registry.address = '서울특별시 중구 가상로 12, 가상아파트 3동 702호';
      f.contract.address = REGISTRY;
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.NO_FLAG);
    });

    it('층이 호수 앞자리와 맞지 않으면 층을 빼지 않는다 (7층 ↔ 802호)', () => {
      const f = fields();
      f.registry.address = '서울특별시 중구 가상로 12, 가상아파트 제3동 제7층 제802호';
      f.contract.address = '서울특별시 중구 가상로 12, 가상아파트 3동 802호';
      expect(normalizeAddress(f.registry.address)).toContain('7층');
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.STOP);
    });

    it('층을 빼도 호수·동이 다르면 STOP', () => {
      const f = fields();
      f.registry.address = REGISTRY;
      f.contract.address = '서울특별시 중구 가상로 12, 가상아파트 3동 703호';
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.STOP);
      f.contract.address = '서울특별시 중구 가상로 12, 가상아파트 4동 702호';
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.STOP);
    });

    it('호수가 없으면 층을 빼지 않는다', () => {
      expect(normalizeAddress('서울특별시 중구 가상로 12 제7층')).toBe('서울특별시중구가상로127층');
    });

    it('지하 층, "비01호"는 층 제거 대상이 아니다', () => {
      expect(normalizeAddress('서울특별시 중구 가상로 12 지하1층 제101호')).toBe('서울특별시중구가상로12지하1층101호');
      expect(normalizeAddress('서울특별시 중구 가상로 12 지하 1층 101호')).toBe('서울특별시중구가상로12지하1층101호');
      expect(normalizeAddress('서울특별시 중구 가상로 12 비01호')).toBe('서울특별시중구가상로12비01호');
    });

    it('도로 번호 뒤의 층도 바르게 뺀다 ("가상로 12 1층 101호", "12층 1202호")', () => {
      expect(normalizeAddress('서울특별시 중구 가상로 12 1층 101호')).toBe('서울특별시중구가상로12101호');
      expect(normalizeAddress('서울특별시 중구 가상로 12 12층 1202호')).toBe('서울특별시중구가상로121202호');
    });
  });

describe('PART 3 assessRisks() 연결', () => {
  it('Mock 입력으로 비교 규칙 3개가 STOP / UNVERIFIABLE / NO_FLAG로 나온다', () => {
    const r = assessRisks(fields(), groups());
    expect(r.ok).toBe(true);
    const byId = Object.fromEntries(r.data.map((x) => [x.ruleId, x.status]));
    expect(byId).toMatchObject({
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
            legend: { '[Owner_A]': 'owner on the register', '[Landlord_B]': 'landlord on the contract' },
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


/** 공동 소유 상황: 소유자를 한 명 더 추가한다 (P5, 이영희) */
function addSecondOwner(f, list) {
  f.registry.owners.push({ findingId: 'PII_R99', name: '이영희', birthDate: '790202', role: 'OWNER' });
  list.push({ personId: 'P5', alias: '[Owner_E]', roles: ['OWNER'], findingIds: ['PII_R99'], status: 'CONFIRMED' });
}

describe('PART 3 공동 소유 (OWNER_MISMATCH, CHECK.co_owner)', () => {
  it('소유자 2명 중 1명만 임대인이면 CHECK (다른 소유자의 동의 필요)', () => {
    const f = fields();
    const g = mergeOwnerAndLandlord(groups()); // 김철수가 소유자이자 임대인
    addSecondOwner(f, g);
    const r = compareOwnerAndLandlord(f, g);
    expect(r.data.status).toBe(RISK_STATUS.CHECK);
    expect(r.data.explanation).toContain('[Owner_A]');
    expect(r.data.explanation).toContain('[Owner_E]');
    expect(r.data.explanation).toContain('other owners');
    expect(r.data.explanation).not.toContain('이영희');
  });

  it('소유자 2명이 모두 임대인으로 서명하면 NO_FLAG', () => {
    const f = fields();
    const g = mergeOwnerAndLandlord(groups());
    addSecondOwner(f, g);
    f.contract.landlords.push({ findingId: 'PII_L99', name: '이영희', birthDate: '790202', role: 'LANDLORD' });
    const second = g.find((x) => x.personId === 'P5');
    second.roles.push('LANDLORD');
    second.findingIds.push('PII_L99');
    expect(compareOwnerAndLandlord(f, g).data.status).toBe(RISK_STATUS.NO_FLAG);
  });

  it('공동 소유인데 임대인이 소유자가 아니면 STOP', () => {
    const f = fields();
    const g = groups(); // 임대인(P2)은 소유자(P1)와 다른 사람
    addSecondOwner(f, g);
    expect(compareOwnerAndLandlord(f, g).data.status).toBe(RISK_STATUS.STOP);
  });

  it('공동 소유자 중 한 명이 AMBIGUOUS면 UNVERIFIABLE', () => {
    const f = fields();
    const g = mergeOwnerAndLandlord(groups());
    addSecondOwner(f, g);
    g.find((x) => x.personId === 'P5').status = 'AMBIGUOUS';
    expect(compareOwnerAndLandlord(f, g).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('소유자가 1명이면 NO_FLAG 그대로', () => {
    expect(compareOwnerAndLandlord(fields(), mergeOwnerAndLandlord(groups())).data.status).toBe(
      RISK_STATUS.NO_FLAG,
    );
  });

  it('임대인이 2명이어도 예금주가 그중 한 명이면 NO_FLAG (공동 소유 CHECK는 소유자 비교에만 쓴다)', () => {
    const f = fields();
    const g = confirmAccountHolderIsLandlord(groups());
    f.contract.landlords.push({ findingId: 'PII_L98', name: '이영희', birthDate: '790202', role: 'LANDLORD' });
    g.push({ personId: 'P6', alias: '[Landlord_F]', roles: ['LANDLORD'], findingIds: ['PII_L98'], status: 'CONFIRMED' });
    expect(compareAccountHolderAndLandlord(f, g).data.status).toBe(RISK_STATUS.NO_FLAG);
  });
});

describe('PART 3 카드 제목은 상태와 상관없이 중립적이다', () => {
  it('"일치하지 않음", "등록됨" 같은 결과를 단정하는 말이 제목에 없다', () => {
    const r = assessRisks(fields(), groups());
    expect(r.ok).toBe(true);
    expect(r.data.length).toBe(8);
    for (const risk of r.data) {
      expect(risk.title).not.toContain('not');
      expect(risk.title).not.toContain('mismatch');
      expect(risk.title).not.toContain('registered');
      expect(risk.title).not.toContain('changed');
      expect(risk.title).not.toContain('Active');
    }
  });

  it('제목 8개가 모두 다르다', () => {
    const r = assessRisks(fields(), groups());
    expect(new Set(r.data.map((x) => x.title)).size).toBe(8);
  });
});

describe('지번 등기부 ↔ 도로명 계약서 (#177)', () => {
  const LOT_REGISTRY = '서울특별시 성동구 가상동 246-8 가상타운 제3층 제301호';
  const ROAD = '서울특별시 성동구 가상로 00';
  const CONTRACT = '서울특별시 성동구 가상로 00, 3층 (가상동, 가상타운) 301호';

  /** 지번 등기부 + 도로명 계약서 기본 쌍. over로 등기부·계약서 값을 바꾼다 */
  const withRoad = (over = {}) => {
    const f = fields();
    f.registry.address = LOT_REGISTRY;
    f.registry.roadAddress = ROAD;
    f.contract.address = CONTRACT;
    Object.assign(f.registry, over.registry);
    Object.assign(f.contract, over.contract);
    return f;
  };

  it('등기부 [도로명주소]와 호수가 계약서와 같으면 NO_FLAG', () => {
    expect(compareAddresses(withRoad()).data.status).toBe(RISK_STATUS.NO_FLAG);
  });

  it('계약서에 건물 이름이 괄호 밖에 있어도 같은 집이면 NO_FLAG', () => {
    const f = withRoad({ contract: { address: '서울특별시 성동구 가상로 00 가상타운 301호' } });
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.NO_FLAG);
  });

  it('도로명이 다르면 STOP', () => {
    const f = withRoad({ contract: { address: '서울특별시 성동구 다른로 00, 3층 301호' } });
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.STOP);
  });

  it('도로 번호가 다르면 STOP (00 ↔ 000)', () => {
    const f = withRoad({ contract: { address: '서울특별시 성동구 가상로 000, 3층 301호' } });
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.STOP);
  });

  it('호수가 다르면 STOP', () => {
    const f = withRoad({ contract: { address: '서울특별시 성동구 가상로 00, 3층 302호' } });
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.STOP);
  });

  it('동이 붙은 호수는 동까지 맞아야 한다 (3동702호 ↔ 13동702호)', () => {
    const base = {
      registry: {
        address: '서울특별시 중구 가상동 12 가상아파트 제3동 제7층 제702호',
        roadAddress: '서울특별시 중구 가상로 12',
      },
    };
    const same = withRoad({ ...base, contract: { address: '서울특별시 중구 가상로 12, 가상아파트 3동 702호' } });
    expect(compareAddresses(same).data.status).toBe(RISK_STATUS.NO_FLAG);
    const other = withRoad({ ...base, contract: { address: '서울특별시 중구 가상로 12, 가상아파트 13동 702호' } });
    expect(compareAddresses(other).data.status).toBe(RISK_STATUS.STOP);
  });

  it('등기부에 [도로명주소]가 없으면(null) 기존처럼 UNVERIFIABLE', () => {
    const f = withRoad({ registry: { roadAddress: null } });
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    delete f.registry.roadAddress;
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('[도로명주소]가 정식 시·도 이름으로 시작하지 않으면 UNVERIFIABLE', () => {
    const f = withRoad({ registry: { roadAddress: '서울 성동구 가상로 00' } });
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('호수를 알 수 없으면 건물 전체가 같을 때만 NO_FLAG, 다르면 STOP이 아니라 UNVERIFIABLE', () => {
    const f = withRoad({ registry: { address: '서울특별시 성동구 가상동 246-8' } });
    f.contract.address = '서울특별시 성동구 가상로 00';
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.NO_FLAG);
    f.contract.address = '서울특별시 성동구 가상로 00 가상타운';
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('지번끼리 같으면 [도로명주소]와 상관없이 NO_FLAG (기존 동작)', () => {
    const f = withRoad({ contract: { address: '서울특별시 성동구 가상동 246-8 가상타운 301호' } });
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.NO_FLAG);
  });

  it('등기부가 도로명이고 계약서가 지번이면 기존처럼 UNVERIFIABLE', () => {
    const f = fields();
    f.registry.address = '서울특별시 성동구 가상로 00, 301호';
    f.contract.address = LOT_REGISTRY;
    expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  describe('계약서 호수 표기가 달라도 같은 집이면 NO_FLAG (#202 리뷰)', () => {
    // 등기부 호수: "301호". 계약서는 건물 이름·방 정보가 호수 앞뒤에 붙어도 된다.
    it.each([
      ['방 한 칸 계약 (301호 중 방 1칸)', '서울특별시 성동구 가상로 00, 301호 중 방 1칸'],
      ['301호 일부', '서울특별시 성동구 가상로 00 301호 일부'],
      ['건물 이름이 호수 뒤 (301호 가상타운)', '서울특별시 성동구 가상로 00, 301호 가상타운'],
    ])('%s', (_name, address) => {
      expect(compareAddresses(withRoad({ contract: { address } })).data.status).toBe(RISK_STATUS.NO_FLAG);
    });

    it('계약서에 호수가 없으면 STOP이 아니라 UNVERIFIABLE', () => {
      const f = withRoad({ contract: { address: '서울특별시 성동구 가상로 00' } });
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    });

    it('계약서에 다른 호수만 분명히 적혀 있으면 STOP (호수가 뒤에 있어도)', () => {
      const f = withRoad({ contract: { address: '서울특별시 성동구 가상로 00, 302호 중 방 1칸' } });
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.STOP);
    });

    it('호수 앞뒤에 숫자가 이어지면 다른 호수다 (301호 ↔ 1301호)', () => {
      const f = withRoad({ contract: { address: '서울특별시 성동구 가상로 00, 1301호' } });
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.STOP);
    });

    it('"2호선" 같은 낱말은 호수로 보지 않는다', () => {
      const f = withRoad({ contract: { address: '서울특별시 성동구 가상로 00, 301호 (2호선 가상역 근처)' } });
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.NO_FLAG);
      const noUnit = withRoad({ contract: { address: '서울특별시 성동구 가상로 00 2호선 가상역 근처' } });
      expect(compareAddresses(noUnit).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    });

    it('지번 번지(246-8)를 호수로 읽지 않는다', () => {
      const f = withRoad({ contract: { address: '서울특별시 성동구 가상로 00, 가상동 246-8, 301호' } });
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.NO_FLAG);
    });
  });

  describe('동이 있는 등기부 호수 (등기부: 103동 7층 702호)', () => {
    const dongRegistry = {
      registry: {
        address: '서울특별시 성동구 가상동 12 가상아파트 제103동 제7층 제702호',
        roadAddress: '서울특별시 성동구 가상로 12',
      },
    };
    const run = (address) => compareAddresses(withRoad({ ...dongRegistry, contract: { address } })).data.status;

    it('"103-702"는 103동 702호로 맞춰 비교해 NO_FLAG', () => {
      expect(run('서울특별시 성동구 가상로 12, 103-702')).toBe(RISK_STATUS.NO_FLAG);
    });

    it('"103-703"은 다른 호수라 STOP', () => {
      expect(run('서울특별시 성동구 가상로 12, 103-703')).toBe(RISK_STATUS.STOP);
    });

    it('동이 빠진 "702호"는 다른 동의 702호일 수 있어서 UNVERIFIABLE', () => {
      expect(run('서울특별시 성동구 가상로 12, 702호')).toBe(RISK_STATUS.UNVERIFIABLE);
    });

    it('동이 다르면 호수가 같아도 STOP (103동702호 ↔ 13동702호, 3동702호)', () => {
      expect(run('서울특별시 성동구 가상로 12, 가상아파트 13동 702호')).toBe(RISK_STATUS.STOP);
      expect(run('서울특별시 성동구 가상로 12, 가상아파트 3동 702호')).toBe(RISK_STATUS.STOP);
    });

    it('동·호수가 같으면 건물 이름이 앞뒤에 있어도 NO_FLAG', () => {
      expect(run('서울특별시 성동구 가상로 12, 가상아파트 103동 702호 중 방 1칸')).toBe(RISK_STATUS.NO_FLAG);
    });

    it('계약서에 동만 있고 등기부에 동이 없으면 UNVERIFIABLE', () => {
      const f = withRoad({ contract: { address: '서울특별시 성동구 가상로 00, 가상타운 3동 301호' } });
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    });
  });

  describe('동이 글자인 경우 (가동/나동, A동/B동) (#202 리뷰)', () => {
    const letterRegistry = (dong) => ({
      registry: {
        address: `서울특별시 성동구 가상동 12 가상빌라 ${dong} 제101호`,
        roadAddress: '서울특별시 성동구 가상로 12',
      },
    });
    const run = (dong, address) =>
      compareAddresses(withRoad({ ...letterRegistry(dong), contract: { address } })).data.status;

    it('등기부 가동 ↔ 계약서 나동이면 STOP', () => {
      expect(run('가동', '서울특별시 성동구 가상로 12, 나동 101호')).toBe(RISK_STATUS.STOP);
    });

    it('등기부 A동 ↔ 계약서 B동이면 STOP', () => {
      expect(run('A동', '서울특별시 성동구 가상로 12, B동 101호')).toBe(RISK_STATUS.STOP);
    });

    it('등기부에 가동이 있는데 계약서에 동이 없으면 UNVERIFIABLE (숫자 동과 같은 규칙)', () => {
      expect(run('가동', '서울특별시 성동구 가상로 12, 101호')).toBe(RISK_STATUS.UNVERIFIABLE);
    });

    it('동·호수가 같으면 건물 이름이 앞뒤에 있어도 NO_FLAG', () => {
      expect(run('가동', '서울특별시 성동구 가상로 12, 가상빌라 가동 101호')).toBe(RISK_STATUS.NO_FLAG);
      expect(run('가동', '서울특별시 성동구 가상로 12, 가동101호 중 방 1칸')).toBe(RISK_STATUS.NO_FLAG);
      expect(run('A동', '서울특별시 성동구 가상로 12, 가상빌라 A동 101호 일부')).toBe(RISK_STATUS.NO_FLAG);
    });

    it('영문 동은 대문자·소문자 차이를 무시한다 (a동 ↔ A동)', () => {
      expect(run('A동', '서울특별시 성동구 가상로 12, a동 101호')).toBe(RISK_STATUS.NO_FLAG);
    });

    it('동은 같아도 호수가 다르면 STOP', () => {
      expect(run('가동', '서울특별시 성동구 가상로 12, 가동 102호')).toBe(RISK_STATUS.STOP);
    });

    it('계약서에만 글자 동이 있고 등기부에 동이 없으면 UNVERIFIABLE', () => {
      const f = withRoad({
        registry: { address: '서울특별시 성동구 가상동 12 가상빌라 제101호', roadAddress: '서울특별시 성동구 가상로 12' },
        contract: { address: '서울특별시 성동구 가상로 12, 가동 101호' },
      });
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    });

    it('숫자 동과 글자 동이 섞이면 다른 동으로 본다 (103동 ↔ 가동)', () => {
      expect(run('103동', '서울특별시 성동구 가상로 12, 가동 101호')).toBe(RISK_STATUS.STOP);
    });

    it('행정동 이름(가상동)의 끝 글자를 건물 동으로 읽지 않는다', () => {
      const f = withRoad({
        registry: { address: '서울특별시 성동구 가상동 12 가상빌라 제101호', roadAddress: '서울특별시 성동구 가상로 12' },
        contract: { address: '서울특별시 성동구 가상로 12 가상동 101호' },
      });
      expect(compareAddresses(f).data.status).toBe(RISK_STATUS.NO_FLAG);
    });
  });
});

describe('PART 3 법인 임대인 (#250)', () => {
  const holder = { findingId: 'PII_L08', name: '최가상', birthDate: null, role: 'ACCOUNT_HOLDER' };
  const companyContract = () => {
    const f = fields();
    f.contract.landlords = [];
    f.contract.landlordCompanies = ['주식회사가상리츠'];
    f.contract.accountHolders = [holder];
    return f;
  };

    it('법인 임차인(사택) + 개인 임대인 + 예금주가 임대인 본인이면 CHECK가 아니다 (#250 리뷰)', () => {
    const f = fields();
    f.contract.landlords = [{ findingId: 'PII_L02', name: '김가상', birthDate: '800101', role: 'LANDLORD' }];
    f.contract.landlordCompanies = ['주식회사사택법인']; // 임차인 칸의 회사
    f.contract.accountHolders = [{ findingId: 'PII_L08', name: '김가상', birthDate: '800101', role: 'ACCOUNT_HOLDER' }];
    const r = compareAccountHolderAndLandlord(f, groups());
    expect(r.data.status).not.toBe(RISK_STATUS.CHECK);
    expect(r.data.explanation).not.toContain('landlord on this contract is a company');
  });

  it('② 카드: 사람 임대인이 있으면 임차인 칸 회사를 Contract landlord 칸에 보이지 않는다', () => {
    const f = fields();
    f.contract.landlordCompanies = ['주식회사사택법인'];
    const r = compareOwnerAndLandlord(f, groups());
    expect(r.data.evidence.right.value).not.toContain('주식회사사택법인');
  });

  it('법인 임대인 + 개인 예금주 → CHECK, 문구에 이름·법인명이 없다', () => {
    const r = compareAccountHolderAndLandlord(companyContract(), groups());
    expect(r.data.status).toBe(RISK_STATUS.CHECK);
    expect(r.data.action).toContain("company's own name");
    expect(`${r.data.explanation} ${r.data.action}`).not.toMatch(/최가상|주식회사가상리츠/);
    expect(r.data.evidence.right.value).toBe('주식회사가상리츠'); // 화면 전용
  });

  it('법인명 필드 없이 임대인 이름이 회사 이름이어도 CHECK', () => {
    const f = companyContract();
    delete f.contract.landlordCompanies;
    f.contract.landlords = [{ findingId: 'PII_L02', name: '가상주택리츠 주식회사', birthDate: null, role: 'LANDLORD' }];
    expect(compareAccountHolderAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.CHECK);
  });

  it('법인 임대인이라도 예금주 정보가 없으면(null, []) UNVERIFIABLE', () => {
    for (const none of [null, []]) {
      const f = companyContract();
      f.contract.accountHolders = none;
      expect(compareAccountHolderAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    }
  });

  it('예금주도 회사 이름이면 CHECK로 바꾸지 않는다', () => {
    const f = companyContract();
    f.contract.accountHolders = [{ ...holder, name: '가상리츠 주식회사' }];
    expect(compareAccountHolderAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('개인 임대인 + 개인 예금주는 기존 동작 (다른 사람으로 확정되면 STOP)', () => {
    const g = groups();
    g.find((x) => x.personId === 'P4').status = 'CONFIRMED';
    expect(compareAccountHolderAndLandlord(fields(), g).data.status).toBe(RISK_STATUS.STOP);
  });

  it('② 카드: 법인명은 근거 칸에만 보이고 판정은 그대로', () => {
    const f = fields();
    f.registry.owners = [];
    f.registry.ownerCompanies = ['가상신탁 주식회사'];
    f.contract.landlords = [];
    f.contract.landlordCompanies = ['주식회사가상리츠'];
    const r = compareOwnerAndLandlord(f, groups());
    expect(r.data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    expect(r.data.evidence.left.value).toBe('가상신탁 주식회사');
    expect(r.data.evidence.right.value).toBe('주식회사가상리츠');
  });
});

describe('PART 3 OCR이 불확실한 이름은 STOP 대신 UNVERIFIABLE (#275)', () => {
  /** 소유자는 "홍길동", 임대인 이름만 바꿔서 비교한다 (사진에서 "홍길동"을 "BUS"로 읽은 실제 사례) */
  const withLandlordName = (name, extra = {}) => {
    const f = fields();
    f.registry.owners[0].name = '홍길동';
    Object.assign(f.contract.landlords[0], { name, ...extra });
    return f;
  };
  const confirmedHolderGroups = () => {
    const g = groups();
    g.find((x) => x.personId === 'P4').status = 'CONFIRMED';
    return g;
  };

  it('사진(OCR)의 "BUS" vs "홍길동"은 STOP이 아니라 UNVERIFIABLE이고, 설명에 이름이 없다', () => {
    const r = compareOwnerAndLandlord(withLandlordName('BUS', { confidence: 0.9 }), groups());
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    expect(r.data.explanation).toContain('read incorrectly');
    expect(r.data.action.length).toBeGreaterThan(0);
    const text = [r.data.title, r.data.explanation, r.data.action].join(' ');
    for (const secret of ['BUS', '홍길동']) expect(text).not.toContain(secret);
  });

  it('사진(OCR)에서 한글이 섞이거나 숫자가 붙은 이름도 한글 이름 모양이 아니라서 UNVERIFIABLE', () => {
    for (const name of ['홍길동1', '홍AB', '홍', '홍길동길동이']) {
      const f = withLandlordName(name, { confidence: 0.9 });
      expect(compareOwnerAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    }
  });

  it('사진(OCR)에서 소유자 쪽 이름이 깨졌어도 UNVERIFIABLE', () => {
    const f = fields();
    f.registry.owners[0].name = 'AdET';
    f.registry.owners[0].confidence = 0.9;
    expect(compareOwnerAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('신뢰도가 기준(0.8)보다 낮으면 한글 이름이어도 UNVERIFIABLE', () => {
    expect(compareOwnerAndLandlord(withLandlordName('김철수', { confidence: 0.5 }), groups()).data.status).toBe(
      RISK_STATUS.UNVERIFIABLE,
    );
  });

  it('신뢰도가 null인 글자 PDF나 신뢰도가 충분한 한글 이름은 기존대로 STOP', () => {
    for (const extra of [{ confidence: null }, { confidence: 0.95 }, { confidence: 0.8 }, {}]) {
      expect(compareOwnerAndLandlord(withLandlordName('김철수', extra), groups()).data.status).toBe(RISK_STATUS.STOP);
    }
  });

  it('정상적인 한글 이름이 서로 다르면 기존대로 STOP (공백이 낀 이름, 네 글자 이름 포함)', () => {
    for (const name of ['김철수', '홍 길 동', '남궁민수']) {
      const f = withLandlordName(name);
      if (name.replace(/\s/g, '') === '홍길동') f.registry.owners[0].name = '이영희';
      expect(compareOwnerAndLandlord(f, groups()).data.status).toBe(RISK_STATUS.STOP);
    }
  });

  it('같은 사람으로 확인된 경우(NO_FLAG)는 이름이 어떻든 바뀌지 않는다', () => {
    const f = withLandlordName('BUS');
    expect(compareOwnerAndLandlord(f, mergeOwnerAndLandlord(groups())).data.status).toBe(RISK_STATUS.NO_FLAG);
  });

  it('예금주 이름이 깨졌거나 신뢰도가 낮으면 UNVERIFIABLE, 정상 한글 이름이면 STOP', () => {
    const run = (extra) => {
      const f = fields();
      Object.assign(f.contract.accountHolders[0], extra);
      return compareAccountHolderAndLandlord(f, confirmedHolderGroups());
    };
    expect(run({}).data.status).toBe(RISK_STATUS.STOP);
    expect(run({ name: 'AdET', confidence: 0.9 }).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    expect(run({ confidence: 0.3 }).data.status).toBe(RISK_STATUS.UNVERIFIABLE);
    expect(run({ name: 'AdET', confidence: 0.9 }).data.explanation).toContain('read incorrectly');
  });
});

describe('PART 3 이름 모양 검사는 OCR 이름(confidence가 숫자)에만 (#312)', () => {
  const withLandlordName = (name, extra = {}) => {
    const f = fields();
    f.registry.owners[0].name = '홍길동';
    Object.assign(f.contract.landlords[0], { name, ...extra });
    return f;
  };
  const status = (f) => compareOwnerAndLandlord(f, groups()).data.status;

  it('글자 PDF(confidence가 null이거나 없음)의 영문 이름 임대인이 진짜 다른 사람이면 STOP', () => {
    for (const extra of [{ confidence: null }, {}]) {
      expect(status(withLandlordName('John Smith', extra))).toBe(RISK_STATUS.STOP);
    }
  });

  it('같은 영문 이름이어도 OCR(confidence가 숫자)이면 UNVERIFIABLE', () => {
    expect(status(withLandlordName('John Smith', { confidence: 0.95 }))).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('글자 PDF의 영문 소유자도 STOP (소유자 쪽)', () => {
    const f = fields();
    f.registry.owners[0].name = 'John Smith';
    f.registry.owners[0].confidence = null;
    expect(status(f)).toBe(RISK_STATUS.STOP);
  });

  it('5자 한글 이름: 글자 PDF는 STOP, OCR은 UNVERIFIABLE', () => {
    expect(status(withLandlordName('남궁가나다'))).toBe(RISK_STATUS.STOP);
    expect(status(withLandlordName('남궁가나다', { confidence: 0.9 }))).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('신뢰도가 낮으면 이름 모양과 상관없이 UNVERIFIABLE (기존 동작)', () => {
    expect(status(withLandlordName('김철수', { confidence: 0.5 }))).toBe(RISK_STATUS.UNVERIFIABLE);
  });
});

describe('PART 3 사진 서류의 주소 숫자 차이는 STOP 대신 CHECK (#312)', () => {
  const LOT_REGISTRY = '서울특별시 가상구 가상동 212-5 가상빌라 제203호';
  const ROAD = '서울특별시 가상구 가상로 45';

  /** photo: true면 계약서 임대인에 OCR 신뢰도(숫자)를 넣어 사진 서류로 만든다 */
  const addressFields = (registryAddress, contractAddress, { photo = false, road = null, registry = {}, contract = {} } = {}) => {
    const f = fields();
    f.registry.address = registryAddress;
    f.registry.roadAddress = road;
    f.contract.address = contractAddress;
    Object.assign(f.registry, registry);
    Object.assign(f.contract, contract);
    if (photo) f.contract.landlords[0].confidence = 0.9;
    return f;
  };
  const status = (f) => compareAddresses(f).data.status;

  it('사진 서류에서 번지·호수 숫자만 다르면(212-5 ↔ 210-5, 203호 ↔ 208호) CHECK', () => {
    const f = addressFields(LOT_REGISTRY, '서울특별시 가상구 가상동 210-5 가상빌라 208호', { photo: true });
    const r = compareAddresses(f);
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe(RISK_STATUS.CHECK);
    expect(r.data.explanation).toContain('read incorrectly');
    expect(r.data.action.length).toBeGreaterThan(0);
  });

  it('같은 주소인데 글자 PDF끼리면 숫자만 달라도 STOP', () => {
    const f = addressFields(LOT_REGISTRY, '서울특별시 가상구 가상동 210-5 가상빌라 208호');
    expect(status(f)).toBe(RISK_STATUS.STOP);
  });

  it('사진 서류라도 동 이름·건물 이름이 다르면 STOP', () => {
    const otherDong = addressFields(LOT_REGISTRY, '서울특별시 가상구 나상동 212-5 가상빌라 203호', { photo: true });
    const otherBuilding = addressFields(LOT_REGISTRY, '서울특별시 가상구 가상동 212-5 나상빌라 203호', { photo: true });
    expect(status(otherDong)).toBe(RISK_STATUS.STOP);
    expect(status(otherBuilding)).toBe(RISK_STATUS.STOP);
  });

  it('서류의 sourceType이 있으면 그것을 따른다 (image_pdf면 사진, text_pdf면 글자 PDF)', () => {
    const different = '서울특별시 가상구 가상동 210-5 가상빌라 208호';
    expect(status(addressFields(LOT_REGISTRY, different, { contract: { sourceType: 'image_pdf' } }))).toBe(RISK_STATUS.CHECK);
    expect(status(addressFields(LOT_REGISTRY, different, { registry: { sourceType: 'image' } }))).toBe(RISK_STATUS.CHECK);
    expect(
      status(
        addressFields(LOT_REGISTRY, different, {
          photo: true,
          registry: { sourceType: 'text_pdf' },
          contract: { sourceType: 'text_pdf' },
        }),
      ),
    ).toBe(RISK_STATUS.STOP);
  });

  it('주소가 같으면 NO_FLAG, 못 읽었으면 UNVERIFIABLE (기존 동작)', () => {
    expect(status(addressFields(LOT_REGISTRY, '서울특별시 가상구 가상동 212-5 가상빌라 203호', { photo: true }))).toBe(
      RISK_STATUS.NO_FLAG,
    );
    expect(status(addressFields(LOT_REGISTRY, null, { photo: true }))).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  // #343: 가짜세트4 사진 (등기부는 정상, 계약서 OCR이 "212-5"를 "2125", "제203호"를 "Hams"로 읽음)
  const REG_203 = '서울특별시 동대문구 가상동 212-5 가상스테이 제2층 제203호';
  const GARBLED = '서울특별시 동대문구 가상동 2125 가상스테이 제2층 Hams';

  it('가짜세트4: 동·호수가 깨져 읽히면 STOP이 아니라 CHECK이고, 원본 확인 안내가 나온다', () => {
    const r = compareAddresses(addressFields(REG_203, GARBLED, { photo: true }));
    expect(r.data.status).toBe(RISK_STATUS.CHECK);
    expect(r.data.explanation).toContain('read incorrectly');
    expect(r.data.action).toContain('original');
  });

  it('영문만 섞였거나, 호수가 통째로 빠져도 CHECK', () => {
    expect(status(addressFields(REG_203, '서울특별시 동대문구 가상동 2l2-5 가상스테이 제2층 203호', { photo: true }))).toBe(RISK_STATUS.CHECK);
    expect(status(addressFields(REG_203, '서울특별시 동대문구 가상동 212-5 가상스테이', { photo: true }))).toBe(RISK_STATUS.CHECK);
  });

  it('등기부가 사진이고 계약서가 글자 PDF여도 CHECK', () => {
    const f = addressFields(GARBLED, '서울특별시 동대문구 가상동 212-5 가상스테이 203호', {
      registry: { sourceType: 'image' },
      contract: { sourceType: 'text_pdf' },
    });
    expect(status(f)).toBe(RISK_STATUS.CHECK);
  });

  it('글자 PDF끼리면 같은 문장이어도 STOP', () => {
    const f = addressFields(REG_203, GARBLED, { registry: { sourceType: 'text_pdf' }, contract: { sourceType: 'text_pdf' } });
    expect(status(f)).toBe(RISK_STATUS.STOP);
  });

  it('사진이라도 읽힌 한글이 다르면(다른 동·건물) 깨짐이 있어도 STOP', () => {
    expect(status(addressFields(REG_203, '서울특별시 동대문구 나상동 212-5 가상스테이', { photo: true }))).toBe(RISK_STATUS.STOP);
    expect(status(addressFields(REG_203, '서울특별시 동대문구 가상동 212-5 나상스테이 Hams', { photo: true }))).toBe(RISK_STATUS.STOP);
  });

  it('영문 동 이름(A동 ↔ B동)은 양쪽에 영문이 있어서 깨짐으로 보지 않고 STOP', () => {
    const f = addressFields('서울특별시 동대문구 가상동 212-5 A동 101호', '서울특별시 동대문구 가상동 212-5 B동 101호', { photo: true });
    expect(status(f)).toBe(RISK_STATUS.STOP);
  });

  it('호수 숫자만 다르면 사진은 기존대로 CHECK(ocr_digits), 글자 PDF는 STOP', () => {
    const different = '서울특별시 동대문구 가상동 212-5 가상스테이 제2층 208호';
    expect(status(addressFields(REG_203, different, { photo: true }))).toBe(RISK_STATUS.CHECK);
    expect(status(addressFields(REG_203, different))).toBe(RISK_STATUS.STOP);
  });

  describe('지번 등기부 ↔ 도로명 계약서', () => {
    const road = (contractAddress, opts = {}) => addressFields(LOT_REGISTRY, contractAddress, { road: ROAD, ...opts });

    it('사진 서류에서 호수만 다르면(203호 ↔ 208호) CHECK, 글자 PDF면 STOP', () => {
      const contract = '서울특별시 가상구 가상로 45 가상빌라 208호';
      expect(status(road(contract, { photo: true }))).toBe(RISK_STATUS.CHECK);
      expect(status(road(contract))).toBe(RISK_STATUS.STOP);
    });

    it('사진 서류에서 도로 번호만 다르면(45 ↔ 46) CHECK', () => {
      expect(status(road('서울특별시 가상구 가상로 46 가상빌라 203호', { photo: true }))).toBe(RISK_STATUS.CHECK);
    });

    it('도로 이름이 다르면 사진 서류라도 STOP, 같은 집이면 NO_FLAG', () => {
      expect(status(road('서울특별시 가상구 나상로 45 가상빌라 203호', { photo: true }))).toBe(RISK_STATUS.STOP);
      expect(status(road('서울특별시 가상구 가상로 45 가상빌라 203호', { photo: true }))).toBe(RISK_STATUS.NO_FLAG);
    });
  });
});
