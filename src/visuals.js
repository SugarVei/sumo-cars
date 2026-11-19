import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export { createCarVisual } from './car-visual.js';

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, flatShading: true, ...extra });
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const zero = [0, 0, 0];

// Merge immobile decoration by material so the detailed scene stays inexpensive.
function batch(target) {
  const materials = new Map();
  return {
    add(geometry, material, position = zero, rotation = zero, scale = [1, 1, 1]) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      const matrix = new THREE.Matrix4().compose(v(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), v(...scale));
      g.applyMatrix4(matrix);
      // Keep a uniform attribute set for boxes, cylinders, and custom panels.
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!materials.has(material)) materials.set(material, []);
      materials.get(material).push(g);
      geometry.dispose();
    },
    flush() {
      for (const [material, geometries] of materials) {
        const merged = mergeGeometries(geometries, false);
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        target.add(mesh);
        geometries.forEach((g) => g.dispose());
      }
      materials.clear();
    },
  };
}

function seededRandom(initial) {
  let state = initial >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTexture(canvas, repeat = [1, 1], color = true) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function textureCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return [canvas, canvas.getContext('2d')];
}

function texturedGround() {
  const [canvas, ctx] = textureCanvas(1024);
  const rng = seededRandom(78231);
  const field = new Float32Array(64);
  for (let i = 0; i < field.length; i++) field[i] = rng() * 2 - 1;
  const patchNoise = (x, y) => {
    const gx = x / 128, gy = y / 128, ix = Math.floor(gx), iy = Math.floor(gy);
    let tx = gx - ix, ty = gy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = field[(iy % 8) * 8 + (ix % 8)], b = field[(iy % 8) * 8 + ((ix + 1) % 8)];
    const c = field[((iy + 1) % 8) * 8 + (ix % 8)], d = field[((iy + 1) % 8) * 8 + ((ix + 1) % 8)];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
  const image = ctx.createImageData(1024, 1024);
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const i = (y * 1024 + x) * 4;
    const fine = (rng() - 0.5) * 19;
    const patch = patchNoise(x, y) * 8;
    image.data[i] = 72 + fine + patch;
    image.data[i + 1] = 128 + fine * 1.25 + patch;
    image.data[i + 2] = 26 + fine * 0.5 + patch * 0.3;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  for (let i = 0; i < 12; i++) {
    const x = rng() * 1024, y = rng() * 1024, radius = 25 + rng() * 45;
    const patch = ctx.createRadialGradient(x, y, 0, x, y, radius);
    patch.addColorStop(0, 'rgba(182,158,74,.12)'); patch.addColorStop(1, 'rgba(182,158,74,0)');
    ctx.fillStyle = patch; ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
  }
  for (let i = 0; i < 142000; i++) {
    const x = rng() * 1024, y = rng() * 1024;
    const length = 1.5 + rng() * 6;
    ctx.strokeStyle = i % 4 === 0 ? 'rgba(188,211,85,.27)' : i % 3 === 0 ? 'rgba(27,65,16,.36)' : 'rgba(91,150,35,.32)';
    ctx.lineWidth = 0.5 + rng() * 0.65;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 3, y - length);
    ctx.stroke();
  }
  const map = canvasTexture(canvas, [7, 7]);
  const bumpMap = canvasTexture(canvas, [7, 7], false);
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map, bumpMap, bumpScale: 0.04, roughness: 0.96, envMapIntensity: 0.35 });
}

