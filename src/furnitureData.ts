import type { FurnitureType } from './types';

export const FURNITURE_PRESETS: Record<FurnitureType, {
  label: string;
  widthCm: number;
  depthCm: number;
  color: string;
  emoji: string;
  openSpace?: { front: number; left: number; right: number; back: number };
}> = {
  bed: { label: 'ベッド', widthCm: 100, depthCm: 200, color: '#7C9EBF', emoji: '🛏' },
  fridge: { label: '冷蔵庫', widthCm: 60, depthCm: 65, color: '#8BC4A8', emoji: '🧊', openSpace: { front: 70, left: 0, right: 0, back: 0 } },
  desk: { label: 'デスク', widthCm: 120, depthCm: 60, color: '#C4A882', emoji: '🖥' },
  sofa: { label: 'ソファ', widthCm: 180, depthCm: 80, color: '#B89EC4', emoji: '🛋' },
  chest: { label: 'チェスト', widthCm: 80, depthCm: 45, color: '#9c8c78', emoji: '🗄️', openSpace: { front: 50, left: 0, right: 0, back: 0 } },
  dresser: { label: 'タンス', widthCm: 90, depthCm: 45, color: '#8f7b66', emoji: '🧺', openSpace: { front: 50, left: 0, right: 0, back: 0 } },
  washer: { label: '洗濯機', widthCm: 64, depthCm: 64, color: '#8ea5b7', emoji: '🧺' },
  drumWasher: { label: 'ドラム洗濯機', widthCm: 65, depthCm: 70, color: '#7f97ad', emoji: '🧼', openSpace: { front: 70, left: 0, right: 0, back: 0 } },
  shelf: { label: '収納棚', widthCm: 90, depthCm: 40, color: '#9aa38a', emoji: '🗂️', openSpace: { front: 60, left: 0, right: 0, back: 0 } },
  kitchen: { label: 'キッチン', widthCm: 240, depthCm: 65, color: '#7e8a97', emoji: '🍳' },
  washstand: { label: '洗面台', widthCm: 75, depthCm: 55, color: '#7d8f9c', emoji: '🪞' },
  laundrySpace: { label: '洗濯機置き場', widthCm: 80, depthCm: 65, color: '#6f889a', emoji: '🧺' },
  toilet: { label: 'トイレ', widthCm: 80, depthCm: 120, color: '#7f8fa3', emoji: '🚽' },
  bathtub: { label: '浴槽', widthCm: 160, depthCm: 70, color: '#6f8da8', emoji: '🛁' },
  door: { label: 'ドア', widthCm: 80, depthCm: 8, color: '#8b7b67', emoji: '🚪' },
  closet: { label: 'クローゼット', widthCm: 180, depthCm: 60, color: '#7f7d70', emoji: '🗄️' },
  window: { label: '窓', widthCm: 160, depthCm: 10, color: '#7aa0b8', emoji: '🪟' },
  aircon: { label: 'エアコン', widthCm: 90, depthCm: 25, color: '#7f96ac', emoji: '❄️' },
  outlet: { label: 'コンセント', widthCm: 12, depthCm: 5, color: '#888f99', emoji: '🔌' },
  pillar: { label: '柱', widthCm: 25, depthCm: 25, color: '#7e756c', emoji: '🧱' },
  beam: { label: '梁', widthCm: 180, depthCm: 20, color: '#746d66', emoji: '🪵' },
  custom: { label: 'カスタム', widthCm: 100, depthCm: 100, color: '#A2AAB8', emoji: '📦' },
};

