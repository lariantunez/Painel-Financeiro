# Painel Financeiro

Painel de receitas e despesas que lê e **alimenta sozinho** a planilha do Google Sheets a partir dos extratos do banco.

Publicado em: https://lariantunez.github.io/Painel-Financeiro/

## Rotina mensal

1. **Importar** → arraste a fatura do cartão e o extrato da conta (CSV do Nubank, OFX de qualquer banco ou CSV genérico).
2. **Contas do mês** → o painel lista as contas mensais com vencimento e parcela já calculados; você só confirma se ainda existe, o valor e se já pagou. Salários entram no mesmo passo.
3. **Revisar** → só aparecem os lançamentos novos ou duvidosos. O que você decidir vale para todos os lançamentos iguais e fica memorizado para os próximos meses.
4. **Enviar** → as linhas vão para a planilha. Cada importação pode ser desfeita.

## Telas

- **Painel** — período de um ou vários meses: receitas, despesas, saldo, tipos, composição (mensal × eventual, fixo × variável), contas a pagar, parcelamentos e lançamentos editáveis (nome, tipo, valor, categoria, recorrência, status).
- **Previsão** — próximos 6/12 meses: contas mensais (último valor) + parcelas restantes × receitas previstas.
- **Importar** — extratos + contas do mês + revisão.
- **Aprendizado** — regras memorizadas.

## Classificação das despesas

| Campo | Valores | Significado |
|---|---|---|
| Categoria | Fixo / Variável | o valor se repete ou muda (ou é lançamento único) |
| Recorrência | Mensal / Eventual | conta paga todo mês ou gasto que acontece ao longo do mês |

Mudar nome, tipo, categoria ou recorrência vale para todos os lançamentos da mesma despesa; mudar o valor (reajuste) vale para o lançamento e os seguintes.

## Como o painel classifica

Para cada lançamento do extrato, nesta ordem:

| Etapa | Exemplo |
|---|---|
| Movimentos que não são gasto | Pagamento de fatura, caixinha/RDB → ignorados |
| Continuação de parcelamento | "Amazon - Parcela 9/10" + parcela 8/10 já na planilha → copia nome e tipo |
| Regra aprendida (aba `Regras`) | Tudo que você já classificou numa importação |
| Histórico da planilha | "Netflix.Com" lançado 10× como ENTRETENIMENTO/FIXO |
| Semelhança | "Carrefour Mercado" ≈ "Carrefour" → sugere e pede confirmação |
| Novo | Pergunta para você |

Na tela **Aprendizado** dá para corrigir ou apagar regras e marcar lançamentos ambíguos (ex.: Pix para uma pessoa) como "perguntar sempre".

## Arquitetura

- **Frontend** estático (GitHub Pages), JavaScript puro em módulos — sem build.
- **Backend** em Google Apps Script ([`apps-script/Codigo.gs`](apps-script/Codigo.gs)) ligado à planilha: lê os dados, grava lançamentos sem duplicar (coluna `ID_IMPORTACAO`), guarda as regras na aba `Regras` e o histórico na aba `Importacoes`. Protegido por token — a planilha pode ficar privada.
- Sem o backend o painel funciona em modo leitura (planilha pública) e a importação termina copiando as linhas para colar.

```
index.html
css/styles.css
js/
  main.js               rotas e atualização automática
  api.js                backend / planilha pública / cache local
  parsers.js            leitura de CSV e OFX
  classifier.js         classificação e aprendizado
  fixas.js              checklist de contas fixas
  analise.js            cálculos do painel
  model.js, util.js     modelo de dados e utilitários
  ui.js                 gráficos SVG, tooltip, avisos
  pagina-*.js           telas
apps-script/Codigo.gs   backend
tests/teste-logica.mjs  testes (node tests/teste-logica.mjs [pasta-com-csvs])
```

## Instalação do backend (uma vez)

Passo a passo dentro do próprio painel em **Configurações**. Resumo: colar `Codigo.gs` em Extensões → Apps Script, executar `configurar`, implantar como App da Web e colar URL + token no painel.

## Rodar localmente

```bash
python -m http.server 8000   # abra http://localhost:8000
```
