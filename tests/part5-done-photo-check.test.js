// @vitest-environment happy-dom
// PART 5. ⑤ 완료 화면: 사진·스캔 서류는 다시 확인이 끝나고 결과를 본 뒤에 마스킹 PDF를 받는다 (#314). 가상 데이터만 사용한다.
import { describe, it, expect, vi } from 'vitest';
import { doneScreen, hasCheckWarning } from '../src/app/screens/done.js';
import { initialState } from '../src/app/app-state.js';
import { CHECK_STATUS } from '../src/app/double-check.js';

const fakeAct = () =>
  /** @type {any} */ ({ doubleCheckPdfs: vi.fn(), setPdfChecked: vi.fn(), goTo: vi.fn(), restart: vi.fn() });
const pdf = (documentType) => ({
  documentId: `doc-${documentType}`,
  documentType,
  result: { ok: true, data: { blob: new Blob(['x'], { type: 'application/pdf' }), fileName: `masked-${documentType}.pdf`, pageCount: 2 } },
});
const PDFS = [pdf('REGISTRY'), pdf('LEASE_CONTRACT')];
const analysisOf = (sourceType) => ({ documents: [{ documentId: 'doc-REGISTRY', sourceType }, { documentId: 'doc-LEASE_CONTRACT', sourceType }] });
const result = (documentType, status, extra = {}) => ({ documentId: `doc-${documentType}`, documentType, status, ...extra });

/** @param {any} patch */
const screen = (patch, act = fakeAct()) => ({
  act,
  node: doneScreen(/** @type {any} */ ({ ...initialState(), step: 'done', prepared: { prompt: 'prompt' }, pdfs: PDFS, ...patch }), act),
});
const links = (node) => [...node.querySelectorAll('a.download')];

describe('PART 5 hasCheckWarning() (#314)', () => {
  it('"찾지 못함"이 아닌 결과가 하나라도 있으면 경고', () => {
    expect(hasCheckWarning([result('REGISTRY', CHECK_STATUS.NOT_FOUND)])).toBe(false);
    for (const status of [CHECK_STATUS.MAYBE_VISIBLE, CHECK_STATUS.PARTLY_CHECKED, CHECK_STATUS.UNVERIFIABLE]) {
      expect(hasCheckWarning([result('REGISTRY', CHECK_STATUS.NOT_FOUND), result('LEASE_CONTRACT', status)])).toBe(true);
    }
    expect(hasCheckWarning(null)).toBe(false);
    expect(hasCheckWarning('running')).toBe(false);
  });
});

describe('PART 5 ⑤ 완료 화면: 글자 PDF는 지금과 같다', () => {
  it('다운로드가 바로 나오고, 다시 확인은 원할 때 누른다', () => {
    const { node, act } = screen({ analysis: analysisOf('text_pdf'), doubleCheck: null });
    expect(links(node)).toHaveLength(2);
    expect(node.querySelector('#pdf-checked')).toBeNull();
    const btn = /** @type {HTMLButtonElement} */ (node.querySelector('#double-check'));
    expect(btn.textContent).toBe('Double-check the PDF');
    btn.click();
    expect(act.doubleCheckPdfs).toHaveBeenCalled();
  });

  it('다시 확인에서 경고가 나와도 다운로드를 막지 않는다 (지금과 같음)', () => {
    const { node } = screen({ analysis: analysisOf('text_pdf'), doubleCheck: [result('LEASE_CONTRACT', CHECK_STATUS.MAYBE_VISIBLE, { hits: [{ type: 'PERSON_NAME', pageIndex: 5 }] })] });
    expect(links(node)).toHaveLength(2);
    expect(node.querySelector('#pdf-checked')).toBeNull();
  });
});

