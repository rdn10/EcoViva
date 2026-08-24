/* Eco Viva — dados reais persistidos no servidor */
(function(){
  function format(n){return Number(n||0).toLocaleString('pt-BR')}
  function toast(message,type='success'){
    let el=document.querySelector('.ev-toast');
    if(!el){el=document.createElement('div');el.className='ev-toast';document.body.appendChild(el)}
    el.className='ev-toast '+type;el.textContent=message;
    requestAnimationFrame(()=>el.classList.add('show'));clearTimeout(window.__evToast);
    window.__evToast=setTimeout(()=>el.classList.remove('show'),3000)
  }
  function setText(sel,val){document.querySelectorAll(sel).forEach(e=>e.textContent=val)}
  function render(data){
    const s=data?.stats||{};
    setText('.points-display',format(s.points));setText('[data-points]',format(s.points));setText('[data-level]',s.level||1);
    setText('[data-trees]',s.trees==null?'—':Number(s.trees).toLocaleString('pt-BR'));setText('[data-water]',s.water==null?'—':Number(s.water).toLocaleString('pt-BR')+' L');setText('[data-co2]',Number(s.co2||0).toLocaleString('pt-BR')+' kg');setText('[data-energy]',s.energy==null?'—':Number(s.energy).toLocaleString('pt-BR')+' kWh');
    setText('[data-scanned]',s.scans||0);setText('[data-redeemed]',s.redemptions||0);
    const progress=document.querySelector('.progress-fill');if(progress){const pct=Math.min(100,((s.points||0)%500)/5);progress.style.width=pct+'%'}
  }
  async function dashboard(){const data=await EcoAuth.api('/api/dashboard');render(data);return data}
  async function lookupProduct(code){return await EcoAuth.api('/api/products/barcode/'+encodeURIComponent(String(code||'').replace(/\D/g,'')))}
  async function registerProduct(product){return await EcoAuth.api('/api/user/products',{method:'POST',body:JSON.stringify(product)})}
  async function addPoints(material,code){
    try {
      const data=await EcoAuth.api('/api/actions/scan',{method:'POST',body:JSON.stringify({material,code})});
      render(data);
      toast(`✓ ${data.scan.label} registrado. +${data.scan.points} pontos!`);
      return data;
    } catch(e) {
      toast(e.message,'error');
      throw e;
    }
  }
  async function loadCoupons(){return await EcoAuth.api('/api/coupons')}
  async function redeemCoupon(couponId){try{const d=await EcoAuth.api('/api/redeem-coupon',{method:'POST',body:JSON.stringify({couponId})});render(d);toast(`🎟️ Cupom ${d.redemption.couponCode} gerado!`);return d}catch(e){toast(e.message,'error')}}
  function modal(title,text,actions=[]){document.querySelector('.ev-modal-backdrop')?.remove();const b=document.createElement('div');b.className='ev-modal-backdrop';b.innerHTML=`<div class="ev-modal" role="dialog"><button class="ev-modal-close">×</button><div class="ev-modal-icon">🌱</div><h3>${title}</h3><p>${text}</p><div class="ev-modal-actions">${actions.map((a,i)=>`<button class="${a.primary?'btn-primary':'btn-secondary'}" data-a="${i}">${a.label}</button>`).join('')}</div></div>`;document.body.appendChild(b);b.querySelector('.ev-modal-close').onclick=()=>b.remove();actions.forEach((a,i)=>b.querySelector(`[data-a="${i}"]`).onclick=()=>{b.remove();a.onClick?.()})}
  window.EcoViva={format,toast,modal,render,dashboard,lookupProduct,registerProduct,addPoints,loadCoupons,redeemCoupon};
  document.addEventListener('DOMContentLoaded',async()=>{try{if(window.EcoAuth)await EcoAuth.me();if(document.querySelector('[data-dashboard]'))await dashboard()}catch(e){}})
})();
