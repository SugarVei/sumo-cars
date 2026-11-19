import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const prefix='punch-drive:lap:v1:',interval=.2,maxSeconds=1200;
const round=n=>Math.round(n*1000)/1000;

export function readBestLap(track){
  try{
    const raw=localStorage.getItem(prefix+track);
    if(!raw||raw.length>600000)return null;
    const best=JSON.parse(raw),points=best.points;
    if(!Number.isFinite(best.time)||best.time<=0||best.time>maxSeconds||!Array.isArray(points)||points.length<3||points.length>maxSeconds/interval+4)return null;
    let last=-1;
    for(const p of points){
      if(!Array.isArray(p)||p.length!==8||!p.every(Number.isFinite)||p[0]<=last||p[0]-last>1.01)return null;
      if(p.slice(1,4).some(n=>Math.abs(n)>2000)||Math.abs(Math.hypot(...p.slice(4))-1)>.01)return null;
      last=p[0];
    }
    return points[0][0]===0&&last===best.time?best:null;
  }catch{return null;}
}

function hologram(){
  const parts=[];
  function box(w,h,l,x,y,z){const g=new THREE.BoxGeometry(w,h,l);g.translate(x,y,z);parts.push(g);}
  box(1.58,.45,2.95,0,.05,0);box(1.22,.42,1.18,0,.45,.14);box(1.68,.1,.34,0,.37,1.28);
  for(const x of [-.8,.8])for(const z of [-.91,.91]){
    const g=new THREE.CylinderGeometry(.35,.35,.22,12);g.rotateZ(Math.PI/2);g.translate(x,-.1,z);parts.push(g);
  }
  const geo=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());
  const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x67ecff,transparent:true,opacity:.26,depthWrite:false}));
  mesh.name='本机最快单圈';mesh.visible=false;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo,28),new THREE.LineBasicMaterial({color:0xbdffff,transparent:true,opacity:.68,depthWrite:false})));
  return mesh;
}

/** This object belongs to one single-player race. The hologram has no physics body. */
export function createLapGhost(track,group,playback){
  let best=readBestLap(track),mesh=null,points=null,cursor=0,started=false;
  const rot=new THREE.Quaternion();
  function pose(time,car){
    const p=car.body.position,q=car.body.quaternion;
    return [time,p.x,p.y,p.z,q.x,q.y,q.z,q.w].map(round);
  }
  function save(time,car){
    if(!points||points.length<2)return false;
    const end=pose(time,car);
    if(end[0]>points.at(-1)[0])points.push(end);
    const current=readBestLap(track);
    if(current&&(!best||current.time<best.time))best=current;
    if(best&&best.time<=end[0])return false;
    const next={time:end[0],points};
    try{localStorage.setItem(prefix+track,JSON.stringify(next));best=next;return true;}catch{return false;}
  }
  return {
    begin(car){started=true;points=[pose(0,car)];cursor=0;},
    invalidate(){points=null;},
    finish(time,car){const saved=started&&time<=maxSeconds&&save(time,car);started=false;points=null;if(mesh)mesh.visible=false;return saved;},
    tick(time,car){
      if(!started)return;
      if(time>maxSeconds)points=null;
      if(points&&time-points.at(-1)[0]>=interval-.001)points.push(pose(time,car));
      if(!playback||!best)return;
      if(!mesh){mesh=hologram();group.add(mesh);}
      mesh.visible=time<=best.time;
      if(!mesh.visible)return;
      const frames=best.points;
      while(cursor<frames.length-2&&frames[cursor+1][0]<=time)cursor++;
      const a=frames[cursor],b=frames[cursor+1],t=THREE.MathUtils.clamp((time-a[0])/(b[0]-a[0]),0,1);
      mesh.position.set(a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t,a[3]+(b[3]-a[3])*t);
      mesh.quaternion.fromArray(a,4).normalize().slerp(rot.fromArray(b,4).normalize(),t);
      const near=mesh.position.distanceTo(car.body.position)<2;mesh.material.opacity=near?.09:.26;
      mesh.children[0].material.opacity=near?.22:.68;
    },
    dispose(){if(mesh){mesh.removeFromParent();mesh.traverse(o=>{o.geometry.dispose();o.material.dispose();});}}
  };
}
