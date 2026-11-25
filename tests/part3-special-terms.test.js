import { describe, it, expect } from 'vitest';
import {
  assessSpecialTerms,
  findRiskyTerms,
  getSpecialTermKeywords,
  normalizeTerm,
  parseSpecialTermKeywords,
} from '../src/features/risk-check/special-terms.js';
import { assessRisks, buildPrompt } from '../src/features/risk-check/index.js';
import { mockExtractedFields, mockPersonGroups } from '../src/shared/mock-data.js';
import { MASKING_PURPOSE, RISK_STATUS } from '../src/shared/document-model.js';

const { STOP, CHECK, NO_FLAG, UNVERIFIABLE } = RISK_STATUS;

/** 계약서 특약만 바꾼 데이터 (원본 Mock은 건드리지 않는다) */
const withTerms = (specialTerms) => {
  const f = structuredClone(mockExtractedFields);
  f.contract.specialTerms = specialTerms;
  return f;
};
const assess = (specialTerms) => assessSpecialTerms(withTerms(specialTerms));

describe('PART 3 위험 특약 문구 (RISKY_SPECIAL_TERM) 상태', () => {
  it('Mock 계약서의 "월세는 현금으로 지급한다."가 CHECK로 나온다', () => {
    const r = assessSpecialTerms(mockExtractedFields);
    expect(r.ok).toBe(true);
    expect(r.data.ruleId).toBe('RISKY_SPECIAL_TERM');
    expect(r.data.status).toBe(CHECK);
    expect(r.data.explanation).toContain('Cash payment');
    expect(r.data.evidence.right.value).toBe('Special term 1: 월세는 현금으로 지급한다.');
  });

  it('specialTerms가 null(못 읽음)이면 UNVERIFIABLE', () => {
    const r = assess(null);
    expect(r.data.status).toBe(UNVERIFIABLE);
    expect(r.data.evidence.left.value).toBe('—');
  });

  it('specialTerms가 [](읽었는데 비어 있음)이면 NO_FLAG이고, 안전하다는 말로 읽히지 않는다', () => {
    const r = assess([]);
    expect(r.data.status).toBe(NO_FLAG);
    expect(r.data.explanation).toContain('empty');
    expect(r.data.explanation).toContain('does not mean the contract is safe');
  });

  it('읽었는데 키워드에 걸리는 특약이 없으면 NO_FLAG', () => {
    const r = assess(['반려동물은 키울 수 없다.', '관리비는 매월 말일에 납부한다.']);
    expect(r.data.status).toBe(NO_FLAG);
    expect(r.data.explanation).toContain('does not mean the contract is safe');
    expect(r.data.evidence.left.value).toBe('2 special terms read');
  });

  it('specialTerms 자체가 없거나 배열이 아니거나 글자가 아닌 값뿐이면 UNVERIFIABLE', () => {
    expect(assessSpecialTerms({}).data.status).toBe(UNVERIFIABLE);
    expect(assessSpecialTerms(null).data.status).toBe(UNVERIFIABLE);
    expect(assess('현금').data.status).toBe(UNVERIFIABLE);
    expect(assess([123, null]).data.status).toBe(UNVERIFIABLE);
    expect(assess(['  ']).data.status).toBe(UNVERIFIABLE);
  });

  it('글자가 아닌 값이 섞여 있어도 글자인 특약은 점검한다', () => {
    expect(assess([123, '월세는 현금으로 지급한다.']).data.status).toBe(CHECK);
  });
});

