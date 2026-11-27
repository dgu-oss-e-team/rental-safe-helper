// @vitest-environment happy-dom
// PART 5. ① 화면: 목적을 먼저 고르고, 목적에 맞는 서류 칸 보여 주기 (기능 개선 목록 1번, #380)
// 가상 데이터만 사용한다. (파일은 내용 없는 가짜 File)
import { describe, it, expect, vi } from 'vitest';
import { uploadScreen } from '../src/app/screens/upload.js';
import { initialState } from '../src/app/app-state.js';
import { PURPOSES, missingDocNotices, purposeInfo } from '../src/app/purposes.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

const fakeAct = () =>
  /** @type {any} */ ({ setFiles: vi.fn(), analyze: vi.fn(), analyzeSample: vi.fn(), goTo: vi.fn(), setPurpose: vi.fn() });

/** @param {Record<string, unknown>} patch */
const stateWith = (patch) => /** @type {any} */ ({ ...initialState(), ...patch });
const pdf = (name) => new File(['x'], name, { type: 'application/pdf' });
const needs = (node) => [node.querySelector('#registry-file-need')?.textContent, node.querySelector('#lease-file-need')?.textContent];

describe('PART 5 ① 목적 카드 (#380)', () => {
  it('목적 카드가 서류 칸보다 위에 있고, 3개다', () => {
    const node = uploadScreen(initialState(), fakeAct());
    const sections = [...node.querySelectorAll('section.card h2')].map((h) => h.textContent);
    expect(sections).toEqual(['What do you want to do?', 'Upload your documents']);
    expect(node.querySelectorAll('.purpose-card input[type=radio]').length).toBe(3);
  });

  it('기본 선택은 사기 위험 확인이고 "Recommended" 표시가 있다', () => {
    const node = uploadScreen(initialState(), fakeAct());
    const checked = /** @type {HTMLInputElement} */ (node.querySelector('.purpose-card input:checked'));
    expect(checked.value).toBe(MASKING_PURPOSE.FRAUD_CHECK);
    expect(checked.closest('.purpose-card')?.querySelector('.chip-recommended')?.textContent).toBe('Recommended');
    expect(node.querySelectorAll('.chip-recommended').length).toBe(1);
  });

  it('카드마다 예시 질문 2개와 필요한 서류(Needs) 한 줄', () => {
    const node = uploadScreen(initialState(), fakeAct());
    for (const label of node.querySelectorAll('.purpose-card')) {
      expect(label.querySelectorAll('.purpose-questions li').length).toBe(2);
      expect(label.textContent).toContain('Needs:');
    }
  });

  it('카드를 고르면 setPurpose로 목적을 저장한다 (결과 이후 AI 준비에 그대로 쓰임)', () => {
    const act = fakeAct();
    const node = uploadScreen(initialState(), act);
    const input = /** @type {HTMLInputElement} */ (node.querySelector(`input[value="${MASKING_PURPOSE.CONTRACT_EXPLANATION}"]`));
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(act.setPurpose).toHaveBeenCalledWith(MASKING_PURPOSE.CONTRACT_EXPLANATION);
  });

  it('저장된 목적이 다시 그릴 때 선택돼 있다', () => {
    const node = uploadScreen(stateWith({ purpose: MASKING_PURPOSE.CLAUSE_EXPLANATION }), fakeAct());
    expect(/** @type {HTMLInputElement} */ (node.querySelector('.purpose-card input:checked')).value).toBe(MASKING_PURPOSE.CLAUSE_EXPLANATION);
  });
});

