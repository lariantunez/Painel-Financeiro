// Tela de regras aprendidas: o histórico de como cada descrição do banco é classificada.
// Alterar uma regra vale para as próximas importações e também corrige os lançamentos já importados.

import { escapeHtml, rotulo, somarMeses, mesAtual, RX_PARCELA, parseParcela } from './util.js';
import { CATEGORIAS, chaveDescricao, ehMarketplace } from './classifier.js';
import { valoresUsados, regraParaLinha } from './model.js';
import { nomeDaParcela } from './analise.js';
import { backendConfigurado, enviar, salvarRegrasLocais, config } from './api.js';
import { toast, $, $$, cabecalho, ordenar, ligarOrdenacao, dataOrdenavel } from './ui.js';

const COLUNAS = [
  { id: 'chave', rotulo: 'Como vem no banco' },
  { id: 'destino', rotulo: 'Vira' },
  { id: 'nome', rotulo: 'Nome no painel' },
  { id: 'tipo', rotulo: 'Tipo / quem recebe' },
  { id: 'categoria', rotulo: 'Categoria' },
  { id: 'recorrencia', rotulo: 'Recorrência' },
  { id: 'perguntar', rotulo: 'Perguntar', desc: true },
  { id: 'usos', rotulo: 'Usos', classe: 'num', desc: true },
  { id: 'atualizado', rotulo: 'Atualizado', desc: true },
  { id: '', rotulo: '' },
];
const VALOR = {
  chave: (r) => r.chave.replace(/^\+ /, ''),
  destino: (r) => r.destino,
  nome: (r) => r.nome,
  tipo: (r) => (r.destino === 'RECEITA' ? r.titular : r.tipo),
  categoria: (r) => r.categoria,
  recorrencia: (r) => r.recorrencia,
  perguntar: (r) => (r.perguntar ? 1 : 0),
  usos: (r) => r.usos,
  atualizado: (r) => dataOrdenavel(String(r.atualizado).split(' ')[0]),
};
const ordem = { col: 'atualizado', dir: -1 };
const RECORRENCIAS = [['MENSAL', 'Mensal'], ['EVENTUAL', 'Eventual']];

let busca = '';
let alteradas = new Map();
let excluidas = new Set();

// Lançamentos já importados que cada regra reconhece (pela descrição original do banco)
function lancamentosDaRegra(dados) {
  const mapa = new Map();
  const add = (chave, aba, l) => {
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push({ aba, l });
  };
  for (const d of dados.despesas) if (d.descOriginal) add(chaveDescricao(d.descOriginal), 'despesas', d);
  for (const r of dados.receitas) if (r.descOriginal) add(`+ ${chaveDescricao(r.descOriginal)}`, 'receitas', r);
  return mapa;
}

