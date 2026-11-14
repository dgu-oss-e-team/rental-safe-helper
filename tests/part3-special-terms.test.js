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

const { CHECK, NO_FLAG, UNVERIFIABLE } = RISK_STATUS;

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
    expect(r.data.evidence.right.value).toBe('월세는 현금으로 지급한다.');
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
    ['전입신고 금지', '임차인은 전입신고를 하지 않는다.', 'address registration'],
    ['확정일자 금지', '확정일자는 받을 수 없다. 확정일자 금지.', 'address registration'],
    ['원상복구 비용 임차인 부담', '원상복구 비용은 임차인이 부담한다.', 'Repair or restoration'],
    ['수리비 임차인 부담', '모든 수리비는 임차인 부담이다.', 'Repair or restoration'],
    ['중개수수료 임차인 부담', '중개수수료는 임차인이 전액 부담한다.', 'Brokerage fee'],
    ['보증금 반환 조건', '새로운 임차인이 들어와야 보증금을 반환한다.', 'getting the deposit back'],
    ['보증금 반환 포기', '임차인은 보증금 반환을 포기한다.', 'getting the deposit back'],
  ];

  it.each(cases)('걸린다: %s', (_name, sentence, labelPart) => {
    const r = assess([sentence]);
    expect(r.data.status).toBe(CHECK);
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
    expect(r.data.evidence.right.value).toBe('월세는 현금으로 지급한다. / 임차인은 전입신고를 하지 않는다.');
  });

  it('OCR로 한 문장이 두 줄로 갈라져도 걸린다 (근거 칸에는 두 줄이 모두 나온다)', () => {
    const r = assess(['월세는 현금으로', '지급한다.']);
    expect(r.data.status).toBe(CHECK);
    expect(r.data.evidence.right.value).toBe('월세는 현금으로 / 지급한다.');
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
    expect(assess([named]).data.evidence.right.value).toBe(named);
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
