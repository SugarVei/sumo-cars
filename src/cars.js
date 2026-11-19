import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {createCarVisual} from './car-visual.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/** Three chassis classes. Stat bars are out of five and only describe the tuning below. */
export const CAR_CLASSES={
  dart:{id:'dart',name:'疾风',en:'DART',tagline:'轻巧灵活，起步最快；过弯好，但最怕被撞。',mass:96,accel:1.1,top:1.05,grip:1.07,turn:1.1,punch:.85,kits:['wing'],stats:{speed:5,accel:5,handling:5,weight:2,punch:2}},
  rumbler:{id:'rumbler',name:'悍将',en:'RUMBLER',tagline:'均衡全能，没有明显短板。',mass:112,accel:1,top:1,grip:1,turn:1,punch:1,kits:['bar','antenna'],stats:{speed:4,accel:3,handling:3,weight:3,punch:3}},
  bruiser:{id:'bruiser',name:'重锤',en:'BRUISER',tagline:'重型推土车；起步慢，但撞人最狠、最难被推动。',mass:142,accel:.86,top:.95,grip:.95,turn:.9,punch:1.25,kits:['plow','roof'],stats:{speed:3,accel:2,handling:2,weight:5,punch:5}},
};

/** Player paint jobs: body colour, stripe colour, underglow colour. */
export const PAINTS=[
  {id:'arctic',name:'北极白',body:0xf1f3f6,stripe:0xe3202f,glow:0x46e4ff},
  {id:'midnight',name:'午夜黑',body:0x14161f,stripe:0x2ff3ff,glow:0x2ff3ff},
  {id:'sakura',name:'樱花粉',body:0xff5ea8,stripe:0x1b1430,glow:0xff4fd8},
  {id:'ocean',name:'海洋蓝',body:0x2a6dff,stripe:0xf4f6ff,glow:0x5ba8ff},
  {id:'lime',name:'毒液绿',body:0xb9ff2e,stripe:0x15171f,glow:0xb9ff2e},
  {id:'ember',name:'余烬橙',body:0xff6a1f,stripe:0x15171f,glow:0xffa63d},
];

/** Original six-driver roster. Slot 0 is always the player. */
export const ROSTER=[
  {name:'新星',number:1,classId:'rumbler',paint:'arctic',profile:'player'},
  {name:'雷霆',number:22,classId:'rumbler',body:0xf4cf2f,stripe:0x16181f,glow:0xffe14a,profile:'puncher'},
  {name:'利刃',number:13,classId:'dart',body:0x8f55ff,stripe:0x16181f,glow:0xb47bff,profile:'flanker'},
  {name:'磐石',number:88,classId:'bruiser',body:0xff8a2b,stripe:0x16181f,glow:0xff9a3c,profile:'pusher'},
  {name:'灵狐',number:7,classId:'dart',body:0x1fcfbf,stripe:0x16181f,glow:0x3dffe9,profile:'opportunist'},
  {name:'烈焰',number:31,classId:'rumbler',body:0xf2394d,stripe:0xf1f3f6,glow:0xff4b62,profile:'rammer'},
];

/** Driving personalities; the numbers bias the shared AI helpers. */
export const PROFILES={
  player:{pace:1,punch:3,edge:1,flank:0,aggression:1,label:'You'},
  puncher:{pace:.97,punch:6.5,edge:1,flank:0,aggression:1.05,label:'Punch specialist'},
  flanker:{pace:1.05,punch:3.2,edge:1.1,flank:3.6,aggression:.95,label:'Flanker'},
  pusher:{pace:.9,punch:1.8,edge:1,flank:0,aggression:1.1,label:'Heavy pusher'},
  opportunist:{pace:1.02,punch:3,edge:.95,flank:.4,aggression:.9,label:'Opportunist'},
  rammer:{pace:1.1,punch:1,edge:.7,flank:0,aggression:1.2,label:'Ram specialist'},
};

export function paintById(id){return PAINTS.find(p=>p.id===id)||PAINTS[0];}

