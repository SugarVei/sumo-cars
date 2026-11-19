import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {createCars,configureCar,placeCar,setGhost,recover,startPunch,driveCar,processContacts,resetContacts,addNitro,useNitro,NITRO,CAR_CLASSES,GLOVES,PAINTS,ROSTER,PROFILES} from './cars.js';
import {createVenues} from './venues.js';
import {buildTrackVenue,TRACKS} from './tracks.js';
import {buildHexVenue,HEX_VENUES} from './hexarena.js';
import {MAPS} from './maps.js';
import {createUI} from './ui.js';
import {createLighting} from './lighting.js';
import {createEffects} from './effects.js';
import {Sound} from './sound.js';
import {createPost} from './post.js';
import {createTrails} from './trails.js';
import {createStudio} from './studio.js';
import {createLocalControls,createLocalCameras} from './local-play.js';
import {matchAccolade} from './accolades.js';
import {createContactShadows} from './contact-shadows.js';
import {MODE_INFO,createMode} from './modes/index.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const DT=1/60;
export const GAME_TITLE='PUNCH DRIVE';

// ---------------------------------------------------------------- renderer
const scene=new THREE.Scene();
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}
catch(error){document.body.innerHTML=`<main style="padding:10%;font:24px sans-serif;color:#fff">${GAME_TITLE}<br><br>WebGL is unavailable. Please open this file in Chrome or Edge with hardware acceleration enabled.</main>`;throw error;}
renderer.setSize(innerWidth,innerHeight);
const lighting=createLighting(scene,renderer);
renderer.domElement.id='game-canvas';
document.body.append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.15,520);
const post=createPost(renderer,scene,camera,lighting);

// ---------------------------------------------------------------- physics
const world=new CANNON.World({gravity:new CANNON.Vec3(0,-22,0)});
world.broadphase=new CANNON.SAPBroadphase(world);
world.solver.iterations=14;world.allowSleep=true;
const groundMaterial=new CANNON.Material('ground'),carMaterial=new CANNON.Material('car');
world.defaultContactMaterial.friction=.25;world.defaultContactMaterial.restitution=.08;
world.addContactMaterial(new CANNON.ContactMaterial(groundMaterial,carMaterial,{friction:0,restitution:.02}));
world.addContactMaterial(new CANNON.ContactMaterial(carMaterial,carMaterial,{friction:.06,restitution:.24}));
const venues=createVenues(scene,world,groundMaterial,{track:buildTrackVenue,hex:buildHexVenue});
const studio=createStudio(scene);

// ---------------------------------------------------------------- cars & systems
const cars=createCars(world,scene,carMaterial);
const carsByBody=new Map(cars.map(car=>[car.body.id,car]));
const effects=createEffects(scene),trails=createTrails(scene),sound=new Sound();
const keys=new Set();
const punchInputs=[new Set(),new Set()];
const duo=()=>!demo && options.players===2;
const isHuman=car=>!demo && (car.id===0 || (duo() && car.id===1));
function holdInput(id,source,pressed,cancel=false){
  const held=punchInputs[id];
  if(pressed){
    if(!held.has(source) && !held.size && !beginPunchHold(cars[id]))return;
    held.add(source);
  }else if(held.delete(source) && !held.size){
    if(cancel)cancelPunchHold(cars[id]);else releasePunchHold(cars[id]);
  }
}
function fireItem(id){if(state==='playing' && !mode?.locked && cars[id].active)mode?.useItem?.(cars[id]);}
function fireNitro(id){if(state==='playing' && !mode?.locked && cars[id].active)useNitro(cars[id],env);}
const localControls=createLocalControls({
  press:id=>holdInput(id,'pad',true),release:id=>holdInput(id,'pad',false),cancel:id=>holdInput(id,'pad',false,true),
  item:fireItem,nitro:fireNitro,
});
function clearInput(){
  keys.clear();localControls.clear();
  for(let id=0;id<punchInputs.length;id++){punchInputs[id].clear();cancelPunchHold(cars[id]);}
}
const localCameras=createLocalCameras(renderer,scene,camera);
const contactShadows=createContactShadows(scene,cars);
let perfWarmup=2;

let state='menu',mode=null,demo=true,simTime=0,accumulator=0,lastFrame=performance.now(),uiClock=0,menuClock=0;
let hitStopLeft=0,slowLeft=0,shake=0,fovKick=0,muted=false,demoRestart=0,recoverCooldown=0,cameraCut=0;
let options={mode:'race',venue:'neon',classId:'rumbler',paint:'arctic',difficulty:'normal',quality:'medium',music:true,laps:3,format:'classic',rounds:3,crownTarget:60};
let previewKey='',autopilot=false,perfClock=0,perfFrames=0,lowStreak=0;
const shakeDir=new THREE.Vector3(1,0,0);
const tour={active:false,events:[],index:0,points:Array(6).fill(0),history:[]};
let lookKeys=new Map();

function newRecord(){return {punches:0,punchHits:0,kos:0,falls:0,streak:0,maxStreak:0,victims:{},killers:{},roundKos:Array(8).fill(0),bestLap:null,overtakes:0,crownTime:0,steals:0,edgeSeconds:0};}

const env={world,cars,simTime:0,grip:1,speedScale:1,airControl:false,props:[],punchScale:1,cooldown:2.5,hooks:{
  landing:(car,strength)=>{if(!demo)sound.landing(strength,pan(car.body.position));},
  skid:car=>effects.skid(car),
  nitroReady:car=>{if(car.isPlayer&&!demo){sound.tone(880,.12,'triangle',.06,1320);ui.nitroReady?.(car.nitroTanks);}},
  nitroFire:car=>{effects.nitroBurst?.(car);if(!demo&&car.isPlayer){sound.boost?.();fovKick=Math.max(fovKick,7);shake=Math.max(shake,.12);}},
  punchHit:(a,t,powered,shielded)=>onPunchHit(a,t,powered,shielded),
  propHit:(car,prop)=>{effects.impact(prop.body.position,.75);if(!demo)sound.collision(.5,pan(prop.body.position));},
  collision:(a,b,closing,d)=>onCollision(a,b,closing,d),
  shove:(a,b,strength)=>mode?.onShove?.(a,b,strength),
}};

