import * as THREE from 'three';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function canvasTexture(size,draw,repeat=1){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  draw(canvas.getContext('2d'),size);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.setScalar(repeat);return texture;
}

/**
 * A neon studio used for the car garage (turntable) and the post-match podium.
 * It sits at the origin; the active venue is hidden while the studio is shown.
 */
export function createStudio(scene){
  const group=new THREE.Group();group.name='STUDIO';group.visible=false;scene.add(group);
  const floorMap=canvasTexture(512,(ctx,s)=>{
    ctx.fillStyle='#0b0d18';ctx.fillRect(0,0,s,s);
    ctx.strokeStyle='rgba(90,120,200,.18)';ctx.lineWidth=2;
    for(let p=0;p<=s;p+=64){ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,s);ctx.moveTo(0,p);ctx.lineTo(s,p);ctx.stroke();}
    ctx.fillStyle='rgba(120,160,255,.08)';for(let i=0;i<3000;i++)ctx.fillRect(Math.random()*s,Math.random()*s,1,1);
  },10);
  const floor=new THREE.Mesh(new THREE.CircleGeometry(46,72),new THREE.MeshStandardMaterial({color:0xffffff,map:floorMap,roughness:.32,metalness:.55,envMapIntensity:.8}));
  floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;group.add(floor);
  const neon=(color,k=3)=>new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(k),toneMapped:false});
  const darkMetal=new THREE.MeshStandardMaterial({color:0x1a1f33,roughness:.28,metalness:.75});
  const satin=new THREE.MeshStandardMaterial({color:0x252b45,roughness:.5,metalness:.5});

  // Garage turntable.
  const turntable=new THREE.Group();group.add(turntable);
  const plate=new THREE.Mesh(new THREE.CylinderGeometry(3.3,3.5,.2,72),darkMetal);plate.position.y=.1;plate.receiveShadow=true;plate.castShadow=true;turntable.add(plate);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(3.36,.035,8,120),neon(0x2ef2ff,1.6));rim.rotation.x=Math.PI/2;rim.position.y=.2;turntable.add(rim);
  const inner=new THREE.Mesh(new THREE.TorusGeometry(2.6,.015,6,120),neon(0xff2fb4,1.3));inner.rotation.x=Math.PI/2;inner.position.y=.205;turntable.add(inner);

  // Podium.
  const podium=new THREE.Group();group.add(podium);
  const pedestals=[{x:0,h:1.45,label:'1',color:0xffd23a},{x:-4.2,h:.95,label:'2',color:0xc8d4ff},{x:4.2,h:.6,label:'3',color:0xff9a4a}];
  for(const p of pedestals){
    const block=new THREE.Mesh(new THREE.BoxGeometry(3.9,p.h,3.7),satin);block.position.set(p.x,p.h/2,0);block.castShadow=true;block.receiveShadow=true;podium.add(block);
    const strip=new THREE.Mesh(new THREE.BoxGeometry(3.92,.05,3.72),neon(p.color,1.5));strip.position.set(p.x,p.h,0);podium.add(strip);
    const label=canvasTexture(256,(ctx,s)=>{ctx.clearRect(0,0,s,s);ctx.fillStyle='#ffffff';ctx.font='700 190px Bahnschrift, "Segoe UI", Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.label,s/2,s/2+8);});
    label.wrapS=label.wrapT=THREE.ClampToEdgeWrapping;label.repeat.setScalar(1);
    const face=new THREE.Mesh(new THREE.PlaneGeometry(1.1,1.1),new THREE.MeshBasicMaterial({map:label,color:new THREE.Color(p.color).multiplyScalar(1.3),transparent:true,toneMapped:false}));
    face.position.set(p.x,Math.max(.36,p.h*.5),1.86);podium.add(face);
    p.top=p.h;
  }
  // Backdrop: an arc of light blades and a floating halo.
  const blades=new THREE.Group();group.add(blades);
  for(let i=-9;i<=9;i++){
    const a=i*.12,r=19,h=7+((i*7)%5+5)%5*1.3;
    const blade=new THREE.Mesh(new THREE.BoxGeometry(.14,h,.14),neon(i%2?0x2ef2ff:0xff2fb4,i%3?1.05:1.5));
    blade.position.set(Math.sin(a)*r,h/2+.2,-Math.cos(a)*r);blades.add(blade);
  }
  const halo=new THREE.Mesh(new THREE.TorusGeometry(6.5,.05,8,160),neon(0xffffff,1.25));halo.position.set(0,7.2,-3);halo.rotation.x=Math.PI/2.4;group.add(halo);
  const key=new THREE.PointLight(0xff4fc8,13,26,1.5);key.position.set(-7,5,4);group.add(key);
  const fill=new THREE.PointLight(0x3be8ff,14,26,1.5);fill.position.set(7,4.5,5);group.add(fill);
  const frontRim=new THREE.DirectionalLight(0xfff4e2,.58);frontRim.position.set(-5,7,9);group.add(frontRim);

  // Confetti for the winner.
  const confettiCount=260;
  const confetti=new THREE.InstancedMesh(new THREE.PlaneGeometry(.12,.22),new THREE.MeshBasicMaterial({side:THREE.DoubleSide,toneMapped:false}),confettiCount);
  confetti.frustumCulled=false;group.add(confetti);
  const bits=Array.from({length:confettiCount},()=>({x:0,y:-10,z:0,vx:0,vy:0,vz:0,r:0,s:0}));
  const palette=[0x2ef2ff,0xff2fb4,0xffe23a,0xb6ff2e,0xffffff].map(c=>new THREE.Color(c).multiplyScalar(1.6));
  bits.forEach((b,i)=>confetti.setColorAt(i,palette[i%palette.length]));
  const dummy=new THREE.Object3D();
  function burst(){for(const b of bits){b.x=(Math.random()-.5)*9;b.y=9+Math.random()*7;b.z=(Math.random()-.5)*5;b.vx=(Math.random()-.5)*1.5;b.vy=-1.2-Math.random()*1.8;b.vz=(Math.random()-.5)*1.5;b.r=Math.random()*6;b.s=4+Math.random()*7;}}

  let view=null,shown=[],spin=0,azimuth=2.45,elevation=.26,radius=6.2,drag=null,clock=0,autoSpin=true,weaponPulse=0;
  let framedCamera=null,stage=null,stageRect=null,stageObserver=null;
  function updateStageRect(){stageRect=stage?.getBoundingClientRect();}
  function frameGarage(camera){
    if(!stage){
      stage=document.querySelector('.garage-stage');
      if(stage){stageObserver=new ResizeObserver(updateStageRect);stageObserver.observe(stage);}
    }
    if(!stageRect?.width)updateStageRect();
    const w=innerWidth,h=innerHeight,r=stageRect;
    if(!r?.width||!r.height)return;
    const displayHeight=Math.min(r.height,r.width*.73);
    camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(22))*h/displayHeight));
    camera.setViewOffset(w,h,w/2-r.left-r.width/2,h/2-r.top-r.height/2,w,h);
    framedCamera=camera;
  }
  function resetFraming(){
    framedCamera?.clearViewOffset();framedCamera=null;stageRect=null;drag=null;
  }
  function place(car,x,y,z,yaw){const g=car.visual.group;g.visible=true;g.position.set(x,y+.62,z);g.rotation.set(0,yaw,0);g.quaternion.setFromEuler(g.rotation);}
  return {
    get view(){return view;},
    pulseWeapon(){weaponPulse=1;},
    showGarage(car){if(view==='garage'){shown=[car];return;}stageRect=null;view='garage';group.visible=true;turntable.visible=true;podium.visible=false;confetti.visible=false;shown=[car];autoSpin=true;azimuth=2.45;elevation=.25;radius=6.2;weaponPulse=.7;},
    showPodium(list){resetFraming();view='podium';group.visible=true;turntable.visible=false;podium.visible=true;confetti.visible=true;shown=list.filter(Boolean).slice(0,3);clock=0;burst();},
    hide(){resetFraming();view=null;group.visible=false;shown=[];},
    poseCar(car,dt){
      const g=car.visual.group,index=shown.indexOf(car);
      if(index<0){g.visible=false;return;}
      if(view==='garage'){place(car,0,.2,0,spin);}
      else{const p=pedestals[index];place(car,p.x,p.top,0,Math.PI+Math.sin(clock*.6+index)*.25);}
      const punchExt=view==='garage'?Math.sin(weaponPulse*Math.PI)*.72:0;
      car.visual.updatePunch(punchExt,0,0,0,clock,view==='garage');car.visual.setGlow(false);
      car.visual.updateState({steer:0,speed:0,throttle:0,brake:false,grounded:true,time:clock,active:true,inStudio:true},dt);
    },
    update(dt){
      if(!group.visible)return;clock+=dt;
      if(weaponPulse>0)weaponPulse=Math.max(0,weaponPulse-dt*2.1);
      if(view==='garage'&&autoSpin&&!drag)spin+=dt*.35;
      halo.rotation.z+=dt*.25;
      rim.material.color.setRGB(.1,1.45,1.6).multiplyScalar(.85+Math.sin(clock*2.2)*.15);
      if(view==='podium'){
        for(let i=0;i<confettiCount;i++){const b=bits[i];
          b.vy=Math.max(b.vy-dt*2.2,-2.6);b.x+=b.vx*dt+Math.sin(clock*3+i)*dt*.6;b.y+=b.vy*dt;b.z+=b.vz*dt;b.r+=dt*b.s;
          if(b.y<0&&clock<8){b.y=10+Math.random()*4;b.x=(Math.random()-.5)*10;b.z=(Math.random()-.5)*5;b.vy=-1;}
          dummy.position.set(b.x,b.y,b.z);dummy.rotation.set(b.r,b.r*.7,b.r*.3);dummy.updateMatrix();confetti.setMatrixAt(i,dummy.matrix);
        }
        confetti.instanceMatrix.needsUpdate=true;
      }
    },
    updateCamera(camera,dt){
      if(view==='garage'){
        camera.position.set(Math.sin(azimuth)*radius,1+Math.sin(elevation)*radius,Math.cos(azimuth)*radius);
        frameGarage(camera);
        camera.up.set(0,1,0);camera.lookAt(0,.78,0);
      }else{
        const a=Math.sin(clock*.18)*.36;
        camera.position.set(Math.sin(a)*13.6,3.75+Math.sin(clock*.3)*.25,Math.cos(a)*13.6);
        camera.up.set(0,1,0);camera.fov+=(42-camera.fov)*.2;camera.updateProjectionMatrix();camera.lookAt(0,1.55,0);
      }
    },
    pointerDown(e,element){if(view!=='garage'||e.button!==0||drag)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};autoSpin=false;element.setPointerCapture?.(e.pointerId);},
    pointerMove(e){if(!drag||e.pointerId!==drag.id)return;azimuth-=(e.clientX-drag.x)*.007;elevation=clamp(elevation+(e.clientY-drag.y)*.004,.04,.9);drag.x=e.clientX;drag.y=e.clientY;},
    pointerUp(){drag=null;},
    wheel(delta){radius=clamp(radius+delta*.004,3.8,10);},
  };
}
