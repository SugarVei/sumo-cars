import {MAPS,createMapManager} from './maps.js';

/**
 * One active venue at a time: a square arena (Sumo, Crown), a race track or a hex floor.
 * Inactive venues keep their meshes cached but contribute no physics bodies.
 */
export function createVenues(scene,world,groundMaterial,builders={}){
  const arenas=createMapManager(scene,world,groundMaterial);
  const cache=new Map();
  let current={type:'arena',id:'meadow'};
  let venue=arenaAdapter();

  function arenaAdapter(){
    return {
      type:'arena',
      get id(){return arenas.id;},
      get descriptor(){return arenas.descriptor;},
      get halfSize(){return arenas.halfSize;},
      get dynamicProps(){return arenas.dynamicProps;},
      get group(){return arenas.group;},
      setRound:(round,total,shrink)=>arenas.setRound(round,total,shrink),
      spawnSafe:(x,z,r)=>arenas.spawnSafe(x,z,r),
      setVisible:value=>arenas.setVisible(value),
      update:(dt,time,player)=>arenas.update(dt,time,player),
      diagnostics:()=>arenas.diagnostics(),
      // Square arenas: distance from the nearest edge, negative outside.
      edgeDistance(x,z){return arenas.halfSize-Math.max(Math.abs(x),Math.abs(z));},
    };
  }

  function set(type,id){
    if(current.type===type&&current.id===id)return venue;
    if(current.type==='arena')arenas.deactivate();else venue.deactivate();
    if(type==='arena'){
      arenas.setMap(MAPS.some(m=>m.id===id)?id:'meadow');venue=arenaAdapter();
    }else{
      const key=type+':'+id;let built=cache.get(key);
      if(!built){
        const before=new Set(world.bodies);
        built=builders[type](scene,world,groundMaterial,id);
        built.bodies??=world.bodies.filter(body=>!before.has(body));
        cache.set(key,built);
      }
      built.activate();venue=built;
    }
    current={type,id:venue.id??id};
    if(world.broadphase)world.broadphase.dirty=true;
    return venue;
  }
  return {
    set,
    get current(){return venue;},
    get type(){return current.type;},
    maps:MAPS,
  };
}

/** Helper for builders: add/remove a cached venue's bodies and toggle its group. */
export function makeActivatable(world,group,bodies){
  let on=true;
  return {
    activate(){if(on)return;on=true;group.visible=true;for(const b of bodies)if(!world.bodies.includes(b))world.addBody(b);},
    deactivate(){if(!on)return;on=false;group.visible=false;for(const b of bodies)if(world.bodies.includes(b))world.removeBody(b);},
    get active(){return on;},
  };
}
