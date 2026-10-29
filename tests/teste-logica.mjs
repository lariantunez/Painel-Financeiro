// Testes da lógica de importação.
// Uso: node tests/teste-logica.mjs [pasta com Despesas.csv e Receitas.csv exportados da planilha]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { lerExtrato, csvParaObjetos } from '../js/parsers.js';
import { criarClassificador, chaveDescricao, paraLinhasPlanilha, regrasAPartirDe, propagarDecisao } from '../js/classifier.js';
import { normalizarDespesa, normalizarReceita } from '../js/model.js';
import { montarFixas, fixasParaLinhas } from '../js/fixas.js';
import { parseValor, parseMesRef } from '../js/util.js';
import { analisarFinancas, valorFuturo, taxaReal, cenario } from '../js/financas.js';
import { parcelasDaMesmaCompra, nomeDaParcela, mesmaDespesa, lancamentosSeguintes, inferirRecorrencia, previsao } from '../js/analise.js';

let ok = 0;
const teste = (nome, fn) => {
  try {
    fn();
    ok++;
    console.log('  ✓', nome);
  } catch (e) {
    console.log('  ✗', nome, '\n   ', e.message);
    process.exitCode = 1;
  }
};

console.log('análise financeira');
teste('Juros compostos e taxa real', () => {
  assert.equal(Math.round(valorFuturo(100, 12, 0)), 1200);
  assert.ok(Math.abs(valorFuturo(1000, 120, 0.12) - 225000) < 5000); // ~R$ 225 mil
  assert.ok(Math.abs(taxaReal(0.12, 0.045) - 0.0718) < 0.001);
});
teste('Reembolso abate gasto (não é renda); salário vai para a pessoa; financiamento conta como dívida', () => {
  const d = (nome, valor, extra = {}) => ({ nome, valor, mesRef: '2026-01', tipo: 'CASA', categoria: 'FIXO', recorrencia: 'MENSAL', forma: 'BOLETO', parcelas: '', ...extra });
  const r = (tipo, nome, valor) => ({ tipo, nome, valor, mesRef: '2026-01' });
  const dados = {
    despesas: [d('Financiamento Apartamento', 3000, { parcelas: '40/415' }), d('Cinema', 200, { tipo: 'LAZER', categoria: 'VARIÁVEL', recorrencia: 'EVENTUAL', forma: 'DÉBITO' })],
    receitas: [r('Salario Douglas', 'DOUGLAS', 5000), r('SALÁRIO', 'LARISSA', 3000), r('REEMBOLSO', 'LARISSA', 100)],
  };
  const a = analisarFinancas(dados, { meses: 1, fim: '2026-01' });
  assert.equal(a.m.renda, 8000);
  assert.equal(a.m.gasto, 3100);
  assert.equal(a.m.saldo, 4900);
  assert.deepEqual(a.salarioPessoa, { LARISSA: 3000, DOUGLAS: 5000 });
  assert.equal(a.m.financiamentos, 3000);
  assert.equal(a.financiamentos[0].restantes, 375);
  assert.equal(a.alertas.find((x) => x.titulo === 'Os gastos estão maiores que a renda'), undefined);
  // sem juros nem inflação, o patrimônio cresce exatamente a sobra de cada mês
  const pts = cenario({ ...a, taxaAnual: 0, inflacao: 0 }, { meses: 3 });
  assert.deepEqual(pts.map(Math.round), [0, 4900, 9800, 14700]);
});

console.log('util');
teste('parseValor BR/US/negativo', () => {
  assert.equal(parseValor('R$ 1.542,51'), 1542.51);
  assert.equal(parseValor('-R$ 24,90'), -24.9);
  assert.equal(parseValor('138.40'), 138.4);
  assert.equal(parseValor('-1,234.50'), -1234.5);
});
teste('parseMesRef', () => {
  assert.equal(parseMesRef('09/2026'), '2026-09');
  assert.equal(parseMesRef('15/01/25'), '2025-01');
});

