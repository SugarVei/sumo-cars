import * as THREE from 'three';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const TAU = Math.PI * 2;
const BILLBOARD_VERTEX = /* glsl */ `
  attribute vec3 effectCenter;
  attribute vec2 effectSize;
  attribute vec4 effectTint;
  attribute vec2 effectShape;
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vKind;
  void main() {
    float c = cos(effectShape.x), s = sin(effectShape.x);
    vec2 local = position.xy * effectSize;
    local = mat2(c, -s, s, c) * local;
    vec4 viewPosition = modelViewMatrix * vec4(effectCenter, 1.0);
    viewPosition.xy += local;
    gl_Position = projectionMatrix * viewPosition;
    vUv = uv;
    vTint = effectTint;
    vKind = effectShape.y;
  }
`;
const BILLBOARD_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vKind;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float radius = length(p);
    float softness = exp(-3.8 * radius * radius) * (1.0 - smoothstep(0.65, 1.0, radius));
    if (vKind > 5.5) {
      softness = exp(-abs(p.x)*8.0)*(1.0-smoothstep(0.3,1.0,abs(p.y)));
    } else if (vKind > 4.5) {
      softness = (1.0 - smoothstep(0.65, 1.0, abs(p.x))) * exp(-p.y * p.y * 7.0);
    } else if (vKind > 3.5) {
      float spokes = pow(abs(cos(atan(p.y, p.x) * 7.0)), 32.0);
      softness = spokes * smoothstep(0.24, 0.42, radius) * (1.0 - smoothstep(0.72, 1.0, radius));
    } else if (vKind > 2.5) {
      softness = exp(-pow((radius - 0.73) * 26.0, 2.0));
    } else if (vKind > 0.5 && vKind < 1.5) {
      // A soft, slightly irregular stone silhouette rather than square confetti.
      float edge = radius + sin(atan(p.y, p.x) * 5.0 + 1.2) * 0.065;
      softness = (1.0 - smoothstep(0.34, 0.91, edge)) * 0.88;
    } else if (vKind > 1.5) {
      float rays = exp(-abs(p.x * p.y) * 95.0) * exp(-radius * 4.8);
      softness = min(1.0, softness + rays * 0.6);
    }
    float alpha = softness * vTint.a;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(vTint.rgb, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const GROUND_VERTEX = /* glsl */ `
  attribute vec3 effectCenter;
  attribute vec2 effectSize;
  attribute vec4 effectTint;
  attribute vec4 effectTiming;
  uniform float effectTime;
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vProgress;
  void main() {
    float age = max(0.0, effectTime - effectTiming.x);
    float progress = clamp(age / max(effectTiming.y, 0.001), 0.0, 1.0);
    float growth = 1.0 + progress * effectTiming.w;
    float c = cos(effectTiming.z), s = sin(effectTiming.z);
    vec2 local = position.xy * effectSize * growth;
    vec2 rotated = mat2(c, -s, s, c) * local;
    vec3 worldPosition = effectCenter + vec3(rotated.x, 0.0, rotated.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);
    vUv = uv;
    vTint = effectTint;
    vProgress = progress;
  }
`;
const GROUND_FRAGMENT = /* glsl */ `
  uniform float effectRing;
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vProgress;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float alpha;
    if (effectRing > 0.5) {
      float radius = length(p);
      float band = exp(-pow((radius - 0.72) * 14.0, 2.0));
      alpha = band * pow(1.0 - vProgress, 1.8);
    } else {
      float edge = 1.0 - smoothstep(0.58, 1.0, abs(p.x));
      float ends = 1.0 - smoothstep(0.48, 1.0, abs(p.y));
      float grooves = 0.87 + 0.13 * sin(vUv.x * 37.0);
      alpha = edge * ends * grooves * (1.0 - smoothstep(0.32, 1.0, vProgress));
    }
    alpha *= vTint.a;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(vTint.rgb, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Fixed-capacity geometry: one draw call for each complete effect family. */
function makeBatch(scene, name, capacity, ground = false, additive = false, ring = false) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  const attributes = {};
  for (const [key, size] of Object.entries({ effectCenter: 3, effectSize: 2, effectTint: 4, [ground ? 'effectTiming' : 'effectShape']: ground ? 4 : 2 })) {
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(key, attribute);
    attributes[key] = attribute;
  }
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    vertexShader: ground ? GROUND_VERTEX : BILLBOARD_VERTEX,
    fragmentShader: ground ? GROUND_FRAGMENT : BILLBOARD_FRAGMENT,
    uniforms: { effectTime: { value: 0 }, effectRing: { value: ring ? 1 : 0 } },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    polygonOffset: ground,
    polygonOffsetFactor: ground ? -2 : 0,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = ground ? (ring ? 4 : 1) : (additive ? 5 : 3);
  mesh.visible = false;
  scene.add(mesh);
  return { geometry, material, mesh, attributes, attributeList: Object.values(attributes), capacity, cursor: 0, used: 0, dirty: false };
}

function upload(batch) {
  if (!batch.dirty) return;
  for (const attribute of batch.attributeList) attribute.needsUpdate = true;
  batch.geometry.instanceCount = batch.used;
  batch.mesh.visible = batch.used > 0;
  batch.dirty = false;
}

function writeGround(batch, clock, x, y, z, width, length, yaw, life, opacity, color, growth = 0) {
  const index = batch.cursor++ % batch.capacity;
  const a = batch.attributes;
  a.effectCenter.setXYZ(index, x, y, z);
  a.effectSize.setXY(index, width, length);
  a.effectTint.setXYZW(index, color[0], color[1], color[2], opacity);
  a.effectTiming.setXYZW(index, clock, life, yaw, growth);
  batch.used = Math.min(batch.capacity, batch.used + 1);
  batch.dirty = true;
}

/**
 * Visual-only effects. No body, gameplay state, timer, camera, or HUD is modified.
 * The public methods allocate no Three.js objects and never add scene children.
 */
export function createEffects(scene) {
  const dust = makeBatch(scene, 'POOLED DUST AND DEBRIS', 480);
  const light = makeBatch(scene, 'POOLED IMPACT LIGHT', 128, false, true);
  const tracks = makeBatch(scene, 'FADING SOFT TIRE MARKS', 2048, true);
  const rings = makeBatch(scene, 'EXPANDING SHOCK RINGS', 32, true, true, true);
  const batches = [dust, light, tracks, rings];
  const groundBatches = [tracks, rings];
  const states = new Map();
  const wheelPoint = new THREE.Vector3();
  // One draw call for all tumbling pieces, including simultaneous local-player hits.
  const chipMesh=new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1),
    new THREE.MeshBasicMaterial({toneMapped:false}),128);
  chipMesh.name='Impact sparks';chipMesh.count=0;chipMesh.frustumCulled=false;
  chipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(chipMesh);
  const chips=Array.from({length:128},()=>({life:0})),chipPose=new THREE.Object3D();
  const chipColors=[new THREE.Color(3,2.1,.6),new THREE.Color(2.8,2.8,2.8)];
  let chipCursor=0;
  const trackColor = [0.10, 0.075, 0.034];
  const ringColor = [0.86, 0.96, 1.0];
  const landingColor = [0.52, 0.45, 0.29];
  const sparkColor = [1.0, 0.7, 0.22];
  const whiteColor = [0.93, 0.98, 1.0];
  const debrisColor = [0.07, 0.095, 0.09];
  const impactColor = [1.0, 0.88, 0.64];
  const cloudColor = [0.8, 0.89, 0.97];
  const turboColor = [0.24, 0.75, 1.0];
  const turboCoreColor = [0.85, 0.96, 1.0];
  const fullTankColor = [.82,.28,1.0];
  const fallEmitters = Array.from({length: 12}, () => ({active:false,x:0,y:0,z:0,speed:0,age:0,nextPuff:0}));
  let fallCursor = 0;
  let clock = 0;
  let seed = 0x5a17c9e3;
  let tracksUntil = 0;
  let ringsUntil = 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const makeParticles = (batch) => Array.from({ length: batch.capacity }, () => ({
    life: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    size: 0, stretch: 1, growth: 0, opacity: 0, angle: 0, spin: 0,
    drag: 0, gravity: 0, kind: 0, red: 1, green: 1, blue: 1,
  }));
  const dustParticles = makeParticles(dust);
  const lightParticles = makeParticles(light);

  function particle(batch, pool, x, y, z, life, size, opacity, kind, vx, vy, vz, color, growth, gravity, drag) {
    const p = pool[batch.cursor++ % batch.capacity];
    p.life = life; p.age = 0;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size; p.stretch = kind === 1 ? 0.72 + random() * 0.6 : 1;
    p.growth = growth; p.opacity = opacity; p.kind = kind;
    p.angle = random() * TAU; p.spin = (random() - 0.5) * (kind === 1 ? 7 : 1.2);
    p.red = color[0]; p.green = color[1]; p.blue = color[2];
    p.gravity = gravity; p.drag = drag;
    return p;
  }

  function dustPuff(x, y, z, strength = 1, vx = 0, vz = 0, color = landingColor) {
    const a = random() * TAU, outward = (0.35 + random() * 0.9) * strength;
    particle(dust, dustParticles, x, y, z,
      0.6 + random() * 0.55, 0.7 + random() * 0.3, 0.16 + strength * 0.09, 0,
      Math.sin(a) * outward + vx * 0.08, 0.4 + random() * 0.8, Math.cos(a) * outward + vz * 0.08,
      color, 1.3 + strength * 0.7, 0.15, 1.5);
  }

  function carState(car) {
    let state = states.get(car.id);
    if (!state) {
      state = { grounded: !!car.grounded, active: !!car.active, airTime: 0, fallSpeed: 0, dustAt: 0, boostAt:0, fallAt:0, marks: [{ time: -99, x: 0, z: 0 }, { time: -99, x: 0, z: 0 }] };
      states.set(car.id, state);
    }
    return state;
  }

  function metalSparks(position,power){
    const count=clamp(Math.round(18*power),12,25);
    for(let i=0;i<count;i++){
      const p=chips[chipCursor++ % chips.length],angle=random()*TAU,speed=(2+random()*7)*power;
      p.x=position.x;p.y=position.y;p.z=position.z;p.floor=position.y-.56;
      p.vx=Math.cos(angle)*speed;p.vz=Math.sin(angle)*speed;p.vy=1.8+random()*5;
      p.life=.25+random()*.32;p.spin=random()*15-7;p.size=.045+random()*.045;
      p.angle=angle;p.bounced=false;p.color=chipColors[i%2];
    }
  }
  function updateSparks(dt){
    let count=0;
    for(const p of chips){
      if(p.life<=0)continue;
      p.life-=dt;if(p.life<=0)continue;
      p.vy-=24*dt;p.y+=p.vy*dt;p.x+=p.vx*dt;p.z+=p.vz*dt;p.angle+=p.spin*dt;
      if(p.y<p.floor&&p.vy<0){
        if(p.bounced){p.life=0;continue;}
        p.bounced=true;p.y=p.floor;p.vy*=-.4;
      }
      const size=p.size*Math.min(1,p.life*10);
      chipPose.position.set(p.x,p.y,p.z);chipPose.scale.set(size*2.5,size,size);
      chipPose.rotation.set(p.angle,p.angle*.7,p.angle*.3);chipPose.updateMatrix();
      chipMesh.setMatrixAt(count,chipPose.matrix);chipMesh.setColorAt(count,p.color);count++;
    }
    chipMesh.count=count;chipMesh.visible=count>0;
    if(count){chipMesh.instanceMatrix.needsUpdate=true;chipMesh.instanceColor.needsUpdate=true;}
  }
  function punchBurst(car){
    const p=car.body.position,f=car.forward,c=Math.cos(car.punchAngle),s=Math.sin(car.punchAngle);
    const dx=f.x*c-f.z*s,dz=f.z*c+f.x*s;
    const arc=particle(light,lightParticles,p.x+dx*2.1,p.y+.1,p.z+dz*2.1,
      .17,car.punchHeavy?1.4:.85,.75,3,dx*12,0,dz*12,whiteColor,8,0,.6);
    arc.spin=0;
  }
  function impact(position, power = 1) {
    metalSparks(position,power);
    for (let i = 0; i < 15; i++) {
      // Original THREE.Mesh UUID consumed four draws before its four explicit
      // particle draws. Preserve all 120 calls and their ordering for gameplay RNG.
      Math.random(); Math.random(); Math.random(); Math.random();
      const lifeSample = Math.random();
      const xSample = Math.random(), ySample = Math.random(), zSample = Math.random();
      const white = i % 3 === 0;
      const color = white ? whiteColor : debrisColor;
      particle(white ? light : dust, white ? lightParticles : dustParticles,
        position.x, position.y + 0.08, position.z,
        0.35 + lifeSample * 0.35, white ? 0.25 : 0.24 + lifeSample * 0.12, white ? 0.75 : 0.85, 1,
        (xSample - 0.5) * 12 * power, (ySample * 8 + 2) * power, (zSample - 0.5) * 12 * power,
        color, white ? 0.05 : 0.12, 18, 1.6);
    }
    particle(light, lightParticles, position.x, position.y + 0.15, position.z,
      0.24, 4.4 * power, 1.0, 2, 0, 0, 0, impactColor, 6, 0, 0);
    particle(light, lightParticles, position.x, position.y + 0.16, position.z,
      0.31, 4.5 * power, 0.85, 4, 0, 0, 0, whiteColor, 10, 0, 0).spin = 0;
    particle(light, lightParticles, position.x, position.y + 0.17, position.z,
      0.36, 2.2 * power, 0.8, 3, 0, 0, 0, whiteColor, 16 * power, 0, 0).spin = 0;
    writeGround(rings, clock, position.x, Math.max(0.035, position.y - 0.53), position.z,
      2.7, 2.7, 0, 0.52, 0.75, ringColor, 3.3 * power);
    ringsUntil = Math.max(ringsUntil, clock + 0.52);
    for (let i = 0; i < 5; i++) dustPuff(position.x, Math.max(0.12, position.y - 0.32), position.z, 1.4 * power);
  }

  function skid(car) {
    const body = car.body;
    const forwardLength = Math.hypot(car.forward.x, car.forward.z) || 1;
    const lateral = Math.abs((-car.forward.z * (body.velocity?.x || 0) + car.forward.x * (body.velocity?.z || 0)) / forwardLength);
    // A steering input alone does not mean the tire is sliding.
    if (!car.grounded || body.position.y > 1.1 || Math.abs(car.speed) < 4 || (lateral <= 3 && !car.brake && !car.drifting)) return;
    const state = carState(car);
    const quaternion = body.quaternion || car.visual.group.quaternion;
    const yaw = Math.atan2(-car.forward.x, -car.forward.z);
    for (let side = 0; side < 2; side++) {
      wheelPoint.set(side === 0 ? -0.82 : 0.82, -0.6, 0.9).applyQuaternion(quaternion);
      const x = wheelPoint.x + body.position.x, z = wheelPoint.z + body.position.z;
      const last = state.marks[side];
      const dx = x - last.x, dz = z - last.z, distance = Math.hypot(dx, dz);
      const connected = clock - last.time < 0.22 && distance > 0.04 && distance < 2.8;
      const life = 12 + random() * 6;
      writeGround(tracks, clock, connected ? (x + last.x) * 0.5 : x,
        0.027 + (tracks.cursor % 3) * 0.0002, connected ? (z + last.z) * 0.5 : z,
        0.24, connected ? distance + 0.24 : 0.65, connected ? Math.atan2(dx, dz) : yaw,
        life, (car.drifting ? .31 : .18) + random() * 0.07, trackColor);
      tracksUntil = Math.max(tracksUntil, clock + life);
      last.time = clock; last.x = x; last.z = z;
      if (clock >= state.dustAt) {
        dustPuff(x, 0.22, z, car.drifting ? .85 : .5, body.velocity?.x || 0, body.velocity?.z || 0,car.drifting ? cloudColor : landingColor);
        if(car.drifting && car.nitroTanks>0){
          const color=car.nitroTanks<2?turboColor:side===0?fullTankColor:sparkColor;
          particle(light,lightParticles,x,.2,z,.26,.24,.85,5,-car.forward.x*2,.65,-car.forward.z*2,color,.3,4,.8);
        }
      }
    }
    if (clock >= state.dustAt) state.dustAt = clock + (car.drifting ? .065 : .15);
  }

  function collision(position, strength = 1) {
    const power = clamp(strength, 0.25, 2.5);
    if(strength>=(30/3.6)/15)metalSparks(position,power);
    const count = Math.round(5 + power * 5);
    for (let i = 0; i < count; i++) {
      const angle = random() * TAU, speed = (2 + random() * 5) * power;
      const spark = particle(light, lightParticles, position.x, position.y + 0.15, position.z,
        0.18 + random() * 0.24, 0.25 + random() * 0.3, 0.85, 5,
        Math.sin(angle) * speed, 1.3 + random() * 4, Math.cos(angle) * speed,
        sparkColor, 0.1, 17, 0.7);
      spark.stretch = 0.17; spark.angle = angle; spark.spin = 0;
    }
    particle(light, lightParticles, position.x, position.y + 0.15, position.z,
      0.12, 1.3 + power * 0.7, 0.65, 2, 0, 0, 0, impactColor, 1.4, 0, 0);
  }

  function cloudSplash(x, y, z) {
    for (let i = 0; i < 22; i++) {
      const angle = i * TAU / 22, speed = 2 + random() * 6;
      particle(dust, dustParticles, x + Math.sin(angle), y, z + Math.cos(angle),
        1.1 + random() * 0.8, 2.1 + random(), 0.3, 0,
        Math.sin(angle) * speed, 1.4 + random() * 2, Math.cos(angle) * speed,
        cloudColor, 4.2, 0.4, 0.9);
    }
    writeGround(rings, clock, x, y + 0.2, z, 7, 7, 0, 0.85, 0.48, whiteColor, 3.2);
    ringsUntil = Math.max(ringsUntil, clock + 0.85);
  }

  const beaconColor=new THREE.Color();
  function fall(position,color) {
    if(color){
      beaconColor.set(color);
      const tint=[beaconColor.r*.85+.15,beaconColor.g*.85+.15,beaconColor.b*.85+.15];
      const beam=particle(light,lightParticles,position.x,position.y+5,position.z,
        .68,2.7,1,6,0,5,0,tint,1,0,0);
      beam.stretch=8;beam.spin=0;beam.angle=0;
    }
    if (position.y <= -23) { cloudSplash(position.x, -27, position.z); return; }
    const emitter = fallEmitters[fallCursor++ % fallEmitters.length];
    emitter.active = true; emitter.x = position.x; emitter.y = position.y;
    emitter.z = position.z; emitter.speed = 11; emitter.age = 0; emitter.nextPuff = 0;
  }

  function knockout(position, combo = 1) {
    const power = 1 + Math.min(3, Math.max(0, combo - 1)) * 0.18;
    particle(light, lightParticles, position.x, position.y + 0.6, position.z,
      0.45, 4, 0.85, 3, 0, 0, 0, sparkColor, 17 * power, 0, 0);
    particle(light, lightParticles, position.x, position.y + 0.6, position.z,
      0.35, 6, 0.65, 4, 0, 0, 0, whiteColor, 10 * power, 0, 0);
  }

  function advanceParticles(batch, pool, dt) {
    const a = batch.attributes;
    let count = 0;
    for (const p of pool) {
      if (p.life <= 0) continue;
      p.age += dt;
      if (p.age >= p.life) { p.life = 0; continue; }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag; p.vz *= drag; p.vy -= p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.angle += p.spin * dt;
      const progress = p.age / p.life;
      const size = p.size + p.growth * p.age;
      const fadeIn = p.kind === 0 ? Math.min(1, p.age / 0.07) : 1;
      const alpha = p.opacity * fadeIn * Math.pow(1 - progress, p.kind === 0 ? 1.1 : 1.7);
      a.effectCenter.setXYZ(count, p.x, p.y, p.z);
      a.effectSize.setXY(count, size, size * p.stretch);
      a.effectTint.setXYZW(count, p.red, p.green, p.blue, alpha);
      a.effectShape.setXY(count, p.angle, p.kind);
      count++;
    }
    batch.used = count;
    batch.dirty = true;
    upload(batch);
  }

  function update(dt, cars, playing = true) {
    if (!playing || !Number.isFinite(dt) || dt <= 0) return;
    clock += dt;
    for (const car of cars) {
      const state = carState(car);
      const position = car.body.position;
      if (car.active && (car.effect === 'boost' || car.driftBoost) && clock >= state.boostAt) {
        state.boostAt = clock + 0.045;
        for (let side = -1; side <= 1; side += 2) {
          wheelPoint.set(side * 0.48, -0.16, 1.65).applyQuaternion(car.body.quaternion || car.visual.group.quaternion);
          particle(light, lightParticles, position.x + wheelPoint.x, position.y + wheelPoint.y, position.z + wheelPoint.z,
            0.22 + random() * 0.14, 0.7, 0.72, 2, -car.forward.x * 4, 0.16, -car.forward.z * 4,
            side < 0 ? turboColor : turboCoreColor, 1.1, 0, 1.3);
        }
      }
      if (car.active && position.y < -1.8 && clock >= state.fallAt) {
        state.fallAt = clock + 0.065;
        const trail = particle(dust, dustParticles, position.x, position.y + 0.8, position.z,
          0.7, 1.1, 0.28, 0, 0, 1.5, 0, cloudColor, 2.2, 0, 0.6);
        trail.stretch = 2.3; trail.angle = 0;
      }
      if (!car.active || !state.active) {
        state.airTime = 0; state.fallSpeed = 0;
        state.marks[0].time = state.marks[1].time = -99;
      } else if (!car.grounded) {
        state.airTime += dt;
        state.fallSpeed = Math.max(state.fallSpeed, -(car.body.velocity?.y || 0));
      } else {
        if (!state.grounded && state.airTime > 0.09 && state.fallSpeed > 2.2) {
          const strength = clamp(state.fallSpeed / 6, 0.7, 1.8);
          for (let i = 0; i < 7; i++) {
            const angle = i * TAU / 7;
            dustPuff(position.x + Math.sin(angle) * 0.9, Math.max(0.12, position.y - 0.43), position.z + Math.cos(angle) * 1.15, strength);
          }
        }
        state.airTime = 0; state.fallSpeed = 0;
      }
      state.grounded = !!car.grounded; state.active = !!car.active;
    }
    for (const emitter of fallEmitters) {
      if (!emitter.active) continue;
      emitter.age += dt; emitter.speed += 19 * dt; emitter.y -= emitter.speed * dt;
      if (emitter.age >= emitter.nextPuff) {
        emitter.nextPuff = emitter.age + 0.07;
        const plume = particle(dust, dustParticles, emitter.x, emitter.y + 1, emitter.z,
          0.75, 1.2, 0.24, 0, 0, 0.8, 0, cloudColor, 1.8, 0, 0.5);
        plume.stretch = 2.4; plume.angle = 0;
      }
      if (emitter.y <= -27) { cloudSplash(emitter.x, -27, emitter.z); emitter.active = false; }
    }
    updateSparks(dt);
    advanceParticles(dust, dustParticles, dt);
    advanceParticles(light, lightParticles, dt);
    for (const batch of groundBatches) {
      batch.material.uniforms.effectTime.value = clock;
      upload(batch);
    }
    tracks.mesh.visible = tracks.used > 0 && clock < tracksUntil;
    rings.mesh.visible = rings.used > 0 && clock < ringsUntil;
  }

  function reset() {
    clock = 0; seed = 0x5a17c9e3; tracksUntil = 0; ringsUntil = 0;
    fallCursor = 0;
    chipCursor=0;chipMesh.count=0;chipMesh.visible=false;
    for(const chip of chips)chip.life=0;
    for (const emitter of fallEmitters) emitter.active = false;
    states.clear();
    for (const pool of [dustParticles, lightParticles]) for (const p of pool) { p.life = 0; p.age = 0; }
    for (const batch of batches) {
      batch.cursor = 0; batch.used = 0; batch.geometry.instanceCount = 0;
      batch.mesh.visible = false; batch.dirty = false;
      batch.material.uniforms.effectTime.value = 0;
    }
  }

  const rocketColor = [1.0, 0.25, 0.75];
  function trailPuff(position) {
    particle(light, lightParticles, position.x, position.y, position.z, 0.32, 0.9, 0.85, 2, 0, 0.4, 0, rocketColor, 1.6, 0, 1);
  }
  function shockwave(position) {
    writeGround(rings, clock, position.x, Math.max(0.04, position.y - 0.5), position.z, 3.2, 3.2, 0, 0.6, 0.95, [1.0, 0.9, 0.4], 7);
    ringsUntil = Math.max(ringsUntil, clock + 0.6);
    particle(light, lightParticles, position.x, position.y + 0.3, position.z, 0.3, 9, 0.8, 3, 0, 0, 0, [1.0, 0.85, 0.35], 26, 0, 0).spin = 0;
  }
  // Nitro ignition: a cone of blue sparks out of the exhaust plus a faint ground ring.
  function nitroBurst(car) {
    const p = car.body.position, f = car.forward, l = Math.hypot(f.x, f.z) || 1, fx = f.x / l, fz = f.z / l;
    const ex = p.x - fx * 1.9, ez = p.z - fz * 1.9;
    for (let i = 0; i < 14; i++) {
      const spread = (random() - 0.5) * 1.6, speed = 6 + random() * 7;
      const spark = particle(light, lightParticles, ex, p.y - 0.15, ez, 0.25 + random() * 0.2, 0.3 + random() * 0.25, 0.9, 5,
        (-fx + -fz * spread * 0.4) * speed, 0.6 + random() * 1.5, (-fz + fx * spread * 0.4) * speed, i % 3 ? turboColor : turboCoreColor, 0.15, 6, 1.2);
      spark.stretch = 0.2; spark.angle = Math.atan2(-fz, -fx); spark.spin = 0;
    }
    particle(light, lightParticles, ex, p.y - 0.1, ez, 0.22, 2.6, 0.85, 2, 0, 0, 0, turboCoreColor, 5, 0, 0);
    writeGround(rings, clock, p.x, Math.max(0.04, p.y - 0.58), p.z, 2.4, 2.4, 0, 0.45, 0.6, turboColor, 2.6);
    ringsUntil = Math.max(ringsUntil, clock + 0.45);
  }
  return { impact, punchBurst, skid, update, reset, collision, fall, knockout, trailPuff, shockwave, nitroBurst };
}
