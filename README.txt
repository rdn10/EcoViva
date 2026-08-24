ECO VIVA — VERSAO COMPLETA

REQUISITOS
- Node.js 18 ou superior

USUARIO
- Cadastro e login reais no backend.
- Perfil, foto, dados pessoais e endereco persistidos.
- Produtos/embalagens podem ser cadastrados pelo proprio usuario.
- Reciclagem usa o produto da conta e os fatores ambientais configurados.
- Pontos e impacto sao calculados no servidor.
- Parceiros e cupons sao exibidos somente quando cadastrados pelo admin.
- Codigo de resgate do cupom e definido pelo administrador.

ADMINISTRADOR
Primeiro acesso:
1. Inicie o servidor.
2. Veja no terminal a linha ADMIN_SETUP_KEY=...
3. Abra http://localhost:3000/admin-setup.html
4. Crie o acesso do dono.
5. Depois use http://localhost:3000/admin-login.html
6. Dashboard: http://localhost:3000/admin.html

O painel administra:
- Dashboard com dados reais
- Parceiros
- Cupons
- Fatores/metodologia ambiental

O cadastro de embalagens para reciclagem e feito pelo usuario dentro do aplicativo.

DADOS INICIAIS
- Nenhum usuario ficticio
- Nenhum parceiro ficticio
- Nenhum cupom ficticio
- Nenhuma reciclagem ficticia
- Nenhum produto de usuario ficticio
- Fatores ambientais iniciais sao referencias de metodologia e nao representam atividade de usuario.

ESTRUTURA
- HTML na raiz
- CSS em components/
- JavaScript em script/
- Persistencia em data/
- Fotos em uploads/
