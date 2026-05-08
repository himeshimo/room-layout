import { useEffect, useRef, useState } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Node } from 'konva/lib/Node';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from 'react-konva';
import useImage from 'use-image';
import { FURNITURE_PRESETS } from './furnitureData';
import {
  cmToPx,
  distanceBetweenPoints,
  flattenPoints,
  getRectCorners,
  getAxisPositions,
  getFurnitureCenter,
  getFurnitureRect,
  getGridSizePx,
  getWallContacts,
  isRectFullyInsidePolygon,
  getPolygonBounds,
  getPolygonCenter,
  inferRoomZoneShapeType,
  isRectangleLike,
  MAJOR_GRID_CM,
  pointInPolygon,
  pxToCm,
  resizeRectangleZoneFromTopLeft,
  snapPointToGrid,
  snapToGrid,
} from './utils/layout';
import type {
  CanvasPoint,
  Furniture,
  FurnitureType,
  RoomZone,
  SavedLayoutDataV2,
  ScaleConfig,
  Tool,
} from './types';
import './App.css';

const CANVAS_W = 880;
const CANVAS_H = 680;
const MIN_DIMENSION_CM = 10;
const TIGHT_EDGE_THRESHOLD_CM = 3;
const WALL_PARALLEL_ANGLE_TOLERANCE_DEG = 5;
const WALL_CONTACT_OVERLAP_RATIO = 0.5;
const ROOM_ZONE_STROKE_WIDTH_PX = 2;
const LOCAL_STORAGE_KEY = 'room-layout-autosave-v5';
const DEFAULT_SCALE: ScaleConfig = { pixelLength: 100, realCm: 100 };
const ROOM_ZONE_COLORS = [
  'rgba(79, 142, 247, 0.22)',
  'rgba(124, 94, 247, 0.22)',
  'rgba(247, 201, 79, 0.22)',
  'rgba(62, 207, 142, 0.22)',
  'rgba(224, 85, 85, 0.22)',
];

type SectionId =
  | 'guide'
  | 'image'
  | 'scale'
  | 'background'
  | 'room'
  | 'add'
  | 'edit'
  | 'placed'
  | 'data'
  | 'debug';

interface BackgroundState {
  x: number;
  y: number;
  widthCm: number;
  heightCm: number;
  opacity: number;
  displayScale?: number;
}

interface DragGuide {
  x: number;
  y: number;
  width: number;
  height: number;
}
type WarningLevel = 'none' | 'warn' | 'danger';

interface UiStateSnapshot {
  showGrid: boolean;
  showBackground: boolean;
  furnitureSnapEnabled: boolean;
  roomSnapEnabled: boolean;
  showOpenSpace: boolean;
  viewportScale: number;
  viewportOffset: { x: number; y: number };
}

interface AppSnapshot {
  scale: ScaleConfig;
  furnitures: Furniture[];
  roomZones: RoomZone[];
  bgImage: string | null;
  background: BackgroundState | null;
  ui: UiStateSnapshot;
}

interface CollapsibleSectionProps {
  id: SectionId;
  title: string;
  index: string;
  isOpen: boolean;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}