function surfaceTexture(kind, repeat = [1, 1]) {
  const [canvas, ctx] = textureCanvas(512);
  const rng = seededRandom(kind === 'wood' ? 1471 : kind === 'orange' ? 9247 : kind === 'rock' ? 6213 : 3538);
  const base = kind === 'wood' ? [168, 115, 61] : kind === 'orange' ? [225, 115, 36] : kind === 'rock' ? [107, 92, 74] : [130, 137, 133];
  const image = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const i = (y * 512 + x) * 4;
    let noise = (rng() - 0.5) * (kind === 'orange' ? 28 : 35);
    if (kind === 'wood') noise += Math.sin(y * 0.22 + Math.sin(x * 0.019) * 2) * 19 + Math.sin(y * 0.95 + x * 0.003) * 7;
    if (kind === 'rock') noise += Math.sin(y * 0.07 + Math.sin(x * 0.02) * 0.6) * 15 + Math.sin(y * 0.13) * 7;
    if (kind === 'orange') noise += Math.sin(x * 0.025) * Math.cos(y * 0.016) * 9;
    for (let c = 0; c < 3; c++) image.data[i + c] = base[c] + noise;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  if (kind === 'wood') {
    for (let i = 0; i < 70; i++) {
      const y = rng() * 512;
      ctx.strokeStyle = `rgba(57,35,18,${0.07 + rng() * 0.14})`;
      ctx.lineWidth = 0.5 + rng();
      ctx.beginPath(); ctx.moveTo(0, y);
      ctx.bezierCurveTo(160, y + rng() * 12 - 6, 350, y + rng() * 12 - 6, 512, y);
      ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const x = rng() * 512, y = rng() * 512;
      for (let j = 0; j < 4; j++) {
        ctx.strokeStyle = `rgba(64,37,16,${0.17 - j * 0.025})`;
        ctx.beginPath(); ctx.ellipse(x, y, 9 + j * 4, 2 + j * 1.2, 0.04, 0, Math.PI * 2); ctx.stroke();
      }
    }
  } else if (kind === 'orange') {
    for (let i = 0; i < 8500; i++) {
      ctx.fillStyle = i % 7 ? 'rgba(81,84,56,.14)' : 'rgba(240,220,163,.32)';
      ctx.fillRect(rng() * 512, rng() * 512, 0.6 + rng() * 1.8, 0.6 + rng() * 1.8);
    }
    ctx.strokeStyle = 'rgba(74,78,56,.13)'; ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.arc(rng() * 512, rng() * 512, 60 + rng() * 140, rng() * 3, 4 + rng()); ctx.stroke();
    }
  } else if (kind === 'concrete') {
    ctx.strokeStyle = 'rgba(51,59,57,.17)'; ctx.lineWidth = 0.7;
    for (let i = 0; i < 4; i++) {
      let x = rng() * 512, y = rng() * 512;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += rng() * 28 - 14; y += rng() * 24; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  return { map: canvasTexture(canvas, repeat), bumpMap: canvasTexture(canvas, repeat, false) };
}

function softCloudTexture() {
  const [canvas, ctx] = textureCanvas(512);
  const rng = seededRandom(18573);
  // Overlapping radial gradients provide a soft, irregular silhouette in one sprite.
  for (let i = 0; i < 18; i++) {
    const x = 80 + rng() * 350, y = 215 + Math.sin(i * 1.7) * 45;
    const radius = 50 + rng() * 58;
    const gradient = ctx.createRadialGradient(x, y, radius * 0.12, x, y, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,.57)');
    gradient.addColorStop(0.48, 'rgba(255,255,255,.34)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return canvasTexture(canvas);
}

function cloudSeaTexture() {
  const [canvas, ctx] = textureCanvas(1024);
  const rng = seededRandom(0x249d5b);
  // A baked, feathered cloud sheet avoids precision and far-plane artifacts from
  // a screen-filling procedural shader, while retaining gaps into the blue abyss.
  for (let i = 0; i < 140; i++) {
    const x = 100 + rng() * 824, y = 100 + rng() * 824;
    const radius = 32 + rng() * 105;
    const gradient = ctx.createRadialGradient(x, y, radius * 0.06, x, y, radius);
    gradient.addColorStop(0, `rgba(221,233,247,${0.15 + rng() * 0.32})`);
    gradient.addColorStop(0.42, 'rgba(193,213,237,.18)');
    gradient.addColorStop(1, 'rgba(171,195,225,0)');
    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const feather = ctx.createRadialGradient(512, 512, 285, 512, 512, 510);
  feather.addColorStop(0, 'rgba(255,255,255,1)'); feather.addColorStop(0.5, 'rgba(255,255,255,.8)'); feather.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = feather; ctx.fillRect(0, 0, 1024, 1024);
  const texture = canvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  return texture;
}

function cloudPuffTexture() {
  const [canvas, ctx] = textureCanvas(256);
  for (const [x, y, radius] of [[61, 151, 48], [100, 110, 62], [145, 112, 66], [192, 151, 43], [127, 161, 64]]) {
    const gradient = ctx.createRadialGradient(x - 8, y - 10, radius * 0.26, x, y, radius);
    gradient.addColorStop(0, 'rgba(237,245,252,.9)');
    gradient.addColorStop(0.55, 'rgba(210,227,244,.66)');
    gradient.addColorStop(0.82, 'rgba(181,207,232,.22)');
    gradient.addColorStop(1, 'rgba(165,194,225,0)');
    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const texture = canvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function curvedBumper(side) {
  const positions = [], indices = [];
  const profile = [[-0.275, 0.08], [-0.275, 1.03], [-0.235, 1.105], [0.235, 1.105], [0.275, 1.03], [0.275, 0.08], [0.235, 0.015], [-0.235, 0.015]];
  for (let i = 0; i <= 48; i++) {
    const a = -0.84 + i / 48 * 1.68;
    const x = side * 15 + Math.sin(a) * 4.6, z = -3 + side * Math.cos(a) * 2.6;
    const dx = Math.cos(a) * 4.6, dz = -side * Math.sin(a) * 2.6, length = Math.hypot(dx, dz);
    for (const [offset, y] of profile) positions.push(x - dz / length * offset, y, z + dx / length * offset);
    if (i > 0) for (let j = 0; j < 8; j++) {
      const a0 = (i - 1) * 8 + j, a1 = (i - 1) * 8 + (j + 1) % 8, b0 = i * 8 + j, b1 = i * 8 + (j + 1) % 8;
      indices.push(a0, b0, a1, a1, b0, b1);
    }
  }
  for (let j = 1; j < 7; j++) { indices.push(0, j + 1, j); indices.push(48 * 8, 48 * 8 + j, 48 * 8 + j + 1); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function barrelLabelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eae7da'; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#303b3f'; ctx.fillRect(0, 0, 512, 26);
  ctx.font = '800 62px \"Microsoft YaHei UI\",\"PingFang SC\",\"Noto Sans SC\",sans-serif'; ctx.textAlign = 'center'; ctx.fillText('重拳飞车', 256, 112);
  ctx.font = '600 32px \"Microsoft YaHei UI\",\"PingFang SC\",\"Noto Sans SC\",sans-serif'; ctx.fillText('场地涂料', 256, 160);
  ctx.fillRect(48, 183, 416, 4); ctx.font = '500 24px \"Microsoft YaHei UI\",\"PingFang SC\",\"Noto Sans SC\",sans-serif'; ctx.fillText('20 升 · 赛场专用', 256, 223);
  return canvasTexture(canvas);
}

export function createArena(scene, world, groundMaterial) {
  let halfSize = 24, shrinking = false;
  const originalHalfSize = 27;
  const staticBodies = [];
  const dynamicProps = [];
  const group = new THREE.Group();
  group.name = 'FLOATING ARENA';
  scene.add(group);
  const shapes = batch(group);
  const charcoal = new THREE.MeshPhysicalMaterial({ color: 0x242d31, roughness: 0.37, metalness: 0.12, clearcoat: 0.32, clearcoatRoughness: 0.28, side: THREE.DoubleSide });
  const concreteTexture = surfaceTexture('concrete', [2, 3]);
  const asphalt = new THREE.MeshStandardMaterial({ color: 0xc1c6c2, ...concreteTexture, bumpScale: 0.045, roughness: 0.87 });
  const orangeTexture = surfaceTexture('orange', [2, 2]);
  const orange = new THREE.MeshStandardMaterial({ color: 0xffffff, ...orangeTexture, bumpScale: 0.018, roughness: 0.82 });
  const yellow = flat(0xf7ef53);
  const ivory = flat(0xf3f6de);
  const woodTexture = surfaceTexture('wood', [1, 1]);
  const wood = new THREE.MeshStandardMaterial({ color: 0xe0c29b, ...woodTexture, bumpScale: 0.035, roughness: 0.82 });
  const woodLight = new THREE.MeshStandardMaterial({ color: 0xffebce, ...woodTexture, bumpScale: 0.025, roughness: 0.78 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0xb89d7d, ...woodTexture, bumpScale: 0.025, roughness: 0.84 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x667577, roughness: 0.33, metalness: 0.72 });
  const bolts = new THREE.MeshStandardMaterial({ color: 0xc4cbd1, roughness: 0.22, metalness: 0.85 });
  const rockTexture = surfaceTexture('rock', [8, 1]);
  const rock = new THREE.MeshStandardMaterial({ color: 0x9a8e7b, ...rockTexture, bumpScale: 0.11, roughness: 0.96 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x6e5438, ...rockTexture, bumpScale: 0.09, roughness: 1 });
  const edgeBlue = flat(0x38aebc, { roughness: 0.65 });

  function fixedBox(size, position, rotation = zero, material = groundMaterial) {
    const body = new CANNON.Body({ mass: 0, material, collisionFilterGroup: 1, collisionFilterMask: -1 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
    body.position.set(...position);
    body.quaternion.setFromEuler(...rotation);
    world.addBody(body);
    staticBodies.push({ body, size: [...size], position: [...position] });
    return body;
  }

  // The top of this finite slab is the physical arena surface at exactly y = 0.
  const floor = new THREE.Mesh(box(54, 1.4, 54), [rock, rock, texturedGround(), rock, rock, rock]);
  floor.position.y = -0.7;
  floor.receiveShadow = true;
  group.add(floor);
  fixedBox([54, 1.4, 54], [0, -0.7, 0]);
  // Shallow visual strata and curbs stay inside the original slab footprint.
  for (const side of [-1, 1]) {
    shapes.add(box(53.96, 0.2, 0.025), soil, [0, -0.17, side * 26.985]);
    shapes.add(box(0.025, 0.2, 53.96), soil, [side * 26.985, -0.17, 0]);
    shapes.add(box(53.98, 0.12, 0.025), charcoal, [0, -1.26, side * 26.985]);
    shapes.add(box(0.025, 0.12, 53.98), charcoal, [side * 26.985, -1.26, 0]);
    shapes.add(new THREE.CylinderGeometry(0.12, 0.12, 53.4, 12), asphalt, [0, -0.035, side * 26.72], [0, 0, Math.PI / 2]);
    shapes.add(new THREE.CylinderGeometry(0.12, 0.12, 53.4, 12), asphalt, [side * 26.72, -0.035, 0], [Math.PI / 2, 0, 0]);
  }
  // Inset edge paint is flush with the floor, never a rail or invisible wall.
  shapes.add(box(54, 0.018, 0.32), charcoal, [0, 0.012, -26.84]);
  shapes.add(box(54, 0.018, 0.32), charcoal, [0, 0.012, 26.84]);
  shapes.add(box(0.32, 0.018, 54), charcoal, [-26.84, 0.012, 0]);
  shapes.add(box(0.32, 0.018, 54), charcoal, [26.84, 0.012, 0]);
  shapes.add(box(14, 0.022, 12), orange, [0, 0.015, -7]);
  shapes.add(box(13.8, 0.008, 0.09), ivory, [0, 0.033, -12.88]);
  shapes.add(box(13.8, 0.008, 0.09), ivory, [0, 0.033, -1.12]);
  shapes.add(box(0.09, 0.008, 11.8), ivory, [-6.88, 0.033, -7]);
  shapes.add(box(0.09, 0.008, 11.8), ivory, [6.88, 0.033, -7]);
  // A restrained painted center circle gives the player a consistent landmark.
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.7, 3.79, 96), new THREE.MeshStandardMaterial({ color: 0xf0f1da, transparent: true, opacity: 0.74, roughness: 0.94, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  const [logoCanvas, logoCtx] = textureCanvas(512);
  logoCtx.textAlign = 'center'; logoCtx.textBaseline = 'middle';
  logoCtx.fillStyle = 'rgba(244,242,211,.69)'; logoCtx.font = '700 72px Bahnschrift, "Segoe UI", Arial, sans-serif';
  logoCtx.fillText('PUNCH DRIVE', 256, 222, 470); logoCtx.font = '700 50px \"Microsoft YaHei UI\",\"PingFang SC\",\"Noto Sans SC\",sans-serif'; logoCtx.fillText('重 拳 飞 车', 256, 300, 470);
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 5.4), new THREE.MeshStandardMaterial({ map: canvasTexture(logoCanvas), transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  logo.rotation.x = -Math.PI / 2; logo.position.y = 0.036; logo.receiveShadow = true; group.add(logo);

  // Ramps use the same transform for rendering and collision.
  const rampAngle = 0.27;
  const rampSize = [6, 0.45, 9];
  const rampY = Math.sin(0.27) * 4.5 - Math.cos(0.27) * 0.225 + 0.015;
  for (const x of [-17, 17]) {
    shapes.add(box(...rampSize), asphalt, [x, rampY, -20], [rampAngle, 0, 0]);
    fixedBox(rampSize, [x, rampY, -20], [rampAngle, 0, 0]);
    for (const edge of [-1, 1]) {
      const edgePosition = v(edge * 2.82, 0.235, 0).applyEuler(new THREE.Euler(rampAngle, 0, 0)).add(v(x, rampY, -20));
      shapes.add(box(0.22, 0.018, 8.9), edgeBlue, edgePosition.toArray(), [rampAngle, 0, 0]);
      for (let j = 0; j < 13; j++) {
        const stripPosition = v(edge * 2.82, 0.246, -4 + j * 0.65).applyEuler(new THREE.Euler(rampAngle, 0, 0)).add(v(x, rampY, -20));
        shapes.add(box(0.23, 0.01, 0.12), yellow, stripPosition.toArray(), [rampAngle, 0, 0]);
      }
    }
    // Painted double chevron follows the slope.
    for (const dz of [-0.5, 1]) {
      for (const side of [-1, 1]) {
        const chevron = box(0.32, 0.018, 1.4);
        const position = new THREE.Vector3(side * 0.43, 0.241, dz).applyEuler(new THREE.Euler(rampAngle, 0, 0)).add(v(x, rampY, -20));
        const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rampAngle, 0, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * 0.68, 0)));
        const euler = new THREE.Euler().setFromQuaternion(quaternion);
        shapes.add(chevron, ivory, position.toArray(), [euler.x, euler.y, euler.z]);
      }
    }
    for (const dx of [-2.6, 2.6]) {
      shapes.add(box(0.18, 2.4, 0.18), metal, [x + dx, 1.2, -23.6]);
      fixedBox([0.18, 2.4, 0.18], [x + dx, 1.2, -23.6]);
    }
  }

  // Two arc-shaped bumpers constructed from matching short physical segments.
  for (const side of [-1, 1]) {
    const centerX = side * 15;
    for (let i = 0; i < 7; i++) {
      const a = -0.72 + i * 0.24;
      const x = centerX + Math.sin(a) * 4.6;
      const z = -3 + side * Math.cos(a) * 2.6;
      const yaw = Math.atan2(-side * Math.sin(a) * 2.6, Math.cos(a) * 4.6);
      fixedBox([1.22, 1.12, 0.55], [x, 0.56, z], [0, -yaw, 0]);
    }
    shapes.add(curvedBumper(side), charcoal);
  }

  // Low wooden scaffold bridge; its underpass remains taller than the car roof.
  const scaffoldZ = -10;
  for (const x of [-3.2, 3.2]) {
    for (const dz of [-0.95, 0.95]) {
      shapes.add(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 12), metal, [x, 1.3, scaffoldZ + dz]);
      fixedBox([0.23, 2.6, 0.23], [x, 1.3, scaffoldZ + dz]);
      shapes.add(box(0.34, 0.14, 0.34), woodDark, [x, 0.08, scaffoldZ + dz]);
      for (const y of [0.3, 2.12]) shapes.add(new THREE.CylinderGeometry(0.155, 0.155, 0.1, 12), bolts, [x, y, scaffoldZ + dz]);
    }
    for (const sign of [-1, 1]) {
      const start = v(x, 0.28, scaffoldZ - 0.88 * sign);
      const end = v(x, 2.1, scaffoldZ + 0.88 * sign);
      const direction = end.clone().sub(start);
      const q = new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), direction.clone().normalize());
      const e = new THREE.Euler().setFromQuaternion(q);
      shapes.add(box(0.14, direction.length(), 0.13), woodDark, start.add(end).multiplyScalar(0.5).toArray(), [e.x, e.y, e.z]);
    }
  }
  for (let z = -0.9; z < 1; z += 0.32) {
    shapes.add(box(6.9, 0.16, 0.29), woodLight, [0, 2.25, scaffoldZ + z]);
    for (const x of [-3.12, 3.12]) shapes.add(new THREE.CylinderGeometry(0.026, 0.026, 0.007, 8), bolts, [x, 2.334, scaffoldZ + z]);
  }
  fixedBox([6.9, 0.16, 2.12], [0, 2.25, scaffoldZ]);
  for (const z of [-0.94, 0.94]) shapes.add(box(7.2, 0.18, 0.18), wood, [0, 2.15, scaffoldZ + z]);

  // A small low pallet outside the center circle is physically driveable.
  for (let i = 0; i < 6; i++) shapes.add(box(2.5, 0.1, 0.25), woodLight, [7, 0.32, -9.8 + i * 0.32]);
  for (const x of [6.1, 7.9]) shapes.add(box(0.25, 0.3, 1.9), woodDark, [x, 0.15, -9]);
  fixedBox([2.5, 0.36, 1.9], [7, 0.18, -9]);

  const barrelColors = [0x4284cc, 0xe95b4a, 0xf6cf45, 0x4284cc];
  const barrelLabel = new THREE.MeshStandardMaterial({ map: barrelLabelTexture(), roughness: 0.78, side: THREE.DoubleSide });
  [[-5.3, -8.6], [-6.9, -9.5], [4.8, -12.6], [8.5, -7.5]].forEach(([x, z], index) => {
    const mesh = new THREE.Group();
    const b = batch(mesh);
    const paint = new THREE.MeshPhysicalMaterial({ color: barrelColors[index], roughness: 0.34, metalness: 0.3, clearcoat: 0.25 });
    b.add(new THREE.CylinderGeometry(0.53, 0.53, 1.16, 32), paint);
    b.add(new THREE.CylinderGeometry(0.545, 0.545, 0.065, 32), bolts, [0, 0.55, 0]);
    b.add(new THREE.CylinderGeometry(0.545, 0.545, 0.055, 32), metal, [0, -0.52, 0]);
    b.add(new THREE.CylinderGeometry(0.49, 0.49, 0.02, 32), bolts, [0, 0.592, 0]);
    b.add(new THREE.TorusGeometry(0.43, 0.012, 6, 32), metal, [0, 0.606, 0], [Math.PI / 2, 0, 0]);
    b.add(new THREE.CylinderGeometry(0.052, 0.052, 0.022, 12), charcoal, [0.23, 0.616, -0.12]);
    b.add(new THREE.CylinderGeometry(0.536, 0.536, 0.44, 32, 1, true, -0.8, 1.6), barrelLabel, [0, -0.02, 0]);
    // Short irregular drips around the rim.
    for (let j = 0; j < 7; j++) {
      const a = j * Math.PI * 2 / 7;
      b.add(box(0.065, 0.14 + (j % 3) * 0.07, 0.025), ivory, [Math.sin(a) * 0.535, 0.43 - (j % 3) * 0.035, Math.cos(a) * 0.535], [0, a, 0]);
    }
    b.flush();
    mesh.position.set(x, 0.62, z);
    scene.add(mesh);
    const body = new CANNON.Body({ mass: 17, material: groundMaterial, linearDamping: 0.15, angularDamping: 0.3, collisionFilterGroup: 4, collisionFilterMask: -1 });
    body.addShape(new CANNON.Cylinder(0.53, 0.53, 1.16, 12));
    body.position.set(x, 0.62, z);
    world.addBody(body);
    dynamicProps.push({ body, mesh, start: body.position.clone() });
  });

  // A readable danger border, painted flat so it never acts as a guardrail.
  const edgeLights = [];
  const warningBlack = flat(0x171b27, { roughness: 0.8 });
  const warningYellow = flat(0xf1bc25, { emissive: 0x694214, emissiveIntensity: 0.25 });
  for (let side = 0; side < 4; side++) {
    const alongX = side < 2, sign = side % 2 ? 1 : -1;
    const position = alongX ? [0, 0.035, sign * 26.53] : [sign * 26.53, 0.035, 0];
    shapes.add(box(alongX ? 53.7 : 0.75, 0.035, alongX ? 0.75 : 53.7), warningBlack, position);
    for (let n = -26; n <= 26; n += 1.28) {
      const stripePosition = alongX ? [n, 0.057, sign * 26.53] : [sign * 26.53, 0.057, n];
      shapes.add(box(0.52, 0.018, 0.7), warningYellow, stripePosition, [0, alongX ? 0.32 : Math.PI / 2 - 0.32, 0]);
    }
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xffd45a, toneMapped: false });
    const light = new THREE.Mesh(box(alongX ? 53.8 : 0.1, 0.045, alongX ? 0.1 : 53.8), lightMaterial);
    light.position.set(...(alongX ? [0, 0.075, sign * 26.91] : [sign * 26.91, 0.075, 0]));
    group.add(light);
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffd45a, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const glow = new THREE.Mesh(box(alongX ? 53.8 : 1.1, 0.01, alongX ? 1.1 : 53.8), glowMaterial);
    glow.position.set(...(alongX ? [0, 0.08, sign * 26.44] : [sign * 26.44, 0.08, 0]));
    group.add(glow);
    edgeLights.push({ axis: alongX ? 'z' : 'x', sign, lightMaterial, glowMaterial });
  }

  // The substantial inverted rock silhouette makes the platform's height readable.
  const islandRock = flat(0x44445c, { roughness: 1, ...surfaceTexture('rock', [4, 2]) });
  const islandRockLight = flat(0x696273, { roughness: 0.95 });
  const rootMaterial = flat(0x53402d, { roughness: 1 });
  const islandShape = new THREE.CylinderGeometry(37.2, 8.5, 17, 4, 4, false);
  islandShape.rotateY(Math.PI / 4);
  shapes.add(islandShape, islandRock, [0, -9.85, 0]);
  const rockRng = seededRandom(0x7ab3d9);
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2, radius = 20 + rockRng() * 5, depth = 3 + rockRng() * 6;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius;
    shapes.add(new THREE.DodecahedronGeometry(1.8 + rockRng() * 1.8, 0), i % 3 ? islandRock : islandRockLight, [x, -depth, z], [rockRng(), rockRng(), rockRng()], [1, 1.6, 1]);
  }
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2, radius = 23;
    const start = v(Math.sin(a) * radius, -1.3, Math.cos(a) * radius);
    const points = [start, v(start.x * 0.97, -4, start.z * 0.96), v(start.x * 0.87 + 1, -7 - (i % 3), start.z * 0.91)];
    shapes.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 8, 0.13, 5, false), rootMaterial);
  }
  shapes.flush();

  const distantGroup = new THREE.Group();
  distantGroup.name = 'HORIZON ISLANDS';
  scene.add(distantGroup);
  const distantShapes = batch(distantGroup);

  // Distant architecture sits on a separate floating island beyond the arena.
  distantShapes.add(new THREE.CylinderGeometry(10, 3.5, 10, 10), islandRock, [8, -6.65, -47]);
  distantShapes.add(new THREE.CylinderGeometry(10.1, 10.1, 0.15, 32), asphalt, [8, -1.65, -47]);
  const domeMaterial = new THREE.MeshPhysicalMaterial({ color: 0xdce3df, roughness: 0.4, metalness: 0.14, clearcoat: 0.26 });
  const domeGlass = new THREE.MeshPhysicalMaterial({ color: 0x365762, roughness: 0.16, metalness: 0.46, clearcoat: 1 });
  distantShapes.add(new THREE.SphereGeometry(6.2, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), domeMaterial, [8, -1.55, -47]);
  distantShapes.add(new THREE.TorusGeometry(6.24, 0.12, 8, 64), metal, [8, -1.52, -47], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, latitude = 0.46, radius = Math.cos(latitude) * 6.23;
    const position = [8 + Math.sin(a) * radius, -1.55 + Math.sin(latitude) * 6.23, -47 + Math.cos(a) * radius];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-latitude, 0, 0)));
    const e = new THREE.Euler().setFromQuaternion(q);
    distantShapes.add(box(1.12, 0.88, 0.1), metal, position, [e.x, e.y, e.z]);
    const outward = v(0, 0, 0.061).applyQuaternion(q).add(v(...position));
    distantShapes.add(box(0.93, 0.68, 0.015), domeGlass, outward.toArray(), [e.x, e.y, e.z]);
  }
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, points = [];
    for (let j = 0; j <= 24; j++) {
      const latitude = j / 24 * Math.PI / 2;
      points.push(v(8 + Math.sin(a) * Math.cos(latitude) * 6.23, -1.55 + Math.sin(latitude) * 6.23, -47 + Math.cos(a) * Math.cos(latitude) * 6.23));
    }
    distantShapes.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.025, 5, false), metal);
  }
  distantShapes.add(box(2.5, 3.3, 0.15), charcoal, [8, 0.05, -40.94]);
  distantShapes.add(box(3.2, 0.2, 0.9), orange, [8, 1.8, -40.5]);
  // Small scenic islands and a balloon give falling cars an unmistakable scale.
  for (const [x, y, z, radius] of [[-58, -12, -52, 8], [72, -18, -5, 11], [-53, -21, 55, 7], [47, -9, 68, 6]]) {
    distantShapes.add(new THREE.CylinderGeometry(radius, radius * 0.18, radius * 1.5, 7), islandRock, [x, y - radius * 0.75, z], [0, 0.3, 0]);
    distantShapes.add(new THREE.CylinderGeometry(radius, radius, 0.18, 7), flat(0x718b4a), [x, y + 0.05, z], [0, 0.3, 0]);
    for (let i = 0; i < 3; i++) {
      const tx = x + Math.sin(i * 2.1) * radius * 0.4, tz = z + Math.cos(i * 2.1) * radius * 0.4;
      distantShapes.add(new THREE.CylinderGeometry(0.2, 0.3, 2.5, 6), rootMaterial, [tx, y + 1.3, tz]);
      distantShapes.add(new THREE.ConeGeometry(1.5, 4, 7), flat(0x315d5a), [tx, y + 4, tz]);
    }
  }
  const balloon = new THREE.Group();
  const balloonBatch = batch(balloon);
  balloonBatch.add(new THREE.SphereGeometry(3.6, 20, 12), flat(0xf5b643), [0, 6, 0], zero, [1, 1.3, 1]);
  balloonBatch.add(new THREE.CylinderGeometry(1.8, 1, 2.3, 20), flat(0xcf594d), [0, 2.4, 0]);
  balloonBatch.add(box(1.8, 1, 1.5), wood, [0, -0.5, 0]);
  for (const x of [-0.7, 0.7]) for (const z of [-0.55, 0.55]) balloonBatch.add(new THREE.CylinderGeometry(0.04, 0.04, 2, 5), rootMaterial, [x, 0.8, z]);
  balloonBatch.flush(); balloon.position.set(-56, 12, 8); distantGroup.add(balloon);
  distantShapes.flush();

  const cloudGroup = new THREE.Group();
  const cloudMap = softCloudTexture();
  const cloudWhite = new THREE.SpriteMaterial({ map: cloudMap, color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: true, toneMapped: false });
  const cloudShade = new THREE.SpriteMaterial({ map: cloudMap, color: 0xcbd8de, transparent: true, opacity: 0.7, depthWrite: false, fog: true, toneMapped: false });
  const clouds = [
    [-38, 13, -43, 1.4], [36, 18, -55, 1.7], [-12, 24, -75, 1.3],
    [53, 8, -7, 1.4], [-52, 5, 12, 1.1], [14, 17, 65, 1.8],
    [-34, -28, -21, 3.2], [36, -30, 22, 3], [-12, -29, 43, 3.4],
  ];
  clouds.forEach(([x, y, z, scale], index) => {
    const cloud = new THREE.Sprite(index > 5 ? cloudShade : cloudWhite);
    cloud.position.set(x, y, z); cloud.scale.set(23 * scale, 12 * scale, 1); cloudGroup.add(cloud);
  });
  const puffMaterial = new THREE.SpriteMaterial({ map: cloudPuffTexture(), color: 0xe4edf8, transparent: true, opacity: 0.83, depthWrite: false, fog: true, toneMapped: false });
  for (const [x, y, z, width, height] of [[-37,-21,18,24,13],[34,-24,8,27,15],[39,-22,-37,23,13],[-24,-27,-44,31,16],[16,-26,47,28,15],[-43,-24,-10,23,13],[53,-30,44,34,18],[0,-28,-60,36,18]]) {
    const puff = new THREE.Sprite(puffMaterial);
    puff.position.set(x, y, z); puff.scale.set(width, height, 1); cloudGroup.add(puff);
  }
  cloudGroup.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
  scene.add(cloudGroup);

  const seaTexture = cloudSeaTexture();
  const cloudSeaMaterial = new THREE.MeshBasicMaterial({ map: seaTexture, color: 0xdce7f4, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const cloudSea = new THREE.Mesh(new THREE.PlaneGeometry(360, 360, 16, 16), cloudSeaMaterial);
  cloudSea.rotation.x = -Math.PI / 2; cloudSea.position.y = -30; cloudSea.renderOrder = -2; scene.add(cloudSea);
  const lowerCloudSea = new THREE.Mesh(new THREE.PlaneGeometry(390, 390, 16, 16), new THREE.MeshBasicMaterial({ map: seaTexture, color: 0x7897bf, transparent: true, opacity: 0.58, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  lowerCloudSea.rotation.set(-Math.PI / 2, 0, 0.68); lowerCloudSea.position.set(14, -35, -12); lowerCloudSea.renderOrder = -3; scene.add(lowerCloudSea);
  // The sky's deep-blue lower hemisphere supplies the abyss. No infinite floor:
  // a large horizontal bottom plane would expose the camera's far-clip boundary.

  const arena = {
    get halfSize() { return halfSize; },
    dynamicProps,
    setRound(round = 1, totalRounds = 6, shrink = 0) {
      const progress = Math.min(1, Math.max(0, (round - 1) / Math.max(1, totalRounds - 1)));
      shrinking = shrink > 0;
      halfSize = 24 * Math.pow(17 / 24, progress) * (1 - .28 * shrink);
      const scale = halfSize / originalHalfSize;
      // Uniform scaling keeps every rotated ramp and its physical box exactly aligned.
      group.scale.setScalar(scale);
      for (const entry of staticBodies) {
        const body = entry.body, shape = body.shapes[0];
        body.position.set(entry.position[0] * scale, entry.position[1] * scale, entry.position[2] * scale);
        shape.halfExtents.set(entry.size[0] * scale / 2, entry.size[1] * scale / 2, entry.size[2] * scale / 2);
        shape.updateConvexPolyhedronRepresentation(); shape.updateBoundingSphereRadius(); body.updateBoundingRadius();
        body.aabbNeedsUpdate = true; body.updateAABB();
        body.previousPosition.copy(body.position); body.interpolatedPosition.copy(body.position);
      }
      for (const prop of dynamicProps) {
        prop.baseStart ??= prop.start.clone();
        prop.start.set(prop.baseStart.x * scale, prop.baseStart.y, prop.baseStart.z * scale);
        if (shrinking) continue;
        prop.body.position.copy(prop.start); prop.body.quaternion.set(0, 0, 0, 1);
        prop.body.velocity.setZero(); prop.body.angularVelocity.setZero(); prop.body.force.setZero(); prop.body.torque.setZero();
        prop.body.aabbNeedsUpdate = true; prop.body.wakeUp();
        prop.mesh.position.copy(prop.body.position); prop.mesh.quaternion.copy(prop.body.quaternion);
      }
      if (world.broadphase) world.broadphase.dirty = true;
      return halfSize;
    },
    update(dt, time, player) {
      cloudGroup.rotation.y = Math.sin(time * 0.012) * 0.035;
      cloudSea.position.y = -30 + Math.sin(time * 0.07) * 0.3;
      lowerCloudSea.rotation.z = 0.68 + Math.sin(time * 0.025) * 0.015;
      balloon.position.y = 12 + Math.sin(time * 0.22) * 1.2;
      const playerPosition = player?.body?.position;
      for (const edge of edgeLights) {
        const distance = playerPosition ? halfSize - playerPosition[edge.axis] * edge.sign : 10;
        const danger = shrinking ? 1 : Math.min(1, Math.max(0, (4 - distance) / 4));
        const pulse = 0.5 + Math.sin(time * (7 + danger * 8)) * 0.5;
        edge.lightMaterial.color.set(danger > 0 ? 0xff3328 : 0xffd45a);
        edge.glowMaterial.color.copy(edge.lightMaterial.color);
        edge.lightMaterial.color.multiplyScalar(1 + danger * (0.4 + pulse * 2.2));
        edge.glowMaterial.opacity = 0.13 + danger * (0.15 + pulse * 0.24);
      }
      for (const prop of dynamicProps) {
        if (prop.body.position.y < -24) {
          prop.body.position.copy(prop.start);
          prop.body.velocity.setZero();
          prop.body.angularVelocity.setZero();
          prop.body.quaternion.set(0, 0, 0, 1);
          prop.body.aabbNeedsUpdate = true;
        }
        prop.mesh.position.copy(prop.body.position);
        prop.mesh.quaternion.copy(prop.body.quaternion);
      }
    },
  };
  arena.setRound(1, 6);
  return arena;
}

const itemVisualRandom = seededRandom(0x31ca847d);

export function createItemVisual(kind) {
  // Three.js UUID construction uses Math.random. Keep richer item geometry from
  // changing the shared gameplay sequence: the original pickup consumed 68 draws.
  const gameplayRandom = Math.random;
  Math.random = itemVisualRandom;
  try {
    return buildItemVisual(kind);
  } finally {
    Math.random = gameplayRandom;
    for (let i = 0; i < 68; i++) gameplayRandom();
  }
}

function buildItemVisual(kind) {
  const group = new THREE.Group();
  const color = kind === 'boost' ? 0x79f1ff : 0xffd750;
  const material = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.46, roughness: 0.12, metalness: 0.24, clearcoat: 1, clearcoatRoughness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x243139, roughness: 0.24, metalness: 0.4 });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.78, 0), material);
  core.castShadow = true;
  group.add(core);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(core.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, toneMapped: false }));
  group.add(outline);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.045, 5, 24), material);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  const emblem = new THREE.Group();
  const shape = batch(emblem);
  if (kind === 'boost') {
    shape.add(box(0.12, 0.54, 0.05), dark, [-0.06, 0.11, 0.65], [0, 0, -0.45]);
    shape.add(box(0.12, 0.54, 0.05), dark, [0.06, -0.11, 0.65], [0, 0, -0.45]);
  } else {
    shape.add(box(0.46, 0.34, 0.05), dark, [0, 0.06, 0.65]);
    shape.add(box(0.22, 0.18, 0.05), dark, [0, -0.18, 0.65]);
  }
  shape.flush();
  group.add(emblem);
  // Transparent ground halo uses real geometry; it needs no external image.
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.5, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.23, side: THREE.DoubleSide, depthWrite: false }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.85;
  group.add(halo);
  const [glowCanvas, glowCtx] = textureCanvas(128);
  const glow = glowCtx.createRadialGradient(64, 64, 5, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255,255,255,.3)'); glow.addColorStop(0.4, 'rgba(255,255,255,.13)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  glowCtx.fillStyle = glow; glowCtx.fillRect(0, 0, 128, 128);
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(glowCanvas), color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
  aura.scale.set(4.2, 4.2, 1); group.add(aura);
  const [beamCanvas, beamCtx] = textureCanvas(128);
  const beamGradient = beamCtx.createLinearGradient(0, 0, 0, 128);
  beamGradient.addColorStop(0, 'rgba(255,255,255,0)');
  beamGradient.addColorStop(0.22, 'rgba(255,255,255,.12)');
  beamGradient.addColorStop(0.8, 'rgba(255,255,255,.24)');
  beamGradient.addColorStop(1, 'rgba(255,255,255,.42)');
  beamCtx.fillStyle = beamGradient; beamCtx.fillRect(0, 0, 128, 128);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.82, 9, 24, 1, true), new THREE.MeshBasicMaterial({ map: canvasTexture(beamCanvas), color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  beam.position.y = 3.6; group.add(beam);
  const beacon = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.065, 6, 40), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  beacon.rotation.x = Math.PI / 2; beacon.position.y = -0.78; group.add(beacon);
  return group;
}
