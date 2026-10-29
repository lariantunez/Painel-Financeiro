// Converte linhas da planilha (chaves = cabeçalhos normalizados) para o modelo interno.

import { parseValor, parseData, parseMesRef, rotulo } from './util.js';

export function normalizarDespesa(r) {
  const venc = r.VENCIMENTO || r.DATA || '';
  return {
    _linha: r._linha,
    nome: (r.NOME_DESPESA || r.NOME || r.DESCRICAO || '').trim(),
    vencimento: venc,
    data: parseData(venc),
    valor: parseValor(r.VALOR),
    categoria: (r.CATEGORIA || '').trim(),
    recorrencia: rotulo(r.RECORRENCIA),
    status: (r.STATUS || '').trim(),
    forma: (r.FORMA_DE_PGTO || r.FORMA_PGTO || '').trim(),
    parcelas: (r.PARCELAS || '').trim(),
    tipo: (r.TIPO || '').trim(),
    instituicao: (r.INSTITUICAO_FINANCEIRA || '').trim(),
    mesRef: parseMesRef(r.MES_DE_REFERENCIA) || parseMesRef(venc),
    id: (r.ID_IMPORTACAO || '').trim(),
    descOriginal: (r.DESCRICAO_ORIGINAL || '').trim(),
  };
}

export function normalizarReceita(r) {
  return {
    _linha: r._linha,
    nome: (r.NOME || '').trim(),
    tipo: (r.TIPO || '').trim(),
    valor: parseValor(r.VALOR),
    dataMes: parseMesRef(r.DATA),
    categoria: (r.CATEGORIA || '').trim(),
    status: (r.STATUS || '').trim(),
    forma: (r.FORMA_DE_PGTO || '').trim(),
    parcelas: (r.PARCELAS || '').trim(),
    instituicao: (r.INSTITUICAO_FINANCEIRA || '').trim(),
    mesRef: parseMesRef(r.MES_DE_REFERENCIA) || parseMesRef(r.DATA),
    id: (r.ID_IMPORTACAO || '').trim(),
    descOriginal: (r.DESCRICAO_ORIGINAL || '').trim(),
  };
}

export function normalizarRegra(r) {
  return {
    _linha: r._linha,
    chave: (r.CHAVE || '').trim(),
    destino: rotulo(r.DESTINO) || 'DESPESA',
    nome: (r.NOME || '').trim(),
    tipo: (r.TIPO || '').trim(),
    categoria: (r.CATEGORIA || '').trim(),
    recorrencia: rotulo(r.RECORRENCIA),
    titular: (r.TITULAR || '').trim(),
    perguntar: /^(SIM|TRUE|1|VERDADEIRO)$/i.test(String(r.PERGUNTAR || '').trim()),
    usos: parseInt(r.USOS, 10) || 0,
    atualizado: r.ATUALIZADO || '',
  };
}

export function regraParaLinha(r) {
  return {
    CHAVE: r.chave,
    DESTINO: r.destino,
    NOME: r.nome,
    TIPO: r.tipo,
    CATEGORIA: r.categoria,
    RECORRENCIA: r.recorrencia || '',
    TITULAR: r.titular || '',
    PERGUNTAR: r.perguntar ? 'SIM' : 'NÃO',
    USOS: r.usos || 0,
  };
}

// Valores distintos de uma coluna, ordenados por frequência (para listas de seleção)
export function valoresUsados(linhas, campo, extras = []) {
  const cont = new Map();
  for (const l of linhas) {
    const v = (l[campo] || '').trim();
    if (v) cont.set(v, (cont.get(v) || 0) + 1);
  }
  for (const e of extras) if (!cont.has(e)) cont.set(e, 0);
  return [...cont.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}
