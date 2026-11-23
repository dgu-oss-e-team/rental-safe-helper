// PART 5. 사진 자동 보정 계산 (#272). 작은 가짜 그림(숫자 배열)으로 확인한다.
import { describe, it, expect } from 'vitest';
import { otsuThreshold, paperBounds, flattenShading } from '../src/app/photo-enhance.js';

/**
 * w×h 회색 그림: 바탕은 bg, (x0,y0)~(x1,y1) 직사각형은 paper 밝기
 * @returns {Float32Array}
 */
function picture(w, h, bg, paper, x0, y0, x1, y1) {
  const g = new Float32Array(w * h).fill(bg);
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) g[y * w + x] = paper;
  return g;
}

describe('PART 5 사진 자동 보정: 문턱 (Otsu, #272)', () => {
  it('어두운 값과 밝은 값 사이에서 나눈다', () => {
    const t = otsuThreshold([20, 22, 25, 30, 200, 210, 220, 230]);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(200);
  });
});

describe('PART 5 사진 자동 보정: 종이 범위 찾기 (#272)', () => {
  it('어두운 책상 위의 밝은 종이만 찾는다', () => {
    const g = picture(100, 140, 60, 235, 20, 15, 85, 130);
    expect(paperBounds(g, 100, 140)).toEqual({ left: 20, top: 15, right: 85, bottom: 130 });
  });

  it('종이 위 글자(어두운 점)가 있어도 종이 범위는 그대로다', () => {
    const g = picture(100, 140, 60, 235, 20, 15, 85, 130);
    for (let y = 30; y < 120; y += 6) for (let x = 25; x < 80; x += 3) g[y * 100 + x] = 30; // 글자 줄
    expect(paperBounds(g, 100, 140)).toEqual({ left: 20, top: 15, right: 85, bottom: 130 });
  });

  it('사진 전체가 종이(이미 스캔한 사진)면 전체를 돌려준다', () => {
    const g = picture(80, 100, 230, 230, 0, 0, 80, 100);
    for (let i = 0; i < g.length; i += 7) g[i] = 40; // 글자
    expect(paperBounds(g, 80, 100)).toEqual({ left: 0, top: 0, right: 80, bottom: 100 });
  });

  it('종이가 너무 작으면(사진의 1/4 미만) 못 찾은 것으로 보고 null → 자르지 않는다', () => {
    const g = picture(100, 100, 60, 235, 40, 40, 60, 60);
    expect(paperBounds(g, 100, 100)).toBeNull();
  });
});

describe('PART 5 사진 자동 보정: 그림자 지우기 (#272)', () => {
  /** 회색 한 픽셀 rgba */
  const px = (v) => [v, v, v, 255];

  it('그림자 속 종이와 밝은 종이가 모두 흰색이 되고, 글자는 검정이 된다', () => {
    // [밝은 곳 종이, 그림자 속 종이, 밝은 곳 글자, 그림자 속 글자]
    const rgba = Uint8ClampedArray.from([...px(230), ...px(130), ...px(60), ...px(35)]);
    const background = Uint8ClampedArray.from([...px(230), ...px(130), ...px(230), ...px(130)]);
    flattenShading(rgba, background);
    const v = [rgba[0], rgba[4], rgba[8], rgba[12]];
    expect(v[0]).toBe(255);
    expect(v[1]).toBe(255);
    expect(v[2]).toBe(0);
    expect(v[3]).toBe(0);
  });

  it('뒷장 비침처럼 옅은 글씨는 흰색에 가까워지고, 결과는 회색조(r=g=b)다', () => {
    const rgba = Uint8ClampedArray.from([200, 190, 180, 255]); // 배경보다 조금 어두운 옅은 글씨 (색 있음)
    const background = Uint8ClampedArray.from([...px(215)]);
    flattenShading(rgba, background);
    expect(rgba[0]).toBeGreaterThan(200);
    expect(rgba[0]).toBe(rgba[1]);
    expect(rgba[1]).toBe(rgba[2]);
    expect(rgba[3]).toBe(255);
  });
});
