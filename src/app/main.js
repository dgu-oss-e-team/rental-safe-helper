// @ts-check
/**
 * PART 5. 앱 시작점: 단계별 화면과 상태 연결
 *
 * 단계: ① 서류 올리기 → ② 위험 점검 결과 → ③ 목적 선택 → ④ 보내기 전 확인 → ⑤ 다운로드·AI 상담
 * 화면 문구는 영어(제안서 기준). 서류 텍스트는 textContent로만 넣는다(ui.js의 el()).
 * 다른 파트 UI(위험 결과 카드, 마스킹 확인, OCR 수정)는 slots.js의 자리에 연결한다.
 * TODO(PART 5): PART 1 ocr-editor가 생기면 ①과 ② 사이에 "OCR 결과 확인" 단계를 넣는다 (사진 업로드일 때만).
 */

import './style.css';
import { appState, initialState } from './app-state.js';
import { emptyEdits, normalizeEdits, editsAfterPurposeChange } from './masking-edits.js';
import { el, button, stepper, disclaimer, card, actions } from './ui.js';
import { uploadScreen } from './screens/upload.js';
import { resultsScreen } from './screens/results.js';
import { purposeScreen } from './screens/purpose.js';
import { reviewScreen } from './screens/review.js';
import { doneScreen } from './screens/done.js';

/** 단계 이름 → 사용자에게 보여 줄 실패 안내 */
const STEP_TEXT = {
  loading: 'loading the document tools',
  input: 'choosing files',
  readDocument: 'reading the documents',
  classifyDocument: 'recognizing the document type',
  detectPII: 'finding personal information',
  extractFields: 'reading the document items',
  matchPeople: 'matching people',
  assessRisks: 'checking risks',
  createMaskingPlan: 'hiding personal information',
  applyMaskingPlan: 'hiding personal information',
  validateMaskedText: 'checking that nothing is left',
  buildPrompt: 'writing the AI prompt',
};

/**
 * 화면에서 부르는 동작 모음
 * @typedef {Object} Actions
 * @property {(patch: Partial<{ registry: File | null, lease: File | null }>) => void} setFiles
 * @property {() => Promise<void>} analyze
 * @property {() => Promise<void>} analyzeSample
 * @property {(step: 'upload' | 'results' | 'purpose' | 'review' | 'done') => void} goTo
 * @property {(purpose: string) => void} setPurpose
 * @property {() => Promise<void>} prepare
 * @property {(edits: import('./masking-edits.js').MaskingEdits) => Promise<void>} setMaskingEdits  PART 4 확인 화면의 onChange
 * @property {(checked: boolean) => void} setReviewed
 * @property {() => Promise<void>} finish
 * @property {() => void} restart
 */

/**
 * 실패 결과를 화면 상태로 바꾼다. (메시지에는 개인정보가 들어가지 않도록 각 파트가 영어 안내만 넣는다)
 * @param {{ step?: string, error: { code: string, message: string } }} r
 */
const toError = (r) => ({ step: r.step, ...r.error });

/**
 * 처리 코드(파이프라인)는 처음 쓸 때 불러온다.
 * PDF·OCR 도구가 커서(약 600KB) 처음부터 실으면 휴대폰에서 첫 화면이 늦게 뜬다.
 * 파일을 고르기 시작하면 미리 받아 두고, 실패하면 다음에 다시 시도한다.
 * @type {Promise<typeof import('./pipeline.js')> | undefined}
 */
let pipelineModule;
function loadPipeline() {
  pipelineModule ??= import('./pipeline.js').catch((e) => {
    pipelineModule = undefined;
    throw e;
  });
  return pipelineModule;
}

/**
 * 파이프라인을 불러와서 쓴다. 불러오지 못하면(인터넷 끊김 등) 오류 화면을 보여 주고 null을 돌려준다.
 * @returns {Promise<typeof import('./pipeline.js') | null>}
 */
async function pipeline() {
  try {
    return await loadPipeline();
  } catch {
    appState.setState({
      busy: null,
      error: { step: 'loading', code: 'LOAD_FAILED', message: 'Please check your internet connection and try again.' },
    });
    return null;
  }
}

/** 미리보기 이미지 주소(blob:). 새로 만들거나 처음부터 다시 할 때 이전 주소를 풀어 메모리를 돌려준다 */
/** @type {string[]} */
let previewUrls = [];
function releasePreviews() {
  previewUrls.forEach((u) => URL.revokeObjectURL(u));
  previewUrls = [];
}

/**
 * ④ 확인 화면의 마스킹 PDF 미리보기를 만든다. 화면은 먼저 보여 주고 이미지는 다 되면 채운다.
 * 만드는 동안 마스킹이 또 바뀌면(사용자 수정) 이 결과는 버린다.
 */
async function refreshPreviews() {
  const { analysis, prepared } = appState.getState();
  if (!analysis || !prepared) return;
  const p = await pipeline();
  if (!p) return;
  const results = await p.previewMaskedPdfs(analysis, prepared.maskingPlan);
  if (appState.getState().prepared !== prepared) return;

  releasePreviews();
  const docs = results.map((d) => ({
    documentId: d.documentId,
    documentType: d.documentType,
    error: d.result.ok ? null : d.result.error,
    pages: d.result.ok
      ? d.result.data.pages.map((pg) => {
          const url = URL.createObjectURL(pg.blob);
          previewUrls.push(url);
          return { pageIndex: pg.pageIndex, url, width: pg.width, height: pg.height };
        })
      : [],
  }));
  appState.setState({ previews: { forPrepared: prepared, docs } });
}