/** Nitro: drifting fills the gauge; every full gauge becomes a tank (max two); Space fires one. */
export const NITRO={tanks:2,rate:.5,duration:2.2,kick:4.5};
export function addNitro(car,amount,env){
  if(!(amount>0))return;
  car.nitro+=amount;
  while(car.nitro>=1&&car.nitroTanks<NITRO.tanks){car.nitro-=1;car.nitroTanks++;env?.hooks?.nitroReady?.(car);}
  if(car.nitroTanks>=NITRO.tanks)car.nitro=Math.min(car.nitro,1);
}
export function useNitro(car,env){
  if(!car.active||car.nitroTanks<1)return false;
  car.nitroTanks--;car.nitroEnd=Math.max(car.nitroEnd,env.simTime)+NITRO.duration;
  if(car.grounded){const f=car.forward,l=Math.hypot(f.x,f.z)||1;car.body.velocity.x+=f.x/l*NITRO.kick;car.body.velocity.z+=f.z/l*NITRO.kick;}
  env.hooks?.nitroFire?.(car);
  return true;
}

const UP=new CANNON.Vec3(0,1,0),FWD=new CANNON.Vec3(0,0,-1);
const forward=new CANNON.Vec3(),right=new CANNON.Vec3(),rayFrom=new CANNON.Vec3(),rayTo=new CANNON.Vec3(),worldUp=new CANNON.Vec3(0,1,0);
const tmp=new CANNON.Vec3(),impulse=new CANNON.Vec3(),impulsePoint=new CANNON.Vec3(),punchRay=new CANNON.RaycastResult();
const carRay=new CANNON.RaycastResult();
const AIM_CONE=22*Math.PI/180, PUNCH_REACH=5.4, ASSIST_REACH=PUNCH_REACH*1.2;
const strikeDir=new CANNON.Vec3(),strikeRight=new CANNON.Vec3();
const shotEnd=new CANNON.Vec3();
export const GLOVES={
  spring:{name:'弹簧拳',tip:'直线击退，冷却最短。',reach:ASSIST_REACH},
  hook:{name:'抓钩拳',tip:'射程 10 米，将双方拉近。',reach:10,cooldown:3.5},
  hammer:{name:'震荡锤',tip:'近身横扫 120°，可震松熔毁地块。',reach:4.3,cooldown:3.2},
  rocket:{name:'火箭拳',tip:'直飞 25 米，击中首辆车，冷却 6 秒。',reach:25,cooldown:6},
};

export function createCars(world,scene,carMaterial){
  const cars=[];
  for(let id=0;id<6;id++){
    const body=new CANNON.Body({mass:110,material:carMaterial,linearDamping:.12,angularDamping:.52,allowSleep:false});
    // Car-to-car contact happens on the low chassis box only; the cabin still meets the ground in a rollover.
    const chassis=new CANNON.Box(new CANNON.Vec3(.9,.33,1.62)),cabin=new CANNON.Box(new CANNON.Vec3(.72,.32,.85));
    chassis.collisionFilterGroup=16;cabin.collisionFilterGroup=32;cabin.collisionFilterMask=~(16|32);
    body.addShape(chassis,new CANNON.Vec3(0,-.28,0));body.addShape(cabin,new CANNON.Vec3(0,.28,.1));
    body.collisionFilterGroup=2;world.addBody(body);
    const entry=ROSTER[id];
    const car={id,isPlayer:id===0,name:entry.name,number:entry.number,color:'#ffffff',glow:0xffffff,classId:entry.classId,stats:CAR_CLASSES[entry.classId],
      profile:PROFILES[entry.profile],body,visual:null,score:0,
      glove:'spring',rocket:null,cooldown:0,punchCooldown:2,punchAge:99,punchHits:new Set(),punchConnected:false,punchHeldAt:null,punchAngle:0,punchHeavy:0,stagger:0,active:true,respawnAt:0,invulnerable:0,ghostUntil:0,lastAttacker:null,lastHit:-99,
      effect:null,effectEnd:0,grounded:false,up:new CANNON.Vec3(0,1,0),forward:new CANNON.Vec3(0,0,-1),groundNormal:new CANNON.Vec3(0,1,0),
      speed:0,steer:0,throttle:0,brake:false,driftInput:false,stuck:0,reverseUntil:0,flipped:0,target:null,retarget:0,
      previousVelocity:new CANNON.Vec3(),skidTime:0,ray:new CANNON.RaycastResult(),
      hitFlash:0,aimX:0,aimZ:0,revenge:null,combo:0,lastKO:-99,wasGrounded:false,fallVelocity:0,airTime:0,
      drifting:false,driftDirection:0,driftCharge:0,driftTime:0,driftBoostEnd:0,driftBoost:false,lateral:0,driftSlip:0,gripRecovery:1,
      speedMul:1,padBoostEnd:0,nitro:0,nitroTanks:0,nitroEnd:0,nitroOn:false,record:null,mode:{}};
    cars.push(car);
  }
  return cars;
}

