// Análise: diagnóstico das finanças, pontos críticos, oportunidades, cenários e investimentos.
// Tudo recalculado dos lançamentos a cada visita; os parâmetros (reserva, taxas, perfil) ficam neste navegador.

import { analisarFinancas, cenario, planoReserva, valorFuturo, taxaReal, PERFIS, NECESSIDADES_PADRAO, PESSOAS } from './financas.js';
import { coresDosTipos } from './analise.js';
import { config, salvarConfig } from './api.js';
import { moeda, moedaCompacta, pct, nomeMes, MESES, escapeHtml, rotulo, parseValor } from './util.js';
import { responsivo, legenda, linhaTooltip, graficoColunas, $, $$ } from './ui.js';
import { linhasSuaves } from './graficos.js';

const PADRAO = { meses: 12, reserva: null, taxa: 0.12, inflacao: 0.045, corte: 0.1, aumento: 0, quitacoes: true, perfil: 'moderado', prazo: 10, necessidades: null, escolhas: {} };
// Oportunidade entra no cenário se marcada; as que são decisões grandes (vender um veículo) começam desmarcadas
const estaMarcada = (o, p) => !o.semValor && (p.escolhas[o.titulo] ?? !o.cenario);
const par = () => ({ ...PADRAO, ...(config.analise || {}) });
const guardar = (parcial) => salvarConfig({ analise: { ...par(), ...parcial } });

const COR_NADA = 'var(--despesa)';
const COR_OPORT = 'var(--serie-b)';
const COR_PLANO = 'var(--serie-3)';
const COR_NEC = 'var(--cat-1)';
const COR_ESTILO = 'var(--cat-2)';
const COR_SOBRA = 'var(--serie-3)';
const capital = (t) => String(t || '').toLowerCase().replace(/(^|[\s/])\p{L}/gu, (c) => c.toUpperCase());
// Renda por pessoa: as mesmas cores do gráfico de receitas do Painel
const SERIES_RENDA = [
  ...PESSOAS.map((p, i) => ({ nome: capital(p), cor: i === 0 ? 'var(--receita)' : 'var(--serie-b)', media: (a) => a.salarioPessoa[p], doMes: (m) => m.salarios[p] })),
  { nome: 'Outras', cor: 'var(--serie-3)', media: (a) => a.outrasRendas, doMes: (m) => Math.max(0, m.renda - PESSOAS.reduce((s, p) => s + m.salarios[p], 0)) },
];
const NIVEL = { critico: ['badge-crit', '● Crítico'], atencao: ['badge-warn', '▲ Atenção'], bom: ['badge-good', '✓ Bom'] };

const mesCurto = (m) => `${MESES[+m.slice(5) - 1]}/${m.slice(2, 4)}`;
const moedaInt = (v) => moeda(Math.round(v)).replace(/,00$/, '');
// Valor digitado: "20.000" é vinte mil (ponto de milhar), não vinte
const lerReais = (texto) => {
  const t = String(texto).replace(/[R$\s]/g, '');
  return /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? +t.replace(/\./g, '').replace(',', '.') : parseValor(t);
};

