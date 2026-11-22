// @ts-check
/**
 * PART 5. 사진 자동 보정 (#272): 종이만 잘라내기 + 그림자 지우기·대비 올리기
 *
 * 휴대폰 사진에는 책상·노트북 같은 배경, 손·휴대폰 그림자, 뒷장 비침이 같이 찍혀서 OCR이 자주 틀린다.
 * 사용자가 문서 스캔 앱을 쓰지 않아도, 그 앱이 하는 일 중 쉬운 두 가지를 앱이 자동으로 한다.
 * OpenCV 없이 canvas만 쓴다 (11/17 B안 결정). 기울어진 종이를 펴는 원근 보정은 하지 않는다.
 *
 * 실험 (인쇄한 가짜 서류 9장을 휴대폰으로 찍음, 흐린 줄은 고치지 않은 같은 조건)
 *   흐린 줄 151/388 → 82/323, 잘못된 STOP 1 → 0, AI 글에 남은 개인정보 8곳 → 4곳
 *
 * 계산은 순수 함수(otsuThreshold, paperBounds, flattenShading)로 나눠 Node에서 테스트한다.
 * 모두 브라우저 안에서만 한다. 사진은 어디에도 보내지 않는다.
 */

/** 종이 범위를 찾을 때 사진을 줄이는 크기 (긴 변, 픽셀) */
const ANALYSIS_PIXELS = 400;
/** 한 행·열에서 밝은 칸이 이 비율을 넘으면 종이로 본다 */
const PAPER_RATIO = 0.5;
/*
 * 알려진 한계 (#287, #273 리뷰): 종이 맨 위·아래에 가로로 긴 진한 띠(검은 제목 칸 등)가 있으면 그 줄은 잘린다.
 * 잘린 부분은 OCR·마스킹 PDF에 들어가지 않아 개인정보가 새지는 않고, 그 부분을 못 읽을 뿐이다.
 * "띠 안에 흰 글자가 조금이라도 있으면 종이로 넣기"를 시험했지만, 실제 휴대폰 사진(종이가 기울어짐)에서
 * 종이 바깥 줄까지 넓어져 흐린 줄이 72 → 110개로 늘어서 넣지 않았다. 등기부·계약서는 위아래가 흰 여백이다.
 */
/** 찾은 종이가 사진의 이 비율보다 작으면 못 찾은 것으로 보고 자르지 않는다 */
const MIN_PAPER_AREA = 0.25;
/** 배경 밝기를 구할 때 줄이는 배율 (글자보다 훨씬 큰 범위의 평균 밝기) */
const SHADING_SCALE = 24;
/** 그림자 지우기: (글자 밝기 / 주변 밝기)가 LOW 이하면 검정, HIGH 이상이면 흰색 */
const SHADING_LOW = 0.5;
const SHADING_HIGH = 0.92;

/**
 * 회색 값(0~255)들을 둘로 가장 잘 나누는 문턱 (Otsu)
 * @param {ArrayLike<number>} gray
 * @returns {number}
 */
