// @ts-check
/**
 * PART 5. 전체 처리 흐름 (파이프라인)
 *
 * 각 파트의 공개 함수만 순서대로 호출한다. 파트 내부 파일을 직접 import하지 않는다.
 * 어느 단계든 { ok: false }가 나오면 거기서 멈추고 어느 단계에서 실패했는지(step) 알려준다.
 *
 * 화면 단계에 맞춰 세 부분으로 나눈다.
 *   1) analyzeDocuments(): 서류 읽기 → 판별 → 개인정보 탐지 → 인물 판별 → 위험 점검   (목적 선택 전)
 *      = readDocuments() (서류 읽기) + analyzeReadDocuments() (나머지)
 *      사진·스캔 서류가 있으면 화면에서 둘 사이에 "Confirm text" 단계(PART 1 OCR 수정 화면)를 넣는다. (#54)
 *   1-1) recheckPeople():  ② "같은 사람인가요?" 답으로 사람 그룹을 합치고 위험 점검 다시 하기
 *   2) prepareForAi():     목적별 마스킹 → 남은 개인정보 검사 → AI 상담 프롬프트        (목적 선택 후)
 *   3) exportMaskedPdfs(): 마스킹 PDF 생성 (실패해도 나머지 결과는 유지)
 * runPipeline()은 세 부분을 한 번에 실행한다 (테스트·스크립트용).
 */

import { ok, fail, ERROR_CODE, SOURCE_TYPE, DOCUMENT_TYPE } from '../shared/document-model.js';
import { mergeDocumentModels } from './merge-documents.js';
import { readDocument, getFlaggedBlocks } from '../features/document-input/index.js';
import { classifyDocument, detectPII, extractFields } from '../features/document-analysis/index.js';
import { assessRisks, buildPrompt } from '../features/risk-check/index.js';
import {
  matchPeople,
  applyPersonAnswers,
  buildPersonQuestions,
  createMaskingPlan,
  applyMaskingPlan,
  validateMaskedText,
  getSendMode,
  SEND_MODE,
  buildRegistrySummary,
  buildContractPartySummary,
} from '../features/masking/index.js';
import { exportMaskedPDF, previewMaskedPages } from '../features/pdf-export/index.js';
import { emptyEdits, normalizeEdits } from './masking-edits.js';
import { findVisiblePii, unverifiable } from './double-check.js';
import { promptDocumentTitles, titledMaskedText } from './document-names.js';
import { withPageMarks, withPageMarksByBlocks } from './page-marks.js';
import { settlePersonAnswers } from './person-questions.js';

/**
 * @typedef {Object} Analysis  analyzeDocuments()의 결과
 * @property {File[]} files  documents[i]는 files[i]를 읽은 결과 (PDF 생성 때 원본으로 씀)
 * @property {import('../shared/document-model.js').DocumentModel[]} documents
 * @property {import('../shared/document-model.js').PiiFinding[]} findings
 * @property {any} fields
 * @property {any[]} personGroups
 * @property {import('../shared/document-model.js').RiskResult[]} riskResults
 */

/**
 * @typedef {Object} Prepared  prepareForAi()의 결과
 * @property {string} purpose
 * @property {import('../shared/document-model.js').MaskingPlan} maskingPlan
 * @property {Record<string, string>} maskedText
 * @property {Record<string, string>} legend
 * @property {string} prompt  보낼 서류가 하나도 없으면 빈 글 (#360)
 * @property {Record<string, string>} sentText  documentId → AI 프롬프트에 실제로 넣은 글 (쪽 표시 전). 안 보낸 서류는 없다
 * @property {SentDocument[]} sending  서류마다 어떻게 보냈는지 (완료 화면 안내용, #360)
 */

