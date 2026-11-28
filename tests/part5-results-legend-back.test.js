// @vitest-environment happy-dom
// ② 결과 화면: 역할 이름·가명 설명(기능 개선 목록 9번), 다른 서류를 넣었을 때 다시 올리러 가는 버튼(10번)
// 가상 데이터만 사용한다.
import { describe, it, expect, vi } from 'vitest';
import { resultsScreen } from '../src/app/screens/results.js';
import { initialState } from '../src/app/app-state.js';
import { DOCUMENT_TYPE } from '../src/shared/document-model.js';

const REG = { documentType: DOCUMENT_TYPE.REGISTRY };
const LEASE = { documentType: DOCUMENT_TYPE.LEASE_CONTRACT };
const UNKNOWN = { documentType: DOCUMENT_TYPE.UNKNOWN };

/** 서류 종류와 칸만 다른 가짜 분석 결과 (위험 결과·사람 없음) */
const screenFor = (documents, uploadSlots = ['registry', 'lease']) => {
  const analysis = { documents, fields: {}, personGroups: [], riskResults: [], findings: [], files: [] };
  const state = /** @type {any} */ ({ ...initialState(), step: 'results', analysis, uploadSlots, uploadParts: null });
  const act = { setPersonAnswers: vi.fn(), goTo: vi.fn(), restart: vi.fn() };
  return { node: resultsScreen(state, /** @type {any} */ (act)), act };
};

describe('② 결과 화면: 역할 이름·가명 설명 (9번)', () => {
  it('"How to read the results" 칸에 Owner·Landlord·가명·Could not check 설명이 있다 (프로토타입 v2 오른쪽 칸, #382)', () => {
    const { node } = screenFor([REG, LEASE]);
    const legend = node.querySelector('#role-legend');
    expect(legend).not.toBeNull();
    expect(legend?.closest('section.card')?.querySelector('h2')?.textContent).toBe('How to read the results');
    const text = legend?.textContent ?? '';
    for (const term of ['Owner', 'Landlord', '[Owner_A]', 'Could not check']) expect(text).toContain(term);
    // "Could not check"가 "문제 없음"으로 읽히지 않게
    expect(text).toContain('does not mean there is no problem');
    expect(text).not.toMatch(/\bsafe\b/i);
  });

  it('등기부를 넣지 않았으면 Owner·Previous owner 설명을 빼고, 가명 예시도 계약서 역할로 (v2 의견)', () => {
    const text = screenFor([LEASE], ['lease']).node.querySelector('#role-legend')?.textContent ?? '';
    expect(text).not.toMatch(/\bOwner\b/);
    expect(text).not.toContain('Previous owner');
    expect(text).not.toContain('[Owner_A]');
    for (const term of ['Landlord', '[Landlord_B]', 'Could not check']) expect(text).toContain(term);
    // 등기부가 없어서 못 본 것도 "Could not check"라는 걸 알려 주고, 문제없다는 뜻이 아니라고 한다
    expect(text).toContain('was not added');
    expect(text).toContain('does not mean there is no problem');
  });
});

describe('② 결과 화면: 다시 올리러 가는 버튼 (10번)', () => {
  it('칸과 종류가 맞으면 버튼이 없다', () => {
    expect(screenFor([REG, LEASE]).node.querySelector('#back-to-upload')).toBeNull();
  });

  it('칸에 다른 서류를 넣었으면 Documents 카드에 버튼이 있고, 누르면 ① 화면으로 간다', () => {
    const { node, act } = screenFor([LEASE, LEASE]);
    const back = /** @type {HTMLButtonElement | null} */ (node.querySelector('#back-to-upload'));
    expect(back?.textContent).toBe('Go back and choose the right file');
    expect(back?.closest('section.card')?.querySelector('h2')?.textContent).toBe('Documents');
    expect(back?.classList.contains('secondary')).toBe(true);
    back?.click();
    expect(act.goTo).toHaveBeenCalledWith('upload');
  });

  it('등기부도 계약서도 아닌 서류는 크게 알리고 버튼을 기본(눈에 띄는) 버튼으로 둔다', () => {
    const { node } = screenFor([REG, UNKNOWN]);
    const notice = node.querySelector('#unknown-doc-notice');
    expect(notice?.getAttribute('role')).toBe('alert');
    expect(notice?.querySelector('strong')?.textContent).toBe('We could not recognize 1 document.');
    expect(notice?.textContent).toContain('Could not check');
    const back = node.querySelector('#back-to-upload');
    expect(back?.classList.contains('secondary')).toBe(false);
    // 버튼은 하나만
    expect(node.querySelectorAll('#back-to-upload')).toHaveLength(1);
  });

  it('모르는 서류가 2개면 복수형', () => {
    const { node } = screenFor([UNKNOWN, UNKNOWN]);
    expect(node.querySelector('#unknown-doc-notice strong')?.textContent).toBe('We could not recognize 2 documents.');
  });
});