describe('PART 3 위험 특약 키워드', () => {
  const cases = [
    ['현금 지급', '월세는 현금으로 지급한다.', 'Cash payment'],
    ['현금 지급 (띄어쓰기가 달라도)', '월세는 현 금 으로 지 급 한다.', 'Cash payment'],
    ['전입신고 금지 (STOP)', '임차인은 전입신고를 하지 않는다.', 'address registration', STOP],
    ['확정일자 금지 (STOP)', '확정일자는 받을 수 없다. 확정일자 금지.', 'address registration', STOP],
    ['원상복구 비용 임차인 부담', '원상복구 비용은 임차인이 부담한다.', 'Repair or restoration'],
    ['수리비 임차인 부담', '모든 수리비는 임차인 부담이다.', 'Repair or restoration'],
    ['중개수수료 임차인 부담', '중개수수료는 임차인이 전액 부담한다.', 'Brokerage fee'],
    ['보증금 반환 조건', '새로운 임차인이 들어와야 보증금을 반환한다.', 'getting the deposit back'],
    ['보증금 반환 포기', '임차인은 보증금 반환을 포기한다.', 'getting the deposit back'],
  ];

  // 네 번째 값이 없으면 CHECK. 전입신고·확정일자 금지만 STOP이다. (#278)
  it.each(cases)('걸린다: %s', (_name, sentence, labelPart, status = CHECK) => {
    const r = assess([sentence]);
    expect(r.data.status).toBe(status);
    expect(r.data.explanation).toContain(labelPart);
  });

  const safeCases = [
    ['현금영수증 발급', '임대인은 요청 시 현금영수증을 발급한다.'],
    ['전입신고 허용', '임차인은 전입신고와 확정일자를 받을 수 있다.'],
    ['수리비 임대인 부담', '건물의 큰 수리비는 임대인이 부담한다.'],
    ['보증금 정상 반환', '보증금은 계약 종료일에 반환한다.'],
  ];

  it.each(safeCases)('걸리지 않는다: %s', (_name, sentence) => {
    expect(assess([sentence]).data.status).toBe(NO_FLAG);
  });

  it('여러 종류가 걸리면 설명에 모두 나온다', () => {
    const r = assess(['월세는 현금으로 지급한다.', '임차인은 전입신고를 하지 않는다.']);
    expect(r.data.explanation).toContain('Cash payment');
    expect(r.data.explanation).toContain('address registration');
    expect(r.data.status).toBe(STOP); // 전입신고 금지가 같이 있으면 STOP
    expect(r.data.evidence.right.value).toBe(
      'Special term 1: 월세는 현금으로 지급한다. / Special term 2: 임차인은 전입신고를 하지 않는다.',
    );
  });

  it('OCR로 한 문장이 두 줄로 갈라져도 걸린다 (근거 칸에는 한 특약으로 합쳐서 나온다)', () => {
    const r = assess(['월세는 현금으로', '지급한다.']);
    expect(r.data.status).toBe(CHECK);
    expect(r.data.evidence.right.value).toBe('Special term 1: 월세는 현금으로 지급한다.');
  });

  it('서로 떨어진 줄의 단어를 이어 붙여서 걸리지는 않는다', () => {
    const r = assess(['현금영수증을 발급한다.', '반려동물은 키울 수 없다.', '관리비는 지급한다.']);
    expect(r.data.status).toBe(NO_FLAG);
  });

  it('키워드 파일이 정상으로 읽히고 모든 분류에 label과 reason이 있다', () => {
    const k = getSpecialTermKeywords();
    expect(k.ok).toBe(true);
    expect(k.data.length).toBeGreaterThanOrEqual(5);
    for (const c of k.data) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });

  it('normalizeTerm: 띄어쓰기·가운뎃점·마침표를 없앤다', () => {
    expect(normalizeTerm('전입 신고 · 확정일자.')).toBe('전입신고확정일자');
  });

  it('findRiskyTerms: 걸린 분류와 특약 줄 번호를 돌려준다', () => {
    const categories = getSpecialTermKeywords().data;
    const { matched, indexes } = findRiskyTerms(['관리비는 매월 납부한다.', '월세는 현금으로 지급한다.'], categories);
    expect(matched.map((c) => c.id)).toEqual(['CASH_PAYMENT']);
    expect(indexes).toEqual([1]);
  });
});

describe('PART 3 위험 특약 키워드 파일 검사', () => {
  it('YAML이 아니면 실패한다', () => {
    expect(parseSpecialTermKeywords('a: [').ok).toBe(false);
  });

  it('categories가 없거나 비어 있으면 실패한다', () => {
    expect(parseSpecialTermKeywords('foo: 1').ok).toBe(false);
    expect(parseSpecialTermKeywords('categories: {}').ok).toBe(false);
  });

  it('label, reason, keywords 중 하나라도 없으면 실패한다', () => {
    const noReason = 'categories:\n  A:\n    label: x\n    keywords: ["현금"]\n';
    const noKeywords = 'categories:\n  A:\n    label: x\n    reason: y\n    keywords: []\n';
    expect(parseSpecialTermKeywords(noReason).ok).toBe(false);
    expect(parseSpecialTermKeywords(noKeywords).ok).toBe(false);
  });

  it('빈 칸이 있는 키워드는 실패한다', () => {
    const emptyPart = 'categories:\n  A:\n    label: x\n    reason: y\n    keywords: ["현금 & "]\n';
    const emptyAlt = 'categories:\n  A:\n    label: x\n    reason: y\n    keywords: ["|"]\n';
    expect(parseSpecialTermKeywords(emptyPart).ok).toBe(false);
    expect(parseSpecialTermKeywords(emptyAlt).ok).toBe(false);
  });

  it('올바른 파일은 읽힌다', () => {
    const good = 'categories:\n  A:\n    label: x\n    reason: y\n    keywords: ["현금 & 지급|납부"]\n';
    const r = parseSpecialTermKeywords(good);
    expect(r.ok).toBe(true);
    expect(r.data[0].expressions).toEqual([[['현금'], ['지급', '납부']]]);
  });
});