/**
 * 서류 하나를 AI에 어떻게 보냈는지 (#360)
 * - mode: 실제로 보낸 방식 (SEND_MODE). 요약을 못 만들어 뺐으면 OMIT
 *   PARTY_SUMMARY = 계약서 인적사항 칸만 요약으로 바꾸고 나머지는 가린 원문 (범위를 못 찾으면 MASKED_TEXT)
 * - reason: OMIT일 때 까닭. PURPOSE = 이 목적에는 안 보내는 서류, SUMMARY_FAILED = 요약을 못 만들어 뺌 (가린 원문으로 돌아가지 않음)
 * - hiddenCount: 요약에서 가린 줄 수 (SUMMARY일 때)
 * @typedef {{ documentId: string, documentType: string, mode: string, reason?: 'PURPOSE' | 'SUMMARY_FAILED', hiddenCount?: number }} SentDocument
 */

/**
 * 실패 결과에 단계 이름을 붙여 돌려준다.
 * @param {string} step
 * @param {{ ok: false, error: { code: string, message: string } }} result
 */
function stoppedAt(step, result) {
  return { ok: false, step, error: result.error };
}

/**
 * 보내기 전 검사가 멈춘 곳의 줄 (#316). 사용자가 화면에서 보고 "이 줄 전체 가리기"를 고를 수 있게 한다.
 * 줄 글자는 사용자 화면에만 쓰고, 오류 메시지·로그에는 넣지 않는다.
 * - text: 원래 줄 글자 (사용자가 서류와 비교한다)
 * - values: 가린 뒤에도 그 줄에 남아 있는 글자 조각. "더 가리기(add)"는 글자 값으로 가리고, 탐지한 값을 먼저 가린 뒤에
 *   적용되므로 원래 줄 전체 글자로는 맞지 않을 수 있다. 그래서 남은 조각을 가린다. (PDF는 줄 위치 bbox로 가린다)
 * @typedef {{ documentId: string, blockId: string, pageIndex: number, bbox: import('../shared/document-model.js').BBox, text: string, values: string[] }} StopLine
 */

/** 가린 글의 자리 표시: "[REDACTED]", 역할 가명 "[Landlord_A]" */
const MASK_PLACEHOLDER = /\[(?:REDACTED|[A-Za-z]+_[A-Z])\]/;

/**
 * PART 4가 돌려준 위치({ documentId, blockId })를 서류의 줄로 바꾼다. 못 찾는 위치·빈 줄·같은 줄은 뺀다.
 * maskedText(가린 글, 블록마다 한 줄)를 주면 그 줄에 남은 조각(values)을 계산한다.
 * 다른 줄에도 그대로 있는 조각("(서명 또는 인)" 같은 서식 글)은 개인정보가 아니고, 가리면 검사가 다른 줄에서 걸리므로 뺀다.
 * @param {import('../shared/document-model.js').DocumentModel[]} documents
 * @param {unknown} where
 * @param {Record<string, string>} [maskedText]
 * @returns {StopLine[]}
 */
export function stopLinesOf(documents, where, maskedText) {
  if (!Array.isArray(where)) return [];
  /** @type {(Omit<StopLine, 'values'> & { masked: string, index: number })[]} */
  const found = [];
  const seen = new Set();
  for (const w of where) {
    const key = `${w?.documentId}\u0000${w?.blockId}`;
    if (seen.has(key)) continue;
    const doc = documents.find((d) => d.documentId === w?.documentId);
    if (!doc) continue;
    const maskedLines = maskedText?.[doc.documentId]?.split('\n');
    let index = 0;
    for (const page of doc.pages ?? []) {
      for (const block of page.blocks ?? []) {
        if (block.blockId === w?.blockId && String(block.text ?? '').trim()) {
          seen.add(key);
          found.push({
            documentId: doc.documentId,
            blockId: block.blockId,
            pageIndex: page.pageIndex,
            bbox: block.bbox,
            text: block.text,
            masked: maskedLines?.[index] ?? block.text,
            index,
          });
        }
        index += 1;
      }
    }
  }
  // 멈춘 줄을 뺀 나머지 가린 글 (조각이 다른 줄에도 있는지 볼 때 쓴다)
  const stopKeys = new Set(found.map((l) => `${l.documentId}\u0000${l.index}`));
  const others = Object.entries(maskedText ?? {})
    .flatMap(([id, text]) => text.split('\n').filter((_, i) => !stopKeys.has(`${id}\u0000${i}`)))
    .join('\n');
  return found.map(({ masked, index, ...line }) => {
    const pieces = masked
      .split(MASK_PLACEHOLDER)
      .map((p) => p.trim())
      .filter((p) => p.replace(/\s+/g, '').length >= 2 && !others.includes(p));
    return { ...line, values: [...new Set(pieces)] };
  });
}

