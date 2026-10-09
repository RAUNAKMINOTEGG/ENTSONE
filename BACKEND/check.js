
const API_BASE="https://entsoneapi.onrender.com";
function authHeaders(json=false){const h={};const token=localStorage.getItem('entsoneSession');if(token)h.Authorization=`Bearer ${token}`;if(json)h['Content-Type']='application/json';return h;}
const games=[
['🔥','Free Fire','Solo · Duo · Squad'],['🎯','BGMI','Solo · Duo · Squad'],['⚔️','ScarFall','Solo · Squad'],['💥','COD Mobile','MP · BR · Duo'],
['🎲','Ludo','1v1 · 4 Players'],['♟️','Chess','1v1'],['🎱','8 Ball Pool','1v1'],['🏰','Clash of Clans','Clan Battles'],['👑','Clash Royale','1v1 · 2v2'],['🏎️','Asphalt','Race Events'],['🎮','Other Game','Organizer-added title']
];
const defaultTours=[
['ENTSONE Battle Cup','Free Fire · Squad','Free Fire','₹10,000','₹49','100 Slots · Tonight 9:00 PM','OPEN'],
['BGMI Pro Clash','BGMI · Squad','BGMI','₹25,000','₹99','100 Slots · Tomorrow 8:00 PM','OPEN'],
['COD Mobile Rush','COD Mobile · Duo','COD Mobile','₹5,000','₹29','64 Slots · Tomorrow 7:30 PM','OPEN'],
['Pool Masters','8 Ball Pool · 1v1','Other','₹2,500','₹19','32 Slots · Saturday 6:00 PM','OPEN'],
['Ludo Knockout','Ludo · 1v1','Other','₹3,000','₹29','64 Slots · Sunday 5:00 PM','UPCOMING'],
['Night Duo Wars','Free Fire · Duo','Free Fire','₹7,500','₹39','50 Teams · Sunday 9:30 PM','UPCOMING']
];
let tours=JSON.parse(localStorage.getItem('entsoneTours')||'null')||[];
let backendTournamentMode=false;
function saveTours(){localStorage.setItem('entsoneTours',JSON.stringify(tours))}
function tournamentRowFromApi(t){return [t.name,`${t.game} · ${t.mode||''}`,t.game,`₹${Number(t.prize_pool||0).toLocaleString('en-IN')}`,`₹${Number(t.entry_fee||0).toLocaleString('en-IN')}`,`${t.slots||0} Slots · ${t.start_label||'Scheduled'}`,t.status||'UPCOMING',t.id,t.start_time,t.countdown_enabled,t.countdown_hours,t.map,t.rules,t.registration_deadline,t.checkin_enabled,t.results_published,t.share_slug,t.prize_first,t.prize_second,t.prize_third,Number(t.joined_count||0)]}
async function loadBackendTournaments(){
  try{
    const r=await fetch(`${API_BASE}/api/tournaments`);
    const d=await r.json();
    if(!r.ok||!d.success||!Array.isArray(d.tournaments)) throw new Error('Tournament API failed');
    tours=d.tournaments.map(tournamentRowFromApi);
    backendTournamentMode=true;populateBracketTournamentSelect();
    saveTours();
    renderHomeTours();renderTours('all');renderGlobalPromo();
  }catch(e){console.warn('Backend tournament load skipped:',e.message)}
}
let selectedTour=null, moneyMode='add', user=JSON.parse(localStorage.getItem('entsoneUser')||'null'), joinedTours=JSON.parse(localStorage.getItem('entsoneJoined')||'[]'), results=JSON.parse(localStorage.getItem('entsoneResults')||'{}');
let notifications=JSON.parse(localStorage.getItem('entsoneNotifications')||'null')||[];
let settings=JSON.parse(localStorage.getItem('entsoneSettings')||'{"reminders":true,"results":true}');
function saveNotifications(){localStorage.setItem('entsoneNotifications',JSON.stringify(notifications))}
function saveSettings(){localStorage.setItem('entsoneSettings',JSON.stringify(settings))}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function saveResults(){localStorage.setItem('entsoneResults',JSON.stringify(results))}
function placementPoints(pos){return ({1:12,2:9,3:7,4:5,5:4,6:3,7:2,8:1}[Number(pos)]||0)}
function totalPoints(pos,kills){return placementPoints(pos)+(Number(kills)||0)}
let routeStack=[];let currentPage=location.hash.replace(/^#/,'')||'home';
function toggleDrawer(open){const drawer=document.getElementById('siteDrawer'),scrim=document.getElementById('drawerScrim'),trigger=document.querySelector('.menuTrigger');if(!drawer||!scrim)return;const show=!!open;drawer.classList.toggle('open',show);scrim.classList.toggle('open',show);drawer.setAttribute('aria-hidden',String(!show));scrim.setAttribute('aria-hidden',String(!show));document.body.classList.toggle('drawerOpen',show);if(trigger)trigger.setAttribute('aria-expanded',String(show));if(show){const name=(user&&(user.username||user.name))||'Player Arena';const nm=document.getElementById('drawerUserName'),sub=document.getElementById('drawerUserSub'),auth=document.getElementById('drawerAuthBtn');if(nm)nm.textContent=name;if(sub)sub.textContent=user?'Signed in · Player account':'Sign in to manage your account';if(auth)auth.textContent=user?'Account & Sign In':'Login / Sign Up';}}
function drawerGo(id){toggleDrawer(false);page(id)}
document.addEventListener('keydown',e=>{if(e.key==='Escape')toggleDrawer(false)});
function page(id,fromPop=false){if(!document.getElementById(id))return;toggleDrawer(false);document.querySelectorAll('.bottom button').forEach((b,i)=>b.classList.toggle('active',['home','games','tournaments','wallet','profile'][i]===id));if(!fromPop&&id!==currentPage){routeStack.push(currentPage)}currentPage=id;document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.getElementById(id).classList.add('active');window.scrollTo(0,0);document.querySelectorAll('.pageBack').forEach(x=>x.remove());if(id!=='home'){const wrap=document.querySelector('#'+id+' .dashboard .wrap');if(wrap){const back=document.createElement('div');back.className='pageBack';back.innerHTML='<button type="button" onclick="goBack()">← Back</button>';wrap.prepend(back)}}renderProfile();if(id==='games')renderGames();if(id==='tournaments')renderTours('all');if(id==='home')renderHomeTours();renderGlobalPromo();if(id==='wallet')renderWallet();if(id==='history')renderHistory();if(id==='notifications'){renderNotifications();syncNotifications();}if(id==='settings')renderSettings();if(!fromPop)history.pushState({page:id},'', '#'+id)}
function goBack(){if(routeStack.length){const prev=routeStack.pop();page(prev,true);history.replaceState({page:prev},'', '#'+prev)}else{page('home');history.replaceState({page:'home'},'', '#home')}}
window.addEventListener('popstate',()=>{const target=location.hash.replace(/^#/,'')||'home';routeStack=[];page(target,true)});
function closeProfilePanel(){document.getElementById('statsPanel').style.display='none';document.getElementById('teamPanel').style.display='none';window.scrollTo(0,0)}
function countdownFor(t){const start=t?.[8]?new Date(t[8]).getTime():0;if(!start||t?.[9]===false)return '';const ms=start-Date.now();if(ms<=0)return '';let s=Math.floor(ms/1000),d=Math.floor(s/86400);s%=86400;let h=Math.floor(s/3600);s%=3600;let m=Math.floor(s/60);let sec=s%60;return `⏳ Starts in ${d?d+'d ':''}${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`}
function cardTour(t){
  let rawStatus=String(t[6]||'OPEN').toUpperCase(),st=rawStatus==='ONGOING'?'LIVE':rawStatus,done=rawStatus==='COMPLETED';
  let safe=String(t[0]).replace(/'/g,"\\'");
  let total=Math.max(0,Number(t[5]?.match(/\d+/)?.[0]||0));
  let joined=Math.max(0,Number(t[21]||0));
  let left=Math.max(0,total-joined);
  let pct=total?Math.min(100,Math.round(joined/total*100)):0;
  let onclick=done?`viewResults('${safe}')`:`openTournament('${safe}','${t[1]}','${t[3]}','${t[4]}')`;
  let label=done?'View Results':'View & Join';
  let cd=countdownFor(t);
  let prizes=[t[18]&&`🏆 1st ${t[18]}`,t[19]&&`🥈 2nd ${t[19]}`,t[20]&&`🥉 3rd ${t[20]}`].filter(Boolean).join(' · ');
  const gameKey=String(t[2]||t[1]||'').toLowerCase();
  const artClass=/bgmi|pubg/.test(gameKey)?'art-bgmi':/free fire/.test(gameKey)?'art-freefire':/valorant/.test(gameKey)?'art-valorant':/call of duty|cod mobile/.test(gameKey)?'art-cod':'art-esports';
  return `<article class="tour ${artClass}"><div class="tourTop"><span class="badge">${escapeHtml(t[1])}</span><span class="open">● ${escapeHtml(st)}</span></div><h3>${escapeHtml(t[0])}</h3><div class="meta">${escapeHtml(t[5])}<br>${t[11]?escapeHtml(t[11])+' · ':''}${done?'Final results published.':rawStatus==='ONGOING'?'Match is live now.':rawStatus==='UPCOMING'?'Registration not open yet.':st==='OPEN'?'Registration open':'Tournament status'}</div>${cd?`<div class="countdownCard" data-start="${escapeHtml(t[8])}">${cd}</div>`:''}<div class="slotLine"><span><strong>${joined}</strong>/${total||'—'} Joined</span><span><strong>${left}</strong> Slots Left</span></div>${total?`<div class="slotBar"><i style="width:${pct}%"></i></div>`:''}<div class="tourFoot row"><div><b>${t[3]}</b><small>Prize Pool</small>${prizes?`<small class="mut">${escapeHtml(prizes)}</small>`:''}</div><div><b>${t[4]}</b><small>Entry Fee</small></div></div><button class="btn full" onclick="${onclick}">${label}</button><button class="btn secondary full" onclick="shareTournament('${safe}')">Share</button></article>`
}
function renderAdmin(){let total=tours.length,open=tours.filter(t=>(t[6]||'OPEN')==='OPEN').length,done=tours.filter(t=>(t[6]||'')==='COMPLETED').length;document.getElementById('adminTotal').textContent=total;document.getElementById('adminOpen').textContent=open;document.getElementById('adminCompleted').textContent=done;let box=document.getElementById('adminTours');if(!box)return;box.innerHTML=tours.length?tours.map(cardTour).join(''):'<div class="empty">No tournaments yet.</div>'}
function renderAdmin(){let total=tours.length,open=tours.filter(t=>(t[6]||'OPEN')==='OPEN').length,done=tours.filter(t=>(t[6]||'')==='COMPLETED').length;document.getElementById('adminTotal').textContent=total;document.getElementById('adminOpen').textContent=open;document.getElementById('adminCompleted').textContent=done;let box=document.getElementById('adminTournamentList');if(!total){box.innerHTML='<div class="empty">No tournaments created yet.</div>'}else{box.innerHTML=tours.map((t,i)=>`<div class="adminRow"><div class="row"><div><b>${t[0]}</b><small class="mut">${t[1]} · ${t[5]}</small></div><span class="pill">AUTO · ${t[6]||'UPCOMING'}</span></div><div class="meta">Prize ${t[3]} · Entry ${t[4]} · ${t[5].match(/\d+/)?.[0]||'—'} Slots</div><div class="adminActions"><button class="btn sm secondary" onclick="editAdminTournament(${i})">Edit</button><button class="btn sm secondary" onclick="selectResultTournament(${i})">Results</button><button class="btn sm danger" onclick="deleteAdminTournament(${i})">Delete</button></div></div>`).join('')}renderResultSelector()}
async function saveAdminTournament(){
  const n=document.getElementById('aName').value.trim();
  const g=document.getElementById('aGame').value;
  const m=document.getElementById('aMode').value;
  const p=document.getElementById('aPrize').value.trim()||'₹0';
  const e=document.getElementById('aEntry').value.trim()||'₹0';
  const sl=Math.max(2,Number(document.getElementById('aSlots').value)||2);
  const st=document.getElementById('aStart').value.trim()||'Scheduled';
  const status=document.getElementById('aStatus').value||'UPCOMING';
  if(!n){toast('Enter tournament name');return}
  const payload={name:n,game:g,mode:m,entry_fee:Number(String(e).replace(/[^\d.]/g,''))||0,prize_pool:Number(String(p).replace(/[^\d.]/g,''))||0,start_label:st,slots:sl,status};
  const edit=window.__adminEdit;
  try{
    const id=Number.isInteger(edit)?tours[edit]?.[7]:null;
    const response=await fetch(id?`${API_BASE}/api/tournaments/${id}`:`${API_BASE}/api/tournaments`,{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await response.json();
    if(!response.ok||!data.success) throw new Error(data.message||'Server rejected tournament');
    const row=tournamentRowFromApi(data.tournament);
    if(Number.isInteger(edit)){tours[edit]=row;toast('Tournament updated in database')}else{tours.push(row);toast('Tournament created in database')}
    backendTournamentMode=true;saveTours();resetAdminForm();renderTours('all');renderHomeTours();
  }catch(err){
    console.error(err);
    toast('Database save failed — tournament not saved');
  }
}
function editAdminTournament(i){let t=tours[i];document.getElementById('aName').value=t[0];let parts=t[1].split(' · ');document.getElementById('aGame').value=parts[0]||'Other';document.getElementById('aMode').value=parts[1]||'Solo';document.getElementById('aPrize').value=t[3];document.getElementById('aEntry').value=t[4];document.getElementById('aSlots').value=(t[5].match(/\d+/)||['100'])[0];document.getElementById('aStart').value=t[5].replace(/\d+ Slots · /,'');document.getElementById('aStatus').value=t[6]||'UPCOMING';window.__adminEdit=i;document.getElementById('adminFormTitle').textContent='Edit Tournament';document.getElementById('adminSaveBtn').textContent='Save Changes';document.getElementById('adminCancelBtn').style.display='block';window.scrollTo({top:0,behavior:'smooth'})}
function resetAdminForm(){window.__adminEdit=null;document.getElementById('adminFormTitle').textContent='Create Tournament';document.getElementById('adminSaveBtn').textContent='Create Tournament';document.getElementById('adminCancelBtn').style.display='none';['aName','aPrize','aEntry','aSlots','aStart'].forEach(id=>document.getElementById(id).value='');document.getElementById('aStatus').value='UPCOMING'}
async function deleteAdminTournament(i){if(!confirm('Delete this tournament?'))return;let id=tours[i]?.[7];if(!id){toast('Tournament ID missing');return}try{const r=await fetch(`${API_BASE}/api/tournaments/${id}`,{method:'DELETE'});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||'Delete failed');tours.splice(i,1);saveTours();renderTours('all');renderHomeTours();toast('Tournament deleted from database')}catch(err){console.error(err);toast('Database delete failed')}}
function renderResultSelector(){
  let sel=document.getElementById('rTournament');
  if(!sel)return;
  let current=sel.value;
  sel.innerHTML=tours.map((t,i)=>{
    const dbId=Number(t?.[7])||0;
    return `<option value="${i}" data-tournament-id="${dbId}">${escapeHtml(t[0])} · ${escapeHtml(t[1])}</option>`;
  }).join('');
  if(current && tours[Number(current)]) sel.value=current;
  renderResultTable();
}
function selectResultTournament(i){let sel=document.getElementById('rTournament');if(sel){sel.value=String(i);renderResultTable();document.querySelector('.resultBox')?.scrollIntoView({behavior:'smooth',block:'start'})}}
async function addResult(){
  const select=document.getElementById('rTournament');
  const idx=Number(select?.value);
  const option=select?.selectedOptions?.[0];
  const name=document.getElementById('rName').value.trim();
  const place=Number(document.getElementById('rPlace').value);
  const kills=Math.max(0,Number(document.getElementById('rKills').value)||0);

  if(!name||!place||place<1){
    toast('Enter player, placement and kills');
    return;
  }

  const t=tours[idx];
  const tid=Number(option?.dataset?.tournamentId || t?.[7]) || 0;

  if(!tid){
    toast('Tournament database ID missing');
    console.error('ENTSONE result: missing tournament ID',{idx,t});
    return;
  }

  try{
    const payload={
      tournament_id:tid,
      player_name:name,
      team_name:name,
      position:place,
      kills:kills
    };

    const uid=Number(user?.id);
    if(Number.isInteger(uid)&&uid>0) payload.user_id=uid;

    console.log('ENTSONE result payload:',payload);

    const response=await fetch(`${API_BASE}/api/results`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });

    const raw=await response.text();
    let data={};
    try{data=raw?JSON.parse(raw):{};}catch(_){}

    if(!response.ok||!data.success){
      const message=data.message||`Result API error (${response.status})`;
      console.error('ENTSONE result API error:',response.status,raw);
      throw new Error(message);
    }

    ['rName','rPlace','rKills'].forEach(id=>document.getElementById(id).value='');
    await renderResultTable();
    toast('Result saved to PostgreSQL');
  }catch(error){
    console.error('ENTSONE result save error:',error);
    toast(error.message||'Could not save result');
  }
}
async function renderResultTable(){let box=document.getElementById('resultAdminTable'),sel=document.getElementById('rTournament');if(!box||!sel||!tours.length)return;let idx=Number(sel.value||0),t=tours[idx],tid=t?.[7],arr=[];if(tid){try{let r=await fetch(`${API_BASE}/api/results/${tid}`),d=await r.json();if(r.ok&&d.success)arr=d.results.map(x=>({id:x.id,name:x.player_name,place:x.position,kills:x.kills,points:x.points,published:x.published}))}catch(e){console.warn(e)}}else {box.innerHTML='<div class="empty" style="margin-top:12px">Tournament database ID missing.</div>';return}if(!arr.length){box.innerHTML='<div class="empty" style="margin-top:12px">No results added for this tournament.</div>';return}box.innerHTML=`<table class="resultTable"><thead><tr><th>#</th><th>Player / Team</th><th>Placement</th><th>Kills</th><th>Points</th><th></th></tr></thead><tbody>${arr.map((r,i)=>`<tr><td class="rank">${i+1}</td><td>${i===0?'🏆 ':''}<b>${escapeHtml(r.name)}</b></td><td>${r.place}</td><td>${r.kills}</td><td><b>${r.points}</b></td><td>${r.id?`<button class="btn sm danger" onclick="removeResultDb(${r.id})">×</button>`:`<button class="btn sm danger" onclick="removeResult(${idx},${i})">×</button>`}</td></tr>`).join('')}</tbody></table>`}
async function removeResultDb(id){if(!confirm('Remove this result?'))return;try{let r=await fetch(`${API_BASE}/api/results/${id}`,{method:'DELETE'});let d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||'Delete failed');renderResultTable();toast('Result removed')}catch(e){toast(e.message||'Could not remove result')}}
function removeResult(idx,i){if(!results[String(idx)])return;results[String(idx)].splice(i,1);saveResults();renderResultTable();toast('Result removed')}
async function clearResults(){
  const idx=Number(document.getElementById('rTournament')?.value||0);
  const tid=Number(tours[idx]?.[7])||0;
  if(!tid){toast('Tournament database ID missing');return}
  try{
    const r=await fetch(`${API_BASE}/api/results/${tid}`);
    const d=await r.json();
    if(!r.ok||!d.success)throw new Error(d.message||'Could not load results');
    if(!d.results?.length){toast('No results to clear');return}
    if(!confirm('Clear all results for this tournament?'))return;
    for(const x of d.results){
      const q=await fetch(`${API_BASE}/api/results/${x.id}`,{method:'DELETE'});
      const qd=await q.json();
      if(!q.ok||!qd.success)throw new Error(qd.message||'Could not delete result');
    }
    await renderResultTable();
    toast('Results cleared from PostgreSQL');
  }catch(e){console.error(e);toast(e.message||'Could not clear results')}
}
async function publishResults(){
  const idx=Number(document.getElementById('rTournament')?.value||0);
  const t=tours[idx];
  const tid=Number(t?.[7])||0;
  const tn=t?.[0]||'';
  if(!tid){toast('Tournament database ID missing');return}
  try{
    const check=await fetch(`${API_BASE}/api/results/${tid}`);
    const checkData=await check.json();
    if(!check.ok||!checkData.success)throw new Error(checkData.message||'Could not load results');
    if(!checkData.results?.length){toast('Add at least one result first');return}
    const r=await fetch(`${API_BASE}/api/tournaments/${tid}/publish-results`,{method:'POST'});
    const d=await r.json();
    if(!r.ok||!d.success)throw new Error(d.message||'Publish failed');
    tours[idx]=tournamentRowFromApi(d.tournament||{...{},id:tid,name:tn,game:t?.[2]||'',mode:'',entry_fee:String(t?.[4]||'').replace(/[^0-9.]/g,''),prize_pool:String(t?.[3]||'').replace(/[^0-9.]/g,''),slots:0,status:'COMPLETED',start_label:t?.[5]||'Scheduled'});
    saveTours();
    notifications.unshift({id:Date.now(),title:'Results published',text:`Results are live for ${tn}.`,read:false,time:'Just now'});
    saveNotifications();
    await syncRegistrations();
    await syncUserResults();
    renderTours('all');renderHomeTours();renderHistory();renderProfile();renderGlobalPromo();
    toast('Results published and tournament marked COMPLETED');
  }catch(e){console.error(e);toast(e.message||'Could not publish results')}
}
async function viewResults(name){let idx=tours.findIndex(t=>t[0]===name),t=tours[idx],arr=[],tid=t?.[7];if(tid){try{let r=await fetch(`${API_BASE}/api/leaderboard/${tid}`),d=await r.json();if(r.ok&&d.success)arr=d.leaderboard.map(x=>({name:x.player_name,place:x.position,kills:x.kills,points:x.points,rank:x.rank}))}catch(e){console.warn(e)}}else {arr=[];toast('Tournament database ID missing')}document.getElementById('resTitle').textContent=name;document.getElementById('resSub').textContent=arr.length?`Final leaderboard · ${arr.length} result${arr.length===1?'':'s'}`:'No published results yet';document.getElementById('publicResults').innerHTML=arr.length?`<table class="resultTable"><thead><tr><th>Rank</th><th>Player / Team</th><th>Place</th><th>Kills</th><th>Points</th></tr></thead><tbody>${arr.map((r,i)=>`<tr><td class="rank ${i===0?'winner':''}">${r.rank||i+1}</td><td><b>${escapeHtml(r.name)}</b></td><td>${r.place}</td><td>${r.kills}</td><td><b>${r.points}</b></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Results have not been published for this tournament.</div>';document.getElementById('resultsModal').classList.add('show')}
function renderHistory(){let box=document.getElementById('historyCards'),list=document.getElementById('historyList');if(!box||!list)return;let completed=joinedTours.filter(x=>x.status==='Completed').length,upcoming=joinedTours.filter(x=>x.status==='Upcoming').length,ongoing=joinedTours.filter(x=>x.status==='Ongoing').length;box.innerHTML=`<div class="historyCard"><small class="mut">UPCOMING</small><br><b>${upcoming}</b><p class="mut">Registered matches</p></div><div class="historyCard"><small class="mut">ONGOING</small><br><b>${ongoing}</b><p class="mut">Matches in progress</p></div><div class="historyCard"><small class="mut">COMPLETED</small><br><b>${completed}</b><p class="mut">Finished matches</p></div>`;if(!joinedTours.length){list.innerHTML='<div class="empty">No tournament history yet.</div>';return}list.innerHTML=joinedTours.map((x,i)=>{let r=x.result;return `<div class="item"><div><b>${escapeHtml(x.name)}</b><small>${escapeHtml(x.game)} · ${escapeHtml(x.mode||'Solo')} · ${escapeHtml(x.team||'Solo')}</small><small>${escapeHtml(x.joinedAt||'')}</small></div><div style="text-align:right"><span class="badge">${escapeHtml(x.status||'Upcoming')}</span>${r?`<small class="green">Rank #${r.rank} · ${r.points} pts</small>`:''}${x.tournamentId?`<button class="btn secondary sm" style="margin-top:5px" onclick="openRoomForJoined(${i})">View Room</button>`:''}</div></div>`}).join('')}
async function syncNotifications(){
  if(!user?.id||!localStorage.getItem('entsoneSession'))return;
  try{
    const r=await fetch(`${API_BASE}/api/notifications/${user.id}`,{headers:authHeaders()});
    const d=await r.json();
    if(!r.ok||!d.success)return;
    notifications=d.notifications.map(n=>({id:n.id,title:n.title,text:n.message,read:n.is_read,time:new Date(n.created_at).toLocaleString('en-IN')}));
    saveNotifications();renderNotifications();
  }catch(e){console.warn('Notification sync skipped',e.message)}
}
function renderNotifications(){let box=document.getElementById('notificationList');if(!box)return;let unread=notifications.filter(x=>!x.read).length;document.getElementById('notifCount').style.display=unread?'inline-block':'none';box.innerHTML=notifications.length?notifications.map(n=>`<div class="item" style="opacity:${n.read?.65:1}"><div><b>${n.read?'':'● '}${escapeHtml(n.title)}</b><small>${escapeHtml(n.text)}</small><small>${escapeHtml(n.time||'')}</small></div></div>`).join(''):'<div class="empty">No notifications.</div>'}

async function markNotificationsRead(){
  notifications.forEach(n=>n.read=true);saveNotifications();renderNotifications();
  if(user?.id){try{await fetch(`${API_BASE}/api/notifications/user/${user.id}/read-all`,{method:'PATCH',headers:authHeaders()})}catch(e){console.warn('Mark notifications read sync skipped',e.message)}}
  toast('Notifications marked as read')
}
function renderSettings(){let r=document.getElementById('toggleReminders'),q=document.getElementById('toggleResults');if(r)r.classList.toggle('on',settings.reminders!==false);if(q)q.classList.toggle('on',settings.results!==false)}
function toggleSetting(k){settings[k]=settings[k]===false;saveSettings();renderSettings()}
function openRoomForJoined(i){let x=joinedTours[i];if(!x)return;showRoom(x.name,i)}
function openRoomForSelected(){let i=joinedTours.findIndex(x=>selectedTour?.id?Number(x.tournamentId)===Number(selectedTour.id):x.name===selectedTour?.n);if(i<0){toast('Join the tournament first');return}showRoom(joinedTours[i].name,i)}
async function showRoom(name,i){let x=joinedTours[i];if(!x)return;if(!x.tournamentId){await syncRegistrations();x=joinedTours[i];}const tid=Number(x?.tournamentId)||0;if(!tid){toast('Tournament registration could not be found');return}try{const r=await fetch(`${API_BASE}/api/tournaments/${tid}/room`,{headers:authHeaders()});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||'Room details are not published yet');document.getElementById('roomTitle').textContent=name;document.getElementById('roomId').textContent=d.room?.room_id||'—';document.getElementById('roomPass').textContent=d.room?.room_password||'—';document.getElementById('roomModal').classList.add('show')}catch(e){toast(e.message||'Room details unavailable')}}
function renderHomeTours(){document.getElementById('homeTours').innerHTML=tours.slice(0,3).map(cardTour).join('')}
let activeTourGameFilter='all';let activeTourStatusFilter='all';
function applyTourSearch(){renderTours(activeTourGameFilter)}
function setTourStatusFilter(status,button){activeTourStatusFilter=status;document.querySelectorAll('#tourStatusFilters .chip').forEach(x=>x.classList.toggle('active',x===button));renderTours(activeTourGameFilter)}
async function shareTournament(name){try{const t=tours.find(x=>x[0]===name);const id=t?.[7];if(!id){toast('Tournament link unavailable');return}const d=await fetch(`${API_BASE}/api/tournaments/${id}`).then(r=>r.json());if(!d?.success)throw new Error(d?.message||'Tournament fetch failed');let slug=d.tournament?.share_slug;if(!slug)throw new Error('Share link unavailable — please edit/save the tournament once');const url=`${location.origin}${location.pathname}?tournament=${encodeURIComponent(slug)}`;if(navigator.share){await navigator.share({title:name,text:`Join ${name} on ENTSONE`,url});toast('Share opened')}else if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(url);toast('Tournament link copied')}else{const ta=document.createElement('textarea');ta.value=url;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('Tournament link copied')}}catch(e){console.error(e);toast(e.message||'Share failed')}}
function renderTourGameFilters(){
  const box=document.getElementById('tourGameOptions');if(!box)return;
  const standard=games.map(g=>g[1]).filter(n=>n!=='Other Game'&&n!=='More Games');
  const actual=(Array.isArray(tours)?tours:[]).map(t=>String(t[2]||'').trim()).filter(Boolean);
  const names=[...new Set([...standard,...actual])].sort((a,b)=>{const ia=standard.indexOf(a),ib=standard.indexOf(b);if(ia!==-1||ib!==-1)return (ia===-1?999:ia)-(ib===-1?999:ib);return a.localeCompare(b)});
  const all=['All Games',...names];
  box.innerHTML=all.map((name,i)=>{const value=i===0?'all':name;const active=activeTourGameFilter===value?' active':'';return `<button type="button" class="chip${active}" data-game="${escapeHtml(value)}" onclick="filterTours(this.dataset.game,this)">${escapeHtml(name)}</button>`}).join('');
}
function renderTours(filter){
  if(filter!==undefined&&filter!==null)activeTourGameFilter=filter||'all';
  renderTourGameFilters();
  const q=(document.getElementById('tourSearch')?.value||'').trim().toLowerCase();
  const statusOf=t=>String(t[6]||'UPCOMING').toUpperCase();
  const statusMatch=t=>{const st=statusOf(t);switch(activeTourStatusFilter){case 'upcoming':return st==='UPCOMING';case 'open':return st==='OPEN';case 'live':return st==='LIVE'||st==='ONGOING';case 'results':return st==='COMPLETED'||st==='RESULTS'||!!t[15];default:return true}};
  const list=(Array.isArray(tours)?tours:[]).filter(t=>(activeTourGameFilter==='all'||String(t[2]||'').toLowerCase()===String(activeTourGameFilter||'').toLowerCase())&&statusMatch(t)&&(!q||String(t[0]||'').toLowerCase().includes(q)||String(t[1]||'').toLowerCase().includes(q)||String(t[11]||'').toLowerCase().includes(q)));
  const box=document.getElementById('allTours');if(!box)return;
  const emptyMessages={all:'No tournaments available yet.',upcoming:'No upcoming tournaments right now.',open:'No tournaments are open for registration right now.',live:'No live matches right now.',results:'No published results yet.'};
  box.innerHTML=list.length?list.map(cardTour).join(''):`<div class="empty" style="grid-column:1/-1">${emptyMessages[activeTourStatusFilter]||'No tournaments available for this game yet.'}</div>`;
}
function filterTours(f,b){activeTourGameFilter=f||'all';document.querySelectorAll('.tourGameFilters .chip').forEach(x=>x.classList.toggle('active',x===b));renderTours(activeTourGameFilter)}
function openGame(name){
  page('tournaments');
  if(name==='Other Game'){renderTours('all');document.getElementById('tourSearch').value='';return}
  document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
  const btn=[...document.querySelectorAll('.chip')].find(x=>x.textContent.trim()===name);
  if(btn) btn.classList.add('active');
  renderTours(name);
}
function renderGlobalPromo(){
  const box=document.getElementById('globalPromo');
  if(!box)return;
  const list=(Array.isArray(tours)?tours:[]).filter(t=>String(t[6]||'OPEN').toUpperCase()!=='COMPLETED').slice(0,6);
  if(!list.length){box.innerHTML='';return}
  box.innerHTML='<div class="promoInner">'+list.map(t=>`<button type="button" class="promo" onclick="openTournament('${String(t[0]).replace(/'/g,"\\'")}','${String(t[1]).replace(/'/g,"\\'")}','${String(t[3]).replace(/'/g,"\\'")}','${String(t[4]).replace(/'/g,"\\'")}')"><strong>${t[0]}</strong><span>${t[1]} · ${t[5]}</span><b>${t[3]} prize</b></button>`).join('')+'</div>';
}
function renderGames(){document.getElementById('allGames').innerHTML=games.map(g=>`<button type="button" class="game" onclick="openGame('${g[1].replace(/'/g,"\\'")}')"><div class="ico">${g[0]}</div><h3>${g[1]}</h3><small>${g[2]}</small></button>`).join('')}
function openAuth(){const gate=document.getElementById('loginGate');gate?.classList.remove('hidden');document.body.classList.add('appLocked');setAuthMode('signup');setTimeout(()=>document.getElementById('phone')?.focus(),80)}
function toggleAuthChannel(){let c=document.getElementById('authChannel').value;document.getElementById('phone').style.display=c==='phone'?'block':'none';document.getElementById('email').style.display=c==='email'?'block':'none'}
function showOtpStep(){document.getElementById('identityStep')?.classList.add('hiddenStep');document.getElementById('otpStep')?.classList.remove('hiddenStep');document.getElementById('stepNo').textContent='02';document.getElementById('progress2')?.classList.add('active');document.getElementById('otp')?.focus()}
function backToIdentityStep(){document.getElementById('otpStep')?.classList.add('hiddenStep');document.getElementById('identityStep')?.classList.remove('hiddenStep');document.getElementById('stepNo').textContent='01';document.getElementById('progress2')?.classList.remove('active');document.getElementById('otp').value='';document.getElementById('otp').disabled=true}
function normalizeUsername(value){return String(value||'').trim().replace(/^@+/,'').toLowerCase()}
function validUsername(value){return /^[a-z0-9._]{3,30}$/.test(value)}
function updateUsernameMeta(){const el=document.getElementById('name'),count=document.getElementById('usernameCount');if(!el)return;const raw=el.value;const n=normalizeUsername(raw);if(raw!==n&&raw.startsWith('@')) el.value=n;if(count)count.textContent=`${n.length}/30`;el.classList.remove('fieldError');const hint=document.getElementById('nameHint');if(!hint)return;if(!n){hint.textContent='Your public @username. 3–30 chars: letters, numbers, _ or .';hint.classList.remove('usernameTaken','usernameAvailable');return}if(!validUsername(n)){hint.textContent='Use 3–30 lowercase letters, numbers, _ or .';hint.classList.add('usernameTaken');hint.classList.remove('usernameAvailable');return}hint.textContent='Looks good. This username will appear publicly on ENTSONE.';hint.classList.remove('usernameTaken');hint.classList.add('usernameAvailable')}
function setAuthMode(mode){window.authMode=mode;const login=mode==='login';document.getElementById('loginTab')?.classList.toggle('active',login);document.getElementById('signupTab')?.classList.toggle('active',!login);document.getElementById('authTitle').textContent=login?'Welcome back to ENTSONE':'Create your ENTSONE account';document.getElementById('authSubtitle').textContent=login?'Sign in with your @username and mobile number. We will send a secure OTP.':'Choose your unique @username and mobile number. No password required.';document.getElementById('accountPrompt').textContent=login?'New to ENTSONE?':'Already have an account?';document.getElementById('accountPromptText').textContent=login?'Create an account':'Sign in to your account';const action=document.getElementById('accountAction');if(action){action.textContent=login?'Sign Up':'Login';action.onclick=()=>setAuthMode(login?'signup':'login')}const hint=document.getElementById('nameHint');if(hint)hint.textContent=login?'Enter the @username linked to your ENTSONE account.':'Your public @username. 3–30 chars: letters, numbers, _ or .';document.getElementById('name').placeholder=login?'@yourusername':'@chooseyourusername';backToIdentityStep();updateUsernameMeta()}
window.authMode='signup';
document.addEventListener('DOMContentLoaded',()=>{const n=document.getElementById('name');if(n){n.addEventListener('input',updateUsernameMeta);n.addEventListener('blur',()=>{n.value=normalizeUsername(n.value);updateUsernameMeta()})}});
window.authMode='signup';
async function editMyTeam(regId){const x=joinedTours.find(z=>Number(z.registrationId)===Number(regId));if(!x)return;document.getElementById('editRegId').value=regId;document.getElementById('editTeamName').value=x.team||'';document.getElementById('editTeamMembers').value=x.teamMembers||'';document.getElementById('teamEditModal').classList.add('show')}
async function saveTeamEdit(){if(!user)return;const id=Number(document.getElementById('editRegId').value),team=document.getElementById('editTeamName').value.trim(),members=document.getElementById('editTeamMembers').value.trim();if(!team){toast('Enter team name');return}try{const r=await fetch(`${API_BASE}/api/registrations/${id}`,{method:'PATCH',headers:authHeaders(true),body:JSON.stringify({team_name:team,team_members:members})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||'Could not update team');closeModal('teamEditModal');await syncRegistrations();toast('Team updated successfully')}catch(e){toast(e.message)}}
async function checkIn(regId){try{const r=await fetch(`${API_BASE}/api/registrations/${regId}/checkin`,{method:'POST',headers:authHeaders()});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||'Check-in failed');await syncRegistrations();toast('Check-in confirmed')}catch(e){toast(e.message)}}
async function sendSupport(){if(!user){openAuth();return}const subject=document.getElementById('supportSubject').value.trim(),message=document.getElementById('supportMessage').value.trim();if(!subject||!message){toast('Enter subject and message');return}try{const r=await fetch(`${API_BASE}/api/support`,{method:'POST',headers:authHeaders(true),body:JSON.stringify({subject,message})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||'Support request failed');document.getElementById('supportSubject').value='';document.getElementById('supportMessage').value='';toast('Support ticket submitted')}catch(e){toast(e.message)}}

function forgotPassword(){setAuthMode('login');const p=document.getElementById('phone');if(p)p.focus();toast('Enter your registered mobile number to receive a verification OTP.')}
let otpCooldown=0,otpTimer=null;function startOtpCooldown(){otpCooldown=30;const b=document.querySelector('.resendBtn');if(!b)return;clearInterval(otpTimer);const tick=()=>{if(otpCooldown>0){b.disabled=true;b.textContent=`Resend in ${otpCooldown}s`;otpCooldown--}else{b.disabled=false;b.textContent='Resend';clearInterval(otpTimer)}};tick();otpTimer=setInterval(tick,1000)}
async function requestOtp(){
  const d=document.getElementById('phone').value.replace(/\D/g,'');
  const n=normalizeUsername(document.getElementById('name').value);document.getElementById('name').value=n;
  const nameInput=document.getElementById('name');
  if(!n){nameInput.classList.add('fieldError');nameInput.focus();toast('Username is required');return}
  if(!validUsername(n)){nameInput.classList.add('fieldError');toast('Username must be 3–30 characters: lowercase letters, numbers, _ or .');return}
  nameInput.classList.remove('fieldError');
  if(d.length!==10||!/^[6-9]\d{9}$/.test(d)){toast('Enter a valid 10-digit Indian mobile number');return}
  const btn=document.getElementById('sendOtpBtn');
  try{
    if(btn){btn.disabled=true;btn.textContent='Sending…'}
    const r=await fetch(`${API_BASE}/api/auth/request-otp`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:'phone',destination:d,mode:window.authMode,username:n})});
    const x=await r.json();
    if(!r.ok||!x.success)throw new Error(x.message||'OTP request failed');
    const otp=document.getElementById('otp');otp.disabled=false;showOtpStep();
    if(x.demo_code){otp.value=x.demo_code;document.getElementById('otpHint').textContent=`DEMO OTP: ${x.demo_code} · Valid for 5 minutes`;toast('Demo OTP generated')}
    else document.getElementById('otpHint').textContent='OTP sent by SMS. Enter the 6-digit code received on your mobile.';
    startOtpCooldown();
  }catch(e){console.error(e);toast(e.message||'Could not request OTP')}
  finally{if(btn){btn.disabled=false;btn.textContent='Send Secure OTP →'}}
}
async function verifyOtp(){
  const d=document.getElementById('phone').value.replace(/\D/g,'');const otp=document.getElementById('otp').value.trim();const n=normalizeUsername(document.getElementById('name').value);document.getElementById('name').value=n;
  if(!n){backToIdentityStep();toast('Username is required');return}
  if(d.length!==10){backToIdentityStep();toast('Enter a valid 10-digit mobile number');return}
  if(!/^\d{6}$/.test(otp)){toast('Enter the 6-digit OTP');return}
  try{
    const r=await fetch(`${API_BASE}/api/auth/verify-otp`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:'phone',destination:d,otp,mode:window.authMode,username:n})});
    const x=await r.json();if(!r.ok||!x.success)throw new Error(x.message||'OTP verification failed');if(!x.session_token)throw new Error('Session was not created');
    let verifiedUser=x.user;if(!verifiedUser?.id)throw new Error('User profile could not be loaded');
    localStorage.setItem('entsoneSession',x.session_token);
    user={id:verifiedUser.id,name:verifiedUser.name||n,phone:verifiedUser.phone||d,email:verifiedUser.email||null,joined:user?.joined||0,wins:user?.wins||0,earn:user?.earn||0};
    localStorage.setItem('entsoneUser',JSON.stringify(user));document.body.classList.remove('appLocked');document.getElementById('loginGate')?.classList.add('hidden');document.getElementById('authBtn').textContent=(user.name||'Player').split(' ')[0]+' ✓';await syncRegistrations();await syncNotifications();renderProfile();page('home');toast(window.authMode==='signup'?'Account created successfully':'Sign in successful');
  }catch(e){console.error('OTP auth error:',e);toast(e.message||'OTP verification failed')}
}
function closeModal(id){
  const el=document.getElementById(id);
  if(el) el.classList.remove('show');
}
function closeAllModals(){
  document.querySelectorAll('.modal.show').forEach(el=>el.classList.remove('show'));
}
document.addEventListener('click',function(e){
  const modal=e.target.closest('.modal');
  if(modal && e.target===modal) modal.classList.remove('show');
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape') closeAllModals();
});
async function sendOtp(){await requestOtp()}
async function syncRegistrations(){if(!user?.id||!localStorage.getItem('entsoneSession'))return;try{let r=await fetch(`${API_BASE}/api/users/${user.id}/registrations`,{headers:authHeaders()}),d=await r.json();if(r.status===401||r.status===403)throw new Error('Session expired. Please login again.');if(!r.ok||!d.success)throw new Error(d.message||'Could not load your tournaments');joinedTours=d.registrations.map(x=>({registrationId:x.id,name:x.name,game:x.game,entry:`₹${Number(x.entry_fee||0).toLocaleString('en-IN')}`,prize:`₹${Number(x.prize_pool||0).toLocaleString('en-IN')}`,prizeFirst:x.prize_first,prizeSecond:x.prize_second,prizeThird:x.prize_third,status:x.status==='COMPLETED'?'Completed':x.status==='ONGOING'?'Ongoing':x.status==='OPEN'?'Open':'Upcoming',mode:x.mode,team:x.team_name||user.name,teamMembers:x.team_members||'',joinedAt:new Date(x.created_at).toLocaleString('en-IN'),result:null,tournamentId:x.tournament_id,checkinEnabled:!!x.checkin_enabled,checkedIn:!!x.checked_in,registrationDeadline:x.registration_deadline,startTime:x.start_time,map:x.map,rules:x.rules,slots:Number(x.slots||0),joinedCount:Number(x.joined_count||0)}));await syncUserResults();localStorage.setItem('entsoneJoined',JSON.stringify(joinedTours));renderHistory();renderProfile()}catch(e){console.warn('Registration sync skipped',e.message)}}
async function syncUserResults(){if(!user?.id)return;try{let r=await fetch(`${API_BASE}/api/users/${user.id}/results`,{headers:authHeaders()}),d=await r.json();if(!r.ok||!d.success)return;joinedTours=joinedTours.map(x=>{let rr=d.results.find(z=>Number(z.tournament_id)===Number(x.tournamentId));return rr?{...x,status:'Completed',result:{rank:Number(rr.position||0),points:Number(rr.points||0),kills:Number(rr.kills||0),placement:Number(rr.position||0)}}:x});localStorage.setItem('entsoneJoined',JSON.stringify(joinedTours));renderHistory();renderProfile()}catch(e){console.warn('Result sync skipped',e.message)}}
function openTournament(n,g,p,e){let t=tours.find(x=>x[0]===n);selectedTour={n,g,p,e,meta:t?t[5]:'',id:t?t[7]:null};document.getElementById('tmName').textContent=n;document.getElementById('tmGame').textContent=g;document.getElementById('tmPrize').textContent=p;document.getElementById('tmPrizes').textContent=t?(t[18]||t[19]||t[20]?`🏆 1st ${t[18]||'₹0'} · 🥈 2nd ${t[19]||'₹0'} · 🥉 3rd ${t[20]||'₹0'}`:''):'';document.getElementById('tmEntry').textContent=e;let total=t?Number(t[5]?.match(/\d+/)?.[0]||0):0,joined=t?Number(t[21]||0):0,left=Math.max(0,total-joined);document.getElementById('tmSlots').textContent=`${joined}/${total||'—'} Joined · ${left} Left`;document.getElementById('tmStart').textContent=t&&t[8]?new Date(t[8]).toLocaleString('en-IN'):'Scheduled';document.getElementById('tmRules').textContent=(t&&t[12])?t[12]:(String(g).includes('Squad')?'Squad match · team registration · placement + performance scoring.':String(g).includes('Duo')?'Duo match · team registration · placement + performance scoring.':'Match format · performance determines leaderboard position.')+' Final results are published after the match.';if(t&&t[11])document.getElementById('tmGame').textContent=g+' · '+t[11];const cd=countdownFor(t);document.getElementById('tmCountdown').textContent=cd||'';document.getElementById('tmCountdown').style.display=cd?'block':'none';let mode=(String(t?.[1]||'').split(' · ')[1]||'Solo').trim();let jm=document.getElementById('joinMode');jm.value=['Solo','Duo','Squad'].includes(mode)?mode:'Solo';jm.disabled=true;jm.classList.add('lockedMode');document.getElementById('modeLockHint').textContent=`Mode fixed by organizer: ${mode}`;let joinedReg=joinedTours.find(x=>selectedTour.id?Number(x.tournamentId)===Number(selectedTour.id):x.name===n);document.getElementById('roomBtn').style.display=joinedReg?'block':'none';if(joinedReg){document.getElementById('teamName').value=joinedReg.team||''}else{document.getElementById('teamName').value=''}document.getElementById('tourModal').classList.add('show')}
async function joinTournament(){if(!user){closeModal('tourModal');openAuth();toast('Login required before joining');return}if(!selectedTour)return;if(joinedTours.some(x=>selectedTour.id ? Number(x.tournamentId)===Number(selectedTour.id) : x.name===selectedTour.n)){closeModal('tourModal');toast('You already joined this tournament');return}let mode=(String(tours.find(x=>Number(x[7])===Number(selectedTour.id))?.[1]||'').split(' · ')[1]||document.getElementById('joinMode')?.value||'Solo').trim(),team=(document.getElementById('teamName')?.value||'').trim();if(selectedTour.id){try{let r=await fetch(`${API_BASE}/api/tournament-registrations`,{method:'POST',headers:authHeaders(true),body:JSON.stringify({tournament_id:selectedTour.id,mode,team_name:team||user.name})});let d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||'Registration failed')}catch(e){toast(e.message||'Could not join tournament');return}}let entry={name:selectedTour.n,game:selectedTour.g,entry:selectedTour.e,prize:selectedTour.p,status:'Upcoming',mode,team:team||user.name,joinedAt:new Date().toLocaleString(),result:null,tournamentId:selectedTour.id||null};joinedTours.unshift(entry);localStorage.setItem('entsoneJoined',JSON.stringify(joinedTours));user.joined=(user.joined||0)+1;localStorage.setItem('entsoneUser',JSON.stringify(user));notifications.unshift({id:Date.now(),title:'Tournament joined',text:`You joined ${selectedTour.n}.`,read:false,time:'Just now'});saveNotifications();closeModal('tourModal');renderProfile();renderHistory();page('history');toast(selectedTour.id?'Tournament registration saved to database.':'Tournament added to your history.')}
function renderTopIdentity(){const box=document.getElementById('userIdentity'),name=document.getElementById('topUserName'),id=document.getElementById('topUserId');if(!box||!name||!id)return;if(user?.id){box.style.display='flex';name.textContent=user.name?(String(user.name).startsWith('@')?user.name:'@'+user.name):'@player';id.textContent=`ID #${user.id}`}else{box.style.display='none'}}
let myTournamentFilter='all';function setMyTournamentFilter(filter){myTournamentFilter=filter;document.querySelectorAll('#myTournamentFilters .chip').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));renderProfile()}function renderProfile(){let u=user||{};renderTopIdentity();document.getElementById('statsPanel').style.display='none';document.getElementById('teamPanel').style.display='none';document.getElementById('profileName').textContent=u.name?(String(u.name).startsWith('@')?u.name:'@'+u.name):'Guest Player';document.getElementById('profileMobile').textContent=u.phone?'+91 '+u.phone:'Not signed in';document.getElementById('pJoined').textContent=joinedTours.length||u.joined||0;document.getElementById('pWins').textContent=joinedTours.filter(x=>x.result?.rank===1).length;document.getElementById('pEarn').textContent='₹0';document.getElementById('authBtn').textContent=u.name?(u.name.split(' ')[0]+' ✓'):'Login / Sign Up';let box=document.getElementById('myTournaments');let count=document.getElementById('myTournamentCount');if(count)count.textContent=`${joinedTours.length} tournament${joinedTours.length===1?'':'s'}`;document.querySelectorAll('#myTournamentFilters .chip').forEach(b=>b.classList.toggle('active',b.dataset.filter===myTournamentFilter));let filteredTours=joinedTours.filter(x=>{let s=String(x.status||'Upcoming').toLowerCase();if(myTournamentFilter==='upcoming')return s==='upcoming';if(myTournamentFilter==='open')return s==='open';if(myTournamentFilter==='ongoing')return s==='ongoing';if(myTournamentFilter==='results')return s==='completed'||!!x.result;return true});if(!filteredTours.length){const emptyText=joinedTours.length?({upcoming:'No upcoming tournaments.',open:'No tournaments currently open.',ongoing:'No ongoing tournaments.',results:'No published results yet.'}[myTournamentFilter]||'No tournaments in this section.'):'No tournaments joined yet.';box.innerHTML=`<div class="empty">${emptyText}</div>`}else{box.innerHTML=filteredTours.slice(0,20).map(x=>`<div style="padding:14px 0;border-bottom:1px solid #25304a"><div class="row"><div><b>${escapeHtml(x.name)}</b><small class="mut">${escapeHtml(x.game)} · ${escapeHtml(x.mode||'Solo')}${x.map?' · '+escapeHtml(x.map):''}</small></div><span class="badge">${escapeHtml(x.status)}</span></div><div class="meta" style="margin-top:6px">Entry ${escapeHtml(x.entry)} · Prize ${escapeHtml(x.prize)} · Team ${escapeHtml(x.team||'Solo')}</div><div class="meta">${x.startTime?new Date(x.startTime).toLocaleString('en-IN'):escapeHtml(x.joinedAt||'')}</div>${x.result?`<div class="meta" style="margin-top:6px;color:#9de8ff">🏆 Result: #${Number(x.result.rank)||'—'} · ${Number(x.result.points)||0} points · ${Number(x.result.kills)||0} kills</div>`:''}${x.teamMembers?`<div class="meta">Members: ${escapeHtml(x.teamMembers)}</div>`:''}<div class="actions"><button class="btn secondary sm" onclick="editMyTeam(${x.registrationId})">✏️ Edit Team</button>${x.tournamentId?`<button class="btn secondary sm" onclick="openRoomForJoined(${joinedTours.indexOf(x)})">🔐 View Room</button>`:''}${x.checkinEnabled&&!x.checkedIn?`<button class="btn secondary sm" onclick="checkIn(${x.registrationId})">✓ Check-in</button>`:''}${x.checkedIn?'<span class="badge">Checked in</span>':''}</div></div>`).join('')}}

function openMoney(m){moneyMode=m;document.getElementById('moneyTitle').textContent=m==='add'?'Add Money':'Withdraw';document.getElementById('amount').value='';document.getElementById('money').classList.add('show')}
function setAmount(a){document.getElementById('amount').value=a}
function moneyAction(){let a=Number(document.getElementById('amount').value);if(!a||a<=0){toast('Enter a valid amount');return}if(a<10){toast('Minimum amount is ₹10');return}closeModal('money');toast('Demo payment flow ready. No real money was charged.')}
function renderWallet(){document.getElementById('navBalance').textContent='₹0';document.getElementById('walletBalance').textContent='₹0';document.getElementById('transactions').innerHTML='<div class="empty">No transactions yet.</div>'}
function toast(m){let t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(window.__t);window.__t=setTimeout(()=>t.classList.remove('show'),3000)}
async function loadRealStats(){if(!user?.id){toast('Login required');return}try{const d=await fetch(`${API_BASE}/api/users/${user.id}/stats`,{headers:authHeaders()}).then(r=>r.json());if(!d.success)throw new Error(d.message);document.getElementById('statsPanel').style.display='block';document.getElementById('realStats').innerHTML=`<div class="stat"><b>${d.stats.joined}</b><small>Joined</small></div><div class="stat"><b>${d.stats.wins}</b><small>Wins</small></div><div class="stat"><b>${d.stats.kills}</b><small>Kills</small></div><div class="stat"><b>${d.stats.points}</b><small>Points</small></div>`;document.getElementById('teamPanel').style.display='none'}catch(e){toast(e.message||'Stats unavailable')}}
async function loadTeamProfile(){if(!user?.id){toast('Login required');return}try{const d=await fetch(`${API_BASE}/api/users/${user.id}/team-profile`,{headers:authHeaders()}).then(r=>r.json());document.getElementById('teamPanel').style.display='block';document.getElementById('statsPanel').style.display='none';document.getElementById('teamProfile').innerHTML=d.team?`<b>${escapeHtml(d.team.team_name)}</b><div class="mut">Mode: ${escapeHtml(d.team.mode||'Solo')} · Tournaments: ${d.team.tournaments}</div><div class="mut">Members: ${escapeHtml(d.team.team_members||'Not added')}</div>`:'<div class="empty">No team profile yet. Join a team tournament and add members.</div>'}catch(e){toast('Team profile unavailable')}}


async function refreshUserData(){if(!user?.id)return;try{await syncRegistrations();await syncNotifications();renderProfile();toast('Account data refreshed')}catch(e){toast(e.message||'Could not refresh account data')}}

async function logoutUser(){
  const token=localStorage.getItem('entsoneSession');
  try{if(token) await fetch(`${API_BASE}/api/auth/logout`,{method:'POST',headers:{Authorization:`Bearer ${token}`}})}catch(e){}
  localStorage.removeItem('entsoneSession');
  localStorage.removeItem('entsoneUser');
  user=null;
  document.body.classList.add('appLocked');
  document.getElementById('loginGate')?.classList.remove('hidden');
  renderProfile();
  page('home');
  toast('Logged out');
}
async function restoreSession(){const token=localStorage.getItem('entsoneSession');if(!token){document.body.classList.remove('appLocked');document.getElementById('loginGate')?.classList.add('hidden');renderProfile();return;}try{const r=await fetch(`${API_BASE}/api/auth/session`,{headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(!r.ok||!d.success)throw new Error('Session expired');user={...d.user,joined:user?.joined||0,wins:user?.wins||0,earn:user?.earn||0};localStorage.setItem('entsoneUser',JSON.stringify(user));document.body.classList.remove('appLocked');document.getElementById('loginGate')?.classList.add('hidden');await syncRegistrations();renderProfile();}catch(e){localStorage.removeItem('entsoneSession');localStorage.removeItem('entsoneUser');user=null;document.body.classList.add('appLocked');document.getElementById('loginGate')?.classList.remove('hidden');renderProfile();console.warn('Session restore skipped:',e.message)}}
async function openSharedTournament(){const slug=new URLSearchParams(location.search).get('tournament');if(!slug)return;try{const d=await fetch(`${API_BASE}/api/share/tournaments/${encodeURIComponent(slug)}`).then(r=>r.json());if(!d.success)return;page('tournaments');await loadBackendTournaments();const t=tours.find(x=>Number(x[7])===Number(d.tournament.id));if(t)openTournament(t[0],t[2],t[3],t[4]);}catch(e){console.warn('Shared tournament unavailable',e.message)}}

function populateBracketTournamentSelect(){const sel=document.getElementById('bracketTournamentSelect');if(!sel)return;const old=sel.value;const rows=(Array.isArray(tours)?tours:[]).filter(t=>Number(t[7])>0);sel.innerHTML='<option value="">Select a tournament…</option>'+rows.map(t=>`<option value="${Number(t[7])}">${escapeHtml(t[0])} · #${Number(t[7])}</option>`).join('');if(old&&rows.some(t=>String(t[7])===old))sel.value=old;}
function selectBracketTournament(value){const input=document.getElementById('bracketTournamentId');if(input)input.value=value||'';if(value)loadBracket();}
async function loadBracket(){
  const raw=document.getElementById('bracketTournamentId')?.value||'';
  const id=Number(raw),status=document.getElementById('bracketStatus'),box=document.getElementById('bracketList');
  if(!Number.isInteger(id)||id<1){status.textContent='Choose a tournament or enter a valid tournament ID.';return}
  const sel=document.getElementById('bracketTournamentSelect');if(sel)sel.value=String(id);
  status.textContent='Loading bracket…';box.innerHTML='';
  try{
    const r=await fetch(`${API_BASE}/api/tournaments/${id}/bracket`),d=await r.json();
    if(!r.ok||!d.success)throw new Error(d.message||'Bracket could not load');
    const matches=Array.isArray(d.matches)?d.matches:[];
    status.textContent=`${d.tournament.name} · ${matches.length} match(es)`;
    if(!matches.length){box.innerHTML='<div class="bracketEmpty">No bracket matches have been generated yet. Once registrations are ready, an admin can generate the first round.</div>';return}
    const rounds=[...new Set(matches.map(m=>Number(m.round_number)||1))].sort((a,b)=>a-b);
    box.innerHTML=rounds.map(round=>{const items=matches.filter(m=>(Number(m.round_number)||1)===round).sort((a,b)=>(Number(a.match_number)||0)-(Number(b.match_number)||0));const title=rounds.length===1?'Round 1':round===rounds[rounds.length-1]?'Final':round===rounds[rounds.length-2]?'Semi-Finals':`Round ${round}`;return `<div class="bracketRound"><div class="bracketRoundTitle">${escapeHtml(title)} <span style="float:right;color:#7c8ba9">${items.length} match${items.length===1?'':'es'}</span></div>${items.map(m=>{const a=escapeHtml(m.participant_a||'TBD'),b=escapeHtml(m.participant_b||'TBD / BYE'),winner=String(m.winner_name||'');const wa=winner&&winner===String(m.participant_a||''),wb=winner&&winner===String(m.participant_b||'');return `<article class="bracketMatch"><div class="bracketMatchMeta"><span>MATCH #${Number(m.match_number)||Number(m.id)}</span><span>${escapeHtml(m.status||'PENDING')}</span></div><div class="bracketTeam ${wa?'winner':''}"><span>${a}</span><span class="bracketScore">${m.score_a===null||m.score_a===undefined?'—':Number(m.score_a)}</span></div><div class="bracketTeam ${wb?'winner':''}"><span>${b}</span><span class="bracketScore">${m.score_b===null||m.score_b===undefined?'—':Number(m.score_b)}</span></div><div class="bracketMatchState">${winner?`🏆 Winner: ${escapeHtml(winner)}`:m.scheduled_at?`Scheduled · ${escapeHtml(new Date(m.scheduled_at).toLocaleString('en-IN'))}`:'Awaiting result'}</div><button class="btn secondary sm" style="margin-top:9px;width:100%" onclick="document.getElementById('disputeMatchId').value='${Number(m.id)}';document.getElementById('disputeReason').focus()">Report Match Issue</button></article>`}).join('')}</div>`}).join('');
    const champion=matches.find(m=>Number(m.round_number)===Math.max(...rounds)&&m.winner_name);if(champion&&rounds.length>1)box.insertAdjacentHTML('beforeend',`<div class="bracketChampion">🏆 Champion: ${escapeHtml(champion.winner_name)}</div>`);
  }catch(e){status.textContent=e.message||'Bracket unavailable'}
}
async function submitMatchDispute(){
  if(!user){toast('Login required');openAuth();return}
  const id=Number(document.getElementById('disputeMatchId').value),reason=document.getElementById('disputeReason').value.trim(),details=document.getElementById('disputeDetails').value.trim(),evidence_url=document.getElementById('disputeEvidence').value.trim(),status=document.getElementById('disputeStatus');
  if(!Number.isInteger(id)||id<1||!reason||!details){status.textContent='Match ID, reason and details are required.';return}
  status.textContent='Submitting…';
  try{const r=await fetch(`${API_BASE}/api/matches/${id}/disputes`,{method:'POST',headers:authHeaders(true),body:JSON.stringify({reason,details,evidence_url})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||'Could not submit dispute');status.textContent=`Dispute #${d.dispute.id} submitted · Status: ${d.dispute.status}`;document.getElementById('disputeReason').value='';document.getElementById('disputeDetails').value='';document.getElementById('disputeEvidence').value='';toast('Dispute submitted successfully')}
  catch(e){status.textContent=e.message||'Dispute submission failed'}
}

setAuthMode('signup');populateBracketTournamentSelect();renderHomeTours();renderGames();renderGlobalPromo();renderProfile();renderWallet();renderHistory();renderNotifications();renderSettings();loadBackendTournaments();restoreSession();openSharedTournament();setInterval(()=>{document.querySelectorAll('.countdownCard').forEach(el=>{const start=new Date(el.dataset.start).getTime(),ms=start-Date.now();if(!start||ms<=0){el.style.display='none';return}let s=Math.floor(ms/1000),d=Math.floor(s/86400);s%=86400;let h=Math.floor(s/3600);s%=3600;let m=Math.floor(s/60);let sec=s%60;el.textContent=`⏳ Starts in ${d?d+'d ':''}${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`})},1000);setInterval(()=>{loadBackendTournaments();if(user?.id)syncNotifications().catch(()=>{});},20000);
