/* DS 6021: deterministic agglomerative clustering, linkage heights and silhouettes.
   No weather class labels are used in clustering. Browser/CommonJS compatible. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.HierarchicalCore=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
function pairwise(points,metric="euclidean"){
 const n=points.length, d=Array.from({length:n},()=>new Float64Array(n));
 for(let i=0;i<n;i++)for(let j=0;j<i;j++){
  let x=0;
  if(metric==="gower"){for(let v=0;v<points[i].length;v++) x+=v===points[i].length-1 ? +(points[i][v]!==points[j][v]):Math.abs(points[i][v]-points[j][v]); x/=points[i].length;}
  else {for(let v=0;v<points[i].length;v++)x+=(points[i][v]-points[j][v])**2;x=Math.sqrt(x);}
  d[i][j]=d[j][i]=x;
 }
 return d;
}
function agglomerate(points,method="average",metric="euclidean"){
 const n=points.length;
 if(n<2||n>160)throw Error("Choose 2–160 observations.");
 if(metric==="gower"&&method==="ward")throw Error("Ward's method needs Euclidean features, not Gower dissimilarities.");
 const D=pairwise(points,metric), groups=new Map(), merge=[], heights=[];
 for(let i=0;i<n;i++)groups.set(i,{id:i,children:null,members:[i],size:1,mean:points[i].slice()});
 let id=n;
 function groupDistance(a,b){
  if(method==="ward"){let sq=0;for(let j=0;j<a.mean.length;j++)sq+=(a.mean[j]-b.mean[j])**2;return Math.sqrt(2*a.size*b.size/(a.size+b.size)*sq);}
  let sum=0,count=0,best=method==="single"?Infinity:-Infinity;
  for(const i of a.members)for(const j of b.members){const d=D[i][j];sum+=d;count++;if(method==="single")best=Math.min(best,d);if(method==="complete")best=Math.max(best,d);}
  return method==="average"?sum/count:best;
 }
 while(groups.size>1){
  const all=[...groups.values()].sort((a,b)=>a.id-b.id);
  let best=Infinity,L=null,R=null;
  for(let ai=0;ai<all.length;ai++)for(let bi=ai+1;bi<all.length;bi++){
   const d=groupDistance(all[ai],all[bi]);
   if(d<best-1e-11){best=d;L=all[ai];R=all[bi];}
  }
  const m=L.size+R.size, mean=L.mean.map((v,j)=>(L.size*v+R.size*R.mean[j])/m);
  const node={id:id++,children:[L,R],members:L.members.concat(R.members),size:m,mean,height:best};
  merge.push({step:merge.length+1,left:L.id,right:R.id,height:best,size:m,members:node.members.slice(),leftMembers:L.members.slice(),rightMembers:R.members.slice(),node});
  heights.push(best);groups.delete(L.id);groups.delete(R.id);groups.set(node.id,node);
 }
 return {n,metric,method,D,merge,root:[...groups.values()][0],heights};
}
function labelsAt(result,k){
 const {n,merge}=result; k=Math.max(1,Math.min(n,Math.round(k)));
 const clusters=Array.from({length:n},(_,i)=>[i]);
 for(let t=0;t<n-k;t++){const members=merge[t].members;for(let i=clusters.length-1;i>=0;i--)if(clusters[i].some(v=>members.includes(v)))clusters.splice(i,1);clusters.push(members.slice());}
 clusters.sort((a,b)=>Math.min(...a)-Math.min(...b));
 const labels=Array(n).fill(-1);clusters.forEach((members,c)=>members.forEach(i=>labels[i]=c));
 return {labels,clusters};
}
function silhouettes(D,labels){
 const n=labels.length,sets=new Map();
 labels.forEach((c,i)=>{if(!sets.has(c))sets.set(c,[]);sets.get(c).push(i);});
 if(sets.size<2||sets.size>=n)return {mean:NaN,values:[],negative:0};
 const values=labels.map((c,i)=>{
  const own=sets.get(c);if(own.length===1)return 0;
  const a=own.reduce((s,j)=>s+(i===j?0:D[i][j]),0)/(own.length-1);
  let b=Infinity;
  for(const [other,indices] of sets)if(other!==c)b=Math.min(b,indices.reduce((s,j)=>s+D[i][j],0)/indices.length);
  return Math.max(a,b)===0?0:(b-a)/Math.max(a,b);
 });
 return {mean:values.reduce((a,b)=>a+b,0)/n,values,negative:values.filter(x=>x<0).length};
}
function compareCuts(result,maxK=8){
 const out=[];for(let k=2;k<=Math.min(maxK,result.n-1);k++){const {labels,clusters}=labelsAt(result,k),s=silhouettes(result.D,labels);out.push({k,mean:s.mean,negative:s.negative,clusters:clusters.length});}return out;
}
return {pairwise,agglomerate,labelsAt,silhouettes,compareCuts};
});
