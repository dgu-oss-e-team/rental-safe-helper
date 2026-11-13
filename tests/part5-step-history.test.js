import { describe, it, expect } from 'vitest';
import { STEP_ORDER, stepFromHash, hashFor, reachableStep, historyAction } from '../src/app/step-history.js';

const none = { ocrReview: null, analysis: null, prepared: null, pdfs: null };
const analyzed = { ...none, analysis: {} };
const prepared = { ...analyzed, prepared: {} };
const finished = { ...prepared, pdfs: [] };

describe('PART 5 브라우저 기록: 주소 ↔ 단계 (#90)', () => {
  it('주소 끝에서 단계 이름을 읽는다', () => {
    for (const step of STEP_ORDER) expect(stepFromHash(hashFor(step))).toBe(step);
  });

  it('빈 주소·모르는 값은 ① upload', () => {
    expect(stepFromHash('')).toBe('upload');
    expect(stepFromHash('#')).toBe('upload');
    expect(stepFromHash('#something-else')).toBe('upload');
    expect(stepFromHash(undefined)).toBe('upload');
  });

  it('주소에는 단계 이름만 들어간다', () => {
    for (const step of STEP_ORDER) expect(hashFor(step)).toMatch(/^#[a-z]+$/);
  });
});

describe('PART 5 브라우저 기록: 결과가 없는 단계로는 못 간다', () => {
  it('분석 전에는 ②~⑤로 못 가고 ①로', () => {
    for (const step of STEP_ORDER) expect(reachableStep(none, step)).toBe('upload');
  });

  it('분석만 했으면 ②·③까지, ④·⑤는 ③으로', () => {
    expect(reachableStep(analyzed, 'results')).toBe('results');
    expect(reachableStep(analyzed, 'purpose')).toBe('purpose');
    expect(reachableStep(analyzed, 'review')).toBe('purpose');
    expect(reachableStep(analyzed, 'done')).toBe('purpose');
  });

  it('보내기 전 확인까지 했으면 ④까지, ⑤는 ④로', () => {
    expect(reachableStep(prepared, 'review')).toBe('review');
    expect(reachableStep(prepared, 'done')).toBe('review');
  });

  it('PDF까지 만들었으면 모든 단계로 갈 수 있다 (확인 단계는 사진·스캔이 있을 때만)', () => {
    expect(reachableStep(finished, 'done')).toBe('done');
    expect(reachableStep(finished, 'results')).toBe('results');
    expect(reachableStep(finished, 'upload')).toBe('upload');
    expect(reachableStep(finished, 'confirm')).toBe('upload');
  });

  it('"Confirm text"는 확인할 서류가 있을 때만', () => {
    expect(reachableStep({ ...none, ocrReview: {} }, 'confirm')).toBe('confirm');
    expect(reachableStep({ ...none, ocrReview: {} }, 'results')).toBe('confirm');
  });
});

describe('PART 5 브라우저 기록: 기록을 남기는 방법', () => {
  it('같은 단계면 그대로', () => {
    expect(historyAction('results', 'results')).toBe('none');
  });

  it('단계가 바뀌면 새 기록 (앞으로든 뒤로든)', () => {
    expect(historyAction('upload', 'results')).toBe('push');
    expect(historyAction('results', 'purpose')).toBe('push');
    expect(historyAction('review', 'purpose')).toBe('push');
    expect(historyAction('done', 'upload')).toBe('push');
  });

  it('"Confirm text"에서 떠날 때는 바꿔 쓴다 → 결과에서 뒤로 가면 ①', () => {
    expect(historyAction('confirm', 'results')).toBe('replace');
    expect(historyAction('confirm', 'upload')).toBe('replace');
  });
});
