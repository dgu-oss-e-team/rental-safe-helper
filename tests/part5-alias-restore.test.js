// @vitest-environment happy-dom
// PART 5. 도전 목표 ②: AI 답변의 가명을 이 브라우저 안에서만 원래 이름으로 보여 주기 (#394)
// 가상 데이터만 사용한다. (이름은 모두 지어낸 것)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildRestoreTable, restoreAliases } from '../src/app/alias-restore.js';
import { doneScreen } from '../src/app/screens/done.js';
import { initialState } from '../src/app/app-state.js';
import { MASKING_ACTION, PII_TYPE } from '../src/shared/document-model.js';

const finding = (id, value, type = PII_TYPE.PERSON_NAME) => ({ id, type, value });
const item = (findingId, replacement, action = MASKING_ACTION.REPLACE) => ({ findingId, action, replacement, pageIndex: 0, bbox: null });

const FINDINGS = [
  finding('F1', '가상소유'), // 등기부 소유자 = 임대인 (같은 사람)
  finding('F2', '가상소유'),
  finding('F3', '가짜임차'),
  finding('F4', '가상동명'), // 동명이인: 다른 사람
  finding('F5', '가상동명'),
  finding('F6', '가짜 예금'), // 띄어쓰기가 다른 같은 이름
  finding('F7', '가짜예금'),
  finding('F8', '서울특별시 가상구 가짜로 1', PII_TYPE.ADDRESS),
  finding('F9', '010-0000-0000', PII_TYPE.PHONE_NUMBER),
  finding('F10', '가상소유'), // F1과 이름은 같지만 같은 사람인지 확인 안 됨 (PART 4 unconfirmedAlias)
];
const PLAN = {
  purpose: 'FRAUD_CHECK',
  items: [
    item('F1', '[Owner_A]'),
    item('F2', '[Owner_A]'),
    item('F3', '[Tenant_C]'),
    item('F4', '[PrevOwner_D]'),
    item('F5', '[Landlord_E]'),
    item('F6', '[AccountHolder_F]'),
    item('F7', '[AccountHolder_F]'),
    item('F8', '서울특별시 가상구'), // 주소는 줄인 주소로 바꾸지만 복원하지 않는다
    item('F9', '[REDACTED]', MASKING_ACTION.REDACT),
    item('F10', '[Owner_A?]'), // [Owner_A]와 이름만 같고 같은 사람인지 확인 안 됨
  ],
};
const TABLE = buildRestoreTable(/** @type {any} */ (PLAN), FINDINGS);
/** 복원 결과를 글로: 바꾼 조각은 {이름} */
const restored = (answer, table = TABLE) =>
  restoreAliases(answer, table).segments.map((s) => ('alias' in s ? `{${s.name}}` : s.text)).join('');

describe('buildRestoreTable(): 마스킹 계획에서 "가명 → 원래 이름" 표', () => {
  it('이름을 가명으로 바꾼 항목만 넣는다 (주소·번호는 넣지 않음)', () => {
    expect([...TABLE.values()].map((e) => e.alias).sort()).toEqual(
      ['[AccountHolder_F]', '[Landlord_E]', '[Owner_A?]', '[Owner_A]', '[PrevOwner_D]', '[Tenant_C]'].sort(),
    );
    const names = [...TABLE.values()].map((e) => e.name).join(' ');
    expect(names).not.toContain('가상구');
    expect(names).not.toContain('010');
  });

  it('같은 사람은 이름 하나, 띄어쓰기만 다른 이름은 하나로 합친다', () => {
    expect(TABLE.get('owner_a')?.name).toBe('가상소유');
    expect(TABLE.get('accountholder_f')?.name).toBe('가짜 예금 / 가짜예금');
  });

  it('확인 안 된 같은 이름 가명은 따로 표시한다', () => {
    expect(TABLE.get('owner_a?')).toEqual({ alias: '[Owner_A?]', name: '가상소유', unconfirmed: true });
    // 이름은 같아도 확인된 가명과 섞지 않는다
    expect(TABLE.get('owner_a')).toEqual({ alias: '[Owner_A]', name: '가상소유', unconfirmed: false });
  });

  it('계획·서류가 없거나 모양이 다르면 빈 표', () => {
    expect(buildRestoreTable(null, FINDINGS).size).toBe(0);
    expect(buildRestoreTable(/** @type {any} */ (PLAN), null).size).toBe(0);
    expect(buildRestoreTable(/** @type {any} */ ({ items: [item('F1', 'Owner A')] }), FINDINGS).size).toBe(0);
    // 이름이 아닌 항목에 가명 모양이 붙어 있어도 넣지 않는다
    expect(buildRestoreTable(/** @type {any} */ ({ items: [item('F8', '[Owner_A]')] }), FINDINGS).size).toBe(0);
  });
});

