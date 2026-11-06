// Inicialização, rotas e atualização automática.

import { mesAtual, escapeHtml } from './util.js';
import { carregarDados, dadosEmCache, config, salvarConfig, importarConfiguracaoDoLink, backendConfigurado } from './api.js';
import { renderPainel } from './pagina-painel.js';
import { renderImportar, importacaoEmAndamento } from './pagina-importar.js';
import { renderAprendizado } from './pagina-aprendizado.js';
import { renderPrevisao } from './pagina-previsao.js';
import { renderAnalise } from './pagina-analise.js';
import { renderConfig } from './pagina-config.js';
import { toast, $, $$ } from './ui.js';

const ATUALIZAR_A_CADA = 2 * 60 * 1000; // 2 minutos, só com a aba visível
const PAGINAS = { painel: renderPainel, previsao: renderPrevisao, analise: renderAnalise, importar: renderImportar, aprendizado: renderAprendizado, config: renderConfig };

const estado = {
  dados: null,
  meses: [mesAtual()], // período selecionado no painel (um ou vários meses)
  filtros: {}, // filtros da página: { tipo|despesa|categoria|recorrencia|forma|status: { valor, texto } }
  rota: 'painel',
  carregando: false,
  erro: null,
  ultimaLeitura: 0,
};

const app = {
  estado,
  renderizar,
  recarregar,
  aplicarTema,
  irParaMes(mes) {
    estado.meses = [mes];
    renderizar();
  },
  definirMeses(meses) {
    estado.meses = [...new Set(meses)].sort();
    if (!estado.meses.length) estado.meses = [mesAtual()];
    renderizar();
  },
  // Clicar num dado filtra a página; clicar de novo no mesmo dado tira o filtro
  alternarFiltro(campo, valor, texto = valor) {
    if (estado.filtros[campo]?.valor === valor) delete estado.filtros[campo];
    else estado.filtros[campo] = { valor, texto };
    renderizar();
  },
  tirarFiltro(campo) {
    delete estado.filtros[campo];
    renderizar();
  },
  limparFiltros() {
    estado.filtros = {};
    estado.meses = [mesAtual()];
    renderizar();
  },
};

function rotaAtual() {
  const r = location.hash.replace(/^#\/?/, '').split(/[?&]/)[0];
  return PAGINAS[r] ? r : 'painel';
}

function renderizar() {
  const rotaAnterior = estado.rota;
  estado.rota = rotaAtual();
  for (const a of $$('.nav a')) a.classList.toggle('ativo', a.dataset.rota === estado.rota);
  // Na mesma página, redesenhar não pode mexer na rolagem (ex.: ao marcar uma conta como paga)
  const raiz = $('#app');
  const mesmaPagina = rotaAnterior === estado.rota;
  const y = window.scrollY;
  if (mesmaPagina) raiz.style.minHeight = `${raiz.offsetHeight}px`;
  if (estado.rota !== 'painel') $('#lateral-periodo').innerHTML = ''; // anos e meses só fazem sentido no Painel
  // Sem dados e a leitura falhou: explica o que fazer em vez de ficar em "Carregando…" (Configurações sempre abre)
  if (!estado.dados && estado.erro && estado.rota !== 'config') raiz.innerHTML = telaSemDados(estado.erro);
  else PAGINAS[estado.rota](raiz, app);
  if (mesmaPagina) {
    raiz.style.minHeight = '';
    window.scrollTo({ top: y, behavior: 'instant' });
  }
  atualizarSync();
}

function telaSemDados(erro) {
  const titulo = backendConfigurado() ? 'Não consegui ler a sua planilha' : 'Conecte a sua planilha';
  const texto = backendConfigurado()
    ? escapeHtml(erro)
    : 'Este aparelho ainda não está ligado a nenhuma planilha. Em Configurações você conecta a sua — ou abra aqui o link de conexão gerado num aparelho que já está conectado.';
  return `<div class="vazio"><p><b>${titulo}</b></p><p>${texto}</p><p><a class="btn btn-primario" style="text-decoration:none" href="#/config">Ir para Configurações</a></p></div>`;
}

function atualizarSync() {
  const dot = $('.sync-dot');
  const txt = $('.sync-texto');
  dot.className = `sync-dot ${estado.carregando ? 'carregando' : estado.erro ? 'erro' : ''}`;
  if (estado.carregando) txt.textContent = 'Atualizando…';
  else if (estado.erro) txt.textContent = 'Sem conexão';
  else if (estado.ultimaLeitura) txt.textContent = `Atualizado às ${new Date(estado.ultimaLeitura).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

// Pedido feito durante outra leitura (ex.: logo após salvar uma edição): essa leitura pode ter
// começado antes da gravação, então lê de novo quando ela terminar
let releitura = null;

async function recarregar({ silencioso = false } = {}) {
  if (estado.carregando) {
    if (!silencioso) releitura = true;
    return;
  }
  estado.carregando = true;
  atualizarSync();
  try {
    const anterior = estado.dados;
    estado.dados = await carregarDados();
    estado.erro = null;
    estado.ultimaLeitura = Date.now();
    // Não redesenha a importação no meio do trabalho; o resto só se algo mudou
    const mudou = !anterior || anterior.despesas.length !== estado.dados.despesas.length || anterior.receitas.length !== estado.dados.receitas.length || anterior.regras.length !== estado.dados.regras.length || !silencioso;
    if (!(estado.rota === 'importar' && importacaoEmAndamento()) && mudou) {
      estado.carregando = false;
      renderizar();
    }
  } catch (e) {
    estado.erro = e.message;
    if (!estado.dados) renderizar(); // troca o "Carregando…" pela explicação
    else if (!silencioso) toast(e.message, 'erro', 6000);
  } finally {
    estado.carregando = false;
    atualizarSync();
  }
  if (releitura) {
    releitura = null;
    await recarregar();
  }
}

const escuroNoSistema = window.matchMedia('(prefers-color-scheme: dark)');
const temaEfetivo = () => (config.tema === 'auto' ? (escuroNoSistema.matches ? 'dark' : 'light') : config.tema);

function aplicarTema() {
  if (config.tema === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = config.tema;
  // o botão mostra para qual tema vai trocar
  const botao = $('#btn-tema');
  const escuro = temaEfetivo() === 'dark';
  botao.innerHTML = escuro ? '<span aria-hidden="true">☀</span> Claro' : '<span aria-hidden="true">☾</span> Escuro';
  botao.title = escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
}

// ───────────── Início ─────────────

const link = importarConfiguracaoDoLink();
if (link === 'ok') toast('Configuração importada do link · este aparelho está conectado');
if (link === 'erro') toast('O link de configuração chegou incompleto. No computador, use Configurações → "Copiar link para o celular" e envie de novo.', 'erro', 12000);
aplicarTema();
estado.dados = dadosEmCache();
renderizar();
recarregar({ silencioso: true });

window.addEventListener('hashchange', () => {
  renderizar();
  window.scrollTo({ top: 0 });
});
$('#btn-atualizar').addEventListener('click', () => recarregar());
$('#btn-tema').addEventListener('click', () => {
  salvarConfig({ tema: temaEfetivo() === 'dark' ? 'light' : 'dark' });
  aplicarTema();
  if (estado.rota === 'config') renderizar(); // mantém o seletor de Aparência em sincronia
});
escuroNoSistema.addEventListener('change', aplicarTema);

setInterval(() => {
  if (document.visibilityState === 'visible') recarregar({ silencioso: true });
}, ATUALIZAR_A_CADA);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - estado.ultimaLeitura > 60 * 1000) recarregar({ silencioso: true });
});
