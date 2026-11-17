// @vitest-environment happy-dom
// PART 4. 화면 테스트: ② "같은 사람인가요?" (renderPersonQuestions), ④ 보내기 전 확인 (renderMaskingReview)
// 가상 데이터(mock-data.js)만 사용한다.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  renderPersonQuestions,
  renderMaskingReview,
  createMaskingPlan,
  applyMaskingPlan,
} from '../src/features/masking/index.js';
import { buildPersonQuestions } from '../src/features/masking/person-answers.js';
import {
  mockRegistryDocument,
  mockLeaseDocument,
  mockRegistryFindings,
  mockLeaseFindings,
  mockExtractedFields,
  mockPersonGroups,
} from '../src/shared/mock-data.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

// mock: P1 소유자 김철수(800101) / P2 임대인 김철수(750315) / P3 임차인 / P4 예금주 김철수(생년월일 없음, AMBIGUOUS)
const analysis = {
  documents: [mockRegistryDocument, mockLeaseDocument],
  findings: [...mockRegistryFindings, ...mockLeaseFindings],
  fields: mockExtractedFields,
  personGroups: mockPersonGroups,
};

/** 라디오·체크박스를 바꾼 것처럼 */
const choose = (/** @type {HTMLInputElement} */ input) => {
  input.checked = true;
  input.dispatchEvent(new Event('change'));
};

describe('PART 4 화면 ② "같은 사람인가요?" (renderPersonQuestions)', () => {
  /** @param {Record<string, string | null>} [personAnswers] */
  const render = (personAnswers = {}, groups = mockPersonGroups) => {
    const onChange = vi.fn();
    const node = renderPersonQuestions({
      analysis: { ...analysis, personGroups: groups },
      personGroups: groups,
      personAnswers,
      onChange,
    });
    return { node, onChange };
  };

  it('물어볼 사람이 없으면 null (아무것도 그리지 않음)', () => {
    const confirmed = mockPersonGroups.map((g) => ({ ...g, status: 'CONFIRMED' }));
    expect(render({}, confirmed).node).toBeNull();
  });

  it('질문마다 fieldset이 하나씩 있다', () => {
    const { node } = render();
    const questions = buildPersonQuestions(analysis.fields, analysis.personGroups);
    expect(questions.length).toBeGreaterThan(0);
    expect(node?.querySelectorAll('fieldset')).toHaveLength(questions.length);
  });

  it('후보를 고르면 onChange가 답 전체로 불린다 (다른 사람의 답은 그대로)', () => {
    const { node, onChange } = render({ P9: null });
    choose(/** @type {HTMLInputElement} */ (node?.querySelector('#pq-P4-P2')));
    expect(onChange).toHaveBeenCalledWith({ P9: null, P4: 'P2' });
  });

  it('"A different person"을 고르면 그 사람의 답이 null이 된다', () => {
    const { node, onChange } = render();
    choose(/** @type {HTMLInputElement} */ (node?.querySelector('#pq-P4-none')));
    expect(onChange).toHaveBeenCalledWith({ P4: null });
  });

  it('"Not sure yet"을 고르면 그 사람의 키가 빠진다', () => {
    const { node, onChange } = render({ P4: 'P2' });
    expect(/** @type {HTMLInputElement} */ (node?.querySelector('#pq-P4-P2')).checked).toBe(true);
    choose(/** @type {HTMLInputElement} */ (node?.querySelector('#pq-P4-unsure')));
    expect(onChange).toHaveBeenCalledWith({});
  });
});