describe('등기부 요약의 개인 권리자 가명 [Holder_N] (#396 holderNames)', () => {
  const HOLDERS = { '[Holder_1]': '가상채권', '[Holder_2]': '가짜 압류' };
  const WITH_HOLDERS = buildRestoreTable(/** @type {any} */ (PLAN), FINDINGS, HOLDERS);

  it('마스킹 계획의 가명과 함께 표에 넣는다', () => {
    expect(WITH_HOLDERS.get('holder_1')).toEqual({ alias: '[Holder_1]', name: '가상채권', unconfirmed: false });
    expect(WITH_HOLDERS.get('holder_2')?.name).toBe('가짜 압류');
    expect(WITH_HOLDERS.get('owner_a')?.name).toBe('가상소유');
    // 마스킹 계획이 없어도(이름이 없는 계약서 등) 권리자 표만으로 만든다
    expect(buildRestoreTable(null, null, HOLDERS).size).toBe(2);
  });

  it('권리자 표에서는 [Holder_N] 모양만 받는다', () => {
    const odd = { '[Owner_A]': '가상다른', '[Holder_A]': '가상글자', '[Holder_1?]': '가상물음', 'Holder_3': '가상괄호', '[Holder_0]': '가상영', '[Holder_4]': '' };
    expect(buildRestoreTable(null, null, /** @type {any} */ (odd)).size).toBe(0);
    expect(buildRestoreTable(null, null, /** @type {any} */ ({ '[Holder_5]': 5 })).size).toBe(0);
  });

  it('여러 모양의 [Holder_1]을 바꾸고, Holder 12·Holder_1a는 바꾸지 않는다', () => {
    for (const form of ['[Holder_1]', 'Holder_1', 'Holder 1', '[holder 1]', 'HOLDER_1']) {
      expect(restored(`${form} filed a seizure.`, WITH_HOLDERS), form).toBe('{가상채권} filed a seizure.');
    }
    for (const text of ['Holder 12', 'Holder_1a', 'Holder_3', 'the holder', 'Holder\n1']) {
      expect(restored(text, WITH_HOLDERS), JSON.stringify(text)).toBe(text);
    }
    expect(restoreAliases('[Holder_1], [Owner_A] and Holder 2', WITH_HOLDERS).replaced).toBe(3);
  });

  it('마스킹 계획의 이름과 같은 권리자는 "확인 안 된 같은 이름"으로 표시한다 (#398 리뷰)', () => {
    // 등기부 요약은 소유자와 이름만 같은 권리자를 [Holder_1]로 따로 둔다. 띄어쓰기만 달라도 같은 이름으로 본다
    const same = buildRestoreTable(/** @type {any} */ (PLAN), FINDINGS, { '[Holder_1]': '가상 소유', '[Holder_2]': '가상채권' });
    expect(same.get('holder_1')).toEqual({ alias: '[Holder_1]', name: '가상 소유', unconfirmed: true });
    expect(same.get('holder_2')?.unconfirmed).toBe(false);
    // 계획 쪽 가명은 그대로
    expect(same.get('owner_a')?.unconfirmed).toBe(false);
    // 찾는 방법은 그대로: [Holder_1]·Holder 1 모두 바꾸고, 바꾼 조각에 확인 안 됨 표시가 붙는다
    const { segments } = restoreAliases('[Owner_A] and Holder 1', same);
    expect(segments.filter((x) => 'alias' in x).map((x) => [x.alias, /** @type {any} */ (x).unconfirmed])).toEqual([
      ['[Owner_A]', false],
      ['[Holder_1]', true],
    ]);
    // 마스킹 계획이 없으면 비교할 이름이 없어 확인된 가명으로 둔다
    expect(buildRestoreTable(null, null, { '[Holder_1]': '가상소유' }).get('holder_1')?.unconfirmed).toBe(false);
  });
});

