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
  error:["خطأ اتصال","draft"],expired:["اشتراك منتهي","draft"]
};
const errors={
  provider_catalog_incomplete:"لم تصل جميع قوائم الأفلام والمسلسلات والقنوات.",
  provider_auth_invalid:"المزوّد لم يقبل معلومات هذا الحساب.",
  provider_list_too_large:"قائمة المحتوى تتجاوز حد الفحص الآمن.",
  provider_host_unreachable:"اسم خادم المزوّد غير متاح أو غير عام.",
  invalid_public_provider_url:"عنوان المزوّد يجب أن يكون HTTP أو HTTPS عاماً، وليس عنوان شبكة داخلية.",
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
let credentials={gateway:"",token:""};
let managed=[];
const msg=(text)=>{if($("xtreamAccountMessage"))$("xtreamAccountMessage").textContent=text;};
function resetAccountForm(){
  if($("xtreamAccountForm"))$("xtreamAccountForm").reset();
  if($("xtreamEditId"))$("xtreamEditId").value="";
  if($("xtreamAccountEnabled"))$("xtreamAccountEnabled").checked=true;
  msg("");
}
async function callApi(endpoint,method="GET",payload){
  if(!credentials.token || !/^https:\/\//.test(credentials.gateway))throw Error("جلسة الإدارة غير متاحة أو بوابة Xtream غير مهيأة. سجّل دخولك مجدداً.");
  const response=await fetch(credentials.gateway.replace(/\/+$/,"")+"/admin/xtream/"+endpoint,{
    method,cache:"no-store",
    headers:{Authorization:"Bearer "+credentials.token,Accept:"application/json",...(payload?{"Content-Type":"application/json"}:{})},
    ...(payload?{body:JSON.stringify(payload)}:{})
  });
  if(!response.ok){
    let code="";
    try{const body=await response.json();code=String(body.detail||"");}catch{}
    const messages={
      db_accounts_unavailable:"تعذّر قراءة حسابات Xtream من قاعدة البيانات. تحقق من عنوان ومفتاح Supabase على Railway.",
      invalid_name_or_public_url:"تحقق من اسم الحساب وعنوان HTTP أو HTTPS العام.",
      http_requires_consent:"فعّل الموافقة على استخدام HTTP غير المشفّر عند إضافة أو تغيير رابط السيرفر.",
      invalid_public_host:"تعذّر تأكيد عنوان الخادم العام.",
      account_not_found:"هذا الحساب لم يعد موجوداً.",
      credentials_required:"اسم المستخدم وكلمة المرور مطلوبان للإضافة.",
      account_limit_reached:"وصلت إلى الحد الأعلى (25 حساباً).",
      admin_access_denied:"تم رفض طلب البوابة. تحقق من اتصال Railway بمشروع Supabase الجديد ومن جلسة المالك.",
      account_has_linked_content:"لا يمكن حذف الحساب لأن محتوى منشوراً أو مسودة مرتبط به. أوقف الحساب بدلاً من حذفه للحفاظ على روابط الأفلام والحلقات.",
      content_dependency_check_failed:"تعذر التحقق من المحتوى المرتبط، ولذلك أُلغي الحذف لحماية المكتبة."
    };
    throw Error(messages[code]||"فشلت العملية: "+(code||"HTTP "+response.status));
  }
  return response.json();
}
function showManaged(list){
  managed=Array.isArray(list)?list:[];
  const root=$("xtreamManagedAccounts");
  if(!root)return;
  root.replaceChildren();
  if(!managed.length){root.append(n("p","xtream-empty","لا توجد حسابات مسجلة. أضف حساباً من النموذج أعلاه."));return;}
  for(const entry of managed){
    const row=n("div","xtream-managed-row"),desc=n("div","xtream-managed-description");
    desc.append(n("b","",entry.name),n("small","",entry.url));
    const actions=n("div","xtream-managed-actions");
    const edit=n("button","admin-button ghost","تعديل");
    edit.type="button";edit.dataset.xtreamAction="edit";edit.dataset.id=entry.id;
    const toggle=n("button","admin-button ghost",entry.enabled?"إيقاف":"تشغيل");
    toggle.type="button";toggle.dataset.xtreamAction="toggle";toggle.dataset.id=entry.id;
    const remove=n("button","admin-button ghost","حذف");
    remove.type="button";remove.dataset.xtreamAction="delete";remove.dataset.id=entry.id;
    actions.append(edit,toggle,remove);row.append(desc,actions);root.append(row);
  }
}
async function refreshManaged(){
  const result=await callApi("manage");
  if(result.ok!==true||!Array.isArray(result.accounts))throw Error("تعذرت قراءة الحسابات.");
  showManaged(result.accounts);
  window.CINARO_XTREAM_IMPORT?.accountsChanged(result.accounts);
}
async function changeAccount(method,id,payload){
  const endpoint="manage"+(id?"/"+encodeURIComponent(id):"");
  await callApi(endpoint,method,payload);
  resetAccountForm();
  await refreshManaged();
  if(credentials.token)await load({...credentials,fresh:true});
}
// Recover a mismatched cached HTML shell without relying on a hard reload.
// An updated JS file can reach mobile browsers before the old PWA page is replaced.
function ensureHttpConsentControl(){
  const input=$("xtreamAccountUrl"), form=$("xtreamAccountForm");
  if(!input||!form)return;
  const label=input.closest("label");
  const title=label?.querySelector("span");
  if(title && /HTTPS/.test(title.textContent||"") && !/HTTP/.test((title.textContent||"").replace("HTTPS","")))
    title.textContent="عنوان سيرفر Xtream (HTTPS أو HTTP)";
  if($("xtreamAllowHttp"))return;
  const approval=document.createElement("label");
  approval.className="check-field";
  const checkbox=document.createElement("input");
  checkbox.type="checkbox";
  checkbox.id="xtreamAllowHttp";
  const caption=document.createElement("span");
  caption.textContent="أوافق على استخدام HTTP غير المشفّر لهذا المصدر";
  approval.append(checkbox,caption);
  const warning=document.createElement("p");
  warning.className="field-help";
  warning.textContent="عند استخدام HTTP تكون بيانات دخول Xtream غير مشفّرة بين بوابة CINARO والمزوّد. يفضّل HTTPS.";
  const enabled=$("xtreamAccountEnabled")?.closest("label");
  if(enabled){enabled.insertAdjacentElement("afterend",approval);approval.insertAdjacentElement("afterend",warning);}
  else {form.append(approval,warning);}
}
function bindManagement(){
  $("xtreamAccountCancel")?.addEventListener("click",resetAccountForm);
  $("xtreamAccountForm")?.addEventListener("submit",async(event)=>{
    event.preventDefault();
    const form=event.currentTarget,id=$("xtreamEditId")?.value||"";
    const payload={
      name:$("xtreamAccountName")?.value.trim()||"",
      url:$("xtreamAccountUrl")?.value.trim()||"",
      enabled:$("xtreamAccountEnabled")?.checked===true,
      allowHttp:$("xtreamAllowHttp")?.checked===true
    };
    const username=$("xtreamAccountUsername")?.value||"";
    const password=$("xtreamAccountPassword")?.value||"";
    if(!id||username)payload.username=username;
    if(!id||password)payload.password=password;
    if(/^http:\/\//i.test(payload.url)&&!payload.allowHttp && !id){
      msg("لاستخدام HTTP لازم تفعّل خانة الموافقة على الاتصال غير المشفّر.");
      return;
    }
    try{
      if($("xtreamAccountSave"))$("xtreamAccountSave").disabled=true;
      msg("جاري حفظ الحساب بأمان…");
      await changeAccount(id?"PATCH":"POST",id,payload);
      msg("تم حفظ الحساب. يمكنك الآن متابعته.");
    }catch(e){msg(e.message||"تعذّر حفظ الحساب.");}
    finally{if($("xtreamAccountSave"))$("xtreamAccountSave").disabled=false;}
  });
  $("xtreamManagedAccounts")?.addEventListener("click",async(event)=>{
    const btn=event.target.closest("[data-xtream-action]");
    if(!btn)return;
    const entry=managed.find(item=>item.id===btn.dataset.id);
    if(!entry)return;
    const action=btn.dataset.xtreamAction;
    if(action==="edit"){
      $("xtreamEditId").value=entry.id;
      $("xtreamAccountName").value=entry.name||"";
      $("xtreamAccountUrl").value=entry.url||"";
      $("xtreamAccountUsername").value="";
      $("xtreamAccountPassword").value="";
      $("xtreamAccountEnabled").checked=entry.enabled===true;
      msg("تعديل "+entry.name+": اترك بيانات الدخول فارغة إذا ما تريد تغييرها.");
      $("xtreamAccountName").focus();
      return;
    }
    if(action==="delete"&&!confirm("حذف حساب "+entry.name+" نهائياً؟ لن يسمح النظام بحذفه إذا كان مرتبطاً بأفلام أو حلقات. يُفضّل إيقاف الحساب بدلاً من حذفه. متابعة؟"))return;
    btn.disabled=true;
    try{
      if(action==="toggle")await changeAccount("PATCH",entry.id,{name:entry.name,url:entry.url,enabled:!entry.enabled});
      if(action==="delete")await changeAccount("DELETE",entry.id);
      msg(action==="delete"?"تم حذف الحساب.":"تم تغيير حالة الحساب.");
    }catch(e){msg(e.message||"تعذّرت العملية.");}
    finally{btn.disabled=false;}
  });
}

let working=false;
async function load({gateway,token,fresh=false}={}){
  credentials={gateway,token};
  if(working)return;
  working=true;
  const refresh=$("xtreamRefresh");
  if(refresh)refresh.disabled=true;
  if($("xtreamNotice"))$("xtreamNotice").textContent="جاري قراءة حالة الحسابات...";
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),65000);
  try{
    if(!token)throw Error("انتهت جلسة الإدارة. سجّل دخولك من جديد.");
    await refreshManaged();
    const url=String(gateway||"").replace(/\/+$/,"")+"/admin/xtream/accounts"+(fresh?"?fresh=true":"");
    if(!url.startsWith("https://"))throw Error("بوابة المراقبة تحتاج اتصال HTTPS.");
    const res=await fetch(url,{headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store",signal:controller.signal});
    if(res.status===401||res.status===403)throw Error("تم رفض جلسة الإدارة لدى بوابة Xtream. تحقق من إعدادات Supabase في Railway ثم سجّل دخولك مجدداً.");
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
      else root.append(n("div","panel xtream-empty","ماكو حسابات مسجلة بعد. أضف حساباً من النموذج داخل الإدارة."));
    }
  }catch(e){
    if($("xtreamNotice"))$("xtreamNotice").textContent=e?.name==="AbortError"?"انتهت مهلة الفحص. حاول مجدداً.":e.message||"تعذر الاتصال.";
    if($("xtreamAccounts"))$("xtreamAccounts").replaceChildren(n("div","panel xtream-empty","تعذرت قراءة الحسابات. لا تُعرض أعداد تقديرية أو غير مؤكدة."));
  }finally{
    clearTimeout(timer);working=false;
    if(refresh)refresh.disabled=false;
  }
}
ensureHttpConsentControl();
bindManagement();
window.CINARO_XTREAM_MONITOR={load,resetAccountForm};
})();