describe('PART 3 위험 특약 개인정보', () => {
  const named = '임대인 김철수는 월세를 현금으로 지급받는다.';

  it('설명과 행동 안내에는 특약 원문(이름이 있는 문장)을 넣지 않는다', () => {
    const r = assess([named]);
    expect(r.data.status).toBe(CHECK);
    for (const text of [r.data.title, r.data.explanation, r.data.action]) {
      expect(text).not.toContain('김철수');
      expect(text).not.toContain('월세는');
    }
  });

  it('특약 원문은 화면 근거 칸에만 나온다', () => {
    expect(assess([named]).data.evidence.right.value).toBe(`Special term 1: ${named}`);
  });

  it('근거 칸의 특약 한 줄이 너무 길면 줄여서 보여 준다', () => {
    const long = `월세는 현금으로 지급한다. ${'가'.repeat(500)}`;
    const value = assess([long]).data.evidence.right.value;
    expect(value.length).toBeLessThan(250);
    expect(value.endsWith('…')).toBe(true);
  });

  it('AI 프롬프트에는 특약 원문이 들어가지 않고, 걸린 문구 종류만 들어간다', () => {
    const risks = assessRisks(withTerms([named]), mockPersonGroups);
    expect(risks.ok).toBe(true);
    const prompt = buildPrompt({
      purpose: MASKING_PURPOSE.FRAUD_CHECK,
      riskResults: risks.data,
      maskedText: { DOC_LEASE: '[Landlord_B] pays rent.' },
      legend: { '[Landlord_B]': 'landlord' },
    });
    expect(prompt.ok).toBe(true);
    expect(prompt.data).toContain('Special terms check');
    expect(prompt.data).toContain('Cash payment');
    expect(prompt.data).not.toContain('김철수');
  });
});

describe('PART 3 assessRisks()에 위험 특약이 포함된다', () => {
  it('Mock 데이터에서 RISKY_SPECIAL_TERM이 CHECK로 나온다', () => {
    const r = assessRisks(mockExtractedFields, mockPersonGroups);
    expect(r.ok).toBe(true);
    const special = r.data.find((x) => x.ruleId === 'RISKY_SPECIAL_TERM');
    expect(special?.status).toBe(CHECK);
  });

  it('특약을 못 읽으면 UNVERIFIABLE로 나온다', () => {
    const r = assessRisks(withTerms(null), mockPersonGroups);
    const special = r.data.find((x) => x.ruleId === 'RISKY_SPECIAL_TERM');
    expect(special?.status).toBe(UNVERIFIABLE);
  });

  it('모든 결과에 설명·행동 안내가 있고 상태는 네 가지 중 하나다', () => {
    const r = assessRisks(mockExtractedFields, mockPersonGroups);
    const valid = Object.values(RISK_STATUS);
    for (const risk of r.data) {
      expect(valid).toContain(risk.status);
      expect(risk.explanation.length).toBeGreaterThan(0);
      expect(risk.action.length).toBeGreaterThan(0);
    }
  });
});