const ctx={
  scene,world,camera,cars,effects,sound,trails,post,lighting,profiles:PROFILES,env,isHuman,
  get venue(){return venues.current;},get simTime(){return simTime;},get demo(){return demo;},get options(){return options;},get keys(){return keys;},
  get autopilot(){return autopilot;},
  ui:null,
  placeCar:(car,x,z,yaw,y=.7,shield=1.2)=>{placeCar(car,x,z,yaw,y,simTime,shield);trails.reset(car);},
  setGhost,recover,
  punch:car=>rivalPunch(car),
  nitro:car=>(!mode||mode.locked)?false:useNitro(car,env),
  fall:car=>fall(car),
  hitStop:s=>{if(!demo)hitStopLeft=Math.max(hitStopLeft,s);},
  slowMo:s=>{if(!demo)slowLeft=Math.max(slowLeft,s);},
  shake:(amount,dir)=>{if(demo)return;shake=Math.max(shake,amount);if(dir)shakeDir.copy(dir);},
  fovKick:deg=>{if(!demo)fovKick=Math.max(fovKick,deg);},
  announce:(...args)=>{if(!demo)ui.announce(...args);},
  feed:message=>{if(!demo)ui.feed(message);},
  countdown:value=>{if(!demo)ui.countdown(value);if(!demo&&value!=null)sound.countdown(value);},
  finish:results=>finishMatch(results),
  cut:()=>{cameraCut=1;},
  newRecord,
};

const ui=createUI({
  title:GAME_TITLE,modes:MODE_INFO,tracks:TRACKS,arenas:MAPS,hexes:HEX_VENUES,classes:CAR_CLASSES,gloves:GLOVES,paints:PAINTS,roster:ROSTER,
  preview:selection=>preview(selection),
  garage:on=>setGarage(on),
  configure:look=>{options={...options,...look};configurePlayer();},
  start:settings=>startMatch(settings),
  restart:()=>restartMatch(),
  resume:()=>resume(),pause:()=>pause(),
  menu:()=>showMenu(),
  next:()=>nextTourEvent(),
  settings:settings=>applySettings(settings),
  punch:()=>{if(state==='playing'&&!demo)doPunch(cars[0]);},
  punchStart:()=>holdInput(0,'touch',true),
  punchRelease:()=>holdInput(0,'touch',false),
  punchCancel:()=>holdInput(0,'touch',false,true),
  item:()=>{if(state==='playing'&&!demo)mode?.useItem?.(cars[0]);},
  nitro:()=>{if(state==='playing'&&!demo&&!mode?.locked)useNitro(cars[0],env);},
  control:(key,pressed)=>pressed?keys.add(key):keys.delete(key),
  mute:()=>{muted=!muted;ui.setSound(muted);sound.setMuted(muted);},
  fullscreen:async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{ui.announce('无法进入全屏','请使用浏览器的全屏快捷键（F11）',2);}},
});
ctx.ui=ui;

// ---------------------------------------------------------------- car looks
function configureCars(){
  for(const car of cars){
    const entry=ROSTER[car.id];
    const look=car.isPlayer?{classId:options.classId,paint:options.paint}:{classId:entry.classId};
    const key=JSON.stringify(look);
    if(lookKeys.get(car.id)!==key||!car.visual){configureCar(car,scene,look);lookKeys.set(car.id,key);trails.reset(car);}
    car.glove=(car.isPlayer||isHuman(car))&&Object.hasOwn(GLOVES,options.glove)?options.glove:'spring';
    car.visual.setGlove(car.glove);
    car.visual.setNight(venues.current.descriptor.night||0);
  }
}
function configurePlayer(){
  const car=cars[0],look={classId:options.classId,paint:options.paint},key=JSON.stringify(look);
  const prevGlove=car.glove;
  if(lookKeys.get(0)!==key){configureCar(car,scene,look);lookKeys.set(0,key);car.visual.setNight(state==='garage'?.4:venues.current.descriptor.night||0);}
  car.glove=Object.hasOwn(GLOVES,options.glove)?options.glove:'spring';car.visual.setGlove(car.glove);
  if(state==='garage'){studio.showGarage(car);if(prevGlove!==car.glove)studio.pulseWeapon();}
}

function applyVenueLook(venue){
  const d=venue.descriptor;
  lighting.setTheme({...d.sky,night:d.night??0},`${venue.type}:${d.id}`);
  post.setLook(d.look||'day');
  for(const car of cars)car.visual?.setNight(d.night||0);
}

// ---------------------------------------------------------------- match lifecycle
function launch(modeId,settings,isDemo){
  mode?.stop?.();mode=null;
  demo=isDemo;simTime=0;accumulator=0;hitStopLeft=0;slowLeft=0;shake=0;fovKick=0;demoRestart=0;recoverCooldown=0;clearInput();
  cars[1].name=duo()?'二号车手':ROSTER[1].name;
  localCameras.reset();perfClock=0;perfFrames=0;lowStreak=0;perfWarmup=2;
  effects.reset();trails.clear();resetContacts();studio.hide();post.fx.speed=0;post.fx.flash=0;
  const next=createMode(modeId,ctx,settings);
  const venue=venues.set(next.venue.type,next.venue.id);
  venue.setVisible?.(true);venue.group&&(venue.group.visible=true);
  configureCars();applyVenueLook(venue);
  env.grip=venue.descriptor.grip||1;env.speedScale=next.speedScale||1;env.airControl=!!next.airControl;env.props=venue.dynamicProps||[];env.punchScale=next.punchScale||1;env.punchStyle=next.punchStyle||'push';env.cooldown=next.cooldown??2;
  for(const car of cars){car.score=0;car.record=newRecord();car.mode={};car.speedMul=1;car.effect=null;car.effectEnd=0;car.padBoostEnd=0;car.revenge=null;car.lastKO=-99;car.combo=0;car.nitro=0;car.nitroTanks=0;car.nitroEnd=0;car.nitroOn=false;}
  for(const car of cars)car.stagger=0;
  mode=next;mode.start();
  cameraCut=1;resetCamera();
}

