document.addEventListener('DOMContentLoaded',()=>{
 const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
 const tabs=$$('.scan-tab'),cameraPanel=$('[data-panel="camera"]'),codePanel=$('[data-panel="code"]'),video=$('#cameraVideo'),placeholder=$('#cameraPlaceholder'),status=$('#cameraStatus'),open=$('#openCamera'),stop=$('#stopCamera'),capture=$('#captureInput'),codeInput=$('#packageCode'),validate=$('#validateCode'),confirm=$('#scanConfirm'),validated=$('#validatedCode'),feedback=$('#scanFeedback'),register=$('#registerScan');
 const productResult=$('#productResult'),productImage=$('#productImage'),productName=$('#productName'),productBrand=$('#productBrand'),productMeta=$('#productMeta'),productSource=$('#productSource');
 const userProductRegister=$('#userProductRegister'),userProductForm=$('#userProductForm'),userProductCode=$('#userProductCode'),userProductName=$('#userProductName'),userProductBrand=$('#userProductBrand'),userProductMaterial=$('#userProductMaterial'),userProductWeight=$('#userProductWeight'),userProductFeedback=$('#userProductFeedback'),saveUserProduct=$('#saveUserProduct');
 let stream=null,controls=null,reader=null,detector=null,loop=null,code='',material='',product=null,configured=false;
 const normalize=v=>String(v||'').replace(/\D/g,'').slice(0,14);
 function validGTIN(v){v=normalize(v);if(![8,12,13,14].includes(v.length))return false;const d=v.split('').map(Number),check=d.pop();let sum=0,w=3;for(let i=d.length-1;i>=0;i--){sum+=d[i]*w;w=w===3?1:3}return ((10-sum%10)%10)===check}
 function setMode(mode){tabs.forEach(t=>t.classList.toggle('active',t.dataset.mode===mode));cameraPanel.hidden=mode!=='camera';codePanel.hidden=mode!=='code';if(mode!=='camera')stopCamera()}
 function renderProduct(data){
   product=data?.product||null;
   configured=!!data?.configured;
   if(!productResult)return;
   if(userProductRegister){
     userProductRegister.hidden=configured;
     if(!configured && code){
       userProductCode.value=code;
       if(product){
         userProductName.value=product.name||'';
         userProductBrand.value=product.brand||'';
       }
     }
   }
   productResult.hidden=false;

   if(product){
     productName.textContent=product.name||'Produto identificado';
     productBrand.textContent=product.brand?`Marca: ${product.brand}`:'';
     productMeta.textContent=[
       product.quantity,
       product.packaging,
       product.material ? `Material: ${product.material}` : '',
       configured && product.weightGrams ? `Peso: ${Number(product.weightGrams).toLocaleString('pt-BR')} g` : ''
     ].filter(Boolean).join(' · ');
     productSource.textContent=configured
       ? 'Produto salvo na sua conta. Os pontos e o impacto serão calculados com os fatores ambientais configurados para este material.'
       : 'Produto localizado em uma base pública. Confira os dados e cadastre esta embalagem na sua conta para continuar.';
     productImage.innerHTML=product.image
       ? `<img src="${product.image}" alt="${product.name||'Produto'}">`
       : '<i class="fa-solid fa-box-open"></i>';
   }else{
     productName.textContent='Código válido, produto não localizado';
     productBrand.textContent='';
     productMeta.textContent='O código é válido, mas não encontramos dados públicos para este produto.';
     productSource.textContent='Nenhum nome foi inventado. Cadastre os dados da embalagem na sua conta para continuar.';
     productImage.innerHTML='<i class="fa-solid fa-box-open"></i>';
   }

   // O material e os pontos não são escolhidos por uma tabela fixa.
   // O material vem da embalagem cadastrada pelo próprio usuário.
   // Os fatores ambientais vêm da metodologia configurada no servidor.
   $$('.material-option').forEach(btn=>{
     btn.classList.remove('selected');
     btn.disabled=!configured;
     const small=btn.querySelector('small');
     if(small) small.textContent=configured ? 'Material do produto' : 'Aguardando configuração';
   });

   material='';
   if(configured && product.material){
     const btn=$$('.material-option').find(x=>x.dataset.material===product.material);
     if(btn){
       btn.classList.add('selected');
       material=product.material;
     }
   }

   register.disabled=!configured || !code;

   if(window.productConfigStatus){
     window.productConfigStatus.hidden=false;
     window.productConfigStatus.textContent=configured
       ? 'Produto configurado. Pronto para registrar a reciclagem.'
       : 'Este produto ainda não pode ser registrado porque os fatores ambientais deste material ainda não estão configurados.';
     window.productConfigStatus.className='scan-feedback '+(configured?'success':'error');
   }
 }
 async function identifyProduct(v){
   feedback.textContent='Consultando o produto...';feedback.className='scan-feedback';
   try{const data=await EcoViva.lookupProduct(v);renderProduct(data);feedback.textContent=configured?'Produto configurado e pronto para registro.':'Código válido, mas o produto ainda não está configurado no Eco Viva.';feedback.className='scan-feedback';}
   catch(e){product=null;renderProduct(null);feedback.textContent='Não foi possível consultar o produto agora. O código continua validado localmente.';feedback.className='scan-feedback error'}
 }
 async function showCode(v){v=normalize(v);if(!validGTIN(v)){feedback.textContent='Código lido, mas o dígito verificador é inválido.';feedback.className='scan-feedback error';return false}code=v;codeInput.value=v;validated.textContent=v;confirm.hidden=false;renderProduct(null);await identifyProduct(v);stopCamera();confirm.scrollIntoView({behavior:'smooth',block:'start'});return true}
 tabs.forEach(t=>t.onclick=()=>setMode(t.dataset.mode));
 async function startCamera(){
   if(window.ZXingBrowser?.BrowserMultiFormatReader){try{reader=new ZXingBrowser.BrowserMultiFormatReader();video.hidden=false;placeholder.hidden=true;open.disabled=true;stop.disabled=false;status.textContent='Câmera ativa · procurando código...';controls=await reader.decodeFromConstraints({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false},video,r=>{if(r)showCode(r.getText())});return}catch(e){controls?.stop?.();controls=null;reader=null}}
   if(!navigator.mediaDevices?.getUserMedia){status.textContent='Câmera indisponível neste navegador.';capture.click();return}
   try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=stream;video.hidden=false;placeholder.hidden=true;await video.play();open.disabled=true;stop.disabled=false;status.textContent='Câmera ativa · procurando código...';if('BarcodeDetector'in window){try{detector=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','itf','code_128','qr_code']})}catch{detector=new BarcodeDetector()}const scan=async()=>{if(!stream||!detector)return;try{const r=await detector.detect(video);if(r?.length){showCode(r[0].rawValue);return}}catch{}loop=requestAnimationFrame(scan)};loop=requestAnimationFrame(scan)}else status.textContent='Câmera ativa · fotografe o código ou digite manualmente.'}catch(e){status.textContent=e.name==='NotAllowedError'?'Permissão da câmera negada.':'Não foi possível abrir a câmera.';feedback.textContent='Permita o acesso à câmera ou use Fotografar código.';feedback.className='scan-feedback error'}
 }
 function stopCamera(){if(loop)cancelAnimationFrame(loop);loop=null;controls?.stop?.();controls=null;reader=null;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null;video.hidden=true;placeholder.hidden=false;open.disabled=false;stop.disabled=true;status.textContent='Câmera desligada'}
 open.onclick=startCamera;stop.onclick=stopCamera;
 capture.onchange=async()=>{const file=capture.files?.[0];if(!file)return;try{if(window.ZXingBrowser?.BrowserMultiFormatReader){const r=new ZXingBrowser.BrowserMultiFormatReader();const u=URL.createObjectURL(file);try{const result=await r.decodeFromImageUrl(u);if(result){await showCode(result.getText());capture.value='';return}}finally{URL.revokeObjectURL(u)}}if('BarcodeDetector'in window){const b=await createImageBitmap(file);let d;try{d=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','itf','code_128','qr_code']})}catch{d=new BarcodeDetector()}const result=await d.detect(b);b.close();if(result?.length){await showCode(result[0].rawValue);capture.value='';return}}feedback.textContent='Não encontrei um código nessa foto. Tente outra foto ou digite o número manualmente.';feedback.className='scan-feedback error';setMode('code')}catch{feedback.textContent='Não foi possível ler a foto. Digite o código manualmente.';feedback.className='scan-feedback error';setMode('code')}capture.value=''};
 validate.onclick=()=>showCode(codeInput.value);codeInput.oninput=()=>{codeInput.value=normalize(codeInput.value)};codeInput.onkeydown=e=>{if(e.key==='Enter')showCode(codeInput.value)};
 $$('.material-option').forEach(btn=>btn.onclick=()=>{
   if(!configured)return;
   $$('.material-option').forEach(x=>x.classList.remove('selected'));
   btn.classList.add('selected');
   material=btn.dataset.material;
   register.disabled=!code;
 });
 register.onclick=async()=>{
   if(!code){
     feedback.textContent='Primeiro valide ou leia o código da embalagem.';
     feedback.className='scan-feedback error';
     return;
   }
   if(!configured){
     feedback.textContent='Este produto foi salvo na sua conta, mas os fatores ambientais deste material ainda não estão configurados.';
     feedback.className='scan-feedback error';
     return;
   }
   register.disabled=true;
   register.textContent='Registrando...';
   try{
     const d=await EcoViva.addPoints(material,code);
     if(d){
       feedback.textContent=`✓ ${d.scan.product?.name||d.scan.label} registrado. +${d.scan.points} pontos. Impacto calculado com base no catálogo Eco Viva.`;
       feedback.className='scan-feedback success';
       register.textContent='Registrado com sucesso';
     }
   }catch(e){
     feedback.textContent=e.message||'Não foi possível registrar a reciclagem.';
     feedback.className='scan-feedback error';
     register.disabled=false;
     register.textContent='Registrar reciclagem';
   }
 };
 userProductForm?.addEventListener('submit',async e=>{
   e.preventDefault();
   userProductFeedback.textContent='Salvando produto...';userProductFeedback.className='scan-feedback';
   saveUserProduct.disabled=true;
   try{
     const d=await EcoViva.registerProduct({code:userProductCode.value,name:userProductName.value,brand:userProductBrand.value,material:userProductMaterial.value,weightGrams:Number(userProductWeight.value)});
     product=d.product||product;
     configured=!!d.factorsConfigured;
     renderProduct({product,configured});
     userProductFeedback.textContent=d.factorsConfigured?'Produto salvo. Agora ele pode ser registrado e gerar pontos.':'Produto salvo na sua conta. Para gerar pontos e impacto, os fatores ambientais deste material ainda precisam estar configurados.';
     userProductFeedback.className='scan-feedback '+(d.factorsConfigured?'success':'error');
     if(d.factorsConfigured){
       register.disabled=false;
       userProductRegister.hidden=true;
       productConfigStatus.hidden=false;
       productConfigStatus.textContent='Produto cadastrado e pronto para registrar. O cálculo será feito pelo servidor.';
       productConfigStatus.className='scan-feedback success';
     }
   }catch(e){userProductFeedback.textContent=e.message||'Não foi possível salvar o produto.';userProductFeedback.className='scan-feedback error';}
   finally{saveUserProduct.disabled=false;}
 });
 window.addEventListener('beforeunload',stopCamera);
});