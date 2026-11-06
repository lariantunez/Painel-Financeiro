# Próximos passos — onde paramos (06/11/2026)

Arquivo de passagem entre máquinas. Não é publicado no site (o Cloudflare só publica index.html, css, js e o ícone).

## Objetivo

Vender o painel como **kit "Planilha + Painel"**: a cliente copia a planilha modelo (com o script dentro) para o Google Drive dela e usa o painel publicado. Os dados ficam na conta Google de cada cliente; nada passa por mim.

## Já feito

- [x] Planilha pessoal "Balanço financeiro" passou de "Qualquer pessoa com o link" para **Restrito** (conferido: o link público devolve 401).
- [x] Código sem o ID da planilha pessoal e sem titulares fixos na configuração padrão (`js/api.js`).
- [x] Painel sem conexão mostra **"Conecte a sua planilha"** em vez de travar em "Carregando dados…" (`js/main.js`).
- [x] **Cloudflare Pages** criado (conta lari260298@gmail.com), ligado só a este repositório:
  - Endereço: https://o-painel-financeiro.pages.dev
  - Branch: `master` — cada `git push` publica sozinho
  - Build command: `mkdir -p site && cp -r index.html css js apple-touch-icon.png site/`
  - Build output directory: `site`
  - Conferido: `apps-script/`, `tests/` e `README.md` não são servidos no endereço novo.

## Próximos passos, nesta ordem

1. **Reconectar os aparelhos no endereço novo** (cada endereço guarda a conexão separado):
   no painel antigo (github.io) → Configurações → "Copiar link para o celular" → trocar o começo
   `https://lariantunez.github.io/Painel-Financeiro/` por `https://o-painel-financeiro.pages.dev/`
   mantendo o `?c=...` → abrir no celular e no computador. O link tem o token: só para mim.
2. **Desligar o GitHub Pages**: repositório → Settings → Pages → desativar.
3. **Tornar o repositório privado**: Settings → General → Danger Zone → Change visibility → Make private.
   Antes, tirar links para este repositório do perfil do GitHub, do LinkedIn e da Vitrine de projetos.
4. **Domínio próprio sem o meu nome** (~R$ 40/ano) apontando para o Cloudflare Pages ("Custom domains").

## Depois disso (produto)

- Pessoas configuráveis: LARISSA / DOUGLAS / CASAL ainda estão fixos em `js/financas.js` e `js/pagina-painel.js` → tela de primeiro uso (quem mora na casa, bancos, cartão).
- `js/pagina-config.js` aponta `URL_SCRIPT` para o Codigo.gs no GitHub — quebra quando o repositório ficar privado; trocar pelas instruções da planilha modelo.
- Menu na planilha (`onOpen`): "Preparar planilha" (roda `configurar`) e "Abrir meu painel" (monta o link `?c=<id>.<token>` com `ScriptApp.getService().getUrl()`).
- Planilha modelo limpa + vídeo de instalação de 3 min.
- Testar com 5–10 pessoas que não são da área de tecnologia → depois página de vendas (Hotmart/Kiwify).

## Observação de git

No computador do trabalho o git global é a conta da Kert. Neste repositório usar:
`git config user.name lariantunez` e `git config user.email lariantunez@hotmail.com`.
