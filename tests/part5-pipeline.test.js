import { describe, it, expect } from 'vitest';
import { runPipeline } from '../src/app/pipeline.js';
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

  // TODO(PART 5): 실제 PDF 생성 후 텍스트·메타데이터가 남지 않는지 검증하는 테스트
});
