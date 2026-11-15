// @ts-check
/**
 * PART 5. 앱 시작점: 단계별 화면과 상태 연결
 *
 * 단계: ① 서류 올리기 (→ 사진·스캔이면 "Confirm text") → ② 위험 점검 결과 → ③ 목적 선택 → ④ 보내기 전 확인 → ⑤ 다운로드·AI 상담
 * 화면 문구는 영어(제안서 기준). 서류 텍스트는 textContent로만 넣는다(ui.js의 el()).
 * 다른 파트 UI(위험 결과 카드, 마스킹 확인, OCR 수정)는 slots.js의 자리에 연결한다.
 */

import './style.css';
import { appState, initialState, currentAnalysis } from './app-state.js';
import { errorHelp } from './error-help.js';
import { emptyEdits, normalizeEdits, editsAfterPurposeChange } from './masking-edits.js';
import { el, button, stepper, disclaimer, card, actions } from './ui.js';
import { uploadScreen } from './screens/upload.js';
import { resultsScreen } from './screens/results.js';
import { purposeScreen } from './screens/purpose.js';
import { reviewScreen } from './screens/review.js';
import { doneScreen } from './screens/done.js';
import { confirmScreen } from './screens/confirm.js';
import { slots } from './slots.js';
import { stepFromHash, hashFor, reachableStep, historyAction } from './step-history.js';

/** 단계 이름 → 사용자에게 보여 줄 실패 안내 */
const STEP_TEXT = {
  loading: 'loading the document tools',
  sample: 'loading the sample documents',
  input: 'choosing files',
  readDocument: 'reading the documents',
  classifyDocument: 'recognizing the document type',
  detectPII: 'finding personal information',
  extractFields: 'reading the document items',
  matchPeople: 'matching people',
  applyPersonAnswers: 'applying your answer about who is who',
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
 * @property {() => void} dismissError
 * @property {() => any[]} getOcrDraft  "Confirm text": 지금까지 고친 사진·스캔 서류
 * @property {(docs: any[]) => number} setOcrDraft  PART 1 OCR 수정 화면의 onChange. 남은 흐린 줄 수를 돌려준다
 * @property {(docs: any[]) => number} countOcrLinesToCheck
 * @property {() => Promise<void>} confirmOcr  흐린 줄을 다 확인했으면 분석을 이어서 한다
 * @property {() => void} cancelOcr  ①로 돌아간다 (고른 파일은 그대로)
 * @property {(answers: Record<string, string | null>) => Promise<void>} setPersonAnswers  PART 4 "같은 사람인가요?"의 onChange
 * @property {(purpose: string) => void} setPurpose
 * @property {() => Promise<void>} prepare
 * @property {(edits: import('./masking-edits.js').MaskingEdits) => Promise<void>} setMaskingEdits  PART 4 확인 화면의 onChange
 * @property {(checked: boolean) => void} setReviewed
 * @property {() => Promise<void>} finish
 * @property {() => Promise<void>} doubleCheckPdfs  ⑤ 마스킹 PDF를 OCR로 다시 검사
 * @property {() => void} restart
 */

/** 샘플 버튼이 불러오는 가짜 서류 (public/samples/) */
const SAMPLE_FILES = ['sample-registry.pdf', 'sample-lease.pdf'];

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
/** 불러온 처리 코드 (화면에서 바로 써야 하는 계산용. 불러오기 전에는 null) */
/** @type {typeof import('./pipeline.js') | null} */
let loadedPipeline = null;
function loadPipeline() {
  pipelineModule ??= import('./pipeline.js')
    .then((m) => {
      loadedPipeline = m;
      // PART 1 OCR 수정 화면은 처리 코드와 같이 불러와서 자리에 넣는다 (첫 화면을 가볍게, #43)
      slots.ocrEditor ??= m.renderOcrEditor;
      return m;
    })
    .catch((e) => {
      pipelineModule = undefined;
      throw e;
    });
  return pipelineModule;
}

/**
 * "Confirm text" 단계에서 사용자가 고친 사진·스캔 서류.
 * 글자를 칠 때마다 화면을 다시 그리면 입력 칸 포커스가 사라지므로 상태(appState) 밖에 둔다.
 * (개인정보가 들어 있으므로 메모리에만 두고, 처음부터 다시 하면 비운다)
 * @type {any[]}
 */
let ocrDraft = [];

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

/** 사용자가 가릴 항목을 연달아 바꿀 때, 마지막 수정 뒤 이만큼 기다렸다가 한 번만 그린다 (휴대폰에서 느려지지 않게) */
const PREVIEW_DELAY_MS = 300;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let previewTimer;

/**
 * 미리보기를 다시 그리도록 예약한다. 기다리는 동안 또 부르면 앞의 예약은 취소된다.
 * @param {number} delayMs  0이면 바로 그린다 (④에 처음 들어올 때)
 */
function schedulePreviews(delayMs) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreviews, delayMs);
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