export function renderAnalise(raiz, app) {
  const { dados } = app.estado;
  if (!dados) {
    raiz.innerHTML = '<div class="vazio">Carregando…</div>';
    return;
  }
  const p = par();
  const a = analisarFinancas(dados, { meses: p.meses, reserva: p.reserva, taxaAnual: p.taxa, inflacao: p.inflacao, necessidades: p.necessidades || NECESSIDADES_PADRAO });
  if (!a.tipos.length) {
    raiz.innerHTML = '<div class="vazio">Ainda não há lançamentos suficientes para a análise.</div>';
    return;
  }
  const paleta = coresDosTipos(dados.despesas.filter((d) => a.periodo.includes(d.mesRef)), dados.despesas);
  const corTipo = (t) => paleta.cores.get(t) || paleta.corOutros;
  const marcadas = a.oportunidades.filter((o) => estaMarcada(o, p));
  const somaOport = marcadas.reduce((s, o) => s + o.mensal, 0);

  raiz.innerHTML = `
    <div class="cabecalho-pagina">
      <div><h1 style="font-size:22px;margin:0">Análise financeira</h1>
        <div class="small text-2" style="margin-top:4px">${nomeMes(a.periodo[0])} a ${nomeMes(a.periodo.at(-1))} · só meses fechados · recalculada a cada importação</div></div>
      <div class="seg" role="group" aria-label="Período">${[6, 12].map((n) => `<button data-janela="${n}" class="${n === p.meses ? 'ativo' : ''}">Últimos ${n} meses</button>`).join('')}</div>
    </div>

    <section class="grade">
      <div class="card c-5">${blocoNota(a)}</div>
      <div class="card c-7">
        <div class="card-titulo"><h2>Números do período</h2><span class="sub">médias por mês</span></div>
        <div class="an-numeros">
          ${numero('Renda', moedaInt(a.m.renda), 'salários e outras entradas, sem reembolsos')}
          ${numero('Gastos', moedaInt(a.m.gasto), `${moedaInt(a.m.despesas)} lançados − ${moedaInt(a.m.reembolsos)} reembolsados`)}
          ${numero('Resultado', `<span class="${a.m.saldo >= 0 ? 'pos' : 'neg'}">${a.m.saldo >= 0 ? '+' : ''}${moedaInt(a.m.saldo)}</span>`, `${a.mesesNegativos} de ${a.k} meses no vermelho`)}
          ${numero('Taxa de poupança', `<span class="${a.poupanca >= 0.1 ? 'pos' : a.poupanca < 0 ? 'neg' : ''}">${pct(a.poupanca)}</span>`, 'do que entra · referência: 10% a 20%')}
          ${numero('Dívidas', pct(a.pctRenda(a.m.dividas)), `${moedaInt(a.m.dividas)} em financiamentos e parcelas · até 30%`)}
          ${numero('Custo essencial', moedaInt(a.custoEssencial), 'necessidades: base da reserva de emergência')}
        </div>
        ${
          a.equilibrio
            ? `<div class="an-equilibrio"><b>Para a conta fechar no zero faltam ${moedaInt(a.equilibrio.falta)} por mês.</b>
                Isso equivale a cortar ${pct(a.equilibrio.pctVariaveis)} dos gastos que não são fixos, ou a aumentar a renda em ${pct(a.equilibrio.pctRenda)}.
                As oportunidades marcadas abaixo somam <b>${moedaInt(somaOport)}/mês</b>${somaOport >= a.equilibrio.falta ? ' — o suficiente para equilibrar.' : ` — cobrem ${pct(somaOport / a.equilibrio.falta)} do que falta.`}</div>`
            : ''
        }
      </div>
    </section>

    <section class="card" style="margin-bottom:12px">
      <div class="card-titulo"><h2>Pontos críticos</h2><span class="sub">do mais grave para o mais tranquilo</span></div>
      <div class="an-alertas">${a.alertas.map(alerta).join('')}</div>
    </section>

    <section class="grade">
      <div class="card c-7">
        <div class="card-titulo"><h2>Para onde vai o dinheiro</h2><span class="sub">${a.pareto} de ${a.tipos.length} tipos somam 80% dos gastos · clique para ver no painel</span></div>
        <div class="an-pareto">${a.tipos.map((t, i) => linhaPareto(t, i, a, corTipo)).join('')}</div>
      </div>
      <div class="card c-5">
        <div class="card-titulo"><h2>Necessidades × estilo de vida</h2><span class="sub">regra 50/30/20</span></div>
        ${bloco503020(a)}
        <div class="small text-2" style="margin:14px 0 6px">Toque num tipo para trocar de grupo:</div>
        <div class="an-chips">${a.tipos.map((t) => `<button class="an-chip ${t.necessidade ? 'nec' : 'est'}" data-grupo="${escapeHtml(t.tipo)}"><i class="swatch" style="background:${t.necessidade ? COR_NEC : COR_ESTILO}"></i>${escapeHtml(capital(t.tipo))}</button>`).join('')}</div>
      </div>
    </section>

    <section class="grade">
      <div class="card c-5">
        <div class="card-titulo"><h2>Maiores destinos</h2><span class="sub">no período</span></div>
        <div class="lista">${a.destinos
          .slice(0, 10)
          .map((d) => `<button class="lista-item lista-filtro" data-ir-despesa="${escapeHtml(d.chave)}" data-texto="${escapeHtml(d.nome)}"><div class="principal"><div>${escapeHtml(d.nome)}</div><div class="small">${escapeHtml(capital(d.tipo))} · ${d.mensal ? 'mensal' : `${d.vezes} lançamento(s)`}</div></div><div class="valor num">${moedaInt(d.total)}<div class="small muted">${moedaInt(d.total / a.k)}/mês</div></div></button>`)
          .join('')}</div>
      </div>
      <div class="card c-7">${blocoRenda(a)}</div>
    </section>

    <section class="card" style="margin-bottom:12px">
      <div class="card-titulo"><h2>Oportunidades de melhoria</h2><span class="sub">marcadas: <b class="num">${moedaInt(somaOport)}/mês</b> · ${moedaInt(somaOport * 12)}/ano</span></div>
      <div class="an-oport">${a.oportunidades.map((o) => linhaOportunidade(o, p)).join('')}</div>
      <div class="small muted" style="margin-top:10px">“Em 5 anos” = a economia investida todo mês, rendendo ${pct(taxaReal(p.taxa, p.inflacao), 1)} ao ano acima da inflação (em reais de hoje). Os itens marcados entram no cenário abaixo.</div>
    </section>

    <section class="card" style="margin-bottom:12px">
      <div class="card-titulo"><h2>Cenários · próximos 5 anos</h2>${legenda([[COR_NADA, 'Se nada mudar'], [COR_OPORT, 'Com as oportunidades'], [COR_PLANO, 'Oportunidades + ajustes']])}</div>
      <div class="an-controles">
        ${controle('corte', 'Corte extra nos gastos não fixos', p.corte, 0, 0.4, 0.01, pct)}
        ${controle('aumento', 'Aumento de renda', p.aumento, 0, 0.5, 0.01, pct)}
        ${controle('taxa', 'Rendimento ao ano', p.taxa, 0.04, 0.18, 0.005, (v) => pct(v, 1))}
        ${controle('inflacao', 'Inflação ao ano', p.inflacao, 0, 0.12, 0.005, (v) => pct(v, 1))}
        <label class="an-check"><input type="checkbox" id="an-quitacoes" ${p.quitacoes ? 'checked' : ''}> Somar o que sobra quando um financiamento termina${a.financiamentos.filter((f) => f.restantes <= 60).map((f) => ` (${escapeHtml(f.nome)}: ${mesCurto(f.termina)})`).join('')}</label>
      </div>
      <div id="g-cenarios"></div>
      <div id="an-cen-tabela"></div>
      <div class="small muted" style="margin-top:8px">Patrimônio = reserva informada + o que sobra (ou falta) a cada mês, rendendo a taxa real. Valores em reais de hoje. Abaixo de zero significa dívida — no cheque especial ou no rotativo o custo seria bem maior que o da simulação.</div>
    </section>

    <section class="grade">
      <div class="card c-5">${blocoReserva(a, p)}</div>
      <div class="card c-7">${blocoEstresse(a)}</div>
    </section>

    <section class="grade">
      <div class="card c-7">${blocoEtapas(a)}</div>
      <div class="card c-5">${blocoAlocacao(p)}</div>
    </section>

    <section class="card" style="margin-bottom:12px">${blocoSimulador(a, p, somaOport)}</section>

    <section class="card" style="margin-bottom:12px">
      <div class="card-titulo"><h2>Sazonalidade</h2><span class="sub">gasto por tipo em cada mês · clique para abrir no painel</span></div>
      <div class="tabela-wrap">${mapaCalor(a)}</div>
      <div class="small text-2" style="margin-top:8px">${mesesCaros(a)}</div>
    </section>

    <p class="small muted" style="line-height:1.6">Análise automática e educativa, feita a partir dos lançamentos da planilha. Não é recomendação individual de investimento nem substitui um planejador financeiro certificado. Taxas, inflação e alocações são parâmetros de referência: ajuste aos valores do momento.</p>`;

  ligar(raiz, app, a, p, somaOport);
}

