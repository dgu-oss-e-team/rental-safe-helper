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
 */

import { MASKING_ACTION, isValidBBox } from '../../shared/document-model.js';

/** @typedef {import('../../shared/document-model.js').MaskingPlan} MaskingPlan */
/** @typedef {import('../../shared/document-model.js').BBox} BBox */

/**
 * @typedef {Object} DrawItem
 * @property {'box' | 'label'} kind  box = 검은 상자, label = 흰 상자 + 글자
 * @property {{ x: number, y: number, width: number, height: number }} rect  픽셀 좌표
 * @property {string} [text]  label일 때 그릴 글자 (가명 등)
 */

/** 상자를 글자보다 조금 넓게 그려서 글자 가장자리가 새지 않게 한다 (페이지 크기 대비 비율) */
const PADDING = 0.002;

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
 * 0~1 정규화 좌표를 픽셀 좌표로 바꾼다. 여유(PADDING)를 더하고 페이지 밖으로 나가지 않게 자른다.
 * @param {BBox} bbox
 * @param {number} pageWidth  픽셀
 * @param {number} pageHeight  픽셀
 */
export function toPixelRect(bbox, pageWidth, pageHeight) {
  const x0 = Math.max(0, bbox.x - PADDING);
  const y0 = Math.max(0, bbox.y - PADDING);
  const x1 = Math.min(1, bbox.x + bbox.width + PADDING);
  const y1 = Math.min(1, bbox.y + bbox.height + PADDING);
  const x = Math.floor(x0 * pageWidth);
  const y = Math.floor(y0 * pageHeight);
  return {
    x,
    y,
    width: Math.ceil(x1 * pageWidth) - x,
    height: Math.ceil(y1 * pageHeight) - y,
  };
}

/**
 * 한 페이지에 그릴 목록을 만든다.
 * @param {MaskingPlan} plan
 * @param {{ documentId: string, pageIndex: number, width: number, height: number }} page  width/height는 픽셀
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

  /** @type {DrawItem[]} */
  const boxes = [];
  /** @type {DrawItem[]} */
  const labels = [];
  for (const item of items) {
    const rect = toPixelRect(item.bbox, page.width, page.height);
    if (item.action === MASKING_ACTION.REPLACE && item.replacement) {
      labels.push({ kind: 'label', rect, text: item.replacement });
    } else {
      boxes.push({ kind: 'box', rect });
    }
  }
  return [...boxes, ...labels];
}

/**
 * 목록을 캔버스에 그린다. 그린 결과는 원본 픽셀을 덮어쓰므로, 이 캔버스로 만든 이미지에는 원래 글자가 남지 않는다.
 * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} ctx
 * @param {DrawItem[]} drawItems
 */
export function drawRedactions(ctx, drawItems) {
  for (const item of drawItems) {
    const { x, y, width, height } = item.rect;
    if (item.kind === 'box') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, y, width, height);
      continue;
    }
    // 100px로 길이를 재서 1px당 길이를 구하고, 상자에 맞는 크기를 계산한다
    const text = item.text ?? '';
    ctx.font = 'bold 100px sans-serif';
    const fontSize = fitFontSize(ctx.measureText(text).width / 100, item.rect);
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