function startMatch(settings={}){
  options={...options,...settings};
  post.set(options.quality);sound.init();sound.setMusic(options.music);sound.setMuted(muted);
  if(options.mode==='tour'){startTour();return;}
  tour.active=false;
  beginEvent(options.mode,options);
}
function beginEvent(modeId,settings){
  launch(modeId,settings,false);
  state='playing';ui.showScreen('playing',{mode:modeId,info:MODE_INFO[modeId],venue:venues.current.descriptor,duo:duo(),tour:tour.active?tourSummary():null});
  sound.setStyle?.(mode.music||modeId);
  lastFrame=performance.now();
}
function restartMatch(){
  if(tour.active){const event=tour.events[tour.index];beginEvent(event.mode,{...options,...event});return;}
  beginEvent(options.mode,options);
}
function preview(selection={}){
  if(!['menu','setup','garage'].includes(state))return;
  const modeId=selection.mode==='tour'||!selection.mode?'race':selection.mode;
  const venue=selection.venue||MODE_INFO[modeId]?.defaultVenue;
  const key=modeId+':'+venue;
  if(state==='garage')setGarage(false);
  if(key===previewKey&&mode)return;
  previewKey=key;
  launch(modeId,{...options,mode:modeId,venue,difficulty:'normal',laps:99,format:'classic',rounds:99,crownTarget:999,demoLoop:true},true);
}
function showMenu(){
  tour.active=false;state='menu';demo=true;keys.clear();
  ui.showScreen('menu');
  previewKey='';preview({mode:'race',venue:'neon'});
  sound.update({playing:false,speed:0},0);
}
function setGarage(on){
  if(on){state='garage';configurePlayer();venues.current.group&&(venues.current.group.visible=false);venues.current.setVisible?.(false);studio.showGarage(cars[0]);for(const car of cars)if(car.id)car.visual.group.visible=false;
    lighting.setTheme({zenith:0x0b0d1e,horizon:0x1b1736,ground:0x05060c,sunColor:0xdfe8ff,sunIntensity:2.2,ambientIntensity:.55,night:.9,fogNear:40,fogFar:140,showSun:false},'studio');post.setLook('studio');cars[0].visual.setNight(.6);}
  else if(state==='garage'){state='setup';studio.hide();const venue=venues.current;venue.group&&(venue.group.visible=true);venue.setVisible?.(true);applyVenueLook(venue);for(const car of cars)car.visual.group.visible=car.active;}
}
function pause(){if(state!=='playing')return;state='paused';clearInput();ui.showScreen('paused',{tour:tour.active});sound.update({playing:false,speed:0},0);}
function resume(){if(state!=='paused')return;state='playing';keys.clear();accumulator=0;lastFrame=performance.now();sound.init();ui.showScreen('playing',{resume:true});}
function applySettings(settings){options={...options,...settings};if(settings.quality)post.set(settings.quality);if('music' in settings)sound.setMusic(settings.music);sound.setLevels(settings);}

function finishMatch(results){
  if(demo){demoRestart=2.2;return;}
  state='results';clearInput();
  for(const car of cars)car.throttle=0;
  const mostKOs=Math.max(...cars.map(c=>c.record.kos));
  results.standings.forEach((row,i)=>{
    const car=cars[row.id];
    if(i<3||isHuman(car))row.accolade=matchAccolade(car,i+1,mode.id,mostKOs);
  });
  const podiumCars=(results.podium||results.standings.slice(0,3).map(s=>s.id)).map(id=>cars[id]);
  let tourInfo=null;
  if(tour.active){
    const award=[10,7,5,3,2,1];
    results.standings.forEach((row,index)=>{tour.points[row.id]+=award[index]||0;row.tourPoints=award[index]||0;});
    tour.history.push({mode:mode.id,venue:venues.current.descriptor.title,order:results.standings.map(s=>s.id)});
    tourInfo=tourSummary();tourInfo.finished=tour.index>=tour.events.length-1;
  }
  const venue=venues.current;venue.group&&(venue.group.visible=false);venue.setVisible?.(false);
  for(const car of cars)car.visual.group.visible=false;
  const finalTour=tourInfo?.finished;
  studio.showPodium(finalTour?tourInfo.standings.slice(0,3).map(s=>cars[s.id]):podiumCars);
  lighting.setTheme({zenith:0x0b0d1e,horizon:0x1b1736,ground:0x05060c,sunColor:0xdfe8ff,sunIntensity:2.2,ambientIntensity:.55,night:.9,fogNear:40,fogFar:140,showSun:false},'studio');post.setLook('studio');
  for(const car of cars)car.visual.setNight(.7);
  ui.showScreen('results',{...results,mode:mode.id,info:MODE_INFO[mode.id],tour:tourInfo});
  sound.fanfare?.(results.standings[0]?.id===0);
}

