import * as THREE from 'three';

const deadZone = .15;
const centered = value => Math.abs(value) < deadZone ? 0 : value;
const held = (keys, ...codes) => codes.some(code => keys.has(code));

// With one controller at a couch match, the keyboard and the controller can each drive a car.
export function createLocalControls(actions) {
  const previous = [null, null];
  const devices = [null, null];
  const neutral = {steer:0, throttle:0, drift:false};
  const analog = [{...neutral}, {...neutral}];
  function clear() {
    previous.fill(null);
    devices.fill(null);
    analog.forEach(input => Object.assign(input, neutral));
  }
  function poll(duo) {
    let connected = [];
    try { connected = Array.from(navigator.getGamepads?.() || []).filter(p => p?.connected && p.mapping === 'standard'); } catch {}
    const players = duo ? [1, 0] : [0];
    for (const id of players) {
      if (devices[id] !== null && !connected.some(p => p.index === devices[id])) {
        actions.cancel(id);
        previous[id] = null;
        devices[id] = null;
      }
    }
    for (const id of players) {
      if (devices[id] === null) devices[id] = connected.find(p => !devices.includes(p.index))?.index ?? null;
      const pad = connected.find(p => p.index === devices[id]);
      if (!pad) { Object.assign(analog[id], neutral); continue; }
      const button = i => !!pad.buttons[i]?.pressed;
      const value = i => pad.buttons[i]?.value || 0;
      const state = [button(0), button(2), button(1)];
      const prev = previous[id];
      if (prev) {
        if (state[0] !== prev[0]) (state[0] ? actions.press : actions.release)(id);
        if (state[1] && !prev[1]) actions.item(id);
        if (state[2] && !prev[2]) actions.nitro(id);
      }
      previous[id] = state;
      analog[id].steer = -centered(pad.axes[0] || 0) || Number(button(14))-Number(button(15));
      analog[id].throttle = value(7)-value(6) || Number(button(12))-Number(button(13));
      analog[id].drift = button(4);
    }
  }
  function read(car, keys, duo) {
    const other = car.id === 1;
    const arrow = other || !duo;
    const wasd = !other;
    const a = analog[car.id];
    const throttle = Number((wasd && held(keys,'KeyW')) || (arrow && held(keys,'ArrowUp'))) - Number((wasd && held(keys,'KeyS')) || (arrow && held(keys,'ArrowDown')));
    const steer = Number((wasd && held(keys,'KeyA')) || (arrow && held(keys,'ArrowLeft'))) - Number((wasd && held(keys,'KeyD')) || (arrow && held(keys,'ArrowRight')));
    car.throttle = throttle || a.throttle;
    car.steer = steer || a.steer;
    car.brake = false;
    car.driftInput = a.drift || (other ? held(keys,'ShiftRight') : held(keys,'ShiftLeft','KeyZ') || (!duo && held(keys,'ShiftRight')));
  }
  return {poll, read, clear};
}

export function createLocalCameras(renderer, scene, camera) {
  const second = camera.clone();
  const center = new THREE.Vector3(), eye = new THREE.Vector3(), forward = new THREE.Vector3();
  const target = new THREE.Vector3();
  let fresh = true;
  function shared(cars, dt, cut, focus) {
    const a = cars[0].active ? cars[0] : null;
    const b = cars[1].active ? cars[1] : null;
    const first = a || b || focus, last = b || a || focus;
    const p = first.body.position, q = last.body.position;
    center.set((p.x+q.x)/2, Math.max(0,(p.y+q.y)/2), (p.z+q.z)/2);
    camera.fov = 52;
    const tangent = Math.tan(THREE.MathUtils.degToRad(26));
    const span = Math.max(7, (Math.abs(p.x-q.x)*.5+4)/camera.aspect, Math.abs(p.z-q.z)*.5+4);
    const distance = Math.max(15,span/tangent+Math.abs(p.z-q.z)*.23);
    eye.copy(center); eye.y += distance*.90; eye.z += distance*.44;
    camera.position.lerp(eye, cut ? 1 : 1-Math.exp(-dt*6));
    camera.up.set(0,1,0);
    camera.lookAt(center); camera.updateProjectionMatrix();
  }
  function split(car, cfg, dt) {
    const horizontal = innerWidth >= innerHeight;
    const cut = Math.floor((horizontal ? innerWidth : innerHeight)/2);
    const view = horizontal ? [cut,0,innerWidth-cut,innerHeight] : [0,0,innerWidth,cut];
    const primary = horizontal ? [0,0,cut,innerHeight] : [0,cut,innerWidth,innerHeight-cut];
    const p = car.body.position;
    forward.set(car.forward.x,0,car.forward.z).normalize();
    eye.set(p.x,Math.max(-18,p.y),p.z).addScaledVector(forward,-(cfg.distance || 8.5));
    eye.y += cfg.height || 5.2;
    center.set(p.x,Math.max(-22,p.y)+.9,p.z).addScaledVector(forward,cfg.look || 3);
    const blend = fresh ? 1 : 1-Math.exp(-dt*8);
    second.position.lerp(eye,blend); target.lerp(center,blend); second.lookAt(target);
    second.fov = (cfg.fov || 58)+(car.nitroOn ? 11 : 0);
    fresh = false;
    const oldAspect = camera.aspect;
    renderer.setScissorTest(true);
    for (const [cam,rect] of [[camera,primary],[second,view]]) {
      cam.aspect = rect[2]/rect[3]; cam.updateProjectionMatrix();
      renderer.setViewport(...rect); renderer.setScissor(...rect); renderer.render(scene,cam);
    }
    camera.aspect = oldAspect; camera.updateProjectionMatrix();
    renderer.setScissorTest(false); renderer.setViewport(0,0,innerWidth,innerHeight);
  }
  return {shared, split, reset(){ fresh = true; }};
}
