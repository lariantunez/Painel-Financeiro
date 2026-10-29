// Monta o checklist mensal de contas fixas (e receitas fixas) a partir do histórico da planilha.

import { rotulo, parseData, dataBR, diasNoMes, parseParcela, RX_PARCELA, somarMeses, mesRefBR, arred, parseValor } from './util.js';

const MESES_SEM_APARECER = 3; // série some do checklist se não aparece há mais de 3 meses

export function serieDe(nome) {
  return rotulo(String(nome).replace(RX_PARCELA, ''));
}

function vemPelaFatura(d, instituicaoCartao) {
  return rotulo(d.forma).startsWith('CREDITO') && rotulo(d.instituicao) === rotulo(instituicaoCartao);
}

function vencimentoNoMes(vencAnterior, mesAlvo) {
  const [ano, mes] = mesAlvo.split('-').map(Number);
  const d = parseData(vencAnterior);
  const dia = Math.min(d ? d.dia : 10, diasNoMes(ano, mes));
  return dataBR({ ano, mes, dia });
}

function proximaParcela(parcelas, mesesPassados) {
  const p = parseParcela(parcelas);
  if (!p || p.n <= 1) return { parcelas: '1/1', encerrada: false };
  const k = p.k + mesesPassados;
  return { parcelas: `${Math.min(k, p.n)}/${p.n}`, encerrada: k > p.n };
}

function mesesEntre(de, ate) {
  const [a1, m1] = de.split('-').map(Number);
  const [a2, m2] = ate.split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

export function montarFixas({ despesas, receitas, mesAlvo, instituicaoCartao = 'NUBANK' }) {
  const limite = somarMeses(mesAlvo, -MESES_SEM_APARECER);

  // ── Despesas fixas ──
  const ultimas = new Map();
  const noMesAlvo = new Map();
  for (const d of despesas) {
    if (rotulo(d.categoria) !== 'FIXO' || !d.mesRef) continue;
    const serie = serieDe(d.nome);
    if (d.mesRef === mesAlvo) {
      noMesAlvo.set(serie, d);
      continue;
    }
    if (d.mesRef > mesAlvo || d.mesRef < limite) continue;
    const atual = ultimas.get(serie);
    if (!atual || d.mesRef > atual.mesRef || (d.mesRef === atual.mesRef && d._linha > atual._linha)) ultimas.set(serie, d);
  }

  const itensDespesa = [];
  const viaCartao = [];
  for (const [serie, d] of ultimas) {
    if (vemPelaFatura(d, instituicaoCartao)) {
      viaCartao.push(d.nome.replace(RX_PARCELA, '').trim());
      continue;
    }
    const lancado = noMesAlvo.get(serie);
    const { parcelas, encerrada } = proximaParcela(d.parcelas, mesesEntre(d.mesRef, mesAlvo));
    itensDespesa.push({
      serie,
      nome: d.nome.replace(/Parcela\s+\d+\s*\/\s*\d+/i, `Parcela ${parcelas}`),
      tipo: d.tipo,
      forma: d.forma,
      instituicao: d.instituicao.trim(),
      valorAnterior: Math.abs(d.valor),
      mesAnterior: d.mesRef,
      valor: Math.abs(lancado ? lancado.valor : d.valor),
      vencimento: lancado ? lancado.vencimento : vencimentoNoMes(d.vencimento, mesAlvo),
      parcelas: lancado ? lancado.parcelas : parcelas,
      status: lancado ? rotulo(lancado.status) : 'A PAGAR',
      incluir: !encerrada && Math.abs(d.valor) > 0,
      encerrada,
      jaLancado: lancado || null,
    });
  }
  // Fixas que já foram lançadas no mês alvo mas não existiam antes (ex.: nova conta)
  for (const [serie, d] of noMesAlvo) {
    if (ultimas.has(serie) || vemPelaFatura(d, instituicaoCartao)) continue;
    itensDespesa.push({
      serie, nome: d.nome, tipo: d.tipo, forma: d.forma, instituicao: d.instituicao.trim(),
      valorAnterior: null, mesAnterior: '', valor: Math.abs(d.valor), vencimento: d.vencimento,
      parcelas: d.parcelas, status: rotulo(d.status), incluir: true, encerrada: false, jaLancado: d,
    });
  }
  itensDespesa.sort((a, b) => (parseData(a.vencimento)?.dia || 0) - (parseData(b.vencimento)?.dia || 0));

  // ── Receitas fixas (ex.: salários) ──
  const porSerieReceita = new Map();
  const contagemNoAlvo = new Map();
  for (const r of receitas) {
    if (rotulo(r.categoria) !== 'FIXO' || !r.mesRef) continue;
    const serie = `${rotulo(r.tipo)}|${rotulo(r.nome)}`;
    if (r.mesRef === mesAlvo) {
      contagemNoAlvo.set(serie, (contagemNoAlvo.get(serie) || 0) + 1);
      continue;
    }
    if (r.mesRef > mesAlvo || r.mesRef < limite) continue;
    const atual = porSerieReceita.get(serie);
    if (!atual || r.mesRef > atual.mesRef) porSerieReceita.set(serie, { mesRef: r.mesRef, linhas: [r] });
    else if (r.mesRef === atual.mesRef) atual.linhas.push(r);
  }
  const itensReceita = [];
  for (const [serie, { linhas }] of porSerieReceita) {
    const jaNoAlvo = contagemNoAlvo.get(serie) || 0;
    linhas.forEach((r, i) => {
      itensReceita.push({
        serie,
        titular: r.nome,
        tipo: r.tipo,
        forma: r.forma,
        instituicao: r.instituicao.trim(),
        valorAnterior: r.valor,
        mesAnterior: r.mesRef,
        valor: r.valor,
        status: 'PAGO',
        incluir: i >= jaNoAlvo,
        jaLancado: i < jaNoAlvo,
      });
    });
  }

  return { despesas: itensDespesa, receitas: itensReceita, viaCartao: [...new Set(viaCartao)].sort() };
}

export function fixasParaLinhas(fixas, mesAlvo) {
  const mes = mesRefBR(mesAlvo);
  const despesas = fixas.despesas
    .filter((f) => f.incluir && !f.jaLancado)
    .map((f) => ({
      NOME_DESPESA: f.nome,
      VENCIMENTO: f.vencimento,
      VALOR: arred(parseValor(f.valor)),
      CATEGORIA: 'FIXO',
      STATUS: f.status,
      FORMA_DE_PGTO: f.forma,
      PARCELAS: f.parcelas,
      TIPO: f.tipo,
      INSTITUICAO_FINANCEIRA: f.instituicao,
      MES_DE_REFERENCIA: mes,
      ID_IMPORTACAO: `FIX-${mesAlvo}-${f.serie}`.slice(0, 80),
      DESCRICAO_ORIGINAL: '',
    }));
  const receitas = fixas.receitas
    .filter((f) => f.incluir && !f.jaLancado)
    .map((f, i) => ({
      NOME: f.titular,
      TIPO: f.tipo,
      VALOR: arred(parseValor(f.valor)),
      DATA: mes,
      INSTITUICAO_FINANCEIRA: f.instituicao,
      CATEGORIA: 'FIXO',
      STATUS: f.status,
      FORMA_DE_PGTO: f.forma,
      PARCELAS: '1/1',
      MES_DE_REFERENCIA: mes,
      ID_IMPORTACAO: `FIXR-${mesAlvo}-${f.serie}-${i}`.slice(0, 80),
      DESCRICAO_ORIGINAL: '',
    }));
  return { despesas, receitas };
}