/** Rebuild one car's look and tune its chassis for a new event. */
export function configureCar(car,scene,{classId,paint,name,number}={}){
  const entry=ROSTER[car.id];
  car.classId=CAR_CLASSES[classId]?classId:entry.classId;car.stats=CAR_CLASSES[car.classId];
  if(name)car.name=name;if(number)car.number=number;
  const colors=car.isPlayer?paintById(paint||entry.paint):{body:entry.body,stripe:entry.stripe,glow:entry.glow};
  car.color='#'+colors.body.toString(16).padStart(6,'0');car.glow=colors.glow;car.paint=colors;
  car.body.mass=car.stats.mass;car.body.updateMassProperties();
  if(car.visual){scene.remove(car.visual.group);car.visual.dispose?.();}
  car.visual=createCarVisual(colors.body,car.isPlayer,car.name,car.number,{classId:car.classId,kits:car.stats.kits,stripe:colors.stripe,glow:colors.glow});
  scene.add(car.visual.group);
}

export function placeCar(car,x,z,yaw,y=.7,simTime=0,shield=1.2){
  const b=car.body;b.position.set(x,y,z);b.quaternion.setFromEuler(0,yaw,0);
  b.velocity.setZero();b.angularVelocity.setZero();b.force.setZero();b.torque.setZero();
  b.previousPosition.copy(b.position);b.interpolatedPosition.copy(b.position);
  b.previousQuaternion.copy(b.quaternion);b.interpolatedQuaternion.copy(b.quaternion);
  b.aabbNeedsUpdate=true;b.collisionResponse=true;b.collisionFilterMask=-1;b.wakeUp();
  car.active=true;car.visual.group.visible=true;car.invulnerable=simTime+shield;car.ghostUntil=0;
  car.lastAttacker=null;car.lastHit=-99;car.flipped=0;car.stuck=0;car.reverseUntil=0;
  car.speed=0;car.steer=0;car.throttle=0;car.brake=false;car.grounded=false;car.driftInput=false;
  car.up.set(0,1,0);b.quaternion.vmult(FWD,car.forward);car.previousVelocity.setZero();car.groundNormal.set(0,1,0);
  car.punchAge=99;car.punchHeldAt=null;car.punchHeavy=0;car.punchAngle=0;car.rocket=null;car.punchHits.clear();car.visual.updatePunch(0);
  car.wasGrounded=false;car.fallVelocity=0;car.hitFlash=0;car.target=null;car.retarget=0;car.airTime=0;
  car.drifting=false;car.driftCharge=0;car.driftTime=0;car.driftBoostEnd=0;car.driftBoost=false;car.lateral=0;car.driftSlip=0;car.gripRecovery=1;
  car.nitroEnd=0;car.nitroOn=false;
  car.visual.group.position.copy(b.position);car.visual.group.quaternion.copy(b.quaternion);
  car.visual.resetTrail?.();
}

/** Ghost cars still ride the floor but pass through other cars. */
export function setGhost(car,on){car.body.collisionFilterMask=on?(-1&~2):-1;}

export function recover(car){
  if(!car.active||!car.grounded||car.up.y>.45)return false;
  const yaw=Math.atan2(-car.forward.x,-car.forward.z);
  car.body.quaternion.setFromEuler(0,yaw,0);car.body.position.y+=.75;car.body.angularVelocity.setZero();
  car.body.velocity.scale(.4,car.body.velocity);car.body.aabbNeedsUpdate=true;car.flipped=0;
  return true;
}

function clearPunchPath(from,to,world,mask=1|4){
  punchRay.reset();
  world.raycastClosest(from,to,{collisionFilterMask:mask,skipBackfaces:true},punchRay);
  return !punchRay.hasHit;
}

function acquirePunchAngle(car,simTime,env){
  const p=car.body.position,f=car.forward;
  let nearest=Math.min(10,GLOVES[car.glove].reach),angle=0;
  for(const target of env.cars){
    if(target===car||!target.active||target.invulnerable>simTime||target.ghostUntil>simTime)continue;
    const q=target.body.position,dx=q.x-p.x,dz=q.z-p.z,distance=Math.hypot(dx,dz);
    if(distance<=1||distance>nearest||Math.abs(q.y-p.y)>=2.2)continue;
    const offset=Math.atan2(-f.z*dx+f.x*dz,f.x*dx+f.z*dz);
    if(Math.abs(offset)>AIM_CONE||!clearPunchPath(p,q,env.world))continue;
    nearest=distance;angle=offset;
  }
  return angle;
}

