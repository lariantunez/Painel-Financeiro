// Previsão: gastos já comprometidos nos próximos meses (contas mensais + parcelas) x receitas previstas.

import { previsao } from './analise.js';
import { moeda, nomeMes, MESES, escapeHtml, rotulo } from './util.js';
import { graficoColunas, responsivo, legenda, linhaTooltip, $, $$ } from './ui.js';

const COR_MENSAL = 'var(--despesa)';
const COR_PARCELA = 'var(--serie-3)';
const COR_RECEITA = 'var(--receita)';

let horizonte = 12;
let aberto = null; // mês com detalhes abertos

export function renderPrevisao(raiz, app) {
  const { dados } = app.estado;
  if (!dados) {
    raiz.innerHTML = '<div class="vazio">Carregando…</div>';
    return;
  }
  const p = previsao(dados, horizonte);
  const meses = p.meses;
  const primeiro = meses[0];
  const media = (campo) => meses.reduce((s, m) => s + m[campo], 0) / meses.length;
  const totalParcelas = meses.reduce((s, m) => s + m.parcelas, 0);
  const fimParcelas = [...meses].reverse().find((m) => m.parcelas > 0);

  raiz.innerHTML = `
    <div class="cabecalho-pagina">
      <h1 style="font-size:22px;margin:0">Previsão</h1>
      <div class="seg" role="group" aria-label="Horizonte">${[6, 12]
        .map((n) => `<button data-horizonte="${n}" class="${n === horizonte ? 'ativo' : ''}">Próximos ${n} meses</button>`)
        .join('')}</div>
    </div>
    <p class="text-2" style="margin-top:-8px">Quanto já está comprometido em cada mês: contas mensais (pelo último valor de cada uma) e parcelas que ainda faltam pagar. Gastos eventuais, como feira e restaurante, não entram — a média deles aparece abaixo como referência.</p>

    <section class="kpis">
      ${cartao(`Comprometido em ${nomeMes(primeiro.mes, false)}`, moeda(primeiro.total), `${moeda(primeiro.mensais)} contas · ${moeda(primeiro.parcelas)} parcelas`)}
      ${cartao('Média mensal comprometida', moeda(media('total')), `nos próximos ${horizonte} meses`)}
      ${cartao('Parcelas a vencer', moeda(totalParcelas), fimParcelas ? `última em ${nomeMes(fimParcelas.mes, false)}` : 'nenhuma parcela futura')}
      ${cartao('Sobra prevista por mês', moeda(media('saldo')), `${moeda(media('saldo') - p.mediaEventual)} depois dos eventuais (média ${moeda(p.mediaEventual)}/mês)`, media('saldo') >= 0)}
    </section>

    <section class="card" style="margin-bottom:12px">
      <div class="card-titulo">
        <h2>Compromissos × receitas previstas</h2>
        ${legenda([[COR_MENSAL, 'Contas mensais'], [COR_PARCELA, 'Parcelas'], [COR_RECEITA, 'Receitas previstas']])}
      </div>
      <div id="g-previsao"></div>
    </section>

    <section class="card">
      <div class="card-titulo"><h2>Mês a mês</h2><span class="sub">Clique num mês para ver o que compõe o valor</span></div>
      <div class="tabela-wrap"><table class="tabela tabela-previsao">
        <thead><tr><th>Mês</th><th class="num">Contas mensais</th><th class="num">Parcelas</th><th class="num">Total comprometido</th><th class="num opc">Receitas previstas</th><th class="num">Sobra prevista</th><th class="num opc">Depois dos eventuais</th></tr></thead>
        <tbody>${meses.map((m) => linhaMes(m, p.mediaEventual)).join('')}</tbody>
      </table></div>
    </section>`;

  for (const b of $$('[data-horizonte]', raiz)) {
    b.addEventListener('click', () => {
      horizonte = +b.dataset.horizonte;
      app.renderizar();
    });
  }
  for (const tr of $$('[data-mes-prev]', raiz)) {
    tr.addEventListener('click', () => {
      aberto = aberto === tr.dataset.mesPrev ? null : tr.dataset.mesPrev;
      app.renderizar();
    });
  }

  responsivo($('#g-previsao', raiz), () =>
    graficoColunas($('#g-previsao', raiz), {
      rotulos: meses.map((m) => MESES[+m.mes.slice(5) - 1] + (m.mes.endsWith('-01') ? ` ${m.mes.slice(2, 4)}` : '')),
      series: [
        { nome: 'Contas mensais', cor: COR_MENSAL, valores: meses.map((m) => m.mensais), pilha: 'gasto' },
        { nome: 'Parcelas', cor: COR_PARCELA, valores: meses.map((m) => m.parcelas), pilha: 'gasto' },
        { nome: 'Receitas previstas', cor: COR_RECEITA, valores: meses.map((m) => m.receita) },
      ],
      selecionado: meses.findIndex((m) => m.mes === aberto),
      onClick: (i) => {
        aberto = aberto === meses[i].mes ? null : meses[i].mes;
        app.renderizar();
      },
      tooltip: (i) => {
        const m = meses[i];
        return `<div class="t-titulo">${nomeMes(m.mes)}</div>${linhaTooltip(COR_MENSAL, 'Contas mensais', moeda(m.mensais))}${linhaTooltip(COR_PARCELA, 'Parcelas', moeda(m.parcelas))}${linhaTooltip('', 'Total comprometido', moeda(m.total))}<div class="t-sep"></div>${linhaTooltip(COR_RECEITA, 'Receitas previstas', moeda(m.receita))}${linhaTooltip('', 'Sobra prevista', `<span class="${m.saldo >= 0 ? 'pos' : 'neg'}">${moeda(m.saldo)}</span>`)}`;
      },
    })
  );
}