let idCounter = 1;
const genId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${idCounter++}`;
};

const DEFAULT_SECTION_STATE: Record<SectionId, boolean> = {
  guide: true,
  image: false,
  scale: false,
  background: false,
  room: false,
  add: true,
  edit: true,
  placed: true,
  data: false,
  debug: false,
};
const FURNITURE_TYPES: FurnitureType[] = ['bed', 'fridge', 'desk', 'sofa', 'chest', 'dresser', 'washer', 'drumWasher', 'shelf'];
const EQUIPMENT_TYPES: FurnitureType[] = ['kitchen', 'washstand', 'laundrySpace', 'toilet', 'bathtub', 'door', 'closet', 'window', 'aircon', 'outlet', 'pillar', 'beam'];
const isEquipmentType = (type: FurnitureType) => EQUIPMENT_TYPES.includes(type);

const formatDimensions = (widthCm: number, depthCm: number) => `${widthCm}×${depthCm}`;

const sanitizeDimensionValue = (value: number, fallback = MIN_DIMENSION_CM) => {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(MIN_DIMENSION_CM, value);
};
const parseNumberOrNull = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const parseDimensions = (value: string) => {
  const normalized = value.trim().replace(/[xX＊*]/g, '×');
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const widthCm = Number(match[1]);
  const depthCm = Number(match[2]);

  if (!Number.isFinite(widthCm) || !Number.isFinite(depthCm) || widthCm <= 0 || depthCm <= 0) {
    return null;
  }

  return {
    widthCm: Math.max(MIN_DIMENSION_CM, widthCm),
    depthCm: Math.max(MIN_DIMENSION_CM, depthCm),
  };
};

const fitBackgroundToCanvas = (imageWidth: number, imageHeight: number, pxPerCm: number): BackgroundState => {
  const scale = Math.min(CANVAS_W / imageWidth, CANVAS_H / imageHeight);
  const fittedWidth = imageWidth * scale;
  const fittedHeight = imageHeight * scale;

  return {
    x: (CANVAS_W - fittedWidth) / 2,
    y: (CANVAS_H - fittedHeight) / 2,
    widthCm: pxToCm(fittedWidth, pxPerCm),
    heightCm: pxToCm(fittedHeight, pxPerCm),
    opacity: 0.65,
    displayScale: 1,
  };
};

const alignPointToAxis = (
  pointer: CanvasPoint,
  anchor: CanvasPoint | undefined,
) => {
  if (!anchor) return pointer;
  const dx = Math.abs(pointer.x - anchor.x);
  const dy = Math.abs(pointer.y - anchor.y);
  if (dx >= dy) {
    return { x: pointer.x, y: anchor.y };
  }
  return { x: anchor.x, y: pointer.y };
};

const alignRoomPointWithClosingAssist = (
  pointer: CanvasPoint,
  previousPoint: CanvasPoint | undefined,
  firstPoint: CanvasPoint | undefined,
  isShiftPressed: boolean,
  isFourthPoint: boolean,
) => {
  if (!isShiftPressed || !previousPoint) return pointer;

  const aligned = alignPointToAxis(pointer, previousPoint);
  if (!isFourthPoint || !firstPoint) return aligned;

  const horizontal = Math.abs(pointer.x - previousPoint.x) >= Math.abs(pointer.y - previousPoint.y);
  const assisted = horizontal
    ? { x: firstPoint.x, y: previousPoint.y }
    : { x: previousPoint.x, y: firstPoint.y };

  const distanceAligned = Math.hypot(pointer.x - aligned.x, pointer.y - aligned.y);
  const distanceAssisted = Math.hypot(pointer.x - assisted.x, pointer.y - assisted.y);
  return distanceAssisted < distanceAligned ? assisted : aligned;
};

const maybeSnapPoint = (
  point: CanvasPoint,
  enabled: boolean,
  pxPerCm: number,
  origin: CanvasPoint,
) => (enabled ? snapPointToGrid(point, pxPerCm, origin) : point);

const maybeSnapAxis = (
  valuePx: number,
  enabled: boolean,
  pxPerCm: number,
  originPx = 0,
) => (enabled ? snapToGrid(valuePx, pxPerCm, originPx) : valuePx);

const shouldSnap = (nativeEvent: MouseEvent | TouchEvent) => !('altKey' in nativeEvent && nativeEvent.altKey);
const sameOptionalNumber = (a?: number, b?: number) => {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) < 0.001;
};

const hasRoleInAncestors = (node: Node | null, role: string) => {
  let current = node;
  while (current) {
    if (current.getAttr('dataRole') === role) return true;
    current = current.getParent();
  }
  return false;
};

const getRoomZoneTopLeft = (zone: RoomZone) => {
  if (typeof zone.x === 'number' && typeof zone.y === 'number') {
    return { x: zone.x, y: zone.y };
  }
  const bounds = getPolygonBounds(zone.points);
  return { x: bounds.minX, y: bounds.minY };
};

const getRoomZonePoints = (zone: RoomZone, pxPerCm: number) => {
  const isRect = zone.shapeType === 'rectangle' || isRectangleLike(zone.points);
  if (isRect && typeof zone.widthCm === 'number' && typeof zone.depthCm === 'number') {
    const topLeft = getRoomZoneTopLeft(zone);
    return [
      { x: topLeft.x, y: topLeft.y },
      { x: topLeft.x + cmToPx(zone.widthCm, pxPerCm), y: topLeft.y },
      { x: topLeft.x + cmToPx(zone.widthCm, pxPerCm), y: topLeft.y + cmToPx(zone.depthCm, pxPerCm) },
      { x: topLeft.x, y: topLeft.y + cmToPx(zone.depthCm, pxPerCm) },
    ];
  }
  return zone.points;
};

const getOpenSpacePaddingPx = (furniture: Furniture, pxPerCm: number) => {
  const c = furniture.openSpace ?? { front: 0, left: 0, right: 0, back: 0 };
  const front = cmToPx(c.front, pxPerCm);
  const left = cmToPx(c.left, pxPerCm);
  const right = cmToPx(c.right, pxPerCm);
  const back = cmToPx(c.back, pxPerCm);
  const rotation = ((furniture.rotation % 360) + 360) % 360;

  if (rotation === 90) return { top: left, right: front, bottom: right, left: back };
  if (rotation === 180) return { top: front, right, bottom: back, left: left };
  if (rotation === 270) return { top: right, right: back, bottom: left, left: front };
  return { top: back, right, bottom: front, left };
};

const getOpenSpaceRects = (
  furnitureRect: { x: number; y: number; width: number; height: number },
  openSpacePadding: { top: number; right: number; bottom: number; left: number },
) => [
  {
    x: furnitureRect.x - openSpacePadding.left,
    y: furnitureRect.y - openSpacePadding.top,
    width: furnitureRect.width + openSpacePadding.left + openSpacePadding.right,
    height: openSpacePadding.top,
  },
  {
    x: furnitureRect.x - openSpacePadding.left,
    y: furnitureRect.y + furnitureRect.height,
    width: furnitureRect.width + openSpacePadding.left + openSpacePadding.right,
    height: openSpacePadding.bottom,
  },
  {
    x: furnitureRect.x - openSpacePadding.left,
    y: furnitureRect.y,
    width: openSpacePadding.left,
    height: furnitureRect.height,
  },
  {
    x: furnitureRect.x + furnitureRect.width,
    y: furnitureRect.y,
    width: openSpacePadding.right,
    height: furnitureRect.height,
  },
].filter((rect) => rect.width > 0 && rect.height > 0);

const getBoundsFromRects = (rects: Array<{ x: number; y: number; width: number; height: number }>) => {
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const rectsOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

const hasOpenSpace = (furniture: Furniture) => {
  const s = furniture.openSpace;
  if (!s) return false;
  return s.front >= 1 || s.back >= 1 || s.left >= 1 || s.right >= 1;
};

const isCornerPlacementAllowed = (furniture: Furniture) => (
  Boolean(furniture.isEquipment || furniture.allowCornerPlacement)
);

const getOccupiedBounds = (furniture: Furniture, pxPerCm: number) => {
  const bodyRect = getFurnitureRect(furniture, pxPerCm);
  if (!hasOpenSpace(furniture)) {
    return {
      bodyRect,
      occupiedBounds: {
        minX: bodyRect.x,
        minY: bodyRect.y,
        maxX: bodyRect.x + bodyRect.width,
        maxY: bodyRect.y + bodyRect.height,
        width: bodyRect.width,
        height: bodyRect.height,
      },
    };
  }

  const openSpacePadding = getOpenSpacePaddingPx(furniture, pxPerCm);
  const openRects = getOpenSpaceRects(bodyRect, openSpacePadding);
  const occupiedBounds = getBoundsFromRects([bodyRect, ...openRects]);
  return { bodyRect, occupiedBounds };
};

const ensureUniqueIds = <T extends { id: string }>(
  items: T[],
  seedIds?: Set<string>,
): T[] => {
  const used = seedIds ?? new Set<string>();
  return items.map((item) => {
    let nextId = item.id;
    while (!nextId || used.has(nextId)) {
      nextId = genId();
    }
    used.add(nextId);
    return nextId === item.id ? item : { ...item, id: nextId };
  });
};

function CollapsibleSection({
  id,
  title,
  index,
  isOpen,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  return (
    <section className={`section ${isOpen ? 'section-open' : 'section-closed'}`}>
      <button className="section-toggle" onClick={() => onToggle(id)}>
        <h2>
          <span>{index}</span>
          {title}
        </h2>
        <span className={`section-toggle-icon ${isOpen ? 'open' : ''}`}>⌄</span>
      </button>
      {isOpen && <div className="section-body">{children}</div>}
    </section>
  );
}

function BackgroundImage({
  src,
  x,
  y,
  width,
  height,
  opacity,
}: {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}) {
  const [image] = useImage(src);
  if (!image) return null;

  return <KonvaImage image={image} x={x} y={y} width={width} height={height} opacity={opacity} />;
}

function FurnitureShape({
  furniture,
  pxPerCm,
  isSelected,
  roomName,
  draggable,
  showOpenSpace,
  warningLevel,
  isOpenSpaceBlocked,
  isOpenSpaceOutOfRoom,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  furniture: Furniture;
  pxPerCm: number;
  isSelected: boolean;
  roomName: string;
  draggable: boolean;
  showOpenSpace: boolean;
  warningLevel: WarningLevel;
  isOpenSpaceBlocked: boolean;
  isOpenSpaceOutOfRoom: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragMove: (id: string, x: number, y: number, nativeEvent: MouseEvent | TouchEvent) => void;
  onDragEnd: (id: string, x: number, y: number, nativeEvent: MouseEvent | TouchEvent) => void;
}) {
  const size = getFurnitureRect(furniture, pxPerCm);
  const openSpace = getOpenSpacePaddingPx(furniture, pxPerCm);
  const shouldShowOpenSpace = showOpenSpace && hasOpenSpace(furniture);
  const isWarning = warningLevel !== 'none';
  const warningStroke = warningLevel === 'warn' ? '#f7c94f' : '#ff4f6d';
  const emoji = furniture.icon ?? FURNITURE_PRESETS[furniture.type].emoji;

  return (
    <Group
      dataRole="furniture"
      x={furniture.x}
      y={furniture.y}
      draggable={draggable}
      onClick={(event) => {
        event.cancelBubble = true;
        onSelect();
      }}
      onTap={(event) => {
        event.cancelBubble = true;
        onSelect();
      }}
      onDragStart={() => onDragStart()}
      onDragMove={(event) => onDragMove(furniture.id, event.target.x(), event.target.y(), event.evt)}
      onDragEnd={(event) => onDragEnd(furniture.id, event.target.x(), event.target.y(), event.evt)}
    >
      {shouldShowOpenSpace && (
        <Rect
          x={-openSpace.left}
          y={-openSpace.top}
          width={size.width + openSpace.left + openSpace.right}
          height={size.height + openSpace.top + openSpace.bottom}
          fill={isOpenSpaceBlocked
            ? 'rgba(255, 79, 109, 0.2)'
            : isOpenSpaceOutOfRoom
              ? 'rgba(247, 166, 79, 0.2)'
              : 'rgba(255, 174, 66, 0.18)'}
          stroke={isOpenSpaceBlocked
            ? 'rgba(255, 79, 109, 0.7)'
            : isOpenSpaceOutOfRoom
              ? 'rgba(247, 166, 79, 0.75)'
              : 'rgba(255, 174, 66, 0.45)'}
          strokeWidth={1}
          cornerRadius={6}
          listening={false}
        />
      )}
      <Rect
        x={3}
        y={3}
        width={size.width}
        height={size.height}
        fill="rgba(0,0,0,0.22)"
        cornerRadius={5}
        listening={false}
      />
      <Rect
        width={size.width}
        height={size.height}
        fill={furniture.color}
        cornerRadius={5}
        stroke={isWarning ? warningStroke : (isSelected ? '#FFD700' : 'rgba(255,255,255,0.4)')}
        strokeWidth={isWarning ? 3 : (isSelected ? 3 : 1)}
        shadowColor={isSelected ? '#FFD700' : undefined}
        shadowBlur={isSelected ? 18 : 0}
        opacity={furniture.isEquipment ? 0.72 : (isSelected ? 1 : 0.9)}
      />
      {isWarning && (
        <Rect
          width={size.width}
          height={size.height}
          fill={warningLevel === 'warn' ? 'rgba(247, 201, 79, 0.16)' : 'rgba(255, 79, 109, 0.18)'}
          cornerRadius={5}
          listening={false}
        />
      )}
      <Text
        x={0}
        y={0}
        width={size.width}
        height={size.height}
        text={isSelected
          ? `${emoji}\n${furniture.label}\n${furniture.widthCm}×${furniture.depthCm}cm\n${roomName}\n${furniture.rotation}°`
          : `${emoji}\n${furniture.label}`}
        fontSize={Math.max(9, Math.min(13, size.width / 9))}
        fontFamily="'Noto Sans JP', sans-serif"
        fill="rgba(255,255,255,0.96)"
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    </Group>
  );
}

export default function App() {
  const [toolMode, setToolMode] = useState<Tool>('select');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>(DEFAULT_SECTION_STATE);
  const [showGrid, setShowGrid] = useState(true);
  const [showBackground, setShowBackground] = useState(true);
  const [showOpenSpace, setShowOpenSpace] = useState(true);
  const [furnitureSnapEnabled, setFurnitureSnapEnabled] = useState(false);
  const [roomSnapEnabled, setRoomSnapEnabled] = useState(false);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [background, setBackground] = useState<BackgroundState | null>(null);
  const [scale, setScale] = useState<ScaleConfig>(DEFAULT_SCALE);
  const [scaleRealCmInput, setScaleRealCmInput] = useState('100');
  const [scaleDraftPoints, setScaleDraftPoints] = useState<CanvasPoint[]>([]);
  const [roomDraftPoints, setRoomDraftPoints] = useState<CanvasPoint[]>([]);
  const [roomNameInput, setRoomNameInput] = useState('');
  const [hoverPoint, setHoverPoint] = useState<CanvasPoint | null>(null);
  const [dragGuide, setDragGuide] = useState<DragGuide | null>(null);
  const [addCategory, setAddCategory] = useState<'furniture' | 'equipment' | 'custom'>('furniture');
  const [addType, setAddType] = useState<FurnitureType>('bed');
  const [newFurnitureSize, setNewFurnitureSize] = useState(formatDimensions(
    FURNITURE_PRESETS.bed.widthCm,
    FURNITURE_PRESETS.bed.depthCm,
  ));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRoomZoneId, setSelectedRoomZoneId] = useState<string | null>(null);
  const [selectedSizeInput, setSelectedSizeInput] = useState('');
  const [selectedWidthInput, setSelectedWidthInput] = useState('');
  const [selectedDepthInput, setSelectedDepthInput] = useState('');
  const [selectedOpenFrontInput, setSelectedOpenFrontInput] = useState('');
  const [selectedOpenBackInput, setSelectedOpenBackInput] = useState('');
  const [selectedOpenLeftInput, setSelectedOpenLeftInput] = useState('');
  const [selectedOpenRightInput, setSelectedOpenRightInput] = useState('');
  const [selectedRoomWidthInput, setSelectedRoomWidthInput] = useState('');
  const [selectedRoomDepthInput, setSelectedRoomDepthInput] = useState('');
  const [furnitures, setFurnitures] = useState<Furniture[]>([]);
  const [roomZones, setRoomZones] = useState<RoomZone[]>([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const [viewportScale, setViewportScale] = useState(1);
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [customFurnitureName, setCustomFurnitureName] = useState('カスタム家具');
  const [customFurnitureWidthCm, setCustomFurnitureWidthCm] = useState(100);
  const [customFurnitureDepthCm, setCustomFurnitureDepthCm] = useState(100);
  const [customFurnitureWidthInput, setCustomFurnitureWidthInput] = useState('100');
  const [customFurnitureDepthInput, setCustomFurnitureDepthInput] = useState('100');
  const [customFurnitureEmoji, setCustomFurnitureEmoji] = useState('📦');
  const [customAllowCornerPlacement, setCustomAllowCornerPlacement] = useState(false);
  const [customOpenSpaceEnabled, setCustomOpenSpaceEnabled] = useState(false);
  const [customOpenFrontCm, setCustomOpenFrontCm] = useState(70);
  const [customOpenBackCm, setCustomOpenBackCm] = useState(0);
  const [customOpenLeftCm, setCustomOpenLeftCm] = useState(0);
  const [customOpenRightCm, setCustomOpenRightCm] = useState(0);
  const [customOpenFrontInput, setCustomOpenFrontInput] = useState('70');
  const [customOpenBackInput, setCustomOpenBackInput] = useState('0');
  const [customOpenLeftInput, setCustomOpenLeftInput] = useState('0');
  const [customOpenRightInput, setCustomOpenRightInput] = useState('0');
  const [helpExpanded, setHelpExpanded] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(false);
  const [undoStack, setUndoStack] = useState<AppSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<AppSnapshot[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const panStartRef = useRef<CanvasPoint | null>(null);
  const panMovedRef = useRef(false);
  const skipHistoryRef = useRef(false);
  const maxHistory = 80;

  const pxPerCm = scale.pixelLength / scale.realCm;
  const gridSizePx = getGridSizePx(pxPerCm);
  const selected = furnitures.find((item) => item.id === selectedId) ?? null;
  const selectedRoomZone = roomZones.find((item) => item.id === selectedRoomZoneId) ?? null;
  const isFirstGuideVisible = !guideDismissed && roomZones.length === 0 && furnitures.length === 0;
  const furnitureDiagnostics = (() => {
    const rectMap = new Map<string, { x: number; y: number; width: number; height: number }>();
    const reasons = new Map<string, Array<{ message: string; level: WarningLevel; priority: number }>>();
    const levels = new Map<string, WarningLevel>();
    const openSpaceBlocked = new Set<string>();
    const openSpaceOutOfRoom = new Set<string>();
    const bodyOutById = new Map<string, boolean>();

    for (const item of furnitures) {
      rectMap.set(item.id, getFurnitureRect(item, pxPerCm));
      reasons.set(item.id, []);
      levels.set(item.id, 'none');
      bodyOutById.set(item.id, false);
    }
    const addReason = (id: string, message: string, level: WarningLevel, priority: number) => {
      const list = reasons.get(id);
      if (!list) return;
      if (!list.some((entry) => entry.message === message)) {
        list.push({ message, level, priority });
      }
      if (level === 'danger') setLevel(id, 'danger');
      if (level === 'warn') setLevel(id, 'warn');
    };
    const setLevel = (id: string, next: WarningLevel) => {
      const current = levels.get(id) ?? 'none';
      if (current === 'danger') return;
      if (current === 'warn' && next === 'none') return;
      levels.set(id, next);
    };

    const roomPolygonByFurniture = new Map<string, CanvasPoint[] | null>();

    // Priority 1: room membership / body out-of-room (polygon)
    for (const item of furnitures) {
      const rect = rectMap.get(item.id)!;
      const corners = getRectCorners(rect);
      if (!item.roomId) {
        roomPolygonByFurniture.set(item.id, null);
        bodyOutById.set(item.id, true);
        addReason(item.id, 'Room Zone未所属です', 'danger', 50);
      } else {
        const zone = roomZones.find((z) => z.id === item.roomId) ?? null;
        if (!zone) {
          roomPolygonByFurniture.set(item.id, null);
          bodyOutById.set(item.id, true);
          addReason(item.id, 'Room Zone未所属です', 'danger', 50);
        } else {
          const roomPolygon = getRoomZonePoints(zone, pxPerCm);
          roomPolygonByFurniture.set(item.id, roomPolygon);
          if (!isRectFullyInsidePolygon(corners, roomPolygon)) {
            bodyOutById.set(item.id, true);
            addReason(item.id, '部屋からはみ出しています', 'danger', 10);
          }
        }
      }
    }

    // Priority 2: body overlap
    for (let i = 0; i < furnitures.length; i += 1) {
      for (let j = i + 1; j < furnitures.length; j += 1) {
        const a = furnitures[i];
        const b = furnitures[j];
        const sameRoom = a.roomId && b.roomId ? a.roomId === b.roomId : (!a.roomId && !b.roomId);
        if (!sameRoom) continue;
        const rectA = rectMap.get(a.id)!;
        const rectB = rectMap.get(b.id)!;
        if (!rectsOverlap(rectA, rectB)) continue;

        addReason(a.id, `${b.label}と重なっています`, 'danger', 20);
        addReason(b.id, `${a.label}と重なっています`, 'danger', 20);
      }
    }

    // Priority 3: open-space blocked / open-space out-of-room
    for (const item of furnitures) {
      if (bodyOutById.get(item.id)) continue;
      if (!hasOpenSpace(item)) continue;
      const body = rectMap.get(item.id)!;
      const roomPolygon = roomPolygonByFurniture.get(item.id) ?? null;
      const p = getOpenSpacePaddingPx(item, pxPerCm);
      const openSpaceRects = getOpenSpaceRects(body, p);

      if (roomPolygon) {
        const outOfRoom = openSpaceRects.some((rect) => !isRectFullyInsidePolygon(getRectCorners(rect), roomPolygon));
        if (outOfRoom) {
          openSpaceOutOfRoom.add(item.id);
          addReason(item.id, '開閉スペースが部屋の外にはみ出しています', 'warn', 30);
        }
      }

      const interferingIds = furnitures
        .filter((other) => other.id !== item.id)
        .filter((other) => (
          item.roomId && other.roomId ? item.roomId === other.roomId : (!item.roomId && !other.roomId)
        ))
        .filter((other) => {
          const otherRect = rectMap.get(other.id)!;
          return openSpaceRects.some((rect) => rectsOverlap(rect, otherRect));
        })
        .map((other) => other.id);

      const blocked = interferingIds.length > 0;
      if (blocked) {
        openSpaceBlocked.add(item.id);
        addReason(item.id, '開閉スペースが不足しています', 'danger', 30);
        for (const interferingId of interferingIds) {
          addReason(interferingId, '他の家具の使用スペースを妨げています', 'warn', 30);
        }
      }
    }

    // Priority 4: wall contact tightness (shape-based)
    for (const item of furnitures) {
      if (bodyOutById.get(item.id)) continue;
      if (item.isEquipment) continue;
      const roomPolygon = roomPolygonByFurniture.get(item.id) ?? null;
      if (!roomPolygon) continue;
      const existing = reasons.get(item.id) ?? [];
      if (existing.some((entry) => entry.priority <= 30 && entry.level === 'danger')) continue;
      const rect = rectMap.get(item.id)!;
      const contacts = getWallContacts(
        getRectCorners(rect),
        roomPolygon,
        cmToPx(TIGHT_EDGE_THRESHOLD_CM, pxPerCm),
        WALL_PARALLEL_ANGLE_TOLERANCE_DEG,
        WALL_CONTACT_OVERLAP_RATIO,
      );
      if (contacts >= 4) {
        addReason(item.id, 'ほぼ余裕がありません。設置困難です', 'danger', 40);
      } else if (contacts >= 3) {
        addReason(item.id, '余裕が非常に少ないため、実測推奨です', 'warn', 40);
      } else if (contacts >= 2 && !isCornerPlacementAllowed(item)) {
        addReason(item.id, '2辺以上が壁に近いため、実測推奨です', 'warn', 40);
      }
    }

    for (const item of furnitures) {
      const sorted = (reasons.get(item.id) ?? []).sort((a, b) => a.priority - b.priority);
      reasons.set(item.id, sorted);
    }

    return { reasons, levels, openSpaceBlocked, openSpaceOutOfRoom };
  })();
  const selectedRoomPoints = selectedRoomZone ? getRoomZonePoints(selectedRoomZone, pxPerCm) : null;
  const selectedRoomBounds = selectedRoomPoints ? getPolygonBounds(selectedRoomPoints) : null;
  const selectedRoomWidthCm = selectedRoomBounds ? pxToCm(selectedRoomBounds.width, pxPerCm) : 0;
  const selectedRoomHeightCm = selectedRoomBounds ? pxToCm(selectedRoomBounds.height, pxPerCm) : 0;
  const backgroundWidthPx = background ? cmToPx(background.widthCm, pxPerCm) * (background.displayScale ?? 1) : 0;
  const backgroundHeightPx = background ? cmToPx(background.heightCm, pxPerCm) * (background.displayScale ?? 1) : 0;
  const worldOrigin = {
    x: background?.x ?? 0,
    y: background?.y ?? 0,
  };
  const measuredScalePx = scaleDraftPoints.length === 2
    ? distanceBetweenPoints(scaleDraftPoints[0], scaleDraftPoints[1])
    : null;
  const modeLabel = toolMode === 'select'
    ? '選択'
    : toolMode === 'scale'
      ? '縮尺取得'
      : 'Room Zone作成';
  const toWorldPoint = (point: CanvasPoint) => ({
    x: (point.x - viewportOffset.x) / viewportScale,
    y: (point.y - viewportOffset.y) / viewportScale,
  });

  const buildSnapshot = (): AppSnapshot => ({
    scale,
    furnitures,
    roomZones,
    bgImage,
    background,
    ui: {
      showGrid,
      showBackground,
      furnitureSnapEnabled,
      roomSnapEnabled,
      showOpenSpace,
      viewportScale,
      viewportOffset,
    },
  });

  const applySnapshot = (snapshot: AppSnapshot) => {
    skipHistoryRef.current = true;
    setScale(snapshot.scale);
    setScaleRealCmInput(String(snapshot.scale.realCm));
    setFurnitures(snapshot.furnitures);
    setRoomZones(snapshot.roomZones);
    setBgImage(snapshot.bgImage);
    setBackground(snapshot.background);
    setShowGrid(snapshot.ui.showGrid);
    setShowBackground(snapshot.ui.showBackground);
    setFurnitureSnapEnabled(snapshot.ui.furnitureSnapEnabled);
    setRoomSnapEnabled(snapshot.ui.roomSnapEnabled);
    setShowOpenSpace(snapshot.ui.showOpenSpace);
    setViewportScale(snapshot.ui.viewportScale);
    setViewportOffset(snapshot.ui.viewportOffset);
    setTimeout(() => {
      skipHistoryRef.current = false;
    }, 0);
  };

  const pushHistory = () => {
    if (skipHistoryRef.current) return;
    const snapshot = buildSnapshot();
    setUndoStack((prev) => [...prev.slice(-maxHistory + 1), snapshot]);
    setRedoStack([]);
  };

  const toggleSection = (id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const undo = () => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const previous = prev[prev.length - 1];
      setRedoStack((redo) => [...redo, buildSnapshot()]);
      applySnapshot(previous);
      return prev.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setUndoStack((undoPrev) => [...undoPrev.slice(-maxHistory + 1), buildSnapshot()]);
      applySnapshot(next);
      return prev.slice(0, -1);
    });
  };

  const activateMode = (nextMode: Tool) => {
    setToolMode(nextMode);
    setHoverPoint(null);
    setDragGuide(null);

    if (nextMode !== 'scale') {
      setScaleDraftPoints([]);
    }

    if (nextMode !== 'room') {
      setRoomDraftPoints([]);
      setRoomNameInput('');
    }
  };

  const getZoneName = (roomId?: string | null) => {
    const zone = roomZones.find((item) => item.id === roomId);
    return zone?.name ?? '未所属';
  };

  const assignRoomToFurniture = (furniture: Furniture) => {
    const center = getFurnitureCenter(furniture, pxPerCm);
    const room = roomZones.find((zone) => pointInPolygon(center, getRoomZonePoints(zone, pxPerCm))) ?? null;
    if (!room) {
      return {
        ...furniture,
        roomId: null,
        xCm: undefined,
        yCm: undefined,
      };
    }
    const roomTopLeft = getRoomZoneTopLeft(room);
    return {
      ...furniture,
      roomId: room.id,
      xCm: pxToCm(furniture.x - roomTopLeft.x, pxPerCm),
      yCm: pxToCm(furniture.y - roomTopLeft.y, pxPerCm),
    };
  };

  const updateRoomZone = (id: string, patch: Partial<RoomZone>) => {
    setRoomZones((prev) => prev.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)));
  };

  const updateRoomZoneSize = (
    zone: RoomZone,
    key: 'widthCm' | 'heightCm',
    value: number,
  ) => {
    const zonePoints = getRoomZonePoints(zone, pxPerCm);
    if (!Number.isFinite(value) || value <= 0) return;

    const bounds = getPolygonBounds(zonePoints);
    const nextWidthCm = key === 'widthCm' ? value : pxToCm(bounds.width, pxPerCm);
    const nextHeightCm = key === 'heightCm' ? value : pxToCm(bounds.height, pxPerCm);

    const nextPoints = resizeRectangleZoneFromTopLeft(
      zonePoints,
      cmToPx(nextWidthCm, pxPerCm),
      cmToPx(nextHeightCm, pxPerCm),
    );
    pushHistory();
    const topLeft = getRoomZoneTopLeft(zone);
    updateRoomZone(zone.id, {
      x: topLeft.x,
      y: topLeft.y,
      widthCm: nextWidthCm,
      depthCm: nextHeightCm,
      points: nextPoints,
      shapeType: 'rectangle',
    });
  };


  const deleteRoomZone = (id: string) => {
    pushHistory();
    setRoomZones((prev) => prev.filter((zone) => zone.id !== id));
    setSelectedRoomZoneId((prev) => (prev === id ? null : prev));
    setFurnitures((prev) => prev.map((item) => (item.roomId === id ? { ...item, roomId: null } : item)));
  };
  const confirmDeleteRoomZone = (id: string) => {
    if (!window.confirm('選択中のRoom Zoneを削除します。よろしいですか？')) return;
    deleteRoomZone(id);
  };

  const createNewLayout = () => {
    if (!window.confirm('現在のレイアウトをすべて削除して新規作成します。よろしいですか？')) return;
    pushHistory();
    setRoomZones([]);
    setFurnitures([]);
    setBgImage(null);
    setBackground(null);
    setScale(DEFAULT_SCALE);
    setScaleRealCmInput(String(DEFAULT_SCALE.realCm));
    setViewportScale(1);
    setViewportOffset({ x: 0, y: 0 });
    setScaleDraftPoints([]);
    setRoomDraftPoints([]);
    setHoverPoint(null);
    setSelectedId(null);
    setSelectedRoomZoneId(null);
    setCustomFurnitureName('カスタム家具');
    setCustomFurnitureWidthCm(100);
    setCustomFurnitureDepthCm(100);
    setCustomFurnitureWidthInput('100');
    setCustomFurnitureDepthInput('100');
    setCustomFurnitureEmoji('📦');
    setCustomAllowCornerPlacement(false);
    setCustomOpenSpaceEnabled(false);
    setCustomOpenFrontCm(70);
    setCustomOpenBackCm(0);
    setCustomOpenLeftCm(0);
    setCustomOpenRightCm(0);
    setCustomOpenFrontInput('70');
    setCustomOpenBackInput('0');
    setCustomOpenLeftInput('0');
    setCustomOpenRightInput('0');
    setGuideDismissed(false);
    setToolMode('select');
  };

  const focusSelectedRoomZone = () => {
    if (!selectedRoomZone) return;
    const points = getRoomZonePoints(selectedRoomZone, pxPerCm);
    const bounds = getPolygonBounds(points);
    const padding = 40;
    const scaleX = (CANVAS_W - padding * 2) / Math.max(bounds.width, 1);
    const scaleY = (CANVAS_H - padding * 2) / Math.max(bounds.height, 1);
    const nextScale = Math.max(0.6, Math.min(2.5, Math.min(scaleX, scaleY)));
    const centerX = bounds.minX + bounds.width / 2;
    const centerY = bounds.minY + bounds.height / 2;

    setViewportScale(nextScale);
    setViewportOffset({
      x: CANVAS_W / 2 - centerX * nextScale,
      y: CANVAS_H / 2 - centerY * nextScale,
    });
  };

  const resetView = () => {
    setViewportScale(1);
    setViewportOffset({ x: 0, y: 0 });
  };

  const clampZoom = (value: number) => Math.max(0.25, Math.min(4, value));

  const zoomBy = (delta: number) => {
    const nextScale = clampZoom(viewportScale * delta);
    setViewportScale(nextScale);
  };

  const fitAllToView = () => {
    const zonePoints = roomZones.flatMap((zone) => getRoomZonePoints(zone, pxPerCm));
    const furniturePoints = furnitures.flatMap((item) => {
      const rect = getFurnitureRect(item, pxPerCm);
      return [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
      ];
    });
    const allPoints = [...zonePoints, ...furniturePoints];
    if (allPoints.length === 0) {
      resetView();
      return;
    }
    const bounds = getPolygonBounds(allPoints);
    const padding = 40;
    const scaleX = (CANVAS_W - padding * 2) / Math.max(bounds.width, 1);
    const scaleY = (CANVAS_H - padding * 2) / Math.max(bounds.height, 1);
    const nextScale = clampZoom(Math.min(scaleX, scaleY));
    const centerX = bounds.minX + bounds.width / 2;
    const centerY = bounds.minY + bounds.height / 2;

    setViewportScale(nextScale);
    setViewportOffset({
      x: CANVAS_W / 2 - centerX * nextScale,
      y: CANVAS_H / 2 - centerY * nextScale,
    });
  };

  useEffect(() => {
    setSelectedSizeInput(selected ? formatDimensions(selected.widthCm, selected.depthCm) : '');
    setSelectedWidthInput(selected ? String(selected.widthCm) : '');
    setSelectedDepthInput(selected ? String(selected.depthCm) : '');
    setSelectedOpenFrontInput(String(selected?.openSpace?.front ?? 0));
    setSelectedOpenBackInput(String(selected?.openSpace?.back ?? 0));
    setSelectedOpenLeftInput(String(selected?.openSpace?.left ?? 0));
    setSelectedOpenRightInput(String(selected?.openSpace?.right ?? 0));
  }, [selected]);

  useEffect(() => {
    if (roomZones.length > 0 || furnitures.length > 0) {
      setGuideDismissed(true);
    }
  }, [roomZones.length, furnitures.length]);

  useEffect(() => {
    if (!selectedRoomZone) {
      setSelectedRoomWidthInput('');
      setSelectedRoomDepthInput('');
      return;
    }
    setSelectedRoomWidthInput(String(Math.round(selectedRoomWidthCm)));
    setSelectedRoomDepthInput(String(Math.round(selectedRoomHeightCm)));
  }, [selectedRoomZoneId, selectedRoomWidthCm, selectedRoomHeightCm]);

  const applyRoomDimensionInput = (zone: RoomZone, key: 'widthCm' | 'heightCm', rawValue: string) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    const fallback = key === 'widthCm' ? selectedRoomWidthCm : selectedRoomHeightCm;
    updateRoomZoneSize(zone, key, sanitizeDimensionValue(numeric, fallback));
  };

  const applyCustomDimensionInput = (key: 'width' | 'depth', rawValue: string) => {
    const numeric = parseNumberOrNull(rawValue);
    if (numeric === null || numeric <= 0) {
      if (key === 'width') setCustomFurnitureWidthInput(String(customFurnitureWidthCm));
      if (key === 'depth') setCustomFurnitureDepthInput(String(customFurnitureDepthCm));
      return;
    }
    const safe = sanitizeDimensionValue(numeric, 100);
    if (key === 'width') {
      setCustomFurnitureWidthCm(safe);
      setCustomFurnitureWidthInput(String(safe));
    } else {
      setCustomFurnitureDepthCm(safe);
      setCustomFurnitureDepthInput(String(safe));
    }
  };

  const applyCustomOpenSpaceInput = (key: 'front' | 'back' | 'left' | 'right', rawValue: string) => {
    const numeric = parseNumberOrNull(rawValue);
    const current = key === 'front' ? customOpenFrontCm : key === 'back' ? customOpenBackCm : key === 'left' ? customOpenLeftCm : customOpenRightCm;
    if (numeric === null || numeric < 0) {
      const fallback = String(current);
      if (key === 'front') setCustomOpenFrontInput(fallback);
      if (key === 'back') setCustomOpenBackInput(fallback);
      if (key === 'left') setCustomOpenLeftInput(fallback);
      if (key === 'right') setCustomOpenRightInput(fallback);
      return;
    }
    const safe = Math.max(0, numeric);
    if (key === 'front') { setCustomOpenFrontCm(safe); setCustomOpenFrontInput(String(safe)); }
    if (key === 'back') { setCustomOpenBackCm(safe); setCustomOpenBackInput(String(safe)); }
    if (key === 'left') { setCustomOpenLeftCm(safe); setCustomOpenLeftInput(String(safe)); }
    if (key === 'right') { setCustomOpenRightCm(safe); setCustomOpenRightInput(String(safe)); }
  };

  const applySelectedDimensionInput = (key: 'widthCm' | 'depthCm', rawValue: string) => {
    if (!selected) return;
    const numeric = parseNumberOrNull(rawValue);
    if (numeric === null || numeric <= 0) {
      if (key === 'widthCm') setSelectedWidthInput(String(selected.widthCm));
      if (key === 'depthCm') setSelectedDepthInput(String(selected.depthCm));
      return;
    }
    updateSelectedDimensions(key, numeric);
    if (key === 'widthCm') setSelectedWidthInput(String(sanitizeDimensionValue(numeric, selected.widthCm)));
    if (key === 'depthCm') setSelectedDepthInput(String(sanitizeDimensionValue(numeric, selected.depthCm)));
  };

  const applySelectedOpenSpaceInput = (key: 'front' | 'back' | 'left' | 'right', rawValue: string) => {
    if (!selected) return;
    const numeric = parseNumberOrNull(rawValue);
    const current = selected.openSpace?.[key] ?? 0;
    if (numeric === null || numeric < 0) {
      const fallback = String(current);
      if (key === 'front') setSelectedOpenFrontInput(fallback);
      if (key === 'back') setSelectedOpenBackInput(fallback);
      if (key === 'left') setSelectedOpenLeftInput(fallback);
      if (key === 'right') setSelectedOpenRightInput(fallback);
      return;
    }
    updateSelectedOpenSpace(key, numeric);
    const safe = String(Math.max(0, numeric));
    if (key === 'front') setSelectedOpenFrontInput(safe);
    if (key === 'back') setSelectedOpenBackInput(safe);
    if (key === 'left') setSelectedOpenLeftInput(safe);
    if (key === 'right') setSelectedOpenRightInput(safe);
  };

  useEffect(() => {
    setFurnitures((prev) => prev.map((item) => {
      if (!item.roomId || item.xCm === undefined || item.yCm === undefined) return item;
      const zone = roomZones.find((z) => z.id === item.roomId);
      if (!zone) return item;
      const topLeft = getRoomZoneTopLeft(zone);
      const nextX = topLeft.x + cmToPx(item.xCm, pxPerCm);
      const nextY = topLeft.y + cmToPx(item.yCm, pxPerCm);
      if (Math.abs(nextX - item.x) < 0.001 && Math.abs(nextY - item.y) < 0.001) return item;
      return { ...item, x: nextX, y: nextY };
    }));
  }, [roomZones, pxPerCm]);

  useEffect(() => {
    const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!saved) return;
    try {
      const data = JSON.parse(saved) as SavedLayoutDataV2;
      if (!data) return;
      const nextScale = data.scale ?? DEFAULT_SCALE;
      const nextPxPerCm = nextScale.pixelLength / nextScale.realCm;
      const nextRoomZonesRaw = (data.roomZones ?? []).map((zone) => {
        const bounds = getPolygonBounds(zone.points);
        return {
          ...zone,
          x: zone.x ?? bounds.minX,
          y: zone.y ?? bounds.minY,
          widthCm: zone.widthCm ?? pxToCm(bounds.width, nextPxPerCm),
          depthCm: zone.depthCm ?? pxToCm(bounds.height, nextPxPerCm),
          rotation: zone.rotation ?? 0,
          shapeType: zone.shapeType ?? inferRoomZoneShapeType(zone.points),
          tatamiJo: zone.tatamiJo ?? null,
          locked: zone.locked ?? false,
        };
      });
      const roomIds = new Set<string>();
      const nextRoomZones = ensureUniqueIds(nextRoomZonesRaw, roomIds);
      const nextFurnituresRaw = (data.furnitures ?? []).map((item) => ({
        ...item,
        roomId: item.roomId ?? null,
        openSpace: item.openSpace
          ?? item.clearances
          ?? FURNITURE_PRESETS[item.type].openSpace
          ?? null,
        allowCornerPlacement: (item.isEquipment ?? isEquipmentType(item.type))
          ? true
          : (item.allowCornerPlacement ?? false),
        isEquipment: item.isEquipment ?? isEquipmentType(item.type),
        locked: item.locked ?? false,
      }));
      const nextFurnitures = ensureUniqueIds(nextFurnituresRaw, roomIds);

      applySnapshot({
        scale: nextScale,
        furnitures: nextFurnitures,
        roomZones: nextRoomZones,
        bgImage: data.bgImage ?? null,
        background: data.background
          ? { ...data.background, displayScale: data.background.displayScale ?? 1 }
          : null,
        ui: {
          showGrid: data.ui?.showGrid ?? true,
          showBackground: data.ui?.showBackground ?? true,
          furnitureSnapEnabled: data.ui?.furnitureSnapEnabled ?? false,
          roomSnapEnabled: data.ui?.roomSnapEnabled ?? false,
          showOpenSpace: data.ui?.showOpenSpace ?? data.ui?.showClearance ?? true,
          viewportScale: data.ui?.viewportScale ?? 1,
          viewportOffset: data.ui?.viewportOffset ?? { x: 0, y: 0 },
        },
      });
    } catch {
      // ignore corrupted autosave
    }
  }, []);

  useEffect(() => {
    const data: SavedLayoutDataV2 = {
      version: 5,
      scale,
      furnitures,
      roomZones,
      bgImage,
      background,
      ui: {
        showGrid,
        showBackground,
        furnitureSnapEnabled,
        roomSnapEnabled,
        showOpenSpace,
        viewportScale,
        viewportOffset,
      },
    };
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  }, [
    scale,
    furnitures,
    roomZones,
    bgImage,
    background,
    showGrid,
    showBackground,
    furnitureSnapEnabled,
    roomSnapEnabled,
    showOpenSpace,
    viewportScale,
    viewportOffset,
  ]);

  useEffect(() => {
    setFurnitures((prev) => prev.map((item) => {
      const next = assignRoomToFurniture(item);
      const sameRoom = next.roomId === item.roomId;
      const sameLocalX = sameOptionalNumber(next.xCm, item.xCm);
      const sameLocalY = sameOptionalNumber(next.yCm, item.yCm);
      return sameRoom && sameLocalX && sameLocalY ? item : next;
    }));
  }, [roomZones, pxPerCm]);

  const clearScaleDraft = () => {
    setScaleDraftPoints([]);
    setHoverPoint(null);
  };

  const applyScaleFromDraft = () => {
    const realCm = Number.parseFloat(scaleRealCmInput);
    if (!measuredScalePx || !Number.isFinite(realCm) || realCm <= 0) return;

    pushHistory();
    setScale({
      pixelLength: measuredScalePx,
      realCm,
      source: 'two_point',
    });
    clearScaleDraft();
    setToolMode('select');
  };


  const cancelRoomDraft = () => {
    setRoomDraftPoints([]);
    setRoomNameInput('');
    setHoverPoint(null);
    setToolMode('select');
  };

  const finalizeRoomZone = () => {
    if (roomDraftPoints.length < 3) return;

    const bounds = getPolygonBounds(roomDraftPoints);
    const nextZone: RoomZone = {
      id: genId(),
      name: roomNameInput.trim() || `部屋 ${roomZones.length + 1}`,
      points: roomDraftPoints,
      x: bounds.minX,
      y: bounds.minY,
      widthCm: pxToCm(bounds.width, pxPerCm),
      depthCm: pxToCm(bounds.height, pxPerCm),
      rotation: 0,
      locked: true,
      color: ROOM_ZONE_COLORS[roomZones.length % ROOM_ZONE_COLORS.length],
      shapeType: inferRoomZoneShapeType(roomDraftPoints),
      tatamiJo: null,
    };

    pushHistory();
    setRoomZones((prev) => [...prev, nextZone]);
    setRoomDraftPoints([]);
    setRoomNameInput('');
    setHoverPoint(null);
    setToolMode('select');
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTyping) return;

      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setShowBackground((prev) => !prev);
        return;
      }
      if (isMod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedId) {
          event.preventDefault();
          deleteSelected();
        } else if (selectedRoomZoneId) {
          event.preventDefault();
          confirmDeleteRoomZone(selectedRoomZoneId);
        }
        return;
      }
      if (isMod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (toolMode === 'scale' && event.key === 'Escape') {
        clearScaleDraft();
        setToolMode('select');
      }

      if (toolMode === 'room') {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelRoomDraft();
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          finalizeRoomZone();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toolMode, roomDraftPoints, roomNameInput, roomZones.length, measuredScalePx, scaleRealCmInput, undo, redo, duplicateSelected, selectedId, selectedRoomZoneId]);

  const gridLines = () => {
    const lines: React.ReactElement[] = [];
    const stepPx = gridSizePx;
    const majorStepPx = cmToPx(MAJOR_GRID_CM, pxPerCm);
    const verticalMinor = getAxisPositions(CANVAS_W, worldOrigin.x, stepPx);
    const horizontalMinor = getAxisPositions(CANVAS_H, worldOrigin.y, stepPx);
    const verticalMajor = getAxisPositions(CANVAS_W, worldOrigin.x, majorStepPx);
    const horizontalMajor = getAxisPositions(CANVAS_H, worldOrigin.y, majorStepPx);

    for (const x of verticalMinor) {
      lines.push(
        <Line key={`minor-v-${x}`} points={[x, 0, x, CANVAS_H]} stroke="rgba(100,160,255,0.12)" strokeWidth={1} />,
      );
    }
    for (const y of horizontalMinor) {
      lines.push(
        <Line key={`minor-h-${y}`} points={[0, y, CANVAS_W, y]} stroke="rgba(100,160,255,0.12)" strokeWidth={1} />,
      );
    }
    for (const x of verticalMajor) {
      lines.push(
        <Line key={`major-v-${x}`} points={[x, 0, x, CANVAS_H]} stroke="rgba(100,160,255,0.28)" strokeWidth={1} />,
      );
    }
    for (const y of horizontalMajor) {
      lines.push(
        <Line key={`major-h-${y}`} points={[0, y, CANVAS_W, y]} stroke="rgba(100,160,255,0.28)" strokeWidth={1} />,
      );
    }

    return lines;
  };

  const addFurniture = () => {
    const preset = FURNITURE_PRESETS[addType];
    const parsedSize = parseDimensions(newFurnitureSize);
    const isCustom = addCategory === 'custom' || addType === 'custom';
    const isEquipment = !isCustom && isEquipmentType(addType);
    const customWidth = sanitizeDimensionValue(customFurnitureWidthCm, 100);
    const customDepth = sanitizeDimensionValue(customFurnitureDepthCm, 100);
    const customOpenSpace = customOpenSpaceEnabled
      ? {
          front: Math.max(0, customOpenFrontCm),
          back: Math.max(0, customOpenBackCm),
          left: Math.max(0, customOpenLeftCm),
          right: Math.max(0, customOpenRightCm),
        }
      : null;
    const anchor = selectedRoomZone
      ? getRoomZoneTopLeft(selectedRoomZone)
      : { x: CANVAS_W / 2, y: CANVAS_H / 2 };
    pushHistory();
    const nextFurniture = assignRoomToFurniture({
      id: genId(),
      type: addType,
      label: isCustom ? customFurnitureName.trim() || 'カスタム家具' : preset.label,
      x: selectedRoomZone
        ? anchor.x + cmToPx(20, pxPerCm)
        : maybeSnapAxis(anchor.x, furnitureSnapEnabled, pxPerCm, worldOrigin.x),
      y: selectedRoomZone
        ? anchor.y + cmToPx(20, pxPerCm)
        : maybeSnapAxis(anchor.y, furnitureSnapEnabled, pxPerCm, worldOrigin.y),
      widthCm: isCustom ? customWidth : (parsedSize?.widthCm ?? preset.widthCm),
      depthCm: isCustom ? customDepth : (parsedSize?.depthCm ?? preset.depthCm),
      rotation: 0,
      color: isCustom ? '#A2AAB8' : preset.color,
      icon: isCustom ? (customFurnitureEmoji.trim() || '📦') : preset.emoji,
      openSpace: isCustom ? customOpenSpace : (preset.openSpace ?? null),
      allowCornerPlacement: isEquipment ? true : (isCustom ? customAllowCornerPlacement : false),
      roomId: selectedRoomZone?.id ?? null,
      isEquipment,
      locked: false,
    });

    setFurnitures((prev) => [...prev, nextFurniture]);
    setSelectedId(nextFurniture.id);
    setSelectedRoomZoneId(null);
  };

  const handleAddTypeChange = (type: FurnitureType) => {
    setAddType(type);
    const preset = FURNITURE_PRESETS[type];
    setNewFurnitureSize(formatDimensions(preset.widthCm, preset.depthCm));
    setAddCategory(type === 'custom' ? 'custom' : (isEquipmentType(type) ? 'equipment' : 'furniture'));
  };

  const updateFurniture = (id: string, patch: Partial<Furniture>) => {
    setFurnitures((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...patch };
      if (item.isEquipment || patch.isEquipment) {
        next.allowCornerPlacement = true;
      }
      return assignRoomToFurniture(next);
    }));
  };

  const toggleSelectedOpenSpaceEnabled = (enabled: boolean) => {
    if (!selected) return;
    pushHistory();
    updateFurniture(selected.id, {
      openSpace: enabled ? (selected.openSpace ?? { front: 0, back: 0, left: 0, right: 0 }) : null,
    });
  };

  const toggleSelectedCornerPlacement = (enabled: boolean) => {
    if (!selected || selected.isEquipment) return;
    pushHistory();
    updateFurniture(selected.id, { allowCornerPlacement: enabled });
  };

  const toggleSelectedLock = (locked: boolean) => {
    if (!selected) return;
    pushHistory();
    updateFurniture(selected.id, { locked });
  };

  const updateSelectedLabel = (label: string) => {
    if (!selectedId) return;
    updateFurniture(selectedId, { label });
  };

  const updateSelectedDimensions = (key: 'widthCm' | 'depthCm', value: number) => {
    if (!selected || !selectedId) return;

    const safeValue = sanitizeDimensionValue(value, selected[key]);
    const nextWidth = key === 'widthCm' ? safeValue : selected.widthCm;
    const nextDepth = key === 'depthCm' ? safeValue : selected.depthCm;

    updateFurniture(selectedId, key === 'widthCm' ? { widthCm: safeValue } : { depthCm: safeValue });
    setSelectedSizeInput(formatDimensions(nextWidth, nextDepth));
  };

  const updateSelectedOpenSpace = (
    key: 'front' | 'back' | 'left' | 'right',
    value: number,
  ) => {
    if (!selectedId || !selected) return;
    const base = selected.openSpace ?? { front: 0, back: 0, left: 0, right: 0 };
    updateFurniture(selectedId, {
      openSpace: {
        ...base,
        [key]: Math.max(0, value),
      },
    });
  };

  const applySelectedSizeInput = (value: string) => {
    setSelectedSizeInput(value);
    const parsed = parseDimensions(value);
    if (!parsed || !selectedId) return;
    updateFurniture(selectedId, {
      widthCm: parsed.widthCm,
      depthCm: parsed.depthCm,
    });
  };

  const rotateSelected = () => {
    if (!selectedId || !selected) return;
    pushHistory();
    updateFurniture(selectedId, { rotation: (selected.rotation + 90) % 360 });
  };

  function duplicateSelected() {
    if (!selected) return;
    pushHistory();
    const offsetPx = cmToPx(10, pxPerCm);
    const duplicated = assignRoomToFurniture({
      ...selected,
      id: genId(),
      x: selected.x + offsetPx,
      y: selected.y + offsetPx,
      xCm: selected.xCm !== undefined ? selected.xCm + 10 : undefined,
      yCm: selected.yCm !== undefined ? selected.yCm + 10 : undefined,
    });
    setFurnitures((prev) => [...prev, duplicated]);
    setSelectedId(duplicated.id);
  }

  const alignSelectedToWall = (direction: 'left' | 'right' | 'top' | 'bottom') => {
    if (!selected || !selected.roomId) return;
    const zone = roomZones.find((z) => z.id === selected.roomId);
    if (!zone) return;
    pushHistory();
    const bounds = getPolygonBounds(getRoomZonePoints(zone, pxPerCm));
    const { occupiedBounds } = getOccupiedBounds(selected, pxPerCm);
    const next = { x: selected.x, y: selected.y };
    if (direction === 'left') next.x = selected.x + (bounds.minX - occupiedBounds.minX);
    if (direction === 'right') next.x = selected.x + (bounds.maxX - occupiedBounds.maxX);
    if (direction === 'top') next.y = selected.y + (bounds.minY - occupiedBounds.minY);
    if (direction === 'bottom') next.y = selected.y + (bounds.maxY - occupiedBounds.maxY);
    updateFurniture(selected.id, next);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    pushHistory();
    setFurnitures((prev) => prev.filter((item) => item.id !== selectedId));
    setSelectedId(null);
  };

  const updateBackground = (patch: Partial<BackgroundState>) => {
    setBackground((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleBgUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      setBgImage(url);
      setBackground(fitBackgroundToCanvas(image.width, image.height, pxPerCm));
      setOpenSections((prev) => ({ ...prev, image: true, background: true, scale: true }));
    };
    image.src = url;
  };

  const resetBackgroundFit = () => {
    if (!background) return;

    const widthPx = cmToPx(background.widthCm, pxPerCm);
    const heightPx = cmToPx(background.heightCm, pxPerCm);
    updateBackground({
      x: snapToGrid((CANVAS_W - widthPx) / 2, pxPerCm),
      y: snapToGrid((CANVAS_H - heightPx) / 2, pxPerCm),
      opacity: 0.65,
    });
  };

  const nudgeBackground = (axis: 'x' | 'y', direction: -1 | 1) => {
    const stepPx = gridSizePx;
    updateBackground({
      [axis]: ((background?.[axis] ?? 0) + stepPx * direction),
    });
  };

  const handleStagePointerDown = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const targetNode = event.target as Node;
    const isFurnitureHit = hasRoleInAncestors(targetNode, 'furniture');
    const isRoomZoneHit = hasRoleInAncestors(targetNode, 'room-zone');
    const isObjectHit = isFurnitureHit || isRoomZoneHit;

    if (toolMode === 'select' && isObjectHit) {
      panStartRef.current = null;
      panMovedRef.current = false;
      return;
    }

    if (toolMode === 'select' && !isObjectHit) {
      const isPrimaryPointer = !(event.evt instanceof MouseEvent) || event.evt.button === 0;
      if (!isPrimaryPointer) return;
      const pointer = event.target.getStage()?.getPointerPosition();
      if (!pointer) return;
      panStartRef.current = pointer;
      panMovedRef.current = false;
      return;
    }

    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    const worldPointer = toWorldPoint(pointer);

    if (toolMode === 'scale') {
      const isShiftPressed = event.evt instanceof MouseEvent && event.evt.shiftKey;
      const firstPoint = scaleDraftPoints.length === 1 ? scaleDraftPoints[0] : undefined;
      const nextPoint = isShiftPressed ? alignPointToAxis(worldPointer, firstPoint) : worldPointer;
      setScaleDraftPoints((prev) => {
        if (prev.length === 0) return [nextPoint];
        if (prev.length === 1) return [...prev, nextPoint];
        return [nextPoint];
      });
      return;
    }

    if (toolMode === 'room') {
      const isShiftPressed = event.evt instanceof MouseEvent && event.evt.shiftKey;
      const rawPoint = alignRoomPointWithClosingAssist(
        worldPointer,
        roomDraftPoints.length > 0 ? roomDraftPoints[roomDraftPoints.length - 1] : undefined,
        roomDraftPoints[0],
        isShiftPressed,
        roomDraftPoints.length === 3,
      );
      const nextPoint = maybeSnapPoint(rawPoint, roomSnapEnabled, pxPerCm, worldOrigin);
      setRoomDraftPoints((prev) => [...prev, nextPoint]);
      return;
    }
  };

  const handleStagePointerMove = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const pointer = event.target.getStage()?.getPointerPosition() ?? null;
    if (!pointer) {
      setHoverPoint(null);
      return;
    }

    if (panStartRef.current && event.evt instanceof MouseEvent) {
      const deltaX = pointer.x - panStartRef.current.x;
      const deltaY = pointer.y - panStartRef.current.y;
      if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
        panMovedRef.current = true;
      }
      panStartRef.current = pointer;
      setViewportOffset((prev) => ({
        x: prev.x + deltaX,
        y: prev.y + deltaY,
      }));
      return;
    }

    const worldPointer = toWorldPoint(pointer);

    if (toolMode === 'scale') {
      const isShiftPressed = event.evt instanceof MouseEvent && event.evt.shiftKey;
      const firstPoint = scaleDraftPoints.length === 1 ? scaleDraftPoints[0] : undefined;
      setHoverPoint(isShiftPressed ? alignPointToAxis(worldPointer, firstPoint) : worldPointer);
      return;
    }

    if (toolMode === 'room') {
      const isShiftPressed = event.evt instanceof MouseEvent && event.evt.shiftKey;
      const rawPoint = alignRoomPointWithClosingAssist(
        worldPointer,
        roomDraftPoints.length > 0 ? roomDraftPoints[roomDraftPoints.length - 1] : undefined,
        roomDraftPoints[0],
        isShiftPressed,
        roomDraftPoints.length === 3,
      );
      setHoverPoint(maybeSnapPoint(rawPoint, roomSnapEnabled, pxPerCm, worldOrigin));
      return;
    }

    setHoverPoint(null);
  };

  const handleStageWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = event.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    if (!event.evt.ctrlKey && !event.evt.metaKey) {
      setViewportOffset((prev) => ({
        x: prev.x - event.evt.deltaX,
        y: prev.y - event.evt.deltaY,
      }));
      return;
    }

    const pointerWorld = toWorldPoint(pointer);
    const zoomRatio = event.evt.deltaY > 0 ? 0.9 : 1.1;
    const nextScale = clampZoom(viewportScale * zoomRatio);
    setViewportScale(nextScale);
    setViewportOffset({
      x: pointer.x - pointerWorld.x * nextScale,
      y: pointer.y - pointerWorld.y * nextScale,
    });
  };

  const handleFurnitureDragMove = (id: string, x: number, y: number, _nativeEvent: MouseEvent | TouchEvent) => {
    const furniture = furnitures.find((item) => item.id === id);
    if (!furniture) return;
    const size = getFurnitureRect(furniture, pxPerCm);
    updateFurniture(id, { x, y });

    setDragGuide({
      x,
      y,
      width: size.width,
      height: size.height,
    });
  };

  const handleFurnitureDragEnd = (id: string, x: number, y: number, nativeEvent: MouseEvent | TouchEvent) => {
    setDragGuide(null);
    const canSnap = furnitureSnapEnabled && shouldSnap(nativeEvent);
    updateFurniture(id, {
      x: maybeSnapAxis(x, canSnap, pxPerCm, worldOrigin.x),
      y: maybeSnapAxis(y, canSnap, pxPerCm, worldOrigin.y),
    });
  };

  const saveJSON = () => {
    const data: SavedLayoutDataV2 = {
      version: 5,
      scale,
      furnitures,
      roomZones,
      bgImage,
      background: background
        ? {
            x: background.x,
            y: background.y,
            widthCm: background.widthCm,
            heightCm: background.heightCm,
            opacity: background.opacity,
            displayScale: background.displayScale ?? 1,
          }
        : null,
      ui: {
        showGrid,
        furnitureSnapEnabled,
        roomSnapEnabled,
        showOpenSpace,
        viewportScale,
        viewportOffset,
      },
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'room-layout.json';
    anchor.click();
  };

  const loadJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const data = JSON.parse(loadEvent.target?.result as string) as SavedLayoutDataV2 & {
          bgConfig?: { x: number; y: number; opacity: number; width: number; height: number };
          bgRoomCalibration?: { widthCm: number; heightCm: number };
        };

        const nextScale = data.scale ?? DEFAULT_SCALE;
        const nextPxPerCm = nextScale.pixelLength / nextScale.realCm;
        const nextRoomZonesRaw = (data.roomZones ?? []).map((zone) => {
          const bounds = getPolygonBounds(zone.points);
          return {
            ...zone,
            x: zone.x ?? bounds.minX,
            y: zone.y ?? bounds.minY,
            widthCm: zone.widthCm ?? pxToCm(bounds.width, nextPxPerCm),
            depthCm: zone.depthCm ?? pxToCm(bounds.height, nextPxPerCm),
            rotation: zone.rotation ?? 0,
            shapeType: zone.shapeType ?? inferRoomZoneShapeType(zone.points),
            tatamiJo: zone.tatamiJo ?? null,
            locked: zone.locked ?? false,
          };
        });
        const roomIds = new Set<string>();
        const nextRoomZones = ensureUniqueIds(nextRoomZonesRaw, roomIds);
        const nextFurnituresRaw = (data.furnitures ?? []).map((item) => ({
          ...item,
          roomId: item.roomId ?? null,
          openSpace: item.openSpace
            ?? item.clearances
            ?? FURNITURE_PRESETS[item.type].openSpace
            ?? null,
          allowCornerPlacement: (item.isEquipment ?? isEquipmentType(item.type))
            ? true
            : (item.allowCornerPlacement ?? false),
          isEquipment: item.isEquipment ?? isEquipmentType(item.type),
          locked: item.locked ?? false,
        }));
        const nextFurnitures = ensureUniqueIds(nextFurnituresRaw, roomIds);
        let nextBackground: BackgroundState | null = null;
        let nextBgImage: string | null = data.bgImage ?? null;

        if (data.background) {
          nextBackground = {
            ...data.background,
            displayScale: data.background.displayScale ?? 1,
          };
        } else if (data.bgConfig) {
          const fallbackWidthCm = data.bgRoomCalibration?.widthCm ?? pxToCm(data.bgConfig.width, nextPxPerCm);
          const fallbackHeightCm = data.bgRoomCalibration?.heightCm ?? pxToCm(data.bgConfig.height, nextPxPerCm);
          nextBackground = {
            x: data.bgConfig.x,
            y: data.bgConfig.y,
            widthCm: fallbackWidthCm,
            heightCm: fallbackHeightCm,
            opacity: data.bgConfig.opacity,
            displayScale: 1,
          };
        }

        applySnapshot({
          scale: nextScale,
          furnitures: nextFurnitures,
          roomZones: nextRoomZones,
          bgImage: nextBgImage,
          background: nextBackground,
          ui: {
            showGrid: data.ui?.showGrid ?? true,
            showBackground: data.ui?.showBackground ?? true,
            furnitureSnapEnabled: data.ui?.furnitureSnapEnabled ?? false,
            roomSnapEnabled: data.ui?.roomSnapEnabled ?? false,
            showOpenSpace: data.ui?.showOpenSpace ?? data.ui?.showClearance ?? true,
            viewportScale: data.ui?.viewportScale ?? 1,
            viewportOffset: data.ui?.viewportOffset ?? { x: 0, y: 0 },
          },
        });
        setUndoStack([]);
        setRedoStack([]);
      } catch {
        alert('JSONの読み込みに失敗しました');
      }
    };

    reader.readAsText(file);
  };

  const roomDraftPreview = roomDraftPoints.length > 0
    ? [...roomDraftPoints, ...(hoverPoint ? [hoverPoint] : [])]
    : [];
  const scaleDraftPreview = scaleDraftPoints.length === 1 && hoverPoint
    ? [scaleDraftPoints[0], hoverPoint]
    : scaleDraftPoints;

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`panel ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="panel-header">
          <div className="panel-header-main">
            <div className="logo-mark">◧</div>
            {!sidebarCollapsed && (
              <div>
                <h1>Room Planner</h1>
                <p className="tagline">2D間取りエディタ</p>
              </div>
            )}
          </div>
          <button className="sidebar-toggle" onClick={() => setSidebarCollapsed((prev) => !prev)}>
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>

        {!sidebarCollapsed && (
          <>
            <CollapsibleSection id="guide" index="01" title="はじめに / ガイド" isOpen={openSections.guide} onToggle={toggleSection}>
              <p className="field-hint">必要なもの: 間取り図画像 + 縮尺を取るための長さが分かる部分（例: 部屋幅、ドア幅、図面上の記載寸法など）</p>
              <p className="field-hint">背景画像なしでも、Room Zoneの寸法入力だけでレイアウト作成できます。</p>
            </CollapsibleSection>

            <CollapsibleSection id="image" index="02" title="間取り図" isOpen={openSections.image} onToggle={toggleSection}>
              <button className="btn btn-outline" onClick={() => fileInputRef.current?.click()}>
                📁 画像をアップロード
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleBgUpload} hidden />
              {bgImage && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setBgImage(null);
                    setBackground(null);
                  }}
                >
                  ✕ 画像を削除
                </button>
              )}
            </CollapsibleSection>

            <CollapsibleSection id="scale" index="03" title="縮尺設定" isOpen={openSections.scale} onToggle={toggleSection}>
              <div className="hint-box">
                <span className="hint-label">現在の縮尺ソース</span>
                <span className="hint-val">
                  2点計測
                </span>
              </div>
              <div className="mode-row">
                <button
                  className={`btn ${toolMode === 'scale' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => activateMode(toolMode === 'scale' ? 'select' : 'scale')}
                >
                  {toolMode === 'scale' ? '縮尺モード終了' : '基準線を取る'}
                </button>
                {scaleDraftPoints.length > 0 && (
                  <button className="btn btn-outline" onClick={clearScaleDraft}>線をクリア</button>
                )}
              </div>
              <p className="field-hint">Canvas 上の2点をクリックして基準線を作り、実寸 cm を入れて縮尺を確定します。</p>
              <div className="hint-box">
                <span className="hint-label">計測ピクセル距離</span>
                <span className="hint-val">{measuredScalePx ? `${measuredScalePx.toFixed(1)} px` : '未計測'}</span>
              </div>
              <div className="input-group">
                <label>実寸 (cm)</label>
                <input type="number" min={1} value={scaleRealCmInput} onChange={(e) => setScaleRealCmInput(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={applyScaleFromDraft}>この基準線で縮尺を適用</button>
            </CollapsibleSection>

            <CollapsibleSection id="background" index="04" title="間取り図調整" isOpen={openSections.background} onToggle={toggleSection}>
              {background ? (
                <>
                  <div className="hint-box">
                    <span className="hint-label">背景表示サイズ</span>
                    <span className="hint-val">{Math.round(backgroundWidthPx)}×{Math.round(backgroundHeightPx)} px</span>
                  </div>
                  <div className="dim-row">
                    <div className="input-group">
                      <label>X オフセット</label>
                      <input type="number" value={Math.round(background.x)} onChange={(e) => updateBackground({ x: Number(e.target.value) })} />
                    </div>
                    <div className="input-group">
                      <label>Y オフセット</label>
                      <input type="number" value={Math.round(background.y)} onChange={(e) => updateBackground({ y: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="nudge-grid">
                    <button className="btn btn-outline" onClick={() => nudgeBackground('x', -1)}>← 10cm</button>
                    <button className="btn btn-outline" onClick={() => nudgeBackground('x', 1)}>10cm →</button>
                    <button className="btn btn-outline" onClick={() => nudgeBackground('y', -1)}>↑ 10cm</button>
                    <button className="btn btn-outline" onClick={() => nudgeBackground('y', 1)}>10cm ↓</button>
                  </div>
                  <div className="input-group">
                    <label>背景の濃さ</label>
                    <input type="range" min={0.15} max={1} step={0.05} value={background.opacity} onChange={(e) => updateBackground({ opacity: Number(e.target.value) })} />
                  </div>
                  <button className="btn btn-outline" onClick={resetBackgroundFit}>中央にリセット</button>
                </>
              ) : (
                <p className="field-hint">背景画像をアップロードすると調整できます。</p>
              )}
            </CollapsibleSection>

            <CollapsibleSection id="room" index="05" title="Room Zone" isOpen={openSections.room} onToggle={toggleSection}>
              <div className="mode-row">
                <button
                  className={`btn ${toolMode === 'room' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => activateMode(toolMode === 'room' ? 'select' : 'room')}
                >
                  {toolMode === 'room' ? '部屋追加を終了' : '部屋追加モード'}
                </button>
                {toolMode === 'room' && <button className="btn btn-outline" onClick={cancelRoomDraft}>キャンセル</button>}
              </div>
              <div className="input-group">
                <label>部屋名</label>
                <input type="text" value={roomNameInput} onChange={(e) => setRoomNameInput(e.target.value)} placeholder="寝室 / キッチン" />
              </div>
              <div className="hint-box">
                <span className="hint-label">下書き頂点数</span>
                <span className="hint-val">{roomDraftPoints.length} 点</span>
              </div>
              <label className="checkbox-label">
                <input type="checkbox" checked={roomSnapEnabled} onChange={(e) => setRoomSnapEnabled(e.target.checked)} />
                <span>Room Zone を 10cm グリッドに吸着</span>
              </label>
              <p className="field-hint">複数点クリックで多角形を作成し、`Enter` で確定、`Esc` でキャンセルします。</p>
              <div className="placed-list">
                {roomZones.length === 0 ? (
                  <p className="field-hint">まだ Room Zone はありません。</p>
                ) : (
                  roomZones.map((zone) => (
                    <button
                      key={zone.id}
                      className={`placed-item ${zone.id === selectedRoomZoneId ? 'active' : ''}`}
                      onClick={() => setSelectedRoomZoneId(zone.id)}
                    >
                      <span className="placed-item-title">{zone.name}</span>
                      <span className="placed-item-meta">{zone.points.length} 頂点 / {(zone.locked ?? false) ? '🔒 ロック中' : '🔓 移動可'}</span>
                    </button>
                  ))
                )}
              </div>
            </CollapsibleSection>

            <CollapsibleSection id="add" index="06" title="オブジェクト追加" isOpen={openSections.add} onToggle={toggleSection}>
              <div className="mode-row">
                <button className={`btn ${addCategory === 'furniture' ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setAddCategory('furniture'); handleAddTypeChange(FURNITURE_TYPES[0]); }}>
                  家具
                </button>
                <button className={`btn ${addCategory === 'equipment' ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setAddCategory('equipment'); handleAddTypeChange(EQUIPMENT_TYPES[0]); }}>
                  設備オブジェクト
                </button>
                <button className={`btn ${addCategory === 'custom' ? 'btn-primary' : 'btn-outline'}`} onClick={() => { setAddCategory('custom'); handleAddTypeChange('custom'); }}>
                  カスタム
                </button>
              </div>
              <div className="furniture-grid">
                {((addCategory === 'furniture'
                  ? FURNITURE_TYPES
                  : addCategory === 'equipment'
                    ? EQUIPMENT_TYPES
                    : ['custom']) as FurnitureType[]).map((type) => (
                  <button
                    key={type}
                    className={`furniture-btn ${addType === type ? 'active' : ''}`}
                    style={{ '--f-color': FURNITURE_PRESETS[type].color } as React.CSSProperties}
                    onClick={() => handleAddTypeChange(type)}
                  >
                    <span className="f-emoji">{FURNITURE_PRESETS[type].emoji}</span>
                    <span className="f-name">{FURNITURE_PRESETS[type].label}</span>
                  </button>
                ))}
              </div>
              <div className="input-group">
                <label>寸法 (cm)</label>
                <input type="text" inputMode="numeric" value={newFurnitureSize} onChange={(e) => setNewFurnitureSize(e.target.value)} placeholder="150×100" />
              </div>
              <label className="checkbox-label">
                <input type="checkbox" checked={furnitureSnapEnabled} onChange={(e) => setFurnitureSnapEnabled(e.target.checked)} />
                <span>家具を 10cm グリッドに吸着</span>
              </label>
              {addCategory === 'custom' && (
                <div className="selected-card">
                  <div className="input-group">
                    <label>カスタム家具名</label>
                    <input type="text" value={customFurnitureName} onChange={(e) => setCustomFurnitureName(e.target.value)} />
                  </div>
                  <div className="dim-row">
                    <div className="input-group">
                      <label>幅 (cm)</label>
                      <input
                        type="number"
                        min={MIN_DIMENSION_CM}
                        value={customFurnitureWidthInput}
                        onChange={(e) => setCustomFurnitureWidthInput(e.target.value)}
                        onBlur={() => applyCustomDimensionInput('width', customFurnitureWidthInput)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') applyCustomDimensionInput('width', customFurnitureWidthInput);
                        }}
                      />
                    </div>
                    <div className="input-group">
                      <label>奥行き (cm)</label>
                      <input
                        type="number"
                        min={MIN_DIMENSION_CM}
                        value={customFurnitureDepthInput}
                        onChange={(e) => setCustomFurnitureDepthInput(e.target.value)}
                        onBlur={() => applyCustomDimensionInput('depth', customFurnitureDepthInput)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') applyCustomDimensionInput('depth', customFurnitureDepthInput);
                        }}
                      />
                    </div>
                  </div>
                  <div className="input-group">
                    <label>アイコン/絵文字 (任意)</label>
                    <input type="text" value={customFurnitureEmoji} onChange={(e) => setCustomFurnitureEmoji(e.target.value)} placeholder="📦" />
                  </div>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={customAllowCornerPlacement}
                      onChange={(e) => setCustomAllowCornerPlacement(e.target.checked)}
                    />
                    <span>角置きOK</span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={customOpenSpaceEnabled}
                      onChange={(e) => setCustomOpenSpaceEnabled(e.target.checked)}
                    />
                    <span>開閉スペースを設定する</span>
                  </label>
                  {customOpenSpaceEnabled && (
                    <div className="dim-row">
                      <div className="input-group">
                        <label>前 (cm)</label>
                        <input
                          type="number"
                          min={0}
                          value={customOpenFrontInput}
                          onChange={(e) => setCustomOpenFrontInput(e.target.value)}
                          onBlur={() => applyCustomOpenSpaceInput('front', customOpenFrontInput)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') applyCustomOpenSpaceInput('front', customOpenFrontInput);
                          }}
                        />
                      </div>
                      <div className="input-group">
                        <label>後 (cm)</label>
                        <input
                          type="number"
                          min={0}
                          value={customOpenBackInput}
                          onChange={(e) => setCustomOpenBackInput(e.target.value)}
                          onBlur={() => applyCustomOpenSpaceInput('back', customOpenBackInput)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') applyCustomOpenSpaceInput('back', customOpenBackInput);
                          }}
                        />
                      </div>
                      <div className="input-group">
                        <label>左 (cm)</label>
                        <input
                          type="number"
                          min={0}
                          value={customOpenLeftInput}
                          onChange={(e) => setCustomOpenLeftInput(e.target.value)}
                          onBlur={() => applyCustomOpenSpaceInput('left', customOpenLeftInput)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') applyCustomOpenSpaceInput('left', customOpenLeftInput);
                          }}
                        />
                      </div>
                      <div className="input-group">
                        <label>右 (cm)</label>
                        <input
                          type="number"
                          min={0}
                          value={customOpenRightInput}
                          onChange={(e) => setCustomOpenRightInput(e.target.value)}
                          onBlur={() => applyCustomOpenSpaceInput('right', customOpenRightInput)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') applyCustomOpenSpaceInput('right', customOpenRightInput);
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button className="btn btn-accent" onClick={addFurniture}>+ {FURNITURE_PRESETS[addType].label}を配置</button>
            </CollapsibleSection>

            <CollapsibleSection id="edit" index="07" title="選択中の編集" isOpen={openSections.edit} onToggle={toggleSection}>
              {selected ? (
                <div className="selected-card" style={{ borderColor: 'rgba(247, 201, 79, 0.85)' }}>
                  <div className="hint-box">
                    <span className="hint-label">選択中</span>
                    <span className="hint-val">{selected.isEquipment ? '設備オブジェクト' : '家具'}: {selected.label}</span>
                  </div>
                  <div className="input-group">
                    <label>表示名</label>
                    <input type="text" value={selected.label} onChange={(e) => updateSelectedLabel(e.target.value)} />
                  </div>
                  <div className="input-group">
                    <label>寸法 (cm)</label>
                    <input type="text" value={selectedSizeInput} onChange={(e) => applySelectedSizeInput(e.target.value)} placeholder="150×100" />
                  </div>
                  <div className="dim-row">
                    <div className="input-group">
                      <label>幅 (cm)</label>
                      <input type="number" min={MIN_DIMENSION_CM} value={selectedWidthInput} onChange={(e) => setSelectedWidthInput(e.target.value)} onBlur={() => applySelectedDimensionInput('widthCm', selectedWidthInput)} onKeyDown={(event) => { if (event.key === 'Enter') applySelectedDimensionInput('widthCm', selectedWidthInput); }} />
                    </div>
                    <div className="input-group">
                      <label>奥行き (cm)</label>
                      <input type="number" min={MIN_DIMENSION_CM} value={selectedDepthInput} onChange={(e) => setSelectedDepthInput(e.target.value)} onBlur={() => applySelectedDimensionInput('depthCm', selectedDepthInput)} onKeyDown={(event) => { if (event.key === 'Enter') applySelectedDimensionInput('depthCm', selectedDepthInput); }} />
                    </div>
                  </div>
                  <div className="hint-box"><span className="hint-label">所属Room Zone</span><span className="hint-val">{getZoneName(selected.roomId)}</span></div>
                  <div className="hint-box"><span className="hint-label">回転角度</span><span className="hint-val">{selected.rotation}°</span></div>
                  {furnitureDiagnostics.reasons.get(selected.id)?.map((reason) => (
                    <p key={`warn-${reason.message}`} className="field-hint" style={{ color: reason.level === 'warn' ? '#f7d57d' : '#ff97ac' }}>{reason.message}</p>
                  ))}
                  {furnitureDiagnostics.reasons.get(selected.id)?.length ? (
                    <p className="field-hint">この判定は入力寸法をもとにした目安です。最終判断は実測値で確認してください。</p>
                  ) : null}
                  <label className="checkbox-label">
                    <input type="checkbox" checked={Boolean(selected.openSpace)} onChange={(e) => toggleSelectedOpenSpaceEnabled(e.target.checked)} />
                    <span>開閉スペースを設定する</span>
                  </label>
                  {!selected.isEquipment && (
                    <label className="checkbox-label">
                      <input type="checkbox" checked={selected.allowCornerPlacement ?? false} onChange={(e) => toggleSelectedCornerPlacement(e.target.checked)} />
                      <span>角置きOK</span>
                    </label>
                  )}
                  <label className="checkbox-label">
                    <input type="checkbox" checked={selected.locked ?? false} onChange={(e) => toggleSelectedLock(e.target.checked)} />
                    <span>位置をロック</span>
                  </label>
                  {selected.openSpace && (
                    <div className="dim-row">
                      <div className="input-group"><label>前 (cm)</label><input type="number" min={0} value={selectedOpenFrontInput} onChange={(e) => setSelectedOpenFrontInput(e.target.value)} onBlur={() => applySelectedOpenSpaceInput('front', selectedOpenFrontInput)} onKeyDown={(event) => { if (event.key === 'Enter') applySelectedOpenSpaceInput('front', selectedOpenFrontInput); }} /></div>
                      <div className="input-group"><label>後 (cm)</label><input type="number" min={0} value={selectedOpenBackInput} onChange={(e) => setSelectedOpenBackInput(e.target.value)} onBlur={() => applySelectedOpenSpaceInput('back', selectedOpenBackInput)} onKeyDown={(event) => { if (event.key === 'Enter') applySelectedOpenSpaceInput('back', selectedOpenBackInput); }} /></div>
                      <div className="input-group"><label>左 (cm)</label><input type="number" min={0} value={selectedOpenLeftInput} onChange={(e) => setSelectedOpenLeftInput(e.target.value)} onBlur={() => applySelectedOpenSpaceInput('left', selectedOpenLeftInput)} onKeyDown={(event) => { if (event.key === 'Enter') applySelectedOpenSpaceInput('left', selectedOpenLeftInput); }} /></div>
                      <div className="input-group"><label>右 (cm)</label><input type="number" min={0} value={selectedOpenRightInput} onChange={(e) => setSelectedOpenRightInput(e.target.value)} onBlur={() => applySelectedOpenSpaceInput('right', selectedOpenRightInput)} onKeyDown={(event) => { if (event.key === 'Enter') applySelectedOpenSpaceInput('right', selectedOpenRightInput); }} /></div>
                    </div>
                  )}
                  <div className="action-row">
                    <button className="btn btn-outline" onClick={() => alignSelectedToWall('left')}>左に揃える</button>
                    <button className="btn btn-outline" onClick={() => alignSelectedToWall('right')}>右に揃える</button>
                  </div>
                  <div className="action-row">
                    <button className="btn btn-outline" onClick={() => alignSelectedToWall('top')}>上に揃える</button>
                    <button className="btn btn-outline" onClick={() => alignSelectedToWall('bottom')}>下に揃える</button>
                  </div>
                  <div className="action-row">
                    <button className="btn btn-outline" onClick={duplicateSelected}>複製 (Ctrl/Cmd + D)</button>
                  </div>
                  <div className="action-row">
                    <button className="btn btn-rotate" onClick={rotateSelected}>↻ 90°回転</button>
                    <button className="btn btn-danger" onClick={deleteSelected}>🗑 削除</button>
                  </div>
                </div>
              ) : selectedRoomZone ? (
                <div className="selected-card" style={{ borderColor: 'rgba(247, 201, 79, 0.85)' }}>
                  <div className="hint-box">
                    <span className="hint-label">選択中</span>
                    <span className="hint-val">Room Zone: {selectedRoomZone.name}</span>
                  </div>
                  <div className="input-group">
                    <label>部屋名</label>
                    <input type="text" value={selectedRoomZone.name} onChange={(e) => updateRoomZone(selectedRoomZone.id, { name: e.target.value })} />
                  </div>
                  <div className="hint-box">
                    <span className="hint-label">頂点数</span>
                    <span className="hint-val">{selectedRoomZone.points.length}</span>
                  </div>
                  <div className="dim-row">
                    <div className="input-group">
                      <label>幅 (cm)</label>
                      <input type="number" min={MIN_DIMENSION_CM} value={selectedRoomWidthInput} onChange={(event) => setSelectedRoomWidthInput(event.target.value)} onBlur={() => applyRoomDimensionInput(selectedRoomZone, 'widthCm', selectedRoomWidthInput)} onKeyDown={(event) => { if (event.key === 'Enter') applyRoomDimensionInput(selectedRoomZone, 'widthCm', selectedRoomWidthInput); }} />
                    </div>
                    <div className="input-group">
                      <label>奥行き (cm)</label>
                      <input type="number" min={MIN_DIMENSION_CM} value={selectedRoomDepthInput} onChange={(event) => setSelectedRoomDepthInput(event.target.value)} onBlur={() => applyRoomDimensionInput(selectedRoomZone, 'heightCm', selectedRoomDepthInput)} onKeyDown={(event) => { if (event.key === 'Enter') applyRoomDimensionInput(selectedRoomZone, 'heightCm', selectedRoomDepthInput); }} />
                    </div>
                  </div>
                  <div className="action-row">
                    <button className="btn btn-outline" onClick={focusSelectedRoomZone}>この部屋にフォーカス</button>
                    <button className="btn btn-danger" onClick={() => confirmDeleteRoomZone(selectedRoomZone.id)}>🗑 部屋を削除</button>
                  </div>
                </div>
              ) : (
                <p className="field-hint">編集するオブジェクトを選択してください。</p>
              )}
            </CollapsibleSection>

            <CollapsibleSection id="placed" index="08" title="配置済み一覧" isOpen={openSections.placed} onToggle={toggleSection}>
              {furnitures.length === 0 ? (
                <p className="field-hint">まだ家具はありません。</p>
              ) : (
                <div className="placed-list">
                  {furnitures.map((item) => (
                    <button
                      key={item.id}
                      className={`placed-item ${item.id === selectedId ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedId(item.id);
                        setSelectedRoomZoneId(null);
                      }}
                    >
                      <span className="placed-item-title">
                        {item.icon ?? FURNITURE_PRESETS[item.type].emoji} {item.label} {item.isEquipment ? '（設備）' : ''}
                      </span>
                      <span className="placed-item-meta">{formatDimensions(item.widthCm, item.depthCm)}cm / {getZoneName(item.roomId)}</span>
                      {furnitureDiagnostics.reasons.get(item.id)?.map((reason) => (
                        <span
                          key={`${item.id}-${reason.message}`}
                          className="placed-item-meta"
                          style={{ color: reason.level === 'warn' ? '#f7d57d' : '#ff8fa3' }}
                        >
                          {reason.message}
                        </span>
                      ))}
                    </button>
                  ))}
                </div>
              )}

            </CollapsibleSection>

            <CollapsibleSection id="data" index="09" title="データ管理" isOpen={openSections.data} onToggle={toggleSection}>
              <button className="btn btn-danger" onClick={createNewLayout}>🆕 新規作成（全消去）</button>
              <button className="btn btn-primary" onClick={saveJSON}>💾 JSONで保存</button>
              <button className="btn btn-outline" onClick={() => jsonInputRef.current?.click()}>📂 JSONを読み込み</button>
              <input ref={jsonInputRef} type="file" accept=".json" onChange={loadJSON} hidden />
            </CollapsibleSection>

            <CollapsibleSection id="debug" index="dbg" title="Debug" isOpen={openSections.debug && debugOpen} onToggle={() => { toggleSection('debug'); setDebugOpen((prev) => !prev); }}>
              <div className="debug-grid">
                <span>px/cm</span>
                <span>{pxPerCm.toFixed(3)}</span>
                <span>gridSizePx</span>
                <span>{gridSizePx.toFixed(3)}</span>
                <span>背景 px</span>
                <span>{background ? `${Math.round(backgroundWidthPx)}×${Math.round(backgroundHeightPx)}` : 'なし'}</span>
                <span>背景 cm</span>
                <span>{background ? `${background.widthCm}×${background.heightCm}` : 'なし'}</span>
                <span>origin</span>
                <span>{`${Math.round(worldOrigin.x)}, ${Math.round(worldOrigin.y)}`}</span>
              </div>
            </CollapsibleSection>
          </>
        )}

        <div className="panel-footer">
          <div className="count-badge">{furnitures.length}</div>
          <span>{sidebarCollapsed ? '' : '個のオブジェクトを配置中'}</span>
        </div>
      </aside>

      <main className="canvas-area">
        <div className="canvas-topbar">
          <span className="canvas-title">Floor Plan Canvas</span>
          <span className="canvas-dims">{CANVAS_W} × {CANVAS_H} px</span>
        </div>
        <div className="canvas-toolbar">
          <span className={`mode-chip ${toolMode === 'select' ? 'active' : ''}`}>選択</span>
          <span className={`mode-chip ${toolMode === 'scale' ? 'active' : ''}`}>縮尺取得</span>
          <span className={`mode-chip ${toolMode === 'room' ? 'active' : ''}`}>Room Zone作成</span>
          <span className="mode-chip active">現在: {modeLabel}</span>
          <span className="mode-chip">{pxPerCm.toFixed(3)} px/cm</span>
          <span className="mode-chip">Zoom {(viewportScale * 100).toFixed(0)}%</span>
          <label className="checkbox-label">
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
            <span>グリッド表示</span>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={showBackground} onChange={(e) => setShowBackground(e.target.checked)} />
            <span>背景表示</span>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={showOpenSpace} onChange={(e) => setShowOpenSpace(e.target.checked)} />
            <span>開閉スペース表示</span>
          </label>
          <div className="mode-row">
            <button className="btn btn-outline" onClick={undo} disabled={undoStack.length === 0}>Undo</button>
            <button className="btn btn-outline" onClick={redo} disabled={redoStack.length === 0}>Redo</button>
            <button className="btn btn-outline" onClick={() => zoomBy(0.9)}>−</button>
            <button className="btn btn-outline" onClick={() => zoomBy(1.1)}>＋</button>
            <button className="btn btn-outline" onClick={resetView}>100%</button>
            <button className="btn btn-outline" onClick={fitAllToView}>全体表示</button>
          </div>
        </div>
        <div className="canvas-wrapper">
          {isFirstGuideVisible && (
            <div className="help-panel" style={{ left: 20, right: 20, top: 20, position: 'absolute', zIndex: 5 }}>
              <div className="help-panel-head">
                <strong>はじめかた</strong>
                <button className="help-close" onClick={() => setGuideDismissed(true)}>閉じる</button>
              </div>
              <p>1. 間取り図をアップロード</p>
              <p>2. 縮尺を設定（長さが分かる部分を2点クリック）</p>
              <p>3. Room Zoneで部屋を作成</p>
              <p>4. 家具・設備オブジェクトを配置</p>
              <p>5. 重なり・はみ出し・開閉スペースを確認</p>
            </div>
          )}
          <Stage
            width={CANVAS_W}
            height={CANVAS_H}
            onMouseDown={handleStagePointerDown}
            onMouseMove={handleStagePointerMove}
            onTouchStart={handleStagePointerDown}
            onTouchMove={handleStagePointerMove}
            onWheel={handleStageWheel}
            onMouseUp={() => {
              if (panStartRef.current && !panMovedRef.current && toolMode === 'select') {
                setSelectedId(null);
                setSelectedRoomZoneId(null);
              }
              panStartRef.current = null;
              panMovedRef.current = false;
            }}
            onTouchEnd={() => {
              panStartRef.current = null;
              panMovedRef.current = false;
            }}
            onMouseLeave={() => {
              setHoverPoint(null);
              setDragGuide(null);
              panStartRef.current = null;
              panMovedRef.current = false;
            }}
          >
            <Layer>
              <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#161b28" />
              <Group x={viewportOffset.x} y={viewportOffset.y} scaleX={viewportScale} scaleY={viewportScale}>
                {showBackground && bgImage && background && (
                  <BackgroundImage
                    src={bgImage}
                    x={background.x}
                    y={background.y}
                    width={backgroundWidthPx}
                    height={backgroundHeightPx}
                    opacity={background.opacity}
                  />
                )}

                {showGrid && gridLines()}

                {roomZones.map((zone) => {
                  const zonePoints = getRoomZonePoints(zone, pxPerCm);
                  const center = getPolygonCenter(zonePoints);
                  return (
                    <Group
                      key={zone.id}
                      dataRole="room-zone"
                      draggable={false}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        setSelectedRoomZoneId(zone.id);
                        setSelectedId(null);
                      }}
                      onTap={(event) => {
                        event.cancelBubble = true;
                        setSelectedRoomZoneId(zone.id);
                        setSelectedId(null);
                      }}
                    >
                      <Line
                        points={flattenPoints(zonePoints)}
                        closed
                        fill={zone.color}
                        stroke={zone.id === selectedRoomZoneId ? '#f7c94f' : zone.color.replace('0.22', '0.85')}
                        strokeWidth={ROOM_ZONE_STROKE_WIDTH_PX}
                        shadowColor={zone.id === selectedRoomZoneId ? '#f7c94f' : 'transparent'}
                        shadowBlur={zone.id === selectedRoomZoneId ? 8 : 0}
                      />
                      <Text
                        x={center.x - 60}
                        y={center.y - 12}
                        width={120}
                        align="center"
                        text={zone.name}
                        fontSize={13}
                        fontFamily="'Noto Sans JP', sans-serif"
                        fill="rgba(255,255,255,0.95)"
                        listening={false}
                      />
                    </Group>
                  );
                })}

                {roomDraftPreview.length >= 2 && (
                  <>
                    <Line
                      points={flattenPoints(roomDraftPreview)}
                      closed={roomDraftPoints.length >= 3}
                      fill="rgba(247, 201, 79, 0.16)"
                      stroke="rgba(247, 201, 79, 0.95)"
                      strokeWidth={2}
                      dash={[8, 6]}
                    />
                    {roomDraftPoints.map((point) => (
                      <Circle key={`${point.x}-${point.y}`} x={point.x} y={point.y} radius={4} fill="#f7c94f" />
                    ))}
                  </>
                )}

                {scaleDraftPreview.length === 2 && (
                  <Line
                    points={flattenPoints(scaleDraftPreview)}
                    stroke="rgba(247, 201, 79, 0.95)"
                    strokeWidth={3}
                    dash={[10, 6]}
                  />
                )}

                {dragGuide && (
                  <>
                    <Rect
                      x={dragGuide.x}
                      y={dragGuide.y}
                      width={dragGuide.width}
                      height={dragGuide.height}
                      stroke="rgba(247, 201, 79, 0.85)"
                      strokeWidth={2}
                      dash={[6, 6]}
                    />
                    <Line points={[dragGuide.x, 0, dragGuide.x, CANVAS_H]} stroke="rgba(247, 201, 79, 0.24)" strokeWidth={1} />
                    <Line points={[0, dragGuide.y, CANVAS_W, dragGuide.y]} stroke="rgba(247, 201, 79, 0.24)" strokeWidth={1} />
                  </>
                )}

                {furnitures.map((item) => (
                  <FurnitureShape
                    key={item.id}
                    furniture={item}
                    pxPerCm={pxPerCm}
                    isSelected={item.id === selectedId}
                    showOpenSpace={showOpenSpace}
                    warningLevel={furnitureDiagnostics.levels.get(item.id) ?? 'none'}
                    isOpenSpaceBlocked={furnitureDiagnostics.openSpaceBlocked.has(item.id)}
                    isOpenSpaceOutOfRoom={furnitureDiagnostics.openSpaceOutOfRoom.has(item.id)}
                    roomName={getZoneName(item.roomId)}
                    draggable={toolMode === 'select' && !(item.locked ?? false)}
                    onSelect={() => {
                      setSelectedId(item.id);
                      setSelectedRoomZoneId(null);
                    }}
                    onDragStart={() => pushHistory()}
                    onDragMove={handleFurnitureDragMove}
                    onDragEnd={handleFurnitureDragEnd}
                  />
                ))}
              </Group>
            </Layer>
          </Stage>
          <div className="help-fab-wrap">
            {!helpExpanded ? (
              <button className="help-fab" onClick={() => setHelpExpanded(true)}>？ 操作ヘルプ</button>
            ) : (
              <div className="help-panel">
                <div className="help-panel-head">
                  <strong>操作ヘルプ</strong>
                  <button className="help-close" onClick={() => setHelpExpanded(false)}>閉じる</button>
                </div>
                <div className="help-section">
                  <h4>基本操作</h4>
                  <p>空白ドラッグ: 画面移動</p>
                  <p>ホイール: 画面移動</p>
                  <p><span className="key-badge">Ctrl / Cmd</span> + ホイール: ズーム</p>
                  <p><span className="key-badge">Ctrl / Cmd + Z</span>: 元に戻す</p>
                  <p><span className="key-badge">Ctrl / Cmd + Shift + Z</span>: やり直し</p>
                  <p><span className="key-badge">Ctrl / Cmd + D</span>: 家具を複製</p>
                  <p><span className="key-badge">B</span>: 背景表示 ON/OFF</p>
                  <p><span className="ui-badge">＋ / −</span>: ズーム</p>
                  <p><span className="ui-badge">100%</span>: 等倍</p>
                  <p><span className="ui-badge">全体表示</span>: 全体表示</p>
                  <p>自動保存: 有効（再読込で復元）</p>
                </div>
                <div className="help-section">
                  <h4>縮尺操作</h4>
                  <p>縮尺取得: 2点クリックで基準線</p>
                  <p><span className="key-badge">Shift</span>: 水平・垂直固定</p>
                  <p>実寸(cm): 長さ入力</p>
                  <p>縮尺適用: pxPerCm更新</p>
                </div>
                <div className="help-section">
                  <h4>Room Zone操作</h4>
                  <p>作成: 頂点クリックで追加</p>
                  <p><span className="key-badge">Shift</span>: 水平・垂直固定</p>
                  <p><span className="key-badge">Enter</span>: 確定</p>
                  <p><span className="key-badge">Esc</span>: キャンセル</p>
                  <p><span className="key-badge">Delete / Backspace</span>: 選択中Room Zone削除</p>
                  <p>この部屋にフォーカス: 部屋へズーム</p>
                </div>
                <div className="help-section">
                  <h4>家具操作</h4>
                  <p>家具ドラッグ: 移動</p>
                  <p>複製: 選択中家具のみ <span className="key-badge">Ctrl / Cmd + D</span></p>
                  <p>削除: 選択中家具のみ <span className="key-badge">Delete / Backspace</span></p>
                  <p><span className="key-badge">Alt</span> + ドラッグ終了: スナップ無効</p>
                  <p>グリッド吸着: ON/OFF</p>
                  <p>開閉スペース表示: ON/OFF</p>
                  <p>開閉スペース: 扉/引き出しの目安</p>
                  <p>赤枠: 配置警告</p>
                  <p>赤/黄警告: 配置の余裕目安</p>
                  <p>家具整列: 選択中家具を壁に揃える</p>
                  <p>重なり検知: 赤枠表示</p>
                  <p>90°回転: 選択中を回転</p>
                  <p>削除: 選択中を削除</p>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="canvas-hint">
          クリック: 選択 / 空白ドラッグ: 移動 / ?: 操作ヘルプ
        </div>
      </main>
    </div>
  );
}
