import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {makeActivatable} from './venues.js';

const UP=new THREE.Vector3(0,1,0);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rng=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);

/**
 * Track layouts are drawn like a turtle: ['S',length,rise] straights and ['R'|'L',radius,degrees,rise] arcs,
 * starting at the start line heading north (-z). Features are placed by segment index and fraction.
 */
export const TRACKS=[
  {
    id:'neon',title:'NEON CIRCUIT',name:'霓虹环线',subtitle:'夜色都市高架 · 立交飞跃 · 倾斜发夹弯',accent:'#2ef2ff',look:'night',night:1,grip:1.12,
    width:15,laps:3,
    sky:{zenith:0x090418,horizon:0x3b1157,ground:0x06030f,fogColor:0x1b0b30,fogNear:190,fogFar:680,sunColor:0xc8b8ff,sunIntensity:1.5,ambientIntensity:.62,sunDirection:[-.35,.9,.25],showSun:false},
    path:{start:[0,0,0],heading:0,segs:[['S',100,0],['R',40,90,2],['S',60,4],['R',35,180,2],['S',150,1.5],['S',40,-2],['L',40,90,-1.5],['S',40,-2],['R',30,35,0],['L',30,35,0],['L',45,90,-1],['S',65.9,-1],['L',30,90,-1],['S',59.4,-1]]},
    jumps:[{seg:4,at:.8,gap:9,height:1.9,length:20}],
    rails:[{seg:1,side:'left'},{seg:3,side:'left'},{seg:6,side:'right'},{seg:10,side:'right'},{seg:12,side:'right'}],
    pads:[{seg:0,at:.6,lat:0},{seg:2,at:.45,lat:-.35},{seg:4,at:.5,lat:0},{seg:11,at:.5,lat:.35}],
    items:[{seg:2,at:.1},{seg:7,at:.45},{seg:13,at:.3}],
    arches:[{seg:0,at:.35},{seg:4,at:.25},{seg:7,at:.75},{seg:11,at:.2}],
  },
  {
    id:'canyon',title:'SUNSET CANYON',name:'落日峡谷',subtitle:'黄昏悬崖 · 长距离漂移弯 · 台地飞跃',accent:'#ffb23a',look:'sunset',night:.15,grip:1.05,
    width:14,laps:3,
    sky:{zenith:0x3b5aa8,horizon:0xffb37a,ground:0x4a2a30,fogColor:0xe7a07a,fogNear:220,fogFar:760,sunColor:0xffc98a,sunIntensity:2.8,ambientIntensity:.62,sunDirection:[.2,.25,-1],showSun:true},
    path:{start:[0,0,0],heading:0,segs:[['S',90,0],['R',70,70,2],['S',40,2],['L',50,50,2],['S',70,1],['R',34,160,-1],['S',131.9,-1],['R',60,50,-1],['S',60,-1],['L',45,60,0],['S',30,-1],['R',38,90,-1],['S',30.9,-1],['R',55,100,0],['S',30,0]]},
    jumps:[{seg:6,at:.48,gap:11,height:2.2,length:22}],
    rails:[{seg:1,side:'left'},{seg:5,side:'left'},{seg:9,side:'right'},{seg:11,side:'left'},{seg:13,side:'left'}],
    pads:[{seg:0,at:.55,lat:0},{seg:6,at:.18,lat:0},{seg:8,at:.5,lat:-.3},{seg:12,at:.5,lat:.3}],
    items:[{seg:2,at:.5},{seg:8,at:.15},{seg:14,at:.4}],
    arches:[{seg:0,at:.3},{seg:4,at:.5},{seg:10,at:.5}],
  },
];

/** Walk the turtle path; returns control points plus each segment's start distance and length. */
export function turtle({start,heading,segs},spacing=10){
  let [x,y,z]=start,h=heading*Math.PI/180,s=0;
  const pts=[[x,y,z]],starts=[],lengths=[];
  for(const seg of segs){
    starts.push(s);
    if(seg[0]==='S'){const [,len,dy=0]=seg,n=Math.max(1,Math.ceil(len/spacing));for(let i=0;i<n;i++){x+=Math.sin(h)*len/n;z-=Math.cos(h)*len/n;y+=dy/n;pts.push([x,y,z]);}lengths.push(len);s+=len;}
    else{const [t,r,deg,dy=0]=seg,ang=deg*Math.PI/180,dir=t==='R'?1:-1,n=Math.max(2,Math.ceil(r*ang/spacing));
      for(let i=0;i<n;i++){const step=ang/n;h+=dir*step/2;const chord=2*r*Math.sin(step/2);x+=Math.sin(h)*chord;z-=Math.cos(h)*chord;h+=dir*step/2;y+=dy/n;pts.push([x,y,z]);}
      lengths.push(r*ang);s+=r*ang;}
  }
  // The loop closes on the start point; drop the duplicate.
  if(Math.hypot(pts.at(-1)[0]-pts[0][0],pts.at(-1)[2]-pts[0][2])<1)pts.pop();
  return {pts,starts,lengths,total:s};
}

/** Convert segment-relative features into lap fractions. */
function resolveFeatures(def,path){
  const u=(seg,at)=>((path.starts[seg]+at*path.lengths[seg])/path.total+1)%1;
  return {
    kickers:(def.jumps||[]).map(j=>({t:u(j.seg,j.at),length:j.length,height:j.height})),
    gaps:(def.jumps||[]).map(j=>[u(j.seg,j.at),u(j.seg,j.at)+j.gap/path.total]),
    rails:(def.rails||[]).map(r=>[u(r.seg,0)-.004,u(r.seg,1)+.004,r.side]),
    pads:(def.pads||[]).map(p=>[u(p.seg,p.at),p.lat]),
    items:(def.items||[]).map(i=>u(i.seg,i.at)),
    arches:(def.arches||[]).map(a=>u(a.seg,a.at)),
  };
}

function canvas(w,h=w){const c=document.createElement('canvas');c.width=w;c.height=h;return [c,c.getContext('2d')];}
function tex(c,{repeat=[1,1],color=true}={}){const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(...repeat);t.anisotropy=8;t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;return t;}