/**
 * 1) 서류 분석: 목적을 고르기 전에 할 수 있는 일 전부
 * @param {{ files: File[] }} input
 */
export async function analyzeDocuments({ files }) {
  const read = await readDocuments({ files });
  if (!read.ok) return read;
  return analyzeReadDocuments(read.data);
}

/**
 * 1-a) 서류 읽기만 한다 (PART 1). documents[i]는 files[i]를 읽은 결과.
 * parts[i]가 있으면(조각 2개 이상) 조각마다 따로 읽고 한 서류로 잇는다 (#298: 계약서 PDF + 특약 별지 PDF·사진).
 *   files[i]는 그 조각들을 같은 순서로 합친 PDF라서, 마스킹 PDF·미리 보기는 files[i]로 그린다.
 *   partTypes[i]: 조각마다 판별한 서류 종류 (PART 2 classifyDocument). 한 칸에 다른 서류가 섞였는지 안내할 때 쓴다 (#305)
 *   조각이 하나면 partTypes[i]는 null (서류 전체 판별과 같으므로).
 * @param {{ files: File[], parts?: (File[] | null | undefined)[] }} input
 * @param {{ allowLowConfidence?: boolean, onProgress?: (p: ReadProgress) => void }} [options]
 *   allowLowConfidence: 사진·스캔에서 흐린 줄이 있어도 멈추지 않고 돌려받는다.
 *   이때는 반드시 "Confirm text" 단계에서 흐린 줄을 사용자가 모두 확인한 뒤에 analyzeReadDocuments()로 넘긴다.
 *   onProgress: 서류(조각)를 읽기 시작할 때, 그리고 PART 1이 쪽마다 onPage를 부르면 쪽마다 불린다 (진행 표시용)
 */
export async function readDocuments({ files, parts }, options = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    return { ...fail(ERROR_CODE.INVALID_INPUT, 'Please choose at least one file.'), step: 'input' };
  }
  const { onProgress, ...readOptions } = options;
  /** 진행을 알리고, PART 1에는 쪽마다 알려 달라고 onPage를 넘긴다 (PART 1이 부르지 않아도 동작한다) */
  const read1 = (/** @type {File} */ f, /** @type {Omit<ReadProgress, 'pageIndex' | 'pageCount'>} */ at) => {
    const report = (/** @type {Partial<ReadProgress>} */ extra = {}) => {
      try {
        onProgress?.({ ...at, ...extra });
      } catch {
        // 진행 표시가 실패해도 읽기는 계속한다
      }
    };
    report();
    return readDocument(f, {
      ...readOptions,
      onPage: (/** @type {{ pageIndex: number, pageCount: number }} */ p) => report({ pageIndex: p.pageIndex, pageCount: p.pageCount }),
    });
  };
  const documents = [];
  /** @type {(string[] | null)[]} */
  const partTypes = [];
  for (const [i, file] of files.entries()) {
    const pieces = parts?.[i];
    if (pieces && pieces.length > 1) {
      const read = [];
      for (const [k, piece] of pieces.entries()) {
        const r = await read1(piece, { docIndex: i, docCount: files.length, partIndex: k, partCount: pieces.length });
        if (!r.ok) return stoppedAt('readDocument', r);
        read.push(r.data);
      }
      documents.push(mergeDocumentModels(read));
      // 판별은 안내용이라 실패해도 멈추지 않고 "모름"으로 둔다 (서류 전체 판별은 analyzeReadDocuments에서 다시 한다)
      partTypes.push(
        read.map((d) => {
          const c = classifyDocument(d);
          return c.ok ? c.data.documentType : DOCUMENT_TYPE.UNKNOWN;
        }),
      );
      continue;
    }
    const r = await read1(file, { docIndex: i, docCount: files.length, partIndex: 0, partCount: 1 });
    if (!r.ok) return stoppedAt('readDocument', r);
    documents.push(r.data);
    partTypes.push(null);
  }
  return ok({ files, documents, partTypes });
}