export const FURNITURE_ICONS: Record<FurnitureType, (w: number, h: number) => string> = {
  bed: (w, h) => `
    <rect x="2" y="${h * 0.3}" width="${w - 4}" height="${h * 0.65}" rx="3" fill="#5a7fa8" opacity="0.6"/>
    <rect x="2" y="2" width="${w - 4}" height="${h * 0.35}" rx="3" fill="#4a6f98" opacity="0.8"/>
    <rect x="${w * 0.1}" y="${h * 0.05}" width="${w * 0.35}" height="${h * 0.22}" rx="4" fill="#c8d8e8" opacity="0.9"/>
    <rect x="${w * 0.55}" y="${h * 0.05}" width="${w * 0.35}" height="${h * 0.22}" rx="4" fill="#c8d8e8" opacity="0.9"/>
  `,
  fridge: (w, h) => `
    <rect x="2" y="2" width="${w - 4}" height="${h * 0.35}" rx="2" fill="#6aaa8a" opacity="0.7"/>
    <rect x="2" y="${h * 0.38}" width="${w - 4}" height="${h * 0.6}" rx="2" fill="#5a9a7a" opacity="0.7"/>
    <line x1="2" y1="${h * 0.36}" x2="${w - 2}" y2="${h * 0.36}" stroke="#fff" stroke-width="1.5"/>
    <rect x="${w * 0.65}" y="${h * 0.12}" width="${w * 0.08}" height="${h * 0.15}" rx="2" fill="#fff" opacity="0.7"/>
    <rect x="${w * 0.65}" y="${h * 0.5}" width="${w * 0.08}" height="${h * 0.2}" rx="2" fill="#fff" opacity="0.7"/>
  `,
  desk: (w, h) => `
    <rect x="2" y="2" width="${w - 4}" height="${h * 0.15}" rx="2" fill="#a08050" opacity="0.9"/>
    <rect x="2" y="${h * 0.18}" width="${w - 4}" height="${h * 0.78}" rx="2" fill="#b09060" opacity="0.6"/>
    <rect x="${w * 0.05}" y="${h * 0.25}" width="${w * 0.55}" height="${h * 0.5}" rx="2" fill="#d4b884" opacity="0.5"/>
    <rect x="${w * 0.65}" y="${h * 0.25}" width="${w * 0.28}" height="${h * 0.5}" rx="2" fill="#c8a870" opacity="0.5"/>
  `,
  sofa: (w, h) => `
    <rect x="2" y="${h * 0.4}" width="${w - 4}" height="${h * 0.55}" rx="4" fill="#9880b0" opacity="0.7"/>
    <rect x="2" y="${h * 0.1}" width="${w * 0.15}" height="${h * 0.85}" rx="4" fill="#8870a0" opacity="0.8"/>
    <rect x="${w - w * 0.15 - 2}" y="${h * 0.1}" width="${w * 0.15}" height="${h * 0.85}" rx="4" fill="#8870a0" opacity="0.8"/>
    <rect x="${w * 0.17}" y="${h * 0.05}" width="${w * 0.66}" height="${h * 0.4}" rx="4" fill="#b09cc8" opacity="0.7"/>
  `,
  chest: (w, h) => `
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="3" fill="#7f6c59" opacity="0.65"/>
    <line x1="${w * 0.12}" y1="${h * 0.28}" x2="${w * 0.88}" y2="${h * 0.28}" stroke="#f5e3c9" stroke-width="1.5"/>
    <line x1="${w * 0.12}" y1="${h * 0.52}" x2="${w * 0.88}" y2="${h * 0.52}" stroke="#f5e3c9" stroke-width="1.5"/>
  `,
  dresser: (w, h) => `
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="3" fill="#6f5d4e" opacity="0.68"/>
    <line x1="${w * 0.1}" y1="${h * 0.33}" x2="${w * 0.9}" y2="${h * 0.33}" stroke="#ead5b8" stroke-width="1.5"/>
    <line x1="${w * 0.1}" y1="${h * 0.66}" x2="${w * 0.9}" y2="${h * 0.66}" stroke="#ead5b8" stroke-width="1.5"/>
  `,
  washer: (w, h) => `
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="3" fill="#6a8397" opacity="0.72"/>
    <circle cx="${w * 0.5}" cy="${h * 0.55}" r="${Math.min(w, h) * 0.22}" fill="#cfdce7" opacity="0.9"/>
    <circle cx="${w * 0.5}" cy="${h * 0.55}" r="${Math.min(w, h) * 0.14}" fill="#90a9bd" opacity="0.9"/>
  `,
  drumWasher: (w, h) => `
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="3" fill="#5f788d" opacity="0.74"/>
    <circle cx="${w * 0.5}" cy="${h * 0.55}" r="${Math.min(w, h) * 0.24}" fill="#d6e2ec" opacity="0.92"/>
    <circle cx="${w * 0.5}" cy="${h * 0.55}" r="${Math.min(w, h) * 0.15}" fill="#8ea6ba" opacity="0.95"/>
    <rect x="${w * 0.15}" y="${h * 0.12}" width="${w * 0.7}" height="${h * 0.1}" rx="2" fill="#d9e4ef" opacity="0.85"/>
  `,
  shelf: (w, h) => `
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="2" fill="#7f8b70" opacity="0.7"/>
    <line x1="2" y1="${h * 0.33}" x2="${w - 2}" y2="${h * 0.33}" stroke="#d8e2c6" stroke-width="1.5"/>
    <line x1="2" y1="${h * 0.66}" x2="${w - 2}" y2="${h * 0.66}" stroke="#d8e2c6" stroke-width="1.5"/>
  `,
  kitchen: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="3" fill="#6f7f8d" opacity="0.72"/>`,
  washstand: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="3" fill="#708896" opacity="0.72"/>`,
  laundrySpace: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="3" fill="#667f90" opacity="0.7"/>`,
  toilet: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="10" fill="#7c8ea2" opacity="0.74"/>`,
  bathtub: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="10" fill="#6d89a3" opacity="0.74"/>`,
  door: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="2" fill="#8b7b67" opacity="0.8"/>`,
  closet: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="2" fill="#7b796d" opacity="0.76"/>`,
  window: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="2" fill="#6f95ad" opacity="0.72"/>`,
  aircon: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="3" fill="#7089a0" opacity="0.72"/>`,
  outlet: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="2" fill="#7f868f" opacity="0.75"/>`,
  pillar: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="2" fill="#766d63" opacity="0.76"/>`,
  beam: (w, h) => `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="2" fill="#6f6861" opacity="0.76"/>`,
  custom: (w, h) => `
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="4" fill="#8e99ac" opacity="0.75"/>
    <rect x="${w * 0.1}" y="${h * 0.1}" width="${w * 0.8}" height="${h * 0.25}" rx="3" fill="#b4becf" opacity="0.85"/>
  `,
};