/** Sample the closed spline into frames with bank, gaps and kickers applied. */
export function sampleTrack(def){
  const path=turtle(def.path);
  const features=resolveFeatures(def,path);
  const curve=new THREE.CatmullRomCurve3(path.pts.map(p=>new THREE.Vector3(...p)),true,'centripetal',.5);
  const length=curve.getLength(),N=Math.round(length/2.5),step=length/N;
  const samples=[];
  for(let i=0;i<N;i++){const u=i/N;samples.push({i,u,s:u*length,p:curve.getPointAt(u),gap:false});}
  // Kickers: a quadratic lip rising into the jump.
  for(const k of features.kickers){
    const end=k.t*length;
    for(const s of samples){const d=end-s.s;if(d>=0&&d<=k.length){const f=1-d/k.length;s.p.y+=k.height*f*f;}}
  }
  for(const [a,b] of features.gaps)for(const s of samples)if(s.u>=a&&s.u<b)s.gap=true;
  for(let i=0;i<N;i++){
    const a=samples[(i-1+N)%N].p,b=samples[(i+1)%N].p,s=samples[i];
    s.T=b.clone().sub(a).normalize();
    // Across a gap the take-off direction is kept so the lip launches straight.
    s.R0=new THREE.Vector3().crossVectors(s.T,UP).normalize();
    s.U0=new THREE.Vector3().crossVectors(s.R0,s.T).normalize();
  }
  for(let i=0;i<N;i++){
    const a=samples[(i-2+N)%N].T,b=samples[(i+2)%N].T,s=samples[i];
    const d=b.clone().sub(a);d.y=0;
    s.k=d.length()/(4*step)*Math.sign(d.dot(s.R0)||1);
  }
  // Smooth curvature, then derive bank (inside edge lower) and curvature magnitude for AI.
  const smooth=samples.map((s,i)=>{let sum=0;for(let j=-6;j<=6;j++)sum+=samples[(i+j+N)%N].k;return sum/13;});
  samples.forEach((s,i)=>{s.k=smooth[i];s.curv=Math.abs(smooth[i]);s.bank=clamp(smooth[i]*7.5,-.24,.24);});
  const hw=def.width/2;
  for(const s of samples){
    const c=Math.cos(s.bank),n=Math.sin(s.bank);
    s.R=s.R0.clone().multiplyScalar(c).addScaledVector(s.U0,-n);
    s.N=s.U0.clone().multiplyScalar(c).addScaledVector(s.R0,n);
    s.L=s.p.clone().addScaledVector(s.R,-hw);s.Rt=s.p.clone().addScaledVector(s.R,hw);
  }
  // Look-ahead curvature (max over the next 55 m) used for AI speed planning.
  const ahead=Math.round(55/step);
  for(let i=0;i<N;i++){let m=0;for(let j=0;j<ahead;j++)m=Math.max(m,samples[(i+j)%N].curv*(1-j/ahead*.35));samples[i].curvAhead=m;}
  return {curve,samples,length,N,step,hw,features};
}

/** Convex hull of 8 points (top quad then bottom quad), centred on its own centroid. */
function convexFromPoints(points,bodyPosition){
  const centroid=new THREE.Vector3();points.forEach(p=>centroid.add(p));centroid.multiplyScalar(1/points.length);
  const verts=points.map(p=>new CANNON.Vec3(p.x-centroid.x,p.y-centroid.y,p.z-centroid.z));
  const faces=[[0,1,2,3],[4,7,6,5],[0,3,7,4],[1,5,6,2],[0,4,5,1],[3,2,6,7]];
  // Fix winding so every face normal points away from the centroid (the shape origin).
  for(const f of faces){
    const a=verts[f[0]],b=verts[f[1]],d=verts[f[2]];
    const n=b.vsub(a).cross(d.vsub(a));
    const fc=new CANNON.Vec3();f.forEach(i=>fc.vadd(verts[i],fc));fc.scale(1/f.length,fc);
    if(n.dot(fc)<0)f.reverse();
  }
  const shape=new CANNON.ConvexPolyhedron({vertices:verts,faces});
  return {shape,offset:new CANNON.Vec3(centroid.x-bodyPosition.x,centroid.y-bodyPosition.y,centroid.z-bodyPosition.z)};
}

function roadTextures(theme){
  const W=512,H=1024;
  const [c,ctx]=canvas(W,H),[rc,rCtx]=canvas(W,H),random=rng(theme==='neon'?811:1907);
  const base=theme==='neon'?[20,22,36]:[68,54,48];
  const img=ctx.createImageData(W,H),rImg=rCtx.createImageData(W,H);
  const rBase=theme==='neon'?115:185;
  for(let i=0;i<img.data.length;i+=4){
    const n=(random()-.5)*(theme==='neon'?18:30);
    img.data[i]=Math.max(0,Math.min(255,base[0]+n));
    img.data[i+1]=Math.max(0,Math.min(255,base[1]+n));
    img.data[i+2]=Math.max(0,Math.min(255,base[2]+n*1.12));
    img.data[i+3]=255;
    const rv=Math.max(20,Math.min(245,rBase+(random()-.5)*44));
    rImg.data[i]=rImg.data[i+1]=rImg.data[i+2]=rv;rImg.data[i+3]=255;
  }
  ctx.putImageData(img,0,0);rCtx.putImageData(rImg,0,0);
  // 赛道橡胶车辙双轨
  for(const tx of [W*.33,W*.67]){
    const gr=ctx.createLinearGradient(tx-56,0,tx+56,0);
    gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(.5,theme==='neon'?'rgba(4,5,12,.34)':'rgba(26,14,10,.28)');gr.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gr;ctx.fillRect(tx-56,0,112,H);
  }
  // 夜间湿润高光水洼反光斑（显著增强霓虹环线质感）
  if(theme==='neon'){
    for(let i=0;i<18;i++){
      const px=50+random()*(W-100),py=random()*H,rx=36+random()*65,ry=70+random()*140;
      const g=rCtx.createRadialGradient(px,py,4,px,py,ry);
      g.addColorStop(0,'rgba(18,18,18,.92)');g.addColorStop(1,'rgba(115,115,115,0)');
      rCtx.fillStyle=g;rCtx.beginPath();rCtx.ellipse(px,py,rx,ry,0,0,Math.PI*2);rCtx.fill();
    }
  }
  // 中心双车道虚线 + 边缘彩绘路肩线
  ctx.fillStyle=theme==='neon'?'rgba(80,235,255,.72)':'rgba(255,214,88,.86)';
  for(let y=0;y<H;y+=128)ctx.fillRect(W/2-6,y+18,12,68);
  ctx.fillStyle=theme==='neon'?'rgba(230,242,255,.68)':'rgba(255,248,230,.85)';
  ctx.fillRect(22,0,9,H);ctx.fillRect(W-31,0,9,H);
  // 红白/蓝粉路肩防滑块
  for(let y=0;y<H;y+=64){
    ctx.fillStyle=(y/64)%2?(theme==='neon'?'#2ef2ff':'#ff7832'):(theme==='neon'?'#ff2fb4':'#f7f1e3');
    ctx.fillRect(0,y,14,64);ctx.fillRect(W-14,y,14,64);
  }
  // 沥青微反光粒料
  for(let i=0;i<2400;i++){ctx.fillStyle=`rgba(255,255,255,${random()*.09})`;ctx.fillRect(random()*W,random()*H,1+random()*2.2,1.2);}
  const map=tex(c,{repeat:[1,1]});
  const roughnessMap=tex(rc,{repeat:[1,1],color:false});
  const bumpMap=tex(c,{repeat:[1,1],color:false});
  return {map,roughnessMap,bumpMap};
}