export function startPunch(car,simTime,env,charge=0,cooldownScale=1){
  if(!car.active||car.cooldown>0)return false;
  car.punchHeavy=charge>=.6?clamp(charge,.6,1):0;
  car.punchAngle=car.glove==='hammer'?0:acquirePunchAngle(car,simTime,env);
  car.punchCooldown=((GLOVES[car.glove].cooldown??env.cooldown??2)+(car.punchHeavy&&car.glove!=='rocket'?1:0))*cooldownScale;
  car.cooldown=car.punchCooldown;car.punchAge=0;car.punchHits.clear();car.punchConnected=false;
  if(car.glove==='rocket'){
    const f=car.forward,s=Math.sin(car.punchAngle),c=Math.cos(car.punchAngle);
    const dir=new CANNON.Vec3(f.x*c-f.z*s,clamp(f.y,-.45,.45),f.z*c+f.x*s);
    dir.normalize();
    const pos=car.body.position.clone();pos.y+=.18;
    car.rocket={pos,dir,remaining:25};
  }
  return true;
}

/**
 * Arcade drive model shared by every mode. Forces are applied to a frictionless
 * chassis so the same car can race, drift, ram and be knocked into the void.
 * env: {world, simTime, grip, speedScale, airControl, cars, props, hooks}
 */