// ───────────── Blocos ─────────────

function blocoNota(a) {
  const { nota, nivel, componentes } = a.nota;
  const r = 52;
  const c = 2 * Math.PI * r;
  const cor = nivel === 'bom' ? 'var(--good)' : nivel === 'atencao' ? 'var(--warning)' : 'var(--critical)';
  const [classe, texto] = NIVEL[nivel];
  return `<div class="card-titulo"><h2>Saúde financeira</h2><span class="badge ${classe}">${texto}</span></div>
    <div class="an-nota">
      <svg viewBox="0 0 130 130" class="an-nota-anel" role="img" aria-label="Nota ${nota} de 100">
        <circle cx="65" cy="65" r="${r}" fill="none" style="stroke:${cor};opacity:.18" stroke-width="12"/>
        <circle cx="65" cy="65" r="${r}" fill="none" style="stroke:${cor}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(nota / 100) * c} ${c}" transform="rotate(-90 65 65)"/>
        <text x="65" y="70" text-anchor="middle" class="an-nota-num">${nota}</text><text x="65" y="90" text-anchor="middle" class="an-nota-de">de 100</text>
      </svg>
      <div class="an-comp">${componentes
        .map((c) => `<div class="an-comp-linha" title="Ideal: ${escapeHtml(c.ideal)}"><span>${escapeHtml(c.nome)}</span><span class="an-comp-trilho"><i style="width:${Math.max(3, c.nota * 100)}%;background:${c.nota >= 0.75 ? 'var(--good)' : c.nota >= 0.4 ? 'var(--warning)' : 'var(--critical)'}"></i></span><b class="num">${Math.round(c.nota * c.peso)}/${c.peso}</b></div>`)
        .join('')}</div>
    </div>
    <div class="small muted" style="margin-top:8px">Sobra, dívidas, fixos, estabilidade da renda e reserva. Passe o mouse para ver a referência de cada um.</div>`;
}

const numero = (rot, valor, info) => `<div class="an-num"><div class="rotulo">${rot}</div><div class="valor num">${valor}</div><div class="small muted">${escapeHtml(info)}</div></div>`;

function alerta(x) {
  const [classe, texto] = NIVEL[x.nivel];
  const ir = x.tipo ? `data-ir-tipo="${escapeHtml(x.tipo)}" role="button" tabindex="0" title="Ver no painel"` : '';
  return `<div class="an-alerta ${x.nivel} ${x.tipo ? 'clicavel' : ''}" ${ir}><span class="badge ${classe}">${texto}</span><div><b>${escapeHtml(x.titulo)}</b><div class="text-2 small" style="margin-top:3px;line-height:1.55">${escapeHtml(x.texto)}</div></div></div>`;
}