function cartao(rotuloCartao, valor, info, positivo) {
  const cor = positivo === undefined ? '' : positivo ? 'pos' : 'neg';
  return `<div class="card kpi"><div class="rotulo">${escapeHtml(rotuloCartao)}</div><div class="valor ${cor}">${valor}</div><div class="delta">${escapeHtml(info)}</div></div>`;
}

function linhaMes(m, mediaEventual) {
  const depois = m.saldo - mediaEventual;
  const linha = `<tr class="linha-mes ${aberto === m.mes ? 'aberta' : ''}" data-mes-prev="${m.mes}" tabindex="0">
    <td><span class="seta-det">${aberto === m.mes ? '▾' : '▸'}</span> ${nomeMes(m.mes)}</td>
    <td class="num">${moeda(m.mensais)}</td><td class="num">${moeda(m.parcelas)}</td><td class="num"><b>${moeda(m.total)}</b></td>
    <td class="num opc">${moeda(m.receita)}</td>
    <td class="num ${m.saldo >= 0 ? 'pos' : 'neg'}">${moeda(m.saldo)}</td>
    <td class="num opc ${depois >= 0 ? 'pos' : 'neg'}">${moeda(depois)}</td></tr>`;
  if (aberto !== m.mes) return linha;
  const grupo = (g, titulo) => {
    const itens = m.itens.filter((i) => i.grupo === g);
    if (!itens.length) return '';
    return `<div class="det-grupo"><div class="det-titulo">${titulo} <span class="muted">${moeda(itens.reduce((s, i) => s + i.valor, 0))}</span></div>
      ${itens.map((i) => `<div class="det-item"><span>${escapeHtml(i.nome)}<span class="muted small"> · ${escapeHtml(i.tipo || '')}</span></span><span>${origem(i)} <b class="num">${moeda(i.valor)}</b></span></div>`).join('')}</div>`;
  };
  const receitas = m.receitas.length
    ? `<div class="det-grupo"><div class="det-titulo">Receitas previstas <span class="muted">${moeda(m.receita)}</span></div>
      ${m.receitas.map((r) => `<div class="det-item"><span>${escapeHtml(r.nome)}<span class="muted small"> · ${escapeHtml(r.quem || '')}</span></span><span>${origem(r)} <b class="num">${moeda(r.valor)}</b></span></div>`).join('')}</div>`
    : '';
  return `${linha}<tr class="detalhe-mes"><td colspan="7"><div class="det-grade">${grupo('mensal', 'Contas mensais')}${grupo('parcela', 'Parcelas')}${receitas}</div></td></tr>`;
}

function origem(i) {
  if (i.origem === 'previsto') return '<span class="badge">previsto</span>';
  return rotulo(i.status) === 'A PAGAR' ? '<span class="badge badge-warn">a pagar</span>' : '<span class="badge badge-good">lançado</span>';
}
