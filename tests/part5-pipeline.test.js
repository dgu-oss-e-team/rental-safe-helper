import { describe, it, expect } from 'vitest';
import { runPipeline, analyzeDocuments, prepareForAi, exportMaskedPdfs } from '../src/app/pipeline.js';
import { checkPlanCoordinates } from '../src/features/pdf-export/index.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

const sampleFiles = () => [
  new File([''], 'sample-registry.pdf', { type: 'application/pdf' }),
  new File([''], 'sample-lease.pdf', { type: 'application/pdf' }),
];

describe('PART 5 전체 파이프라인 (Mock 연결)', () => {
  it('파일 두 개로 처음부터 프롬프트까지 연결된다', async () => {
    const r = await runPipeline({ files: sampleFiles(), purpose: MASKING_PURPOSE.FRAUD_CHECK });
    expect(r.ok).toBe(true);
    expect(r.data.documents).toHaveLength(2);
    expect(r.data.prompt).toContain('Please answer in English.');
  });

  it('프롬프트에 원본 개인정보가 들어가지 않는다', async () => {
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const r = await runPipeline({ files: sampleFiles(), purpose });
      for (const f of r.data.findings) expect(r.data.prompt).not.toContain(f.value);
    }
  });

  it('잘못된 파일이면 어느 단계에서 멈췄는지 알려준다', async () => {
    const r = await runPipeline({
      files: [new File([''], 'notes.txt', { type: 'text/plain' })],
      purpose: MASKING_PURPOSE.FRAUD_CHECK,
    });
    expect(r).toMatchObject({ ok: false, step: 'readDocument', error: { code: 'UNSUPPORTED_FILE' } });
  });

  it('좌표가 규칙을 벗어난 마스킹 계획은 PDF 생성 전에 걸러진다', () => {
    const plan = { purpose: 'FRAUD_CHECK', items: [{ bbox: { x: 100, y: 0, width: 10, height: 10 } }] };
    expect(checkPlanCoordinates(plan).ok).toBe(false);
  });

  // 실제 PDF 생성·검증은 tests/part5-pdf-export.test.js에서 한다
});

describe('PART 5 화면 단계별 파이프라인', () => {
  it('분석 → 목적 선택 → AI 준비를 나눠 실행해도 한 번에 실행한 결과와 같다', async () => {
    const analyzed = await analyzeDocuments({ files: sampleFiles() });
    expect(analyzed.ok).toBe(true);
    const prepared = prepareForAi(analyzed.data, MASKING_PURPOSE.FRAUD_CHECK);
    const all = await runPipeline({ files: sampleFiles(), purpose: MASKING_PURPOSE.FRAUD_CHECK });
    expect(prepared.data.prompt).toBe(all.data.prompt);
    expect(prepared.data.maskingPlan).toEqual(all.data.maskingPlan);
  });

  it('한 번 분석한 결과로 목적만 바꿔서 다시 준비할 수 있다 (서류를 다시 읽지 않음)', async () => {
    const analyzed = (await analyzeDocuments({ files: sampleFiles() })).data;
    const fraud = prepareForAi(analyzed, MASKING_PURPOSE.FRAUD_CHECK).data;
    const clause = prepareForAi(analyzed, MASKING_PURPOSE.CLAUSE_EXPLANATION).data;
    expect(fraud.prompt).toContain('Role legend');
    expect(clause.prompt).not.toContain('Role legend');
  });

  it('알 수 없는 목적이면 어느 단계에서 멈췄는지 알려준다', async () => {
    const analyzed = (await analyzeDocuments({ files: sampleFiles() })).data;
    expect(prepareForAi(analyzed, 'WHATEVER')).toMatchObject({ ok: false, step: 'createMaskingPlan' });
  });

  it('PDF는 서류마다 결과가 하나씩 나오고, 실패해도 오류를 던지지 않는다 (Node에는 캔버스가 없음)', async () => {
    const analyzed = (await analyzeDocuments({ files: sampleFiles() })).data;
    const prepared = prepareForAi(analyzed, MASKING_PURPOSE.FRAUD_CHECK).data;
    const pdfs = await exportMaskedPdfs(analyzed, prepared.maskingPlan);
    expect(pdfs).toHaveLength(2);
    for (const p of pdfs) expect(p.result).toHaveProperty('ok');
  });
});