/**
 * 읽기 진행 (0부터 세는 번호). pageIndex·pageCount는 PART 1이 쪽마다 알려 줄 때만 있다.
 * @typedef {{ docIndex: number, docCount: number, partIndex: number, partCount: number, pageIndex?: number, pageCount?: number }} ReadProgress
 */

/** OCR로 읽은 서류인지 (사진 또는 글자 없는 스캔 PDF) → "Confirm text" 단계에서 확인한다 */
export function needsTextReview(/** @type {import('../shared/document-model.js').DocumentModel} */ doc) {
  return doc.sourceType === SOURCE_TYPE.IMAGE || doc.sourceType === SOURCE_TYPE.IMAGE_PDF;
}

/**
 * 아직 사용자가 확인하지 않은 줄 수 (PART 1 getFlaggedBlocks 기준: 흐린 줄 + 당사자·주소 같은 핵심 줄)
 * 편집 화면이 보여 주는 수와 같아야 한다. 0이 되어야 "Confirm text" 단계에서 다음으로 넘어갈 수 있다.
 * @param {import('../shared/document-model.js').DocumentModel[]} documents
 */
export function countLinesToCheck(documents) {
  return getFlaggedBlocks(documents).length;
}

/**
 * 1-b) 읽은 서류로 나머지 분석: 판별 → 개인정보 탐지 → 인물 판별 → 위험 점검
 * @param {{ files: File[], documents: import('../shared/document-model.js').DocumentModel[] }} input
 */
export function analyzeReadDocuments({ files, documents: readDocs }) {
  // 판별 결과를 문서에 적으므로, 넘겨받은 문서를 바꾸지 않게 복사해서 쓴다
  const documents = structuredClone(readDocs);

  // 문서 판별 + 개인정보 탐지 (PART 2)
  const findings = [];
  for (const doc of documents) {
    const c = classifyDocument(doc);
    if (!c.ok) return stoppedAt('classifyDocument', c);
    doc.documentType = c.data.documentType;

    const d = detectPII(doc);
    if (!d.ok) return stoppedAt('detectPII', d);
    findings.push(...d.data);
  }

  const fields = extractFields(documents, findings);
  if (!fields.ok) return stoppedAt('extractFields', fields);

  // 인물 판별 (PART 4)
  const people = matchPeople(fields.data);
  if (!people.ok) return stoppedAt('matchPeople', people);

  // 위험 점검 (PART 3)
  const risks = assessRisks(fields.data, people.data);
  if (!risks.ok) return stoppedAt('assessRisks', risks);

  /** @type {Analysis} */
  const analysis = {
    files,
    documents,
    findings,
    fields: fields.data,
    personGroups: people.data,
    riskResults: risks.data,
  };
  return ok(analysis);
}

/**
 * @typedef {Object} Checked  recheckPeople()의 결과 ("같은 사람인가요?" 답을 반영한 판정)
 * @property {any[]} personGroups  답으로 합친 그룹
 * @property {import('../shared/document-model.js').RiskResult[]} riskResults  합친 그룹으로 다시 점검한 결과
 * @property {Record<string, string | null>} personAnswers  화면과 맞춘 답 (숨긴 카드의 답·엇갈린 답을 뺌, #171). 이것을 저장한다
 */

/**
 * 1-1) ② 화면의 "같은 사람인가요?" 답으로 사람 그룹을 합치고 위험 점검을 다시 한다. (docs/INTERFACES.md 6번)
 * 서류를 다시 읽지 않는다. 원래 analysis.personGroups·riskResults는 바꾸지 않는다 (답을 바꾸면 원래 판정에서 다시 계산).
 * @param {Analysis} analysis
 * @param {Record<string, string | null>} personAnswers  { P4: 'P2' } 같은 사람 / { P4: null } 다른 사람 / 키 없음 = 안 답함
 */
