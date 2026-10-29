// Inicialização, rotas e atualização automática.

import { mesAtual } from './util.js';
import { carregarDados, dadosEmCache, config, importarConfiguracaoDoLink } from './api.js';
import { renderPainel } from './pagina-painel.js';
import { renderImportar, importacaoEmAndamento } from './pagina-importar.js';
import { renderAprendizado } from './pagina-aprendizado.js';
import { renderConfig } from './pagina-config.js';
import { toast, $, $$ } from './ui.js';

const ATUALIZAR_A_CADA = 2 * 60 * 1000; // 2 minutos, só com a aba visível
const PAGINAS = { painel: renderPainel, importar: renderImportar, aprendizado: renderAprendizado, config: renderConfig };

const estado = {
  dados: null,
  mes: mesAtual(),
  filtroTipo: null,
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
    estado.mes = mes;
    renderizar();
  },
  filtrarTipo(tipo) {
    estado.filtroTipo = tipo;
    renderizar();
  },
};

function rotaAtual() {
  const r = location.hash.replace(/^#\/?/, '').split(/[?&]/)[0];
  return PAGINAS[r] ? r : 'painel';
}

function renderizar() {
  estado.rota = rotaAtual();
  for (const a of $$('.nav a')) a.classList.toggle('ativo', a.dataset.rota === estado.rota);
  PAGINAS[estado.rota]($('#app'), app);
  atualizarSync();
}

function atualizarSync() {
  const dot = $('.sync-dot');
  const txt = $('.sync-texto');
  dot.className = `sync-dot ${estado.carregando ? 'carregando' : estado.erro ? 'erro' : ''}`;
  if (estado.carregando) txt.textContent = 'Atualizando…';
  else if (estado.erro) txt.textContent = 'Sem conexão';
  else if (estado.ultimaLeitura) txt.textContent = `Atualizado às ${new Date(estado.ultimaLeitura).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

async function recarregar({ silencioso = false } = {}) {
  if (estado.carregando) return;
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
    if (!silencioso) toast(e.message, 'erro', 6000);
  } finally {
    estado.carregando = false;
    atualizarSync();
  }
}

function aplicarTema() {
  if (config.tema === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = config.tema;
}

// ───────────── Início ─────────────

if (importarConfiguracaoDoLink()) toast('Configuração importada do link');
aplicarTema();
estado.dados = dadosEmCache();
renderizar();
recarregar({ silencioso: true }).then(() => {
  if (estado.erro && !estado.dados) toast(estado.erro, 'erro', 8000);
});

window.addEventListener('hashchange', () => {
  renderizar();
  window.scrollTo({ top: 0 });
});
$('#btn-atualizar').addEventListener('click', () => recarregar());

setInterval(() => {
  if (document.visibilityState === 'visible') recarregar({ silencioso: true });
}, ATUALIZAR_A_CADA);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - estado.ultimaLeitura > 60 * 1000) recarregar({ silencioso: true });
});