describe('PART 3 위험 특약 오탐 줄이기 (except)', () => {
  const notFlagged = [
    ['현금 지급을 받지 않는다는 문장', '월세는 계좌이체로 지급하며 현금 지급은 받지 않는다.'],
    ['새로운 임차인과 관계없이 반환', '새로운 임차인 여부와 관계없이 보증금을 즉시 반환한다.'],
    ['띄어쓰기가 달라도 예외 문구로 본다', '새로운 임차인 여부와 관 계 없 이 보증금을 즉시 반환한다.'],
  ];

  it.each(notFlagged)('CHECK가 아니다: %s', (_name, sentence) => {
    expect(assess([sentence]).data.status).toBe(NO_FLAG);
  });

  it('예외 문구가 없는 현금 지급 특약은 그대로 CHECK이다', () => {
    const r = assess(['월세는 현금으로 지급한다.']);
    expect(r.data.status).toBe(CHECK);
    expect(r.data.explanation).toContain('Cash payment');
  });

  // 예외 문구가 "무엇을" 받지 않는지까지 담고 있어야, 위험한 특약이 예외로 가려지지 않는다 (PR #117 리뷰)
  const stillChecked = [
    ['계좌이체는 받지 않으며 월세는 현금으로 지급한다.', 'Cash payment'],
    ['임대인은 계좌이체를 받을 수 없으므로 월세는 현금으로 지급한다.', 'Cash payment'],
    ['계약 기간과 관계없이 보증금은 새로운 임차인이 구해진 후 반환한다.', 'Limits on getting the deposit back'],
    ['임대인 사정과 상관없이 보증금은 신규 임차인 입주 후에 돌려준다.', 'Limits on getting the deposit back'],
  ];

  it.each(stillChecked)('CHECK 유지: %s', (sentence, label) => {
    const r = assess([sentence]);
    expect(r.data.status).toBe(CHECK);
    expect(r.data.explanation).toContain(label);
  });

  it('한 문장이 두 줄로 갈라져도 예외 문구를 본다 (예외 문구가 뒷줄에 있어도, 앞줄에 있어도)', () => {
    expect(assess(['월세는 계좌이체로 지급하며 현금 지급은', '받지 않는다.']).data.status).toBe(NO_FLAG);
    expect(assess(['새로운 임차인 여부와', '관계없이 보증금을 즉시 반환한다.']).data.status).toBe(NO_FLAG);
    expect(assess(['새로운 임차인 여부와 관계없이 보증금을', '즉시 반환한다.']).data.status).toBe(NO_FLAG);
  });

  it('문장이 끝난 줄은 다음 줄의 예외 문구를 빌리지 않는다 (서로 다른 특약이 섞이지 않게)', () => {
    const r = assess(['월세는 현금으로 지급한다.', '쓰레기는 받지 않는다.']);
    expect(r.data.status).toBe(CHECK);
    expect(r.data.evidence.right.value).toBe('Special term 1: 월세는 현금으로 지급한다.');
  });

    it('예외 문구가 옆 줄 안에 통째로 있으면, 마침표 없이 이어져도 이 줄의 위험 특약을 가리지 않는다', () => {
    // 앞줄에 예외 문구가 통째로 있는 경우 (마침표 없음)
    const before = assess(['임차인과 관계없이 임대인은 관리비를 정한다', '보증금은 새로운 임차인이 구해지면 반환한다.']);
    expect(before.data.status).toBe(CHECK);
    expect(before.data.explanation).toContain('Limits on getting the deposit back');
    expect(before.data.evidence.right.value).toBe('Special term 1: 보증금은 새로운 임차인이 구해지면 반환한다.');

    // 뒷줄에 예외 문구가 통째로 있는 경우
    const after = assess(['보증금은 새로운 임차인이 구해지면 반환한다', '임차인과 관계없이 관리비는 임대인이 정한다.']);
    expect(after.data.status).toBe(CHECK);
    expect(after.data.explanation).toContain('Limits on getting the deposit back');
    expect(after.data.evidence.right.value).toBe('Special term 1: 보증금은 새로운 임차인이 구해지면 반환한다');

    // 현금: 뒷줄의 "현금 지급은 받지 않는다"는 앞 특약의 예외가 아니다
    const cash = assess(['월세는 현금으로 지급한다', '현금 지급은 받지 않는다.']);
    expect(cash.data.status).toBe(CHECK);
    expect(cash.data.explanation).toContain('Cash payment');
  });

  it('예외 문구는 그 분류만 뺀다 (다른 분류는 그대로 걸린다)', () => {
    const r = assess(['월세는 계좌이체로 지급하며 현금 지급은 받지 않는다.', '임차인은 전입신고를 하지 않는다.']);
    expect(r.data.status).toBe(STOP);
    expect(r.data.explanation).toContain('address registration');
    expect(r.data.explanation).not.toContain('Cash payment');
  });

  it('부정문은 STOP이 아니라 CHECK로 남는다 (전입신고·확정일자 금지 분류, #278)', () => {
    const r = assess(['임차인은 전입신고를 금지하지 않는다.']);
    expect(r.data.status).toBe(CHECK);
    expect(r.data.status).not.toBe(STOP);
  });

  it('except가 걸린 오탐 문장은 assessRisks()에서도 CHECK로 뜨지 않는다', () => {
    const r = assessRisks(withTerms(['새로운 임차인 여부와 관계없이 보증금을 즉시 반환한다.']), mockPersonGroups);
    expect(r.data.find((x) => x.ruleId === 'RISKY_SPECIAL_TERM')?.status).toBe(NO_FLAG);
  });
});

describe('PART 3 위험 특약 키워드 파일: except 검사', () => {
  const file = (except) =>
    `categories:\n  A:\n    label: x\n    reason: y\n    keywords: ["현금"]\n${except === undefined ? '' : `    except: ${except}\n`}`;

  it('except는 선택이다. 없으면 빈 목록이다', () => {
    const r = parseSpecialTermKeywords(file(undefined));
    expect(r.ok).toBe(true);
    expect(r.data[0].except).toEqual([]);
  });

  it('except 문구도 띄어쓰기를 없앤 상태로 읽힌다', () => {
    const r = parseSpecialTermKeywords(file('["받지 않", "관계없이"]'));
    expect(r.ok).toBe(true);
    expect(r.data[0].except).toEqual(['받지않', '관계없이']);
  });

  it('except가 목록이 아니거나, 글자가 아닌 값·빈 문구가 있으면 실패한다', () => {
    for (const bad of ['"받지않"', '[123]', '[""]', '["  "]', '["받지않", ""]']) {
      expect(parseSpecialTermKeywords(file(bad)).ok).toBe(false);
    }
  });

  it('실제 키워드 파일: 현금 지급과 보증금 반환 분류에 예외 문구가 있고, &·|는 쓰지 않았다', () => {
    const byId = Object.fromEntries(getSpecialTermKeywords().data.map((c) => [c.id, c]));
    expect(byId.CASH_PAYMENT.except).toContain('현금지급은받지않');
    expect(byId.DEPOSIT_RETURN_LIMIT.except).toContain('임차인여부와관계없이');
    for (const category of Object.values(byId)) {
      for (const phrase of category.except) expect(phrase).not.toMatch(/[&|]/);
    }
  });

  it('실제 키워드 파일: 예외 문구가 너무 넓지 않다 ("받지않"·"관계없이"만으로는 예외가 되지 않는다)', () => {
    const byId = Object.fromEntries(getSpecialTermKeywords().data.map((c) => [c.id, c]));
    for (const phrase of ['받지않', '받을수없']) expect(byId.CASH_PAYMENT.except).not.toContain(phrase);
    for (const phrase of ['관계없이', '상관없이', '무관하게']) expect(byId.DEPOSIT_RETURN_LIMIT.except).not.toContain(phrase);
    expect(byId.CASH_PAYMENT.except.every((phrase) => phrase.includes('현금'))).toBe(true);
    expect(byId.DEPOSIT_RETURN_LIMIT.except.every((phrase) => phrase.includes('임차인'))).toBe(true);
  });
});

