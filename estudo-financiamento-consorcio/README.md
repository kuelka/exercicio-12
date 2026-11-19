# Financiar ou consorciar? (veículo, nov/2026)

Estudo comparativo entre financiamento de veículo (CDC, tabela Price) e consórcio, para um carro 0 km de R$ 100 mil,
com três administradoras (Rodobens, Itaú Consórcio e Porto Consórcio).

- `engine.js`: motor de cálculo (VP de cada estratégia, IOF PF, lances livre/embutido, ponto de equilíbrio).
- `cenarios.js`: gera `cenarios.json` e `cenarios.csv` com janelas de contemplação (1 a 80 meses),
  prazos de financiamento (36/48/60), três taxas de financiamento e três custos de mobilidade.
- `index.html`: página do estudo com gráficos, mapa de decisão e simulador (usa `engine.js`).

Rodar: `node cenarios.js`. Abrir `index.html` no navegador para o simulador.

Métrica: custo econômico em valor presente = VP(desembolsos) + VP(custo de ficar sem carro) − VP(revenda no mês 80),
descontado pelo CDB 100% do CDI líquido de IR. Estudo educativo, não é recomendação de investimento.
