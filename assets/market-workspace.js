(()=>{
const path=location.pathname.replace(/\/+$/,"")||"/";
const configs={
 buyer:{label:"Buyer workspace",title:"DateVault Market",groups:[{label:"Market",items:[["Discover","/discover","◈"],["Search","/search","⌕"],["My Library","/library","▣"],["Saved","/saved","♡"]]},{label:"Your account",items:[["Wallet","/wallet","◉"],["Transactions","/transactions","↔"],["My Profile","/profile","○"]]},{label:"Workspace",items:[["Creator Studio","/studio","✧"]]}]},
 creator:{label:"Creator workspace",title:"Creator Studio",groups:[{label:"Studio",items:[["Overview","/studio","⌂"]]},{label:"Content management",items:[["Upload content","/studio/upload","＋"],["My content","/studio/content","▤"],["Drafts","/studio/drafts","▧"],["Performance","/studio/performance","↗"]]},{label:"Finances",items:[["Earnings","/studio/earnings","◉"],["Withdrawals","/studio/withdrawals","⇧"],["Sales & transactions","/studio/sales","↔"]]},{label:"Creator account",items:[["Public profile","/studio/profile","◎"],["Identity verification","/studio/verification","✓"],["Settings","/studio/settings","⚙"]]}]},
 admin:{label:"Admin workspace",title:"Market Console",groups:[{label:"Overview",items:[["Overview","/admin","⌂"]]},{label:"People",items:[["Buyers","/admin/buyers","♙"],["Creators","/admin/creators","✧"],["Identity reviews","/admin/identity","✓"]]},{label:"Marketplace",items:[["Content library","/admin/content","▣"],["Listings","/admin/listings","▤"]]},{label:"Finance",items:[["Withdrawals","/admin/withdrawals","⇧"],["Creator earnings","/admin/earnings","◉"]]},{label:"Trust & safety",items:[["Reports & moderation","/admin/reports","⚑"],["Audit logs","/admin/audit","≡"],["Settings","/admin/settings","⚙"]]}]}
};
const role=path.startsWith("/studio")?"creator":path.startsWith("/admin")?"admin":"buyer";
const cfg=configs[role];
const current=path==="/"?"/discover":path==="/member"?"/library":path==="/creator"?"/creator":path;
const pageTitles={" /":"Discover","/":"Discover","/discover":"Discover","/search":"Search","/library":"My Library","/member":"My Library","/saved":"Saved","/wallet":"Wallet","/transactions":"Transactions","/profile":"My Profile","/studio":"Overview","/studio/upload":"Upload content","/studio/content":"My content","/studio/drafts":"Drafts","/studio/performance":"Content performance","/studio/earnings":"Earnings","/studio/withdrawals":"Withdrawals","/studio/sales":"Sales & transactions","/studio/profile":"Public profile","/studio/verification":"Identity verification","/studio/settings":"Creator settings","/admin":"Overview","/admin/buyers":"Buyers","/admin/creators":"Creators","/admin/identity":"Identity reviews","/admin/content":"Content library","/admin/listings":"Listings","/admin/withdrawals":"Withdrawals","/admin/earnings":"Creator earnings","/admin/reports":"Reports & moderation","/admin/audit":"Audit logs","/admin/settings":"Platform settings"};
const title=pageTitles[current]||cfg.title;
const body=document.body;body.classList.add("market-workspace");
const oldHeader=body.querySelector("header");if(oldHeader)oldHeader.classList.add("workspace-original-header");
const oldMain=body.querySelector("main");
const shell=document.createElement("div");shell.className="market-shell";
const overlay=document.createElement("div");overlay.className="market-mobile-overlay";
const aside=document.createElement("aside");aside.className="market-sidebar";
const groups=cfg.groups.map(g=>'<div class="market-nav-group"><div class="market-nav-label">'+g.label+'</div>'+g.items.map(([label,url,icon])=>'<a class="market-nav-link '+(current===url?"active":"")+'" href="'+url+'"><span class="market-nav-icon">'+icon+'</span><span>'+label+'</span></a>').join("")+'</div>').join("");
aside.innerHTML='<a class="market-brand" href="/discover"><span class="market-brand-mark">M</span><span>DATEVAULT <span style="color:#35d6ae">MARKET</span><small>'+cfg.label.toUpperCase()+'</small></span></a><nav>'+groups+'</nav><div class="market-sidebar-bottom"><a class="market-nav-link" href="https://elysiandate.site"><span class="market-nav-icon">↗</span><span>Back to DateVault</span></a></div>';
const main=document.createElement("div");main.className="market-main";
const top=document.createElement("div");top.className="market-topbar";
top.innerHTML='<div style="display:flex;align-items:center;gap:12px"><button class="market-mobile-menu" type="button" aria-label="Open navigation">☰</button><div><div class="market-top-title">'+title+'</div><div class="market-top-subtitle">'+cfg.label+'</div></div></div><div class="market-top-actions"><span class="market-status">● Secure workspace</span><a class="market-top-link" href="/member">My Market</a><button class="market-top-link" id="marketSignOut" type="button">Sign out</button></div>';
const page=document.createElement("div");page.className="market-page";
if(oldMain){page.appendChild(oldMain);main.append(top,page);}else main.append(top,page);
shell.append(overlay,aside,main);body.insertBefore(shell,body.firstChild);
const menu=()=>shell.classList.toggle("menu-open");top.querySelector(".market-mobile-menu").addEventListener("click",menu);overlay.addEventListener("click",menu);top.querySelector("#marketSignOut").addEventListener("click",async()=>{const b=top.querySelector("#marketSignOut");b.disabled=true;b.textContent="Signing out…";try{await fetch("/api/market-logout",{method:"POST",credentials:"same-origin"});}finally{location.href="https://elysiandate.site";}});
const style=document.createElement("link");style.rel="stylesheet";style.href="/assets/market-workspace.css";document.head.appendChild(style);

// Reuse existing page sections as independently addressable workspace views.
const placeholder=(message)=>{const node=document.createElement("section");node.className="market-view-placeholder";node.innerHTML='<div class="market-kicker">Workspace module</div><h1>'+title+'</h1><p>'+message+'</p><p>Your existing Market account, purchases, creator earnings and access records are unchanged. This page will be connected to its dedicated data and actions in the next implementation step.</p>';page.replaceChildren(node);};
const setVisible=(selector,visible)=>{const node=document.querySelector(selector);if(node)node.hidden=!visible;};
if(role==="admin"){
 const map={"/admin":"all","/admin/buyers":"directory","/admin/creators":"directory","/admin/identity":"identity","/admin/content":"directory","/admin/listings":"directory","/admin/withdrawals":"withdrawals","/admin/earnings":"directory","/admin/reports":"reports"};
 const target=map[current];
 if(target){document.querySelectorAll("main>section.section").forEach(n=>n.hidden=target!=="all"&&n.id!==target);const intro=document.querySelector("main>.top");if(intro)intro.hidden=target!=="all";const status=document.getElementById("globalStatus");if(status)status.hidden=target!=="all"&&target!=="reports";}
 else placeholder("This admin module is planned as a dedicated view. Existing moderation and payout records remain in the current operations workspace.");
}
if(role==="creator"){
 const tools=document.getElementById("creatorTools");
 if(tools){
  const children=[...tools.children];const avatar=children.find(n=>n.querySelector("#creatorAvatarPreview"));const listingsTitle=children.find(n=>n.tagName==="H2"&&/Your creator listings/i.test(n.textContent));const listingsBox=document.getElementById("listings");const createTitle=children.find(n=>n.tagName==="H2"&&/Create a listing draft/i.test(n.textContent));const listingForm=document.getElementById("listingForm");const earningsTitle=children.find(n=>n.tagName==="H2"&&/Creator earnings/i.test(n.textContent));const earnings=document.getElementById("earnings"),withdraw=document.getElementById("withdrawForm"),withdrawals=document.getElementById("withdrawals");
  const overview=document.createElement("section");overview.className="market-view-placeholder";overview.innerHTML='<div class="market-kicker">Creator Studio</div><h1>Welcome to your studio</h1><p>Manage your content, monitor earnings and keep your creator account up to date.</p><div class="market-actions"><a class="market-top-link" href="/studio/upload">Upload content</a> <a class="market-top-link" href="/studio/earnings">View earnings</a></div>';
  const wrap=(id,label,nodes)=>{const box=document.createElement("section");box.dataset.studioView=id;box.append(...nodes.filter(Boolean));return box;};
  const panels=[wrap("profile","profile",[avatar]),wrap("content","content",[listingsTitle,listingsBox]),wrap("upload","upload",[createTitle,listingForm]),wrap("earnings","earnings",[earningsTitle,earnings,withdraw,withdrawals])];
  panels.forEach(n=>tools.appendChild(n));
  const first=document.querySelector("main>section.panel");if(first)first.dataset.studioIntro="1";
  const view=current==="/studio"? "overview":current.split("/")[2];
  if(view==="overview"){panels.forEach(n=>n.hidden=true);if(first)first.hidden=false;overview.style.marginBottom="18px";tools.prepend(overview);}
  else if(["profile","content","upload","earnings"].includes(view)){if(first)first.hidden=true;panels.forEach(n=>n.hidden=n.dataset.studioView!==view&&!(view==="upload"&&n.dataset.studioView==="content"));}
  else if(view==="drafts"){if(first)first.hidden=true;panels.forEach(n=>n.hidden=n.dataset.studioView!=="content");const observer=new MutationObserver(()=>{document.querySelectorAll("#listings [data-listing-card]").forEach(card=>{const status=card.querySelector(".withdrawal-status")?.textContent?.trim().toLowerCase();card.hidden=status!=="draft";});});observer.observe(listingsBox,{childList:true,subtree:true});}
  else if(view==="verification"){panels.forEach(n=>n.hidden=true);if(first)first.hidden=false;document.getElementById("identitySection")?.removeAttribute("hidden");document.getElementById("verifyAge")?.removeAttribute("hidden");}
  else placeholder("This Creator Studio module is on the roadmap. Your current listing, upload, verification and earnings tools remain available from their dedicated workspace pages.");
 }
}
if(role==="buyer"&&(current==="/saved"||current==="/wallet"||current==="/transactions"||current==="/profile"))placeholder(current==="/saved"?"Saved creator and listing collections are being added.":current==="/wallet"?"Wallet top-ups and balance controls remain in DateVault. Market purchases continue to use your existing DateVault token wallet.":current==="/transactions"?"Your Market purchase and rental history is available in My Library. A unified transaction ledger view is being added.":"Your account identity and personal details are managed securely in DateVault.");
if(role==="buyer"&&current==="/search"){const q=document.getElementById("query");if(q){q.focus();q.placeholder="Search creators by username or display name";}}
if(role==="buyer"&&current==="/library"){const h=[...document.querySelectorAll("h2")].find(n=>/Blocked creators/i.test(n.textContent));const blocked=h?.parentElement;if(blocked)blocked.hidden=true;}
const logout=document.getElementById("logout");if(logout)logout.textContent="Sign out";
})();
