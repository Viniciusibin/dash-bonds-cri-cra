# dash-bonds-cri-cra

## CVM

O backend agora expõe uma base inicial para enriquecimento com dados da CVM:

- `POST /api/cvm/refresh`
  Faz download e cache local do `cad_cia_aberta.csv` e do `dfp_cia_aberta_<ano>.zip`.
  Exemplo de payload: `{"year": 2025, "force": false}`

- `GET /api/cvm/companies?q=energisa&active_only=1`
  Busca companhias por razão social, nome comercial, setor, CNPJ ou código CVM.

- `GET /api/cvm/company/00.864.214/0001-06?year=2025`
- `GET /api/cvm/company/015253?year=2025`
  Retorna cadastro + snapshot financeiro anual.

### Métricas calculadas

- `cash`: caixa e equivalentes de caixa
- `current_debt`: dívida de curto prazo
- `non_current_debt`: dívida de longo prazo
- `gross_debt`: soma da dívida de curto e longo prazo
- `net_debt`: dívida bruta menos caixa
- `ebit`: proxy de EBIT a partir da DRE
- `depreciation_amortization`: D&A a partir da DVA
- `ebitda_proxy`: `ebit + depreciation_amortization`
- `nd_ebitda`: `net_debt / ebitda_proxy`

### Observações importantes

- O parser prioriza demonstrações consolidadas.
- O cálculo usa apenas contas fixas (`ST_CONTA_FIXA = S`) para reduzir dupla contagem.
- O maior ponto em aberto continua sendo o vínculo entre `papel ANBIMA` e `companhia CVM`.
  A base da CVM está pronta para isso, mas o matching precisa de uma camada dedicada.
