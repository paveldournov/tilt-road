import {
  road,
  treasure,
  TREASURE_START,
  TREASURE_SPACING,
  random,
  type GameState,
  type Scenery,
  type Topology,
} from './core';
type V = { x: number; y: number; z: number };
type Face = { points: V[]; color: string };
const palettes = {
  coast: {
    sky: '#193d50',
    horizon: '#f7b79a',
    ground: '#315e65',
    terrain: '#244c55',
    light: '#4a7374',
    road: '#24323c',
    stripe: '#72eed7',
    fog: '#bdaca0',
    sun: '#ffe0b0',
  },
  desert: {
    sky: '#593e57',
    horizon: '#f8b36f',
    ground: '#995c4a',
    terrain: '#784744',
    light: '#b17a59',
    road: '#3d333c',
    stripe: '#ffdd8b',
    fog: '#c38b70',
    sun: '#ffe9bc',
  },
  night: {
    sky: '#070d23',
    horizon: '#303965',
    ground: '#111c35',
    terrain: '#17243d',
    light: '#263958',
    road: '#101c30',
    stripe: '#66e8f1',
    fog: '#202e50',
    sun: '#bbcffa',
  },
};

/** Lightweight software 3D renderer: world-space track, near clipping and depth ordering. */
export class RoadRenderer {
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private observer: ResizeObserver;
  private cam: V = { x: 0, y: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private focal = 600;
  private faces: Face[] = [];
  private roadFrames = new Map<
    number,
    { x: number; y: number; bank: number; cos: number; sin: number }
  >();
  private rotation = { cy: 1, sy: 0, cp: 1, sp: 0, cr: 1, sr: 0 };
  private fogColors = new Map<string, string>();
  private fogScenery: Scenery | null = null;
  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas unavailable');
    this.ctx = ctx;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }
  private resize() {
    const b = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, b.width);
    this.height = Math.max(1, b.height);
    // Bound raster work on large/Retina windows; layout stays in CSS pixels.
    const d = Math.min(
      window.devicePixelRatio || 1,
      1.5,
      Math.sqrt(1_920_000 / (this.width * this.height)),
    );
    this.canvas.width = Math.round(this.width * d);
    this.canvas.height = Math.round(this.height * d);
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  private point(s: number, x: number, y: number, mode: Topology): V {
    let c = this.roadFrames.get(s);
    if (!c) {
      const center = road(s, mode),
        next = road(s + 0.5, mode);
      const a = Math.atan2(next.x - center.x, 0.5);
      c = { ...center, cos: Math.cos(a), sin: Math.sin(a) };
      this.roadFrames.set(s, c);
    }
    return {
      x: c.x + x * c.cos,
      y: c.y + y + x * c.bank,
      z: s - x * c.sin,
    };
  }
  private view(v: V): V {
    const x = v.x - this.cam.x,
      y = v.y - this.cam.y,
      z = v.z - this.cam.z;
    const { cy, sy, cp, sp, cr, sr } = this.rotation;
    const rx = x * cy - z * sy,
      rz = x * sy + z * cy;
    const ry = y * cp - rz * sp,
      zz = y * sp + rz * cp;
    return {
      x: rx * cr - ry * sr,
      y: rx * sr + ry * cr,
      z: zz,
    };
  }
  private fogColor(color: string, fog: string, depth: number) {
    const level = Math.round(
      Math.min(0.98, Math.max(0, (depth - 130) / 780)) * 64,
    );
    if (!level) return color;
    const key = `${color}:${level}`;
    let mixed = this.fogColors.get(key);
    if (!mixed) {
      const base = parseInt(color.slice(1), 16),
        target = parseInt(fog.slice(1), 16);
      const alpha = level / 64;
      const channels = [16, 8, 0].map((shift) =>
        Math.round(
          ((base >> shift) & 255) * (1 - alpha) +
            ((target >> shift) & 255) * alpha,
        ),
      );
      mixed = `rgb(${channels.join(',')})`;
      this.fogColors.set(key, mixed);
    }
    return mixed;
  }
  private polygon(points: V[], color: string) {
    this.faces.push({ points, color });
  }
  private quad(
    s: number,
    end: number,
    x1: number,
    x2: number,
    y1: number,
    y2: number,
    mode: Topology,
    color: string,
  ) {
    this.polygon(
      [
        this.point(s, x1, y1, mode),
        this.point(end, x1, y1, mode),
        this.point(end, x2, y2, mode),
        this.point(s, x2, y2, mode),
      ],
      color,
    );
  }
  private box(
    s: number,
    x: number,
    width: number,
    height: number,
    depth: number,
    mode: Topology,
    color: string,
    top: string,
    base = 0,
  ) {
    const v = [
        this.point(s - depth / 2, x - width / 2, base, mode),
        this.point(s - depth / 2, x + width / 2, base, mode),
        this.point(s + depth / 2, x + width / 2, base, mode),
        this.point(s + depth / 2, x - width / 2, base, mode),
      ],
      h = v.map((q) => ({ ...q, y: q.y + height }));
    this.polygon([v[0], v[1], h[1], h[0]], color);
    this.polygon([v[1], v[2], h[2], h[1]], color);
    this.polygon([v[3], v[0], h[0], h[3]], color);
    this.polygon(h, top);
  }
  render(state: GameState, scenery: Scenery, time: number) {
    this.roadFrames.clear();
    if (this.fogScenery !== scenery) {
      this.fogColors.clear();
      this.fogScenery = scenery;
    }
    const ctx = this.ctx,
      w = this.width,
      h = this.height,
      p = palettes[scenery],
      mode = state.topology,
      s = state.distance;
    // Fixed vertical field of view keeps the deck visible on ultrawide displays.
    this.focal = h * 0.95;
    const c = road(s, mode),
      ahead = road(s + 2, mode);
    this.yaw = Math.atan2(ahead.x - c.x, 2);
    this.pitch = Math.atan2(ahead.y - c.y, 2) - 0.025 - state.pitch * 0.025;
    this.roll = -state.roll * 0.07 - c.bank * 0.3;
    this.rotation = {
      cy: Math.cos(this.yaw),
      sy: Math.sin(this.yaw),
      cp: Math.cos(this.pitch),
      sp: Math.sin(this.pitch),
      cr: Math.cos(this.roll),
      sr: Math.sin(this.roll),
    };
    this.cam = this.point(
      s,
      state.lateral,
      3.3 + Math.sin(time * 1.5) * 0.025,
      mode,
    );
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, p.sky);
    sky.addColorStop(0.72, p.horizon);
    sky.addColorStop(1, p.ground);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(
      w * 0.72 - Math.sin(this.yaw) * w * 0.16,
      h * 0.35 + this.pitch * h * 0.6,
    );
    ctx.fillStyle = p.sun;
    ctx.shadowColor = p.sun;
    ctx.shadowBlur = 55;
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(w, h) * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (scenery === 'night') {
      ctx.fillStyle = '#d8e5ff';
      for (let i = 0; i < 80; i++) {
        ctx.globalAlpha = 0.2 + random(i + 600) * 0.6;
        ctx.fillRect(random(i + 42) * w, random(i + 82) * h * 0.42, 1.4, 1.4);
      }
      ctx.globalAlpha = 1;
    }
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = [p.fog, p.light, p.terrain][layer];
      ctx.globalAlpha = 0.5 + layer * 0.16;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = -1; i <= 30; i++) {
        const x = (i / 28) * w,
          y =
            h * (0.51 + layer * 0.035) -
            (Math.sin(i * 0.57 + layer * 2.1 + this.yaw) * 0.5 +
              random(i + layer * 44) * 0.5) *
              h *
              (0.07 + layer * 0.025);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.faces = [];
    const start = Math.floor((s - 16) / 10) * 10;
    for (let z = start; z < s + 950; z += 10) {
      this.quad(z, z + 10, -1000, 1000, -3.5, -3.5, mode, p.ground);
      this.quad(z, z + 10, -9.35, 9.35, -0.24, -0.24, mode, '#142631');
      this.quad(
        z,
        z + 10,
        -9,
        9,
        0,
        0,
        mode,
        Math.floor(z / 10) % 2
          ? p.road
          : scenery === 'night'
            ? '#122035'
            : scenery === 'desert'
              ? '#40363e'
              : '#273740',
      );
      for (const side of [-1, 1]) {
        this.quad(
          z,
          z + 10,
          side * 8.75 - 0.1,
          side * 8.75 + 0.1,
          0.025,
          0.025,
          mode,
          p.stripe,
        );
        this.quad(
          z,
          z + 5.8,
          side * 3 - 0.035,
          side * 3 + 0.035,
          0.035,
          0.035,
          mode,
          scenery === 'night' ? '#536689' : '#6b7c7d',
        );
        if (z % 40 === 0)
          this.box(z, side * 9.6, 0.12, 1.1, 0.12, mode, p.stripe, '#e1ffef');
      }
    }
    const first = Math.max(
      0,
      Math.floor((s - 10 - TREASURE_START) / TREASURE_SPACING),
    );
    for (let i = first; i < first + 21; i++) {
      if (i === state.lastCollected) continue;
      const gem = treasure(i);
      if (gem.s > s + 920) continue;
      const center = this.point(
        gem.s,
        gem.x,
        2.3 + Math.sin(time * 2 + i) * 0.15,
        mode,
      );
      const top = { ...center, y: center.y + 1.6 };
      const bottom = { ...center, y: center.y - 1.6 };
      const ring = Array.from({ length: 4 }, (_, side) => {
        const angle = time * 0.9 + (side * Math.PI) / 2;
        return {
          x: center.x + Math.cos(angle) * gem.radius,
          y: center.y,
          z: center.z + Math.sin(angle) * gem.radius,
        };
      });
      const gold = ['#ffdf79', '#ffeeb5', '#e8a635', '#f9c451'];
      for (let side = 0; side < 4; side++) {
        this.polygon([top, ring[side], ring[(side + 1) % 4]], gold[side]);
        this.polygon(
          [bottom, ring[(side + 1) % 4], ring[side]],
          gold[(side + 2) % 4],
        );
      }
    }
    for (let i = Math.floor((s - 50) / 35); i < Math.floor(s / 35) + 27; i++)
      for (const side of [-1, 1]) {
        const z = i * 35 + random(i + side) * 15,
          x = side * (23 + random(i * 3 + side) * 90),
          tall = 12 + random(i + 400) * 55;
        if (scenery === 'night') {
          this.box(
            z,
            x,
            7 + random(i) * 12,
            tall,
            10,
            mode,
            '#18263d',
            '#324663',
            -3,
          );
          this.box(
            z - 5.1,
            x,
            0.15,
            tall * 0.8,
            0.1,
            mode,
            i % 3 ? '#64bfc9' : '#ad7dad',
            '#b4edee',
            -2,
          );
        } else {
          const b = this.point(z, x, -3.3, mode),
            size = 9 + random(i + 60) * 17,
            tip = { x: b.x + size * 0.15, y: b.y + tall, z: b.z },
            a = { x: b.x - size, y: b.y, z: b.z - size },
            d = { x: b.x + size, y: b.y, z: b.z - size },
            e = { x: b.x, y: b.y, z: b.z + size };
          this.polygon([a, d, tip], p.terrain);
          this.polygon([d, e, tip], p.light);
          this.polygon([e, a, tip], p.terrain);
          if (scenery === 'coast' && i % 2 === 0) {
            const t = this.point(
              z + 15,
              side * (14 + random(i) * 7),
              -2.5,
              mode,
            );
            for (let n = 0; n < 3; n++) {
              const r = 3.3 - n * 0.7,
                y = n * 2;
              this.polygon(
                [
                  { x: t.x - r, y: t.y + y, z: t.z },
                  { x: t.x + r, y: t.y + y, z: t.z },
                  { x: t.x, y: t.y + y + 5, z: t.z },
                ],
                n % 2 ? '#244e4c' : '#193f42',
              );
            }
          }
        }
      }
    const projected = this.faces
      .map((face) => {
        const points = face.points.map((v) => this.view(v));
        return {
          color: face.color,
          points,
          depth: points.reduce((sum, v) => sum + v.z, 0) / points.length,
        };
      })
      .filter((face) => face.points.some((v) => v.z >= 0.5))
      .sort((a, b) => b.depth - a.depth);
    for (const face of projected) {
      const clipped: V[] = [];
      for (let i = 0; i < face.points.length; i++) {
        const a = face.points[i],
          b = face.points[(i + 1) % face.points.length];
        if (a.z >= 0.5) clipped.push(a);
        if (a.z >= 0.5 !== b.z >= 0.5) {
          const t = (0.5 - a.z) / (b.z - a.z);
          clipped.push({
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: 0.5,
          });
        }
      }
      if (clipped.length < 3) continue;
      const coords = clipped.map((v) => ({
        x: w / 2 + (v.x / v.z) * this.focal,
        y: h * 0.49 - (v.y / v.z) * this.focal,
      }));
      if (
        coords.every((v) => v.x < 0) ||
        coords.every((v) => v.x > w) ||
        coords.every((v) => v.y < 0) ||
        coords.every((v) => v.y > h)
      )
        continue;
      ctx.beginPath();
      coords.forEach((v, i) =>
        i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y),
      );
      ctx.closePath();
      const depth = clipped.reduce((sum, v) => sum + v.z, 0) / clipped.length;
      // Mix opaque surface and fog once instead of rasterizing every face twice.
      ctx.fillStyle = this.fogColor(face.color, p.fog, depth);
      ctx.fill();
    }
    // Positive roll steers right: lower the right edge in Y-up space.
    // Screen projection then flips Y, matching the HUD's clockwise roll.
    const deck = (x: number, y: number, z: number) => ({
      x: w / 2 + (x / (z + 1.6)) * this.focal,
      y:
        h * 0.49 -
        ((y -
          x * Math.sin(state.roll * 0.38) +
          (z - 3) * Math.sin(state.pitch * 0.1)) /
          (z + 1.6)) *
          this.focal,
    });
    const deckPoly = (points: number[][], color: string, stroke?: string) => {
      ctx.beginPath();
      points.forEach(([x, y, z], i) => {
        const q = deck(x, y, z);
        if (i) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };
    deckPoly(
      [
        [-1.35, -1.9, 2.2],
        [1.35, -1.9, 2.2],
        [1.1, -1.9, 4.2],
        [0.8, -1.9, 4.65],
        [-0.8, -1.9, 4.65],
        [-1.1, -1.9, 4.2],
      ],
      '#101f2b',
      '#5ecbbb',
    );
    deckPoly(
      [
        [-0.88, -1.89, 2.3],
        [0.88, -1.89, 2.3],
        [0.65, -1.89, 4.2],
        [-0.65, -1.89, 4.2],
      ],
      '#233847',
    );
    deckPoly(
      [
        [-0.025, -1.87, 2.3],
        [0.025, -1.87, 2.3],
        [0.025, -1.87, 4.1],
        [-0.025, -1.87, 4.1],
      ],
      p.stripe,
    );
    if (state.pickupFlash > 0) {
      ctx.fillStyle = `rgba(255,215,100,${state.pickupFlash * 0.07})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
  dispose() {
    this.observer.disconnect();
  }
}