describe('PART 3 전입신고·확정일자 금지 특약은 STOP (#278)', () => {
  const banned = [
    '임차인은 전입신고를 하지 않는다.',
    '전입신고는 금지한다.',
    '확정일자 신청은 금지한다.',
    '임차인은 확정일자를 받지 못한다.',
    '전입신고 및 확정일자 신청은 불가하다.',
  ];

  it.each(banned)('STOP: %s', (sentence) => {
    const r = assess([sentence]);
    expect(r.data.status).toBe(STOP);
    expect(r.data.explanation).toContain('address registration');
  });

  const negated = [
    '임대인은 전입신고를 금지하지 않는다.',
    '임대인은 임차인의 전입신고를 제한하지 않는다.',
    '전입신고와 확정일자는 제한 없이 가능하다.',
    '임대인은 전입신고를 방해하지 않는다.',
    '임차인은 확정일자를 받는 것이 금지되지 않는다.',
  ];

  it.each(negated)('부정문은 STOP이 아니라 CHECK: %s', (sentence) => {
    expect(assess([sentence]).data.status).toBe(CHECK);
  });

  it('부정문이 두 줄로 갈라져도 STOP이 아니라 CHECK', () => {
    expect(assess(['임대인은 전입신고를 금지하지', '않는다.']).data.status).toBe(CHECK);
  });

  it('부정문 특약과 전입신고 금지 특약이 같이 있으면 STOP', () => {
    expect(assess(['임대인은 전입신고를 금지하지 않는다.', '확정일자는 받지 못한다.']).data.status).toBe(STOP);
  });

  it('현금 지급 등 다른 분류만 걸리면 기존대로 CHECK', () => {
    expect(assess(['월세는 현금으로 지급한다.']).data.status).toBe(CHECK);
    expect(assess(['중개수수료는 임차인이 전액 부담한다.']).data.status).toBe(CHECK);
  });

  it('STOP이어도 설명·행동 안내에 특약 원문이 없고, "서명하지 말라"고 단정하지 않는다', () => {
    const r = assess(['임차인 김철수는 전입신고를 하지 않는다.']);
    expect(r.data.status).toBe(STOP);
    for (const text of [r.data.title, r.data.explanation, r.data.action]) {
      expect(text).not.toContain('김철수');
      expect(text).not.toMatch(/do not sign/i);
    }
    expect(r.data.action.length).toBeGreaterThan(0);
  });

  it('assessRisks()에서도 RISKY_SPECIAL_TERM이 STOP으로 나온다', () => {
    const risks = assessRisks(withTerms(['임차인은 전입신고를 하지 않는다.']), mockPersonGroups);
    expect(risks.data.find((x) => x.ruleId === 'RISKY_SPECIAL_TERM')?.status).toBe(STOP);
  });

  it('키워드 파일: 전입신고·확정일자 금지만 severity가 STOP이고, negation 문구가 있다', () => {
    const categories = getSpecialTermKeywords().data;
    const stop = categories.filter((c) => c.severity === 'STOP');
    expect(stop.map((c) => c.id)).toEqual(['REGISTRATION_BAN']);
    expect(stop[0].negation.length).toBeGreaterThan(0);
    for (const phrase of stop[0].negation) expect(phrase).not.toMatch(/[&|\s]/);
  });

  it('severity·negation 검사: 없으면 기본값, 잘못되면 실패한다', () => {
    const file = (extra) =>
      `categories:\n  A:\n    label: x\n    reason: y\n    keywords: ["현금"]\n${extra}`;
    const plain = parseSpecialTermKeywords(file(''));
    expect(plain.ok).toBe(true);
    expect(plain.data[0].severity).toBe('CHECK');
    expect(plain.data[0].negation).toEqual([]);
    const stop = parseSpecialTermKeywords(file('    severity: STOP\n    negation: ["하지 않"]\n'));
    expect(stop.data[0].severity).toBe('STOP');
    expect(stop.data[0].negation).toEqual(['하지않']);
    for (const bad of ['    severity: WARN\n', '    negation: "하지않"\n', '    negation: [""]\n', '    negation: [123]\n']) {
      expect(parseSpecialTermKeywords(file(bad)).ok).toBe(false);
    }
  });
});