/** @param {File[]} files */
async function runAnalysis(files) {
  appState.setState({ busy: 'Reading your documents and checking risks…', error: null });
  const p = await pipeline();
  if (!p) return;
  const r = await p.analyzeDocuments({ files });
  // 새 서류면 findingId·blockId가 달라지므로 이전 수정(maskingEdits)도 비운다
  if (r.ok) {
    releasePreviews();
    appState.setState({
      busy: null,
      analysis: r.data,
      prepared: null,
      previews: null,
      maskingEdits: emptyEdits(),
      pdfs: null,
      reviewed: false,
      step: 'results',
    });
  } else appState.setState({ busy: null, error: toError(r) });
}

/** @type {Actions} */
const act = {
  setFiles(patch) {
    appState.setState({ files: { ...appState.getState().files, ...patch }, error: null });
    // 분석 버튼을 누르기 전에 처리 코드를 미리 받아 둔다 (실패는 분석할 때 다시 처리)
    loadPipeline().catch(() => {});
  },
  async analyze() {
    const { registry, lease } = appState.getState().files;
    await runAnalysis(/** @type {File[]} */ ([registry, lease].filter(Boolean)));
  },
  async analyzeSample() {
    // 빈 파일 = 샘플 데이터 (PART 1이 가상 등기부·계약서를 돌려준다)
    await runAnalysis([
      new File([''], 'sample-registry.pdf', { type: 'application/pdf' }),
      new File([''], 'sample-lease.pdf', { type: 'application/pdf' }),
    ]);
  },
  goTo(step) {
    appState.setState({ step, error: null });
  },
  setPurpose(purpose) {
    const state = appState.getState();
    if (purpose === state.purpose) return;
    // 목적이 바뀌면 이전 마스킹 결과는 버리고, 해제(remove)는 새 목적에서 다시 고르게 한다 (더 가린 것은 유지)
    appState.setState({
      purpose,
      maskingEdits: editsAfterPurposeChange(state.maskingEdits),
      prepared: null,
      pdfs: null,
      reviewed: false,
    });
  },
  async prepare() {
    const { analysis, purpose, maskingEdits } = appState.getState();
    if (!analysis) return;
    const p = await pipeline();
    if (!p) return;
    const r = p.prepareForAi(analysis, purpose, maskingEdits);
    if (r.ok) {
      appState.setState({ prepared: r.data, reviewed: false, pdfs: null, step: 'review', error: null });
      refreshPreviews();
    } else appState.setState({ error: toError(r) });
  },
  async setMaskingEdits(edits) {
    const { analysis, purpose } = appState.getState();
    if (!analysis) return;
    const next = normalizeEdits(edits);
    const p = await pipeline();
    if (!p) return;
    // 수정할 때마다 다시 가려서 미리보기를 바꾼다. 바뀐 내용은 다시 확인해야 하므로 체크를 푼다.
    const r = p.prepareForAi(analysis, purpose, next);
    // 실패하면(예: 남은 개인정보 검사 실패) 이전 수정과 미리보기를 그대로 두고 오류만 보여 준다
    if (r.ok) {
      appState.setState({ maskingEdits: next, prepared: r.data, reviewed: false, pdfs: null, error: null });
      refreshPreviews();
    } else appState.setState({ error: toError(r) });
  },
  setReviewed(checked) {
    appState.setState({ reviewed: checked });
  },
  async finish() {
    const { analysis, prepared } = appState.getState();
    if (!analysis || !prepared) return;
    appState.setState({ busy: 'Creating the masked PDF…', error: null });
    const p = await pipeline();
    if (!p) return;
    const pdfs = await p.exportMaskedPdfs(analysis, prepared.maskingPlan);
    appState.setState({ busy: null, pdfs, step: 'done' });
  },
  restart() {
    releasePreviews();
    appState.setState(initialState());
  },
};

const SCREENS = {
  upload: uploadScreen,
  results: resultsScreen,
  purpose: purposeScreen,
  review: reviewScreen,
  done: doneScreen,
};

const app = /** @type {HTMLElement} */ (document.querySelector('#app'));

/** @param {{ step?: string, code: string, message: string }} error */
function errorCard(error) {
  return card(
    'Something went wrong',
    [
      el('p', {}, [`We stopped while ${STEP_TEXT[error.step ?? ''] ?? 'processing'}.`]),
      el('p', { class: 'hint' }, [`${error.message} (${error.code})`]),
      actions([button('Start over', () => act.restart(), { variant: 'secondary' })]),
    ],
    'error-card',
  );
}

function render() {
  const state = appState.getState();
  const screen = SCREENS[state.step] ?? uploadScreen;
  const parts = [
    el('header', {}, [el('h1', {}, ['Rental Safety Helper']), disclaimer()]),
    stepper(state.step),
    state.busy ? el('p', { class: 'busy', role: 'status' }, [el('span', { class: 'spinner', 'aria-hidden': 'true' }), state.busy]) : null,
    state.error ? errorCard(state.error) : null,
    state.busy ? null : screen(state, act),
  ];
  app.replaceChildren(.../** @type {HTMLElement[]} */ (parts.filter(Boolean)));
  // 단계가 바뀌면 화면 맨 위로 (휴대폰에서 다음 단계가 아래에 숨지 않게)
  if (render.lastStep !== state.step) window.scrollTo({ top: 0 });
  render.lastStep = state.step;
}
/** @type {string | undefined} */
render.lastStep = undefined;

appState.subscribe(render);
render();
