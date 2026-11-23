// @ts-check
/** PART 5. ① 서류 올리기 화면 */

import { el, button, card, actions } from '../ui.js';
import { resumeStep } from '../step-history.js';
import { addPicked, removePhoto, isPdf } from '../photo-pages.js';

/** @param {number} n @param {string} word */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * 칸 상태 글 (#298): 사진만이면 "3 photos (3 pages)", 섞였으면 "2 PDFs, 1 photo"
 * @param {File[]} files
 */
function listStatus(files) {
  const pdfs = files.filter(isPdf).length;
  const photos = files.length - pdfs;
  if (pdfs === 0) return `${plural(photos, 'photo')} (${plural(photos, 'page')})`;
  return [pdfs ? plural(pdfs, 'PDF') : '', photos ? plural(photos, 'photo') : ''].filter(Boolean).join(', ');
}

/**
 * 이전 결과가 남아 있으면 ① 위쪽에 보여 주는 안내 (#124)
 * 제목·뒤로 가기로 ①에 오면 결과는 그대로인데, 그걸 몰라서 사라졌다고 생각하지 않게 한다.
 * 파일 이름 등 서류 정보는 넣지 않는다.
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
function resumeCard(state, act) {
  const step = resumeStep(state);
  if (!step) return null;
  return card(
    'Your earlier results are still here',
    [
      el('p', {}, ['If you check new documents or try the sample, these results will be replaced.']),
      actions([button('Back to your results', () => act.goTo(step), { id: 'back-to-results', variant: 'secondary' })]),
    ],
    'resume-card',
  );
}

function photoTipsBox() {
  return el('div', { class: 'photo-tips' }, [
    el('strong', {}, ['Tips for taking a clear photo']),
    el('ul', {}, [
      el('li', {}, ['Place the paper flat without folds or creases.']),
      el('li', {}, ['Shoot straight-on from the front so the page is not tilted.']),
      el('li', {}, ['Use bright, even lighting and avoid shadows over the text.']),
      el('li', {}, ['Fit the entire page inside the frame so no edges are cut off.']),
    ]),
    // 선택 팁 (#272): 앱은 배경 자르기·그림자 지우기까지만 한다. 휴대폰 문서 스캔은 비스듬한 종이도 펴 줘서 더 정확하다.
    el('p', { class: 'scan-tip', id: 'scan-tip' }, [
      "For the best results, you can use your phone's document scan feature (for example in Notes, Files or Google Drive) and upload the PDF it makes. Plain photos work too: we crop the page and remove shadows for you.",
    ]),
    // 여러 쪽을 한 번에 (#272): 휴대폰 카메라는 한 번에 한 장만 찍으므로, 먼저 다 찍고 사진 보관함에서 한꺼번에 고르게 안내한다.
    // 앱 안 연속 촬영은 화질이 낮아질 수 있어 넣지 않았다 (보고서 Future work)
    el('p', { class: 'scan-tip', id: 'many-pages-tip' }, [
      'To add several pages at once, take photos of all pages with your camera first, then tap "Choose file" and select them all from your photo library.',
    ]),
  ]);
}

/*
 * 올린 파일 미리 보기 (#268)
 * 사진·PDF를 이 브라우저 안에서만 보여 준다 (object URL). 칸에서 빠진 파일의 주소는 화면을 그릴 때마다 정리한다.
 */
/** @type {Map<File, string>} */
const previewUrls = new Map();

/** @param {File} file */
function urlOf(file) {
  let url = previewUrls.get(file);
  if (!url && typeof URL.createObjectURL === 'function') {
    url = URL.createObjectURL(file);
    previewUrls.set(file, url);
  }
  return url ?? '';
}

/**
 * 지금 칸에 없는 파일의 미리 보기 주소를 정리한다
 * @param {Set<File>} keep
 */
function releaseUnused(keep) {
  for (const [file, url] of previewUrls) {
    if (keep.has(file)) continue;
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    previewUrls.delete(file);
  }
}

/**
 * 크게 보기 창 (사진 한 장). 닫기 버튼과 Esc로 닫는다.
 * @returns {{ node: HTMLDialogElement, open: (url: string, caption: string) => void }}
 */
function photoViewer() {
  const img = /** @type {HTMLImageElement} */ (el('img', { class: 'viewer-image', alt: '' }));
  const caption = el('p', { class: 'viewer-caption', id: 'file-viewer-caption' }, []);
  const node = /** @type {HTMLDialogElement} */ (
    el('dialog', { id: 'file-viewer', class: 'file-viewer', 'aria-labelledby': 'file-viewer-caption' }, [
      caption,
      img,
      actions([button('Close', () => close(), { id: 'file-viewer-close', variant: 'secondary' })]),
    ])
  );
  const close = () => {
    if (typeof node.close === 'function' && node.open) node.close();
    else node.removeAttribute('open');
  };
  return {
    node,
    open(url, text) {
      img.src = url;
      img.alt = text;
      caption.textContent = text;
      if (typeof node.showModal === 'function') node.showModal();
      else node.setAttribute('open', '');
      document.getElementById('file-viewer-close')?.focus();
    },
  };
}

/**
 * 파일 고르는 칸 하나
 * 칸에는 PDF 한 개 또는 사진 여러 장이 들어간다 (#268). 사진은 고를 때마다 뒤에 덧붙는다.
 * @param {{
 *   id: string,
 *   label: string,
 *   hint: string,
 *   docName: string,
 *   current: import('../photo-pages.js').SlotValue,
 *   notice: string | null,
 *   onChange: (value: import('../photo-pages.js').SlotValue, notice?: string | null) => void,
 *   viewer: ReturnType<typeof photoViewer>,
 * }} opts
 *   docName: 화면 낭독기용 서류 이름 ("property register")
 */
function filePicker({ id, label, hint, docName, current, notice, onChange, viewer }) {
  const statusId = `${id}-status`;
  const hintId = `${id}-hint`;
  // 목록(사진만, 또는 PDF·사진 섞임 #298) / PDF 한 개
  const list = Array.isArray(current) ? current : null;
  const photosOnly = Boolean(list && !list.some(isPdf));
  const pdf = current && !Array.isArray(current) ? current : null;
  // 브라우저 기본 파일 칸은 컴퓨터 언어로 "파일 선택 / 선택된 파일 없음"이 나와서 영어 화면과 섞인다.
  // 기본 칸은 보이지 않게 두고(키보드·화면 낭독기로는 그대로 쓸 수 있음), 영어 버튼과 상태 글을 따로 보여 준다. (#188)
  const input = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'file',
      id,
      class: 'file-input',
      accept: 'application/pdf,image/jpeg,image/png',
      // 갤러리에서 여러 장을 한 번에 고를 수 있다. 카메라는 한 장씩 찍고 "Add another page"로 덧붙인다 (#268)
      multiple: true,
      // 화면 낭독기로도 칸 설명(특약 별지 안내 등)을 듣게 한다 (#234)
      'aria-describedby': `${hintId} ${statusId}`,
    })
  );
  // 고르기 창에서 취소하면 브라우저에 따라 빈 change가 온다. 그때 고른 파일이 지워지지 않게 한다 (지우기는 Remove로)
  input.addEventListener('change', () => {
    const picked = [...(input.files ?? [])];
    if (picked.length === 0) return;
    const r = addPicked(current, picked);
    onChange(r.value, r.notice);
  });

  // 지우기: 작은 글자 버튼 (주 버튼 "Check my documents"보다 눈에 덜 띄게)
  let remove = null;
  if (current) {
    remove = button(list ? 'Remove all' : 'Remove', () => {
      onChange(null);
      // 화면이 바로 다시 그려진다. 키보드 사용자가 길을 잃지 않게 같은 칸의 파일 선택으로 포커스를 옮긴다.
      document.getElementById(id)?.focus();
    }, { id: `${id}-remove` });
    remove.className = 'link-button';
    remove.setAttribute(
      'aria-label',
      photosOnly ? `Remove all photos of the ${docName}` : list ? `Remove all files of the ${docName}` : `Remove the ${docName} file`,
    );
  }

  // PDF는 새 탭에서 열어 모든 쪽을 확인한다 (브라우저의 PDF 보기, 이 기기 안에서만)
  let view = null;
  if (pdf) {
    view = button('View', () => window.open(urlOf(pdf), '_blank', 'noopener'), { id: `${id}-view` });
    view.className = 'link-button';
    view.setAttribute('aria-label', `View the ${docName} file`);
  }

  // PDF가 들어 있으면 새로 고른 파일은 바꾸지 않고 뒤에 덧붙인다 (특약 별지 PDF·사진, #298). 바꾸려면 Remove 후 다시 고른다.
  const buttonText = photosOnly ? 'Add another page' : current ? 'Add another file' : 'Choose file';
  const statusText = list ? listStatus(list) : pdf ? pdf.name : 'No file chosen';

  return el('div', { class: 'picker' }, [
    el('label', { for: id }, [label]),
    el('p', { class: 'hint', id: hintId }, [hint]),
    el('div', { class: 'file-row' }, [
      input,
      // 누르면 파일 고르기 창이 열린다 (label for)
      el('label', { for: id, class: 'file-button', 'aria-hidden': 'true' }, [buttonText]),
      // 파일 이름에는 개인정보가 있을 수 있어 화면에만 보여 준다
      el('span', { id: statusId, class: current ? 'file-name chosen' : 'file-name' }, [statusText]),
      view,
      remove,
    ]),
    list ? photoList(id, docName, list, onChange, viewer) : null,
    notice ? el('p', { class: 'picker-notice', role: 'status', id: `${id}-notice` }, [notice]) : null,
  ]);
}