describe('PART 5 ① 목적에 맞는 서류 칸 (#380)', () => {
  it('사기 위험 확인: 등기부 Required + 계약서 Required', () => {
    const node = uploadScreen(stateWith({ purpose: MASKING_PURPOSE.FRAUD_CHECK }), fakeAct());
    expect(needs(node)).toEqual(['Required', 'Required']);
    expect(node.querySelector('#registry-file-extra')).toBeNull();
  });

  it('조항·용어 설명: 둘 다 Optional, "하나만 올려도 된다" 안내', () => {
    const node = uploadScreen(stateWith({ purpose: MASKING_PURPOSE.CLAUSE_EXPLANATION }), fakeAct());
    expect(needs(node)).toEqual(['Optional', 'Optional']);
    expect(node.textContent).toContain('One is enough');
  });

  it('계약 조건 설명: 계약서 Required, 등기부 Recommended + "점검에만 쓰고 AI로 안 보냄" 한 줄', () => {
    const node = uploadScreen(stateWith({ purpose: MASKING_PURPOSE.CONTRACT_EXPLANATION }), fakeAct());
    expect(needs(node)).toEqual(['Recommended', 'Required']);
    const extra = node.querySelector('#registry-file-extra')?.textContent ?? '';
    expect(extra).toContain('recommended');
    expect(extra).toContain('not sent to AI');
  });

  it('등기부 칸에 받는 곳과 PDF 추천', () => {
    const hint = uploadScreen(initialState(), fakeAct()).querySelector('#registry-file-hint')?.textContent ?? '';
    expect(hint).toContain('iros.go.kr');
    expect(hint).toContain('PDF recommended');
  });

  it('촬영 팁은 기본으로 접혀 있다', () => {
    const tips = uploadScreen(initialState(), fakeAct()).querySelector('details.photo-tips');
    expect(tips).not.toBeNull();
    expect(/** @type {HTMLDetailsElement} */ (tips).open).toBe(false);
  });
});

describe('PART 5 ① 필요한 서류가 없어도 막지 않는다 (#380)', () => {
  it('사기 위험 확인인데 계약서만 있으면: 안내가 나오고 "Check my documents"는 켜져 있다', () => {
    const node = uploadScreen(stateWith({ files: { registry: null, lease: pdf('lease.pdf') } }), fakeAct());
    expect(node.querySelector('#upload-missing')?.textContent).toContain('property register');
    expect(node.querySelector('#upload-missing')?.getAttribute('role')).toBe('status');
    expect(/** @type {HTMLButtonElement} */ (node.querySelector('#run')).disabled).toBe(false);
  });

  it('서류가 하나도 없으면 안내 없이 버튼만 꺼져 있다 (지금과 같음)', () => {
    const node = uploadScreen(initialState(), fakeAct());
    expect(node.querySelector('#upload-missing')).toBeNull();
    expect(/** @type {HTMLButtonElement} */ (node.querySelector('#run')).disabled).toBe(true);
  });

  it('조항·용어 설명은 하나만 있어도 안내가 없다', () => {
    expect(missingDocNotices(MASKING_PURPOSE.CLAUSE_EXPLANATION, { registry: pdf('r.pdf'), lease: null })).toEqual([]);
    expect(missingDocNotices(MASKING_PURPOSE.CLAUSE_EXPLANATION, { registry: null, lease: pdf('l.pdf') })).toEqual([]);
  });

  it('계약 조건 설명에서 등기부가 없으면 "소유자 확인을 못 한다" 안내, 계약서가 없으면 Required 안내', () => {
    const noReg = missingDocNotices(MASKING_PURPOSE.CONTRACT_EXPLANATION, { registry: null, lease: pdf('l.pdf') });
    expect(noReg).toHaveLength(1);
    expect(noReg[0]).toContain('landlord is the owner');
    const noLease = missingDocNotices(MASKING_PURPOSE.CONTRACT_EXPLANATION, { registry: pdf('r.pdf'), lease: null });
    expect(noLease).toHaveLength(1);
    expect(noLease[0]).toContain('lease contract');
  });

  it('둘 다 있으면 안내가 없다', () => {
    for (const p of PURPOSES) expect(missingDocNotices(p.value, { registry: pdf('r.pdf'), lease: pdf('l.pdf') })).toEqual([]);
  });

  it('안내에 파일 이름을 넣지 않는다 (개인정보가 있을 수 있음)', () => {
    const node = uploadScreen(stateWith({ files: { registry: null, lease: pdf('가상_계약서_홍길동.pdf') } }), fakeAct());
    expect(node.querySelector('#upload-missing')?.textContent).not.toContain('홍길동');
  });

  it('모르는 목적 값이면 기본(사기 위험 확인)으로 본다', () => {
    expect(purposeInfo('NOPE').value).toBe(MASKING_PURPOSE.FRAUD_CHECK);
  });
});