function startLineTexture(){
  const [c,ctx]=canvas(256,64);
  for(let y=0;y<4;y++)for(let x=0;x<16;x++){ctx.fillStyle=(x+y)%2?'#f6f6f6':'#121216';ctx.fillRect(x*16,y*16,16,16);}
  return tex(c);
}

/** Ribbon geometry along the track between two lateral offsets (in metres from centre) at a height offset. */
function ribbon(track,from,to,lift=0,{skipGaps=true,uvScale=10}={}){
  const {samples,N}=track,pos=[],uv=[],along=[],idx=[];
  let v=0;
  for(let i=0;i<=N;i++){
    const s=samples[i%N];
    for(const off of [from,to]){const p=s.p.clone().addScaledVector(s.R,off).addScaledVector(s.N,lift);pos.push(p.x,p.y,p.z);}
    uv.push(0,(i*track.step)/uvScale,1,(i*track.step)/uvScale);along.push(i*track.step,i*track.step);
    if(i<N&&!(skipGaps&&(s.gap||samples[(i+1)%N].gap))){const a=v,b=v+1,c=v+2,d=v+3;idx.push(a,b,c,b,d,c);}
    v+=2;
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('along',new THREE.Float32BufferAttribute(along,1));g.setIndex(idx);g.computeVertexNormals();return g;
}

/** Vertical skirt (side wall) between two heights along one edge. */
function skirt(track,offset,top,bottom){
  const {samples,N}=track,pos=[],idx=[];let v=0;
  for(let i=0;i<=N;i++){const s=samples[i%N];
    const a=s.p.clone().addScaledVector(s.R,offset).addScaledVector(s.N,top),b=s.p.clone().addScaledVector(s.R,offset).addScaledVector(s.N,bottom);
    pos.push(a.x,a.y,a.z,b.x,b.y,b.z);
    if(i<N&&!s.gap&&!samples[(i+1)%N].gap)idx.push(v,v+1,v+2,v+1,v+3,v+2);v+=2;}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();return g;
}

const edgeShader=(colorA,colorB)=>new THREE.ShaderMaterial({
  uniforms:{time:{value:0},colorA:{value:new THREE.Color(colorA)},colorB:{value:new THREE.Color(colorB)}},
  vertexShader:`attribute float along;varying float vAlong;varying vec2 vUv;void main(){vAlong=along;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform float time;uniform vec3 colorA,colorB;varying float vAlong;varying vec2 vUv;
    void main(){float f=fract(vAlong/18.-time*1.4);float pulse=smoothstep(0.,.06,f)*(1.-smoothstep(.06,.3,f));
      float edge=smoothstep(0.,.35,vUv.x)*smoothstep(1.,.65,vUv.x);
      vec3 c=mix(colorA,colorB,pulse)*(1.6+pulse*3.2)*(.55+edge*.45);gl_FragColor=vec4(c,1.);}`,
  toneMapped:false,
});

const padShader=color=>new THREE.ShaderMaterial({
  uniforms:{time:{value:0},color:{value:new THREE.Color(color)}},transparent:true,depthWrite:false,
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform float time;uniform vec3 color;varying vec2 vUv;
    void main(){vec2 p=vUv;float y=fract(p.y*3.-time*2.2);float chev=1.-smoothstep(.0,.08,abs(y-.5-abs(p.x-.5)*.9)-.08);
      float frame=step(.04,p.x)*step(p.x,.96)*step(.02,p.y)*step(p.y,.98);float border=1.-frame;
      vec3 c=color*(chev*3.4+border*2.2+.35);gl_FragColor=vec4(c,(chev*.95+border*.9+.28));}`,
  toneMapped:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-4,
});

function textCanvasTexture(lines,{w=512,h=256,bg='rgba(10,8,30,.82)',fg='#2ef2ff',accent='#ff2fb4',font='"Microsoft YaHei UI","PingFang SC","Noto Sans SC",sans-serif'}={}){
  const [c,ctx]=canvas(w,h);ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  ctx.strokeStyle=accent;ctx.lineWidth=6;ctx.strokeRect(8,8,w-16,h-16);
  ctx.textAlign='center';ctx.textBaseline='middle';
  const single=lines.length===1;
  lines.forEach((line,i)=>{ctx.fillStyle=i?accent:fg;ctx.font=`${i?600:800} ${single?Math.round(h*.5):i?Math.round(h*.15):Math.round(h*.31)}px ${font}`;ctx.fillText(line,w/2,h*(single?.54:i?.75:.41),w-40);});
  const t=tex(c);t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;return t;
}

function chevronTexture(color){
  const [c,ctx]=canvas(256,128);ctx.fillStyle='rgba(8,6,20,.9)';ctx.fillRect(0,0,256,128);
  ctx.fillStyle=color;
  for(let k=0;k<3;k++){const x=30+k*72;ctx.beginPath();ctx.moveTo(x,16);ctx.lineTo(x+46,64);ctx.lineTo(x,112);ctx.lineTo(x+22,112);ctx.lineTo(x+68,64);ctx.lineTo(x+22,16);ctx.closePath();ctx.fill();}
  const t=tex(c);t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;return t;
}

function windowTexture(seed,warm){
  const [c,ctx]=canvas(128,256),random=rng(seed);
  ctx.fillStyle='#000';ctx.fillRect(0,0,128,256);
  for(let y=8;y<256;y+=16)for(let x=6;x<128;x+=16){
    if(random()<.3){const hue=random();ctx.fillStyle=warm?(hue<.6?'#ffcf7a':hue<.85?'#ff7ad9':'#7af0ff'):(hue<.55?'#5fdcff':hue<.8?'#9b7bff':'#ff5fcf');ctx.globalAlpha=.3+random()*.55;ctx.fillRect(x,y,9,8);}
  }
  ctx.globalAlpha=1;return tex(c);
}

/** Merge boxes whose side UVs repeat with the building size, so windows keep their scale. */
function cityGeometry(boxes){
  const parts=[];
  for(const b of boxes){
    const g=new THREE.BoxGeometry(b.w,b.h,b.d),uv=g.attributes.uv;
    for(let face=0;face<6;face++){
      const across=face<2?b.d:face<4?0:b.w;
      for(let k=0;k<4;k++){const i=face*4+k;if(face===2||face===3){uv.setXY(i,0,0);continue;}uv.setXY(i,uv.getX(i)*across/24,uv.getY(i)*b.h/48);}
    }
    g.translate(b.x,b.y,b.z);if(b.r)g.rotateY(0);parts.push(g);
  }
  const merged=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());return merged;
}

export function buildTrackVenue(scene,world,groundMaterial,id){
  const def=TRACKS.find(t=>t.id===id)||TRACKS[0];
  const track=sampleTrack(def),{samples,N,hw,length,step}=track;
  const group=new THREE.Group();group.name=`TRACK / ${def.title}`;scene.add(group);
  const scenery=new THREE.Group();group.add(scenery);
  const bodies=[];const animated=[];
  const neon=def.id==='neon';
  const accentA=neon?0x2ef2ff:0xffb23a,accentB=neon?0xff2fb4:0xff5a3a;

  // ---- road surface
  const rTex=roadTextures(def.id);
  const roadMat=new THREE.MeshStandardMaterial({...rTex,bumpScale:neon?.035:.055,roughness:neon?.55:.72,metalness:neon?.32:.06,envMapIntensity:neon?1.45:.7});
  const road=new THREE.Mesh(ribbon(track,-hw,hw,0,{uvScale:22}),roadMat);road.receiveShadow=true;group.add(road);
  const shoulderMat=new THREE.MeshStandardMaterial({color:neon?0x101225:0x5b3a2a,roughness:.5,metalness:.4});
  // Side walls and underside give the deck real thickness.
  const sideMat=new THREE.MeshStandardMaterial({color:neon?0x161a33:0x7a4a32,roughness:.55,metalness:neon?.6:.1,side:THREE.DoubleSide});
  for(const o of [-hw,hw]){const g=skirt(track,o,0,-1.1);const m=new THREE.Mesh(g,sideMat);m.receiveShadow=true;group.add(m);}
  const under=new THREE.Mesh(ribbon(track,hw,-hw,-1.1,{uvScale:22}),sideMat);group.add(under);
  // Neon edge strips with travelling pulses.
  const edgeA=edgeShader(accentA,0xffffff),edgeB=edgeShader(accentB,0xffffff);
  group.add(new THREE.Mesh(ribbon(track,-hw-.05,-hw+.42,.03),edgeA),new THREE.Mesh(ribbon(track,hw-.42,hw+.05,.03),edgeB));
  animated.push((dt,t)=>{edgeA.uniforms.time.value=t;edgeB.uniforms.time.value=t;});
  // Under-deck light line (visible on elevated sections).
  const underGlow=new THREE.Mesh(ribbon(track,-.6,.6,-1.12),new THREE.MeshBasicMaterial({color:new THREE.Color(accentB).multiplyScalar(neon?2.2:.9),toneMapped:false,side:THREE.DoubleSide}));group.add(underGlow);
  void shoulderMat;

  // ---- physics: convex deck segments, grouped six per body
  const thickness=1.1;
  let body=null,count=0;
  for(let i=0;i<N;i++){
    const a=samples[i],b=samples[(i+1)%N];if(a.gap||b.gap)continue;
    if(!body||count>=6){
      body=new CANNON.Body({mass:0,material:groundMaterial,collisionFilterGroup:1,collisionFilterMask:-1});
      body.position.set(a.p.x,a.p.y,a.p.z);world.addBody(body);bodies.push(body);count=0;
    }
    // Slight overlap along the track hides seams between segments.
    const ext=.12,aT=a.T.clone().multiplyScalar(-ext),bT=b.T.clone().multiplyScalar(ext);
    const pts=[a.L.clone().add(aT),a.Rt.clone().add(aT),b.Rt.clone().add(bT),b.L.clone().add(bT)];
    const bottom=pts.map((p,k)=>p.clone().addScaledVector((k<2?a:b).N,-thickness));
    const hull=convexFromPoints([...pts,...bottom],body.position);body.addShape(hull.shape,hull.offset);count++;
  }
  // Guard rails on selected corners.
  const railMat=new THREE.MeshStandardMaterial({color:neon?0x1b2040:0x3b2a24,roughness:.35,metalness:.7,transparent:true,opacity:.92});
  const railGlow=new THREE.MeshBasicMaterial({color:new THREE.Color(accentA).multiplyScalar(2.4),toneMapped:false});
  const railParts=[],railGlowParts=[];
  const barriers=[],barrierAt=new Map();
  const energyMat=new THREE.MeshBasicMaterial({color:new THREE.Color(.32,2.4,3),transparent:true,opacity:.65,side:THREE.DoubleSide,toneMapped:false});
  for(const [t0,t1,side] of track.features.rails){
    const sides=side==='both'?[-1,1]:[side==='left'?-1:1];
    for(const sgn of sides){
      let rb=null,rc=0;
      const middle=Math.floor((t0+t1)*N/2);
      const barrier={side:sgn,active:true,mesh:null},panels=[];
      for(let i=Math.floor(t0*N);i<Math.floor(t1*N);i++){
        const a=samples[i%N],b=samples[(i+1)%N];
        const off=sgn*(hw+.2);
        const pa=a.p.clone().addScaledVector(a.R,off),pb=b.p.clone().addScaledVector(b.R,off);
        const out=sgn*.32;
        const pts=[pa,pb,pb.clone().addScaledVector(b.R,out),pa.clone().addScaledVector(a.R,out)];
        const tops=pts.map((p,k)=>p.clone().addScaledVector(k===0||k===3?a.N:b.N,1.05));
        const quad=[pts[0],pts[3],pts[2],pts[1]];const topQuad=[tops[0],tops[3],tops[2],tops[1]];
        // A roughly 20-metre section of the outer rail is a one-use energy net.
        if(i>=middle-4&&i<middle+4){
          barrierAt.set(i+':'+sgn,barrier);
          for(const lift of [.25,.62,.99]){
            const l=pa.clone().addScaledVector(a.N,lift),r=pb.clone().addScaledVector(b.N,lift);
            const u=l.clone().addScaledVector(a.N,.12),v=r.clone().addScaledVector(b.N,.12);
            panels.push(new THREE.BufferGeometry().setFromPoints([l,r,v,l,v,u]));
          }
          continue;
        }
        if(!rb||rc>=8){rb=new CANNON.Body({mass:0,material:groundMaterial,collisionFilterGroup:1,collisionFilterMask:-1});rb.position.set(pa.x,pa.y,pa.z);world.addBody(rb);bodies.push(rb);rc=0;}
        const hull=convexFromPoints([...topQuad,...quad],rb.position);rb.addShape(hull.shape,hull.offset);rc++;
        const g=new THREE.BufferGeometry().setFromPoints([tops[0],tops[1],pts[1],tops[0],pts[1],pts[0]]);g.computeVertexNormals();railParts.push(g);
        const gl=new THREE.BufferGeometry().setFromPoints([tops[0],tops[1],tops[1].clone().addScaledVector(b.N,-.12),tops[0],tops[1].clone().addScaledVector(b.N,-.12),tops[0].clone().addScaledVector(a.N,-.12)]);railGlowParts.push(gl);
      }
      if(panels.length){barrier.mesh=new THREE.Mesh(mergeGeometries(panels,false),energyMat);group.add(barrier.mesh);barriers.push(barrier);panels.forEach(g=>g.dispose());}
    }
  }
  if(railParts.length){
    const railMerged=mergeGeometries(railParts,false);railMat.side=THREE.DoubleSide;group.add(new THREE.Mesh(railMerged,railMat));
    const glowMerged=mergeGeometries(railGlowParts,false);railGlow.side=THREE.DoubleSide;group.add(new THREE.Mesh(glowMerged,railGlow));
    railParts.forEach(g=>g.dispose());railGlowParts.forEach(g=>g.dispose());
  }

  // ---- start line, boost pads, checkpoint arches
  const startIndex=0;
  const s0=samples[startIndex];
  const startLine=new THREE.Mesh(new THREE.PlaneGeometry(def.width,2.4),new THREE.MeshStandardMaterial({map:startLineTexture(),roughness:.6,polygonOffset:true,polygonOffsetFactor:-3}));
  orientOnTrack(startLine,s0,0,.02);startLine.rotateX(-Math.PI/2);group.add(startLine);
  const gantry=buildGantry(def,s0,hw,accentA,accentB);group.add(gantry.group);animated.push(gantry.update);
  const pads=[];
  const padMat=padShader(neon?0xffd23a:0xffe060);
  for(const [t,lat] of track.features.pads){
    const i=Math.floor(t*N)%N,s=samples[i];
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(3.4,6.4),padMat);
    orientOnTrack(mesh,s,lat*hw,.035);mesh.rotateX(-Math.PI/2);group.add(mesh);
    pads.push({index:i,lateral:lat*hw,s:s.s});
  }
  animated.push((dt,t)=>{padMat.uniforms.time.value=t;});
  for(const t of track.features.arches){const i=Math.floor(t*N)%N;group.add(buildArch(samples[i],hw,accentA,accentB));}
  // Chevron boards on the outside of tight corners.
  const chevronMat=new THREE.MeshBasicMaterial({map:chevronTexture(neon?'#ff2fb4':'#ffcf3a'),color:new THREE.Color(1,1,1).multiplyScalar(neon?1.8:1.2),toneMapped:false,side:THREE.DoubleSide});
  const chevrons=[];
  for(let i=0;i<N;i+=5){
    const s=samples[i];if(s.curv<.022||s.gap)continue;
    const outside=s.k>0?-1:1;const g=new THREE.PlaneGeometry(2.6,1.3);
    const m=new THREE.Mesh(g);orientOnTrack(m,s,outside*(hw+1.2),1.1);
    if(s.k<0)m.rotateY(Math.PI);m.rotateY((s.k<0?1:-1)*outside*.35);m.updateMatrix();g.applyMatrix4(m.matrix);chevrons.push(g);
  }
  if(chevrons.length){group.add(new THREE.Mesh(mergeGeometries(chevrons,false),chevronMat));chevrons.forEach(g=>g.dispose());}

  // ---- item boxes
  const itemBoxes=[];
  const boxGeometry=new THREE.BoxGeometry(1.15,1.15,1.15);
  const boxMat=new THREE.MeshStandardMaterial({color:0x1a1030,emissive:new THREE.Color(neon?0xff2fb4:0xff7a3a),emissiveIntensity:1.6,roughness:.2,metalness:.3,transparent:true,opacity:.86});
  const boxEdges=new THREE.LineBasicMaterial({color:new THREE.Color(2.6,2.6,2.6),toneMapped:false});
  const edgesGeometry=new THREE.EdgesGeometry(boxGeometry);
  for(const t of track.features.items){
    const i=Math.floor(t*N)%N,s=samples[i];
    for(const lat of [-.6,-.2,.2,.6]){
      const holder=new THREE.Group();const cube=new THREE.Mesh(boxGeometry,boxMat);cube.add(new THREE.LineSegments(edgesGeometry,boxEdges));holder.add(cube);
      const position=s.p.clone().addScaledVector(s.R,lat*hw).addScaledVector(s.N,1.25);holder.position.copy(position);group.add(holder);
      itemBoxes.push({index:i,position,mesh:holder,cube,respawnAt:0});
    }
  }

  // ---- scenery
  (neon?buildNeonScenery:buildCanyonScenery)(scenery,track,def,animated);

  // Fall plane height for each sample (falls are measured relative to the nearest deck).
  const toggle=makeActivatable(world,group,bodies);
  // Grid slots: two columns behind the start line.
  const grid=[];
  for(let k=0;k<6;k++){
    const back=10+Math.floor(k/2)*8+(k%2)*3.5,i=(startIndex-Math.round(back/step)+N)%N,s=samples[i];
    const lat=(k%2?.32:-.32)*hw;
    grid.push({index:i,position:s.p.clone().addScaledVector(s.R,lat),yaw:Math.atan2(-s.T.x,-s.T.z),s:s.s-length});
  }
  const venue={
    type:'track',id:def.id,descriptor:{...def,id:def.id,title:def.title},group,bodies,track,samples,length,hw,step,N,pads,itemBoxes,grid,gantry,barriers,barrierAt,
    activate:toggle.activate,deactivate:toggle.deactivate,
    setVisible(v){group.visible=v;},
    dynamicProps:[],
    update(dt,time){for(const f of animated)f(dt,time);for(const box of itemBoxes){box.cube.rotation.y+=dt*1.6;box.cube.rotation.x=Math.sin(time*1.3+box.index)*.35;box.mesh.position.y=box.position.y+Math.sin(time*2.2+box.index*.3)*.15;}},
    /** Nearest sample to p, searching a window around a hint index. */
    nearest(p,hint=-1,window=14){
      let best=-1,bd=Infinity;
      if(hint<0){for(let i=0;i<N;i++){const d=samples[i].p.distanceToSquared(p);if(d<bd){bd=d;best=i;}}}
      else for(let j=-window;j<=window*2;j++){const i=(hint+j+N)%N,d=samples[i].p.distanceToSquared(p);if(d<bd){bd=d;best=i;}}
      return {index:best,distance:Math.sqrt(bd)};
    },
  };
  toggle.deactivate();toggle.activate();
  return venue;
}

function orientOnTrack(object,s,lateral,lift){
  const p=s.p.clone().addScaledVector(s.R,lateral).addScaledVector(s.N,lift);
  object.position.copy(p);
  const m=new THREE.Matrix4().makeBasis(s.R,s.N,s.T.clone().multiplyScalar(-1));
  object.quaternion.setFromRotationMatrix(m);
}

function buildGantry(def,s,hw,accentA,accentB){
  const group=new THREE.Group();orientOnTrack(group,s,0,0);
  const dark=new THREE.MeshStandardMaterial({color:0x14182c,roughness:.3,metalness:.8});
  const glowA=new THREE.MeshBasicMaterial({color:new THREE.Color(accentA).multiplyScalar(2.6),toneMapped:false});
  const glowB=new THREE.MeshBasicMaterial({color:new THREE.Color(accentB).multiplyScalar(2.6),toneMapped:false});
  for(const x of [-hw-1.2,hw+1.2]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.9,8.5,.9),dark);leg.position.set(x,4.25,0);leg.castShadow=true;group.add(leg);
    const strip=new THREE.Mesh(new THREE.BoxGeometry(.12,8.2,.95),x<0?glowA:glowB);strip.position.set(x+(x<0?.46:-.46),4.25,0);group.add(strip);}
  const beam=new THREE.Mesh(new THREE.BoxGeometry(def.width+3.4,1.6,1.1),dark);beam.position.y=8.4;beam.castShadow=true;group.add(beam);
  const banner=new THREE.Mesh(new THREE.PlaneGeometry(def.width-1,1.25),new THREE.MeshBasicMaterial({map:textCanvasTexture([`${def.name}  ·  PUNCH DRIVE`],{w:1024,h:128,fg:'#ffffff',accent:def.accent}),toneMapped:false}));
  banner.position.set(0,8.4,.56);group.add(banner);
  const back=banner.clone();back.rotation.y=Math.PI;back.position.z=-.56;group.add(back);
  // Five start lamps (red -> green), driven by the race countdown.
  const lamps=[];
  for(let i=0;i<5;i++){const lamp=new THREE.Mesh(new THREE.CircleGeometry(.36,20),new THREE.MeshBasicMaterial({color:0x220608,toneMapped:false}));lamp.position.set((i-2)*1.1,6.9,.58);group.add(lamp);
    const lb=lamp.clone();lb.material=lamp.material;lb.rotation.y=Math.PI;lb.position.z=-.58;group.add(lb);lamps.push(lamp);}
  const plate=new THREE.Mesh(new THREE.BoxGeometry(6.2,1.05,.9),dark);plate.position.y=6.9;group.add(plate);
  let lampState=-1;
  return {group,update(){},
    setLamps(n,go){if(n===lampState&&!go)return;lampState=n;lamps.forEach((l,i)=>{l.material.color.set(go?0x31ff7a:i<n?0xff2238:0x220608);if(go||i<n)l.material.color.multiplyScalar(3);});},
  };
}

function buildArch(s,hw,accentA,accentB){
  const group=new THREE.Group();orientOnTrack(group,s,0,0);
  const glow=new THREE.MeshBasicMaterial({color:new THREE.Color(accentA).multiplyScalar(2.2),toneMapped:false});
  const glow2=new THREE.MeshBasicMaterial({color:new THREE.Color(accentB).multiplyScalar(2.2),toneMapped:false});
  const arch=new THREE.Mesh(new THREE.TorusGeometry(hw+1.6,.16,8,64,Math.PI),glow);arch.position.y=-1.2;group.add(arch);
  const arch2=new THREE.Mesh(new THREE.TorusGeometry(hw+1.95,.07,6,64,Math.PI),glow2);arch2.position.y=-1.2;arch2.position.z=-.6;group.add(arch2);
  return group;
}

/** True when a support under sample i would stand on another, lower part of the track. */
function blocksLowerDeck(track,i){
  const s=track.samples[i];
  return track.samples.some((o,j)=>{const lap=Math.min(Math.abs(i-j),track.N-Math.abs(i-j));return lap>12&&o.p.y<s.p.y-2&&Math.hypot(o.p.x-s.p.x,o.p.z-s.p.z)<track.hw+5;});
}

// ---------------------------------------------------------------- themes
function buildNeonScenery(group,track,def,animated){
  const random=rng(4242);
  // Retro sun on the northern horizon.
  const sunMat=new THREE.ShaderMaterial({
    uniforms:{time:{value:0}},transparent:true,depthWrite:false,fog:false,toneMapped:false,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform float time;varying vec2 vUv;void main(){vec2 p=vUv-.5;float r=length(p);if(r>.5)discard;
      vec3 top=vec3(1.45,1.15,.32),bottom=vec3(1.35,.16,.78);vec3 c=mix(bottom,top,smoothstep(-.45,.45,p.y));
      float band=step(.0,p.y)+step(fract((p.y+.5)*14.+time*.2),.62+p.y*1.1);if(band<.5)discard;
      float glow=1.-smoothstep(.42,.5,r);gl_FragColor=vec4(c*glow,glow);}`,
  });
  const sun=new THREE.Mesh(new THREE.CircleGeometry(58,64),sunMat);sun.position.set(0,6,-420);sun.renderOrder=-50;group.add(sun);
  animated.push((dt,t)=>{sunMat.uniforms.time.value=t;});
  // Synthwave mountain ring: dark fill plus glowing ridgelines.
  const fill=[],lines=[];
  for(let i=0;i<64;i++){
    const a0=i/64*Math.PI*2,a1=(i+1)/64*Math.PI*2,r=350+random()*40,h=20+random()*55,am=(a0+a1)/2;
    const p0=new THREE.Vector3(Math.sin(a0)*r,-30,Math.cos(a0)*r),p1=new THREE.Vector3(Math.sin(a1)*r,-30,Math.cos(a1)*r),pk=new THREE.Vector3(Math.sin(am)*(r-10),-30+h,Math.cos(am)*(r-10));
    fill.push(p0.x,p0.y,p0.z,pk.x,pk.y,pk.z,p1.x,p1.y,p1.z);lines.push(p0.x,p0.y,p0.z,pk.x,pk.y,pk.z,pk.x,pk.y,pk.z,p1.x,p1.y,p1.z);
    for(let k=1;k<4;k++){const f=k/4;const a=p0.clone().lerp(pk,f),b=p1.clone().lerp(pk,f);lines.push(a.x,a.y,a.z,b.x,b.y,b.z);}
  }
  const mountainGeometry=new THREE.BufferGeometry();mountainGeometry.setAttribute('position',new THREE.Float32BufferAttribute(fill,3));
  group.add(new THREE.Mesh(mountainGeometry,new THREE.MeshBasicMaterial({color:0x0c0420,side:THREE.DoubleSide,fog:false})));
  const ridge=new THREE.BufferGeometry();ridge.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));
  group.add(new THREE.LineSegments(ridge,new THREE.LineBasicMaterial({color:new THREE.Color(2.4,.4,1.9),fog:false,toneMapped:false})));
  // Stars.
  const stars=[];for(let i=0;i<900;i++){const a=random()*Math.PI*2,y=.05+random()*.95,r=Math.sqrt(1-y*y);stars.push(Math.cos(a)*r*400,y*260,Math.sin(a)*r*400);}
  const starGeometry=new THREE.BufferGeometry();starGeometry.setAttribute('position',new THREE.Float32BufferAttribute(stars,3));
  group.add(new THREE.Points(starGeometry,new THREE.PointsMaterial({color:0xdcd6ff,size:1.1,sizeAttenuation:false,fog:false,toneMapped:false})));
  // City far below the skyway: low blocks under the deck, towers only well away from it.
  const boxes=[],strips=[];
  for(let i=0;i<300;i++){
    const x=(random()-.5)*640,z=(random()-.5)*640;
    let near=Infinity;for(const s of track.samples){const d=Math.hypot(s.p.x-x,s.p.z-z);if(d<near)near=d;}
    const w=10+random()*16,d=10+random()*16;
    const h=near<34?18+random()*40:near<80?35+random()*60:60+random()*110;
    boxes.push({x,z,w,d,h,y:-95+h/2});
    if(near>40&&random()<.45){const top=-95+h;for(const sx of [-1,1])strips.push({x:x+sx*w/2,z:z+d/2,h:h*.9,top});}
  }
  const windows=windowTexture(77,false);
  const city=new THREE.Mesh(cityGeometry(boxes),new THREE.MeshStandardMaterial({color:0x0b0d1d,roughness:.55,metalness:.6,emissive:0xffffff,emissiveMap:windows,emissiveIntensity:.85}));
  group.add(city);
  const stripParts=strips.map(st=>{const g=new THREE.BoxGeometry(.5,st.h,.5);g.translate(st.x,st.top-st.h/2,st.z);return g;});
  if(stripParts.length){group.add(new THREE.Mesh(mergeGeometries(stripParts,false),new THREE.MeshBasicMaterial({color:new THREE.Color(.25,1.6,1.9),toneMapped:false})));stripParts.forEach(g=>g.dispose());}
  // Ground grid glow far below.
  const [gc,gctx]=canvas(256);gctx.fillStyle='#000';gctx.fillRect(0,0,256,256);gctx.strokeStyle='#ff2fb4';gctx.lineWidth=3;gctx.strokeRect(0,0,256,256);
  const gridTex=tex(gc,{repeat:[60,60]});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(1200,1200),new THREE.MeshBasicMaterial({map:gridTex,color:new THREE.Color(.9,.5,1),transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-95;group.add(floor);
  // Support pylons under the deck.
  const pylons=[],rings=[];
  for(let i=0;i<track.N;i+=14){const s=track.samples[i];if(s.gap||blocksLowerDeck(track,i))continue;const h=s.p.y+95;
    const g=new THREE.CylinderGeometry(.9,1.3,h,10);g.translate(s.p.x,s.p.y-1.1-h/2,s.p.z);pylons.push(g);
    for(const y of [-8,-24]){const r=new THREE.TorusGeometry(1.25,.09,6,20);r.rotateX(Math.PI/2);r.translate(s.p.x,s.p.y+y,s.p.z);rings.push(r);}}
  group.add(new THREE.Mesh(mergeGeometries(pylons,false),new THREE.MeshStandardMaterial({color:0x151a33,roughness:.4,metalness:.7})));
  group.add(new THREE.Mesh(mergeGeometries(rings,false),new THREE.MeshBasicMaterial({color:new THREE.Color(.3,2.6,3),toneMapped:false})));
  // Holographic billboards along the skyway.
  const boards=[['PUNCH DRIVE','重拳飞车 · 竞速 乱斗 生存'],['油门到底','前方没有护栏'],['霓虹环线','九号空中赛道'],['别往下看','稳住方向盘'],['伏特能源','漂移攒满氮气']];
  boards.forEach((lines,k)=>{
    const s=track.samples[Math.floor((k+.5)/boards.length*track.N)%track.N];const side=k%2?1:-1;
    const t=textCanvasTexture(lines,{fg:k%2?'#ff2fb4':'#2ef2ff',accent:k%2?'#2ef2ff':'#ff2fb4'});
    const board=new THREE.Mesh(new THREE.PlaneGeometry(16,8),new THREE.MeshBasicMaterial({map:t,color:new THREE.Color(1.6,1.6,1.6),transparent:true,opacity:.92,toneMapped:false}));
    // A second face on the back so the text never reads mirrored from the far side of the loop.
    const reverse=board.clone();reverse.rotation.y=Math.PI;reverse.position.z=-.02;board.add(reverse);
    const p=s.p.clone().addScaledVector(s.R0,side*(track.hw+14));board.position.set(p.x,p.y+9,p.z);board.lookAt(s.p.x,s.p.y+6,s.p.z);group.add(board);
    const post=new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,60),new THREE.MeshStandardMaterial({color:0x141833,metalness:.7,roughness:.4}));post.position.set(p.x,p.y-25,p.z);group.add(post);
  });
}