export function renderAprendizado(raiz, app) {
  const { dados } = app.estado;
  if (!dados) {
    raiz.innerHTML = '<div class="vazio">Carregando…</div>';
    return;
  }
  const tipos = valoresUsados(dados.despesas.filter((d) => d.mesRef >= somarMeses(mesAtual(), -12)), 'tipo').sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const titulares = [...new Set([...Object.values(config.titulares), ...valoresUsados(dados.receitas, 'nome')].filter(Boolean))];
  const usados = lancamentosDaRegra(dados);
  const regras = dados.regras.filter((r) => !excluidas.has(r.chave)).map((r) => alteradas.get(r.chave) || r);
  const termo = rotulo(busca);
  const visiveis = ordenar(regras.filter((r) => !termo || rotulo(`${r.chave} ${r.nome} ${r.tipo} ${r.titular}`).includes(termo)), ordem, VALOR);
  const pendente = alteradas.size + excluidas.size;

  raiz.innerHTML = `
    <div class="cabecalho-pagina"><h1 style="font-size:22px;margin:0">Aprendizado</h1>
      <div style="display:flex;gap:8px">${pendente ? `<button class="btn" id="descartar">Descartar</button><button class="btn btn-primario" id="salvar">Salvar ${pendente} alteração(ões)</button>` : ''}</div></div>
    <p class="text-2" style="margin-top:-8px">Cada classificação que você faz numa importação fica guardada aqui: como a descrição vem no banco e como ela aparece no painel. Ao alterar uma regra, a mudança vale para as próximas importações <b>e corrige os lançamentos já importados</b> com essa descrição.</p>
    <div class="resumo">
      <div class="card"><div class="muted small">Regras</div><div class="valor">${regras.length}</div></div>
      <div class="card"><div class="muted small">Despesas</div><div class="valor">${regras.filter((r) => r.destino === 'DESPESA').length}</div></div>
      <div class="card"><div class="muted small">Receitas</div><div class="valor">${regras.filter((r) => r.destino === 'RECEITA').length}</div></div>
      <div class="card"><div class="muted small">Ignoradas</div><div class="valor">${regras.filter((r) => r.destino === 'IGNORAR').length}</div></div>
    </div>
    <div class="card">
      <div class="ferramentas"><input class="input input-sm" id="busca-regra" placeholder="Buscar pelo nome do banco ou do painel…" value="${escapeHtml(busca)}"></div>
      ${
        visiveis.length
          ? `<div class="tabela-wrap"><table class="tabela tabela-regras">${cabecalho(COLUNAS, ordem)}<tbody>
        ${visiveis.map((r) => linha(r, tipos, titulares, (usados.get(r.chave) || []).length)).join('')}</tbody></table></div>`
          : `<div class="vazio">${regras.length ? 'Nada encontrado.' : 'Ainda não há regras. Elas são criadas na sua primeira importação.'}</div>`
      }
    </div>`;

  $('#busca-regra', raiz).addEventListener('input', (e) => {
    busca = e.target.value;
    const pos = e.target.selectionStart;
    renderAprendizado(raiz, app);
    const novo = $('#busca-regra', raiz);
    novo.focus();
    novo.setSelectionRange(pos, pos);
  });
  ligarOrdenacao(raiz, COLUNAS, ordem, () => renderAprendizado(raiz, app));
  $('#descartar', raiz)?.addEventListener('click', () => {
    alteradas = new Map();
    excluidas = new Set();
    renderAprendizado(raiz, app);
  });
  $('#salvar', raiz)?.addEventListener('click', (e) => salvar(e.target, app, usados));

  for (const tr of $$('tr[data-chave]', raiz)) {
    const chave = tr.dataset.chave;
    const atual = () => alteradas.get(chave) || { ...dados.regras.find((r) => r.chave === chave) };
    tr.addEventListener('change', (e) => {
      const c = e.target.dataset.c;
      if (!c) return;
      const r = atual();
      r[c] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (r.destino === 'RECEITA' && c === 'nome') r.tipo = r.nome; // na receita, o nome no painel é a descrição
      alteradas.set(chave, r);
      renderAprendizado(raiz, app);
    });
    $('[data-excluir]', tr).addEventListener('click', () => {
      excluidas.add(chave);
      alteradas.delete(chave);
      renderAprendizado(raiz, app);
    });
  }
}

