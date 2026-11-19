import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createArena } from './visuals.js';

export const MAPS = [
  { id: 'meadow', look: 'day', night: 0, name: '浮岛草原', title: 'SKY MEADOW', subtitle: '最初的浮空擂台 · 开阔草地', accent: '#dfff35', grip: 1, sky: { zenith: 0x3685cf, horizon: 0xb9e5fa, ground: 0x173558, sunColor: 0xffefd6, sunIntensity: 2.5, ambientIntensity: 0.6 } },
  { id: 'neon', look: 'night', night: 1, name: '霓虹港湾', title: 'NEON HARBOR', subtitle: '集装箱巷道 · 高架码头 · 双跳台', accent: '#53f4e8', grip: 1, sky: { zenith: 0x111629, horizon: 0x433363, ground: 0x060e24, sunColor: 0xbccaff, sunIntensity: 1.4, ambientIntensity: 0.75 } },
  { id: 'mesa', look: 'sunset', night: 0.15, name: '赤岩峡谷', title: 'REDROCK MESA', subtitle: '宽阔漂移线 · 砂岩石柱', accent: '#ffb25a', grip: 0.88, sky: { zenith: 0x718dc6, horizon: 0xf1c895, ground: 0x653c48, sunColor: 0xffcc88, sunIntensity: 2.7, ambientIntensity: 0.6 } },
  { id: 'glacier', look: 'ice', night: 0.42, name: '极光冰港', title: 'AURORA GLACIER', subtitle: '湿滑冰面 · 冰晶山脊 · 极光夜空', accent: '#9aefff', grip: 0.78, sky: { zenith: 0x081e36, horizon: 0x5b8caa, ground: 0x102f57, sunColor: 0xc5eaff, sunIntensity: 1.8, ambientIntensity: 0.8 } },
  { id: 'sakura', look: 'day', night: 0.05, name: '樱庭回廊', title: 'SAKURA COURT', subtitle: '庭园门廊 · 错层平台 · 石砌转角', accent: '#ffaccb', grip: 1.03, sky: { zenith: 0x719bc8, horizon: 0xf5dbe1, ground: 0x5d536c, sunColor: 0xffe6cf, sunIntensity: 2.3, ambientIntensity: 0.7 } },
  { id: 'orbital', look: 'space', night: 0.9, name: '轨道基地', title: 'ORBITAL STATION', subtitle: '反应堆核心 · 弹射跳台 · 无边天际', accent: '#a6a0ff', grip: 0.96, sky: { zenith: 0x040715, horizon: 0x18213d, ground: 0x030510, sunColor: 0xd6e3ff, sunIntensity: 2.1, ambientIntensity: 0.5 } },
];

const TAU = Math.PI * 2;
const ZERO = [0, 0, 0];
const vec = (x, y, z) => new THREE.Vector3(x, y, z);
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const rng = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

function makeBatch(target) {
  const entries = new Map();
  return {
    add(geometry, material, position = ZERO, rotation = ZERO, scale = [1, 1, 1]) {
      const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      const matrix = new THREE.Matrix4().compose(vec(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), vec(...scale));
      copy.applyMatrix4(matrix);
      if (!copy.attributes.uv) copy.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(copy.attributes.position.count * 2), 2));
      if (!entries.has(material)) entries.set(material, []);
      entries.get(material).push(copy); geometry.dispose();
    },
    flush() {
      for (const [material, geometries] of entries) {
        const geometry = mergeGeometries(geometries, false);
        const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; target.add(mesh);
        for (const old of geometries) old.dispose();
      }
      entries.clear();
    },
  };
}

function canvas(size) {
  const image = document.createElement('canvas'); image.width = image.height = size;
  return [image, image.getContext('2d')];
}

function texture(image, repeats = 1) {
  const map = new THREE.CanvasTexture(image); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.setScalar(repeats); map.anisotropy = 8;
  return map;
}