// ---------------------------------------------------------------- party tour
function startTour(){
  const arenas=['neon','mesa','glacier','sakura','orbital','meadow'];
  const pick=()=>arenas.splice(Math.floor(Math.random()*arenas.length),1)[0];
  tour.active=true;tour.index=0;tour.points=Array(6).fill(0);tour.history=[];
  tour.events=[
    {mode:'race',venue:'neon',laps:2},
    {mode:'sumo',venue:pick(),format:'quick'},
    {mode:'crown',venue:pick(),crownTarget:45},
    {mode:'meltdown',venue:'core',rounds:2},
    {mode:'race',venue:'canyon',laps:2},
  ];
  const event=tour.events[0];beginEvent(event.mode,{...options,...event});
}
function nextTourEvent(){
  if(!tour.active)return;
  if(tour.index>=tour.events.length-1){showMenu();return;}
  tour.index++;const event=tour.events[tour.index];beginEvent(event.mode,{...options,...event});
}
function tourSummary(){
  const standings=cars.map(car=>({id:car.id,name:car.name,color:car.color,points:tour.points[car.id],player:car.isPlayer})).sort((a,b)=>b.points-a.points||a.id-b.id);
  return {index:tour.index,total:tour.events.length,events:tour.events.map(e=>({mode:e.mode,name:MODE_INFO[e.mode].name,venue:e.venue})),standings,history:tour.history};
}

// ---------------------------------------------------------------- combat hooks
function punchReady(car){
  return mode&&!mode.locked&&car.active&&car.cooldown<=0&&(!mode.canPunch||mode.canPunch(car));
}
function beginPunchHold(car){
  if(state!=='playing'||demo||!punchReady(car)||car.punchHeldAt!==null)return false;
  car.punchHeldAt=simTime;
  return true;
}
function cancelPunchHold(car){car.punchHeldAt=null;}
function rivalPunch(car){
  if(!punchReady(car)||car.punchHeldAt!==null)return false;
  // A stationary brawler winds up in a clinch. Rivals telegraph and can miss just like human drivers.
  if(mode.id!=='race'&&car.target?.active&&Math.abs(car.speed)<2&&car.body.position.distanceTo(car.target.body.position)<4.4){
    car.punchHeldAt=simTime;
    return true;
  }
  return doPunch(car);
}
function releasePunchHold(car){
  if(car.punchHeldAt===null)return false;
  const charge=clamp(simTime-car.punchHeldAt,0,1);
  cancelPunchHold(car);
  return state==='playing'&&!demo&&doPunch(car,charge);
}
function doPunch(car,charge=0){
  if(!punchReady(car)||!startPunch(car,simTime,env,charge,mode.cooldownMultiplier?.(car)??1))return false;
  effects.punchBurst(car);
  if(!demo){
    car.record.punches++;
    if(ctx.isHuman(car)){
      sound.tone(car.punchHeavy?135:200,.105,'triangle',.085,car.punchHeavy?480:660);
      sound.tone(car.punchHeavy?470:650,.21,'sine',.045,125);
    }
  }
  if(car.glove==='hammer')mode.onHammer?.(car);
  mode.onPunch?.(car);
  return true;
}
function onPunchHit(attacker,target,powered,shielded){
  const a=attacker.body.position,b=target.body.position;
  const dx=b.x-a.x,dz=b.z-a.z,distance=Math.hypot(dx,dz)||1;
  const contact={x:b.x-dx/distance*.85,y:b.y+.15,z:b.z-dz/distance*.85};
  effects.impact(contact,shielded?.6:powered?1.45:1);
  if(demo){mode?.onPunchHit?.(attacker,target,powered,shielded);return;}
  sound.hit(powered?1.6:1,pan(target.body.position));
  if(!attacker.punchConnected){attacker.punchConnected=true;attacker.record.punchHits++;}
  if(ctx.isHuman(attacker)||ctx.isHuman(target)){
    hitStopLeft=Math.max(.045,hitStopLeft);fovKick=powered?6:3;shake=powered?.48:.28;shakeDir.set(dx/distance,.15,dz/distance);
    if(ctx.isHuman(target)){post.fx.flash=.48;post.fx.flashColor.set(1,.18,.25);}
  }
  mode?.onPunchHit?.(attacker,target,powered,shielded);
}
function onCollision(a,b,closing,d){
  const p={x:(a.body.position.x+b.body.position.x)*.5,y:(a.body.position.y+b.body.position.y)*.5,z:(a.body.position.z+b.body.position.z)*.5};
  effects.collision(p,clamp(closing/15,.2,1.4));
  if(!demo){
    sound.collision(clamp(closing/15,.2,1.4),pan(p));
    if(ctx.isHuman(a)||ctx.isHuman(b)){
      shake=Math.max(shake,clamp(closing/50,.08,.35));shakeDir.set(d.x,.25,d.z);
      if(closing>30/3.6)hitStopLeft=Math.max(.045,hitStopLeft);
      if(closing>13&&a.forward.dot(b.forward)<-.55)ui.announce('正面对撞！','',.7,'small');
    }
  }
  mode?.onCollision?.(a,b,closing,d);
}
function fall(car){
  if(!car.active)return;
  car.active=false;car.respawnAt=0;
  car.body.collisionResponse=false;car.body.collisionFilterMask=0;car.body.wakeUp();car.drifting=false;car.driftCharge=0;
  cancelPunchHold(car);
  car.rocket=null;
  effects.fall(car.body.position,car.color);
  if(car.isPlayer&&!demo){sound.fall();slowLeft=Math.max(slowLeft,.4);}
  mode.onFall(car);
}
function pan(position){const offset=new THREE.Vector3(position.x,position.y,position.z).project(camera);return clamp(offset.x,-1,1);}

