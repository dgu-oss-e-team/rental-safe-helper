// @vitest-environment happy-dom
// PART 5. ① 화면의 "Back to your results" 안내 (#124). 화면(DOM) 테스트 예시 (#131)
// 가상 데이터만 사용한다. (서류 내용 없이 "결과가 있다"는 표시만 넣는다)
import { describe, it, expect, vi } from 'vitest';
import { uploadScreen } from '../src/app/screens/upload.js';
import { initialState } from '../src/app/app-state.js';

/** 화면에서 부르는 동작 (가짜) */
const fakeAct = () =>
  /** @type {any} */ ({ setFiles: vi.fn(), analyze: vi.fn(), analyzeSample: vi.fn(), goTo: vi.fn() });

/** @param {Record<string, unknown>} patch */
const stateWith = (patch) => /** @type {any} */ ({ ...initialState(), ...patch });

describe('PART 5 ① 화면: 이전 결과로 돌아가기 (#124)', () => {
  it('처음 들어오면(결과 없음) 안내가 없고 목적 고르기가 맨 위다 (#380)', () => {
    const node = uploadScreen(initialState(), fakeAct());
    expect(node.querySelector('#back-to-results')).toBeNull();
    expect(node.querySelector('.resume-card')).toBeNull();
    expect(node.querySelector('section.start-section > h2')?.textContent).toBe('What do you want to do?');
  });

  it('이전 결과가 있으면 안내가 업로드 칸 위에 나오고, 결과가 바뀐다는 말도 있다', () => {
    const node = uploadScreen(stateWith({ analysis: {} }), fakeAct());
    const first = node.querySelector('section.card');
    expect(first?.classList.contains('resume-card')).toBe(true);
    expect(first?.textContent).toContain('these results will be replaced');
  });

  it('버튼은 보조 버튼이다 (새 서류 확인이 ①의 주된 일이므로 "Check my documents"보다 눈에 덜 띄게)', () => {
    const node = uploadScreen(stateWith({ analysis: {} }), fakeAct());
    expect(node.querySelector('#back-to-results')?.classList.contains('secondary')).toBe(true);
    expect(node.querySelector('#run')?.classList.contains('secondary')).toBe(false);
  });

  it('누르면 결과가 있는 가장 먼 단계로 간다 (②·④·⑤)', () => {
    for (const [patch, step] of /** @type {const} */ ([
      [{ analysis: {} }, 'results'],
      [{ analysis: {}, prepared: {} }, 'review'],
      [{ analysis: {}, prepared: {}, pdfs: [] }, 'done'],
    ])) {
      const act = fakeAct();
      const node = uploadScreen(stateWith(patch), act);
      /** @type {HTMLButtonElement} */ (node.querySelector('#back-to-results')).click();
      expect(act.goTo).toHaveBeenCalledWith(step);
    }
  });

  it('안내에 파일 이름을 넣지 않는다 (개인정보가 있을 수 있음)', () => {
    const file = new File([''], '가상_임대차계약서_홍길동.pdf', { type: 'application/pdf' });
    const node = uploadScreen(stateWith({ analysis: {}, files: { registry: null, lease: file } }), fakeAct());
    expect(node.querySelector('.resume-card')?.textContent).not.toContain('홍길동');
  });
  it('사진 촬영 안내(.photo-tips)가 파일 선택 칸 위에 표시된다 (PART 1)', () => {
    const node = uploadScreen(initialState(), fakeAct());
    const tips = node.querySelector('.photo-tips');
    expect(tips).not.toBeNull();
    expect(tips?.querySelectorAll('li').length).toBe(4);
    expect(tips?.textContent).toContain('Tips for taking a clear photo');
  });
});
