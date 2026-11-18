// @ts-check
/** PART 5. ① 서류 올리기 화면 */

import { el, button, card, actions } from '../ui.js';
import { resumeStep } from '../step-history.js';

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
  ]);
}

/**
 * 파일 고르는 칸 하나
 * @param {string} id
 * @param {string} label
 * @param {string} hint
 * @param {File | null} current
 * @param {(file: File | null) => void} onChange
 * @param {string} removeLabel  지우기 버튼의 화면 낭독기용 이름 (어느 칸인지 알 수 있게)
 */
function filePicker(id, label, hint, current, onChange, removeLabel) {
  const statusId = `${id}-status`;
  // 브라우저 기본 파일 칸은 컴퓨터 언어로 "파일 선택 / 선택된 파일 없음"이 나와서 영어 화면과 섞인다.
  // 기본 칸은 보이지 않게 두고(키보드·화면 낭독기로는 그대로 쓸 수 있음), 영어 버튼과 상태 글을 따로 보여 준다. (#188)
  const input = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'file',
      id,
      class: 'file-input',
      accept: 'application/pdf,image/jpeg,image/png',
      'aria-describedby': statusId,
    })
  );
  // 고르기 창에서 취소하면 브라우저에 따라 빈 change가 온다. 그때 고른 파일이 지워지지 않게 한다 (지우기는 Remove로)
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onChange(file);
  });

  // 지우기: 파일 이름 옆의 작은 글자 버튼 (주 버튼 "Check my documents"보다 눈에 덜 띄게)
  let remove = null;
  if (current) {
    remove = button('Remove', () => {
      onChange(null);
      // 화면이 바로 다시 그려진다. 키보드 사용자가 길을 잃지 않게 같은 칸의 파일 선택으로 포커스를 옮긴다.
      document.getElementById(id)?.focus();
    }, { id: `${id}-remove` });
    remove.className = 'link-button';
    remove.setAttribute('aria-label', removeLabel);
  }

  return el('div', { class: 'picker' }, [
    el('label', { for: id }, [label]),
    el('p', { class: 'hint' }, [hint]),
    el('div', { class: 'file-row' }, [
      input,
      // 누르면 파일 고르기 창이 열린다 (label for). 고른 뒤에는 "Change file"로 바꿀 수 있다고 보인다.
      el('label', { for: id, class: 'file-button', 'aria-hidden': 'true' }, [current ? 'Change file' : 'Choose file']),
      // 파일 이름에는 개인정보가 있을 수 있어 화면에만 보여 준다
      el('span', { id: statusId, class: current ? 'file-name chosen' : 'file-name' }, [current ? current.name : 'No file chosen']),
      remove,
    ]),
  ]);
}

/**
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
export function uploadScreen(state, act) {
  const { registry, lease } = state.files;
  const hasFile = Boolean(registry || lease);
  return el('div', {}, [
    resumeCard(state, act),
    card('Upload your documents', [
      el('p', {}, [
        'Upload the property register and the lease contract you received. PDF files and photos (JPG, PNG) both work. On a phone, you can take a photo.',
      ]),
      photoTipsBox(),
      filePicker(
        'registry-file',
        'Property register (등기부등본)',
        'Shows who owns the home and any mortgage or seizure.',
        registry,
        (f) => act.setFiles({ registry: f }),
        'Remove the property register file',
      ),
      filePicker(
        'lease-file',
        'Lease contract (임대차계약서)',
        'The contract you are about to sign.',
        lease,
        (f) => act.setFiles({ lease: f }),
        'Remove the lease contract file',
      ),
      actions([
        button('Check my documents', () => act.analyze(), { id: 'run', disabled: !hasFile }),
        button('Try with sample data', () => act.analyzeSample(), { id: 'run-sample', variant: 'secondary' }),
      ]),
    ]),
  ]);
}
