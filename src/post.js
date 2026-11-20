import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';

/**
 * One finishing pass: lens fringe and speed streaks on the HDR image, then tone mapping and
 * sRGB output (three's chunks), then the display-space grade, vignette, hit flash and grain.
 */
const FinalShader={
  uniforms:{
    tDiffuse:{value:null},resolution:{value:new THREE.Vector2(1,1)},time:{value:0},
    vignette:{value:.38},aberration:{value:.0035},grain:{value:.028},saturation:{value:1.08},contrast:{value:1.05},
    lift:{value:new THREE.Color(0,0,0)},gain:{value:new THREE.Color(1,1,1)},
    speed:{value:0},flash:{value:0},flashColor:{value:new THREE.Color(1,.2,.25)},
  },
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`
    uniform sampler2D tDiffuse;uniform vec2 resolution;uniform float time,vignette,aberration,grain,saturation,contrast,speed,flash;
    uniform vec3 lift,gain,flashColor;varying vec2 vUv;
    float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    vec3 tap(vec2 uv){return texture2D(tDiffuse,uv).rgb;}
    float lum(vec3 c){c=c/(1.+c);return dot(c,vec3(.299,.587,.114));}
    void main(){
      vec2 c=vUv-.5;float r=length(c*vec2(resolution.x/resolution.y,1.)*.85);
      vec3 col=tap(vUv);
      #ifdef FXAA
      // FXAA-lite on the HDR image (luma from a cheap tonemap): smooths edges without a second pass.
      {vec2 px=1./resolution;
       float lM=lum(col),lNW=lum(tap(vUv+vec2(-1.,-1.)*px)),lNE=lum(tap(vUv+vec2(1.,-1.)*px)),lSW=lum(tap(vUv+vec2(-1.,1.)*px)),lSE=lum(tap(vUv+vec2(1.,1.)*px));
       float lMin=min(lM,min(min(lNW,lNE),min(lSW,lSE))),lMax=max(lM,max(max(lNW,lNE),max(lSW,lSE)));
       if(lMax-lMin>max(.04,lMax*.14)){
         vec2 dir=vec2(-((lNW+lNE)-(lSW+lSE)),(lNW+lSW)-(lNE+lSE));
         float reduce=max((lNW+lNE+lSW+lSE)*.03125,1./128.);
         dir=clamp(dir/(min(abs(dir.x),abs(dir.y))+reduce),-6.,6.)*px;
         vec3 a=.5*(tap(vUv+dir*(-1./6.))+tap(vUv+dir*(1./6.)));
         vec3 b=a*.5+.25*(tap(vUv-dir*.5)+tap(vUv+dir*.5));
         float lB=lum(b);col=(lB<lMin||lB>lMax)?a:b;}}
      #endif
      if(speed>.01){
        vec3 acc=col;float w=1.;
        for(int i=1;i<5;i++){float k=float(i)/4.;vec2 o=c*k*.05*speed;acc+=tap(vUv-o)*(1.-k*.5);w+=1.-k*.5;}
        col=mix(col,acc/w,smoothstep(.16,.58,r)*min(1.,speed*1.3));
      }
      gl_FragColor=vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      col=gl_FragColor.rgb;
      col=col*gain+lift*(1.-col);
      float l=dot(col,vec3(.2126,.7152,.0722));col=mix(vec3(l),col,saturation);
      col=(col-.5)*contrast+.5;
      col*=mix(1.,smoothstep(1.05,.18,r),vignette);
      col=mix(col,flashColor,flash*smoothstep(.2,.85,r));
      col+=(hash(vUv*resolution+fract(time)*97.)-.5)*grain;
      gl_FragColor=vec4(clamp(col,0.,1.),1.);
    }`,
};

const LOOKS={
  // Clarity first: tight, crisp daylight look with vibrant true colours and sharp shadows.
  day:{bloom:[.11,.18,1.02],vignette:.08,saturation:1.08,contrast:1.06,lift:[0,0,0],gain:[1.01,1.01,1.01],grain:.003,aberration:.0003},
  sunset:{bloom:[.18,.22,.96],vignette:.14,saturation:1.07,contrast:1.06,lift:[0,0,0],gain:[1.02,1,.98],grain:.004,aberration:.0004},
  night:{bloom:[.36,.24,.9],vignette:.2,saturation:1.06,contrast:1.08,lift:[0,0,0],gain:[1,1,1.02],grain:.005,aberration:.0005},
  space:{bloom:[.34,.24,.9],vignette:.2,saturation:1.05,contrast:1.07,lift:[0,0,0],gain:[.99,1,1.02],grain:.005,aberration:.0005},
  studio:{bloom:[.16,.2,.98],vignette:.16,saturation:1.06,contrast:1.06,lift:[0,0,0],gain:[1,1,1],grain:.003,aberration:.0003},
  ice:{bloom:[.14,.2,.98],vignette:.14,saturation:1.04,contrast:1.06,lift:[0,0,0],gain:[.99,1,1.02],grain:.003,aberration:.0003},
};

