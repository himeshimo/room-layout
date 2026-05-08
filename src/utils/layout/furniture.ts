import type { Furniture } from '../../types';
import { cmToPx } from './scale';

export interface FurnitureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const getFurnitureRect = (furniture: Furniture, pxPerCm: number): FurnitureRect => {
  const baseWidth = cmToPx(furniture.widthCm, pxPerCm);
  const baseHeight = cmToPx(furniture.depthCm, pxPerCm);
  const isRotated = furniture.rotation % 180 !== 0;

  return {
    x: furniture.x,
    y: furniture.y,
    width: isRotated ? baseHeight : baseWidth,
    height: isRotated ? baseWidth : baseHeight,
  };
};

export const getFurnitureCenter = (furniture: Furniture, pxPerCm: number) => {
  const rect = getFurnitureRect(furniture, pxPerCm);
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
};

