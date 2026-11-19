// Gera as tabelas de cenários do estudo: node cenarios.js  (grava cenarios.json e cenarios.csv)
const fs = require('fs');
const path = require('path');
const M = require('./engine.js');

// Premissas de mercado (nov/2026) e as três administradoras analisadas
const ADMS = [
  { id: 'rodobens', nome: 'Rodobens', taxaAdm: 0.1, fundoReserva: 0.02, prazoCons: 80 },
  { id: 'itau', nome: 'Itaú Consórcio', taxaAdm: 0.12, fundoReserva: 0.02, prazoCons: 80 },
  { id: 'porto', nome: 'Porto Consórcio', taxaAdm: 0.136, fundoReserva: 0.02, prazoCons: 80 },
];
const TAXAS_FIN = [
  { id: 'montadora', nome: 'Banco de montadora (1,49% a.m.)', taxaFinM: 0.0149 },
  { id: 'mediana', nome: 'Mediana do mercado (1,73% a.m.)', taxaFinM: 0.0173 },
  { id: 'mediaBC', nome: 'Média BC (1,97% a.m.)', taxaFinM: 0.0197 },
];
const JANELAS = [1, 3, 6, 12, 18, 24, 36, 48, 60, 72, 80];
const MOBILIDADE = [0, 1000, 2500];
const PRAZOS_FIN = [36, 48, 60];

const base = M.defaults();
const out = { base, adms: ADMS, taxasFin: TAXAS_FIN, janelas: JANELAS, cenarios: [] };
const csv = ['mobilidade;prazoFin;estrategia;janela;vp;desembolso;revenda;custoMobilidade;taxaImplicitaAa'];
const r0 = (x) => Math.round(x);

for (const mob of MOBILIDADE) {
  for (const prazoFin of PRAZOS_FIN) {
    const p0 = { ...base, mobilidade: mob, prazoFin };
    const bloco = { mobilidade: mob, prazoFin, financiamento: {}, consorcio: {}, poupar: null, aVista: null, breakEven: {} };
    for (const t of TAXAS_FIN) {
      const p = { ...p0, taxaFinM: t.taxaFinM };
      const f = M.vpFinanciamento(p);
      bloco.financiamento[t.id] = { vp: r0(f.vp), pmt: r0(f.det.pmt), total: r0(f.det.totalPago), cetA: f.det.cetA, iof: r0(f.det.iof) };
      csv.push([mob, prazoFin, 'fin-' + t.id, 0, r0(f.vp), r0(f.desembolso), r0(f.revenda), 0, ''].join(';'));
    }
    for (const a of ADMS) {
      const p = { ...p0, ...a };
      bloco.consorcio[a.id] = {};
      for (const k of JANELAS) {
        const c = M.vpConsorcio(p, k);
        const tx = c.taxaImplicitaM === null ? null : M.aFromM(c.taxaImplicitaM);
        bloco.consorcio[a.id][k] = { vp: r0(c.vp), taxaImplicitaAa: tx };
        csv.push([mob, prazoFin, 'cons-' + a.id, k, r0(c.vp), r0(c.desembolso), r0(c.revenda), r0(c.mobilidade), tx === null ? '' : tx.toFixed(4)].join(';'));
      }
      bloco.consorcio[a.id].esperado = r0(M.vpConsorcioEsperado(p));
      bloco.breakEven[a.id] = {};
      for (const t of TAXAS_FIN) bloco.breakEven[a.id][t.id] = M.breakEven({ ...p, taxaFinM: t.taxaFinM });
    }
    const pp = M.vpPoupar({ ...p0 });
    bloco.poupar = pp && { vp: r0(pp.vp), mes: pp.mes };
    bloco.aVista = { vp: r0(M.vpAVista(p0).vp) };
    out.cenarios.push(bloco);
  }
}

