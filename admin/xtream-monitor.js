(function(){
"use strict";
const $=(id)=>document.getElementById(id);
const n=(tag,cls,text)=>{
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(text!=null)el.textContent=String(text);
  return el;
};
const number=(v)=>typeof v==="number"&&Number.isFinite(v)&&v>=0?new Intl.NumberFormat("ar-IQ").format(v):"—";
const when=(v)=>{const t=Date.parse(v||"");return Number.isFinite(t)?new Intl.DateTimeFormat("ar-IQ",{dateStyle:"medium",timeStyle:"short"}).format(t):"غير محدد";};
const remain=(v)=>{
  const t=Date.parse(v||"");
  if(!Number.isFinite(t))return "غير معلوم";
  const days=Math.ceil((t-Date.now())/86400000);
  return days<0?"منتهي منذ "+number(Math.abs(days))+" يوم":days===0?"ينتهي اليوم":"متبقي "+number(days)+" يوم";
};
const statuses={
  online:["متصل","published"],partial:["بيانات جزئية","draft"],
  disabled:["معطّل","draft"],inactive:["غير نشط","draft"],
  error:["خطأ اتصال","draft"]
};
const errors={
  provider_catalog_incomplete:"لم تصل جميع قوائم الأفلام والمسلسلات والقنوات.",
  provider_auth_invalid:"المزوّد لم يقبل معلومات هذا الحساب.",
  provider_list_too_large:"قائمة المحتوى تتجاوز حد الفحص الآمن.",
  provider_host_unreachable:"اسم خادم المزوّد غير متاح أو غير عام.",
  public_https_required:"المزوّد يحتاج عنوان HTTPS عامًا.",
  provider_connection_failed:"تعذر الاتصال بخادم المزوّد.",
  provider_invalid_json:"المزوّد لم يرجع بيانات صحيحة."
};
function metric(container,title,value){
  const box=n("div","");
  box.append(n("span","",title),n("b","",value));
  container.append(box);
}
function itemLine(list,title,value){
  const row=n("div",""),dt=n("dt","",title),dd=n("dd","",value);
  row.append(dt,dd);list.append(row);
}
function accountCard(a){
  const sub=a.subscription||{}, c=a.counts||{}, holder=n("article","panel xtream-account");
  const head=n("div","xtream-account-head"),name=n("div","");
  name.append(n("h3","",a.name||a.id||"حساب"),n("small","",a.host||"عنوان الخادم غير متاح"));
  const status=statuses[a.health]||["غير معروف","draft"];
  head.append(name,n("span","status-chip "+status[1],status[0]));
  holder.append(head);
  const counts=n("div","xtream-account-counts");
  metric(counts,"الأفلام",number(c.movies));
  metric(counts,"المسلسلات",number(c.series));
  metric(counts,"الأنمي *",number(c.anime));
  metric(counts,"البث المباشر — عدد فقط",number(c.live));
  holder.append(counts);
  const details=n("dl","xtream-details");
  itemLine(details,"حالة الاشتراك",sub.status||"غير معلوم");
  itemLine(details,"انتهاء الصلاحية",when(sub.expiresAt));
  itemLine(details,"الوقت المتبقي",remain(sub.expiresAt));
  itemLine(details,"تاريخ الإنشاء",when(sub.createdAt));
  itemLine(details,"الاتصالات الحالية / الحد",number(sub.activeConnections)+" / "+number(sub.maxConnections));
  itemLine(details,"نوع الحساب",sub.status?(sub.trial?"تجريبي":"عادي"):"غير معلوم");
  itemLine(details,"الصيغ المتاحة",Array.isArray(sub.allowedFormats)?sub.allowedFormats.join("، ")||"غير معروف":"غير معروف");
  itemLine(details,"توقيت الخادم",sub.serverTime||"غير متاح");
  itemLine(details,"منطقة الخادم الزمنية",sub.serverTimezone||"غير متاحة");
  itemLine(details,"تصنيفات الأفلام / المسلسلات",number(c.categories?.movie)+" / "+number(c.categories?.series));
  itemLine(details,"آخر فحص",when(a.checkedAt));
  itemLine(details,"استغرق الفحص",number(a.latencyMs)+" مللي ثانية");
  holder.append(details);
  if(a.error)holder.append(n("p","xtream-account-error",errors[a.error]||"تعذر إكمال الفحص."));
  return holder;
}
let working=false;
async function load({gateway,token,fresh=false}={}){
  if(working)return;
  working=true;
  const refresh=$("xtreamRefresh");
  if(refresh)refresh.disabled=true;
  if($("xtreamNotice"))$("xtreamNotice").textContent="جاري قراءة حالة الحسابات...";
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),65000);
  try{
    if(!token)throw Error("انتهت جلسة الإدارة. سجّل دخولك من جديد.");
    const url=String(gateway||"").replace(/\/+$/,"")+"/admin/xtream/accounts"+(fresh?"?fresh=true":"");
    if(!url.startsWith("https://"))throw Error("بوابة المراقبة تحتاج اتصال HTTPS.");
    const res=await fetch(url,{headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store",signal:controller.signal});
    if(res.status===401||res.status===403)throw Error("هذا القسم متاح للمدير الأساسي فقط.");
    if(!res.ok)throw Error(res.status===404?"لم يتم نشر خدمة Xtream بعد.":"تعذّر قراءة بيانات المراقبة: HTTP "+res.status);
    const data=await res.json();
    if(data?.ok!==true||!Array.isArray(data.accounts))throw Error("استجابة غير صحيحة من بوابة المراقبة.");
    const accounts=data.accounts,good=accounts.filter((a)=>a.health==="online"&&a.counts);
    for(const [id,key] of [["xtreamMovies","movies"],["xtreamSeries","series"],["xtreamAnime","anime"],["xtreamLive","live"]]){
      const target=$(id);
      if(target)target.textContent=good.length?number(good.reduce((sum,a)=>sum+(Number(a.counts[key])||0),0)):"—";
    }
    if($("xtreamAccountTotal"))$("xtreamAccountTotal").textContent=number(accounts.length)+" حساب";
    if($("xtreamLastCheck"))$("xtreamLastCheck").textContent="آخر قراءة "+when(new Date().toISOString())+(data.cached?" · مخزنة":" · فحص مباشر");
    if($("xtreamNotice"))$("xtreamNotice").textContent=accounts.length?
      "البيانات للقراءة فقط؛ الأرقام مجموع الحسابات وقد تشمل محتوى مكررًا.":"لا توجد حسابات مهيأة بعد. أضف بياناتها السرية إلى Railway ولا تضع كلمات المرور في التطبيق.";
    const root=$("xtreamAccounts");
    if(root){
      root.replaceChildren();
      if(accounts.length)accounts.forEach((a)=>root.append(accountCard(a)));
      else root.append(n("div","panel xtream-empty","لم تُضف حسابات Xtream على الخادم بعد. اضبط XTREAM_MONITOR_ACCOUNTS_JSON ثم اضغط تحديث الفحص."));
    }
  }catch(e){
    if($("xtreamNotice"))$("xtreamNotice").textContent=e?.name==="AbortError"?"انتهت مهلة الفحص. حاول مجدداً.":e.message||"تعذر الاتصال.";
    if($("xtreamAccounts"))$("xtreamAccounts").replaceChildren(n("div","panel xtream-empty","تعذرت قراءة الحسابات. لا تُعرض أعداد تقديرية أو غير مؤكدة."));
  }finally{
    clearTimeout(timer);working=false;
    if(refresh)refresh.disabled=false;
  }
}
window.CINARO_XTREAM_MONITOR={load};
})();