export function driveCar(car,dt,env){
  if(!car.active)return;
  const b=car.body,st=car.stats,profile=car.profile;
  b.quaternion.vmult(UP,car.up);b.quaternion.vmult(FWD,car.forward);
  const fx=car.forward.x,fz=car.forward.z,flen=Math.hypot(fx,fz)||1;
  forward.set(fx/flen,0,fz/flen);right.set(-forward.z,0,forward.x);
  car.speed=b.velocity.dot(forward);
  rayFrom.set(b.position.x,b.position.y+.1,b.position.z);rayTo.set(b.position.x,b.position.y-1.2,b.position.z);
  car.ray.reset();env.world.raycastClosest(rayFrom,rayTo,{collisionFilterMask:1,skipBackfaces:true},car.ray);
  car.grounded=car.ray.hasHit&&car.ray.distance<1.16;car.onCar=null;
  if(!car.grounded){
    // A short ray from inside the chassis floor finds a rival's roof without seeing our own body.
    rayFrom.set(b.position.x,b.position.y-.5,b.position.z);rayTo.set(b.position.x,b.position.y-1.12,b.position.z);
    carRay.reset();env.world.raycastClosest(rayFrom,rayTo,{collisionFilterMask:2,skipBackfaces:true},carRay);
    if(carRay.hasHit&&carRay.body!==b){car.grounded=true;car.onCar=carRay.body;}
  }
  if(car.grounded&&!car.onCar)car.groundNormal.copy(car.ray.hitNormalWorld);else car.groundNormal.set(0,1,0);
  if(car.grounded&&!car.wasGrounded&&car.fallVelocity<-3)env.hooks?.landing?.(car,clamp(-car.fallVelocity/12,.15,1));
  car.wasGrounded=car.grounded;car.fallVelocity=b.velocity.y;
  car.airTime=car.grounded?0:car.airTime+dt;
  car.lateral=b.velocity.dot(right);
  car.driftSlip=Math.atan2(car.lateral,Math.max(1,Math.abs(car.speed)));
  const scale=env.speedScale||1;
  const canDrift=car.grounded&&car.up.y>.6&&car.speed>5.8&&car.throttle>=0&&!car.brake;
  if(car.driftInput&&canDrift&&(car.drifting||Math.abs(car.steer)>.18)){
    if(!car.drifting){car.drifting=true;car.driftDirection=Math.sign(car.steer)||1;car.driftCharge=0;car.driftTime=0;car.gripRecovery=0;}
    car.driftTime+=dt;
    // Real sideways slip at speed is what fills the nitro gauge; a lazy wiggle earns almost nothing.
    const slip=Math.abs(car.driftSlip);
    if(slip>.12){const gain=dt*NITRO.rate*clamp(slip/.3,.5,1.3)*clamp(Math.abs(car.speed)/(16*(env.speedScale||1)),.5,1.2);addNitro(car,gain,env);car.driftCharge=clamp(car.driftCharge+gain,0,9);}
  }else if(car.drifting){
    car.drifting=false;car.driftCharge=0;car.driftTime=0;
  }
  if(!car.drifting)car.gripRecovery=Math.min(1,car.gripRecovery+dt*2.8);
  car.nitroOn=car.nitroEnd>env.simTime;car.driftBoost=car.nitroOn;
  const boosting=(car.effect==='boost'&&car.effectEnd>env.simTime)||car.nitroOn||car.padBoostEnd>env.simTime;
  if(car.grounded&&car.up.y>.28){
    const charging=car.punchHeldAt!==null&&env.simTime-car.punchHeldAt>.15;
    const pace=(car.isPlayer?1:profile.pace)*car.speedMul*(charging?.85:1);
    const maxSpeed=(car.nitroOn?27:boosting?25:18)*pace*st.top*scale;
    const allowed=car.throttle>=0?car.speed<maxSpeed:car.speed>-8;
    // Nitro pushes even without throttle input, so a held tank always feels like a shove forward.
    const drive=car.nitroOn?Math.max(car.throttle,.85):car.throttle;
    const accel=(car.nitroOn?30:boosting?25:car.drifting?18.5:17)*pace*st.accel*drive*(allowed?1:0)*(scale>1?1+(scale-1)*.35:1);
    const lateral=car.lateral,grip=(car.brake?2.3:6)*(env.grip||1)*st.grip*(.35+.65*car.gripRecovery);
    const drag=(car.brake?4.2:car.throttle===0?1.4:car.drifting?.42:.65)/(scale>1?scale:1);
    const lateralForce=car.drifting?-lateral*3+car.driftDirection*.7:-lateral*grip;
    b.applyForce(tmp.set((forward.x*accel+right.x*lateralForce-b.velocity.x*drag)*b.mass,0,(forward.z*accel+right.z*lateralForce-b.velocity.z*drag)*b.mass));
    const highSpeed=clamp((Math.abs(car.speed)-16)/16,0,1);
    const steering=(car.drifting?car.steer*1.62+car.driftDirection*.2:car.steer*1.95)*st.turn*(1-.34*highSpeed);
    const turn=steering*clamp(Math.abs(car.speed)/4,0,1)*(car.speed<-.3?-1:1);
    b.angularVelocity.y+=(turn-b.angularVelocity.y)*Math.min(1,dt*(car.drifting?5.5:9));
    // Suspension-like alignment toward the surface the car is resting on.
    const n=car.groundNormal,u=car.up;
    b.torque.x+=(u.y*n.z-u.z*n.y)*b.mass*6-b.angularVelocity.x*b.mass*.95;
    b.torque.z+=(u.x*n.y-u.y*n.x)*b.mass*6-b.angularVelocity.z*b.mass*.95;
    if((Math.abs(lateral)>3||car.drifting||(car.brake&&Math.abs(car.speed)>7))&&Math.abs(car.speed)>4){car.skidTime+=dt;if(car.skidTime>.065){env.hooks?.skid?.(car);car.skidTime=0;}}else car.skidTime=0;
  }else if(!car.grounded&&(env.airControl||(car.airTime>.4&&b.velocity.length()<12))){
    // Mid-air levelling so jumps land on four wheels; also rights a car left leaning on a rival or a kerb.
    const u=car.up,k=env.airControl?2.2:3;
    b.torque.x+=(u.y*worldUp.z-u.z*worldUp.y)*b.mass*k-b.angularVelocity.x*b.mass*.35;
    b.torque.z+=(u.x*worldUp.y-u.y*worldUp.x)*b.mass*k-b.angularVelocity.z*b.mass*.35;
    if(env.airControl)b.angularVelocity.y+=(car.steer*1.1-b.angularVelocity.y)*Math.min(1,dt*2);
  }
  // A car parked on top of another slides off sideways instead of riding it forever.
  if(car.onCar){const other=car.onCar;const dx=b.position.x-other.position.x,dz=b.position.z-other.position.z,len=Math.hypot(dx,dz)||1;b.velocity.x+=dx/len*6*dt;b.velocity.z+=dz/len*6*dt;}
  if(car.up.y<.2&&car.grounded){car.flipped+=dt;if(car.flipped>2.2)recover(car);}else car.flipped=0;
  const lastPunchAge=car.punchAge;
  car.cooldown=Math.max(0,car.cooldown-dt);car.punchAge+=dt;car.hitFlash=Math.max(0,car.hitFlash-dt*5);
  if(car.effect&&env.simTime>car.effectEnd)car.effect=null;
  if(car.rocket)advanceRocket(car,dt,env);
  else if(car.glove!=='rocket'&&car.punchAge>.035&&car.punchAge<.18)resolvePunch(car,env);
  if(lastPunchAge<.18&&car.punchAge>=.18&&car.punchHeavy&&car.glove!=='rocket'&&car.punchHits.size===0){
    b.velocity.x+=forward.x*3.6*car.punchHeavy;b.velocity.z+=forward.z*3.6*car.punchHeavy;
  }
  car.previousVelocity.copy(b.velocity);
}

