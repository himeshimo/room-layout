export type FurnitureType =
  | 'bed'
  | 'fridge'
  | 'desk'
  | 'sofa'
  | 'chest'
  | 'dresser'
  | 'washer'
  | 'drumWasher'
  | 'shelf'
  | 'kitchen'
  | 'washstand'
  | 'laundrySpace'
  | 'toilet'
  | 'bathtub'
  | 'door'
  | 'closet'
  | 'window'
  | 'aircon'
  | 'outlet'
  | 'pillar'
  | 'beam'
  | 'custom';

export interface OpenSpace {
  front: number;
  left: number;
  right: number;
  back: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface Furniture {
  id: string;
  type: FurnitureType;
  label: string;
  icon?: string;
  x: number; // top-left px on canvas
  y: number;
  xCm?: number;
  yCm?: number;
  widthCm: number;
  depthCm: number;
  openSpace?: OpenSpace | null;
  allowCornerPlacement?: boolean;
  clearances?: OpenSpace;
  rotation: number; // 0, 90, 180, 270
  color: string;
  roomId?: string | null;
  isEquipment?: boolean;
  locked?: boolean;
}

export interface ScaleConfig {
  pixelLength: number; // px
  realCm: number; // cm
  source?: 'two_point' | 'tatami';
}

export interface RoomZone {
  id: string;
  name: string;
  points: CanvasPoint[];
  x?: number;
  y?: number;
  widthCm?: number;
  depthCm?: number;
  rotation?: number;
  locked?: boolean;
  color: string;
  shapeType?: 'rectangle' | 'polygon';
  tatamiJo?: number | null;
}

export type Tool = 'select' | 'scale' | 'room';

export interface SavedLayoutDataV2 {
  version: 2 | 3 | 4 | 5;
  scale?: ScaleConfig;
  furnitures?: Furniture[];
  roomZones?: RoomZone[];
  bgImage?: string | null;
  background?: {
    x: number;
    y: number;
    widthCm: number;
    heightCm: number;
    opacity: number;
    displayScale?: number;
  } | null;
  ui?: {
    showGrid?: boolean;
    showBackground?: boolean;
    furnitureSnapEnabled?: boolean;
    roomSnapEnabled?: boolean;
    showOpenSpace?: boolean;
    showClearance?: boolean;
    viewportScale?: number;
    viewportOffset?: { x: number; y: number };
  };
}
