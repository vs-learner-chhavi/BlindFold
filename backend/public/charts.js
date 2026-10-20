const SEV={blocker:'#ff4d6d',major:'#ffa94d',minor:'#ffd43b'};
const STAGES=['reported','acknowledged','fixed','verified'];
const STAGE_COL={reported:'#ff4d6d',acknowledged:'#ffa94d',responded:'#a78bfa',fixed:'#22d3ee',verified:'#34d399'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=(m,err)=>{const t=document.getElementById('toast');t.textContent=m;t.className='show'+(err?' err':'');clearTimeout(t._t);t._t=setTimeout(()=>t.className='',2800)};
const usersNum=u=>u==='1 to 4 users'?2:(parseInt(u)||0);

function donut(el,items,label){
  const sum=items.reduce((a,b)=>a+b.value,0),T=sum||1,R=52,C=2*Math.PI*R;let off=0;
  const arcs=items.map(i=>{const l=i.value/T*C,s=`<circle r="${R}" cx="70" cy="70" fill="none" stroke="${i.color}" stroke-width="16" stroke-dasharray="${l} ${C-l}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`;off+=l;return s}).join('');
  el.innerHTML=`<div class="donut-wrap"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(label)}"><circle r="${R}" cx="70" cy="70" fill="none" stroke="#1a2540" stroke-width="16"/>${arcs}<text x="70" y="72" class="c-big" text-anchor="middle">${sum}</text><text x="70" y="90" class="c-sm" text-anchor="middle">total</text></svg><ul class="legend">${items.map(i=>`<li><i style="background:${i.color}"></i>${esc(i.name)}<b>${i.value}</b></li>`).join('')}</ul></div>`;
}
function bars(el,items){
  const max=Math.max(1,...items.map(i=>i.value));
  el.innerHTML=items.length?items.map(i=>`<div class="hbar"><span title="${esc(i.name)}">${esc(i.name)}</span><div class="track"><div class="fill" style="width:0;color:${i.color};background:${i.color}" data-w="${i.value/max*100}"></div></div><b>${i.value}</b></div>`).join(''):'<p class="sub">No data yet.</p>';
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.querySelectorAll('.fill').forEach(f=>f.style.width=f.dataset.w+'%')));
}
function line(el,pts,label){
  if(!pts.length){el.innerHTML='<p class="sub">No data yet.</p>';return}
  const W=420,H=150,p=24,max=Math.max(1,...pts.map(q=>q.y)),n=Math.max(1,pts.length-1);
  const xy=pts.map((q,i)=>[p+i/n*(W-2*p),H-p-q.y/max*(H-2*p)]);
  const d=xy.map((c,i)=>(i?'L':'M')+c[0].toFixed(1)+' '+c[1].toFixed(1)).join(' ');
  el.innerHTML=`<svg class="line-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee" stop-opacity=".45"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient></defs><path d="${d} L${xy.at(-1)[0]} ${H-p} L${xy[0][0]} ${H-p}Z" fill="url(#lg)"/><path d="${d}" fill="none" stroke="#22d3ee" stroke-width="2.5"/>${xy.map((c,i)=>`<circle cx="${c[0]}" cy="${c[1]}" r="3.5" fill="#060a13" stroke="#22d3ee" stroke-width="2"><title>${esc(pts[i].x)}: ${pts[i].y}</title></circle>`).join('')}<text x="${p}" y="${H-6}">${esc(pts[0].x)}</text><text x="${W-p}" y="${H-6}" text-anchor="end">${esc(pts.at(-1).x)}</text><text x="${p}" y="12">max ${max}</text></svg>`;
}