function linha(r, tipos, titulares, qtd) {
  const opc = (lista, atual) => `${atual && !lista.includes(atual) ? `<option selected>${escapeHtml(atual)}</option>` : ''}${lista.map((t) => `<option ${t === atual ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}`;
  const ignorar = r.destino === 'IGNORAR';
  const receita = r.destino === 'RECEITA';
  const marketplace = ehMarketplace(r.chave);
  const mudou = alteradas.has(r.chave);
  return `<tr data-chave="${escapeHtml(r.chave)}" class="${mudou ? 'regra-alterada' : ''}">
    <td><span class="mono">${escapeHtml(r.chave.replace(/^\+ /, ''))}</span>
      <span class="desc-original">${receita ? 'entrada · ' : ''}${qtd ? `${qtd} lançamento(s) importado(s)` : 'nenhum lançamento importado ainda'}</span></td>
    <td><select class="select select-sm" data-c="destino">${['DESPESA', 'RECEITA', 'IGNORAR'].map((d) => `<option value="${d}" ${d === r.destino ? 'selected' : ''}>${d[0] + d.slice(1).toLowerCase()}</option>`).join('')}</select></td>
    <td>${ignorar ? '<span class="muted small">não vai para a planilha</span>' : marketplace ? '<span class="muted small" title="Compras em marketplace: o nome é dado em cada compra">cada compra recebe seu nome</span>' : `<input class="input input-sm" data-c="nome" value="${escapeHtml(r.nome)}">`}</td>
    <td>${ignorar ? '' : receita ? `<select class="select select-sm" data-c="titular">${opc(titulares, r.titular)}</select>` : `<select class="select select-sm" data-c="tipo">${opc(tipos, r.tipo)}</select>`}</td>
    <td>${ignorar ? '' : `<select class="select select-sm" data-c="categoria">${opc(CATEGORIAS, r.categoria)}</select>`}</td>
    <td>${r.destino === 'DESPESA' ? `<select class="select select-sm" data-c="recorrencia">${r.recorrencia ? '' : '<option value="">—</option>'}${RECORRENCIAS.map(([v, t]) => `<option value="${v}" ${v === r.recorrencia ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}</td>
    <td style="text-align:center"><input type="checkbox" data-c="perguntar" ${r.perguntar ? 'checked' : ''} aria-label="Sempre perguntar"></td>
    <td class="num">${r.usos}</td>
    <td class="tab small text-2">${escapeHtml(String(r.atualizado || '').split(' ')[0])}</td>
    <td><button class="btn btn-sm btn-ghost btn-perigo" data-excluir aria-label="Apagar regra">Apagar</button></td>
  </tr>`;
}

// O que muda nos lançamentos já importados quando a regra muda
function correcoes(antes, depois, usados) {
  const alteracoes = [];
  if (depois.destino !== antes.destino || depois.destino === 'IGNORAR') return alteracoes; // trocar o destino não mexe no que já foi lançado
  for (const { aba, l } of usados.get(depois.chave) || []) {
    const campos = {};
    const parcelaDeCompra = parseParcela(l.parcelas)?.n > 1 && (RX_PARCELA.test(l.nome) || rotulo(l.forma).startsWith('CREDITO'));
    if (aba === 'despesas') {
      // compras parceladas mantêm o nome de cada compra (a mesma loja pode ter compras diferentes)
      if (depois.nome && depois.nome !== antes.nome && !parcelaDeCompra && !ehMarketplace(depois.chave)) {
        const nome = nomeDaParcela(depois.nome, l);
        if (nome !== l.nome) campos.NOME_DESPESA = nome;
      }
      if (depois.tipo && depois.tipo !== antes.tipo && depois.tipo !== l.tipo) campos.TIPO = depois.tipo;
      if (depois.recorrencia && depois.recorrencia !== antes.recorrencia && depois.recorrencia !== l.recorrencia) campos.RECORRENCIA = depois.recorrencia;
    } else {
      if (depois.nome && depois.nome !== antes.nome && depois.nome !== l.tipo) campos.TIPO = depois.nome;
      if (depois.titular && depois.titular !== antes.titular && depois.titular !== l.nome) campos.NOME = depois.titular;
    }
    if (depois.categoria && depois.categoria !== antes.categoria && rotulo(depois.categoria) !== rotulo(l.categoria)) campos.CATEGORIA = depois.categoria;
    if (Object.keys(campos).length) alteracoes.push({ aba, linha: l._linha, nome: aba === 'despesas' ? l.nome : l.tipo, campos });
  }
  return alteracoes;
}

async function salvar(botao, app, usados) {
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  const regras = [...alteradas.values()];
  const excluir = [...excluidas];
  try {
    if (!backendConfigurado()) {
      salvarRegrasLocais(regras, excluir);
      toast('Aprendizado atualizado neste navegador');
    } else {
      await enviar('regras', { regras: regras.map(regraParaLinha), excluir });
      const alteracoes = regras.flatMap((r) => correcoes(app.estado.dados.regras.find((x) => x.chave === r.chave) || {}, r, usados));
      let corrigidos = 0;
      if (alteracoes.length) {
        const res = await enviar('status', { alteracoes });
        corrigidos = res.alteradas || 0;
        if (res.erros?.length) toast(`Alguns lançamentos não foram corrigidos: ${res.erros[0]}`, 'erro', 8000);
      }
      toast(corrigidos ? `Aprendizado atualizado · ${corrigidos} lançamento(s) corrigido(s) na planilha` : 'Aprendizado atualizado');
    }
    alteradas = new Map();
    excluidas = new Set();
    await app.recarregar();
  } catch (e) {
    toast(e.message, 'erro', 6000);
    botao.disabled = false;
    botao.textContent = 'Salvar';
  }
}
