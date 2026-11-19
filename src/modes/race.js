import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {skillFor} from '../ai.js';
import {TRACKS} from '../tracks.js';
import {createLapGhost} from '../lap-ghost.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const RACE_ITEMS={
  turbo:{id:'turbo',name:'涡轮',color:'#38d9f5',hint:'2 秒超级加速'},
  surge:{id:'surge',name:'电磁推进',color:'#b38bff',hint:'3 秒强力追赶'},
  shield:{id:'shield',name:'护盾',color:'#8be26a',hint:'5 秒 · 挡住出拳和火箭拳'},
  shock:{id:'shock',name:'冲击波',color:'#f2c94b',hint:'震开身边的车'},
  rocket:{id:'rocket',name:'火箭拳',color:'#ff4fa8',hint:'追踪前一名'},
};
const LANES=[0,-.42,.42,-.18,.18,-.6];

export function fmtTime(t){if(t==null||!isFinite(t))return '--:--.--';const m=Math.floor(t/60),s=t-m*60;return `${m}:${s.toFixed(2).padStart(5,'0')}`;}

export function createRace(ctx,settings){
  const {cars}=ctx;
  const def=TRACKS.find(t=>t.id===settings.venue)||TRACKS[0];
  const laps=settings.demoLoop?999:clamp(Number(settings.laps)||def.laps||3,1,9);
  let venue=null,samples=null,N=0,L=0,hw=7,step=2.5;
  let phase='countdown',countdown=4.2,lastCount=null,raceTime=0,firstFinish=null,endTimer=0,demoClock=0;
  const rockets=[];
  let ghost=null;
  const tmp=new THREE.Vector3(),impulse=new CANNON.Vec3();
  const rocketGeometry=new THREE.SphereGeometry(.42,14,10);
  const rocketMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(3,.5,2.2),toneMapped:false});

  const wrap=d=>{while(d>L/2)d-=L;while(d<-L/2)d+=L;return d;};
  function sProj(car,index){const s=samples[index];tmp.copy(car.body.position).sub(s.p);return s.s+clamp(tmp.dot(s.T),-step,step);}
  function lateralOf(pos,index){const s=samples[index];tmp.set(pos.x,pos.y,pos.z).sub(s.p);return tmp.dot(s.R);}
  function ranking(){
    return [...cars].sort((a,b)=>{
      const fa=a.mode.finished,fb=b.mode.finished;
      if(fa&&fb)return a.mode.finishTime-b.mode.finishTime;if(fa)return -1;if(fb)return 1;
      return b.mode.dist-a.mode.dist;
    });
  }
  function placeOf(car){return ranking().indexOf(car)+1;}
  function placeOnTrack(car,index,lateral,speed=0,ghost=0){
    const s=samples[index];
    const pos=s.p.clone().addScaledVector(s.R,clamp(lateral,-hw+1.6,hw-1.6)).addScaledVector(s.N,.72);
    ctx.placeCar(car,pos.x,pos.z,Math.atan2(-s.T.x,-s.T.z),pos.y,ghost?0:.4);
    if(ghost){car.ghostUntil=ctx.simTime+ghost;ctx.setGhost(car,true);}
    if(speed)car.body.velocity.set(s.T.x*speed,s.T.y*speed,s.T.z*speed);
  }
  function giveItem(car){
    const place=placeOf(car),r=Math.random();
    const table=place<=2?[['turbo',.30],['shield',.45],['shock',.25]]:place<=4?[['turbo',.35],['shield',.2],['shock',.25],['rocket',.2]]:[['surge',.48],['shield',.10],['turbo',.08],['rocket',.34]];
    let acc=0;for(const [id,w] of table){acc+=w;if(r<=acc)return id;}return table[0][0];
  }

  function useItem(car){
    const m=car.mode,item=m.item;if(!item||phase!=='race'||!car.active)return false;
    m.item=null;m.itemsUsed=(m.itemsUsed||0)+1;
    if(item==='turbo'||item==='surge'){
      car.effect='boost';car.effectEnd=ctx.simTime+(item==='surge'?3:2.2);
      if(item==='surge'){
        car.mode.surgeUntil=car.effectEnd;
        car.body.velocity.x+=car.forward.x*4;car.body.velocity.z+=car.forward.z*4;
      }
      if(ctx.isHuman(car)){ctx.fovKick(5);ctx.sound.boost?.();}
    }
    else if(item==='shield'){car.effect='shield';car.effectEnd=ctx.simTime+5;if(car.isPlayer)ctx.sound.pickup();}
    else if(item==='shock'){
      ctx.effects.shockwave?.(car.body.position);ctx.effects.impact(car.body.position,2);
      for(const other of cars){if(other===car||!other.active||other.ghostUntil>ctx.simTime)continue;
        const d=other.body.position.vsub(car.body.position),dist=Math.hypot(d.x,d.z);if(dist>10)continue;
        if(other.effect==='shield'&&other.effectEnd>ctx.simTime){other.effect=null;continue;}
        const f=(1-dist/10)*1500+500;impulse.set(d.x/(dist||1)*f,700,d.z/(dist||1)*f);other.body.applyImpulse(impulse);
        other.lastAttacker=car.id;other.lastHit=ctx.simTime;other.hitFlash=1;
        if(car.isPlayer||other.isPlayer){ctx.hitStop(.08);ctx.shake(.4);}
      }
      if(!ctx.demo)ctx.sound.hit(1.8,0);
    }else if(item==='rocket'){
      const order=ranking(),place=order.indexOf(car);const target=place>0?order[place-1]:null;
      const mesh=new THREE.Mesh(rocketGeometry,rocketMaterial);mesh.position.copy(car.body.position);mesh.position.y+=.6;ctx.scene.add(mesh);
      rockets.push({owner:car,target,mesh,index:car.mode.idx,life:4.5,lateral:car.mode.lateral||0});
      if(!ctx.demo)ctx.sound.tone(520,.35,'sawtooth',.05,180);
    }
    return true;
  }
  function updateRockets(dt){
    for(let i=rockets.length-1;i>=0;i--){
      const r=rockets[i];r.life-=dt;
      const target=r.target&&r.target.active?r.target:null;
      // Fly along the deck, then home in for the last stretch.
      const advance=Math.max(1,Math.round(dt*48/step));r.index=(r.index+advance)%N;
      const s=samples[r.index];
      const goal=target&&target.body.position.distanceTo(r.mesh.position)<16?tmp.copy(target.body.position):tmp.copy(s.p).addScaledVector(s.R,r.lateral).addScaledVector(s.N,1.1);
      r.mesh.position.lerp(goal,Math.min(1,dt*9));
      ctx.effects.trailPuff?.(r.mesh.position);
      if(target&&target.body.position.distanceTo(r.mesh.position)<2.4){
        if(target.effect==='shield'&&target.effectEnd>ctx.simTime){target.effect=null;}
        else{const side=(Math.random()<.5?-1:1);impulse.set(target.forward.z*side*700-target.forward.x*500,1500,-target.forward.x*side*700-target.forward.z*500);
          target.body.applyImpulse(impulse);target.body.angularVelocity.y+=side*6;target.hitFlash=1;target.lastAttacker=r.owner.id;target.lastHit=ctx.simTime;
          if(target.isPlayer||r.owner.isPlayer){ctx.hitStop(.09);ctx.shake(.45);ctx.fovKick(5);}
          if(target.isPlayer)ctx.announce('被火箭拳击中！',`${r.owner.name} 打中了你`,1.1,'small');
          if(r.owner.isPlayer)ctx.announce('命中！',`${target.name} 原地打转`,1.1,'small');}
        ctx.effects.impact(r.mesh.position,1.8);if(!ctx.demo)ctx.sound.hit(1.6,0);
        r.life=0;
      }
      if(r.life<=0){ctx.scene.remove(r.mesh);rockets.splice(i,1);}
    }
  }

  function progress(car){
    const m=car.mode;
    const near=venue.nearest(car.body.position,m.idx,10);
    if(near.distance>Math.max(18,hw+9))return;
    const sNew=sProj(car,near.index),delta=wrap(sNew-m.s);
    if(Math.abs(delta)>24){if(car.active)ctx.fall(car);return;}
    m.dist+=delta;m.s=sNew;m.idx=near.index;
    m.lateral=lateralOf(car.body.position,near.index);
    if(car.grounded&&Math.abs(m.lateral)<hw-1.2&&!samples[m.idx].gap)m.safe={idx:m.idx,lateral:m.lateral,dist:m.dist};
    // Direction check for the wrong-way warning.
    const s=samples[m.idx],dot=car.forward.x*s.T.x+car.forward.z*s.T.z;
    m.wrong=dot<-.3&&Math.abs(car.speed)>3?m.wrong+(1/60):0;
    if(ghost&&car.isPlayer){
      m.reverseTravel=delta<0?(m.reverseTravel||0)-delta:0;
      if(ctx.autopilot||m.wrong>.2||m.reverseTravel>2)ghost.invalidate();
    }
    const lap=Math.floor(m.dist/L)+1;
    if(lap>m.lap&&m.dist>0){
      if(ghost&&car.isPlayer&&!m.finished){
        if(m.lap>=1&&ghost.finish(raceTime-m.lapStart,car))ctx.feed(`本机单圈纪录 · ${fmtTime(raceTime-m.lapStart)}`);
        if(lap<=laps){ghost.begin(car);if(ctx.autopilot)ghost.invalidate();}
      }
      if(m.lap>=1){const time=raceTime-m.lapStart;m.lapTimes.push(time);m.lastLap=time;if(m.bestLap==null||time<m.bestLap){m.bestLap=time;if(car.isPlayer&&m.lap>=1&&!m.finishedNow)ctx.feed(`最快单圈 ${fmtTime(time)}`);}}
      m.lap=lap;m.lapStart=raceTime;
      if(lap>laps&&!m.finished)finishCar(car);
      else if(car.isPlayer&&lap>1){ctx.announce(lap===laps?'最后一圈':`第 ${lap}/${laps} 圈`,lap===laps?'冲回终点':`上一圈 ${fmtTime(m.lastLap)}`,1.5,lap===laps?'ko':'small');if(lap===laps)ctx.sound.finalLap?.();}
    }
  }
  function finishCar(car){
    const m=car.mode;m.finished=true;m.finishTime=raceTime;
    const place=ranking().filter(c=>c.mode.finished).length;m.place=place;
    if(firstFinish==null){firstFinish=raceTime;}
    ctx.feed(`${car.isPlayer?'你':car.name} 第 ${place} 名完赛 · ${fmtTime(raceTime)}`);
    if(ctx.isHuman(car)){
      ctx.announce(`${car.isPlayer?'':car.name+' · '}${place===1?'冠军！':`第 ${place} 名完赛`}`,fmtTime(raceTime),2.4,'ko');ctx.sound.knockout(place===1?3:1);
      if(cars.filter(ctx.isHuman).every(c=>c.mode.finished))endTimer=4.5;
    }
  }

  const mode={
    id:'race',settings,venue:{type:'track',id:def.id},speedScale:1.5,airControl:true,punchScale:1,punchStyle:'side',cooldown:2.2,trails:'always',
    camera:{distance:7.6,height:3.2,look:6,fov:60,speedFov:13,follow:5.5,crowdLift:false,speedPull:1.2},labelRange:60,indicators:false,
    music:'race',
    get locked(){return phase==='countdown';},
    get intense(){return cars[0].mode.lap>=laps;},
    start(){
      venue=ctx.venue;samples=venue.samples;N=venue.N;L=venue.length;hw=venue.hw;step=venue.step;
      if(!ctx.demo&&ctx.options.players!==2)ghost=createLapGhost(def.id,venue.group,settings.lapGhost!==0);
      // The player starts mid-grid (P4); rivals are shuffled around them.
      const humans=cars.filter(ctx.isHuman),rivals=cars.filter(c=>!ctx.isHuman(c)).sort(()=>Math.random()-.5);
      const front=humans.length===2?2:3;
      const order=ctx.demo?rivals:[...rivals.slice(0,front),...humans,...rivals.slice(front)];
      order.forEach((car,slot)=>{
        const g=venue.grid[slot];
        ctx.placeCar(car,g.position.x,g.position.z,g.yaw,g.position.y+.72,0);
        car.mode={idx:g.index,s:samples[g.index].s,dist:g.s,lap:0,lapStart:0,lapTimes:[],bestLap:null,lastLap:null,finished:false,finishTime:null,item:null,lane:LANES[car.id],laneTarget:LANES[car.id],lateral:0,wrong:0,safe:{idx:g.index,lateral:0,dist:g.s},startHeld:-1,place:slot+1,itemHold:0,driftHold:0,overtakes:0};
      });
      for(const box of venue.itemBoxes){box.respawnAt=0;box.mesh.visible=true;}
      for(const barrier of venue.barriers){barrier.active=true;barrier.mesh.visible=true;}
      phase='countdown';countdown=ctx.demo?.01:4.2;lastCount=null;raceTime=0;firstFinish=null;endTimer=0;
      venue.gantry?.setLamps(0,false);
      ctx.ui?.setMinimap?.(samples.filter((_,i)=>i%2===0).map(s=>[s.p.x,s.p.z]),def.accent);
      if(!ctx.demo)ctx.announce(def.name,`${laps} 圈 · 最后一声提示时踩油门可完美起步`,2.6);
    },
    clock(dt){
      if(phase==='countdown'){
        countdown-=dt;const n=Math.ceil(countdown-.2);
        if(n!==lastCount&&n>0&&n<=3){lastCount=n;ctx.countdown(n);venue.gantry?.setLamps({3:2,2:4,1:5}[n],false);}
        if(countdown<=.2&&lastCount!=='GO'){lastCount='GO';phase='race';ctx.countdown('GO');venue.gantry?.setLamps(5,true);
          for(const car of cars){
            const held=car.mode.startHeld;
            if(ctx.isHuman(car)){
              if(held>=0&&held<.55){car.padBoostEnd=ctx.simTime+1.4;ctx.announce('完美起步！','',1.1,'small');ctx.fovKick(4);}
              else if(held>2.3){car.speedMul=.55;car.mode.stallUntil=raceTime+.5;ctx.announce('踩早了','轮胎空转 · 等最后一声再踩',1.1,'small');}
            }else if(!car.isPlayer&&Math.random()<(skillFor(ctx.options.difficulty)-.55))car.padBoostEnd=ctx.simTime+1.1;
          }
        }
        return;
      }
    },
    onLockedInput(car){
      // Measure how long the throttle has been held before the lights go out.
      if(car.throttle>0){car.mode.startHeld=car.mode.startHeld<0?0:car.mode.startHeld+1/60;}else car.mode.startHeld=-1;
    },
    control(car,dt){
      const m=car.mode,speed=Math.abs(car.speed),skill=skillFor(ctx.options.difficulty);
      const look=8+speed*.55,ahead=Math.round(look/step),s=samples[(m.idx+ahead)%N];
      // Lane planning: default lane, dodge slower cars ahead, grab pads and item boxes.
      let laneTarget=LANES[car.id];
      for(const other of cars){if(other===car||!other.active)continue;const gap=wrap(other.mode.s-m.s);
        if(gap>0&&gap<16&&Math.abs(other.mode.lateral-m.lane*hw)<2.8&&Math.abs(other.speed)<speed+1)laneTarget=other.mode.lateral>0?-.42:.42;}
      for(const pad of venue.pads){const gap=wrap(pad.s-m.s);if(gap>4&&gap<45){laneTarget=pad.lateral/hw;break;}}
      // Keep a car-width of air between rivals running side by side.
      for(const other of cars){if(other===car||!other.active)continue;const gap=wrap(other.mode.s-m.s),dl=m.lateral-other.mode.lateral;
        if(Math.abs(gap)<6&&Math.abs(dl)<3.4)laneTarget+=(Math.sign(dl)||(car.id>other.id?1:-1))*.4;}
      if(!m.item)for(const box of venue.itemBoxes){if(box.respawnAt>ctx.simTime)continue;const gap=wrap(samples[box.index].s-m.s);if(gap>4&&gap<40){laneTarget=clamp(lateralOf(box.position,box.index)/hw,-.6,.6);break;}}
      const gapAhead=samples[(m.idx+Math.round(30/step))%N].gap||samples[(m.idx+Math.round(15/step))%N].gap||samples[(m.idx+Math.round(48/step))%N].gap;
      if(gapAhead)laneTarget=0;
      m.lane+=(clamp(laneTarget,-.55,.55)-m.lane)*Math.min(1,dt*1.1);
      const tx=s.p.x+s.R.x*m.lane*hw,tz=s.p.z+s.R.z*m.lane*hw;
      const k=samples[m.idx].curvAhead,aLat=(21+skill*7)*(venue.descriptor.grip||1);
      const vMax=gapAhead?99:k>.002?Math.sqrt(aLat/k):99;
      // Pure-pursuit steering: ask for exactly the yaw rate that arcs onto the target point.
      const p=car.body.position,dx=tx-p.x,dz=tz-p.z,ld=Math.max(4,Math.hypot(dx,dz));
      const alpha=Math.atan2(-dx,-dz)-Math.atan2(-car.forward.x,-car.forward.z);
      const a=Math.atan2(Math.sin(alpha),Math.cos(alpha));
      const v=Math.max(4,speed),high=clamp((v-16)/16,0,1);
      const yawMax=(car.drifting?1.62:1.95)*car.stats.turn*(1-.34*high);
      car.steer=Math.abs(a)>1.15?Math.sign(a):clamp(2*Math.sin(a)/ld*v/yawMax,-1,1);
      car.throttle=Math.abs(a)>1.3?.45:speed<vMax?1:speed>vMax+3?0:.45;
      car.brake=speed>vMax+2.5||(Math.abs(a)>1.1&&speed>9);
      // Fire nitro only when the next ~60 m stay straight.
      if(car.nitroTanks>0&&!car.nitroOn&&phase==='race'&&!gapAhead&&speed>14&&k<.008&&samples[(m.idx+Math.round(60/step))%N].curvAhead<.012&&Math.random()<dt*1.4)ctx.nitro(car);
      // A stalled car is reset to the deck instead of reversing blindly near the edge.
      if(speed<1.2)m.stall=(m.stall||0)+dt;else m.stall=0;
      if(m.stall>2.2&&phase==='race'){m.stall=0;mode.manualReset(car);return;}
      // Drifters slide through long corners and release for a mini-turbo.
      const drifter=(car.classId==='dart'||car.profile.flank>1)&&(ctx.demo||ctx.options.difficulty==='hard');
      if(drifter&&samples[m.idx].curv>.022&&speed>15&&speed<vMax*1.02&&!gapAhead&&Math.abs(m.lateral)<hw*.55){m.driftHold+=dt;car.driftInput=true;}
      else if(car.driftInput&&(samples[m.idx].curv<.012||m.driftHold>2.6||speed<12)){car.driftInput=false;m.driftHold=0;}
      // Rubber-banding keeps the pack near the player.
      if(!ctx.demo){const gap=m.dist-cars[0].mode.dist,band=ctx.options.difficulty==='hard'?.5:1;car.speedMul=clamp(1-gap/700*band,.9,1.08)*(ctx.options.difficulty==='easy'?.93:1)*(ctx.simTime<m.surgeUntil?1.22:1);}
      // Punch the car directly ahead.
      for(const other of cars){if(other===car||!other.active||car.cooldown>0)continue;
        const d=other.body.position.vsub(car.body.position),len=Math.hypot(d.x,d.z);
        if(len>1.5&&len<4.8&&(d.x*car.forward.x+d.z*car.forward.z)/len>.9&&raceTime>4&&Math.random()<dt*car.profile.punch*.32*skill){ctx.punch(car);break;}}
      // Items.
      if(m.item){m.itemHold+=dt;
        const near=cars.filter(o=>o!==car&&o.active&&o.body.position.distanceTo(car.body.position)<7).length;
        const ahead=ranking()[ranking().indexOf(car)-1];
        if(((m.item==='turbo'||m.item==='surge')&&k<.012&&m.itemHold>.6)||(m.item==='shock'&&near>0)||(m.item==='shield'&&m.itemHold>1.5)||(m.item==='rocket'&&ahead&&wrap(ahead.mode.s-m.s)<90&&m.itemHold>.8)||m.itemHold>9)useItem(car);
      }
    },
    update(dt){
      if(phase==='countdown')return;
      raceTime+=dt;
      const player=cars[0];
      if(ghost&&ctx.autopilot)ghost.invalidate();
      for(const car of cars){
        if(!car.active)continue;
        const m=car.mode;
        if(m.stallUntil&&raceTime>m.stallUntil){car.speedMul=1;m.stallUntil=0;}
        progress(car);
        if(!car.active)continue;
        if(Math.abs(m.lateral)>hw-.9&&Math.abs(m.lateral)<hw+1.3){
          const side=Math.sign(m.lateral),barrier=venue.barrierAt.get(m.idx+':'+side);
          const s=samples[m.idx],p=car.body.position,v=car.body.velocity;
          const height=tmp.copy(p).sub(s.p).dot(s.N),out=(v.x*s.R.x+v.y*s.R.y+v.z*s.R.z)*side;
          if(barrier?.active&&height>-.2&&height<2&&out>.25){
            barrier.active=false;barrier.mesh.visible=false;
            const inset=Math.abs(m.lateral)-(hw-1.4);
            p.x-=s.R.x*side*inset;p.y-=s.R.y*side*inset;p.z-=s.R.z*side*inset;
            v.x=(v.x-s.R.x*side*(out+2))*.76;v.z=(v.z-s.R.z*side*(out+2))*.76;
            car.body.aabbNeedsUpdate=true;ctx.effects.impact(p,1);
            if(ctx.isHuman(car))ctx.feed(`${car.name} 撞碎了能量护栏`);
          }
        }
        // Rivals (and Easy-mode players) get a gentle nudge back from the very edge of the deck.
        const assist=!ctx.isHuman(car)?1:{easy:1,normal:.45,hard:0}[ctx.options.difficulty]??.45;
        if(assist>0&&car.grounded&&!m.finished){const s=samples[m.idx],over=Math.abs(m.lateral)-(hw-1.6);
          if(over>0){const out=Math.sign(m.lateral),vOut=(car.body.velocity.x*s.R.x+car.body.velocity.z*s.R.z)*out;
            if(vOut>0){const k=Math.min(vOut,(over*7*dt+vOut*3*dt)*assist);car.body.velocity.x-=s.R.x*out*k;car.body.velocity.z-=s.R.z*out*k;}}}
        // Upside-down or on its side for a moment: put it back on the deck.
        if(car.up.y<0||(car.up.y<.6&&!car.grounded&&car.body.velocity.length()<14)){m.flipT=(m.flipT||0)+dt;if(m.flipT>(car.up.y<0?.6:1)){m.flipT=0;mode.manualReset(car);}}else m.flipT=0;
        if(car.ghostUntil&&car.ghostUntil<ctx.simTime){car.ghostUntil=0;ctx.setGhost(car,false);}
        // Boost pads.
        if(car.grounded)for(const pad of venue.pads){const gap=Math.abs(wrap(pad.s-m.s));if(gap<3.4&&Math.abs(m.lateral-pad.lateral)<1.9){if(car.padBoostEnd<ctx.simTime+.5&&car.isPlayer){ctx.fovKick(4);ctx.sound.boost?.();}car.padBoostEnd=ctx.simTime+1.25;}}
        // Item boxes.
        for(const box of venue.itemBoxes){
          if(box.respawnAt>ctx.simTime)continue;
          if(box.position.distanceToSquared(tmp.set(car.body.position.x,car.body.position.y,car.body.position.z))<6.2){
            box.respawnAt=ctx.simTime+5;box.mesh.visible=false;ctx.effects.impact(box.position,.5);
            if(!m.item){m.item=giveItem(car);m.itemHold=0;if(car.isPlayer&&!ctx.demo){ctx.sound.pickup();ctx.announce(`获得${RACE_ITEMS[m.item].name}`,'按 Q 使用',1.1,'small');}}
          }
        }
        if(car.effect==='shield'&&car.effectEnd<ctx.simTime)car.effect=null;
      }
      for(const box of venue.itemBoxes)if(!box.mesh.visible&&box.respawnAt<=ctx.simTime)box.mesh.visible=true;
      if(ghost&&player.mode.lap>=1&&!player.mode.finished)ghost.tick(raceTime-player.mode.lapStart,player);
      updateRockets(dt);
      // Track overtakes for the player's stats.
      const place=placeOf(cars[0]);if(cars[0].mode.place&&place<cars[0].mode.place&&!cars[0].mode.finished)cars[0].mode.overtakes++;cars[0].mode.place=place;
      // Draft: tuck in behind a rival for a small speed gain.
      for(const car of cars){if(!car.active)continue;car.mode.draft=false;
        for(const other of cars){if(other===car||!other.active)continue;const gap=wrap(other.mode.s-car.mode.s);if(gap>2&&gap<11&&Math.abs(other.mode.lateral-car.mode.lateral)<1.6){car.mode.draft=true;break;}}
        if(ctx.isHuman(car))car.speedMul=(car.mode.stallUntil?.55:1)*(car.mode.draft?1.05:1)*(ctx.simTime<car.mode.surgeUntil?1.22:1);}
      if(ctx.demo){demoClock+=dt;return;}
      if(firstFinish!=null&&cars.some(c=>ctx.isHuman(c)&&!c.mode.finished)){const left=35-(raceTime-firstFinish);if(left<=0){mode.end();return;}}
      if(endTimer>0){endTimer-=dt;if(endTimer<=0||cars.every(c=>c.mode.finished))mode.end();}
    },
    end(){if(phase==='done')return;phase='done';ctx.finish(mode.results());},
    useItem:car=>useItem(car),
    itemName(car){return RACE_ITEMS[car.mode.item]?.name||'';},
    onPunchHit(attacker,target,powered,shielded){
      if(shielded||phase!=='race'||attacker.mode.finished)return;
      const d=target.body.position.vsub(attacker.body.position),len=Math.hypot(d.x,d.z)||1;
      if((d.x*target.forward.x+d.z*target.forward.z)/len<.55)return;
      attacker.padBoostEnd=Math.max(attacker.padBoostEnd,ctx.simTime+.8);
      if(ctx.isHuman(attacker))ctx.feed(`${attacker.name} 尾击成功 · 尾流加速`);
    },
    fallY(car){return samples?samples[car.mode.idx??0].p.y-9:-6;},
    onFall(car){
      if(car.isPlayer)ghost?.invalidate();
      car.respawnAt=ctx.simTime+1.1;car.mode.falls=(car.mode.falls||0)+1;
      if(!ctx.demo)car.record.falls++;
      if(!ctx.demo){
        const attacker=cars[car.lastAttacker];
        if(ctx.isHuman(car))ctx.feed(`${car.name} 掉下了赛道`);
        if(attacker&&ctx.isHuman(attacker)&&ctx.simTime-car.lastHit<5){ctx.feed(`${attacker.name} 把 ${car.name} 打下了赛道`);attacker.record.kos++;ctx.announce('打下赛道！',`${car.name} 掉下去了`,1.3,'small');}
      }
    },
    respawn(car){
      const m=car.mode,safe=m.safe;
      let index=(safe.idx-2+N)%N,speed=10;
      // A missed jump puts the car on the landing side instead of looping it back to the lip.
      for(let j=0;j<Math.round(30/step);j++){if(samples[(safe.idx+j)%N].gap){let k=(safe.idx+j)%N;while(samples[k].gap)k=(k+1)%N;index=(k+Math.round(8/step))%N;speed=16;break;}}
      m.dist=safe.dist+wrap(samples[index].s-samples[safe.idx].s);m.s=samples[index].s;m.idx=index;
      m.safe={idx:index,lateral:0,dist:m.dist};
      placeOnTrack(car,index,safe.lateral*.4,speed,1.8);car.cooldown=.5;
      if(car.isPlayer&&!ctx.demo)ctx.cut();
    },
    manualReset(car){
      if(!car.active||phase!=='race')return false;
      if(car.isPlayer)ghost?.invalidate();
      const m=car.mode;placeOnTrack(car,m.idx,clamp(m.lateral,-hw*.4,hw*.4),4,1.5);m.s=samples[m.idx].s;ctx.cut();return true;
    },
    demoSubject(){const order=ranking();return order[Math.floor(Math.random()*3)].id;},
    hud(){
      const p=cars[0],m=p.mode,order=ranking(),place=order.indexOf(p)+1;
      const lap=clamp(m.lap||1,1,laps),leader=order[0];
      const s=samples?samples[m.idx??0]:null;
      const edge=p.active&&s&&!p.mode.finished?clamp((Math.abs(m.lateral)-hw+3)/3,0,1):0;
      return {
        race:{place,of:cars.length,lap,laps,time:fmtTime(raceTime),lapTime:fmtTime(phase==='race'?raceTime-m.lapStart:0),best:fmtTime(m.bestLap),item:m.item?RACE_ITEMS[m.item]:null,wrongWay:m.wrong>1,finished:m.finished,draft:m.draft},
        board:{title:'实时名次',rows:order.map((c,i)=>({id:c.id,name:c.name,color:c.color,player:c.isPlayer,out:!c.active,value:c.mode.finished?fmtTime(c.mode.finishTime):i===0?'领先':`+${Math.max(0,(leader.mode.dist-c.mode.dist)/24).toFixed(1)} 秒`}))},
        minimap:{cars:cars.map(c=>({x:c.body.position.x,z:c.body.position.z,color:c.color,player:c.isPlayer,active:c.active}))},
        respawn:!p.active?{seconds:Math.max(0,p.respawnAt-ctx.simTime),cause:'你掉下了赛道'}:null,
        edgeDanger:edge,
        clock:{big:fmtTime(raceTime),lines:[`第 ${lap}<i>/${laps}</i> 圈`,`最快 ${fmtTime(m.bestLap)}`],tag:firstFinish!=null&&cars.some(c=>ctx.isHuman(c)&&!c.mode.finished)?`比赛将在 ${Math.ceil(Math.max(0,35-(raceTime-firstFinish)))} 秒后结束`:lap===laps?'最后一圈':def.name,hot:lap===laps,warn:firstFinish!=null&&!m.finished},
      };
    },
    results(){
      const order=ranking(),p=cars[0],m=p.mode;
      const place=order.indexOf(p)+1;
      return {
        subtitle:def.name,
        standings:order.map((c,i)=>({id:c.id,name:c.name,color:c.color,player:c.isPlayer,value:c.mode.finished?fmtTime(c.mode.finishTime):`未完赛 · 第 ${clamp(c.mode.lap,1,laps)} 圈`,score:order.length-i})),
        stats:[['比赛用时',m.finished?fmtTime(m.finishTime):'未完赛'],['最快单圈',fmtTime(m.bestLap)],['超车',m.overtakes||0],['使用道具',m.itemsUsed||0],['出拳命中',`${p.record.punchHits}/${p.record.punches}`],['打下赛道',p.record.kos],['掉落',m.falls||0]],
      };
    },
    forceFinish(){for(const c of cars)if(!c.mode.finished){c.mode.finished=true;c.mode.finishTime=raceTime+c.id;}mode.end();},
    markers(){return [];},
    stop(){ghost?.dispose();for(const r of rockets)ctx.scene.remove(r.mesh);rockets.length=0;rocketGeometry.dispose();rocketMaterial.dispose();},
  };
  return mode;
}