describe('PART 3 특약은 번호로 시작하는 줄마다 끊어서 검사 (#278)', () => {
  // 상욱님 가짜세트4: 임차인에게 유리한 특약이 다른 줄의 "임차인"과 합쳐져 걸리던 오탐
  const favorable = '2. 임대사업자는 입주 전에 도배를 새로 하며, 그 비용은 임대사업자가 부담한다.';
  const brokerage = '1. 중개보수는 임차인이 전액 부담한다.';
  const brokerageText = '중개보수는 임차인이 전액 부담한다.'; // 번호를 뺀 문구

  it('특약 하나만 넣었을 때처럼, 목록 전체를 넣어도 "도배 비용은 임대사업자 부담"이 수리비 임차인 부담으로 걸리지 않는다', () => {
    const alone = assess([favorable]);
    expect(alone.data.status).toBe(NO_FLAG);
    const all = assess([brokerage, favorable]);
    expect(all.data.explanation).not.toContain('Repair or restoration');
    expect(all.data.explanation).toContain('Brokerage fee'); // 1번 중개보수는 그대로 걸린다
    expect(all.data.evidence.right.value).toBe(`Special term 1: ${brokerageText}`);
  });

  it('번호로 시작하는 줄과는 이어 붙이지 않는다 (번호가 달라도, ①처럼 써도)', () => {
    for (const second of ['2. 도배는 임대사업자가 하며 그 비용을 부담한다.', '② 도배는 임대사업자가 하며 그 비용을 부담한다.', '(2) 도배는 임대사업자가 하며 그 비용을 부담한다.']) {
      expect(assess(['1. 장판 교체는 임차인이 한다', second]).data.explanation ?? '').not.toContain('Repair or restoration');
    }
  });

  it('앞 줄이 문장을 끝냈으면, 번호 없는 다음 줄과도 이어 붙이지 않는다', () => {
    const r = assess(['중개보수는 임차인이 전액 부담한다.', '도배는 새로 하며 그 비용은 임대사업자가 부담한다.']);
    expect(r.data.explanation).not.toContain('Repair or restoration');
  });

  it('번호 없이 줄만 넘어간 한 문장은 기존처럼 이어서 본다 (번호가 붙은 줄 안에서도)', () => {
    expect(assess(['월세는 현금으로', '지급한다.']).data.status).toBe(CHECK);
    const r = assess(['1. 월세는 현금으로', '지급한다.']);
    expect(r.data.status).toBe(CHECK);
    expect(r.data.evidence.right.value).toBe('Special term 1: 월세는 현금으로 지급한다.');
  });

  it('날짜·소수처럼 번호가 아닌 숫자로 시작하는 줄은 새 특약으로 보지 않는다', () => {
    const r = assess(['월세는 현금으로', '2025. 3. 5.까지 지급한다.']);
    expect(r.data.status).toBe(CHECK);
    const pct = assess(['월세는 현금으로', '3.5%를 가산하여 지급한다.']);
    expect(pct.data.status).toBe(CHECK);
  });

  it('findRiskyTerms: 번호 줄 경계는 넘지 않는다', () => {
    const categories = getSpecialTermKeywords().data;
    const { matched } = findRiskyTerms([brokerage, favorable], categories);
    expect(matched.map((c) => c.id)).toEqual(['BROKER_FEE_TENANT']);
  });
});