function floorMaterial(id) {
  const S = 1024;
  const [image, ctx] = canvas(S), [rImage, rCtx] = canvas(S), random = rng(0x72fd9 + id.length * 317);
  const palettes = { neon: [34, 46, 62], mesa: [186, 114, 66], glacier: [162, 206, 226], sakura: [164, 178, 170], orbital: [54, 68, 86] };
  const base = palettes[id], data = ctx.createImageData(S, S);
  const rBase = { neon: 118, mesa: 230, glacier: 52, sakura: 205, orbital: 108 }[id];
  const rData = rCtx.createImageData(S, S);
  for (let i = 0; i < data.data.length; i += 4) {
    const noise = (random() - 0.5) * (id === 'mesa' ? 28 : 14);
    data.data[i] = Math.max(0, Math.min(255, base[0] + noise));
    data.data[i + 1] = Math.max(0, Math.min(255, base[1] + noise));
    data.data[i + 2] = Math.max(0, Math.min(255, base[2] + noise * 1.05));
    data.data[i + 3] = 255;
    const rv = Math.max(20, Math.min(250, rBase + (random() - 0.5) * 32));
    rData.data[i] = rData.data[i + 1] = rData.data[i + 2] = rv; rData.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0); rCtx.putImageData(rData, 0, 0);

  if (id === 'neon') {
    // 重工铆钉防滑钢板 + 漂移胎痕 + 霓虹地坪标线
    for (let y = 0; y < S; y += 256) {
      for (let x = 0; x < S; x += 256) {
        ctx.fillStyle = ((x / 256 + y / 256) % 2 === 0) ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(x + 3, y + 3, 250, 250);
        ctx.strokeStyle = '#121924'; ctx.lineWidth = 4; ctx.strokeRect(x + 2, y + 2, 252, 252);
        ctx.strokeStyle = 'rgba(130,210,235,0.16)'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 6, y + 6, 244, 244);
        for (const [rx, ry] of [[18, 18], [238, 18], [18, 238], [238, 238], [128, 18], [128, 238], [18, 128], [238, 128]]) {
          ctx.fillStyle = '#0e141e'; ctx.beginPath(); ctx.arc(x + rx, y + ry, 4.5, 0, TAU); ctx.fill();
          ctx.fillStyle = '#6f8ea6'; ctx.beginPath(); ctx.arc(x + rx - 1, y + ry - 1, 2.2, 0, TAU); ctx.fill();
        }
      }
    }
    ctx.strokeStyle = 'rgba(180,220,245,0.07)'; ctx.lineWidth = 2;
    for (let y = 24; y < S; y += 48) for (let x = 24; x < S; x += 48) {
      ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 24, y - 6); ctx.lineTo(x + 24, y + 6); ctx.stroke();
    }
    for (let k = 0; k < 10; k++) {
      ctx.strokeStyle = `rgba(10,12,18,${0.18 + random() * 0.14})`; ctx.lineWidth = 12 + random() * 14;
      ctx.beginPath(); ctx.arc(random() * S, random() * S, 110 + random() * 200, random() * TAU, random() * TAU); ctx.stroke();
      rCtx.strokeStyle = 'rgba(55,55,55,0.55)'; rCtx.lineWidth = 16;
      rCtx.beginPath(); rCtx.arc(random() * S, random() * S, 90 + random() * 180, 0, TAU); rCtx.stroke();
    }
  } else if (id === 'mesa') {
    ctx.strokeStyle = 'rgba(92,50,30,.22)'; ctx.lineWidth = 2;
    for (let i = 0; i < 160; i++) { const x = random() * S, y = random() * S; ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + 35, y - 14, x + 80, y + 24, x + 130, y + 4); ctx.stroke(); }
    ctx.fillStyle = 'rgba(246,214,155,.32)'; for (let i = 0; i < 36000; i++) ctx.fillRect(random() * S, random() * S, 1.5, 1.5);
    ctx.strokeStyle = 'rgba(65,36,22,.18)'; ctx.lineWidth = 14;
    for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(random() * S, random() * S, 140 + random() * 220, random() * 4, random() * 6); ctx.stroke(); }
  } else if (id === 'glacier') {
    for (let i = 0; i < 48; i++) {
      let x = random() * S, y = random() * S; ctx.strokeStyle = i % 2 ? 'rgba(248,255,255,.65)' : 'rgba(52,130,168,.35)'; ctx.lineWidth = i % 3 ? 1.5 : 3;
      ctx.beginPath(); ctx.moveTo(x, y); for (let j = 0; j < 11; j++) { x += random() * 90 - 40; y += random() * 75 - 25; ctx.lineTo(x, y); } ctx.stroke();
    }
    for (let i = 0; i < 14; i++) {
      const gx = random() * S, gy = random() * S, rad = 40 + random() * 110;
      const g = rCtx.createRadialGradient(gx, gy, 4, gx, gy, rad);
      g.addColorStop(0, 'rgba(18,18,18,0.85)'); g.addColorStop(1, 'rgba(90,90,90,0)');
      rCtx.fillStyle = g; rCtx.fillRect(gx - rad, gy - rad, rad * 2, rad * 2);
    }
  } else if (id === 'sakura') {
    ctx.strokeStyle = '#6c7c74'; ctx.lineWidth = 4;
    for (let y = 0; y < S; y += 128) for (let x = -128; x < S; x += 256) {
      const ox = x + (y % 256 ? 128 : 0);
      ctx.fillStyle = `rgba(255,255,255,${(random() - 0.5) * 0.06})`; ctx.fillRect(ox + 2, y + 2, 252, 124);
      ctx.strokeRect(ox, y, 256, 128);
    }
    ctx.fillStyle = 'rgba(75,112,60,.18)'; for (let i = 0; i < 11000; i++) ctx.fillRect(random() * S, random() * S, 1 + random() * 4, 1.5);
  } else {
    ctx.strokeStyle = 'rgba(155,192,216,.48)'; ctx.lineWidth = 3;
    for (let y = -60; y < S + 60; y += 72) for (let x = -60; x < S + 60; x += 84) {
      const ox = x + (Math.round(y / 72) % 2 ? 42 : 0); ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; const px = ox + Math.cos(a) * 46, py = y + Math.sin(a) * 46; if (!k) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.closePath(); ctx.stroke();
      ctx.fillStyle = 'rgba(125,180,235,0.22)'; ctx.fillRect(ox - 2, y - 2, 4, 4);
    }
  }
  const rep = id === 'orbital' ? 4 : id === 'mesa' ? 5 : 4;
  const map = texture(image, rep);
  const roughnessMap = texture(rImage, rep); roughnessMap.colorSpace = THREE.NoColorSpace;
  const bumpMap = map.clone(); bumpMap.colorSpace = THREE.NoColorSpace;
  const roughness = { neon: 0.62, mesa: 0.96, glacier: 0.24, sakura: 0.86, orbital: 0.48 }[id];
  return mat(0xffffff, { map, roughnessMap, bumpMap, bumpScale: id === 'glacier' ? 0.03 : 0.065, roughness, metalness: id === 'orbital' ? 0.48 : id === 'neon' ? 0.34 : 0.05 });
}

function glowing(color, intensity = 0.7) { return mat(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.35, metalness: 0.2 }); }

