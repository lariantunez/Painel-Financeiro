// Classificador de lançamentos: transforma transações do extrato em linhas prontas para a planilha,
// usando (1) regras automáticas, (2) continuação de parcelamentos, (3) regras aprendidas e
// (4) o histórico da própria planilha. O que não tiver certeza vira pergunta para o usuário.

import { rotulo, dataBR, mesRefBR, chaveMes, somarMeses, parseParcela, RX_PARCELA, capitalizar, arred, formatarDescricao } from './util.js';

export const DESTINOS = ['DESPESA', 'RECEITA', 'IGNORAR'];
export const FORMAS = ['DÉBITO', 'CRÉDITO A VISTA', 'CRÉDITO PARCELADO', 'DÉBITO EM CONTA', 'BOLETO', 'PIX'];
export const FORMAS_RECEITA = ['PIX', 'DEPÓSITO EM CONTA', 'DÉBITO EM CONTA'];
export const CATEGORIAS = ['VARIÁVEL', 'FIXO'];

// Marketplaces: o nome no extrato não diz o que foi comprado, então o painel sempre pergunta
const MARKETPLACES = ['SHOPEE', 'AMAZON', 'AMAZONMKTPLC', 'MERCADOLIVRE', 'MERCADO LIVRE', 'ALIEXPRESS', 'MAGALU', 'SHEIN'];

export function ehMarketplace(chave) {
  const c = String(chave).replace(/^\+ /, '');
  return MARKETPLACES.some((m) => c === m || c.startsWith(`${m} `));
}

const STOPWORDS = new Set(
  ('DE DA DO DOS DAS E EM NO NA COM POR PARA LTDA SA S A ME EIRELI EPP COMERCIO COM BR BRASIL MP PG PAG IFD EC DL DM PP MTZ HNA ' +
    'PAGSEGURO PAYPAL EBANX PICPAY MERCADOPAGO NUPAY SUMUP STONE CIELO GETNET HTM IZ SQ LOJA LOJAS OSASCO SAO PAULO SP MERCADO LIVRE')
    .split(' ')
    .concat(MARKETPLACES)
);

// ───────────── Normalização da descrição do banco ─────────────

const PREFIXOS_CONTA = [
  [/^COMPRA NO DEBITO( VIA NUPAY)?/, 'DÉBITO'],
  [/^COMPRA NO CREDITO/, 'CRÉDITO A VISTA'],
  [/^PAGAMENTO DE BOLETO( EFETUADO)?/, 'BOLETO'],
  [/^PAGAMENTO DE CONVENIO/, 'BOLETO'],
  [/^TRANSFERENCIA ENVIADA PELO PIX/, 'PIX'],
  [/^PIX ENVIADO|^TRANSF\.? PIX|^PIX TRANSF/, 'PIX'],
  [/^TRANSFERENCIA (ENVIADA|ENTRE CONTAS)/, 'PIX'],
  [/^DEBITO (AUTOMATICO|EM CONTA)/, 'DÉBITO EM CONTA'],
  [/^TRANSFERENCIA RECEBIDA PELO PIX|^PIX RECEBIDO|^REEMBOLSO RECEBIDO PELO PIX/, 'PIX'],
  [/^TRANSFERENCIA RECEBIDA|^TED RECEBIDA|^DOC RECEBIDO/, 'DEPÓSITO EM CONTA'],
];

// Movimentos que nunca são despesa/receita (o gasto real já aparece em outro lugar)
const IGNORAR_AUTOMATICO = [
  [/PAGAMENTO (DE FATURA|RECEBIDO|EFETUADO)|^PAGAMENTO FATURA|FATURA NUBANK/, 'Pagamento da fatura do cartão'],
  [/^(APLICACAO|RESGATE) RDB|CAIXINHA|^DINHEIRO GUARDADO|^GUARDADO NA|^RESGATE DE DINHEIRO GUARDADO/, 'Movimentação de investimento/caixinha'],
];

