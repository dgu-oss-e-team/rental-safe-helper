// @vitest-environment happy-dom
// PART 5. ① 화면: 사진 여러 장 올리기와 미리 보기 (#268). 가상 파일 이름만 사용한다.
import { describe, it, expect, vi } from 'vitest';
import { uploadScreen } from '../src/app/screens/upload.js';
import { initialState } from '../src/app/app-state.js';
import { PHOTO_NOTICE } from '../src/app/photo-pages.js';

const fakeAct = () => /** @type {any} */ ({ setFiles: vi.fn(), analyze: vi.fn(), analyzeSample: vi.fn(), goTo: vi.fn() });
const photo = (name) => new File(['x'], name, { type: 'image/jpeg' });
const pdf = (name) => new File(['x'], name, { type: 'application/pdf' });
const screenWith = (files, extra = {}, act = fakeAct()) => ({
  act,
  node: uploadScreen(/** @type {any} */ ({ ...initialState(), files: { registry: null, lease: null, ...files }, ...extra }), act),
});
const choose = (/** @type {HTMLInputElement} */ input, /** @type {File[]} */ files) => {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
};

describe('PART 5 ① 화면: 사진 여러 장 (#268)', () => {
  it('파일 칸은 여러 개를 한 번에 고를 수 있다', () => {
    expect(screenWith({}).node.querySelector('#registry-file')?.hasAttribute('multiple')).toBe(true);
  });

  it('사진이 있는 칸에서 사진을 더 고르면 뒤에 덧붙인다 (바꿔치기 하지 않음)', () => {
    const p1 = photo('p1.jpg');
    const { node, act } = screenWith({ registry: [p1] });
    choose(/** @type {HTMLInputElement} */ (node.querySelector('#registry-file')), [photo('p2.jpg')]);
    const [patch, notice] = act.setFiles.mock.calls[0];
    expect(patch.registry.map((f) => f.name)).toEqual(['p1.jpg', 'p2.jpg']);
    expect(notice).toBeNull();
  });

  it('이미 올린 사진을 다시 고르면 덧붙이지 않고 그 칸 아래에 안내한다 (#287)', () => {
    const p1 = new File(['x'], 'p1.jpg', { type: 'image/jpeg', lastModified: 1 });
    const { node, act } = screenWith({ registry: [p1] });
    choose(/** @type {HTMLInputElement} */ (node.querySelector('#registry-file')), [new File(['x'], 'p1.jpg', { type: 'image/jpeg', lastModified: 1 })]);
    const [patch, notice] = act.setFiles.mock.calls[0];
    expect(patch.registry).toHaveLength(1);
    expect(notice).toEqual({ slot: 'registry', text: PHOTO_NOTICE.DUPLICATE });
  });

  it('사진이 있으면 버튼이 "Add another page"이고, 몇 장(몇 쪽)인지 보여 준다', () => {
    const { node } = screenWith({ registry: [photo('p1.jpg'), photo('p2.jpg'), photo('p3.jpg')] });
    expect(node.querySelector('label.file-button[for="registry-file"]')?.textContent).toBe('Add another page');
    expect(node.querySelector('#registry-file-status')?.textContent).toBe('3 photos (3 pages)');
    expect(screenWith({ lease: [photo('p1.jpg')] }).node.querySelector('#lease-file-status')?.textContent).toBe('1 photo (1 page)');
  });

  it('사진마다 쪽 번호가 붙은 미리 보기가 순서대로 나온다', () => {
    const { node } = screenWith({ registry: [photo('p1.jpg'), photo('p2.jpg')] });
    const items = node.querySelectorAll('#registry-file-pages li');
    expect(items).toHaveLength(2);
    expect([...items].map((li) => li.querySelector('.photo-page-label')?.textContent)).toEqual(['Page 1', 'Page 2']);
    expect(node.querySelector('#registry-file-page-1')?.getAttribute('aria-label')).toBe('View page 2');
  });

  it('미리 보기를 누르면 크게 보기 창이 열리고, Close로 닫힌다', () => {
    const { node } = screenWith({ lease: [photo('p1.jpg'), photo('p2.jpg')] });
    document.body.replaceChildren(node);
    /** @type {HTMLButtonElement} */ (node.querySelector('#lease-file-page-1')).click();
    const dialog = /** @type {HTMLDialogElement} */ (node.querySelector('#file-viewer'));
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.querySelector('.viewer-caption')?.textContent).toBe('Page 2 of the lease contract (your photo)');
    /** @type {HTMLButtonElement} */ (node.querySelector('#file-viewer-close')).click();
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('한 장만 지우면 나머지는 그대로, "Remove all"은 칸을 비운다', () => {
    const list = [photo('p1.jpg'), photo('p2.jpg'), photo('p3.jpg')];
    const { node, act } = screenWith({ registry: list });
    /** @type {HTMLButtonElement} */ (node.querySelector('#registry-file-remove-1')).click();
    expect(act.setFiles.mock.calls[0][0].registry.map((f) => f.name)).toEqual(['p1.jpg', 'p3.jpg']);
    expect(node.querySelector('#registry-file-remove-1')?.getAttribute('aria-label')).toBe('Remove page 2 of the property register');

    const all = node.querySelector('#registry-file-remove');
    expect(all?.textContent).toBe('Remove all');
    /** @type {HTMLButtonElement} */ (all).click();
    expect(act.setFiles).toHaveBeenLastCalledWith({ registry: null }, null);
  });

  it('지원하지 않는 파일을 고르면 칸은 그대로 두고 그 칸 아래에 안내한다', () => {
    const p1 = photo('p1.jpg');
    const { node, act } = screenWith({ lease: [p1] });
    choose(/** @type {HTMLInputElement} */ (node.querySelector('#lease-file')), [new File(['x'], 'a.heic', { type: 'image/heic' })]);
    expect(act.setFiles).toHaveBeenCalledWith({ lease: [p1] }, { slot: 'lease', text: PHOTO_NOTICE.UNSUPPORTED });

    const shown = screenWith({ lease: [p1] }, { uploadNotice: { slot: 'lease', text: PHOTO_NOTICE.UNSUPPORTED } }).node;
    expect(shown.querySelector('#lease-file-notice')?.textContent).toBe(PHOTO_NOTICE.UNSUPPORTED);
    expect(shown.querySelector('#lease-file-notice')?.getAttribute('role')).toBe('status');
    expect(shown.querySelector('#registry-file-notice')).toBeNull();
  });

  it('계약서 PDF가 있는 칸에 특약 별지 사진·PDF를 더 고르면 뒤에 덧붙인다 (#298)', () => {
    const lease = pdf('lease.pdf');
    const { node, act } = screenWith({ lease });
    choose(/** @type {HTMLInputElement} */ (node.querySelector('#lease-file')), [photo('terms.jpg')]);
    const [patch, notice] = act.setFiles.mock.calls[0];
    expect(patch.lease.map((f) => f.name)).toEqual(['lease.pdf', 'terms.jpg']);
    expect(notice).toBeNull();
  });

  it('PDF·사진이 섞인 칸: 상태 글, "Add another file", PDF는 새 탭으로 보기, 하나씩 지우기 (#298)', () => {
    const lease = pdf('lease.pdf');
    const terms = photo('terms.jpg');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { node, act } = screenWith({ lease: [lease, terms] });
    expect(node.querySelector('#lease-file-status')?.textContent).toBe('1 PDF, 1 photo');
    expect(node.querySelector('label.file-button[for="lease-file"]')?.textContent).toBe('Add another file');
    expect(node.querySelector('#lease-file-pages')?.getAttribute('aria-label')).toBe('Files of the lease contract, in page order');
    expect(node.querySelector('#lease-file-remove')?.getAttribute('aria-label')).toBe('Remove all files of the lease contract');

    const first = /** @type {HTMLButtonElement} */ (node.querySelector('#lease-file-page-0'));
    expect(first.classList.contains('pdf-thumb')).toBe(true);
    expect(first.getAttribute('aria-label')).toBe('View file 1 (PDF)');
    first.click();
    expect(open).toHaveBeenCalledWith(expect.any(String), '_blank', 'noopener');
    open.mockRestore();
    expect(node.querySelector('#lease-file-page-1 img')).not.toBeNull();
    expect([...node.querySelectorAll('.photo-page-label')].map((n) => n.textContent)).toEqual(['File 1', 'File 2']);

    // 사진을 빼면 PDF 한 개로 돌아간다
    const rm = /** @type {HTMLButtonElement} */ (node.querySelector('#lease-file-remove-1'));
    expect(rm.getAttribute('aria-label')).toBe('Remove file 2 of the lease contract');
    rm.click();
    expect(act.setFiles).toHaveBeenCalledWith({ lease }, null);
  });

  it('PDF 여러 개면 "2 PDFs"로 보여 준다 (#298)', () => {
    const { node } = screenWith({ lease: [pdf('a.pdf'), pdf('b.pdf')] });
    expect(node.querySelector('#lease-file-status')?.textContent).toBe('2 PDFs');
  });

  it('계약서 칸은 따로 된 특약 쪽(PDF·사진)도 같은 칸에 더하라고 안내한다 (#298)', () => {
    const hint = screenWith({}).node.querySelector('#lease-file-hint')?.textContent ?? '';
    expect(hint).toContain('If the special terms page is a separate PDF or photo, add it here too with "Add another file".');
  });

  it('사진 팁 상자에 휴대폰 문서 스캔을 권하는 선택 팁이 있다 (그냥 사진도 된다고 함께 알림, #272)', () => {
    const tip = screenWith({}).node.querySelector('.photo-tips #scan-tip')?.textContent ?? '';
    expect(tip).toContain('document scan feature');
    expect(tip).toContain('Plain photos work too');
  });

  it('여러 쪽은 카메라로 먼저 다 찍고 사진 보관함에서 한꺼번에 고르라고 안내한다 (#272)', () => {
    const tip = screenWith({}).node.querySelector('.photo-tips #many-pages-tip')?.textContent ?? '';
    expect(tip).toContain('take photos of all pages with your camera first');
    expect(tip).toContain('select them all from your photo library');
  });

  it('PDF는 이름과 "View" 버튼을 보여 준다 (미리 보기 목록은 없음)', () => {
    const { node } = screenWith({ registry: pdf('가상_등기부.pdf') });
    expect(node.querySelector('#registry-file-status')?.textContent).toBe('가상_등기부.pdf');
    expect(node.querySelector('#registry-file-view')?.getAttribute('aria-label')).toBe('View the property register file');
    expect(node.querySelector('#registry-file-pages')).toBeNull();
  });
});