describe('restoreAliases(): 대소문자·띄어쓰기·밑줄만 정리해 정확히 같은 가명만 바꾼다', () => {
  it('여러 모양의 같은 가명을 바꾼다', () => {
    for (const form of ['[Owner_A]', 'Owner_A', 'Owner A', '[owner_a]', '[ Owner A ]', 'OWNER_A', 'owner A']) {
      expect(restored(`Ask ${form} for the ID.`), form).toBe('Ask {가상소유} for the ID.');
    }
  });

  it('두 단어 역할(AccountHolder·PrevOwner)도 띄어 쓴 모양을 찾는다', () => {
    expect(restored('Account Holder F and Prev Owner D')).toBe('{가짜 예금 / 가짜예금} and {가상동명}');
    expect(restored('[account_holder_f]')).toBe('{가짜 예금 / 가짜예금}');
  });

  it('동명이인은 다른 가명이므로 각자 자기 이름으로 (둘 다 같은 이름이 나오지만 섞이지 않는다)', () => {
    const { segments } = restoreAliases('[PrevOwner_D] sold it. [Landlord_E] rents it.', TABLE);
    expect(segments.filter((s) => 'alias' in s).map((s) => /** @type {any} */ (s).alias)).toEqual(['[PrevOwner_D]', '[Landlord_E]']);
  });

  it('바꾸면 안 되는 말은 그대로 둔다', () => {
    for (const text of [
      'the landlord said',
      'Owner',
      'a landlord a day', // 대괄호 없이 소문자 한 글자
      'Owner_As',
      'Owner_A1',
      'Tenant_Z', // 표에 없는 가명
      'Landlord_A', // 표에 없는 역할·글자 조합
      'MyOwner_A', // 앞 글자에 붙어 있음
    ]) {
      expect(restored(text), text).toBe(text);
    }
  });

  it('확인 안 된 가명: 대괄호 안 ?만 그것으로 보고, 문장 끝 물음표는 남긴다', () => {
    const r = restoreAliases('[Owner_A?] may differ. Is it Owner_A?', TABLE);
    const changed = r.segments.filter((s) => 'alias' in s);
    expect(changed.map((s) => /** @type {any} */ (s).unconfirmed)).toEqual([true, false]);
    expect(restored('Is it Owner_A?')).toBe('Is it {가상소유}?');
  });

  it('같은 이름이 나란히: [Owner_A]와 [Owner_A?]는 같은 이름이 나오지만 확인 여부는 따로', () => {
    const { segments } = restoreAliases('[Owner_A] signed. [Owner_A?] is on the register.', TABLE);
    const changed = segments.filter((s) => 'alias' in s).map((s) => /** @type {any} */ (s));
    expect(changed.map((s) => [s.name, s.alias, s.unconfirmed])).toEqual([
      ['가상소유', '[Owner_A]', false],
      ['가상소유', '[Owner_A?]', true],
    ]);
  });

  it('줄바꿈은 넘지 않는다: "Owner" 다음 줄이 대문자 한 글자로 시작해도 가명이 아니다', () => {
    for (const text of ['Owner\nA new rule applies.', 'Owner\r\nA', 'Account\nHolder F', 'Owner\tA']) {
      expect(restored(text), JSON.stringify(text)).toBe(text);
    }
    expect(restored('Owner A\nTenant C')).toBe('{가상소유}\n{가짜임차}');
  });

  it('확인된 가명이 표에 없으면 ?가 빠진 모양도 확인 안 된 가명으로 본다', () => {
    const only = buildRestoreTable(/** @type {any} */ ({ items: [item('F10', '[Owner_A?]')] }), FINDINGS);
    const r = restoreAliases('Owner_A', only);
    expect(r.replaced).toBe(1);
    expect(/** @type {any} */ (r.segments[0]).unconfirmed).toBe(true);
  });

  it('한쪽 대괄호만 있으면 대괄호는 글로 남긴다', () => {
    expect(restored('see [Owner_A for details')).toBe('see [{가상소유} for details');
    expect(restored('see Owner_A] here')).toBe('see {가상소유}] here');
  });

  it('바꾼 수를 센다. 빈 글·빈 표는 그대로', () => {
    expect(restoreAliases('[Owner_A], [Tenant_C] and Owner A', TABLE).replaced).toBe(3);
    // 같은 가명이 여러 번 + 표에 없는 가명이 섞여 있으면 표에 있는 것만 센다
    expect(restoreAliases('[Owner_A] [Owner_A] [Tenant_Z] [Landlord_B] Owner_A [Tenant_C]', TABLE).replaced).toBe(4);
    expect(restoreAliases('', TABLE)).toEqual({ segments: [], replaced: 0 });
    expect(restoreAliases('Owner_A', new Map())).toEqual({ segments: [{ text: 'Owner_A' }], replaced: 0 });
  });

  it('조각을 이으면 원래 답변 글과 같다 (글을 빼거나 더하지 않음)', () => {
    const answer = '1. [Owner_A] = Landlord?\n2. Ask owner a question.\n3. [Owner_A?] / Tenant C';
    expect(restoreAliases(answer, TABLE).segments.map((s) => s.text).join('')).toBe(answer);
  });
});

