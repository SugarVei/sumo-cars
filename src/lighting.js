import * as THREE from 'three';

// All sky and reflection data is made locally; no HDR files or image requests.
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: {
      zenith: {value:new THREE.Color(0x208bd8)},
      horizon: {value:new THREE.Color(0xb9e5fa)},
      ground: {value:new THREE.Color(0x173558)},
    },
    vertexShader: `varying vec3 vDirection;
      void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform vec3 zenith;uniform vec3 horizon;uniform vec3 ground;varying vec3 vDirection;
      void main(){float h=normalize(vDirection).y;
        vec3 sky=mix(horizon,zenith,smoothstep(-0.35,0.75,h));
        sky=mix(sky,ground,1.0-smoothstep(-0.65,-0.03,h));
        gl_FragColor=vec4(sky,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function haloTexture() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const context=canvas.getContext('2d');
  const g=context.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'rgba(255,249,222,1)');g.addColorStop(.11,'rgba(255,245,211,.8)');
  g.addColorStop(.3,'rgba(255,224,164,.19)');g.addColorStop(1,'rgba(255,220,160,0)');
  context.fillStyle=g;context.fillRect(0,0,128,128);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

export function createLighting(scene,renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  // Three r186+ folds soft filtering into PCFShadowMap; PCFSoftShadowMap is removed.
  renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  // Neutral tone mapping keeps colours and edges crisp; ACES at high exposure washed highlights out.
  renderer.toneMapping=THREE.NeutralToneMapping;
  renderer.toneMappingExposure=1;
  scene.background=new THREE.Color(0xb9e5fa);
  scene.fog=new THREE.Fog(0xb9e5fa,60,160);

  const direction=new THREE.Vector3(-25,44,15).normalize();
  const hemisphere=new THREE.HemisphereLight(0xc7e7ff,0x749b4c,.6);
  scene.add(hemisphere);
  const sun=new THREE.DirectionalLight(0xffefd6,2.5);
  sun.position.set(-25,44,15);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-40,right:40,top:40,bottom:-40,near:1,far:115});
  sun.shadow.radius=2.5;sun.shadow.normalBias=.025;sun.shadow.bias=-.00008;
  sun.shadow.intensity=1;
  scene.add(sun);
  const rim=new THREE.DirectionalLight(0xc4ddff,.32);
  rim.position.set(18,14,-30);scene.add(rim);

  const sky=new THREE.Mesh(new THREE.SphereGeometry(190,32,16),skyMaterial());
  sky.renderOrder=-100;sky.frustumCulled=false;scene.add(sky);
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:haloTexture(),color:0xffedc6,transparent:true,opacity:.85,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));
  glow.position.copy(direction).multiplyScalar(155);glow.scale.setScalar(36);scene.add(glow);
  const disc=new THREE.Mesh(new THREE.SphereGeometry(1.8,20,12),new THREE.MeshBasicMaterial({color:new THREE.Color(5,4.5,3.8),toneMapped:false,fog:false}));
  disc.position.copy(glow.position);scene.add(disc);

  const environment=new THREE.Scene();
  const envSky=new THREE.Mesh(new THREE.SphereGeometry(48,32,16),skyMaterial());
  environment.add(envSky);
  const envSun=new THREE.Mesh(new THREE.SphereGeometry(2.4,20,12),new THREE.MeshBasicMaterial({color:new THREE.Color(12,10,7),toneMapped:false}));
  envSun.position.copy(direction).multiplyScalar(40);environment.add(envSun);
  // Broad cloud reflections make the curved clearcoat readable without screen-space bloom.
  const cloudMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(2.2,2.4,2.55),toneMapped:false});
  for(const [x,y,z,sx,sy,sz] of [[-18,20,-22,13,2.5,6],[24,12,8,8,2,12],[-8,9,30,12,1.8,5],[5,29,23,7,.8,2]]){
    const cloud=new THREE.Mesh(new THREE.SphereGeometry(1,20,10),cloudMaterial);cloud.position.set(x,y,z);cloud.scale.set(sx,sy,sz);environment.add(cloud);
  }
  const pmrem=new THREE.PMREMGenerator(renderer);
  const envTarget=pmrem.fromScene(environment,.035,.1,100);
  scene.environment=envTarget.texture;scene.environmentIntensity=.6;
  const environments=new Map([['meadow',envTarget]]);
  // Neon reflection panels only exist in the reflection scene, never in the visible world.
  const neonPanels=new THREE.Group();neonPanels.visible=false;environment.add(neonPanels);
  for(const [x,y,z,w,h,color] of [[-30,6,-20,26,1.2,0x2ef2ff],[28,9,-14,22,1,0xff2fb4],[0,4,34,40,.9,0x7a5cff],[-22,14,24,14,.7,0xff2fb4],[24,3,26,18,.8,0x2ef2ff],[0,22,-30,30,1.4,0xffe0a8]]){
    const panel=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(1.7),toneMapped:false,side:THREE.DoubleSide}));
    panel.position.set(x,y,z);panel.lookAt(0,0,0);neonPanels.add(panel);
  }
  let activeTheme='meadow';
  /** config: {zenith,horizon,ground,sunColor,sunIntensity,ambientIntensity,night (0-1),fogNear,fogFar,sunDirection,showSun} */
  function setTheme(config={},id='meadow'){
    const colors={zenith:config.zenith??0x208bd8,horizon:config.horizon??0xb9e5fa,ground:config.ground??0x173558};
    for(const [name,value] of Object.entries(colors)){sky.material.uniforms[name].value.set(value);envSky.material.uniforms[name].value.set(value);}
    scene.background.set(colors.horizon);scene.fog.color.set(config.fogColor??colors.horizon);
    scene.fog.near=config.fogNear??90;scene.fog.far=config.fogFar??240;
    hemisphere.color.set(config.zenith??0xc7e7ff).lerp(new THREE.Color(0xe2f0ff),.7);
    hemisphere.groundColor.set(colors.ground).lerp(new THREE.Color(0xb2b8ba),.35);
    hemisphere.intensity=config.ambientIntensity??.6;
    sun.color.set(config.sunColor??0xffefd6);sun.intensity=config.sunIntensity??2.5;
    const dir=config.sunDirection?new THREE.Vector3(...config.sunDirection).normalize():direction;
    sun.position.copy(sun.target.position).addScaledVector(dir,52);glow.position.copy(dir).multiplyScalar(155);disc.position.copy(glow.position);
    const night=config.night??((id==='neon'||id==='orbital'||id==='glacier')?.8:0);
    const showSun=config.showSun??night<.5;
    glow.visible=showSun;disc.visible=showSun;rim.color.set(night>.5?0xabbcff:0xc4ddff);rim.intensity=night>.5?.6:.32;
    if(activeTheme!==id&&!environments.has(id)){
      envSun.material.color.set(config.sunColor??0xffefd6).multiplyScalar(night>.5?2:10);
      envSun.position.copy(dir).multiplyScalar(40);
      neonPanels.visible=night>.5;
      environments.set(id,pmrem.fromScene(environment,.035,.1,100));
      neonPanels.visible=false;envSun.position.copy(direction).multiplyScalar(40);
    }
    scene.environment=environments.get(id).texture;scene.environmentIntensity=config.envIntensity??(night>.5?.8:.65);activeTheme=id;
  }
  // Sky dome and sun sprite ride with the camera so large tracks never reach the dome.
  const sunOffset=new THREE.Vector3();
  function follow(camera){
    sky.position.copy(camera.position);
    sunOffset.copy(glow.position).sub(disc.position);
    const dir=sun.position.clone().normalize();
    glow.position.copy(camera.position).addScaledVector(dir,155);disc.position.copy(glow.position);
  }
  scene.add(sun.target);
  const sunDirection=new THREE.Vector3();
  /** Keep the shadow frustum centred on the action (tracks are larger than the shadow box). */
  function focus(x,y,z,snap=8){
    sunDirection.copy(sun.position).sub(sun.target.position).normalize();
    // Snap the frustum to a coarse grid to avoid shadow swimming.
    const fx=Math.round(x/snap)*snap,fz=Math.round(z/snap)*snap;
    sun.target.position.set(fx,y,fz);sun.position.copy(sun.target.position).addScaledVector(sunDirection,52);
  }
  return {sun,hemisphere,environment:envTarget,setTheme,sky,follow,focus};
}