/**
 * 서류를 읽고, 사진·스캔이 있으면 "Confirm text" 단계로, 없으면 바로 분석으로 간다. (#54)
 * @param {File[]} files
 */
async function runAnalysis(files) {
  appState.setState({ busy: 'Reading your documents…', error: null });
  const p = await pipeline();
  if (!p) return;
  // 흐린 줄이 있어도 멈추지 않고 받아서 사용자가 확인하게 한다 (확인 전에는 다음으로 못 감)
  const read = await p.readDocuments({ files }, { allowLowConfidence: true });
  if (!read.ok) {
    appState.setState({ busy: null, error: toError(read) });
    return;
  }
  const ocrIndexes = read.data.documents.map((d, i) => (p.needsTextReview(d) ? i : -1)).filter((i) => i >= 0);
  if (ocrIndexes.length > 0) {
    ocrDraft = structuredClone(ocrIndexes.map((i) => read.data.documents[i]));
    appState.setState({
      busy: null,
      step: 'confirm',
      ocrReview: { read: read.data, files: ocrIndexes.map((i) => read.data.files[i]) },
    });
    return;
  }
  await finishAnalysis(p, read.data);
}

/**
 * 읽은(그리고 확인한) 서류로 나머지 분석을 하고 ② 결과 화면으로 간다.
 * @param {typeof import('./pipeline.js')} p
 * @param {{ files: File[], documents: any[] }} read
 */
