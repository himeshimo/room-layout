import { GRID_CM } from './constants';

export const cmToPx = (cm: number, pxPerCm: number) => cm * pxPerCm;

export const pxToCm = (px: number, pxPerCm: number) => px / pxPerCm;

export const getGridSizePx = (pxPerCm: number) => GRID_CM * pxPerCm;

