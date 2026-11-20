import * as CANNON from 'cannon-es';
import {createItemVisual} from '../visuals.js';
import {brawlAI} from '../ai.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/** Sumo Arena: 3v3 Team Brawl + Classic/Quick Free-for-all on shrinking floating arenas. */
export function createSumo(ctx,settings){
  const isTeam=settings.format==='team';
  const quick=settings.format==='quick';
  const TOTAL=isTeam?3:quick?3:6;
  const ROUND=quick?45:60;
  const {cars}=ctx;
  let round=1,timeLeft=ROUND,phase='countdown',countdown=3.2,lastCount=null,breakLeft=0,itemTime=9,item=null,demoClock=0;
  let blueScore=0,redScore=0;
  const itemMeshes=new Map();
  let shrinkStep=0;

  function applyTeams(){
    for(const car of cars){
      car.team=isTeam?(car.id<3?'blue':'red'):null;
      car.visual?.setTeam?.(car.team);
    }
  }

  function spawnRound(){
    const venue=ctx.venue;venue.setRound(round,TOTAL);shrinkStep=0;
    const placed=[];
    for(const car of cars){
      let x,z,yaw;
      if(isTeam){
        const slot=car.id%3,side=car.team==='blue'?1:-1;
        const spread=(slot-1)*6.8*(venue.halfSize/24);
        const dist=venue.halfSize*.58;
        x=spread;z=side*dist;yaw=side>0?0:Math.PI;
      }else{
        const a=car.id*Math.PI/3,r=venue.halfSize*.62;x=Math.sin(a)*r;z=Math.cos(a)*r;yaw=Math.atan2(x,z);
      }
      if(!venue.spawnSafe(x,z,2)||placed.some(p=>Math.hypot(p.x-x,p.z-z)<4)){
        const baseA=Math.atan2(x,z);
        for(let n=0;n<72;n++){const angle=baseA+n*.29,radius=venue.halfSize*(.42+(n%4)*.11),cx=Math.sin(angle)*radius,cz=Math.cos(angle)*radius;
          if(venue.spawnSafe(cx,cz,2)&&placed.every(p=>Math.hypot(p.x-cx,p.z-cz)>4)){x=cx;z=cz;yaw=Math.atan2(x,z);break;}}
      }
      placed.push({x,z});ctx.placeCar(car,x,z,yaw);
      car.cooldown=0;car.effect=null;car.effectEnd=0;car.respawnAt=0;car.combo=0;car.stagger=0;
    }
    for(const prop of venue.dynamicProps){const b=prop.body;b.position.copy(prop.start);b.quaternion.set(0,0,0,1);b.velocity.setZero();b.angularVelocity.setZero();b.wakeUp();}
    removeItem();itemTime=9;
  }
  function removeItem(){if(item){ctx.scene.remove(item.mesh);item=null;}}
  function spawnItem(){
    if(item)return;
    const venue=ctx.venue;
    const kind=Math.random()<.5?'boost':'power',side=Math.floor(Math.random()*4),edge=venue.halfSize-4.2,along=(Math.random()-.5)*venue.halfSize*1.1;
    let x=side<2?(side===0?edge:-edge):along,z=side>=2?(side===2?edge:-edge):along;
    if(!venue.spawnSafe(x,z,1.5)){x=venue.halfSize*.55*(Math.random()<.5?1:-1);z=venue.halfSize*.55*(Math.random()<.5?1:-1);}
    if(!itemMeshes.has(kind))itemMeshes.set(kind,createItemVisual(kind));
    const surface=new CANNON.RaycastResult();
    ctx.world.raycastClosest(new CANNON.Vec3(x,12,z),new CANNON.Vec3(x,-2,z),{collisionFilterMask:1,skipBackfaces:true},surface);
    const baseY=(surface.hasHit?surface.hitPointWorld.y:0)+1.2;
    const mesh=itemMeshes.get(kind);mesh.position.set(x,baseY,z);ctx.scene.add(mesh);item={kind,mesh,x,z,baseY};itemTime=13;
  }
  function respawnPoint(car){
    let best={x:0,z:9,d:-1};const venue=ctx.venue;
    for(let n=0;n<64;n++){const a=n*Math.PI*2/32+ctx.simTime*.7,r=(venue.pitHalf?venue.pitHalf+4.2:3.5)+(n%5)*2.1;const x=Math.sin(a)*r,z=Math.cos(a)*r;
      if(!venue.spawnSafe(x,z,1.9)||Math.max(Math.abs(x),Math.abs(z))>venue.halfSize-3.8)continue;
      const d=Math.min(...cars.filter(c=>c.active&&c!==car).map(c=>Math.hypot(c.body.position.x-x,c.body.position.z-z)),99);
      if(d>best.d)best={x,z,d};}
    return best;
  }
  function standings(){return [...cars].sort((a,b)=>b.score-a.score||a.id-b.id);}

  const mode={
    id:'sumo',settings,venue:{type:'arena',id:settings.venue||'testpit'},speedScale:1,airControl:false,
    camera:{distance:9.2,height:5.8,look:2.8,fov:56,speedFov:0},labelRange:85,
    get locked(){return phase==='countdown'||phase==='break';},
    get intense(){return round===TOTAL;},
    music:'arena',
    start(){
      blueScore=0;redScore=0;
      applyTeams();
      round=1;timeLeft=ROUND;phase='countdown';countdown=ctx.demo?0.01:3.2;lastCount=null;spawnRound();
      if(!ctx.demo)ctx.announce(isTeam?'3v3 相扑团队赛':'相扑擂台',isTeam?'蓝队 vs 红队 · 把敌队轰入深坑或推下擂台！':'把对手推下擂台 · 第 1 回合',2.2);
    },
    clock(dt){
      if(phase==='countdown'){
        countdown-=dt;const n=Math.ceil(countdown);
        if(n!==lastCount&&n>0&&n<=3){lastCount=n;ctx.countdown(n);}
        if(countdown<=0){phase='play';ctx.countdown('GO');}
        return;
      }
      if(phase==='break'){
        breakLeft-=dt;
        if(breakLeft<=0){spawnRound();phase='countdown';countdown=1.6;lastCount=null;
          ctx.announce(round===TOTAL?'最终回合':`第 ${round} 回合`,round===TOTAL?'双倍积分 · 擂台最小':'擂台正在缩小',1.6);ctx.cut();}
        return;
      }
      if(phase!=='play')return;
      if(ctx.demo){demoClock+=dt;if(demoClock>42){demoClock=0;spawnRound();}return;}
      timeLeft=Math.max(0,timeLeft-dt);
      if(timeLeft<20){
        // Update static collision hulls eight times per second, in lockstep with the visible edge.
        const step=Math.ceil((20-timeLeft)*8);
        if(step>shrinkStep){
          if(shrinkStep===0)ctx.announce('擂台开始收缩','向安全区行驶',1.5,'small');
          shrinkStep=step;const half=ctx.venue.setRound(round,TOTAL,step/160);
          if(item&&Math.max(Math.abs(item.x),Math.abs(item.z))>half-1){removeItem();itemTime=2;}
        }
      }
      if(timeLeft<=10)ctx.sound.tick(Math.ceil(timeLeft));
      if(timeLeft<=0){
        if(round>=TOTAL){phase='done';ctx.finish(mode.results());}
        else{round++;timeLeft=ROUND;phase='break';breakLeft=2;ctx.announce('回合结束',`下一回合：第 ${round}/${TOTAL} 回合`,2);ctx.sound.tone(380,.25,'triangle',.06,570);}
      }
    },
    control(car,dt){
      const venue=ctx.venue;
      const pit=venue.pitHalf||0;
      brawlAI(ctx,car,dt,{
        choose:(candidate)=>{
          const t=candidate.body.position;
          const outerExp=clamp((Math.max(Math.abs(t.x),Math.abs(t.z))-venue.halfSize+8)/8,0,1);
          const pitExp=pit>0?clamp((pit+4.5-Math.max(Math.abs(t.x),Math.abs(t.z)))/4.5,0,1):0;
          const exposure=Math.max(outerExp,pitExp);
          const leader=Math.max(...cars.map(c=>c.score)),opening=ROUND-timeLeft<4&&candidate.isPlayer?-1.4:0;
          return exposure*(car.profile.label==='Opportunist'?3.5:.9)+(candidate.score===leader&&leader>0?.65:0)+opening;
        },
        safety:(c)=>{
          const p=c.body.position,v=c.body.velocity;
          const fx=p.x+v.x*.52,fz=p.z+v.z*.52;
          const edge=Math.max(Math.abs(fx),Math.abs(fz));
          const outerDanger=clamp((edge-venue.halfSize+5.5)/3.8,0,1);
          // 工业测试场中央深坑避险：预判车即将冲入深坑时自动绕行外侧安全环
          if(pit>0){
            const pitEdge=Math.max(Math.abs(fx),Math.abs(fz));
            const pitDanger=clamp((pit+3.2-pitEdge)/3.0,0,1);
            if(pitDanger>outerDanger){
              const len=Math.hypot(p.x,p.z)||1;
              const safeR=Math.min(venue.halfSize-5.5,pit+6.2);
              return {danger:pitDanger,x:p.x/len*safeR-p.z/len*3.2,z:p.z/len*safeR+p.x/len*3.2};
            }
          }
          return {danger:outerDanger,x:p.x*.55,z:p.z*.55};
        },
      });
      // Flankers drift through wide turns away from edges and center pit.
      const distC=Math.max(Math.abs(car.body.position.x),Math.abs(car.body.position.z));
      if(car.profile.flank>1&&Math.abs(car.steer)>.38&&distC<venue.halfSize-6&&(pit===0||distC>pit+4))car.driftInput=true;
    },
    update(dt){
      if(ctx.demo||phase!=='play')return;
      if(!item){itemTime-=dt;if(itemTime<=0)spawnItem();}
      if(item){for(const car of cars){if(car.active&&Math.hypot(car.body.position.x-item.x,car.body.position.z-item.z)<2&&Math.abs(car.body.position.y-item.baseY)<2){
        car.effect=item.kind;car.effectEnd=ctx.simTime+7;
        if(car.isPlayer){ctx.announce(item.kind==='boost'?'涡轮加速':'强化拳','持续 7 秒',1.8);ctx.sound.pickup();}
        removeItem();itemTime=13;break;}}}
    },
    render(dt){if(item){item.mesh.rotation.y+=dt*1.7;item.mesh.position.y=item.baseY+.25+Math.sin(ctx.simTime*3)*.22;}},
    fallY:()=>-4,
    onFall(car){
      car.respawnAt=ctx.simTime+2;
      if(ctx.demo||phase!=='play')return;
      const attacker=car.lastAttacker!==null?cars[car.lastAttacker]:null;
      const credited=attacker&&attacker!==car&&(!isTeam||attacker.team!==car.team)&&ctx.simTime-car.lastHit<=4.5;
      car.record.falls++;car.record.streak=0;
      const inPit=ctx.venue.pitHalf>0&&Math.abs(car.body.position.x)<ctx.venue.pitHalf+2&&Math.abs(car.body.position.z)<ctx.venue.pitHalf+2;
      const dropWord=inPit?'轰入深坑':'推下擂台';
      const points=round===TOTAL?2:1;
      if(credited){
        attacker.score+=points;attacker.record.kos++;attacker.record.streak++;
        attacker.record.maxStreak=Math.max(attacker.record.maxStreak,attacker.record.streak);attacker.record.roundKos[round-1]++;
        attacker.record.victims[car.id]=(attacker.record.victims[car.id]||0)+1;car.record.killers[attacker.id]=(car.record.killers[attacker.id]||0)+1;
        car.revenge=attacker.id;attacker.combo=ctx.simTime-attacker.lastKO<4?attacker.combo+1:1;attacker.lastKO=ctx.simTime;
        if(isTeam){if(attacker.team==='blue')blueScore+=points;else redScore+=points;}
        ctx.feed(`${attacker.isPlayer?'你':attacker.name} 将 ${car.isPlayer?'你':car.name} ${dropWord} +${points}`);
        ctx.effects.knockout(car.body.position,attacker.combo);
        if(attacker.isPlayer){
          const title=attacker.combo>=3?'三连击落！':attacker.combo===2?'双杀！':inPit?'暴扣入坑！':'击落！';
          ctx.announce(title,`+${points} 分 · ${car.name} ${inPit?'掉进深坑':'掉下擂台'}`,1.6,'ko');
          ctx.sound.knockout(attacker.combo);ctx.slowMo(.4);mode.koFocus=car;mode.koFocusLeft=.55;
        }
      }else{
        if(isTeam){if(car.team==='blue')redScore+=points;else blueScore+=points;}
        ctx.feed(`${car.isPlayer?'你':car.name} ${inPit?'掉进了深坑':'掉下了擂台'}`);
      }
      if(car.isPlayer)mode.attackerName=credited?attacker.name:'';
      car.lastAttacker=null;car.effect=null;
    },
    respawn(car){
      const spot=respawnPoint(car);ctx.placeCar(car,spot.x,spot.z,Math.atan2(spot.x,spot.z));car.cooldown=.5;
      if(car.isPlayer&&!ctx.demo){mode.attackerName='';ctx.announce('重新上场','护盾 1.2 秒',1.2,'small');ctx.cut();}
    },
    cameraOverride(camera,target,dt){
      if(mode.koFocus&&mode.koFocusLeft>0){mode.koFocusLeft-=dt;const p=mode.koFocus.body.position;target.lerp({x:p.x,y:p.y,z:p.z},1-Math.exp(-dt*5));camera.position.y+=dt*1.5;return true;}
      mode.koFocus=null;return false;
    },
    demoCamera(camera,target,dt,t){
      const venue=ctx.venue,isPit=venue.id==='testpit';
      const r=venue.halfSize*(isPit?1.42:1.55),a=(isPit?.42:.3)+Math.sin(t*.08)*.42;
      camera.position.set(r*Math.sin(a),venue.halfSize*(isPit?.92:.95),r*Math.cos(a));camera.up.set(0,1,0);camera.fov=isPit?50:52;camera.updateProjectionMatrix();camera.lookAt(0,0.4,isPit?1.5:-3);return true;
    },
    markers(){return item?[{id:'item',name:item.kind==='power'?'强化拳':'加速',x:item.mesh.position.x,y:item.mesh.position.y,z:item.mesh.position.z,color:item.kind==='power'?'#ffbf52':'#65effa',type:'item'}]:[];},
    hud(){
      const p=cars[0],venue=ctx.venue,ranked=standings();
      const outerEdge=p.active?clamp((Math.max(Math.abs(p.body.position.x),Math.abs(p.body.position.z))-venue.halfSize+4)/4,0,1):0;
      const pitEdge=p.active&&venue.pitHalf>0?clamp((venue.pitHalf+2.6-Math.max(Math.abs(p.body.position.x),Math.abs(p.body.position.z)))/2.6,0,1):0;
      const edge=Math.max(outerEdge,pitEdge);
      const mapRow=c=>({id:c.id,name:c.name,color:c.color,team:c.team,value:c.score,player:c.isPlayer,out:!c.active});
      return {
        board:{title:isTeam?'团队击落':'击落积分',rows:ranked.map(mapRow)},
        teams:isTeam?{
          blue:cars.filter(c=>c.team==='blue').sort((a,b)=>b.score-a.score||a.id-b.id).map(mapRow),
          red:cars.filter(c=>c.team==='red').sort((a,b)=>b.score-a.score||a.id-b.id).map(mapRow),
        }:null,
        teamScore:isTeam?{blue:blueScore,red:redScore}:null,
        clock:{big:fmt(timeLeft),lines:[`第 ${round}<i>/${TOTAL}</i> 回合`,item?'场上有道具':`道具 ${Math.ceil(Math.max(0,itemTime))} 秒后刷新`],tag:shrinkStep?`缩圈中 · ${Math.round(venue.halfSize*2)} 米`:round===TOTAL?'最终回合 · 双倍积分':isTeam?venue.descriptor.name:`擂台 ${Math.round(venue.halfSize*2)} 米`,warn:timeLeft<=10,hot:round===TOTAL||shrinkStep>0},
        edgeDanger:edge,
        respawn:!p.active?{seconds:Math.max(0,p.respawnAt-ctx.simTime),cause:mode.attackerName?`${mode.attackerName} 把你轰下去了`:'你掉下去了'}:null,
        combo:ctx.simTime-p.lastKO<4&&p.combo>=2?p.combo:0,
      };
    },
    results(){
      const ranked=standings(),r=cars[0].record;
      const top=map=>{const entry=Object.entries(map).sort((a,b)=>b[1]-a[1])[0];return entry?`${cars[+entry[0]].name} (${entry[1]})`:'—';};
      const base={
        standings:ranked.map(c=>({id:c.id,name:c.name,color:c.color,team:c.team,value:`${c.score} 分`,score:c.score,player:c.isPlayer})),
        stats:[['击落',r.kos],['出拳命中',`${r.punchHits}/${r.punches}`],['命中率',`${r.punches?Math.round(r.punchHits/r.punches*100):0}%`],['掉落',r.falls],['最长连续击落',r.maxStreak],['最常击落',top(r.victims)],['宿敌',top(r.killers)]],
      };
      if(isTeam){
        base.title=blueScore>redScore?'蓝队胜利':redScore>blueScore?'红队胜利':'蓝红平局';
        base.subtitle=`3v3 团队赛 · 蓝队 ${blueScore} : ${redScore} 红队`;
        base.teamWin=blueScore>redScore?1:0;
      }
      return base;
    },
    forceFinish(){phase='done';ctx.finish(mode.results());},
    stop(){removeItem();for(const car of cars){car.team=null;car.visual?.setTeam?.(null);}},
  };
  return mode;
}

export function fmt(seconds){const s=Math.max(0,Math.ceil(seconds));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