export function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) hist[Math.max(0, Math.min(255, gray[i] | 0))] += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let weightB = 0;
  let best = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    weightB += hist[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * hist[t];
    const between = weightB * weightF * (sumB / weightB - (sum - sumB) / weightF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * 밝은 종이가 있는 범위 (작게 줄인 회색 사진 기준)
 * 밝은 칸이 절반 넘는 행의 위·아래 끝, 그 안에서 밝은 칸이 절반 넘는 열의 왼쪽·오른쪽 끝을 찾는다.
 * 종이를 못 찾으면(범위가 사진의 1/4보다 작음) null → 자르지 않는다.
 * @param {ArrayLike<number>} gray  w*h 회색 값
 * @param {number} w
 * @param {number} h
 * @returns {{ left: number, top: number, right: number, bottom: number } | null}  right·bottom은 포함하지 않는 끝
 */
export function paperBounds(gray, w, h) {
  const th = otsuThreshold(gray);
  const bright = (/** @type {number} */ x, /** @type {number} */ y) => gray[y * w + x] > th;
  const rowIsPaper = (/** @type {number} */ y) => {
    let n = 0;
    for (let x = 0; x < w; x += 1) if (bright(x, y)) n += 1;
    return n > w * PAPER_RATIO;
  };
  let top = 0;
  while (top < h && !rowIsPaper(top)) top += 1;
  let bottom = h - 1;
  while (bottom > top && !rowIsPaper(bottom)) bottom -= 1;
  if (top >= h) return null;
  const colIsPaper = (/** @type {number} */ x) => {
    let n = 0;
    for (let y = top; y <= bottom; y += 1) if (bright(x, y)) n += 1;
    return n > (bottom - top + 1) * PAPER_RATIO;
  };
  let left = 0;
  while (left < w && !colIsPaper(left)) left += 1;
  let right = w - 1;
  while (right > left && !colIsPaper(right)) right -= 1;
  if (left >= w) return null;
  const box = { left, top, right: right + 1, bottom: bottom + 1 };
  if ((box.right - box.left) * (box.bottom - box.top) < w * h * MIN_PAPER_AREA) return null;
  return box;
}

/**
 * 그림자 지우기 + 대비 올리기: 픽셀 밝기를 주변(흐린) 밝기로 나눠 회색조로 바꾼다. rgba를 바꾼다.
 * 그림자 속 종이도, 밝은 곳의 종이도 흰색이 되고, 글자는 진한 검정이 된다. 뒷장 비침처럼 옅은 글씨는 흰색에 가까워진다.
 * @param {Uint8ClampedArray} rgba  사진 픽셀 (바뀜)
 * @param {Uint8ClampedArray} background  같은 크기의 흐린 배경 픽셀
 */
export function flattenShading(rgba, background) {
  for (let i = 0; i < rgba.length; i += 4) {
    const g = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
    const b = Math.max(1, background[i] * 0.299 + background[i + 1] * 0.587 + background[i + 2] * 0.114);
    const v = Math.max(0, Math.min(255, ((g / b - SHADING_LOW) / (SHADING_HIGH - SHADING_LOW)) * 255));
    rgba[i] = v;
    rgba[i + 1] = v;
    rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
}

/**
 * @param {number} w
 * @param {number} h
 */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true })) };
}

/**
 * 사진의 종이 범위 (원본 픽셀). 못 찾으면 사진 전체 (브라우저 전용)
 * @param {ImageBitmap} bitmap
 */
function findPaper(bitmap) {
  const scale = ANALYSIS_PIXELS / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const { c, ctx } = makeCanvas(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  c.width = 0;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) gray[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  const box = paperBounds(gray, w, h);
  if (!box) return { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  // 가장자리 글자가 잘리지 않게 작은 사진 기준 2칸 여유
  const m = 2;
  const x0 = Math.max(0, box.left - m) / scale;
  const y0 = Math.max(0, box.top - m) / scale;
  const x1 = Math.min(w, box.right + m) / scale;
  const y1 = Math.min(h, box.bottom + m) / scale;
  return {
    x: Math.round(x0),
    y: Math.round(y0),
    width: Math.min(bitmap.width, Math.round(x1 - x0)),
    height: Math.min(bitmap.height, Math.round(y1 - y0)),
  };
}

/**
 * 사진을 보정한 캔버스: 종이만 잘라내고, 긴 변을 maxPixels 이하로 줄이고, 그림자를 지운 회색조 (브라우저 전용)
 * @param {ImageBitmap} bitmap  회전 정보(EXIF)를 반영해 만든 사진
 * @param {number} maxPixels
 * @returns {HTMLCanvasElement}
 */
export function enhancePhoto(bitmap, maxPixels) {
  const crop = findPaper(bitmap);
  const ratio = Math.min(1, maxPixels / Math.max(crop.width, crop.height));
  const width = Math.max(1, Math.round(crop.width * ratio));
  const height = Math.max(1, Math.round(crop.height * ratio));
  const { c: canvas, ctx } = makeCanvas(width, height);
  ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);

  // 주변 밝기: 크게 줄였다가 흐리게 다시 키운 그림 (그림자·조명 차이만 남고 글자는 사라짐)
  const small = makeCanvas(Math.max(1, Math.round(width / SHADING_SCALE)), Math.max(1, Math.round(height / SHADING_SCALE)));
  small.ctx.imageSmoothingQuality = 'high';
  small.ctx.drawImage(canvas, 0, 0, small.c.width, small.c.height);
  const bg = makeCanvas(width, height);
  bg.ctx.imageSmoothingQuality = 'high';
  bg.ctx.filter = 'blur(6px)';
  bg.ctx.drawImage(small.c, 0, 0, width, height);
  const background = bg.ctx.getImageData(0, 0, width, height).data;
  small.c.width = 0;
  bg.c.width = 0;

  flattenShading(image.data, background);
  ctx.putImageData(image, 0, 0);
  return canvas;
}
