import type { CanvasPoint } from '../../types';
import { getGridSizePx } from './scale';

export const snapToGrid = (valuePx: number, pxPerCm: number, originPx = 0) => {
  const gridSizePx = getGridSizePx(pxPerCm);
  return Math.round((valuePx - originPx) / gridSizePx) * gridSizePx + originPx;
};

export const snapPointToGrid = (point: CanvasPoint, pxPerCm: number, origin: CanvasPoint) => ({
  x: snapToGrid(point.x, pxPerCm, origin.x),
  y: snapToGrid(point.y, pxPerCm, origin.y),
});

export const getAxisPositions = (canvasSize: number, originPx: number, stepPx: number) => {
  const positions: number[] = [];
  const remainder = ((originPx % stepPx) + stepPx) % stepPx;
  let current = remainder === 0 ? 0 : remainder;

  while (current <= canvasSize) {
    positions.push(current);
    current += stepPx;
  }

  return positions;
};

