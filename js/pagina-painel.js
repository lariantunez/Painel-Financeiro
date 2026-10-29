// Tela principal: visão do mês.

import { moeda, pct, nomeMes, somarMeses, MESES, MESES_LONGOS, escapeHtml, rotulo, mesAtual, RX_PARCELA, parseValor, arred, rotuloPeriodo } from './util.js';
import { totaisMes, serieMeses, porTipo, fixoVariavel, contasAPagar, parcelamentos, maioresGastos, qualidade, tipoDe, mesmaDespesa, lancamentosSeguintes, nomeDaParcela, periodoAnterior, FILTROS, filtrarDespesas } from './analise.js';
import { serieDe } from './fixas.js';
import { graficoColunas, responsivo, legenda, linhaTooltip, mostrarTooltip, esconderTooltip, toast, $, $$, cabecalho, ordenar, ligarOrdenacao, dataOrdenavel } from './ui.js';
import { backendConfigurado, enviar } from './api.js';
import { valoresUsados, regraParaLinha } from './model.js';
import { chaveDescricao, ehMarketplace } from './classifier.js';

const COR_R = 'var(--receita)';
const COR_D = 'var(--despesa)';
let abaTabela = 'despesas';
let classificandoSemTipo = false;
let parcelasAbertas = false;
let editando = null; // linha da planilha em edição na tabela
let ctxTabela = null;
let busca = '';

// Colunas ordenáveis (clique no título); a ordem escolhida fica guardada enquanto a página está aberta
const COLS_DESPESAS = [
  { id: 'data', rotulo: 'Data', desc: true },
  { id: 'nome', rotulo: 'Descrição' },
  { id: 'tipo', rotulo: 'Tipo' },
  { id: 'categoria', rotulo: 'Categoria', classe: 'opc' },
  { id: 'recorrencia', rotulo: 'Recorrência', classe: 'opc' },
  { id: 'forma', rotulo: 'Forma', classe: 'opc' },
  { id: 'parcela', rotulo: 'Parcela', classe: 'opc' },
  { id: 'status', rotulo: 'Status', classe: 'opc' },
  { id: 'valor', rotulo: 'Valor', classe: 'num', desc: true },
];
const VALOR_DESPESA = {
  data: (d) => dataOrdenavel(d.vencimento),
  nome: (d) => d.nome,
  tipo: (d) => d.tipo,
  categoria: (d) => rotulo(d.categoria),
  recorrencia: (d) => d.recorrencia,
  forma: (d) => d.forma,
  parcela: (d) => (d.parcelas && d.parcelas !== '1/1' ? d.parcelas : ''),
  status: (d) => rotulo(d.status),
  valor: (d) => d.valor,
};
const COLS_RECEITAS = [
  { id: 'quem', rotulo: 'Quem' },
  { id: 'tipo', rotulo: 'Descrição' },
  { id: 'instituicao', rotulo: 'Instituição', classe: 'opc' },
  { id: 'forma', rotulo: 'Forma', classe: 'opc' },
  { id: 'valor', rotulo: 'Valor', classe: 'num', desc: true },
];
const VALOR_RECEITA = { quem: (r) => r.nome, tipo: (r) => r.tipo, instituicao: (r) => r.instituicao, forma: (r) => r.forma, valor: (r) => r.valor };
const COLS_PARCELAS = [
  { id: 'nome', rotulo: 'Compra' },
  { id: 'parcela', rotulo: 'Parcela' },
  { id: 'valor', rotulo: 'Valor', classe: 'num', desc: true },
  { id: 'restante', rotulo: 'Falta pagar', classe: 'num', desc: true },
  { id: 'termina', rotulo: 'Termina' },
];
const VALOR_PARCELA = { nome: (a) => a.nome, parcela: (a) => a.n - a.k, valor: (a) => a.valor, restante: (a) => a.restante, termina: (a) => a.termina };
const ORDEM_PADRAO = {
  despesas: { col: 'data', dir: -1 },
  receitas: { col: 'valor', dir: -1 },
  parcelas: { col: 'restante', dir: -1 },
};
const ordem = structuredClone(ORDEM_PADRAO);

// Filtros: tipo (gráfico de categorias), busca da tabela e ordenação das colunas
// (o período também conta: clicar numa barra do gráfico de 12 meses filtra a página inteira)
let comparacao = 'vs mês anterior'; // texto das variações nos cartões
let periodo = 'mês'; // "mês" ou "período", nos textos
let filtrosAtuais = {};

// Atributos que tornam um dado clicável como filtro (clicar de novo no mesmo dado tira o filtro)
function filtravel(campo, valor, texto = valor) {
  const ativo = filtrosAtuais[campo]?.valor === valor;
  return `data-filtro="${campo}" data-valor="${escapeHtml(valor)}" data-texto="${escapeHtml(texto)}" title="${ativo ? 'Clique para tirar o filtro' : 'Clique para filtrar a página'}"`;
}
const ativoNoFiltro = (campo, valor) => filtrosAtuais[campo]?.valor === valor;
const apagadoNoFiltro = (campo, valor) => Boolean(filtrosAtuais[campo]) && filtrosAtuais[campo].valor !== valor;

function temFiltro({ filtros, meses }) {
  return Boolean(Object.keys(filtros).length || meses.length !== 1 || meses[0] !== mesAtual() || busca.trim() || Object.keys(ORDEM_PADRAO).some((k) => ordem[k].col !== ORDEM_PADRAO[k].col || ordem[k].dir !== ORDEM_PADRAO[k].dir));
}

// ───────────── Seletor de período (vários meses) ─────────────

const ATALHOS = [
  ['atual', 'Mês atual'],
  ['3', 'Últimos 3 meses'],
  ['6', 'Últimos 6 meses'],
  ['12', 'Últimos 12 meses'],
  ['ano', 'Este ano'],
];

function mesesDoAtalho(atalho) {
  const hoje = mesAtual();
  if (atalho === 'atual') return [hoje];
  if (atalho === 'ano') return Array.from({ length: +hoje.slice(5) }, (_, i) => `${hoje.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`);
  return Array.from({ length: +atalho }, (_, i) => somarMeses(hoje, -i));
}

