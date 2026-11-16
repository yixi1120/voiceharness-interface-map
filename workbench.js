'use strict';
(()=>{
const publicView=window.MAP_PUBLIC===true;
const map=window.interfaceMap,base=structuredClone(map.data),$=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const baseLabel=base.meta.modeLabel||'已核验基线';
const key='voiceharness-scenario-v1:'+base.meta.referenceCommit;
const empty=()=>({schema:1,baseCommit:base.meta.referenceCommit,nodes:[],edges:[],removedNodes:[],removedEdges:[]});
let draft=empty(),mode='baseline',candidate=null,csrf='',editingNode='',editingEdge='',updatePending=false,sharedContext=null;
const id=()=> 'draft.'+crypto.randomUUID();
function validate(d){
 if(!d||d.schema!==1||d.baseCommit!==base.meta.referenceCommit)throw Error('草稿基线版本不一致，不能直接覆盖当前图。');
 for(const k of ['nodes','edges','removedNodes','removedEdges'])if(!Array.isArray(d[k])||d[k].length>2000)throw Error('草稿格式无效或过大');
 for(const n of d.nodes){if(!/^[\w.-]{1,120}$/.test(n.id)||!['module','component','interface'].includes(n.kind))throw Error('节点类型或ID无效');for(const v of Object.values(n))if(typeof v!=='string'||v.length>10000)throw Error('节点字段无效');}
 for(const e of d.edges){if(!/^[\w.-]{1,120}$/.test(e.id)||!base.meta.relations.includes(e.type))throw Error('连线类型或ID无效');for(const v of Object.values(e))if(typeof v!=='string'||v.length>10000)throw Error('连线字段无效');}
 for(const k of ['nodes','edges'])if(new Set(d[k].map(x=>x.id)).size!==d[k].length)throw Error('草稿包含重复ID');
}
function scenario(d=draft){
 validate(d);const g=structuredClone(base),nodes=new Map(g.nodes.map(n=>[n.id,n]));
 for(const n of d.nodes){const original=nodes.get(n.id);if(original&&original.kind!==n.kind)throw Error('不能更改原节点的层级类型');nodes.set(n.id,{...original,...n,status:'Proposed',evidence:[],signatureNote:'模拟草稿：尚未修改业务代码，也未核验接口实现。'});}
 const removed=new Set(d.removedNodes);let changed=true;while(changed){changed=false;for(const n of nodes.values())if(removed.has(n.parent)&&!removed.has(n.id)){removed.add(n.id);changed=true;}}
 for(const x of removed)nodes.delete(x);
 for(const n of nodes.values()){
  if(n.kind==='module'){n.module=n.id;delete n.parent;continue;}
  const p=nodes.get(n.parent);if(!p||(n.kind==='component'&&p.kind!=='module')||(n.kind==='interface'&&!['component','module'].includes(p.kind)))throw Error('请选择有效的父模块或组件');
  n.module=p.kind==='module'?p.id:p.module;if(!nodes.has(n.module))throw Error('节点所属模块无效');
 }
 const edges=new Map(g.edges.filter(e=>nodes.has(e.source)&&nodes.has(e.target)&&!d.removedEdges.includes(e.id)).map(e=>[e.id,e]));
 for(const e of d.edges){if(removed.has(e.source)||removed.has(e.target))continue;if(!nodes.has(e.source)||!nodes.has(e.target))throw Error('连线两端必须存在');edges.set(e.id,{...e,status:'Proposed',evidence:[]});}
 const edited=new Set(d.nodes.map(n=>n.id));for(const e of edges.values())if(edited.has(e.source)||edited.has(e.target)){e.status='Proposed';e.evidence=[];}
 g.nodes=[...nodes.values()];g.edges=[...edges.values()];g.hierarchy=g.nodes.filter(n=>n.parent).map(n=>({source:n.parent,target:n.id,type:nodes.get(n.parent).kind==='component'?'Defines':'Contains'}));
 for(const n of g.nodes){n.callers=g.edges.filter(e=>e.target===n.id&&e.type==='Calls').map(e=>({node:e.source,edge:e.id}));n.consumers=g.edges.filter(e=>e.source===n.id&&e.type==='Data Flow').map(e=>({node:e.target,edge:e.id}));n.relatedEdges=g.edges.filter(e=>e.source===n.id||e.target===n.id).map(e=>e.id);}
 g.tours=g.tours.map(t=>({...t,nodes:t.nodes.filter(x=>nodes.has(x))}));g.meta.modeLabel='模拟草稿 · 未改业务代码';return g;
}
function save(){scenario();localStorage.setItem(key,JSON.stringify(draft));}
function message(s){$('labMessage').textContent=s;}
function bar(){ $('labBar').innerHTML=`<strong>${publicView?'接口地图 · 方案模拟':'本地试验台'}</strong><span id="labMode">${esc(baseLabel)}</span><button id="labDraft">模拟改图</button><button id="labShared">共享方案</button><button id="labCompare">前后对比</button>${publicView?'':'<button id="labUpdate">源码更新</button><button id="labPublish">发布分享版</button>'}<button id="labBase">恢复基线</button><span id="labMessage"></span>`;}
function preview(g,label){map.replaceGraph(g);$('labMode').textContent=label;$('labDialog').close();}
function showDraft(){sharedContext=null;mode='draft';preview(scenario(),'模拟草稿 · 不改主代码');}
function options(list,value=''){return list.map(n=>`<option value="${esc(n.id)}" ${value===n.id?'selected':''}>${esc(n.label||n.id)} · ${esc(n.id)}</option>`).join('');}
function dialog(title,html){$('labDialog').innerHTML=`<div class="lab-heading"><h2>${esc(title)}</h2><button id="labClose">关闭</button></div>${html}`;$('labClose').onclick=()=>$('labDialog').close();if(!$('labDialog').open)$('labDialog').show();}
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function mutate(fn){const old=structuredClone(draft);try{fn();save();showDraft();message('草稿已保存在此浏览器；业务代码和当前发布数据未变。');}catch(e){draft=old;message(e.message);alert(e.message);}}
function editor(){
 const g=scenario();dialog('模拟添加与调整',`<p>先在图里试方案。新增、修改的节点及其连线标为 Proposed；含义是拟议关系，不会变成源码事实。</p><div class="lab-row"><button id="draftExample">添加摘要接入示例</button><button id="draftPreview">预览草稿</button><button id="draftExport">导出草稿</button><button id="draftSubmit">提交共享方案</button><button id="draftCompare">对比我的修改</button><label class="lab-import">导入草稿<input id="draftImport" type="file" accept=".json"></label></div><p class="hint">${publicView?'草稿先保存在你的浏览器。点“提交共享方案”并在 GitHub 确认后，其他人可在“共享方案”查看。':'草稿只含修改项，不附业务源码；图上“完整数据 JSON”仍是本地研究资料，不可直接公开。'}</p>
 <h3>节点</h3><label>选择已有节点编辑<select id="nodePick"><option value="">新增节点…</option>${options(g.nodes)}</select></label>
 <form id="nodeForm"><label>层级<select id="nodeKind"><option value="interface">接口</option><option value="component">组件</option><option value="module">模块</option></select></label><label>属于哪个模块 / 组件<select id="nodeParent"></select></label><label>名称<input id="nodeLabel" required maxlength="120" placeholder="例如 summarizeConversation"></label><label>一句话用途<textarea id="nodeSummary" maxlength="2000"></textarea></label><label>签名<input id="nodeSignature" placeholder="例如 summarize(input): Summary"></label><label>输入<input id="nodeInput"></label><label>输出<input id="nodeOutput"></label><label>错误与取消<input id="nodeErrors"></label><div class="lab-row"><button type="submit">保存节点并预览</button><button type="button" id="nodeDelete">模拟删除此节点</button></div></form>
 <h3>连线</h3><label>选择已有连线<select id="edgePick"><option value="">新增连线…</option>${options(g.edges.map(e=>({id:e.id,label:g.nodes.find(n=>n.id===e.source)?.label+' → '+g.nodes.find(n=>n.id===e.target)?.label+' · '+e.type})))}</select></label>
 <form id="edgeForm"><label>起点<select id="edgeSource">${options(g.nodes)}</select></label><label>终点<select id="edgeTarget">${options(g.nodes)}</select></label><label>关系<select id="edgeType">${base.meta.relations.map(t=>`<option>${esc(t)}</option>`).join('')}</select></label><label>说明<input id="edgeLabel" required maxlength="200" placeholder="例如把对话交给摘要模块"></label><div class="lab-row"><button type="submit">保存连线并预览</button><button type="button" id="edgeDelete">模拟删除此连线</button></div></form><hr><button id="draftReset">清空本地草稿</button>`);
 editingNode='';editingEdge='';
 function parents(){const kind=$('nodeKind').value;const a=g.nodes.filter(n=>n.id!==editingNode&&(kind==='component'?n.kind==='module':['module','component'].includes(n.kind)));$('nodeParent').innerHTML=options(a);$('nodeParent').disabled=kind==='module';}
 parents();$('nodeKind').onchange=parents;
 $('nodePick').onchange=()=>{editingNode=$('nodePick').value;const n=g.nodes.find(x=>x.id===editingNode);$('nodeKind').disabled=!!n;$('nodeKind').value=n?.kind||'interface';parents();if(n?.parent)$('nodeParent').value=n.parent;for(const [field,k] of [['Label','label'],['Summary','summary'],['Signature','signature'],['Input','input'],['Output','output'],['Errors','errors']])$('node'+field).value=n?.[k]||'';};
 $('nodeForm').onsubmit=e=>{e.preventDefault();mutate(()=>{const n={id:editingNode||id(),kind:$('nodeKind').value,parent:$('nodeParent').value,label:$('nodeLabel').value.trim(),summary:$('nodeSummary').value,signature:$('nodeSignature').value,input:$('nodeInput').value,output:$('nodeOutput').value,errors:$('nodeErrors').value};if(!n.label)throw Error('请输入名称');const parent=g.nodes.find(x=>x.id===n.parent);n.module=n.kind==='module'?n.id:parent.kind==='module'?parent.id:parent.module;draft.nodes=draft.nodes.filter(x=>x.id!==n.id);draft.nodes.push(n);});};
 $('nodeDelete').onclick=()=>{if(!editingNode)return;if(confirm('只在草稿中删除此节点、子节点及相关连线？'))mutate(()=>{draft.removedNodes.push(editingNode);draft.nodes=draft.nodes.filter(n=>n.id!==editingNode);draft.edges=draft.edges.filter(e=>e.source!==editingNode&&e.target!==editingNode);});};
 $('edgePick').onchange=()=>{editingEdge=$('edgePick').value;const e=g.edges.find(x=>x.id===editingEdge);if(e){$('edgeSource').value=e.source;$('edgeTarget').value=e.target;$('edgeType').value=e.type;$('edgeLabel').value=e.label;}};
 $('edgeForm').onsubmit=e=>{e.preventDefault();mutate(()=>{const edge={id:editingEdge||id(),source:$('edgeSource').value,target:$('edgeTarget').value,type:$('edgeType').value,label:$('edgeLabel').value.trim()};if(!edge.label)throw Error('请输入连线说明');draft.edges=draft.edges.filter(x=>x.id!==edge.id);draft.edges.push(edge);});};
 $('edgeDelete').onclick=()=>{if(editingEdge)mutate(()=>{draft.removedEdges.push(editingEdge);draft.edges=draft.edges.filter(e=>e.id!==editingEdge);});};
 $('draftExample').onclick=()=>mutate(()=>{const component=id(),api=id();draft.nodes.push({id:component,kind:'component',module:'eff',parent:'eff',label:'拟议摘要服务',summary:'讨论用替换方案，尚未实现。'},{id:api,kind:'interface',module:'eff',parent:component,label:'summarizeDraft',signature:'summarizeDraft(input, signal): Summary',input:'待总结的对话与取消信号',output:'摘要文本与来源范围',summary:'先在图里讨论摘要交接，不执行摘要。',errors:'拟议：取消后不发布迟到结果；待团队确认。'});draft.edges.push({id:id(),source:'live.session',target:api,type:'Calls',label:'拟议：主流程调用摘要服务'});});
 $('draftCompare').onclick=()=>{$('labDialog').close();window.ScenarioCompare.open(draft,'我的模拟草稿');};
 $('draftSubmit').onclick=()=>{$('labDialog').close();window.dispatchEvent(new Event('map-share-submit'));};
 $('draftPreview').onclick=showDraft;$('draftExport').onclick=()=>download(draft,'voiceharness-scenario.json');
 $('draftImport').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>2000000)throw Error('草稿过大');const d=JSON.parse(await f.text());scenario(d);draft=d;save();showDraft();}catch(error){alert(error.message);}};
 $('draftReset').onclick=()=>{if(confirm('清空此浏览器的模拟草稿？已核验基线不受影响。')){draft=empty();save();mode='baseline';preview(base,baseLabel);}};
}
function reportHTML(){if(!candidate)return '<p>还没有更新候选。先读取本地代码或拉取远端 main。</p>';const r=candidate.report;return `<h3>更新报告</h3><p>版本：${esc(r.version.label)}<br>变化或缺失文件：${r.files.filter(f=>f.state!=='unchanged').length}<br>受影响节点：${r.affectedNodes.length}；关系：${r.affectedEdges.length}</p><div class="lab-row"><button id="candidatePreview">预览候选图</button><button id="reportExport">导出待审清单</button></div><details><summary>文件与受影响接口</summary><ul>${r.files.filter(f=>f.state!=='unchanged').map(f=>`<li>${esc(f.path)} · ${esc(f.state)}</li>`).join('')}</ul><p>${r.affectedNodes.map(esc).join('、')||'已收录证据对应文件均未变化。'}</p></details><details><summary>声明定位线索（${r.declarations.length}，最多列 500 项）</summary><p>仅扫描变化或此前未收录文件里的 export 声明，不是新增接口结论，不推断调用方。可核对后通过“模拟改图”选择模块和归属。</p><ul>${r.declarations.map(d=>`<li>${esc(d.name)} · ${esc(d.kind)}<br>${esc(d.path)}:${d.line} · Unverified</li>`).join('')}</ul></details>`;}
async function updates(){dialog('源码更新 · 本地专用',`<p>读取代码，不执行代码，不修改工作仓库。远端拉取使用本机 Git 现有身份，私有缓存不在网页服务目录内。</p><label>本地 VoiceHarness 根目录<input id="sourcePath" placeholder="/你的路径/VoiceHarness" value="${esc(localStorage.getItem('vh-source-path')||base.meta.sourceRoot||'')}"></label><div class="lab-row"><button id="readLocal">检查本地代码</button><button id="fetchRemote">拉取远端 main 并检查</button><button id="loadCandidate">读取上次候选</button></div><p id="updateState" role="status">连接本地更新服务…</p><p class="hint">远端固定为 colus-liu/VoiceHarness。文件变化会使相关旧节点/连线降为 Unverified；不会仅凭函数同名画新箭头。候选图只在本地预览，不覆盖基线、不自动上传 GitHub。</p><div id="updateReport">${reportHTML()}</div>`);
 function bindReport(){$('candidatePreview')?.addEventListener('click',()=>{mode='candidate';preview(candidate.graph,'更新候选 · 旧接口说明待复核');});$('reportExport')?.addEventListener('click',()=>download(candidate.report,'voiceharness-update-review.json'));}
 bindReport();
 const buttons=['readLocal','fetchRemote','loadCandidate'];buttons.forEach(k=>$(k).disabled=true);
 try{if(!['localhost','127.0.0.1'].includes(location.hostname))throw Error('请通过本机 serve.mjs 打开试验台。');const r=await fetch('/api/status');const s=await r.json();if(!r.ok||!s.local)throw Error('请重启本地服务，加载新版 serve.mjs。');csrf=s.csrf;buttons.forEach(k=>$(k).disabled=s.busy);$('updateState').textContent=s.busy?'已有更新进行中，请稍后重新打开。':'本地服务可用。';}catch(e){$('updateState').textContent=e.message;return;}
 async function run(mode){updatePending=true;buttons.forEach(k=>$(k).disabled=true);$('updateState').textContent=mode==='remote'?'正在拉取并比对，请等待；不会运行主仓库代码…':'正在读取本地文件并比对…';try{const sourcePath=$('sourcePath').value;const r=await fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json','X-Map-CSRF':csrf},body:JSON.stringify({mode,sourcePath})});const d=await r.json();if(!r.ok)throw Error(d.error);candidate=d;if(mode==='local')localStorage.setItem('vh-source-path',sourcePath);$('updateReport').innerHTML=reportHTML();bindReport();$('updateState').textContent='候选已生成，点击“预览候选图”查看。';}catch(e){$('updateState').textContent=e.message;}finally{updatePending=false;buttons.forEach(k=>{if($(k))$(k).disabled=false;});}}
 $('readLocal').onclick=()=>run('local');$('fetchRemote').onclick=()=>run('remote');$('loadCandidate').onclick=async()=>{try{const r=await fetch('/api/candidate');const d=await r.json();if(!r.ok)throw Error(d.error);candidate=d;$('updateReport').innerHTML=reportHTML();bindReport();$('updateState').textContent='已读取上次候选；注意版本时间。';}catch(e){$('updateState').textContent=e.message;}};
}
bar();try{const saved=localStorage.getItem(key);if(saved){const d=JSON.parse(saved);scenario(d);draft=d;message('发现已保存草稿，点“模拟改图”继续。');}}catch{message('旧草稿未通过校验，未自动应用。');}
$('labDraft').onclick=()=>{if(updatePending){message('更新尚未完成，请稍后再编辑。');return;}try{editor();}catch(e){alert(e.message);}};if(!publicView)$('labUpdate').onclick=()=>{if(updatePending){message('更新正在进行，请等待完成。');return;}updates();};$('labBase').onclick=()=>{mode='baseline';preview(base,baseLabel);message('已恢复；模拟草稿仍保存在本浏览器。');};
if(!publicView)$('labPublish').onclick=()=>window.dispatchEvent(new Event('map-publish-open'));
$('labCompare').onclick=()=>window.ScenarioCompare.openCurrent();
$('labShared').onclick=()=>window.dispatchEvent(new Event('map-share-list'));
window.mapWorkbench={scenario,getDraft:()=>structuredClone(draft),getMode:()=>mode,getBase:()=>structuredClone(base),getComparisonTarget:()=>mode==='shared'&&sharedContext?structuredClone(sharedContext):{draft:structuredClone(draft),title:'我的模拟草稿'},
 showComparison(g,label){mode='compare';preview(g,label);$('proposed').checked=true;$('proposed').dispatchEvent(new Event('change'));},
 previewShared(d,title){sharedContext={draft:structuredClone(d),title};const g=scenario(d);g.meta.modeLabel='共享方案 · '+title+' · 尚未实现';mode='shared';preview(g,g.meta.modeLabel);$('proposed').checked=true;$('proposed').dispatchEvent(new Event('change'));const first=d.nodes.find(n=>n.kind==='interface')||d.nodes[0];if(first)map.select(first.id);else if(d.edges[0])map.select(d.edges[0].target);message('正在查看共享方案；你自己的模拟草稿未被覆盖。');},
 adoptShared(d){scenario(d);const old=draft;try{draft=structuredClone(d);save();showDraft();message('已复制为本机草稿，继续修改后可提交为新的共享方案。');}catch(e){draft=old;throw e;}}
};
})();
