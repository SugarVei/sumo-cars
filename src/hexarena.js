import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {makeActivatable} from './venues.js';

const rng=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const SQRT3=Math.sqrt(3);

export const HEX_VENUES=[
  {id:'core',title:'MAGMA CORE',name:'熔岩核心',subtitle:'熔岩反应堆上的六边形地块 · 压过的地块会升温熔化',accent:'#ff6a2a',look:'night',night:.85,grip:1,
    sky:{zenith:0x12040a,horizon:0x4a1208,ground:0x1a0402,fogColor:0x2a0906,fogNear:130,fogFar:380,sunColor:0xffb090,sunIntensity:1.4,ambientIntensity:.55,sunDirection:[-.3,1,.4],showSun:false},
    tile:0x2a2d3a,edge:0x2ef2ff,hot:0xff5a1a,lava:true},
  {id:'grid',title:'CYBER GRID',name:'赛博网格',subtitle:'数据虚空中的玻璃地块 · 规则相同，光线更冷',accent:'#2ef2ff',look:'night',night:1,grip:1,
    sky:{zenith:0x02040e,horizon:0x0b1f3a,ground:0x010208,fogColor:0x061226,fogNear:130,fogFar:400,sunColor:0xbfd8ff,sunIntensity:1.3,ambientIntensity:.55,sunDirection:[.4,1,.2],showSun:false},
    tile:0x1b2333,edge:0xff2fb4,hot:0xff2fb4,lava:false},
];