function seletorPeriodo(meses, dados) {
  // meses disponíveis: do primeiro lançamento até 2 meses à frente (contas já lançadas)
  const comDados = new Set([...dados.despesas, ...dados.receitas].map((l) => l.mesRef).filter((m) => m && m >= '2000'));
  const fim = somarMeses(mesAtual(), 2);
  const inicio = [...comDados].filter((m) => m <= fim).sort()[0] || mesAtual();
  const anos = [];
  for (let a = +fim.slice(0, 4); a >= +inicio.slice(0, 4); a--) anos.push(a);
  const sel = new Set(meses);
  return `<div class="periodo">
    <button class="btn btn-ghost btn-icone" data-mover="-1" aria-label="Período anterior">‹</button>
    <button class="periodo-btn" id="periodo-btn" aria-haspopup="true" aria-expanded="false"><h1>${escapeHtml(rotuloPeriodo(meses))}</h1><span class="seta" aria-hidden="true">▾</span></button>
    <button class="btn btn-ghost btn-icone" data-mover="1" aria-label="Próximo período">›</button>
    <div class="periodo-painel" id="periodo-painel" hidden>
      <div class="periodo-atalhos">${ATALHOS.map(([v, r]) => `<button class="btn btn-sm" data-atalho="${v}">${r}</button>`).join('')}</div>
      <div class="periodo-anos">
        ${anos
          .map((a) => {
            const doAno = Array.from({ length: 12 }, (_, i) => `${a}-${String(i + 1).padStart(2, '0')}`).filter((m) => m >= inicio && m <= fim);
            return `<div class="periodo-ano">
              <label class="periodo-ano-rotulo"><input type="checkbox" data-ano="${a}" ${doAno.every((m) => sel.has(m)) ? 'checked' : ''}> ${a}</label>
              <div class="periodo-meses">${Array.from({ length: 12 }, (_, i) => {
                const m = `${a}-${String(i + 1).padStart(2, '0')}`;
                const fora = m < inicio || m > fim;
                return `<label class="mes-chip ${comDados.has(m) ? '' : 'sem-dados'}" title="${MESES_LONGOS[i]} ${a}${comDados.has(m) ? '' : ' (sem lançamentos)'}"><input type="checkbox" data-m="${m}" ${sel.has(m) ? 'checked' : ''} ${fora ? 'disabled' : ''}><span>${MESES[i]}</span></label>`;
              }).join('')}</div>
            </div>`;
          })
          .join('')}
      </div>
      <div class="periodo-rodape"><span class="muted small" id="periodo-contagem">${meses.length} mês(es)</span><span style="display:flex;gap:8px"><button class="btn btn-sm btn-ghost" id="periodo-cancelar">Cancelar</button><button class="btn btn-sm btn-primario" id="periodo-aplicar">Aplicar</button></span></div>
    </div>
  </div>`;
}

function ligarSeletorPeriodo(raiz, app) {
  const painel = $('#periodo-painel', raiz);
  const botao = $('#periodo-btn', raiz);
  const abrir = (sim) => {
    painel.hidden = !sim;
    botao.setAttribute('aria-expanded', String(sim));
  };
  const marcados = () => $$('[data-m]:checked', painel).map((c) => c.dataset.m);
  const contar = () => {
    $('#periodo-contagem', painel).textContent = `${marcados().length} mês(es)`;
    for (const c of $$('[data-ano]', painel)) {
      const doAno = $$(`[data-m^="${c.dataset.ano}-"]:not(:disabled)`, painel);
      c.checked = doAno.length > 0 && doAno.every((x) => x.checked);
    }
  };
  botao.addEventListener('click', () => abrir(painel.hidden));
  $('#periodo-cancelar', painel).addEventListener('click', () => abrir(false));
  $('#periodo-aplicar', painel).addEventListener('click', () => app.definirMeses(marcados()));
  painel.addEventListener('change', (e) => {
    if (e.target.dataset.ano) for (const c of $$(`[data-m^="${e.target.dataset.ano}-"]:not(:disabled)`, painel)) c.checked = e.target.checked;
    contar();
  });
  for (const b of $$('[data-atalho]', painel)) b.addEventListener('click', () => app.definirMeses(mesesDoAtalho(b.dataset.atalho)));
  for (const b of $$('[data-mover]', raiz)) b.addEventListener('click', () => app.definirMeses(app.estado.meses.map((m) => somarMeses(m, +b.dataset.mover * app.estado.meses.length))));
  painel.addEventListener('keydown', (e) => e.key === 'Escape' && (abrir(false), botao.focus()));
}

// Fecha o seletor de período ao clicar fora (um único ouvinte para a página toda)
document.addEventListener('mousedown', (e) => {
  const painel = document.getElementById('periodo-painel');
  if (painel && !painel.hidden && !e.target.closest('.periodo')) {
    painel.hidden = true;
    document.getElementById('periodo-btn')?.setAttribute('aria-expanded', 'false');
  }
});

// Sempre visível; fica desativado quando não há nada para limpar
function atualizarBotaoLimpar(estado) {
  const b = document.getElementById('limpar-filtros');
  if (b && estado) b.disabled = !temFiltro(estado);
}