function canHit(car,target,now){
  return target!==car&&target.active&&!car.punchHits.has(target.id)&&target.invulnerable<=now&&target.ghostUntil<=now&&car.ghostUntil<=now;
}

function hitCar(car,target,dir,env){
  const b=car.body,t=target.body;
  car.punchHits.add(target.id);
  const powered=car.effect==='power'||car.punchHeavy>0;
  const shielded=target.effect==='shield'&&target.effectEnd>env.simTime;
  const closing=clamp(b.velocity.dot(dir)-t.velocity.dot(dir),0,26);
  const base=(car.effect==='power'?20:12)*car.stats.punch+.24*closing;
  const power=base*(1+1.5*car.punchHeavy)*(1+.1*target.stagger)*(car.nitroEnd>env.simTime?1.2:1)*(env.punchScale||1)*(shielded?.15:1);
  if(car.glove==='hook'){
    // Equal and opposite impulses keep a rescue hook useful near the ledge, and a heavy target hard to reel in.
    impulse.set(dir.x*70*power,0,dir.z*70*power);
    b.applyImpulse(impulse);impulse.negate(impulse);t.applyImpulse(impulse);
  }else if(env.punchStyle==='side'){
    const sideSign=Math.sign((t.position.x-b.position.x)*(-dir.z)+(t.position.z-b.position.z)*dir.x)||(Math.random()<.5?-1:1);
    impulse.set((-dir.z*sideSign*.55+dir.x*.08)*110*power,220*(shielded?.3:1),(dir.x*sideSign*.55+dir.z*.08)*110*power);
    t.applyImpulse(impulse);
    if(!shielded){t.angularVelocity.y+=-sideSign*(powered?4.5:3);t.velocity.x*=.86;t.velocity.z*=.86;}
  }else{
    const weight=car.glove==='hammer'?.82:car.glove==='rocket'?.74:1;
    impulse.set(dir.x*110*power*weight,110*(3.2+1.8*car.punchHeavy)*(shielded?.3:1),dir.z*110*power*weight);
    impulsePoint.set(-dir.x*.4,.16,-dir.z*.4);
    t.applyImpulse(impulse,impulsePoint);
  }
  target.lastAttacker=car.id;target.lastHit=env.simTime;target.hitFlash=1;
  if(!shielded)target.stagger=Math.min(5,target.stagger+1);
  env.hooks?.punchHit?.(car,target,powered,shielded);
}

function advanceRocket(car,dt,env){
  const shot=car.rocket,from=shot.pos,dir=shot.dir;
  const step=Math.min(shot.remaining,38*dt);
  shotEnd.set(from.x+dir.x*step,from.y+dir.y*step,from.z+dir.z*step);
  const blocked=!clearPunchPath(from,shotEnd,env.world);
  const limit=blocked?punchRay.distance:step;
  let nearest=null,first=Infinity;
  for(const target of env.cars){
    if(!canHit(car,target,env.simTime))continue;
    const p=target.body.position,dx=p.x-from.x,dy=p.y-from.y,dz=p.z-from.z;
    const along=dx*dir.x+dy*dir.y+dz*dir.z;
    if(along<0||along>limit+1.15||along>=first)continue;
    const at=Math.min(along,limit);
    if(Math.hypot(dx-dir.x*at,dy-dir.y*at,dz-dir.z*at)>1.15||!clearPunchPath(from,p,env.world))continue;
    first=along;nearest=target;
  }
  if(nearest)hitCar(car,nearest,dir,env);
  shot.pos.copy(shotEnd);shot.remaining-=step;
  if(nearest||blocked||shot.remaining<=0)car.rocket=null;
}

