// @vitest-environment happy-dom
// ② 결과 화면 맨 아래 "Next: ask AI": 목적 확인·바꾸기, Stop이면 사기 위험 확인 제안 (#381, 기능 개선 목록 2번)
// 가상 데이터만 사용한다.
import { describe, it, expect, vi } from 'vitest';
import { resultsScreen } from '../src/app/screens/results.js';
import { initialState } from '../src/app/app-state.js';
import { DOCUMENT_TYPE, MASKING_PURPOSE, RISK_STATUS } from '../src/shared/document-model.js';
import { PURPOSES } from '../src/app/purposes.js';
import { stepper } from '../src/app/ui.js';

const DOCS = [{ documentType: DOCUMENT_TYPE.REGISTRY }, { documentType: DOCUMENT_TYPE.LEASE_CONTRACT }];
/** @param {string} status */
const risk = (status) => ({ ruleId: `RULE_${status}`, status, title: `Fake ${status}`, explanation: 'Fake explanation.', action: 'Fake action.' });

/**
 * @param {{ purpose?: string, statuses?: string[] }} [opts]
 */
const screenFor = ({ purpose = MASKING_PURPOSE.FRAUD_CHECK, statuses = [] } = {}) => {
  const analysis = { documents: DOCS, fields: {}, personGroups: [], riskResults: statuses.map(risk), findings: [], files: [] };
  const state = /** @type {any} */ ({ ...initialState(), step: 'results', analysis, purpose, uploadSlots: ['registry', 'lease'], uploadParts: null });
  const act = { setPersonAnswers: vi.fn(), goTo: vi.fn(), restart: vi.fn(), setPurpose: vi.fn(), prepare: vi.fn() };
  return { node: resultsScreen(state, /** @type {any} */ (act)), act };
};

describe('② "Next: ask AI" (#381)', () => {
  it('결과 화면 맨 아래 카드에 고른 목적과 AI에 보내는 것 한 줄이 보인다', () => {
    const { node } = screenFor({ purpose: MASKING_PURPOSE.CONTRACT_EXPLANATION });
    const cards = node.querySelectorAll('section.card');
    const last = cards[cards.length - 1];
    expect(last.querySelector('h2')?.textContent).toBe('Next: ask AI');
    expect(last.querySelector('#chosen-purpose-title')?.textContent).toBe('Explain contract conditions');
    expect(last.querySelector('#chosen-purpose')?.textContent).toContain('The property register is not sent');
  });

  it('목적 화면으로 가는 버튼이 없고, 다음 버튼은 바로 AI 준비(prepare)를 한다', () => {
    const { node, act } = screenFor();
    expect([...node.querySelectorAll('button')].some((b) => b.textContent === 'Ask AI about these results')).toBe(false);
    /** @type {HTMLButtonElement} */ (node.querySelector('#next-review')).click();
    expect(act.prepare).toHaveBeenCalledTimes(1);
    expect(act.goTo).not.toHaveBeenCalledWith('purpose');
  });

  it('"Change"를 누르면 목적 3개가 펼쳐지고, 고르면 setPurpose를 부른다', () => {
    const { node, act } = screenFor();
    const list = /** @type {HTMLElement} */ (node.querySelector('#purpose-choices'));
    const change = /** @type {HTMLButtonElement} */ (node.querySelector('#change-purpose'));
    expect(list.hidden).toBe(true);
    expect(change.getAttribute('aria-expanded')).toBe('false');
    expect(change.getAttribute('aria-controls')).toBe('purpose-choices');
    change.click();
    expect(list.hidden).toBe(false);
    expect(change.getAttribute('aria-expanded')).toBe('true');
    expect(list.querySelectorAll('input[type=radio]')).toHaveLength(3);
    // 목적마다 AI에 보내는 것 설명 (옛 목적 화면 문구)
    for (const p of PURPOSES) expect(list.textContent).toContain(p.sendsText);
    const clause = /** @type {HTMLInputElement} */ (list.querySelector(`input[value="${MASKING_PURPOSE.CLAUSE_EXPLANATION}"]`));
    clause.checked = true;
    clause.dispatchEvent(new Event('change'));
    expect(act.setPurpose).toHaveBeenCalledWith(MASKING_PURPOSE.CLAUSE_EXPLANATION);
    // 목적을 고르면 화면이 다시 그려진다. 고른 결과가 보이게 펼친 채로 그린다
    expect(/** @type {HTMLElement} */ (screenFor().node.querySelector('#purpose-choices')).hidden).toBe(false);
    // 다음 단계로 가면 접힌다
    const again = screenFor();
    /** @type {HTMLButtonElement} */ (again.node.querySelector('#next-review')).click();
    expect(/** @type {HTMLElement} */ (screenFor().node.querySelector('#purpose-choices')).hidden).toBe(true);
  });

  it('Stop이 있고 사기 위험 확인이 아니면 "Switch to Check fraud risks"를 제안한다', () => {
    const { node, act } = screenFor({ purpose: MASKING_PURPOSE.CONTRACT_EXPLANATION, statuses: [RISK_STATUS.STOP, RISK_STATUS.CHECK] });
    const sw = /** @type {HTMLButtonElement} */ (node.querySelector('#switch-fraud'));
    expect(sw?.textContent).toBe('Switch to Check fraud risks');
    sw.click();
    expect(act.setPurpose).toHaveBeenCalledWith(MASKING_PURPOSE.FRAUD_CHECK);
  });

  it('Stop이 없거나, 이미 사기 위험 확인이면 제안하지 않는다', () => {
    expect(screenFor({ purpose: MASKING_PURPOSE.CLAUSE_EXPLANATION, statuses: [RISK_STATUS.CHECK, RISK_STATUS.NO_FLAG] }).node.querySelector('#switch-purpose')).toBeNull();
    expect(screenFor({ purpose: MASKING_PURPOSE.FRAUD_CHECK, statuses: [RISK_STATUS.STOP] }).node.querySelector('#switch-purpose')).toBeNull();
  });

  it('단계 표시줄은 4칸: Upload · Check · Review · Done (사진 글자 확인은 Upload 칸)', () => {
    expect([...stepper('results').querySelectorAll('.label')].map((n) => n.textContent)).toEqual(['Upload', 'Check', 'Review', 'Done']);
    expect(stepper('confirm').querySelector('[aria-current="step"] .label')?.textContent).toBe('Upload');
    expect(stepper('review').querySelector('[aria-current="step"] .num')?.textContent).toBe('3');
  });

  it('"Start over"는 그대로 있다', () => {
    const { node, act } = screenFor();
    [...node.querySelectorAll('button')].find((b) => b.textContent === 'Start over')?.click();
    expect(act.restart).toHaveBeenCalled();
  });
});