export function renderPainel(raiz, app) {
  const { dados, meses, filtros } = app.estado;
  filtrosAtuais = filtros;
  const filtrado = Object.keys(filtros).length > 0;
  if (!dados) {
    raiz.innerHTML = '<div class="vazio">Carregando dados…</div>';
    return;
  }

  // Período: um ou vários meses. "mes" = último mês do período (referência para contas a pagar e parcelas)
  const mes = meses[meses.length - 1];
  const varios = meses.length > 1;
  comparacao = varios ? 'vs período anterior' : 'vs mês anterior';
  periodo = varios ? 'período' : 'mês';
  const t = totaisMes(dados, meses, filtros);
  const ant = totaisMes(dados, periodoAnterior(meses), filtros);
  // saldo e poupança são do orçamento inteiro: não faz sentido "receitas − só uma parte das despesas"
  const geral = filtrado ? totaisMes(dados, meses) : t;
  const geralAnt = filtrado ? totaisMes(dados, periodoAnterior(meses)) : ant;
  const problemas = qualidade(dados);
  const aPagar = filtrarDespesas(contasAPagar(dados, mes), filtros, ['status']);

  const semTipo = problemas.find((p) => p.semTipo)?.semTipo || [];
  raiz.innerHTML = `
    ${avisos(app, problemas)}
    ${classificandoSemTipo && semTipo.length ? painelSemTipo(semTipo, dados) : ''}
    <div class="cabecalho-pagina">
      ${seletorPeriodo(meses, dados)}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${Object.entries(filtros)
          .map(([k, f]) => `<button class="filtro-chip" data-tirar="${k}" title="Tirar este filtro">${FILTROS[k].rotulo}: ${escapeHtml(f.texto)} <span aria-hidden="true">×</span></button>`)
          .join('')}
        <button class="btn btn-sm" id="limpar-filtros" ${temFiltro(app.estado) ? '' : 'disabled'} title="Volta para o mês atual e limpa o tipo, a busca e a ordenação das tabelas">Limpar filtros</button>
      </div>
    </div>

    <section class="kpis">
      ${kpi('Receitas', COR_R, t.receita, ant.receita, `${t.qtdReceitas} lançamento(s)`, true)}
      ${kpi('Despesas', COR_D, t.despesa, ant.despesa, `${t.qtdDespesas} lançamento(s)`, false)}
      ${kpiSaldo(geral, filtrado)}
      ${kpiPoupanca(geral, geralAnt, filtrado)}
    </section>

    <section class="grade">
      <div class="card c-12">
        <div class="card-titulo">
          <h2>Últimos 12 meses</h2>
          ${legenda([[COR_R, 'Receitas'], [COR_D, filtrado ? 'Despesas (filtradas)' : 'Despesas']])}
        </div>
        <div id="g-evolucao"></div>
      </div>
    </section>

    <section class="grade">
      <div class="card c-7">
        <div class="card-titulo">
          <h2>Despesas por tipo</h2>
          ${legenda([[COR_D, varios ? 'No período' : 'Este mês'], ['var(--media-fundo)', varios ? 'Média de 6 meses (mesma duração)' : 'Média 6 meses']])}
        </div>
        <div id="por-tipo"></div>
      </div>
      <div class="c-5" style="display:grid;gap:12px;align-content:start">
        <div class="card">
          <div class="card-titulo"><h2 class="filtravel ${ativoNoFiltro('status', 'A PAGAR') ? 'filtro-ativo' : ''}" ${filtravel('status', 'A PAGAR', 'A pagar')}>Contas a pagar</h2><span class="sub">${aPagar.length ? moeda(aPagar.reduce((s, d) => s + d.valor, 0)) : ''}</span></div>
          <div id="a-pagar"></div>
        </div>
        <div class="card" id="composicao"></div>
      </div>
    </section>

    <section class="grade">
      <div class="card c-7" id="parcelamentos"></div>
      <div class="card c-5">
        <div class="card-titulo"><h2>Maiores gastos ${varios ? 'do período' : 'do mês'}</h2></div>
        <div id="maiores"></div>
      </div>
    </section>

    <section class="card">
      <div class="abas" role="tablist">
        <button data-aba="despesas" class="${abaTabela === 'despesas' ? 'ativo' : ''}">Despesas <span class="muted">${t.qtdDespesas}</span></button>
        <button data-aba="receitas" class="${abaTabela === 'receitas' ? 'ativo' : ''}">Receitas <span class="muted">${t.qtdReceitas}</span></button>
      </div>
      <div class="ferramentas"><input class="input input-sm" id="busca" placeholder="Buscar lançamento…" value="${escapeHtml(busca)}"></div>
      <div class="tabela-wrap" id="tabela"></div>
    </section>
  `;

  ligarSemTipo(raiz, semTipo, app);

  ligarSeletorPeriodo(raiz, app);
  for (const b of $$('[data-tirar]', raiz)) b.addEventListener('click', () => app.tirarFiltro(b.dataset.tirar));
  // Um único ouvinte: qualquer dado com data-filtro filtra a página (e desfaz ao clicar de novo)
  if (!raiz._filtrosLigados) {
    raiz._filtrosLigados = true;
    raiz.addEventListener('click', (e) => {
      const alvo = e.target.closest('[data-filtro]');
      if (!alvo || !raiz.contains(alvo) || app.estado.rota !== 'painel') return;
      e.preventDefault();
      esconderTooltip();
      app.alternarFiltro(alvo.dataset.filtro, alvo.dataset.valor, alvo.dataset.texto);
    });
  }
  $('#limpar-filtros', raiz).addEventListener('click', () => {
    busca = '';
    Object.assign(ordem, structuredClone(ORDEM_PADRAO));
    app.limparFiltros(); // redesenha a página inteira
  });

  // Evolução
  // Janela fixa: últimos 12 meses até o mês atual (clicar numa barra só a seleciona, nada muda de lugar).
  // Só se move quando o período escolhido tem mês fora dessa janela.
  let fimGrafico = mesAtual();
  if (meses.some((m) => m > fimGrafico || m < somarMeses(fimGrafico, -11))) fimGrafico = mes;
  const serie = serieMeses(dados, fimGrafico, 12, filtros);
  responsivo($('#g-evolucao', raiz), () =>
    graficoColunas($('#g-evolucao', raiz), {
      rotulos: serie.map((s) => MESES[+s.mes.slice(5) - 1] + (s.mes.endsWith('-01') ? ` ${s.mes.slice(2, 4)}` : '')),
      series: [
        { nome: 'Receitas', cor: COR_R, valores: serie.map((s) => s.receita) },
        { nome: 'Despesas', cor: COR_D, valores: serie.map((s) => s.despesa) },
      ],
      selecionado: serie.map((s, i) => (meses.includes(s.mes) ? i : -1)).filter((i) => i >= 0),
      onClick: (i, e) => {
        const m = serie[i].mes;
        if (e.ctrlKey || e.metaKey) app.definirMeses(meses.includes(m) ? meses.filter((x) => x !== m) : [...meses, m]);
        else if (meses.length === 1 && meses[0] === m) app.irParaMes(mesAtual()); // clicar de novo tira o filtro
        else app.irParaMes(m);
      },
      tooltip: (i) => {
        const s = serie[i];
        return `<div class="t-titulo">${nomeMes(s.mes)}</div>${linhaTooltip(COR_R, 'Receitas', moeda(s.receita))}${linhaTooltip(COR_D, 'Despesas', moeda(s.despesa))}<div class="t-sep"></div>${linhaTooltip('', 'Saldo', `<span class="${s.saldo >= 0 ? 'pos' : 'neg'}">${s.saldo >= 0 ? '+' : ''}${moeda(s.saldo)}</span>`)}<div class="t-sep"></div><div class="small muted">Clique: ver este mês (de novo: volta ao atual) · Ctrl+clique: somar ao período</div>`;
      },
    })
  );

  renderPorTipo($('#por-tipo', raiz), dados, meses, filtros);
  renderAPagar($('#a-pagar', raiz), aPagar, mes, app);
  renderComposicao($('#composicao', raiz), filtrarDespesas(totaisMes(dados, meses).despesas, filtros, ['categoria', 'recorrencia']));
  renderParcelamentos($('#parcelamentos', raiz), filtrado ? { ...dados, despesas: filtrarDespesas(dados.despesas, filtros) } : dados, mes);
  renderMaiores($('#maiores', raiz), t.despesas);
  ctxTabela = { app, tipos: valoresUsados(dados.despesas, 'tipo').sort((a, b) => a.localeCompare(b, 'pt-BR')) };
  renderTabela($('#tabela', raiz), t);

  for (const b of $$('[data-aba]', raiz)) {
    b.addEventListener('click', () => {
      abaTabela = b.dataset.aba;
      $$('[data-aba]', raiz).forEach((x) => x.classList.toggle('ativo', x === b));
      renderTabela($('#tabela', raiz), t);
    });
  }
  $('#busca', raiz).addEventListener('input', (e) => {
    busca = e.target.value;
    renderTabela($('#tabela', raiz), t);
  });
}