export function limparDescricao(desc) {
  let s = rotulo(desc);
  s = s.replace(/\s*-?\s*PARCELA\s+\d+\s*\/\s*\d+/, ' ');
  s = s.replace(/^ESTORNO( DE)?\s*/, '').replace(/^"|"$/g, '');
  for (const [rx] of PREFIXOS_CONTA) s = s.replace(rx, '');
  s = s.replace(/^\s*-\s*/, '');
  s = s.replace(/\s*\(TRANSFERENCIA (ENVIADA|RECEBIDA)\)/, '');
  s = s.replace(/^[\d./-]{6,}\s+/, ''); // CNPJ/CPF no começo do nome
  // Pix/transferência: "NOME DA PESSOA - •••.123.456-•• - BANCO (0260) Agência..." -> nome
  s = s.split(/\s+-\s+/)[0];
  return s.replace(/[•*"]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function chaveDescricao(desc) {
  return limparDescricao(desc)
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(' ')
    .filter((t) => t && !/^\d{3,}$/.test(t))
    .join(' ');
}

// Palavras significativas (sem conectivos, intermediadores de pagamento, cidades e códigos como "P4703")
function tokens(chave) {
  return chave.split(' ').filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/\d/.test(t));
}

// "DROGASIL" ~ "DROGASILS", mas "MERCADOLIVRE" não é "MERCADO"
function prefixoForte(a, b) {
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
  return curto.length >= 4 && longo.startsWith(curto) && curto.length / longo.length >= 0.7;
}

function similaridade(tokA, tokB) {
  if (!tokA.length || !tokB.length) return 0;
  let acertos = 0;
  for (const a of tokA) {
    if (tokB.some((b) => a === b || prefixoForte(a, b))) acertos++;
  }
  const score = acertos / Math.max(tokA.length, Math.min(tokB.length, tokA.length + 1));
  // Mesmo nome principal ("WELLHUB LARISSA" ~ "WELLHUB") é um sinal forte
  return tokA[0] === tokB[0] && tokA[0].length >= 5 ? Math.max(score, 0.7) : score;
}

function nomeSugerido(desc) {
  return capitalizar(limparDescricao(desc).toLowerCase()) || desc;
}

// ───────────── Índices ─────────────

function indexarHistorico(despesas, receitas) {
  const porChave = new Map(); // chave -> { destino, tipos:{tipo:n}, categorias, nome, n }
  const add = (chave, destino, r) => {
    if (!chave) return;
    let e = porChave.get(chave);
    if (!e) porChave.set(chave, (e = { chave, destino, tipos: {}, categorias: {}, recorrencias: {}, nome: '', n: 0, tok: tokens(chave), mesRef: '' }));
    e.n++;
    e.tipos[r.tipo] = (e.tipos[r.tipo] || 0) + 1;
    e.categorias[r.categoria] = (e.categorias[r.categoria] || 0) + 1;
    if (r.recorrencia) e.recorrencias[r.recorrencia] = (e.recorrencias[r.recorrencia] || 0) + 1;
    if (!e.mesRef || r.mesRef >= e.mesRef) {
      e.mesRef = r.mesRef;
      e.nome = destino === 'DESPESA' ? r.nome.replace(RX_PARCELA, '').trim() : r.tipo;
    }
  };
  for (const d of despesas) {
    if (!d.tipo) continue;
    if (d.descOriginal) add(chaveDescricao(d.descOriginal), 'DESPESA', d);
    add(chaveDescricao(d.nome), 'DESPESA', d);
  }
  for (const r of receitas) {
    if (r.descOriginal) add(`+ ${chaveDescricao(r.descOriginal)}`, 'RECEITA', r);
  }
  return porChave;
}

function dominante(contagem) {
  let melhor = '';
  let n = 0;
  let total = 0;
  for (const [k, v] of Object.entries(contagem)) {
    total += v;
    if (v > n && k) {
      melhor = k;
      n = v;
    }
  }
  return { valor: melhor, share: total ? n / total : 0 };
}

// ───────────── Classificador ─────────────

// diaFechamento: compras do cartão a partir desse dia contam para o mês; antes dele, para o mês anterior (ciclo da fatura)
export function criarClassificador({ regras = [], despesas = [], receitas = [], titulares = {}, diaFechamento = 7 } = {}) {
  const mapaRegras = new Map(regras.map((r) => [r.chave, r]));
  const tokRegras = regras.map((r) => ({ r, tok: tokens(r.chave) }));
  const historico = indexarHistorico(despesas, receitas);
  const idsExistentes = new Set([...despesas, ...receitas].map((r) => r.id).filter(Boolean));
  const parcelasUsadas = new Set();

  // Linhas digitadas à mão (sem ID) que podem ser o mesmo lançamento do extrato
  // (inclui as contas fixas lançadas pelo painel, que não têm descrição original do banco)
  const legado = despesas.filter((d) => !d.descOriginal && d.data && d.valor > 0);

  function continuacaoParcela(tx, base, k, n) {
    if (k <= 1) return null;
    const anterior = `${k - 1}/${n}`;
    const tokBase = tokens(chaveDescricao(base));
    let melhor = null;
    let melhorScore = -1;
    for (const d of despesas) {
      if (parcelasUsadas.has(d)) continue;
      const p = parseParcela(d.parcelas);
      if (!p || p.n !== n || p.k !== k - 1) continue;
      // a 1ª parcela costuma ter alguns centavos a mais (arredondamento)
      if (Math.abs(Math.abs(d.valor) - tx.valor) > Math.max(0.15, tx.valor * 0.01)) continue;
      const origem = d.descOriginal ? chaveDescricao(d.descOriginal) : chaveDescricao(d.nome);
      const score = similaridade(tokBase, tokens(origem)) + (d.nome.includes(anterior) ? 0.1 : 0);
      if (score > melhorScore) {
        melhor = d;
        melhorScore = score;
      }
    }
    if (!melhor) return null;
    parcelasUsadas.add(melhor);
    return melhor;
  }

  // mesFatura: mês de referência único para toda a fatura do cartão (ex.: '2026-09')
  function classificar(tx, origem, instituicao, mesFatura) {
    const descN = rotulo(tx.descricao);
    let chave = chaveDescricao(tx.descricao);
    const data = tx.data;
    const lanc = {
      id: tx.id,
      tx,
      chave,
      descricaoOriginal: tx.descricao,
      origem,
      instituicao: instituicao || 'NUBANK',
      vencimento: dataBR(data),
      mesRef:
        origem === 'cartao'
          ? mesFatura || (data.dia < diaFechamento ? somarMeses(chaveMes(data.ano, data.mes), -1) : chaveMes(data.ano, data.mes))
          : chaveMes(data.ano, data.mes),
      valor: tx.valor,
      destino: 'DESPESA',
      nome: nomeSugerido(tx.descricao),
      tipo: '',
      categoria: 'VARIÁVEL',
      recorrencia: 'EVENTUAL',
      status: 'PAGO',
      forma: '',
      parcelas: '1/1',
      titular: titulares[instituicao] || '',
      confianca: 'novo',
      motivo: 'Primeira vez que aparece',
      jaLancado: idsExistentes.has(tx.id),
      possivelDuplicado: false,
      lembrar: true,
    };

    // 1. Natureza do movimento
    for (const [rx, motivo] of IGNORAR_AUTOMATICO) {
      if (rx.test(descN) && (origem === 'cartao' ? tx.entrada : true)) {
        return Object.assign(lanc, { destino: 'IGNORAR', confianca: 'certo', motivo, lembrar: false });
      }
    }

    const parcela = tx.descricao.match(RX_PARCELA);
    const estorno = /^ESTORNO|ESTORNO DE/.test(descN) || (origem === 'cartao' && tx.entrada);
    if (origem === 'cartao') {
      lanc.forma = parcela && +parcela[2] > 1 ? 'CRÉDITO PARCELADO' : 'CRÉDITO A VISTA';
      if (parcela) lanc.parcelas = `${parcela[1]}/${parcela[2]}`;
    } else {
      const prefixo = PREFIXOS_CONTA.find(([rx]) => rx.test(descN));
      lanc.forma = prefixo ? prefixo[1] : tx.entrada ? 'PIX' : 'DÉBITO';
      if (tx.entrada && !estorno) lanc.destino = 'RECEITA';
    }
    if (estorno) {
      lanc.valor = -tx.valor;
      lanc.destino = 'DESPESA';
    }
    // Entradas têm regras próprias: o Pix enviado a alguém e o Pix recebido dessa pessoa não se confundem
    if (lanc.destino === 'RECEITA') lanc.chave = chave = `+ ${chave}`;

    // 2. Continuação de parcelamento já lançado
    if (parcela && lanc.destino === 'DESPESA') {
      const anterior = continuacaoParcela(tx, tx.descricao.replace(RX_PARCELA, ''), +parcela[1], +parcela[2]);
      if (anterior) {
        const sufixo = `Parcela ${parcela[1]}/${parcela[2]}`;
        return Object.assign(lanc, {
          nome: RX_PARCELA.test(anterior.nome) ? anterior.nome.replace(/Parcela\s+\d+\s*\/\s*\d+/i, sufixo) : `${anterior.nome.trim()} - ${sufixo}`,
          tipo: anterior.tipo,
          categoria: anterior.categoria || 'VARIÁVEL',
          recorrencia: anterior.recorrencia || 'EVENTUAL',
          confianca: 'certo',
          motivo: `Continuação de "${anterior.nome}"`,
          lembrar: false,
          anteriorParcela: anterior, // se você renomear esta parcela, as anteriores na planilha acompanham
        });
      }
    }

    const sufixoParcela = parcela && lanc.forma === 'CRÉDITO PARCELADO' ? ` - Parcela ${parcela[1]}/${parcela[2]}` : '';
    const prefixoEstorno = estorno ? 'Estorno ' : '';
    const marketplace = ehMarketplace(chave);
    const aplicar = (fonte, confianca, motivo) => {
      // Em marketplace o nome/tipo anteriores são só sugestão: cada compra é um produto diferente
      if (marketplace && confianca === 'certo') {
        confianca = 'sugestao';
        motivo = 'Compra em marketplace: confirme o que foi comprado';
      }
      Object.assign(lanc, {
        destino: estorno ? 'DESPESA' : fonte.destino || lanc.destino,
        tipo: fonte.tipo || '',
        categoria: fonte.categoria || lanc.categoria,
        recorrencia: fonte.recorrencia || lanc.recorrencia,
        confianca,
        motivo,
      });
      if (fonte.nome && !marketplace) lanc.nome = lanc.destino === 'RECEITA' ? fonte.nome : prefixoEstorno + fonte.nome + sufixoParcela;
      if (lanc.destino === 'RECEITA' && fonte.titular) lanc.titular = fonte.titular;
      return lanc;
    };
    if (sufixoParcela || estorno) lanc.nome = prefixoEstorno + lanc.nome + sufixoParcela;

    // 3. Regra aprendida
    const regra = mapaRegras.get(chave);
    if (regra) {
      lanc.regra = regra;
      lanc.perguntar = regra.perguntar;
      return regra.perguntar
        ? aplicar(regra, 'sugestao', marketplace ? 'Compra em marketplace: confirme o que foi comprado' : 'Você pediu para sempre confirmar este lançamento')
        : aplicar(regra, 'certo', 'Regra aprendida');
    }

    // 4. Histórico da planilha (mesma descrição)
    const hist = historico.get(chave);
    if (hist && hist.destino === lanc.destino) {
      const tipo = dominante(hist.tipos);
      const cat = dominante(hist.categorias);
      const fonte = { destino: hist.destino, nome: hist.nome, tipo: tipo.valor, categoria: cat.valor, recorrencia: dominante(hist.recorrencias).valor };
      if (hist.n >= 2 && tipo.share >= 0.85) return aplicar(fonte, 'certo', `Igual a ${hist.n} lançamentos anteriores`);
      return aplicar(fonte, 'sugestao', `Parecido com "${hist.nome}" (${hist.n}x no histórico)`);
    }

    // 5. Semelhança com regras e histórico
    const tok = tokens(chave);
    let melhor = null;
    for (const { r, tok: t } of tokRegras) {
      const s = similaridade(tok, t);
      if (s >= 0.6 && (!melhor || s > melhor.s)) melhor = { s, fonte: r, rotulo: r.nome };
    }
    for (const h of historico.values()) {
      if (h.destino !== lanc.destino) continue;
      const s = similaridade(tok, h.tok);
      if (s >= 0.6 && (!melhor || s > melhor.s + 0.05)) {
        melhor = { s, fonte: { destino: h.destino, nome: h.nome, tipo: dominante(h.tipos).valor, categoria: dominante(h.categorias).valor, recorrencia: dominante(h.recorrencias).valor }, rotulo: h.nome };
      }
    }
    if (melhor) {
      aplicar(melhor.fonte, 'sugestao', `Parecido com "${melhor.rotulo}"`);
      if (melhor.s < 0.99) lanc.nome = prefixoEstorno + nomeSugerido(tx.descricao) + sufixoParcela;
      return lanc;
    }

    if (lanc.destino === 'RECEITA') lanc.tipo = lanc.nome;
    return lanc;
  }

  // Mesmo valor e mesma data; para valores a partir de R$ 50, até 20 dias de diferença
  // (ex.: conta fixa lançada com o vencimento e paga dias antes)
  const usados = new Set();
  const diasEntre = (a, b) => Math.abs(new Date(a.ano, a.mes - 1, a.dia) - new Date(b.ano, b.mes - 1, b.dia)) / 864e5;
  function marcarDuplicados(lancamentos) {
    for (const l of lancamentos) {
      if (l.jaLancado || l.destino !== 'DESPESA' || l.valor < 0) continue;
      let melhor = null;
      for (const d of legado) {
        if (usados.has(d) || Math.abs(d.valor - l.tx.valor) > 0.009) continue;
        if (l.forma === 'CRÉDITO PARCELADO' && (d.parcelas || '1/1') !== l.parcelas) continue; // parcela 2/10 não é duplicata da 1/10
        const dias = diasEntre(d.data, l.tx.data);
        const mesmoMes = d.mesRef === l.mesRef;
        if (dias === 0 || (l.tx.valor >= 50 && mesmoMes && dias <= 31)) {
          const nota = (mesmoMes ? 0 : 100) + dias;
          if (!melhor || nota < melhor.nota) melhor = { d, nota };
        }
      }
      if (melhor) {
        usados.add(melhor.d);
        l.possivelDuplicado = true;
        l.duplicadoDe = melhor.d;
        const pendente = rotulo(melhor.d.status) === 'A PAGAR';
        l.motivo = `Já está na planilha como “${melhor.d.nome}” (${melhor.d.vencimento})${pendente ? ' — vai ser marcado como PAGO' : ''}`;
      }
    }
  }

  return {
    classificarExtrato(extrato) {
      const lista = extrato.transacoes.map((tx) => classificar(tx, extrato.origem, extrato.instituicao, extrato.mesFatura));
      marcarDuplicados(lista);
      return lista;
    },
  };
}

// Propaga a decisão do usuário para os demais lançamentos com a mesma descrição.
export function propagarDecisao(lancamentos, modelo) {
  for (const l of lancamentos) {
    if (l === modelo || l.chave !== modelo.chave || l.confianca === 'certo' && l.motivo.startsWith('Continuação')) continue;
    l.destino = modelo.destino;
    l.tipo = modelo.tipo;
    l.categoria = modelo.categoria;
    l.recorrencia = modelo.recorrencia;
    if (modelo.destino === 'RECEITA') l.titular = modelo.titular;
    const sufixo = l.nome.match(RX_PARCELA);
    l.nome = modelo.nome.replace(RX_PARCELA, '') + (sufixo ? ` - Parcela ${sufixo[1]}/${sufixo[2]}` : '');
    l.confianca = 'certo';
    l.motivo = 'Igual ao que você classificou acima';
  }
}

// Regras que devem ser criadas/atualizadas a partir das decisões da importação.
export function regrasAPartirDe(lancamentos) {
  const regras = new Map();
  for (const l of lancamentos) {
    if (!l.lembrar || !l.chave || l.jaLancado) continue;
    if (l.motivo.startsWith('Continuação') || l.motivo.startsWith('Pagamento') || l.motivo.startsWith('Movimentação')) continue;
    const nome = (l.destino === 'RECEITA' ? l.tipo : l.nome).replace(RX_PARCELA, '').replace(/^Estorno\s+/i, '').trim();
    const anterior = l.regra;
    const mudou = anterior && (anterior.tipo !== l.tipo || anterior.destino !== l.destino);
    const marketplace = ehMarketplace(l.chave);
    regras.set(l.chave, {
      chave: l.chave,
      destino: l.destino,
      nome: marketplace ? '' : nome, // o nome dado a uma compra de marketplace vale só para ela
      tipo: l.destino === 'IGNORAR' ? '' : l.tipo,
      categoria: l.destino === 'IGNORAR' ? '' : l.categoria,
      recorrencia: l.destino === 'DESPESA' ? l.recorrencia : '',
      titular: l.destino === 'RECEITA' ? l.titular : '',
      // Se uma regra já usada várias vezes foi contrariada, o lançamento é ambíguo: passa a perguntar sempre.
      perguntar: marketplace || (l.perguntar !== undefined && l.editado ? l.perguntar : anterior ? anterior.perguntar || (mudou && anterior.usos >= 2) : false),
      usos: (anterior?.usos || 0) + 1,
    });
  }
  return [...regras.values()];
}

// Converte lançamentos aprovados no formato de linha da planilha (chaves = cabeçalhos normalizados)
export function paraLinhasPlanilha(lancamentos) {
  const despesas = [];
  const receitas = [];
  for (const l of lancamentos) {
    if (l.destino === 'IGNORAR' || l.jaLancado || l.excluir) continue;
    if (l.destino === 'DESPESA') {
      despesas.push({
        NOME_DESPESA: formatarDescricao(l.nome),
        VENCIMENTO: l.vencimento,
        VALOR: l.valor,
        CATEGORIA: l.categoria,
        RECORRENCIA: l.recorrencia || 'EVENTUAL',
        STATUS: l.status,
        FORMA_DE_PGTO: l.forma,
        PARCELAS: l.parcelas,
        TIPO: l.tipo,
        INSTITUICAO_FINANCEIRA: l.instituicao,
        MES_DE_REFERENCIA: mesRefBR(l.mesRef),
        ID_IMPORTACAO: l.id,
        DESCRICAO_ORIGINAL: l.descricaoOriginal || '',
      });
    } else {
      receitas.push({
        NOME: l.titular,
        TIPO: formatarDescricao(l.tipo),
        VALOR: Math.abs(l.valor),
        DATA: mesRefBR(l.mesRef),
        INSTITUICAO_FINANCEIRA: l.instituicao,
        CATEGORIA: l.categoria,
        STATUS: l.status,
        FORMA_DE_PGTO: l.forma,
        PARCELAS: l.parcelas || '1/1',
        MES_DE_REFERENCIA: mesRefBR(l.mesRef),
        ID_IMPORTACAO: l.id,
        DESCRICAO_ORIGINAL: l.descricaoOriginal || '',
      });
    }
  }
  return { despesas, receitas };
}

