// Tela de regras aprendidas: ver, corrigir e apagar.

import { escapeHtml, rotulo, somarMeses, mesAtual } from './util.js';
import { CATEGORIAS } from './classifier.js';
import { valoresUsados, regraParaLinha } from './model.js';
import { backendConfigurado, enviar, salvarRegrasLocais } from './api.js';
import { toast, $, $$ } from './ui.js';

let busca = '';
let alteradas = new Map();
let excluidas = new Set();

export function renderAprendizado(raiz, app) {
  const { dados } = app.estado;
  if (!dados) {
    raiz.innerHTML = '<div class="vazio">Carregando…</div>';
    return;
  }
  const tipos = valoresUsados(dados.despesas.filter((d) => d.mesRef >= somarMeses(mesAtual(), -12)), 'tipo').sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const regras = dados.regras.filter((r) => !excluidas.has(r.chave)).map((r) => alteradas.get(r.chave) || r);
  const termo = rotulo(busca);
  const visiveis = regras.filter((r) => !termo || rotulo(`${r.chave} ${r.nome} ${r.tipo}`).includes(termo)).sort((a, b) => b.usos - a.usos || a.chave.localeCompare(b.chave));
  const pendente = alteradas.size + excluidas.size;

  raiz.innerHTML = `
    <div class="cabecalho-pagina"><h1 style="font-size:22px;margin:0">Aprendizado</h1>
      <div style="display:flex;gap:8px">${pendente ? `<button class="btn" id="descartar">Descartar</button><button class="btn btn-primario" id="salvar">Salvar ${pendente} alteração(ões)</button>` : ''}</div></div>
    <p class="text-2" style="margin-top:-8px">Cada vez que você classifica um lançamento novo, o painel guarda aqui como reconhecê-lo. Além dessas regras, ele também consulta todo o histórico da planilha.</p>
    <div class="resumo">
      <div class="card"><div class="muted small">Regras</div><div class="valor">${regras.length}</div></div>
      <div class="card"><div class="muted small">Despesas</div><div class="valor">${regras.filter((r) => r.destino === 'DESPESA').length}</div></div>
      <div class="card"><div class="muted small">Receitas</div><div class="valor">${regras.filter((r) => r.destino === 'RECEITA').length}</div></div>
      <div class="card"><div class="muted small">Sempre perguntar</div><div class="valor">${regras.filter((r) => r.perguntar).length}</div></div>
    </div>
    <div class="card">
      <div class="ferramentas"><input class="input input-sm" id="busca-regra" placeholder="Buscar…" value="${escapeHtml(busca)}"></div>
      ${
        visiveis.length
          ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Como aparece no banco</th><th>Vira</th><th>Nome na planilha</th><th>Tipo</th><th>Categoria</th><th title="Sempre perguntar">Perguntar</th><th class="num">Usos</th><th></th></tr></thead><tbody>
        ${visiveis.map((r) => linha(r, tipos)).join('')}</tbody></table></div>`
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
  $('#descartar', raiz)?.addEventListener('click', () => {
    alteradas = new Map();
    excluidas = new Set();
    renderAprendizado(raiz, app);
  });
  $('#salvar', raiz)?.addEventListener('click', (e) => salvar(e.target, app));

  for (const tr of $$('tr[data-chave]', raiz)) {
    const chave = tr.dataset.chave;
    const atual = () => alteradas.get(chave) || { ...dados.regras.find((r) => r.chave === chave) };
    tr.addEventListener('change', (e) => {
      const c = e.target.dataset.c;
      if (!c) return;
      const r = atual();
      r[c] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
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

function linha(r, tipos) {
  const opc = (lista, atual) => `${atual && !lista.includes(atual) ? `<option selected>${escapeHtml(atual)}</option>` : ''}${lista.map((t) => `<option ${t === atual ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}`;
  const ehDespesa = r.destino === 'DESPESA';
  return `<tr data-chave="${escapeHtml(r.chave)}">
    <td class="mono">${escapeHtml(r.chave.replace(/^\+ /, '↓ '))}</td>
    <td><select class="select select-sm" data-c="destino">${['DESPESA', 'RECEITA', 'IGNORAR'].map((d) => `<option value="${d}" ${d === r.destino ? 'selected' : ''}>${d[0] + d.slice(1).toLowerCase()}</option>`).join('')}</select></td>
    <td><input class="input input-sm" data-c="nome" value="${escapeHtml(r.nome)}" ${r.destino === 'IGNORAR' ? 'disabled' : ''}></td>
    <td>${ehDespesa ? `<select class="select select-sm" data-c="tipo">${opc(tipos, r.tipo)}</select>` : r.destino === 'RECEITA' ? `<input class="input input-sm" data-c="tipo" value="${escapeHtml(r.tipo)}">` : ''}</td>
    <td>${r.destino === 'IGNORAR' ? '' : `<select class="select select-sm" data-c="categoria">${opc(CATEGORIAS, r.categoria)}</select>`}</td>
    <td style="text-align:center"><input type="checkbox" data-c="perguntar" ${r.perguntar ? 'checked' : ''} aria-label="Sempre perguntar"></td>
    <td class="num">${r.usos}</td>
    <td><button class="btn btn-sm btn-ghost btn-perigo" data-excluir aria-label="Apagar regra">Apagar</button></td>
  </tr>`;
}

async function salvar(botao, app) {
  botao.disabled = true;
  const regras = [...alteradas.values()];
  const excluir = [...excluidas];
  try {
    if (backendConfigurado()) await enviar('regras', { regras: regras.map(regraParaLinha), excluir });
    else salvarRegrasLocais(regras, excluir);
    toast('Aprendizado atualizado');
    alteradas = new Map();
    excluidas = new Set();
    await app.recarregar();
  } catch (e) {
    toast(e.message, 'erro', 6000);
    botao.disabled = false;
  }
}
