// @ts-check
/**
 * PART 5. 마스킹을 페이지 이미지에 직접 그린다.
 *
 * 1) planRedactions(): 마스킹 계획(0~1 좌표)을 "이 페이지에 무엇을 어디에 그릴지" 목록으로 바꾼다. (계산만 함)
 * 2) drawRedactions(): 그 목록을 캔버스에 그린다. (브라우저 전용)
 *
 * 그리는 순서: REDACT(검은 상자) → REPLACE(흰 상자 + 가명 글자).
 *   PART 2가 블록 전체 좌표를 쓰기 때문에, 한 블록에 이름과 주민번호가 함께 있으면 두 상자가 겹친다.
 *   검은 상자를 먼저 그리고 가명을 위에 그려야 가명이 보이고, 주민번호는 그대로 가려진다.
 *   한 블록에 이름이 둘이면(서명란 "임대인 … 임차인 …") 가명을 이어서 한 상자에 그린다.
 */

import { MASKING_ACTION, isValidBBox } from '../../shared/document-model.js';

/** @typedef {import('../../shared/document-model.js').MaskingPlan} MaskingPlan */
/** @typedef {import('../../shared/document-model.js').BBox} BBox */

/**
 * @typedef {Object} DrawItem
 * @property {'box' | 'label'} kind  box = 검은 상자, label = 흰 상자 + 글자
 * @property {{ x: number, y: number, width: number, height: number }} rect  픽셀 좌표
 * @property {string} [text]  label일 때 그릴 글자 (가명 등)
 * @property {{ left: number, right: number }} [room]  label일 때 흰 상자를 넓혀도 되는 왼쪽·오른쪽 끝 (픽셀, #261)
 *   같은 높이에 있는 옆 글자·다른 가림 상자 앞까지다. 가명이 상자에 안 들어갈 때만 이 안에서 넓힌다.
 */

/*
 * 상자 여유 (#139): 상자를 글자보다 넓게 그려서 글자 가장자리가 새지 않게 한다.
 * OCR 좌표는 몇 픽셀씩 어긋날 수 있고, 휴대폰 사진은 페이지가 작아서 페이지 비율만으로는 여유가 2~3px밖에 안 된다.
 * 그래서 줄 높이에 비례해서 잡는다. 덜 가리는 것보다 조금 더 가리는 쪽이 안전하다.
 * - 위아래: 줄 높이의 20% (샘플에서 줄 사이 간격은 가장 좁을 때 줄 높이의 50%라서 옆 줄 글자에 닿지 않는다)
 * - 좌우: 줄 높이의 25% (글자 1/4 정도). 50%로 하면 표(등기부 갑구)에서 상자가 칸 선을 더 많이 넘어,
 *   ⑤ Double-check의 OCR이 선 조각을 흐린 숫자로 읽고 "확인 불가"로 멈췄다. (가려진 글자가 보인 것은 아님, #139에서 확인)
 * - 가장 작아도 페이지의 0.2% (이전 값), 가장 커도 페이지 긴 변의 1% (여러 줄 묶음처럼 큰 상자가 과하게 커지지 않게)
 * - 옆에 가리지 않는 글자가 있으면 그 글자까지 간격의 절반까지만 넓힌다. 실제 등기부·계약서처럼 줄 간격이 좁거나
 *   표 칸이 붙어 있어도 옆 줄·옆 칸 글자를 덮지 않는다. (공개 양식을 따른 빽빽한 가짜 서류 tests/fixtures/dense-*.pdf로 확인)
 * - 단, 옆 글자 때문에 줄이더라도 가장 작은 여유(페이지의 0.2%, 이 기능 전과 같은 값)는 항상 지킨다.
 *   OCR 좌표가 몇 px 어긋나면 개인정보 글자 끝이 보일 수 있어서, 옆 줄 끝을 1~2px 덮는 쪽이 새는 쪽보다 안전하다.
 * - 같은 줄의 옆 칸 글자 조각(span, #252)은 글자 상자가 가릴 글자와 1~2px 겹칠 때가 있다 (#256).
 *   겹친 글자도 대부분이 바깥쪽에 있으면 옆 칸으로 보고, 그 글자 끝에서 가장 작은 여유까지만 넘어간다.
 *   가릴 글자는 언제나 다 덮는다 (상자가 가릴 글자 안쪽으로 줄어들지는 않는다).
 */
