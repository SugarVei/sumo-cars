import * as THREE from 'three';

const tailRed = new THREE.Color(0xff303e);
const POINTS = 40;
const SPACING = 0.42;
const point = new THREE.Vector3();
const side = new THREE.Vector3();

/**
 * Neon light trails streaming from each car's tail lamps.
 * One additive mesh per car; buffers are rewritten in place, nothing is allocated per frame.
 */
export function createTrails(scene) {
  const entries = new Map();

  function entryFor(car) {
    let entry = entries.get(car.id);
    if (entry) return entry;
    const ribbons = 2, vertices = ribbons * POINTS * 2;
    const positions = new Float32Array(vertices * 3), colors = new Float32Array(vertices * 4), indices = [];
    for (let r = 0; r < ribbons; r++) for (let i = 0; i < POINTS - 1; i++) {
      const a = (r * POINTS + i) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.name = `Light trail / ${car.name}`;
    scene.add(mesh);
    entry = { mesh, geometry, positions, colors, history: [[], []], age: 0, intensity: 0 };
    entries.set(car.id, entry);
    return entry;
  }

  function reset(car) {
    const entry = entries.get(car.id);
    if (!entry) return;
    entry.history[0].length = 0; entry.history[1].length = 0; entry.intensity = 0;
    entry.mesh.visible = false;
  }

  function update(cars, dt, settings = {}) {
    for (const car of cars) {
      const entry = entryFor(car);
      const group = car.visual?.group;
      if (!group || !car.visual.taillights) { entry.mesh.visible = false; continue; }
      const speed = Math.abs(car.speed || 0);
      const boosted = car.nitroOn || car.driftBoost || car.effect === 'boost' || car.padBoostEnd > (settings.simTime ?? 0);
      // The chased car only streaks while boosting, so its own trail never floods the camera.
      const own = settings.focusId === car.id;
      const wake = car.drifting ? .52 : THREE.MathUtils.clamp((speed-17)/18,0,.56);
      const wanted = !car.active ? 0 : Math.max(wake,boosted ? (own ? .55 : 1) : settings.always && !own ? THREE.MathUtils.clamp((speed-9)/14,0,1) : 0);
      entry.intensity += (wanted - entry.intensity) * (1 - Math.exp(-dt * 6));
      if (entry.intensity < 0.01 && entry.history[0].length === 0) { entry.mesh.visible = false; continue; }
      group.updateMatrixWorld();
      side.set(1, 0, 0).transformDirection(group.matrixWorld);
      for (let r = 0; r < 2; r++) {
        const history = entry.history[r];
        point.copy(car.visual.taillights[r]).applyMatrix4(group.matrixWorld);
        if (history[0] && history[0].p.distanceToSquared(point) > 64) history.length = 0; // teleport (respawn)
        if (!car.active) { if (history.length) history.pop(); continue; }
        // history[0] is a live head that follows the lamp; it is committed once it leaves the previous point.
        const anchor = history[1];
        if (!history.length || !anchor || anchor.p.distanceToSquared(point) > SPACING * SPACING) {
          const item = history.length >= POINTS ? history.pop() : { p: new THREE.Vector3(), s: new THREE.Vector3() };
          item.p.copy(point); item.s.copy(side);
          history.unshift(item);
        } else { history[0].p.copy(point); history[0].s.copy(side); }
      }
      const color = boosted ? car.visual.glowColor : tailRed;
      const night = settings.night ?? 0.5;
      const gain = (0.42 + night * 0.7) * entry.intensity;
      const width = 0.075 + 0.035 * entry.intensity;
      let visible = false;
      for (let r = 0; r < 2; r++) {
        const history = entry.history[r];
        for (let i = 0; i < POINTS; i++) {
          const item = history[Math.min(i, history.length - 1)];
          const base = ((r * POINTS + i) * 2);
          if (!item) { for (let k = 0; k < 2; k++) entry.colors[(base + k) * 4 + 3] = 0; continue; }
          const fade = i >= history.length ? 0 : Math.pow(1 - i / POINTS, 1.6) * gain;
          if (fade > 0.002) visible = true;
          const w = width * (1 - i / POINTS * 0.6);
          for (let k = 0; k < 2; k++) {
            const sign = k ? 1 : -1, v = base + k;
            entry.positions[v * 3] = item.p.x + item.s.x * w * sign;
            entry.positions[v * 3 + 1] = item.p.y + item.s.y * w * sign;
            entry.positions[v * 3 + 2] = item.p.z + item.s.z * w * sign;
            // Hot white core near the car cooling into the car's neon colour.
            const heat = Math.max(0, 1 - i / 4);
            entry.colors[v * 4] = color.r + heat * 0.35;
            entry.colors[v * 4 + 1] = color.g + heat * 0.35;
            entry.colors[v * 4 + 2] = color.b + heat * 0.35;
            entry.colors[v * 4 + 3] = fade;
          }
        }
      }
      entry.mesh.visible = visible;
      entry.geometry.attributes.position.needsUpdate = true;
      entry.geometry.attributes.color.needsUpdate = true;
    }
  }

  return { update, reset, clear() { for (const [, entry] of entries) { entry.history[0].length = 0; entry.history[1].length = 0; entry.intensity = 0; entry.mesh.visible = false; } } };
}