function linhaPareto(t, i, a, corTipo) {
  const max = a.tipos[0].media;
  const corte = i === a.pareto - 1;
  return `<button class="an-pareto-linha ${i >= a.pareto ? 'cauda' : ''}" data-ir-tipo="${escapeHtml(t.tipo)}" title="${escapeHtml(t.tipo)}: ${moedaInt(t.total)} no período">
      <span class="nome"><i class="swatch" style="background:${corTipo(t.tipo)}"></i>${escapeHtml(capital(t.tipo))}</span>
      <span class="trilho"><i style="width:${(t.media / max) * 100}%;background:${corTipo(t.tipo)}"></i></span>
      <span class="num">${moedaInt(t.media)}<span class="muted">/mês</span></span>
      <span class="num muted">${pct(t.pct)} · ${pct(t.acumulado)}</span>
    </button>${corte ? '<div class="an-pareto-corte">80% dos gastos até aqui</div>' : ''}`;
}

function bloco503020(a) {
  const entradas = a.m.renda + a.m.reembolsos;
  const nec = a.m.necessidades / entradas;
  const est = a.m.estilo / entradas;
  const sobra = a.m.saldo / entradas;
  const total = Math.max(1, nec + est);
  const barra = (partes) => `<div class="an-barra">${partes.map(([v, cor, t]) => (v > 0 ? `<i style="width:${(v / total) * 100}%;background:${cor}" title="${escapeHtml(t)}"></i>` : '')).join('')}</div>`;
  return `<div class="an-5030">
      <div class="small text-2">Real (sobre ${moedaInt(entradas)}/mês que entram)</div>
      ${barra([[nec, COR_NEC, `Necessidades ${pct(nec)}`], [est, COR_ESTILO, `Estilo de vida ${pct(est)}`], [Math.max(0, sobra), COR_SOBRA, `Sobra ${pct(sobra)}`]])}
      ${total > 1 ? `<div class="an-estouro small">Os gastos passam ${pct(total - 1)} do que entra</div>` : ''}
      <div class="small text-2" style="margin-top:12px">Referência</div>
      ${barra([[0.5, COR_NEC, 'Necessidades 50%'], [0.3, COR_ESTILO, 'Estilo de vida 30%'], [0.2, COR_SOBRA, 'Poupança 20%']])}
      <div class="an-5030-legenda">
        <div><i class="swatch" style="background:${COR_NEC}"></i>Necessidades <b class="num">${pct(nec)}</b> <span class="muted">· ideal 50%</span></div>
        <div><i class="swatch" style="background:${COR_ESTILO}"></i>Estilo de vida <b class="num">${pct(est)}</b> <span class="muted">· ideal 30%</span></div>
        <div><i class="swatch" style="background:${COR_SOBRA}"></i>Poupança <b class="num ${sobra < 0 ? 'neg' : ''}">${pct(sobra)}</b> <span class="muted">· ideal 20%</span></div>
      </div>
    </div>`;
}

function blocoRenda(a) {
  const total = a.m.renda || 1;
  const partes = SERIES_RENDA.map((s) => [s.nome, s.media(a), s.cor]).filter(([, v]) => v > 0);
  const rendas = a.mensal.filter((m) => m.temDados).map((m) => m.renda);
  const menor = Math.min(...rendas);
  const maior = Math.max(...rendas);
  return `<div class="card-titulo"><h2>Renda</h2><span class="sub">de onde vem e quanto varia</span></div>
    <div class="an-barra alta">${partes.map(([n, v, cor]) => `<i style="width:${(v / total) * 100}%;background:${cor}" title="${n}: ${moedaInt(v)}/mês"></i>`).join('')}</div>
    <div class="an-5030-legenda" style="margin-bottom:14px">${partes.map(([n, v, cor]) => `<div><i class="swatch" style="background:${cor}"></i>${n} <b class="num">${moedaInt(v)}/mês</b> <span class="muted">· ${pct(v / total)}</span></div>`).join('')}</div>
    <div class="an-numeros tres">
      ${numero('Mês mais fraco', moedaInt(menor), 'planeje o mês por aqui')}
      ${numero('Mês mais forte', moedaInt(maior), 'o excedente vai para a reserva')}
      ${numero('Variação', pct(a.cvRenda), 'desvio em relação à média · ideal até 15%')}
    </div>
    <div id="an-g-renda" style="margin-top:14px"></div>
    <div class="small text-2" style="margin-top:10px;line-height:1.55">Reembolsos (${moedaInt(a.m.reembolsos)}/mês) não contam como renda: são abatidos dos gastos. Assim a taxa de poupança e o peso das dívidas não ficam inflados.</div>`;
}