export const PAD_Y_RATIO = 0.2;
export const PAD_X_RATIO = 0.25;
export const PAD_MIN = 0.002;
const PAD_MAX = 0.01;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** 같은 자리에 가명이 여러 개일 때 이어 붙이는 구분자 */
export const LABEL_SEPARATOR = ' / ';

/** 가명 글자가 이보다 작아지면 읽을 수 없으므로 가명 대신 검은 상자로 그린다 (px) */
const MIN_LABEL_FONT = 6;

/**
 * 상자 안에 가명이 눌리지 않고 들어가는 글자 크기를 구한다.
 * - 높이 기준(상자 높이의 70%)과 너비 기준(글자 길이가 상자에 맞게) 중 작은 값
 * - 너무 작아지면 0을 돌려준다 → 가명 대신 검은 상자로 그림
 * @param {number} widthPer1px  글자 크기 1px일 때의 글자 길이 (measureText 결과 ÷ 잰 크기)
 * @param {{ width: number, height: number }} rect  픽셀
 */
export function fitFontSize(widthPer1px, rect) {
  const sidePadding = rect.height * 0.15;
  const byHeight = rect.height * 0.7;
  const byWidth = widthPer1px > 0 ? (rect.width - sidePadding * 2) / widthPer1px : byHeight;
  const size = Math.floor(Math.min(byHeight, byWidth));
  return size >= MIN_LABEL_FONT ? size : 0;
}

/**
 * 0~1 정규화 좌표를 픽셀 좌표로 바꾼다. 줄 높이에 맞춘 여유를 더하고 페이지 밖으로 나가지 않게 자른다.
 * neighbors(가리지 않는 글자 위치)가 가까이 있으면 그쪽 여유는 간격의 절반까지만 준다.
 * @param {BBox} bbox
 * @param {number} pageWidth  픽셀
 * @param {number} pageHeight  픽셀
 * @param {BBox[]} [neighbors]  같은 페이지에서 가리지 않는 글자 위치 (0~1)
 */
export function toPixelRect(bbox, pageWidth, pageHeight, neighbors = []) {
  const lineHeight = bbox.height * pageHeight;
  const maxPad = PAD_MAX * Math.max(pageWidth, pageHeight);
  const padX = clamp(lineHeight * PAD_X_RATIO, PAD_MIN * pageWidth, maxPad);
  const padY = clamp(lineHeight * PAD_Y_RATIO, PAD_MIN * pageHeight, maxPad);
  const left = bbox.x * pageWidth;
  const top = bbox.y * pageHeight;
  const right = (bbox.x + bbox.width) * pageWidth;
  const bottom = (bbox.y + bbox.height) * pageHeight;
  const pad = { top: padY, bottom: padY, left: padX, right: padX };
  const minX = PAD_MIN * pageWidth;
  const minY = PAD_MIN * pageHeight;
  // 살짝 겹친 옆 글자가 있을 때 상자가 넘어가도 되는 끝 (가릴 글자 끝보다 안쪽으로는 오지 않는다)
  const cap = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };

  for (const n of neighbors) {
    const nl = n.x * pageWidth;
    const nt = n.y * pageHeight;
    const nr = (n.x + n.width) * pageWidth;
    const nb = (n.y + n.height) * pageHeight;
    if (nr > left && nl < right && nb > top && nt < bottom) {
      // 가릴 글자와 겹치는 글자: 가운데가 가릴 글자 바깥이면 살짝 겹친 옆 글자 (#256), 아니면 피할 수 없다
      const cx = (nl + nr) / 2;
      const cy = (nt + nb) / 2;
      if (cx < left) cap.left = Math.max(cap.left, Math.min(left, nr - minX));
      else if (cx > right) cap.right = Math.min(cap.right, Math.max(right, nl + minX));
      else if (cy < top) cap.top = Math.max(cap.top, Math.min(top, nb - minY));
      else if (cy > bottom) cap.bottom = Math.min(cap.bottom, Math.max(bottom, nt + minY));
      continue;
    }
    const sideBySide = nb > top - padY && nt < bottom + padY; // 같은 높이 (옆 칸)
    const stacked = nr > left - padX && nl < right + padX; // 같은 열 (위·아래 줄)
    if (stacked && nb <= top) pad.top = Math.min(pad.top, (top - nb) / 2);
    if (stacked && nt >= bottom) pad.bottom = Math.min(pad.bottom, (nt - bottom) / 2);
    if (sideBySide && nr <= left) pad.left = Math.min(pad.left, (left - nr) / 2);
    if (sideBySide && nl >= right) pad.right = Math.min(pad.right, (nl - right) / 2);
  }
  // 옆 글자 때문에 줄였어도 가장 작은 여유는 지킨다 (덜 가려서 새는 것보다 옆 줄 끝을 조금 덮는 쪽이 안전)
  pad.top = Math.max(pad.top, minY);
  pad.bottom = Math.max(pad.bottom, minY);
  pad.left = Math.max(pad.left, minX);
  pad.right = Math.max(pad.right, minX);

  const x = Math.max(0, Math.floor(Math.max(left - pad.left, cap.left)));
  const y = Math.max(0, Math.floor(Math.max(top - pad.top, cap.top)));
  const x1 = Math.min(pageWidth, Math.ceil(Math.min(right + pad.right, cap.right)));
  const y1 = Math.min(pageHeight, Math.ceil(Math.min(bottom + pad.bottom, cap.bottom)));
  return { x, y, width: x1 - x, height: y1 - y };
}

