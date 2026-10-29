import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle, DEFAULT_MOBA, ARENA_MOBA } from '../src/index.ts';

const idle = { move: {x:0,y:0}, aim:{x:1,y:0}, fire:false, dash:false, shield:false };
function advance(s, ticks) {
  for (let i=0; i<ticks; i++) s = stepBattle(s, {A:idle,B:idle}, ARENA_MOBA);
  return s;
}
describe('Overseer arena rules', () => {
  it('spawns at 6:00 and not one tick before', () => {
    let s = createBattle(ARENA_MOBA);
    s.tick = 10798; s.time = 10798/30;
    s = advance(s,1);
    assert.equal(s.moba.overseer.alive,false);
    s = advance(s,1);
    assert.equal(s.moba.overseer.alive,true);
    assert.equal(s.moba.overseer.hp,s.moba.overseer.maxHp);
  });
  it('spaces the outer towers symmetrically away from mid', () => {
    const s = createBattle(ARENA_MOBA);
    const a = s.moba.structures.find(x=>x.id==='a_t1');
    const b = s.moba.structures.find(x=>x.id==='b_t1');
    assert.equal(a.pos.x + b.pos.x,48);
    assert.ok(b.pos.x-a.pos.x >= 10);
    assert.equal(createBattle(DEFAULT_MOBA).moba.structures.find(x=>x.id==='a_t1').pos.x,22.5);
  });
});

describe('Overseer defeat and buff', () => {
  it('credits the killing side, grants 90 seconds and respawns after 3 minutes', () => {
    let s = createBattle(ARENA_MOBA);
    s.tick = 10799; s.time = s.tick / 30;
    s = advance(s, 1);
    s.moba.overseer.hp = 5;
    s.projectiles.push({ id: 77, owner:'A', pos:{x:24,y:1.8}, prev:{x:24,y:1.8}, vel:{x:0,y:30}, alive:true, dmg:10 });
    s = advance(s, 1);
    const killed = s.tick;
    assert.equal(s.moba.overseer.alive, false);
    assert.equal(s.moba.overseer.buffUntil.A, killed + 2700);
    assert.equal(s.moba.overseer.buffUntil.B, 0);
    assert.equal(s.moba.overseer.spawnTick, killed + 5400);
    assert.equal(s.moba.log.at(-1).type, 'overseer-defeated');
    s.tick = killed + 5398; s.time = s.tick / 30;
    s = advance(s,1);
    assert.equal(s.moba.overseer.alive,false);
    s = advance(s,1);
    assert.equal(s.moba.overseer.alive,true);
  });
});

it('chip can observe and deliberately move and aim at the Overseer', async () => {
  const { observe, drive } = await import('../src/index.ts');
  const { validatePolicy } = await import('@agent-wars/behavior-dna');
  let s=createBattle(ARENA_MOBA); s.tick=10799; s.time=s.tick/30; s=advance(s,1);
  s.agents.A.pos={x:24,y:6};
  const p={schemaVersion:2,agentVersionId:'v',dna:{aggression:50,evasion:50,preferredDistance:50,energyConservation:50},rules:[{id:'boss',when:{operand:'overseerAlive',op:'eq',value:true},move:'CONTEST_OVERSEER',target:'OVERSEER'}]};
  assert.equal(validatePolicy(p).ok,true);
  assert.equal(observe(s,'A',ARENA_MOBA).overseerAlive,true);
  assert.equal(observe(s,'A',ARENA_MOBA).overseerHpPct,100);
  const a=drive(s,p,'A',ARENA_MOBA);
  assert.equal(a.fire,true);
  assert.ok(a.aim.y < 0);
});

it('the Overseer strikes nearby robots and the buff increases robot attack damage until expiration', () => {
  let s=createBattle(ARENA_MOBA);s.tick=10799;s.time=s.tick/30;s=advance(s,1);
  s.agents.A.pos={x:24,y:6};s.agents.A.hp=550;s.agents.A.items=[];
  s.moba.overseer.lastAttackTick=s.tick-30;
  s=advance(s,1);
  assert.ok(s.agents.A.hp < 550);
  s.moba.overseer.buffUntil.A=s.tick+2;
  s.agents.A.lastShotAt=-10;
  const shot={...idle,aim:{x:1,y:0},fire:true};
  s=stepBattle(s,{A:shot,B:idle},ARENA_MOBA);
  assert.equal(s.projectiles.find(p=>p.owner==='A').dmg,24);
  s=advance(s,1);s.agents.A.lastShotAt=-10;
  s=stepBattle(s,{A:shot,B:idle},ARENA_MOBA);
  assert.equal(s.projectiles.filter(p=>p.owner==='A').at(-1).dmg,20);
});

it('last-hit observation uses actual minion damage in the new arena', async () => {
  const { observe }=await import('../src/index.ts');
  const s=createBattle(ARENA_MOBA);
  s.agents.A.pos={x:24,y:8}; s.agents.A.items=[];
  s.moba.minions.push({id:9,side:'B',kind:'melee',pos:{x:25,y:8},hp:19,alive:true,target:null,wpIndex:0,lastShotAt:0});
  assert.equal(observe(s,'A',ARENA_MOBA).killableFoeMinionsInRange,1);
});

it('credits both sides when their lethal hits land during the same simulation tick', () => {
  let s=createBattle(ARENA_MOBA); s.tick=10799;s.time=s.tick/30;s=advance(s,1);s.moba.overseer.hp=5;
  for (const [id,owner] of [[81,'A'],[82,'B']]) s.projectiles.push({id,owner,pos:{x:24,y:1.8},prev:{x:24,y:1.8},vel:{x:0,y:30},alive:true,dmg:10});
  s=advance(s,1);
  assert.equal(s.moba.overseer.buffUntil.A,s.tick+2700);
  assert.equal(s.moba.overseer.buffUntil.B,s.tick+2700);
});

it('replays the same new arena and records the spawn and map positions', async () => {
  const { buildReplay, fightPolicies } = await import('../src/index.ts');
  const p={schemaVersion:2,agentVersionId:'idle',dna:{aggression:50,evasion:50,preferredDistance:50,energyConservation:50},rules:[{id:'hold',when:{operand:'ownHpPct',op:'gte',value:0},move:'WAIT',target:'NONE'}]};
  const cfg={...ARENA_MOBA, autoBuy:false, world:{...ARENA_MOBA.world,maxTicks:10818}};
  const out=fightPolicies(p,p,'overseer-replay',cfg);
  const replay=buildReplay(p,p,'overseer-replay',cfg);
  assert.equal(replay.checksum,out.checksum);
  assert.equal(replay.rulesetVersion,2);
  assert.equal(replay.structurePositions.a_t1.x,19);
  assert.ok(replay.events.some(e=>e.type==='overseer-spawn' && e.t===10800));
  assert.ok(replay.frames.some(f=>f.overseer?.alive));
});
