import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const admin=fs.readFileSync(new URL("../admin/app.js",import.meta.url),"utf8");
const user=fs.readFileSync(new URL("../web/catalog-playback.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../admin/index.html",import.meta.url),"utf8");
const backend=fs.readFileSync(new URL("../web/supabase.js",import.meta.url),"utf8");

function extractFunction(source,name){
  const begin=source.indexOf("  function "+name+"(");
  assert.ok(begin>=0,"Missing "+name);
  const body=source.indexOf("{",begin);
  // Both functions under test have no nested template-literal braces.
  let level=0;
  for(let i=body;i<source.length;i++){
    if(source[i]==="{")level++;
    if(source[i]==="}"&&!--level)return source.slice(begin,i+1).trim();
  }
  throw new Error("Unclosed "+name);
}

const mode=vm.runInNewContext("("+extractFunction(admin,"computeProviderSourceMode")+")");
assert.equal(mode("media-catalog","auto",false),"auto");
assert.equal(mode("media-catalog","manual",false),"manual");
assert.equal(mode("media-catalog","auto",true),"manual","Editing an imported video switches to manual");
assert.equal(mode("media-catalog-anime","manual",false),"manual");
assert.equal(mode("manual","manual",true),"auto","Manual content ignores the catalog override");
console.log("PASS imported video source mode respects administrator edits and reset");

const window={};
vm.runInNewContext(user,{window,URL,AbortController,setTimeout,clearTimeout,Date,console});
const resolver=window.CINARO_CATALOG_PLAYBACK;
const movie={kind:"movie",item:{provider:"media-catalog",providerId:"movie_abc",providerSourceMode:"auto"},sources:[{url:"https://videos.example/working.mp4",type:"video/mp4"}]};
assert.equal(resolver.requestPlan(movie)?.type,"movie");
movie.item.providerSourceMode="manual";
assert.equal(resolver.requestPlan(movie),null,"Manual override must bypass automatic resolver");
assert.equal((await resolver.resolve(movie())).status,"skip","Never contact original provider for manual video");
movie.item.providerSourceMode="auto";
assert.equal(resolver.requestPlan(movie)?.id,"movie_abc","Switching back to automatic restores provider");
const anime={kind:"series",item:{provider:"media-catalog-anime",providerSourceMode:"manual"},episode:{providerEpisodeId:"episode_abc"},sources:[{url:"https://cdn.example/episode.mp4"}]};
assert.equal(resolver.requestPlan(anime),null,"Anime can use administrator override too");
console.log("PASS manual URLs take priority and provider mode is reversible");

assert.match(html,/id="providerSourceMode"/);
assert.match(admin,/movieSourceUrl", "movieBackupUrl/);
assert.match(admin,/manualChecks\.some\(\(check\) => check\.ok\)/);
assert.match(backend,/providerSourceMode: raw\.providerSourceMode === "manual" \? "manual" : "auto"/);
console.log("PASS override stored in admin JSON, user catalog, and visible in editor");

function makeFakeVideo(){
  const events={};
  return {
    preload:"",muted:false,playsInline:false,
    addEventListener(name,callback){(events[name]??=[]).push(callback);},
    removeAttribute(){},load(){},
    fire(name){for(const cb of events[name]||[])cb();}
  };
}

async function simulateProbe(kind){
  const handlers={};
  let timer;
  const video=makeFakeVideo();
  class Hls {
    static isSupported(){return true;}
    static Events={MANIFEST_PARSED:"manifest",ERROR:"error",MEDIA_ATTACHED:"attached"};
    on(name,handler){handlers[name]=handler;}
    attachMedia(){}
    loadSource(){}
    destroy(){}
  }
  const mpegHandlers={};
  const mpegRuntime={
    isSupported:()=>true,
    Events:{ERROR:"error"},
    createPlayer(){return{on:(name,cb)=>mpegHandlers[name]=cb,attachMediaElement(){},load(){},unload(){},detachMediaElement(){},destroy(){}}}
  };
  const context={
    asString:(v)=>String(v||""),
    normalizeStorageId:()=>"",
    playbackInputUrl:(v)=>v,
    inferMediaType:()=>kind,
    adminNativePlayerAvailable:()=>false,
    document:{createElement:()=>video},
    window:{Hls,mpegts:mpegRuntime,setTimeout:(cb)=>{timer=cb;return 1;},clearTimeout:()=>{}},
    Promise,console
  };
  const fn=vm.runInNewContext("("+extractFunction(admin,"probePlaybackUrl")+")",context);
  let settled=false;
  const pending=fn("https://cdn.example/clip."+(kind.includes("mpegurl")?"m3u8":"ts")).then(v=>{settled=true;return v;});
  return {video,handlers,mpegHandlers,hasSettled:()=>settled,pending,timeout:()=>timer?.()};
}

{
  const sim=await simulateProbe("application/vnd.apple.mpegurl");
  sim.handlers.manifest?.();
  await Promise.resolve();
  assert.equal(sim.hasSettled(),false,"Reading HLS manifest must not mean the video works");
  sim.video.fire("loadedmetadata");
  assert.equal((await sim.pending).ok,true);
  console.log("PASS HLS probe waits for real video metadata, not playlist alone");
}
{
  const sim=await simulateProbe("video/mp2t");
  assert.equal(sim.hasSettled(),false,"TS support library alone must not mean video works");
  sim.mpegHandlers.error?.();
  assert.equal((await sim.pending).ok,false);
  console.log("PASS TS playback errors fail validation before publication");
}
