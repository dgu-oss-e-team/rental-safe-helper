import { describe, it, expect, vi } from 'vitest';
import { buildPrompt, getRecommendedQuestions, assessRisks } from '../src/features/risk-check/index.js';
import { replaceUnlistedAliases, ANSWER_RULES } from '../src/features/risk-check/prompt-builder.js';
import { mockExtractedFields, mockPersonGroups } from '../src/shared/mock-data.js';
import { RISK_STATUS, MASKING_PURPOSE } from '../src/shared/document-model.js';

const { FRAUD_CHECK, CLAUSE_EXPLANATION, CONTRACT_EXPLANATION } = MASKING_PURPOSE;

const risk = (explanation, title = 'Owner and landlord check', extra = {}) => ({
  ruleId: 'OWNER_MISMATCH',
  status: RISK_STATUS.STOP,
  title,
  explanation,
  action: 'A',
  ...extra,
});

const prompt = ({ results, legend, purpose = FRAUD_CHECK }) =>
  buildPrompt({
    purpose,
    riskResults: results,
    maskedText: { DOC_LEASE: '임대인 [REDACTED]' },
    legend,
  });

describe('PART 3 프롬프트: 가림 해제된 가명 처리', () => {
  it('범례에 있는 가명은 그대로 둔다', () => {
    const r = prompt({
      results: [risk('[Owner_A] is the registered owner, but [Landlord_B] signs.')],
      legend: { '[Owner_A]': 'owner on the register', '[Landlord_B]': 'landlord on the contract' },
    });
    expect(r.data).toContain('[Owner_A] is the registered owner, but [Landlord_B] signs.');
  });

  it('범례에 없는 가명(가림을 해제한 사람)은 역할 이름으로 바꾼다', () => {
    const r = prompt({
      results: [risk('[Owner_A] is the registered owner, but [Landlord_B] signs.')],
      legend: { '[Owner_A]': 'owner on the register' },
    });
    expect(r.data).toContain('[Owner_A] is the registered owner, but the landlord signs.');
    expect(r.data).not.toContain('[Landlord_B]');
  });

  it('문장 맨 앞의 가명은 대문자로 시작한다', () => {
    const r = prompt({
      results: [risk('[Owner_A] is the registered owner. [Landlord_B] signs.')],
      legend: {},
    });
    expect(r.data).toContain('The owner is the registered owner. The landlord signs.');
  });

  it('같은 역할이 둘 이어지면 복수로 합친다', () => {
    expect(replaceUnlistedAliases('This home has owners ([Owner_A] and [Owner_E]).', {})).toBe(
      'This home has owners (the owners).',
    );
    expect(replaceUnlistedAliases('[AccountHolder_D] and [AccountHolder_F] differ.', {})).toBe(
      'The account holders differ.',
    );
  });

  it('쉼표로 이어지거나 셋 이상이어도 복수로 합친다', () => {
    expect(replaceUnlistedAliases('Owners: [Owner_A], [Owner_E].', {})).toBe('Owners: the owners.');
    expect(replaceUnlistedAliases('[Owner_A], [Owner_E] and [Owner_F] sign.', {})).toBe('The owners sign.');
    expect(replaceUnlistedAliases('[Owner_A] and [Owner_E] and [Owner_F] sign.', {})).toBe('The owners sign.');
  });

  it('다른 역할 둘은 합치지 않는다', () => {
    expect(replaceUnlistedAliases('[Owner_A] and [Landlord_B] differ.', {})).toBe(
      'The owner and the landlord differ.',
    );
  });

  it('이전 소유자 가명 [PrevOwner_E]는 "the previous owner"로 바꾼다', () => {
    expect(replaceUnlistedAliases('[PrevOwner_E] sold the home recently.', {})).toBe(
      'The previous owner sold the home recently.',
    );
    expect(replaceUnlistedAliases('Ownership moved from [PrevOwner_E] to [Owner_A].', {})).toBe(
      'Ownership moved from the previous owner to the owner.',
    );
  });

  it('범례에 있는 [PrevOwner_E]는 그대로 두고, 둘 이어지면 복수로 합친다', () => {
    expect(replaceUnlistedAliases('[PrevOwner_E] sold it.', { '[PrevOwner_E]': 'previous owner' })).toBe(
      '[PrevOwner_E] sold it.',
    );
    expect(replaceUnlistedAliases('[PrevOwner_E] and [PrevOwner_F] sold it.', {})).toBe(
      'The previous owners sold it.',
    );
  });

  it('알 수 없는 역할이면 "a person"', () => {
    expect(replaceUnlistedAliases('See [Person_C].', {})).toBe('See a person.');
  });

  it('제목에 있는 가명도 바꾼다', () => {
    const r = prompt({ results: [risk('E', 'Check for [Landlord_B]')], legend: {} });
    expect(r.data).toContain('Check for the landlord');
  });

  it('범례가 아예 없어도(undefined) 오류 없이 모든 가명을 바꾼다', () => {
    const r = prompt({ results: [risk('[Landlord_B] signs.')], legend: undefined });
    expect(r.ok).toBe(true);
    expect(r.data).toContain('The landlord signs.');
  });

  it('가명이 없는 설명은 그대로다', () => {
    expect(replaceUnlistedAliases('A mortgage is registered. KRW 120,000,000.', {})).toBe(
      'A mortgage is registered. KRW 120,000,000.',
    );
  });

  it('실제 점검 결과: 임대인 가림을 해제하면 프롬프트에 [Landlord_B]가 남지 않는다', () => {
    const results = assessRisks(structuredClone(mockExtractedFields), structuredClone(mockPersonGroups)).data;
    const r = prompt({ results, legend: { '[Owner_A]': 'owner on the register' } });
    expect(r.ok).toBe(true);
    expect(r.data).not.toContain('[Landlord_B]');
    expect(r.data).toContain('[Owner_A] is the registered owner, but the landlord is signing as the landlord.');
  });
});

