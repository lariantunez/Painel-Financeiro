// Configurações: conexão com a planilha, titulares e aparência.

import { config, salvarConfig, testarConexao, backendConfigurado, linkDeConfiguracao } from './api.js';
import { escapeHtml } from './util.js';
import { toast, $, $$ } from './ui.js';

const INSTITUICOES = ['NUBANK', 'BRADESCO', 'ITAÚ', 'PORTO'];
const URL_SCRIPT = 'https://github.com/lariantunez/Painel-Financeiro/blob/master/apps-script/Codigo.gs';

export function renderConfig(raiz, app) {
  const conectado = backendConfigurado();
  raiz.innerHTML = `
    <div class="cabecalho-pagina"><h1 style="font-size:22px;margin:0">Configurações</h1></div>

    <div class="card" style="margin-bottom:12px">
      <div class="card-titulo"><h2>Conexão com a planilha</h2>${conectado ? '<span class="badge badge-good">✓ Conectado</span>' : '<span class="badge badge-warn">Não conectado</span>'}</div>
      <details class="secao" ${conectado ? '' : 'open'} style="margin-bottom:14px"><summary>Como conectar (uma vez só, ~3 minutos)</summary>
        <ol class="passo-a-passo" style="margin-top:8px">
          <li>Abra a planilha e vá em <b>Extensões → Apps Script</b>.</li>
          <li>Apague o que estiver lá e cole o conteúdo do arquivo <a href="${URL_SCRIPT}" target="_blank" rel="noopener">apps-script/Codigo.gs</a>. Salve (Ctrl+S).</li>
          <li>No menu de funções escolha <b>configurar</b> e clique em <b>Executar</b>. Autorize o acesso com sua conta Google.</li>
          <li>Abra <b>Registro de execução</b>: copie o <b>TOKEN</b> que apareceu.</li>
          <li>Clique em <b>Implantar → Nova implantação</b>, tipo <b>App da Web</b>, “Executar como: <b>Eu</b>”, “Quem pode acessar: <b>Qualquer pessoa</b>”. Copie a URL (termina em <code>/exec</code>).</li>
          <li>Cole a URL e o TOKEN abaixo e clique em <b>Testar e salvar</b>.</li>
          <li>Pronto! Agora você pode tirar o compartilhamento público da planilha — o painel lê pelo backend, protegido pelo token.</li>
        </ol>
      </details>
      <div class="config-grade">
        <label class="campo">URL do App da Web<input class="input mono" id="cfg-url" placeholder="https://script.google.com/macros/s/…/exec" value="${escapeHtml(config.url)}"></label>
        <label class="campo">TOKEN<input class="input mono" id="cfg-token" type="password" autocomplete="off" value="${escapeHtml(config.token)}"></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-primario" id="testar">Testar e salvar</button>
        ${conectado ? '<button class="btn" id="desconectar">Desconectar</button><button class="btn" id="link">Copiar link para o celular</button>' : ''}
      </div>
      ${conectado ? '<p class="small muted" style="margin:10px 0 0">O link para o celular já leva a conexão configurada. Envie só para você — quem tiver o link consegue ver seus dados.</p>' : ''}
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="card-titulo"><h2>Importação</h2></div>
      <div class="config-grade">
        <label class="campo">Cartão de crédito principal<span class="dica">Contas fixas pagas nele vêm pela fatura e não entram no checklist</span>
          <select class="select" id="cfg-cartao">${INSTITUICOES.map((i) => `<option ${i === config.instituicaoCartao ? 'selected' : ''}>${i}</option>`).join('')}</select></label>
        <div></div>
        ${INSTITUICOES.map((i) => `<label class="campo">Quem recebe na conta ${i}<span class="dica">Preenche a coluna NOME das receitas</span><input class="input" data-titular="${i}" value="${escapeHtml(config.titulares[i] || '')}"></label>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-titulo"><h2>Aparência</h2></div>
      <div class="seg" id="cfg-tema">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, n]) => `<button data-tema="${v}" class="${config.tema === v ? 'ativo' : ''}">${n}</button>`).join('')}</div>
    </div>`;

  $('#testar', raiz).addEventListener('click', async (e) => {
    const url = $('#cfg-url', raiz).value.trim();
    const token = $('#cfg-token', raiz).value.trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
      toast('A URL deve começar com https://script.google.com/ e terminar em /exec', 'erro', 6000);
      return;
    }
    e.target.disabled = true;
    e.target.textContent = 'Testando…';
    try {
      const planilha = await testarConexao(url, token);
      salvarConfig({ url, token });
      toast(`Conectado à planilha “${planilha}”`);
      await app.recarregar();
    } catch (err) {
      toast(`Falhou: ${err.message}`, 'erro', 8000);
    }
    app.renderizar();
  });
  $('#desconectar', raiz)?.addEventListener('click', () => {
    salvarConfig({ url: '', token: '' });
    app.recarregar();
    app.renderizar();
  });
  $('#link', raiz)?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(linkDeConfiguracao());
      toast('Link copiado — abra no celular');
    } catch {
      toast('Não consegui copiar o link', 'erro');
    }
  });
  $('#cfg-cartao', raiz).addEventListener('change', (e) => salvarConfig({ instituicaoCartao: e.target.value }));
  for (const i of $$('[data-titular]', raiz)) {
    i.addEventListener('change', () => salvarConfig({ titulares: { ...config.titulares, [i.dataset.titular]: i.value.trim().toUpperCase() } }));
  }
  for (const b of $$('[data-tema]', raiz)) {
    b.addEventListener('click', () => {
      salvarConfig({ tema: b.dataset.tema });
      app.aplicarTema();
      app.renderizar();
    });
  }
}
