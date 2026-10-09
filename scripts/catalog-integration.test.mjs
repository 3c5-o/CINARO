import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const resolverCode=fs.readFileSync(new URL("../web/catalog-playback.js",import.meta.url),"utf8");
const appCode=fs.readFileSync(new URL("../web/app.js",import.meta.url),"utf8");
const backend=fs.readFileSync(new URL("../web/supabase.js",import.meta.url),"utf8");

function getResolver(){
  const window={};
  vm.runInNewContext(resolverCode,{
    window,URL,AbortController,setTimeout,clearTimeout,Date,console
  });
  return window.CINARO_CATALOG_PLAYBACK;
}
function movie(sources=[{url:"https://video.example/a.ts"}],id="movie_test123"){
  return {kind:"movie",sources,item:{
    provider:"media-catalog",providerId:id,
    providerBaseUrl:"https://media-catalog-navy.vercel.app/api/v1"
  }};
}
function episode(sourceUrl="https://video.example/a.ts"){
  return {kind:"series",sources:[{url:sourceUrl,type:"video/mp2t"}],
    episode:{providerEpisodeId:"episode_test456"},
    item:{provider:"media-catalog-anime",providerId:"anime_s1",
      providerBaseUrl:"https://media-catalog-navy.vercel.app/api/v1/anime"}};
}

const resolver=getResolver();
assert.equal(resolver.requestPlan(movie()).type,"movie");
assert.equal(resolver.requestPlan(episode(),false).type,"episode");
assert.equal(resolver.requestPlan(episode(),true),null,"Android TS must keep native playback");
assert.equal(resolver.requestPlan(movie([{storageId:"CIN-M-ABCDEFGHIJ"}])),null,"Telegram Storage is not a catalog stream");
assert.equal(resolver.requestPlan({kind:"movie",sources:[],item:{provider:"manual",providerId:"movie_x"}}),null);
console.log("PASS catalog provenance, anime episode ID and native/Telegram bypass");

{
  const media=movie();
  const mockFetch=async(url,opts)=>{
    const u=new URL(url);
    assert.equal(u.origin,"https://media-catalog-navy.vercel.app");
    assert.equal(u.pathname,"/api/v1/playback");
    assert.equal(u.searchParams.get("id"),"movie_test123");
    assert.equal(u.searchParams.get("fresh"),"1");
    assert.equal(opts.cache,"no-store");
    return {ok:true,json:async()=>({ok:true,type:"movie",id:"movie_test123",available:true,
      selected:{url:"https://cdn.example/safe.mp4",format:"mp4"},verified_full_playback:false})};
  };
  const success=await resolver.resolve(media,{fetch:mockFetch});
  assert.equal(success.status,"ready");
  assert.equal(success.sources.length,1);
  assert.equal(success.sources[0].url,"https://cdn.example/safe.mp4");
  assert.equal(success.sources[0].type,"video/mp4");
  assert.equal(success.verifiedFullPlayback,false);
  console.log("PASS old provider TS replaced with verified-byte MP4 candidate");
}

{
  const response=async()=>({ok:true,json:async()=>({ok:true,type:"movie",id:"movie_test123",
    available:false,selected:null,candidates:[{issues:["hls_child_non_video"]}]})});
  const unavailable=await resolver.resolve(movie(),{fetch:response});
  assert.equal(unavailable.status,"unavailable");
  assert.ok(unavailable.issues.includes("hls_child_non_video"));
  console.log("PASS resolver refuses to auto-play known broken HLS");
}

{
  const badSelection=resolver.sourceFromSelection({url:"javascript:alert(1)",format:"mp4"});
  assert.equal(badSelection,null);
  assert.equal(resolver.sourceFromSelection({url:"https://example.org/cat.png",format:"png"}),null);
  await assert.rejects(resolver.resolve(movie(),{fetch:async()=>({ok:true,json:async()=>({
    ok:true,type:"movie",id:"movie_wrong",available:true,
    selected:{url:"https://cdn.example/safe.mp4",format:"mp4"}
  })})}),/media_catalog_invalid_response/);
  assert.equal(resolver.requestPlan(movie([{url:"https://video.example/a.mp4"}],"movie_test123")).apiBase,
    "https://media-catalog-navy.vercel.app/api/v1");
  const overridden=movie();
  overridden.item.providerBaseUrl="http://insecure.example/api/v1";
  assert.equal(resolver.requestPlan(overridden).apiBase,"https://media-catalog-navy.vercel.app/api/v1");
  console.log("PASS invalid resolver data, unsafe URLs and insecure API bases are rejected");
}

{
  // Exercise the real watch-page async completion guard: a late network result
  // from a previous route must never start playback on a different title.
  const signature="  async function resolveCatalogPlayerSources(media, serial) {";
  const start=appCode.indexOf(signature);
  const end=appCode.indexOf("\n  }\n",start);
  assert.ok(start>0&&end>start);
  const fn=vm.runInNewContext("("+appCode.slice(start+2,end+4)+")",{
    window:{CINARO_CATALOG_PLAYBACK:{resolve:async()=>({status:"ready",sources:[{url:"https://cdn.example/play.mp4"}]})}},
    nativePlayerAvailable:()=>false,
    player:{resolveSerial:2,media:null,root:{hidden:false},
      resolvingCatalog:false,loading:{hidden:false},error:{hidden:true},failedSources:new Set()},
    showPlayerError:()=>{throw new Error("Stale route displayed an error")},
    populateQualityOptions:()=>{throw new Error("Stale route changed quality")},
    loadPlayerSource:()=>{throw new Error("Stale route started video")},
    console
  });
  const older={key:"old",sources:[],item:{id:"old"}};
  await fn(older,1);
  console.log("PASS late playback resolution cannot open a previous title");
}

assert.ok(backend.includes("providerEpisodeId:")&&backend.includes("providerBaseUrl:"));
assert.ok(appCode.includes("player.resolveSerial = (player.resolveSerial || 0) + 1;"));
assert.ok(appCode.includes("resolveCatalogPlayerSources(media, player.resolveSerial)"));
console.log("PASS user catalog metadata and player route safeguards are wired");
