import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 汽车级高光烤漆曲面 3D 车模（严格对齐 Cannon-es 物理底盘：车头朝 -Z，轮胎触地 y = -0.61，轮心 (±0.79, -0.22, ±1.02)）
// 三款差异化车型（全车系高光清漆烤漆 + 醒目黄牌 + 粗弹簧拳击垫）：
//   - dart    (疾风)：圆润紧凑复古两厢拉力小钢炮（饱满掀背曲面、双赛车拉花、分色尾灯、欧式黄牌、多辐拉力轮毂）
//   - rumbler (悍将)：曲面烤漆巴哈沙漠皮卡（倒C日行灯、三点琥珀灯、防滚架、后斗斜卧双备胎、外露氮气避震）
//   - bruiser (重锤)：饱满宽体装甲越野猛兽（增压引擎盖、重型推土牛栏、高位双镀铬烟囱排气管、后斗重型备胎）
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
const rounded = (x, y, z, radius = 0.04, segments = 2) =>
  cached(`round:${x}:${y}:${z}:${radius}:${segments}`, () => new RoundedBoxGeometry(x, y, z, segments, radius));
const cylinder = (rTop, rBot, length, segments = 18) =>
  cached(`cyl:${rTop}:${rBot}:${length}:${segments}`, () => new THREE.CylinderGeometry(rTop, rBot, length, segments));
const torus = (radius, tube, radial = 7, tubular = 26, arc = TAU) =>
  cached(`torus:${radius}:${tube}:${radial}:${tubular}:${arc}`, () => new THREE.TorusGeometry(radius, tube, radial, tubular, arc));

/**
 * 侧面 2D 轮廓拉伸工具（车头在 -Z，车尾在 +Z）
 * 严格使用 rotateY(-Math.PI / 2)，保证 Shape 的 x 坐标直接映射为世界 z 坐标（-x -> -Z 车头, +x -> +Z 车尾）。
 */
function sideExtrude(points, width, bevel = 0.055, bevelSegments = 3) {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
  });
  geo.center();
  geo.rotateY(-Math.PI / 2);
  return geo;
}