function makeThemeArena(parent, world, groundMaterial, descriptor) {
  const platform = new THREE.Group(), scenery = new THREE.Group(); parent.add(platform, scenery);
  platform.name = `${descriptor.title} / PLAYABLE`; scenery.name = `${descriptor.title} / SCENERY`;
  const staticBatch = makeBatch(platform), distantBatch = makeBatch(scenery), records = [], dynamicProps = [], animated = [];
  const accent = new THREE.Color(descriptor.accent);
  const dark = mat(0x243241, { metalness: 0.22 }), white = mat(0xdce5df), warm = mat(0xeab55c);
  const sideColors = { neon: 0x21354a, mesa: 0x985139, glacier: 0x5c8fae, sakura: 0x716e71, orbital: 0x2a3248 };
  const side = mat(sideColors[descriptor.id], { roughness: descriptor.id === 'glacier' ? 0.3 : 0.9 });
  let halfSize = 24, shrinking = false;

  function solidBox(size, position, material = dark, rotation = ZERO) {
    staticBatch.add(new THREE.BoxGeometry(...size), material, position, rotation);
    const body = new CANNON.Body({ mass: 0, material: groundMaterial, collisionFilterGroup: 1, collisionFilterMask: -1 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
    body.position.set(...position); body.quaternion.setFromEuler(...rotation); world.addBody(body);
    records.push({ body, type: 'box', size: [...size], position: [...position] }); return body;
  }
  function solidCylinder(radius, height, position, material = side, segments = 12) {
    staticBatch.add(new THREE.CylinderGeometry(radius, radius, height, segments), material, position);
    const body = new CANNON.Body({ mass: 0, material: groundMaterial, collisionFilterGroup: 1, collisionFilterMask: -1 });
    body.addShape(new CANNON.Cylinder(radius, radius, height, segments)); body.position.set(...position); world.addBody(body);
    records.push({ body, type: 'cylinder', radius, height, segments, position: [...position] }); return body;
  }
  function artBox(size, position, material = dark, rotation = ZERO, distant = false) { (distant ? distantBatch : staticBatch).add(new THREE.BoxGeometry(...size), material, position, rotation); }
  function ramp(x, z, width, length, rise, yaw = 0, material = side) {
    const angle = Math.atan2(rise, length), slopeLength = Math.hypot(length, rise), y = rise / 2 - Math.cos(angle) * 0.17;
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, 0, 0)));
    const euler = new THREE.Euler().setFromQuaternion(quaternion), rotation = [euler.x, euler.y, euler.z];
    solidBox([width, 0.34, slopeLength], [x, y, z], material, rotation);
    for (const edge of [-1, 1]) {
      const p = vec(edge * (width / 2 - 0.1), 0.185, 0).applyQuaternion(quaternion).add(vec(x, y, z));
      artBox([0.13, 0.02, slopeLength * 0.98], p.toArray(), glowing(accent, 0.35), rotation);
    }
    for (const edge of [-1, 1]) {
      const p = vec(edge * 0.36, 0.19, 0.1).applyQuaternion(quaternion).add(vec(x, y, z));
      const arrowQ = quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, edge * 0.7, 0)));
      const arrowE = new THREE.Euler().setFromQuaternion(arrowQ);
      artBox([0.18, 0.025, 1.2], p.toArray(), white, [arrowE.x, arrowE.y, arrowE.z]);
    }
  }
  function paintRing(x, z, radius, color = descriptor.accent, width = 0.08) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + width, 72), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.027, z); platform.add(ring);
  }
  function movableCrate(x, z, color) {
    const mesh = new THREE.Group(), b = makeBatch(mesh), paint = mat(color, { roughness: 0.62, metalness: 0.22 });
    b.add(new THREE.BoxGeometry(1.05, 1.05, 1.05), paint);
    for (const s of [-1, 1]) { b.add(new THREE.BoxGeometry(1.09, 0.09, 1.09), dark, [0, s * 0.44, 0]); b.add(new THREE.BoxGeometry(0.1, 1.09, 1.09), dark, [s * 0.44, 0, 0]); }
    b.flush(); parent.add(mesh);
    const body = new CANNON.Body({ mass: 22, material: groundMaterial, collisionFilterGroup: 4, collisionFilterMask: -1, linearDamping: 0.15, angularDamping: 0.3 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.525, 0.525, 0.525))); body.position.set(x, 0.56, z); world.addBody(body);
    dynamicProps.push({ body, mesh, start: body.position.clone(), baseStart: body.position.clone() });
  }
  function distantIsland(x, y, z, radius, height, material = side, top = null) {
    distantBatch.add(new THREE.CylinderGeometry(radius, radius * 0.22, height, 7), material, [x, y - height / 2, z]);
    if (top) distantBatch.add(new THREE.CylinderGeometry(radius, radius, 0.22, 7), top, [x, y + 0.05, z]);
  }

  const floor = solidBox([48, 1.5, 48], [0, -0.75, 0], side);
  // The textured top is visual-only; the finite solid box remains the exact floor.
  const top = new THREE.Mesh(new THREE.PlaneGeometry(48, 48), floorMaterial(descriptor.id)); top.rotation.x = -Math.PI / 2; top.position.y = 0.003; top.receiveShadow = true; platform.add(top);
  const edgeLights = [];
  const border = mat(0x24303b), borderLight = mat(accent, { emissive: accent, emissiveIntensity: 0.2 });
  for (let i = 0; i < 4; i++) {
    const alongX = i < 2, sign = i % 2 ? 1 : -1;
    artBox(alongX ? [47.8, 0.035, 0.65] : [0.65, 0.035, 47.8], alongX ? [0, 0.027, sign * 23.62] : [sign * 23.62, 0.027, 0], border);
    for (let p = -23; p <= 23; p += 1.35) artBox([0.48, 0.018, 0.55], alongX ? [p, 0.054, sign * 23.62] : [sign * 23.62, 0.054, p], borderLight, [0, alongX ? 0.28 : 1.29, 0]);
    const material = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(...(alongX ? [47.85, 0.045, 0.08] : [0.08, 0.045, 47.85])), material);
    strip.position.set(...(alongX ? [0, 0.075, sign * 23.9] : [sign * 23.9, 0.075, 0])); platform.add(strip);
    edgeLights.push({ axis: alongX ? 'z' : 'x', sign, material });
  }
  const c = { descriptor, platform, scenery, staticBatch, distantBatch, solidBox, solidCylinder, artBox, ramp, paintRing, movableCrate, distantIsland, animated, dark, white, warm, side, accent };
  ({ neon: buildNeon, mesa: buildMesa, glacier: buildGlacier, sakura: buildSakura, orbital: buildOrbital })[descriptor.id](c);
  staticBatch.flush(); distantBatch.flush();
  // Skyline, distant islands and orbital scenery never shadow the playfield.
  scenery.traverse(object=>{object.castShadow=false;object.receiveShadow=false;});
  const arena = {
    get halfSize() { return halfSize; }, dynamicProps, floor,
    setRound(round = 1, total = 6, shrink = 0) {
      shrinking = shrink > 0;
      halfSize = 24 * Math.pow(17 / 24, Math.min(1, Math.max(0, (round - 1) / Math.max(1, total - 1)))) * (1 - .28 * shrink);
      const scale = halfSize / 24; platform.scale.setScalar(scale);
      for (const record of records) {
        const b = record.body; b.position.set(...record.position.map(n => n * scale));
        if (record.type === 'box') { const shape = b.shapes[0]; shape.halfExtents.set(...record.size.map(n => n * scale / 2)); shape.updateConvexPolyhedronRepresentation(); shape.updateBoundingSphereRadius(); }
        else { b.removeShape(b.shapes[0]); b.addShape(new CANNON.Cylinder(record.radius * scale, record.radius * scale, record.height * scale, record.segments)); }
        b.updateBoundingRadius(); b.aabbNeedsUpdate = true; b.updateAABB(); b.previousPosition.copy(b.position); b.interpolatedPosition.copy(b.position);
      }
      for (const p of dynamicProps) {
        p.start.set(p.baseStart.x * scale, p.baseStart.y, p.baseStart.z * scale);
        if (shrinking) continue;
        p.body.position.copy(p.start); p.body.quaternion.set(0, 0, 0, 1);
        p.body.velocity.setZero(); p.body.angularVelocity.setZero(); p.body.force.setZero(); p.body.torque.setZero(); p.body.aabbNeedsUpdate = true; p.body.wakeUp();
        p.mesh.position.copy(p.body.position); p.mesh.quaternion.copy(p.body.quaternion);
      }
      if (world.broadphase) world.broadphase.dirty = true;
      return halfSize;
    },
    update(dt, time, player) {
      for (const edge of edgeLights) {
        const distance = player?.body?.position ? halfSize - player.body.position[edge.axis] * edge.sign : 10;
        const danger = shrinking ? 1 : Math.min(1, Math.max(0, (4 - distance) / 4));
        if (danger) edge.material.color.set(0xff382f); else edge.material.color.copy(accent);
        edge.material.color.multiplyScalar(1 + danger * (0.6 + Math.sin(time * 12) * 0.45));
      }
      for (const p of dynamicProps) {
        if (p.body.position.y < -30) { p.body.position.copy(p.start); p.body.velocity.setZero(); p.body.angularVelocity.setZero(); p.body.quaternion.set(0, 0, 0, 1); p.body.aabbNeedsUpdate = true; p.body.wakeUp(); }
        p.mesh.position.copy(p.body.position); p.mesh.quaternion.copy(p.body.quaternion);
      }
      for (const callback of animated) callback(dt, time);
    },
  };
  arena.setRound(1, 6); return arena;
}