export function recheckPeople(analysis, personAnswers) {
  // 같은 두 사람 질문은 한 번만 보이므로(#171), 숨긴 카드의 답·엇갈린 답은 지우고 앞 카드 답으로 정해진 답을 더한다
  const questions = buildPersonQuestions(analysis.fields, analysis.personGroups);
  const settled = settlePersonAnswers(questions, personAnswers);
  const merged = applyPersonAnswers(analysis.personGroups, settled.effective);
  if (!merged.ok) return stoppedAt('applyPersonAnswers', merged);

  const risks = assessRisks(analysis.fields, merged.data);
  // 처음 분석('assessRisks')과 달리 이전 결과가 화면에 남아 있으므로 단계를 따로 둔다 (#126)
  if (!risks.ok) return stoppedAt('recheckRisks', risks);

  /** @type {Checked} */
  const checked = { personGroups: merged.data, riskResults: risks.data, personAnswers: settled.answers };
  return ok(checked);
}

/**
 * 2) AI 상담 준비: 목적에 맞게 가리고, 남은 개인정보를 검사하고, 프롬프트를 만든다.
 * @param {Analysis} analysis
 * @param {string} purpose  MASKING_PURPOSE 값
 * @param {import('./masking-edits.js').MaskingEdits} [edits]  ④에서 사용자가 해제·추가한 내용 (규칙은 PART 4가 적용)
 */