describe('PART 3 근거 칸에 몇 번째 특약인지 표시 (#278)', () => {
  it('걸린 특약마다 "Special term N: 문구"로 나온다 (계약서에 적힌 번호를 따르고, 문구 앞의 번호는 뺀다)', () => {
    const r = assess(['1. 관리비는 매월 납부한다.', '2. 월세는 현금으로 지급한다.', '3. 임차인은 전입신고를 하지 않는다.']);
    expect(r.data.evidence.right.value).toBe(
      'Special term 2: 월세는 현금으로 지급한다. / Special term 3: 임차인은 전입신고를 하지 않는다.',
    );
  });

  it('번호가 없으면 몇 번째 특약인지 센 값을 쓴다 (문장이 끝날 때마다 새 특약)', () => {
    const r = assess(['관리비는 매월 납부한다.', '월세는 현금으로 지급한다.']);
    expect(r.data.evidence.right.value).toBe('Special term 2: 월세는 현금으로 지급한다.');
  });

  it('번호가 있는 목록 안의 번호 없는 앞머리 문장은 번호 없이 보여 준다 (계약서 번호와 겹치지 않게)', () => {
    const r = assess(['월세는 현금으로 지급한다.', '1. 관리비는 매월 납부한다.']);
    expect(r.data.evidence.right.value).toBe('월세는 현금으로 지급한다.');
  });

  it('한 특약의 두 줄이 모두 걸리면 한 번호 아래 합쳐서 보여 준다', () => {
    const r = assess(['3. 월세는 현금으로', '지급한다.']);
    expect(r.data.evidence.right.value).toBe('Special term 3: 월세는 현금으로 지급한다.');
  });

  it('번호와 문구는 근거 칸에만 있고 설명·행동 안내·프롬프트에는 없다', () => {
    const risks = assessRisks(withTerms(['1. 임대인 김철수는 월세를 현금으로 지급받는다.']), mockPersonGroups);
    const special = risks.data.find((x) => x.ruleId === 'RISKY_SPECIAL_TERM');
    expect(special.evidence.right.value).toContain('Special term 1');
    for (const text of [special.explanation, special.action]) {
      expect(text).not.toContain('Special term 1');
      expect(text).not.toContain('김철수');
    }
    const prompt = buildPrompt({
      purpose: MASKING_PURPOSE.FRAUD_CHECK,
      riskResults: risks.data,
      maskedText: { DOC_LEASE: '[Landlord_B] pays rent.' },
      legend: { '[Landlord_B]': 'landlord' },
    });
    expect(prompt.data).not.toContain('Special term 1');
    expect(prompt.data).not.toContain('김철수');
  });
});

describe('PART 3 전입신고 금지 STOP은 좁게, 구절 단위로 (#336 리뷰)', () => {
  // sw8606: 임차인을 지켜 주는 보호 특약이 STOP이 되면 안 된다
  const protective = [
    '임대인은 임차인의 전입신고 다음날까지 저당권 등 담보권을 설정하지 않는다.',
    '임대인은 잔금일 다음날까지 근저당권 설정을 하지 않으며, 임차인은 잔금일에 전입신고 및 확정일자를 받는다.',
  ];

  it.each(protective)('보호 특약은 STOP이 아니다: %s', (sentence) => {
    expect(assess([sentence]).data.status).not.toBe(STOP);
  });

  it('보호 특약은 assessRisks()에서도 STOP으로 나오지 않는다', () => {
    for (const sentence of protective) {
      const risks = assessRisks(withTerms([sentence]), mockPersonGroups);
      expect(risks.data.find((x) => x.ruleId === 'RISKY_SPECIAL_TERM')?.status).not.toBe(STOP);
    }
  });

  // jygh429: 부정문은 전입신고·확정일자와 같은 구절에 있을 때만 본다
  it('다른 구절에 "~하지 않"이 있어도 전입신고 금지 구절이 있으면 STOP', () => {
    const r = assess(['임차인은 전입신고를 할 수 없으며, 임대인은 수리를 방해하지 않는다.']);
    expect(r.data.status).toBe(STOP);
  });

  it('같은 구절의 부정문은 그대로 CHECK', () => {
    expect(assess(['임차인은 수리를 하며, 임대인은 전입신고를 방해하지 않는다.']).data.status).toBe(CHECK);
  });

  it('전입신고 금지 구절이 부정문 구절과 이어져 있어도 STOP', () => {
    expect(assess(['임대인은 전입신고를 방해하지 않고, 확정일자는 받을 수 없다.']).data.status).toBe(STOP);
  });

  it('키워드 파일: REGISTRATION_BAN에 stop_patterns가 있고, 잘못된 값은 실패한다', () => {
    const stop = getSpecialTermKeywords().data.find((c) => c.id === 'REGISTRATION_BAN');
    expect(stop.stopPatterns.length).toBeGreaterThan(0);

    const file = (extra) =>
      `categories:\n  A:\n    label: x\n    reason: y\n    keywords: ["현금"]\n${extra}`;
    expect(parseSpecialTermKeywords(file('')).data[0].stopPatterns).toEqual([]);
    expect(parseSpecialTermKeywords(file("    stop_patterns: ['전입.{0,8}금지']\n")).ok).toBe(true);
    for (const bad of ['    stop_patterns: "전입"\n', '    stop_patterns: [""]\n', '    stop_patterns: [123]\n', "    stop_patterns: ['(']\n"]) {
      expect(parseSpecialTermKeywords(file(bad)).ok).toBe(false);
    }
  });
});

describe('PART 3 날짜로 시작하는 줄은 특약 번호가 아니다 (#336 리뷰)', () => {
  it('"12. 31.까지"·"3. 5.까지"로 시작하는 줄은 앞 특약에 이어 붙고, 번호로 표시되지 않는다', () => {
    expect(assess(['월세는 현금으로', '12. 31.까지 지급한다.']).data.evidence.right.value).toBe(
      'Special term 1: 월세는 현금으로 12. 31.까지 지급한다.',
    );
    expect(assess(['1. 월세는 현금으로', '3. 5.까지 지급한다.']).data.evidence.right.value).toBe(
      'Special term 1: 월세는 현금으로 3. 5.까지 지급한다.',
    );
  });

  it('진짜 번호("3. 월세는 …", "3) …")는 그대로 번호로 본다', () => {
    expect(assess(['3. 월세는 현금으로 지급한다.']).data.evidence.right.value).toBe('Special term 3: 월세는 현금으로 지급한다.');
    expect(assess(['3) 월세는 현금으로 지급한다.']).data.evidence.right.value).toBe('Special term 3: 월세는 현금으로 지급한다.');
  });
});

