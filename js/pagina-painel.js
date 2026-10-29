// Tela principal: visão do mês.

import { moeda, pct, nomeMes, somarMeses, MESES, escapeHtml, rotulo, mesAtual, RX_PARCELA } from './util.js';
import { totaisMes, serieMeses, porTipo, fixoVariavel, contasAPagar, parcelamentos, maioresGastos, qualidade, tipoDe, parcelasDaMesmaCompra, nomeDaParcela } from './analise.js';
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
const ordem = {
  despesas: { col: 'data', dir: -1 },
  receitas: { col: 'valor', dir: -1 },
  parcelas: { col: 'restante', dir: -1 },
};

export function renderPainel(raiz, app) {
  const { dados, mes, filtroTipo } = app.estado;
  if (!dados) {
    raiz.innerHTML = '<div class="vazio">Carregando dados…</div>';
    return;
  }

  const t = totaisMes(dados, mes, filtroTipo);
  const ant = totaisMes(dados, somarMeses(mes, -1), filtroTipo);
  const problemas = qualidade(dados);
  const aPagar = contasAPagar(dados, mes);

  const semTipo = problemas.find((p) => p.semTipo)?.semTipo || [];
  raiz.innerHTML = `
    ${avisos(app, problemas)}
    ${classificandoSemTipo && semTipo.length ? painelSemTipo(semTipo, dados) : ''}
    <div class="cabecalho-pagina">
      <div class="seletor-mes">
        <button class="btn btn-ghost btn-icone" data-mes="-1" aria-label="Mês anterior">‹</button>
        <h1>${nomeMes(mes)}</h1>
        <button class="btn btn-ghost btn-icone" data-mes="1" aria-label="Próximo mês">›</button>
        ${mes !== mesAtual() ? '<button class="btn btn-sm btn-ghost" data-mes="hoje">Hoje</button>' : ''}
      </div>
      ${filtroTipo ? `<button class="filtro-chip" id="limpar-filtro">Tipo: ${escapeHtml(filtroTipo)} <span aria-hidden="true">×</span></button>` : ''}
    </div>

    <section class="kpis">
      ${kpi('Receitas', COR_R, t.receita, ant.receita, `${t.qtdReceitas} lançamento(s)`, true)}
      ${kpi('Despesas', COR_D, t.despesa, ant.despesa, `${t.qtdDespesas} lançamento(s)`, false)}
      ${kpiSaldo(t)}
      ${kpiPoupanca(t, ant)}
    </section>

    <section class="grade">
      <div class="card c-12">
        <div class="card-titulo">
          <h2>Últimos 12 meses</h2>
          ${legenda([[COR_R, 'Receitas'], [COR_D, filtroTipo ? `Despesas · ${filtroTipo}` : 'Despesas']])}
        </div>
        <div id="g-evolucao"></div>
      </div>
    </section>

    <section class="grade">
      <div class="card c-7">
        <div class="card-titulo">
          <h2>Despesas por tipo</h2>
          ${legenda([[COR_D, 'Este mês'], ['tick', 'Média 6 meses']])}
        </div>
        <div id="por-tipo"></div>
      </div>
      <div class="c-5" style="display:grid;gap:12px;align-content:start">
        <div class="card">
          <div class="card-titulo"><h2>Contas a pagar</h2><span class="sub">${aPagar.length ? moeda(aPagar.reduce((s, d) => s + d.valor, 0)) : ''}</span></div>
          <div id="a-pagar"></div>
        </div>
        <div class="card" id="fixo-variavel"></div>
      </div>
    </section>

    <section class="grade">
      <div class="card c-7" id="parcelamentos"></div>
      <div class="card c-5">
        <div class="card-titulo"><h2>Maiores gastos do mês</h2></div>
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

  // Navegação
  for (const b of $$('[data-mes]', raiz)) {
    b.addEventListener('click', () => app.irParaMes(b.dataset.mes === 'hoje' ? mesAtual() : somarMeses(mes, +b.dataset.mes)));
  }
  $('#limpar-filtro', raiz)?.addEventListener('click', () => app.filtrarTipo(null));

  // Evolução
  const serie = serieMeses(dados, mes, 12, filtroTipo);
  responsivo($('#g-evolucao', raiz), () =>
    graficoColunas($('#g-evolucao', raiz), {
      rotulos: serie.map((s) => MESES[+s.mes.slice(5) - 1] + (s.mes.endsWith('-01') ? ` ${s.mes.slice(2, 4)}` : '')),
      series: [
        { nome: 'Receitas', cor: COR_R, valores: serie.map((s) => s.receita) },
        { nome: 'Despesas', cor: COR_D, valores: serie.map((s) => s.despesa) },
      ],
      selecionado: serie.length - 1,
      onClick: (i) => app.irParaMes(serie[i].mes),
      tooltip: (i) => {
        const s = serie[i];
        return `<div class="t-titulo">${nomeMes(s.mes)}</div>${linhaTooltip(COR_R, 'Receitas', moeda(s.receita))}${linhaTooltip(COR_D, 'Despesas', moeda(s.despesa))}<div class="t-sep"></div>${linhaTooltip('', 'Saldo', `<span class="${s.saldo >= 0 ? 'pos' : 'neg'}">${s.saldo >= 0 ? '+' : ''}${moeda(s.saldo)}</span>`)}`;
      },
    })
  );

  renderPorTipo($('#por-tipo', raiz), dados, mes, filtroTipo, app);
  renderAPagar($('#a-pagar', raiz), aPagar, mes, app);
  renderFixoVariavel($('#fixo-variavel', raiz), totaisMes(dados, mes).despesas);
  renderParcelamentos($('#parcelamentos', raiz), dados, mes);
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
  if (!anterior) return '<span class="muted">sem dados no mês anterior</span>';
  const d = (atual - anterior) / Math.abs(anterior);
  const subiu = d >= 0;
  const bom = subiu === subirEhBom;
  return `<b class="${Math.abs(d) < 0.005 ? '' : bom ? 'pos' : 'neg'}">${subiu ? '▲' : '▼'} ${pct(Math.abs(d))}</b> vs mês anterior`;
}

function kpi(rotuloKpi, cor, valor, anterior, info, subirEhBom) {
  return `<div class="card kpi">
    <div class="rotulo"><i class="swatch" style="background:${cor}"></i>${rotuloKpi}</div>
    <div class="valor">${moeda(valor)}</div>
    <div class="delta">${delta(valor, anterior, subirEhBom)}</div>
    <div class="delta">${info}</div>
  </div>`;
}

function kpiSaldo(t) {
  if (!t.qtdReceitas && !t.qtdDespesas) {
    return '<div class="card kpi"><div class="rotulo">Saldo do mês</div><div class="valor muted">—</div><div class="delta">mês ainda sem lançamentos</div></div>';
  }
  const positivo = t.saldo >= 0;
  return `<div class="card kpi">
    <div class="rotulo">Saldo do mês</div>
    <div class="valor ${positivo ? 'pos' : 'neg'}">${positivo ? '' : '−'}${moeda(Math.abs(t.saldo))}</div>
    <div class="delta">${positivo ? '<span class="badge badge-good">✓ Sobrou dinheiro</span>' : '<span class="badge badge-crit">! Gastou mais que recebeu</span>'}</div>
  </div>`;
}

function kpiPoupanca(t, ant) {
  const v = t.poupanca;
  const va = ant.poupanca;
  let comp = '<span class="muted">—</span>';
  if (v !== null && va !== null) {
    const dif = (v - va) * 100;
    comp = `<b class="${dif >= 0 ? 'pos' : 'neg'}">${dif >= 0 ? '▲' : '▼'} ${Math.abs(dif).toFixed(0)} p.p.</b> vs mês anterior`;
  }
  return `<div class="card kpi">
    <div class="rotulo">Taxa de poupança</div>
    <div class="valor">${v === null ? '—' : pct(v)}</div>
    <div class="delta">${comp}</div>
    <div class="delta">da receita que sobrou</div>
  </div>`;
}

function renderPorTipo(el, dados, mes, filtroTipo, app) {
  const tipos = porTipo(dados, mes);
  if (!tipos.length) {
    el.innerHTML = '<div class="vazio">Nenhuma despesa neste mês.</div>';
    return;
  }
  const max = Math.max(...tipos.map((t) => Math.max(t.valor, t.media)));
  el.innerHTML = `<div class="barras">${tipos
    .map((t) => {
      const dif = t.media ? (t.valor - t.media) / t.media : null;
      const difTxt = dif === null ? 'novo' : `${dif >= 0 ? '+' : '−'}${pct(Math.abs(dif))}`;
      return `<button class="barra-linha ${filtroTipo && filtroTipo !== t.tipo ? 'apagada' : ''}" data-tipo="${escapeHtml(t.tipo)}">
        <span class="nome">${escapeHtml(t.tipo)}</span>
        <span class="barra-trilho">
          <span class="barra-fill" style="width:${(Math.max(0, t.valor) / max) * 100}%"></span>
          ${t.media ? `<span class="barra-media" style="left:calc(${(t.media / max) * 100}% - 1px)"></span>` : ''}
        </span>
        <span class="valores num">${moeda(t.valor)}<span class="muted">${difTxt}</span></span>
      </button>`;
    })
    .join('')}</div>`;
  for (const b of $$('.barra-linha', el)) {
    const t = tipos.find((x) => x.tipo === b.dataset.tipo);
    b.addEventListener('click', () => app.filtrarTipo(filtroTipo === t.tipo ? null : t.tipo));
    b.addEventListener('mousemove', (e) =>
      mostrarTooltip(e, `<div class="t-titulo">${escapeHtml(t.tipo)}</div>${linhaTooltip(COR_D, 'Este mês', moeda(t.valor))}${linhaTooltip('', 'Média 6 meses', moeda(t.media))}<div class="t-sep"></div><div class="small muted">Clique para filtrar</div>`)
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

function renderFixoVariavel(el, despesas) {
  const { fixo, variavel } = fixoVariavel(despesas);
  const total = fixo + variavel;
  if (total <= 0) {
    el.innerHTML = '<div class="card-titulo"><h2>Fixo × variável</h2></div><div class="vazio" style="padding:8px 0">Sem despesas no mês.</div>';
    return;
  }
  el.innerHTML = `<div class="card-titulo"><h2>Fixo × variável</h2></div>
    <div class="split"><div style="flex:${fixo};background:var(--receita)"></div><div style="flex:${variavel};background:var(--neutro)"></div></div>
    <div class="legenda" style="justify-content:space-between">
      <span><i class="swatch" style="background:var(--receita)"></i>Fixo <b class="num">${moeda(fixo)}</b> <span class="muted">${pct(fixo / total)}</span></span>
      <span><i class="swatch" style="background:var(--neutro)"></i>Variável <b class="num">${moeda(variavel)}</b> <span class="muted">${pct(variavel / total)}</span></span>
    </div>`;
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
      ${ordenar(p.ativos, ordem.parcelas, VALOR_PARCELA).map((a) => `<tr><td>${escapeHtml(a.nome)}<span class="desc-original">${escapeHtml(a.tipo)}</span></td><td class="tab">${a.k}/${a.n}</td><td class="num">${moeda(a.valor)}</td><td class="num">${moeda(a.restante)}</td><td>${nomeMes(a.termina, false)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum parcelamento ativo.</td></tr>'}
      </tbody></table>`;
    ligarOrdenacao(alvo, COLS_PARCELAS, ordem.parcelas, desenharParcelas);
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
        .map((d) => `<div class="lista-item"><div class="principal"><div>${escapeHtml(d.nome)}</div><div class="small">${escapeHtml(tipoDe(d))} · ${escapeHtml(d.forma)}</div></div><div class="valor num">${moeda(d.valor)}</div></div>`)
        .join('')}</div>`
    : '<div class="vazio">Sem despesas no mês.</div>';
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
}

// Listas de seleção na tabela (status e categoria): gravam na planilha ao escolher
const SELETORES = {
  status: {
    coluna: 'STATUS',
    opcoes: [['PAGO', 'Pago', 'pago'], ['A PAGAR', 'A pagar', 'a-pagar']],
    aviso: (d, v) => `“${d.nome}” marcada como ${v === 'PAGO' ? 'paga' : 'a pagar'}`,
  },
  categoria: {
    coluna: 'CATEGORIA',
    opcoes: [['FIXO', 'Fixo', 'fixo'], ['VARIÁVEL', 'Variável', '']],
    aviso: (d, v) => `“${d.nome}” agora é ${v === 'FIXO' ? 'fixa' : 'variável'}`,
  },
};

function seletor(campo, d) {
  const { opcoes } = SELETORES[campo];
  const atual = rotulo(d[campo]);
  const lista = opcoes.some(([v]) => rotulo(v) === atual) || !atual ? opcoes : [...opcoes, [d[campo], d[campo], '']];
  const escolhida = lista.find(([v]) => rotulo(v) === atual);
  return `<select class="status-sel ${escolhida?.[2] || ''}" data-sel-campo="${campo}" data-sel-linha="${d._linha}" aria-label="${campo === 'status' ? 'Status' : 'Categoria'} de ${escapeHtml(d.nome)}">
    ${atual ? '' : '<option value="" selected>—</option>'}${lista.map(([v, r]) => `<option value="${escapeHtml(v)}" ${escolhida && v === escolhida[0] ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}</select>`;
}

function ligarSeletores(el, linhas) {
  for (const s of $$('[data-sel-campo]', el)) {
    s.addEventListener('change', async () => {
      const campo = s.dataset.selCampo;
      const { coluna, aviso } = SELETORES[campo];
      const d = linhas.find((x) => x._linha === +s.dataset.selLinha);
      const anterior = d[campo];
      const novo = s.value;
      if (!novo || rotulo(novo) === rotulo(anterior)) return;
      s.disabled = true;
      try {
        const r = await enviar('status', { alteracoes: [{ aba: 'despesas', linha: d._linha, nome: d.nome, campos: { [coluna]: novo } }] });
        if (r.erros?.length) throw new Error(r.erros[0]);
        d[campo] = novo;
        toast(aviso(d, novo));
        ctxTabela.app.renderizar(); // atualiza também os quadros (contas a pagar, fixo × variável)
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
  const categoria = editavel ? seletor('categoria', d) : escapeHtml(rotulo(d.categoria) === 'FIXO' ? 'Fixo' : d.categoria ? 'Variável' : '');
  return `<tr><td class="tab">${escapeHtml(d.vencimento)}</td><td>${escapeHtml(d.nome)}${desc}</td>
    <td>${escapeHtml(tipoDe(d))}</td><td class="opc">${categoria}</td><td class="text-2 opc">${escapeHtml(d.forma)}</td><td class="tab opc">${escapeHtml(d.parcelas && d.parcelas !== '1/1' ? d.parcelas : '')}</td>
    <td class="opc">${editavel ? seletor('status', d) : statusBadge(d.status)}</td><td class="num">${moeda(d.valor)}</td>
    ${editavel ? `<td class="acao-linha"><button class="btn btn-ghost btn-icone btn-sm" data-editar="${d._linha}" aria-label="Editar ${escapeHtml(d.nome)}" title="Renomear / mudar tipo">✎</button></td>` : ''}</tr>`;
}

function linhaEmEdicao(d) {
  const tipos = ctxTabela.tipos;
  const outras = parcelasDaMesmaCompra(ctxTabela.app.estado.dados.despesas, d).length - 1;
  const aviso = outras > 0 ? `<span class="desc-original" style="color:var(--accent)">Também atualiza as outras ${outras} parcela(s) desta compra</span>` : '';
  return `<tr class="editando"><td class="tab">${escapeHtml(d.vencimento)}</td>
    <td><input class="input input-sm" id="edit-nome" value="${escapeHtml(d.nome)}" aria-label="Nome da despesa">${d.descOriginal ? `<span class="desc-original">No banco: ${escapeHtml(d.descOriginal)}</span>` : ''}${aviso}</td>
    <td><select class="select select-sm" id="edit-tipo" aria-label="Tipo">${!d.tipo ? '<option value="">Escolha…</option>' : ''}${tipos.map((x) => `<option ${x === d.tipo ? 'selected' : ''}>${escapeHtml(x)}</option>`).join('')}</select></td>
    <td class="text-2 opc">${escapeHtml(rotulo(d.categoria) === 'FIXO' ? 'Fixo' : 'Variável')}</td><td class="text-2 opc">${escapeHtml(d.forma)}</td><td class="tab opc">${escapeHtml(d.parcelas && d.parcelas !== '1/1' ? d.parcelas : '')}</td><td class="opc">${statusBadge(d.status)}</td>
    <td class="num">${moeda(d.valor)}</td>
    <td class="acao-linha"><button class="btn btn-primario btn-sm" id="edit-salvar">Salvar</button> <button class="btn btn-ghost btn-sm" id="edit-cancelar" aria-label="Cancelar">✕</button></td></tr>`;
}

function ligarEdicao(el, t, linhas) {
  for (const b of $$('[data-editar]', el)) {
    b.addEventListener('click', () => {
      editando = +b.dataset.editar;
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
    // Parcelada: o novo nome/tipo vale para todas as parcelas da compra, cada uma com seu número
    const mudouNome = nome && nome !== d.nome;
    const mudouTipo = tipo && tipo !== d.tipo;
    if (!mudouNome && !mudouTipo) return cancelar();
    const parcelas = parcelasDaMesmaCompra(ctxTabela.app.estado.dados.despesas, d);
    const alteracoes = parcelas
      .map((x) => {
        const campos = {};
        const novoNome = x === d && !RX_PARCELA.test(d.nome) ? nome : nomeDaParcela(nome, x);
        if (mudouNome && novoNome !== x.nome) campos.NOME_DESPESA = novoNome;
        if (mudouTipo && tipo !== x.tipo) campos.TIPO = tipo;
        return { x, campos };
      })
      .filter(({ campos }) => Object.keys(campos).length);
    if (!alteracoes.length) return cancelar();
    const botao = $('#edit-salvar', el);
    botao.disabled = true;
    botao.textContent = 'Salvando…';
    try {
      const r = await enviar('status', { alteracoes: alteracoes.map(({ x, campos }) => ({ aba: 'despesas', linha: x._linha, nome: x.nome, campos })) });
      if (r.erros?.length && !r.alteradas) throw new Error(r.erros[0]);
      if (r.erros?.length) toast(`Algumas parcelas não foram atualizadas: ${r.erros[0]}`, 'erro', 8000);
      await ensinar(d, nome || d.nome, tipo || d.tipo);
      for (const { x, campos } of alteracoes) Object.assign(x, { nome: campos.NOME_DESPESA || x.nome, tipo: campos.TIPO || x.tipo });
      editando = null;
      toast(alteracoes.length > 1 ? `${alteracoes.length} parcelas atualizadas na planilha` : 'Despesa atualizada na planilha');
      ctxTabela.app.recarregar();
    } catch (err) {
      toast(err.message, 'erro', 6000);
      botao.disabled = false;
      botao.textContent = 'Salvar';
    }
  };
  $('#edit-salvar', el).addEventListener('click', salvar);
  $('#edit-cancelar', el).addEventListener('click', cancelar);
  $('#edit-nome', el).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') salvar();
    if (e.key === 'Escape') cancelar();
  });
}

// Despesa importada (fora de marketplace): o novo nome/tipo passa a valer nas próximas importações
async function ensinar(d, nome, tipo) {
  if (!d.descOriginal) return;
  const chave = chaveDescricao(d.descOriginal);
  if (!chave || ehMarketplace(chave)) return;
  const atual = ctxTabela.app.estado.dados.regras.find((r) => r.chave === chave);
  const base = atual || { chave, destino: 'DESPESA', categoria: d.categoria, titular: '', perguntar: false, usos: 1 };
  await enviar('regras', { regras: [regraParaLinha({ ...base, nome: nome.replace(RX_PARCELA, '').trim(), tipo })] });
}

function statusBadge(status) {
  const s = rotulo(status);
  if (s === 'PAGO') return '<span class="badge badge-good">✓ Pago</span>';
  if (s === 'A PAGAR') return '<span class="badge badge-warn">● A pagar</span>';
  return s ? `<span class="badge">${escapeHtml(status)}</span>` : '';
}