export function prepareForAi(analysis, purpose, edits = emptyEdits()) {
  const { documents, findings, personGroups, riskResults } = analysis;

  // 사용자가 더 가린 글자(add)는 findings에 없으므로, 가리기·검사 단계에도 edits를 함께 넘긴다
  const userEdits = normalizeEdits(edits);

  const plan = createMaskingPlan(findings, personGroups, purpose, userEdits);
  if (!plan.ok) return stoppedAt('createMaskingPlan', plan);

  const masked = applyMaskingPlan(documents, plan.data, findings, personGroups, userEdits);
  if (!masked.ok) return stoppedAt('applyMaskingPlan', masked);

  // 사진(OCR) 서류는 PART 4 사진용 안전망(역할 옆 이름, 동이 붙은 호수)도 본다
  const photoDocumentIds = documents.filter(needsTextReview).map((d) => d.documentId);
  // lineBlocks를 넘기면 멈춘 곳 위치(where)에 blockId가 들어간다 (#328)
  const check = validateMaskedText(masked.data.maskedText, findings, plan.data, userEdits, {
    photoDocumentIds,
    lineBlocks: masked.data.lineBlocks,
  });
  if (!check.ok) {
    // 검사가 남은 곳의 위치(where)를 주면, 사용자가 그 줄을 직접 가리고 다시 진행할 수 있게 줄 정보를 붙인다 (#316)
    const lines = stopLinesOf(documents, /** @type {any} */ (check).where, masked.data.maskedText);
    return lines.length > 0 ? { ...stoppedAt('validateMaskedText', check), lines } : stoppedAt('validateMaskedText', check);
  }

  // 목적별로 서류마다 보낼 방식을 정한다 (#360, PART 4 send-mode.json)
  // 위 검사는 모든 서류의 가린 글로 그대로 한다: 마스킹 PDF도 같은 계획으로 만들므로, 보내지 않는 서류도 검사에서 빼지 않는다
  const selected = selectSentText(analysis, purpose, masked.data, userEdits);

  // 요약을 넣은 글도 보내기 전 검사를 한 번 더 거친다 (요약 함수가 미리 검사하지만, 나가는 글은 모두 같은 검사를 통과해야 한다)
  // 등기부 요약 줄은 서류의 줄과 이어지지 않으므로 lineBlocks가 없다 → 멈추면 "이 줄 가리기" 없이 일반 안내만 나온다
  // 인적사항 요약을 넣은 계약서는 PART 4가 돌려준 줄 순서(lineBlocks)를 넘겨, 원문 줄에서 멈추면 그 줄을 알려 준다
  const summarized = selected.sending.filter((s) => s.mode === SEND_MODE.SUMMARY || s.mode === SEND_MODE.PARTY_SUMMARY);
  if (summarized.length > 0) {
    const summaryCheck = validateMaskedText(
      Object.fromEntries(summarized.map((s) => [s.documentId, selected.sentText[s.documentId]])),
      findings,
      plan.data,
      userEdits,
      { photoDocumentIds, lineBlocks: /** @type {Record<string, string[]>} */ (/** @type {unknown} */ (selected.sentLineBlocks)) },
    );
    if (!summaryCheck.ok) {
      const lines = stopLinesOf(documents, /** @type {any} */ (summaryCheck).where, masked.data.maskedText);
      return lines.length > 0 ? { ...stoppedAt('validateMaskedText', summaryCheck), lines } : stoppedAt('validateMaskedText', summaryCheck);
    }
  }

  // 프롬프트에는 마스킹 완료 텍스트(또는 요약)와 범례만 넣는다 (PART 3)
  // 서류 제목은 내부 ID 대신 "Property register (등기부등본)" 같은 이름으로 넘긴다 (#240)
  // 쪽 표시("--- page 2 ---")를 넣어 AI가 몇 쪽인지 밝힐 수 있게 한다. 검사한 글과 다르게 나오면 쪽 표시 없이 보낸다
  //  - 가린 원문: 지금처럼 쪽마다 다시 가려 맞춰 본다 (withPageMarks)
  //  - 인적사항 요약을 넣은 계약서: 줄마다의 blockId로 쪽을 찾아 표시만 끼운다 (withPageMarksByBlocks)
  //  - 등기부 요약: 쪽과 이어지지 않으므로 쪽 표시를 넣지 않는다
  const maskedOnly = Object.fromEntries(
    selected.sending.filter((s) => s.mode === SEND_MODE.MASKED_TEXT).map((s) => [s.documentId, selected.sentText[s.documentId]]),
  );
  const paged = withPageMarks(documents, maskedOnly, (docs) => {
    const r = applyMaskingPlan(docs, plan.data, findings, personGroups, userEdits);
    return r.ok ? r.data.maskedText : null;
  });
  for (const [documentId, blocks] of Object.entries(selected.sentLineBlocks)) {
    paged[documentId] = withPageMarksByBlocks(
      documents.find((d) => d.documentId === documentId),
      selected.sentText[documentId],
      blocks,
    );
  }
  /** @type {Record<string, string>} 올린 순서대로 */
  const promptText = {};
  for (const documentId of Object.keys(selected.sentText)) promptText[documentId] = paged[documentId] ?? selected.sentText[documentId];

  // 이 목적에 보낼 서류가 하나도 없으면(예: 등기부만 올리고 계약 조건 설명) 프롬프트 없이 진행한다.
  // 마스킹 PDF는 그대로 만들 수 있어야 하므로 멈추지 않는다. 완료 화면이 sending으로 까닭을 알려 준다.
  let promptData = '';
  if (Object.keys(promptText).length > 0) {
    // import { promptDocumentTitles, titledMaskedText } from './document-names.js';  ← promptDocumentTitles 추가
    const titles = promptDocumentTitles(documents);
    const registrySent = selected.sending.find((s) => s.mode === SEND_MODE.SUMMARY);
    const registryFailed = selected.sending.some((s) => s.mode === SEND_MODE.OMIT && s.reason === 'SUMMARY_FAILED');

    const prompt = buildPrompt({
      purpose,
      riskResults,
      maskedText: titledMaskedText(promptText, documents),
      legend: masked.data.legend,
      monthlyRent: analysis.fields?.contract?.monthlyRent,
      registry: {
      summaryTitle: registrySent ? titles.get(registrySent.documentId) : null,
      unavailable: registryFailed,
      },
    });
    if (!prompt.ok) return stoppedAt('buildPrompt', prompt);
    promptData = prompt.data;
  }

  /** @type {Prepared} */
  const prepared = {
    purpose,
    maskingPlan: plan.data,
    maskedText: masked.data.maskedText,
    legend: masked.data.legend,
    prompt: promptData,
    sentText: selected.sentText,
    sending: selected.sending,
  };
  return ok(prepared);
}