describe('PART 3 전입신고 금지 STOP 추가 보완 (#336 2차 리뷰)', () => {
  // jygh429: 조건문·전입세대 열람은 STOP이 아니다
  const notStop = [
    '임차인이 전입신고를 할 수 없는 경우 계약을 해제할 수 있다.',
    '임대인은 임차인의 전입세대 열람을 거부할 수 없다.',
  ];

  it.each(notStop)('조건문·전입세대 열람은 STOP이 아니다: %s', (sentence) => {
    expect(assess([sentence]).data.status).not.toBe(STOP);
  });

  // jygh429: 대출 때문에 전입을 막는 특약은 STOP
  it('근저당권자 요청으로 전입신고를 막는 특약은 STOP', () => {
    expect(assess(['근저당권자의 요청에 따라 임차인은 전입신고를 하지 않는다.']).data.status).toBe(STOP);
  });

  it('키워드 파일: negation에 담보권·저당권·근저당이 없다', () => {
    const stop = getSpecialTermKeywords().data.find((c) => c.id === 'REGISTRATION_BAN');
    for (const word of ['담보권', '저당권', '근저당']) expect(stop.negation).not.toContain(word);
  });

  // jygh429: 날짜로 시작하는 줄 안의 진짜 번호
  it('"3. 2027. 1. 5.까지 …"로 시작하는 줄은 3번 특약이다', () => {
    expect(assess(['3. 2027. 1. 5.까지 월세는 현금으로 지급한다.']).data.evidence.right.value).toBe(
      'Special term 3: 2027. 1. 5.까지 월세는 현금으로 지급한다.',
    );
  });
});

describe('PART 3 조건문·이중 부정은 STOP이 아니다 (#336 3차 리뷰)', () => {
  const notStop = [
    '임차인이 전입신고를 하지 못하는 경우 계약을 해제할 수 있다.',
    '전입신고가 불가한 경우 임대인은 보증금을 즉시 반환한다.',
    '전입신고를 할 수 없을 때에는 계약을 해제할 수 있다.',
    '임대인은 임차인의 전입신고를 막지 못한다.',
    '임대인은 임차인의 전입신고를 제한하는 어떠한 행위도 하지 않는다.',
  ];

  it.each(notStop)('STOP이 아니다: %s', (sentence) => {
    expect(assess([sentence]).data.status).not.toBe(STOP);
  });

  it('조건 말이 금지 뒤에 바로 붙지 않으면 STOP을 유지한다', () => {
    expect(assess(['전입신고는 금지하며 위반 시 계약을 해지한다.']).data.status).toBe(STOP);
    expect(assess(['임차인은 전입신고를 할 수 없다.']).data.status).toBe(STOP);
  });
});

describe('PART 3 전입신고·확정일자 금지 특약 키워드 보완 (#342)', () => {
  const missed = [
    '임차인은 사업자등록 및 전입신고를 하지 아니한다.',
    '전입신고 및 확정일자는 받지 않기로 한다.',
    '임차인은 주민등록 이전을 하지 않는다.',
    '전입신고 및 확정일자를 받지 않는다.',
    '확정일자를 받을 수 없다.',
    '전입신고를 하지 않는 경우에만 보증금을 반환한다.',
  ];
  it.each(missed)('NO_FLAG로 새지 않고 STOP: %s', (sentence) => {
    expect(assess([sentence]).data.status).toBe(STOP);
  });

  const protective = [
    '임대인은 임차인의 전입신고 및 확정일자를 방해할 수 없다.',
    '임대인은 전입신고 및 확정일자를 거부할 수 없다.',
    '전입신고가 제한되는 사유가 발생하면 즉시 임차인에게 알린다.',
  ];
  it.each(protective)('보호 특약은 STOP이 아니라 CHECK: %s', (sentence) => {
    expect(assess([sentence]).data.status).toBe(CHECK);
  });

  it('사업자등록만 금지하면 STOP이 아니라 CHECK', () => {
    expect(assess(['임차인은 사업자등록을 하지 않는다.']).data.status).toBe(CHECK);
  });

  it('주민등록번호·"받을 수 있다"·"받는다"는 걸리지 않는다', () => {
    for (const s of ['임대인은 임차인의 주민등록번호를 기재하지 않는다.', '임차인은 전입신고 및 확정일자를 받을 수 있다.', '임차인은 전입신고 및 확정일자를 받는다.']) {
      expect(assess([s]).data.status).toBe(NO_FLAG);
    }
  });
});
