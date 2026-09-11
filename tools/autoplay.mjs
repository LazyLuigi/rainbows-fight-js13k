// Headless autopilot: plays the game in jsdom to sanity-check balance.
// Needs jsdom:  npm i -D jsdom      Usage:  SK=0.7 node tools/autoplay.mjs
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const fs={readFileSync:readFileSync};
let html=fs.readFileSync(process.argv[2]||'src/index.html','utf8');
html=html.replace("requestAnimationFrame(draw);\n</script>",`window.__dbg=function(){return{over:over,started:started,arena:arena,phase:phase,lives:lives,score:scoreV,cleaned:cleaned,tut:tut,pause:tutPause,camX:camX,scrR:(arena+1)*SCR-pl.x,song:song.key+'/'+song.prog+'/'+song.drum+'/'+(60/STEP/4).toFixed(0),charging:pl.charging,charge:pl.charge,atk:pl.atk,face:pl.face,beams:beams.length,
  cans:cans.map(function(c){return{st:c.st,dx:c.x-pl.x,dy:c.y-pl.y,z:c.z,thrower:!!c.thrower}}),
  mobs:mobs.map(function(m){return{dx:m.x-pl.x,dy:m.y-pl.y,dead:m.dead,st:m.st,hp:m.hp}})}};
requestAnimationFrame(draw);
</script>`);
let clock=0,queue=[],frames=0;
const dom=new JSDOM(html,{runScripts:'dangerously',beforeParse(w){
  const ctx=new Proxy({},{get:(t,k)=>k==='measureText'?()=>({width:1}):()=>{},set:()=>true});
  w.HTMLCanvasElement.prototype.getContext=()=>ctx;
  class P{constructor(){this.value=0}setValueAtTime(){}linearRampToValueAtTime(){}exponentialRampToValueAtTime(){}setTargetAtTime(){}}
  class N{constructor(){this.gain=new P();this.frequency=new P();this.detune=new P();this.Q=new P()}connect(){}start(){}stop(){}}
  w.AudioContext=class{constructor(){this.sampleRate=44100;this.state='running';this.destination={}}get currentTime(){return clock}
    createGain(){return new N()}createOscillator(){return new N()}createBufferSource(){return new N()}createBiquadFilter(){return new N()}
    createBuffer(c,l){return{getChannelData:()=>new Float32Array(l)}}resume(){return Promise.resolve()}};
  w.requestAnimationFrame=cb=>{frames++;queue.push(cb);return 1};w.performance={now:()=>clock*1000};w.setInterval=()=>0;w.clearInterval=()=>{};
  w.addEventListener('error',e=>console.log('WINERR',e.message,e.error&&e.error.stack&&e.error.stack.split('\n')[1]));
}});
const w=dom.window,doc=w.document,dt=1/60;
const frame=()=>{clock+=dt;const q=queue;queue=[];q.forEach(cb=>cb(clock*1000))};
const key=(t,k)=>doc.dispatchEvent(new w.KeyboardEvent(t,{key:k,bubbles:true}));
let held={};const set=(k,on)=>{if(!!held[k]===!!on)return;held[k]=on;key(on?'keydown':'keyup',k)};
const release=()=>['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].forEach(k=>set(k,false));
const SK=parseFloat(process.env.SK||'1');
let hesit=0;
setTimeout(()=>{
  for(let i=0;i<120;i++)frame();                       // attract mode
  
  const cvs=doc.getElementById('c');cvs.getBoundingClientRect=()=>({left:0,top:0,width:320,height:180});
  const pe=new w.Event('pointerdown',{bubbles:true});pe.pointerId=1;pe.clientX=200;pe.clientY=100;cvs.dispatchEvent(pe);
  const pu=new w.Event('pointerup',{bubbles:true});pu.pointerId=1;cvs.dispatchEvent(pu);
  
  let last='',charging=false,chargeStart=0;
  for(let i=0;i<60*420;i++){
    const d=w.__dbg();
    if(d.over){console.log(JSON.stringify({score:d.score,street:d.arena+1,flowers:d.cleaned,t:Math.round(i/60)}));break}
    if(hesit>0){hesit--;release();frame();continue}
    if(Math.random()>SK*.985+.005){hesit=Math.round((1-SK)*30*Math.random());release();frame();continue}
    const m=d.mobs.filter(x=>!x.dead).sort((a,b)=>Math.abs(a.dx)-Math.abs(b.dx))[0];
    const trash=d.cans.filter(c=>c.st!=='flower'&&c.dx<d.scrR);
    const inc=d.cans.find(c=>c.st==='fly'&&c.thrower&&Math.abs(c.dx)<36&&Math.abs(c.dy)<16);
    if(d.charging||charging){                            // hold until full then release
      if(d.charge>=1||i-chargeStart>150){key('keyup','j');charging=false}
      frame();continue;
    }
    if(inc){release();set(inc.dx>0?'ArrowRight':'ArrowLeft',true);frame();release();key('keydown','j');key('keyup','j');frame();continue}
    if(m){                                              // fight: face it, close in, punch
      const want=m.dx>0?26:-26;
      set('ArrowRight',m.dx>want+4);set('ArrowLeft',m.dx<want-4);set('ArrowDown',m.dy>4);set('ArrowUp',m.dy<-4);
      if(Math.abs(m.dx)<30+(1-SK)*26&&Math.abs(m.dx)>8&&Math.abs(m.dy)<10+(1-SK)*14&&i%9===0){release();set(m.dx>0?'ArrowRight':'ArrowLeft',true);frame();release();key('keydown','j');key('keyup','j')}
    }else if(trash.length){                             // clean: line up with a can and charge
      const c=trash.sort((a,b)=>Math.abs(a.dx)-Math.abs(b.dx))[0];
      set('ArrowDown',c.dy>4);set('ArrowUp',c.dy<-4);
      const want=c.dx>0?40:-40;set('ArrowRight',c.dx>want+6&&c.dx>0||c.dx<0&&c.dx>want-6&&false);set('ArrowLeft',c.dx<want-6&&c.dx<0);
      if(Math.abs(c.dy)<6&&Math.abs(c.dx)>20){
        if(d.atk>0){release();frame();continue}
        release();set(c.dx>0?'ArrowRight':'ArrowLeft',true);for(let k=0;k<3;k++)frame();release();frame();
        key('keydown','j');charging=true;chargeStart=i}
      else if(Math.abs(c.dx)<=20){set(c.dx>0?'ArrowLeft':'ArrowRight',true)}
    }else{release();set('ArrowRight',true)}
    frame();
    if(0)console.log('    dbg t='+(i/60)+'s mobs '+d.mobs.map(m=>m.st+'/'+m.hp+'@'+m.dx.toFixed(0)+','+m.dy.toFixed(0)).join(' ')+' cans '+d.cans.map(c=>c.st+'@'+c.dx.toFixed(0)+','+c.dy.toFixed(0)).join(' ')+' charging '+d.charging+' '+d.charge.toFixed(2));
    const line=0&&'street '+(d.arena+1)+' tut '+d.tut+' lives '+d.lives+' '+d.phase+' flowers '+d.cleaned+' mobs '+d.mobs.length+' cans '+d.cans.length+' song '+d.song;
    
  }

  process.exit(0);
},80);
