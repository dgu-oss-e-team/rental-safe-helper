// @ts-check
/**
 * PART 5. 전체 처리 흐름 (파이프라인)
 *
 * 각 파트의 공개 함수만 순서대로 호출한다. 파트 내부 파일을 직접 import하지 않는다.
 * 어느 단계든 { ok: false }가 나오면 거기서 멈추고 어느 단계에서 실패했는지(step) 알려준다.
 *
 * 화면 단계에 맞춰 세 부분으로 나눈다.
 *   1) analyzeDocuments(): 서류 읽기 → 판별 → 개인정보 탐지 → 인물 판별 → 위험 점검   (목적 선택 전)
 *   1-1) recheckPeople():  ② "같은 사람인가요?" 답으로 사람 그룹을 합치고 위험 점검 다시 하기
 *   2) prepareForAi():     목적별 마스킹 → 남은 개인정보 검사 → AI 상담 프롬프트        (목적 선택 후)
 *   3) exportMaskedPdfs(): 마스킹 PDF 생성 (실패해도 나머지 결과는 유지)
 * runPipeline()은 세 부분을 한 번에 실행한다 (테스트·스크립트용).
 */

import { ok, fail, ERROR_CODE } from '../shared/document-model.js';
import { readDocument } from '../features/document-input/index.js';
import { classifyDocument, detectPII, extractFields } from '../features/document-analysis/index.js';
import { assessRisks, buildPrompt } from '../features/risk-check/index.js';
import {
  matchPeople,
  applyPersonAnswers,
  createMaskingPlan,
  applyMaskingPlan,
  validateMaskedText,
} from '../features/masking/index.js';
import { exportMaskedPDF, previewMaskedPages } from '../features/pdf-export/index.js';
import { emptyEdits, normalizeEdits } from './masking-edits.js';
import { findVisiblePii, unverifiable } from './double-check.js';

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
 * @property {string} prompt
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
 * 1) 서류 분석: 목적을 고르기 전에 할 수 있는 일 전부
 * @param {{ files: File[] }} input
 */
export async function analyzeDocuments({ files }) {
  if (!Array.isArray(files) || files.length === 0) {
    return { ...fail(ERROR_CODE.INVALID_INPUT, 'Please choose at least one file.'), step: 'input' };
  }

  // 서류 읽기 (PART 1)
  const documents = [];
  for (const file of files) {
    const r = await readDocument(file);
    if (!r.ok) return stoppedAt('readDocument', r);
    documents.push(r.data);
  }

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
 */

/**
 * 1-1) ② 화면의 "같은 사람인가요?" 답으로 사람 그룹을 합치고 위험 점검을 다시 한다. (docs/INTERFACES.md 6번)
 * 서류를 다시 읽지 않는다. 원래 analysis.personGroups·riskResults는 바꾸지 않는다 (답을 바꾸면 원래 판정에서 다시 계산).
 * @param {Analysis} analysis
 * @param {Record<string, string | null>} personAnswers  { P4: 'P2' } 같은 사람 / { P4: null } 다른 사람 / 키 없음 = 안 답함
 */
export function recheckPeople(analysis, personAnswers) {
  const merged = applyPersonAnswers(analysis.personGroups, personAnswers);
  if (!merged.ok) return stoppedAt('applyPersonAnswers', merged);

  const risks = assessRisks(analysis.fields, merged.data);
  if (!risks.ok) return stoppedAt('assessRisks', risks);

  /** @type {Checked} */
  const checked = { personGroups: merged.data, riskResults: risks.data };
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

  const check = validateMaskedText(masked.data.maskedText, findings, plan.data, userEdits);
  if (!check.ok) return stoppedAt('validateMaskedText', check);

  // 프롬프트에는 마스킹 완료 텍스트와 범례만 넣는다 (PART 3)
  const prompt = buildPrompt({
    purpose,
    riskResults,
    maskedText: masked.data.maskedText,
    legend: masked.data.legend,
  });
  if (!prompt.ok) return stoppedAt('buildPrompt', prompt);

  /** @type {Prepared} */
  const prepared = {
    purpose,
    maskingPlan: plan.data,
    maskedText: masked.data.maskedText,
    legend: masked.data.legend,
    prompt: prompt.data,
  };
  return ok(prepared);
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
      const read = await readDocument(file);
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
