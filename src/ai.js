const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const angleWrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export const yawOf=car=>Math.atan2(-car.forward.x,-car.forward.z);

export function skillFor(difficulty){return difficulty==='easy'?.68:difficulty==='hard'?1.14:.9;}

/** Point the car at (tx,tz). Returns the signed heading error in radians. */
export function steerTo(car,tx,tz,{throttle=1,brakeAngle=1.1,brakeSpeed=9,gain=1.65}={}){
  const p=car.body.position;
  const desired=Math.atan2(-(tx-p.x),-(tz-p.z)),angle=angleWrap(desired-yawOf(car));
  car.steer=clamp(angle*gain,-1,1);
  car.throttle=Math.abs(angle)>1.4?Math.min(.32,throttle):throttle;
  car.brake=Math.abs(angle)>brakeAngle&&Math.abs(car.speed)>brakeSpeed;
  return angle;
}

/** Back out of a wedge if the car has been stationary for a while. */
export function unstick(car,dt,simTime,angle){
  if(Math.abs(car.speed)<1.1)car.stuck+=dt;else car.stuck=Math.max(0,car.stuck-dt*2);
  if(car.stuck>1.4){car.reverseUntil=simTime+.8;car.stuck=0;}
  if(simTime<car.reverseUntil){car.throttle=-.65;car.steer=-Math.sign(angle||1);car.brake=false;return true;}
  return false;
}

/** Punch when a target sits squarely in front. */
export function maybePunch(ctx,car,target,dt,{rate=1,cone=.86}={}){
  if(!target||!target.active||car.cooldown>0)return false;
  if(car.team&&target.team&&car.team===target.team)return false;
  const p=car.body.position,t=target.body.position,dx=t.x-p.x,dz=t.z-p.z,len=Math.hypot(dx,dz);
  if(len>6.1||len<1)return false;
  const facing=(dx*car.forward.x+dz*car.forward.z)/len;
  const skill=skillFor(ctx.options.difficulty);
  if(facing>(ctx.options.difficulty==='easy'?.73:cone)&&Math.random()<dt*car.profile.punch*skill*rate)return ctx.punch(car);
  return false;
}

/**
 * Generic arena brawler used by Sumo and Crown Clash.
 * choose(candidate) adds mode-specific interest; safety(car) returns {danger, x, z} retreat advice.
 */
export function brawlAI(ctx,car,dt,{choose=()=>0,safety,punchRate=1,goal=null}={}){
  const b=car.body,p=b.position,profile=car.profile,difficulty=ctx.options.difficulty,skill=skillFor(difficulty);
  car.driftInput=false;
  car.retarget-=dt;
  if(!goal&&(car.retarget<=0||!car.target?.active)){
    const crowd=new Map();
    for(const other of ctx.cars)if(other!==car&&other.target&&!other.isPlayer)crowd.set(other.target.id,(crowd.get(other.target.id)||0)+1);
    let best=-Infinity;car.target=null;
    for(const candidate of ctx.cars){if(candidate===car||!candidate.active||candidate.ghostUntil>ctx.simTime)continue;
      if(car.team&&candidate.team&&car.team===candidate.team)continue;
      const t=candidate.body.position,d=p.distanceTo(t);
      const value=24/(d+4)+(candidate.id===car.revenge?.85:0)+(candidate.isPlayer&&difficulty!=='easy'?.45:0)-(crowd.get(candidate.id)||0)*.55+Math.random()*.45+choose(candidate,d);
      if(value>best){best=value;car.target=candidate;}
    }
    car.retarget=(.28+Math.random()*.32)/skill;
    const error=difficulty==='easy'?2:difficulty==='hard'?.35:1;
    car.aimX=(Math.random()-.5)*error*2;car.aimZ=(Math.random()-.5)*error*2;
  }
  let tx=p.x,tz=p.z,distance=99;
  if(goal){tx=goal.x;tz=goal.z;distance=Math.hypot(tx-p.x,tz-p.z);}
  else if(car.target){
    const target=car.target,t=target.body.position,v=target.body.velocity,len=Math.hypot(t.x,t.z)||1;
    distance=Math.hypot(t.x-p.x,t.z-p.z);
    const flank=profile.flank*(distance>5?1:.35)*Math.sin(ctx.simTime*.65+car.id);
    // Aim slightly past the target toward the arena centre so hits push it outward.
    tx=t.x+v.x*.12*skill-t.x/len*1.1-t.z/len*flank+car.aimX;
    tz=t.z+v.z*.12*skill-t.z/len*1.1+t.x/len*flank+car.aimZ;
    if(profile===ctx.profiles?.flanker&&target.punchAge<.35){tx-=target.forward.z*4;tz+=target.forward.x*4;}
  }
  let danger=0;
  if(safety){const advice=safety(car);danger=clamp(advice.danger*profile.edge,0,1);tx=tx*(1-danger)+advice.x*danger;tz=tz*(1-danger)+advice.z*danger;}
  const angle=steerTo(car,tx,tz,{throttle:(danger>.3?.7:1)*(difficulty==='easy'?.8:1),brakeSpeed:profile.flank>1?6:9});
  if(unstick(car,dt,ctx.simTime,angle))return;
  if(!goal&&car.target&&danger<.85)maybePunch(ctx,car,car.target,dt,{rate:punchRate});
  // Spend a nitro tank to ram a rival that is lined up ahead (never while backing off an edge).
  if(!goal&&car.nitroTanks>0&&!car.nitroOn&&car.target&&danger<.15&&distance>4&&distance<15){
    const t=car.target.body.position,dx=t.x-p.x,dz=t.z-p.z,len=Math.hypot(dx,dz)||1;
    if((dx*car.forward.x+dz*car.forward.z)/len>.93&&Math.random()<dt*.9*(profile.aggression||1))ctx.nitro?.(car);
  }
}
