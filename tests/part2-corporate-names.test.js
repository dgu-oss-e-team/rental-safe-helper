// PART 2. 계약서 "성명(법인명)" 칸의 회사 이름 읽기 (findCorporateNames, #250 재수정)
// 회사·사람 이름은 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { findCorporateNames } from '../src/features/document-analysis/name-detector.js';

describe('PART 2 findCorporateNames()', () => {
  it('윗줄이 칸 이름이면 다음 줄 회사 이름에서 "(서명 또는 인)"을 자른다', () => {
    expect(findCorporateNames(['성명(법인명)', '주식회사가상리츠 (서명 또는 인)'])).toEqual(['주식회사가상리츠']);
  });

  it('한 줄에 "대표이사 김대표"가 붙어 있어도 회사 이름만 남긴다', () => {
    expect(findCorporateNames(['성명(법인명) 주식회사가상리츠 대표이사 김대표 (서명 또는 인)'])).toEqual(['주식회사가상리츠']);
    expect(findCorporateNames(['성명(법인명) 가상위탁관리부동산투자회사 대표자 김대표 (서 명 또는 인)'])).toEqual([
      '가상위탁관리부동산투자회사',
    ]);
  });

  it('OCR이 "(서 명"으로 읽어도 자른다', () => {
    expect(findCorporateNames(['성명(법인명) 주식회사가상리츠 (서 명 또는 인)'])).toEqual(['주식회사가상리츠']);
  });

  it('칸 이름 뒤 같은 줄에 회사 이름만 있어도 읽는다', () => {
    expect(findCorporateNames(['성명(법인명) 가상위탁관리부동산투자회사'])).toEqual(['가상위탁관리부동산투자회사']);
  });

  it('사람 이름은 회사로 읽지 않는다', () => {
    expect(findCorporateNames(['성명(법인명)', '김가상 (서명 또는 인)'])).toEqual([]);
  });

  it('회사 이름 안의 "대표"는 자르지 않는다 (앞에 공백이 있어도 뒤에 글자가 이어지면 이름의 일부)', () => {
    expect(findCorporateNames(['성명(법인명)', '주식회사 대표리츠 (서명 또는 인)'])).toEqual(['주식회사 대표리츠']);
  });

  it('칸이 둘이면 둘 다 모은다 (임대인인지는 PART 3가 사람 임대인 유무로 거른다)', () => {
    const lines = ['성명(법인명)', '주식회사가상리츠 (서명 또는 인)', '성명(법인명)', '주식회사사택법인 (서명 또는 인)'];
    expect(findCorporateNames(lines)).toEqual(['주식회사가상리츠', '주식회사사택법인']);
  });
});