/**
 * 한 페이지에서 글자가 있는 자리 목록 (planRedactions의 textBoxes)
 * 글자 PDF 블록은 글자 조각(spans, #252) 단위로 넘겨서, 같은 줄의 옆 칸 글자도 피할 수 있게 한다 (#256).
 * spans가 없는 블록(OCR 등)은 블록 전체 위치를 쓴다.
 * @param {{ blocks?: { bbox: BBox, spans?: { bbox: BBox }[] }[] } | undefined} page
 * @returns {BBox[]}
 */
export function textBoxesOf(page) {
  return (page?.blocks ?? []).flatMap((b) =>
    Array.isArray(b.spans) && b.spans.length > 0 ? b.spans.map((sp) => sp.bbox) : [b.bbox],
  );
}

/**
 * 두 상자가 겹치는 넓이 ÷ b의 넓이 (0~1)
 * @param {BBox} a
 * @param {BBox} b
 */
function coverOf(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const area = b.width * b.height;
  return w > 0 && h > 0 && area > 0 ? (w * h) / area : 0;
}

/**
 * 가명 상자 옆의 빈 공간: 같은 높이의 옆 글자·다른 상자 앞까지 (#261)
 * 가장 작은 여유(PAD_MIN)만큼 떨어뜨린다. 페이지 밖으로는 나가지 않는다.
 * @param {DrawItem['rect']} rect  픽셀
 * @param {DrawItem['rect'][]} obstacles  픽셀 (옆 글자, 다른 상자)
 * @param {number} pageWidth  픽셀
 * @returns {{ left: number, right: number }}
 */
export function labelRoom(rect, obstacles, pageWidth) {
  const gap = PAD_MIN * pageWidth;
  const right0 = rect.x + rect.width;
  let left = 0;
  let right = pageWidth;
  for (const o of obstacles) {
    const sameRow = o.y < rect.y + rect.height && o.y + o.height > rect.y;
    if (!sameRow || o === rect) continue;
    if (o.x >= right0) right = Math.min(right, o.x - gap);
    else if (o.x + o.width <= rect.x) left = Math.max(left, o.x + o.width + gap);
  }
  return { left: Math.min(rect.x, Math.ceil(left)), right: Math.max(right0, Math.floor(right)) };
}