function frontExtrude(points, depth, bevel = 0.03, bevelSegments = 2) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
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
    ctx.fillStyle = '#1b1f25';
    ctx.fillRect(0, 0, w, h);
    for (let i = -1; i < 33; i++) {
      const x = i * 16;
      ctx.strokeStyle = '#0c0f13';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 5, 16);
      ctx.lineTo(x + 9, 64);
      ctx.lineTo(x - 5, 112);
      ctx.stroke();
      ctx.strokeStyle = '#363e47';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - 2, 16);
      ctx.lineTo(x + 12, 64);
      ctx.lineTo(x - 2, 112);
      ctx.stroke();
    }
    ctx.fillStyle = '#11151a';
    for (const y of [18, 44, 84, 110]) ctx.fillRect(0, y, w, 2);
  });
  tireMap.wrapS = THREE.RepeatWrapping;

  const hazardMap = textureFromCanvas(256, 256, (ctx, s) => {
    ctx.fillStyle = '#181b22';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#f6b81d';
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(-Math.PI / 4);
    for (let i = -s; i < s; i += 48) ctx.fillRect(i, -s, 24, s * 2);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
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
    g.addColorStop(0, 'rgba(38,140,255,0)');
    g.addColorStop(0.32, 'rgba(72,204,255,.45)');
    g.addColorStop(0.7, 'rgba(180,242,255,.92)');
    g.addColorStop(1, 'rgba(255,255,255,.98)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  sharedMaterials = {
    trim: new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.66, metalness: 0.16 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x242a35, roughness: 0.36, metalness: 0.74 }),
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x424c5c, roughness: 0.3, metalness: 0.84 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb6c2d0, roughness: 0.24, metalness: 0.9, envMapIntensity: 1.35 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xedf3fa, roughness: 0.12, metalness: 0.96, envMapIntensity: 1.65 }),
    rimWhite: new THREE.MeshPhysicalMaterial({ color: 0xf1f4f8, roughness: 0.22, metalness: 0.25, clearcoat: 0.8 }),
    brake: new THREE.MeshStandardMaterial({ color: 0x6f7a86, roughness: 0.48, metalness: 0.86 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xe62932, roughness: 0.3, metalness: 0.36 }),
    towHook: new THREE.MeshStandardMaterial({ color: 0xff2c38, roughness: 0.3, metalness: 0.4 }),
    shock: new THREE.MeshStandardMaterial({ color: 0xff3c2e, roughness: 0.26, metalness: 0.48 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardMap, roughness: 0.44, metalness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1b2027, map: tireMap, bumpMap: tireMap, bumpScale: 0.016, roughness: 0.9, metalness: 0.04 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x0b1522,
      emissive: 0x030811,
      emissiveIntensity: 0.12,
      metalness: 0.35,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.5,
      side: THREE.DoubleSide,
    }),
    stripe: new THREE.MeshPhysicalMaterial({
      color: 0x181b22,
      metalness: 0.08,
      roughness: 0.24,
      clearcoat: 0.85,
      clearcoatRoughness: 0.1,
      envMapIntensity: 0.85,
      emissive: 0x000000,
      emissiveIntensity: 0.02,
      side: THREE.DoubleSide,
    }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xfbfdff, roughness: 0.12, metalness: 0.18, emissive: 0xfff4d6, emissiveIntensity: 1.3 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0xe82424, roughness: 0.18, metalness: 0.16, emissive: 0xff221c, emissiveIntensity: 1.2 }),
    reverseLight: new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.16, metalness: 0.15, emissive: 0xffffff, emissiveIntensity: 0.55 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffa622, roughness: 0.2, metalness: 0.16, emissive: 0xff8208, emissiveIntensity: 1.15 }),
    cyanLed: new THREE.MeshStandardMaterial({ color: 0x38e8ff, roughness: 0.14, metalness: 0.2, emissive: 0x00d9ff, emissiveIntensity: 1.5 }),
    lampGlow: new THREE.SpriteMaterial({ map: glowMap, color: 0xfff1cf, opacity: 0.22, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    tailGlow: new THREE.SpriteMaterial({ map: glowMap, color: 0xff3628, opacity: 0.2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    wheelGlow: new THREE.SpriteMaterial({ map: glowMap, color: 0x5be2ff, opacity: 0.48, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    playerRing: new THREE.MeshBasicMaterial({ color: 0x38b6ff, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false }),
    flame: new THREE.MeshBasicMaterial({ map: flameMap, color: 0xbcf4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false }),
    powerLine: new THREE.LineBasicMaterial({ color: 0xb8f7ff, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    powerGlow: new THREE.SpriteMaterial({ map: glowMap, color: 0x6bdfff, opacity: 0.48, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  };
  return sharedMaterials;
}

/** 复古拉力多辐赛道轮毂（疾风小钢炮专用，呼应参考视频精致白色/金属轮圈边） */
function buildRallyWheelParts(parts, { radius = 0.39, width = 0.29, side = 1, offset = [0, 0, 0], rot = [0, 0, 0], includeRotor = true } = {}) {
  const local = batch();
  const rIn = radius * 0.58;
  const rOut = radius * 0.965;
  const hw = width * 0.5;
  const profile = [
    [rIn, -hw * 0.88],
    [rOut * 0.93, -hw],
    [rOut, -hw * 0.72],
    [rOut, hw * 0.72],
    [rOut * 0.93, hw],
    [rIn, hw * 0.88],
    [rIn, -hw * 0.88],
  ];
  const tire = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), 28);
  tire.rotateZ(Math.PI / 2);
  local.add('rubber', tire, [0, 0, 0], [0, 0, 0], [1, 1, 1], true);

  // 细腻胎肩凸块
  const lugGeo = box(width * 0.44, 0.022, radius * 0.16);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    local.add('rubber', lugGeo, [(i % 2 ? 1 : -1) * width * 0.18, Math.cos(a) * (rOut + 0.006), Math.sin(a) * (rOut + 0.006)], [a, 0, 0]);
  }

  const faceDir = side >= 0 ? 1 : -1;
  local.add('darkMetal', cylinder(rIn * 1.02, rIn * 1.02, width * 0.82, 22), [0, 0, 0], [0, 0, Math.PI / 2]);
  local.add('rimWhite', torus(rIn * 0.96, 0.024, 7, 26), [faceDir * hw * 0.84, 0, 0], [0, Math.PI / 2, 0]);
  local.add('gunmetal', cylinder(rIn * 0.86, rIn * 0.68, width * 0.2, 20), [faceDir * hw * 0.54, 0, 0], [0, 0, Math.PI / 2]);

  // 8 辐拉力运动轮辐
  const spokeGeo = box(0.036, rIn * 0.88, 0.044);
  for (let s = 0; s < 8; s++) {
    const a = (s / 8) * TAU;
    local.add('rimWhite', spokeGeo, [faceDir * hw * 0.74, Math.cos(a) * rIn * 0.42, Math.sin(a) * rIn * 0.42], [a, 0, 0]);
  }
  local.add('chrome', cylinder(rIn * 0.25, rIn * 0.29, 0.065, 14), [faceDir * hw * 0.82, 0, 0], [0, 0, Math.PI / 2]);
  if (includeRotor) {
    local.add('brake', cylinder(rIn * 0.76, rIn * 0.76, 0.026, 18), [-faceDir * hw * 0.14, 0, 0], [0, 0, Math.PI / 2]);
  }
  for (const [k, geo] of local.finish()) parts.add(k, geo, offset, rot, [1, 1, 1], true);
}

/** 37 寸硬派越野泥地大胎 + 防脱轮毂（悍将 / 重锤专用） */
function buildMudWheelParts(parts, { radius = 0.39, width = 0.31, side = 1, offset = [0, 0, 0], rot = [0, 0, 0], includeRotor = true } = {}) {
  const local = batch();
  const rIn = radius * 0.54;
  const rOut = radius * 0.935;
  const hw = width * 0.5;
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

  const lugCount = 18;
  const lugGeo = box(width * 0.46, 0.042, radius * 0.21);
  const sideLugGeo = box(0.034, 0.056, radius * 0.14);
  const rLug = radius * 0.948;
  for (let i = 0; i < lugCount; i++) {
    const a = (i / lugCount) * TAU;
    const stagger = i % 2 === 0 ? 1 : -1;
    local.add('rubber', lugGeo, [stagger * width * 0.19, Math.cos(a) * rLug, Math.sin(a) * rLug], [a, 0, stagger * 0.15]);
    for (const s of [-1, 1]) {
      local.add('rubber', sideLugGeo, [s * (hw - 0.01), Math.cos(a + 0.14) * (radius * 0.83), Math.sin(a + 0.14) * (radius * 0.83)], [a + 0.14, 0, 0]);
    }
  }

  const faceDir = side >= 0 ? 1 : -1;
  local.add('darkMetal', cylinder(rIn * 1.02, rIn * 1.02, width * 0.82, 20), [0, 0, 0], [0, 0, Math.PI / 2]);
  local.add('gunmetal', cylinder(rIn * 0.88, rIn * 0.7, width * 0.24, 18), [faceDir * hw * 0.56, 0, 0], [0, 0, Math.PI / 2]);
  const spokeGeo = box(0.04, rIn * 0.86, 0.058);
  for (let s = 0; s < 6; s++) {
    const a = (s / 6) * TAU;
    local.add('steel', spokeGeo, [faceDir * hw * 0.74, Math.cos(a) * rIn * 0.42, Math.sin(a) * rIn * 0.42], [a, 0, 0]);
  }
  local.add('chrome', cylinder(rIn * 0.29, rIn * 0.33, 0.07, 12), [faceDir * hw * 0.82, 0, 0], [0, 0, Math.PI / 2]);
  local.add('rimWhite', torus(rIn * 0.97, 0.023, 6, 22), [faceDir * hw * 0.86, 0, 0], [0, Math.PI / 2, 0]);
  const boltGeo = cylinder(0.012, 0.012, 0.028, 6);
  for (let b = 0; b < 12; b++) {
    const a = (b / 12) * TAU;
    local.add('chrome', boltGeo, [faceDir * hw * 0.92, Math.cos(a) * rIn * 0.97, Math.sin(a) * rIn * 0.97], [0, 0, Math.PI / 2]);
  }
  if (includeRotor) {
    local.add('brake', cylinder(rIn * 0.78, rIn * 0.78, 0.028, 16), [-faceDir * hw * 0.16, 0, 0], [0, 0, Math.PI / 2]);
  }
  for (const [k, geo] of local.finish()) parts.add(k, geo, offset, rot, [1, 1, 1], true);
}

function wheelGeometry(classId, side) {
  const style = classId === 'dart' ? 'rally' : 'mud';
  return cached(`wheel:${style}:${side}`, () => {
    const parts = batch();
    if (style === 'rally') buildRallyWheelParts(parts, { radius: 0.39, width: 0.29, side, includeRotor: true });
    else buildMudWheelParts(parts, { radius: 0.39, width: 0.31, side, includeRotor: true });
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

function buildTruckShell(classId) {
  if (shellCache.has(classId)) return shellCache.get(classId);
  const parts = batch();

  const specs = {
    dart:    { bodyW: 1.48, frontZ: -1.56, rearZ: 1.54, railLen: 2.76, roofY: 0.88 },
    rumbler: { bodyW: 1.50, frontZ: -1.68, rearZ: 1.66, railLen: 3.10, roofY: 0.90 },
    bruiser: { bodyW: 1.58, frontZ: -1.70, rearZ: 1.68, railLen: 3.16, roofY: 0.92 },
  };
  const S = specs[classId] || specs.rumbler;
  const halfW = S.bodyW * 0.5;

  const addWipers = (yPos, zPos, tiltX) => {
    for (const wx of [-0.24, 0.18]) {
      parts.add('trim', box(0.30, 0.02, 0.02), [wx, yPos, zPos], [tiltX, 0, 0.11]);
    }
  };
  const addMirrors = (yPos, zPos) => {
    for (const side of [-1, 1]) {
      parts.add('trim', box(0.14, 0.036, 0.055), [side * (halfW - 0.01), yPos, zPos]);
      parts.add('paint', rounded(0.13, 0.10, 0.095, 0.03, 2), [side * (halfW + 0.08), yPos + 0.015, zPos]);
      parts.add('glass', box(0.088, 0.068, 0.012), [side * (halfW + 0.085), yPos + 0.015, zPos + 0.048]);
    }
  };

  if (classId === 'dart') {
    /* =======================================================================
       疾风 DART：参考视频同款 · 圆润烤漆复古两厢拉力小钢炮
       饱满圆角车身 + 双纵向赛车条纹 + 立体分色尾灯 + 醒目黄色欧式车牌
       ======================================================================= */
    // 底盘护板与底梁
    parts.add('darkMetal', rounded(1.24, 0.12, 2.72, 0.04, 2), [0, -0.25, 0]);
    parts.add('steel', box(0.86, 0.045, 0.56), [0, -0.22, -1.32], [0.32, 0, 0]);

    // 饱满流线复古两厢下车身（大圆角 bevel 产生细腻汽车烤漆肩线高光）
    const lowerGeo = sideExtrude(
      [[-1.48, -0.14], [1.46, -0.14], [1.48, 0.14], [1.42, 0.35], [-1.36, 0.34], [-1.52, 0.16]],
      S.bodyW - 0.11,
      0.065,
      3,
    );
    parts.add('paint', lowerGeo, [0, 0.11, 0], [0, 0, 0], [1, 1, 1], true);

    // 经典复古掀背圆角驾驶舱（前斜风挡 + 平顶 + 微斜掀背大尾窗）
    const cabGeo = sideExtrude(
      [[-0.78, 0], [1.18, 0], [0.96, 0.49], [-0.36, 0.49]],
      S.bodyW - 0.26,
      0.06,
      3,
    );
    parts.add('paint', cabGeo, [0, 0.58, 0.15], [0, 0, 0], [1, 1, 1], true);

    // 清晰高反光前后风挡 + 双侧分体车窗（精准贴合座舱外表面，零吞模！）
    parts.add('glass', rounded(S.bodyW - 0.36, 0.45, 0.05, 0.014, 2), [0, 0.60, -0.66], [0.71, 0, 0]);
    addWipers(0.43, -0.77, 0.71);
    // 标志性大面积掀背斜后窗 + 后雨刮器（追尾视角第一眼特征！）
    parts.add('glass', rounded(S.bodyW - 0.36, 0.44, 0.05, 0.014, 2), [0, 0.60, 1.07], [-0.42, 0, 0]);
    parts.add('trim', box(0.28, 0.022, 0.024), [0.06, 0.46, 1.15], [-0.42, 0, -0.18]);
    // 两侧前后侧窗 + B 柱
    for (const side of [-1, 1]) {
      parts.add('glass', rounded(0.045, 0.31, 0.62, 0.01, 1), [side * 0.682, 0.60, -0.06]);
      parts.add('glass', rounded(0.045, 0.30, 0.50, 0.01, 1), [side * 0.682, 0.60, 0.62]);
      parts.add('trim', box(0.052, 0.34, 0.08), [side * 0.684, 0.60, 0.31]);
      // 侧门把手 + 车身黑防擦腰条
      parts.add('trim', rounded(0.036, 0.045, 0.16, 0.01, 1), [side * (halfW + 0.014), 0.24, 0.16]);
      parts.add('trim', rounded(0.03, 0.065, 1.12, 0.015, 1), [side * (halfW + 0.012), -0.04, 0]);
    }

    // 宽体拉力圆拱轮眉（紧致包裹 4 轮）
    const archGeo = sideExtrude(
      [[-0.44, -0.06], [-0.30, 0.21], [0.30, 0.21], [0.44, -0.06], [0.35, -0.08], [0.24, 0.12], [-0.24, 0.12], [-0.35, -0.08]],
      0.14,
      0.025,
      2,
    );
    for (const wz of [-1.02, 1.02]) {
      for (const side of [-1, 1]) {
        parts.add('trim', archGeo, [side * (halfW + 0.065), 0.06, wz]);
      }
    }
    archGeo.dispose();

    // 复古拉力双赛车条纹（从机盖贯穿车顶直达尾门 — 复刻视频经典双黑条纹视觉！）
    for (const sx of [-0.15, 0.15]) {
      parts.add('stripe', box(0.13, 0.015, 0.86), [sx, 0.395, -1.04]);
      parts.add('stripe', box(0.13, 0.015, 1.24), [sx, 0.892, 0.44]);
      parts.add('stripe', box(0.13, 0.36, 0.016), [sx, 0.17, 1.545]);
    }

    // 车顶小运动扰流尾翼 + 高位刹车灯 + 车顶小黑尾鳍（呼应视频顶部精致配件）
    parts.add('trim', rounded(S.bodyW - 0.28, 0.055, 0.22, 0.02, 2), [0, 0.885, 1.15], [0.12, 0, 0]);
    parts.add('taillight', box(0.32, 0.024, 0.025), [0, 0.885, 1.265]);
    parts.add('trim', rounded(0.46, 0.08, 0.34, 0.025, 2), [0, 0.915, 0.30]);

    // 经典复古拉力前脸：熏黑宽格栅 + 圆角矩形大灯 + 双圆形拉力雾灯 + 黑前保杠
    parts.add('trim', rounded(1.36, 0.24, 0.12, 0.03, 2), [0, 0.15, -1.53]);
    parts.add('trim', rounded(1.52, 0.19, 0.20, 0.04, 2), [0, -0.08, -1.55]);
    for (const lx of [-0.50, 0.50]) {
      parts.add('headlight', rounded(0.28, 0.15, 0.06, 0.02, 2), [lx, 0.17, -1.57]);
      parts.add('amber', box(0.08, 0.13, 0.055), [lx + Math.sign(lx) * 0.16, 0.17, -1.56]);
      parts.add('headlight', cylinder(0.068, 0.068, 0.06, 14), [lx * 0.46, -0.05, -1.64], [Math.PI / 2, 0, 0]);
    }

    // 追尾视角灵魂：立体分色尾灯组（红/白/橙）+ 厚实黑后保杠 + 双镀铬排气尾喉
    parts.add('trim', rounded(1.52, 0.19, 0.20, 0.04, 2), [0, -0.08, 1.54]);
    parts.add('trim', box(0.68, 0.18, 0.04), [0, 0.16, 1.53]);
    for (const tx of [-0.54, 0.54]) {
      parts.add('trim', rounded(0.32, 0.19, 0.065, 0.02, 2), [tx, 0.18, 1.53]);
      parts.add('taillight', rounded(0.18, 0.14, 0.045, 0.012, 1), [tx + Math.sign(tx) * 0.045, 0.19, 1.555]);
      parts.add('amber', box(0.08, 0.07, 0.04), [tx - Math.sign(tx) * 0.095, 0.21, 1.555]);
      parts.add('reverseLight', box(0.08, 0.06, 0.04), [tx - Math.sign(tx) * 0.095, 0.14, 1.555]);
    }
    for (const ex of [-0.42, 0.42]) {
      parts.add('chrome', cylinder(0.052, 0.052, 0.22, 14), [ex, -0.17, 1.58], [Math.PI / 2, 0, 0]);
    }

    addMirrors(0.49, -0.42);

  } else if (classId === 'rumbler') {
    /* =======================================================================
       悍将 RUMBLER：曲面烤漆巴哈沙漠运动皮卡
       ======================================================================= */
    for (const fx of [-0.34, 0.34]) parts.add('darkMetal', box(0.10, 0.11, S.railLen), [fx, -0.18, 0]);
    parts.add('gunmetal', cylinder(0.04, 0.04, S.railLen * 0.72, 8), [0, -0.24, 0], [Math.PI / 2, 0, 0]);
    parts.add('darkMetal', cylinder(0.05, 0.05, 1.44, 8), [0, -0.24, 1.02], [0, 0, Math.PI / 2]);
    parts.add('steel', box(0.84, 0.05, 0.62), [0, -0.18, S.frontZ + 0.25], [0.42, 0, 0]);

    const coilGeo = coilSpringGeo(0.38, 0.058, 6, 0.015);
    for (const side of [-1, 1]) {
      for (const wz of [-1.02, 1.02]) {
        parts.add('shock', coilGeo, [side * 0.53, -0.02, wz], [0, 0, side * 0.18]);
        parts.add('chrome', cylinder(0.024, 0.024, 0.42, 8), [side * 0.53, -0.02, wz], [0, 0, side * 0.18]);
        for (const ay of [-0.11, -0.25]) parts.add('darkMetal', box(0.46, 0.04, 0.10), [side * 0.44, ay, wz], [0, 0, side * -0.16]);
      }
      parts.add('darkMetal', cylinder(0.038, 0.038, 1.18, 10), [side * (halfW + 0.09), -0.12, 0], [Math.PI / 2, 0, 0]);
    }

    const lowerGeo = sideExtrude(
      [[-1.60, -0.10], [1.60, -0.10], [1.58, 0.35], [-1.50, 0.35], [-1.64, 0.16]],
      S.bodyW - 0.10,
      0.058,
      3,
    );
    parts.add('paint', lowerGeo, [0, 0.13, 0], [0, 0, 0], [1, 1, 1], true);

    parts.add('paint', rounded(0.78, 0.09, 0.94, 0.04, 2), [0, 0.40, -1.06]);
    for (const vx of [-0.20, 0.20]) parts.add('trim', rounded(0.22, 0.035, 0.32, 0.01, 1), [vx, 0.448, -1.10]);
    for (const sx of [-0.16, 0.16]) {
      parts.add('stripe', box(0.12, 0.015, 0.98), [sx, 0.452, -1.10]);
      parts.add('stripe', box(0.12, 0.015, 0.76), [sx, 0.896, 0.03]);
    }

    const cabGeo = sideExtrude(
      [[-0.64, 0], [0.49, 0], [0.43, 0.48], [-0.34, 0.48]],
      S.bodyW - 0.25,
      0.052,
      3,
    );
    parts.add('paint', cabGeo, [0, 0.62, -0.04], [0, 0, 0], [1, 1, 1], true);
    parts.add('glass', rounded(S.bodyW - 0.36, 0.45, 0.05, 0.014, 2), [0, 0.63, -0.50], [0.56, 0, 0]);
    addWipers(0.45, -0.62, 0.56);
    parts.add('glass', rounded(S.bodyW - 0.36, 0.34, 0.05, 0.012, 1), [0, 0.64, 0.545], [-0.11, 0, 0]);
    for (const side of [-1, 1]) {
      parts.add('glass', rounded(0.048, 0.33, 0.66, 0.012, 1), [side * 0.712, 0.64, 0.02]);
      parts.add('chrome', box(0.04, 0.04, 0.17), [side * (halfW + 0.015), 0.26, 0.12]);
    }

    // 开放式巴哈后斗 + 防滚架 + 双斜卧备胎 + 红氮气副筒
    parts.add('trim', box(1.14, 0.06, 0.98), [0, 0.33, 1.08]);
    for (const rx of [-0.54, 0.54]) {
      parts.add('darkMetal', tubePath([[rx, 0.34, 0.57], [rx, 0.84, 0.59], [rx, 0.38, 1.54]], 0.034, 14, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
      parts.add('darkMetal', tubePath([[rx, 0.62, 1.06], [rx, 0.34, 1.06]], 0.028, 6, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    }
    parts.add('darkMetal', tubePath([[-0.54, 0.84, 0.59], [0.54, 0.84, 0.59]], 0.034, 8, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    for (const tx of [-0.31, 0.31]) {
      buildMudWheelParts(parts, { radius: 0.29, width: 0.21, side: 1, offset: [tx, 0.49, 1.12], rot: [0.34, 0, Math.PI / 2], includeRotor: false });
    }
    for (const tx of [-0.46, 0.46]) parts.add('shock', cylinder(0.042, 0.042, 0.38, 8), [tx, 0.48, 0.76], [-0.22, 0, 0]);

    // 猛禽前脸 & 车尾分色尾灯
    parts.add('trim', rounded(1.30, 0.32, 0.10, 0.03, 2), [0, 0.18, -1.64]);
    for (const ax of [-0.18, 0, 0.18]) parts.add('amber', box(0.08, 0.04, 0.045), [ax, 0.30, -1.69]);
    for (const lx of [-0.57, 0.57]) {
      const s = Math.sign(lx);
      parts.add('headlight', rounded(0.17, 0.20, 0.06, 0.015, 1), [lx, 0.20, -1.68]);
      parts.add('amber', box(0.24, 0.044, 0.065), [lx - s * 0.03, 0.295, -1.685]);
    }
    parts.add('darkMetal', tubePath([[-0.72, -0.02, -1.63], [-0.38, -0.04, -1.75], [0.38, -0.04, -1.75], [0.72, -0.02, -1.63]], 0.046, 14, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    for (const hx of [-0.32, 0.32]) parts.add('towHook', torus(0.05, 0.018, 6, 12), [hx, -0.08, -1.72]);

    parts.add('trim', rounded(1.26, 0.20, 0.06, 0.02, 1), [0, 0.19, 1.64]);
    for (const tx of [-0.60, 0.60]) {
      parts.add('taillight', rounded(0.13, 0.24, 0.08, 0.02, 2), [tx, 0.21, 1.65]);
      parts.add('reverseLight', box(0.11, 0.06, 0.06), [tx, 0.09, 1.66]);
    }
    parts.add('darkMetal', rounded(1.52, 0.16, 0.18, 0.03, 2), [0, -0.05, 1.66]);
    for (const ex of [-0.42, 0.42]) parts.add('chrome', cylinder(0.06, 0.06, 0.24, 12), [ex, -0.14, 1.68], [Math.PI / 2, 0, 0]);

    const flareGeo = sideExtrude([[-0.45, -0.06], [-0.32, 0.22], [0.32, 0.22], [0.45, -0.06], [0.37, -0.08], [0.25, 0.13], [-0.25, 0.13], [-0.37, -0.08]], 0.18, 0.022, 2);
    for (const wz of [-1.02, 1.02]) for (const side of [-1, 1]) parts.add('trim', flareGeo, [side * (halfW + 0.08), 0.08, wz]);
    flareGeo.dispose();

    parts.add('trim', rounded(1.08, 0.08, 0.11, 0.02, 2), [0, 0.94, -0.36]);
    for (let i = 0; i < 6; i++) parts.add('headlight', box(0.12, 0.05, 0.03), [-0.45 + i * 0.18, 0.94, -0.415]);
    addMirrors(0.52, -0.44);

  } else {
    /* =======================================================================
       重锤 BRUISER：饱满圆角宽体装甲越野猛兽
       ======================================================================= */
    for (const fx of [-0.36, 0.36]) parts.add('darkMetal', box(0.11, 0.12, S.railLen), [fx, -0.18, 0]);
    parts.add('gunmetal', cylinder(0.042, 0.042, S.railLen * 0.72, 8), [0, -0.24, 0], [Math.PI / 2, 0, 0]);
    parts.add('darkMetal', cylinder(0.055, 0.055, 1.50, 8), [0, -0.24, 1.02], [0, 0, Math.PI / 2]);
    parts.add('steel', box(0.92, 0.055, 0.64), [0, -0.18, S.frontZ + 0.26], [0.42, 0, 0]);

    const coilGeo = coilSpringGeo(0.38, 0.06, 6, 0.016);
    for (const side of [-1, 1]) {
      for (const wz of [-1.02, 1.02]) {
        parts.add('shock', coilGeo, [side * 0.54, -0.02, wz], [0, 0, side * 0.18]);
        parts.add('chrome', cylinder(0.026, 0.026, 0.42, 8), [side * 0.54, -0.02, wz], [0, 0, side * 0.18]);
      }
      parts.add('darkMetal', cylinder(0.042, 0.042, 1.22, 10), [side * (halfW + 0.09), -0.12, 0], [Math.PI / 2, 0, 0]);
    }

    const lowerGeo = sideExtrude(
      [[-1.62, -0.12], [1.62, -0.12], [1.60, 0.39], [-1.56, 0.39], [-1.67, 0.18]],
      S.bodyW - 0.10,
      0.06,
      3,
    );
    parts.add('paint', lowerGeo, [0, 0.13, 0], [0, 0, 0], [1, 1, 1], true);

    const scoopGeo = frontExtrude([[-0.44, 0], [0.44, 0], [0.35, 0.15], [-0.35, 0.15]], 0.84, 0.028, 2);
    parts.add('trim', scoopGeo, [0, 0.48, -1.08], [0, 0, 0], [1, 1, 1], true);
    for (const ax of [-0.15, 0, 0.15]) parts.add('taillight', box(0.07, 0.036, 0.04), [ax, 0.51, -1.50]);
    for (const sx of [-0.50, 0.50]) parts.add('stripe', box(0.09, 0.015, 0.88), [sx, 0.415, -1.08]);

    const cabGeo = sideExtrude(
      [[-0.65, 0], [0.51, 0], [0.47, 0.45], [-0.40, 0.45]],
      S.bodyW - 0.24,
      0.052,
      3,
    );
    parts.add('paint', cabGeo, [0, 0.64, -0.04], [0, 0, 0], [1, 1, 1], true);
    parts.add('glass', rounded(S.bodyW - 0.36, 0.42, 0.05, 0.014, 2), [0, 0.65, -0.57], [0.48, 0, 0]);
    addWipers(0.47, -0.68, 0.48);
    parts.add('glass', rounded(S.bodyW - 0.36, 0.32, 0.05, 0.012, 1), [0, 0.66, 0.56]);
    for (const side of [-1, 1]) parts.add('glass', rounded(0.048, 0.31, 0.72, 0.012, 1), [side * 0.748, 0.65, 0.02]);

    parts.add('trim', rounded(1.44, 0.34, 0.12, 0.03, 2), [0, 0.20, -1.66]);
    for (const lx of [-0.58, 0.58]) {
      parts.add('headlight', rounded(0.26, 0.11, 0.06, 0.015, 1), [lx, 0.24, -1.71]);
      parts.add('amber', box(0.28, 0.036, 0.065), [lx, 0.31, -1.71]);
    }
    parts.add('darkMetal', rounded(1.68, 0.26, 0.24, 0.04, 2), [0, -0.02, -1.74]);
    parts.add('darkMetal', tubePath([[-0.80, 0.08, -1.78], [-0.66, 0.38, -1.80], [0.66, 0.38, -1.80], [0.80, 0.08, -1.78]], 0.048, 16, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    for (const hx of [-0.40, 0.40]) parts.add('towHook', torus(0.056, 0.02, 6, 12), [hx, -0.10, -1.84]);

    for (const sx of [-0.66, 0.66]) {
      parts.add('chrome', cylinder(0.06, 0.065, 0.88, 12), [sx, 0.70, 0.65]);
      parts.add('trim', cylinder(0.08, 0.08, 0.46, 10), [sx, 0.62, 0.65]);
    }
    parts.add('trim', box(1.26, 0.06, 0.96), [0, 0.38, 1.14]);
    buildMudWheelParts(parts, { radius: 0.35, width: 0.22, side: 1, offset: [0, 0.51, 1.18], rot: [0.24, 0, Math.PI / 2], includeRotor: false });
    for (const tx of [-0.64, 0.64]) {
      parts.add('taillight', rounded(0.14, 0.26, 0.09, 0.02, 2), [tx, 0.24, 1.67]);
      parts.add('reverseLight', box(0.12, 0.06, 0.06), [tx, 0.10, 1.68]);
    }
    parts.add('darkMetal', rounded(1.64, 0.20, 0.20, 0.035, 2), [0, -0.05, 1.68]);

    const flareGeo = sideExtrude([[-0.46, -0.06], [-0.32, 0.22], [0.32, 0.22], [0.46, -0.06], [0.38, -0.08], [0.25, 0.13], [-0.25, 0.13], [-0.38, -0.08]], 0.19, 0.025, 2);
    for (const wz of [-1.02, 1.02]) for (const side of [-1, 1]) parts.add('trim', flareGeo, [side * (halfW + 0.08), 0.08, wz]);
    flareGeo.dispose();

    parts.add('trim', rounded(1.22, 0.08, 0.11, 0.02, 2), [0, 0.94, -0.41]);
    for (let i = 0; i < 6; i++) parts.add('headlight', box(0.14, 0.05, 0.03), [-0.50 + i * 0.20, 0.94, -0.465]);
    addMirrors(0.54, -0.46);
  }

  // 车门拉花号牌 + 醒目黄色欧式金属尾牌（复刻视频车尾黄牌提气感！）
  for (const side of [-1, 1]) {
    const x = side * (halfW + 0.008);
    const pts = side > 0
      ? [[x, 0.05, 0.28], [x, 0.05, -0.32], [x, 0.23, -0.32], [x, 0.23, 0.28]]
      : [[x, 0.05, -0.32], [x, 0.05, 0.28], [x, 0.23, 0.28], [x, 0.23, -0.32]];
    parts.add('decal', quad(pts, [0, 0.5, 1, 1]), [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
  }
  const plateZ = classId === 'dart' ? 1.565 : S.rearZ + 0.105;
  const plateY = classId === 'dart' ? 0.155 : -0.05;
  parts.add(
    'decal',
    quad([[-0.26, plateY - 0.068, plateZ], [0.26, plateY - 0.068, plateZ], [0.26, plateY + 0.068, plateZ], [-0.26, plateY + 0.068, plateZ]], [0, 0, 1, 0.5]),
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
    // 车门竞技编号贴
    ctx.fillStyle = '#f8f9fb';
    ctx.beginPath();
    ctx.roundRect(16, 16, 992, 224, 24);
    ctx.fill();
    ctx.fillStyle = '#151923';
    ctx.beginPath();
    ctx.roundRect(32, 32, 210, 192, 16);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 132px Bahnschrift, "Segoe UI", Arial, sans-serif';
    ctx.fillText(displayNumber, 137, 132, 180);
    ctx.fillStyle = '#151923';
    ctx.textAlign = 'left';
    ctx.font = '800 104px "Microsoft YaHei UI","PingFang SC","Noto Sans SC",sans-serif';
    ctx.fillText(String(name), 280, 126, 670);
    ctx.fillStyle = '#2584ff';
    ctx.fillRect(278, 192, 668, 12);

    // 醒目欧式明黄金属尾牌（复刻视频拉风车尾亮黄车牌）
    ctx.fillStyle = '#f8ca22';
    ctx.beginPath();
    ctx.roundRect(12, 272, 1000, 226, 20);
    ctx.fill();
    ctx.strokeStyle = '#141720';
    ctx.lineWidth = 16;
    ctx.strokeRect(20, 280, 984, 210);
    // 左侧标志蓝条
    ctx.fillStyle = '#1d5cd6';
    ctx.fillRect(28, 288, 84, 194);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '900 54px Bahnschrift, "Segoe UI", Arial, sans-serif';
    ctx.fillText('PD', 70, 392, 70);
    // 中央黑字车手名与编号
    ctx.fillStyle = '#141720';
    ctx.font = '900 132px "Microsoft YaHei UI","PingFang SC","Noto Sans SC",sans-serif';
    ctx.fillText(`${name} · ${displayNumber}`, 558, 390, 820);
  });
  return new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    alphaTest: 0.15,
    roughness: 0.35,
    metalness: 0.12,
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
 * 4 款精细 3D 前杠机械武器（默认弹簧拳升级为视频同款粗螺旋弹簧 + 饱满蓝/红拳击缓冲圆垫）
 */
function makePunch(shared, baseZ = -1.64, padColorHex = 0x2488ff) {
  const group = new THREE.Group();
  group.name = 'Bumper Weapon Rig';
  group.position.set(0, 0.04, baseZ);

  const mount = makeMesh(rounded(0.54, 0.22, 0.16, 0.03, 2), shared.darkMetal, 'Weapon mount');
  mount.position.set(0, 0, 0.04);
  group.add(mount);

  const rod = makeMesh(cylinder(0.052, 0.052, 1, 12), shared.chrome, 'Telescopic chrome rod');
  rod.rotation.x = Math.PI / 2;
  group.add(rod);

  const springGeometry = cached('spring-coil-heavy', () => {
    const points = [];
    for (let i = 0; i <= 128; i++) {
      const t = i / 128;
      points.push(vector(Math.sin(t * TAU * 7) * 0.165, Math.cos(t * TAU * 7) * 0.165, -t));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.028, 6, false);
  });
  const spring = makeMesh(springGeometry, shared.chrome, 'Heavy steel coil');
  group.add(spring);

  const head = new THREE.Group();
  head.name = 'Weapon head';

  // 饱满高对比拳击垫材质（玩家/蓝队为电光蓝，红队/对手为竞速红，蓄力发亮橙红光）
  const face = new THREE.MeshPhysicalMaterial({
    color: padColorHex,
    metalness: 0.14,
    roughness: 0.24,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
    emissive: new THREE.Color(0xff4214),
    emissiveIntensity: 0.05,
  });

  // 1. 弹簧拳：精致紧凑饱满圆润缓冲拳垫 + 橡胶外圈，出拳时自动膨胀张力十足
  const springKit = new THREE.Group();
  const springHeadParts = cached('punch-head-spring-v3', () => {
    const p = batch();
    p.add('darkMetal', cylinder(0.28, 0.25, 0.12, 24), [0, 0, 0.04], [Math.PI / 2, 0, 0]);
    p.add('trim', torus(0.32, 0.044, 8, 28), [0, 0, -0.04]);
    p.add('face', cylinder(0.32, 0.34, 0.14, 28), [0, 0, -0.06], [Math.PI / 2, 0, 0]);
    p.add('face', cached('punch-dome-v3', () => new THREE.SphereGeometry(0.30, 20, 12, 0, TAU, 0, Math.PI * 0.48)), [0, 0, -0.12], [-Math.PI / 2, 0, 0], [1, 0.36, 1]);
    p.add('chrome', torus(0.19, 0.018, 6, 22), [0, 0, -0.18]);
    return p.finish();
  });
  for (const [k, geo] of springHeadParts) {
    const mesh = makeMesh(geo, k === 'face' ? face : shared[k]);
    mesh.castShadow = k === 'face';
    springKit.add(mesh);
  }

  // 2. 抓钩拳
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

  // 3. 震荡锤
  const hammerKit = new THREE.Group();
  const hammerHeadParts = cached('punch-head-hammer', () => {
    const p = batch();
    for (const x of [-0.30, 0.30]) p.add('chrome', cylinder(0.06, 0.06, 0.26, 10), [x, 0, 0.06], [Math.PI / 2, 0, 0]);
    p.add('hazard', rounded(1.24, 0.38, 0.24, 0.045, 2), [0, 0, -0.10]);
    p.add('amber', rounded(1.30, 0.12, 0.10, 0.025, 2), [0, 0, -0.22]);
    p.add('face', box(0.96, 0.08, 0.04), [0, 0.16, -0.20]);
    return p.finish();
  });
  for (const [k, geo] of hammerHeadParts) {
    const mesh = makeMesh(geo, k === 'face' ? face : shared[k]);
    mesh.castShadow = k === 'hazard';
    hammerKit.add(mesh);
  }

  // 4. 火箭拳
  const rocketKit = new THREE.Group();
  const rocketHeadParts = cached('punch-head-rocket', () => {
    const p = batch();
    p.add('face', cylinder(0.17, 0.21, 0.56, 16), [0, 0.02, -0.14], [Math.PI / 2, 0, 0]);
    p.add('darkMetal', cached('rocket-cone', () => new THREE.ConeGeometry(0.17, 0.30, 16)), [0, 0.02, -0.56], [-Math.PI / 2, 0, 0]);
    for (const s of [-1, 1]) p.add('steel', rounded(0.28, 0.045, 0.24, 0.012, 1), [s * 0.24, 0.02, 0.02], [0, s * 0.32, 0]);
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
  group.visible = true;

  return {
    group,
    head,
    face,
    setPadColor(hex) {
      face.color.setHex(hex);
    },
    setGlove(id) {
      glove = kits[id] ? id : 'spring';
      for (const [name, kit] of Object.entries(kits)) kit.visible = name === glove;
    },
    update(extension, angle = 0, charge = 0, heavy = 0, time = 0, showcase = false) {
      const amount = clamp(Number(extension) || 0, -0.1, 1.12);
      // 始终可见紧凑前杠弹簧拳，还原视频里每辆车自带前杠弹簧拳的标志轮廓
      group.visible = true;
      group.rotation.y = charge > 0 ? 0 : -angle;
      group.position.z = baseZ + Math.max(0, -amount) * 0.95;
      const reach = glove === 'hook' ? 7.1 : glove === 'hammer' ? 1.3 : glove === 'rocket' ? 0.18 : 3.55;
      const idleLen = glove === 'spring' ? 0.16 : 0.14;
      const length = charge > 0
        ? Math.max(0.06, 0.22 - 0.14 * charge)
        : showcase
          ? Math.max(idleLen, idleLen + amount * 0.55)
          : Math.max(idleLen, idleLen + amount * reach);
      const popScale = glove === 'spring' ? 1 + Math.max(0, amount) * 0.34 : 1;
      head.scale.setScalar(popScale);
      face.emissiveIntensity = charge > 0 ? charge * (1.5 + 0.8 * Math.sin(time * 26)) : heavy && amount > 0 ? 1.7 : 0.05;
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
  bodyRig.name = 'Car suspension rig';
  group.add(bodyRig);

  const shared = materials();
  const baseColor = new THREE.Color(color);
  const lum = baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
  if (lum < 0.09) baseColor.lerp(new THREE.Color(0x283142), 0.52);

  // 汽车级高光清漆烤漆材质
  const paint = new THREE.MeshPhysicalMaterial({
    color: baseColor,
    metalness: 0.34,
    roughness: 0.19,
    clearcoat: 1.0,
    clearcoatRoughness: 0.055,
    envMapIntensity: 1.55,
  });
  const stripeColor = new THREE.Color(options.stripe ?? 0x161920);
  const stripe = new THREE.MeshPhysicalMaterial({
    color: stripeColor,
    metalness: 0.1,
    roughness: 0.24,
    clearcoat: 0.85,
    clearcoatRoughness: 0.1,
    emissive: stripeColor,
    emissiveIntensity: 0.03,
    side: THREE.DoubleSide,
  });
  const shockColor = new THREE.Color(options.stripe ?? 0xff3b2f);
  if (shockColor.r + shockColor.g + shockColor.b < 0.35) shockColor.setHex(0xff4230);
  const shockMat = new THREE.MeshStandardMaterial({ color: shockColor, roughness: 0.26, metalness: 0.45 });

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
    if (key === 'glass') { mesh.renderOrder = 2; mesh.castShadow = false; }
    if (key === 'decal') { mesh.renderOrder = 3; mesh.castShadow = false; }
    bodyRig.add(mesh);
  }

  const wheels = [], steeringRigs = [], glowSprites = [];
  for (const side of [-1, 1]) {
    for (const z of [-1.02, 1.02]) {
      const rear = z > 0;
      const steering = new THREE.Group();
      steering.position.set(side * 0.79, -0.22, z);
      group.add(steering);

      const wheel = new THREE.Group();
      steering.add(wheel);
      wheel.userData.front = !rear;
      wheel.userData.steeringRig = steering;
      for (const [key, geometry] of wheelGeometry(classId, side)) {
        const mesh = makeMesh(geometry, shared[key], `Wheel / ${key}`);
        mesh.castShadow = key === 'rubber';
        wheel.add(mesh);
      }

      const caliper = makeMesh(rounded(0.068, 0.145, 0.105, 0.02, 1), shared.caliper, 'Fixed red brake caliper');
      caliper.position.set(side * 0.075, 0.095, -0.115);
      caliper.rotation.x = -0.36;
      steering.add(caliper);

      wheels.push(wheel);
      if (!rear) steeringRigs.push(steering);

      const glow = new THREE.Sprite(shared.wheelGlow);
      glow.position.set(side * 0.96, -0.22, z);
      glow.scale.set(0.92, 0.92, 1);
      glow.visible = false;
      group.add(glow);
      glowSprites.push(glow);
    }
  }

  const frontLampZ = classId === 'dart' ? -1.58 : classId === 'bruiser' ? -1.73 : -1.70;
  const rearLampZ = classId === 'dart' ? 1.57 : 1.70;
  for (const side of [-1, 1]) {
    const front = new THREE.Sprite(shared.lampGlow);
    front.position.set(side * 0.52, 0.19, frontLampZ);
    front.scale.set(0.45, 0.24, 1);
    bodyRig.add(front);
    const rear = new THREE.Sprite(shared.tailGlow);
    rear.position.set(side * 0.56, 0.20, rearLampZ);
    rear.scale.set(0.42, 0.22, 1);
    bodyRig.add(rear);
  }

  const weaponBaseZ = classId === 'dart' ? -1.60 : classId === 'bruiser' ? -1.84 : -1.74;
  const punch = makePunch(shared, weaponBaseZ, isPlayer ? 0x268cff : 0xe83b38);
  bodyRig.add(punch.group);
  owned.push(punch.face);

  let flyingHead = null;
  const modelFront = vector(0, 0, -1), rocketDir = vector();

  const glowColor = new THREE.Color(options.glow ?? 0x46e4ff);
  const underglowMaterial = new THREE.MeshBasicMaterial({
    map: glowDisc(),
    color: glowColor.clone().multiplyScalar(0.55),
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  owned.push(underglowMaterial);
  const underglow = new THREE.Mesh(cached('underglow-plane', () => new THREE.PlaneGeometry(1, 1)), underglowMaterial);
  underglow.scale.set(3.1, 4.5, 1);
  underglow.renderOrder = 1;
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = -0.6;
  group.add(underglow);
  let glowLevel = 0.5;

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
  shield.scale.set(1.22, 1.0, 1.98);
  shield.position.y = 0.18;
  shield.visible = false;
  group.add(shield);

  let playerRing = null;
  if (isPlayer) {
    playerRing = new THREE.Mesh(cached('player-identification-ring', () => new THREE.RingGeometry(1.18, 1.25, 40)), shared.playerRing);
    playerRing.rotation.x = -Math.PI / 2;
    playerRing.position.y = -0.61;
    playerRing.scale.set(1, 1.54, 1);
    group.add(playerRing);
  }

  const flameRig = new THREE.Group();
  flameRig.position.set(0, -0.15, rearLampZ + 0.04);
  flameRig.visible = false;
  bodyRig.add(flameRig);
  const flameGeometry = cached('paired-turbo-flames', () => {
    const parts = batch();
    const cone = new THREE.ConeGeometry(0.14, 1.05, 8, 1, true);
    for (const side of [-1, 1]) parts.add('flame', cone, [side * 0.42, 0, 0.50], [Math.PI / 2, 0, 0]);
    cone.dispose();
    return parts.finish().get('flame');
  });
  flameRig.add(new THREE.Mesh(flameGeometry, shared.flame));

  const powerRig = new THREE.Group();
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
  let previousSpeed = 0, wasGrounded = true, landingSquash = 0;

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
  group.userData.visualBudget = { triangles: triangleCount, meshes: meshCount, sprites, lines, shadowCasters, bodyLength: 3.4, tireOutsideWidth: 1.86 };

  return {
    group,
    wheels,
    bodyRig,
    glowColor,
    taillights: [vector(-0.52, 0.14, rearLampZ), vector(0.52, 0.14, rearLampZ)],
    setGlove(id) { punch.setGlove(id); },
    setTeam(team) {
      if (team === 'blue') punch.setPadColor(0x268cff);
      else if (team === 'red') punch.setPadColor(0xeb343d);
      else punch.setPadColor(isPlayer ? 0x268cff : 0xe83b38);
    },
    updatePunch(...args) { punch.update(...args); },
    updateRocket(shot) {
      if (!shot) { if (flyingHead) flyingHead.visible = false; punch.head.visible = true; return; }
      if (!flyingHead) { flyingHead = punch.head.clone(true); group.add(flyingHead); }
      punch.head.visible = false;
      flyingHead.visible = true;
      inverseOrientation.copy(group.quaternion).invert();
      flyingHead.position.copy(shot.pos).sub(group.position).applyQuaternion(inverseOrientation);
      rocketDir.copy(shot.dir).applyQuaternion(inverseOrientation);
      flyingHead.quaternion.setFromUnitVectors(modelFront, rocketDir);
    },
    setGlow(active) { for (const glow of glowSprites) glow.visible = Boolean(active); },
    setNight(level = 0) {
      glowLevel = 0.18 + level * 0.95;
      stripe.emissiveIntensity = 0.02 + level * 0.45;
    },
    dispose() {
      for (const material of owned) { material.map?.dispose?.(); material.dispose(); }
      shieldMaterial.dispose();
    },
    updateState(state = {}, dt = 1 / 60) {
      const lift = state.grounded === false ? 0 : 1;
      underglowMaterial.color.copy(glowColor).multiplyScalar(glowLevel * (state.boost ? 1.45 : 1) * (0.2 + 0.8 * lift));
      underglow.visible = state.active !== false && glowLevel > 0.22;
      const numericDt = Number(dt);
      const step = Number.isFinite(numericDt) ? clamp(numericDt, 0, 0.1) : 1 / 60;
      const steer = clamp(Number(state.steer) || 0, -1, 1);
      const speed = Number(state.speed) || 0;
      const time = Number(state.time) || 0;
      const grounded = state.grounded !== false;
      if (grounded && !wasGrounded) landingSquash = 1;
      wasGrounded = grounded;
      landingSquash = Math.max(0, landingSquash - step * 4.5);

      const ease = 1 - Math.exp(-step * 11);
      const acceleration = step > 0 ? clamp((speed - previousSpeed) / step, -12, 12) : 0;
      if (step > 0) previousSpeed = speed;
      const drift = state.drifting ? (Number.isFinite(Number(state.driftAmount)) ? clamp(Number(state.driftAmount), 0, 1) : 0.65) : 0;
      // 富有活力的悬架侧倾与起步抬头（呼应视频急加速前轮微翘、过弯灵动侧倾质感）
      const targetRoll = grounded ? -steer * clamp(Math.abs(speed) / 11, 0, 1) * (0.105 + drift * 0.07) : 0;
      const targetPitch = grounded
        ? clamp(acceleration * 0.0085 - (state.brake ? 0.04 : 0) + (Number(state.throttle) || 0) * 0.022 + (state.boost ? 0.032 : 0), -0.09, 0.105)
        : 0;
      bodyRig.rotation.z += (targetRoll - bodyRig.rotation.z) * ease;
      bodyRig.rotation.x += (targetPitch - bodyRig.rotation.x) * ease;
      const frontSteer = drift > 0.05 ? -steer * (0.30 + drift * 0.30) : steer * 0.44;
      for (const steering of steeringRigs) steering.rotation.y += (frontSteer - steering.rotation.y) * ease;
      const squashOffset = -Math.sin(landingSquash * Math.PI) * 0.085;
      const idleBreath = Math.abs(speed) < 0.5 && grounded ? Math.sin(time * 2.8) * 0.01 : 0;
      bodyRig.position.y += ((grounded ? -0.018 * drift + squashOffset + idleBreath : 0) - bodyRig.position.y) * ease;

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
      punch.head.scale.setScalar(powered ? 1.15 : 1);
      if (powered) {
        powerRig.position.copy(punch.group.position);
        powerRig.position.z += punch.group.visible ? punch.head.position.z - 0.12 : -0.045;
        powerRig.scale.setScalar(punch.group.visible ? 1 : 0.58);
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