// ───────────── Blocos ─────────────

function avisos(app, problemas) {
  let html = '';
  if (app.estado.erro) {
    html += `<div class="aviso erro"><div><b>Não consegui atualizar os dados.</b> ${escapeHtml(app.estado.erro)}<br><span class="small text-2">Mostrando a última cópia salva neste navegador.</span></div></div>`;
  }
  if (!backendConfigurado()) {
    html += `<div class="aviso info"><div><b>Falta um passo para a importação automática.</b> Conecte o painel à planilha (leva 3 minutos) para gravar lançamentos, marcar contas como pagas e deixar a planilha privada.</div><div class="acoes"><a class="btn btn-sm" href="#/config">Configurar</a></div></div>`;
  }
  for (const p of problemas) {
    const ex = p.exemplo ? ` — ex.: linha ${p.exemplo._linha} (“${escapeHtml(p.exemplo.tipo || p.exemplo.nome)}”)` : '';
    const linhas = p.linhas.length > 8 ? `${p.linhas.slice(0, 8).join(', ')}…` : p.linhas.join(', ');
    const acao = p.semTipo && backendConfigurado() && !classificandoSemTipo ? '<div class="acoes"><button class="btn btn-sm" id="btn-sem-tipo">Classificar agora</button></div>' : '';
    html += `<div class="aviso"><div><b>${escapeHtml(p.texto)}</b> na aba ${p.aba}${ex}. ${p.impacto}<br><span class="small text-2">Linhas: ${linhas}</span></div>${acao}</div>`;
  }
  return html;
}

// Classificar despesas sem TIPO direto pelo painel
function painelSemTipo(lista, dados) {
  const tipos = valoresUsados(dados.despesas, 'tipo').sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return `<div class="card" style="margin-bottom:16px">
    <div class="card-titulo"><h2>Classificar despesas sem tipo</h2><span class="sub">A alteração vai direto para a planilha</span></div>
    <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Data</th><th>Nome</th><th class="opc">Forma</th><th class="num">Valor</th><th>Tipo</th></tr></thead><tbody>
    ${lista
      .map(
        (d, i) => `<tr><td class="tab">${escapeHtml(d.vencimento)}</td><td><input class="input input-sm" data-sem-tipo-nome="${i}" value="${escapeHtml(d.nome)}" aria-label="Nome da despesa"><span class="desc-original">linha ${d._linha} · ${nomeMes(d.mesRef, false)}${d.descOriginal ? ` · no banco: ${escapeHtml(d.descOriginal)}` : ''}</span></td>
        <td class="text-2 opc">${escapeHtml(d.forma)}</td><td class="num">${moeda(d.valor)}</td>
        <td><select class="select select-sm" data-sem-tipo="${i}" aria-label="Tipo de ${escapeHtml(d.nome)}"><option value="">Escolha…</option>${tipos.map((t) => `<option>${escapeHtml(t)}</option>`).join('')}</select></td></tr>`
      )
      .join('')}
    </tbody></table></div>
    <div class="rodape-acoes" style="justify-content:flex-end"><button class="btn" id="cancelar-sem-tipo">Cancelar</button><button class="btn btn-primario" id="salvar-sem-tipo">Salvar</button></div>
  </div>`;
}

function ligarSemTipo(raiz, lista, app) {
  $('#btn-sem-tipo', raiz)?.addEventListener('click', () => {
    classificandoSemTipo = true;
    app.renderizar();
  });
  $('#cancelar-sem-tipo', raiz)?.addEventListener('click', () => {
    classificandoSemTipo = false;
    app.renderizar();
  });
  $('#salvar-sem-tipo', raiz)?.addEventListener('click', async (e) => {
    const escolhas = $$('[data-sem-tipo]', raiz)
      .map((s) => {
        const d = lista[+s.dataset.semTipo];
        const nome = $(`[data-sem-tipo-nome="${s.dataset.semTipo}"]`, raiz).value.trim();
        const campos = {};
        if (s.value) campos.TIPO = s.value;
        if (nome && nome !== d.nome) campos.NOME_DESPESA = nome;
        return { d, campos };
      })
      .filter(({ campos }) => Object.keys(campos).length);
    if (!escolhas.length) {
      toast('Escolha o tipo ou mude o nome de pelo menos uma despesa', 'erro');
      return;
    }
    e.target.disabled = true;
    e.target.textContent = 'Salvando…';
    try {
      const r = await enviar('status', { alteracoes: escolhas.map(({ d, campos }) => ({ aba: 'despesas', linha: d._linha, nome: d.nome, campos })) });
      if (r.erros?.length) toast(r.erros[0], 'erro', 6000);
      if (r.alteradas) toast(`${r.alteradas} despesa(s) atualizada(s)`);
      classificandoSemTipo = false;
      await app.recarregar();
    } catch (err) {
      toast(err.message, 'erro', 6000);
      e.target.disabled = false;
      e.target.textContent = 'Salvar';
    }
  });
}

function delta(atual, anterior, subirEhBom) {
  if (!atual) return '<span class="muted">nenhum lançamento ainda</span>';
  if (!anterior) return `<span class="muted">sem dados no ${comparacao === 'vs mês anterior' ? 'mês' : 'período'} anterior</span>`;
  const d = (atual - anterior) / Math.abs(anterior);
  const subiu = d >= 0;
  const bom = subiu === subirEhBom;
  return `<b class="${Math.abs(d) < 0.005 ? '' : bom ? 'pos' : 'neg'}">${subiu ? '▲' : '▼'} ${pct(Math.abs(d))}</b> ${comparacao}`;
}

function kpi(rotuloKpi, cor, valor, anterior, info, subirEhBom) {
  return `<div class="card kpi">
    <div class="rotulo"><i class="swatch" style="background:${cor}"></i>${rotuloKpi}</div>
    <div class="valor">${moeda(valor)}</div>
    <div class="delta">${delta(valor, anterior, subirEhBom)}</div>
    <div class="delta">${info}</div>
  </div>`;
}

function kpiSaldo(t, filtrado) {
  if (!t.qtdReceitas && !t.qtdDespesas) {
    return `<div class="card kpi"><div class="rotulo">Saldo do ${periodo}</div><div class="valor muted">—</div><div class="delta">${periodo} ainda sem lançamentos</div></div>`;
  }
  const positivo = t.saldo >= 0;
  return `<div class="card kpi">
    <div class="rotulo">Saldo do ${periodo}${filtrado ? ' <span class="badge">sem filtros</span>' : ''}</div>
    <div class="valor ${positivo ? 'pos' : 'neg'}">${positivo ? '' : '−'}${moeda(Math.abs(t.saldo))}</div>
    <div class="delta">${positivo ? '<span class="badge badge-good">✓ Sobrou dinheiro</span>' : '<span class="badge badge-crit">! Gastou mais que recebeu</span>'}</div>
  </div>`;
}