/**
 * 서류마다 AI에 보낼 글을 고른다 (#360). 올린 순서를 지킨다.
 *  - OMIT: 이 목적에는 보내지 않는다 (예: 계약 조건 설명의 등기부)
 *  - SUMMARY: PART 4 buildRegistrySummary() 요약. 못 만들면 그 서류를 뺀다. 가린 원문으로 돌아가지 않는다.
 *    요약은 extractFields()의 registry 하나로 만든다. 등기부를 두 개 올려 데이터가 없는 등기부도 같은 이유로 뺀다.
 *  - PARTY_SUMMARY: PART 4 buildContractPartySummary()로 가린 계약서의 인적사항 칸만 요약으로 바꾼다 (본문·특약은 가린 원문).
 *    인적사항 칸 범위를 못 찾으면(replaced: false) 가린 원문 그대로 보낸다. 팀 합의에서 원문을 허용한 유일한 경우다.
 *    요약은 extractFields()의 contract 하나로 만든다. 특약 별지 같은 다른 계약서 서류는 가린 원문.
 *  - MASKED_TEXT(그 밖): 지금처럼 가린 원문
 * @param {Analysis} analysis
 * @param {string} purpose
 * @param {{ maskedText: Record<string, string>, legend: Record<string, string>, lineBlocks?: Record<string, string[]> }} masked
 * @param {import('./masking-edits.js').MaskingEdits} userEdits
 * @returns {{ sentText: Record<string, string>, sending: SentDocument[], sentLineBlocks: Record<string, (string | null)[]> }}
 *   sentLineBlocks: 인적사항 요약을 넣은 계약서의 줄 순서대로 blockId (요약 줄은 null). 검사·쪽 표시에 쓴다
 */
function selectSentText(analysis, purpose, masked, userEdits) {
  /** @type {Record<string, string>} */
  const sentText = {};
  /** @type {SentDocument[]} */
  const sending = [];
  /** @type {Record<string, (string | null)[]>} */
  const sentLineBlocks = {};
  const registryFields = analysis.fields?.registry;
  const contractFields = analysis.fields?.contract;
  for (const doc of analysis.documents) {
    const { documentId } = doc;
    const documentType = doc.documentType ?? DOCUMENT_TYPE.UNKNOWN;
    const text = masked.maskedText[documentId];
    if (typeof text !== 'string') continue;
    const mode = getSendMode(purpose, documentType);

    if (mode === SEND_MODE.OMIT) {
      sending.push({ documentId, documentType, mode: SEND_MODE.OMIT, reason: 'PURPOSE' });
      continue;
    }
    if (mode === SEND_MODE.SUMMARY) {
      const summary =
        registryFields?.documentId === documentId
          ? buildRegistrySummary(registryFields, analysis.personGroups, masked.legend, userEdits)
          : null;
      if (summary?.ok) {
        sentText[documentId] = summary.data.text;
        sending.push({ documentId, documentType, mode: SEND_MODE.SUMMARY, hiddenCount: summary.data.hiddenCount });
      } else {
        sending.push({ documentId, documentType, mode: SEND_MODE.OMIT, reason: 'SUMMARY_FAILED' });
      }
      continue;
    }
    if (mode === SEND_MODE.PARTY_SUMMARY && contractFields?.documentId === documentId) {
      const party = buildContractPartySummary({
        maskedText: text,
        contractFields,
        personGroups: analysis.personGroups,
        purpose,
        legend: masked.legend,
        lineBlocks: masked.lineBlocks?.[documentId],
        registryFields,
        document: doc,
      });
      if (party.ok && party.data.replaced) {
        sentText[documentId] = party.data.text;
        if (Array.isArray(party.data.lineBlocks)) sentLineBlocks[documentId] = party.data.lineBlocks;
        sending.push({ documentId, documentType, mode: SEND_MODE.PARTY_SUMMARY });
        continue;
      }
    }
    sentText[documentId] = text;
    sending.push({ documentId, documentType, mode: SEND_MODE.MASKED_TEXT });
  }
  return { sentText, sending, sentLineBlocks };
}

/**
 * 3) 서류마다 마스킹 PDF를 만든다. 한 서류가 실패해도 나머지는 계속 만든다.
 * @param {Analysis} analysis
 * @param {import('../shared/document-model.js').MaskingPlan} maskingPlan
 */
