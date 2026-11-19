/** Each driver receives at most one title. Keep the numbers behind it for the results screen. */
export function matchAccolade(car,rank,mode,mostKOs){
  const r=car.record,m=car.mode;
  const accuracy=r.punches ? r.punchHits/r.punches : 0;
  if(mode==='crown'&&rank>1&&r.crownTime>=55&&m.lostAtFinish)
    return {name:'最强打工仔',reason:`持冠 ${r.crownTime.toFixed(1)} 秒，在最后 6 秒失去王冠`};
  if(r.punches>15&&r.punchHits===0)
    return {name:'人体描边大师',reason:`本场挥拳 ${r.punches} 次，全部打空`};
  if(r.kos>0&&r.kos===mostKOs&&accuracy>.70)
    return {name:'擂台拳王',reason:`${r.punches} 拳命中 ${r.punchHits} 次，击落 ${r.kos} 次，达到全场最高击落数`};
  if(r.edgeSeconds>15)
    return {name:'悬崖华尔兹',reason:`在距离擂台边缘 2 米内行驶了 ${r.edgeSeconds.toFixed(1)} 秒`};
  if(mode==='meltdown'&&m.wins)
    return {name:'最后的轮胎',reason:`在 ${m.wins} 个回合存活到最后`};
  if(mode==='crown'&&r.steals)
    return {name:'王冠大盗',reason:`从持冠者手上打掉王冠 ${r.steals} 次`};
  if(mode==='race'&&m.bestLap!=null)
    return {name:'追风车手',reason:`个人最快单圈 ${m.bestLap.toFixed(2)} 秒`};
  if(r.kos>0)return {name:'清场专家',reason:`本场击落对手 ${r.kos} 次`};
  if(r.punchHits>0)return {name:'拳套开张',reason:`本场命中 ${r.punchHits} 拳`};
  if(r.falls>0)return {name:'悬崖熟客',reason:`本场坠落 ${r.falls} 次`};
  return {name:'稳稳当当',reason:`以第 ${rank} 名结束比赛，全程零坠落`};
}
