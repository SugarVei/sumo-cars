// PUNCH DRIVE regression + screenshot run.  Usage:  npm test   (add -- --perf for frame-rate sampling)
// Drives the offline HTML in Edge through Playwright. Writes 验收数据/qa-results.json and 截图/*.png.
import {chromium} from 'playwright';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';

const root=process.cwd(),html=pathToFileURL(root+'/Sumo Cars.html').href;
const shots=root+'/截图/',dataDir=root+'/验收数据/';
await fs.mkdir(shots,{recursive:true});await fs.mkdir(dataDir,{recursive:true});
const perf=process.argv.includes('--perf');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1600,height:900},offline:true});
const page=await context.newPage();
const errors=[],requests=[],checks=[],metrics={};
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
const check=(ok,name,detail)=>{checks.push({name,pass:!!ok,detail});console.log(ok?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const wait=ms=>page.waitForTimeout(ms);
const g=(fn,arg)=>page.evaluate(fn,arg);
// Frozen-render screenshot: simulate, draw, then let CSS banners settle before capturing.
const still=async(name,settle=2300)=>{await g(()=>__game.draw(8));await wait(settle);await g(()=>__game.draw(2));await page.screenshot({path:shots+name+'.png'});};

// Latin words that may stay on screen: the brand, the small English mode tags, key caps and units.
const LATIN_OK=new Set(['PUNCH','DRIVE','PARTY','TOUR','GRAND','PRIX','SUMO','CROWN','CLASH','MELTDOWN','DART','RUMBLER','BRUISER','WASD','Shift','Esc']);
const latinWords=sel=>g(s=>[...new Set((document.querySelector(s)?.innerText||'').match(/[A-Za-z]{3,}/g)||[])],sel);
const chineseOnly=async(sel,name)=>{const words=await latinWords(sel);check(words.every(w=>LATIN_OK.has(w)),name,words.filter(w=>!LATIN_OK.has(w)));};

await page.goto(html+'?qa=1');await page.waitForFunction(()=>window.__game);await wait(3200);
check(await page.locator('.mode-card').count()===5,'Title screen lists five events');
check(await g(()=>document.documentElement.lang)==='zh-CN','Page language is zh-CN');
check((await page.locator('.mode-card strong').allInnerTexts()).join(',')==='派对巡回赛,霓虹大奖赛,相扑擂台,王冠争夺,熔毁','Mode names are Chinese');
await chineseOnly('.menu-screen','Title screen copy is Chinese');
await page.screenshot({path:shots+'01-标题菜单.png'});

// ---------------------------------------------------------------- UI flow with real clicks
await page.click('.mode-card[data-mode="race"]');await wait(700);
check(await page.locator('.venue-card').count()===2,'Grand Prix offers two tracks');
await page.click('.venue-card[data-venue="canyon"]');await page.click('.option[data-key="laps"] button[data-value="2"]');
await page.click('.next-btn');await wait(700);
check(await g(()=>__game.state)==='garage','Car step opens the garage');
await page.click('.class-card[data-class="dart"]');await page.click('.swatch[data-paint="sakura"]');await wait(1600);
await chineseOnly('.setup-screen','Garage copy is Chinese');
await page.screenshot({path:shots+'04-车库选车.png'});
await page.click('.next-btn');await wait(900);
const opts=await g(()=>__game.options());
check(await g(()=>__game.state)==='playing'&&opts.venue==='canyon'&&opts.laps===2&&opts.classId==='dart'&&opts.paint==='sakura','Start applies venue, laps, class and paint',opts);

// ---------------------------------------------------------------- live keyboard controls
// Put the input fixture on the first straight, in clear air. A random grid collision or a slow
// render must not turn a drift/boost assertion into an off-road respawn check.
await g(()=>{
  __game.freezeRender();
  __game.step(4.3);
  const car=__game.cars[0],index=12,s=__game.ctx.venue.samples[index];
  __game.ctx.placeCar(car,s.p.x,s.p.z,Math.atan2(-s.T.x,-s.T.z),s.p.y+.7,0);
  Object.assign(car.mode,{idx:index,s:s.s,dist:s.s,stallUntil:0});
  car.speedMul=1;
});
const driveFor=async seconds=>g(t=>{__game.step(t);__game.draw(5);},seconds);
await page.keyboard.down('KeyW');await driveFor(1.3);
check(await g(()=>__game.cars[0].speed)>12,'W accelerates after the start lights',await g(()=>+__game.cars[0].speed.toFixed(1)));
await page.keyboard.down('KeyA');await driveFor(.12);check(await g(()=>__game.cars[0].steer)>.5,'A steers left');await page.keyboard.up('KeyA');
// Drift right then counter-drift left so the car stays on the (rail-less) road while the gauge fills.
const gauge=()=>g(()=>__game.cars[0].nitro+__game.cars[0].nitroTanks);
const gauge0=await gauge();
await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyD');await driveFor(.68);check(await g(()=>__game.cars[0].driftInput),'Shift + steer engages drift');
await page.keyboard.up('KeyD');await page.keyboard.down('KeyA');await driveFor(.12);
const gauge1=await gauge(),hint=await page.locator('#speedo .nitro-hint').innerText();
await page.keyboard.up('ShiftLeft');await page.keyboard.up('KeyA');
check(gauge1>gauge0+.03,'Drifting fills the nitro gauge',{before:+gauge0.toFixed(3),after:+gauge1.toFixed(3)});
check(/氮气/.test(hint),'Nitro HUD explains itself in Chinese',hint);
await g(()=>{__game.cars[0].nitroTanks=1;});await driveFor(.05);
check(await page.locator('#speedo .tanks i.full').count()===1,'HUD shows one full nitro tank');
await page.keyboard.press('Space');await driveFor(.08);
const burn=await g(()=>({on:__game.cars[0].nitroOn,tanks:__game.cars[0].nitroTanks}));
check(burn.on&&burn.tanks===0,'Space fires a nitro tank',burn);
check(await page.locator('#speedo.nitro-on').count()===1,'HUD shows the nitro burn');
await chineseOnly('.hud','Race HUD copy is Chinese');
check(await g(()=>__game.cars[0].active),'Driver remains on the straight during the input checks');
await page.keyboard.press('KeyJ');await wait(80);
const punch=await g(()=>({active:__game.cars[0].active,cooldown:+__game.cars[0].cooldown.toFixed(2)}));check(punch.cooldown>0,'J throws a punch',punch);
await g(()=>{__game.cars[0].mode.item='turbo';});await page.keyboard.press('KeyQ');await wait(80);
const item=await g(()=>({active:__game.cars[0].active,effect:__game.cars[0].effect}));check(item.effect==='boost','Q fires the held item',item);
await page.keyboard.up('KeyW');
await page.keyboard.press('Escape');await wait(250);check(await g(()=>__game.state)==='paused','Esc pauses');
await page.keyboard.press('Space');await wait(150);check(await g(()=>__game.state)==='paused','Space cannot press a focused button while paused');
await page.keyboard.press('Escape');await wait(250);check(await g(()=>__game.state)==='playing','Esc resumes');
check(!!(await g(()=>__game.ctx.sound.ctx?.state)),'Audio starts from the click');

// ---------------------------------------------------------------- full simulated races
await g(()=>__game.freezeRender());
for(const venue of ['neon','canyon']){
  const r=await g(v=>{__game.autopilot(true);__game.start({mode:'race',venue:v,laps:3,quality:'medium',music:false});
    const falls=[0,0,0,0,0,0],was=__game.cars.map(()=>true),nitro=[0,0,0,0,0,0],burning=__game.cars.map(()=>false);let t=0;
    while(__game.state==='playing'&&t<420){__game.step(.5);t+=.5;__game.cars.forEach((c,i)=>{if(was[i]&&!c.active)falls[i]++;was[i]=c.active;if(c.nitroOn&&!burning[i])nitro[i]++;burning[i]=c.nitroOn;});}
    return {t,state:__game.state,falls,nitro,finished:__game.cars.filter(c=>c.mode.finished).length,best:__game.cars.map(c=>c.mode.bestLap&&+c.mode.bestLap.toFixed(1))};},venue);
  metrics['race-'+venue]=r;
  check(r.state==='results'&&r.finished>=1,`3-lap race on ${venue} reaches the podium`,r);
  check(r.nitro.filter(n=>n>0).length>=3,`Drivers drift-charge and fire nitro on ${venue}`,r.nitro);
}
// Race screenshots mid-pack.
for(const [venue,name,at] of [['neon','02-竞速-霓虹环线',11],['canyon','03-竞速-落日峡谷',9]]){
  await g(([v,at])=>{__game.autopilot(true);__game.start({mode:'race',venue:v,laps:3,quality:'high',music:false});__game.step(at);},[venue,at]);
  await still(name);
}

// ---------------------------------------------------------------- arena modes
await g(()=>{__game.start({mode:'sumo',venue:'neon',format:'classic',quality:'high',music:false});__game.step(20);});
await still('05-相扑-霓虹港湾');
const sumo=await g(()=>{let t=0,fires=0;const burning=__game.cars.map(()=>false);
  while(__game.state==='playing'&&t<420){__game.step(.5);t+=.5;__game.cars.forEach((c,i)=>{if(c.nitroOn&&!burning[i])fires++;burning[i]=c.nitroOn;});}
  return {t,state:__game.state,fires,scores:__game.cars.map(c=>c.score)};});
metrics.sumo=sumo;check(sumo.state==='results','Classic Sumo plays all six rounds to the results',sumo);
check(sumo.fires>=2,'Arena drivers also use nitro rams',sumo.fires);
await still('09-颁奖台',2600);
await chineseOnly('.results-screen','Results copy is Chinese');

await g(()=>{__game.start({mode:'crown',venue:'mesa',crownTarget:60,quality:'high',music:false});__game.step(16);});
await still('06-王冠争夺-赤岩峡谷');
const crown=await g(()=>{let t=0;while(__game.state==='playing'&&t<200){__game.step(2);t+=2;}return {t,state:__game.state,time:__game.cars.map(c=>+(c.mode.crown||0).toFixed(1))};});
metrics.crown=crown;check(crown.state==='results'&&Math.max(...crown.time)>5,'Crown Clash banks crown time and ends',crown);

for(const [venue,name] of [['core','07-熔毁-熔岩核心'],['grid','08-熔毁-赛博网格']]){
  await g(v=>{__game.start({mode:'meltdown',venue:v,rounds:3,quality:'high',music:false});__game.step(15);},venue);
  await still(name);
}
const melt=await g(()=>{let t=0;while(__game.state==='playing'&&t<300){__game.step(2);t+=2;}return {t,state:__game.state,points:__game.cars.map(c=>c.score)};});
metrics.meltdown=melt;check(melt.state==='results'&&melt.t<300,'Meltdown finishes three rounds',melt);

// ---------------------------------------------------------------- party tour
await g(()=>__game.menu());await g(()=>__game.resumeRender());await wait(800);
await page.click('.mode-card[data-mode="tour"]');await wait(700);
check(await g(()=>__game.state)==='garage','Party Tour goes straight to car select');
await page.click('.next-btn');await wait(700);
const events=[];
for(let i=0;i<5;i++){
  events.push(await g(()=>__game.snapshot().mode));
  await g(()=>{__game.freezeRender();__game.autopilot(true);__game.step(5);__game.finish();});await wait(900);
  const next=page.locator('.next-event-btn:not([hidden])');
  if(await next.count()){await g(()=>__game.resumeRender());await next.click();await wait(700);}
}
check(events.join(',')==='race,sumo,crown,meltdown,race','Tour plays race, sumo, crown, meltdown, race',events);
await g(()=>__game.draw(10));await wait(2400);
check(await page.locator('.tour-panel:not([hidden])').count()===1,'Tour standings appear on the final results');
await page.screenshot({path:shots+'10-巡回赛冠军.png'});

// ---------------------------------------------------------------- performance (opt-in)
if(perf){
  await g(()=>__game.resumeRender());
  const sample=()=>g(()=>new Promise(r=>{const ts=[];let last=performance.now();const t0=last;function f(now){ts.push(now-last);last=now;if(now-t0<4000)requestAnimationFrame(f);else{ts.shift();ts.sort((a,b)=>a-b);const avg=ts.reduce((a,b)=>a+b,0)/ts.length;r({fps:+(1000/avg).toFixed(1),p95:+ts[Math.floor(ts.length*.95)].toFixed(1)});}}requestAnimationFrame(f);}));
  metrics.performance={};
  for(const q of ['low','medium','high'])for(const [m,v] of [['race','neon'],['sumo','neon'],['meltdown','core']]){
    await g(([m,v,q])=>{__game.autopilot(true);__game.start({mode:m,venue:v,quality:q,music:false});},[m,v,q]);await wait(5000);
    metrics.performance[`${q}/${m}/${v}`]=await sample();console.log('perf',q,m,v,JSON.stringify(metrics.performance[`${q}/${m}/${v}`]));
  }
}

check(errors.length===0,'No page errors',errors.slice(0,5));
check(requests.length===0,'No network requests (fully offline)',requests.slice(0,5));
await fs.writeFile(dataDir+'qa-results.json',JSON.stringify({date:new Date().toISOString(),passed:checks.filter(c=>c.pass).length,total:checks.length,checks,metrics,errors,requests},null,2));
console.log(`\n${checks.filter(c=>c.pass).length}/${checks.length} checks passed`);
await browser.close();
process.exitCode=checks.every(c=>c.pass)?0:1;