console.log('parsers');
const cartaoCSV = `date,title,amount
2026-09-03,Netflix.Com,44.90
2026-09-05,Amazon - Parcela 9/10,138.40
2026-09-06,Carrefour Mercado,210.55
2026-09-07,Pagamento recebido,-4500.00
2026-09-08,Loja Nova Xyz Ltda,89.90
2026-09-08,Loja Nova Xyz Ltda,89.90
2026-09-10,"Estorno de ""Netflix.Com""",-44.90
2026-09-12,Mercadolivre*Fone - Parcela 1/3,100.00`;
const contaCSV = `Data,Valor,Identificador,Descrição
05/09/2026,-38.00,a1b2,Compra no débito - Pastel Feira
06/09/2026,-4500.00,c3d4,Pagamento de fatura
07/09/2026,-60.00,e5f6,Transferência enviada pelo Pix - PRISCILLA SOUZA - •••.123.456-•• - ITAÚ UNIBANCO (0341) Agência: 1 Conta: 2
08/09/2026,26.00,g7h8,Transferência recebida pelo Pix - PRISCILLA SOUZA - •••.123.456-•• - ITAÚ (0341) Agência: 1 Conta: 2
09/09/2026,-260.26,i9j0,Pagamento de boleto efetuado - ENEL DISTRIBUICAO SAO PAULO
10/09/2026,-1000.00,k1l2,Aplicação RDB`;
const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>0237</BANKID></BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260915120000[-3:BRT]<TRNAMT>-64.09<FITID>X1<MEMO>CONTA TELEFONE VIVO</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260905<TRNAMT>3000.00<FITID>X2<MEMO>SALARIO</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const cartao = lerExtrato(cartaoCSV, 'Nubank_2026-09.csv');
const conta = lerExtrato(contaCSV, 'NU_123.csv');
const banco = lerExtrato(ofx, 'extrato.ofx');
teste('detecta fatura Nubank', () => {
  assert.equal(cartao.origem, 'cartao');
  assert.equal(cartao.instituicao, 'NUBANK');
  assert.equal(cartao.transacoes.length, 8);
});
teste('detecta conta Nubank', () => {
  assert.equal(conta.origem, 'conta');
  assert.equal(conta.transacoes[0].entrada, false);
  assert.equal(conta.transacoes[3].entrada, true);
});
teste('OFX Bradesco', () => {
  assert.equal(banco.instituicao, 'BRADESCO');
  assert.equal(banco.transacoes[0].valor, 64.09);
  assert.equal(banco.transacoes[1].entrada, true);
});
teste('IDs únicos mesmo para compras idênticas', () => {
  const ids = cartao.transacoes.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});
teste('IDs estáveis entre leituras', () =>
  assert.deepEqual(lerExtrato(cartaoCSV, 'Nubank_2026-09.csv').transacoes.map((t) => t.id), cartao.transacoes.map((t) => t.id)));
teste('chave do Pix usa só o nome', () => assert.equal(chaveDescricao(conta.transacoes[2].descricao), 'PRISCILLA SOUZA'));

