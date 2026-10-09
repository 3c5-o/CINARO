(function(){
"use strict";
const $=id=>document.getElementById(id);
const text=value=>String(value==null?"":value).trim();
const asNumber=value=>Number.isFinite(Number(value))?Number(value):0;
const gatewayApi="/admin/xtream/";
let context=null,active=false,cancelled=false;
const state={processed:0,added:0,duplicates:0,failed:0,tmdbMissing:0,episodes:0,total:0,cursor:0,errors:[]};

function status(message,bad=false){
  const el=$("xtreamImportMessage");
  if(el){el.textContent=message;el.dataset.status=bad?"error":"active";}
}
function progress(){
  if($("xtreamImportStats"))$("xtreamImportStats").textContent=
    "تمت معالجة "+state.processed+"/"+state.total+" · أضيف "+state.added+
    " · مكرر "+state.duplicates+" · فشل "+state.failed+
    " · حلقات "+state.episodes+" · بدون TMDb "+state.tmdbMissing;
  if($("xtreamImportProgress"))$("xtreamImportProgress").value=state.total?Math.min(100,Math.round(state.processed/state.total*100)):0;
  if($("xtreamImportFailures"))$("xtreamImportFailures").textContent=state.errors.slice(-8).join("\n");
}
function cursorKey(account,kind){return "cinaro:xtream-import:v1:"+account+":"+kind;}
function getCursor(account,kind){
  try{return Math.max(0,Math.floor(asNumber(localStorage.getItem(cursorKey(account,kind)))));}catch{return 0;}
}
function setCursor(account,kind,cursor){
  try{localStorage.setItem(cursorKey(account,kind),String(cursor));}catch{}
}
function gatewayOrigin(){
  if(!context)throw Error("سجّل دخولك كمالك في الإدارة.");
  const target=new URL(context.gateway);
  if(target.protocol!=="https:")throw Error("لا يمكن استخدام بوابة غير مشفّرة.");
  return target.origin;
}
async function api(endpoint,params={}){
  if(!context?.token)throw Error("جلسة المالك منتهية، سجّل دخولك مرة أخرى.");
  const url=new URL(gatewayApi+endpoint,gatewayOrigin());
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  const response=await fetch(url.toString(),{
    headers:{Authorization:"Bearer "+context.token,Accept:"application/json"},
    cache:"no-store"
  });
  let body={};
  try{body=await response.json();}catch{}
  if(!response.ok)throw Error("Xtream "+response.status+": "+text(body.detail||"تعذّر الاتصال بالمصدر."));
  return body;
}
function sourceFromGateway(candidate){
  const path=text(candidate?.path);
  if(!path.startsWith("/xtream/play/")||!path.includes("?sig="))throw Error("رابط تشغيل غير صالح من البوابة.");
  const url=new URL(path,gatewayOrigin());
  if(url.origin!==gatewayOrigin())throw Error("مصدر التشغيل خارج بوابة CINARO.");
  return {label:"Xtream",url:url.href,type:text(candidate?.type)||"video/mp4"};
}
function normalizeName(value){
  return text(value).normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g,"").replace(/\b(19|20)\d{2}\b/g,"")
    .replace(/\b(4k|1080p|720p|web-dl|bluray|hdtv|dubbed|subbed)\b/g,"")
    .replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/\s+/g," ");
}
function tmdbTitle(value){return text(value).replace(/\s*[\[({].*?[\])}]\s*/g," ").replace(/\s+(?:S\d+|Season\s*\d+)$/i,"").trim();}
async function tmdbJson(path,query={}){
  const token=text(context?.tmdbToken);
  if(!token)throw Error("أضف TMDb Read Access Token من إعدادات CINARO أولاً.");
  const url=new URL("https://api.themoviedb.org/3"+path);
  Object.entries(query).forEach(([key,value])=>url.searchParams.set(key,String(value)));
  const response=await fetch(url.toString(),{
    headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store"
  });
  if(response.status===429)throw Error("TMDb أرجع 429. حاول لاحقاً لإكمال الدفعة.");
  if(response.status===401)throw Error("TMDb Token غير صالح.");
  if(!response.ok)throw Error("TMDb HTTP "+response.status);
  return response.json();
}
async function enrich(item){
  const namespace=item.kind==="movie"?"movie":"tv";
  const name=tmdbTitle(item.title);
  let id=asNumber(item.tmdbId);
  if(!id){
    const search=await tmdbJson("/search/"+namespace,{
      query:name,language:"en-US",include_adult:"false",page:1
    });
    const normalized=normalizeName(name),year=asNumber(item.year);
    const exact=(Array.isArray(search.results)?search.results:[]).find(row=>{
      const names=[row.title,row.name,row.original_title,row.original_name].map(normalizeName);
      const release=asNumber(text(row.release_date||row.first_air_date).slice(0,4));
      return names.some(candidate=>candidate===normalized || (candidate.length>5 && normalized===candidate))
        && (!year || !release || Math.abs(year-release)<=2);
    });
    if(exact)id=asNumber(exact.id);
  }
  if(!id)return null;
  const d=await tmdbJson("/"+namespace+"/"+id,{language:"ar-IQ"});
  const title=text(d.title||d.name||d.original_title||d.original_name)||item.title;
  return {
    id, title,englishTitle:text(d.original_title||d.original_name),
    description:text(d.overview),year:asNumber(text(d.release_date||d.first_air_date).slice(0,4)),
    rating:Math.max(0,Math.min(10,asNumber(d.vote_average))),
    genres:Array.isArray(d.genres)?d.genres.map(g=>text(g.name)).filter(Boolean).slice(0,12):[],
    duration:asNumber(d.runtime||(Array.isArray(d.episode_run_time)?d.episode_run_time[0]:0)),
    poster:d.poster_path?"https://image.tmdb.org/t/p/w500"+d.poster_path:"",
    backdrop:d.backdrop_path?"https://image.tmdb.org/t/p/w1280"+d.backdrop_path:""
  };
}
async function enrichEpisodeMetadata(seasons,tmdbId){
  if(!tmdbId||!Array.isArray(seasons))return seasons;
  for(const season of seasons){
    try{
      const tmdb=await tmdbJson("/tv/"+tmdbId+"/season/"+season.number,{language:"ar-IQ"});
      const byNumber=new Map((Array.isArray(tmdb.episodes)?tmdb.episodes:[])
        .map(episode=>[Number(episode.episode_number),episode]));
      for(const episode of season.episodes){
        const data=byNumber.get(Number(episode.number));
        if(!data)continue;
        if(text(data.name))episode.title=text(data.name).slice(0,150);
        if(asNumber(data.runtime)>0)episode.duration=asNumber(data.runtime);
        if(data.still_path)episode.thumbnail="https://image.tmdb.org/t/p/w780"+data.still_path;
      }
      if(text(tmdb.name))season.title=text(tmdb.name).slice(0,120);
    }catch(error){
      // Episode list remains complete from Xtream even when TMDb lacks
      // episode artwork/translations for a particular season.
      if(String(error.message||"").includes("429"))throw error;
    }
  }
  return seasons;
}
function fallbackPoster(row){
  const raw=text(row.poster);
  if(/^https:\/\//i.test(raw))return raw;
  return "https://3c5-o.github.io/CINARO/web/assets/images/poster-placeholder.webp";
}
function buildPayload(item,info,detail){
  const id=("xt-"+item.accountId+"-"+item.kind+"-"+item.id).toLowerCase();
  const poster=info?.poster||fallbackPoster(item);
  const seasons=item.kind==="series"?(Array.isArray(detail.seasons)?detail.seasons:[]):[];
  if(item.kind==="series" && (!seasons.length || seasons.some(season=>!Array.isArray(season.episodes)||!season.episodes.length)))
    throw Error("المسلسل لا يحتوي جميع مواسمه وحلقاته.");
  const normalizedSeasons=seasons.map(season=>({
    number:asNumber(season.number),title:text(season.title),
    episodes:season.episodes.map(episode=>({
      id:text(episode.id),number:asNumber(episode.number),
      title:text(episode.title),duration:asNumber(episode.duration),
      thumbnail:info?.backdrop||poster,
      sources:(episode.sources||[]).map(sourceFromGateway),subtitles:[]
    }))
  }));
  const sources=item.kind==="movie"?(detail.sources||[]).map(sourceFromGateway):[];
  if(item.kind==="movie"&&!sources.length)throw Error("الفيلم لا يحتوي رابط تشغيل.");
  const type=item.contentType==="anime"?"anime":item.kind;
  const section=type==="movie"?"movies":type==="anime"?"anime":"series";
  return {
    id,kind:item.kind,contentType:type,title:info?.title||item.title,
    englishTitle:info?.englishTitle||"",year:info?.year||asNumber(item.year)||new Date().getFullYear(),
    rating:info?.rating||0,ageRating:"عام",duration:info?.duration||0,
    genres:info?.genres?.length?info.genres:["عام"],
    sectionIds:[section],managementSectionId:section,
    description:info?.description||"المعلومات متوفرة عبر مزوّد Xtream.",
    poster,backdrop:info?.backdrop||poster,
    sources,subtitles:[],seasons:normalizedSeasons,
    views:0,order:0,featured:false,published:true,
    tmdbId:info?.id||0,tmdbType:item.kind==="movie"?"movie":"tv",
    tmdbImportedAt:info?.id?Date.now():0,
    provider:"xtream",providerId:item.accountId+":"+item.kind+":"+item.id,
    providerSourceMode:"auto",providerImportedAt:Date.now(),
    addedAt:new Date().toISOString().slice(0,10),
    updatedBy:text(context?.uid)
  };
}
async function start(){
  if(active)return;
  if(!context?.save) {status("افتح صفحة Xtream بعد تسجيل الدخول كمالك.",true);return;}
  const account=$("xtreamImportAccount")?.value,kind=$("xtreamImportKind")?.value||"all";
  if(!account){status("اختر حساب Xtream أولاً.",true);return;}
  if(!text(context.tmdbToken)){status("أضف TMDb Read Access Token من إعدادات الإدارة أولاً.",true);return;}
  if(!window.confirm("سيتم استيراد حتى 100 عنصر من الحساب المختار. كل مسلسل يُحفظ بمواسمه وحلقاته كاملة قبل التالي، وسيُنشر بعد الحفظ. تأكد أن لديك حق استخدام المحتوى. متابعة؟"))return;
  active=true;cancelled=false;
  const startBtn=$("xtreamImportStart");
  if(startBtn)startBtn.disabled=true;
  if($("xtreamImportCancel"))$("xtreamImportCancel").hidden=false;
  Object.assign(state,{processed:0,added:0,duplicates:0,failed:0,tmdbMissing:0,episodes:0,total:0,cursor:0,errors:[]});
  try{
    const cursor=getCursor(account,kind);
    const result=await api("catalog",{account,kind,cursor,limit:100});
    const items=Array.isArray(result.items)?result.items:[];
    state.total=items.length;state.cursor=cursor;progress();
    if(!items.length){status("ماكو عناصر أخرى. تقدر تعيد المؤشر من البداية إذا تريد إعادة الفحص.");return;}
    const known=Array.isArray(context.listContent?.())?context.listContent():[];
    const providerSet=new Set(known.filter(p=>p.provider==="xtream").map(p=>text(p.providerId)));
    const ids=new Set(known.map(p=>p.id));
    const tmdbKeys=new Set(known.filter(p=>p.tmdbId).map(p=>(p.kind==="movie"?"movie":"series")+":"+p.tmdbId));
    for(const item of items){
      if(cancelled)break;
      try{
        const providerId=item.accountId+":"+item.kind+":"+item.id;
        const generatedId=("xt-"+item.accountId+"-"+item.kind+"-"+item.id).toLowerCase();
        if(providerSet.has(providerId)||ids.has(generatedId)){
          state.duplicates++;
        }else{
          status("TMDb وXtream: "+(state.processed+1)+"/"+items.length+" — "+text(item.title));
          const info=await enrich(item);
          const matchedKey=info?(item.kind==="movie"?"movie":"series")+":"+info.id:"";
          if(matchedKey&&tmdbKeys.has(matchedKey)){state.duplicates++;}
          else{
            const detail=await api("detail",{account:item.accountId,kind:item.kind,media_id:item.id,extension:item.extension||"mp4"});
            const payload=buildPayload(item,info,detail);
            if(item.kind==="series"&&info?.id)await enrichEpisodeMetadata(payload.seasons,info.id);
            // Atomic per-title upsert: all episodes are in one Supabase record.
            await context.save(payload);
            providerSet.add(providerId);ids.add(payload.id);
            if(matchedKey)tmdbKeys.add(matchedKey);
            if(!info)state.tmdbMissing++;
            state.added++;
            state.episodes+=payload.seasons.reduce((n,s)=>n+s.episodes.length,0);
          }
        }
      }catch(error){
        state.failed++;
        state.errors.push(text(item.title)+": "+text(error.message||error));
      }
      state.processed++;
      setCursor(account,kind,cursor+state.processed);
      progress();
      // Give the browser time to repaint and avoid hammering TMDb.
      await new Promise(resolve=>setTimeout(resolve,140));
    }
    status(cancelled?
      "تم إيقاف الدفعة، ويمكن إكمالها من آخر عنصر.":
      "اكتملت الدفعة. أضيف "+state.added+"، مكرر "+state.duplicates+"، فشل "+state.failed+"، والحلقات "+state.episodes+
      ". "+(result.hasMore?"اضغط إضافة 100 أخرى للدفعة التالية.":"انتهى الكتالوج."),
      state.failed>0);
  }catch(error){status(text(error.message||error),true);}
  finally{
    active=false;progress();
    if(startBtn)startBtn.disabled=false;
    if($("xtreamImportCancel"))$("xtreamImportCancel").hidden=true;
  }
}
function configure(value){context=value;}
function accountsChanged(accounts){
  const select=$("xtreamImportAccount");if(!select)return;
  const old=select.value;
  select.replaceChildren();
  const intro=document.createElement("option");intro.value="";intro.textContent="اختر حساباً";select.append(intro);
  (Array.isArray(accounts)?accounts:[]).filter(a=>a.enabled).forEach(account=>{
    const option=document.createElement("option");option.value=text(account.id);option.textContent=text(account.name);select.append(option);
  });
  if([...select.options].some(o=>o.value===old))select.value=old;
}
$("xtreamImportStart")?.addEventListener("click",start);
$("xtreamImportCancel")?.addEventListener("click",()=>{cancelled=true;status("سيتم الإيقاف بعد حفظ العنصر الحالي...");});
$("xtreamImportReset")?.addEventListener("click",()=>{
  if(active)return;
  const account=$("xtreamImportAccount")?.value,kind=$("xtreamImportKind")?.value||"all";
  if(!account)return;
  if(window.confirm("إعادة المؤشر إلى أول الكتالوج؟ المحتوى المنشور لن يُحذف وسيتم تخطي المكرر.")){
    setCursor(account,kind,0);status("تم إعادة المؤشر للبداية.");
  }
});
window.CINARO_XTREAM_IMPORT={configure,accountsChanged};
})();