export function createPost(renderer,scene,camera,lighting){
  let level='',composer=null,bloom=null,grade=null,shadowFrame=0,look=LOOKS.day,lookId='day',dynamic=1,msaa=0;
  const qs=new URLSearchParams(location.search);if(qs.has('msaa'))msaa=Number(qs.get('msaa'))||0;
  const fx={speed:0,flash:0,flashColor:new THREE.Color(1,.2,.25)};
  const size=new THREE.Vector2();
  function dispose(){if(!composer)return;composer.renderTarget1.dispose();composer.renderTarget2.dispose();for(const pass of composer.passes)pass.dispose?.();composer=null;bloom=null;grade=null;}
  function build(){
    dispose();if(level==='low')return;
    renderer.getDrawingBufferSize(size);
    // High uses 4x MSAA; Medium uses the FXAA built into the final pass (MSAA costs ~10 ms on integrated GPUs).
    const target=new THREE.WebGLRenderTarget(size.x,size.y,{type:THREE.HalfFloatType,samples:level==='high'?4:msaa});
    composer=new EffectComposer(renderer,target);
    composer.addPass(new RenderPass(scene,camera));
    bloom=new UnrealBloomPass(new THREE.Vector2(size.x,size.y),.5,.5,.85);
    // Run the bloom chain at half its usual resolution; the glow is soft anyway.
    const bloomSetSize=bloom.setSize.bind(bloom),bloomScale=level==='high'?.75:.36;
    bloom.setSize=(w,h)=>bloomSetSize(Math.max(64,Math.round(w*bloomScale)),Math.max(64,Math.round(h*bloomScale)));
    composer.addPass(bloom);
    grade=new ShaderPass(FinalShader);if(level!=='high'||msaa>0&&level!=='high')grade.material.defines.FXAA=1;grade.material.needsUpdate=true;composer.addPass(grade);
    applyLook();resize();
  }
  function applyLook(){
    if(!bloom)return;
    const [strength,radius,threshold]=look.bloom;
    bloom.strength=strength*(level==='high'?1.12:1);bloom.radius=radius;bloom.threshold=Math.max(1.01,threshold);
    const u=grade.uniforms;
    u.vignette.value=look.vignette;u.saturation.value=look.saturation;u.contrast.value=look.contrast;
    u.lift.value.setRGB(...look.lift);u.gain.value.setRGB(...look.gain);u.grain.value=look.grain;u.aberration.value=look.aberration;
  }
  function resize(){
    // Native sharpness on high-DPI screens; the adaptive governor trims it only if frames drop.
    const cap=level==='low'?1:level==='medium'?1.5:2,target=Math.min(devicePixelRatio,cap);
    renderer.setPixelRatio(Math.max(1,Math.min(target,target*dynamic)));
    renderer.setSize(innerWidth,innerHeight);
    if(composer){
      composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(innerWidth,innerHeight);
      renderer.getDrawingBufferSize(size);grade.uniforms.resolution.value.copy(size);
    }
  }
  function set(value){
    const next=['low','medium','high'].includes(value)?value:'medium';
    if(next===level)return;
    level=next;renderer.shadowMap.enabled=level!=='low';
    renderer.shadowMap.autoUpdate=level==='high';renderer.shadowMap.needsUpdate=true;shadowFrame=0;
    lighting.sun.castShadow=level!=='low';
    const mapSize=level==='high'?2048:1024;
    if(lighting.sun.shadow.mapSize.x!==mapSize){lighting.sun.shadow.mapSize.set(mapSize,mapSize);lighting.sun.shadow.map?.dispose();lighting.sun.shadow.map=null;}
    build();resize();
  }
  function setLook(id){lookId=LOOKS[id]?id:'day';look=LOOKS[lookId];applyLook();}
  set('medium');
  return {
    set,resize,setLook,fx,
    /** Called every few seconds with the measured frame rate; returns true if the resolution changed. */
    adapt(fps){
      const cap=Math.min(devicePixelRatio,level==='low'?1:level==='medium'?1.5:2);if(cap<=1)return false;
      const before=dynamic;
      if(fps<46)dynamic=Math.max(1/cap,dynamic-.12);else if(fps>58)dynamic=Math.min(1,dynamic+.06);
      if(Math.abs(before-dynamic)<1e-3)return false;resize();return true;
    },
    get pixelRatio(){return renderer.getPixelRatio();},
    get level(){return level;},get look(){return lookId;},get bloom(){return !!bloom;},
    render(dt=1/60){
      if(level==='medium'&&shadowFrame++%3===0)renderer.shadowMap.needsUpdate=true;
      if(!composer){renderer.render(scene,camera);return;}
      const u=grade.uniforms;u.time.value+=dt;
      u.speed.value+=(fx.speed-u.speed.value)*(1-Math.exp(-dt*8));
      u.flash.value=fx.flash;u.flashColor.value.copy(fx.flashColor);
      composer.render(dt);
    },
  };
}