// Sensibilidades (prazo fin 48, mobilidade R$ 1.000, Itaú, contemplação mês 12)
const sens = {};
const pS = { ...base, ...ADMS[1] };
sens.cdi = [0.09, 0.105, 0.12, 0.135, 0.15].map((cdi) => {
  const p = { ...pS, cdi };
  return { cdi, fin: r0(M.vpFinanciamento(p).vp), cons12: r0(M.vpConsorcio(p, 12).vp), consEsp: r0(M.vpConsorcioEsperado(p)), be: M.breakEven(p) };
});
sens.taxaAdm = [0.065, 0.1, 0.12, 0.15, 0.175, 0.2].map((taxaAdm) => {
  const p = { ...pS, taxaAdm };
  return { taxaAdm, cons12: r0(M.vpConsorcio(p, 12).vp), be: M.breakEven(p) };
});
sens.lance = [0, 0.1, 0.2, 0.3].map((l) => {
  const p = { ...pS, lanceLivrePct: l };
  return { lanceLivre: l, cons1: r0(M.vpConsorcio(p, 1).vp), cons6: r0(M.vpConsorcio(p, 6).vp) };
});
sens.embutido = [0, 0.15, 0.25, 0.3].map((e) => {
  const p = { ...pS, lanceEmbutidoPct: e };
  return { embutido: e, cons1: r0(M.vpConsorcio(p, 1).vp), cons3: r0(M.vpConsorcio(p, 3).vp) };
});
out.sensibilidade = sens;

// Mapa de decisão: VP(consórcio na janela k) − VP(financiamento mediano), por custo de mobilidade
const MOB_GRID = [0, 500, 1000, 1500, 2000, 2500, 3000];
out.mapa = {};
for (const a of ADMS) {
  out.mapa[a.id] = JANELAS.map((k) => MOB_GRID.map((mob) => {
    const p = { ...base, ...a, mobilidade: mob };
    return r0(M.vpConsorcio(p, k).vp - M.vpFinanciamento(p).vp);
  }));
}
out.mobGrid = MOB_GRID;
// Custo de mobilidade a partir do qual o financiamento passa a vencer o consórcio por sorteio (esperado)
out.mobEquilibrio = {};
for (const a of ADMS) {
  out.mobEquilibrio[a.id] = {};
  for (const t of TAXAS_FIN) {
    let lo = 0, hi = 10000;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      const p = { ...base, ...a, taxaFinM: t.taxaFinM, mobilidade: mid };
      if (M.vpConsorcioEsperado(p) < M.vpFinanciamento(p).vp) lo = mid; else hi = mid;
    }
    out.mobEquilibrio[a.id][t.id] = r0(lo);
  }
}
let lo = 0, hi = 10000;
for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; const p = { ...base, mobilidade: mid }; if (M.vpPoupar(p).vp < M.vpFinanciamento(p).vp) lo = mid; else hi = mid; }
out.mobEquilibrioPoupar = r0(lo);

fs.writeFileSync(path.join(__dirname, 'cenarios.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, 'cenarios.csv'), csv.join('\n') + '\n');

// Resumo no terminal
for (const b of out.cenarios.filter((b) => b.prazoFin === 48)) {
  console.log(`\n== mobilidade R$ ${b.mobilidade}/mês · financiamento 48m`);
  for (const t of TAXAS_FIN) console.log('  fin', t.id.padEnd(10), b.financiamento[t.id]);
  console.log('  poupar', b.poupar, ' à vista', b.aVista);
  for (const a of ADMS) {
    const row = JANELAS.map((k) => `${k}:${(b.consorcio[a.id][k].vp / 1000).toFixed(1)}k`).join(' ');
    console.log('  ', a.id.padEnd(9), row, ' esp', (b.consorcio[a.id].esperado / 1000).toFixed(1) + 'k', ' BE', JSON.stringify(b.breakEven[a.id]));
  }
}
console.log('\nTaxa implícita Itaú (a.a.) por janela:', JANELAS.map((k) => `${k}:${(out.cenarios[3].consorcio.itau[k].taxaImplicitaAa * 100).toFixed(1)}%`).join(' '));
console.log('\nmobEquilibrio', JSON.stringify(out.mobEquilibrio), 'poupar', out.mobEquilibrioPoupar);
console.log('mapa itau', JSON.stringify(out.mapa.itau));
console.log('\nSensibilidade', JSON.stringify(sens, null, 0));