function linhaOportunidade(o, p) {
  const marcada = estaMarcada(o, p);
  return `<div class="an-op ${marcada ? '' : 'desmarcada'}">
      ${o.semValor ? '<span class="an-op-check"></span>' : `<input type="checkbox" class="an-op-check" data-oport="${escapeHtml(o.titulo)}" ${marcada ? 'checked' : ''} aria-label="Incluir no cenário">`}
      <div class="an-op-texto"><b>${escapeHtml(o.titulo)}</b>${o.estimativa ? ' <span class="badge">estimativa</span>' : ''}${o.cenario ? ' <span class="badge badge-acc">decisão</span>' : ''}<div class="small text-2" style="margin-top:3px;line-height:1.55">${escapeHtml(o.texto)}</div></div>
      ${o.semValor ? '<div class="an-op-valores small muted">depende da taxa do contrato</div>' : `<div class="an-op-valores"><b class="num">${moedaInt(o.mensal)}/mês</b><span class="small muted num">${moedaInt(o.anual)}/ano</span><span class="small num">em 5 anos: <b>${moedaInt(o.cincoAnos)}</b></span></div>`}
    </div>`;
}

function controle(id, rot, valor, min, max, passo, fmt) {
  return `<label class="an-controle">${rot} <b id="an-v-${id}">${fmt(valor)}</b><input type="range" data-controle="${id}" min="${min}" max="${max}" step="${passo}" value="${valor}"></label>`;
}

