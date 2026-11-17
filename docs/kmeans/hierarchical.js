/* DS 6021 hierarchical weather tab, sharing the KMeans weather dataset. */
(function(){
"use strict";
const host=document.getElementById("hier-panel"), Core=window.HierarchicalCore;
if(!host)return;
const colors=["#232d4b","#e57200","#147d80","#8252a0","#687c25","#b04446","#3978a6","#a16b27","#8d527c","#58776e"];
host.innerHTML=[
'<div class="learning-question"><strong>How do weather hours form a hierarchy?</strong><span>Start with each weather hour alone, repeatedly merge the closest groups, then cut the completed tree. Weather-condition labels are never used.</span></div>',
'<div class="hier-links"><a href="downloads/Hierarchical_Clustering_Notes.html" target="_blank" rel="noopener">Lecture notes ↗</a><a href="https://colab.research.google.com/github/afriyiep1/ds6021-predictive-modeling/blob/main/docs/kmeans/downloads/Hierarchical_Clustering_Colab.ipynb" target="_blank" rel="noopener">Open Python notebook in Colab ↗</a><a href="downloads/Hierarchical_Clustering_Colab.ipynb" download>Download notebook</a></div>',
'<div class="hier-config">',
'<label>Features<select data-h="dims"><option value="2">2D · cloud + humidity</option><option value="3">3D · add precipitation</option></select></label>',
'<label>Distance<select data-h="metric"><option value="euclidean">Euclidean</option><option value="gower">Gower · numeric + daypart</option></select></label>',
'<label>Linkage<select data-h="linkage"><option value="single">Single · closest pair</option><option value="complete">Complete · farthest pair</option><option value="average" selected>Average · mean distance</option><option value="ward">Ward · SSE increase</option></select></label>',
'<label>Scale<select data-h="scale"><option value="standardized" selected>Standardized (z-scores)</option><option value="raw">Raw units</option></select></label>',
'<label>Sample<select data-h="sample"><option value="24">24 hours</option><option value="48" selected>48 hours</option><option value="72">72 hours</option><option value="96">96 hours</option></select></label>',
'</div><p class="hier-hint" data-h="scale-note"></p>',
'<div class="hier-progress"><button type="button" class="button secondary" data-h="prev">← Previous</button><button type="button" class="button primary" data-h="next">Next merge →</button><button type="button" class="button secondary" data-h="finish">Complete tree</button><button type="button" class="button secondary" data-h="reset">Reset</button><span>Merge <strong data-h="step-index">0 / 0</strong></span></div>',
'<input class="hier-step" data-h="step" aria-label="Merge step" type="range" min="0" max="47" value="0">',
'<div class="hier-stats"><div>Sampled hours<strong data-h="count">—</strong></div><div>Current groups<strong data-h="group-count">—</strong></div><div>Cut silhouette<strong data-h="silhouette">—</strong></div><div>Best K by silhouette<strong data-h="best">—</strong></div></div>',
'<p class="hier-status" data-h="status" role="status">Loading shared weather data…</p>',
'<div class="hier-merge" data-h="merge-message"></div>',
'<div class="hier-plots"><section><h3>1 · Watch groups merge</h3><div class="hier-plot" data-h="scatter"></div><p class="hier-hint">Colors represent the groups at the current step.</p></section><section><h3>2 · Read the dendrogram</h3><div class="hier-plot" data-h="tree"></div><p class="hier-hint" data-h="height-note"></p></section></div>',
'<div class="hier-kbar"><label>3 · Cut the full hierarchy at K = <strong data-h="k-label">3</strong><input data-h="k" type="range" min="2" max="10" value="3"></label><div data-h="chosen"></div></div>',
'<div class="hier-plots hier-bottom"><section><h3>Average silhouette vs. K</h3><div class="hier-plot hier-short" data-h="scores"></div></section><section><h3>Silhouette profiles for selected K</h3><div class="hier-plot hier-short" data-h="profile"></div></section></div>',
'<div class="hier-teaching"><div><h3>Why linkage matters</h3><p><strong>Single:</strong> shortest distance between any two points in different groups; can create chains. <strong>Complete:</strong> longest cross-group distance; tends to form compact groups. <strong>Average:</strong> mean cross-group distance. <strong>Ward:</strong> merges that cause the smallest increase in within-group SSE.</p><p>Unlike K-means, hierarchical clustering builds the entire nested tree before you choose K. Previously merged groups never split apart.</p></div><div><h3>What do weather groups mean?</h3><p>Check whether clusters reflect cloudiness, humidity, and precipitation. The algorithm never sees official weather labels. Try raw versus standardized Euclidean geometry, then Gower with the categorical time-of-day feature.</p><p class="hier-hint" data-h="distance-note"></p><p class="hier-hint">For classroom performance this display selects evenly spaced complete hours from the same 60-day model-estimated weather dataset as the other tabs. The sampled hours are not independent observations.</p></div></div>'
].join("");
const el=role=>host.querySelector('[data-h="'+role+'"]');
const number=x=>Number.isFinite(x)?x.toFixed(3):"—";
let data=null,signature="",fit=null,active=false,step=0,scoreTable=[],dirty=true;
function getData(){return window.KMeansLab&&window.KMeansLab.getDataset&&window.KMeansLab.getDataset();}
function dataKey(d){if(!d||!d.rows||!d.rows.length)return "";const a=d.rows;return [a.length,a[0].time,a[a.length-1].time,(d.metadata||{}).retrieved_at].join("|");}
function setData(d){const k=dataKey(d);if(!k||k===signature)return;signature=k;data=d;dirty=true;if(active)rebuild();}
function warn(t){el("status").textContent=t;}
function features(){
 const keys=el("dims").value==="3"?["cloud_cover","relative_humidity_2m","precipitation"]:["cloud_cover","relative_humidity_2m"];
 const complete=data.rows.filter(r=>Number.isFinite(Number(r.time))&&["cloud_cover","relative_humidity_2m","precipitation"].every(f=>Number.isFinite(Number(r[f]))));
 const n=Math.min(Number(el("sample").value),complete.length), rows=[];
 for(let i=0;i<n;i++)rows.push(complete[Math.floor((i+.5)*complete.length/n)]);
 const v=rows.map(r=>keys.map(f=>Number(r[f])));
 const means=keys.map((_,j)=>v.reduce((s,a)=>s+a[j],0)/n);
 const sd=keys.map((_,j)=>Math.sqrt(v.reduce((s,a)=>s+(a[j]-means[j])**2,0)/n)||1);
 const min=keys.map((_,j)=>Math.min(...v.map(a=>a[j])));
 const range=keys.map((_,j)=>Math.max(...v.map(a=>a[j]))-min[j]||1);
 const daypart=rows.map(r=>Math.floor((Number(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"numeric",hour12:false}).format(new Date(Number(r.time)*1000)))%24)/6));
 const metric=el("metric").value;
 const points=v.map((a,i)=>metric==="gower"?a.map((x,j)=>(x-min[j])/range[j]).concat([daypart[i]]):a.map((x,j)=>el("scale").value==="raw"?x:(x-means[j])/sd[j]));
 return {rows,keys,points,metric};
}
function showOptions(){
 const g=el("metric").value==="gower",ward=el("linkage").querySelector('[value="ward"]');
 ward.disabled=g;if(g&&el("linkage").value==="ward")el("linkage").value="average";
 el("scale").disabled=g;
 el("scale-note").textContent=g?"Gower uses normalized numeric differences plus a categorical daypart (night/morning/afternoon/evening). Ward is not defined for this dissimilarity.":"Use raw or standardized Euclidean distance. Raw precipitation (mm) may contribute less than cloud cover (%) due to its scale.";
}
function rebuild(){
 if(!active)return;
 if(!data){warn("Loading shared weather observations…");return;}
 try{
  if(!Core||!window.Plotly)throw Error("The clustering or chart library did not load.");
  showOptions();
  const p=features();if(p.rows.length<4)throw Error("Not enough complete observations");
  fit={...Core.agglomerate(p.points,el("linkage").value,p.metric),p};
  scoreTable=Core.compareCuts(fit,Math.min(10,fit.n-1));
  step=0;el("step").max=fit.n-1;el("step").value=0;el("k").max=Math.min(10,fit.n-1);
  if(+el("k").value>+el("k").max)el("k").value=el("k").max;
  dirty=false;
  warn("Ready. Move through the merges, change linkage, or cut the completed hierarchy at K.");
  render();
 }catch(e){warn("Could not fit hierarchy: "+e.message);console.error(e);}
}
function renderScatter(){
 const {rows,keys}=fit.p,n=fit.n,{clusters}=Core.labelsAt(fit,n-step),is3=keys.length===3;
 const xs=rows.map(r=>Number(r.cloud_cover)),ys=rows.map(r=>Number(r.relative_humidity_2m)),zs=rows.map(r=>Number(r.precipitation));
 const traces=clusters.map((indices,c)=>{
  const tr={type:is3?"scatter3d":"scatter",mode:"markers",name:"Group "+(c+1),x:indices.map(i=>xs[i]),y:indices.map(i=>ys[i]),
   marker:{size:is3?5:8,color:colors[c%colors.length],opacity:.85},text:indices.map(i=>new Date(Number(rows[i].time)*1000).toLocaleString("en-US",{timeZone:"America/New_York"})+" · precipitation "+zs[i].toFixed(1)+" mm"),hovertemplate:"%{text}<br>Cloud: %{x:.1f}%<br>Humidity: %{y:.1f}%<extra></extra>"};
  if(is3)tr.z=indices.map(i=>zs[i]);return tr;
 });
 const lay={margin:{l:56,r:10,b:48,t:10},showlegend:clusters.length<=7,legend:{orientation:"h",y:-.25,font:{size:10}},paper_bgcolor:"#fff",plot_bgcolor:"#fff",
  font:{size:11},xaxis:{title:"Cloud cover (%)"},yaxis:{title:"Humidity (%)"}};
 if(is3){lay.margin={l:0,r:0,t:0,b:0};lay.scene={xaxis:{title:"Cloud cover (%)"},yaxis:{title:"Humidity (%)"},zaxis:{title:"Precipitation (mm)"}};delete lay.xaxis;delete lay.yaxis;}
 return Plotly.react(el("scatter"),traces,lay,{responsive:true,displaylogo:false});
}
function renderTree(){
 let leaf=0;const px=new Map(),traces=[];
 function locate(node){if(!node.children){px.set(node.id,leaf++);return px.get(node.id);}const a=locate(node.children[0]),b=locate(node.children[1]);px.set(node.id,(a+b)/2);return (a+b)/2;}
 locate(fit.root);
 function traverse(node){if(!node.children)return;const a=node.children[0],b=node.children[1];
  traces.push({type:"scatter",mode:"lines",x:[px.get(a.id),px.get(a.id),px.get(b.id),px.get(b.id)],y:[a.height||0,node.height,node.height,b.height||0],
   line:{color:node.id<fit.n+step?"#e57200":"#657488",width:node.id<fit.n+step?2.7:1.5},showlegend:false,hoverinfo:"skip"});
  traverse(a);traverse(b);}
 traverse(fit.root);
 const k=+el("k").value,low=fit.merge[fit.n-k-1]?.height||0,high=fit.merge[fit.n-k]?.height||low,cut=(low+high)/2;
 traces.push({type:"scatter",mode:"lines",x:[-.5,fit.n-.5],y:[cut,cut],line:{color:"#c75632",dash:"dash",width:2},showlegend:false,hoverinfo:"skip"});
 return Plotly.react(el("tree"),traces,{paper_bgcolor:"#fff",plot_bgcolor:"#fff",margin:{l:55,r:15,b:40,t:13},font:{size:11},
  xaxis:{title:"Weather hours (leaves)",showticklabels:false,showgrid:false,range:[-.5,fit.n-.5]},
  yaxis:{title:fit.method==="ward"?"Ward height":"Linkage height",rangemode:"tozero"},
  annotations:[{xref:"paper",yref:"paper",x:1,y:1.09,showarrow:false,text:"Dashed line: K = "+k,font:{size:10,color:"#c75632"}}]},{responsive:true,displaylogo:false});
}
function renderScores(){
 const k=+el("k").value;
 return Plotly.react(el("scores"),[{type:"scatter",mode:"lines+markers",x:scoreTable.map(x=>x.k),y:scoreTable.map(x=>x.mean),line:{color:"#232d4b"},
 marker:{size:scoreTable.map(x=>x.k===k?11:7),color:scoreTable.map(x=>x.k===k?"#e57200":"#232d4b")},hovertemplate:"K = %{x}<br>Mean silhouette = %{y:.3f}<extra></extra>"}],
 {paper_bgcolor:"#fff",plot_bgcolor:"#fff",margin:{l:52,r:15,b:47,t:10},font:{size:11},xaxis:{title:"K",dtick:1},yaxis:{title:"Mean silhouette",range:[-1,1]}},{responsive:true,displaylogo:false});
}
function renderProfile(){
 const k=+el("k").value,{labels}=Core.labelsAt(fit,k),scores=Core.silhouettes(fit.D,labels);
 const group=Array.from({length:k},()=>[]);labels.forEach((label,i)=>group[label].push({i,s:scores.values[i]}));
 const traces=group.map((a,c)=>({type:"bar",orientation:"h",name:"Cluster "+(c+1),x:a.sort((a,b)=>a.s-b.s).map(x=>x.s),
 y:a.map(x=>"Hour "+(x.i+1)),marker:{color:colors[c%colors.length]},hovertemplate:"%{y}<br>Silhouette %{x:.3f}<extra></extra>"}));
 return Plotly.react(el("profile"),traces,{paper_bgcolor:"#fff",plot_bgcolor:"#fff",margin:{l:55,r:12,b:45,t:8},height:300,
 font:{size:10},showlegend:k<=6,legend:{orientation:"h",y:-.3,font:{size:9}},xaxis:{title:"Silhouette",range:[-1,1],zeroline:true},yaxis:{showticklabels:fit.n<=24}},{responsive:true,displaylogo:false});
}
function render(){
 if(!active||!fit)return;
 const n=fit.n,k=+el("k").value,s=Core.silhouettes(fit.D,Core.labelsAt(fit,k).labels),last=fit.merge[step-1];
 el("count").textContent=n;el("group-count").textContent=n-step;el("silhouette").textContent=number(s.mean);
 el("step-index").textContent=step+" / "+(n-1);el("step").value=step;el("k-label").textContent=k;
 el("prev").disabled=step===0;el("next").disabled=step===n-1;
 const best=scoreTable.reduce((a,b)=>b.mean>a.mean?b:a,scoreTable[0]);
 el("best").textContent=best?"K = "+best.k+" ("+number(best.mean)+")":"—";
 el("chosen").textContent="K = "+k+" · "+s.negative+" negative silhouettes";
 el("merge-message").textContent=last?"Merge "+step+": groups of "+last.leftMembers.length+" and "+last.rightMembers.length+" observations merged at height "+number(last.height)+".": "Initially each sampled hour is its own cluster. Click Next merge to build the hierarchy.";
 el("height-note").textContent=fit.method==="ward"?"Ward's displayed height is √(2 × increase in within-cluster SSE).":"Height gives the "+fit.method+" linkage distance at which two groups merge.";
 el("distance-note").textContent=fit.metric==="gower"?"Gower: equal contributions from normalized numeric features and the categorical daypart.":"Euclidean distances calculated on "+(el("scale").value==="raw"?"raw measurements.":"z-scores.") ;
 renderScatter();renderTree();renderScores();renderProfile();
}
function activate(on){active=on;if(!on)return;setData(getData());if(dirty||!fit)rebuild();else render();}
["dims","metric","linkage","scale","sample"].forEach(role=>el(role).addEventListener("change",()=>{dirty=true;rebuild();}));
el("prev").addEventListener("click",()=>{if(fit){step=Math.max(0,step-1);render();}});
el("next").addEventListener("click",()=>{if(fit){step=Math.min(fit.n-1,step+1);render();}});
el("finish").addEventListener("click",()=>{if(fit){step=fit.n-1;render();}});
el("reset").addEventListener("click",()=>{if(fit){step=0;render();}});
el("step").addEventListener("input",()=>{if(fit){step=+el("step").value;render();}});
el("k").addEventListener("input",()=>{if(fit)render();});
document.addEventListener("weather-data-changed",e=>setData(e.detail&&e.detail.dataset));
document.addEventListener("learning-tab-changed",e=>activate(e.detail&&e.detail.mode==="hier"));
window.addEventListener("resize",()=>{if(active&&fit&&window.Plotly)for(const role of ["scatter","tree","scores","profile"])Plotly.Plots.resize(el(role));});
activate(location.hash==="#hier");
window.HierarchicalLab={refresh:rebuild,getState:()=>({active,sample:fit?.n,metric:fit?.metric,linkage:fit?.method,k:+el("k").value,mergeStep:step,sourceKey:signature})};
})();