/**
 * 한 페이지에 그릴 목록을 만든다.
 * @param {MaskingPlan} plan
 * @param {{ documentId: string, pageIndex: number, width: number, height: number, textBoxes?: BBox[] }} page
 *   width/height는 픽셀. textBoxes는 이 페이지의 글자 위치(0~1, textBoxesOf())로, 가리지 않는 줄·칸을 덮지 않게 쓴다 (#139, #256)
 * @returns {DrawItem[]}
 */
export function planRedactions(plan, page) {
  const items = plan.items.filter(
    (i) =>
      i.documentId === page.documentId &&
      i.pageIndex === page.pageIndex &&
      i.action !== MASKING_ACTION.KEEP &&
      isValidBBox(i.bbox),
  );
  // 가리지 않는 줄: 가릴 상자와 절반 이상 겹치지 않는 줄
  const neighbors = (page.textBoxes ?? []).filter(
    (b) => isValidBBox(b) && !items.some((i) => coverOf(i.bbox, b) > 0.5),
  );

  /** @type {DrawItem[]} */
  const boxes = [];
  /** 같은 자리(픽셀 상자)에 그릴 가명 모음. 순서는 계획 순서(= 문서에서 나온 순서) */
  /** @type {Map<string, { rect: DrawItem['rect'], texts: string[] }>} */
  const labelsByRect = new Map();
  for (const item of items) {
    const rect = toPixelRect(item.bbox, page.width, page.height, neighbors);
    if (item.action === MASKING_ACTION.REPLACE && item.replacement) {
      const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
      const label = labelsByRect.get(key) ?? { rect, texts: [] };
      if (!label.texts.includes(item.replacement)) label.texts.push(item.replacement);
      labelsByRect.set(key, label);
    } else {
      boxes.push({ kind: 'box', rect });
    }
  }
  // 한 줄(block)에 가명이 여러 개면 위치가 같아서, 따로 그리면 마지막 가명만 보인다.
  // 같은 자리의 가명은 "[Landlord_A] / [Tenant_B]"처럼 이어서 한 번만 그린다.
  /** @type {DrawItem[]} */
  const labels = [...labelsByRect.values()].map(({ rect, texts }) => ({
    kind: 'label',
    rect,
    text: texts.join(LABEL_SEPARATOR),
  }));
  // 가명이 안 들어갈 때 넓혀도 되는 빈 공간 (#261): 옆 글자, 다른 상자를 넘지 않는다
  const W = page.width;
  const H = page.height;
  const textRects = neighbors.map((b) => ({ x: b.x * W, y: b.y * H, width: b.width * W, height: b.height * H }));
  const drawn = [...boxes, ...labels].map((d) => d.rect);
  for (const label of labels) label.room = labelRoom(label.rect, [...textRects, ...drawn], W);
  return [...boxes, ...labels];
}

/** 가명 글자가 이 크기(상자 높이 대비)보다 작으면 옆 빈 공간으로 넓혀 본다 (#261) */
const LABEL_TARGET = 0.7;
/** 넓혀도 이 크기(상자 높이 대비)보다 작으면 괄호를 뺀 가명도 그려 보고 큰 쪽을 쓴다 */
const LABEL_READABLE = 0.5;

/**
 * 표 칸 선이나 검은 상자처럼 위아래로 길게 어두운 세로줄이 있으면 그 앞에서 멈춘다 (#261)
 * 캔버스의 픽셀을 읽을 수 없는 환경(테스트)에서는 그대로 둔다.
 * @param {any} ctx
 * @param {DrawItem['rect']} rect
 * @param {number} from  넓히기 시작하는 x (상자 끝)
 * @param {number} to  넓히고 싶은 x
 * @returns {number} 실제로 넓혀도 되는 x
 */
