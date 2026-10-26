// World geometry for THE_FORGE map. All values use world units.

import type { CoverBox, WorldConfig } from "./types.ts";

// The builder returns the symmetric hackathon map.
export function forgeWorld(): WorldConfig {
  const width = 24;
  const height = 16;
  const covers: CoverBox[] = [
    { minX: 6.5, minY: 3.5, maxX: 8.5, maxY: 5.5 },
    { minX: 15.5, minY: 3.5, maxX: 17.5, maxY: 5.5 },
    { minX: 6.5, minY: 10.5, maxX: 8.5, maxY: 12.5 },
    { minX: 15.5, minY: 10.5, maxX: 17.5, maxY: 12.5 },
  ];
  const control: CoverBox = {
    minX: width / 2 - 2,
    minY: height / 2 - 2,
    maxX: width / 2 + 2,
    maxY: height / 2 + 2,
  };
  return { width, height, covers, control, tickHz: 30, maxTicks: 2700 };
}

// The check returns true when the point sits inside the box.
export function pointInBox(x: number, y: number, box: CoverBox): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

// The check returns true when the circle touches the box.
export function circleHitsBox(
  x: number,
  y: number,
  radius: number,
  box: CoverBox,
): boolean {
  const cx = Math.min(Math.max(x, box.minX), box.maxX);
  const cy = Math.min(Math.max(y, box.minY), box.maxY);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

// Swept segment test. It blocks shots that cross a cover box.
export function segmentHitsBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  box: CoverBox,
): boolean {
  if (pointInBox(x1, y1, box) || pointInBox(x2, y2, box)) return true;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tmin = 0;
  let tmax = 1;
  if (dx === 0) {
    if (x1 < box.minX || x1 > box.maxX) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (box.minX - x1) * inv;
    let t2 = (box.maxX - x1) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (dy === 0) {
    if (y1 < box.minY || y1 > box.maxY) return false;
  } else {
    const inv = 1 / dy;
    let t1 = (box.minY - y1) * inv;
    let t2 = (box.maxY - y1) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}
