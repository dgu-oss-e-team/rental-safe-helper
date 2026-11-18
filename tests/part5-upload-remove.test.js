// @vitest-environment happy-dom
// PART 5. ① 화면: 올린 파일 지우기·바꾸기 (#188). 가상 파일 이름만 사용한다.
import { describe, it, expect, vi } from 'vitest';
import { uploadScreen } from '../src/app/screens/upload.js';
import { initialState } from '../src/app/app-state.js';

const fakeAct = () => /** @type {any} */ ({ setFiles: vi.fn(), analyze: vi.fn(), analyzeSample: vi.fn(), goTo: vi.fn() });
const file = (name) => new File([''], name, { type: 'application/pdf' });
/** @param {{ registry?: File | null, lease?: File | null }} files */
const screenWith = (files, act = fakeAct()) => ({
  act,
  node: uploadScreen(/** @type {any} */ ({ ...initialState(), files: { registry: null, lease: null, ...files } }), act),
});

describe('PART 5 ① 화면: 올린 파일 지우기 (#188)', () => {
  it('파일이 없으면 Remove 버튼이 없다', () => {
    const { node } = screenWith({});
    expect(node.querySelector('#registry-file-remove')).toBeNull();
    expect(node.querySelector('#lease-file-remove')).toBeNull();
  });

  it('파일을 고른 칸에만 Remove 버튼이 있고, 화면 낭독기용 이름으로 어느 칸인지 알 수 있다', () => {
    const { node } = screenWith({ lease: file('가상_계약서.pdf') });
    expect(node.querySelector('#registry-file-remove')).toBeNull();
    const remove = node.querySelector('#lease-file-remove');
    expect(remove?.textContent).toBe('Remove');
    expect(remove?.getAttribute('aria-label')).toBe('Remove the lease contract file');
    expect(remove?.getAttribute('type')).toBe('button');
  });

  it('Remove를 누르면 그 칸만 비운다 (다른 칸은 그대로)', () => {
    const { node, act } = screenWith({ registry: file('가상_등기부.pdf'), lease: file('가상_계약서.pdf') });
    /** @type {HTMLButtonElement} */ (node.querySelector('#registry-file-remove')).click();
    expect(act.setFiles).toHaveBeenCalledTimes(1);
    expect(act.setFiles).toHaveBeenCalledWith({ registry: null });
  });

  it('지운 뒤 같은 칸의 파일 선택으로 포커스를 옮긴다 (키보드 사용자)', () => {
    const { node } = screenWith({ registry: file('가상_등기부.pdf') });
    document.body.replaceChildren(node);
    /** @type {HTMLButtonElement} */ (node.querySelector('#registry-file-remove')).click();
    expect(document.activeElement?.id).toBe('registry-file');
  });

  it('고른 파일이 있으면 이름과 "Change file" 버튼을 보여 준다', () => {
    const { node } = screenWith({ registry: file('가상_등기부.pdf') });
    expect(node.querySelector('#registry-file-status')?.textContent).toBe('가상_등기부.pdf');
    expect(node.querySelector('label.file-button[for="registry-file"]')?.textContent).toBe('Change file');
  });

  it('파일 칸 글자는 영어다 (브라우저 기본 "파일 선택 / 선택된 파일 없음" 대신)', () => {
    const { node } = screenWith({});
    expect(node.querySelector('label.file-button[for="lease-file"]')?.textContent).toBe('Choose file');
    expect(node.querySelector('#lease-file-status')?.textContent).toBe('No file chosen');
    // 기본 파일 칸은 숨기지만 키보드·화면 낭독기로 쓸 수 있게 남겨 두고, 상태 글과 연결한다
    const input = node.querySelector('#lease-file');
    expect(input?.classList.contains('file-input')).toBe(true);
    expect(input?.getAttribute('aria-describedby')).toBe('lease-file-status');
  });

  it('Remove는 주 버튼보다 눈에 덜 띄는 글자 버튼이다', () => {
    const { node } = screenWith({ lease: file('a.pdf') });
    const remove = node.querySelector('#lease-file-remove');
    expect(remove?.classList.contains('link-button')).toBe(true);
    expect(remove?.closest('.file-row')).not.toBeNull();
  });

  it('두 칸이 다 비면 "Check my documents" 버튼이 잠긴다', () => {
    expect(/** @type {HTMLButtonElement} */ (screenWith({}).node.querySelector('#run')).disabled).toBe(true);
    expect(/** @type {HTMLButtonElement} */ (screenWith({ lease: file('a.pdf') }).node.querySelector('#run')).disabled).toBe(false);
  });
});

describe('PART 5 ① 화면: 파일 바꾸기 (#188)', () => {
  /** 파일 선택 칸에 파일을 넣은 것처럼 change를 보낸다 */
  const choose = (/** @type {HTMLInputElement} */ input, /** @type {File[]} */ files) => {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  };

  it('다른 파일을 고르면 그 칸이 새 파일로 바뀐다', () => {
    const { node, act } = screenWith({ lease: file('old.pdf') });
    choose(/** @type {HTMLInputElement} */ (node.querySelector('#lease-file')), [file('new.pdf')]);
    expect(act.setFiles).toHaveBeenCalledWith({ lease: expect.objectContaining({ name: 'new.pdf' }) });
  });

  it('고르기 창에서 취소해서 빈 change가 와도 고른 파일을 지우지 않는다 (지우기는 Remove로만)', () => {
    const { node, act } = screenWith({ lease: file('old.pdf') });
    choose(/** @type {HTMLInputElement} */ (node.querySelector('#lease-file')), []);
    expect(act.setFiles).not.toHaveBeenCalled();
  });
});