/**
 * 올린 사진 미리 보기 목록: 쪽 순서대로, 누르면 크게 보기, 한 장씩 지우기 (#268)
 * @param {string} id
 * @param {string} docName
 * @param {File[]} photos
 * @param {(value: import('../photo-pages.js').SlotValue) => void} onChange
 * @param {ReturnType<typeof photoViewer>} viewer
 */
function photoList(id, docName, photos, onChange, viewer) {
  // 사진만이면 "Page 1, 2…", PDF가 섞이면 PDF 한 개가 여러 쪽일 수 있어 "File 1, 2…"로 센다 (#298)
  const photosOnly = !photos.some(isPdf);
  const unit = photosOnly ? 'page' : 'file';
  return el(
    'ol',
    {
      class: 'photo-pages',
      id: `${id}-pages`,
      'aria-label': photosOnly ? `Photos of the ${docName}` : `Files of the ${docName}, in page order`,
    },
    photos.map((file, i) => {
      const n = i + 1;
      const Unit = unit === 'page' ? 'Page' : 'File';
      /** @type {HTMLElement} */
      let thumb;
      if (isPdf(file)) {
        // PDF는 새 탭에서 열어 모든 쪽을 확인한다 (이 기기 안에서만). 파일 이름은 화면에만 보여 준다
        thumb = el('button', { type: 'button', class: 'photo-thumb pdf-thumb', id: `${id}-page-${i}`, 'aria-label': `View file ${n} (PDF)` }, [
          el('span', { class: 'pdf-mark', 'aria-hidden': 'true' }, ['PDF']),
          el('span', { class: 'pdf-name' }, [file.name]),
        ]);
        thumb.addEventListener('click', () => window.open(urlOf(file), '_blank', 'noopener'));
      } else {
        const pageText = `${Unit} ${n} of the ${docName} (your photo)`;
        thumb = el('button', { type: 'button', class: 'photo-thumb', id: `${id}-page-${i}`, 'aria-label': `View ${unit} ${n}` }, [
          el('img', { src: urlOf(file), alt: '' }),
        ]);
        thumb.addEventListener('click', () => viewer.open(urlOf(file), pageText));
      }
      const rm = button('Remove', () => {
        onChange(removePhoto(photos, i));
        document.getElementById(id)?.focus();
      }, { id: `${id}-remove-${i}` });
      rm.className = 'link-button';
      rm.setAttribute('aria-label', `Remove ${unit} ${n} of the ${docName}`);
      return el('li', { class: 'photo-page' }, [thumb, el('span', { class: 'photo-page-label' }, [`${Unit} ${n}`]), rm]);
    }),
  );
}

