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
    assert.ok(dl.every((d) => d.MES_DE_REFERENCIA === '09/2026' && d.ID_IMPORTACAO));
    assert.equal(rl.length, 1);
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
    assert.ok(l.despesas.every((d) => d.CATEGORIA === 'FIXO' && d.MES_DE_REFERENCIA === '10/2026'));
  });
}
console.log(`\n${ok} testes passaram${process.exitCode ? ' — HÁ FALHAS' : ''}`);