/** Pointy-top hex floor. Tiles start solid, warn (heat up) when touched, then drop away. */
export function buildHexVenue(scene,world,groundMaterial,id){
  const def=HEX_VENUES.find(v=>v.id===id)||HEX_VENUES[0];
  const R=7,size=2.05,height=1.2;
  const group=new THREE.Group();group.name=`HEX / ${def.title}`;scene.add(group);
  const tiles=[],lookup=new Map(),bodies=[];
  for(let q=-R;q<=R;q++)for(let r=-R;r<=R;r++){
    if(Math.abs(q+r)>R)continue;
    const x=size*SQRT3*(q+r/2),z=size*1.5*r;
    const ring=Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r));
    const body=new CANNON.Body({mass:0,material:groundMaterial,collisionFilterGroup:1,collisionFilterMask:-1});
    body.addShape(new CANNON.Cylinder(size*1.003,size*1.003,height,6));body.position.set(x,-height/2,z);world.addBody(body);bodies.push(body);
    const tile={q,r,x,z,ring,body,state:'solid',timer:0,heat:0,warm:0,y:0,vy:0,spin:0,rot:new THREE.Euler(),index:tiles.length};
    tiles.push(tile);lookup.set(q+','+r,tile);
  }
  const count=tiles.length;
  // Instanced plates, glowing rims and hot cores — 高清装甲六边形贴图增强近景细节
  const plateTexCanvas=document.createElement('canvas');plateTexCanvas.width=plateTexCanvas.height=256;
  const pCtx=plateTexCanvas.getContext('2d');
  pCtx.fillStyle='#dce2ec';pCtx.fillRect(0,0,256,256);
  pCtx.strokeStyle='rgba(20,26,38,.45)';pCtx.lineWidth=6;
  pCtx.beginPath();for(let k=0;k<6;k++){const a=k*Math.PI/3;const px=128+Math.cos(a)*104,py=128+Math.sin(a)*104;k?pCtx.lineTo(px,py):pCtx.moveTo(px,py);}pCtx.closePath();pCtx.stroke();
  pCtx.strokeStyle='rgba(255,255,255,.35)';pCtx.lineWidth=2;
  pCtx.beginPath();for(let k=0;k<6;k++){const a=k*Math.PI/3;const px=128+Math.cos(a)*72,py=128+Math.sin(a)*72;k?pCtx.lineTo(px,py):pCtx.moveTo(px,py);}pCtx.closePath();pCtx.stroke();
  for(let k=0;k<6;k++){const a=k*Math.PI/3;pCtx.fillStyle='rgba(15,20,32,.55)';pCtx.beginPath();pCtx.arc(128+Math.cos(a)*88,128+Math.sin(a)*88,4,0,Math.PI*2);pCtx.fill();}
  const plateMap=new THREE.CanvasTexture(plateTexCanvas);plateMap.colorSpace=THREE.SRGBColorSpace;plateMap.anisotropy=4;
  const plateBump=new THREE.CanvasTexture(plateTexCanvas);plateBump.colorSpace=THREE.NoColorSpace;
  const plateGeometry=new THREE.CylinderGeometry(size*.965,size*.965,height,6);
  const plateMaterial=new THREE.MeshStandardMaterial({color:0xffffff,map:plateMap,bumpMap:plateBump,bumpScale:.035,roughness:def.lava?.42:.22,metalness:def.lava?.55:.42,envMapIntensity:.95,transparent:!def.lava,opacity:def.lava?1:.93});
  const plates=new THREE.InstancedMesh(plateGeometry,plateMaterial,count);plates.castShadow=true;plates.receiveShadow=true;group.add(plates);
  const rimGeometry=new THREE.RingGeometry(size*.87,size*.95,6,1);rimGeometry.rotateX(-Math.PI/2);rimGeometry.rotateY(Math.PI/6);
  // RingGeometry places its first vertex on +x; rotate so its corners match the pointy-top plates.
  const rims=new THREE.InstancedMesh(rimGeometry,new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false,transparent:true,depthWrite:false}),count);group.add(rims);
  const base=new THREE.Color(def.tile),edge=new THREE.Color(def.edge),hot=new THREE.Color(0xff932a),red=new THREE.Color(0xff261a);
  // Three branching fissures share one instanced draw, hidden until a tile is about to fall.
  const fissures=[];
  for(let i=0;i<3;i++){
    const g=new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-.055,.02,0),new THREE.Vector3(.08,.02,0),new THREE.Vector3(.29,.02,.75),
      new THREE.Vector3(.08,.02,0),new THREE.Vector3(.36,.02,.75),new THREE.Vector3(.29,.02,.75),
      new THREE.Vector3(.29,.02,.75),new THREE.Vector3(.36,.02,.75),new THREE.Vector3(.14,.02,1.72),
    ]);
    g.rotateY(i*2*Math.PI/3);fissures.push(g);
  }
  const cracks=new THREE.InstancedMesh(mergeGeometries(fissures,false),new THREE.MeshBasicMaterial({color:new THREE.Color(3.5,1.5,.25),side:THREE.DoubleSide,toneMapped:false}),count);
  cracks.frustumCulled=false;group.add(cracks);fissures.forEach(g=>g.dispose());
  for(const mesh of [plates,rims,cracks])mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  function writeTile(t){
    const warning=t.state==='warn',falling=t.state==='falling',jitter=warning?Math.sin(t.timer*42+t.index)*.045:0;
    dummy.position.set(t.x+jitter,t.y-height/2,t.z);dummy.rotation.copy(t.rot);dummy.scale.setScalar(t.state==='gone'?0:1);dummy.updateMatrix();plates.setMatrixAt(t.index,dummy.matrix);
    dummy.position.y=t.y+.012;dummy.updateMatrix();rims.setMatrixAt(t.index,dummy.matrix);
    dummy.scale.setScalar(warning?1:0);dummy.updateMatrix();cracks.setMatrixAt(t.index,dummy.matrix);
    color.copy(base).lerp(falling?red:hot,falling?1:warning?.65+.35*t.heat:t.heat*.6);plates.setColorAt(t.index,color);
    const pulse=warning?1.4+.6*Math.sin(t.timer*24):1;
    color.copy(edge).lerp(falling?red:hot,warning||falling?1:t.heat).multiplyScalar((.85+(t.ring===R?.55:0))*pulse);
    rims.setColorAt(t.index,color);
  }
  tiles.forEach(writeTile);for(const mesh of [plates,rims,cracks])mesh.instanceMatrix.needsUpdate=true;
  // Rim pylons with light bars.
  const pylonParts=[],barParts=[];
  for(let i=0;i<18;i++){const a=i/18*Math.PI*2,rad=R*size*1.78;
    const g=new THREE.CylinderGeometry(.45,.7,9,8);g.translate(Math.sin(a)*rad,-2,Math.cos(a)*rad);pylonParts.push(g);
    const b=new THREE.BoxGeometry(.18,6,.18);b.translate(Math.sin(a)*(rad-.55),.4,Math.cos(a)*(rad-.55));barParts.push(b);}
  group.add(new THREE.Mesh(mergeGeometries(pylonParts,false),new THREE.MeshStandardMaterial({color:0x1a1d2a,roughness:.4,metalness:.75})));
  group.add(new THREE.Mesh(mergeGeometries(barParts,false),new THREE.MeshBasicMaterial({color:new THREE.Color(def.accent).multiplyScalar(1.45),toneMapped:false})));
  // Below: molten core or data void.
  const coreMat=new THREE.ShaderMaterial({
    uniforms:{time:{value:0},a:{value:new THREE.Color(def.lava?0xff3a0a:0x0a3a8a)},b:{value:new THREE.Color(def.lava?0xffc23a:0x2ef2ff)}},fog:false,toneMapped:false,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform float time;uniform vec3 a,b;varying vec2 vUv;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      void main(){vec2 p=(vUv-.5)*14.;float t=time*.12;
        float v=n(p+vec2(t,-t))*.55+n(p*2.1-vec2(t*1.7,t))*.3+n(p*4.3+t*2.)*.15;
        float r=length(vUv-.5)*2.;float glow=pow(v,2.2)*(1.35-r*.9);
        vec3 c=mix(a*.35,b*2.4,smoothstep(.25,.85,v))*max(0.,glow);gl_FragColor=vec4(c,1.);}`,
  });
  const core=new THREE.Mesh(new THREE.CircleGeometry(160,64),coreMat);core.rotation.x=-Math.PI/2;core.position.y=-46;group.add(core);
  // Rising embers / data motes.
  const random=rng(def.lava?5:9),moteCount=380,motes=new Float32Array(moteCount*3),speeds=new Float32Array(moteCount);
  for(let i=0;i<moteCount;i++){motes[i*3]=(random()-.5)*120;motes[i*3+1]=-46+random()*60;motes[i*3+2]=(random()-.5)*120;speeds[i]=2+random()*5;}
  const moteGeometry=new THREE.BufferGeometry();moteGeometry.setAttribute('position',new THREE.BufferAttribute(motes,3).setUsage(THREE.DynamicDrawUsage));
  const moteMesh=new THREE.Points(moteGeometry,new THREE.PointsMaterial({color:def.lava?new THREE.Color(3,1.2,.3):new THREE.Color(.6,2.4,3),size:.35,transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
  group.add(moteMesh);
  // Distant ring structure.
  const ringParts=[];
  for(let k=0;k<3;k++){const g=new THREE.TorusGeometry(70+k*14,.6+k*.3,6,96);g.rotateX(Math.PI/2);g.translate(0,-18-k*9,0);ringParts.push(g);}
  group.add(new THREE.Mesh(mergeGeometries(ringParts,false),new THREE.MeshBasicMaterial({color:new THREE.Color(def.accent).multiplyScalar(1.6),toneMapped:false,fog:false})));
  const stars=[];for(let i=0;i<600;i++){const a=random()*Math.PI*2,y=.05+random()*.95,rr=Math.sqrt(1-y*y);stars.push(Math.cos(a)*rr*260,y*180,Math.sin(a)*rr*260);}
  const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(stars,3));
  group.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffe6dc,size:1,sizeAttenuation:false,fog:false})));

  const toggle=makeActivatable(world,group,bodies);
  const dirty=new Set(tiles);
  function axial(x,z){
    const q=(SQRT3/3*x-1/3*z)/size,r=(2/3*z)/size;
    let rx=Math.round(q),rz=Math.round(r),ry=Math.round(-q-r);
    const dx=Math.abs(rx-q),dz=Math.abs(rz-r),dy=Math.abs(ry+q+r);
    if(dx>dy&&dx>dz)rx=-ry-rz;else if(dy<=dz)rz=-rx-ry;
    return [rx,rz];
  }
  const venue={
    type:'hex',id:def.id,descriptor:{...def},group,bodies,tiles,R,size,
    halfSize:R*size*1.6,
    activate:toggle.activate,deactivate:toggle.deactivate,setVisible(v){group.visible=v;},dynamicProps:[],
    tileAt(x,z){const [q,r]=axial(x,z);return lookup.get(q+','+r)||null;},
    solidAt(x,z){const t=venue.tileAt(x,z);return !!t&&t.state==='solid';},
    trigger(t,delay=.8){if(!t||t.state!=='solid')return false;t.state='warn';t.timer=Math.max(.8,delay);t.warnTime=t.timer;t.heat=.45;dirty.add(t);return true;},
    // Wheels heat a plate up; once it is glowing hot it starts its melt countdown.
    heatUp(t,amount,delay){if(!t||t.state!=='solid')return false;t.warm=Math.min(1,t.warm+amount);t.heat=t.warm*.45;dirty.add(t);return t.warm>=1?venue.trigger(t,delay):false;},
    reset(){
      for(const t of tiles){t.state='solid';t.timer=0;t.heat=0;t.warm=0;t.y=0;t.vy=0;t.rot.set(0,0,0);if(!world.bodies.includes(t.body)&&toggle.active)world.addBody(t.body);dirty.add(t);}
    },
    remaining(){return tiles.filter(t=>t.state==='solid').length;},
    spawnPoints(n){return Array.from({length:n},(_,i)=>{const a=i/n*Math.PI*2+.3,rad=R*size*.95;return {x:Math.sin(a)*rad,z:Math.cos(a)*rad,yaw:Math.atan2(Math.sin(a),Math.cos(a))};});},
    edgeDistance(x,z){return R*size*1.5-Math.hypot(x,z);},
    // Simulation step: the melt countdown and collision removal run on the fixed physics clock,
    // so a tile drops at the same moment whatever the frame rate (and in fast-forwarded tests).
    tick(dt){
      for(const t of tiles){
        if(t.state!=='warn')continue;
        t.timer-=dt;t.heat=.45+.55*Math.min(1,1-t.timer/t.warnTime);dirty.add(t);
        if(t.timer<=0){t.state='falling';t.vy=0;t.spin=(Math.random()-.5)*2;if(world.bodies.includes(t.body))world.removeBody(t.body);}
      }
    },
    // Visual step: glow pulse, falling plates and drifting motes.
    update(dt,time){
      coreMat.uniforms.time.value=time;
      for(let i=0;i<moteCount;i++){motes[i*3+1]+=speeds[i]*dt;if(motes[i*3+1]>14)motes[i*3+1]=-46;}
      moteGeometry.attributes.position.needsUpdate=true;
      for(const t of tiles){
        if(t.state==='falling'){t.vy-=24*dt;t.y+=t.vy*dt;t.rot.x+=t.spin*dt;t.rot.z+=t.spin*.7*dt;if(t.y<-50)t.state='gone';dirty.add(t);}
      }
      if(dirty.size){
        dirty.forEach(writeTile);dirty.clear();
        for(const mesh of [plates,rims,cracks])mesh.instanceMatrix.needsUpdate=true;
        plates.instanceColor.needsUpdate=true;rims.instanceColor.needsUpdate=true;
      }
    },
  };
  toggle.deactivate();toggle.activate();
  return venue;
}
