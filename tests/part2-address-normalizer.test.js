import { describe, it, expect } from 'vitest';
import { toFormalAddress } from '../src/features/document-analysis/address-normalizer.js';

// 모든 주소는 가짜다.

describe('PART 2 시·도 정식 이름 변환', () => {
  it('줄여 쓴 시·도 이름을 정식 이름으로 바꾼다', () => {
    expect(toFormalAddress('서울 중구 필동로 00, 101호')).toBe('서울특별시 중구 필동로 00, 101호');
    expect(toFormalAddress('서울시 중구 필동로 00')).toBe('서울특별시 중구 필동로 00');
    expect(toFormalAddress('부산 해운대구 해운대로 00')).toBe('부산광역시 해운대구 해운대로 00');
    expect(toFormalAddress('경기 수원시 팔달구 효원로 00')).toBe('경기도 수원시 팔달구 효원로 00');
    expect(toFormalAddress('충북 청주시 상당구 00')).toBe('충청북도 청주시 상당구 00');
    expect(toFormalAddress('경남 창원시 의창구 00')).toBe('경상남도 창원시 의창구 00');
    expect(toFormalAddress('세종 한누리대로 00')).toBe('세종특별자치시 한누리대로 00');
    expect(toFormalAddress('세종시 한누리대로 00')).toBe('세종특별자치시 한누리대로 00');
  });

  it('옛 이름도 지금 정식 이름으로 바꾼다', () => {
    expect(toFormalAddress('강원도 춘천시 00')).toBe('강원특별자치도 춘천시 00');
    expect(toFormalAddress('강원 춘천시 00')).toBe('강원특별자치도 춘천시 00');
    expect(toFormalAddress('전라북도 전주시 완산구 00')).toBe('전북특별자치도 전주시 완산구 00');
    expect(toFormalAddress('전북 전주시 완산구 00')).toBe('전북특별자치도 전주시 완산구 00');
    expect(toFormalAddress('제주도 제주시 00')).toBe('제주특별자치도 제주시 00');
    expect(toFormalAddress('제주 제주시 00')).toBe('제주특별자치도 제주시 00');
  });

  it('이미 정식 이름이면 그대로 둔다', () => {
    expect(toFormalAddress('서울특별시 중구 필동로 00, 101호')).toBe('서울특별시 중구 필동로 00, 101호');
    expect(toFormalAddress('경기도 수원시 팔달구 효원로 00')).toBe('경기도 수원시 팔달구 효원로 00');
    expect(toFormalAddress('전북특별자치도 전주시 00')).toBe('전북특별자치도 전주시 00');
  });

  it('"경기"와 "경기도"를 헷갈리지 않는다 (도가 두 번 붙지 않는다)', () => {
    expect(toFormalAddress('경기도 수원시')).toBe('경기도 수원시');
  });

  it('시·도 이름과 시·군·구 사이의 공백이 여러 개여도 한 칸으로 정리한다', () => {
    expect(toFormalAddress('서울  중구 필동로 00')).toBe('서울특별시 중구 필동로 00');
  });
});

describe('PART 2 광주 구분', () => {
  it('광주 + 구는 광주광역시', () => {
    expect(toFormalAddress('광주 북구 용봉로 00')).toBe('광주광역시 북구 용봉로 00');
    expect(toFormalAddress('광주 광산구 00')).toBe('광주광역시 광산구 00');
    expect(toFormalAddress('광주광역시 서구 00')).toBe('광주광역시 서구 00');
  });

  it('광주시 + 구는 광주광역시 (경기도 광주시에는 구가 없다, 이슈 #72)', () => {
    expect(toFormalAddress('광주시 북구 용봉로 00')).toBe('광주광역시 북구 용봉로 00');
    expect(toFormalAddress('광주시 광산구 00')).toBe('광주광역시 광산구 00');
  });

  it('광주시는 경기도 광주시', () => {
    expect(toFormalAddress('광주시 00')).toBe('경기도 광주시 00');
    expect(toFormalAddress('광주시 오포읍 00')).toBe('경기도 광주시 오포읍 00');
    expect(toFormalAddress('경기 광주시 00')).toBe('경기도 광주시 00');
  });

  it('광주 + 읍·면은 경기도 광주시', () => {
    expect(toFormalAddress('광주 오포읍 00')).toBe('경기도 광주시 오포읍 00');
    expect(toFormalAddress('광주 곤지암읍 00')).toBe('경기도 광주시 곤지암읍 00');
  });

  it('광주인데 구·읍·면을 알 수 없으면 바꾸지 않고 원문 그대로 둔다 (추측 금지)', () => {
    expect(toFormalAddress('광주 필동로 00')).toBe('광주 필동로 00');
    expect(toFormalAddress('광주')).toBe('광주');
  });
});

describe('PART 2 붙여 쓴 주소 (이슈 #72)', () => {
  it('시·도 이름과 시·군·구를 띄어서 정식 이름으로 바꾼다', () => {
    expect(toFormalAddress('서울특별시중구 필동로 00, 101호')).toBe('서울특별시 중구 필동로 00, 101호');
    expect(toFormalAddress('서울시중구 필동로 00')).toBe('서울특별시 중구 필동로 00');
    expect(toFormalAddress('경기도수원시 팔달구 효원로 00')).toBe('경기도 수원시 팔달구 효원로 00');
    expect(toFormalAddress('강원도춘천시 00')).toBe('강원특별자치도 춘천시 00');
    expect(toFormalAddress('경기도광주시 오포읍 00')).toBe('경기도 광주시 오포읍 00');
    expect(toFormalAddress('서울특별시중구')).toBe('서울특별시 중구');
  });

  it('줄여 쓴 이름을 붙여 쓴 경우나 시·군·구가 아닌 단어는 바꾸지 않는다', () => {
    expect(toFormalAddress('서울중구 필동로 00')).toBe('서울중구 필동로 00');
    expect(toFormalAddress('서울시청 앞')).toBe('서울시청 앞');
  });
});

describe('PART 2 정식 이름으로 바꿀 수 없는 주소', () => {
  it('시·도 이름이 없으면 원문 그대로', () => {
    expect(toFormalAddress('필동로 00, 101호')).toBe('필동로 00, 101호');
    expect(toFormalAddress('중구 필동로 00')).toBe('중구 필동로 00');
  });

  it('시·도 이름처럼 시작하지만 다른 단어면 바꾸지 않는다', () => {
    expect(toFormalAddress('서울대로 00')).toBe('서울대로 00');
    expect(toFormalAddress('경기장로 00')).toBe('경기장로 00');
  });

  it('빈 값이나 문자열이 아니면 그대로 돌려준다', () => {
    expect(toFormalAddress('')).toBe('');
    // @ts-expect-error 잘못된 입력도 죽지 않는다
    expect(toFormalAddress(null)).toBeNull();
  });

  it('앞뒤 공백은 정리한다', () => {
    expect(toFormalAddress('  서울 중구 00  ')).toBe('서울특별시 중구 00');
  });
});