describe('PART 4 화면 ④ 보내기 전 확인 (renderMaskingReview)', () => {
  /** PART 5처럼 계획을 만들고 화면을 그린다 */
  const render = (edits = { remove: [], add: [] }, purpose = MASKING_PURPOSE.FRAUD_CHECK, onChange = vi.fn()) => {
    const plan = createMaskingPlan(analysis.findings, analysis.personGroups, purpose, edits).data;
    const masked = applyMaskingPlan(analysis.documents, plan, analysis.findings, analysis.personGroups, edits).data;
    const node = renderMaskingReview({
      analysis,
      prepared: { maskingPlan: plan, maskedText: masked.maskedText, legend: masked.legend },
      edits,
      onChange,
    });
    document.body.replaceChildren(node);
    return { node, onChange };
  };
  /** 표에서 첫 칸이 label로 시작하는 줄 */
  const rowsOf = (node, label) => [...node.querySelectorAll('tbody tr')].filter((tr) => tr.cells[0].textContent.startsWith(label));

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('주민번호·외국인등록번호·전화·계좌 줄은 체크박스 없이 🔒로 보인다', () => {
    const { node } = render();
    for (const label of ['Resident registration no.', 'Foreigner registration no.', 'Phone number', 'Bank account']) {
      const rows = rowsOf(node, label);
      expect(rows.length, label).toBeGreaterThan(0);
      for (const tr of rows) {
        expect(tr.querySelector('input[type="checkbox"]'), label).toBeNull();
        expect(tr.querySelector('.mr-locked')?.textContent, label).toContain('🔒');
      }
    }
  });

  it('"Show"를 체크하면 onChange의 remove에 그 항목이 들어간다', () => {
    const { node, onChange } = render();
    const tenant = rowsOf(node, 'Name').find((tr) => tr.querySelector('.mr-original')?.textContent === 'NGUYEN VAN A');
    choose(/** @type {HTMLInputElement} */ (tenant?.querySelector('input[type="checkbox"]')));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].remove).toContain('PII_L04');
  });

  it('더 가린 글자의 "Undo"를 누르면 add에서 빠진다', () => {
    const block = mockLeaseDocument.pages[0].blocks.find((b) => b.text.includes('현금으로'));
    const add = [{ id: 'USER_001', documentId: 'DOC_LEASE', blockId: block.blockId, value: '현금으로', pageIndex: 0, bbox: block.bbox }];
    const { node, onChange } = render({ remove: [], add });
    /** @type {HTMLButtonElement} */ (node.querySelector('.mr-undo')).click();
    expect(onChange).toHaveBeenCalledWith({ remove: [], add: [] });
  });

  it('원본 값(mr-original)은 표에만 있고, 가린 미리보기에는 섞이지 않는다 (목적 3가지 모두)', () => {
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const { node } = render(undefined, purpose);
      const preview = node.querySelector('.mr-preview');
      expect(preview?.querySelector('.mr-original'), purpose).toBeNull();
      const previewText = preview?.textContent ?? '';
      const originals = [...node.querySelectorAll('tbody tr:not(.mr-row-shown) .mr-original')].flatMap((td) =>
        (td.textContent ?? '').split(' / '),
      );
      expect(originals.length, purpose).toBeGreaterThan(0);
      for (const value of originals) expect(previewText, `${purpose}: "${value}"`).not.toContain(value);
    }
  });

  it('여러 줄을 가리면 "Hid in N places" 안내가 조금 뒤에 들어가고, 목적을 바꾸면 사라진다', () => {
    vi.useFakeTimers();
    let edits = { remove: [], add: [] };
    const onChange = vi.fn((next) => {
      edits = next;
    });
    const { node } = render(edits, MASKING_PURPOSE.FRAUD_CHECK, onChange);

    // 미리보기에서 두 줄에 있는 "월세"를 고른다 (보증금 줄, 특약 줄)
    const line = [...node.querySelectorAll('.mr-line')].find((l) => l.textContent?.includes('월세'));
    const text = /** @type {Text} */ (line?.firstChild);
    const at = text.data.indexOf('월세');
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + 2);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    /** @type {HTMLButtonElement} */ ([...node.querySelectorAll('button')].find((b) => b.textContent === 'Hide selected text')).click();
    expect(edits.add).toHaveLength(2);

    // PART 5처럼 새로 그린다: 처음에는 빈 칸, 조금 뒤에 안내가 들어간다
    const again = render(edits, MASKING_PURPOSE.FRAUD_CHECK, onChange).node;
    const hint = () => again.querySelector('[role="status"]')?.textContent;
    expect(hint()).toBe('');
    vi.advanceTimersByTime(100);
    expect(hint()).toBe('Hid "월세" in 2 places. In the PDF, each of those lines is covered.');

    // 이미 알린 뒤 한 번 더 그려지면 글이 처음부터 들어 있다 (바뀌지 않으니 화면 읽기 프로그램이 다시 읽지 않음)
    const third = render(edits, MASKING_PURPOSE.FRAUD_CHECK, onChange).node;
    expect(third.querySelector('[role="status"]')?.textContent).toBe(
      'Hid "월세" in 2 places. In the PDF, each of those lines is covered.',
    );

    // 목적을 바꿔 다시 그리면 안내는 없다 (더 가린 글자는 그대로)
    const other = render(edits, MASKING_PURPOSE.CLAUSE_EXPLANATION, onChange).node;
    vi.advanceTimersByTime(100);
    expect(other.querySelector('[role="status"]')?.textContent).toBe('');
    expect(other.querySelectorAll('.mr-added li')).toHaveLength(1);
  });
});