describe('PART 3 프롬프트: 개인정보', () => {
  it('evidence(화면용 실제 값)는 프롬프트에 들어가지 않는다', () => {
    const evidence = {
      left: { label: 'Registry owner', value: '김철수 (birth 800101)' },
      right: { label: 'Contract landlord', value: '김철수 (birth 750315)' },
    };
    const r = prompt({ results: [risk('[Owner_A] and [Landlord_B] differ.', 'T', { evidence })], legend: {} });
    expect(r.data).not.toContain('김철수');
    expect(r.data).not.toContain('800101');
    expect(r.data).not.toContain('750315');
    expect(r.data).not.toContain('Registry owner');
  });

  it('실제 점검 결과 전체를 넣어도 실제 이름·생년월일이 없다', () => {
    const results = assessRisks(structuredClone(mockExtractedFields), structuredClone(mockPersonGroups)).data;
    const r = prompt({ results, legend: {} });
    for (const secret of ['김철수', 'NGUYEN', '800101', '750315', '990505']) {
      expect(r.data).not.toContain(secret);
    }
  });

  it('위험 점검 결과는 사기 위험 확인 목적에만 넣는다', () => {
    const results = [risk('[Landlord_B] signs.')];
    expect(prompt({ results, legend: {}, purpose: CLAUSE_EXPLANATION }).data).not.toContain('Automatic check results');
    expect(prompt({ results, legend: {}, purpose: CONTRACT_EXPLANATION }).data).not.toContain('Automatic check results');
    expect(prompt({ results, legend: {}, purpose: FRAUD_CHECK }).data).toContain('Automatic check results');
  });
});

describe('PART 3 추천 질문', () => {
  it('세 가지 목적 모두 추천 질문이 나온다', () => {
    for (const purpose of [CLAUSE_EXPLANATION, FRAUD_CHECK, CONTRACT_EXPLANATION]) {
      const questions = getRecommendedQuestions(purpose);
      expect(questions.length).toBeGreaterThan(0);
      const r = prompt({ results: [], legend: {}, purpose });
      expect(r.ok).toBe(true);
      for (const q of questions) expect(r.data).toContain(`- ${q}`);
    }
  });

  it('목적마다 질문이 다르다', () => {
    const sets = [CLAUSE_EXPLANATION, FRAUD_CHECK, CONTRACT_EXPLANATION].map((p) =>
      getRecommendedQuestions(p).join('|'),
    );
    expect(new Set(sets).size).toBe(3);
  });

  it('알 수 없는 목적이면 null, 프롬프트도 만들지 않는다', () => {
    expect(getRecommendedQuestions('UNKNOWN')).toBeNull();
    expect(prompt({ results: [], legend: {}, purpose: 'UNKNOWN' }).ok).toBe(false);
  });

  it('돌려받은 목록을 고쳐도 원래 질문은 바뀌지 않는다', () => {
    const q = getRecommendedQuestions(FRAUD_CHECK);
    q.push('hacked');
    expect(getRecommendedQuestions(FRAUD_CHECK)).not.toContain('hacked');
  });

  it('질문에는 가명·이름이 없다', () => {
    for (const purpose of [CLAUSE_EXPLANATION, FRAUD_CHECK, CONTRACT_EXPLANATION]) {
      for (const q of getRecommendedQuestions(purpose)) expect(q).not.toMatch(/\[[A-Za-z]+_[A-Z]\]/);
    }
  });
});

