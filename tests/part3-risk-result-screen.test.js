// @vitest-environment happy-dom
// PART 3 결과 화면 개선 (#377): 도움받을 곳은 STOP·CHECK 카드에만, 안내 문구는 한 번만. 가상 데이터만 사용한다.
import { describe, it, expect, vi } from 'vitest';
import { RISK_STATUS } from '../src/shared/document-model.js';
import { renderRiskResults, renderConclusionBanner, renderScreenOnlyNote } from '../src/features/risk-check/risk-result-ui.js';
import { HELP_CONTACTS } from '../src/config/help-contacts.js';
import { resultsScreen } from '../src/app/screens/results.js';
import { initialState } from '../src/app/app-state.js';
import { DOCUMENT_TYPE } from '../src/shared/document-model.js';

const make = (ruleId, status, evidence) => ({ ruleId, status, title: ruleId, explanation: 'e', action: 'a', evidence });
const EVIDENCE = { left: { label: 'Registry owner', value: '[Owner_A]' }, right: { label: 'Contract landlord', value: '[Landlord_B]' } };

describe('도움받을 곳 (#377)', () => {
  it('STOP·CHECK 카드에만 나오고, 연락처는 데이터 파일 내용과 같다', () => {
    const root = renderRiskResults([
      make('S', RISK_STATUS.STOP),
      make('C', RISK_STATUS.CHECK),
      make('N', RISK_STATUS.NO_FLAG),
      make('U', RISK_STATUS.UNVERIFIABLE),
    ]);
    // 접힌 칸(NO_FLAG·UNVERIFIABLE)의 카드는 DOM에 있으니 data-rule로 찾는다
    const has = (id) => root.querySelector(`.risk[data-rule="${id}"] .help-box`) !== null;
    expect(has('S')).toBe(true);
    expect(has('C')).toBe(true);
    expect(has('N')).toBe(false);
    expect(has('U')).toBe(false);
    const text = root.querySelector('.risk[data-rule="S"] .help-box')?.textContent ?? '';
    for (const c of HELP_CONTACTS) expect(text).toContain(c.name);
    expect(text).toContain('1345');
    expect(text).toContain('132');
  });
});

describe('배너 (#377)', () => {
  it('배너 제목이 결과에 맞게 나온다', () => {
    expect(renderConclusionBanner([make('S', RISK_STATUS.STOP)]).textContent).toContain('Do not sign yet');
    expect(renderConclusionBanner([make('N', RISK_STATUS.NO_FLAG)]).textContent).toContain('This does not mean the home is safe');
  });
});

describe('"Shown only on this screen" 안내 한 번만 (#377)', () => {
  const screenFor = (riskResults) => {
    const analysis = { documents: [{ documentType: DOCUMENT_TYPE.REGISTRY }, { documentType: DOCUMENT_TYPE.LEASE_CONTRACT }], fields: {}, personGroups: [], riskResults, findings: [], files: [] };
    const state = /** @type {any} */ ({ ...initialState(), step: 'results', analysis, uploadSlots: ['registry', 'lease'], uploadParts: null });
    return resultsScreen(state, /** @type {any} */ ({ setPersonAnswers: vi.fn(), goTo: vi.fn(), restart: vi.fn() }));
  };

  it.each([
    ['카드 0개', []],
    ['카드 1개', [make('S', RISK_STATUS.STOP, EVIDENCE)]],
    ['카드 여러 개', [make('S', RISK_STATUS.STOP, EVIDENCE), make('C', RISK_STATUS.CHECK, EVIDENCE), make('C2', RISK_STATUS.CHECK, EVIDENCE)]],
  ])('%s: 정확히 한 번, Ask AI 버튼 바로 위', (_name, results) => {
    const node = screenFor(results);
    expect(node.querySelectorAll('.screen-only-note')).toHaveLength(1);
    // 카드 안에는 없다
    expect(node.querySelector('.risk .screen-only-note')).toBeNull();
    expect(node.textContent?.match(/shown only on this screen/gi)).toHaveLength(1);
    // 바로 다음 칸이 Ask AI 버튼이 있는 actions
    const note = node.querySelector('#screen-only-note');
    expect(note?.nextElementSibling?.textContent).toContain('Ask AI about these results');
  });

  it('renderScreenOnlyNote 단독으로도 한 줄이다', () => {
    expect(renderScreenOnlyNote().textContent).toContain('not included in the AI prompt');
  });
});
