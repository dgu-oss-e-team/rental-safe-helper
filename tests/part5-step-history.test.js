import { describe, it, expect } from 'vitest';
import {
  STEP_ORDER,
  stepFromHash,
  hashFor,
  reachableStep,
  historyAction,
  shouldGoHome,
  resumeStep,
} from '../src/app/step-history.js';

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

  it('분석만 했으면 ② 결과까지, 그 뒤 단계는 ②로 (목적 화면 없음, #381)', () => {
    expect(reachableStep(analyzed, 'results')).toBe('results');
    expect(reachableStep(analyzed, 'review')).toBe('results');
    expect(reachableStep(analyzed, 'done')).toBe('results');
  });

  it('단계는 4개 + 사진일 때 글자 확인 (목적 단계 없음, #381)', () => {
    expect([...STEP_ORDER]).toEqual(['upload', 'confirm', 'results', 'review', 'done']);
  });

  it('예전 목적 화면 주소(#purpose)는 목적을 바꾸는 ② 결과로', () => {
    expect(stepFromHash('#purpose')).toBe('results');
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
    expect(historyAction('results', 'review')).toBe('push');
    expect(historyAction('review', 'results')).toBe('push');
    expect(historyAction('done', 'upload')).toBe('push');
  });

  it('"Confirm text"에서 떠날 때는 바꿔 쓴다 → 결과에서 뒤로 가면 ①', () => {
    expect(historyAction('confirm', 'results')).toBe('replace');
    expect(historyAction('confirm', 'upload')).toBe('replace');
  });
});

describe('PART 5 서비스 제목 = 홈 링크 (#118)', () => {
  it('②~⑤와 "Confirm text"에서 누르면 ①로 간다 (새 기록 → 뒤로 가기로 돌아옴)', () => {
    for (const step of STEP_ORDER.filter((s) => s !== 'upload')) {
      expect(shouldGoHome({ step, busy: null })).toBe(true);
    }
    expect(historyAction('review', 'upload')).toBe('push');
  });

  it('이미 ①이면 아무것도 하지 않는다 (같은 기록이 쌓이지 않게)', () => {
    expect(shouldGoHome({ step: 'upload', busy: null })).toBe(false);
  });

  it('서류를 읽는 중에는 가지 않는다', () => {
    expect(shouldGoHome({ step: 'results', busy: 'Reading your documents…' })).toBe(false);
  });

  it('①로 가도 결과는 남아 있어서 앞으로 가기로 돌아갈 수 있다', () => {
    expect(reachableStep(finished, 'done')).toBe('done');
  });
});

describe('PART 5 ① "Back to your results" (#124)', () => {
  it('이전 결과가 없으면(처음, Start over 뒤) 버튼을 보여 주지 않는다', () => {
    expect(resumeStep(none)).toBeNull();
    // 사진 글자 확인만 하고 분석 전이면 결과가 아니다
    expect(resumeStep({ ...none, ocrReview: {} })).toBeNull();
  });

  it('결과가 있는 가장 먼 단계로 간다: 분석만 했으면 ②, 확인 화면까지면 ④, PDF까지면 ⑤', () => {
    expect(resumeStep(analyzed)).toBe('results');
    expect(resumeStep(prepared)).toBe('review');
    expect(resumeStep(finished)).toBe('done');
  });

  it('간 단계는 뒤로·앞으로 가기 규칙으로도 갈 수 있는 단계다', () => {
    for (const state of [analyzed, prepared, finished]) {
      const step = /** @type {any} */ (resumeStep(state));
      expect(reachableStep(state, step)).toBe(step);
    }
  });
});