function resolvePunch(car,env){
  const b=car.body,hammer=car.glove==='hammer',hook=car.glove==='hook';
  if(hook&&car.punchHits.size)return;
  const cos=Math.cos(car.punchAngle),sin=Math.sin(car.punchAngle);
  strikeDir.set(forward.x*cos+right.x*sin,0,forward.z*cos+right.z*sin);
  strikeRight.set(-strikeDir.z,0,strikeDir.x);
  let hooked=null,hookDistance=Infinity;
  for(const target of env.cars){
    if(!canHit(car,target,env.simTime))continue;
    const delta=target.body.position.vsub(b.position),along=delta.dot(strikeDir),side=Math.abs(delta.dot(strikeRight));
    const distance=Math.hypot(delta.x,delta.z);
    if(distance>GLOVES[car.glove].reach||Math.abs(delta.y)>=2.2||along<=0)continue;
    if(hammer?along<distance*.5:(along<=1||side>=1.35))continue;
    if(!clearPunchPath(b.position,target.body.position,env.world))continue;
    if(hook){
      if(distance<hookDistance){hookDistance=distance;hooked=target;}
    }else if(hammer){
      delta.set(delta.x/distance,0,delta.z/distance);hitCar(car,target,delta,env);
    }else hitCar(car,target,strikeDir,env);
  }
  if(hooked){hitCar(car,hooked,strikeDir,env);return;}
  for(const prop of env.props||[]){
    const key=`prop-${prop.body.id}`;if(car.punchHits.has(key))continue;
    const delta=prop.body.position.vsub(b.position),along=delta.dot(strikeDir),side=Math.abs(delta.dot(strikeRight));
    const distance=Math.hypot(delta.x,delta.z);
    const inArc=hammer?distance<=GLOVES.hammer.reach&&along>=distance*.5:along<(hook?GLOVES.hook.reach:PUNCH_REACH)&&side<1.65;
    if(along>1&&inArc&&Math.abs(delta.y)<2.2){
      punchRay.reset();env.world.raycastClosest(b.position,prop.body.position,{collisionFilterMask:1,skipBackfaces:true},punchRay);if(punchRay.hasHit)continue;
      const shove=(hook?-280:280)*(1+1.5*car.punchHeavy);
      car.punchHits.add(key);prop.body.wakeUp();prop.body.applyImpulse(new CANNON.Vec3(strikeDir.x*shove,100,strikeDir.z*shove));
      env.hooks?.propHit?.(car,prop);
    }
  }
}

const contactTimes=new Map();
export function resetContacts(){contactTimes.clear();}
/** Attribute shoves for scoring and raise collision feedback once per pair. */
export function processContacts(world,carsByBody,env){
  for(const contact of world.contacts){
    const a=carsByBody.get(contact.bi.id),b=carsByBody.get(contact.bj.id);if(!a||!b||!a.active||!b.active)continue;
    const d=b.body.position.vsub(a.body.position);d.y=0;d.normalize();
    const av=a.previousVelocity.dot(d),bv=-b.previousVelocity.dot(d);
    const closing=av+bv,key=a.id<b.id?a.id*8+b.id:b.id*8+a.id;
    if(closing>3&&env.simTime-(contactTimes.get(key)??-99)>.45){
      contactTimes.set(key,env.simTime);
      env.hooks?.collision?.(a,b,closing,d);
    }
    const pushA=a.throttle>.3&&a.forward.dot(d)>.8&&av>.4&&av>bv+.2;
    const pushB=b.throttle>.3&&b.forward.dot(d)<-.8&&bv>.4&&bv>av+.2;
    if(((av>2.5&&av>bv+1&&a.forward.dot(d)>.25)||pushA)&&b.invulnerable<env.simTime){b.lastAttacker=a.id;b.lastHit=env.simTime;env.hooks?.shove?.(a,b,av-bv);}
    else if(((bv>2.5&&bv>av+1&&b.forward.dot(d)<-.25)||pushB)&&a.invulnerable<env.simTime){a.lastAttacker=b.id;a.lastHit=env.simTime;env.hooks?.shove?.(b,a,bv-av);}
  }
}