function kpiPoupanca(t, ant, filtrado) {
  const v = t.poupanca;
  const va = ant.poupanca;
  let comp = '<span class="muted">—</span>';
  if (v !== null && va !== null) {
    const dif = (v - va) * 100;
    comp = `<b class="${dif >= 0 ? 'pos' : 'neg'}">${dif >= 0 ? '▲' : '▼'} ${Math.abs(dif).toFixed(0)} p.p.</b> ${comparacao}`;
  }
  return `<div class="card kpi">
    <div class="rotulo">Taxa de poupança${filtrado ? ' <span class="badge">sem filtros</span>' : ''}</div>
    <div class="valor">${v === null ? '—' : pct(v)}</div>
    <div class="delta">${comp}</div>
    <div class="delta">da receita que sobrou</div>
  </div>`;
}

function renderPorTipo(el, dados, mes, filtros) {
  const tipos = porTipo(dados, mes, filtros);
  if (!tipos.length) {
    el.innerHTML = `<div class="vazio">Nenhuma despesa neste ${periodo}.</div>`;
    return;
  }
  const max = Math.max(...tipos.map((t) => Math.max(t.valor, t.media)));
  el.innerHTML = `<div class="barras">${tipos
    .map((t) => {
      const dif = t.media ? (t.valor - t.media) / t.media : null;
      const difTxt = dif === null ? 'novo' : `${dif >= 0 ? '+' : '−'}${pct(Math.abs(dif))}`;
      return `<button class="barra-linha ${apagadoNoFiltro('tipo', t.tipo) ? 'apagada' : ''}" data-tipo="${escapeHtml(t.tipo)}" ${filtravel('tipo', t.tipo)}>
        <span class="nome">${escapeHtml(t.tipo)}</span>
        <span class="barra-trilho">
          ${t.media ? `<span class="barra-media-fundo" style="width:${(t.media / max) * 100}%"></span>` : ''}
          <span class="barra-fill" style="width:${(Math.max(0, t.valor) / max) * 100}%"></span>
                  </span>
        <span class="valores num">${moeda(t.valor)}<span class="muted">${difTxt}</span></span>
      </button>`;
    })
    .join('')}</div>`;
  for (const b of $$('.barra-linha', el)) {
    const t = tipos.find((x) => x.tipo === b.dataset.tipo);
    b.addEventListener('mousemove', (e) =>
      mostrarTooltip(e, `<div class="t-titulo">${escapeHtml(t.tipo)}</div>${linhaTooltip(COR_D, 'Este mês', moeda(t.valor))}${linhaTooltip('', 'Média 6 meses', moeda(t.media))}<div class="t-sep"></div><div class="small muted">${ativoNoFiltro('tipo', t.tipo) ? 'Clique para tirar o filtro' : 'Clique para filtrar'}</div>`)
    );
    b.addEventListener('mouseleave', esconderTooltip);
  }
}

function renderAPagar(el, lista, mes, app) {
  if (!lista.length) {
    el.innerHTML = '<div class="vazio" style="padding:8px 0">✓ Nada pendente até este mês.</div>';
    return;
  }
  const podeMarcar = backendConfigurado();
  el.innerHTML = `<div class="lista">${lista
    .map((d, i) => {
      const atrasada = d.mesRef < mes || (d.data && new Date(d.data.ano, d.data.mes - 1, d.data.dia) < new Date(new Date().toDateString()));
      return `<div class="lista-item">
        <div class="principal"><div>${escapeHtml(d.nome)}</div><div class="small">${escapeHtml(d.vencimento || '')} · ${escapeHtml(d.forma)}${atrasada ? ' · <span class="neg">vencida</span>' : ''}</div></div>
        <div class="valor num">${moeda(d.valor)}</div>
        ${podeMarcar ? `<button class="btn btn-sm" data-pagar="${i}">Pago</button>` : ''}
      </div>`;
    })
    .join('')}</div>`;
  for (const b of $$('[data-pagar]', el)) {
    b.addEventListener('click', async () => {
      const d = lista[+b.dataset.pagar];
      b.disabled = true;
      b.textContent = '…';
      try {
        const r = await enviar('status', { alteracoes: [{ aba: 'despesas', linha: d._linha, nome: d.nome, campos: { STATUS: 'PAGO' } }] });
        if (r.erros?.length) throw new Error(r.erros[0]);
        d.status = 'PAGO';
        toast(`“${d.nome}” marcada como paga`);
        app.renderizar();
      } catch (e) {
        toast(e.message, 'erro', 6000);
        b.disabled = false;
        b.textContent = 'Pago';
      }
    });
  }
}

// Composição das despesas do mês: valor fixo × variável e conta mensal × gasto eventual
function renderComposicao(el, despesas) {
  const { fixo, variavel } = fixoVariavel(despesas);
  const total = fixo + variavel;
  if (total <= 0) {
    el.innerHTML = `<div class="card-titulo"><h2>Composição das despesas</h2></div><div class="vazio" style="padding:8px 0">Sem despesas no ${periodo}.</div>`;
    return;
  }
  const mensal = despesas.filter((d) => d.recorrencia === 'MENSAL').reduce((s, d) => s + d.valor, 0);
  // cada parte (barra ou legenda) é clicável: filtra a página por ela; clicar de novo tira
  const divisao = (campo, a, valA, rotA, corA, b, valB, rotB) => {
    const parte = (v, cor, flex) => `<div class="split-parte ${apagadoNoFiltro(campo, v) ? 'apagada' : ''}" style="flex:${Math.max(flex, 0)};background:${cor}" ${filtravel(campo, v, v === valA ? rotA : rotB)}></div>`;
    const item = (v, cor, rot, valor) => `<button class="legenda-filtro ${ativoNoFiltro(campo, v) ? 'filtro-ativo' : ''} ${apagadoNoFiltro(campo, v) ? 'apagada' : ''}" ${filtravel(campo, v, rot)}><i class="swatch" style="background:${cor}"></i>${rot} <b class="num">${moeda(valor)}</b> <span class="muted">${pct(valor / total)}</span></button>`;
    return `<div class="split">${parte(valA, corA, a)}${parte(valB, 'var(--neutro)', b)}</div>
      <div class="legenda" style="justify-content:space-between;margin-bottom:12px">${item(valA, corA, rotA, a)}${item(valB, 'var(--neutro)', rotB, b)}</div>`;
  };
  el.innerHTML = `<div class="card-titulo"><h2>Composição das despesas</h2><span class="sub">clique para filtrar</span></div>
    ${divisao('recorrencia', mensal, 'MENSAL', 'Mensal', 'var(--accent)', total - mensal, 'EVENTUAL', 'Eventual')}
    ${divisao('categoria', fixo, 'FIXO', 'Fixo', 'var(--accent)', variavel, 'VARIAVEL', 'Variável')}`;
}