function stopAtDarkColumn(ctx, rect, from, to) {
  if (typeof ctx.getImageData !== 'function' || from === to) return to;
  const x0 = Math.floor(Math.min(from, to));
  const w = Math.ceil(Math.abs(to - from));
  const y0 = Math.max(0, Math.floor(rect.y));
  const h = Math.max(1, Math.floor(rect.height));
  if (w <= 0) return to;
  let data;
  try {
    data = ctx.getImageData(x0, y0, w, h).data;
  } catch {
    return from; // 읽을 수 없으면 넓히지 않는다
  }
  const dark = (col) => {
    let n = 0;
    for (let row = 0; row < h; row += 1) {
      const k = (row * w + col) * 4;
      if (data[k] * 0.299 + data[k + 1] * 0.587 + data[k + 2] * 0.114 < 128) n += 1;
    }
    return n >= h * 0.7;
  };
  if (to > from) {
    for (let col = 0; col < w; col += 1) if (dark(col)) return Math.max(from, x0 + col - 1);
  } else {
    for (let col = w - 1; col >= 0; col -= 1) if (dark(col)) return Math.min(from, x0 + col + 2);
  }
  return to;
}

/**
 * 가명이 상자에 안 들어가면 옆 빈 공간(room) 안에서 오른쪽, 다음 왼쪽으로 넓힌다 (#261)
 * @param {any} ctx
 * @param {DrawItem} item
 * @param {number} widthPer1px
 * @returns {DrawItem['rect']}
 */
function widenedRect(ctx, item, widthPer1px) {
  const { rect, room } = item;
  if (!room) return rect;
  const side = rect.height * 0.15;
  const need = widthPer1px * Math.floor(rect.height * LABEL_TARGET) + side * 2 + 1;
  let extra = need - rect.width;
  if (extra <= 0) return rect;
  const right0 = rect.x + rect.width;
  const right = stopAtDarkColumn(ctx, rect, right0, Math.min(room.right, right0 + extra));
  extra -= right - right0;
  const left = extra > 0 ? stopAtDarkColumn(ctx, rect, rect.x, Math.max(room.left, rect.x - extra)) : rect.x;
  return { x: left, y: rect.y, width: right - left, height: rect.height };
}

/**
 * 목록을 캔버스에 그린다. 그린 결과는 원본 픽셀을 덮어쓰므로, 이 캔버스로 만든 이미지에는 원래 글자가 남지 않는다.
 * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} ctx
 * @param {DrawItem[]} drawItems
 */
export function drawRedactions(ctx, drawItems) {
  for (const item of drawItems) {
    const { y, height } = item.rect;
    if (item.kind === 'box') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(item.rect.x, y, item.rect.width, height);
      continue;
    }
    // 100px로 길이를 재서 1px당 길이를 구하고, 상자에 맞는 크기를 계산한다
    let text = item.text ?? '';
    ctx.font = 'bold 100px sans-serif';
    const per = ctx.measureText(text).width / 100;
    let fontSize = fitFontSize(per, item.rect);
    let { x, width } = item.rect;
    // 짧은 이름 칸처럼 가명이 작아지면 옆 빈 공간으로 넓힌다 (#261). 원래 자리는 그대로 다 덮는다
    if (fontSize < Math.floor(height * LABEL_TARGET)) {
      const wide = widenedRect(ctx, item, per);
      const wideSize = fitFontSize(per, wide);
      if (wideSize > fontSize) {
        ({ x, width } = wide);
        fontSize = wideSize;
      }
    }
    // 그래도 작으면 괄호를 뺀 가명 ("[Owner_A]" → "Owner_A")
    if (fontSize < height * LABEL_READABLE && /[[\]]/.test(text)) {
      const plain = text.replace(/[[\]]/g, '');
      const plainPer = ctx.measureText(plain).width / 100;
      const plainSize = fitFontSize(plainPer, { width, height });
      if (plainSize > fontSize) {
        text = plain;
        fontSize = plainSize;
      }
    }
    if (fontSize === 0) {
      // 가명이 들어가지 않는 작은 상자: 흰 상자만 남으면 가린 곳인지 모르므로 REDACT처럼 검은 상자로 그린다
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, y, width, height);
      continue;
    }

    // 흰 상자로 원래 글자를 완전히 덮고, 테두리와 가명을 그린다
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#1f5fbf';
    ctx.lineWidth = Math.max(1, Math.round(height * 0.06));
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = '#1f5fbf';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textBaseline = 'middle';
    // 최대 너비를 주지 않아서 글자가 가로로 눌리지 않는다 (크기를 이미 맞췄음)
    ctx.fillText(text, x + height * 0.15, y + height / 2);
  }
}
