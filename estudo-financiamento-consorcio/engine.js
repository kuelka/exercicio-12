/*
 * Motor de cálculo: financiamento (CDC, tabela Price) × consórcio × poupar e comprar à vista.
 *
 * Métrica principal: CUSTO ECONÔMICO EM VALOR PRESENTE (VP), em R$ de hoje, no horizonte T:
 *   VP(desembolsos)                         entrada, parcelas, lances, tarifas
 * + VP(custo de mobilidade sem carro)       meses em que ainda não há carro
 * − VP(valor de revenda do carro em T)      carro comprado mais tarde vale mais em T
 * Desconto pela taxa líquida de um CDB 100% do CDI (custo de oportunidade).
 * Menor VP = melhor. Todas as estratégias usam o mesmo horizonte T.
 */
(function (root) {
  'use strict';

  const mFromA = (a) => Math.pow(1 + a, 1 / 12) - 1; // taxa anual -> mensal
  const aFromM = (m) => Math.pow(1 + m, 12) - 1; // taxa mensal -> anual

  function defaults() {
    return {
      preco: 100000, // preço do carro hoje (R$)
      ipca: 0.045, // reajuste anual do preço do carro / da carta (a.a.)
      cdi: 0.12, // CDI médio no horizonte (a.a.)
      ir: 0.15, // IR sobre renda fixa > 720 dias
      deprec: 0.1, // depreciação anual frente ao carro 0 km
      mobilidade: 1000, // custo líquido mensal de ficar sem carro (R$ de hoje)
      // financiamento
      entradaPct: 0.2,
      taxaFinM: 0.0173, // a.m.
      prazoFin: 48,
      tarifas: 1300, // cadastro + registro de contrato (gravame)
      // consórcio
      taxaAdm: 0.12, // sobre o crédito, no plano inteiro
      fundoReserva: 0.02,
      prazoCons: 80,
      lanceLivrePct: 0, // % da carta pago com recursos próprios na contemplação
      lanceEmbutidoPct: 0, // % da carta usado como lance embutido
      devolveFR: 0, // fração do fundo de reserva devolvida no encerramento
    };
  }

  // Taxa de desconto mensal líquida de IR
  function taxaDesconto(p) {
    return mFromA(p.cdi * (1 - p.ir));
  }

  // Índice de preço do carro/carta: reajuste anual em degraus (a cada 12 meses)
  const indice = (p, mes) => Math.pow(1 + p.ipca, Math.floor(mes / 12));

  // Valor de revenda em T de um carro comprado 0 km no mês tb
  function revenda(p, tb, T) {
    const novoEmT = p.preco * Math.pow(1 + p.ipca, T / 12);
    return novoEmT * Math.pow(1 - p.deprec, (T - tb) / 12);
  }

  function vpMobilidade(p, ateMes, r) {
    let s = 0;
    for (let m = 1; m <= ateMes; m++) s += (p.mobilidade * indice(p, m - 1)) / Math.pow(1 + r, m);
    return s;
  }

  /* ---------------- Financiamento (Price + IOF PF) ---------------- */
  function financiamento(p) {
    const i = p.taxaFinM;
    const n = p.prazoFin;
    const entrada = p.preco * p.entradaPct;
    const base = p.preco - entrada + p.tarifas;
    // IOF PF: 0,0082% a.d. sobre cada amortização (limitado a 365 dias) + 0,38% fixo, financiado.
    let principal = base;
    let iof = 0;
    for (let it = 0; it < 30; it++) {
      const pmt = (principal * i) / (1 - Math.pow(1 + i, -n));
      let saldo = principal;
      let iofDiario = 0;
      for (let j = 1; j <= n; j++) {
        const juros = saldo * i;
        const amort = pmt - juros;
        iofDiario += amort * 0.000082 * Math.min(30 * j, 365);
        saldo -= amort;
      }
      iof = iofDiario + principal * 0.0038;
      principal = base + iof;
    }
    const pmt = (principal * i) / (1 - Math.pow(1 + i, -n));
    // CET mensal: taxa que iguala (preço − entrada) às parcelas
    const cetM = irr([-(p.preco - entrada), ...Array(n).fill(pmt)].map((v) => -v));
    return { entrada, principal, iof, pmt, n, totalPago: entrada + pmt * n, cetM, cetA: aFromM(cetM) };
  }

  /* ---------------- Consórcio ----------------
   * Parcela = carta × (1 + taxa adm + fundo de reserva) / prazo, reajustada anualmente com a carta.
   * Lance (livre e/ou embutido) na contemplação abate o saldo e reduz as parcelas restantes.
   * Lance embutido: a carta contratada é maior (carta = preço / (1 − %embutido)), para que o crédito
   * líquido compre o carro.
   */
  function consorcio(p, k) {
    const n = p.prazoCons;
    const carta0 = p.preco / (1 - p.lanceEmbutidoPct);
    const fator = 1 + p.taxaAdm + p.fundoReserva;
    const fluxos = []; // fluxo do consorciado por mês (negativo = paga)
    let pctPago = 0; // fração do "valor total do plano" já quitada
    let fatorParcela = 1; // após lance, as parcelas restantes são reduzidas
    let lanceLivre = 0;
    for (let m = 1; m <= n; m++) {
      const carta = carta0 * indice(p, m - 1);
      const parcela = (carta * fator * fatorParcela) / n;
      let f = -parcela;
      pctPago += fatorParcela / n;
      if (m === k) {
        const creditoLiquido = carta * (1 - p.lanceEmbutidoPct);
        f += creditoLiquido; // carta usada na compra (ida e volta: carro adquirido)
        // lances, expressos em % da carta; abatem o saldo devedor (em % do plano)
        const lancePctPlano = (p.lanceLivrePct + p.lanceEmbutidoPct) / fator;
        lanceLivre = carta * p.lanceLivrePct;
        f -= lanceLivre;
        const restante = 1 - pctPago;
        const restanteApos = Math.max(0, restante - lancePctPlano);
        fatorParcela = restante > 0 ? (fatorParcela * restanteApos) / restante : 0;
      }
      fluxos.push(f);
    }
    // devolução do fundo de reserva não utilizado no fim do grupo
    const frPago = carta0 * p.fundoReserva * indice(p, n - 1);
    fluxos[n - 1] += frPago * p.devolveFR;
    return { fluxos, carta0, lanceLivre };
  }

  /* ---------------- VP das estratégias ---------------- */
  function horizonte(p) {
    return Math.max(p.prazoCons, p.prazoFin);
  }

  function vpFinanciamento(p) {
    const r = taxaDesconto(p);
    const T = horizonte(p);
    const f = financiamento(p);
    let vp = f.entrada;
    for (let j = 1; j <= f.n; j++) vp += f.pmt / Math.pow(1 + r, j);
    const vpRev = revenda(p, 0, T) / Math.pow(1 + r, T);
    return { vp: vp - vpRev, desembolso: vp, revenda: vpRev, mobilidade: 0, det: f };
  }

  function vpConsorcio(p, k) {
    const r = taxaDesconto(p);
    const T = horizonte(p);
    const c = consorcio(p, k);
    // desembolsos líquidos: parcelas + lance − carta, mais a compra do carro pelo preço do mês k
    let vp = 0;
    c.fluxos.forEach((f, idx) => (vp += -f / Math.pow(1 + r, idx + 1)));
    const precoK = p.preco * indice(p, k - 1); // carta reajustada = preço do carro no mês
    vp += precoK / Math.pow(1 + r, k);
    const mob = vpMobilidade(p, k - 1, r) + (p.mobilidade * indice(p, k - 1) * 0.5) / Math.pow(1 + r, k); // meio mês até retirar o carro
    const vpRev = revenda(p, k, T) / Math.pow(1 + r, T);
    // taxa implícita do consórcio (fluxo financeiro puro, sem carro/mobilidade)
    let tx = null;
    try {
      tx = irr(c.fluxos.map((v) => -v));
    } catch (e) {
      tx = null;
    }
    return { vp: vp + mob - vpRev, desembolso: vp, revenda: vpRev, mobilidade: mob, taxaImplicitaM: tx, det: c };
  }

  // Poupar a parcela do financiamento (mais a entrada) em CDB e comprar à vista quando der
  function vpPoupar(p) {
    const r = taxaDesconto(p);
    const T = horizonte(p);
    const f = financiamento(p);
    let saldo = f.entrada;
    let tb = null;
    for (let m = 1; m <= 600; m++) {
      saldo = saldo * (1 + r) + f.pmt;
      if (saldo >= p.preco * indice(p, m)) {
        tb = m;
        break;
      }
    }
    if (tb === null) return null;
    const vpCompra = (p.preco * indice(p, tb)) / Math.pow(1 + r, tb);
    const mob = vpMobilidade(p, tb, r);
    const tbEf = Math.min(tb, T);
    const vpRev = revenda(p, tbEf, T) / Math.pow(1 + r, T);
    return { vp: vpCompra + mob - vpRev, desembolso: vpCompra, revenda: vpRev, mobilidade: mob, mes: tb };
  }

  function vpAVista(p) {
    const r = taxaDesconto(p);
    const T = horizonte(p);
    const vpRev = revenda(p, 0, T) / Math.pow(1 + r, T);
    return { vp: p.preco - vpRev, desembolso: p.preco, revenda: vpRev, mobilidade: 0 };
  }

  // Custo esperado com contemplação por sorteio (distribuição uniforme entre os meses 1..n)
  function vpConsorcioEsperado(p) {
    let s = 0;
    for (let k = 1; k <= p.prazoCons; k++) s += vpConsorcio(p, k).vp;
    return s / p.prazoCons;
  }

  // Último mês de contemplação em que o consórcio ainda empata ou vence o financiamento
  function breakEven(p) {
    const fin = vpFinanciamento(p).vp;
    let ultimo = 0;
    for (let k = 1; k <= p.prazoCons; k++) if (vpConsorcio(p, k).vp <= fin) ultimo = k;
    return ultimo;
  }

  // TIR mensal por bisseção, fluxos na convenção "positivo = recebe"
  function irr(cf) {
    const npv = (r) => cf.reduce((s, v, t) => s + v / Math.pow(1 + r, t), 0);
    let lo = -0.05;
    let hi = 0.2;
    let flo = npv(lo);
    let fhi = npv(hi);
    if (flo * fhi > 0) throw new Error('sem TIR');
    for (let it = 0; it < 200; it++) {
      const mid = (lo + hi) / 2;
      const fm = npv(mid);
      if (flo * fm <= 0) {
        hi = mid;
        fhi = fm;
      } else {
        lo = mid;
        flo = fm;
      }
    }
    return (lo + hi) / 2;
  }

  const api = {
    defaults,
    mFromA,
    aFromM,
    taxaDesconto,
    financiamento,
    consorcio,
    vpFinanciamento,
    vpConsorcio,
    vpConsorcioEsperado,
    vpPoupar,
    vpAVista,
    breakEven,
    irr,
    horizonte,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Motor = api;
})(typeof window !== 'undefined' ? window : globalThis);