async function finishAnalysis(p, read) {
  appState.setState({ busy: 'Checking risks…', error: null });
  const r = p.analyzeReadDocuments(read);
  // 새 서류면 findingId·blockId·personId가 달라지므로 이전 수정(maskingEdits)과 "같은 사람인가요?" 답도 비운다
  if (r.ok) {
    ocrDraft = [];
    releasePreviews();
    appState.setState({
      busy: null,
      analysis: r.data,
      ocrReview: null,
      personAnswers: {},
      checked: null,
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
    // 사이트에 있는 가짜 등기부·계약서 PDF(public/samples)를 받아서 실제 서류처럼 처리한다.
    // (이름·번호·주소는 모두 가짜. 만드는 방법은 scripts/make-sample-pdfs.mjs)
    appState.setState({ busy: 'Loading the sample documents…', error: null });
    loadPipeline().catch(() => {});
    /** @type {File[]} */
    let files;
    // 받는 부분만 감싼다. 분석 중 오류는 runAnalysis가 단계 이름과 함께 따로 보여 준다.
    try {
      files = await Promise.all(
        SAMPLE_FILES.map(async (name) => {
          // BASE_URL = '/rental-safe-helper/' (GitHub Pages 주소 앞부분, vite.config.js)
          // @ts-ignore -- Vite가 import.meta.env를 채운다 (괄호로 감싸면 Vite가 바꾸지 못하므로 그대로 쓴다)
          const base = import.meta.env.BASE_URL;
          const res = await fetch(`${base}samples/${name}`);
          if (!res.ok) throw new Error('SAMPLE_LOAD_FAILED');
          return new File([await res.blob()], name, { type: 'application/pdf' });
        }),
      );
    } catch {
      appState.setState({
        busy: null,
        error: { step: 'sample', code: 'LOAD_FAILED', message: 'Please check your internet connection and try again.' },
      });
      return;
    }
    await runAnalysis(files);
  },
  goTo(step) {
    appState.setState({ step, error: null });
  },
  dismissError() {
    // 오류만 닫는다. 고른 파일·분석 결과·수정 내용은 그대로 둔다.
    appState.setState({ error: null });
  },
  getOcrDraft() {
    return ocrDraft;
  },
  setOcrDraft(docs) {
    // 화면을 다시 그리지 않고 저장만 한다 (입력 중인 칸의 포커스를 지키기 위해)
    ocrDraft = docs;
    return act.countOcrLinesToCheck(docs);
  },
  countOcrLinesToCheck(docs) {
    // "Confirm text"는 처리 코드를 불러온 뒤에만 나오므로 loadedPipeline이 있다. 없으면 넘어가지 못하게 1
    return loadedPipeline ? loadedPipeline.countLinesToCheck(docs) : 1;
  },
  async confirmOcr() {
    const { ocrReview } = appState.getState();
    if (!ocrReview || act.countOcrLinesToCheck(ocrDraft) > 0) return;
    const p = await pipeline();
    if (!p) return;
    // 고친 서류를 원래 자리에 넣는다 (documentId로 찾기)
    const edited = new Map(ocrDraft.map((d) => [d.documentId, d]));
    const documents = ocrReview.read.documents.map((d) => edited.get(d.documentId) ?? d);
    await finishAnalysis(p, { files: ocrReview.read.files, documents });
  },
  cancelOcr() {
    ocrDraft = [];
    appState.setState({ ocrReview: null, step: 'upload', error: null });
  },
  async setPersonAnswers(answers) {
    const { analysis } = appState.getState();
    if (!analysis) return;
    const p = await pipeline();
    if (!p) return;
    const next = { ...answers };
    // 답으로 사람을 합치고 위험 점검을 다시 한다. ② 결과가 그 자리에서 바뀐다.
    const r = p.recheckPeople(analysis, next);
    if (!r.ok) {
      // 잘못된 답(없는 사람·자기 자신·서로 가리킴·확인된 사람)이면 이전 답과 결과를 그대로 둔다
      appState.setState({ error: toError(r) });
      return;
    }
    // 같은 사람이면 가명도 합쳐지므로 이전에 만든 마스킹·미리보기·PDF는 버리고 다시 확인하게 한다
    clearTimeout(previewTimer);
    appState.setState({
      personAnswers: next,
      checked: Object.keys(next).length > 0 ? r.data : null,
      prepared: null,
      pdfs: null,
      reviewed: false,
      error: null,
    });
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
    const state = appState.getState();
    const { purpose, maskingEdits } = state;
    // "같은 사람인가요?" 답을 반영한 그룹으로 가린다 (같은 사람 = 같은 가명)
    const analysis = currentAnalysis(state);
    if (!analysis) return;
    const p = await pipeline();
    if (!p) return;
    const r = p.prepareForAi(analysis, purpose, maskingEdits);
    if (r.ok) {
      appState.setState({ prepared: r.data, reviewed: false, pdfs: null, step: 'review', error: null });
      schedulePreviews(0);
    } else appState.setState({ error: toError(r) });
  },
  async setMaskingEdits(edits) {
    const state = appState.getState();
    const { purpose } = state;
    const analysis = currentAnalysis(state);
    if (!analysis) return;
    const next = normalizeEdits(edits);
    const p = await pipeline();
    if (!p) return;
    // 수정할 때마다 다시 가려서 미리보기를 바꾼다. 바뀐 내용은 다시 확인해야 하므로 체크를 푼다.
    const r = p.prepareForAi(analysis, purpose, next);
    // 실패하면(예: 남은 개인정보 검사 실패) 이전 수정과 미리보기를 그대로 두고 오류만 보여 준다
    if (r.ok) {
      appState.setState({ maskingEdits: next, prepared: r.data, reviewed: false, pdfs: null, error: null });
      // 연달아 바꾸면 마지막 수정만 그린다
      schedulePreviews(PREVIEW_DELAY_MS);
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
    appState.setState({ busy: null, pdfs, doubleCheck: null, step: 'done' });
  },
  async doubleCheckPdfs() {
    const state = appState.getState();
    const analysis = currentAnalysis(state);
    const { prepared, pdfs } = state;
    if (!analysis || !prepared || !pdfs) return;
    appState.setState({ doubleCheck: 'running', error: null });
    const p = await pipeline();
    if (!p) {
      appState.setState({ doubleCheck: null });
      return;
    }
    const results = await p.doubleCheckPdfs(analysis, prepared.maskingPlan, pdfs);
    // 검사하는 동안 PDF가 바뀌었으면(처음부터 다시 등) 이 결과는 버린다
    if (appState.getState().pdfs !== pdfs) return;
    appState.setState({ doubleCheck: results });
  },
  restart() {
    clearTimeout(previewTimer);
    releasePreviews();
    ocrDraft = [];
    appState.setState(initialState());
  },
};

const SCREENS = {
  upload: uploadScreen,
  confirm: confirmScreen,
  results: resultsScreen,
  purpose: purposeScreen,
  review: reviewScreen,
  done: doneScreen,
};

const app = /** @type {HTMLElement} */ (document.querySelector('#app'));

/**
 * 오류 안내 카드: 무슨 일인지 + 무엇을 하면 되는지 + 다음 버튼
 * 각 파트의 개발자용 메시지 대신 error-help.js의 쉬운 안내를 보여 준다. (코드는 문의할 때 쓰도록 작게)
 * @param {{ step?: string, code: string, message: string }} error
 * @param {string} screenStep  지금 보고 있는 화면
 */
function errorCard(error, screenStep) {
  const { title, help } = errorHelp(error);
  // ①에서 실패하면 파일을 바꿔 다시 하면 되고, 그 뒤 단계에서는 이전 상태가 남아 있으므로 닫고 계속하면 된다
  // (인터넷 문제면 같은 파일로 다시 하면 되므로 "Try again")
  const retryLabel = error.code === 'LOAD_FAILED' ? 'Try again' : 'Try another file';
  const retry =
    screenStep === 'upload'
      ? button(retryLabel, () => act.dismissError(), { id: 'error-retry' })
      : button('Close', () => act.dismissError(), { id: 'error-close' });
  const node = card(
    title,
    [
      el('p', {}, [help]),
      el('p', { class: 'hint' }, [
        `We stopped while ${STEP_TEXT[error.step ?? ''] ?? 'processing'}. Error code: ${error.code}`,
      ]),
      actions([retry, button('Start over', () => act.restart(), { variant: 'secondary' })]),
    ],
    'error-card',
  );
  node.setAttribute('role', 'alert');
  return node;
}

function render() {
  const state = appState.getState();
  const screen = SCREENS[state.step] ?? uploadScreen;
  const parts = [
    el('header', {}, [el('h1', {}, ['Rental Safety Helper']), disclaimer()]),
    stepper(state.step),
    state.busy ? el('p', { class: 'busy', role: 'status' }, [el('span', { class: 'spinner', 'aria-hidden': 'true' }), state.busy]) : null,
    state.error ? errorCard(state.error, state.step) : null,
    state.busy ? null : screen(state, act),
  ];
  app.replaceChildren(.../** @type {HTMLElement[]} */ (parts.filter(Boolean)));
  // 단계가 바뀌면 화면 맨 위로 (휴대폰에서 다음 단계가 아래에 숨지 않게)
  if (render.lastStep !== state.step) window.scrollTo({ top: 0 });
  render.lastStep = state.step;
}
/** @type {string | undefined} */
render.lastStep = undefined;

/*
 * 브라우저 기록 연결 (#90): 휴대폰 뒤로 가기가 사이트를 나가지 않고 이전 단계로 가게 한다.
 * 주소에는 단계 이름만 남긴다 (#results 등). 서류 정보·개인정보는 넣지 않는다. 규칙은 step-history.js.
 */

/** 앱 안에서 단계가 바뀌면 기록에 남긴다 */
function syncHistory() {
  const { step } = appState.getState();
  const action = historyAction(stepFromHash(location.hash), step);
  if (action === 'push') history.pushState(null, '', hashFor(step));
  else if (action === 'replace') history.replaceState(null, '', hashFor(step));
}

/** 뒤로·앞으로 가기: 그 단계로 간다. 결과가 없는 단계면(예: 처음부터 다시 한 뒤의 ⑤) 갈 수 있는 앞 단계로 */
window.addEventListener('popstate', () => {
  const state = appState.getState();
  const wanted = stepFromHash(location.hash);
  const step = reachableStep(state, wanted);
  if (step !== wanted) history.replaceState(null, '', hashFor(step));
  if (step !== state.step) appState.setState({ step, error: null });
});

// 새로고침하면 서류와 결과가 없으므로 ①부터. 남아 있던 단계 이름은 지운다 (#review로 새로고침 등)
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
// 단계가 바뀌면 render()가 맨 위로 올리므로 브라우저가 스크롤 위치를 되돌리지 않게 한다
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

appState.subscribe(syncHistory);
appState.subscribe(render);
render();
