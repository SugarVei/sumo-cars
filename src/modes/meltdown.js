import {brawlAI} from '../ai.js';
import {fmt} from './sumo.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const PLACE_POINTS=[5,3,2,1,0,0];
// A plate needs about 1.1 s of wheel contact (roughly three passes at speed, or a second parked)
// before it glows red, then drops 1 s later. Touch-to-melt emptied a 169-plate floor in about 10 s.
const HEAT_RATE=.45,MELT_DELAY=1;

/** Meltdown: every hex you drive over melts away. Last car standing takes the round. */
export function createMeltdown(ctx,settings){
  const {cars}=ctx;
  const ROUNDS=settings.demoLoop?999:clamp(Number(settings.rounds)||3,1,7);
  let round=1,phase='countdown',countdown=3.2,lastCount=null,roundTime=0,breakLeft=0,collapseClock=0,collapseRing=99,order=[],demoClock=0;

  function venue(){return ctx.venue;}
  function alive(){return cars.filter(c=>c.active&&!c.mode.out);}
  function spawnRound(){
    const v=venue();v.reset();
    const spots=v.spawnPoints(6);
    cars.forEach((car,i)=>{const s=spots[(i+round)%6];ctx.placeCar(car,s.x,s.z,s.yaw,.72,.8);car.mode.out=false;car.cooldown=0;car.effect=null;
      car.nitroTanks=1;car.nitro=0;car.stagger=0;
      Object.assign(car.mode,{hunt:false,huntUntil:0,roamUntil:0,goal:null,think:0,hopReadyAt:0});});
    order=[];roundTime=0;collapseClock=0;collapseRing=v.R+1;
  }
  function eliminateCar(car){
    if(car.mode.out)return;car.mode.out=true;order.push(car);
    const place=cars.length-order.length+1;car.mode.lastPlace=place;
    if(ctx.demo)return;
    const attacker=car.lastAttacker!=null?cars[car.lastAttacker]:null;
    if(attacker&&attacker!==car&&ctx.simTime-car.lastHit<5&&!attacker.mode.out){attacker.score+=1;attacker.record.kos++;attacker.mode.kos=(attacker.mode.kos||0)+1;ctx.feed(`${attacker.isPlayer?'你':attacker.name} 把 ${car.isPlayer?'你':car.name} 推进了熔岩 +1`);
      if(attacker.isPlayer){ctx.announce('熔化！',`${car.name} 掉下去了 · +1`,1.3,'ko');ctx.sound.knockout(1);}}
    else ctx.feed(`${car.isPlayer?'你':car.name} 掉下去了`);
    if(ctx.isHuman(car)){const survivor=alive().find(ctx.isHuman);
      ctx.announce(car.isPlayer?'你被淘汰了':`${car.name} 被淘汰了`,`第 ${place} 名 · ${survivor?survivor.name+' 仍在场上':'进入观战'}`,1.8);}
  }
  function finishRound(){
    phase='break';breakLeft=3;
    const survivors=alive();for(const s of survivors)if(!s.mode.out){s.mode.out=true;order.push(s);}
    const ranking=[...order].reverse();
    ranking.forEach((car,i)=>{car.score+=PLACE_POINTS[i]||0;car.mode.wins=(car.mode.wins||0)+(i===0?1:0);});
    const winner=ranking[0];
    if(!ctx.demo){
      ctx.announce(winner.isPlayer?'最后的幸存者！':`${winner.name} 存活到最后`,`第 ${round} 回合 · +${PLACE_POINTS[0]} 分`,2.2,winner.isPlayer?'ko':'');
      if(winner.isPlayer)ctx.sound.knockout(2);
    }
  }

  const mode={
    id:'meltdown',settings,venue:{type:'hex',id:settings.venue||'core'},speedScale:1,airControl:false,
    camera:{distance:8.4,height:5.6,look:3,fov:58,speedFov:0},labelRange:80,music:'meltdown',
    get locked(){return phase==='countdown'||phase==='break';},
    get intense(){return alive().length<=3||collapseRing<=venue().R;},
    start(){
      for(const car of cars)car.mode={out:false,wins:0,kos:0};
      round=1;phase='countdown';countdown=ctx.demo?.01:3.2;lastCount=null;spawnRound();
      if(!ctx.demo)ctx.announce('熔毁','橙色地块即将塌陷 · 用道具键消耗一格氮气小跳',2.4);
    },
    clock(dt){
      if(phase==='countdown'){countdown-=dt;const n=Math.ceil(countdown);if(n!==lastCount&&n>0&&n<=3){lastCount=n;ctx.countdown(n);}if(countdown<=0){phase='play';ctx.countdown('GO');}return;}
      if(phase==='break'){breakLeft-=dt;if(breakLeft<=0){
        if(round>=ROUNDS){phase='done';ctx.finish(mode.results());return;}
        round++;spawnRound();phase='countdown';countdown=2.2;lastCount=null;ctx.cut();
        ctx.announce(round===ROUNDS?'最终回合':`第 ${round} 回合`,'全新地面 · 规则不变',1.6);}
      }
    },
    control(car,dt){
      const v=venue(),p=car.body.position;
      const safety=c=>{
        const q=c.body.position,speed=Math.abs(c.speed),f=c.forward;
        const look=3+speed*.35;
        const aheadSolid=v.solidAt(q.x+f.x*look,q.z+f.z*look)&&v.solidAt(q.x+f.x*look*.5,q.z+f.z*look*.5);
        let best=null,bestScore=-Infinity;
        for(let k=0;k<12;k++){const a=k/12*Math.PI*2,dx=Math.sin(a),dz=Math.cos(a);let score=0;
          for(const d of [2.5,5,8,11]){const t=v.tileAt(q.x+dx*d,q.z+dz*d);score+=t&&t.state==='solid'?1:t&&t.state==='warn'?-.4:-2.2;}
          score+=(dx*-q.x+dz*-q.z)/(Math.hypot(q.x,q.z)+1)*.6+(dx*f.x+dz*f.z)*.5;
          if(score>bestScore){bestScore=score;best={x:q.x+dx*9,z:q.z+dz*9};}}
        return {danger:aheadSolid?(v.edgeDistance(q.x,q.z)<4?.5:0):1,x:best.x,z:best.z};
      };
      // Survival first. Six cars converging on the centre at GO used to melt the middle and drop the
      // whole field within 4 s, so rivals now roam open floor away from the crowd and only hunt in
      // short bursts when someone is already close.
      const m=car.mode,f=car.forward;
      const roamTarget=()=>{
        // Opening pinwheel: everyone swings round the ring the same way instead of diving for the middle.
        if(roundTime<2.5){const a=Math.atan2(p.x,p.z)+1.2;return {x:Math.sin(a)*9.5,z:Math.cos(a)*9.5};}
        let best=null,bestScore=-Infinity;
        for(let k=0;k<12;k++){const a=k/12*Math.PI*2,dx=Math.sin(a),dz=Math.cos(a);let score=0;
          for(const d of [2.5,5,8,11]){const t=v.tileAt(p.x+dx*d,p.z+dz*d);score+=t&&t.state==='solid'?1-t.warm*.7:t&&t.state==='warn'?-.6:-2.4;}
          const cx=p.x+dx*9,cz=p.z+dz*9,rc=Math.hypot(cx,cz);
          score+=(dx*f.x+dz*f.z)*.6-Math.max(0,rc-14)*.25-Math.max(0,5-rc)*.1;
          for(const o of cars){if(o===car||!o.active||o.mode.out)continue;
            const q=o.body.position,w=o.body.velocity,ox=q.x-p.x,oz=q.z-p.z,d=Math.hypot(ox,oz)||1;
            if(d<14)score-=Math.max(0,(ox*dx+oz*dz)/d)*(14-d)/14*1.6;
            score-=Math.max(0,7-Math.hypot(q.x+w.x*.6-cx,q.z+w.z*.6-cz))*.3;}
          score+=Math.random()*.3;
          if(score>bestScore){bestScore=score;best={x:cx,z:cz};}}
        return best;
      };
      const under=v.tileAt(p.x,p.z),rear=v.tileAt(p.x-f.x*1.15,p.z-f.z*1.15);
      const slow=Math.abs(car.speed)<5;
      const sinking=(under&&under.state!=='solid')||(rear&&rear.state!=='solid'&&slow)||(slow&&((under?.warm||0)>.6||(rear?.warm||0)>.6));
      m.think=(m.think||0)-dt;
      const goalDist=m.goal?Math.hypot(m.goal.x-p.x,m.goal.z-p.z):0;
      if(m.think<=0||sinking||!m.goal||goalDist<4){
        m.think=.6+Math.random()*.6;m.goal=roamTarget();
        let nearest=Infinity;
        for(const o of cars)if(o!==car&&o.active&&!o.mode.out)nearest=Math.min(nearest,o.body.position.distanceTo(p));
        const reach=(3.5+3.5*(car.profile.aggression||1))*({easy:.8,normal:1,hard:1.2}[ctx.options.difficulty]||1);
        if(m.hunt&&(roundTime>m.huntUntil||nearest>reach*1.6||sinking)){m.hunt=false;m.roamUntil=roundTime+1.5+Math.random()*2;}
        else if(!m.hunt&&!sinking&&roundTime>6&&roundTime>(m.roamUntil||0)&&nearest<reach){m.hunt=true;m.huntUntil=roundTime+2.5+Math.random()*1.5;}
      }
      if(m.hunt)brawlAI(ctx,car,dt,{safety,choose:c=>c.mode.out?-99:0,punchRate:1.2});
      else brawlAI(ctx,car,dt,{safety,goal:m.goal});
      if(sinking&&car.nitroTanks>0&&!car.nitroOn&&v.solidAt(p.x+f.x*6,p.z+f.z*6)&&Math.random()<dt*3)mode.useItem(car);
    },
    update(dt){
      if(phase!=='play')return;
      const v=venue();
      roundTime+=dt;
      // Plates under each axle heat up while a car is on them.
      for(const car of cars){
        if(!car.active||car.mode.out||!car.grounded)continue;
        const p=car.body.position,f=car.forward;
        for(const k of [1.15,-1.15])v.heatUp(v.tileAt(p.x+f.x*k,p.z+f.z*k),dt*HEAT_RATE,MELT_DELAY);
      }
      // Sudden death: the outer ring collapses every few seconds after 40 s.
      if(roundTime>75)for(const t of v.tiles)if(t.state==='solid')v.trigger(t,.6+Math.random()*1.5);
      if(roundTime>36){collapseClock-=dt;if(collapseClock<=0&&collapseRing>1){collapseRing--;collapseClock=4.5;for(const t of v.tiles)if(t.ring>=collapseRing&&t.state==='solid')v.trigger(t,1.2+Math.random()*.5);if(!ctx.demo&&collapseRing===v.R)ctx.announce('突然死亡','地面从外圈开始塌陷',1.6,'small');}}
      for(const car of cars)if(!car.active&&!car.mode.out)eliminateCar(car);
      if(alive().length<=1){
        if(ctx.demo){demoClock+=dt;if(demoClock>2.5){demoClock=0;spawnRound();}return;}
        finishRound();
      }
    },
    fallY:()=>-6,
    onFall(car){car.respawnAt=0;if(!ctx.demo)car.record.falls++;eliminateCar(car);},
    respawn(){},
    onHammer(car){
      if(phase!=='play'||!car.grounded)return;
      const v=venue(),p=car.body.position,f=car.forward;
      for(const tile of v.tiles){
        const dx=tile.x-p.x,dz=tile.z-p.z,dist=Math.hypot(dx,dz);
        if(dist>1&&dist<6&&(dx*f.x+dz*f.z)>dist*.5)v.trigger(tile,1);
      }
    },
    useItem(car){
      if(phase!=='play'||!car.active||car.mode.out||!car.grounded||car.up.y<.5||car.nitroTanks<1||ctx.simTime<car.mode.hopReadyAt)return false;
      car.nitroTanks--;car.mode.hopReadyAt=ctx.simTime+.6;
      const p=car.body.position,v=car.body.velocity,f=car.forward;
      // Give even a slow-moving car enough forward momentum to clear one missing plate.
      const kick=clamp(8-(v.x*f.x+v.z*f.z),1.5,8);
      v.x+=f.x*kick;v.z+=f.z*kick;v.y=Math.max(v.y,6.3);car.body.wakeUp();
      ctx.effects.shockwave?.(p);
      if(ctx.isHuman(car)){ctx.sound.boost?.();ctx.fovKick(3);}
      return true;
    },
    isSpectating(){return phase==='play'&&!cars.some(c=>ctx.isHuman(c)&&!c.mode.out);},
    cameraFocus(){
      const p=cars[0];if(!p.mode.out||phase!=='play')return p;
      const living=alive();return living.find(ctx.isHuman)||living.sort((a,b)=>b.score-a.score)[0]||p;
    },
    demoCamera(camera,target,dt,t){
      const r=46,a=t*.05;camera.position.set(Math.sin(a)*r,30,Math.cos(a)*r);camera.up.set(0,1,0);camera.fov=50;camera.updateProjectionMatrix();camera.lookAt(0,-2,0);return true;
    },
    hud(){
      const p=cars[0],v=venue(),ranked=[...cars].sort((a,b)=>b.score-a.score||a.id-b.id);
      const spectating=mode.isSpectating()?mode.cameraFocus():null;
      const tile=p.active?v.tileAt(p.body.position.x,p.body.position.z):null;
      return {
        board:{title:'积分',rows:ranked.map(c=>({id:c.id,name:c.name,color:c.color,player:c.isPlayer,value:c.score,out:c.mode.out}))},
        clock:{big:fmt(roundTime),lines:[`第 ${round}<i>/${ROUNDS}</i> 回合`,`存活 ${alive().length}`],tag:collapseRing<=v.R?'突然死亡':`剩余 ${v.remaining()} 块地面`,hot:collapseRing<=v.R},
        edgeDanger:tile&&tile.state==='warn'?.7:0,
        item:p.active&&p.nitroTanks>0?{name:'氮气小跳',hint:'消耗一格氮气',color:'#ff9e44'}:null,
        spectate:spectating&&spectating!==p?spectating.name:null,
      };
    },
    results(){
      const ranked=[...cars].sort((a,b)=>b.score-a.score||a.id-b.id),p=cars[0];
      return {title:ranked[0].isPlayer?'最后的幸存者':'',standings:ranked.map(c=>({id:c.id,name:c.name,color:c.color,player:c.isPlayer,value:`${c.score} 分 · 胜 ${c.mode.wins||0} 回合`,score:c.score})),
        stats:[['回合胜利',p.mode.wins||0],['熔化对手',p.mode.kos||0],['出拳命中',`${p.record.punchHits}/${p.record.punches}`],['总积分',p.score]]};
    },
    forceFinish(){phase='done';ctx.finish(mode.results());},
    stop(){},
  };
  return mode;
}
