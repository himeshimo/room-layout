import type { CanvasPoint } from '../../types';
import { pointInPolygon } from './room';

export interface Edge {
  a: CanvasPoint;
  b: CanvasPoint;
  dx: number;
  dy: number;
  length: number;
}

export const getRectCorners = (rect: { x: number; y: number; width: number; height: number }): CanvasPoint[] => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.width, y: rect.y },
  { x: rect.x + rect.width, y: rect.y + rect.height },
  { x: rect.x, y: rect.y + rect.height },
];

export const getRectEdges = (corners: CanvasPoint[]): Edge[] => corners.map((point, index) => {
  const next = corners[(index + 1) % corners.length];
  const dx = next.x - point.x;
  const dy = next.y - point.y;
  return {
    a: point,
    b: next,
    dx,
    dy,
    length: Math.hypot(dx, dy),
  };
});

export const getPolygonEdges = (points: CanvasPoint[]): Edge[] => points.map((point, index) => {
  const next = points[(index + 1) % points.length];
  const dx = next.x - point.x;
  const dy = next.y - point.y;
  return {
    a: point,
    b: next,
    dx,
    dy,
    length: Math.hypot(dx, dy),
  };
});

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const distancePointToSegment = (p: CanvasPoint, e: Edge) => {
  if (e.length < 1e-9) return Math.hypot(p.x - e.a.x, p.y - e.a.y);
  const t = clamp01(((p.x - e.a.x) * e.dx + (p.y - e.a.y) * e.dy) / (e.length * e.length));
  const projX = e.a.x + e.dx * t;
  const projY = e.a.y + e.dy * t;
  return Math.hypot(p.x - projX, p.y - projY);
};

const minDistanceToPolygonEdges = (point: CanvasPoint, polygonEdges: Edge[]) => (
  polygonEdges.reduce((min, edge) => Math.min(min, distancePointToSegment(point, edge)), Number.POSITIVE_INFINITY)
);

const edgeDistance = (a: Edge, b: Edge) => Math.min(
  distancePointToSegment(a.a, b),
  distancePointToSegment(a.b, b),
  distancePointToSegment(b.a, a),
  distancePointToSegment(b.b, a),
);

const degreesBetweenEdges = (a: Edge, b: Edge) => {
  if (a.length < 1e-9 || b.length < 1e-9) return 180;
  const dot = a.dx * b.dx + a.dy * b.dy;
  const cos = Math.max(-1, Math.min(1, dot / (a.length * b.length)));
  const deg = Math.acos(Math.abs(cos)) * (180 / Math.PI);
  return deg;
};

export const areEdgesNearlyParallel = (a: Edge, b: Edge, toleranceDeg: number) => (
  degreesBetweenEdges(a, b) <= toleranceDeg
);

export const getProjectedOverlapRatio = (base: Edge, target: Edge) => {
  if (base.length < 1e-9) return 0;
  const ux = base.dx / base.length;
  const uy = base.dy / base.length;

  const proj = (p: CanvasPoint) => (p.x - base.a.x) * ux + (p.y - base.a.y) * uy;
  const baseMin = 0;
  const baseMax = base.length;
  const t1 = proj(target.a);
  const t2 = proj(target.b);
  const targetMin = Math.min(t1, t2);
  const targetMax = Math.max(t1, t2);

  const overlap = Math.max(0, Math.min(baseMax, targetMax) - Math.max(baseMin, targetMin));
  return overlap / base.length;
};

const pointOnSegment = (point: CanvasPoint, a: CanvasPoint, b: CanvasPoint, eps = 1e-6) => {
  const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
  if (Math.abs(cross) > eps) return false;
  const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
  if (dot < -eps) return false;
  const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (dot - lenSq > eps) return false;
  return true;
};

export const isPointInPolygonInclusive = (point: CanvasPoint, polygon: CanvasPoint[]) => (
  pointInPolygon(point, polygon) || polygon.some((p, i) => pointOnSegment(point, p, polygon[(i + 1) % polygon.length]))
);

export const isRectInsidePolygon = (corners: CanvasPoint[], polygon: CanvasPoint[]) => (
  corners.every((corner) => isPointInPolygonInclusive(corner, polygon))
);

const orient = (a: CanvasPoint, b: CanvasPoint, c: CanvasPoint) => (
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
);

const segmentsProperlyIntersect = (a1: CanvasPoint, a2: CanvasPoint, b1: CanvasPoint, b2: CanvasPoint) => {
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  const eps = 1e-9;

  const hasStraddle = (x: number, y: number) => (x > eps && y < -eps) || (x < -eps && y > eps);
  return hasStraddle(o1, o2) && hasStraddle(o3, o4);
};

export const isRectFullyInsidePolygon = (corners: CanvasPoint[], polygon: CanvasPoint[]) => {
  if (!isRectInsidePolygon(corners, polygon)) return false;

  const rectEdges = getRectEdges(corners);
  const roomEdges = getPolygonEdges(polygon);
  const crossesBoundary = rectEdges.some((re) => roomEdges.some((pe) => (
    segmentsProperlyIntersect(re.a, re.b, pe.a, pe.b)
  )));

  return !crossesBoundary;
};

export const isRectInsidePolygonWithInnerPadding = (
  corners: CanvasPoint[],
  polygon: CanvasPoint[],
  innerPaddingPx: number,
) => {
  if (innerPaddingPx <= 0) return isRectFullyInsidePolygon(corners, polygon);
  if (!isRectFullyInsidePolygon(corners, polygon)) return false;

  const polygonEdges = getPolygonEdges(polygon);
  return corners.every((corner) => minDistanceToPolygonEdges(corner, polygonEdges) >= innerPaddingPx);
};

export const getWallContacts = (
  rectCorners: CanvasPoint[],
  roomPolygon: CanvasPoint[],
  distanceThresholdPx: number,
  angleToleranceDeg: number,
  overlapRatio: number,
) => {
  const rectEdges = getRectEdges(rectCorners);
  const roomEdges = getPolygonEdges(roomPolygon);
  let contacts = 0;

  for (const edge of rectEdges) {
    const touches = roomEdges.some((roomEdge) => (
      areEdgesNearlyParallel(edge, roomEdge, angleToleranceDeg)
      && edgeDistance(edge, roomEdge) <= distanceThresholdPx
      && getProjectedOverlapRatio(edge, roomEdge) >= overlapRatio
    ));
    if (touches) contacts += 1;
  }

  return contacts;
};
