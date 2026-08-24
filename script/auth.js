/* Eco Viva — autenticação via servidor */
(function () {
  let current = null;
  let stats = null;
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });

  async function api(url, options = {}) {
    const res = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }

  function toast(message, type = 'success') {
    if (window.EcoViva?.toast) return window.EcoViva.toast(message, type);
    alert(message);
  }

  async function me(force = false) {
    if (current && !force) return { user: current, stats };
    const data = await api('/api/auth/me');
    current = data.authenticated ? data.user : null;
    stats = data.authenticated ? data.stats : null;
    return { user: current, stats };
  }

  function goLogin(next) { location.href = `login.html?next=${encodeURIComponent(next || 'index.html')}`; }

  async function register(form) {
    try {
      const data = await api('/api/auth/register', { method:'POST', body:JSON.stringify({
        name:form.name.value, email:form.email.value, password:form.password.value, confirmPassword:form.confirmPassword?.value || ''
      })});
      current = data.user; stats = data.stats;
      toast('Conta criada com sucesso!');
      const next = new URLSearchParams(location.search).get('next');
      setTimeout(() => location.href = next || 'perfil.html', 350);
    } catch(e) { toast(e.message, 'error'); }
  }

  async function login(form) {
    try {
      const data = await api('/api/auth/login', { method:'POST', body:JSON.stringify({email:form.email.value,password:form.password.value})});
      current = data.user; stats = data.stats;
      toast('Login realizado com sucesso!');
      const next = new URLSearchParams(location.search).get('next');
      setTimeout(() => location.href = next || 'index.html', 350);
    } catch(e) { toast(e.message, 'error'); }
  }

  async function logout() {
    try { await api('/api/auth/logout', {method:'POST'}); } catch {}
    current = null; stats = null;
    location.href = 'login.html';
  }

  async function updateUser(data) {
    const result = await api('/api/profile', {method:'PATCH', body:JSON.stringify(data)});
    current = result.user; stats = result.stats;
    renderHeader();
    return result.user;
  }

  async function uploadAvatar(file) {
    if (!file) return null;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use JPG, PNG ou WEBP.');
    if (file.size > 2 * 1024 * 1024) throw new Error('A foto deve ter no máximo 2 MB.');
    const dataUrl = await new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); });
    const result = await api('/api/profile/avatar',{method:'POST',body:JSON.stringify({data:dataUrl})});
    current=result.user; renderHeader(); return result.user;
  }

  function renderHeader() {
    document.querySelectorAll('[data-header-user]').forEach(el => {
      if (!current) {
        el.innerHTML='<span class="header-user-avatar header-user-initials"><i class="fa-solid fa-user"></i></span><span class="header-user-login">Entrar</span>';
        el.href='login.html'; return;
      }
      const first = (current.name || 'Usuário').trim().split(/\s+/)[0] || 'Usuário';
      const initial = first.charAt(0).toUpperCase();
      const avatar = current.avatar
        ? `<span class="header-user-avatar header-user-photo"><img src="${current.avatar}" alt="Foto de ${first}"></span>`
        : `<span class="header-user-avatar header-user-initials">${initial}</span>`;
      el.innerHTML = `${avatar}<span class="header-user-name">${first}</span>`;
      el.href='perfil.html'; el.title=current.name;
    });
    document.querySelectorAll('[data-auth-name]').forEach(x=>{if(current)x.textContent=current.name});
    document.querySelectorAll('[data-auth-email]').forEach(x=>{if(current)x.textContent=current.email});
  }

  const PROTECTED = new Set(['escanear.html','pontuacao.html','resgates.html','separar-lixo.html','empresas.html','perfil.html','editar-perfil.html','endereco.html','seguranca.html','preferencias.html']);
  async function protect() {
    const page=location.pathname.split('/').pop()||'index.html';
    const result=await me();
    if(PROTECTED.has(page) && !result.user){ goLogin(page); return false; }
    renderHeader(); return true;
  }

  window.EcoAuth={api,me,register,login,logout,updateUser,uploadAvatar,renderHeader,protect,ready,isLoggedIn:()=>!!current,getCurrentUser:()=>current};

  document.addEventListener('DOMContentLoaded', async ()=>{
    try {
      await protect();
    } catch(e) {
      console.error(e);
    } finally {
      readyResolve({user:current, stats});
    }
    document.querySelectorAll('[data-login-form]').forEach(form=>form.addEventListener('submit',e=>{e.preventDefault();login(form)}));
    document.querySelectorAll('[data-register-form]').forEach(form=>form.addEventListener('submit',e=>{e.preventDefault();register(form)}));
    document.querySelectorAll('[data-logout]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();logout()}));
  });
})();