function blocoReserva(a, p) {
  const plano = planoReserva(a, 12);
  const progresso = a.reserva != null && a.reservaAlvo ? Math.min(1, a.reserva / a.reservaAlvo) : 0;
  return `<div class="card-titulo"><h2>Reserva de emergência</h2><span class="sub">6 meses do custo essencial</span></div>
    <label class="campo">Quanto vocês têm guardado hoje (com resgate rápido)
      <input class="input" id="an-reserva" inputmode="decimal" placeholder="Ex.: 15.000" value="${a.reserva != null ? escapeHtml(a.reserva.toLocaleString('pt-BR')) : ''}"></label>
    <div class="an-progresso"><i style="width:${progresso * 100}%"></i></div>
    <div class="an-numeros tres" style="margin-top:12px">
      ${numero('Meta', moedaInt(a.reservaAlvo), `6 × ${moedaInt(a.custoEssencial)}`)}
      ${numero('Cobre hoje', a.mesesReserva != null ? `${a.mesesReserva.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mês(es)` : '—', 'do custo essencial')}
      ${numero('Para chegar em 12 meses', plano.falta > 0 ? `${moedaInt(plano.porMes)}/mês` : 'meta batida', plano.falta > 0 ? `faltam ${moedaInt(plano.falta)}` : 'mantenha e invista o resto')}
    </div>
    <div class="small text-2" style="margin-top:12px;line-height:1.6">Onde deixar: liquidez diária e baixo risco — Tesouro Selic, CDB de banco grande com 100% do CDI ou mais, ou a caixinha do Nubank. Nada de ações ou fundos com prazo de resgate longo.${a.temCnpj ? ' <b>Como há renda de CNPJ (DAS)</b>, que costuma variar mais, vale mirar em 9 a 12 meses.' : ''}</div>`;
}

function blocoEstresse(a) {
  const linhas = PESSOAS.filter((p) => a.salarioPessoa[p] > 0).map((p) => {
    const falta = Math.max(0, a.salarioPessoa[p] - a.m.saldo);
    const dura = a.reserva != null && falta > 0 ? a.reserva / falta : null;
    return `<tr><td>Se a renda de <b>${capital(p)}</b> parar</td><td class="num">${moedaInt(a.salarioPessoa[p])}/mês</td><td class="num neg">−${moedaInt(falta)}/mês</td><td class="num">${dura == null ? (a.reserva == null ? '<span class="muted">informe a reserva</span>' : '—') : `${dura.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mês(es)`}</td></tr>`;
  });
  const imprevisto = a.custoEssencial;
  return `<div class="card-titulo"><h2>Teste de estresse</h2><span class="sub">e se algo der errado?</span></div>
    <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Situação</th><th class="num">Renda perdida</th><th class="num">Faltaria</th><th class="num">A reserva aguenta</th></tr></thead>
      <tbody>${linhas.join('')}
        <tr><td>Imprevisto de 1 mês de custo essencial (saúde, carro, casa)</td><td class="num">—</td><td class="num neg">−${moedaInt(imprevisto)}</td><td class="num">${a.reserva == null ? '<span class="muted">informe a reserva</span>' : a.reserva >= imprevisto ? '<span class="pos">sim</span>' : '<span class="neg">não</span>'}</td></tr>
      </tbody></table></div>
    <div class="small text-2" style="margin-top:10px;line-height:1.55">Proteções que valem a pena olhar: seguro de vida para quem tem a maior renda (há financiamento de imóvel em nome de vocês — confira se o seguro habitacional já cobre), e plano de saúde ou reserva maior para saúde.</div>`;
}

function blocoEtapas(a) {
  const etapa = (n, titulo, status, texto) => {
    const [classe, rot] = NIVEL[status];
    return `<li class="an-etapa"><span class="an-etapa-n">${n}</span><div><div class="an-etapa-titulo"><b>${titulo}</b><span class="badge ${classe}">${rot}</span></div><div class="small text-2" style="line-height:1.6;margin-top:3px">${texto}</div></div></li>`;
  };
  const carro = a.financiamentos.find((f) => /CARRO|VEICULO|AUTO/.test(rotulo(f.nome)));
  return `<div class="card-titulo"><h2>Estratégia em etapas</h2><span class="sub">a ordem importa</span></div>
    <ol class="an-etapas">
      ${etapa(1, 'Equilibrar o orçamento', a.m.saldo < 0 ? 'critico' : a.poupanca < 0.1 ? 'atencao' : 'bom', a.m.saldo < 0 ? `Hoje faltam ${moedaInt(-a.m.saldo)}/mês. Investir antes disso é encher um balde furado: comece pelas oportunidades acima, das maiores para as menores.` : `Sobram ${pct(a.poupanca)} do que entra. Automatize: transfira a sobra no dia do salário, não no fim do mês.`)}
      ${etapa(2, 'Montar a reserva de emergência', a.mesesReserva == null ? 'atencao' : a.mesesReserva >= 6 ? 'bom' : a.mesesReserva >= 3 ? 'atencao' : 'critico', `Meta de ${moedaInt(a.reservaAlvo)} (6 meses de custo essencial), em aplicação de liquidez diária. Só depois dela vale correr risco.`)}
      ${etapa(3, 'Atacar as dívidas mais caras', a.pctRenda(a.m.dividas) > 0.35 ? 'critico' : a.pctRenda(a.m.dividas) > 0.25 ? 'atencao' : 'bom', `Rotativo do cartão e cheque especial: nunca. ${carro ? `Financiamento do carro (${moedaInt(carro.falta)} restantes): compare o CET com o rendimento líquido — se for maior, amortizar rende mais e sem risco. ` : ''}O financiamento do imóvel costuma ter os juros mais baixos; amortize por último.`)}
      ${etapa(4, 'Investir para objetivos', 'atencao', 'Separe por prazo. <b>Até 2 anos</b> (viagem, troca de carro): Tesouro Selic, CDB, LCI/LCA. <b>2 a 5 anos</b>: Tesouro IPCA+ ou prefixado com vencimento perto do objetivo. <b>Mais de 5 anos</b>: Tesouro IPCA+ longo, fundos imobiliários e ETFs de ações do Brasil e do exterior.')}
      ${etapa(5, 'Aposentadoria e independência', 'atencao', 'Quem declara IR no modelo completo pode deduzir até 12% da renda tributável com PGBL. Para o longo prazo, ETFs de baixo custo e Tesouro IPCA+ protegem da inflação. Reavalie a carteira uma vez por ano.')}
    </ol>`;
}

function blocoAlocacao(p) {
  const perfil = PERFIS[p.perfil] || PERFIS.moderado;
  const cores = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)', 'var(--cat-6)'];
  return `<div class="card-titulo"><h2>Carteira de referência</h2><span class="sub">depois da reserva pronta</span></div>
    <div class="seg" style="margin-bottom:12px">${Object.entries(PERFIS).map(([k, v]) => `<button data-perfil="${k}" class="${k === p.perfil ? 'ativo' : ''}">${v.nome}</button>`).join('')}</div>
    <div class="an-barra alta">${perfil.classes.map(([n, v], i) => `<i style="width:${v * 100}%;background:${cores[i]}" title="${escapeHtml(n)}: ${pct(v)}"></i>`).join('')}</div>
    <div class="an-aloc">${perfil.classes.map(([n, v], i) => `<div><i class="swatch" style="background:${cores[i]}"></i><span>${escapeHtml(n)}</span><b class="num">${pct(v)}</b></div>`).join('')}</div>
    <div class="small text-2" style="margin-top:12px;line-height:1.6">Renda fixa paga IR de 22,5% (até 6 meses) a 15% (mais de 2 anos) sobre o rendimento; LCI, LCA e poupança são isentas. CDB, LCI e LCA têm garantia do FGC até R$ 250 mil por CPF e instituição.</div>`;
}

function blocoSimulador(a, p, somaOport) {
  const aporte = p.aporte ?? Math.max(100, Math.round(somaOport / 50) * 50);
  const meses = p.prazo * 12;
  const real = taxaReal(p.taxa, p.inflacao);
  const nominal = valorFuturo(aporte, meses, p.taxa);
  const hoje = valorFuturo(aporte, meses, real);
  const investido = aporte * meses;
  return `<div class="card-titulo"><h2>Simulador de investimento mensal</h2><span class="sub">juros compostos</span></div>
    <div class="an-sim">
      <label class="campo">Aporte por mês<input class="input" id="an-aporte" inputmode="decimal" value="${escapeHtml(String(aporte).replace('.', ','))}"></label>
      <label class="campo">Prazo<select class="select" id="an-prazo">${[1, 2, 3, 5, 10, 15, 20, 25, 30].map((n) => `<option value="${n}" ${n === p.prazo ? 'selected' : ''}>${n} ano${n > 1 ? 's' : ''}</option>`).join('')}</select></label>
      ${numero('Você investe', moedaInt(investido), `${moedaInt(aporte)} × ${meses} meses`)}
      ${numero('Valor no fim', moedaInt(nominal), `a ${pct(p.taxa, 1)} ao ano, antes do IR`)}
      ${numero('Em reais de hoje', moedaInt(hoje), `descontada a inflação de ${pct(p.inflacao, 1)} ao ano`)}
    </div>
    <div class="small muted" style="margin-top:8px">Sugestão de aporte: o total das oportunidades marcadas. A taxa e a inflação são as do bloco de cenários.</div>`;
}

function mapaCalor(a) {
  const tipos = a.tipos.slice(0, 12);
  const max = Math.max(1, ...tipos.flatMap((t) => t.serie));
  const celula = (t, v, i) => {
    const f = Math.sqrt(v / max); // raiz: diferencia melhor os valores do meio
    const mes = a.periodo[i];
    return `<td class="an-calor num" data-ir-tipo="${escapeHtml(t.tipo)}" data-ir-mes="${mes}" style="background:color-mix(in srgb, var(--despesa) ${Math.round(f * 90)}%, var(--surface));color:${f > 0.62 ? '#fff' : 'var(--text)'}" title="${escapeHtml(t.tipo)} · ${nomeMes(mes)}: ${moeda(v)}">${v > 0 ? moedaCompacta(v).replace('R$ ', '') : ''}</td>`;
  };
  return `<table class="tabela an-mapa"><thead><tr><th>Tipo</th>${a.periodo.map((m) => `<th class="num">${mesCurto(m)}</th>`).join('')}</tr></thead>
    <tbody>${tipos.map((t) => `<tr><td>${escapeHtml(capital(t.tipo))}</td>${t.serie.map((v, i) => celula(t, v, i)).join('')}</tr>`).join('')}
    <tr class="an-mapa-total"><td><b>Total</b></td>${a.mensal.map((m) => `<td class="num"><b>${moedaCompacta(m.despesas).replace('R$ ', '')}</b></td>`).join('')}</tr></tbody></table>`;
}

function mesesCaros(a) {
  const comDados = a.mensal.filter((m) => m.temDados);
  const media = comDados.reduce((s, m) => s + m.despesas, 0) / Math.max(1, comDados.length);
  const caros = [...comDados].sort((x, y) => y.despesas - x.despesas).slice(0, 3).filter((m) => m.despesas > media * 1.1);
  if (!caros.length) return 'Os gastos são parecidos ao longo dos meses.';
  const principal = (mes) => {
    const i = a.periodo.indexOf(mes);
    const t = [...a.tipos].sort((x, y) => y.serie[i] - x.serie[i])[0];
    return t ? `${capital(t.tipo)} ${moedaInt(t.serie[i])}` : '';
  };
  return `Meses mais caros: ${caros.map((m) => `<b>${nomeMes(m.mes)}</b> (${moedaInt(m.despesas)}, ${pct(m.despesas / media - 1)} acima da média; maior peso: ${escapeHtml(principal(m.mes))})`).join(' · ')}. Gastos que se repetem todo ano nessas épocas (IPVA, IPTU, matrícula, presentes de fim de ano) podem ser provisionados: guarde 1/12 por mês.`;
}

// ───────────── Interação ─────────────

function ligar(raiz, app, a, p, somaOport) {
  const abrir = (filtros, meses = a.periodo) => {
    app.estado.meses = meses;
    app.estado.filtros = filtros;
    location.hash = '#/painel';
  };
  for (const b of $$('[data-janela]', raiz)) b.addEventListener('click', () => (guardar({ meses: +b.dataset.janela }), app.renderizar()));
  for (const el of $$('[data-ir-tipo]', raiz)) {
    const ir = () => abrir({ tipo: { valor: el.dataset.irTipo, texto: el.dataset.irTipo } }, el.dataset.irMes ? [el.dataset.irMes] : a.periodo);
    el.addEventListener('click', ir);
    el.addEventListener('keydown', (e) => e.key === 'Enter' && ir());
  }
  for (const el of $$('[data-ir-despesa]', raiz)) el.addEventListener('click', () => abrir({ despesa: { valor: el.dataset.irDespesa, texto: el.dataset.texto } }));
  for (const b of $$('[data-grupo]', raiz)) {
    b.addEventListener('click', () => {
      const atuais = new Set((p.necessidades || NECESSIDADES_PADRAO).map(rotulo));
      const t = rotulo(b.dataset.grupo);
      if (atuais.has(t)) atuais.delete(t);
      else atuais.add(t);
      guardar({ necessidades: [...atuais] });
      app.renderizar();
    });
  }
  for (const c of $$('[data-oport]', raiz)) {
    c.addEventListener('change', () => {
      guardar({ escolhas: { ...p.escolhas, [c.dataset.oport]: c.checked } });
      app.renderizar();
    });
  }
  for (const r of $$('[data-controle]', raiz)) {
    const id = r.dataset.controle;
    const fmt = id === 'taxa' || id === 'inflacao' ? (v) => pct(v, 1) : pct;
    r.addEventListener('input', () => {
      $(`#an-v-${id}`, raiz).textContent = fmt(+r.value);
      guardar({ [id]: +r.value });
      desenharCenarios(raiz, a, par(), somaOport);
    });
    // taxa e inflação mudam também as oportunidades e o simulador: redesenha tudo ao soltar
    if (id === 'taxa' || id === 'inflacao') r.addEventListener('change', () => app.renderizar());
  }
  $('#an-quitacoes', raiz).addEventListener('change', (e) => {
    guardar({ quitacoes: e.target.checked });
    desenharCenarios(raiz, a, par(), somaOport);
  });
  $('#an-reserva', raiz).addEventListener('change', (e) => {
    const texto = e.target.value.trim();
    guardar({ reserva: texto ? Math.max(0, lerReais(texto)) : null });
    app.renderizar();
  });
  for (const b of $$('[data-perfil]', raiz)) b.addEventListener('click', () => (guardar({ perfil: b.dataset.perfil }), app.renderizar()));
  $('#an-aporte', raiz).addEventListener('change', (e) => (guardar({ aporte: Math.max(0, lerReais(e.target.value)) }), app.renderizar()));
  $('#an-prazo', raiz).addEventListener('change', (e) => (guardar({ prazo: +e.target.value }), app.renderizar()));
  desenharCenarios(raiz, a, p, somaOport);
  const gRenda = $('#an-g-renda', raiz);
  responsivo(gRenda, () =>
    graficoColunas(gRenda, {
      rotulos: a.periodo.map(mesCurto),
      series: SERIES_RENDA.map((s) => ({ nome: s.nome, cor: s.cor, valores: a.mensal.map(s.doMes), pilha: 'renda' })),
      altura: 170,
      onClick: (i) => abrir({}, [a.periodo[i]]),
      tooltip: (i) => `<div class="t-titulo">${nomeMes(a.periodo[i])}</div>${SERIES_RENDA.map((s) => linhaTooltip(s.cor, s.nome, moeda(s.doMes(a.mensal[i])))).join('')}<div class="t-sep"></div>${linhaTooltip('', 'Renda', moeda(a.mensal[i].renda))}<div class="small muted">Clique para abrir o mês no painel</div>`,
    })
  );
}

function desenharCenarios(raiz, a, p, somaOport) {
  // a taxa e a inflação dos controles valem na hora para o gráfico
  const base = { ...a, taxaAnual: p.taxa, inflacao: p.inflacao };
  const variaveis = Math.max(1, a.m.gasto - a.m.fixo);
  const corteOport = Math.min(1, somaOport / variaveis);
  const series = [
    { nome: 'Se nada mudar', cor: COR_NADA, pontos: cenario(base, { quitacoes: p.quitacoes }) },
    { nome: 'Com as oportunidades', cor: COR_OPORT, pontos: cenario(base, { corteVariaveis: corteOport, quitacoes: p.quitacoes }) },
    { nome: 'Oportunidades + ajustes', cor: COR_PLANO, pontos: cenario(base, { corteVariaveis: Math.min(1, corteOport + p.corte), aumentoRenda: p.aumento, quitacoes: p.quitacoes }) },
  ];
  const fim = a.periodo.at(-1);
  const idx = Array.from({ length: 21 }, (_, i) => i * 3); // a cada 3 meses
  const mesDe = (i) => {
    const [ano, mes] = fim.split('-').map(Number);
    const t = ano * 12 + (mes - 1) + i;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  };
  const el = $('#g-cenarios', raiz);
  responsivo(el, () =>
    linhasSuaves(el, {
      rotulos: idx.map((i) => mesCurto(mesDe(i))),
      series: series.map((s) => ({ nome: s.nome, cor: s.cor, valores: idx.map((i) => s.pontos[i]) })),
      area: false,
      altura: 260,
      tooltip: (j) => `<div class="t-titulo">${nomeMes(mesDe(idx[j]))}</div>${series.map((s) => linhaTooltip(s.cor, s.nome, `<span class="${s.pontos[idx[j]] < 0 ? 'neg' : ''}">${moedaInt(s.pontos[idx[j]])}</span>`)).join('')}`,
    })
  );
  $('#an-cen-tabela', raiz).innerHTML = `<div class="tabela-wrap"><table class="tabela an-cen"><thead><tr><th>Cenário</th><th class="num">Sobra por mês hoje</th><th class="num">Em 1 ano</th><th class="num">Em 3 anos</th><th class="num">Em 5 anos</th></tr></thead><tbody>${series
    .map((s) => {
      const v = (i) => `<td class="num ${s.pontos[i] < 0 ? 'neg' : 'pos'}">${moedaInt(s.pontos[i])}</td>`;
      return `<tr><td><i class="swatch" style="background:${s.cor}"></i> ${s.nome}</td><td class="num ${s.pontos.sobra < 0 ? 'neg' : ''}">${moedaInt(s.pontos.sobra)}</td>${v(12)}${v(36)}${v(60)}</tr>`;
    })
    .join('')}</tbody></table></div>`;
}