function renderParcelamentos(el, dados, mes) {
  const p = parcelamentos(dados, mes);
  el.innerHTML = `<div class="card-titulo"><h2>Parcelamentos no cartão</h2><span class="sub">${p.ativos.length} ativo(s) · ainda faltam <b class="num">${moeda(p.totalRestante)}</b></span></div>
    <div id="g-parcelas"></div>
    <details class="secao" style="margin-top:8px" ${parcelasAbertas ? 'open' : ''}><summary>Ver compras parceladas</summary>
      <div class="tabela-wrap" id="tabela-parcelas"></div>
    </details>`;
  const desenharParcelas = () => {
    const alvo = $('#tabela-parcelas', el);
    alvo.innerHTML = `<table class="tabela">${cabecalho(COLS_PARCELAS, ordem.parcelas)}<tbody>
      ${ordenar(p.ativos, ordem.parcelas, VALOR_PARCELA).map((a) => `<tr><td><span class="filtravel ${ativoNoFiltro('despesa', serieDe(a.nome)) ? 'filtro-ativo' : ''}" ${filtravel('despesa', serieDe(a.nome), a.nome)}>${escapeHtml(a.nome)}</span><span class="desc-original">${escapeHtml(a.tipo)}</span></td><td class="tab">${a.k}/${a.n}</td><td class="num">${moeda(a.valor)}</td><td class="num">${moeda(a.restante)}</td><td>${nomeMes(a.termina, false)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum parcelamento ativo.</td></tr>'}
      </tbody></table>`;
    ligarOrdenacao(alvo, COLS_PARCELAS, ordem.parcelas, desenharParcelas);
    atualizarBotaoLimpar(ctxTabela?.app.estado);
  };
  desenharParcelas();
  $('details', el).addEventListener('toggle', (e) => (parcelasAbertas = e.target.open));
  if (!p.proximos.some((x) => x.valor > 0)) {
    $('#g-parcelas', el).innerHTML = '<div class="vazio" style="padding:8px 0">Nenhuma parcela futura.</div>';
    return;
  }
  responsivo($('#g-parcelas', el), () =>
    graficoColunas($('#g-parcelas', el), {
      rotulos: p.proximos.map((x) => MESES[+x.mes.slice(5) - 1]),
      series: [{ nome: 'Parcelas', cor: COR_D, valores: p.proximos.map((x) => x.valor) }],
      altura: 170,
      tooltip: (i) => `<div class="t-titulo">${nomeMes(p.proximos[i].mes)}</div>${linhaTooltip(COR_D, 'Parcelas já assumidas', moeda(p.proximos[i].valor))}`,
    })
  );
}

function renderMaiores(el, despesas) {
  const lista = maioresGastos(despesas, 6);
  el.innerHTML = lista.length
    ? `<div class="lista">${lista
        .map((d) => `<button class="lista-item lista-filtro ${ativoNoFiltro('despesa', serieDe(d.nome)) ? 'filtro-ativo' : ''}" ${filtravel('despesa', serieDe(d.nome), d.nome.replace(RX_PARCELA, ''))}><div class="principal"><div>${escapeHtml(d.nome)}</div><div class="small">${escapeHtml(tipoDe(d))} · ${escapeHtml(d.forma)}</div></div><div class="valor num">${moeda(d.valor)}</div></button>`)
        .join('')}</div>`
    : `<div class="vazio">Sem despesas no ${periodo}.</div>`;
}

function renderTabela(el, t) {
  const termo = rotulo(busca);
  const filtra = (campos) => !termo || rotulo(campos.join(' ')).includes(termo);
  const redesenhar = () => renderTabela(el, t);
  if (abaTabela === 'despesas') {
    const linhas = ordenar(t.despesas.filter((d) => filtra([d.nome, d.tipo, d.forma, d.instituicao, d.descOriginal])), ordem.despesas, VALOR_DESPESA);
    const editavel = backendConfigurado();
    const colunas = editavel ? [...COLS_DESPESAS, { id: '', rotulo: '' }] : COLS_DESPESAS;
    el.innerHTML = linhas.length
      ? `<table class="tabela">${cabecalho(colunas, ordem.despesas)}<tbody>
        ${linhas.map((d) => (editavel && editando === d._linha ? linhaEmEdicao(d) : linhaDespesa(d, editavel))).join('')}</tbody></table>`
      : '<div class="vazio">Nenhuma despesa encontrada.</div>';
    ligarOrdenacao(el, COLS_DESPESAS, ordem.despesas, redesenhar);
    ligarEdicao(el, t, linhas);
    ligarSeletores(el, linhas);
  } else {
    const linhas = ordenar(t.receitas.filter((r) => filtra([r.nome, r.tipo, r.instituicao])), ordem.receitas, VALOR_RECEITA);
    el.innerHTML = linhas.length
      ? `<table class="tabela">${cabecalho(COLS_RECEITAS, ordem.receitas)}<tbody>
        ${linhas.map((r) => `<tr><td>${escapeHtml(r.nome)}</td><td>${escapeHtml(r.tipo)}</td><td class="text-2 opc">${escapeHtml(r.instituicao)}</td><td class="text-2 opc">${escapeHtml(r.forma)}</td><td class="num">${moeda(r.valor)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="vazio">Nenhuma receita encontrada.</div>';
    ligarOrdenacao(el, COLS_RECEITAS, ordem.receitas, redesenhar);
  }
  atualizarBotaoLimpar(ctxTabela?.app.estado);
}

// Listas de seleção na tabela. Categoria e recorrência são classificação: valem para todos os
// lançamentos da mesma despesa. Status é de cada lançamento (cada mês é pago separadamente).
const SELETORES = {
  status: {
    coluna: 'STATUS',
    rotulo: 'Status',
    opcoes: [['PAGO', 'Pago', 'pago'], ['A PAGAR', 'A pagar', 'a-pagar']],
    aviso: (d, v) => `“${d.nome}” marcada como ${v === 'PAGO' ? 'paga' : 'a pagar'}`,
  },
  categoria: {
    coluna: 'CATEGORIA',
    rotulo: 'Categoria',
    propaga: true,
    opcoes: [['FIXO', 'Fixo', 'fixo'], ['VARIÁVEL', 'Variável', '']],
    aviso: (d, v) => `“${d.nome}” agora é ${v === 'FIXO' ? 'fixa' : 'variável'}`,
  },
  recorrencia: {
    coluna: 'RECORRENCIA',
    rotulo: 'Recorrência',
    propaga: true,
    opcoes: [['MENSAL', 'Mensal', 'mensal'], ['EVENTUAL', 'Eventual', '']],
    aviso: (d, v) => `“${d.nome}” agora é ${v === 'MENSAL' ? 'mensal' : 'eventual'}`,
  },
};

function seletor(campo, d) {
  const { opcoes, rotulo: nomeCampo } = SELETORES[campo];
  const atual = rotulo(d[campo]);
  const lista = opcoes.some(([v]) => rotulo(v) === atual) || !atual ? opcoes : [...opcoes, [d[campo], d[campo], '']];
  const escolhida = lista.find(([v]) => rotulo(v) === atual);
  return `<select class="status-sel ${escolhida?.[2] || ''}" data-sel-campo="${campo}" data-sel-linha="${d._linha}" aria-label="${nomeCampo} de ${escapeHtml(d.nome)}">
    ${atual ? '' : '<option value="" selected>—</option>'}${lista.map(([v, r]) => `<option value="${escapeHtml(v)}" ${escolhida && v === escolhida[0] ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}</select>`;
}

function ligarSeletores(el, linhas) {
  for (const s of $$('[data-sel-campo]', el)) {
    s.addEventListener('change', async () => {
      const campo = s.dataset.selCampo;
      const { coluna, aviso, propaga } = SELETORES[campo];
      const d = linhas.find((x) => x._linha === +s.dataset.selLinha);
      const anterior = d[campo];
      const novo = s.value;
      if (!novo || rotulo(novo) === rotulo(anterior)) return;
      const alvos = (propaga ? mesmaDespesa(ctxTabela.app.estado.dados.despesas, d) : [d]).filter((x) => x === d || rotulo(x[campo]) !== rotulo(novo));
      s.disabled = true;
      try {
        const r = await enviar('status', { alteracoes: alvos.map((x) => ({ aba: 'despesas', linha: x._linha, nome: x.nome, campos: { [coluna]: novo } })) });
        if (r.erros?.length && !r.alteradas) throw new Error(r.erros[0]);
        if (r.erros?.length) toast(`Alguns lançamentos não foram atualizados: ${r.erros[0]}`, 'erro', 8000);
        for (const x of alvos) x[campo] = campo === 'recorrencia' ? rotulo(novo) : novo;
        if (propaga) await ensinar(d, { [campo]: campo === 'recorrencia' ? rotulo(novo) : novo });
        toast(alvos.length > 1 ? `${aviso(d, novo)} — ${alvos.length} lançamentos atualizados` : aviso(d, novo));
        ctxTabela.app.renderizar(); // atualiza também os quadros (contas a pagar, composição)
      } catch (err) {
        toast(err.message, 'erro', 6000);
        s.value = anterior;
        s.disabled = false;
      }
    });
  }
}

function linhaDespesa(d, editavel) {
  const desc = d.descOriginal && d.descOriginal !== d.nome ? `<span class="desc-original">${escapeHtml(d.descOriginal)}</span>` : '';
  const texto = (campo) => escapeHtml(SELETORES[campo].opcoes.find(([v]) => rotulo(v) === rotulo(d[campo]))?.[1] || d[campo] || '');
  const celula = (campo, valor, texto, conteudo) => `<span class="filtravel ${ativoNoFiltro(campo, valor) ? 'filtro-ativo' : ''}" ${filtravel(campo, valor, texto)}>${conteudo}</span>`;
  return `<tr><td class="tab">${escapeHtml(d.vencimento)}</td><td>${celula('despesa', serieDe(d.nome), d.nome.replace(RX_PARCELA, ''), escapeHtml(d.nome))}${desc}</td>
    <td>${celula('tipo', tipoDe(d), tipoDe(d), escapeHtml(tipoDe(d)))}</td>
    <td class="opc">${editavel ? seletor('categoria', d) : texto('categoria')}</td>
    <td class="opc">${editavel ? seletor('recorrencia', d) : texto('recorrencia')}</td>
    <td class="text-2 opc">${d.forma ? celula('forma', d.forma, d.forma, escapeHtml(d.forma)) : ''}</td><td class="tab opc">${escapeHtml(d.parcelas && d.parcelas !== '1/1' ? d.parcelas : '')}</td>
    <td class="opc">${editavel ? seletor('status', d) : statusBadge(d.status)}</td><td class="num">${moeda(d.valor)}</td>
    ${editavel ? `<td class="acao-linha"><button class="btn btn-ghost btn-icone btn-sm" data-editar="${d._linha}" aria-label="Editar ${escapeHtml(d.nome)}" title="Editar" aria-expanded="${editando === d._linha}">✎</button></td>` : ''}</tr>`;
}

// Edição: a linha continua visível e um painel abre logo abaixo, com espaço próprio para os campos
// (não corta em telas menores e, no celular, dá acesso às colunas que ficam escondidas)
function linhaEmEdicao(d) {
  const tipos = ctxTabela.tipos;
  const despesas = ctxTabela.app.estado.dados.despesas;
  const iguais = mesmaDespesa(despesas, d).length - 1;
  const seguintes = lancamentosSeguintes(despesas, d).length - 1;
  const opcoes = (campo) => {
    const atual = rotulo(d[campo]);
    return `${atual ? '' : '<option value="">—</option>'}${SELETORES[campo].opcoes.map(([v, r]) => `<option value="${escapeHtml(v)}" ${rotulo(v) === atual ? 'selected' : ''}>${r}</option>`).join('')}`;
  };
  const alcance = iguais > 0
    ? `<div class="edicao-alcance">Nome, tipo, categoria e recorrência: este e mais <b>${iguais}</b> lançamento(s) igual(is). Valor: este${seguintes ? ` e os <b>${seguintes}</b> seguinte(s)` : ''}. Status: só este.
        <label><input type="checkbox" id="edit-so"> Só neste lançamento</label></div>`
    : '';
  return `${linhaDespesa(d, true).replace('<tr>', '<tr class="em-edicao">')}
    <tr class="editando"><td colspan="${COLS_DESPESAS.length + 1}">
      <div class="edicao">
        <label class="campo edicao-nome">Nome<input class="input input-sm" id="edit-nome" value="${escapeHtml(d.nome)}">
          ${d.descOriginal ? `<span class="dica">No banco: ${escapeHtml(d.descOriginal)}</span>` : ''}</label>
        <label class="campo">Tipo<select class="select select-sm" id="edit-tipo">${!d.tipo ? '<option value="">Escolha…</option>' : ''}${tipos.map((x) => `<option ${x === d.tipo ? 'selected' : ''}>${escapeHtml(x)}</option>`).join('')}</select></label>
        <label class="campo">Valor<input class="input input-sm num" id="edit-valor" inputmode="decimal" value="${d.valor.toFixed(2).replace('.', ',')}"></label>
        <label class="campo">Categoria<select class="select select-sm" id="edit-categoria">${opcoes('categoria')}</select></label>
        <label class="campo">Recorrência<select class="select select-sm" id="edit-recorrencia">${opcoes('recorrencia')}</select></label>
        <label class="campo">Status<select class="select select-sm" id="edit-status">${opcoes('status')}</select></label>
      </div>
      <div class="edicao-rodape">${alcance}<div class="edicao-acoes"><button class="btn btn-sm" id="edit-cancelar">Cancelar</button><button class="btn btn-sm btn-primario" id="edit-salvar">Salvar</button></div></div>
    </td></tr>`;
}

function ligarEdicao(el, t, linhas) {
  for (const b of $$('[data-editar]', el)) {
    b.addEventListener('click', () => {
      editando = editando === +b.dataset.editar ? null : +b.dataset.editar;
      renderTabela(el, t);
      const input = $('#edit-nome', el);
      input?.focus();
      input?.select();
    });
  }
  const d = linhas.find((x) => x._linha === editando);
  if (!d || !$('#edit-salvar', el)) return;
  const cancelar = () => {
    editando = null;
    renderTabela(el, t);
  };
  const salvar = async () => {
    const nome = $('#edit-nome', el).value.trim();
    const tipo = $('#edit-tipo', el).value;
    const valor = arred(parseValor($('#edit-valor', el).value));
    const categoria = $('#edit-categoria', el).value;
    const recorrencia = $('#edit-recorrencia', el).value;
    const status = $('#edit-status', el).value;
    const so = $('#edit-so', el)?.checked;
    const mudou = {
      nome: nome && nome !== d.nome,
      tipo: tipo && tipo !== d.tipo,
      valor: $('#edit-valor', el).value.trim() !== '' && Math.abs(valor - d.valor) > 0.004,
      categoria: categoria && rotulo(categoria) !== rotulo(d.categoria),
      recorrencia: recorrencia && rotulo(recorrencia) !== rotulo(d.recorrencia),
      status: status && rotulo(status) !== rotulo(d.status),
    };
    if (!Object.values(mudou).some(Boolean)) return cancelar();

    // Classificação (nome, tipo, categoria, recorrência): todos os lançamentos da mesma despesa.
    // Valor: este e os seguintes (reajuste). Status: só este.
    const despesas = ctxTabela.app.estado.dados.despesas;
    const todos = so ? [d] : mesmaDespesa(despesas, d);
    const seguintes = so ? [d] : lancamentosSeguintes(despesas, d);
    const porLinha = new Map();
    const campos = (x) => {
      if (!porLinha.has(x)) porLinha.set(x, {});
      return porLinha.get(x);
    };
    for (const x of todos) {
      const novoNome = x === d && !RX_PARCELA.test(d.nome) ? nome : nomeDaParcela(nome, x);
      if (mudou.nome && novoNome !== x.nome) campos(x).NOME_DESPESA = novoNome;
      if (mudou.tipo && tipo !== x.tipo) campos(x).TIPO = tipo;
      if (mudou.categoria && rotulo(categoria) !== rotulo(x.categoria)) campos(x).CATEGORIA = categoria;
      if (mudou.recorrencia && recorrencia !== x.recorrencia) campos(x).RECORRENCIA = recorrencia;
    }
    if (mudou.valor) for (const x of seguintes) if (Math.abs(x.valor - valor) > 0.004) campos(x).VALOR = valor;
    if (mudou.status) campos(d).STATUS = status;
    const alteracoes = [...porLinha].filter(([, c]) => Object.keys(c).length);
    if (!alteracoes.length) return cancelar();

    const botao = $('#edit-salvar', el);
    botao.disabled = true;
    botao.textContent = 'Salvando…';
    try {
      const r = await enviar('status', { alteracoes: alteracoes.map(([x, c]) => ({ aba: 'despesas', linha: x._linha, nome: x.nome, campos: c })) });
      if (r.erros?.length && !r.alteradas) throw new Error(r.erros[0]);
      if (r.erros?.length) toast(`Alguns lançamentos não foram atualizados: ${r.erros[0]}`, 'erro', 8000);
      if (!so && (mudou.nome || mudou.tipo || mudou.categoria || mudou.recorrencia)) {
        await ensinar(d, { nome: nome || d.nome, tipo: tipo || d.tipo, categoria: categoria || d.categoria, recorrencia: recorrencia || d.recorrencia });
      }
      for (const [x, c] of alteracoes) {
        Object.assign(x, {
          nome: c.NOME_DESPESA || x.nome,
          tipo: c.TIPO || x.tipo,
          valor: c.VALOR ?? x.valor,
          categoria: c.CATEGORIA || x.categoria,
          recorrencia: c.RECORRENCIA || x.recorrencia,
          status: c.STATUS || x.status,
        });
      }
      editando = null;
      toast(alteracoes.length > 1 ? `${alteracoes.length} lançamentos atualizados na planilha` : 'Despesa atualizada na planilha');
      ctxTabela.app.recarregar();
    } catch (err) {
      toast(err.message, 'erro', 6000);
      botao.disabled = false;
      botao.textContent = 'Salvar';
    }
  };
  $('#edit-salvar', el).addEventListener('click', salvar);
  $('#edit-cancelar', el).addEventListener('click', cancelar);
  for (const campo of $$('.edicao input:not([type=checkbox])', el)) {
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') salvar();
      if (e.key === 'Escape') cancelar();
    });
  }
}

// Despesa importada (fora de marketplace): a classificação passa a valer nas próximas importações
async function ensinar(d, mudancas) {
  if (!d.descOriginal) return;
  const chave = chaveDescricao(d.descOriginal);
  if (!chave || ehMarketplace(chave)) return;
  const atual = ctxTabela.app.estado.dados.regras.find((r) => r.chave === chave);
  const base = atual || { chave, destino: 'DESPESA', nome: d.nome, tipo: d.tipo, categoria: d.categoria, recorrencia: d.recorrencia, titular: '', perguntar: false, usos: 1 };
  const regra = { ...base, ...mudancas };
  regra.nome = String(regra.nome || '').replace(RX_PARCELA, '').trim();
  await enviar('regras', { regras: [regraParaLinha(regra)] });
}

function statusBadge(status) {
  const s = rotulo(status);
  if (s === 'PAGO') return '<span class="badge badge-good">✓ Pago</span>';
  if (s === 'A PAGAR') return '<span class="badge badge-warn">● A pagar</span>';
  return s ? `<span class="badge">${escapeHtml(status)}</span>` : '';
}
