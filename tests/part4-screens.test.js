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
import { notSentAsWritten } from '../src/features/masking/masking-review-ui.js';
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

  it('questions를 넘기면 그 질문만 그린다 (PART 5가 겹치는 질문을 뺀 목록, #172)', () => {
    // P2도 AMBIGUOUS로 바꿔 원래 판정의 질문을 2개로 만들고, 그중 1개만 넘긴다
    const unsure = mockPersonGroups.map((g) => (g.personId === 'P2' ? { ...g, status: 'AMBIGUOUS' } : g));
    const all = buildPersonQuestions(analysis.fields, unsure);
    expect(all).toHaveLength(2);
    const given = all.slice(0, 1);
    const node = renderPersonQuestions({
      analysis: { ...analysis, personGroups: unsure },
      personAnswers: {},
      onChange: vi.fn(),
      questions: given,
    });
    expect(node?.querySelectorAll('fieldset')).toHaveLength(1);
    expect(node?.querySelector(`#pq-${given[0].personId}-none`)).not.toBeNull();
    expect(node?.querySelector(`#pq-${all[1].personId}-none`)).toBeNull();
    // 빈 목록을 넘기면 원래 판정에 질문이 있어도 아무것도 그리지 않는다
    expect(renderPersonQuestions({ analysis, personAnswers: {}, onChange: vi.fn(), questions: [] })).toBeNull();
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

describe('PART 4 화면 ④ 한국어 원문 접기·요약 보기 (개선 목록 11·12번, #359)', () => {
  // 이 묶음은 "가리기"보다 먼저 돈다: 접힌 칸을 연 상태는 화면을 새로 그려도 기억되기 때문
  /** @param {any} [extra]  prepared에 더 넣을 값 (sending, sentText) */
  const render = (extra = {}) => {
    const edits = { remove: [], add: [] };
    const plan = createMaskingPlan(analysis.findings, analysis.personGroups, MASKING_PURPOSE.FRAUD_CHECK, edits).data;
    const masked = applyMaskingPlan(analysis.documents, plan, analysis.findings, analysis.personGroups, edits).data;
    const node = renderMaskingReview({
      analysis,
      prepared: { maskingPlan: plan, maskedText: masked.maskedText, legend: masked.legend, ...extra },
      edits,
      onChange: vi.fn(),
    });
    document.body.replaceChildren(node);
    return node;
  };

  afterEach(() => document.body.replaceChildren());

  it('한국어 가린 원문과 "Hide selected text"는 접힌 칸 안에 있고, 개인정보 표는 칸 밖에 있다', () => {
    const node = render();
    const korean = /** @type {HTMLDetailsElement} */ (node.querySelector('details.mr-korean'));
    expect(korean).not.toBeNull();
    expect(korean.open).toBe(false);
    expect(korean.querySelector('summary')?.textContent).toContain('For someone who reads Korean');
    expect(korean.querySelector('.mr-preview')).not.toBeNull();
    expect([...korean.querySelectorAll('button')].some((b) => b.textContent === 'Hide selected text')).toBe(true);
    expect(node.querySelector('.mr-table')?.closest('details')).toBeNull();
    expect(node.querySelector('.mr-count')?.textContent).toMatch(/^We hid or replaced \d+ of \d+ item\(s\)/);
  });

  it('요약으로 보내는 등기부는 요약 글을 칸 밖에 보여 주고, 서류마다 AI에 무엇이 가는지 적는다', () => {
    const registryId = mockRegistryDocument.documentId;
    const leaseId = mockLeaseDocument.documentId;
    const summary = [
      'Extracted items from the property register (the original register text is not sent).',
      'Current owner: [Owner_A]',
      'Rights and restrictions:',
      '- Mortgage (근저당권): received 2019-02-01, cause 설정계약, active',
    ].join('\n');
    const node = render({
      sentText: { [registryId]: summary, [leaseId]: 'masked lease' },
      sending: [
        { documentId: registryId, documentType: 'REGISTRY', mode: 'SUMMARY', hiddenCount: 0 },
        { documentId: leaseId, documentType: 'LEASE_CONTRACT', mode: 'PARTY_SUMMARY' },
      ],
    });
    const block = node.querySelector('.mr-summaries');
    expect(block?.closest('details')).toBeNull();
    // 아래 한국어 가린 원문과 달라 보이게: "Sent to the AI" 표시, 영어 제목, 글 목록 (#373 리뷰)
    const sent = block?.querySelector('.mr-sent');
    expect(sent?.querySelector('.mr-sent-badge')?.textContent).toBe('Sent to the AI');
    expect(sent?.querySelector('h3')?.textContent).toBe('Property register: a short summary, not the full text');
    expect([...(sent?.querySelectorAll('.mr-sent-list li') ?? [])].map((li) => li.textContent)).toEqual([
      'Current owner: [Owner_A]',
      'Rights and restrictions:',
      'Mortgage (근저당권): received 2019-02-01, cause 설정계약, active',
    ]);
    expect(sent?.querySelector('.mr-sent-sub')?.textContent).toContain('Mortgage');
    expect(sent?.querySelector('.mr-doc, pre')).toBeNull();
    const notes = [...node.querySelectorAll('.mr-korean .mr-preview .mr-note')].map((p) => p.textContent);
    expect(notes).toContain('The AI gets only the short summary shown above, not this text. This text is used for the masked PDF.');
    expect(notes).toContain("The AI gets this text, but the section with the parties' personal details is replaced by a short list of roles.");
  });

  it('보내지 않는 서류는 "AI에 안 감, 마스킹 PDF에만 쓰임"이라고 적고, sending이 없으면(예전 결과) 안내 없이 그린다', () => {
    const node = render({ sending: [{ documentId: mockRegistryDocument.documentId, documentType: 'REGISTRY', mode: 'OMIT', reason: 'PURPOSE' }] });
    const notes = [...node.querySelectorAll('.mr-preview .mr-note')].map((p) => p.textContent);
    expect(notes).toContain('The AI does not get this document for this purpose. This text is used only for the masked PDF.');
    expect(node.querySelector('.mr-summaries')).toBeNull();
    expect(render().querySelectorAll('.mr-preview .mr-note')).toHaveLength(0);
  });
});

describe('PART 4 화면 ④ 요약으로 보내는 곳의 "Show" 안내 (#359)', () => {
  // mock 계약서 줄: 3 = "임대인 김철수 …"(L_004), 4 = "임차인 NGUYEN VAN A …"(L_005), 6 = "입금 계좌 … 예금주 김철수"(L_007)
  /** @param {any} sending @param {any} [ranges] */
  const render = (sending, ranges) => {
    const edits = { remove: [], add: [] };
    const fields = { ...analysis.fields, contract: { ...analysis.fields.contract, ...(ranges ? { personalInfoRanges: ranges } : {}) } };
    const withFields = { ...analysis, fields };
    const plan = createMaskingPlan(analysis.findings, analysis.personGroups, MASKING_PURPOSE.FRAUD_CHECK, edits).data;
    const masked = applyMaskingPlan(analysis.documents, plan, analysis.findings, analysis.personGroups, edits).data;
    const node = renderMaskingReview({
      analysis: withFields,
      prepared: { maskingPlan: plan, maskedText: masked.maskedText, legend: masked.legend, sending },
      edits,
      onChange: vi.fn(),
    });
    document.body.replaceChildren(node);
    return node;
  };
  /** 표에서 원래 값이 value인 줄들 */
  const rowsWith = (node, value) => [...node.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('.mr-original')?.textContent === value);
  const noteOf = (tr) => tr.querySelector('.mr-show-note')?.textContent ?? null;
  const REG = mockRegistryDocument.documentId;
  const LEASE = mockLeaseDocument.documentId;

  afterEach(() => document.body.replaceChildren());

  it('요약으로 보내는 등기부의 항목은 "Show가 PDF만 바꾼다"고 알린다. 🔒 항목에는 안내가 없다', () => {
    const node = render([
      { documentId: REG, mode: 'SUMMARY' },
      { documentId: LEASE, mode: 'MASKED_TEXT' },
    ]);
    const SUMMARY_NOTE = 'This part is sent to the AI as a summary with role names only, so ticking Show only changes the masked PDF.';
    // 등기부에만 있는 값: 등기 고유번호, 소유자 김철수
    expect(noteOf(rowsWith(node, '0000-0000-000000')[0])).toBe(SUMMARY_NOTE);
    expect(rowsWith(node, '김철수').map(noteOf).filter((n) => n === SUMMARY_NOTE)).toHaveLength(1);
    // 등기부·계약서 둘 다에 나오는 주소는 "일부만" 안내
    expect(noteOf(rowsWith(node, '서울특별시 중구 필동로 00, 101호')[0])).toMatch(/^In some places this is not sent to the AI as written/);
    // 항상 가리는 항목(🔒)은 Show가 없으니 안내도 없다
    expect(noteOf(rowsWith(node, '800101-1******')[0])).toBeNull();
    // 계약서는 가린 원문 그대로 가므로 안내가 없다
    expect(noteOf(rowsWith(node, 'NGUYEN VAN A')[0])).toBeNull();
  });

  it('인적사항 칸을 요약으로 바꾼 계약서는 칸 안의 항목만 알린다 (칸 밖의 예금주·주소는 그대로)', () => {
    const node = render(
      [
        { documentId: REG, mode: 'MASKED_TEXT' },
        { documentId: LEASE, mode: 'PARTY_SUMMARY' },
      ],
      [{ startLine: 3, endLine: 4 }],
    );
    expect(noteOf(rowsWith(node, 'NGUYEN VAN A')[0])).toBe(
      'This part is sent to the AI as a summary with role names only, so ticking Show only changes the masked PDF.',
    );
    // 김철수 세 줄(소유자·임대인·예금주) 중 칸 안의 임대인 줄만 안내가 붙는다
    const kims = rowsWith(node, '김철수').map(noteOf);
    expect(kims.filter(Boolean)).toHaveLength(1);
    expect(noteOf(rowsWith(node, '서울특별시 중구 필동로 00, 101호')[0])).toBeNull();
  });

  it('보내지 않는 서류의 항목은 "이 목적에는 안 보낸다"고 알리고, sending이 없으면(예전 결과) 안내가 없다', () => {
    const node = render([
      { documentId: REG, mode: 'OMIT' },
      { documentId: LEASE, mode: 'MASKED_TEXT' },
    ]);
    const notes = [...node.querySelectorAll('.mr-show-note')].map((n) => n.textContent);
    expect(notes).toContain('This document is not sent to the AI for this purpose, so ticking Show only changes the masked PDF.');
    // 등기부·계약서 둘 다에 나오는 값은 일부만 해당된다는 안내
    for (const n of notes) expect(n).toMatch(/^(This document is not sent to the AI|In some places this is not sent to the AI as written)/);
    expect(render(undefined).querySelectorAll('.mr-show-note')).toHaveLength(0);
  });

  it('notSentAsWritten: 한 block에 여러 줄이 있으면 값이 든 줄로 칸 안인지 본다 (#383 리뷰)', () => {
    // block l1 = 줄 0~2. 인적사항 칸은 줄 1~2만
    const documents = [{ documentId: 'L', pages: [{ blocks: [{ blockId: 'l1', text: '보증금 계좌 예금주 가상일\n임대인 가상이\n임차인 가상삼' }] }] }];
    const findings = [
      { id: 'OUT', documentId: 'L', blockId: 'l1', value: '가상일' },
      { id: 'IN', documentId: 'L', blockId: 'l1', value: '가상삼' },
      { id: 'UNKNOWN', documentId: 'L', blockId: 'l1', value: '어디에도없음' },
    ];
    const fields = { contract: { documentId: 'L', personalInfoRanges: [{ startLine: 1, endLine: 2 }] } };
    const m = notSentAsWritten({ documents, findings, fields }, { sending: [{ documentId: 'L', mode: 'PARTY_SUMMARY' }] });
    // 칸 밖 줄의 값은 AI에 그대로 가므로 표시하지 않는다. 값이 든 줄을 못 찾으면 block이 모두 칸 안일 때만 표시
    expect([...m]).toEqual([['IN', 'SUMMARY']]);

    const allIn = notSentAsWritten(
      { documents, findings, fields: { contract: { documentId: 'L', personalInfoRanges: [{ startLine: 0, endLine: 2 }] } } },
      { sending: [{ documentId: 'L', mode: 'PARTY_SUMMARY' }] },
    );
    expect([...allIn.keys()]).toEqual(['OUT', 'IN', 'UNKNOWN']);
  });

  it('notSentAsWritten: 한 사람이 요약으로 가는 곳과 그대로 가는 곳에 다 있으면 일부만 표시된다', () => {
    const findings = [
      { id: 'A', documentId: 'R', blockId: 'r1' },
      { id: 'B', documentId: 'L', blockId: 'l1' },
      { id: 'C', documentId: 'L', blockId: 'l2' },
    ];
    const documents = [
      { documentId: 'R', pages: [{ blocks: [{ blockId: 'r1', text: 'x' }] }] },
      { documentId: 'L', pages: [{ blocks: [{ blockId: 'l1', text: 'a\nb' }, { blockId: 'l2', text: 'c' }] }] },
    ];
    const fields = { contract: { documentId: 'L', personalInfoRanges: [{ startLine: 2, endLine: 2 }] } };
    const m = notSentAsWritten({ documents, findings, fields }, { sending: [{ documentId: 'R', mode: 'SUMMARY' }, { documentId: 'L', mode: 'PARTY_SUMMARY' }] });
    expect([...m]).toEqual([
      ['A', 'SUMMARY'],
      ['C', 'SUMMARY'],
    ]);
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

  it('등기·법인·임대사업자 번호 줄은 "Other registration no."로 보인다 (주민·외국인등록번호와 헷갈리지 않게)', () => {
    const { node } = render();
    const rows = rowsOf(node, 'Other registration no.');
    expect(rows.length).toBeGreaterThan(0);
    for (const tr of rows) expect(tr.cells[0].textContent).not.toMatch(/^(Resident|Foreigner)/);
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

  it('0.1초가 지나기 전에 다시 그려지면, 화면에서 빠진 예전 칸은 건너뛰고 새 칸이 한 번만 알린다', () => {
    vi.useFakeTimers();
    let edits = { remove: [], add: [] };
    const onChange = vi.fn((next) => {
      edits = next;
    });
    const { node } = render(edits, MASKING_PURPOSE.FRAUD_CHECK, onChange);

    // "월세"를 골라 가린다 (두 줄)
    const line = [...node.querySelectorAll('.mr-line')].find((l) => l.textContent?.includes('월세'));
    const text = /** @type {Text} */ (line?.firstChild);
    const at = text.data.indexOf('월세');
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + 2);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    /** @type {HTMLButtonElement} */ ([...node.querySelectorAll('button')].find((b) => b.textContent === 'Hide selected text')).click();

    // 0.1초 안에 두 번 그려진다: 첫 칸은 곧 화면에서 빠진다
    const first = render(edits, MASKING_PURPOSE.FRAUD_CHECK, onChange).node;
    const firstHint = first.querySelector('[role="status"]');
    const second = render(edits, MASKING_PURPOSE.FRAUD_CHECK, onChange).node;
    const secondHint = second.querySelector('[role="status"]');
    expect(firstHint?.isConnected).toBe(false);
    expect(secondHint?.textContent).toBe('');

    vi.advanceTimersByTime(100);
    expect(firstHint?.textContent).toBe(''); // 화면에 없는 칸은 건너뜀
    expect(secondHint?.textContent).toBe('Hid "월세" in 2 places. In the PDF, each of those lines is covered.');

    // 알린 뒤 또 그려지면 글이 처음부터 들어 있다 (다시 읽지 않음)
    const third = render(edits, MASKING_PURPOSE.FRAUD_CHECK, onChange).node;
    expect(third.querySelector('[role="status"]')?.textContent).toBe(
      'Hid "월세" in 2 places. In the PDF, each of those lines is covered.',
    );
  });
});