function buildCanyonScenery(group,track,def,animated){
  const random=rng(9931);
  const rock=new THREE.MeshStandardMaterial({color:0xb4643e,roughness:.95,flatShading:true});
  const rockLight=new THREE.MeshStandardMaterial({color:0xe39a5c,roughness:.9,flatShading:true});
  const rockDark=new THREE.MeshStandardMaterial({color:0x6e3a33,roughness:1,flatShading:true});
  // Desert floor far below with a winding river.
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(1400,1400,1,1),new THREE.MeshStandardMaterial({color:0xa5583a,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-70;floor.receiveShadow=false;group.add(floor);
  const river=new THREE.Mesh(new THREE.PlaneGeometry(40,1400),new THREE.MeshStandardMaterial({color:0x2c6f94,roughness:.15,metalness:.4,emissive:0x0a2a40}));river.rotation.set(-Math.PI/2,0,.4);river.position.set(-30,-69.6,0);group.add(river);
  // Rock columns supporting the road.
  const cols=[],caps=[];
  for(let i=0;i<track.N;i+=11){const s=track.samples[i];if(s.gap||blocksLowerDeck(track,i))continue;const h=s.p.y+70;
    const r=4+random()*3;const g=new THREE.CylinderGeometry(r*.85,r*1.25,h,7);g.translate(s.p.x,s.p.y-1.2-h/2,s.p.z);cols.push(g);
    const c=new THREE.CylinderGeometry(r*1.05,r*.9,1.4,7);c.translate(s.p.x,s.p.y-1.6,s.p.z);caps.push(c);}
  group.add(new THREE.Mesh(mergeGeometries(cols,false),rock),new THREE.Mesh(mergeGeometries(caps,false),rockLight));
  // Distant mesas and buttes.
  const mesas=[];
  for(let i=0;i<46;i++){
    const a=random()*Math.PI*2,r=220+random()*220,w=20+random()*60,h=40+random()*110;
    const x=Math.sin(a)*r,z=Math.cos(a)*r;
    const g=new THREE.CylinderGeometry(w*.8,w,h,6+Math.floor(random()*3));g.translate(x,-70+h/2,z);mesas.push(g);
    if(random()<.6){const c=new THREE.CylinderGeometry(w*.82,w*.82,3,6);c.translate(x,-70+h,z);mesas.push(c);}
  }
  group.add(new THREE.Mesh(mergeGeometries(mesas,false),rockDark));
  // Floating dust motes catching the low sun.
  const dust=[];for(let i=0;i<500;i++)dust.push((random()-.5)*500,-40+random()*80,(random()-.5)*500);
  const dg=new THREE.BufferGeometry();dg.setAttribute('position',new THREE.Float32BufferAttribute(dust,3));
  const motes=new THREE.Points(dg,new THREE.PointsMaterial({color:0xffd9a0,size:.5,transparent:true,opacity:.6}));group.add(motes);
  animated.push((dt,t)=>{motes.rotation.y=t*.01;});
  // Cacti and boulders on wide road shoulders are skipped; the road floats on columns.
  const boards=[['PUNCH DRIVE','SUNSET CANYON'],['MESA LEAP','HOLD IT FLAT'],['DRIFT KING','LONG ARCS AHEAD']];
  boards.forEach((lines,k)=>{
    const s=track.samples[Math.floor((k*.33+.12)*track.N)%track.N];const side=k%2?1:-1;
    const t=textCanvasTexture(lines,{bg:'rgba(40,20,14,.88)',fg:'#ffd27a',accent:'#ff6a3a'});
    const board=new THREE.Mesh(new THREE.PlaneGeometry(14,7),new THREE.MeshBasicMaterial({map:t,color:new THREE.Color(1.15,1.15,1.15),side:THREE.DoubleSide,toneMapped:false}));
    const p=s.p.clone().addScaledVector(s.R0,side*(track.hw+12));board.position.set(p.x,p.y+8,p.z);board.lookAt(s.p.x,s.p.y+6,s.p.z);group.add(board);
  });
}
