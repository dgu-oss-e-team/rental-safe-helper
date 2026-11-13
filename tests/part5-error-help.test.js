// PART 5. 오류 안내 (error-help.js): 개발자용 메시지 대신 쉬운 안내를 보여 준다.
import { describe, it, expect } from 'vitest';
import { errorHelp } from '../src/app/error-help.js';
import { ERROR_CODE } from '../src/shared/document-model.js';

describe('PART 5 errorHelp(): 오류 코드 → 사용자 안내', () => {
  it('모든 오류 코드에 제목과 할 일이 있다', () => {
    for (const code of Object.values(ERROR_CODE)) {
      const h = errorHelp({ step: 'readDocument', code });
      expect(h.title.length).toBeGreaterThan(5);
      expect(h.help.length).toBeGreaterThan(5);
    }
  });

  it('글자를 잘 못 읽으면(LOW_CONFIDENCE) 원본 PDF나 더 선명한 사진을 올리라고 안내한다', () => {
    const h = errorHelp({ step: 'readDocument', code: ERROR_CODE.LOW_CONFIDENCE });
    expect(h.title).toBe('Some text could not be read clearly.');
    expect(h.help).toContain('original PDF');
  });

  it('INVALID_INPUT은 단계에 따라 다른 안내를 보여 준다', () => {
    expect(errorHelp({ step: 'input', code: ERROR_CODE.INVALID_INPUT }).title).toBe('No file was chosen.');
    expect(errorHelp({ step: 'applyPersonAnswers', code: ERROR_CODE.INVALID_INPUT }).help).toContain('previous answers are kept');
    expect(errorHelp({ step: 'validateMaskedText', code: ERROR_CODE.INVALID_INPUT }).title).toContain('might still be visible');
  });

  it('인터넷 문제(LOAD_FAILED)는 연결을 확인하라고 안내한다', () => {
    expect(errorHelp({ step: 'sample', code: 'LOAD_FAILED' }).help).toContain('internet connection');
  });

  it('모르는 오류나 빈 값이어도 안내가 나온다', () => {
    expect(errorHelp({ code: 'SOMETHING_NEW' }).title).toBe('Something went wrong.');
    expect(errorHelp(null).title).toBe('Something went wrong.');
  });

  it('안내 문구에 "safe"(안전하다)라는 표현을 쓰지 않는다 — 결과를 안전하다고 오해하지 않게', () => {
    for (const code of [...Object.values(ERROR_CODE), 'LOAD_FAILED']) {
      for (const step of ['input', 'applyPersonAnswers', 'validateMaskedText', 'readDocument']) {
        const { title, help } = errorHelp({ step, code });
        expect(`${title} ${help}`).not.toMatch(/\bsafe\b/i);
      }
    }
  });
});