describe('PART 5 ⑤ 완료 화면: 사진·스캔 서류는 확인 뒤에 받는다 (#314)', () => {
  it('확인하는 동안에는 다운로드가 없고, 확인 중이라고 알린다', () => {
    const { node } = screen({ analysis: analysisOf('image_pdf'), doubleCheck: 'running' });
    expect(links(node)).toHaveLength(0);
    expect(node.querySelector('#double-check-running')?.textContent).toContain('Checking the masked PDF before you download it');
    expect(node.querySelector('#downloads-wait')).not.toBeNull();
  });

  it('확인이 시작되지 못했으면 시작 버튼을 보여 주고, 다운로드는 아직 없다', () => {
    const { node, act } = screen({ analysis: analysisOf('image_pdf'), doubleCheck: null });
    expect(links(node)).toHaveLength(0);
    const btn = /** @type {HTMLButtonElement} */ (node.querySelector('#double-check'));
    expect(btn.textContent).toBe('Check the masked PDF');
    btn.click();
    expect(act.doubleCheckPdfs).toHaveBeenCalled();
  });

  it('모두 "찾지 못함"이면 체크 없이 바로 받는다', () => {
    const { node } = screen({
      analysis: analysisOf('image_pdf'),
      doubleCheck: [result('REGISTRY', CHECK_STATUS.NOT_FOUND), result('LEASE_CONTRACT', CHECK_STATUS.NOT_FOUND)],
    });
    expect(links(node)).toHaveLength(2);
    expect(node.querySelector('#pdf-checked')).toBeNull();
  });

  it('보일 수 있다는 경고가 있으면 쪽을 알려 주고, 직접 봤다고 체크해야 다운로드가 나온다', () => {
    const doubleCheck = [
      result('REGISTRY', CHECK_STATUS.PARTLY_CHECKED, { unclear: { count: 3, pages: [0, 2] } }),
      result('LEASE_CONTRACT', CHECK_STATUS.MAYBE_VISIBLE, { hits: [{ type: 'PERSON_NAME', pageIndex: 5 }] }),
    ];
    const { node, act } = screen({ analysis: analysisOf('image_pdf'), doubleCheck, pdfChecked: false });
    expect(links(node)).toHaveLength(0);
    expect(node.querySelector('.double-check-results')?.textContent).toContain('page 6');
    expect(node.querySelector('#pdf-check-warning')?.textContent).toContain('photos or scans');

    const box = /** @type {HTMLInputElement} */ (node.querySelector('#pdf-checked'));
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(act.setPdfChecked).toHaveBeenCalledWith(true);

    /** @type {HTMLButtonElement} */ (node.querySelector('#back-to-review')).click();
    expect(act.goTo).toHaveBeenCalledWith('review');

    const checked = screen({ analysis: analysisOf('image_pdf'), doubleCheck, pdfChecked: true }).node;
    expect(links(checked)).toHaveLength(2);
    expect(/** @type {HTMLInputElement} */ (checked.querySelector('#pdf-checked')).checked).toBe(true);
  });

  it('확인하지 못했어도(UNVERIFIABLE) 체크하면 받을 수 있다 (다운로드를 영영 막지 않음)', () => {
    const doubleCheck = [result('REGISTRY', CHECK_STATUS.UNVERIFIABLE), result('LEASE_CONTRACT', CHECK_STATUS.UNVERIFIABLE)];
    expect(links(screen({ analysis: analysisOf('image_pdf'), doubleCheck, pdfChecked: false }).node)).toHaveLength(0);
    expect(links(screen({ analysis: analysisOf('image_pdf'), doubleCheck, pdfChecked: true }).node)).toHaveLength(2);
  });

  it('한 서류만 사진이어도 사진 규칙을 따른다', () => {
    const analysis = { documents: [{ documentId: 'doc-REGISTRY', sourceType: 'text_pdf' }, { documentId: 'doc-LEASE_CONTRACT', sourceType: 'image_pdf' }] };
    expect(links(screen({ analysis, doubleCheck: 'running' }).node)).toHaveLength(0);
  });

  it('경고 문구에 파일 이름이나 개인정보를 넣지 않는다', () => {
    const doubleCheck = [result('LEASE_CONTRACT', CHECK_STATUS.MAYBE_VISIBLE, { hits: [{ type: 'PERSON_NAME', pageIndex: 5 }] })];
    const text = screen({ analysis: analysisOf('image_pdf'), doubleCheck }).node.textContent ?? '';
    expect(text).not.toContain('.pdf');
  });
});