// ---------------------------------------------------------------- simulation
function readInput(car){localControls.read(car,keys,duo());}
function fixedUpdate(dt){
  if(!mode)return;
  const running=state==='playing'||(demo&&['menu','setup'].includes(state));
  if(!running)return;
  if(demoRestart>0){demoRestart-=dt;if(demoRestart<=0){const id=mode.id,settings=mode.settings;launch(id,settings,true);}return;}
  mode.clock?.(dt);
  const frozen=hitStopLeft>0;hitStopLeft=Math.max(0,hitStopLeft-dt);
  const scale=frozen?.05:slowLeft>0?.25:1;slowLeft=Math.max(0,slowLeft-dt);
  recoverCooldown=Math.max(0,recoverCooldown-dt);
  const pdt=dt*scale;
  if(pdt<=0)return;
  simTime+=pdt;env.simTime=simTime;
  const locked=mode.locked;
  for(const car of cars){
    if(!car.active){if(car.respawnAt>0&&simTime>=car.respawnAt){car.respawnAt=0;mode.respawn(car);}else if(car.body.position.y<-70&&car.body.sleepState!==2)car.body.sleep();continue;}
    if(isHuman(car)&&!autopilot){readInput(car);if(locked){mode.onLockedInput?.(car);car.throttle=0;car.steer=0;car.brake=true;car.driftInput=false;}}
    else if(locked){car.throttle=0;car.steer=0;car.brake=true;car.driftInput=false;}
    else{mode.control(car,pdt);
      // Rivals bank a trickle of nitro on top of whatever they earn by drifting.
      if(!locked)addNitro(car,pdt*(demo?.05:{easy:.022,normal:.038,hard:.055}[options.difficulty]??.038),env);}
    if(locked)cancelPunchHold(car);
    else if((!isHuman(car)||autopilot)&&car.punchHeldAt!==null&&simTime-car.punchHeldAt>=.85){
      const charge=Math.min(1,simTime-car.punchHeldAt);
      cancelPunchHold(car);doPunch(car,charge);
    }
    driveCar(car,pdt,env);
  }
  world.step(pdt);
  if(!demo&&!locked&&venues.current.type==='arena'){
    for(const car of cars){
      if(!car.active||!car.grounded||Math.abs(car.speed)<1)continue;
      const p=car.body.position,distance=venues.current.edgeDistance(p.x,p.z);
      if(distance>=0&&distance<=2)car.record.edgeSeconds+=pdt;
    }
  }
  processContacts(world,carsByBody,env);
  for(const car of cars)if(car.active&&car.body.position.y<mode.fallY(car))fall(car);
  venues.current.tick?.(pdt);
  mode.update(pdt);
  effects.update(pdt,cars,true);
}

// ---------------------------------------------------------------- camera
const cameraTarget=new THREE.Vector3(),cameraPosition=new THREE.Vector3(),tmpV=new THREE.Vector3(),tmpUp=new THREE.Vector3();
let cinematic={car:0,until:0,angle:0,style:0};
function resetCamera(){
  const focus=mode?.cameraFocus?.()||cars[0];const p=focus.body.position,f=focus.forward,fl=Math.hypot(f.x,f.z)||1,cfg=mode?.camera||{};
  camera.position.set(p.x-f.x/fl*(cfg.distance??8.5),p.y+(cfg.height??5.2),p.z-f.z/fl*(cfg.distance??8.5));
  cameraTarget.set(p.x+f.x*3,p.y+1,p.z+f.z*3);camera.up.set(0,1,0);camera.fov=cfg.fov??58;camera.updateProjectionMatrix();camera.lookAt(cameraTarget);
}
function chase(car,dt,cfg){
  const b=car.body,f=car.forward,fl=Math.hypot(f.x,f.z)||1;
  const speed=Math.abs(car.speed);
  const distance=(cfg.distance??8.5)+clamp(speed/30,0,1)*(cfg.speedPull??0);
  const nearby=cfg.crowdLift!==false&&cars.some(c=>c!==car&&c.active&&c.body.position.distanceSquared(b.position)<22);
  cameraPosition.set(b.position.x-f.x/fl*distance,b.position.y+(cfg.height??5.2)+(nearby?1.6:0),b.position.z-f.z/fl*distance);
  cameraPosition.y=Math.max(b.position.y+1.6,cameraPosition.y);
  const k=cameraCut?1:1-Math.exp(-dt*(cfg.follow??4.5));
  camera.position.lerp(cameraPosition,k);
  tmpV.set(b.position.x+f.x/fl*(cfg.look??3),b.position.y+.8,b.position.z+f.z/fl*(cfg.look??3));
  cameraTarget.lerp(tmpV,cameraCut?1:1-Math.exp(-dt*8));
  tmpUp.set(car.up.x*.26,1,car.up.z*.26).normalize();camera.up.lerp(tmpUp,1-Math.exp(-dt*3));
}
function updateCamera(dt){
  const cfg=mode?.camera||{};
  if(state==='garage'||state==='results'){studio.updateCamera(camera,dt);cameraCut=0;return;}
  if(demo&&mode){
    menuClock+=dt;
    if(mode.demoCamera?.(camera,cameraTarget,dt,menuClock)){cameraCut=0;return;}
    // TV-style chase of a rotating subject.
    if(menuClock>cinematic.until||!cars[cinematic.car].active){cinematic.car=(mode.demoSubject?.()??Math.floor(Math.random()*6));cinematic.until=menuClock+6+Math.random()*3;cinematic.style=(cinematic.style+1)%3;cameraCut=1;}
    const car=cars[cinematic.car];
    if(car.active){
      const b=car.body.position,f=car.forward,fl=Math.hypot(f.x,f.z)||1,side=cinematic.style===1?1:cinematic.style===2?-1:0;
      cameraPosition.set(b.x-f.x/fl*7+(-f.z/fl)*side*5,b.y+2.4+(cinematic.style===0?1.2:0),b.z-f.z/fl*7+(f.x/fl)*side*5);
      camera.position.lerp(cameraPosition,cameraCut?1:1-Math.exp(-dt*2.6));
      cameraTarget.lerp(tmpV.set(b.x+f.x*4,b.y+.6,b.z+f.z*4),cameraCut?1:1-Math.exp(-dt*5));
      camera.up.set(0,1,0);camera.fov+=(52-camera.fov)*.1;camera.updateProjectionMatrix();camera.lookAt(cameraTarget);
    }
    cameraCut=0;return;
  }
  if(state==='paused')return;
  if(duo() && mode.id!=='race'){localCameras.shared(cars,dt,cameraCut,mode.cameraFocus?.()||cars[0]);cameraCut=0;return;}
  const player=cars[0],focus=mode?.cameraFocus?.()||player;
  fovKick=Math.max(0,fovKick-dt*20);
  const speed=Math.abs(focus.speed),boosting=focus.nitroOn||focus.effect==='boost'||focus.driftBoost||focus.padBoostEnd>simTime;
  const nextFov=(cfg.fov??58)+clamp((speed-12)/20,0,1)*(cfg.speedFov??0)+Math.max(fovKick,focus.nitroOn?11:boosting?9:focus.drifting?1.2:0);
  camera.fov+=(nextFov-camera.fov)*(1-Math.exp(-dt*10));camera.updateProjectionMatrix();
  post.fx.speed=boosting&&focus===player?.42:clamp((speed-26)/14,0,.22)*(cfg.speedFov?1:0);
  post.fx.flash=Math.max(0,post.fx.flash-dt*2.4);
  if(!focus.active){
    const b=focus.body;
    cameraPosition.set(b.position.x+5,Math.max(-29,b.position.y+6),b.position.z+8);camera.position.lerp(cameraPosition,1-Math.exp(-dt*4));
    cameraTarget.lerp(tmpV.set(b.position.x,Math.max(-34,b.position.y),b.position.z),1-Math.exp(-dt*7));camera.up.lerp(tmpUp.set(0,1,0),dt*3);camera.lookAt(cameraTarget);cameraCut=0;return;
  }
  const special=mode?.cameraOverride?.(camera,cameraTarget,dt);
  if(!special)chase(focus,dt,cfg);
  if(shake>0){shake=Math.max(0,shake-dt*1.7);const t=performance.now();camera.position.addScaledVector(shakeDir,Math.sin(t*.075)*shake);camera.position.y+=Math.cos(t*.091)*shake*.35;}
  camera.lookAt(cameraTarget);cameraCut=0;
}

