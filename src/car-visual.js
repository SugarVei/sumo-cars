import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 美式硬派越野精细 3D 车模（严格对齐 Cannon-es 物理底盘：车头朝 -Z，轮胎接地 y = -0.61，四轮轴距 ±1.02，轮距 ±0.79）
// 三款差异化美式越野车：
//   - dart    (疾风)：短轴宽体硬派越野（对标 Ford Bronco Raptor：圆形光环大灯、半敞篷全景防滚架、涉水喉、尾门外挂备胎）
//   - rumbler (悍将)：巴哈沙漠越野皮卡（对标 Ford F-150 Raptor Baja：倒C日行灯、三点琥珀灯、开放后斗防滚架与斜卧双备胎）
//   - bruiser (重锤)：超宽重装越野猛兽（对标 Ram 1500 TRX：机械增压引擎盖进气罩、巨型推土牛栏、高位双镀铬烟囱排气管）
const geometryCache = new Map();
const shellCache = new Map();
let sharedMaterials;
const vector = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function cached(key, create) {
  if (!geometryCache.has(key)) geometryCache.set(key, create());
  return geometryCache.get(key);
}

const box = (x, y, z) => cached(`box:${x}:${y}:${z}`, () => new THREE.BoxGeometry(x, y, z));
const rounded = (x, y, z, radius = 0.03, segments = 1) =>
  cached(`round:${x}:${y}:${z}:${radius}:${segments}`, () => new RoundedBoxGeometry(x, y, z, segments, radius));
const cylinder = (rTop, rBot, length, segments = 16) =>
  cached(`cyl:${rTop}:${rBot}:${length}:${segments}`, () => new THREE.CylinderGeometry(rTop, rBot, length, segments));
const torus = (radius, tube, radial = 6, tubular = 24, arc = TAU) =>
  cached(`torus:${radius}:${tube}:${radial}:${tubular}:${arc}`, () => new THREE.TorusGeometry(radius, tube, radial, tubular, arc));

/**
 * 侧面 2D 轮廓拉伸工具（车头在 -Z，车尾在 +Z）
 * 严格使用 rotateY(-Math.PI / 2)，确保 Shape 的 x 坐标直接映射为世界 z 坐标（-x -> -Z 车头, +x -> +Z 车尾），杜绝装反。
 */
function sideExtrude(points, width, bevel = 0.035) {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geo.center();
  geo.rotateY(-Math.PI / 2);
  return geo;
}

/** 正面 2D 轮廓拉伸（X-Y 平面拉伸至 Z 轴） */
function frontExtrude(points, depth, bevel = 0.025) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geo.center();
  return geo;
}

function tubePath(points, radius = 0.03, tubularSegments = 16, radialSegments = 6) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => vector(...p)));
  return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
}

function coilSpringGeo(height = 0.38, radius = 0.06, turns = 6, wireRadius = 0.015) {
  return cached(`coil:${height}:${radius}:${turns}:${wireRadius}`, () => {
    const pts = [];
    const steps = 42;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = t * turns * TAU;
      pts.push(vector(Math.cos(a) * radius, (t - 0.5) * height, Math.sin(a) * radius));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, wireRadius, 5, false);
  });
}

function quad(points, uvBounds = [0, 0, 1, 1]) {
  const [u0, v0, u1, v1] = uvBounds;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

function textureFromCanvas(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function batch() {
  const bins = new Map();
  return {
    add(key, geometry, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], disposeInput = false) {
      const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      if (!copy.attributes.uv) {
        copy.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(copy.attributes.position.count * 2), 2));
      }
      if (!copy.attributes.normal) copy.computeVertexNormals();
      copy.applyMatrix4(
        new THREE.Matrix4().compose(
          vector(...position),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
          vector(...scale),
        ),
      );
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(copy);
      if (disposeInput) geometry.dispose();
    },
    finish() {
      const result = new Map();
      for (const [key, geometries] of bins) {
        result.set(key, mergeGeometries(geometries, false));
        geometries.forEach((g) => g.dispose());
      }
      return result;
    },
  };
}