const pasta = process.argv[2];
if (pasta) {
  console.log('classificador com dados reais');
  const despesas = csvParaObjetos(fs.readFileSync(path.join(pasta, 'Despesas.csv'), 'utf8')).map(normalizarDespesa);
  const receitas = csvParaObjetos(fs.readFileSync(path.join(pasta, 'Receitas.csv'), 'utf8')).map(normalizarReceita);
  const cls = criarClassificador({ despesas, receitas, titulares: { NUBANK: 'LARISSA' } });
  const lc = cls.classificarExtrato(cartao);
  const ld = cls.classificarExtrato(conta);
  for (const l of [...lc, ...ld]) {
    console.log(
      `    [${l.confianca.padEnd(8)}] ${l.destino.padEnd(8)} ${String(l.valor).padStart(8)}  ${l.nome.padEnd(40)} ${(l.tipo || '?').padEnd(14)} ${l.categoria.padEnd(8)} ${l.forma.padEnd(18)} ${l.parcelas}  — ${l.motivo}`
    );
  }
  const por = (lista, nome) => lista.find((l) => l.descricaoOriginal.startsWith(nome));
  teste('Netflix reconhecida como FIXO/ENTRETENIMENTO', () => {
    const l = por(lc, 'Netflix');
    assert.equal(l.tipo, 'ENTRETENIMENTO');
    assert.equal(l.categoria, 'FIXO');
    assert.equal(l.confianca, 'certo');
  });
  teste('Parcela 9/10 continua "Amazon Monitores"', () => {
    const l = por(lc, 'Amazon');
    assert.equal(l.nome, 'Amazon Monitores - Parcela 9/10');
    assert.equal(l.tipo, 'EDUCAÇÃO');
    assert.equal(l.forma, 'CRÉDITO PARCELADO');
  });
  teste('Pagamento da fatura ignorado (cartão e conta)', () => {
    assert.equal(por(lc, 'Pagamento').destino, 'IGNORAR');
    assert.equal(por(ld, 'Pagamento de fatura').destino, 'IGNORAR');
  });
  teste('Aplicação RDB ignorada', () => assert.equal(por(ld, 'Aplicação').destino, 'IGNORAR'));
  teste('Estorno vira despesa negativa', () => {
    const l = por(lc, 'Estorno');
    assert.equal(l.destino, 'DESPESA');
    assert.equal(l.valor, -44.9);
  });
  teste('Pix recebido vira receita', () => {
    const l = por(ld, 'Transferência recebida');
    assert.equal(l.destino, 'RECEITA');
    assert.equal(l.titular, 'LARISSA');
    assert.equal(l.forma, 'PIX');
  });
  teste('Débito e boleto com forma correta', () => {
    assert.equal(por(ld, 'Compra no débito').forma, 'DÉBITO');
    assert.equal(por(ld, 'Pagamento de boleto').forma, 'BOLETO');
  });
  teste('Loja nova pergunta', () => assert.equal(por(lc, 'Loja Nova').confianca, 'novo'));

  teste('Propagação + aprendizado', () => {
    const novos = lc.filter((l) => l.descricaoOriginal.startsWith('Loja Nova'));
    Object.assign(novos[0], { nome: 'Loja Nova', tipo: 'CASA' });
    propagarDecisao(lc, novos[0]);
    assert.equal(novos[1].tipo, 'CASA');
    const regras = regrasAPartirDe([...lc, ...ld]);
    const r = regras.find((x) => x.chave === 'LOJA NOVA XYZ LTDA');
    assert.equal(r.tipo, 'CASA');
    const cls2 = criarClassificador({ despesas, receitas, regras });
    const l2 = cls2.classificarExtrato(lerExtrato(cartaoCSV, 'Nubank.csv')).find((l) => l.descricaoOriginal.startsWith('Loja Nova'));
    assert.equal(l2.confianca, 'certo');
    assert.equal(l2.nome, 'Loja Nova');
    assert.equal(l2.tipo, 'CASA');
  });
  teste('Linhas para planilha', () => {
    const { despesas: dl, receitas: rl } = paraLinhasPlanilha([...lc, ...ld]);
    assert.ok(dl.every((d) => d.ID_IMPORTACAO));
    assert.equal(rl.length, 1);
  });
  teste('Cartão segue o ciclo da fatura (fecha dia 7); conta segue o calendário', () => {
    assert.equal(por(lc, 'Netflix').mesRef, '2026-08'); // compra em 03/09 -> fatura de agosto
    assert.equal(por(lc, 'Mercadolivre').mesRef, '2026-09'); // 12/09 -> setembro
    assert.equal(por(ld, 'Compra no débito').mesRef, '2026-09'); // débito em 05/09 -> setembro
  });
  teste('Fatura inteira vai para o mês escolhido, mesmo com compras do mês atual', () => {
    const csv = 'date,title,amount\n2026-10-06,Shopee *Kuangre,"25,90"\n2026-09-08,Netflix Entretenimento,"44,90"';
    const ex = { ...lerExtrato(csv, 'Nubank.csv'), mesFatura: '2026-09' };
    assert.deepEqual(criarClassificador({ despesas, receitas }).classificarExtrato(ex).map((l) => l.mesRef), ['2026-09', '2026-09']);
  });
  teste('Marketplace: nome dado não é memorizado e sempre pergunta', () => {
    const csv = 'date,title,amount\n2026-09-27,Shopee *Kuangre,"25,90"';
    const [l] = criarClassificador({ despesas, receitas }).classificarExtrato(lerExtrato(csv, 'Nubank.csv'));
    Object.assign(l, { nome: 'Capinha de celular', tipo: 'ACESSÓRIOS', editado: true });
    const [r] = regrasAPartirDe([l]);
    assert.equal(r.nome, '');
    assert.equal(r.perguntar, true);
    const [l2] = criarClassificador({ despesas, receitas, regras: [r] }).classificarExtrato(lerExtrato(csv.replace('25,90', '99,00'), 'Nubank.csv'));
    assert.equal(l2.confianca, 'sugestao');
    assert.equal(l2.tipo, 'ACESSÓRIOS');
    assert.notEqual(l2.nome, 'Capinha de celular');
  });
  teste('Renomear parcela atualiza a compra inteira, cada uma com seu número', () => {
    const amazon = despesas.find((d) => d.nome === 'Amazon Monitores - Parcela 8/10');
    const serie = parcelasDaMesmaCompra(despesas, amazon);
    assert.equal(serie.length, 8, `achou ${serie.length} parcelas`);
    assert.ok(serie.some((d) => d.nome === 'Monitores' && d.parcelas === '1/10')); // a 1ª tinha outro nome
    assert.ok(serie.every((d) => /Monitores/.test(d.nome)));
    assert.equal(nomeDaParcela('Monitores LG', amazon), 'Monitores LG - Parcela 8/10');
    assert.equal(nomeDaParcela('Monitores LG - Parcela 1/10', serie.find((d) => d.parcelas === '3/10')), 'Monitores LG - Parcela 3/10');
    // linha com PARCELAS "6/10" mas nome "Parcela 7/10": vale o nome
    assert.equal(nomeDaParcela('Monitores LG', serie.find((d) => d.nome.endsWith('7/10'))), 'Monitores LG - Parcela 7/10');
    assert.equal(nomeDaParcela('Monitores LG', serie.find((d) => d.nome === 'Monitores')), 'Monitores LG - Parcela 1/10');
    const moto = despesas.find((d) => d.nome === 'Moto' && d.parcelas === '8/48');
    assert.equal(nomeDaParcela('Moto Honda', moto), 'Moto Honda');
  });
  teste('Classificação propaga para a mesma despesa; valor só para as seguintes', () => {
    const cond = despesas.find((d) => d.nome === 'Condomínio' && d.mesRef === '2026-08');
    const todos = mesmaDespesa(despesas, cond);
    assert.ok(todos.length >= 20 && todos.every((d) => d.nome === 'Condomínio'), `${todos.length}`);
    assert.deepEqual(lancamentosSeguintes(despesas, cond).map((d) => d.mesRef).sort(), ['2026-08', '2026-09']);
    // financiamento numerado (22/63) segue pelo nome, mesmo com valores diferentes ao longo do tempo
    const fin = despesas.find((d) => d.nome === 'Financiamento Carro' && d.mesRef === '2026-08');
    assert.ok(mesmaDespesa(despesas, fin).length >= 20);
    // marketplace com nome genérico: só ele mesmo
    const shopee = despesas.find((d) => d.nome === 'shopee');
    assert.deepEqual(mesmaDespesa(despesas, shopee), [shopee]);
    // compra parcelada no cartão: só as parcelas da compra
    const amazon = despesas.find((d) => d.nome === 'Amazon Monitores - Parcela 8/10');
    assert.equal(mesmaDespesa(despesas, amazon).length, 8);
    assert.deepEqual(lancamentosSeguintes(despesas, amazon), [amazon]);
  });
  teste('Recorrência inferida: contas mensais x gastos eventuais', () => {
    const r = inferirRecorrencia(despesas);
    const de = (nome) => r.get(despesas.find((d) => d.nome === nome));
    assert.equal(de('Condomínio'), 'MENSAL');
    assert.equal(de('Luz'), 'MENSAL');
    assert.equal(de('Financiamento Apartamento'), 'MENSAL');
    assert.equal(de('Feira'), 'EVENTUAL'); // muitos meses, mas várias vezes por mês
    assert.equal(de('Amazon Monitores - Parcela 8/10'), 'EVENTUAL'); // parcela de compra no cartão
  });
  teste('Previsão: contas mensais pelo último valor + parcelas restantes, sem duplicar compra', () => {
    const inf = inferirRecorrencia(despesas);
    const comRec = despesas.map((d) => ({ ...d, recorrencia: inf.get(d) }));
    const p = previsao({ despesas: comRec, receitas }, 12, '2026-10');
    const out = p.meses[0];
    assert.equal(out.itens.filter((i) => /Monitores/.test(i.nome)).length, 1); // 1ª parcela com outro nome não duplica
    assert.ok(out.itens.some((i) => i.grupo === 'mensal' && i.nome === 'Condomínio' && i.valor === 728.72));
    assert.ok(out.itens.some((i) => i.nome.startsWith('Financiamento Carro (23/63)')));
    assert.ok(!out.itens.some((i) => i.valor === 0));
    assert.ok(!p.meses[1].itens.some((i) => /Monitores/.test(i.nome))); // compra terminou em out/26
    assert.ok(Math.abs(out.total - (out.mensais + out.parcelas)) < 0.01 && out.receita > 0);
  });
  teste('Parcela seguinte com mesmo valor não é duplicata', () => {
    const l = criarClassificador({ despesas, receitas }).classificarExtrato(lerExtrato('date,title,amount\n2026-09-07,LIVELO - NuPay - Parcela 2/10,"299,48"', 'f.csv'))[0];
    assert.equal(l.possivelDuplicado, false);
    assert.equal(l.nome, 'LIVELO - Pneus - Parcela 2/10');
  });

  console.log('contas fixas (outubro/2026)');
  const fixas = montarFixas({ despesas, receitas, mesAlvo: '2026-10' });
  for (const f of fixas.despesas) {
    console.log(
      `    ${f.incluir ? '☑' : '☐'} ${f.nome.padEnd(32)} ${String(f.valor).padStart(8)} venc ${f.vencimento} ${f.parcelas.padEnd(6)} ${f.forma} ${f.instituicao}${f.jaLancado ? ' (já lançada)' : ''}`
    );
  }
  console.log('    via cartão:', fixas.viaCartao.join(', '));
  for (const f of fixas.receitas) console.log(`    ${f.incluir ? '☑' : '☐'} receita ${f.titular} ${f.tipo} ${f.valor}`);
  teste('Financiamento incrementa parcela', () =>
    assert.equal(fixas.despesas.find((f) => f.nome.startsWith('Financiamento Carro')).parcelas, '23/63'));
  teste('Assinaturas do cartão ficam fora do checklist', () =>
    assert.ok(fixas.viaCartao.includes('Netflix.Com') && !fixas.despesas.some((f) => f.nome === 'Netflix.Com')));
  teste('Linhas de fixas', () => {
    const l = fixasParaLinhas(fixas, '2026-10');
    assert.ok(l.despesas.every((d) => d.MES_DE_REFERENCIA === '10/2026'));
    assert.equal(l.despesas.find((d) => d.NOME_DESPESA === 'Condomínio').CATEGORIA, 'FIXO');
  });
  teste('Salário que chega por Pix (regra) sai do checklist de receitas', () => {
    const regras = [{ chave: '+ DOUGLAS SILVA BOTEELHO', destino: 'RECEITA', nome: 'Salario Douglas', tipo: 'Salario Douglas', categoria: 'FIXO', titular: 'DOUGLAS', usos: 0 }];
    const f2 = montarFixas({ despesas, receitas, mesAlvo: '2026-10', regras });
    assert.ok(!f2.receitas.some((x) => x.titular === 'DOUGLAS'));
    assert.ok(f2.receitas.some((x) => x.titular === 'LARISSA'));
    const pix = 'Data,Valor,Identificador,Descrição\n16/09/2026,2500.00,z9,Transferência recebida pelo Pix - DOUGLAS SILVA BOTEELHO - •••.989.188-•• - BCO BRADESCO S.A. (0237) Agência: 1 Conta: 2';
    const l = criarClassificador({ despesas, receitas, regras, titulares: { NUBANK: 'LARISSA' } }).classificarExtrato(lerExtrato(pix, 'NU_x.csv'))[0];
    assert.deepEqual([l.destino, l.tipo, l.titular, l.categoria, l.confianca], ['RECEITA', 'Salario Douglas', 'DOUGLAS', 'FIXO', 'certo']);
  });
  teste('Recorrente pago fora do Nubank entra no checklist mantendo a categoria', () => {
    const f = fixas.despesas.find((x) => x.nome.startsWith('Financiamento Apartamento'));
    assert.equal(f.categoria, 'VARIÁVEL');
    assert.ok(!fixas.despesas.some((x) => x.nome === 'Luz')); // Luz é paga pelo Nubank: vem no extrato
  });
}
console.log(`\n${ok} testes passaram${process.exitCode ? ' — HÁ FALHAS' : ''}`);