// ---------------------------------------------------------------- render
const projected=new THREE.Vector3(),cameraSpace=new THREE.Vector3();
function render(dt){
  const moving=state==='playing'||(demo&&['menu','setup'].includes(state));
  const visualDt=moving?(hitStopLeft>0?0:dt*(slowLeft>0?.25:1)):0;
  for(const car of cars){
    const v=car.visual;if(!v)continue;
    if(state==='garage'||state==='results'){v.updateRocket(null);studio.poseCar(car,dt);continue;}
    v.group.position.copy(car.body.position);v.group.quaternion.copy(car.body.quaternion);
    v.group.visible=car.active||car.body.position.y>-38;
    for(const wheel of v.wheels)wheel.rotation.x-=car.speed*visualDt/.4;
    const t=car.punchAge,ext=t<.035?-.08*Math.sin(t/.035*Math.PI):t<.095?Math.sin((t-.035)/.06*Math.PI*.5)*1.08:t<.16?1.08-(t-.095)*1.23:t<.39?Math.pow(1-(t-.16)/.23,2):0;
    const boost=car.effect==='boost'||car.driftBoost||car.padBoostEnd>simTime;
    const charge=car.punchHeldAt===null?0:clamp(simTime-car.punchHeldAt,0,1);
    v.updatePunch(ext,car.punchAngle,charge,car.punchHeavy,simTime);v.updateRocket(car.rocket);v.setGlow((!car.grounded&&car.active)||boost||(car.brake&&Math.abs(car.speed)>3));
    v.updateState({steer:car.steer,speed:car.speed,throttle:car.throttle,brake:car.brake,drifting:car.drifting,driftAmount:clamp(Math.abs(car.driftSlip)/.7,0,1),invulnerable:car.active&&(car.invulnerable>simTime||car.ghostUntil>simTime),boost,nitro:car.nitroOn,power:car.effect==='power',shield:car.effect==='shield',hitFlash:car.hitFlash,time:simTime,grounded:car.grounded,active:car.active},visualDt);
  }
  if(moving){venues.current.update?.(visualDt,simTime,state==='playing'&&!demo?cars[0]:null);mode?.render?.(visualDt);}
  if(state!=='garage'&&state!=='results')trails.update(cars,visualDt,{simTime,always:mode?.trails==='always',night:venues.current.descriptor.night??0,focusId:demo?cinematic.car:(mode?.cameraFocus?.()||cars[0]).id});
  studio.update(dt);
  updateCamera(dt);
  lighting.follow(camera);
  const focus=state==='playing'||state==='paused'?(mode?.cameraFocus?.()||cars[0]).body.position:cameraTarget;
  if(venues.current.type!=='arena'||state==='garage'||state==='results')lighting.focus(focus.x,0,focus.z);else lighting.focus(0,0,0);
  contactShadows.update(state!=='garage'&&state!=='results');
  const split=duo() && mode.id==='race' && (state==='playing'||state==='paused');
  if(split)localCameras.split(cars[1],mode.camera||{},dt);else post.render(dt);
  uiClock+=dt;
  const hudVisible=(state==='playing'||state==='paused')&&!demo;
  if(uiClock>.06){uiClock=0;if(hudVisible)updateHUD();}
  if(hudVisible&&!split)updateLabels();else ui.setLabels([]),ui.setIndicators([]);
  const player=cars[0];
  sound.update({speed:player.speed,throttle:player.throttle,brake:player.brake,lateral:player.lateral,playing:state==='playing'&&!demo&&!mode?.locked,revving:state==='playing'&&mode?.locked,grounded:player.grounded,falling:!player.active,boost:player.effect==='boost'||player.driftBoost||player.padBoostEnd>simTime,finalRound:!!mode?.intense},dt);
}
function updateHUD(){
  const p=cars[0],eventHUD=mode.hud();
  ui.hud({
    mode:mode.id,
    duoStatus:duo()?localStatus(eventHUD.board?.rows||[]):null,
    speed:p.active?Math.abs(p.speed)*3.6:0,drifting:p.drifting,
    nitro:{gauge:p.nitro,tanks:p.nitroTanks,max:NITRO.tanks,on:p.nitroOn,remaining:Math.max(0,p.nitroEnd-simTime)},
    cooldown:p.cooldown,cooldownMax:p.punchCooldown,canPunch:p.active&&!mode.locked&&(mode.canPunch?mode.canPunch(p):true),
    punchHolding:p.punchHeldAt!==null,punchCharge:p.punchHeldAt===null?0:clamp(simTime-p.punchHeldAt,0,1),
    effect:p.effect?{type:p.effect,remaining:Math.max(0,p.effectEnd-simTime)}:null,
    ...eventHUD,
  });
}
function localStatus(board){
  return cars.slice(0,2).map((car,id)=>{
    const rank=board.findIndex(row=>row.id===car.id);
    const raceStatus=mode.id==='race'&&car.mode.finished?'已完赛':null;
    return {id,rank:rank+1,status:raceStatus,speed:Math.round(Math.abs(car.speed)*3.6),
      tanks:car.nitroTanks,cooldown:car.cooldown,active:car.active,item:mode.itemName?.(car) ?? '',color:car.color};
  });
}
function updateLabels(){
  const labels=[],indicators=[];
  const extra=mode.markers?.()||[];
  for(const car of cars){
    const point=new THREE.Vector3(car.body.position.x,car.body.position.y+2.15,car.body.position.z);
    projected.copy(point).project(camera);cameraSpace.copy(point).applyMatrix4(camera.matrixWorldInverse);
    const distance=camera.position.distanceTo(point);
    const onScreen=cameraSpace.z<0&&Math.abs(projected.x)<.96&&Math.abs(projected.y)<.94;
    const label=duo()&&car.id<2?(car.id===0?'一号车手':'二号车手'):car.name;
    labels.push({id:car.id,name:label+(car.stagger?' · 动摇 ×'+car.stagger:''),color:car.color,x:(projected.x*.5+.5)*innerWidth,y:(-.5*projected.y+.5)*innerHeight,visible:car.active&&onScreen&&(!car.isPlayer||duo())&&distance<(duo()?150:mode.labelRange??70),tag:mode.labelTag?.(car)});
    if(!car.isPlayer&&car.active&&mode.indicators!==false&&!onScreen)indicators.push(indicator(car.id,car.name,point,car.color,'enemy'));
  }
  for(const marker of extra){
    tmpV.set(marker.x,marker.y,marker.z);projected.copy(tmpV).project(camera);cameraSpace.copy(tmpV).applyMatrix4(camera.matrixWorldInverse);
    const onScreen=cameraSpace.z<0&&Math.abs(projected.x)<.87&&Math.abs(projected.y)<.78;
    if(!onScreen)indicators.push(indicator(marker.id,marker.name,tmpV,marker.color,marker.type||'item'));
  }
  ui.setLabels(labels);ui.setIndicators(indicators);
}
function indicator(id,name,point,color,type){
  cameraSpace.copy(point).applyMatrix4(camera.matrixWorldInverse);
  const dx=cameraSpace.x,dy=-cameraSpace.y+(cameraSpace.z>0?Math.abs(cameraSpace.z):0),length=Math.hypot(dx,dy)||1;
  const nx=dx/length,ny=dy/length,w=Math.max(20,innerWidth*.5-65),h=Math.max(20,innerHeight*.5-105);
  const reach=Math.min(w/Math.max(Math.abs(nx),.001),h/Math.max(Math.abs(ny),.001));
  return {id,name,x:innerWidth*.5+nx*reach,y:innerHeight*.5+ny*reach,angle:Math.atan2(ny,nx),color,type};
}
function loop(now){
  const sinceFrame=(now-lastFrame)/1000;
  if(document.hidden || (state!=='playing' && sinceFrame<1/30-.001))return;
  const elapsed=Math.min(.1,sinceFrame);lastFrame=now;
  if(state==='playing'&&!autopilot)localControls.poll(duo());
  perfWarmup=Math.max(0,perfWarmup-elapsed);
  // Adaptive quality: first trim resolution on high-DPI screens, then (if still slow) step the preset down.
  if(state==='playing'&&!demo&&!mode.locked&&perfWarmup===0){perfClock+=sinceFrame;perfFrames++;
    if(perfClock>3){const fps=perfFrames/perfClock;perfClock=0;perfFrames=0;
      const changed=post.adapt(fps);
      if(!changed&&fps<36&&post.level!=='low'){lowStreak++;
        if(lowStreak>=2){lowStreak=0;const next=post.level==='high'?'medium':'low';post.set(next);ui.feed(`本场画质已调为「${{medium:'中',low:'低'}[next]}」`);}}
      else lowStreak=0;}}
  const fast=state==='playing'&&!demo&&mode?.isSpectating?.()&&keys.has('Space')?3:1;
  const running=state==='playing'||(demo&&state==='menu');
  const step=demo?1/30:DT;
  if(running){accumulator+=elapsed*fast;let n=0;while(accumulator>=step&&n<6*fast){fixedUpdate(step);accumulator-=step;n++;}}else accumulator=0;
  render(elapsed);
}

