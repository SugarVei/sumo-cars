import {createSumo} from './sumo.js';
import {createRace} from './race.js';
import {createCrown} from './crown.js';
import {createMeltdown} from './meltdown.js';

/** Menu metadata for every event. venueType decides which venue list the setup screen shows. */
export const MODE_INFO={
  tour:{id:'tour',name:'派对巡回赛',en:'PARTY TOUR',tag:'五场赛事连战，按积分决出总冠军。',accent:'#ff4fa8',venueType:null,length:'约 12 分钟'},
  race:{id:'race',name:'霓虹大奖赛',en:'GRAND PRIX',tag:'悬空赛道竞速：加速带、飞跃缺口、道具箱，大部分弯道没有护栏。',accent:'#38d9f5',venueType:'track',defaultVenue:'neon',length:'3 圈'},
  sumo:{id:'sumo',name:'相扑擂台',en:'SUMO',tag:'把对手推下浮空擂台，擂台每回合缩小一圈。',accent:'#c8e64a',venueType:'arena',defaultVenue:'neon',length:'6 回合'},
  crown:{id:'crown',name:'王冠争夺',en:'CROWN CLASH',tag:'抢到王冠就开始计时；打中或撞中持有者就能抢过来。',accent:'#f2b84b',venueType:'arena',defaultVenue:'mesa',length:'先到 60 秒'},
  meltdown:{id:'meltdown',name:'熔毁',en:'MELTDOWN',tag:'车轮压过的地块会升温，烧红就塌落。不停移动，坚持到最后。',accent:'#ff7a45',venueType:'hex',defaultVenue:'core',length:'3 回合'},
};

export function createMode(id,ctx,settings){
  const factory={sumo:createSumo,race:createRace,crown:createCrown,meltdown:createMeltdown}[id]||createRace;
  return factory(ctx,{...settings,mode:id});
}
