import type { CanvasPoint } from '../../types';

export const distanceBetweenPoints = (a: CanvasPoint, b: CanvasPoint) => Math.hypot(b.x - a.x, b.y - a.y);

export const flattenPoints = (points: CanvasPoint[]) => points.flatMap((point) => [point.x, point.y]);

export const getPolygonCenter = (points: CanvasPoint[]) => {
  const total = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
};

export const pointInPolygon = (point: CanvasPoint, polygon: CanvasPoint[]) => {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
};

export const getPolygonAreaPx2 = (points: CanvasPoint[]) => {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum) / 2;
};

export const getPolygonAreaM2 = (points: CanvasPoint[], pxPerCm: number) => {
  const areaCm2 = getPolygonAreaPx2(points) / (pxPerCm * pxPerCm);
  return areaCm2 / 10000;
};

export const getTatamiCount = (areaM2: number) => areaM2 / 1.62;

export const getPolygonBounds = (points: CanvasPoint[]) => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const EPSILON = 0.001;
const RECTANGLE_TOLERANCE_PX = 16;

const approximatelyEqual = (a: number, b: number) => Math.abs(a - b) <= EPSILON;

export const isAxisAlignedRectangle = (points: CanvasPoint[]) => {
  if (points.length !== 4) return false;

  const bounds = getPolygonBounds(points);
  const expected = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];

  return expected.every((corner) => points.some(
    (point) => approximatelyEqual(point.x, corner.x) && approximatelyEqual(point.y, corner.y),
  ));
};

export const isRectangleLike = (points: CanvasPoint[]) => {
  if (isAxisAlignedRectangle(points)) return true;
  if (points.length !== 4) return false;

  const bounds = getPolygonBounds(points);
  const expected = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];

  return expected.every((corner) => points.some((point) => (
    Math.abs(point.x - corner.x) <= RECTANGLE_TOLERANCE_PX
    && Math.abs(point.y - corner.y) <= RECTANGLE_TOLERANCE_PX
  )));
};

export const inferRoomZoneShapeType = (points: CanvasPoint[]) => (
  isRectangleLike(points) ? 'rectangle' : 'polygon'
);

export const resizeRectangleZoneFromTopLeft = (
  points: CanvasPoint[],
  widthPx: number,
  heightPx: number,
) => {
  const bounds = getPolygonBounds(points);
  const minX = bounds.minX;
  const minY = bounds.minY;

  return [
    { x: minX, y: minY },
    { x: minX + widthPx, y: minY },
    { x: minX + widthPx, y: minY + heightPx },
    { x: minX, y: minY + heightPx },
  ];
};

export const getRectangleSizeCmFromTatami = (
  tatamiJo: number,
  aspectRatio: number,
) => {
  const areaCm2 = tatamiJo * 1.62 * 10000;
  const safeAspectRatio = aspectRatio > 0 ? aspectRatio : 1;
  const widthCm = Math.sqrt(areaCm2 * safeAspectRatio);
  const heightCm = areaCm2 / widthCm;

  return {
    widthCm,
    heightCm,
  };
};