// ---------------------------------------------------------------- input
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();post.resize();});
window.addEventListener('keydown',e=>{
  if(state==='playing'&&e.target.tagName==='BUTTON'){e.target.blur();if(e.code==='Space'||e.code==='Enter')e.preventDefault();}
  if(state!=='playing'&&['SELECT','INPUT','BUTTON'].includes(e.target.tagName)&&e.code!=='Escape')return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  if(e.repeat)return;
  if(e.code==='Escape'){if(state==='playing')pause();else if(state==='paused')resume();else ui.back?.();return;}
  if(e.code==='Enter'&&['menu','setup'].includes(state)){ui.confirm?.();return;}
  if(state!=='playing')return;
  keys.add(e.code);
  if(e.code==='KeyF'){if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});else document.documentElement.requestFullscreen?.().catch(()=>{});}
  if(e.code==='KeyR'&&recoverCooldown===0&&!demo){if(mode?.manualReset?.(cars[0]))recoverCooldown=3;else if(recover(cars[0]))recoverCooldown=4;}
  if(duo() && ['Enter','Numpad1','NumpadEnter','Numpad2','Slash','Period','Numpad0'].includes(e.code)){
    e.preventDefault();sound.init();
    if(['Enter','Numpad1','NumpadEnter'].includes(e.code))holdInput(1,e.code,true);
    else if(['Slash','Numpad2'].includes(e.code))fireItem(1);
    else fireNitro(1);
    return;
  }
  if(['KeyJ','KeyE','KeyX'].includes(e.code)){e.preventDefault();sound.init();holdInput(0,e.code,true);}
  if(e.code==='Space'&&!demo&&!mode?.locked&&!mode?.isSpectating?.()){e.preventDefault();useNitro(cars[0],env);}
  if(['KeyQ','KeyK','KeyC'].includes(e.code)){e.preventDefault();fireItem(0);}
});
window.addEventListener('keyup',e=>{
  keys.delete(e.code);
  if(state!=='playing')return;
  if(['KeyJ','KeyE','KeyX'].includes(e.code))holdInput(0,e.code,false);
  if(duo()&&['Enter','Numpad1','NumpadEnter'].includes(e.code))holdInput(1,e.code,false);
});
window.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('pointerdown',e=>{
  if(e.button===2&&state==='playing'){e.preventDefault();sound.init();doPunch(cars[0]);}
  if(state==='garage'||state==='results')studio.pointerDown(e,renderer.domElement);
});
renderer.domElement.addEventListener('pointermove',e=>studio.pointerMove(e));
renderer.domElement.addEventListener('pointerup',()=>studio.pointerUp());
renderer.domElement.addEventListener('pointercancel',()=>studio.pointerUp());
renderer.domElement.addEventListener('wheel',e=>{if(state==='garage'){e.preventDefault();studio.wheel(e.deltaY);}},{passive:false});
window.addEventListener('blur',()=>{keys.clear();pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();pause();}});

