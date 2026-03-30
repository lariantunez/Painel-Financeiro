# 💰 Painel Financeiro V2

Painel simples para análise de receitas e despesas por mês.

## Estrutura esperada

### Aba: DESPESAS
- **Coluna A**: Nome da Despesa
- **Coluna B**: Vencimento (formato: YYYY-MM-DD, ex: 2026-03-15)
- **Coluna C**: Valor (numérico, ex: 150.00)

### Aba: RECEITAS
- **Coluna A**: Nome (ex: Larissa, Douglas)
- **Coluna B**: Tipo (ex: Salário, Freelancer, etc)
- **Coluna C**: Valor (numérico, ex: 3000.00)

## Como usar

### 1. Abrir o painel
Rode um servidor local (importante para evitar `origin null`/CORS):

- Python 3:
  - `python -m http.server 8000`
  - Acesse `http://localhost:8000`
- ou `npm install -g serve && serve .`

### 2. Selecionar mês/ano
Use o campo "Mês/Ano" na seção de filtros para mudar o período de análise.

### 3. Importar dados
Clique em "📥 Importar do Google Sheets"

Opções:
- **A)** Informe o URL da planilha no campo “URL ou ID da Planilha” e o dashboard tentará ler as abas `Despesas` e `Receitas` automaticamente (precisa estar publicada/visível publicamente no Google Sheets para permitir fetch)
- **B)** Cole o JSON no mesmo campo usando o formato acima para importação direta

### Formato JSON esperado

```json
{
  "despesas": [
    {
      "nomeDespesa": "Aluguel",
      "vencimento": "2026-03-10",
      "valor": 1500.00
    },
    {
      "nomeDespesa": "Alimentação",
      "vencimento": "2026-03-15",
      "valor": 280.50
    }
  ],
  "receitas": [
    {
      "nome": "Larissa",
      "tipo": "Salário",
      "valor": 3000.00
    },
    {
      "nome": "Douglas",
      "tipo": "Freelancer",
      "valor": 1200.00
    }
  ]
}
```

## Funcionalidades

✅ **Cards principais**: Receita, Despesa e Saldo
✅ **Filtro por Mês/Ano**: Análise mês a mês
✅ **2 Abas**: Despesas e Receitas separadas
✅ **Armazenamento local**: LocalStorage (persiste dados no navegador)
✅ **Design responsivo**: Funciona em desktop e mobile

## Próximas etapas (conforme solicitado)

- Integração direta com Google Sheets API
- Gráficos de evolução mensal
- Categorização de despesas
- Relatório comparativo (mês anterior)
