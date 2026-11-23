// PART 5. 보내기 전 검사가 멈춘 사진 서류: 안내와 "Check the text"로 돌아가기 (#286). 가상 데이터만 쓴다.
import { describe, it, expect } from 'vitest';
import { hasPhotoDocuments, textReviewFromAnalysis, isPhotoDocument } from '../src/app/text-review.js';
import { errorHelp, PHOTO_STOP_HELP } from '../src/app/error-help.js';
import { ERROR_CODE, SOURCE_TYPE } from '../src/shared/document-model.js';

const doc = (id, sourceType, text = '가상 글자') => ({
  documentId: id,
  sourceType,
  pages: [{ pageIndex: 0, width: 1000, height: 1400, blocks: [{ blockId: 'b0', text, bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.02 }, confidence: 0.9 }] }],
});
const file = (name) => new File(['x'], name);

describe('PART 5 사진 서류 찾기 (#286)', () => {
  it('사진·스캔(image, image_pdf)만 글자 확인 대상이다', () => {
    expect(isPhotoDocument({ sourceType: SOURCE_TYPE.IMAGE })).toBe(true);
    expect(isPhotoDocument({ sourceType: SOURCE_TYPE.IMAGE_PDF })).toBe(true);
    expect(isPhotoDocument({ sourceType: SOURCE_TYPE.TEXT_PDF })).toBe(false);
    expect(hasPhotoDocuments({ documents: [doc('A', SOURCE_TYPE.TEXT_PDF), doc('B', SOURCE_TYPE.IMAGE_PDF)] })).toBe(true);
    expect(hasPhotoDocuments({ documents: [doc('A', SOURCE_TYPE.TEXT_PDF)] })).toBe(false);
    expect(hasPhotoDocuments(null)).toBe(false);
  });
});

describe('PART 5 분석 뒤 "Check the text"로 돌아가기 (#286)', () => {
  it('사진 서류만 다시 확인하게 하고, 전체 서류·파일·칸은 그대로 넘긴다', () => {
    const analysis = {
      files: [file('registry.pdf'), file('lease-photos.pdf')],
      documents: [doc('REG', SOURCE_TYPE.TEXT_PDF), doc('LEASE', SOURCE_TYPE.IMAGE_PDF, '서물특별시 중구 가상로 30')],
    };
    const back = textReviewFromAnalysis(analysis, ['registry', 'lease']);
    expect(back?.ocrReview.read.documents.map((d) => d.documentId)).toEqual(['REG', 'LEASE']);
    expect(back?.ocrReview.files.map((f) => f.name)).toEqual(['lease-photos.pdf']);
    expect(back?.ocrReview.slots).toEqual(['registry', 'lease']);
    // 이미 고친 글자로 다시 연다
    expect(back?.draft.map((d) => d.documentId)).toEqual(['LEASE']);
    expect(back?.draft[0].pages[0].blocks[0].text).toBe('서물특별시 중구 가상로 30');
  });

  it('고치는 동안 분석 결과의 서류는 바뀌지 않는다 (복사본을 고침)', () => {
    const analysis = { files: [file('a.pdf')], documents: [doc('A', SOURCE_TYPE.IMAGE_PDF, '서물특별시')] };
    const back = textReviewFromAnalysis(analysis, null);
    back.draft[0].pages[0].blocks[0].text = '서울특별시';
    expect(analysis.documents[0].pages[0].blocks[0].text).toBe('서물특별시');
  });

  it('사진 서류가 없으면 null (돌아갈 곳이 없음)', () => {
    expect(textReviewFromAnalysis({ files: [file('a.pdf')], documents: [doc('A', SOURCE_TYPE.TEXT_PDF)] }, null)).toBeNull();
  });
});

describe('PART 5 보내기 전 검사 멈춤 안내 (#286)', () => {
  const stopped = { step: 'validateMaskedText', code: ERROR_CODE.INVALID_INPUT };

  it('사진 서류가 있으면 잘못 읽힌 글자를 고치라고 안내한다', () => {
    expect(errorHelp(stopped, { photo: true })).toBe(PHOTO_STOP_HELP);
    expect(PHOTO_STOP_HELP.help).toContain('Nothing was shared');
    expect(PHOTO_STOP_HELP.help).toContain('Check the text we read');
  });

  it('글자 PDF만 있으면 지금 안내 그대로, 다른 단계 오류는 사진이어도 그대로', () => {
    expect(errorHelp(stopped, { photo: false }).title).toContain('might still be visible');
    expect(errorHelp(stopped).title).toContain('might still be visible');
    expect(errorHelp({ step: 'assessRisks', code: ERROR_CODE.INVALID_INPUT }, { photo: true })).not.toBe(PHOTO_STOP_HELP);
  });

  it('안내에 개발자용 말이나 "safe"가 없다', () => {
    const text = `${PHOTO_STOP_HELP.title} ${PHOTO_STOP_HELP.help}`;
    for (const word of ['INVALID', 'validate', 'safe', 'no risk']) expect(text).not.toContain(word);
  });
});