ui.onScreen=name=>{if(name==='setup'&&state==='menu')state='setup';if(name==='menu'&&state==='setup')state='menu';};
showMenu();
renderer.setAnimationLoop(loop);

// ---------------------------------------------------------------- QA hooks (opt-in)
if(new URLSearchParams(location.search).get('qa')==='1'){
  window.__game={
    get state(){return state;},get mode(){return mode;},cars,ctx,world,venues,options:()=>options,
    snapshot:()=>({state,demo,mode:mode?.id,simTime,venue:venues.current.descriptor.id,hud:mode?.hud?.(),cars:cars.map(c=>({id:c.id,name:c.name,score:c.score,active:c.active,speed:c.speed,classId:c.classId,position:{...c.body.position},grounded:c.grounded,mode:{...c.mode}}))}),
    step:seconds=>{for(let i=0;i<Math.ceil(seconds/DT);i++)fixedUpdate(DT);render(0);},
    start:settings=>startMatch(settings),preview,menu:showMenu,pause,resume,next:nextTourEvent,garage:setGarage,
    key:(code,on)=>on?keys.add(code):keys.delete(code),
    place:(id,x,z,yaw=0,y=.7)=>ctx.placeCar(cars[id],x,z,yaw,y),
    punch:id=>doPunch(cars[id]),
    freezeRender:()=>renderer.setAnimationLoop(null),resumeRender:()=>{lastFrame=performance.now();renderer.setAnimationLoop(loop);},
    draw:(frames=1)=>{for(let i=0;i<frames;i++)render(1/60);},
    finish:()=>mode?.forceFinish?.(),
    visual:()=>({dynamicRatio:post.pixelRatio,quality:post.level,bloom:post.bloom,look:post.look,pixelRatio:renderer.getPixelRatio(),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,bodies:world.bodies.length}),
    setQuality:q=>post.set(q),autopilot:on=>{autopilot=!!on;},
    detail:id=>{const c=cars[id];return {name:c.name,active:c.active,hitAge:+(simTime-c.lastHit).toFixed(2),attacker:c.lastAttacker,pos:[c.body.position.x,c.body.position.y,c.body.position.z].map(v=>+v.toFixed(2)),up:+c.up.y.toFixed(2),grounded:c.grounded,speed:+c.speed.toFixed(1),throttle:c.throttle,steer:+c.steer.toFixed(2),brake:c.brake,drift:c.driftInput,stuck:+c.stuck.toFixed(2),rev:+(c.reverseUntil-simTime).toFixed(2),mode:{idx:c.mode.idx,lat:c.mode.lateral&&+c.mode.lateral.toFixed(2),dist:c.mode.dist&&+c.mode.dist.toFixed(1),lane:c.mode.lane&&+c.mode.lane.toFixed(2)},contacts:world.contacts.filter(k=>k.bi===c.body||k.bj===c.body).map(k=>{const o=k.bi===c.body?k.bj:k.bi;return {other:o.id,mass:o.mass,ni:[k.ni.x,k.ni.y,k.ni.z].map(v=>+v.toFixed(2))};}).slice(0,6)};},
  };
}
