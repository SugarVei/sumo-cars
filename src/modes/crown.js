import * as THREE from 'three';
import {brawlAI,steerTo,unstick,skillFor} from '../ai.js';
import {fmt} from './sumo.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function buildCrown(){
  const group=new THREE.Group();
  const gold=new THREE.MeshStandardMaterial({color:0xffc83a,emissive:0xff9a1a,emissiveIntensity:.9,metalness:.9,roughness:.22});
  const gem=new THREE.MeshBasicMaterial({color:new THREE.Color(3,.4,1.8),toneMapped:false});
  const band=new THREE.Mesh(new THREE.CylinderGeometry(.62,.55,.42,24,1,true),gold);band.material.side=THREE.DoubleSide;group.add(band);
  for(let i=0;i<5;i++){const a=i/5*Math.PI*2;const spike=new THREE.Mesh(new THREE.ConeGeometry(.17,.55,8),gold);spike.position.set(Math.sin(a)*.58,.45,Math.cos(a)*.58);group.add(spike);
    const g=new THREE.Mesh(new THREE.SphereGeometry(.09,10,8),gem);g.position.set(Math.sin(a)*.62,.05,Math.cos(a)*.62);group.add(g);}
  const halo=new THREE.Mesh(new THREE.TorusGeometry(.95,.035,8,48),new THREE.MeshBasicMaterial({color:new THREE.Color(3,2.3,.6),toneMapped:false}));halo.rotation.x=Math.PI/2;halo.position.y=-.1;group.add(halo);
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(.5,1.1,30,20,1,true),new THREE.MeshBasicMaterial({color:new THREE.Color(1.6,1.1,.25),transparent:true,opacity:.28,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
  beam.position.y=15;group.add(beam);
  group.scale.setScalar(1.25);
  return {group,beam,halo};
}

/** Crown Clash: hold the crown to bank seconds; punch or ram the holder to knock it loose. */
export function createCrown(ctx,settings){
  const {cars}=ctx;
  const target=settings.demoLoop?999:clamp(Number(settings.crownTarget)||60,20,180);
  const LIMIT=settings.demoLoop?9999:150;
  let phase='countdown',countdown=3.2,lastCount=null,timeLeft=LIMIT,demoClock=0;
  const crown={holder:null,pos:new THREE.Vector3(0,1.6,0),vel:new THREE.Vector3(),flying:false,cooldown:0,visual:buildCrown(),resetAt:0,spin:0};
  ctx.scene.add(crown.visual.group);

  function holdTime(car){return car.mode.crown||0;}
  function standings(){return [...cars].sort((a,b)=>holdTime(b)-holdTime(a)||a.id-b.id);}
  function dropCrown(from,attacker){
    const h=crown.holder;if(!h)return;
    crown.holder=null;crown.flying=true;crown.cooldown=.45;
    crown.pos.set(h.body.position.x,h.body.position.y+2.4,h.body.position.z);
    const dir=attacker?new THREE.Vector3(attacker.forward.x,0,attacker.forward.z):new THREE.Vector3(Math.random()-.5,0,Math.random()-.5);
    dir.normalize();crown.vel.set(dir.x*7+(Math.random()-.5)*3,9,dir.z*7+(Math.random()-.5)*3);
    h.speedMul=1;h.mode.lastCrownLoss=ctx.simTime;
    if(attacker){attacker.record.steals++;ctx.feed(`${attacker.isPlayer?'你':attacker.name} 打掉了 ${h.isPlayer?'你':h.name} 的王冠`);}
    if(h.isPlayer)ctx.announce('王冠被打掉了！',attacker?`${attacker.name} 把它打飞了`:'快抢回来',1.2,'small');
    ctx.sound.collision(1,0);ctx.effects.knockout?.(crown.pos,1);
  }
  function resetCrown(){
    if(crown.holder)crown.holder.speedMul=1;
    crown.holder=null;crown.flying=false;
    const pit=ctx.venue?.pitHalf||0;
    crown.pos.set(0,1.6,pit>0?pit+3.2:0);
    crown.vel.set(0,0,0);crown.cooldown=.4;
  }
  function spawn(){
    const venue=ctx.venue;venue.setRound(3,6);
    for(const car of cars){const a=car.id*Math.PI/3+Math.PI/6,r=venue.halfSize*.66;ctx.placeCar(car,Math.sin(a)*r,Math.cos(a)*r,Math.atan2(Math.sin(a),Math.cos(a)));car.cooldown=0;car.mode.crown=car.mode.crown||0;}
    resetCrown();
  }

  const mode={
    id:'crown',settings,venue:{type:'arena',id:settings.venue||'neon'},speedScale:1,airControl:false,
    camera:{distance:8.6,height:5.4,look:3,fov:58,speedFov:0},labelRange:80,music:'arena',
    get locked(){return phase==='countdown';},
    get intense(){return standings()[0].mode.crown>target*.75||timeLeft<30;},
    start(){
      for(const car of cars)car.mode={crown:0};
      phase='countdown';countdown=ctx.demo?.01:3.2;lastCount=null;timeLeft=LIMIT;spawn();
      if(!ctx.demo)ctx.announce('王冠争夺',`先持有王冠满 ${target} 秒者获胜`,2.2);
    },
    clock(dt){
      if(phase==='countdown'){countdown-=dt;const n=Math.ceil(countdown);if(n!==lastCount&&n>0&&n<=3){lastCount=n;ctx.countdown(n);}if(countdown<=0){phase='play';ctx.countdown('GO');}return;}
      if(phase!=='play')return;
      if(ctx.demo){demoClock+=dt;if(demoClock>45){demoClock=0;for(const c of cars)c.mode.crown=0;spawn();}return;}
      timeLeft=Math.max(0,timeLeft-dt);if(timeLeft<=10)ctx.sound.tick(Math.ceil(timeLeft));
      if(timeLeft<=0)mode.end();
    },
    control(car,dt){
      const venue=ctx.venue,p=car.body.position;
      const safety=c=>{
        const q=c.body.position,v=c.body.velocity,fx=q.x+v.x*.5,fz=q.z+v.z*.5,edge=Math.max(Math.abs(fx),Math.abs(fz));
        const outerDanger=clamp((edge-venue.halfSize+5.5)/3.8,0,1);
        const pit=venue.pitHalf||0;
        if(pit>0){
          const pitDanger=clamp((pit+3.2-edge)/3.0,0,1);
          if(pitDanger>outerDanger){
            const len=Math.hypot(q.x,q.z)||1,safeR=Math.min(venue.halfSize-5.5,pit+6.2);
            return {danger:pitDanger,x:q.x/len*safeR-q.z/len*3,z:q.z/len*safeR+q.x/len*3};
          }
        }
        return {danger:outerDanger,x:q.x*.5,z:q.z*.5};
      };
      if(crown.holder===car){
        // Flee: steer away from chasers, bending back toward the middle near edges.
        let fx=0,fz=0;
        for(const other of cars){if(other===car||!other.active)continue;const d=p.vsub(other.body.position),len=Math.hypot(d.x,d.z)||1;if(len<16){fx+=d.x/len*(16-len);fz+=d.z/len*(16-len);}}
        const edge=clamp((Math.max(Math.abs(p.x),Math.abs(p.z))-venue.halfSize+9)/7,0,1);
        fx=fx*(1-edge)-p.x*edge*2.2;fz=fz*(1-edge)-p.z*edge*2.2;
        const wander=Math.sin(ctx.simTime*.5+car.id)*4;
        const angle=steerTo(car,p.x+fx+wander,p.z+fz-wander,{throttle:1,brakeSpeed:12});unstick(car,dt,ctx.simTime,angle);car.driftInput=false;
        // The holder burns nitro to break away from a close chaser.
        const chased=cars.some(o=>o!==car&&o.active&&o.body.position.distanceTo(p)<9);
        if(car.cooldown<=0&&cars.some(o=>{
          if(o===car||!o.active)return false;
          const d=o.body.position.vsub(p),len=Math.hypot(d.x,d.z);
          return len>0&&len<4.6&&(d.x*car.forward.x+d.z*car.forward.z)/len>.9;
        }))ctx.punch(car);
        if(chased&&car.nitroTanks>0&&!car.nitroOn&&Math.abs(angle)<.35&&Math.max(Math.abs(p.x),Math.abs(p.z))<venue.halfSize-8&&Math.random()<dt*2)ctx.nitro(car);
        return;
      }
      if(!crown.holder){brawlAI(ctx,car,dt,{goal:{x:crown.pos.x,z:crown.pos.z},safety});return;}
      const holder=crown.holder;
      brawlAI(ctx,car,dt,{choose:c=>c===holder?6:0,safety,punchRate:1.4});
    },
    update(dt){
      if(phase!=='play')return;
      const venue=ctx.venue;
      crown.cooldown=Math.max(0,crown.cooldown-dt);
      if(crown.holder&&!crown.holder.active){const h=crown.holder;h.mode.lastCrownLoss=ctx.simTime;resetCrown();if(!ctx.demo)ctx.announce('王冠重置','回到场地中央',1.1,'small');}
      if(crown.flying){
        crown.vel.y-=22*dt;crown.pos.addScaledVector(crown.vel,dt);
        const pit=venue.pitHalf||0;
        const overPit=pit>0&&Math.abs(crown.pos.x)<pit&&Math.abs(crown.pos.z)<pit;
        if(!overPit&&crown.pos.y<1.6&&Math.max(Math.abs(crown.pos.x),Math.abs(crown.pos.z))<venue.halfSize-1){crown.pos.y=1.6;crown.vel.set(0,0,0);crown.flying=false;}
        if(crown.pos.y<-6){resetCrown();}
      }
      if(!crown.holder&&crown.cooldown<=0){
        for(const car of cars){if(!car.active)continue;const p=car.body.position;
          if(Math.hypot(p.x-crown.pos.x,p.z-crown.pos.z)<2.5&&Math.abs(p.y+1.2-crown.pos.y)<2.6){
            crown.holder=car;crown.flying=false;car.speedMul=.92;
            if(!ctx.demo){if(ctx.isHuman(car)){ctx.announce(car.isPlayer?'王冠在你手上':`${car.name} 抢到了王冠`,'极速 −8% · 出拳冷却 −30%',1.4,'ko');ctx.sound.pickup();}else ctx.feed(`${car.name} 抢到了王冠`);}
            break;}}
      }
      if(crown.holder){
        const h=crown.holder;h.mode.crown=(h.mode.crown||0)+dt;h.score=Math.floor(h.mode.crown);if(!ctx.demo)h.record.crownTime=h.mode.crown;
        if(!ctx.demo&&h.mode.crown>=target)mode.end();
      }
    },
    cooldownMultiplier(car){return car===crown.holder?.7:1;},
    onPunchHit(attacker,targetCar,powered,shielded){if(!shielded&&targetCar===crown.holder&&phase==='play')dropCrown(targetCar,attacker);},
    onCollision(a,b,closing){
      if(phase!=='play'||!crown.holder||closing<8.5)return;
      const h=crown.holder;if(a!==h&&b!==h)return;
      const other=a===h?b:a;
      // The rammer must be driving into the holder.
      const d=h.body.position.vsub(other.body.position),len=Math.hypot(d.x,d.z)||1;
      if((d.x*other.forward.x+d.z*other.forward.z)/len>.4)dropCrown(h,other);
    },
    render(dt){
      crown.spin+=dt*2.2;
      const g=crown.visual.group;
      if(crown.holder){const p=crown.holder.body.position;crown.pos.set(p.x,p.y+2.5+Math.sin(crown.spin*1.3)*.12,p.z);}
      g.position.copy(crown.pos);if(!crown.holder&&!crown.flying)g.position.y+=Math.sin(crown.spin)*.25;
      g.rotation.y=crown.spin;crown.visual.beam.material.opacity=crown.holder?.18:.28;crown.visual.halo.scale.setScalar(1+Math.sin(crown.spin*2)*.08);
    },
    fallY:()=>-4,
    onFall(car){car.respawnAt=ctx.simTime+2;if(!ctx.demo){car.record.falls++;if(car.isPlayer)mode.cause='你掉下去了';}},
    respawn(car){
      const venue=ctx.venue;let best=null,bd=-1;
      for(let n=0;n<24;n++){const a=n/24*Math.PI*2,r=venue.halfSize*.55,x=Math.sin(a)*r,z=Math.cos(a)*r;if(!venue.spawnSafe(x,z,1.9))continue;
        const d=Math.min(...cars.filter(c=>c.active&&c!==car).map(c=>Math.hypot(c.body.position.x-x,c.body.position.z-z)),99);if(d>bd){bd=d;best={x,z};}}
      best??={x:0,z:6};ctx.placeCar(car,best.x,best.z,Math.atan2(best.x,best.z));
      if(car.isPlayer&&!ctx.demo)ctx.cut();
    },
    canPunch(){return true;},
    labelTag(car){return car===crown.holder?'♛':'';},
    markers(){return crown.holder?.isPlayer?[]:[{id:'crown',name:crown.holder?crown.holder.name:'王冠',x:crown.pos.x,y:crown.pos.y,z:crown.pos.z,color:'#ffc83a',type:'crown'}];},
    demoCamera(camera,targetVec,dt,t){
      const venue=ctx.venue,r=venue.halfSize*1.5,a=.6+Math.sin(t*.06)*.6;
      camera.position.set(r*Math.sin(a),venue.halfSize*.9,r*Math.cos(a));camera.up.set(0,1,0);camera.fov=52;camera.updateProjectionMatrix();camera.lookAt(crown.pos.x*.5,0,crown.pos.z*.5);return true;
    },
    hud(){
      const p=cars[0],venue=ctx.venue,ranked=standings();
      const edge=p.active?clamp((Math.max(Math.abs(p.body.position.x),Math.abs(p.body.position.z))-venue.halfSize+4)/4,0,1):0;
      return {
        board:{title:`持冠时间 · 目标 ${target} 秒`,rows:ranked.map(c=>({id:c.id,name:c.name,color:c.color,player:c.isPlayer,out:!c.active,value:`${Math.floor(holdTime(c))} 秒`,bar:holdTime(c)/target,crown:c===crown.holder}))},
        clock:{big:fmt(timeLeft),lines:[crown.holder?(crown.holder.isPlayer?'<b>王冠在你手上</b>':`${crown.holder.name} 持有王冠`):'王冠无人持有',`目标 ${target} 秒`],tag:'王冠争夺',warn:timeLeft<=10,hot:crown.holder?.isPlayer},
        crown:{held:crown.holder?.isPlayer,progress:holdTime(p)/target},
        edgeDanger:edge,
        respawn:!p.active?{seconds:Math.max(0,p.respawnAt-ctx.simTime),cause:mode.cause||'你掉下去了'}:null,
      };
    },
    end(){if(phase==='done')return;phase='done';
      for(const car of cars)car.mode.lostAtFinish=car!==crown.holder&&ctx.simTime-car.mode.lastCrownLoss<=6;
      ctx.finish(mode.results());},
    results(){
      const ranked=standings(),r=cars[0].record;
      return {title:ranked[0].isPlayer?'王冠属于你':'',standings:ranked.map(c=>({id:c.id,name:c.name,color:c.color,player:c.isPlayer,value:`${holdTime(c).toFixed(1)} 秒`,score:holdTime(c)})),
        stats:[['持冠时间',`${holdTime(cars[0]).toFixed(1)} 秒`],['抢夺次数',r.steals],['出拳命中',`${r.punchHits}/${r.punches}`],['掉落',r.falls]]};
    },
    forceFinish(){mode.end();},
    stop(){ctx.scene.remove(crown.visual.group);for(const c of cars)c.speedMul=1;},
  };
  return mode;
}