function buildNeon(c) {
  const { solidBox, artBox, ramp, distantBatch, staticBatch, movableCrate, paintRing, dark, white, side } = c;
  const cyan = glowing(0x5de5df, 0.8), purple = glowing(0xa17be9, 0.65), cargoA = mat(0x338b9d, { metalness: 0.35 }), cargoB = mat(0x795b9d, { metalness: 0.3 });
  for (const [x, z, material, yaw] of [[-7, -1, cargoA, 0.18], [7, 2, cargoB, -0.25]]) {
    solidBox([3.4, 2.7, 7.2], [x, 1.35, z], material, [0, yaw, 0]);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    for (const edge of [-1, 1]) for (let n = -3.2; n <= 3.2; n += 0.48) {
      const p = vec(edge * 1.73, 0, n).applyQuaternion(q).add(vec(x, 1.35, z)); artBox([0.08, 2.5, 0.09], p.toArray(), dark, [0, yaw, 0]);
    }
    const top = vec(0, 2.72, 0).add(vec(x, 0, z)); artBox([3.45, 0.06, 7.2], top.toArray(), material, [0, yaw, 0]);
  }
  for (const x of [-15, 15]) {
    solidBox([6.4, 1.7, 6.5], [x, 0.85, -20.75], side);
    ramp(x, -14, 5.2, 7, 1.7, 0, mat(0x627a86, { metalness: 0.25 }));
    artBox([6.25, 0.04, 0.18], [x, 1.73, -23.7], cyan);
  }
  for (const x of [-2.7, 2.7]) artBox([0.12, 0.018, 37], [x, 0.025, 0], cyan);
  paintRing(0, 10, 4.1, '#a9e8e7');
  movableCrate(-2, -9, 0x45a5af); movableCrate(3, 8, 0xb684d4);
  // Harbor pylons and cranes are scenery, outside the collision platform.
  for (const sign of [-1, 1]) {
    artBox([7, 1.2, 44], [sign * 35, -4, -4], side, ZERO, true);
    for (const z of [-24, -5, 14]) {
      artBox([1, 14, 1], [sign * 35, 2.5, z], dark, ZERO, true);
      artBox([14, 0.9, 0.9], [sign * 29, 9.5, z], dark, ZERO, true);
      artBox([0.09, 7, 0.09], [sign * 23, 5.8, z], white, ZERO, true);
      artBox([3, 0.08, 0.18], [sign * 35, 9.98, z], purple, ZERO, true);
    }
  }
  for (let n = 0; n < 11; n++) {
    const x = (n - 5) * 10, h = 9 + ((n * 7) % 5) * 4;
    artBox([6.5, h, 7], [x, h / 2 - 8, -68], mat(n % 2 ? 0x354967 : 0x29354f), ZERO, true);
    for (let y = -3; y < h - 9; y += 2.7) artBox([4.6, 0.35, 0.08], [x, y, -64.45], n % 2 ? cyan : purple, ZERO, true);
  }
  const [waterCanvas, waterCtx] = canvas(256); waterCtx.fillStyle = '#10283b'; waterCtx.fillRect(0, 0, 256, 256);
  for (let y = 2; y < 256; y += 8) { waterCtx.fillStyle = y % 16 ? 'rgba(73,155,170,.15)' : 'rgba(138,105,176,.14)'; waterCtx.fillRect(0, y, 256, 2); }
  const water = new THREE.Mesh(new THREE.CircleGeometry(140, 64), mat(0xffffff, { map: texture(waterCanvas, 12), roughness: 0.25, metalness: 0.38 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -26; c.scenery.add(water);
  c.animated.push((dt) => { water.material.map.offset.x += dt * 0.006; });
  staticBatch.add(new THREE.BoxGeometry(45, 1.2, 45), dark, [0, -2.1, 0]);
  distantBatch.add(new THREE.BoxGeometry(9, 3, 18), cargoA, [48, -22, 28], [0, -0.3, 0]);
}

function buildMesa(c) {
  const { solidBox, solidCylinder, artBox, ramp, staticBatch, distantBatch, distantIsland, movableCrate, paintRing } = c;
  const sandstone = mat(0xb76743, { roughness: 1, flatShading: true }), lightStone = mat(0xda975e, { roughness: 0.95, flatShading: true }), darkStone = mat(0x713d3b, { roughness: 1 });
  for (const [x, z, radius, height] of [[-6, -5, 2.25, 4.8], [8, 3, 1.6, 3.5], [-18, -17, 2.2, 5.4], [18, 16, 1.8, 4.3]]) {
    solidCylinder(radius, height, [x, height / 2, z], sandstone, 7);
    staticBatch.add(new THREE.CylinderGeometry(radius * 1.08, radius * 1.04, 0.25, 7), lightStone, [x, height - 0.12, z]);
    staticBatch.add(new THREE.CylinderGeometry(radius * 1.015, radius * 1.015, 0.12, 7), darkStone, [x, height * 0.4, z]);
  }
  solidBox([3.4, 1.8, 5], [-19, 0.9, 14.8], sandstone);
  ramp(-19, 8.8, 3.4, 7, 1.8, Math.PI, lightStone);
  // A second low diagonal rock shelf changes approach lines without filling the drift bowl.
  solidBox([5.6, 0.72, 2.1], [6, 0.36, -10.5], lightStone, [0, -0.48, 0]);
  paintRing(0, 4, 6.6, '#f5d2a0', 0.12);
  for (const x of [-3, 3]) artBox([0.12, 0.018, 8], [x, 0.025, 13], mat(0xe9b877));
  movableCrate(-4, 9, 0xb69054); movableCrate(11, -2, 0x9a7953);
  const cactus = mat(0x557c63, { roughness: 1 }), cactusDark = mat(0x355d50);
  for (const [x, z] of [[-20, 1], [19, -17], [3, 20]]) {
    solidCylinder(0.35, 2.5, [x, 1.25, z], cactus, 8);
    artBox([1.4, 0.28, 0.28], [x + 0.5, 1.6, z], cactus);
    artBox([0.3, 1.2, 0.3], [x + 1.1, 2.05, z], cactusDark);
  }
  staticBatch.add(new THREE.CylinderGeometry(33.5, 11, 14, 4, 3), darkStone, [0, -8.2, 0], [0, Math.PI / 4, 0]);
  for (const [x, y, z, r, h] of [[-58, -8, -35, 12, 22], [55, -12, -50, 17, 30], [6, -16, 68, 15, 26], [-64, -20, 42, 10, 18]]) {
    distantIsland(x, y, z, r, h, sandstone, lightStone);
    distantBatch.add(new THREE.CylinderGeometry(r * 0.5, r * 0.75, 9, 7), sandstone, [x, y + 4.5, z]);
  }
  // A distant natural arch has no hidden collision and frames the open canyon.
  artBox([7, 20, 7], [-28, 0, -63], sandstone, ZERO, true); artBox([7, 20, 7], [-5, 0, -63], sandstone, ZERO, true);
  artBox([30, 5.5, 7.5], [-16.5, 10, -63], lightStone, [0, 0, 0.04], true);
}

function buildGlacier(c) {
  const { solidBox, solidCylinder, artBox, ramp, staticBatch, distantBatch, movableCrate, paintRing, scenery } = c;
  const ice = new THREE.MeshPhysicalMaterial({ color: 0x81b8cf, roughness: 0.22, metalness: 0.1, clearcoat: 0.8 }), snow = mat(0xdceaf0, { roughness: 0.92 }), deep = mat(0x416f9b, { roughness: 0.4 });
  solidBox([10, 0.72, 1.1], [-7, 0.36, 0], ice, [0, 0.55, 0]);
  solidBox([8.2, 0.9, 1.25], [6, 0.45, -9], ice, [0, -0.4, 0]);
  solidCylinder(1.35, 2.8, [3, 1.4, 4], ice, 6);
  staticBatch.add(new THREE.ConeGeometry(1.36, 1.5, 6), snow, [3, 3.55, 4]);
  ramp(-15.5, -16, 4.4, 7, 1.8, 0, ice);
  solidBox([4.6, 1.8, 3], [-15.5, 0.9, -21], ice);
  paintRing(0, 3.8, 6.5, '#e2faff', 0.13);
  paintRing(0, 3.8, 6.9, '#578baf', 0.06);
  movableCrate(10, 2, 0x6c9cba); movableCrate(-6, -10, 0x91bcd1);
  for (const [x, z] of [[-20, 16], [20, -18], [15, 19]]) {
    solidCylinder(0.6, 1.8, [x, 0.9, z], deep, 6);
    staticBatch.add(new THREE.ConeGeometry(0.9, 3, 6), ice, [x, 2.9, z]);
  }
  staticBatch.add(new THREE.CylinderGeometry(33.5, 17, 12, 4, 4), deep, [0, -7.2, 0], [0, Math.PI / 4, 0]);
  const random = rng(8187);
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU, r = 65 + random() * 25, h = 12 + random() * 25;
    distantBatch.add(new THREE.ConeGeometry(9 + random() * 7, h, 5), i % 3 ? snow : deep, [Math.sin(a) * r, h / 2 - 22, Math.cos(a) * r], [0, a, 0]);
  }
  // Two translucent aurora curtains, each a single vertex-colored draw call.
  for (let band = 0; band < 2; band++) {
    const vertices = [], colors = [], indices = [];
    for (let i = 0; i <= 64; i++) {
      const x = -75 + i / 64 * 150, z = -78 + Math.sin(i * 0.12 + band) * 13, y = 25 + Math.sin(i * 0.19 + band) * 5;
      vertices.push(x, y, z, x, y + 12 + Math.sin(i * 0.13) * 4, z);
      const low = new THREE.Color(band ? 0x85b4ff : 0x54efbf), high = new THREE.Color(band ? 0x996be8 : 0x57a1b7);
      colors.push(low.r, low.g, low.b, high.r, high.g, high.b);
      if (i) { const k = i * 2; indices.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: band ? 0.18 : 0.28, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    const aurora = new THREE.Mesh(geometry, material); scenery.add(aurora); c.animated.push((dt, time) => { aurora.position.y = Math.sin(time * 0.09 + band) * 1.7; });
  }
}

function buildSakura(c) {
  const { solidBox, solidCylinder, artBox, ramp, staticBatch, distantBatch, distantIsland, movableCrate, paintRing, dark } = c;
  const stone = mat(0x898d87), lightStone = mat(0xd2cbc0), wood = mat(0x78443c), red = mat(0xc9544c), green = mat(0x557861), pink = mat(0xe9a6c2, { roughness: 0.9, flatShading: true }), palePink = mat(0xf1c2d2, { roughness: 0.9, flatShading: true });
  // Off-center paired terraces create distinct curved approaches through the garden.
  solidBox([6, 0.7, 4], [-6, 0.35, 3], lightStone); ramp(-6, 7.5, 4.8, 5, 0.7, 0, stone);
  solidBox([6, 0.9, 4], [7.5, 0.45, -13], lightStone); ramp(7.5, -8.5, 4.8, 5, 0.9, 0, stone);
  for (const x of [-4.2, 4.2]) solidCylinder(0.32, 5.1, [x, 2.55, -5], red, 10);
  solidBox([10.4, 0.38, 0.6], [0, 4.6, -5], red);
  solidBox([11.2, 0.42, 0.75], [0, 5.15, -5], dark);
  artBox([0.65, 1.15, 0.1], [0, 4.6, -4.6], wood);
  for (const [x, z, h] of [[-17.5, -1, 4.2], [17, 2, 4.6], [-19, 18, 4.2]]) {
    solidCylinder(0.38, h, [x, h / 2, z], wood, 8);
    artBox([3, 0.2, 0.2], [x, h - 0.6, z], wood, [0, 0, 0.2]);
    for (let j = 0; j < 5; j++) staticBatch.add(new THREE.IcosahedronGeometry(j ? 1.65 : 2.3, 1), j % 2 ? pink : palePink, [x + Math.sin(j * 1.7) * 1.6, h + 0.7 + Math.cos(j * 2) * 0.4, z + Math.cos(j * 1.7) * 1.4], [0, j, 0], [1.1, 0.7, 1]);
  }
  for (const [x, z] of [[-12, -16], [16, 16], [-18, 17]]) {
    solidBox([1.4, 0.25, 1.4], [x, 0.125, z], stone); solidBox([0.55, 1.1, 0.55], [x, 0.8, z], stone);
    artBox([0.8, 0.6, 0.8], [x, 1.55, z], glowing(0xf5d998, 0.2)); staticBatch.add(new THREE.ConeGeometry(0.9, 0.45, 4), dark, [x, 2.08, z], [0, Math.PI / 4, 0]);
  }
  paintRing(1, 5, 4.6, '#c3bdaa'); movableCrate(-1, -11, 0xb5866d); movableCrate(8, 9, 0x927766);
  const random = rng(61573);
  // Fallen petals are one merged ground decal draw, not hundreds of objects.
  for (let i = 0; i < 160; i++) {
    const x = -20 + random() * 40, z = -20 + random() * 40;
    staticBatch.add(new THREE.CircleGeometry(0.045 + random() * 0.06, 5), pink, [x, 0.022, z], [-Math.PI / 2, 0, random() * TAU], [1.5, 1, 1]);
  }
  staticBatch.add(new THREE.CylinderGeometry(33.6, 12, 11, 4, 3), stone, [0, -6.8, 0], [0, Math.PI / 4, 0]);
  for (const [x, y, z, r] of [[-53, -5, -35, 10], [48, -10, -54, 14], [-30, -13, 58, 11]]) {
    distantIsland(x, y, z, r, 13, stone, green);
    for (let j = 0; j < 3; j++) {
      distantBatch.add(new THREE.CylinderGeometry(0.3, 0.5, 4, 7), wood, [x + (j - 1) * 4, y + 2, z]);
      distantBatch.add(new THREE.IcosahedronGeometry(3.5, 1), pink, [x + (j - 1) * 4, y + 5, z], ZERO, [1.2, 0.6, 1]);
    }
  }
  // A remote pavilion gives the gate a destination without introducing collisions.
  artBox([12, 1, 9], [0, -3, -58], stone, ZERO, true);
  for (const x of [-4.5, 4.5]) for (const z of [-61, -55]) artBox([0.4, 7, 0.4], [x, 0.8, z], red, ZERO, true);
  distantBatch.add(new THREE.ConeGeometry(9, 3, 4), dark, [0, 5.5, -58], [0, Math.PI / 4, 0], [1, 1, 0.8]);
}

function buildOrbital(c) {
  const { solidBox, solidCylinder, artBox, ramp, staticBatch, distantBatch, movableCrate, paintRing, platform, scenery, dark, white } = c;
  const metal = mat(0x6c7e94, { metalness: 0.65, roughness: 0.42 }), light = glowing(0x9e9cff, 0.75), cyan = glowing(0x66d9e4, 0.6), black = mat(0x20273a, { metalness: 0.45 });
  solidCylinder(2.35, 3.6, [0, 1.8, 0], metal, 16);
  staticBatch.add(new THREE.CylinderGeometry(2.48, 2.48, 0.23, 24), dark, [0, 0.2, 0]);
  staticBatch.add(new THREE.CylinderGeometry(2.42, 2.42, 0.22, 24), light, [0, 3.5, 0]);
  const reactor = new THREE.Group(); reactor.position.set(0, 2, 0); platform.add(reactor);
  for (let i = 0; i < 3; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.055, 6, 48), light); ring.rotation.set(Math.PI / 2, i * 0.3, i * 0.4); ring.position.y = (i - 1) * 0.7; reactor.add(ring); }
  c.animated.push((dt, time) => { reactor.rotation.y = time * 0.22; });
  ramp(-13, 0, 5, 7, 2, Math.PI / 2, metal); ramp(13, 0, 5, 7, 2, -Math.PI / 2, metal);
  for (const [x, z] of [[-17.8, -17.8], [17.8, 17.8]]) {
    solidBox([5, 2.3, 5], [x, 1.15, z], metal);
    artBox([4.3, 0.08, 0.08], [x, 2.18, z + 2.53], cyan);
    artBox([2.5, 0.72, 0.06], [x, 1.35, z + 2.54], black);
  }
  solidBox([4.5, 0.7, 1.1], [-6, 0.35, 8], metal, [0, 0.3, 0]);
  solidBox([4.5, 0.7, 1.1], [6, 0.35, -8], metal, [0, -0.3, 0]);
  paintRing(0, 0, 7.6, '#a4b9dd', 0.1);
  for (const x of [-4, 4]) artBox([0.14, 0.018, 44], [x, 0.026, 0], cyan);
  movableCrate(-8, -5, 0x73849e); movableCrate(8, 6, 0x8a7fa8);
  // Structure underneath reads as a station rather than another natural island.
  staticBatch.add(new THREE.CylinderGeometry(28, 18, 4, 8), black, [0, -3.3, 0]);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU; staticBatch.add(new THREE.CylinderGeometry(1.1, 1.6, 4, 12), metal, [Math.sin(a) * 20, -6, Math.cos(a) * 20]);
    staticBatch.add(new THREE.CylinderGeometry(1.2, 1.2, 0.08, 16), cyan, [Math.sin(a) * 20, -8, Math.cos(a) * 20]);
  }
  const starPositions = [], random = rng(0x617ca);
  for (let i = 0; i < 280; i++) { const a = random() * TAU, y = random() * 1.7 - 0.45, r = Math.sqrt(Math.max(0, 1 - y * y)); starPositions.push(Math.cos(a) * r * 155, y * 115, Math.sin(a) * r * 155); }
  const starsGeometry = new THREE.BufferGeometry(); starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  scenery.add(new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0xdceaff, size: 0.4, sizeAttenuation: true, fog: false, toneMapped: false })));
  const planet = new THREE.Mesh(new THREE.SphereGeometry(22, 40, 24), new THREE.MeshStandardMaterial({ color: 0x637eae, emissive: 0x18203a, emissiveIntensity: 0.3, roughness: 0.95, fog: false }));
  planet.position.set(-55, 26, -82); scenery.add(planet);
  const rings = new THREE.Mesh(new THREE.RingGeometry(27, 35, 96), new THREE.MeshBasicMaterial({ color: 0xb7aec5, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  rings.position.copy(planet.position); rings.rotation.set(1.04, -0.3, 0.2); scenery.add(rings);
  distantBatch.add(new THREE.SphereGeometry(8, 20, 12), mat(0xaaa2b1, { roughness: 1 }), [65, 5, -62]);
  for (const sign of [-1, 1]) { artBox([7, 0.8, 40], [sign * 47, -4, 8], metal, ZERO, true); for (const z of [-4, 13, 29]) artBox([15, 0.1, 11], [sign * 47, -3.5, z], mat(0x253657, { metalness: 0.5 }), [0, 0, sign * 0.2], true); }
}

/**
 * Only the selected arena contributes physics bodies or visible geometry.
 * Arenas are built once on first selection and retained for bounded switching.
 * Vehicle bodies belong to the caller and are never removed or changed here.
 */
export function createMapManager(scene, world, groundMaterial) {
  const cache = new Map();
  let active = null, round = 1, totalRounds = 6, visible = true;

  let enabled = true;
  function deactivate() {
    if (!active || !enabled) return;
    enabled = false; active.group.visible = false;
    for (const body of active.bodies) if (world.bodies.includes(body)) world.removeBody(body);
    if (world.broadphase) world.broadphase.dirty = true;
  }
  function setMap(id) {
    const descriptor = MAPS.find(map => map.id === id) || MAPS[0];
    if (active?.descriptor.id === descriptor.id && enabled) return descriptor;
    if (active?.descriptor.id === descriptor.id && !enabled) {
      enabled = true; active.group.visible = visible;
      for (const body of active.bodies) if (!world.bodies.includes(body)) world.addBody(body);
      active.arena.setRound(round, totalRounds);
      if (world.broadphase) world.broadphase.dirty = true;
      return descriptor;
    }
    enabled = true;
    if (active) {
      active.group.visible = false;
      for (const body of active.bodies) if (body.world === world || world.bodies.includes(body)) world.removeBody(body);
    }
    let entry = cache.get(descriptor.id);
    if (!entry) {
      const before = new Set(world.bodies), group = new THREE.Group();
      group.name = `MAP / ${descriptor.title}`; group.visible = false; scene.add(group);
      const arena = descriptor.id === 'meadow' ? createArena(group, world, groundMaterial) : makeThemeArena(group, world, groundMaterial, descriptor);
      const bodies = world.bodies.filter(body => !before.has(body));
      entry = { descriptor, group, arena, bodies, floor: arena.floor || bodies[0] }; cache.set(descriptor.id, entry);
    } else {
      for (const body of entry.bodies) if (!world.bodies.includes(body)) world.addBody(body);
    }
    active = entry; active.group.visible = visible; active.arena.setRound(round, totalRounds);
    if (world.broadphase) world.broadphase.dirty = true;
    return descriptor;
  }

  function spawnSafe(x, z, radius = 2) {
    if (!active || Math.abs(x) + radius > active.arena.halfSize - 0.3 || Math.abs(z) + radius > active.arena.halfSize - 0.3) return false;
    for (const body of active.bodies) {
      if (body === active.floor || body.collisionFilterMask === 0) continue;
      if (body.aabbNeedsUpdate) body.updateAABB();
      const a = body.aabb;
      if (a.upperBound.y < 0.1 || a.lowerBound.y > 2) continue;
      if (x + radius > a.lowerBound.x && x - radius < a.upperBound.x && z + radius > a.lowerBound.z && z - radius < a.upperBound.z) return false;
    }
    return true;
  }

  const manager = {
    setMap, deactivate,
    get group() { return active.group; },
    get bodies() { return active.bodies; },
    get id() { return active.descriptor.id; },
    get descriptor() { return active.descriptor; },
    get halfSize() { return active.arena.halfSize; },
    get dynamicProps() { return active.arena.dynamicProps; },
    get spawnPoints() {
      return Array.from({ length: 6 }, (_, index) => { const yaw = index * Math.PI / 3, r = active.arena.halfSize * 0.62; return { x: Math.sin(yaw) * r, z: Math.cos(yaw) * r, yaw }; });
    },
    spawnSafe,
    setVisible(value) { visible = !!value; if (active && enabled) active.group.visible = visible; },
    setRound(nextRound = 1, total = 6, shrink = 0) { round = nextRound; totalRounds = total; return active.arena.setRound(round, totalRounds, shrink); },
    update(dt, time, player) { active?.arena.update(dt, time, player); },
    diagnostics() {
      const geometries = new Set(), materials = new Set(), textures = new Set();
      const worldSet = new Set(world.bodies); let inactiveBodiesInWorld = 0, visibleMapGroups = 0;
      const bodyCounts = {};
      for (const [id, entry] of cache) {
        bodyCounts[id] = entry.bodies.length; if (entry.group.visible) visibleMapGroups++;
        if (entry !== active) inactiveBodiesInWorld += entry.bodies.filter(body => worldSet.has(body)).length;
        entry.group.traverse(object => {
          if (object.geometry) geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
            materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
          }
        });
      }
      return { id: active.descriptor.id, halfSize: active.arena.halfSize, cachedMaps: cache.size, bodyCounts, activeMapBodies: active.bodies.length, activeBodiesInWorld: active.bodies.filter(body => worldSet.has(body)).length, inactiveBodiesInWorld, worldBodies: world.bodies.length, visibleMapGroups, visible, cachedResources: { geometries: geometries.size, materials: materials.size, textures: textures.size } };
    },
  };
  setMap('meadow'); return manager;
}