function materials() {
  if (sharedMaterials) return sharedMaterials;

  const tireMap = textureFromCanvas(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1c2026';
    ctx.fillRect(0, 0, w, h);
    for (let i = -1; i < 33; i++) {
      const x = i * 16;
      ctx.strokeStyle = '#0d1014';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 5, 16);
      ctx.lineTo(x + 9, 64);
      ctx.lineTo(x - 5, 112);
      ctx.stroke();
      ctx.strokeStyle = '#384049';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - 2, 16);
      ctx.lineTo(x + 12, 64);
      ctx.lineTo(x - 2, 112);
      ctx.stroke();
    }
    ctx.fillStyle = '#12161b';
    for (const y of [18, 44, 84, 110]) ctx.fillRect(0, y, w, 2);
  });
  tireMap.wrapS = THREE.RepeatWrapping;

  const hazardMap = textureFromCanvas(256, 256, (ctx, s) => {
    ctx.fillStyle = '#141720';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#ffaa1d';
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(-Math.PI / 4);
    for (let i = -s; i < s; i += 48) ctx.fillRect(i, -s, 24, s * 2);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let i = 0; i < 600; i++) ctx.fillRect((i * 73) % s, (i * 41) % s, 2, 2);
  });
  hazardMap.wrapS = hazardMap.wrapT = THREE.RepeatWrapping;

  const glowMap = textureFromCanvas(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,.86)');
    g.addColorStop(0.18, 'rgba(255,255,255,.45)');
    g.addColorStop(0.45, 'rgba(255,255,255,.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });

  const flameMap = textureFromCanvas(64, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(28,104,255,0)');
    g.addColorStop(0.3, 'rgba(40,178,255,.38)');
    g.addColorStop(0.68, 'rgba(119,239,255,.88)');
    g.addColorStop(1, 'rgba(248,255,255,.96)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  sharedMaterials = {
    trim: new THREE.MeshStandardMaterial({ color: 0x161b24, roughness: 0.78, metalness: 0.18 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x222834, roughness: 0.42, metalness: 0.72 }),
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x3b4454, roughness: 0.34, metalness: 0.82 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa8ba, roughness: 0.28, metalness: 0.88, envMapIntensity: 1.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe6eef8, roughness: 0.14, metalness: 0.95, envMapIntensity: 1.5 }),
    brake: new THREE.MeshStandardMaterial({ color: 0x67727d, roughness: 0.5, metalness: 0.85 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xe02430, roughness: 0.34, metalness: 0.38 }),
    towHook: new THREE.MeshStandardMaterial({ color: 0xff2c38, roughness: 0.32, metalness: 0.42 }),
    shock: new THREE.MeshStandardMaterial({ color: 0xff3b2f, roughness: 0.28, metalness: 0.48 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardMap, roughness: 0.46, metalness: 0.32 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1d2229, map: tireMap, bumpMap: tireMap, bumpScale: 0.018, roughness: 0.92, metalness: 0.04 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x18344c,
      emissive: 0x071728,
      emissiveIntensity: 0.3,
      metalness: 0.35,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.85,
      side: THREE.DoubleSide,
    }),
    stripe: new THREE.MeshPhysicalMaterial({
      color: 0xd9202f,
      metalness: 0.08,
      roughness: 0.32,
      clearcoat: 0.65,
      clearcoatRoughness: 0.14,
      envMapIntensity: 0.6,
      emissive: 0x390000,
      emissiveIntensity: 0.04,
      side: THREE.DoubleSide,
    }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xf7fbff, roughness: 0.14, metalness: 0.18, emissive: 0xdff2ff, emissiveIntensity: 1.55 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0xf02b2b, roughness: 0.2, metalness: 0.15, emissive: 0xff2222, emissiveIntensity: 1.35 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffa629, roughness: 0.22, metalness: 0.15, emissive: 0xff8008, emissiveIntensity: 1.4 }),
    cyanLed: new THREE.MeshStandardMaterial({ color: 0x38e8ff, roughness: 0.15, metalness: 0.2, emissive: 0x00d9ff, emissiveIntensity: 1.65 }),
    lampGlow: new THREE.SpriteMaterial({ map: glowMap, color: 0xfff0cc, opacity: 0.26, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    tailGlow: new THREE.SpriteMaterial({ map: glowMap, color: 0xff3628, opacity: 0.24, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    wheelGlow: new THREE.SpriteMaterial({ map: glowMap, color: 0x5be2ff, opacity: 0.52, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    playerRing: new THREE.MeshBasicMaterial({ color: 0xd8ff3e, transparent: true, opacity: 0.76, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false }),
    flame: new THREE.MeshBasicMaterial({ map: flameMap, color: 0xaff9ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false }),
    powerLine: new THREE.LineBasicMaterial({ color: 0xb8f7ff, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    powerGlow: new THREE.SpriteMaterial({ map: glowMap, color: 0x6bdfff, opacity: 0.5, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  };
  return sharedMaterials;
}

/**
 * 37 寸硬派越野泥地大胎 + 18 组交错凸起泥地咬地花纹块 + 6 辐防脱轮毂 + 12 颗镀铬螺栓
 * 半径 R = 0.39（与原物理接地高度 -0.22 - 0.39 = -0.61 严丝合缝）
 */
function buildMudWheelParts(parts, { radius = 0.39, width = 0.31, side = 1, offset = [0, 0, 0], rot = [0, 0, 0], includeRotor = true } = {}) {
  const local = batch();
  const rIn = radius * 0.54;
  const rOut = radius * 0.935;
  const hw = width * 0.5;

  // 1. 胎肩圆润的厚壁越野胎体
  const profile = [
    [rIn, -hw * 0.88],
    [rOut * 0.92, -hw],
    [rOut, -hw * 0.76],
    [rOut, hw * 0.76],
    [rOut * 0.92, hw],
    [rIn, hw * 0.88],
    [rIn, -hw * 0.88],
  ];
  const tire = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), 24);
  tire.rotateZ(Math.PI / 2);
  local.add('rubber', tire, [0, 0, 0], [0, 0, 0], [1, 1, 1], true);

  // 2. 18 组交错深咬地泥地胎块 + 胎肩侧牙
  const lugCount = 18;
  const lugGeo = box(width * 0.46, 0.044, radius * 0.22);
  const sideLugGeo = box(0.036, 0.06, radius * 0.14);
  const rLug = radius * 0.948;
  for (let i = 0; i < lugCount; i++) {
    const a = (i / lugCount) * TAU;
    const stagger = i % 2 === 0 ? 1 : -1;
    local.add('rubber', lugGeo, [stagger * width * 0.19, Math.cos(a) * rLug, Math.sin(a) * rLug], [a, 0, stagger * 0.15]);
    for (const s of [-1, 1]) {
      local.add('rubber', sideLugGeo, [s * (hw - 0.01), Math.cos(a + 0.14) * (radius * 0.83), Math.sin(a + 0.14) * (radius * 0.83)], [a + 0.14, 0, 0]);
    }
  }

  // 3. 深凹金属轮辋 + 6 辐越野轮辐 + 防脱压环 + 12 颗防脱螺栓
  const faceDir = side >= 0 ? 1 : -1;
  local.add('darkMetal', cylinder(rIn * 1.02, rIn * 1.02, width * 0.82, 20), [0, 0, 0], [0, 0, Math.PI / 2]);
  local.add('gunmetal', cylinder(rIn * 0.88, rIn * 0.7, width * 0.24, 18), [faceDir * hw * 0.56, 0, 0], [0, 0, Math.PI / 2]);

  const spokeGeo = box(0.04, rIn * 0.86, 0.058);
  for (let s = 0; s < 6; s++) {
    const a = (s / 6) * TAU;
    local.add('steel', spokeGeo, [faceDir * hw * 0.74, Math.cos(a) * rIn * 0.42, Math.sin(a) * rIn * 0.42], [a, 0, 0]);
  }
  local.add('chrome', cylinder(rIn * 0.29, rIn * 0.33, 0.07, 12), [faceDir * hw * 0.82, 0, 0], [0, 0, Math.PI / 2]);
  local.add('steel', torus(rIn * 0.97, 0.024, 6, 22), [faceDir * hw * 0.86, 0, 0], [0, Math.PI / 2, 0]);

  const boltGeo = cylinder(0.012, 0.012, 0.028, 6);
  for (let b = 0; b < 12; b++) {
    const a = (b / 12) * TAU;
    local.add('chrome', boltGeo, [faceDir * hw * 0.92, Math.cos(a) * rIn * 0.97, Math.sin(a) * rIn * 0.97], [0, 0, Math.PI / 2]);
  }

  if (includeRotor) {
    local.add('brake', cylinder(rIn * 0.78, rIn * 0.78, 0.028, 16), [-faceDir * hw * 0.16, 0, 0], [0, 0, Math.PI / 2]);
  }

  // 把局部轮胎变换合并到目标 batch（用于备胎或独立轮毂）
  for (const [k, geo] of local.finish()) {
    parts.add(k, geo, offset, rot, [1, 1, 1], true);
  }
}

function wheelGeometry(side) {
  return cached(`offroad-wheel:${side}`, () => {
    const parts = batch();
    buildMudWheelParts(parts, { radius: 0.39, width: 0.31, side, includeRotor: true });
    return parts.finish();
  });
}

function resolveClassId(options = {}) {
  if (options.classId && ['dart', 'rumbler', 'bruiser'].includes(options.classId)) return options.classId;
  const kits = options.kits || [];
  if (kits.includes('wing')) return 'dart';
  if (kits.includes('plow') || kits.includes('roof')) return 'bruiser';
  return 'rumbler';
}

/**
 * 构建三款美式硬派越野神车的合批车身几何体并永久缓存
 * 所有尺寸精确适配 Cannon-es 物理底盘（宽 ~1.83m，长 ~3.40m，轮心 (±0.79, -0.22, ±1.02)）
 */
function buildTruckShell(classId) {
  if (shellCache.has(classId)) return shellCache.get(classId);
  const parts = batch();

  const specs = {
    dart:    { bodyW: 1.44, frontZ: -1.56, rearZ: 1.48, railLen: 2.86, roofY: 0.90 },
    rumbler: { bodyW: 1.48, frontZ: -1.68, rearZ: 1.66, railLen: 3.12, roofY: 0.90 },
    bruiser: { bodyW: 1.58, frontZ: -1.70, rearZ: 1.68, railLen: 3.16, roofY: 0.92 },
  };
  const S = specs[classId] || specs.rumbler;
  const halfW = S.bodyW * 0.5;

  // =========================================================================
  // 1. 共有美式越野底盘骨架：大梁纵梁 + 传动轴 + 后桥差速器 + 铝制前护板 + 4角外露螺旋避震 + 侧踏板
  // =========================================================================
  for (const fx of [-0.34, 0.34]) {
    parts.add('darkMetal', box(0.10, 0.11, S.railLen), [fx, -0.18, 0]);
  }
  parts.add('gunmetal', cylinder(0.04, 0.04, S.railLen * 0.72, 8), [0, -0.24, 0], [Math.PI / 2, 0, 0]);
  parts.add('darkMetal', cylinder(0.05, 0.05, 1.44, 8), [0, -0.24, 1.02], [0, 0, Math.PI / 2]);
  parts.add('gunmetal', cached('diff-ball', () => new THREE.SphereGeometry(0.125, 10, 8)), [0, -0.24, 1.02]);

  // 高角度铝制越野前底护板（Skid Plate）
  parts.add('steel', box(0.84, 0.05, 0.62), [0, -0.18, S.frontZ + 0.25], [0.42, 0, 0]);

  // 四角外露红色螺旋避震弹簧 + 镀铬液压芯轴 + 上下控制摆臂
  const coilGeo = coilSpringGeo(0.38, 0.058, 6, 0.015);
  for (const side of [-1, 1]) {
    for (const wz of [-1.02, 1.02]) {
      const sx = side * 0.53;
      parts.add('shock', coilGeo, [sx, -0.02, wz], [0, 0, side * 0.18]);
      parts.add('chrome', cylinder(0.024, 0.024, 0.42, 8), [sx, -0.02, wz], [0, 0, side * 0.18]);
      for (const ay of [-0.11, -0.25]) {
        parts.add('darkMetal', box(0.46, 0.04, 0.10), [side * 0.44, ay, wz], [0, 0, side * -0.16]);
      }
    }
    // 两侧粗壮越野钢管防滚侧踏板（Rock Sliders）
    parts.add('darkMetal', cylinder(0.038, 0.038, 1.18, 10), [side * (halfW + 0.09), -0.12, 0], [Math.PI / 2, 0, 0]);
  }

  // 外扩宽体铆钉越野轮眉（4 个）+ 门把手 + 前翼子板散热鳃
  const flareGeo = sideExtrude(
    [
      [-0.45, -0.06], [-0.32, 0.22], [0.32, 0.22], [0.45, -0.06],
      [0.37, -0.08], [0.25, 0.13], [-0.25, 0.13], [-0.37, -0.08],
    ],
    0.18,
    0.018,
  );
  const rivetGeo = cylinder(0.011, 0.011, 0.02, 6);
  for (const wz of [-1.02, 1.02]) {
    for (const side of [-1, 1]) {
      parts.add('trim', flareGeo, [side * (halfW + 0.085), 0.08, wz]);
      for (const [dz, dy] of [[-0.31, 0.07], [-0.15, 0.16], [0, 0.17], [0.15, 0.16], [0.31, 0.07]]) {
        parts.add('chrome', rivetGeo, [side * (halfW + 0.175), 0.04 + dy, wz + dz], [0, 0, Math.PI / 2]);
      }
    }
  }
  flareGeo.dispose();

  for (const side of [-1, 1]) {
    parts.add('chrome', box(0.04, 0.04, 0.17), [side * (halfW + 0.015), 0.26, 0.12]);
    parts.add('trim', box(0.036, 0.14, 0.24), [side * (halfW + 0.01), 0.24, -0.52]);
  }

  // 辅助生成：双雨刮器、车顶 6 联 LED 射灯排、后视镜
  const addWipers = (yPos, zPos, tiltX) => {
    for (const wx of [-0.24, 0.18]) {
      parts.add('trim', box(0.30, 0.022, 0.022), [wx, yPos, zPos], [tiltX, 0, 0.11]);
    }
  };

  const addRoofLightBar = (yPos, zPos, barW) => {
    parts.add('trim', rounded(barW, 0.085, 0.11, 0.02), [0, yPos, zPos]);
    for (let i = 0; i < 6; i++) {
      const lx = -barW * 0.42 + (i / 5) * barW * 0.84;
      parts.add('headlight', box(barW * 0.12, 0.052, 0.03), [lx, yPos, zPos - 0.055]);
    }
    for (const bx of [-barW * 0.47, barW * 0.47]) {
      parts.add('darkMetal', box(0.036, 0.12, 0.08), [bx, yPos - 0.06, zPos + 0.02]);
    }
  };

  const addMirrors = (yPos, zPos) => {
    for (const side of [-1, 1]) {
      parts.add('trim', box(0.15, 0.04, 0.055), [side * (halfW - 0.01), yPos, zPos]);
      parts.add('paint', rounded(0.13, 0.11, 0.095, 0.025), [side * (halfW + 0.08), yPos + 0.02, zPos]);
      parts.add('glass', box(0.09, 0.075, 0.012), [side * (halfW + 0.085), yPos + 0.02, zPos + 0.05]);
    }
  };

  // =========================================================================
  // 2. 分车型精细美式硬表面车身雕塑
  // =========================================================================
  if (classId === 'dart') {
    /* -------------------- 疾风：Ford Bronco Raptor 福特烈马猛禽 -------------------- */
    const lowerGeo = sideExtrude(
      [[-1.50, -0.10], [1.44, -0.10], [1.42, 0.36], [-1.42, 0.36], [-1.54, 0.16]],
      S.bodyW - 0.07,
      0.04,
    );
    parts.add('paint', lowerGeo, [0, 0.14, -0.02], [0, 0, 0], [1, 1, 1], true);

    // 引擎盖隆起 + 双赛车拉花条纹
    parts.add('paint', rounded(0.76, 0.075, 0.86, 0.025), [0, 0.40, -1.04]);
    for (const sx of [-0.15, 0.15]) {
      parts.add('stripe', box(0.11, 0.016, 0.90), [sx, 0.442, -1.05]);
    }

    // 半敞篷硬顶前棚 + 实体复古直立前风挡框 + 清晰高反光前挡风玻璃 + 雨刮器
    parts.add('trim', rounded(S.bodyW - 0.18, 0.075, 0.78, 0.025), [0, 0.88, -0.10]);
    parts.add('paint', rounded(S.bodyW - 0.20, 0.48, 0.06, 0.02), [0, 0.63, -0.55], [0.26, 0, 0]);
    parts.add('glass', box(S.bodyW - 0.34, 0.38, 0.072), [0, 0.64, -0.56], [0.26, 0, 0]);
    addWipers(0.46, -0.63, 0.26);

    // 外露全景黑色钢管防滚架（从前风挡柱贯通至尾厢）
    for (const rx of [-0.58, 0.58]) {
      parts.add('darkMetal', tubePath([[rx, 0.36, -0.60], [rx, 0.87, -0.46], [rx, 0.87, 1.08], [rx, 0.36, 1.26]], 0.036, 18, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
      parts.add('darkMetal', tubePath([[rx, 0.87, 0.24], [rx, 0.36, 0.24]], 0.032, 8, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
      parts.add('darkMetal', tubePath([[rx, 0.84, 0.30], [rx, 0.38, 1.20]], 0.028, 10, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    }
    parts.add('darkMetal', tubePath([[-0.58, 0.87, 1.08], [0.58, 0.87, 1.08]], 0.034, 8, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);

    // 敞篷座舱内双运动桶椅 + 方向盘
    for (const sx of [-0.30, 0.30]) {
      parts.add('trim', rounded(0.32, 0.46, 0.14, 0.03), [sx, 0.54, 0.10], [-0.18, 0, 0]);
    }
    parts.add('darkMetal', torus(0.11, 0.018, 6, 14), [-0.30, 0.56, -0.34], [0.4, 0, 0]);

    // 右侧 A 柱高位涉水喉（Snorkel）
    parts.add('trim', tubePath([[0.71, 0.26, -0.76], [0.73, 0.40, -0.60], [0.68, 0.89, -0.46]], 0.038, 12, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);

    // 烈马标志性前脸：熏黑贯穿格栅 + 圆形 LED 光环大灯 + 琥珀横眉
    parts.add('trim', rounded(1.28, 0.32, 0.10, 0.02), [0, 0.18, -1.53]);
    for (const lx of [-0.47, 0.47]) {
      parts.add('headlight', torus(0.10, 0.022, 8, 18), [lx, 0.19, -1.59]);
      parts.add('headlight', cached('bronco-lamp-lens', () => new THREE.CircleGeometry(0.072, 14)), [lx, 0.19, -1.585], [0, Math.PI, 0]);
      parts.add('amber', box(0.17, 0.034, 0.04), [lx - Math.sign(lx) * 0.14, 0.19, -1.59]);
    }

    // 紧致钢管前杠 + 双红拖车钩
    parts.add('darkMetal', tubePath([[-0.70, -0.02, -1.55], [-0.34, -0.04, -1.66], [0.34, -0.04, -1.66], [0.70, -0.02, -1.55]], 0.044, 14, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    for (const hx of [-0.30, 0.30]) {
      parts.add('towHook', torus(0.048, 0.017, 6, 12), [hx, -0.09, -1.64]);
    }

    // 烈马灵魂车尾：尾门正中外挂全尺寸泥地备胎（严格在车尾 +Z！）
    buildMudWheelParts(parts, { radius: 0.35, width: 0.24, side: 1, offset: [0, 0.26, 1.62], rot: [0, Math.PI / 2, 0], includeRotor: false });
    for (const tx of [-0.60, 0.60]) {
      parts.add('taillight', rounded(0.12, 0.30, 0.08, 0.02), [tx, 0.22, 1.48]);
    }
    parts.add('darkMetal', rounded(1.44, 0.16, 0.18, 0.025), [0, -0.05, 1.50]);
    for (const ex of [-0.42, 0.42]) {
      parts.add('chrome', cylinder(0.055, 0.055, 0.22, 12), [ex, -0.14, 1.52], [Math.PI / 2, 0, 0]);
    }

    addRoofLightBar(0.95, -0.45, 1.06);
    addMirrors(0.52, -0.48);

  } else if (classId === 'rumbler') {
    /* -------------------- 悍将：Ford F-150 Raptor 巴哈沙漠皮卡 -------------------- */
    const lowerGeo = sideExtrude(
      [[-1.62, -0.10], [1.62, -0.10], [1.60, 0.35], [-1.52, 0.35], [-1.66, 0.16]],
      S.bodyW - 0.07,
      0.04,
    );
    parts.add('paint', lowerGeo, [0, 0.13, 0], [0, 0, 0], [1, 1, 1], true);

    // 肌肉引擎盖隆起 + 双黑色百叶散热口 + 双赛车拉花条纹
    parts.add('paint', rounded(0.78, 0.09, 0.94, 0.03), [0, 0.40, -1.06]);
    for (const vx of [-0.20, 0.20]) {
      parts.add('trim', box(0.22, 0.035, 0.32), [vx, 0.448, -1.10]);
    }
    for (const sx of [-0.16, 0.16]) {
      parts.add('stripe', box(0.12, 0.016, 0.98), [sx, 0.452, -1.10]);
      parts.add('stripe', box(0.12, 0.016, 0.76), [sx, 0.892, 0.03]);
    }

    // 雕塑驾驶室（-x 倾斜前风挡严格朝向车头 -Z，+x 垂直后背朝车尾 +Z！）
    const cabGeo = sideExtrude(
      [[-0.64, 0], [0.49, 0], [0.43, 0.48], [-0.34, 0.48]],
      S.bodyW - 0.24,
      0.035,
    );
    parts.add('paint', cabGeo, [0, 0.62, -0.04], [0, 0, 0], [1, 1, 1], true);

    // 清晰高反光倾斜前挡风玻璃 + 双雨刮器（贴合前斜坡外表面）
    parts.add('glass', box(S.bodyW - 0.33, 0.47, 0.045), [0, 0.63, -0.53], [0.56, 0, 0]);
    addWipers(0.45, -0.64, 0.56);

    // 后挡风与两侧车窗
    parts.add('glass', box(S.bodyW - 0.35, 0.35, 0.045), [0, 0.64, 0.47], [-0.11, 0, 0]);
    for (const side of [-1, 1]) {
      parts.add('glass', box(0.045, 0.33, 0.69), [side * (halfW - 0.095), 0.64, 0.03]);
    }

    // 开放式巴哈后斗内凹槽 + 钢管防滚架（位于车尾 z ∈ [0.56, 1.58]）
    parts.add('trim', box(1.14, 0.06, 0.98), [0, 0.33, 1.08]);
    for (const rx of [-0.54, 0.54]) {
      parts.add('darkMetal', tubePath([[rx, 0.34, 0.57], [rx, 0.84, 0.59], [rx, 0.38, 1.54]], 0.034, 14, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
      parts.add('darkMetal', tubePath([[rx, 0.62, 1.06], [rx, 0.34, 1.06]], 0.028, 6, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    }
    parts.add('darkMetal', tubePath([[-0.54, 0.84, 0.59], [0.54, 0.84, 0.59]], 0.034, 8, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    parts.add('darkMetal', tubePath([[-0.54, 0.62, 1.06], [0.54, 0.62, 1.06]], 0.028, 8, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);

    // 后斗内斜卧双全尺寸越野备胎（巴哈沙漠皮卡标志姿态，安稳斜卧车尾后斗！）
    for (const tx of [-0.31, 0.31]) {
      buildMudWheelParts(parts, { radius: 0.29, width: 0.21, side: 1, offset: [tx, 0.49, 1.12], rot: [0.34, 0, Math.PI / 2], includeRotor: false });
    }

    // 后斗外露红色氮气副筒避震塔
    for (const tx of [-0.46, 0.46]) {
      parts.add('shock', cylinder(0.042, 0.042, 0.38, 8), [tx, 0.48, 0.76], [-0.22, 0, 0]);
    }

    // 猛禽前脸：熏黑大中网 + 标志性 3 颗琥珀警示灯 + 倒 C 日行灯
    parts.add('trim', rounded(1.30, 0.32, 0.10, 0.02), [0, 0.18, -1.64]);
    for (const ax of [-0.18, 0, 0.18]) {
      parts.add('amber', box(0.08, 0.04, 0.045), [ax, 0.30, -1.69]);
    }
    for (const lx of [-0.57, 0.57]) {
      const s = Math.sign(lx);
      parts.add('headlight', box(0.17, 0.20, 0.06), [lx, 0.20, -1.68]);
      parts.add('amber', box(0.24, 0.044, 0.065), [lx - s * 0.03, 0.295, -1.685]);
      parts.add('amber', box(0.044, 0.18, 0.065), [lx + s * 0.07, 0.20, -1.685]);
    }

    // 巴哈钢管牛栏前杠 + 双红拖车钩
    parts.add('darkMetal', tubePath([[-0.72, -0.02, -1.63], [-0.38, -0.04, -1.75], [0.38, -0.04, -1.75], [0.72, -0.02, -1.63]], 0.046, 14, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    parts.add('darkMetal', tubePath([[-0.42, 0.04, -1.73], [-0.30, 0.21, -1.73], [0.30, 0.21, -1.73], [0.42, 0.04, -1.73]], 0.03, 12, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    for (const hx of [-0.32, 0.32]) {
      parts.add('towHook', torus(0.05, 0.018, 6, 12), [hx, -0.08, -1.72]);
    }

    // 车尾：熏黑尾门饰板 + 立体红光尾灯 + 钢后杠 + 双出镀铬粗排气管
    parts.add('trim', box(1.26, 0.20, 0.06), [0, 0.19, 1.64]);
    for (const tx of [-0.60, 0.60]) {
      parts.add('taillight', rounded(0.13, 0.27, 0.08, 0.02), [tx, 0.19, 1.65]);
    }
    parts.add('darkMetal', rounded(1.50, 0.16, 0.18, 0.025), [0, -0.05, 1.66]);
    for (const ex of [-0.42, 0.42]) {
      parts.add('chrome', cylinder(0.06, 0.06, 0.24, 12), [ex, -0.14, 1.68], [Math.PI / 2, 0, 0]);
    }

    addRoofLightBar(0.94, -0.36, 1.08);
    addMirrors(0.52, -0.44);

  } else {
    /* -------------------- 重锤：Ram 1500 TRX / 重装装甲越野猛兽 -------------------- */
    const lowerGeo = sideExtrude(
      [[-1.64, -0.12], [1.64, -0.12], [1.62, 0.39], [-1.58, 0.39], [-1.69, 0.18]],
      S.bodyW - 0.06,
      0.04,
    );
    parts.add('paint', lowerGeo, [0, 0.13, 0], [0, 0, 0], [1, 1, 1], true);

    // 机械增压引擎盖进气风罩（TRX Hood Scoop）+ 3 颗红色进气口灯 + 粗拉花
    const scoopGeo = frontExtrude([[-0.44, 0], [0.44, 0], [0.35, 0.15], [-0.35, 0.15]], 0.84, 0.022);
    parts.add('trim', scoopGeo, [0, 0.48, -1.08], [0, 0, 0], [1, 1, 1], true);
    for (const ax of [-0.15, 0, 0.15]) {
      parts.add('taillight', box(0.07, 0.036, 0.04), [ax, 0.51, -1.50]);
    }
    for (const sx of [-0.52, 0.52]) {
      parts.add('stripe', box(0.08, 0.015, 0.88), [sx, 0.415, -1.08]);
    }

    // 重装甲强悍驾驶室（-x 倾斜前风挡朝车头 -Z，+x 直立后背朝车尾 +Z）
    const cabGeo = sideExtrude(
      [[-0.65, 0], [0.51, 0], [0.47, 0.45], [-0.40, 0.45]],
      S.bodyW - 0.22,
      0.035,
    );
    parts.add('paint', cabGeo, [0, 0.64, -0.04], [0, 0, 0], [1, 1, 1], true);

    // 清晰装甲倾斜前挡风玻璃 + 双雨刮器
    parts.add('glass', box(S.bodyW - 0.32, 0.43, 0.045), [0, 0.65, -0.57], [0.48, 0, 0]);
    addWipers(0.47, -0.68, 0.48);

    parts.add('glass', box(S.bodyW - 0.35, 0.32, 0.045), [0, 0.66, 0.48]);
    for (const side of [-1, 1]) {
      parts.add('glass', box(0.045, 0.30, 0.76), [side * (halfW - 0.085), 0.65, 0.02]);
    }

    // 凶狠装甲前脸：细长怒目 LED 大灯 + 巨型钢制推土装甲牛栏防撞杠（Bull Bar）
    parts.add('trim', rounded(1.44, 0.34, 0.12, 0.02), [0, 0.20, -1.66]);
    for (const lx of [-0.58, 0.58]) {
      parts.add('headlight', box(0.26, 0.11, 0.06), [lx, 0.24, -1.71]);
      parts.add('amber', box(0.28, 0.036, 0.065), [lx, 0.31, -1.71]);
    }

    // 重型推土装甲牛栏前杠 + 双粗红拖车钩
    parts.add('darkMetal', rounded(1.68, 0.26, 0.24, 0.03), [0, -0.02, -1.74]);
    parts.add('darkMetal', tubePath([[-0.80, 0.08, -1.78], [-0.66, 0.38, -1.80], [0.66, 0.38, -1.80], [0.80, 0.08, -1.78]], 0.048, 16, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    for (const hx of [-0.40, 0.40]) {
      parts.add('towHook', torus(0.056, 0.02, 6, 12), [hx, -0.10, -1.84]);
    }

    // 驾驶室后方两侧高位粗壮卡车双镀铬烟囱排气管（Vertical Exhaust Stacks）
    for (const sx of [-0.66, 0.66]) {
      parts.add('chrome', cylinder(0.06, 0.065, 0.88, 12), [sx, 0.70, 0.65]);
      parts.add('trim', cylinder(0.08, 0.08, 0.46, 10), [sx, 0.62, 0.65]);
    }

    // 宽敞后斗底槽 + 水平斜卧重型越野大备胎（安稳卧在车尾后斗！）
    parts.add('trim', box(1.26, 0.06, 0.96), [0, 0.38, 1.14]);
    buildMudWheelParts(parts, { radius: 0.35, width: 0.22, side: 1, offset: [0, 0.51, 1.18], rot: [0.24, 0, Math.PI / 2], includeRotor: false });

    for (const tx of [-0.64, 0.64]) {
      parts.add('taillight', rounded(0.14, 0.30, 0.09, 0.02), [tx, 0.22, 1.67]);
    }
    parts.add('darkMetal', rounded(1.64, 0.20, 0.20, 0.03), [0, -0.05, 1.68]);

    addRoofLightBar(0.94, -0.41, 1.24);
    addMirrors(0.54, -0.46);
  }

  // =========================================================================
  // 3. 车门编号贴纸 & 车尾号牌（完美贴合两侧直立越野车门与后杠）
  // =========================================================================
  for (const side of [-1, 1]) {
    const x = side * (halfW + 0.008);
    const pts = side > 0
      ? [[x, 0.04, 0.30], [x, 0.04, -0.34], [x, 0.24, -0.34], [x, 0.24, 0.30]]
      : [[x, 0.04, -0.34], [x, 0.04, 0.30], [x, 0.24, 0.30], [x, 0.24, -0.34]];
    parts.add('decal', quad(pts, [0, 0.5, 1, 1]), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
  }
  const plateZ = S.rearZ + (classId === 'dart' ? 0.11 : 0.10);
  parts.add(
    'decal',
    quad([[-0.22, -0.11, plateZ], [0.22, -0.11, plateZ], [0.22, 0.01, plateZ], [-0.22, 0.01, plateZ]], [0, 0, 1, 0.5]),
    [0, 0, 0],
    [0, 0, 0],
    [1, 1, 1],
    true,
  );

  const built = parts.finish();
  shellCache.set(classId, built);
  return built;
}

function decalFor(name, number) {
  const displayNumber = String(number).padStart(2, '0');
  const map = textureFromCanvas(1024, 512, (ctx) => {
    ctx.fillStyle = '#fffdf7';
    ctx.beginPath();
    ctx.roundRect(14, 14, 996, 228, 30);
    ctx.fill();
    ctx.strokeStyle = '#0b0d15';
    ctx.lineWidth = 14;
    ctx.stroke();

    ctx.fillStyle = '#0b0d15';
    ctx.beginPath();
    ctx.roundRect(32, 32, 212, 192, 20);
    ctx.fill();

    ctx.fillStyle = '#d8ff3e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 136px Bahnschrift, "Segoe UI", Arial, sans-serif';
    ctx.fillText(displayNumber, 138, 134, 180);

    ctx.fillStyle = '#0b0d15';
    ctx.textAlign = 'left';
    ctx.font = '900 108px "Microsoft YaHei UI","PingFang SC","Noto Sans SC",sans-serif';
    ctx.fillText(String(name), 282, 126, 670);
    ctx.fillStyle = '#ff2e55';
    ctx.fillRect(280, 192, 668, 14);

    // 尾牌
    ctx.fillStyle = '#f3f5ec';
    ctx.beginPath();
    ctx.roundRect(10, 270, 1004, 228, 22);
    ctx.fill();
    ctx.strokeStyle = '#0b0d15';
    ctx.lineWidth = 14;
    ctx.strokeRect(24, 284, 976, 200);
    ctx.fillStyle = '#0b0d15';
    ctx.textAlign = 'center';
    ctx.font = '800 136px "Microsoft YaHei UI","PingFang SC","Noto Sans SC",sans-serif';
    ctx.fillText(`${name} · ${displayNumber}`, 512, 388, 895);
  });
  return new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    alphaTest: 0.15,
    roughness: 0.45,
    metalness: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
}

let underglowTexture;
function glowDisc() {
  if (underglowTexture) return underglowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  underglowTexture = new THREE.CanvasTexture(canvas);
  underglowTexture.colorSpace = THREE.SRGBColorSpace;
  return underglowTexture;
}

function makeMesh(geometry, material, name = '') {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = !material.transparent;
  return mesh;
}

/**
 * 4 款高精 3D 前杠机械武器（弹簧拳 / 抓钩拳 / 震荡锤 / 火箭拳）
 * 100% 保持原版动态伸缩、蓄力高亮、瞄准偏转及脱手飞拳契约
 */
function makePunch(shared, baseZ = -1.72) {
  const group = new THREE.Group();
  group.name = 'Offroad Bumper Weapon Rig';
  group.position.set(0, 0.04, baseZ);

  // 底座厚重钢制挂载架（始终固定在车头，杜绝浮空！）
  const mount = makeMesh(rounded(0.56, 0.24, 0.18, 0.03), shared.darkMetal, 'Weapon mount');
  mount.position.set(0, 0, 0.04);
  group.add(mount);

  const rod = makeMesh(cylinder(0.055, 0.055, 1, 10), shared.chrome, 'Telescopic chrome rod');
  rod.rotation.x = Math.PI / 2;
  group.add(rod);

  const springGeometry = cached('spring-coil-heavy', () => {
    const points = [];
    for (let i = 0; i <= 128; i++) {
      const t = i / 128;
      points.push(vector(Math.sin(t * TAU * 7) * 0.16, Math.cos(t * TAU * 7) * 0.16, -t));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.026, 5, false);
  });
  const spring = makeMesh(springGeometry, shared.chrome, 'Heavy steel coil');
  group.add(spring);

  const head = new THREE.Group();
  head.name = 'Weapon head';

  // 独立发光核心材质，支持蓄力红热闪烁
  const face = shared.stripe.clone();
  face.emissive.setHex(0xff3010);

  // 1. 弹簧重拳头（机械雕塑重拳 + 警戒腕环 + 4 指节护甲）
  const springKit = new THREE.Group();
  const springHeadParts = cached('punch-head-spring', () => {
    const p = batch();
    p.add('hazard', rounded(0.46, 0.28, 0.13, 0.02), [0, 0, 0.06]);
    p.add('face', frontExtrude([[-0.28, -0.17], [0.28, -0.17], [0.31, 0.13], [0.18, 0.22], [-0.18, 0.22], [-0.31, 0.13]], 0.24, 0.035), [0, 0.01, -0.14], [0, 0, 0], [1, 1, 1], true);
    p.add('darkMetal', box(0.42, 0.14, 0.08), [0, 0.17, -0.14]);
    p.add('darkMetal', rounded(0.12, 0.14, 0.18, 0.02), [-0.33, -0.06, -0.14]);
    for (let i = 0; i < 4; i++) {
      p.add('gunmetal', rounded(0.10, 0.19, 0.12, 0.02), [-0.18 + i * 0.12, 0.01, -0.28]);
      p.add('chrome', cylinder(0.024, 0.024, 0.04, 6), [-0.18 + i * 0.12, 0.06, -0.34], [Math.PI / 2, 0, 0]);
    }
    return p.finish();
  });
  for (const [k, geo] of springHeadParts) {
    const mesh = makeMesh(geo, k === 'face' ? face : shared[k]);
    mesh.castShadow = k === 'face';
    springKit.add(mesh);
  }

  // 2. 抓钩拳头（发光离子核心 + 3 爪钢铁抓钩）
  const hookKit = new THREE.Group();
  const hookHeadParts = cached('punch-head-hook', () => {
    const p = batch();
    p.add('chrome', cylinder(0.075, 0.095, 0.34, 12), [0, 0, -0.04], [Math.PI / 2, 0, 0]);
    p.add('cyanLed', cached('hook-core', () => new THREE.SphereGeometry(0.11, 10, 10)), [0, 0, -0.22]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + Math.PI / 6;
      const claw = tubePath([[0, 0.07, 0], [0, 0.28, -0.14], [0, 0.14, -0.38]], 0.034, 12, 6);
      p.add('steel', claw, [0, 0, -0.20], [0, 0, a], [1, 1, 1], true);
    }
    return p.finish();
  });
  for (const [k, geo] of hookHeadParts) {
    const mesh = makeMesh(geo, shared[k]);
    mesh.castShadow = k === 'steel';
    hookKit.add(mesh);
  }

  // 3. 震荡锤头（双粗液压推杆 + 宽幅黑黄警戒能量冲击锤板）
  const hammerKit = new THREE.Group();
  const hammerHeadParts = cached('punch-head-hammer', () => {
    const p = batch();
    for (const x of [-0.30, 0.30]) {
      p.add('chrome', cylinder(0.06, 0.06, 0.26, 10), [x, 0, 0.06], [Math.PI / 2, 0, 0]);
    }
    p.add('hazard', rounded(1.24, 0.38, 0.24, 0.04), [0, 0, -0.10]);
    p.add('amber', rounded(1.30, 0.12, 0.10, 0.025), [0, 0, -0.22]);
    p.add('face', box(0.96, 0.08, 0.04), [0, 0.16, -0.20]);
    return p.finish();
  });
  for (const [k, geo] of hammerHeadParts) {
    const mesh = makeMesh(geo, k === 'face' ? face : shared[k]);
    mesh.castShadow = k === 'hazard';
    hammerKit.add(mesh);
  }

  // 4. 火箭拳头（气动弹头 + 双尾翼 + 冰蓝离子尾喷口）
  const rocketKit = new THREE.Group();
  const rocketHeadParts = cached('punch-head-rocket', () => {
    const p = batch();
    p.add('face', cylinder(0.17, 0.21, 0.56, 16), [0, 0.02, -0.14], [Math.PI / 2, 0, 0]);
    p.add('darkMetal', cached('rocket-cone', () => new THREE.ConeGeometry(0.17, 0.30, 16)), [0, 0.02, -0.56], [-Math.PI / 2, 0, 0]);
    for (const s of [-1, 1]) {
      p.add('steel', rounded(0.28, 0.045, 0.24, 0.012), [s * 0.24, 0.02, 0.02], [0, s * 0.32, 0]);
    }
    p.add('cyanLed', cylinder(0.13, 0.10, 0.12, 12), [0, 0.02, 0.18], [Math.PI / 2, 0, 0]);
    return p.finish();
  });
  for (const [k, geo] of rocketHeadParts) {
    const mesh = makeMesh(geo, k === 'face' ? face : shared[k]);
    mesh.castShadow = k === 'face';
    rocketKit.add(mesh);
  }

  const kits = { spring: springKit, hook: hookKit, hammer: hammerKit, rocket: rocketKit };
  for (const kit of Object.values(kits)) {
    head.add(kit);
    kit.visible = false;
  }
  kits.spring.visible = true;

  let glove = 'spring';
  group.add(head);
  group.visible = false;

  return {
    group,
    head,
    face,
    setGlove(id) {
      glove = kits[id] ? id : 'spring';
      for (const [name, kit] of Object.entries(kits)) kit.visible = name === glove;
    },
    update(extension, angle = 0, charge = 0, heavy = 0, time = 0, showcase = false) {
      const amount = clamp(Number(extension) || 0, -0.1, 1.12);
      group.visible = showcase || glove !== 'spring' || charge > 0 || Math.abs(amount) > 0.008;
      group.rotation.y = charge > 0 ? 0 : -angle;
      group.position.z = baseZ + Math.max(0, -amount) * 1.1;
      const reach = glove === 'hook' ? 7.1 : glove === 'hammer' ? 1.3 : glove === 'rocket' ? 0.18 : 3.55;
      const length = charge > 0
        ? 0.42 - 0.28 * charge
        : showcase
          ? Math.max(0.22, 0.22 + amount * 0.55)
          : Math.max(0.14, 0.14 + amount * reach);
      face.emissiveIntensity = charge > 0 ? charge * (1.5 + 0.8 * Math.sin(time * 26)) : heavy && amount > 0 ? 1.8 : 0.12;
      rod.scale.y = length;
      rod.position.z = -length / 2;
      spring.visible = glove === 'spring';
      spring.scale.z = length;
      head.position.z = -length;
    },
  };
}

export function createCarVisual(color, isPlayer = false, driverName = '新星', driverNumber = 1, options = {}) {
  const classId = resolveClassId(options);
  const group = new THREE.Group();
  group.name = `${driverName} / ${classId}`;
  const bodyRig = new THREE.Group();
  bodyRig.name = 'Offroad suspension rig';
  group.add(bodyRig);

  const shared = materials();
  // 每辆车独立的清漆与强调色实例（保持击中闪光局部隔离，且让午夜黑也有丰富立体金属光泽）
  const baseColor = new THREE.Color(color);
  const lum = baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
  if (lum < 0.09) baseColor.lerp(new THREE.Color(0x283246), 0.55);

  const paint = new THREE.MeshPhysicalMaterial({
    color: baseColor,
    metalness: 0.36,
    roughness: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
    envMapIntensity: 1.35,
  });
  const stripeColor = new THREE.Color(options.stripe ?? 0xe3202f);
  const stripe = new THREE.MeshPhysicalMaterial({
    color: stripeColor,
    metalness: 0.12,
    roughness: 0.28,
    clearcoat: 0.75,
    clearcoatRoughness: 0.14,
    emissive: stripeColor,
    emissiveIntensity: 0.04,
    side: THREE.DoubleSide,
  });
  const shockColor = new THREE.Color(options.stripe ?? 0xff3b2f);
  if (shockColor.r + shockColor.g + shockColor.b < 0.35) shockColor.setHex(0xff4230);
  const shockMat = new THREE.MeshStandardMaterial({ color: shockColor, roughness: 0.28, metalness: 0.45 });

  const palette = {
    ...shared,
    paint,
    stripe,
    shock: shockMat,
    trim: shared.trim.clone(),
    glass: shared.glass.clone(),
    decal: decalFor(driverName, driverNumber),
  };
  const owned = [paint, stripe, shockMat, palette.trim, palette.glass, palette.decal];

  for (const [key, geometry] of buildTruckShell(classId)) {
    const mesh = makeMesh(geometry, palette[key], `Body / ${key}`);
    mesh.castShadow = key === 'paint' || key === 'darkMetal' || key === 'rubber';
    if (key === 'glass') {
      mesh.renderOrder = 2;
      mesh.castShadow = false;
    }
    if (key === 'decal') {
      mesh.renderOrder = 3;
      mesh.castShadow = false;
    }
    bodyRig.add(mesh);
  }

  // 四角 37 寸越野泥地大轮（与物理底盘完全对齐：y = -0.22，外径 0.78，触地 y = -0.61）
  const wheels = [];
  const steeringRigs = [];
  const glowSprites = [];
  for (const side of [-1, 1]) {
    for (const z of [-1.02, 1.02]) {
      const rear = z > 0;
      const steering = new THREE.Group();
      steering.name = `${side < 0 ? 'Left' : 'Right'} ${rear ? 'rear' : 'front'} hub carrier`;
      steering.position.set(side * 0.79, -0.22, z);
      group.add(steering);

      const wheel = new THREE.Group();
      wheel.name = 'Mud-terrain beadlock wheel';
      steering.add(wheel);
      wheel.userData.front = !rear;
      wheel.userData.steeringRig = steering;
      for (const [key, geometry] of wheelGeometry(side)) {
        const mesh = makeMesh(geometry, shared[key], `Wheel / ${key}`);
        mesh.castShadow = key === 'rubber';
        wheel.add(mesh);
      }

      // 鲜红固定刹车卡钳（附着于转向节，不随轮胎旋转）
      const caliper = makeMesh(rounded(0.068, 0.145, 0.105, 0.02), shared.caliper, 'Fixed red brake caliper');
      caliper.position.set(side * 0.075, 0.095, -0.115);
      caliper.rotation.x = -0.36;
      steering.add(caliper);

      wheels.push(wheel);
      if (!rear) steeringRigs.push(steering);

      const glow = new THREE.Sprite(shared.wheelGlow);
      glow.name = 'Soft wheel aura';
      glow.position.set(side * 0.96, -0.22, z);
      glow.scale.set(0.95, 0.95, 1);
      glow.visible = false;
      group.add(glow);
      glowSprites.push(glow);
    }
  }

  // 前后车灯光晕
  const frontLampZ = classId === 'dart' ? -1.61 : classId === 'bruiser' ? -1.73 : -1.70;
  const rearLampZ = classId === 'dart' ? 1.52 : 1.70;
  for (const side of [-1, 1]) {
    const front = new THREE.Sprite(shared.lampGlow);
    front.position.set(side * 0.54, 0.21, frontLampZ);
    front.scale.set(0.48, 0.26, 1);
    bodyRig.add(front);
    const rear = new THREE.Sprite(shared.tailGlow);
    rear.position.set(side * 0.60, 0.21, rearLampZ);
    rear.scale.set(0.44, 0.24, 1);
    bodyRig.add(rear);
  }

  // 前杠 3D 机械武器总成
  const weaponBaseZ = classId === 'dart' ? -1.64 : classId === 'bruiser' ? -1.84 : -1.74;
  const punch = makePunch(shared, weaponBaseZ);
  bodyRig.add(punch.group);
  owned.push(punch.face);

  let flyingHead = null;
  const modelFront = vector(0, 0, -1);
  const rocketDir = vector();

  // 底盘霓虹灯盘
  const glowColor = new THREE.Color(options.glow ?? 0x46e4ff);
  const underglowMaterial = new THREE.MeshBasicMaterial({
    map: glowDisc(),
    color: glowColor.clone().multiplyScalar(0.55),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  owned.push(underglowMaterial);
  const underglow = new THREE.Mesh(cached('underglow-plane', () => new THREE.PlaneGeometry(1, 1)), underglowMaterial);
  underglow.name = 'Neon underglow';
  underglow.scale.set(3.2, 4.6, 1);
  underglow.renderOrder = 1;
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = -0.6;
  group.add(underglow);
  let glowLevel = 0.55;

  // 重生无敌能量护盾
  const shieldMaterial = new THREE.ShaderMaterial({
    uniforms: { strength: { value: 0.35 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    toneMapped: false,
    vertexShader: 'varying vec3 vNormal; varying vec3 vView; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
    fragmentShader: 'varying vec3 vNormal; varying vec3 vView; uniform float strength; void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),2.4);gl_FragColor=vec4(0.35,0.8,1.0,(0.025+rim)*strength);}',
  });
  const shield = new THREE.Mesh(cached('respawn-shield', () => new THREE.SphereGeometry(1, 12, 8)), shieldMaterial);
  shield.name = 'Respawn shield';
  shield.scale.set(1.22, 1.0, 1.98);
  shield.position.y = 0.18;
  shield.visible = false;
  group.add(shield);

  // 玩家青柠识别光环
  let playerRing = null;
  if (isPlayer) {
    playerRing = new THREE.Mesh(cached('player-identification-ring', () => new THREE.RingGeometry(1.18, 1.26, 40)), shared.playerRing);
    playerRing.name = 'Player identification ring';
    playerRing.rotation.x = -Math.PI / 2;
    playerRing.position.y = -0.61;
    playerRing.scale.set(1, 1.56, 1);
    group.add(playerRing);
  }

  // 氮气加速蓝焰尾喷
  const flameRig = new THREE.Group();
  flameRig.name = 'Turbo exhaust';
  flameRig.position.set(0, -0.14, rearLampZ + 0.04);
  flameRig.visible = false;
  bodyRig.add(flameRig);
  const flameGeometry = cached('paired-turbo-flames', () => {
    const parts = batch();
    const cone = new THREE.ConeGeometry(0.145, 1.08, 8, 1, true);
    for (const side of [-1, 1]) parts.add('flame', cone, [side * 0.44, 0, 0.52], [Math.PI / 2, 0, 0]);
    cone.dispose();
    return parts.finish().get('flame');
  });
  flameRig.add(new THREE.Mesh(flameGeometry, shared.flame));

  // 强化拳电流效果
  const powerRig = new THREE.Group();
  powerRig.name = 'Charged punch electricity';
  powerRig.visible = false;
  bodyRig.add(powerRig);
  const arcPositions = new Float32Array(16 * 2 * 3);
  const arcGeometry = new THREE.BufferGeometry();
  arcGeometry.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const arcs = new THREE.LineSegments(arcGeometry, shared.powerLine);
  arcs.frustumCulled = false;
  powerRig.add(arcs);
  const chargeGlow = new THREE.Sprite(shared.powerGlow);
  chargeGlow.scale.set(1.6, 1.6, 1);
  powerRig.add(chargeGlow);

  const inverseOrientation = new THREE.Quaternion();
  const horizontalRing = new THREE.Quaternion().setFromAxisAngle(vector(1, 0, 0), -Math.PI / 2);
  let previousSpeed = 0;

  // 渲染预算统计（保持原有契约字段）
  let meshCount = 0, triangleCount = 0, shadowCasters = 0, sprites = 0, lines = 0;
  group.traverse((child) => {
    if (child.isMesh) {
      meshCount++;
      triangleCount += child.geometry.index ? child.geometry.index.count / 3 : child.geometry.attributes.position.count / 3;
      if (child.castShadow) shadowCasters++;
    }
    if (child.isSprite) sprites++;
    if (child.isLine) lines++;
  });
  let normalTriangles = 0, normalDrawCalls = 0;
  const countVisible = (node, parentVisible = true) => {
    const visible = parentVisible && node.visible;
    if (visible && (node.isMesh || node.isSprite || node.isLine)) {
      normalDrawCalls++;
      if (node.geometry) normalTriangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    }
    for (const child of node.children) countVisible(child, visible);
  };
  countVisible(group);
  group.userData.visualBudget = {
    triangles: normalTriangles,
    normalTriangles,
    normalDrawCalls,
    meshes: meshCount,
    sprites,
    lines,
    allEffectTriangles: triangleCount,
    maxDrawCalls: meshCount + sprites + lines,
    shadowCasters,
    bodyLength: 3.4,
    tireOutsideWidth: 1.88,
  };

  return {
    group,
    wheels,
    bodyRig,
    glowColor,
    taillights: [vector(-0.6, 0.21, rearLampZ), vector(0.6, 0.21, rearLampZ)],
    setGlove(id) {
      punch.setGlove(id);
    },
    updatePunch(...args) {
      punch.update(...args);
    },
    updateRocket(shot) {
      if (!shot) {
        if (flyingHead) flyingHead.visible = false;
        punch.head.visible = true;
        return;
      }
      if (!flyingHead) {
        flyingHead = punch.head.clone(true);
        group.add(flyingHead);
      }
      punch.head.visible = false;
      flyingHead.visible = true;
      inverseOrientation.copy(group.quaternion).invert();
      flyingHead.position.copy(shot.pos).sub(group.position).applyQuaternion(inverseOrientation);
      rocketDir.copy(shot.dir).applyQuaternion(inverseOrientation);
      flyingHead.quaternion.setFromUnitVectors(modelFront, rocketDir);
    },
    setGlow(active) {
      for (const glow of glowSprites) glow.visible = Boolean(active);
    },
    setNight(level = 0) {
      glowLevel = 0.35 + level * 0.9;
      stripe.emissiveIntensity = 0.04 + level * 0.55;
    },
    dispose() {
      for (const material of owned) {
        material.map?.dispose?.();
        material.dispose();
      }
      shieldMaterial.dispose();
    },
    updateState(state = {}, dt = 1 / 60) {
      const lift = state.grounded === false ? 0 : 1;
      underglowMaterial.color.copy(glowColor).multiplyScalar(glowLevel * (state.boost ? 1.45 : 1) * (0.25 + 0.75 * lift));
      underglow.visible = state.active !== false;
      const numericDt = Number(dt);
      const step = Number.isFinite(numericDt) ? clamp(numericDt, 0, 0.1) : 1 / 60;
      const steer = clamp(Number(state.steer) || 0, -1, 1);
      const speed = Number(state.speed) || 0;
      const time = Number(state.time) || 0;
      const grounded = state.grounded !== false;
      const ease = 1 - Math.exp(-step * 10);
      const acceleration = step > 0 ? clamp((speed - previousSpeed) / step, -10, 10) : 0;
      if (step > 0) previousSpeed = speed;
      const drift = state.drifting ? (Number.isFinite(Number(state.driftAmount)) ? clamp(Number(state.driftAmount), 0, 1) : 0.65) : 0;
      const targetRoll = grounded ? -steer * clamp(Math.abs(speed) / 13, 0, 1) * (0.085 + drift * 0.06) : 0;
      const targetPitch = grounded ? clamp(acceleration * 0.0045 - (state.brake ? 0.028 : 0) + (Number(state.throttle) || 0) * 0.009, -0.075, 0.065) : 0;
      bodyRig.rotation.z += (targetRoll - bodyRig.rotation.z) * ease;
      bodyRig.rotation.x += (targetPitch - bodyRig.rotation.x) * ease;
      const frontSteer = drift > 0.05 ? -steer * (0.30 + drift * 0.30) : steer * 0.43;
      for (const steering of steeringRigs) steering.rotation.y += (frontSteer - steering.rotation.y) * ease;
      // 越野长行程悬架微呼吸
      const idleBreath = Math.abs(speed) < 0.5 && grounded ? Math.sin(time * 2.8) * 0.012 : 0;
      bodyRig.position.y += ((grounded ? -0.015 * drift + idleBreath : 0) - bodyRig.position.y) * ease;

      const flash = clamp(Number(state.hitFlash) || 0, 0, 1);
      for (const material of [palette.paint, palette.trim, palette.glass]) {
        material.emissive.setHex(0xfff1dc);
        material.emissiveIntensity = flash * flash * (material === palette.paint ? 0.55 : 0.25);
      }
      shield.visible = Boolean(state.invulnerable);
      shieldMaterial.uniforms.strength.value = 0.18 + Math.sin(time * 13) * 0.05;
      if (playerRing) {
        playerRing.visible = grounded && !state.inStudio;
        inverseOrientation.copy(group.quaternion).invert();
        playerRing.quaternion.copy(inverseOrientation).multiply(horizontalRing);
        playerRing.position.set(0, -0.602, 0).applyQuaternion(inverseOrientation);
      }
      flameRig.visible = Boolean(state.boost);
      if (flameRig.visible) {
        const n = state.nitro ? 1.55 : 1;
        flameRig.scale.set(
          n > 1 ? 1.15 : 1,
          (0.88 + Math.sin(time * 39) * 0.12) * (n > 1 ? 1.15 : 1),
          (0.88 + Math.sin(time * 31) * 0.16 + clamp(Math.abs(speed) / 25, 0, 0.4)) * n,
        );
      }
      const powered = Boolean(state.power);
      powerRig.visible = powered;
      punch.head.scale.setScalar(powered ? 1.14 : 1);
      if (powered) {
        powerRig.position.copy(punch.group.position);
        powerRig.position.z += punch.group.visible ? punch.head.position.z - 0.12 : -0.045;
        const scale = punch.group.visible ? 1 : 0.58;
        powerRig.scale.setScalar(scale);
        for (let i = 0; i < 16; i++) {
          const angle = (i * TAU) / 16 + time * 2.5;
          const radius = 0.64 + Math.sin(time * 21 + i * 4.13) * 0.055;
          const end = angle + 0.23;
          const at = i * 6;
          arcPositions[at] = Math.cos(angle) * radius;
          arcPositions[at + 1] = Math.sin(angle) * radius;
          arcPositions[at + 2] = -0.02;
          arcPositions[at + 3] = Math.cos(end) * (radius + 0.07);
          arcPositions[at + 4] = Math.sin(end) * (radius + 0.07);
          arcPositions[at + 5] = Math.sin(i + time * 17) * 0.07;
        }
        arcGeometry.attributes.position.needsUpdate = true;
      }
    },
  };
}
