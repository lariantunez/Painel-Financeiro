// Tela principal: visão do mês.

import { moeda, pct, nomeMes, somarMeses, MESES, escapeHtml, rotulo, parseData, mesAtual } from './util.js';
import { totaisMes, serieMeses, porTipo, fixoVariavel, contasAPagar, parcelamentos, maioresGastos, qualidade, tipoDe } from './analise.js';
import { graficoColunas, responsivo, legenda, linhaTooltip, mostrarTooltip, esconderTooltip, toast, $, $$ } from './ui.js';
import { backendConfigurado, enviar } from './api.js';
import { valoresUsados } from './model.js';

const COR_R = 'var(--receita)';
const COR_D = 'var(--despesa)';
let abaTabela = 'despesas';
let classificandoSemTipo = false;
let busca = '';

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
    <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Data</th><th>Descrição</th><th class="opc">Forma</th><th class="num">Valor</th><th>Tipo</th></tr></thead><tbody>
    ${lista
      .map(
        (d, i) => `<tr><td class="tab">${escapeHtml(d.vencimento)}</td><td>${escapeHtml(d.nome)}<span class="desc-original">linha ${d._linha} · ${nomeMes(d.mesRef, false)}</span></td>
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
      .filter((s) => s.value)
      .map((s) => ({ d: lista[+s.dataset.semTipo], tipo: s.value }));
    if (!escolhas.length) {
      toast('Escolha o tipo de pelo menos uma despesa', 'erro');
      return;
    }
    e.target.disabled = true;
    e.target.textContent = 'Salvando…';
    try {
      const r = await enviar('status', { alteracoes: escolhas.map(({ d, tipo }) => ({ aba: 'despesas', linha: d._linha, nome: d.nome, campos: { TIPO: tipo } })) });
      if (r.erros?.length) toast(r.erros[0], 'erro', 6000);
      if (r.alteradas) toast(`${r.alteradas} despesa(s) classificada(s)`);
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
    <details class="secao" style="margin-top:8px"><summary>Ver compras parceladas</summary>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Compra</th><th>Parcela</th><th class="num">Valor</th><th class="num">Falta pagar</th><th>Termina</th></tr></thead><tbody>
      ${p.ativos.map((a) => `<tr><td>${escapeHtml(a.nome)}<span class="desc-original">${escapeHtml(a.tipo)}</span></td><td class="num">${a.k}/${a.n}</td><td class="num">${moeda(a.valor)}</td><td class="num">${moeda(a.restante)}</td><td>${nomeMes(a.termina, false)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum parcelamento ativo.</td></tr>'}
      </tbody></table></div>
    </details>`;
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
  const ordenar = (a, b) => {
    const da = parseData(a.vencimento) || { ano: 0, mes: 0, dia: 0 };
    const db = parseData(b.vencimento) || { ano: 0, mes: 0, dia: 0 };
    return db.ano - da.ano || db.mes - da.mes || db.dia - da.dia;
  };
  if (abaTabela === 'despesas') {
    const linhas = t.despesas.filter((d) => filtra([d.nome, d.tipo, d.forma, d.instituicao])).sort(ordenar);
    el.innerHTML = linhas.length
      ? `<table class="tabela"><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th class="opc">Forma</th><th class="opc">Parcela</th><th class="opc">Status</th><th class="num">Valor</th></tr></thead><tbody>
        ${linhas
          .map(
            (d) => `<tr><td class="tab">${escapeHtml(d.vencimento)}</td><td>${escapeHtml(d.nome)}${rotulo(d.categoria) === 'FIXO' ? ' <span class="badge">fixo</span>' : ''}</td><td>${escapeHtml(tipoDe(d))}</td><td class="text-2 opc">${escapeHtml(d.forma)}</td><td class="tab opc">${escapeHtml(d.parcelas && d.parcelas !== '1/1' ? d.parcelas : '')}</td><td class="opc">${statusBadge(d.status)}</td><td class="num">${moeda(d.valor)}</td></tr>`
          )
          .join('')}</tbody></table>`
      : '<div class="vazio">Nenhuma despesa encontrada.</div>';
  } else {
    const linhas = t.receitas.filter((r) => filtra([r.nome, r.tipo, r.instituicao]));
    el.innerHTML = linhas.length
      ? `<table class="tabela"><thead><tr><th>Quem</th><th>Descrição</th><th class="opc">Instituição</th><th class="opc">Forma</th><th class="num">Valor</th></tr></thead><tbody>
        ${linhas.map((r) => `<tr><td>${escapeHtml(r.nome)}</td><td>${escapeHtml(r.tipo)}</td><td class="text-2 opc">${escapeHtml(r.instituicao)}</td><td class="text-2 opc">${escapeHtml(r.forma)}</td><td class="num">${moeda(r.valor)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="vazio">Nenhuma receita encontrada.</div>';
  }
}

function statusBadge(status) {
  const s = rotulo(status);
  if (s === 'PAGO') return '<span class="badge badge-good">✓ Pago</span>';
  if (s === 'A PAGAR') return '<span class="badge badge-warn">● A pagar</span>';
  return s ? `<span class="badge">${escapeHtml(status)}</span>` : '';
}