describe('PART 3 프롬프트 (#250)', () => {
  it('Automatic check results는 STOP → CHECK → UNVERIFIABLE → NO_FLAG 순, 같은 상태는 규칙 순서', () => {
    const mk = (ruleId, status) => ({ ruleId, status, title: `T_${ruleId}`, explanation: 'e', action: 'a' });
    const results = [
      mk('A', RISK_STATUS.NO_FLAG), mk('B', RISK_STATUS.UNVERIFIABLE), mk('C', RISK_STATUS.CHECK),
      mk('D', RISK_STATUS.STOP), mk('E', RISK_STATUS.CHECK), mk('F', RISK_STATUS.STOP),
    ];
    const text = prompt({ results }).data;
    const positions = ['T_D', 'T_F', 'T_C', 'T_E', 'T_B', 'T_A'].map((t) => text.indexOf(t));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('법인명·예금주 이름은 화면 칸에만 있고 프롬프트에는 없다', () => {
    const f = structuredClone(mockExtractedFields);
    f.registry.owners = [];
    f.registry.ownerCompanies = ['가상신탁 주식회사'];
    f.contract.landlords = [];
    f.contract.landlordCompanies = ['주식회사가상리츠'];
    f.contract.accountHolders = [{ findingId: 'PII_L08', name: '최가상', birthDate: null, role: 'ACCOUNT_HOLDER' }];
    const risks = assessRisks(f, structuredClone(mockPersonGroups));
    expect(risks.ok).toBe(true);
    const owner = risks.data.find((r) => r.ruleId === 'OWNER_MISMATCH');
    expect(owner.evidence.right.value).toContain('주식회사가상리츠'); // 화면에는 있다
    const p = buildPrompt({ purpose: FRAUD_CHECK, riskResults: risks.data, maskedText: { DOC_LEASE: 'masked' }, legend: {} });
    for (const secret of ['주식회사가상리츠', '가상신탁 주식회사', '최가상']) expect(p.data).not.toContain(secret);
  });
});

describe('PART 3 프롬프트 답변 규칙 (#274)', () => {
  it('규칙은 4개이고, 가명 모양이나 이름·숫자 같은 개인정보가 없다', () => {
    expect(ANSWER_RULES).toHaveLength(4);
    for (const rule of ANSWER_RULES) {
      expect(rule).not.toMatch(/\[[A-Za-z]+_[A-Z]\]/);
      expect(rule).not.toMatch(/\d{6,}/);
    }
  });

  it('세 목적 모두 4개 규칙이 들어간다', () => {
    for (const purpose of [CLAUSE_EXPLANATION, FRAUD_CHECK, CONTRACT_EXPLANATION]) {
      const text = prompt({ results: [], legend: {}, purpose }).data;
      expect(text).toContain('## Answer rules');
      for (const rule of ANSWER_RULES) expect(text).toContain(`- ${rule}`);
    }
  });

  it('규칙 4가지 내용: 추측 금지, 문서·쪽 번호, 사실/추측 구분, 법 시행일', () => {
    const text = ANSWER_RULES.join('\n');
    expect(text).toMatch(/Do not guess or reconstruct/);
    expect(text).toMatch(/which document/);
    expect(text).toMatch(/page number/);
    expect(text).toMatch(/Separate facts from guesses/);
    expect(text).toMatch(/came into effect/);
    expect(text).toMatch(/say so instead of guessing/);
  });

  it('규칙은 서류 내용보다 앞에 있고, 프롬프트는 여전히 영어 답변 요청으로 끝난다', () => {
    const text = prompt({ results: [], legend: {} }).data;
    expect(text.indexOf('## Answer rules')).toBeLessThan(text.indexOf('## Documents (masked)'));
    expect(text.trim().endsWith('Please answer in English.')).toBe(true);
  });

  it('가명(role name)은 같은 사람이라는 뜻을 남기고, "알 수 없다고 답하라"고 하지 않는다', () => {
    const rule = ANSWER_RULES[0];
    expect(rule).toContain('Treat [REDACTED] as unknown');
    expect(rule).toContain('the same role name always means the same person');
    expect(rule).toContain('role legend');
    expect(rule).not.toContain('cannot tell');
  });
});

describe('동명이인 안내는 프롬프트에 들어가지 않는다 (#378)', () => {
  it('buildPrompt 결과에 이름·생년월일·안내 문구가 없다', () => {
    const risks = assessRisks(structuredClone(mockExtractedFields), structuredClone(mockPersonGroups));
    expect(risks.ok).toBe(true);
    expect(risks.data.some((x) => x.notice)).toBe(true); // 테스트 전제: notice가 실제로 있다
    const p = buildPrompt({
      purpose: MASKING_PURPOSE.FRAUD_CHECK,
      riskResults: risks.data,
      maskedText: { DOC_001: '[Owner_A] and [Landlord_B] ...' },
      legend: { '[Owner_A]': 'Registry owner', '[Landlord_B]': 'Contract landlord' },
    });
    expect(p.ok).toBe(true);
    for (const s of ['김철수', '800101', '750315', 'Same name', 'SAME_NAME']) {
      expect(p.data).not.toContain(s);
    }
  });

  it('분석 중 콘솔에 이름·생년월일이 찍히지 않는다', () => {
    const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    assessRisks(structuredClone(mockExtractedFields), structuredClone(mockPersonGroups));
    const printed = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const s of ['김철수', '800101', '750315']) expect(printed).not.toContain(s);
    spies.forEach((s) => s.mockRestore());
  });

  it('잘못된 입력의 오류 메시지에 개인정보가 없다', () => {
    const r = assessRisks(null, []);
    expect(r.ok).toBe(false);
    expect(r.error.message).not.toMatch(/김철수|800101|750315/);
  });
});
