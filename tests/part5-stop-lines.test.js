// @vitest-environment happy-dom
// PART 5. 보내기 전 검사가 멈춘 줄을 직접 가리고 진행하기 (#316). 가상 서류만 사용한다.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stopLinesOf, analyzeDocuments, prepareForAi } from '../src/app/pipeline.js';
import { addLineEdits, emptyEdits } from '../src/app/masking-edits.js';
import { stopLinesPanel } from '../src/app/stop-lines.js';
import { MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

const bbox = { x: 0.1, y: 0.2, width: 0.5, height: 0.02 };
const docs = [
  {
    documentId: 'DOC_A',
    pages: [
      { pageIndex: 0, blocks: [{ blockId: 'p0_b0', text: '임차인 (서명 또는 인)', bbox }] },
      {
        pageIndex: 1,
        blocks: [
          { blockId: 'p1_b3', text: '임대인 800101-1234567 김가상 (서명 또는 인)', bbox },
          { blockId: 'p1_b4', text: '   ', bbox },
        ],
      },
    ],
  },
];

describe('PART 5 stopLinesOf(): 검사가 준 위치 → 줄 (#316)', () => {
  it('documentId·blockId로 줄 글자와 쪽·위치를 찾는다 (가린 글이 없으면 원래 줄 글자를 가릴 조각으로)', () => {
    expect(stopLinesOf(/** @type {any} */ (docs), [{ documentId: 'DOC_A', blockId: 'p1_b3' }])).toEqual([
      { documentId: 'DOC_A', blockId: 'p1_b3', pageIndex: 1, bbox, text: '임대인 800101-1234567 김가상 (서명 또는 인)', values: ['임대인 800101-1234567 김가상 (서명 또는 인)'] },
    ]);
  });

  it('가린 글을 주면, 그 줄에 남은 조각만 가릴 값으로 고른다. 다른 줄에도 있는 서식 글 조각은 뺀다', () => {
    // 블록마다 한 줄: p0_b0, p1_b3, p1_b4
    const maskedText = { DOC_A: ['임차인 (서명 또는 인)', '임대인 [REDACTED] 김가상', '   '].join('\n') };
    const [line] = stopLinesOf(/** @type {any} */ (docs), [{ documentId: 'DOC_A', blockId: 'p1_b3' }], maskedText);
    expect(line.text).toBe('임대인 800101-1234567 김가상 (서명 또는 인)');
    expect(line.values).toEqual(['임대인', '김가상']);

    const withForm = { DOC_A: ['임대인 계약서 (서명 또는 인)', '임대인 [REDACTED] [Landlord_A] (서명 또는 인)', ''].join('\n') };
    // "임대인"과 "(서명 또는 인)"은 다른 줄에도 그대로 있어서 뺀다 (가리면 다른 줄에서 검사가 걸린다)
    expect(stopLinesOf(/** @type {any} */ (docs), [{ documentId: 'DOC_A', blockId: 'p1_b3' }], withForm)[0].values).toEqual([]);
  });

  it('없는 위치, 빈 줄, 같은 줄 두 번, 위치가 없는 경우는 뺀다', () => {
    const where = [
      { documentId: 'DOC_A', blockId: 'p1_b3' },
      { documentId: 'DOC_A', blockId: 'p1_b3' },
      { documentId: 'DOC_A', blockId: 'p1_b4' },
      { documentId: 'DOC_X', blockId: 'p0_b0' },
      { documentId: 'DOC_A', blockId: 'p9_b9' },
    ];
    expect(stopLinesOf(/** @type {any} */ (docs), where)).toHaveLength(1);
    expect(stopLinesOf(/** @type {any} */ (docs), undefined)).toEqual([]);
    expect(stopLinesOf(/** @type {any} */ (docs), 'x')).toEqual([]);
  });
});

describe('PART 5 addLineEdits(): 멈춘 줄 더 가리기 (#316)', () => {
  const line = { documentId: 'DOC_A', blockId: 'p1_b3', pageIndex: 1, bbox, text: '임대인 800101-1234567 김가상', values: ['임대인', '김가상'] };

  it('남은 조각마다 add(항상 REDACT)로 넣고 PDF 줄 위치(bbox)도 같이 넣는다. 해제(remove)는 그대로', () => {
    const next = addLineEdits({ remove: ['F1'], add: [] }, [line]);
    expect(next.remove).toEqual(['F1']);
    expect(next.add).toEqual([
      { id: 'line:DOC_A:p1_b3:0', documentId: 'DOC_A', blockId: 'p1_b3', value: '임대인', pageIndex: 1, bbox },
      { id: 'line:DOC_A:p1_b3:1', documentId: 'DOC_A', blockId: 'p1_b3', value: '김가상', pageIndex: 1, bbox },
    ]);
  });

  it('조각이 없으면 원래 줄 글자를 쓰고, 같은 조각은 두 번 넣지 않는다. 받은 값은 바꾸지 않는다', () => {
    const before = emptyEdits();
    expect(addLineEdits(before, [{ ...line, values: undefined }]).add.map((a) => a.value)).toEqual(['임대인 800101-1234567 김가상']);
    const once = addLineEdits(before, [line]);
    expect(addLineEdits(once, [line]).add).toHaveLength(2);
    expect(addLineEdits(before, [{ ...line, values: ['  '] }]).add).toEqual([]);
    expect(before.add).toEqual([]);
  });
});

describe('PART 5 stopLinesPanel(): 멈춘 줄 보여 주기 (#316)', () => {
  const lines = [
    { documentId: 'DOC_A', blockId: 'p1_b3', pageIndex: 1, bbox, text: '김가상 (서명 또는 인)', values: ['김가상 (서명 또는 인)'] },
    { documentId: 'DOC_A', blockId: 'p0_b0', pageIndex: 0, bbox, text: '가상 서류 제목', values: ['가상 서류 제목'] },
  ];

  it('줄이 없으면 아무것도 그리지 않는다', () => {
    expect(stopLinesPanel(undefined, vi.fn())).toBeNull();
    expect(stopLinesPanel([], vi.fn())).toBeNull();
  });

  it('줄마다 쪽 번호와 원래 글자, 체크(기본 선택)를 보여 주고, 고른 줄만 넘긴다', () => {
    const onHide = vi.fn();
    const node = /** @type {HTMLElement} */ (stopLinesPanel(lines, onHide));
    const items = [...node.querySelectorAll('.stop-line-list li')].map((li) => li.textContent);
    expect(items).toEqual([' Page 2: 김가상 (서명 또는 인)', ' Page 1: 가상 서류 제목']);
    const second = /** @type {HTMLInputElement} */ (node.querySelector('#stop-line-1'));
    expect(second.checked).toBe(true);
    second.checked = false;
    second.dispatchEvent(new Event('change'));
    /** @type {HTMLButtonElement} */ (node.querySelector('#hide-stop-lines')).click();
    expect(onHide).toHaveBeenCalledWith([lines[0]]);
  });

  it('하나도 고르지 않으면 가리기 버튼을 누를 수 없다', () => {
    const node = /** @type {HTMLElement} */ (stopLinesPanel([lines[0]], vi.fn()));
    const box = /** @type {HTMLInputElement} */ (node.querySelector('#stop-line-0'));
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(/** @type {HTMLButtonElement} */ (node.querySelector('#hide-stop-lines')).disabled).toBe(true);
  });

  it('줄 글자는 HTML로 해석하지 않는다 (textContent)', () => {
    const node = /** @type {HTMLElement} */ (stopLinesPanel([{ ...lines[0], text: '<img src=x onerror=alert(1)>' }], vi.fn()));
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('.stop-line-text')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('PART 5 탐지가 놓친 이름 줄을 가리면 보내기 전 검사를 통과한다 (#316)', () => {
  const file = (path, name) => new File([readFileSync(path)], name, { type: 'application/pdf' });

  it('등기부에서는 찾은 이름을 계약서에서 놓치면 멈추고, 그 줄들을 가리면 프롬프트까지 간다', async () => {
    const r = await analyzeDocuments({
      files: [file('public/samples/sample-registry.pdf', 'registry.pdf'), file('public/samples/sample-lease.pdf', 'lease.pdf')],
    });
    expect(r.ok).toBe(true);
    const analysis = r.data;
    const [registry, lease] = analysis.documents;
    // 두 서류에 모두 나오는 이름(소유자 = 임대인)을 계약서 탐지에서만 뺀다 (사진에서 칸 이름이 빠져 못 찾은 상황)
    const names = analysis.findings.filter((f) => f.type === PII_TYPE.PERSON_NAME);
    const shared = names.find((f) => f.documentId === registry.documentId && names.some((g) => g.documentId === lease.documentId && g.value === f.value));
    expect(shared).toBeDefined();
    const name = shared.value;
    const missedInLease = (f) => f.documentId === lease.documentId && f.type === PII_TYPE.PERSON_NAME && f.value === name;
    const broken = { ...analysis, findings: analysis.findings.filter((f) => !missedInLease(f)) };
    const purpose = MASKING_PURPOSE.CONTRACT_EXPLANATION;
    const stopped = prepareForAi(broken, purpose);
    expect(stopped.ok).toBe(false);
    expect(stopped.step).toBe('validateMaskedText');

    // PART 4가 준 실제 위치(where + lineBlocks, #328)로 찾은 줄: 계약서에서 그 이름이 남은 줄
    const lines = stopped.lines;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.documentId === lease.documentId)).toBe(true);
    expect(lines.every((l) => l.values.some((v) => v.includes(name)))).toBe(true);
    // 오류 메시지에는 값이 없다
    expect(stopped.error.message).not.toContain(name);

    const passed = prepareForAi(broken, purpose, addLineEdits(emptyEdits(), lines));
    expect(passed.ok).toBe(true);
    // 가린 줄의 이름은 AI 글에 없고, 마스킹 계획에 줄 위치가 REDACT로 들어간다 (PDF에서도 줄이 가려짐)
    expect(passed.data.prompt).not.toContain(name);
    for (const l of lines) {
      expect(passed.data.maskingPlan.items.some((i) => i.findingId.startsWith(`line:${l.documentId}:${l.blockId}:`) && i.action === 'REDACT')).toBe(true);
    }
  }, 60_000);

  it('사진 서류: 탐지가 놓친 역할 옆 이름에서 PART 4 사진 안전망이 멈추면, 그 줄을 보여 주고 가리면 통과한다', () => {
    const photo = {
      documentId: 'DOC_PHOTO',
      documentType: 'LEASE_CONTRACT',
      sourceType: 'image_pdf',
      pages: [
        {
          pageIndex: 0,
          width: 1000,
          height: 1400,
          blocks: [
            { blockId: 'p0_b0', text: '주택임대차표준계약서', bbox, confidence: 0.9 },
            { blockId: 'p0_b1', text: '임차인 왕리웨이', bbox, confidence: 0.6 },
          ],
        },
      ],
    };
    const analysis = { documents: [photo], findings: [], personGroups: [], riskResults: [] };
    const purpose = MASKING_PURPOSE.CLAUSE_EXPLANATION;
    const stopped = prepareForAi(analysis, purpose);
    expect(stopped.ok).toBe(false);
    expect(stopped.step).toBe('validateMaskedText');
    expect(stopped.lines.map((l) => [l.documentId, l.blockId, l.pageIndex])).toEqual([['DOC_PHOTO', 'p0_b1', 0]]);
    expect(stopped.error.message).not.toContain('왕리웨이');

    const passed = prepareForAi(analysis, purpose, addLineEdits(emptyEdits(), stopped.lines));
    expect(passed.ok).toBe(true);
    expect(passed.data.prompt).not.toContain('왕리웨이');
  });
});