/**
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
export function uploadScreen(state, act) {
  const { registry, lease } = state.files;
  const hasFile = Boolean(registry || lease);
  const notice = state.uploadNotice ?? null;
  // 칸에서 빠진 파일의 미리 보기 주소 정리
  releaseUnused(new Set([registry, lease].flat().filter((f) => f instanceof File)));
  const viewer = photoViewer();
  return el('div', {}, [
    resumeCard(state, act),
    card('Upload your documents', [
      el('p', {}, [
        'Upload the property register and the lease contract you received. PDF files and photos (JPG, PNG) both work. On a phone, you can take a photo of each page.',
      ]),
      photoTipsBox(),
      filePicker({
        id: 'registry-file',
        label: 'Property register (등기부등본)',
        // 등기부는 보통 여러 쪽이고, 근저당·압류·신탁은 뒤쪽 갑구·을구에 있다 (#243 리뷰)
        hint:
          'Shows who owns the home and any mortgage or seizure. Include every page: mortgages and seizures are often on the later pages. ' +
          'Upload one PDF with all pages, or take a photo of each page (after the first photo, use "Add another page").',
        docName: 'property register',
        current: registry,
        notice: notice?.slot === 'registry' ? notice.text : null,
        onChange: (value, n) => act.setFiles({ registry: value }, n ? { slot: 'registry', text: n } : null),
        viewer,
      }),
      filePicker({
        id: 'lease-file',
        label: 'Lease contract (임대차계약서)',
        // 특약을 별지에 따로 적은 계약서는 그 쪽이 빠지면 "특약 없음"으로 보일 수 있다 (#234)
        hint:
          'The contract you are about to sign. Include every page, including any separate special terms page (특약사항 별지). ' +
          'Upload one PDF with all pages, or take a photo of each page (after the first photo, use "Add another page"). ' +
          'If the special terms page is a separate PDF or photo, add it here too with "Add another file".',
        docName: 'lease contract',
        current: lease,
        notice: notice?.slot === 'lease' ? notice.text : null,
        onChange: (value, n) => act.setFiles({ lease: value }, n ? { slot: 'lease', text: n } : null),
        viewer,
      }),
      actions([
        button('Check my documents', () => act.analyze(), { id: 'run', disabled: !hasFile }),
        button('Try with sample data', () => act.analyzeSample(), { id: 'run-sample', variant: 'secondary' }),
      ]),
    ]),
    viewer.node,
  ]);
}
