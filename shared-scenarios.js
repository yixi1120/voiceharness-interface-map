'use strict';
(()=>{
const REPO='yixi1120/voiceharness-interface-map',API='https://api.github.com/repos/'+REPO,WEB='https://github.com/'+REPO,MARK='<!-- voiceharness-scenario:v1 -->';
const $=s=>panel.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const panel=document.createElement('dialog');panel.id='sharedDialog';panel.className='publish-dialog';document.body.append(panel);
let timer=null,sequence=0,loaded=[],nextPage=1,hasMore=false,loading=false,loadSequence=-1;
function clean(d){
 if(!d||d.schema!==1||!/^[a-f0-9]{40}$/.test(d.baseCommit))throw Error('方案版本无效');
 const out={schema:1,baseCommit:d.baseCommit};
 for(const k of ['nodes','edges','removedNodes','removedEdges']){if(!Array.isArray(d[k])||d[k].length>2000)throw Error('方案格式无效或过大');out[k]=k.startsWith('removed')?d[k].map(id=>{if(typeof id!=='string'||!/^[\w.-]{1,120}$/.test(id))throw Error('删除项ID无效');return id;}):d[k].map(item=>{
 const keys=k==='nodes'?['id','kind','parent','module','label','summary','signature','input','output','errors']:['id','source','target','type','label'];const v={};for(const key of keys)if(Object.hasOwn(item,key)){if(typeof item[key]!=='string'||item[key].length>10000)throw Error('字段格式无效');v[key]=item[key];}if(!/^[\w.-]{1,120}$/.test(v.id))throw Error('ID无效');return v;});}
 if(JSON.stringify(out).length>40000)throw Error('共享方案超过40,000字符，请拆成几个小方案提交。');
 return out;
}
function encode(d){return btoa(Array.from(new TextEncoder().encode(JSON.stringify(clean(d))),x=>String.fromCharCode(x)).join(''));}
function bodyFor(d,note){return `${MARK}\n这是接口地图的模拟方案，尚未实现或核验；关闭此记录也不表示代码已合入。\n\n说明：${note}\n\n基线：${d.baseCommit}\n\n请保留下方数据块，地图据此恢复方案。\n\n\`\`\`vh-scenario-v1\n${encode(d)}\n\`\`\`\n`;}
function parseIssue(issue){
 if(issue.pull_request||typeof issue.body!=='string'||!issue.body.includes(MARK))return null;
 if(issue.body.length>65000)throw Error('方案正文过大');
 const matches=[...issue.body.matchAll(/```vh-scenario-v1\s+([A-Za-z0-9+/=]+)\s+```/g)];if(matches.length!==1)throw Error('方案数据块缺失或重复');const match=matches[0];if(!match)throw Error('缺少完整方案数据块');
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(match[1]),x=>x.charCodeAt(0)));
 return clean(JSON.parse(raw));
}
function show(title,html){sequence++;clearTimeout(timer);panel.innerHTML=`<div class="lab-heading"><h2>${esc(title)}</h2><button id="sharedClose">关闭</button></div>${html}<p id="sharedStatus" role="status"></p>`;$('#sharedClose').onclick=()=>panel.close();if(!panel.open)panel.showModal();}
function fail(e){const el=$('#sharedStatus');if(el)el.textContent=e.message||String(e);}
async function get(endpoint){const r=await fetch(API+endpoint,{headers:{Accept:'application/vnd.github+json'},credentials:'omit',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(r.status===403||r.status===429?'GitHub 暂时限制访问频率，请稍后刷新，也可直接打开 GitHub 方案记录。':r.status===404?'没有找到此方案，请核对编号。':'暂时无法读取 GitHub（'+r.status+'），请重试。');return r.json();}
function changes(d){return '<details><summary>查看修改清单</summary><ul>'+[...d.nodes.map(n=>'新增/修改节点：'+n.label+' ('+n.id+')'),...d.edges.map(e=>'新增/修改关系：'+e.source+' → '+e.target+' · '+e.type+' · '+e.label),...d.removedNodes.map(id=>'拟删除节点：'+id),...d.removedEdges.map(id=>'拟删除关系：'+id)].map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details>';}
function summary(d){return `${d.nodes.length} 个新增/修改节点 · ${d.edges.length} 条新增/修改连线 · ${d.removedNodes.length} 个删除节点 · ${d.removedEdges.length} 条删除连线`;}
function submit(){
 let d;try{d=clean(window.mapWorkbench.getDraft());window.mapWorkbench.scenario(d);if(!['nodes','edges','removedNodes','removedEdges'].some(k=>d[k].length))throw Error('先在“模拟改图”中保存一些修改，再提交共享方案。');}catch(e){show('提交共享方案','');fail(e);return;}
 show('提交共享方案',`<p>提交后，所有人都可在本网站的“共享方案”打开查看。需要用你自己的 GitHub 账号确认提交；不需要提供令牌。</p><p>${esc(summary(d))}</p><label>方案名称<input id="shareTitle" maxlength="100" placeholder="例如：语音打断接口调整"></label><label>修改说明<textarea id="shareNote" maxlength="2000" placeholder="说明改了什么，希望大家确认什么"></textarea></label><p class="hint">只提交模拟修改项，不上传完整地图或业务源码。此展示仓库公开，请勿在说明或接口字段中填写源码正文、密钥或私人数据。</p><label class="publish-check"><input type="checkbox" id="shareAck">我确认这些接口说明可以公开，准备提交给大家查看。</label><button id="sharePrepare" disabled>生成提交内容</button><div id="shareHandoff"></div>`);
 $('#shareAck').onchange=()=>{$('#sharePrepare').disabled=!$('#shareAck').checked;$('#shareHandoff').innerHTML='';};
 for(const field of ['#shareTitle','#shareNote'])$(field).oninput=()=>{$('#shareHandoff').innerHTML='';};
 $('#sharePrepare').onclick=()=>{try{
 const title=$('#shareTitle').value.trim(),note=$('#shareNote').value.trim();if(!title)throw Error('请填写方案名称');if(note.includes('```vh-scenario-v1'))throw Error('修改说明中不能嵌入方案数据块');
 const body=bodyFor(d,note),scan=JSON.stringify(d)+title+note;if(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}/.test(scan))throw Error('内容疑似包含密钥，请移除后再提交。');
 const params=new URLSearchParams({title:'[模拟方案] '+title,body});let link=WEB+'/issues/new?'+params;
 const long=link.length>6000;if(long)link=WEB+'/issues/new?'+new URLSearchParams({title:'[模拟方案] '+title});
 $('#shareHandoff').innerHTML=`<p>${long?'方案较大：先复制下方提交内容，打开 GitHub 后粘贴到正文，再提交。':'打开 GitHub 后，标题和内容已填好；检查后点击 Create / Submit new issue 完成提交。'}</p><details ${long?'open':''}><summary>检查将公开的提交内容</summary><textarea id="shareBody" readonly rows="7"></textarea></details><button id="copyShareBody">复制提交内容</button> <a id="openGitHubSubmit" class="share-link" href="${esc(link)}" target="_blank" rel="noreferrer">${long?'打开 GitHub 并粘贴':'前往 GitHub 确认提交'} ↗</a><p>打开提交页面还不算同步成功。GitHub 创建记录后，回这里点“查看共享方案”；你和卢同学都能看到。</p><button id="shareAfterSubmit">查看共享方案</button>`;
 $('#shareBody').value=body;$('#copyShareBody').onclick=async()=>{try{await navigator.clipboard.writeText(body);$('#sharedStatus').textContent='已复制，粘贴到 GitHub 正文即可。';}catch{$('#shareBody').focus();$('#shareBody').select();$('#sharedStatus').textContent='请按 Ctrl+C / ⌘C 复制已选中的内容。';}};$('#shareAfterSubmit').onclick=list;
 }catch(e){fail(e);}};
}
function renderList(){
 const container=$('#sharedList');if(!container)return;
 container.innerHTML=loaded.length?loaded.map(i=>`<article class="shared-card"><strong>${esc(i.title)}</strong><p>#${i.number} · ${esc(i.user?.login||'未知账号')} · ${i.state==='closed'?'已关闭（不代表已采纳）':'待讨论'} · ${esc(i.updated_at?.slice(0,10))}</p><button data-proposal="${i.number}">查看方案</button> <a href="${WEB}/issues/${i.number}" target="_blank" rel="noreferrer">GitHub 记录 ↗</a></article>`).join(''):'<p>已加载的记录中还没有共享方案。模拟改图后，点“提交共享方案”开始。</p>';
 container.querySelectorAll('[data-proposal]').forEach(b=>b.onclick=()=>open(Number(b.dataset.proposal)));
 $('#sharedMore').hidden=!hasMore;
}
async function refresh(append=false){
 if(loading&&loadSequence===sequence)return;loading=true;loadSequence=sequence;const ticket=sequence;clearTimeout(timer);$('#sharedStatus').textContent='正在读取共享方案…';
 try{const page=append?nextPage:1;const items=await get(`/issues?state=all&sort=created&direction=desc&per_page=50&page=${page}`);if(ticket!==sequence||!panel.open)return;
 if(!Array.isArray(items))throw Error('GitHub 返回格式不正确');const matches=items.filter(i=>!i.pull_request&&i.body?.includes(MARK)&&Number.isSafeInteger(i.number));loaded=append?[...new Map([...loaded,...matches].map(i=>[i.number,i])).values()]:matches;nextPage=page+1;hasMore=items.length===50;renderList();$('#sharedStatus').textContent=`已读取 ${loaded.length} 个方案。最后刷新：${new Date().toLocaleTimeString()}。提交不会修改正式图。`;}
 catch(e){if(ticket===sequence)fail(e);}finally{if(loadSequence===ticket)loading=false;}
}
function list(){show('共享方案',`<p>这里读取地图仓库里的模拟方案。任何人都可查看，作者以 GitHub 账号为准；查看不会覆盖你的本机草稿。</p><div class="lab-row"><button id="sharedRefresh">刷新方案</button><button id="sharedSubmit">提交我的草稿</button><a href="${WEB}/issues" target="_blank" rel="noreferrer">在 GitHub 查看 ↗</a></div><label>按方案编号打开<input id="proposalNumber" type="number" min="1" placeholder="例如 12"></label><button id="openProposalNumber">打开此方案</button><div id="sharedList"></div><button id="sharedMore" hidden>加载更早记录</button>`);loaded=[];nextPage=1;hasMore=false;$('#sharedRefresh').onclick=()=>refresh();$('#sharedSubmit').onclick=submit;$('#sharedMore').onclick=()=>refresh(true);$('#openProposalNumber').onclick=()=>{const n=Number($('#proposalNumber').value);if(Number.isSafeInteger(n)&&n>0)open(n);else fail(Error('请输入有效编号'));};refresh();}
async function open(number){
 if(!Number.isSafeInteger(number)||number<1)return;show('读取共享方案',`<p>正在读取 #${number}…</p>`);const ticket=sequence;
 try{const issue=await get('/issues/'+number);if(ticket!==sequence||!panel.open)return;const d=parseIssue(issue);if(!d)throw Error('此记录不是接口地图模拟方案');let incompatible='';try{window.mapWorkbench.scenario(d);}catch(e){incompatible=e.message;}
 show('共享方案 #'+number,`<h3>${esc(issue.title)}</h3><p>提交账号：${esc(issue.user?.login)} · ${issue.state==='closed'?'已关闭（不表示已实现）':'待讨论'}<br>基线：<code>${esc(d.baseCommit)}</code></p><p>${esc(summary(d))}</p>${changes(d)}<p>${incompatible?'当前图无法套用此方案：'+esc(incompatible):'可以在图上预览。所有改动仍标为 Proposed，正式图和你原有的草稿不会改变。'}</p><div class="lab-row"><button id="previewShared" ${incompatible?'disabled':''}>在图上预览</button><button id="adoptShared" ${incompatible?'disabled':''}>复制到我的草稿继续改</button><button id="downloadShared">下载方案</button><button id="backShared">返回列表</button></div><p><a href="${WEB}/issues/${number}" target="_blank" rel="noreferrer">查看说明 / 讨论 / 编辑 / 关闭记录 ↗</a></p><button id="copyProposalLink">复制本网站方案链接</button>`);
 $('#previewShared').onclick=()=>{window.mapWorkbench.previewShared(d,'#'+number+' '+issue.title);panel.close();};$('#adoptShared').onclick=()=>{if(!confirm('这会替换你当前浏览器的模拟草稿。需要保留时，请先导出原草稿。继续？'))return;try{window.mapWorkbench.adoptShared(d);panel.close();}catch(e){fail(e);}};
 $('#downloadShared').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`voiceharness-proposal-${number}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};$('#backShared').onclick=list;
 $('#copyProposalLink').onclick=async()=>{const url='https://yixi1120.github.io/voiceharness-interface-map/#proposal='+number;try{await navigator.clipboard.writeText(url);$('#sharedStatus').textContent='已复制方案链接。';}catch{$('#sharedStatus').textContent=url;}};
 }catch(e){if(ticket===sequence){fail(e);}}
}
panel.addEventListener('close',()=>{sequence++;clearTimeout(timer);});window.addEventListener('map-share-list',list);window.addEventListener('map-share-submit',submit);window.addEventListener('focus',()=>{if(panel.open&&$('#sharedList')&&!loading)refresh();});
function deepLink(){const m=location.hash.match(/^#proposal=([1-9][0-9]{0,8})$/);if(m)open(Number(m[1]));}window.addEventListener('hashchange',deepLink);deepLink();
window.sharedScenarios={clean,bodyFor,parseIssue};
})();