export async function exportMaskedPdfs(analysis, maskingPlan) {
  const pdfs = [];
  for (const [i, doc] of analysis.documents.entries()) {
    const docPlan = { ...maskingPlan, items: maskingPlan.items.filter((item) => item.documentId === doc.documentId) };
    pdfs.push({
      documentId: doc.documentId,
      documentType: doc.documentType,
      result: await exportMaskedPDF(doc, docPlan, { file: analysis.files[i] }),
    });
  }
  return pdfs;
}

/**
 * 3-1) ⑤ "Double-check the PDF": 만든 마스킹 PDF를 OCR로 다시 읽어 탐지했던 개인정보가 보이는지 찾는다.
 * (노션 10장: 생성된 PDF를 다시 OCR하여 개인정보가 눈에 보이게 남아 있지 않은지 확인)
 * OCR은 PART 1 공개 함수 readDocument()를 그대로 쓴다. 이미지로만 된 PDF라서 PART 1이 OCR로 읽는다.
 * 한 서류가 실패해도 나머지는 계속 검사하고, 못 읽으면 "확인 불가"로 둔다.
 * 흐린 줄이 있어도 끝까지 읽고(allowLowConfidence), 흐린 줄은 double-check.js가 "확인하지 못한 줄"로 따로 센다. (#146)
 * @param {Analysis} analysis  답을 반영한 분석 결과 (findings 비교용)
 * @param {import('../shared/document-model.js').MaskingPlan} maskingPlan
 * @param {any[]} pdfs  exportMaskedPdfs() 결과
 */
export async function doubleCheckPdfs(analysis, maskingPlan, pdfs) {
  const results = [];
  for (const pdf of pdfs) {
    let check;
    if (!pdf.result.ok) {
      check = unverifiable(pdf.result.error.code);
    } else {
      const file = new File([pdf.result.data.blob], pdf.result.data.fileName, { type: 'application/pdf' });
      const read = await readDocument(file, { allowLowConfidence: true });
      check = read.ok
        ? findVisiblePii(
            read.data,
            analysis.findings.filter((f) => f.documentId === pdf.documentId),
            maskingPlan,
          )
        : unverifiable(read.error.code);
    }
    results.push({ documentId: pdf.documentId, documentType: pdf.documentType, ...check });
  }
  return results;
}

/**
 * ④ 확인 화면용: 서류마다 마스킹된 페이지 미리보기 이미지를 만든다. (PDF와 같은 방법으로 그림)
 * 한 서류가 실패해도 나머지는 계속 만든다.
 * @param {Analysis} analysis
 * @param {import('../shared/document-model.js').MaskingPlan} maskingPlan
 */
export async function previewMaskedPdfs(analysis, maskingPlan) {
  const previews = [];
  for (const [i, doc] of analysis.documents.entries()) {
    const docPlan = { ...maskingPlan, items: maskingPlan.items.filter((item) => item.documentId === doc.documentId) };
    previews.push({
      documentId: doc.documentId,
      documentType: doc.documentType,
      result: await previewMaskedPages(doc, docPlan, { file: analysis.files[i] }),
    });
  }
  return previews;
}

/**
 * 세 부분을 한 번에 실행한다.
 * @param {{ files: File[], purpose: string }} input
 */
export async function runPipeline({ files, purpose }) {
  const analyzed = await analyzeDocuments({ files });
  if (!analyzed.ok) return analyzed;

  const prepared = prepareForAi(analyzed.data, purpose);
  if (!prepared.ok) return prepared;

  const { files: _files, ...analysis } = analyzed.data;
  return ok({
    ...analysis,
    ...prepared.data,
    pdfs: await exportMaskedPdfs(analyzed.data, prepared.data.maskingPlan),
  });
}

// PART 1 OCR 수정 화면. PART 1 코드는 pdf.js·OCR 때문에 커서 첫 화면에 싣지 않고,
// 이 파일(처리 코드)을 불러올 때 같이 불러와 slots.ocrEditor에 넣는다. (main.js loadPipeline)
export { renderOcrEditor } from '../features/document-input/index.js';