describe('완료 화면 "Read the AI answer with real names" (#394)', () => {
  const act = () => /** @type {any} */ ({ doubleCheckPdfs: vi.fn(), setPdfChecked: vi.fn(), goTo: vi.fn(), restart: vi.fn() });
  /** @param {any} [patch] */
  const stateOf = (patch = {}) =>
    /** @type {any} */ ({
      ...initialState(),
      step: 'done',
      analysis: { documents: [{ documentId: 'D1', sourceType: 'text_pdf' }], findings: FINDINGS },
      prepared: { prompt: 'fake prompt', maskingPlan: PLAN, sending: [] },
      pdfs: [],
      doubleCheck: null,
      ...patch,
    });
  /** @param {any} [patch] */
  const screen = (patch = {}) => doneScreen(stateOf(patch), act());
  /** 목적별 마스킹 계획: 이름은 사기 위험 확인만 가명, 나머지 두 목적은 완전히 가린다 (masking-policy.json) */
  const planFor = (/** @type {string} */ purpose) =>
    purpose === 'FRAUD_CHECK'
      ? PLAN
      : { purpose, items: PLAN.items.map((i) => ({ ...i, action: MASKING_ACTION.REDACT, replacement: '[REDACTED]' })) };
  afterEach(() => vi.restoreAllMocks());

  it('붙여 넣고 누르면 가명 자리에 원래 이름과 가명을 함께 보여 준다', () => {
    const node = screen();
    const input = /** @type {HTMLTextAreaElement} */ (node.querySelector('#ai-answer'));
    expect(input.getAttribute('spellcheck')).toBe('false');
    input.value = 'Check that [Owner_A] and Landlord E are the same person. <b>x</b>';
    /** @type {HTMLButtonElement} */ (node.querySelector('#restore-names')).click();
    const out = /** @type {HTMLElement} */ (node.querySelector('#restored-answer'));
    expect(out.hidden).toBe(false);
    const marks = [...out.querySelectorAll('mark.restored')];
    expect(marks.map((m) => m.firstChild?.textContent)).toEqual(['가상소유', '가상동명']);
    expect(marks[0].textContent).toContain('[Owner_A]');
    // 붙여 넣은 글은 HTML로 해석하지 않는다
    expect(out.querySelector('b')).toBeNull();
    expect(out.textContent).toContain('<b>x</b>');
    expect(node.querySelector('#restore-status')?.textContent).toBe('Replaced 2 labels with real names.');
  });

  it('확인 안 된 가명은 그렇다고 적는다', () => {
    const node = screen();
    /** @type {HTMLTextAreaElement} */ (node.querySelector('#ai-answer')).value = '[Owner_A?]';
    /** @type {HTMLButtonElement} */ (node.querySelector('#restore-names')).click();
    const mark = node.querySelector('mark.restored');
    expect(mark?.classList.contains('unconfirmed')).toBe(true);
    expect(mark?.textContent).toContain('not confirmed to be the same person');
  });

  it('바꿀 가명이 없으면·빈 칸이면 알려 준다, Clear는 지운다', () => {
    const node = screen();
    const input = /** @type {HTMLTextAreaElement} */ (node.querySelector('#ai-answer'));
    const status = node.querySelector('#restore-status');
    /** @type {HTMLButtonElement} */ (node.querySelector('#restore-names')).click();
    expect(status?.textContent).toBe('Paste the AI answer first.');
    input.value = 'the landlord should return the deposit';
    /** @type {HTMLButtonElement} */ (node.querySelector('#restore-names')).click();
    expect(status?.textContent).toBe('We found no labels like [Landlord_B] in this answer.');
    /** @type {HTMLButtonElement} */ (node.querySelector('#restore-clear')).click();
    expect(input.value).toBe('');
    expect(/** @type {HTMLElement} */ (node.querySelector('#restored-answer')).hidden).toBe(true);
  });

  it('원래 이름을 저장하거나 콘솔에 쓰지 않고, 복사 버튼도 없다', () => {
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const err = vi.spyOn(console, 'error');
    const node = screen();
    /** @type {HTMLTextAreaElement} */ (node.querySelector('#ai-answer')).value = '[Owner_A] [Tenant_C]';
    /** @type {HTMLButtonElement} */ (node.querySelector('#restore-names')).click();
    for (const spy of [log, warn, err]) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage })).not.toContain('가상소유');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('가상소유');
    const card = node.querySelector('.restore-card');
    expect([...(card?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Show real names', 'Clear']);
    expect(card?.querySelector('#restore-privacy')?.textContent).toContain('not saved or sent anywhere');
  });

  it('등기부 요약의 권리자 가명도 완료 화면에서 바꾼다 (prepared.holderNames)', () => {
    const node = screen({ prepared: { prompt: 'p', maskingPlan: PLAN, sending: [], holderNames: { '[Holder_1]': '가상채권' } } });
    /** @type {HTMLTextAreaElement} */ (node.querySelector('#ai-answer')).value = '[Holder_1] has a provisional seizure. Ask [Owner_A].';
    /** @type {HTMLButtonElement} */ (node.querySelector('#restore-names')).click();
    const marks = [...node.querySelectorAll('mark.restored')];
    expect(marks.map((m) => m.firstChild?.textContent)).toEqual(['가상채권', '가상소유']);
    expect(marks[0].textContent).toContain('[Holder_1]');
    // 이름 가명이 없고 권리자만 있어도 붙여 넣는 칸이 나온다
    const only = screen({
      prepared: { prompt: 'p', maskingPlan: { purpose: 'FRAUD_CHECK', items: [] }, sending: [], holderNames: { '[Holder_1]': '가상채권' } },
    });
    expect(only.querySelector('#ai-answer')).not.toBeNull();
  });

  it('소유자와 이름만 같은 권리자는 완료 화면에서 "same name, not confirmed"로 보인다 (#398 리뷰)', () => {
    const node = screen({ prepared: { prompt: 'p', maskingPlan: PLAN, sending: [], holderNames: { '[Holder_1]': '가상 소유' } } });
    /** @type {HTMLTextAreaElement} */ (node.querySelector('#ai-answer')).value = '[Owner_A] and [Holder_1]';
    /** @type {HTMLButtonElement} */ (node.querySelector('#restore-names')).click();
    const marks = [...node.querySelectorAll('mark.restored')];
    expect(marks.map((m) => m.classList.contains('unconfirmed'))).toEqual([false, true]);
    expect(marks[1].textContent).toContain('[Holder_1]: same name, not confirmed to be the same person');
  });

  it('프롬프트가 없거나 사진 다시 확인을 기다리면 카드가 없다', () => {
    for (const node of [
      screen({ prepared: { prompt: '', maskingPlan: PLAN, sending: [] } }),
      screen({ analysis: { documents: [{ documentId: 'D1', sourceType: 'image' }], findings: FINDINGS }, doubleCheck: null }),
    ]) {
      expect(node.querySelector('.restore-card')).toBeNull();
    }
  });

  it('세 목적 모두 카드가 나온다: 사기 위험 확인은 붙여 넣는 칸, 나머지 두 목적은 바꿀 이름이 없다는 안내', () => {
    for (const purpose of ['FRAUD_CHECK', 'CLAUSE_EXPLANATION', 'CONTRACT_EXPLANATION']) {
      const card = screen({ prepared: { prompt: 'p', maskingPlan: planFor(purpose), sending: [] } }).querySelector('.restore-card');
      expect(card, purpose).not.toBeNull();
      expect(card?.textContent, purpose).toContain('Read the AI answer with real names');
      if (purpose === 'FRAUD_CHECK') {
        expect(card?.querySelector('#ai-answer'), purpose).not.toBeNull();
        expect(card?.querySelector('#restore-none'), purpose).toBeNull();
      } else {
        expect(card?.querySelector('#ai-answer'), purpose).toBeNull();
        expect(card?.querySelector('#restore-none')?.textContent, purpose).toContain('names are fully hidden');
        expect(card?.querySelector('#restore-none')?.textContent, purpose).toContain('Check fraud risks');
      }
    }
    // 사기 위험 확인인데 이름이 하나도 없었으면: 보낸 가명이 없다고 알린다
    const none = screen({ prepared: { prompt: 'p', maskingPlan: { purpose: 'FRAUD_CHECK', items: [] }, sending: [] } });
    expect(none.querySelector('#restore-none')?.textContent).toContain('No name labels');
  });

  it('화면을 다시 그리거나 "Check other documents"를 누르면 붙여 넣은 답변과 결과가 남지 않는다', () => {
    const a = act();
    const state = stateOf();
    const node = doneScreen(state, a);
    /** @type {HTMLTextAreaElement} */ (node.querySelector('#ai-answer')).value = 'Ask [Owner_A] now';
    /** @type {HTMLButtonElement} */ (node.querySelector('#restore-names')).click();
    expect(node.querySelector('mark.restored')).not.toBeNull();
    // 답변과 결과는 화면에만 있고 앱 상태에 들어가지 않는다
    expect(JSON.stringify(state)).not.toContain('Ask [Owner_A] now');
    // 다른 화면에 갔다가 돌아오면 완료 화면을 새로 그린다: 빈 칸, 결과 없음
    const again = doneScreen(state, a);
    expect(/** @type {HTMLTextAreaElement} */ (again.querySelector('#ai-answer')).value).toBe('');
    expect(/** @type {HTMLElement} */ (again.querySelector('#restored-answer')).hidden).toBe(true);
    expect(again.querySelector('mark.restored')).toBeNull();
    // "Check other documents"는 처음부터 다시 시작한다 (새 상태에는 마스킹 계획이 없어 카드도 없다)
    const restartBtn = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Check other documents');
    restartBtn?.click();
    expect(a.restart).toHaveBeenCalledTimes(1);
    expect(initialState().prepared ?? null).toBeNull();
  });
});
