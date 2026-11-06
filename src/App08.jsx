import React, { useState, useMemo, useRef, useLayoutEffect, useEffect } from "react";
// Motion (ex-Framer Motion): animações aceleradas por hardware, fluidas no APK e no desktop.
// Respeita a preferência de "movimento reduzido" do sistema por padrão.
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
// Plugin nativo do próprio app (android-extra/SalvarArquivoPlugin.java): abre o "Salvar como" do Android
const SalvarArquivo = registerPlugin("SalvarArquivo");
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, Area, AreaChart, ReferenceLine, ReferenceDot,
  PieChart, Pie
} from "recharts";

// ════════════════════════════════════════════════════════════════════════════
// LEITOR DA PLANILHA DA B3 (Movimentação) — calcula posição e preço médio
// ════════════════════════════════════════════════════════════════════════════
// Tipos de movimento que NÃO mexem na quantidade (são proventos/atualizações)
const B3_MOV_IGNORAR = new Set(["Rendimento","Dividendo","Juros Sobre Capital Próprio","Atualização"]);
// Tipos de movimento que SÃO proventos recebidos (entram como "realizado")
const B3_MOV_PROVENTO = new Set(["Rendimento","Dividendo","Juros Sobre Capital Próprio","Juros","Amortização","Rendimento Tributado","Leilão de Fração"]);
function b3Num(v) {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  // formato de cercadura da B3: "-R$ 0.15-" (hífens dos dois lados = visual, não sinal)
  if (s.startsWith("-") && s.endsWith("-")) s = s.slice(1, -1);
  s = s.replace(/[R$\s]/g,"");
  if (s.endsWith("-")) s = s.slice(0, -1);
  if (s.includes(",")) s = s.replace(/\./g,"").replace(",",".");
  return parseFloat(s);
}
function b3TickerDeProduto(produto) {
  const p = String(produto||"").trim();
  if (p.includes(" - ")) {
    const t = p.split(" - ")[0].trim().toUpperCase();
    if (/^[A-Z0-9]{4,6}$/.test(t)) return t;
  }
  if (/^tesouro/i.test(p)) return p.split(" - ")[0].trim(); // Tesouro: usa o nome
  return p.split(" - ")[0].trim().toUpperCase();
}
// Converte data da B3 ("dd/mm/aaaa") para ISO "aaaa-mm-dd"
function b3Data(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  // célula de data do Excel lida como número de série (dias desde 30/12/1899)
  if (typeof v === "number" || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (n > 20000 && n < 80000) return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0,10);
  }
  const s = String(v).trim();
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return m2[0];
  return null;
}

// Recebe as linhas (array de objetos) da aba Movimentação e devolve posições
function parseB3Movimentacao(linhas) {
  const pos = {};
  let lidas = 0, ignoradas = 0;
  for (const r of linhas) {
    const mov = String(r["Movimentação"] ?? r["Movimentacao"] ?? "").trim();
    const es  = String(r["Entrada/Saída"] ?? r["Entrada/Saida"] ?? "").trim();
    const prod = r["Produto"];
    const data = b3Data(r["Data"] ?? r["Data do Negócio"] ?? r["Data Negócio"]);
    if (!prod) continue;
    if (B3_MOV_IGNORAR.has(mov)) { ignoradas++; continue; }
    const qtd = b3Num(r["Quantidade"]);
    if (!isFinite(qtd) || qtd === 0) continue;
    let preco = b3Num(r["Preço unitário"] ?? r["Preco unitario"]);
    if (!isFinite(preco)) preco = null;
    const tk = b3TickerDeProduto(prod);
    if (!tk) continue;
    if (!pos[tk]) pos[tk] = { qtd:0, custo:0, qc:0, primeiraCompra:null, ultimaCompra:null, movs:[] };
    if (es === "Credito" || es === "Crédito") {
      pos[tk].qtd += qtd;
      if (preco) { pos[tk].custo += qtd*preco; pos[tk].qc += qtd; }
      if (data) {
        if (!pos[tk].primeiraCompra || data < pos[tk].primeiraCompra) pos[tk].primeiraCompra = data;
        if (!pos[tk].ultimaCompra || data > pos[tk].ultimaCompra) pos[tk].ultimaCompra = data;
        pos[tk].movs.push({ data, qtd:+qtd, preco:preco||0, tipo:"compra" });
      }
    } else if (es === "Debito" || es === "Débito") {
      pos[tk].qtd -= qtd;
      if (data) pos[tk].movs.push({ data, qtd:-qtd, preco:preco||0, tipo:"venda" });
    }
    lidas++;
  }
  const itens = [];
  const vendidos = []; // vendeu tudo: some da lista, mas o histórico de compras/vendas fica para a evolução
  for (const tk in pos) {
    const p = pos[tk];
    p.movs.sort((a,b)=>a.data<b.data?-1:1);
    const ehTesouro = /^tesouro/i.test(tk);
    const qtdFinal = ehTesouro ? +p.qtd.toFixed(4) : Math.round(p.qtd); // Tesouro tem frações
    // direito (12/13) ou recibo (14/15) de subscrição de FII: vira cota do ...11 quando exercido; não é posição
    const ehSubscricao = /^[A-Z]{4}1[2-5]$/.test(tk);
    if (!(qtdFinal > 0) || ehSubscricao) { if (p.movs.length) vendidos.push({ ticker:tk, movimentacoes:p.movs, subscricao:ehSubscricao }); continue; }
    const pm = p.qc > 0 ? +(p.custo/p.qc).toFixed(2) : null;
    itens.push({ ticker:tk, qtd:qtdFinal, precoMedio:pm, cotacao:null, dataCompra:p.primeiraCompra, ultimaCompra:p.ultimaCompra, movimentacoes:p.movs });
  }
  itens.sort((a,b)=>a.ticker.localeCompare(b.ticker));
  return { itens, lidas, ignoradas, vendidos };
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA FISCAL DOS PROVENTOS (Brasil) — calcula o LÍQUIDO real automaticamente
// A planilha da B3 traz o valor creditado, mas não discrimina o imposto.
// Aplicamos a regra oficial por tipo de provento:
//  • Dividendo................ isento de IR para pessoa física (líquido = bruto)
//  • Rendimento (FII)......... isento para PF que cumpre os requisitos (líquido = bruto)
//  • JCP...................... IR retido na fonte: 15% até 2025, 17,5% a partir de 2026
//  • Amortização.............. devolução de capital, não é renda (líquido = bruto)
// Obs.: a B3 credita o JCP já líquido em muitos casos; por isso guardamos os dois
// valores (bruto estimado e líquido creditado) e sinalizamos o imposto retido.
// ════════════════════════════════════════════════════════════════════════════
function aliquotaJCP(dataISO) {
  // A partir de 01/01/2026 a alíquota do JCP passou de 15% para 17,5%
  const ano = parseInt(String(dataISO||"").slice(0,4), 10) || new Date().getFullYear();
  return ano >= 2026 ? 0.175 : 0.15;
}
function fiscalProvento(tipo, valorCreditado, dataISO) {
  const t = String(tipo||"").toLowerCase();
  const ehJCP = t.includes("juros"); // "Juros Sobre Capital Próprio" / "Juros"
  if (!ehJCP) {
    // Dividendo, Rendimento de FII e Amortização: sem IR na fonte para PF
    return { bruto:+valorCreditado.toFixed(2), imposto:0, liquido:+valorCreditado.toFixed(2), tributavel:false, aliquota:0 };
  }
  // JCP: o valor creditado na conta já vem LÍQUIDO (IR retido na fonte pela empresa).
  // Reconstituímos o bruto para transparência: bruto = liquido / (1 - aliquota)
  const aliq = aliquotaJCP(dataISO);
  const liquido = +valorCreditado.toFixed(2);
  const bruto = +(liquido / (1 - aliq)).toFixed(2);
  const imposto = +(bruto - liquido).toFixed(2);
  return { bruto, imposto, liquido, tributavel:true, aliquota:aliq };
}

// Extrai os PROVENTOS RECEBIDOS (Rendimento/Dividendo/JCP/Amortização) da planilha B3.
// Retorna { porMes, total (líquido), totalBruto, totalImposto, registros: [{data, ticker, valor, bruto, imposto, tipo}] }
function parseProventosRecebidos(linhas) {
  const porMes = {};       // líquido por mês (o que realmente entrou na conta)
  const porMesBruto = {};  // bruto por mês (antes do IR)
  const registros = [];
  let total = 0, totalBruto = 0, totalImposto = 0;
  for (const r of linhas) {
    const mov = String(r["Movimentação"] ?? r["Movimentacao"] ?? "").trim();
    if (!B3_MOV_PROVENTO.has(mov)) continue;
    const es = String(r["Entrada/Saída"] ?? r["Entrada/Saida"] ?? "").trim();
    if (es && !(es === "Credito" || es === "Crédito")) continue; // só entradas
    const valor = b3Num(r["Valor da Operação"] ?? r["Valor"] ?? r["Valor da Operacao"]);
    if (!isFinite(valor) || valor <= 0) continue;
    const data = b3Data(r["Data"] ?? r["Data do Negócio"]);
    if (!data) continue;
    // quantidade e valor unitário do provento (colunas da planilha)
    const qtdReg = b3Num(r["Quantidade"]);
    const unitReg = b3Num(r["Preço unitário"] ?? r["Preço Unitário"] ?? r["Preco unitario"] ?? r["Preco Unitario"]);
    // aplica a regra fiscal real por tipo de provento
    const f = fiscalProvento(mov, valor, data);
    const mesKey = data.slice(0,7); // YYYY-MM
    porMes[mesKey]      = +((porMes[mesKey] || 0) + f.liquido).toFixed(2);
    porMesBruto[mesKey] = +((porMesBruto[mesKey] || 0) + f.bruto).toFixed(2);
    total += f.liquido; totalBruto += f.bruto; totalImposto += f.imposto;
    registros.push({
      data, ticker: b3TickerDeProduto(r["Produto"]) || "—", tipo: mov,
      valor: f.liquido,           // líquido (o que caiu na conta)
      bruto: f.bruto, imposto: f.imposto, aliquota: f.aliquota, tributavel: f.tributavel,
      qtd: (isFinite(qtdReg) && qtdReg > 0) ? qtdReg : null,
      unit: (isFinite(unitReg) && unitReg > 0) ? +unitReg.toFixed(4) : null,
    });
  }
  registros.sort((a,b)=> a.data < b.data ? 1 : -1); // mais recentes primeiro
  return {
    porMes, porMesBruto, registros,
    total: +total.toFixed(2),
    totalBruto: +totalBruto.toFixed(2),
    totalImposto: +totalImposto.toFixed(2),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CONEXÃO COM O SERVIDOR — auto-detect (Tailscale → Local → localhost)
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// PONTE DA IA — endereço do servidor guardado no APARELHO (vale para todas as contas)
// ════════════════════════════════════════════════════════════════════════════
const PONTE_KEY = "carteiraProventos_ponteIA";
const PONTE_PADRAO = "http://100.100.195.84:4000";
function normalizarUrlServidor(u) {
  let s = String(u == null ? "" : u).trim();
  if (!s) return PONTE_PADRAO;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  return s.replace(/\/+$/, "");
}
function lerPonteIA() {
  try {
    const v = localStorage.getItem(PONTE_KEY);
    if (v) return normalizarUrlServidor(v);
    const legado = localStorage.getItem(PREFIXO + "bridgeUrl"); // migração: valor salvo na conta antiga
    if (legado) return normalizarUrlServidor(JSON.parse(legado));
  } catch {}
  return PONTE_PADRAO;
}
function gravarPonteIA(u) { try { localStorage.setItem(PONTE_KEY, normalizarUrlServidor(u)); } catch {} }

// ════════════════════════════════════════════════════════════════════════════
// MOTOR DE PROVENTOS — realizado (já caiu) + previsto (meses em aberto)
// ════════════════════════════════════════════════════════════════════════════
const ymDe = (data) => String(data || "").slice(0, 7);
const MESES_ABREV = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
function ymAdd(ym, n) {
  const a = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function ymHojeStr() { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`; }
// registros reais (todos os proventos que caíram, inclusive de ativos já vendidos), sem duplicatas
function registrosValidos(registros, ativos) {
  const vistos = new Set();
  return (registros || []).filter(r => {
    if (!r || !r.data || !(r.valor > 0)) return false;
    const k = [r.data, r.ticker, r.tipo, r.valor, r.qtd == null ? "" : r.qtd].join("|");
    if (vistos.has(k)) return false;
    vistos.add(k); return true;
  });
}
// valor por cota vigente: o informado no ativo > o último recebido (sem amortização)
function porCotaVigente(a, regs) {
  if (a.prov > 0) return +a.prov;
  const ult = regs.filter(r => r.ticker === a.ticker && r.qtd > 0 && !/amortiz/i.test(r.tipo || ""))
    .sort((x, y) => (x.data < y.data ? 1 : -1))[0];
  return ult ? +(ult.valor / ult.qtd).toFixed(4) : 0;
}
// Série mensal de [inicio..fim] (AAAA-MM).
// Meses passados: só o realizado. Mês atual: realizado + pendências. Meses futuros: evento anunciado (se houver),
// senão repete o valor vigente nos meses de pagamento do ativo.
function serieProventos({ ativos, registros, eventos = [], inicio, fim }) {
  const hoje = ymHojeStr();
  const regs = registrosValidos(registros, ativos);
  const evs = (eventos || []).filter(e => e && e.ticker && e.data);
  const linhas = [];
  for (let ym = inicio; ym <= fim; ym = ymAdd(ym, 1)) {
    const real = regs.filter(r => ymDe(r.data) === ym).reduce((soma, r) => soma + r.valor, 0);
    let previsto = 0;
    if (ym >= hoje) {
      // a) eventos anunciados no mês: valor líquido a que você tem direito (mesmo de ativo já vendido)
      const qtdDe = {}; (ativos || []).forEach(a => { qtdDe[a.ticker] = +a.qtd || 0; });
      const comEvento = new Set();
      evs.filter(e => ymDe(e.data) === ym).forEach(e => {
        comEvento.add(e.ticker);
        const jaCaiu = regs.some(r => r.ticker === e.ticker && r.data === e.data); // já está na Movimentação
        if (jaCaiu) return;
        previsto += e.valorTotal > 0 ? +e.valorTotal : (+e.valorPorCota || 0) * (qtdDe[e.ticker] || 0);
      });
      // b) ativos da carteira sem anúncio no mês: repete o último valor nos meses de pagamento
      (ativos || []).forEach(a => {
        if (!(a.qtd > 0) || comEvento.has(a.ticker)) return;
        const recebeuNoMes = regs.some(r => r.ticker === a.ticker && ymDe(r.data) === ym);
        if (ym === hoje && recebeuNoMes) return; // este mês já caiu
        if (!(a.meses || []).includes(Number(ym.slice(5, 7)))) return;
        const v = porCotaVigente(a, regs);
        if (v > 0) previsto += v * a.qtd;
      });
    }
    linhas.push({
      ym, rotulo: `${MESES_ABREV[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`,
      real: +real.toFixed(2), previsto: +previsto.toFixed(2),
      total: +(real + previsto).toFixed(2), futuro: ym > hoje,
    });
  }
  return linhas;
}
// ── AGENDA DE PROVENTOS (calendário): datas de pagamento e data-com por ativo ──
// Feriados da B3 (sem pregão) 2026–2027
const FERIADOS_B3 = new Set([
  "2026-01-01","2026-02-16","2026-02-17","2026-04-03","2026-04-21","2026-05-01","2026-06-04","2026-09-07","2026-10-12","2026-11-02","2026-11-20","2026-12-24","2026-12-25","2026-12-31",
  "2027-01-01","2027-02-08","2027-02-09","2027-03-26","2027-04-21","2027-05-27","2027-09-07","2027-10-12","2027-11-02","2027-11-15","2027-11-20","2027-12-24","2027-12-31",
]);
const p2 = (n) => String(n).padStart(2, "0");
const isoDia = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const dataDeIso = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d, 12); };
const ehDiaUtil = (d) => d.getDay() % 6 !== 0 && !FERIADOS_B3.has(isoDia(d));
function nEsimoDiaUtil(y, m, n) { const d = new Date(y, m, 1, 12); let c = 0; for (let i = 0; i < 40; i++) { if (ehDiaUtil(d) && ++c === n) return d; d.setDate(d.getDate() + 1); } return ultimoDiaUtil(y, m); }
function ultimoDiaUtil(y, m) { const d = new Date(y, m + 1, 0, 12); while (!ehDiaUtil(d)) d.setDate(d.getDate() - 1); return d; }
function somaDiasUteis(d0, n) { const d = new Date(d0); const passo = n < 0 ? -1 : 1; let falta = Math.abs(n); while (falta > 0) { d.setDate(d.getDate() + passo); if (ehDiaUtil(d)) falta--; } return d; }
function indiceDiaUtil(d) { let c = 0; const x = new Date(d.getFullYear(), d.getMonth(), 1, 12); while (x <= d) { if (ehDiaUtil(x)) c++; x.setDate(x.getDate() + 1); } return c; }
function diasUteisEntre(a, b) { let c = 0; const x = new Date(a); while (x < b) { x.setDate(x.getDate() + 1); if (ehDiaUtil(x)) c++; } return c; }
const moda = (arr) => { const m = {}; let melhor = null; arr.forEach(v => { m[v] = (m[v] || 0) + 1; if (melhor == null || m[v] > m[melhor]) melhor = v; }); return melhor; };

// Regras que você levantou no seu painel HTML: [data-com, pagamento]
//  número = n-ésimo dia útil do mês · "L" = último dia útil do mês anterior · "T" = 3ª terça do mês anterior · "+N" = N dias úteis depois da data-com
const REGRA_USUARIO = { OIAG11:[5,"+5"], TRXF11:["L",10], RBRY11:[7,"+5"], MFII11:["L",10], RBRX11:[10,"+6"], KNCR11:["L",9], VGRI11:["L",5],
  MXRF11:["L",10], BCRI11:["L",10], MCRE11:[11,"+5"], IRIM11:[7,"+5"], VGHF11:["L",5], GGRC11:[1,"+5"], COIN11:["T",6] };
function terceiraTerca(y, m) { const d = new Date(y, m, 1, 12); while (d.getDay() !== 2) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + 14); return d; }
// Aprende a regra de datas do ativo com o que já aconteceu:
//  pagamento → n-ésimo dia útil do mês (ou último dia útil) mais frequente nos últimos pagamentos
//  data-com  → dos eventos da B3 (último dia útil do mês anterior, ou N dias úteis antes do pagamento)
function regraDatas(ticker, cat, registros, eventos) {
  if (REGRA_USUARIO[ticker]) return { usuario: REGRA_USUARIO[ticker], aprendida: true };
  const pags = [...new Set([
    ...(registros || []).filter(r => r.ticker === ticker).map(r => r.data),
    ...(eventos || []).filter(e => e.ticker === ticker).map(e => e.data),
  ])].sort().slice(-6).map(dataDeIso);
  let pag = null;
  if (pags.length) {
    const ultimos = pags.filter(d => isoDia(d) === isoDia(ultimoDiaUtil(d.getFullYear(), d.getMonth()))).length;
    pag = ultimos > pags.length / 2 ? "U" : Number(moda(pags.map(indiceDiaUtil)));
  }
  let com = null;
  const comEv = (eventos || []).filter(e => e.ticker === ticker && e.dataCom && e.data);
  if (comEv.length) {
    const tipos = comEv.map(e => {
      const dc = dataDeIso(e.dataCom), dp = dataDeIso(e.data);
      const ultAnt = ultimoDiaUtil(dp.getFullYear(), dp.getMonth() - 1);
      return isoDia(dc) === isoDia(ultAnt) ? "Uant" : `-${diasUteisEntre(dc, dp)}`;
    });
    com = moda(tipos);
  } else if (cat === "FII") com = "Uant"; // padrão mais comum dos FIIs
  return { pag, com, aprendida: pags.length > 0 };
}
// data-com a partir de uma data de pagamento conhecida (evento anunciado ou já recebido)
function comPeloPagamento(regra, pagIso) {
  const dp = dataDeIso(pagIso);
  if (regra.usuario) {
    const [c, p] = regra.usuario;
    if (typeof p === "string") return isoDia(somaDiasUteis(dp, -Number(p.slice(1))));
    if (c === "L") return isoDia(ultimoDiaUtil(dp.getFullYear(), dp.getMonth() - 1));
    if (c === "T") return isoDia(terceiraTerca(dp.getFullYear(), dp.getMonth() - 1));
    return null;
  }
  if (regra.com === "Uant") return isoDia(ultimoDiaUtil(dp.getFullYear(), dp.getMonth() - 1));
  if (regra.com) return isoDia(somaDiasUteis(dp, Number(regra.com)));
  return null;
}
function datasPelaRegra(regra, y, m) {
  if (regra.usuario) {
    const [c, p] = regra.usuario;
    const com = c === "L" ? ultimoDiaUtil(y, m - 1) : c === "T" ? terceiraTerca(y, m - 1) : nEsimoDiaUtil(y, m, c);
    const pag = typeof p === "string" ? somaDiasUteis(com, Number(p.slice(1))) : nEsimoDiaUtil(y, m, p);
    return { pag: isoDia(pag), com: isoDia(com) };
  }
  const pag = regra.pag === "U" ? ultimoDiaUtil(y, m) : regra.pag ? nEsimoDiaUtil(y, m, regra.pag) : new Date(y, m, 15, 12);
  let com = null;
  if (regra.com === "Uant") com = ultimoDiaUtil(y, m - 1);
  else if (regra.com) com = somaDiasUteis(pag, Number(regra.com));
  return { pag: isoDia(pag), com: com ? isoDia(com) : null };
}
// Segmentos do calendário (os mesmos nomes do seu painel em HTML)
const SEGMENTO_FIXO = { OIAG11:"Fiagro", TRXF11:"Tijolo", GGRC11:"Tijolo", RBRY11:"Papel (CRI)", KNCR11:"Papel (CRI)", VGRI11:"Papel (CRI)", BCRI11:"Papel (CRI)",
  MCRE11:"Papel (CRI)", IRIM11:"Papel (CRI)", MFII11:"Misto", RBRX11:"Misto", VGHF11:"Misto", MXRF11:"Misto", COIN11:"ETF Bitcoin" };
const COR_SEGMENTO = { "Papel (CRI)":"#2bb894", "Tijolo":"#5b82e6", "Fiagro":"#e86aa6", "Misto":"#9b6fe0", "ETF Bitcoin":"#e0a030", "Ações":"#d9822b", "Outros":"#8a94a6" };
function segmentoDe(ticker, ativo) {
  if (SEGMENTO_FIXO[ticker]) return SEGMENTO_FIXO[ticker];
  const cat = ativo && ativo.cat, setor = String((ativo && ativo.setor) || (CATALOGO_ATIVOS.find(c => c.t === ticker) || {}).s || "");
  if (cat === "Ação") return "Ações";
  if (/fiagro|agro/i.test(setor)) return "Fiagro";
  if (/papel|cri|receb|cr[eé]dito/i.test(setor)) return "Papel (CRI)";
  if (/h[ií]brido|multi|misto|fof|fundo de fundos|hedge/i.test(setor)) return "Misto";
  if (/log|shop|laje|tijolo|renda urbana|galp|hotel|agência|hosp/i.test(setor)) return "Tijolo";
  if (cat === "FII" || /^[A-Z]{4}11$/.test(ticker)) return "Misto";
  return "Outros";
}
// Pagamentos de um mês (m = 0..11). Mesma conta do motor (serieProventos):
//  recebido (Movimentação) + anunciado (arquivo de eventos, inclusive de ativo vendido) + estimado (repete o último valor)
function agendaMes({ ativos, registros, eventos = [], y, m }) {
  const ym = `${y}-${p2(m + 1)}`, hoje = ymHojeStr();
  const regs = registrosValidos(registros, ativos);
  const evs = (eventos || []).filter(e => e && e.ticker && e.data);
  const porTk = {}; (ativos || []).forEach(a => { porTk[a.ticker] = a; });
  const regraCache = {};
  const regra = (tk) => regraCache[tk] || (regraCache[tk] = regraDatas(tk, porTk[tk] ? porTk[tk].cat : (/^[A-Z]{4}11$/.test(tk) ? "FII" : null), regs, evs));
  const itens = [];
  regs.filter(r => ymDe(r.data) === ym).forEach(r => {
    const ev = evs.find(e => e.ticker === r.ticker && e.data === r.data);
    const qtd = +r.qtd || null;
    itens.push({ ticker: r.ticker, pag: r.data, com: (ev && ev.dataCom) || comPeloPagamento(regra(r.ticker), r.data), valor: +r.valor,
      qtd, porCota: qtd ? r.valor / qtd : null, status: "recebido", tipo: r.tipo || "", naCarteira: !!(porTk[r.ticker] && porTk[r.ticker].qtd > 0) });
  });
  if (ym >= hoje) {
    const comEvento = new Set();
    evs.filter(e => ymDe(e.data) === ym).forEach(e => {
      comEvento.add(e.ticker);
      if (regs.some(r => r.ticker === e.ticker && r.data === e.data)) return;
      const qtd = e.qtd > 0 ? +e.qtd : (porTk[e.ticker] ? +porTk[e.ticker].qtd : 0);
      const valor = e.valorTotal > 0 ? +e.valorTotal : (+e.valorPorCota || 0) * qtd;
      if (!(valor > 0)) return;
      itens.push({ ticker: e.ticker, pag: e.data, com: e.dataCom || comPeloPagamento(regra(e.ticker), e.data), comEstimada: !e.dataCom, valor, qtd: qtd || null,
        porCota: +e.valorPorCota || (qtd ? valor / qtd : null), status: "anunciado", tipo: e.tipo || "", naCarteira: !!(porTk[e.ticker] && porTk[e.ticker].qtd > 0) });
    });
    (ativos || []).forEach(a => {
      if (!(a.qtd > 0) || comEvento.has(a.ticker)) return;
      if (ym === hoje && regs.some(r => r.ticker === a.ticker && ymDe(r.data) === ym)) return;
      if (!(a.meses || []).includes(m + 1)) return;
      const v = porCotaVigente(a, regs);
      if (!(v > 0)) return;
      const d = datasPelaRegra(regra(a.ticker), y, m);
      itens.push({ ticker: a.ticker, pag: d.pag, com: d.com, comEstimada: true, valor: v * a.qtd, qtd: +a.qtd, porCota: v, status: "estimado", tipo: "", naCarteira: true, dataAprox: !regra(a.ticker).aprendida });
    });
  }
  itens.forEach(i => { i.segmento = segmentoDe(i.ticker, porTk[i.ticker]); i.valor = +i.valor.toFixed(2); });
  return itens.sort((a, b) => (a.pag < b.pag ? -1 : a.pag > b.pag ? 1 : b.valor - a.valor));
}
// janelas do gráfico: ano = Jan..Dez do ano escolhido; 12m = 12 últimos + 12 próximos; 2a = 24 + 12; tudo = do 1º registro + 12
function janelaProventos(filtro, ano, registros, ativos) {
  const hoje = ymHojeStr();
  if (filtro === "ano") return { inicio: `${ano}-01`, fim: `${ano}-12` };
  if (filtro === "12m") return { inicio: ymAdd(hoje, -11), fim: ymAdd(hoje, 12) };
  if (filtro === "2a") return { inicio: ymAdd(hoje, -23), fim: ymAdd(hoje, 12) };
  const regs = registrosValidos(registros, ativos);
  const primeiro = regs.length ? regs.map(r => ymDe(r.data)).sort()[0] : ymAdd(hoje, -11);
  return { inicio: primeiro, fim: ymAdd(hoje, 12) };
}
// totais de um ano: realizado (meses passados/atual) + previsto (meses em aberto)
function resumoAno(ano, ativos, registros, eventos) {
  const linhas = serieProventos({ ativos, registros, eventos, inicio: `${ano}-01`, fim: `${ano}-12` });
  const soma = (k) => +linhas.reduce((t, l) => t + l[k], 0).toFixed(2);
  return { linhas, real: soma("real"), previsto: soma("previsto"), total: soma("total") };
}
// todos os proventos recebidos: os da última planilha + os guardados em cada ativo (proventosHist)
function juntarRegistros(proventosRecebidos, ativos) {
  const lista = [...(proventosRecebidos?.registros || [])];
  (ativos || []).forEach(a => (a.proventosHist || []).forEach(r => lista.push({ ...r, ticker: r.ticker || a.ticker })));
  return registrosValidos(lista, ativos);
}
// Evolução mensal da carteira desde a 1ª compra (mínimo de N meses na tela).
// aplicado = custo das posições no fim de cada mês (compras − vendas pelo preço médio), lido das movimentações da B3.
// patrimonio = valor de mercado só onde é conhecido: retratos mensais salvos pelo app + o valor de hoje.
function evolucaoPatrimonio({ ativos, vendidos = [], historico = [], patrimonioAtual = 0, aplicadoAtual = 0, minMeses = 12 }) {
  const hoje = ymHojeStr();
  const movs = [];
  let semData = 0;
  const naCarteira = new Set((ativos || []).filter(a => a.qtd > 0).map(a => a.ticker));
  (vendidos || []).forEach(v => {
    if (!v || naCarteira.has(v.ticker) || v.subscricao) return;
    (v.movimentacoes || []).filter(m => m && m.data && isFinite(+m.qtd) && +m.qtd !== 0)
      .forEach(m => movs.push({ ym: ymDe(m.data), data: m.data, tk: v.ticker, q: +m.qtd, preco: +m.preco > 0 ? +m.preco : 0, pm: 0 }));
  });
  (ativos || []).forEach(a => {
    if (!(a.qtd > 0)) return;
    const pm = a.precoMedio > 0 ? +a.precoMedio : (+a.cotacao || 0);
    const lista = (a.movimentacoes || []).filter(m => m && m.data && isFinite(+m.qtd) && +m.qtd !== 0);
    if (lista.length) lista.forEach(m => movs.push({ ym: ymDe(m.data), data: m.data, tk: a.ticker, q: +m.qtd, preco: +m.preco > 0 ? +m.preco : 0, pm }));
    else if (a.dataCompra) movs.push({ ym: ymDe(a.dataCompra), data: a.dataCompra, tk: a.ticker, q: +a.qtd, preco: pm, pm });
    else semData++;
  });
  movs.sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0));
  const primeiro = movs.length ? movs[0].ym : null;
  let inicio = ymAdd(hoje, -(minMeses - 1));
  if (primeiro && primeiro < inicio) inicio = primeiro;
  const pos = {};
  let i = 0;
  const snap = {};
  (historico || []).forEach(h => { if (h && h.mes && +h.patrimonio > 0) snap[h.mes] = +h.patrimonio; });
  const meses = [];
  for (let ym = inicio; ym <= hoje; ym = ymAdd(ym, 1)) {
    while (i < movs.length && movs[i].ym <= ym) {
      const m = movs[i++];
      const p = pos[m.tk] || (pos[m.tk] = { q: 0, custo: 0 });
      if (m.q > 0) { p.q += m.q; p.custo += m.q * (m.preco || 0); }
      else if (p.q > 0) { const sai = Math.min(-m.q, p.q); p.custo -= p.custo * (sai / p.q); p.q -= sai; }
    }
    let aplicado = Object.values(pos).reduce((t, p) => t + Math.max(p.custo, 0), 0);
    const atual = ym === hoje;
    if (atual) aplicado = aplicadoAtual; // mês atual: valor aplicado de hoje (qtd × preço médio)
    meses.push({
      ym, rotulo: `${MESES_ABREV[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`,
      aplicado: +aplicado.toFixed(2),
      patrimonio: atual ? +(+patrimonioAtual).toFixed(2) : (snap[ym] != null ? snap[ym] : null),
      atual,
    });
  }
  return { meses, primeiro, temHistorico: movs.length > 0, semData };
}

// Reserva = Tesouro, ETFs globais e renda fixa (CDB, LCI, LCA, RDB, CRI, CRA) pelo NOME.
// Código de bolsa (BCRI11, CRAA11...) é FII/ação, nunca reserva.
function ehReservaAtivo(a) {
  if (!a) return false;
  if (a.cat === "Tesouro" || ETFS_GLOBAIS.includes(a.ticker)) return true;
  if (a.cat === "FII" || a.cat === "Ação" || /^[A-Z]{4}\d{1,2}F?$/.test(a.ticker || "")) return false;
  return /\b(tesouro|cdb|lci|lca|rdb|cri|cra)\b/i.test(`${a.nome || ""} ${a.ticker || ""}`);
}
// junta eventos novos aos já guardados (mesmo ticker + data substitui)
// O arquivo da B3 é a lista COMPLETA do que está a receber: ao importar um novo, ele substitui os pendentes
// (de hoje em diante). Os de datas passadas ficam guardados como histórico.
function mesclarEventos(atual, novos) {
  const hojeISO = new Date().toISOString().slice(0, 10);
  const chave = (e) => `${e.ticker}|${e.data}|${normCab(e.tipo)}`;
  const mapa = new Map();
  (atual || []).filter(e => e && e.data < hojeISO).forEach(e => mapa.set(chave(e), e));
  (novos || []).forEach(e => mapa.set(chave(e), e));
  return [...mapa.values()].sort((a, b) => (a.data < b.data ? -1 : 1));
}

// ════════════════════════════════════════════════════════════════════════════
// ARQUIVO DE EVENTOS da B3 (proventos anunciados). Lê as colunas pelo nome do cabeçalho.
// ════════════════════════════════════════════════════════════════════════════
const normCab = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function parseB3Eventos(linhas) {
  const itens = [];
  let ignoradas = 0;
  const cab = linhas && linhas[0] ? Object.keys(linhas[0]) : [];
  const achaChave = (pistas, excluir = []) => cab.find(k => {
    const n = normCab(k);
    return pistas.some(p => n.includes(p)) && !excluir.some(x => n.includes(x));
  });
  const kProduto = achaChave(["produto", "ativo", "ticker", "codigo"]);
  const kPagto   = achaChave(["pagamento"]);
  const kCom     = achaChave(["data com", "datacom", "data-com", "data de com"]);
  const kPorCota = achaChave(["por acao", "por cota", "unitario", "por ativo", "valor unit"]);
  const kTotal   = achaChave(["valor liquido"]) || achaChave(["valor"], ["acao", "cota", "unit", "por "]);
  const kQtd     = achaChave(["quantidade", "qtd"]);
  // "Tipo de Evento" (RENDIMENTO/DIVIDENDO/JCP) — a coluna "Tipo" sozinha é o tipo do papel (Fundo, PN, ON)
  const kTipo    = achaChave(["tipo de evento", "evento"]) || achaChave(["tipo"], ["compra", "venda"]);
  for (const r of linhas || []) {
    const ticker = kProduto && r[kProduto] ? b3TickerDeProduto(r[kProduto]) : null;
    const dataPag = kPagto ? b3Data(r[kPagto]) : null;
    const dataCom = kCom ? b3Data(r[kCom]) : null;
    const data = dataPag || dataCom;
    let porCota = kPorCota ? b3Num(r[kPorCota]) : NaN;
    const total = kTotal ? b3Num(r[kTotal]) : NaN;
    const qtd = kQtd ? b3Num(r[kQtd]) : NaN;
    // o "Preço unitário" da B3 vem arredondado (0,10 em vez de 0,095): quando há total e quantidade, usa total ÷ quantidade
    if (total > 0 && qtd > 0) porCota = total / qtd;
    if (!ticker || !data || !(porCota > 0)) { ignoradas++; continue; }
    itens.push({
      ticker, data, dataCom: dataCom || null,
      tipo: String((kTipo && r[kTipo]) || "Provento"),
      valorPorCota: +porCota.toFixed(6),
      // valor líquido que você TEM DIREITO (posição na data-com) — vale mesmo se já vendeu o ativo
      valorTotal: total > 0 ? +total.toFixed(2) : null,
      qtd: qtd > 0 ? qtd : null,
      origem: "eventos",
    });
  }
  return {
    itens, lidas: (linhas || []).length, ignoradas,
    colunas: { produto: kProduto, pagamento: kPagto, dataCom: kCom, porCota: kPorCota, total: kTotal, quantidade: kQtd, tipo: kTipo },
  };
}

const SERVIDORES = [
  { nome:"Tailscale", url:"http://100.100.195.84:4000" },
  { nome:"Local",     url:"http://192.168.1.17:4000" },
  { nome:"localhost", url:"http://localhost:4000" },
];
async function detectarServidor(aoTestar) {
  for (const s of SERVIDORES) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 3000);
      const r = await fetch(`${s.url}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json().catch(()=>({}));
        aoTestar && aoTestar(s, true);
        if (d.status === "ok" || r.ok) return s;
      } else { aoTestar && aoTestar(s, false); }
    } catch(e) { aoTestar && aoTestar(s, false); }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// AÇÕES DA IA (Camada 1) — comandos SEGUROS que não quebram a estrutura base.
// A IA emite [[ACAO]]{"tipo":"tema","valor":"padrao"}[[/ACAO]] e o app aplica
// numa camada acima (preview → aplicar/cancelar). A base fica sempre intacta.
// ════════════════════════════════════════════════════════════════════════════
// Elementos que a IA pode estilizar (whitelist — protege a base do app)
const ELEMENTOS_ESTILO = {
  // ─ Painel · cabeçalho ─
  saudacao:            { nome:"Saudação (Boa noite!)",        grupo:"Cabeçalho", base:24 },
  dataHoje:            { nome:"Data de hoje",                 grupo:"Cabeçalho", base:11 },
  destaqueDia:         { nome:"Card de destaque do dia",      grupo:"Cabeçalho", base:11, caixa:true },
  headerApp:           { nome:"Barra do topo do app",         grupo:"Cabeçalho", base:13, caixa:true },
  logoApp:             { nome:"Logo/nome no topo",            grupo:"Cabeçalho", base:13 },
  // ─ Valores principais ─
  dividendosHeader:    { nome:"Rótulo 'Dividendos do ano'",   grupo:"Valores", base:11 },
  dividendosValor:     { nome:"Valor dos dividendos",         grupo:"Valores", base:26 },
  dividendosCard:      { nome:"Card dos dividendos",          grupo:"Valores", base:13, caixa:true },
  patrimonioLabel:     { nome:"Rótulo 'Patrimônio total'",    grupo:"Valores", base:10 },
  patrimonioValor:     { nome:"Valor do patrimônio",          grupo:"Valores", base:26 },
  patrimonioCard:      { nome:"Card do patrimônio",           grupo:"Valores", base:13, caixa:true },
  // ─ KPIs ─
  kpiCarrossel:        { nome:"Carrossel de KPIs",            grupo:"KPIs", base:13, caixa:true },
  kpiCard:             { nome:"Cards dos KPIs",               grupo:"KPIs", base:12, caixa:true },
  kpiValor:            { nome:"Números dos KPIs",             grupo:"KPIs", base:16 },
  kpiLabel:            { nome:"Rótulos dos KPIs",             grupo:"KPIs", base:9 },
  // ─ Metas ─
  metaCard:            { nome:"Card da meta",                 grupo:"Metas", base:13, caixa:true },
  tituloMetaProventos: { nome:"Título 'Meta de proventos'",   grupo:"Metas", base:13 },
  metaValorAtual:      { nome:"Valor atual da meta",          grupo:"Metas", base:22 },
  metaAlvo:            { nome:"Valor alvo da meta",           grupo:"Metas", base:11 },
  metaBarra:           { nome:"Barra de progresso da meta",   grupo:"Metas", base:13, caixa:true },
  // ─ Blocos do painel ─
  tituloProx3Meses:    { nome:"Título 'Proventos 3 meses'",   grupo:"Blocos", base:11 },
  cardProx3Meses:      { nome:"Cards dos 3 meses",            grupo:"Blocos", base:13, caixa:true },
  tituloGraficoMensal: { nome:"Título 'Proventos mês a mês'", grupo:"Blocos", base:11 },
  cardGraficoMensal:   { nome:"Card do gráfico mensal",       grupo:"Blocos", base:13, caixa:true },
  tituloProjecao:      { nome:"Título da Projeção",           grupo:"Blocos", base:13 },
  cardProjecao:        { nome:"Card da Projeção",             grupo:"Blocos", base:13, caixa:true },
  tituloPrevistoRealizado:{ nome:"Título 'Previsto vs Realizado'", grupo:"Blocos", base:13 },
  cardPrevistoRealizado:{ nome:"Card do Previsto vs Realizado", grupo:"Blocos", base:13, caixa:true },
  // ─ Listas e ativos ─
  listaAtivoItem:      { nome:"Itens da lista de ativos",     grupo:"Listas", base:13, caixa:true },
  listaAtivoTicker:    { nome:"Ticker do ativo",              grupo:"Listas", base:13 },
  listaAtivoValor:     { nome:"Valor do ativo",               grupo:"Listas", base:13 },
  // ─ Navegação ─
  menuFlutuante:       { nome:"Menu flutuante inferior",      grupo:"Navegação", base:13, caixa:true },
  menuBotao:           { nome:"Botões do menu",               grupo:"Navegação", base:8 },
  abasInternas:        { nome:"Mini-abas do painel",          grupo:"Navegação", base:11, caixa:true },
  // ─ Chat ─
  chatBalaoIA:         { nome:"Balão de resposta da IA",      grupo:"Chat", base:13, caixa:true },
  chatBalaoUsuario:    { nome:"Balão da sua mensagem",        grupo:"Chat", base:13, caixa:true },
  chatCaixaEnvio:      { nome:"Caixa de digitar do chat",     grupo:"Chat", base:14, caixa:true },
  chatStatus:          { nome:"Barra de status da IA",        grupo:"Chat", base:12, caixa:true },
  // ─ Geral ─
  fundoApp:            { nome:"Fundo geral do app",           grupo:"Geral", base:13, caixa:true },
  todosCards:          { nome:"Todos os cards (global)",      grupo:"Geral", base:13, caixa:true },
};
const ANIMACOES_IA = ["nenhuma","pulsar","brilhar","flutuar","balancar","girar","tremer","surgir"];

const ACOES_VALIDAS = {
  tema:      { label:"Trocar tema" },
  layout:    { label:"Trocar layout (celular/TV)" },
  densidade: { label:"Trocar densidade" },
  fonte:     { label:"Ajustar tamanho da fonte" },
  meta:      { label:"Definir meta de proventos" },
  aporte:    { label:"Definir meta de aporte" },
  navegar:   { label:"Ir para uma tela" },
  blocoMover:   { label:"Mover bloco de página" },
  blocoVisivel: { label:"Mostrar/ocultar bloco" },
  estilo:       { label:"Estilizar elemento (fonte/cor/efeitos)" },
};
function detectarAcoes(txt) {
  const acoes = [];
  const blocos = String(txt||"").match(/\[\[ACAO\]\][\s\S]*?\[\[\/ACAO\]\]/g) || [];
  blocos.forEach(b=>{
    const corpo = b.replace("[[ACAO]]","").replace("[[/ACAO]]","").trim();
    try { const o = JSON.parse(corpo); if (o && o.tipo && ACOES_VALIDAS[o.tipo]) acoes.push(o); } catch(e){}
  });
  return acoes;
}
// remove os blocos [[ACAO]] do texto exibido ao usuário (fica limpo no chat)
function limparAcoesDoTexto(txt) {
  return String(txt||"").replace(/\[\[ACAO\]\][\s\S]*?\[\[\/ACAO\]\]/g, "").trim();
}


// ════════════════════════════════════════════════════════════════════════════
function gerarRelatorioPDF({ ativos, metaMensal, custoVida, totalAnual, provEsteMes, mediaMes, patrimonioTotal }) {
  const doc = new jsPDF({ unit:"mm", format:"a4" });
  const W = 210; const M = 16; let y = 0;
  const VERDE = [79,97,71], CINZA=[120,128,118], ESCURO=[51,64,47], CLARO=[236,238,231], CIANO=[109,150,144];
  const real = (v)=>"R$ "+(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const linha = (yy)=>{ doc.setDrawColor(220,224,214); doc.line(M,yy,W-M,yy); };
  const checkPage = (precisa=10)=>{ if (y+precisa>285){ doc.addPage(); y=20; } };

  // cabeçalho
  doc.setFillColor(...VERDE); doc.rect(0,0,W,30,"F");
  doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(18);
  doc.text("Carteira de Proventos", M, 13);
  doc.setFont("helvetica","normal"); doc.setFontSize(10);
  const hoje = new Date().toLocaleDateString("pt-BR",{ day:"2-digit", month:"long", year:"numeric" });
  doc.text("Relatório gerado em "+hoje, M, 21);
  y = 40;

  // números principais
  const ativosVivos = ativos.filter(a=>a.qtd>0);
  doc.setTextColor(...CINZA); doc.setFontSize(9); doc.setFont("helvetica","normal");
  doc.text("PATRIMÔNIO TOTAL", M, y);
  doc.text("DIVIDENDOS / ANO", M+62, y);
  doc.text("RECEBIDO ESTE MÊS", M+124, y);
  y += 7;
  doc.setTextColor(...ESCURO); doc.setFont("helvetica","bold"); doc.setFontSize(15);
  doc.text(real(patrimonioTotal), M, y);
  doc.setTextColor(...VERDE); doc.text(real(totalAnual), M+62, y);
  doc.setTextColor(...CIANO); doc.text(real(provEsteMes), M+124, y);
  y += 6;
  doc.setTextColor(...CINZA); doc.setFont("helvetica","normal"); doc.setFontSize(8);
  doc.text(`${ativosVivos.length} ativos`, M, y);
  doc.text(`média ${real(mediaMes)}/mês`, M+62, y);
  y += 8; linha(y); y += 8;

  // composição por classe
  doc.setTextColor(...ESCURO); doc.setFont("helvetica","bold"); doc.setFontSize(11);
  doc.text("Composição por classe", M, y); y += 7;
  const total = ativosVivos.reduce((s,a)=>s+a.qtd*a.cotacao,0);
  const grupos = {};
  ativosVivos.forEach(a=>{ const c=classeDe(a); grupos[c]=(grupos[c]||0)+a.qtd*a.cotacao; });
  const ordenadas = Object.entries(grupos).sort((a,b)=>b[1]-a[1]);
  const corClasse = (c)=>{ const h=(CLASSE_COR[c]||"#4f6147").replace("#",""); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; };
  ordenadas.forEach(([cl,val])=>{
    checkPage(8);
    const pct = total>0?val/total*100:0;
    doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...ESCURO);
    doc.text(cl, M, y);
    doc.setTextColor(...CINZA); doc.text(real(val)+`  (${pct.toFixed(1)}%)`, W-M, y, { align:"right" });
    y += 2.5;
    doc.setFillColor(...CLARO); doc.rect(M, y, W-2*M, 2.5, "F");
    doc.setFillColor(...corClasse(cl)); doc.rect(M, y, (W-2*M)*pct/100, 2.5, "F");
    y += 7;
  });
  y += 4; linha(y); y += 8;

  // lista de ativos
  checkPage(20);
  doc.setTextColor(...ESCURO); doc.setFont("helvetica","bold"); doc.setFontSize(11);
  doc.text("Ativos", M, y); y += 7;
  doc.setFontSize(8); doc.setTextColor(...CINZA); doc.setFont("helvetica","bold");
  doc.text("ATIVO", M, y); doc.text("QTD", M+70, y, {align:"right"}); doc.text("P.MÉDIO", M+100, y, {align:"right"});
  doc.text("COTAÇÃO", M+130, y, {align:"right"}); doc.text("VALOR", W-M, y, {align:"right"}); y += 2;
  linha(y); y += 5;
  ativosVivos.sort((a,b)=>b.qtd*b.cotacao-a.qtd*a.cotacao).forEach(a=>{
    checkPage(7);
    doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...ESCURO);
    doc.text(String(a.ticker).slice(0,28), M, y);
    doc.setFont("helvetica","normal"); doc.setTextColor(...CINZA);
    doc.text(String(a.qtd<1?a.qtd.toFixed(2):a.qtd), M+70, y, {align:"right"});
    doc.text(real(a.precoMedio).replace("R$ ",""), M+100, y, {align:"right"});
    doc.text(real(a.cotacao).replace("R$ ",""), M+130, y, {align:"right"});
    doc.setTextColor(...ESCURO); doc.setFont("helvetica","bold");
    doc.text(real(a.qtd*a.cotacao), W-M, y, {align:"right"});
    y += 5.5;
  });
  y += 3; linha(y); y += 8;

  // metas resumo
  checkPage(30);
  doc.setTextColor(...ESCURO); doc.setFont("helvetica","bold"); doc.setFontSize(11);
  doc.text("Metas", M, y); y += 7;
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  const metaPct = metaMensal>0?Math.min(mediaMes/metaMensal*100,100):0;
  doc.setTextColor(...CINZA);
  doc.text(`Meta de proventos: ${real(mediaMes)} / ${real(metaMensal)} por mês (${metaPct.toFixed(0)}%)`, M, y); y += 6;
  const custoTotal = Object.values(custoVida||{}).reduce((s,v)=>s+(+v||0),0);
  if (custoTotal>0) { const cp=Math.min(mediaMes/custoTotal*100,100); doc.text(`Contas fixas cobertas: ${cp.toFixed(0)}% de ${real(custoTotal)}/mês`, M, y); y += 6; }
  const reserva = ativosVivos.filter(ehReservaAtivo).reduce((s,a)=>s+a.qtd*a.cotacao,0);
  doc.text(`Reserva Plus (Tesouro + ETFs globais): ${real(reserva)}`, M, y); y += 10;

  // rodapé
  const paginas = doc.internal.getNumberOfPages();
  for (let p=1;p<=paginas;p++){ doc.setPage(p); doc.setFontSize(7); doc.setTextColor(...CINZA);
    doc.text("Gerado pelo app Carteira de Proventos · estimativas informativas, não é recomendação de investimento", W/2, 292, {align:"center"});
    doc.text(`${p}/${paginas}`, W-M, 292, {align:"right"});
  }

  const nomeArq = `carteira-proventos-${new Date().toISOString().slice(0,10)}.pdf`;
  // No Android (app empacotado): salva e abre a tela de compartilhar. No navegador: baixa direto.
  (async () => {
    if (typeof window!=="undefined" && window.Capacitor?.isNativePlatform?.()) {
      try {
        const fsMod = await import("@capacitor/filesystem");
        const shareMod = await import("@capacitor/share");
        const base64 = doc.output("datauristring").split(",")[1];
        const res = await fsMod.Filesystem.writeFile({ path:nomeArq, data:base64, directory:fsMod.Directory.Cache });
        await shareMod.Share.share({ title:"Relatório da carteira", text:"Relatório da minha carteira de proventos", url:res.uri });
        return;
      } catch(e) { /* se falhar, tenta o download normal abaixo */ }
    }
    try { doc.save(nomeArq); }
    catch(e) {
      try { const url = doc.output("bloburl"); window.open(url, "_blank"); }
      catch(e2) { alert("Não consegui gerar o PDF neste dispositivo."); }
    }
  })();
  return nomeArq;
}

// ════════════════════════════════════════════════════════════════════════════
// TEMAS DE CORES — 3 perfis selecionáveis no canto superior direito
// ════════════════════════════════════════════════════════════════════════════
const TEMAS = {
  padrao: {
    nome: "Padrão",
    emoji: "🌙",
    bg: "#0a0a14",
    bgHeader: "linear-gradient(135deg,#1a1040 0%,#0a0a14 100%)",
    card: "#131325",
    cardAlt: "#0f0f1a",
    border: "#1e293b",
    borderSoft: "#334155",
    text: "#e2e8f0",
    textDim: "#94a3b8",
    textMute: "#64748b",
    textFaint: "#475569",
    accent: "#6366f1",
    accentSoft: "#a5b4fc",
    accentBg: "#1a1040",
    accentBorder: "#4338ca",
    green: "#34d399",
    red: "#f87171",
    amber: "#fbbf24",
    cyan: "#22d3ee",
    // paletas de ativos
    corFII: { MFII11:"#06b6d4",VGHF11:"#0891b2",RBRY11:"#0e7490",OIAG11:"#22d3ee",CPTS11:"#67e8f9",GARE11:"#2dd4bf",TRXF11:"#0d9488",RBRX11:"#14b8a6",IRIM11:"#5eead4",KNCR11:"#99f6e4",VISC11:"#34d399",XPML11:"#6ee7b7",MXRF11:"#a7f3d0" },
    corAcao: { BBAS3:"#6366f1",PETR4:"#8b5cf6",BBDC3:"#a78bfa",ITSA4:"#c084fc",BBSE3:"#e879f9",TAEE11:"#f472b6",BRSR6:"#818cf8",KLBN4:"#7c3aed",KLBN11:"#db2777",CXSE3:"#ec4899",WEGE3:"#be185d",CPLE3:"#9d174d",SANB3:"#fb7185" },
  },
  office: {
    nome: "Office",
    emoji: "💼",
    bg: "#1a1d21",
    bgHeader: "linear-gradient(135deg,#2d3748 0%,#1a1d21 100%)",
    card: "#22262b",
    cardAlt: "#1d2125",
    border: "#374151",
    borderSoft: "#4b5563",
    text: "#e5e7eb",
    textDim: "#9ca3af",
    textMute: "#6b7280",
    textFaint: "#4b5563",
    accent: "#10b981",
    accentSoft: "#6ee7b7",
    accentBg: "#1f3a32",
    accentBorder: "#047857",
    green: "#10b981",
    red: "#ef4444",
    amber: "#d97706",
    cyan: "#0ea5e9",
    corFII: { MFII11:"#0ea5e9",VGHF11:"#0284c7",RBRY11:"#0369a1",OIAG11:"#38bdf8",CPTS11:"#7dd3fc",GARE11:"#0891b2",TRXF11:"#075985",RBRX11:"#0e7490",IRIM11:"#22d3ee",KNCR11:"#67e8f9",VISC11:"#06b6d4",XPML11:"#a5f3fc",MXRF11:"#cffafe" },
    corAcao: { BBAS3:"#10b981",PETR4:"#059669",BBDC3:"#34d399",ITSA4:"#6ee7b7",BBSE3:"#047857",TAEE11:"#065f46",BRSR6:"#22c55e",KLBN4:"#16a34a",KLBN11:"#15803d",CXSE3:"#4ade80",WEGE3:"#84cc16",CPLE3:"#65a30d",SANB3:"#a3e635" },
  },
  conforto: {
    nome: "Conforto",
    emoji: "🎨",
    bg: "#1c1b22",
    bgHeader: "linear-gradient(135deg,#3b2f4a 0%,#1c1b22 100%)",
    card: "#26242e",
    cardAlt: "#201f27",
    border: "#3a3744",
    borderSoft: "#524d5e",
    text: "#ede9f0",
    textDim: "#b8b2c4",
    textMute: "#857d92",
    textFaint: "#5c5568",
    accent: "#c084fc",
    accentSoft: "#e9d5ff",
    accentBg: "#3b2f4a",
    accentBorder: "#9333ea",
    green: "#86efac",
    red: "#fca5a5",
    amber: "#fcd34d",
    cyan: "#7dd3fc",
    corFII: { MFII11:"#7dd3fc",VGHF11:"#93c5fd",RBRY11:"#a5b4fc",OIAG11:"#a7f3d0",CPTS11:"#bbf7d0",GARE11:"#99f6e4",TRXF11:"#5eead4",RBRX11:"#6ee7b7",IRIM11:"#86efac",KNCR11:"#bef264",VISC11:"#7dd3fc",XPML11:"#c4b5fd",MXRF11:"#ddd6fe" },
    corAcao: { BBAS3:"#c084fc",PETR4:"#d8b4fe",BBDC3:"#f0abfc",ITSA4:"#f5d0fe",BBSE3:"#fbcfe8",TAEE11:"#fda4af",BRSR6:"#fecaca",KLBN4:"#fed7aa",KLBN11:"#fde68a",CXSE3:"#fef08a",WEGE3:"#d9f99d",CPLE3:"#bef264",SANB3:"#f9a8d4" },
  },
  minimalista: {
    nome: "Minimalista",
    emoji: "🌿",
    claro: true, // tema claro
    bg: "#eceee7",            // verde-acinzentado bem claro (parede)
    bgHeader: "linear-gradient(160deg,#dfe4da 0%,#eceee7 100%)",
    card: "#f6f7f2",          // quase branco, levemente quente
    cardAlt: "#e7e9e1",       // cinza do sofá
    border: "#d6dacf",        // borda suave
    borderSoft: "#c3c9b9",
    text: "#33402f",          // verde escuro (almofada) p/ texto — delicado, não preto
    textDim: "#5a6553",
    textMute: "#8a9382",
    textFaint: "#a9b0a0",
    accent: "#4f6147",        // verde escuro da almofada (cor principal)
    accentSoft: "#6f8166",
    accentBg: "#dde3d7",
    accentBorder: "#8a9b80",
    green: "#5e8a5a",         // verde suave p/ positivo
    red: "#b07c6e",           // terracota suave p/ negativo (sem vermelho gritante)
    amber: "#b69a5e",         // ocre suave
    cyan: "#6d9690",          // verde-água suave
    // paletas de ativos: tons terrosos/sálvia, pouca cor (conceito minimalista)
    corFII: { MFII11:"#6d9690",VGHF11:"#7ba39c",RBRY11:"#89a59f",OIAG11:"#9bb0a0",CPTS11:"#a9bbac",GARE11:"#7f9b86",TRXF11:"#6e8a74",RBRX11:"#83a08a",IRIM11:"#96ad99",KNCR11:"#aabba0",VISC11:"#7d978a",XPML11:"#92a995",MXRF11:"#b3c0b0" },
    corAcao: { BBAS3:"#4f6147",PETR4:"#5e7155",BBDC3:"#6f8166",ITSA4:"#7d8f73",BBSE3:"#8a9b80",TAEE11:"#97a78d",BRSR6:"#a4b29a",KLBN4:"#69745e",KLBN11:"#76836a",CXSE3:"#838f76",WEGE3:"#909b82",CPLE3:"#9da78e",SANB3:"#aab39b" },
  },
  minimalista2: {
    nome: "Minimal+",
    emoji: "🍃",
    claro: true,
    espacoso: true, // espaçamentos generosos estilo B3/Nubank
    bg: "#eef0ea",
    bgHeader: "linear-gradient(160deg,#e3e7df 0%,#eef0ea 100%)",
    card: "#f8f9f5",
    cardAlt: "#e9ebe3",
    border: "#dde1d7",
    borderSoft: "#cad0c1",
    text: "#33402f",
    textDim: "#5a6553",
    textMute: "#8a9382",
    textFaint: "#aab0a0",
    accent: "#4f6147",
    accentSoft: "#6f8166",
    accentBg: "#e1e7db",
    accentBorder: "#8a9b80",
    green: "#5e8a5a",
    red: "#b07c6e",
    amber: "#b69a5e",
    cyan: "#6d9690",
    corFII: { MFII11:"#6d9690",VGHF11:"#7ba39c",RBRY11:"#89a59f",OIAG11:"#9bb0a0",CPTS11:"#a9bbac",GARE11:"#7f9b86",TRXF11:"#6e8a74",RBRX11:"#83a08a",IRIM11:"#96ad99",KNCR11:"#aabba0",VISC11:"#7d978a",XPML11:"#92a995",MXRF11:"#b3c0b0" },
    corAcao: { BBAS3:"#4f6147",PETR4:"#5e7155",BBDC3:"#6f8166",ITSA4:"#7d8f73",BBSE3:"#8a9b80",TAEE11:"#97a78d",BRSR6:"#a4b29a",KLBN4:"#69745e",KLBN11:"#76836a",CXSE3:"#838f76",WEGE3:"#909b82",CPLE3:"#9da78e",SANB3:"#aab39b" },
  },
};

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════
function mesesIdx(mesesCal) {
  return mesesCal.map(m => m >= 7 ? m - 7 : m + 5).filter(i => i >= 0 && i < 12);
}
function labelMes(offset) {
  const meses = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const totalMes = 6 + offset;
  return `${meses[totalMes % 12]}/${String(2026 + Math.floor(totalMes / 12)).slice(2)}`;
}
const fmt  = v => v.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
const fmtK = v => v >= 1000 ? `R$${(v/1000).toFixed(1)}k` : fmt(v);

// ── IMPORTAÇÃO EM MASSA — lê texto colado tipo "BBAS3 291 20,55" ──────────
// Aceita: TICKER QTD [PREÇO_MÉDIO] [COTAÇÃO], com vírgula ou ponto decimal.
function parseNumBR(s) {
  if (s == null) return NaN;
  s = String(s).replace(/[R$\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // formato BR: 1.234,56
  return parseFloat(s);
}
function parseImportacao(txt) {
  const linhas = String(txt||"").split(/\n+/).map(l=>l.trim()).filter(Boolean);
  const itens = [];
  for (const l of linhas) {
    const m = l.match(/([A-Za-z]{4}\d{1,2})/); // ticker tipo BBAS3, MFII11
    if (!m) { itens.push({ raw:l, erro:true }); continue; }
    const ticker = m[1].toUpperCase();
    const resto = l.slice(l.indexOf(m[1]) + m[1].length);
    const nums = (resto.match(/[\d.,]+/g) || []).map(parseNumBR).filter(n=>!isNaN(n));
    if (nums.length === 0) { itens.push({ raw:l, ticker, erro:true }); continue; }
    itens.push({
      ticker,
      qtd:        nums[0] != null ? Math.round(nums[0]) : null,
      precoMedio: nums[1] != null ? nums[1] : null,
      cotacao:    nums[2] != null ? nums[2] : null,
    });
  }
  return itens;
}


// Grupo de exibição (para listas agrupadas e expansíveis). NÃO altera o campo
// 'cat' do ativo (que continua alimentando gráficos e filtros) — é só para exibir.
function grupoDe(a) {
  if (a.cat === "FII") return "FIIs";
  if (a.cat === "Cripto") return "Cripto";
  if (/^(BOVA11|BOVX11|IVVB11|SMAL11|HASH11|XINA11|NASD11|GOLD11|VWRA11)$/.test(a.ticker)) return "ETFs";
  if (/tesouro|tesour/i.test(a.nome) || /^(LFT|LTN|NTN|TD)/.test(a.ticker)) return "Tesouro Direto";
  return "Ações";
}
const ORDEM_GRUPOS = ["FIIs","Ações","ETFs","Cripto","Tesouro Direto","Outros"];
const EMOJI_GRUPO = { "FIIs":"🏢","Ações":"📈","ETFs":"📊","Cripto":"🪙","Tesouro Direto":"🏛️","Outros":"📦" };
const COR_GRUPO = (nome,T) => ({ "FIIs":T.cyan,"Ações":T.accent,"ETFs":"#f472b6","Cripto":T.amber,"Tesouro Direto":T.green,"Outros":T.textMute }[nome] || T.accent);


const MESES_BASE = ["Jul/26","Ago/26","Set/26","Out/26","Nov/26","Dez/26","Jan/27","Fev/27","Mar/27","Abr/27","Mai/27","Jun/27"];

// ════════════════════════════════════════════════════════════════════════════
// DADOS INICIAIS DOS ATIVOS (editáveis na aba "Editar")
// ════════════════════════════════════════════════════════════════════════════
// Setor (subcategoria) de cada ativo — poucos grupos, fácil de ler
const SETOR_TICKER = {
  // Ações
  BBAS3:"Bancos", BBDC3:"Bancos", SANB3:"Bancos", BRSR6:"Bancos", ITSA4:"Bancos", B3SA3:"Bancos",
  BBSE3:"Seguradoras", CXSE3:"Seguradoras",
  TAEE11:"Energia & Infra", CPLE3:"Energia & Infra", SBSP3:"Energia & Infra", WEGE3:"Energia & Infra", EMBJ3:"Energia & Infra",
  PETR4:"Commodities", KLBN4:"Commodities", KLBN11:"Commodities",
  // FIIs
  VGHF11:"FII Papel", RBRY11:"FII Papel", CPTS11:"FII Papel", IRIM11:"FII Papel", KNCR11:"FII Papel", MXRF11:"FII Papel", RBRX11:"FII Papel",
  MFII11:"FII Tijolo", TRXF11:"FII Tijolo", GARE11:"FII Tijolo", VISC11:"FII Tijolo", XPML11:"FII Tijolo", OIAG11:"FII Tijolo",
  // Índice & Cripto
  BOVA11:"Índice & Cripto", BOVX11:"Índice & Cripto", COIN11:"Índice & Cripto",
};
// Cor de cada setor (para gráficos do dashboard)
const COR_SETOR = {
  "Bancos":"#6366f1", "Seguradoras":"#a78bfa", "Energia & Infra":"#22d3ee",
  "Commodities":"#fbbf24", "FII Papel":"#34d399", "FII Tijolo":"#2dd4bf",
  "Índice & Cripto":"#f472b6", "Outros":"#64748b",
};

const ATIVOS_INICIAIS = []; // conta nova começa do zero — ativos são adicionados pelo usuário

// ════════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE ATIVOS — sugestões ao adicionar (t=ticker, n=nome, c=cat, s=setor, f=freq)
// ════════════════════════════════════════════════════════════════════════════
const CATALOGO_ATIVOS = [
  {t:"VALE3",n:"Vale",c:"Ação",s:"Mineração",f:"Semestral"},{t:"PETR4",n:"Petrobras PN",c:"Ação",s:"Petróleo",f:"Trimestral"},{t:"PETR3",n:"Petrobras ON",c:"Ação",s:"Petróleo",f:"Trimestral"},
  {t:"ITUB4",n:"Itaú Unibanco",c:"Ação",s:"Bancos",f:"Mensal"},{t:"BBDC4",n:"Bradesco",c:"Ação",s:"Bancos",f:"Mensal"},{t:"BBAS3",n:"Banco do Brasil",c:"Ação",s:"Bancos",f:"Trimestral"},
  {t:"SANB11",n:"Santander",c:"Ação",s:"Bancos",f:"Semestral"},{t:"ITSA4",n:"Itaúsa",c:"Ação",s:"Holdings",f:"Trimestral"},{t:"B3SA3",n:"B3",c:"Ação",s:"Financeiro",f:"Trimestral"},
  {t:"BBSE3",n:"BB Seguridade",c:"Ação",s:"Seguros",f:"Semestral"},{t:"CXSE3",n:"Caixa Seguridade",c:"Ação",s:"Seguros",f:"Semestral"},{t:"PSSA3",n:"Porto Seguro",c:"Ação",s:"Seguros",f:"Trimestral"},
  {t:"WEGE3",n:"WEG",c:"Ação",s:"Industrial",f:"Trimestral"},{t:"ABEV3",n:"Ambev",c:"Ação",s:"Bebidas",f:"Anual"},{t:"SUZB3",n:"Suzano",c:"Ação",s:"Papel e Celulose",f:"Anual"},
  {t:"KLBN11",n:"Klabin",c:"Ação",s:"Papel e Celulose",f:"Trimestral"},{t:"GGBR4",n:"Gerdau",c:"Ação",s:"Siderurgia",f:"Trimestral"},{t:"CSNA3",n:"CSN",c:"Ação",s:"Siderurgia",f:"Anual"},
  {t:"USIM5",n:"Usiminas",c:"Ação",s:"Siderurgia",f:"Anual"},{t:"CMIG4",n:"Cemig",c:"Ação",s:"Energia",f:"Semestral"},{t:"CPLE6",n:"Copel",c:"Ação",s:"Energia",f:"Semestral"},
  {t:"ELET3",n:"Eletrobras",c:"Ação",s:"Energia",f:"Anual"},{t:"EGIE3",n:"Engie Brasil",c:"Ação",s:"Energia",f:"Semestral"},{t:"TAEE11",n:"Taesa",c:"Ação",s:"Energia",f:"Trimestral"},
  {t:"TRPL4",n:"ISA Energia",c:"Ação",s:"Energia",f:"Anual"},{t:"CPFE3",n:"CPFL Energia",c:"Ação",s:"Energia",f:"Anual"},{t:"AURE3",n:"Auren",c:"Ação",s:"Energia",f:"Anual"},
  {t:"NEOE3",n:"Neoenergia",c:"Ação",s:"Energia",f:"Anual"},{t:"SBSP3",n:"Sabesp",c:"Ação",s:"Saneamento",f:"Anual"},{t:"CSMG3",n:"Copasa",c:"Ação",s:"Saneamento",f:"Trimestral"},
  {t:"SAPR11",n:"Sanepar",c:"Ação",s:"Saneamento",f:"Trimestral"},{t:"VIVT3",n:"Vivo",c:"Ação",s:"Telecom",f:"Trimestral"},{t:"TIMS3",n:"TIM",c:"Ação",s:"Telecom",f:"Trimestral"},
  {t:"RADL3",n:"RaiaDrogasil",c:"Ação",s:"Saúde",f:"Trimestral"},{t:"HYPE3",n:"Hypera",c:"Ação",s:"Saúde",f:"Trimestral"},{t:"FLRY3",n:"Fleury",c:"Ação",s:"Saúde",f:"Trimestral"},
  {t:"RENT3",n:"Localiza",c:"Ação",s:"Locação",f:"Trimestral"},{t:"RAIL3",n:"Rumo",c:"Ação",s:"Logística",f:"Anual"},{t:"MOTV3",n:"Motiva (CCR)",c:"Ação",s:"Concessões",f:"Anual"},
  {t:"EMBR3",n:"Embraer",c:"Ação",s:"Aeroespacial",f:"—"},{t:"PRIO3",n:"PRIO",c:"Ação",s:"Petróleo",f:"—"},{t:"RECV3",n:"PetroRecôncavo",c:"Ação",s:"Petróleo",f:"Trimestral"},
  {t:"CSAN3",n:"Cosan",c:"Ação",s:"Energia",f:"Anual"},{t:"UGPA3",n:"Ultrapar",c:"Ação",s:"Distribuição",f:"Semestral"},{t:"VBBR3",n:"Vibra",c:"Ação",s:"Distribuição",f:"Semestral"},
  {t:"LREN3",n:"Lojas Renner",c:"Ação",s:"Varejo",f:"Trimestral"},{t:"MGLU3",n:"Magazine Luiza",c:"Ação",s:"Varejo",f:"—"},{t:"JBSS3",n:"JBS",c:"Ação",s:"Alimentos",f:"Anual"},
  {t:"BRFS3",n:"BRF",c:"Ação",s:"Alimentos",f:"—"},{t:"BEEF3",n:"Minerva",c:"Ação",s:"Alimentos",f:"Anual"},
  {t:"MXRF11",n:"Maxi Renda",c:"FII",s:"Papel",f:"Mensal"},{t:"KNCR11",n:"Kinea Rendimentos",c:"FII",s:"Papel",f:"Mensal"},{t:"KNIP11",n:"Kinea Índice de Preços",c:"FII",s:"Papel",f:"Mensal"},
  {t:"KNRI11",n:"Kinea Renda Imobiliária",c:"FII",s:"Híbrido",f:"Mensal"},{t:"HGLG11",n:"CSHG Logística",c:"FII",s:"Logística",f:"Mensal"},{t:"BTLG11",n:"BTG Logística",c:"FII",s:"Logística",f:"Mensal"},
  {t:"VILG11",n:"Vinci Logística",c:"FII",s:"Logística",f:"Mensal"},{t:"XPLG11",n:"XP Log",c:"FII",s:"Logística",f:"Mensal"},{t:"LVBI11",n:"VBI Logístico",c:"FII",s:"Logística",f:"Mensal"},
  {t:"HGRU11",n:"CSHG Renda Urbana",c:"FII",s:"Renda Urbana",f:"Mensal"},{t:"TRXF11",n:"TRX Real Estate",c:"FII",s:"Renda Urbana",f:"Mensal"},{t:"GARE11",n:"Guardian Real Estate",c:"FII",s:"Renda Urbana",f:"Mensal"},
  {t:"HGRE11",n:"CSHG Real Estate",c:"FII",s:"Lajes",f:"Mensal"},{t:"PVBI11",n:"VBI Prime Properties",c:"FII",s:"Lajes",f:"Mensal"},{t:"JSRE11",n:"JS Real Estate",c:"FII",s:"Lajes",f:"Mensal"},
  {t:"XPML11",n:"XP Malls",c:"FII",s:"Shoppings",f:"Mensal"},{t:"VISC11",n:"Vinci Shopping Centers",c:"FII",s:"Shoppings",f:"Mensal"},{t:"HGBS11",n:"Hedge Brasil Shopping",c:"FII",s:"Shoppings",f:"Mensal"},
  {t:"MALL11",n:"Malls Brasil Plural",c:"FII",s:"Shoppings",f:"Mensal"},{t:"HSML11",n:"HSI Malls",c:"FII",s:"Shoppings",f:"Mensal"},{t:"MFII11",n:"Mérito Desenvolvimento",c:"FII",s:"Desenvolvimento",f:"Mensal"},
  {t:"CPTS11",n:"Capitânia Securities",c:"FII",s:"Papel",f:"Mensal"},{t:"VGHF11",n:"Valora Hedge Fund",c:"FII",s:"Multiestratégia",f:"Mensal"},{t:"VGIR11",n:"Valora CRI",c:"FII",s:"Papel",f:"Mensal"},
  {t:"RBRY11",n:"RBR Crédito Estruturado",c:"FII",s:"Papel",f:"Mensal"},{t:"RBRR11",n:"RBR High Grade",c:"FII",s:"Papel",f:"Mensal"},{t:"IRDM11",n:"Iridium Recebíveis",c:"FII",s:"Papel",f:"Mensal"},
  {t:"VRTA11",n:"Fator Verità",c:"FII",s:"Papel",f:"Mensal"},{t:"RECR11",n:"REC Recebíveis",c:"FII",s:"Papel",f:"Mensal"},{t:"BCFF11",n:"BTG Fundo de Fundos",c:"FII",s:"FoF",f:"Mensal"},
  {t:"RBRF11",n:"RBR Alpha",c:"FII",s:"FoF",f:"Mensal"},{t:"HFOF11",n:"Hedge Top FoF",c:"FII",s:"FoF",f:"Mensal"},{t:"VINO11",n:"Vinci Offices",c:"FII",s:"Lajes",f:"Mensal"},
  {t:"RZTR11",n:"Riza Terrax",c:"FII",s:"Agro",f:"Mensal"},{t:"OIAG11",n:"Ourinvest Agro",c:"FII",s:"Agro",f:"Mensal"},{t:"KNSC11",n:"Kinea Securities",c:"FII",s:"Papel",f:"Mensal"},
  {t:"BOVA11",n:"iShares Ibovespa",c:"ETF",s:"Índice BR",f:"—"},{t:"IVVB11",n:"iShares S&P 500",c:"ETF",s:"Internacional",f:"—"},{t:"SMAL11",n:"iShares Small Caps",c:"ETF",s:"Índice BR",f:"—"},
  {t:"DIVO11",n:"It Now Dividendos",c:"ETF",s:"Dividendos",f:"—"},{t:"HASH11",n:"Hashdex Cripto",c:"ETF",s:"Cripto",f:"—"},{t:"GOLD11",n:"Trend Ouro",c:"ETF",s:"Ouro",f:"—"},
  {t:"XFIX11",n:"Trend IFIX",c:"ETF",s:"FIIs",f:"Mensal"},{t:"IMAB11",n:"It Now IMA-B",c:"ETF",s:"Renda Fixa",f:"—"},{t:"B5P211",n:"It Now IMA-B5",c:"ETF",s:"Renda Fixa",f:"—"},{t:"WRLD11",n:"Trend Mundo",c:"ETF",s:"Internacional",f:"—"},
  {t:"AAPL34",n:"Apple",c:"Ação",s:"BDR · Tecnologia",f:"Trimestral"},{t:"MSFT34",n:"Microsoft",c:"Ação",s:"BDR · Tecnologia",f:"Trimestral"},{t:"GOGL34",n:"Alphabet (Google)",c:"Ação",s:"BDR · Tecnologia",f:"—"},
  {t:"AMZO34",n:"Amazon",c:"Ação",s:"BDR · Tecnologia",f:"—"},{t:"TSLA34",n:"Tesla",c:"Ação",s:"BDR · Automotivo",f:"—"},{t:"NVDC34",n:"NVIDIA",c:"Ação",s:"BDR · Tecnologia",f:"Trimestral"},
  {t:"META34",n:"Meta (Facebook)",c:"Ação",s:"BDR · Tecnologia",f:"Trimestral"},{t:"NFLX34",n:"Netflix",c:"Ação",s:"BDR · Mídia",f:"—"},{t:"DISB34",n:"Disney",c:"Ação",s:"BDR · Mídia",f:"Anual"},{t:"COCA34",n:"Coca-Cola",c:"Ação",s:"BDR · Consumo",f:"Trimestral"},
  {t:"PAGS34",n:"PagSeguro",c:"Ação",s:"BDR · Pagamentos",f:"—"},{t:"VWRA11",n:"Investo FTSE All-World",c:"ETF",s:"Internacional",f:"—"},
  {t:"TESOURO SELIC 2029",n:"Tesouro Selic 2029",c:"Tesouro",s:"Renda Fixa",f:"—"},{t:"TESOURO IPCA+ 2035",n:"Tesouro IPCA+ 2035",c:"Tesouro",s:"Renda Fixa",f:"—"},
  {t:"TESOURO IPCA+ 2045",n:"Tesouro IPCA+ 2045",c:"Tesouro",s:"Renda Fixa",f:"—"},{t:"TESOURO PREFIXADO 2029",n:"Tesouro Prefixado 2029",c:"Tesouro",s:"Renda Fixa",f:"—"},
  {t:"TESOURO RENDA+ 2065",n:"Tesouro Renda+ 2065",c:"Tesouro",s:"Renda Fixa",f:"—"},
  {t:"BTC",n:"Bitcoin",c:"Cripto",s:"Cripto",f:"—"},{t:"ETH",n:"Ethereum",c:"Cripto",s:"Cripto",f:"—"},
];

// ════════════════════════════════════════════════════════════════════════════
// PERSISTÊNCIA — salva tudo na memória permanente do app (localStorage)
// Funciona no APK. No preview do Claude o localStorage é bloqueado, então
// envolvemos em try/catch: lá não salva, mas também não quebra.
// ════════════════════════════════════════════════════════════════════════════
let PREFIXO = "carteiraProventos_"; // muda por usuário após o login (dados separados por conta)
const CONTAS_KEY = "carteiraProventos_CONTAS";
const SESSAO_KEY = "carteiraProventos_SESSAO";
function definirUsuarioAtivo(email) {
  const slug = String(email||"").toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 40);
  PREFIXO = "carteiraProventos_u_" + slug + "_";
}
function hashSenha(sx) { let h=5381; const str=String(sx); for (let i=0;i<str.length;i++){ h=((h<<5)+h+str.charCodeAt(i))|0; } return "h"+(h>>>0).toString(36); }
function lerContas(){ try { return JSON.parse(localStorage.getItem(CONTAS_KEY)||"{}")||{}; } catch { return {}; } }
function gravarContas(c){ try { localStorage.setItem(CONTAS_KEY, JSON.stringify(c)); } catch {} }
function gerarFraseRec(){ const P=["verde","ouro","lua","rio","trigo","norte","pinho","sol","mar","serra","campo","aurora"]; const r=()=>P[Math.floor(Math.random()*P.length)]; return `${r()}-${r()}-${r()}-${Math.floor(100+Math.random()*900)}`; }

function lerSalvo(chave, padrao) {
  try {
    const v = localStorage.getItem(PREFIXO + chave);
    return v !== null ? JSON.parse(v) : padrao;
  } catch { return padrao; }
}
function gravarSalvo(chave, valor) {
  try { localStorage.setItem(PREFIXO + chave, JSON.stringify(valor)); } catch { /* preview: ignora */ }
}

// ════════════════════════════════════════════════════════════════════════════
// MOTOR DE LOGS — registro central de tudo que acontece no app
// Cada log: { id, ts, tipo, direcao, origem, msg, detalhe }
//   tipo:    "cotacao" | "edicao" | "chat" | "erro" | "sistema" | "import"
//   direcao: "ida" (app->fora) | "volta" (fora->app) | "interno"
//   origem:  "app" | "api" (brapi) | "servidor" (bridge/IA)
// ════════════════════════════════════════════════════════════════════════════
const LOG_CHAVE = "logs";
const LOG_MAX = 500; // mantém os últimos 500 registros
let _logListeners = [];

function registrarLog(tipo, msg, opts = {}) {
  const entrada = {
    id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    ts: new Date().toISOString(),
    tipo,
    direcao: opts.direcao || "interno",
    origem: opts.origem || "app",
    msg: String(msg),
    detalhe: opts.detalhe != null ? (typeof opts.detalhe === "string" ? opts.detalhe : JSON.stringify(opts.detalhe)) : null,
  };
  try {
    const atuais = lerSalvo(LOG_CHAVE, []);
    const novos = [entrada, ...atuais].slice(0, LOG_MAX);
    gravarSalvo(LOG_CHAVE, novos);
    _logListeners.forEach(fn => { try { fn(novos); } catch {} });
  } catch {}
  return entrada;
}
function lerLogs() { return lerSalvo(LOG_CHAVE, []); }
function limparLogs() { gravarSalvo(LOG_CHAVE, []); _logListeners.forEach(fn=>{try{fn([]);}catch{}}); }
function inscreverLogs(fn) { _logListeners.push(fn); return () => { _logListeners = _logListeners.filter(f=>f!==fn); }; }


// Hook: igual ao useState, mas grava automaticamente toda mudança na memória.
function useEstadoSalvo(chave, padrao) {
  const [valor, setValor] = useState(() => lerSalvo(chave, padrao));
  useEffect(() => { gravarSalvo(chave, valor); }, [chave, valor]);
  return [valor, setValor];
}

// Carrega os ativos salvos, mas SEMPRE inclui ativos novos que eu adicionar no
// código no futuro (faz merge por ticker): suas edições são preservadas e os
// ativos novos aparecem mesmo que você já tenha dados salvos.
function carregarAtivos() {
  const salvos = lerSalvo("ativos", null);
  // 1) parte da lista SALVA, preservando TODOS os campos (movimentacoes, proventosHist, nome, cat...)
  const lista = Array.isArray(salvos) ? salvos.filter(a => a && a.ticker).map(a => ({ ...a })) : [];
  // 2) acrescenta ao final os ativos do código que ainda não existem na lista salva
  const tickers = new Set(lista.map(a => a.ticker));
  ATIVOS_INICIAIS.forEach(base => { if (!tickers.has(base.ticker)) lista.push({ ...base }); });
  return lista;
}

// ════════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE CÁLCULO (recebem a lista de ativos como parâmetro)
// ════════════════════════════════════════════════════════════════════════════
function corDe(ticker, cat, T) {
  return cat === "FII" ? (T.corFII[ticker] || T.cyan) : (T.corAcao[ticker] || T.accent);
}

function buildChart(ativos, filtro) {
  const lista = filtro==="TUDO" ? ativos : filtro==="FII" ? ativos.filter(a=>a.cat==="FII") : ativos.filter(a=>a.cat==="Ação");
  return MESES_BASE.map((mes,i) => {
    const e = { mes };
    let t = 0;
    lista.forEach(a => { const v = mesesIdx(a.meses).includes(i) ? +(a.prov*a.qtd).toFixed(2) : 0; e[a.ticker]=v; t+=v; });
    e._total = +t.toFixed(2);
    return e;
  });
}

function simular(ativos, regras, horizonte, aporte, aportesExtras = [], creditoCartao = 0) {
  const estado = ativos.map(a => ({ ...a }));
  let acum = 0;
  return Array.from({ length: horizonte }, (_, m) => {
    let provBrutoMes = 0;
    const detalhes = [];
    estado.forEach(a => {
      if (mesesIdx(a.meses).includes(m % 12)) {
        const v = a.prov * a.qtd;
        provBrutoMes += v;
        detalhes.push({ ticker: a.ticker, cat: a.cat, val: +v.toFixed(2) });
      }
    });
    // aportes esporádicos que caem neste mês (13º, férias, venda de item, etc.)
    const extrasMes = aportesExtras.filter(e => e.mes === m);
    const extraValor = extrasMes.reduce((s,e)=>s+(+e.valor||0), 0);
    // crédito do cartão garantido por ativos: injeção única no 1º mês (acelera a bola de neve)
    const creditoMes = m === 0 ? creditoCartao : 0;
    const caixaInicial = acum + provBrutoMes + aporte + extraValor + creditoMes;
    let caixa = caixaInicial;
    const compras = [];
    let reinvestido = 0;
    regras.forEach(r => {
      if (r.pct <= 0) return;
      const ativo = estado.find(a => a.ticker === r.ticker);
      if (!ativo) return;
      const cot = r.cotacaoAlvo || ativo.cotacao;
      const cotas = Math.floor((caixaInicial * (r.pct / 100)) / cot);
      if (cotas > 0) {
        ativo.qtd += cotas;
        caixa -= cotas * cot;
        reinvestido += cotas * cot;
        compras.push({ ticker: r.ticker, cotas, gasto: +(cotas*cot).toFixed(2) });
      }
    });
    acum = Math.max(caixa, 0);
    const patri = estado.reduce((s,a) => s + a.qtd*a.cotacao, 0);
    const provMedio = estado.reduce((s,a) => s + a.prov*a.qtd*a.meses.length/12, 0);
    // limite de cartão (PLACEHOLDER): projeção de crédito usando ativos como garantia.
    // Será refinado quando a aba de cartões for construída (ex: Tesouro como garantia).
    const limiteCartao = patri * 0.40;
    return {
      mes: labelMes(m),
      provento: +provBrutoMes.toFixed(2),
      provMedio: +provMedio.toFixed(2),
      patrimonio: +patri.toFixed(2),
      caixa: +acum.toFixed(2),
      limiteCartao: +limiteCartao.toFixed(2),
      reinvestido: +reinvestido.toFixed(2),
      aporteExtra: +extraValor.toFixed(2),
      extrasMes,
      compras,
      detalhes: detalhes.sort((a,b)=>b.val-a.val),
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTES VISUAIS
// ════════════════════════════════════════════════════════════════════════════
function TipBar({ active, payload, label, ativos, T }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter(p=>p.value>0).sort((a,b)=>b.value-a.value);
  const findCat = tk => ativos.find(a=>a.ticker===tk)?.cat;
  return (
    <div style={{ background:T.card,border:`1px solid ${T.accentBorder}`,borderRadius:10,padding:"10px 14px",minWidth:200,maxHeight:300,overflowY:"auto",boxShadow:"0 8px 24px #0008" }}>
      <div style={{ fontSize:11,fontWeight:800,color:T.accentSoft,marginBottom:6,borderBottom:`1px solid ${T.border}`,paddingBottom:4 }}>{label}</div>
      {items.map(p=>{
        const c = corDe(p.dataKey, findCat(p.dataKey), T);
        return (
          <div key={p.dataKey} style={{ display:"flex",justifyContent:"space-between",gap:10,marginBottom:3,alignItems:"center" }}>
            <div style={{ display:"flex",alignItems:"center",gap:5 }}>
              <div style={{ width:8,height:8,borderRadius:2,background:c,flexShrink:0 }}/>
              <span style={{ fontSize:10,color:T.textDim }}>{p.dataKey}</span>
            </div>
            <span style={{ fontSize:11,fontWeight:700,color:c }}>{fmt(p.value)}</span>
          </div>
        );
      })}
      <div style={{ borderTop:`1px solid ${T.accentBorder}`,marginTop:6,paddingTop:6,fontSize:12,fontWeight:800,color:T.accentSoft,display:"flex",justifyContent:"space-between" }}>
        <span>Total</span><span>{fmt(items.reduce((s,p)=>s+p.value,0))}</span>
      </div>
    </div>
  );
}

function TipSim({ active, payload, label, T }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:T.card,border:`1px solid ${T.accentBorder}`,borderRadius:10,padding:"10px 14px",minWidth:190,boxShadow:"0 8px 24px #0008" }}>
      <div style={{ fontSize:11,fontWeight:800,color:T.accentSoft,marginBottom:6,borderBottom:`1px solid ${T.border}`,paddingBottom:4 }}>{label}</div>
      {payload.map(p=>(
        <div key={p.name} style={{ display:"flex",justifyContent:"space-between",gap:14,marginBottom:3 }}>
          <div style={{ display:"flex",alignItems:"center",gap:5 }}>
            <div style={{ width:8,height:8,borderRadius:2,background:p.color }}/>
            <span style={{ fontSize:10,color:T.textDim }}>{p.name}</span>
          </div>
          <span style={{ fontSize:11,fontWeight:700,color:p.color }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Legenda({ ativos, T }) {
  return (
    <div style={{ display:"flex",flexWrap:"wrap",gap:"4px 10px",padding:"6px 8px 2px" }}>
      {ativos.map(a=>(
        <div key={a.ticker} style={{ display:"flex",alignItems:"center",gap:4 }}>
          <div style={{ width:8,height:8,borderRadius:2,background:corDe(a.ticker,a.cat,T) }}/>
          <span style={{ fontSize:9,color:T.textMute }}>{a.ticker}</span>
        </div>
      ))}
    </div>
  );
}

function DetalheMes({ ativos, idx, filtro, T }) {
  const [abertos, setAbertos] = useState({});
  const lista = filtro==="TUDO" ? ativos : filtro==="FII" ? ativos.filter(a=>a.cat==="FII") : ativos.filter(a=>a.cat==="Ação");
  const pag = lista.filter(a=>mesesIdx(a.meses).includes(idx)).map(a=>({...a,total:+(a.prov*a.qtd).toFixed(2)})).sort((a,b)=>b.total-a.total);
  const total = pag.reduce((s,a)=>s+a.total,0);

  // agrupa por categoria de exibição
  const grupos = {};
  pag.forEach(a => { const g = grupoDe(a); (grupos[g] = grupos[g] || []).push(a); });
  const ordenados = ORDEM_GRUPOS.filter(g => grupos[g]);

  return (
    <div>
      <div style={{ display:"flex",alignItems:"baseline",gap:8,marginBottom:10 }}>
        <span style={{ fontSize:12,fontWeight:700,color:T.accentSoft }}>{MESES_BASE[idx]}</span>
        <span style={{ fontSize:20,fontWeight:800,color:T.text }}>{fmt(total)}</span>
      </div>
      {pag.length===0
        ? <div style={{ fontSize:12,color:T.textFaint,textAlign:"center",padding:"16px 0" }}>Nenhum provento neste mês</div>
        : ordenados.map(g=>{
          const itens = grupos[g];
          const cg = COR_GRUPO(g,T);
          const aberto = abertos[g];
          const subtotal = itens.reduce((s,a)=>s+a.total,0);
          const patri = itens.reduce((s,a)=>s+a.qtd*a.cotacao,0);
          return (
            <div key={g} style={{ marginBottom:6 }}>
              {/* linha do grupo (clicável) */}
              <div onClick={()=>setAbertos(p=>({ ...p, [g]:!p[g] }))} style={{
                display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer",
                background:`${cg}10`, border:`1px solid ${cg}33`, borderLeft:`3px solid ${cg}`,
                borderRadius:8, padding:"9px 12px"
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:10, color:T.textFaint, transform:aberto?"rotate(90deg)":"none", transition:"transform 0.2s", display:"inline-block" }}>▶</span>
                  <span style={{ fontSize:13 }}>{EMOJI_GRUPO[g]}</span>
                  <div>
                    <span style={{ fontSize:12, fontWeight:800, color:T.text }}>{g}</span>
                    <div style={{ fontSize:9, color:T.textFaint }}>{itens.length} ativo{itens.length>1?"s":""} · {fmt(patri)} em carteira</div>
                  </div>
                </div>
                <div style={{ fontSize:13, fontWeight:800, color:cg }}>{fmt(subtotal)}</div>
              </div>
              {/* itens do grupo */}
              {aberto && (
                <div style={{ paddingLeft:6, marginTop:5 }}>
                  {itens.map(a=>{
                    const c = corDe(a.ticker,a.cat,T);
                    return (
                      <div key={a.ticker} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",background:`${c}0d`,border:`1px solid ${c}33`,borderLeft:`3px solid ${c}`,borderRadius:8,padding:"8px 12px",marginBottom:5 }}>
                        <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                          <div style={{ width:8,height:8,borderRadius:2,background:c }}/>
                          <div>
                            <span onClick={()=>abrirEditorAtivo(a.ticker)} style={{ fontSize:12,fontWeight:700,color:T.text, cursor:"pointer" }}>{a.ticker}</span>
                            <span style={{ fontSize:9,color:T.textFaint,background:T.border,padding:"1px 5px",borderRadius:4,marginLeft:6 }}>{a.freq}</span>
                            <div style={{ fontSize:10,color:T.textFaint,marginTop:1 }}>{a.nome} · {a.qtd}× R${a.prov.toFixed(2)}</div>
                          </div>
                        </div>
                        <div style={{ fontSize:13,fontWeight:800,color:c }}>{fmt(a.total)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      }
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD DA CARTEIRA — composição (pizza) + dinheiro (barras), por grupo
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// BLOCOS CONFIGURÁVEIS (Camada 2) — componentes que podem mudar de página/ordem
// ════════════════════════════════════════════════════════════════════════════
function BlocoProx3Meses({ serie = [], estiloDe = () => ({ style:{}, cls:"" }), T }) {
  const cores = [T.green, T.accentSoft, T.cyan];
  const rotulos = ["📥 Este mês", "📅 Próximo mês", "🗓️ Mês seguinte"];
  return (
    <div style={{ marginBottom:18 }}>
      <div className={estiloDe("tituloProx3Meses",11).cls} style={{ fontSize:11, color:T.textMute, fontWeight:600, marginBottom:10, ...estiloDe("tituloProx3Meses",11).style }}>📆 Proventos a receber · próximos 3 meses</div>
      <div style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:4, scrollSnapType:"x mandatory" }}>
        {serie.map((l, i) => (
          <div key={l.ym} style={{ flex:"0 0 auto", width:"46%", minWidth:150, scrollSnapAlign:"start", background:`linear-gradient(135deg, ${cores[i]}22, ${T.card})`, border:`1px solid ${cores[i]}44`, borderRadius:14, padding:"15px 15px 16px" }}>
            <div style={{ fontSize:9, color:cores[i], fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>{rotulos[i]}</div>
            <div style={{ fontSize:10, color:T.textFaint, marginBottom:8 }}>{l.rotulo} · {l.futuro ? "previsto" : (l.previsto > 0 ? "recebido + pendente" : "recebido")}</div>
            <div style={{ fontSize:22, fontWeight:800, color:cores[i], letterSpacing:-0.5 }}>{fmt(l.total)}</div>
            <div style={{ fontSize:9, color:T.textMute, marginTop:5 }}>{l.total === 0 ? "nenhum provento previsto" : [l.real > 0 ? `recebido ${fmt(l.real)}` : "", l.previsto > 0 ? `previsto ${fmt(l.previsto)}` : ""].filter(Boolean).join(" · ")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BlocoGraficoMensal({ serie = [], janela = "ano", setJanela = () => {}, ano, setAno = () => {}, estiloDe = () => ({ style:{}, cls:"" }), T }) {
  const FILTROS = [["ano", "Ano"], ["12m", "12 meses"], ["2a", "2 anos"], ["tudo", "Desde o começo"]];
  const dados = serie.map(l => ({ mes: l.rotulo, Recebido: l.real, Previsto: l.previsto }));
  const temDados = dados.some(d => d.Recebido > 0 || d.Previsto > 0);
  const btn = (ativo) => ({ padding:"5px 8px", borderRadius:7, border:`1px solid ${ativo ? T.accent : T.border}`, background: ativo ? `${T.accent}22` : T.cardAlt, color: ativo ? T.accentSoft : T.textMute, cursor:"pointer", fontSize:10, fontWeight:700 });
  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px 8px 8px", marginBottom:16 }}>
      <div className={estiloDe("tituloGraficoMensal",11).cls} style={{ paddingLeft:8, marginBottom:8, fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1, ...estiloDe("tituloGraficoMensal",11).style }}>💵 Proventos mês a mês</div>
      <div style={{ display:"flex", alignItems:"center", gap:5, paddingLeft:8, marginBottom:8, flexWrap:"wrap" }}>
        {janela === "ano" && (<>
          <button onClick={() => setAno(ano - 1)} style={btn(false)}>‹</button>
          <span style={{ fontSize:12, fontWeight:800, color:T.text, minWidth:42, textAlign:"center" }}>{ano}</span>
          <button onClick={() => setAno(ano + 1)} style={btn(false)}>›</button>
        </>)}
        <span style={{ flex:1 }}/>
        {FILTROS.map(([id, lb]) => <button key={id} onClick={() => setJanela(id)} style={btn(janela === id)}>{lb}</button>)}
      </div>
      {temDados ? (
        <div style={{ width:"100%", height:170 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dados} margin={{ top:4, right:8, left:0, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false}/>
              <XAxis dataKey="mes" tick={{ fontSize:8, fill:T.textMute }} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
              <YAxis tick={{ fontSize:8, fill:T.textMute }} axisLine={false} tickLine={false} width={38} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : `${Math.round(v)}`}/>
              <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:8, fontSize:12 }} cursor={{ fill:`${T.accent}11` }}/>
              <Bar dataKey="Recebido" stackId="p" fill={T.green}/>
              <Bar dataKey="Previsto" stackId="p" fill={T.cyan} fillOpacity={0.5} radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={{ fontSize:11, color:T.textFaint, padding:"34px 12px", textAlign:"center", lineHeight:1.6 }}>Sem proventos neste período. Importe a planilha de Movimentação (e a de Eventos, se tiver) na tela ✏️ Editar.</div>
      )}
      <div style={{ fontSize:9, color:T.textFaint, padding:"6px 10px 0" }}>Verde = já recebido · azul = previsto (evento anunciado, ou o último valor repetido nos meses de pagamento).</div>
    </div>
  );
}

// Registro dos blocos móveis: id, nome, página padrão e ordem padrão.
// A base do app usa SEMPRE este padrão se a configuração estiver vazia/quebrada.
const BLOCOS_PAGINAS = ["painel","analises","calendario","ranking","custovida"];
const BLOCOS_DEF = [
  { id:"prox3meses",       nome:"Proventos · 3 meses",    emoji:"📆", paginaPadrao:"painel", ordemPadrao:1 },
  { id:"graficoMensal",    nome:"Proventos mês a mês",    emoji:"💵", paginaPadrao:"painel", ordemPadrao:2 },
  { id:"projecao",         nome:"Projeção + contribuição",emoji:"🔮", paginaPadrao:"painel", ordemPadrao:3 },
  { id:"previstoRealizado",nome:"Previsto vs Realizado",  emoji:"⚖️", paginaPadrao:"painel", ordemPadrao:4 },
];

// ════════════════════════════════════════════════════════════════════════════
// MODO DE EDIÇÃO VISUAL — envolve elementos e mostra o ✏️ lapisinho ao editar
// ════════════════════════════════════════════════════════════════════════════
function Editavel({ id, modoEdicao, onEditar, children, inline=false, T }) {
  if (!modoEdicao || !ELEMENTOS_ESTILO[id]) return children;
  const def = ELEMENTOS_ESTILO[id];
  return (
    <span style={{ position:"relative", display: inline ? "inline-block" : "block" }}>
      {/* contorno tracejado indicando que é editável */}
      <span style={{ position:"absolute", inset:-3, border:`1.5px dashed ${T.accent}88`, borderRadius:8, pointerEvents:"none", zIndex:1 }}/>
      {children}
      <button
        onClick={(e)=>{ e.stopPropagation(); e.preventDefault(); onEditar(id); }}
        title={`Editar: ${def.nome}`}
        style={{
          position:"absolute", top:-9, right:-9, zIndex:3,
          width:22, height:22, borderRadius:"50%", border:"none",
          background:T.accent, color:"#fff", cursor:"pointer",
          fontSize:11, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow:`0 2px 8px ${T.accent}88`, padding:0,
        }}
      >✏️</button>
    </span>
  );
}

// Popup com TODAS as customizações possíveis do elemento escolhido
function PopupCustomizar({ id, estilosCustom, setEstilosCustom, onClose, T }) {
  const def = ELEMENTOS_ESTILO[id] || {};
  const atual = (estilosCustom||{})[id] || {};
  const set = (patch) => setEstilosCustom(prev=>({ ...(prev||{}), [id]: { ...((prev||{})[id]||{}), ...patch } }));
  const resetar = () => setEstilosCustom(prev=>{ const c={ ...(prev||{}) }; delete c[id]; return Object.keys(c).length?c:null; });

  const CORES = ["#e74c3c","#e67e22","#f1c40f","#2ecc71","#1abc9c","#3498db","#9b59b6","#e91e63","#607d8b","#111827","#ffffff"];
  const FUNDOS = [
    { lb:"Nenhum", v:null },
    { lb:"Roxo", v:"linear-gradient(135deg,#667eea,#764ba2)" },
    { lb:"Oceano", v:"linear-gradient(135deg,#2193b0,#6dd5ed)" },
    { lb:"Pôr do sol", v:"linear-gradient(135deg,#ff6a00,#ee0979)" },
    { lb:"Verde", v:"linear-gradient(135deg,#11998e,#38ef7d)" },
    { lb:"Ouro", v:"linear-gradient(135deg,#f7971e,#ffd200)" },
    { lb:"Escuro", v:"#1a1a2e" },
  ];
  const FONTES = [
    { lb:"Padrão", v:null },
    { lb:"Serifada", v:"Georgia, serif" },
    { lb:"Mono", v:"monospace" },
    { lb:"Sistema", v:"system-ui, sans-serif" },
  ];
  const rot = (t) => <div style={{ fontSize:10, color:T.textMute, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, margin:"14px 0 7px" }}>{t}</div>;
  const chip = (ativo, onClick, children, extra={}) => (
    <button onClick={onClick} style={{ padding:"7px 11px", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700,
      border:`1px solid ${ativo?T.accent:T.border}`, background: ativo?`${T.accent}18`:T.cardAlt, color: ativo?T.accentSoft:T.textMute, ...extra }}>{children}</button>
  );
  const slider = (label, prop, min, max, step, padrao) => (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.textMute, marginBottom:4 }}>
        <span>{label}</span><span style={{ fontWeight:700, color:T.text }}>{atual[prop] ?? padrao}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={atual[prop] ?? padrao}
        onChange={e=>set({ [prop]: parseFloat(e.target.value) })}
        style={{ width:"100%", accentColor:T.accent }}/>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"#000b", zIndex:1600, display:"flex", alignItems:"flex-end", justifyContent:"center", padding:0 }}>
      <motion.div
        onClick={e=>e.stopPropagation()}
        initial={{ y:"100%" }} animate={{ y:0 }} exit={{ y:"100%" }}
        transition={{ type:"spring", stiffness:340, damping:32 }}
        style={{ background:T.bg, borderRadius:"20px 20px 0 0", width:"100%", maxWidth:460, maxHeight:"85vh", overflowY:"auto", padding:"18px 18px 26px", boxShadow:"0 -10px 40px #000a" }}
      >
        <div style={{ width:38, height:4, borderRadius:2, background:T.border, margin:"0 auto 14px" }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:T.text }}>🎨 {def.nome}</div>
            <div style={{ fontSize:9, color:T.textFaint }}>{def.grupo}</div>
          </div>
          <button onClick={onClose} style={{ width:32, height:32, borderRadius:8, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontSize:15 }}>✕</button>
        </div>

        {rot("Tamanho e peso")}
        {slider("Escala da fonte", "escala", 0.5, 3, 0.05, 1)}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {chip(atual.negrito, ()=>set({ negrito:!atual.negrito }), "B", { fontWeight:900 })}
          {chip(atual.italico, ()=>set({ italico:!atual.italico }), "I", { fontStyle:"italic" })}
          {chip(atual.sublinhado, ()=>set({ sublinhado:!atual.sublinhado }), "U", { textDecoration:"underline" })}
          {chip(atual.maiuscula, ()=>set({ maiuscula:!atual.maiuscula }), "MAIÚSC")}
        </div>

        {rot("Cor do texto")}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {chip(!atual.cor, ()=>set({ cor:null }), "Padrão")}
          {CORES.map(c=>(
            <button key={c} onClick={()=>set({ cor:c })} style={{ width:30, height:30, borderRadius:"50%", cursor:"pointer",
              border: atual.cor===c ? `3px solid ${T.accent}` : `1px solid ${T.border}`, background:c }}/>
          ))}
        </div>

        {rot("Alinhamento")}
        <div style={{ display:"flex", gap:6 }}>
          {[["left","⬅️ Esq"],["center","↔️ Centro"],["right","➡️ Dir"]].map(([v,lb])=>chip(atual.alinhamento===v, ()=>set({ alinhamento: atual.alinhamento===v?null:v }), lb))}
        </div>

        {rot("Fonte")}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {FONTES.map(f=>chip(atual.fonte===f.v, ()=>set({ fonte:f.v }), f.lb, f.v?{ fontFamily:f.v }:{}))}
        </div>

        {rot("Fundo")}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {FUNDOS.map(f=>(
            <button key={f.lb} onClick={()=>set({ fundo:f.v })} style={{ padding:"9px 12px", borderRadius:8, cursor:"pointer", fontSize:10, fontWeight:700,
              border: atual.fundo===f.v ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
              background: f.v || T.cardAlt, color: f.v ? "#fff" : T.textMute }}>{f.lb}</button>
          ))}
        </div>

        {rot("Caixa")}
        {slider("Cantos arredondados", "raio", 0, 40, 1, 0)}
        {slider("Espaço interno", "padding", 0, 40, 1, 0)}
        {slider("Opacidade", "opacidade", 0.1, 1, 0.05, 1)}
        {slider("Rotação (graus)", "rotacao", -30, 30, 1, 0)}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:6 }}>
          {chip(!!atual.borda, ()=>set({ borda: atual.borda ? null : `2px solid ${T.accent}` }), "Borda")}
          {chip(!!atual.sombra, ()=>set({ sombra: atual.sombra ? null : "0 8px 24px #0005" }), "Sombra")}
          {chip(!!atual.oculto, ()=>set({ oculto:!atual.oculto }), atual.oculto ? "🚫 Oculto" : "👁 Visível")}
        </div>

        {rot("Animação")}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {ANIMACOES_IA.map(a=>chip((atual.animacao||"nenhuma")===a, ()=>set({ animacao:a }), a))}
        </div>

        <div style={{ display:"flex", gap:8, marginTop:20 }}>
          <button onClick={resetar} style={{ flex:1, padding:"13px", borderRadius:10, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:12, fontWeight:700 }}>♻️ Restaurar padrão</button>
          <button onClick={onClose} style={{ flex:1, padding:"13px", borderRadius:10, border:"none", background:T.accent, color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700 }}>✓ Pronto</button>
        </div>
      </motion.div>
    </div>
  );
}

function PainelCarteira({ ativos, historico = [], proventosRecebidos, blocosRender, estiloDe = () => ({ style:{}, cls:"" }), modoEdicao=false, onEditar=()=>{}, T }) {
  const [agrupar, setAgrupar] = useState("cat");   // "cat" | "setor"
  const [metrica, setMetrica] = useState("atual"); // "atual" | "investido"
  const [filtroCat, setFiltroCat] = useState("TUDO"); // "TUDO" | "FII" | "Ação" | "Cripto"

  // cores por categoria
  const corCat = { "FII":T.cyan, "Ação":T.accent, "Cripto":T.amber };

  // aplica filtro de categoria
  const lista = filtroCat==="TUDO" ? ativos : ativos.filter(a=>a.cat===filtroCat);

  // agrupa e soma
  const grupos = {};
  lista.forEach(a => {
    const chave = agrupar==="cat" ? a.cat : a.setor;
    const atual = a.qtd * a.cotacao;
    const investido = a.qtd * a.precoMedio;
    if (!grupos[chave]) grupos[chave] = { nome:chave, atual:0, investido:0, qtdAtivos:0 };
    grupos[chave].atual += atual;
    grupos[chave].investido += investido;
    grupos[chave].qtdAtivos += 1;
  });
  const arr = Object.values(grupos)
    .map(g => ({ ...g, valor: metrica==="atual"?g.atual:g.investido, resultado:g.atual-g.investido }))
    .sort((a,b)=>b.valor-a.valor);

  const totalAtual = lista.reduce((s,a)=>s+a.qtd*a.cotacao,0);
  const totalInvest = lista.reduce((s,a)=>s+a.qtd*a.precoMedio,0);
  const totalMetrica = metrica==="atual"?totalAtual:totalInvest;
  const resultadoGeral = totalAtual-totalInvest;
  const mediaMesPainel = lista.reduce((s,a)=>s+a.prov*a.qtd*a.meses.length,0)/12; // proventos médios por mês

  const corGrupo = (nome) => agrupar==="cat" ? (corCat[nome]||T.accent) : (COR_SETOR[nome]||T.textMute);

  const pieData = arr.map(g => ({ name:g.nome, value:+g.valor.toFixed(2), cor:corGrupo(g.nome) }));
  const maxBar = Math.max(...arr.map(g=>g.valor), 1);

  const FILTROS_CAT = [
    { id:"TUDO", label:"Tudo" },
    { id:"FII",  label:"FIIs" },
    { id:"Ação", label:"Ações" },
    { id:"Cripto",label:"Cripto" },
  ];

  const [vista, setVista] = useState("proventos"); // proventos | resumo | composicao | historico
  const MINI = [
    { id:"proventos",  label:"Proventos",  emoji:"💰", destaque:true },
    { id:"resumo",     label:"Resumo",     emoji:"👁️" },
    { id:"composicao", label:"Composição", emoji:"🥧" },
    { id:"historico",  label:"Histórico",  emoji:"🕒" },
  ];

  return (
    <div>
      {/* SAUDAÇÃO + DATA + DESTAQUE DO DIA */}
      {(() => {
        const hoje = new Date();
        const h = hoje.getHours();
        const saud = h<12 ? "Bom dia" : h<18 ? "Boa tarde" : "Boa noite";
        const NOMES_MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
        const dataFmt = `${hoje.getDate()} de ${NOMES_MES[hoje.getMonth()]}`;
        const mAtual = hoje.getMonth()+1;

        // candidatos a destaque do dia
        const candidatos = [];
        const pagadores = ativos.filter(a=>a.qtd>0 && a.prov>0 && a.meses.includes(mAtual)).map(a=>({t:a.ticker, v:a.prov*a.qtd})).sort((x,y)=>y.v-x.v);
        if (pagadores[0]) candidatos.push({ icon:"💰", txt:`Seu maior pagador este mês é o ${pagadores[0].t} (${fmt(pagadores[0].v)})` });
        let magicProx=null;
        ativos.forEach(a=>{
          const pm=a.prov*(a.meses.length/12);
          if(pm>0 && a.cotacao>0){ const magic=Math.ceil(a.cotacao/pm); const faltam=magic-a.qtd;
            if(faltam>0 && (!magicProx||faltam<magicProx.faltam)) magicProx={t:a.ticker, faltam}; }
        });
        if (magicProx && magicProx.faltam<=15) candidatos.push({ icon:"✨", txt:`Você está a ${magicProx.faltam} cota${magicProx.faltam>1?"s":""} do Magic Number do ${magicProx.t}!` });
        const patri = ativos.reduce((s,a)=>s+a.qtd*a.cotacao,0);
        const porA = ativos.map(a=>({t:a.ticker, v:a.qtd*a.cotacao})).sort((x,y)=>y.v-x.v);
        if (porA[0] && patri>0) { const cc=porA[0].v/patri*100;
          if (cc>30) candidatos.push({ icon:"⚖️", txt:`${porA[0].t} já é ${cc.toFixed(0)}% da carteira — talvez diversificar.` });
        }
        const totProx = ativos.filter(a=>a.qtd>0 && a.prov>0 && a.meses.includes(mAtual===12?1:mAtual+1)).reduce((s,a)=>s+a.prov*a.qtd,0);
        if (totProx>0) candidatos.push({ icon:"📅", txt:`No próximo mês você deve receber cerca de ${fmt(totProx)}.` });
        if (candidatos.length===0) candidatos.push({ icon:"🌱", txt:"Cadastre seus ativos para ver destaques personalizados." });
        // varia o destaque conforme o dia
        const destaque = candidatos[hoje.getDate() % candidatos.length];

        return (
          <div style={{ marginBottom:20, marginTop:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:14 }}>
              <Editavel id="saudacao" modoEdicao={modoEdicao} onEditar={onEditar} inline T={T}><span className={estiloDe("saudacao",24).cls} style={{ fontSize:24, fontWeight:800, color:T.text, letterSpacing:-0.5, ...estiloDe("saudacao",24).style }}>{saud}! 👋</span></Editavel>
              <Editavel id="dataHoje" modoEdicao={modoEdicao} onEditar={onEditar} inline T={T}><span className={estiloDe("dataHoje",12).cls} style={{ fontSize:12, color:T.textFaint, ...estiloDe("dataHoje",12).style }}>{dataFmt}</span></Editavel>
            </div>
            <Editavel id="destaqueDia" modoEdicao={modoEdicao} onEditar={onEditar} T={T}><div className={estiloDe("destaqueDia",11).cls} style={{ background:`linear-gradient(135deg, ${T.amber}1c, ${T.card})`, border:`1px solid ${T.amber}44`, borderRadius:12, padding:"11px 13px", display:"flex", alignItems:"center", gap:10, ...estiloDe("destaqueDia",11).style }}>
              <span style={{ fontSize:20 }}>{destaque.icon}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:8, color:T.amber, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Destaque do dia</div>
                <div style={{ fontSize:12, color:T.text, fontWeight:600, lineHeight:1.3 }}>{destaque.txt}</div>
              </div>
            </div></Editavel>
          </div>
        );
      })()}

      {/* mini-abas internas do Painel — carrossel deslizável, Proventos em destaque */}
      <div style={{ display:"flex", gap:7, overflowX:"auto", paddingBottom:6, marginBottom:18, scrollbarWidth:"none" }}>
        {MINI.map(m=>{
          const sel = vista===m.id;
          if (m.destaque) {
            // botão Proventos: maior, chapado, verde, sempre primeiro
            return (
              <button key={m.id} onClick={()=>setVista(m.id)} style={{
                flexShrink:0, padding:"11px 20px", borderRadius:12, border:"none", cursor:"pointer",
                fontSize:14, fontWeight:800, whiteSpace:"nowrap",
                background: sel ? T.green : `${T.green}1f`,
                color: sel ? "#06281b" : T.green,
                boxShadow: sel ? `0 4px 14px ${T.green}55` : "none",
              }}>{m.emoji} {m.label}</button>
            );
          }
          return (
            <button key={m.id} onClick={()=>setVista(m.id)} style={{
              flexShrink:0, padding:"11px 16px", borderRadius:12, border:`1px solid ${sel?T.accent:T.border}`, cursor:"pointer",
              fontSize:12, fontWeight:700, whiteSpace:"nowrap",
              background: sel?T.accentBg:T.card, color: sel?T.accentSoft:T.textMute
            }}>{m.emoji} {m.label}</button>
          );
        })}
      </div>

      {/* ═══ VISTA: PROVENTOS — blocos configuráveis (Camada 2) ═══ */}
      {vista==="proventos" && (<>
      {ativos.filter(a=>a.qtd>0).length===0 && (
        <div style={{ background:T.card, border:`2px dashed ${T.accentBorder}`, borderRadius:16, padding:"26px 18px", textAlign:"center", marginBottom:16 }}>
          <div style={{ fontSize:38, marginBottom:8 }}>🌱</div>
          <div style={{ fontSize:15, fontWeight:800, color:T.text, marginBottom:6 }}>Sua carteira está vazia</div>
          <div style={{ fontSize:11, color:T.textMute, lineHeight:1.6, marginBottom:14 }}>Adicione seu primeiro ativo (temos um catálogo com sugestões) ou importe a planilha da B3 na tela ✏️ Editar.</div>
          <button onClick={()=>abrirEditorAtivo(null)} style={{ padding:"12px 20px", borderRadius:10, border:"none", background:T.accent, color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>➕ Adicionar primeiro ativo</button>
        </div>
      )}
      {blocosRender
        ? blocosRender
        : (<>{/* fallback: ordem padrão da instalação (base intacta) */}
          <BlocoProx3Meses ativos={ativos} estiloDe={estiloDe} T={T}/>
          <BlocoGraficoMensal ativos={ativos} estiloDe={estiloDe} T={T}/>
          <ProjecaoProventos ativos={ativos} T={T}/>
          <PrevistoVsRealizado ativos={ativos} proventosRecebidos={proventosRecebidos} estiloDe={estiloDe} T={T}/>
        </>)}
      </>)}

      {/* ═══ VISTA: RESUMO (patrimônio total + médias) ═══ */}
      {vista==="resumo" && (<>
      {/* resumo geral */}
      <div style={{ background:`linear-gradient(135deg, ${T.accent}22, ${T.card})`, border:`1px solid ${T.border}`, borderRadius:14, padding:"18px", marginBottom:16 }}>
        <Editavel id="patrimonioLabel" modoEdicao={modoEdicao} onEditar={onEditar} T={T}><div className={estiloDe("patrimonioLabel",10).cls} style={{ fontSize:10, color:T.textFaint, textTransform:"uppercase", letterSpacing:1, ...estiloDe("patrimonioLabel",10).style }}>💼 Patrimônio total</div></Editavel>
        <div style={{ fontSize:30, fontWeight:800, color:T.text, letterSpacing:-1, lineHeight:1.1 }}>{fmt(totalAtual)}</div>
        <div style={{ fontSize:11, color:T.green, marginTop:3 }}>Proventos médios: <strong>{fmt(mediaMesPainel)}/mês</strong></div>
        <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap" }}>
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 11px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Investido</div>
            <div style={{ fontSize:12, fontWeight:700, color:T.textDim }}>{fmt(totalInvest)}</div>
          </div>
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 11px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Resultado</div>
            <div style={{ fontSize:12, fontWeight:700, color:resultadoGeral>=0?T.green:T.red }}>{resultadoGeral>=0?"+":""}{fmt(resultadoGeral)}</div>
          </div>
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 11px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Rentab.</div>
            <div style={{ fontSize:12, fontWeight:700, color:resultadoGeral>=0?T.green:T.red }}>{totalInvest>0?`${resultadoGeral>=0?"+":""}${((resultadoGeral/totalInvest)*100).toFixed(1)}%`:"—"}</div>
          </div>
        </div>
      </div>

      </>)}

      {/* ═══ VISTA: HISTÓRICO ═══ */}
      {vista==="historico" && (
        historico.length>0 ? (
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px 6px 12px", marginBottom:16 }}>
          <div style={{ paddingLeft:8, marginBottom:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1 }}>🕒 Histórico real</div>
            <span style={{ fontSize:9, color:T.textFaint }}>{historico.length} mês{historico.length>1?"es":""} registrado{historico.length>1?"s":""}</span>
          </div>
          {historico.length===1 ? (
            <div style={{ fontSize:10, color:T.textFaint, padding:"8px 12px", lineHeight:1.6 }}>
              📸 Primeiro retrato guardado! O app grava a evolução do seu patrimônio automaticamente a cada mês. Volte nos próximos meses para ver a linha crescer.
            </div>
          ) : (
            <div style={{ width:"100%", height:180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historico.map(h=>({ mes:h.mes.slice(5)+"/"+h.mes.slice(2,4), patrimonio:h.patrimonio }))} margin={{ top:8,right:12,left:0,bottom:0 }}>
                  <defs>
                    <linearGradient id="gradHist" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={T.accent} stopOpacity={0.4}/>
                      <stop offset="100%" stopColor={T.accent} stopOpacity={0.02}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false}/>
                  <XAxis dataKey="mes" tick={{ fontSize:8,fill:T.textMute }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fontSize:8,fill:T.textMute }} axisLine={false} tickLine={false} width={42}
                    tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:`${Math.round(v)}`}/>
                  <Tooltip formatter={(v)=>fmt(v)} contentStyle={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:8, fontSize:12 }}/>
                  <Area type="monotone" dataKey="patrimonio" name="Patrimônio" stroke={T.accent} strokeWidth={2.5} fill="url(#gradHist)" dot={{ r:3, fill:T.accent }}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <div style={{ fontSize:9, color:T.textFaint, padding:"4px 12px 0", lineHeight:1.5 }}>
            Diferente das projeções: aqui é o valor real registrado a cada mês conforme você usa o app e atualiza as cotações.
          </div>
        </div>
        ) : (
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"24px 16px", textAlign:"center" }}>
            <div style={{ fontSize:28, marginBottom:6 }}>🕒</div>
            <div style={{ fontSize:12, color:T.textMute, lineHeight:1.6 }}>O histórico começa a ser gravado automaticamente. Volte nos próximos meses para ver a evolução real do seu patrimônio.</div>
          </div>
        )
      )}

      {/* ═══ VISTA: COMPOSIÇÃO ═══ */}
      {vista==="composicao" && (<>
      {/* controles */}
      <div style={{ display:"flex", gap:6, marginBottom:8, flexWrap:"wrap" }}>
        {FILTROS_CAT.map(f=>(
          <button key={f.id} onClick={()=>setFiltroCat(f.id)} style={{
            padding:"6px 12px", borderRadius:8, border:"none", cursor:"pointer", fontSize:11, fontWeight:700,
            background:filtroCat===f.id?T.accent:T.border, color:filtroCat===f.id?"#fff":T.textMute
          }}>{f.label}</button>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:20 }}>
        <div style={{ flex:1, display:"flex", gap:4, background:T.card, borderRadius:8, padding:3 }}>
          {[{id:"cat",l:"Por categoria"},{id:"setor",l:"Por setor"}].map(o=>(
            <button key={o.id} onClick={()=>setAgrupar(o.id)} style={{ flex:1, padding:"6px 4px", borderRadius:6, border:"none", cursor:"pointer", fontSize:10, fontWeight:700, background:agrupar===o.id?T.accentBg:"transparent", color:agrupar===o.id?T.accentSoft:T.textMute }}>{o.l}</button>
          ))}
        </div>
        <div style={{ flex:1, display:"flex", gap:4, background:T.card, borderRadius:8, padding:3 }}>
          {[{id:"atual",l:"Valor atual"},{id:"investido",l:"Investido"}].map(o=>(
            <button key={o.id} onClick={()=>setMetrica(o.id)} style={{ flex:1, padding:"6px 4px", borderRadius:6, border:"none", cursor:"pointer", fontSize:10, fontWeight:700, background:metrica===o.id?T.accentBg:"transparent", color:metrica===o.id?T.accentSoft:T.textMute }}>{o.l}</button>
          ))}
        </div>
      </div>

      {/* PIZZA — composição */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:16 }}>
        <div style={{ fontSize:11, color:T.textMute, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>
          Composição {agrupar==="cat"?"por categoria":"por setor"}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <div style={{ width:160, height:160, flexShrink:0, margin:"0 auto" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={72} paddingAngle={2} stroke="none">
                  {pieData.map((e,i)=><Cell key={i} fill={e.cor}/>)}
                </Pie>
                <Tooltip formatter={(v)=>fmt(v)} contentStyle={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:8, fontSize:12 }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex:1, minWidth:140 }}>
            {arr.map(g=>{
              const pct = totalMetrica>0 ? (g.valor/totalMetrica)*100 : 0;
              return (
                <div key={g.nome} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <div style={{ width:10, height:10, borderRadius:3, background:corGrupo(g.nome), flexShrink:0 }}/>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontSize:11, color:T.textDim, fontWeight:600 }}>{g.nome}</span>
                      <span style={{ fontSize:11, color:T.text, fontWeight:700 }}>{pct.toFixed(1)}%</span>
                    </div>
                    <div style={{ fontSize:9, color:T.textFaint }}>{fmt(g.valor)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* BARRAS — dinheiro por grupo */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:16 }}>
        <div style={{ fontSize:11, color:T.textMute, marginBottom:16, textTransform:"uppercase", letterSpacing:1 }}>
          {metrica==="atual"?"Valor atual":"Investido"} por {agrupar==="cat"?"categoria":"setor"}
        </div>
        {arr.map(g=>{
          const pct = (g.valor/maxBar)*100;
          return (
            <div key={g.nome} style={{ marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                <span style={{ fontSize:11, color:T.textDim, fontWeight:600 }}>{g.nome} <span style={{ fontSize:9, color:T.textFaint }}>· {g.qtdAtivos} ativo{g.qtdAtivos>1?"s":""}</span></span>
                <div style={{ textAlign:"right" }}>
                  <span style={{ fontSize:11, color:T.text, fontWeight:700 }}>{fmt(g.valor)}</span>
                  <span style={{ fontSize:9, color:g.resultado>=0?T.green:T.red, marginLeft:6 }}>{g.resultado>=0?"+":""}{fmtK(g.resultado)}</span>
                </div>
              </div>
              <div style={{ height:8, background:T.cardAlt, borderRadius:5, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${pct}%`, background:corGrupo(g.nome), borderRadius:5, transition:"width 0.4s" }}/>
              </div>
            </div>
          );
        })}
        {arr.length===0 && <div style={{ fontSize:11, color:T.textFaint, textAlign:"center", padding:"16px 0" }}>Nenhum ativo neste filtro</div>}
      </div>
      </>)}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ANÁLISE DA CARTEIRA — yield, saúde, benchmarks (usada na aba Análises)
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// PROJEÇÃO DE PROVENTOS — estimativa do próximo mês (card verde), dados ao vivo
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// TELA "MINHA CARTEIRA" — página de distribuição por classe (estilo dedicado)
// Acessível pelo ícone 💼 no cabeçalho. Usa os dados reais dos ativos.
// ════════════════════════════════════════════════════════════════════════════
function classeDe(a) {
  if (a.cat === "FII") return "Imobiliário";
  if (a.cat === "Cripto" || /^(COIN11|HASH11|QBTC|BITH11|QETH)/.test(a.ticker)) return "Criptoativos";
  if (/tesouro/i.test(a.nome) || /^(LFT|LTN|NTN|TD)/.test(a.ticker)) {
    return /prefix|ltn|ntn-f/i.test(a.nome+a.ticker) ? "Renda Fixa Prefixada" : "Renda Fixa Inflação";
  }
  if (/^(IVVB11|NASD11|XINA11|PAGS34|ROXO34|AAPL34|MSFT34|GOGL34|AMZO34)/.test(a.ticker) || /s&p|nasdaq|internacional|\(bdr\)/i.test(a.nome)) return "Internacional";
  if (/^(GOLD11|OZ1|AURA|GOLD)/.test(a.ticker) || /ouro|gold/i.test(a.nome)) return "Ouro";
  return "Ações";
}
const CLASSE_COR = {
  "Ações":"#6366f1", "Imobiliário":"#22d3ee", "Criptoativos":"#f59e0b",
  "Renda Fixa Inflação":"#34d399", "Renda Fixa Prefixada":"#a78bfa",
  "Internacional":"#60a5fa", "Ouro":"#fbbf24",
};
const ORDEM_CLASSE = ["Ações","Imobiliário","Criptoativos","Renda Fixa Inflação","Renda Fixa Prefixada","Internacional","Ouro"];

function TelaCarteira({ ativos, onClose, onEditar, T }) {
  const [tab, setTab] = useState("resumo");
  const [sortA, setSortA] = useState("valor");
  const [sortF, setSortF] = useState("valor");

  const C = {
    bg: T.bg, header: T.bgHeader, card: T.card, borda: T.border,
    txt: T.text, txtDim: T.textDim, txtFaint: T.textFaint,
    roxo: T.accent, verde: T.green, vermelho: T.red,
  };
  const pctFmt = v => v!=null ? `${v>0?"+":""}${v.toFixed(2)}%` : "—";

  // calcula por ativo
  const comCalc = ativos.filter(a=>a.qtd>0).map(a=>({
    ...a, classe:classeDe(a),
    valor:+(a.qtd*a.cotacao).toFixed(2),
    custo:+(a.qtd*a.precoMedio).toFixed(2),
    variacao:+((a.qtd*a.cotacao)-(a.qtd*a.precoMedio)).toFixed(2),
    varPct:a.precoMedio>0 ? ((a.cotacao-a.precoMedio)/a.precoMedio*100) : 0,
  }));
  const total = comCalc.reduce((s,a)=>s+a.valor,0);

  // agrupa por classe
  const porClasse = ORDEM_CLASSE.map(cl=>{
    const itens = comCalc.filter(a=>a.classe===cl);
    const v = itens.reduce((s,a)=>s+a.valor,0);
    const variacao = itens.reduce((s,a)=>s+a.variacao,0);
    return { classe:cl, valor:v, variacao, percentual: total>0?v/total*100:0, n:itens.length };
  }).filter(c=>c.valor>0);

  const acoes = comCalc.filter(a=>a.classe==="Ações" || a.classe==="Internacional" || a.classe==="Ouro");
  const fiis = comCalc.filter(a=>a.classe==="Imobiliário");
  const totAcoes = acoes.reduce((s,a)=>s+a.valor,0);
  const totFiis = fiis.reduce((s,a)=>s+a.valor,0);
  const provMes = ativos.reduce((s,a)=>{
    const m=new Date().getMonth()+1;
    return s + (a.meses?.includes(m) ? a.prov*a.qtd : 0);
  },0);

  const ordenar = (arr,k) => [...arr].sort((x,y)=> k==="valor"?y.valor-x.valor : k==="var"?(x.varPct-y.varPct) : x.ticker.localeCompare(y.ticker));

  const Linha = ({ a }) => (
    <div onClick={()=>abrirEditorAtivo(a.ticker)} style={{ display:"grid", gridTemplateColumns:"1fr 44px 70px 70px 58px", gap:6, background:C.card, border:`1px solid ${C.borda}`, borderRadius:10, padding:"11px 12px", marginBottom:6, alignItems:"center", cursor:"pointer" }}>
      <div>
        <div style={{ fontWeight:700, fontSize:13, color:C.txt }}>{a.ticker}</div>
        <div style={{ fontSize:10, color:C.txtFaint, marginTop:1 }}>{a.nome}</div>
        <div style={{ fontSize:11, color:C.roxo, marginTop:1, fontWeight:600 }}>{fmt(a.valor)}</div>
      </div>
      <div style={{ fontSize:12, color:C.txtDim, textAlign:"center" }}>{a.qtd}</div>
      <div style={{ fontSize:11, color:C.txtDim, textAlign:"right" }}>R${a.precoMedio.toFixed(2)}</div>
      <div style={{ fontSize:11, color:C.txt, textAlign:"right" }}>R${a.cotacao.toFixed(2)}</div>
      <div style={{ fontSize:12, fontWeight:700, color:a.varPct>=0?C.verde:C.vermelho, textAlign:"right" }}>{pctFmt(a.varPct)}</div>
    </div>
  );
  const Cab = () => (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 44px 70px 70px 58px", gap:6, padding:"6px 12px", marginBottom:4 }}>
      {["Ativo","Qtd","P.Médio","Cotação","Var%"].map(h=><div key={h} style={{ fontSize:10, color:C.txtFaint, fontWeight:600, textTransform:"uppercase" }}>{h}</div>)}
    </div>
  );
  const Ordenacao = ({ val, set }) => (
    <div style={{ display:"flex", gap:6, marginBottom:14, alignItems:"center", flexWrap:"wrap" }}>
      <span style={{ fontSize:11, color:C.txtFaint, marginRight:4 }}>Ordenar:</span>
      {[["valor","Valor"],["var","Variação"],["ticker","Ticker"]].map(([k,l])=>(
        <button key={k} onClick={()=>set(k)} style={{ padding:"5px 12px", borderRadius:6, border:"none", cursor:"pointer", fontSize:11, fontWeight:600, background:val===k?C.roxo:C.borda, color:val===k?"#fff":C.txtDim }}>{l}</button>
      ))}
    </div>
  );

  const MES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][new Date().getMonth()];

  return (
    <div className="modal-fullscreen" style={{ position:"fixed", inset:0, background:C.bg, zIndex:1300, overflowY:"auto", color:C.txt, fontFamily:"'Inter',system-ui,sans-serif", paddingBottom:48 }}>
      {/* Header */}
      <div style={{ background:C.header, padding:"22px 18px 18px", borderBottom:`1px solid ${C.borda}`, position:"relative" }}>
        <div style={{ position:"absolute", top:16, right:16, display:"flex", gap:8 }}>
          <button onClick={()=>{ onClose(); onEditar && onEditar(); }} title="Editar ativos" style={{ width:34, height:34, borderRadius:8, border:`1px solid ${C.borda}`, background:C.card, color:C.txt, cursor:"pointer", fontSize:15 }}>✏️</button>
          <button onClick={onClose} style={{ width:34, height:34, borderRadius:8, border:`1px solid ${C.borda}`, background:C.card, color:C.txt, cursor:"pointer", fontSize:16 }}>✕</button>
        </div>
        <div style={{ fontSize:11, color:C.txtFaint, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>Minha Carteira · {MES} {new Date().getFullYear()}</div>
        <div style={{ fontSize:30, fontWeight:700, color:C.txt, letterSpacing:-1 }}>{fmt(total)}</div>
        <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap" }}>
          {[{l:"Ações",v:fmt(totAcoes),c:C.roxo},{l:"FIIs",v:fmt(totFiis),c:T.cyan},{l:"Proventos/mês",v:fmt(provMes),c:C.verde}].map(x=>(
            <div key={x.l} style={{ background:T.cardAlt, borderRadius:8, padding:"6px 12px" }}>
              <div style={{ fontSize:10, color:C.txtFaint }}>{x.l}</div>
              <div style={{ fontSize:13, fontWeight:700, color:x.c }}>{x.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:2, padding:"10px 12px 0", background:C.bg, borderBottom:`1px solid ${C.borda}`, overflowX:"auto" }}>
        {[{id:"resumo",l:"Resumo"},{id:"acoes",l:"Ações"},{id:"fiis",l:"FIIs"},{id:"outros",l:"Outros"},{id:"proventos",l:"💰 Proventos"}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"8px 12px", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap", background:tab===t.id?(t.id==="proventos"?T.green:C.roxo):"transparent", color:tab===t.id?"#fff":C.txtFaint }}>{t.l}</button>
        ))}
      </div>

      <div style={{ padding:"14px" }}>
        {/* RESUMO */}
        {tab==="resumo" && (
          <>
            <div style={{ background:C.card, border:`1px solid ${C.borda}`, borderRadius:12, padding:"14px", marginBottom:12 }}>
              <div style={{ fontSize:11, color:C.txtFaint, marginBottom:10, textTransform:"uppercase", letterSpacing:1 }}>Distribuição</div>
              <div style={{ display:"flex", height:10, borderRadius:8, overflow:"hidden", gap:2, marginBottom:12 }}>
                {porClasse.map(c=><div key={c.classe} style={{ flex:c.percentual, background:CLASSE_COR[c.classe], borderRadius:4 }}/>)}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"6px 14px" }}>
                {porClasse.map(c=>(
                  <div key={c.classe} style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:CLASSE_COR[c.classe] }}/>
                    <span style={{ fontSize:11, color:C.txtDim }}>{c.classe} <span style={{ color:C.txt, fontWeight:600 }}>{c.percentual.toFixed(1)}%</span></span>
                  </div>
                ))}
              </div>
            </div>
            {porClasse.map(c=>{
              const pos = c.variacao>=0;
              return (
                <div key={c.classe} style={{ background:C.card, border:`1px solid ${C.borda}`, borderRadius:12, padding:"13px 14px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:8, height:36, borderRadius:4, background:CLASSE_COR[c.classe] }}/>
                    <div>
                      <div style={{ fontWeight:600, fontSize:14, color:C.txt }}>{c.classe}</div>
                      <div style={{ fontSize:12, color:C.txtFaint, marginTop:2 }}>{c.percentual.toFixed(1)}% · {c.n} ativo{c.n!==1?"s":""}</div>
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:700, fontSize:15, color:C.txt }}>{fmt(c.valor)}</div>
                    <div style={{ fontSize:12, color:pos?C.verde:C.vermelho, marginTop:2 }}>{pos?"▲":"▼"} {fmt(Math.abs(c.variacao))}</div>
                  </div>
                </div>
              );
            })}
            <div style={{ background:`linear-gradient(135deg,${T.accent},${T.accentSoft})`, borderRadius:12, padding:"14px", marginTop:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:13, color:"#fff", fontWeight:600 }}>TOTAL GERAL</div>
              <div style={{ fontSize:20, fontWeight:800, color:"#fff" }}>{fmt(total)}</div>
            </div>
          </>
        )}
        {/* AÇÕES */}
        {tab==="acoes" && (
          <>
            <Ordenacao val={sortA} set={setSortA}/>
            <div style={{ background:C.card, border:`1px solid ${C.borda}`, borderRadius:10, padding:"11px 14px", marginBottom:12, display:"flex", justifyContent:"space-between" }}>
              <span style={{ color:C.txtFaint, fontSize:12 }}>Total · {acoes.length} ativos</span>
              <span style={{ color:C.roxo, fontWeight:700, fontSize:14 }}>{fmt(totAcoes)}</span>
            </div>
            <Cab/>
            {ordenar(acoes,sortA).map(a=><Linha key={a.ticker} a={a}/>)}
          </>
        )}
        {/* FIIs */}
        {tab==="fiis" && (
          <>
            <Ordenacao val={sortF} set={setSortF}/>
            <div style={{ background:C.card, border:`1px solid ${C.borda}`, borderRadius:10, padding:"11px 14px", marginBottom:12, display:"flex", justifyContent:"space-between" }}>
              <span style={{ color:C.txtFaint, fontSize:12 }}>Total · {fiis.length} fundos</span>
              <span style={{ color:T.cyan, fontWeight:700, fontSize:14 }}>{fmt(totFiis)}</span>
            </div>
            <Cab/>
            {ordenar(fiis,sortF).map(a=><Linha key={a.ticker} a={a}/>)}
          </>
        )}
        {/* OUTROS */}
        {tab==="outros" && (
          <>
            {["Criptoativos","Renda Fixa Inflação","Renda Fixa Prefixada","Internacional","Ouro"].map(cl=>{
              const itens = comCalc.filter(a=>a.classe===cl);
              if (itens.length===0) return null;
              const tot = itens.reduce((s,a)=>s+a.valor,0);
              return (
                <div key={cl} style={{ marginBottom:20 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:CLASSE_COR[cl] }}/>
                    <span style={{ fontSize:11, color:C.txtDim, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>{cl}</span>
                    <span style={{ fontSize:13, color:CLASSE_COR[cl], fontWeight:700, marginLeft:"auto" }}>{fmt(tot)}</span>
                  </div>
                  {itens.map(a=>(
                    <div key={a.ticker} style={{ background:C.card, border:`1px solid ${C.borda}`, borderRadius:10, padding:"12px 14px", marginBottom:6 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                        <div>
                          <div style={{ fontWeight:700, fontSize:13, color:C.txt }}>{a.ticker}</div>
                          <div style={{ fontSize:11, color:C.txtFaint, marginTop:2 }}>{a.nome}</div>
                          <div style={{ fontSize:11, color:C.txtDim, marginTop:3 }}>Qtd: {a.qtd} · PM: R${a.precoMedio.toFixed(2)} · Cot: R${a.cotacao.toFixed(2)}</div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontWeight:700, color:C.txt, fontSize:14 }}>{fmt(a.valor)}</div>
                          <div style={{ fontSize:12, color:a.varPct>=0?C.verde:C.vermelho, marginTop:2 }}>{pctFmt(a.varPct)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
            {comCalc.filter(a=>["Criptoativos","Renda Fixa Inflação","Renda Fixa Prefixada","Internacional","Ouro"].includes(a.classe)).length===0 && (
              <div style={{ textAlign:"center", padding:"30px 0", color:C.txtFaint, fontSize:12 }}>Nenhum ativo de outras classes.</div>
            )}
          </>
        )}
        {/* PROVENTOS */}
        {tab==="proventos" && <div style={{ marginTop:4 }}><ProjecaoProventos ativos={ativos} T={T}/></div>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TELA DEDICADA — RESERVA PLUS (Tesouro Direto + CDB/LCI + ETFs globais)
// ════════════════════════════════════════════════════════════════════════════
function TelaReservaPlus({ ativos, onClose, T }) {
  const ehGlobal = (a) => ETFS_GLOBAIS.includes(a.ticker);
  const ehTesouro = (a) => a.cat==="Tesouro" || /tesouro/i.test(String(a.nome));
  const ehRendaFixa = (a) => ehReservaAtivo(a) && !ehTesouro(a) && !ehGlobal(a);
  const ehReserva = ehReservaAtivo;

  const itens = ativos.filter(a=>a.qtd>0 && ehReserva(a)).map(a=>({
    ...a, valor:+(a.qtd*a.cotacao).toFixed(2), custo:+(a.qtd*a.precoMedio).toFixed(2),
    classe: ehTesouro(a)?"Tesouro Direto":ehGlobal(a)?"Internacional (ETF)":"Renda Fixa",
  }));
  const total = itens.reduce((s,a)=>s+a.valor,0);
  const custoTotal = itens.reduce((s,a)=>s+a.custo,0);
  const ganho = total - custoTotal;
  const ganhoPct = custoTotal>0 ? ganho/custoTotal*100 : 0;
  const patrimonio = ativos.filter(a=>a.qtd>0).reduce((s,a)=>s+a.qtd*a.cotacao,0);
  const pctPatrimonio = patrimonio>0 ? total/patrimonio*100 : 0;
  const alvo = Math.max(patrimonio*0.25, 1000);
  const pctAlvo = Math.min(total/alvo*100, 100);

  const CLASSES = ["Tesouro Direto","Internacional (ETF)","Renda Fixa"];
  const CORES = { "Tesouro Direto":T.green, "Internacional (ETF)":T.cyan, "Renda Fixa":T.amber };
  const ICONES = { "Tesouro Direto":"🏛️", "Internacional (ETF)":"🌎", "Renda Fixa":"🔒" };
  const porClasse = CLASSES.map(cl=>{
    const its = itens.filter(a=>a.classe===cl);
    return { classe:cl, valor:its.reduce((s,a)=>s+a.valor,0), n:its.length };
  }).filter(c=>c.valor>0);

  return (
    <div className="modal-fullscreen" style={{ position:"fixed", inset:0, background:T.bg, zIndex:1300, overflowY:"auto", color:T.text, paddingBottom:48 }}>
      {/* header */}
      <div style={{ background:T.bgHeader, padding:"22px 18px 18px", borderBottom:`1px solid ${T.border}`, position:"relative" }}>
        <button onClick={onClose} style={{ position:"absolute", top:16, right:16, width:34, height:34, borderRadius:8, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontSize:16 }}>✕</button>
        <div style={{ fontSize:11, color:T.textMute, letterSpacing:2, textTransform:"uppercase", marginBottom:4 }}>🌍 Reserva Plus</div>
        <div style={{ fontSize:30, fontWeight:800, color:T.text, letterSpacing:-1 }}>{fmt(total)}</div>
        <div style={{ fontSize:12, color:T.textFaint, marginTop:4 }}>{pctPatrimonio.toFixed(1)}% do seu patrimônio · exposição internacional + renda fixa</div>
        {/* progresso do alvo */}
        <div style={{ marginTop:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.textMute, marginBottom:4 }}>
            <span>Alvo de reserva (25% do patrimônio)</span><span style={{ fontWeight:700 }}>{pctAlvo.toFixed(0)}%</span>
          </div>
          <div style={{ height:8, background:T.cardAlt, borderRadius:5, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${pctAlvo}%`, background:T.green, borderRadius:5, transition:"width 0.5s" }}/>
          </div>
        </div>
      </div>

      <div style={{ padding:"16px" }}>
        {itens.length===0 ? (
          <div style={{ textAlign:"center", padding:"40px 20px", color:T.textMute }}>
            <div style={{ fontSize:40, marginBottom:10 }}>🌍</div>
            <div style={{ fontSize:13, marginBottom:6 }}>Você ainda não tem títulos de reserva.</div>
            <div style={{ fontSize:11, color:T.textFaint }}>A Reserva Plus reúne Tesouro Direto, CDB/LCI/LCA e ETFs globais (BOVA11 não conta — é Brasil). Esses ativos dão segurança e exposição internacional à carteira.</div>
          </div>
        ) : (<>
          {/* resumo: ganho/rentabilidade */}
          <div style={{ display:"flex", gap:10, marginBottom:16 }}>
            <div style={{ flex:1, background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"12px 14px" }}>
              <div style={{ fontSize:10, color:T.textFaint, marginBottom:3 }}>Investido</div>
              <div style={{ fontSize:16, fontWeight:800, color:T.text }}>{fmt(custoTotal)}</div>
            </div>
            <div style={{ flex:1, background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"12px 14px" }}>
              <div style={{ fontSize:10, color:T.textFaint, marginBottom:3 }}>Rendimento</div>
              <div style={{ fontSize:16, fontWeight:800, color: ganho>=0?T.green:T.red }}>{ganho>=0?"+":""}{fmt(ganho)}</div>
              <div style={{ fontSize:10, color: ganho>=0?T.green:T.red }}>{ganho>=0?"▲":"▼"} {Math.abs(ganhoPct).toFixed(2)}%</div>
            </div>
          </div>

          {/* composição por classe */}
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"14px", marginBottom:16 }}>
            <div style={{ fontSize:11, color:T.textFaint, marginBottom:10, textTransform:"uppercase", letterSpacing:1 }}>Composição</div>
            <div style={{ display:"flex", height:10, borderRadius:6, overflow:"hidden", gap:2, marginBottom:12 }}>
              {porClasse.map(c=><div key={c.classe} style={{ flex:c.valor, background:CORES[c.classe] }}/>)}
            </div>
            {porClasse.map(c=>(
              <div key={c.classe} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
                <span style={{ fontSize:12, color:T.textDim }}>{ICONES[c.classe]} {c.classe} <span style={{ fontSize:10, color:T.textFaint }}>· {c.n}</span></span>
                <span style={{ fontSize:12, fontWeight:700, color:CORES[c.classe] }}>{fmt(c.valor)} <span style={{ fontSize:10, color:T.textFaint }}>({(c.valor/total*100).toFixed(0)}%)</span></span>
              </div>
            ))}
          </div>

          {/* lista de títulos */}
          <div style={{ fontSize:11, color:T.textFaint, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>Títulos ({itens.length})</div>
          {itens.sort((a,b)=>b.valor-a.valor).map(a=>{
            const g = a.valor-a.custo; const gp = a.custo>0?g/a.custo*100:0;
            return (
              <div key={a.ticker} onClick={()=>abrirEditorAtivo(a.ticker)} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"12px 14px", marginBottom:8, cursor:"pointer" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:T.text }}>{ICONES[a.classe]} {a.nome}</div>
                    <div style={{ fontSize:10, color:T.textFaint, marginTop:2 }}>{a.classe} · {a.qtd<1?a.qtd.toFixed(2):a.qtd} cotas · PM {fmt(a.precoMedio)}</div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontSize:14, fontWeight:800, color:T.text }}>{fmt(a.valor)}</div>
                    <div style={{ fontSize:10, color: g>=0?T.green:T.red }}>{g>=0?"+":""}{fmt(g)} ({gp.toFixed(1)}%)</div>
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ fontSize:9, color:T.textFaint, marginTop:10, textAlign:"center", lineHeight:1.5 }}>
            💡 Toque num título para editar. A Reserva Plus ajuda a medir sua proteção (renda fixa) e exposição internacional (ETFs globais).
          </div>
        </>)}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PREVISTO vs REALIZADO — compara o provento previsto com o recebido de fato
// "Realizado" vem das linhas de Rendimento/Dividendo/JCP da planilha da B3.
// ════════════════════════════════════════════════════════════════════════════
function PrevistoVsRealizado({ ativos, proventosRecebidos, estiloDe = () => ({ style:{}, cls:"" }), T }) {
  const ano = new Date().getFullYear();
  const mesAtual = new Date().getMonth(); // 0-11
  const NOMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const previstoChart = buildChart(ativos, "TUDO");
  const realizadoPorMes = proventosRecebidos?.porMes || {};
  const temRealizado = Object.keys(realizadoPorMes).some(k=>k.startsWith(String(ano)));

  const dados = NOMES.map((nome,i)=>{
    const mesKey = `${ano}-${String(i+1).padStart(2,"0")}`;
    return { mes:nome, previsto:+(previstoChart[i]?._total||0).toFixed(2), realizado:+(realizadoPorMes[mesKey]||0).toFixed(2), passou:i<=mesAtual };
  });
  const totalPrevistoAno = dados.reduce((s,d)=>s+d.previsto,0);
  const totalRealizadoAno = Object.entries(realizadoPorMes).filter(([k])=>k.startsWith(String(ano))).reduce((s,[,v])=>s+v,0);
  const previstoAteAgora = dados.filter(d=>d.passou).reduce((s,d)=>s+d.previsto,0);
  const aderencia = previstoAteAgora>0 ? totalRealizadoAno/previstoAteAgora*100 : 0;

  if (!temRealizado) {
    return (
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"16px", marginBottom:18 }}>
        <div className={estiloDe("tituloPrevistoRealizado",13).cls} style={{ fontSize:13, fontWeight:800, color:T.text, marginBottom:6, ...estiloDe("tituloPrevistoRealizado",13).style }}>📊 Previsto vs Realizado</div>
        <div style={{ fontSize:11, color:T.textMute, lineHeight:1.5 }}>
          Para ver quanto você <strong>realmente recebeu</strong> de proventos vs o previsto, importe a planilha de Movimentação da B3 (ela tem as linhas de Rendimento/Dividendo/JCP). Vá em <strong>Importar em massa → Arquivo da B3</strong>.
        </div>
        <div style={{ marginTop:10, padding:"10px 12px", background:T.accentBg, borderRadius:10, fontSize:11, color:T.accentSoft }}>
          Previsto para {ano}: <strong>{fmt(totalPrevistoAno)}</strong> ({fmt(totalPrevistoAno/12)}/mês em média)
        </div>
      </div>
    );
  }

  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"16px", marginBottom:18 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:4 }}>
        <span className={estiloDe("tituloPrevistoRealizado",13).cls} style={{ fontSize:13, fontWeight:800, color:T.text, ...estiloDe("tituloPrevistoRealizado",13).style }}>📊 Previsto vs Realizado · {ano}</span>
      </div>
      <div style={{ fontSize:10, color:T.textFaint, marginBottom:12 }}>Realizado = proventos recebidos de fato (da planilha B3)</div>

      {/* resumo */}
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        <div style={{ flex:1, background:T.cardAlt, borderRadius:10, padding:"10px 11px" }}>
          <div style={{ fontSize:9, color:T.textFaint, marginBottom:2 }}>Recebido no ano</div>
          <div style={{ fontSize:15, fontWeight:800, color:T.green }}>{fmt(totalRealizadoAno)}</div>
        </div>
        <div style={{ flex:1, background:T.cardAlt, borderRadius:10, padding:"10px 11px" }}>
          <div style={{ fontSize:9, color:T.textFaint, marginBottom:2 }}>Previsto até agora</div>
          <div style={{ fontSize:15, fontWeight:800, color:T.accentSoft }}>{fmt(previstoAteAgora)}</div>
        </div>
        <div style={{ flex:1, background:T.cardAlt, borderRadius:10, padding:"10px 11px" }}>
          <div style={{ fontSize:9, color:T.textFaint, marginBottom:2 }}>Aderência</div>
          <div style={{ fontSize:15, fontWeight:800, color: aderencia>=95?T.green:aderencia>=80?T.amber:T.red }}>{aderencia.toFixed(0)}%</div>
        </div>
      </div>

      {/* gráfico agrupado */}
      <div style={{ height:180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top:4, right:4, left:0, bottom:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false}/>
            <XAxis dataKey="mes" tick={{ fontSize:9, fill:T.textFaint }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fontSize:9, fill:T.textFaint }} axisLine={false} tickLine={false} width={38} tickFormatter={v=>v>=1000?(v/1000).toFixed(0)+"k":v}/>
            <Tooltip
              contentStyle={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, fontSize:11 }}
              labelStyle={{ color:T.text }}
              formatter={(v,n)=>[fmt(v), n==="previsto"?"Previsto":"Realizado"]}
            />
            <Legend wrapperStyle={{ fontSize:10 }} formatter={(v)=>v==="previsto"?"Previsto":"Realizado"}/>
            <Bar dataKey="previsto" fill={T.accentSoft} radius={[3,3,0,0]} maxBarSize={14}/>
            <Bar dataKey="realizado" fill={T.green} radius={[3,3,0,0]} maxBarSize={14}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ fontSize:9, color:T.textFaint, marginTop:8, textAlign:"center" }}>
        Meses futuros mostram só o previsto · o realizado aparece conforme os proventos caem
      </div>
    </div>
  );
}

function ProjecaoProventos({ ativos, T }) {
  const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const hoje = new Date();
  const mProx = hoje.getMonth()+1===12 ? 1 : hoje.getMonth()+2; // mês seguinte (1-12)

  // todos que pagam no próximo mês (estimativa pelos meses cadastrados)
  const pagantes = ativos
    .filter(a=>a.qtd>0 && a.prov>0 && a.meses.includes(mProx))
    .map(a=>({ ticker:a.ticker, cat:a.cat, provCota:a.prov, qtd:a.qtd, total:+(a.prov*a.qtd).toFixed(2), valorPos:a.qtd*a.cotacao }))
    .sort((x,y)=>y.total-x.total);

  const totalPrev = pagantes.reduce((s,f)=>s+f.total,0);
  const totalFIIs = ativos.filter(a=>a.cat==="FII").reduce((s,a)=>s+a.qtd*a.cotacao,0);
  const dyMensal = totalFIIs>0 ? (pagantes.filter(p=>p.cat==="FII").reduce((s,p)=>s+p.total,0)/totalFIIs*100) : 0;

  // separa FIIs (mensais, mais previsíveis = "confirmável") de ações (trimestrais = "estimado")
  const confirmados = pagantes.filter(p=>p.cat==="FII");
  const estimados = pagantes.filter(p=>p.cat!=="FII");
  const totConf = confirmados.reduce((s,f)=>s+f.total,0);
  const totEst = estimados.reduce((s,f)=>s+f.total,0);

  if (pagantes.length===0) {
    return (
      <div style={{ background:`linear-gradient(135deg, ${T.green}10, ${T.card})`, border:`1px solid ${T.green}33`, borderRadius:14, padding:"20px 16px", marginBottom:16, textAlign:"center" }}>
        <div style={{ fontSize:24, marginBottom:6 }}>📅</div>
        <div style={{ fontSize:12, color:T.textMute }}>Nenhum provento estimado para {MESES[mProx-1]} com os dados atuais.</div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom:16 }}>
      {/* card de projeção */}
      <div style={{ background:"linear-gradient(135deg,#064e3b,#065f46)", border:"1px solid #059669", borderRadius:14, padding:"16px", marginBottom:14 }}>
        <div style={{ fontSize:11, color:"#6ee7b7", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>📅 Projeção de proventos · {MESES[mProx-1]} {mProx<hoje.getMonth()+1?hoje.getFullYear()+1:hoje.getFullYear()}</div>
        <div style={{ fontSize:28, fontWeight:800, color:"#ecfdf5" }}>{fmt(totalPrev)}</div>
        <div style={{ fontSize:12, color:"#6ee7b7", marginTop:6 }}>Estimativa baseada nos meses de pagamento dos seus {pagantes.length} ativos</div>
        <div style={{ display:"flex", gap:10, marginTop:10, flexWrap:"wrap" }}>
          <div style={{ background:"#065f46", borderRadius:8, padding:"6px 12px" }}>
            <div style={{ fontSize:10, color:"#6ee7b7" }}>✅ FIIs (mensais)</div>
            <div style={{ fontSize:13, fontWeight:700, color:"#34d399" }}>{fmt(totConf)}</div>
          </div>
          <div style={{ background:"#065f46", borderRadius:8, padding:"6px 12px" }}>
            <div style={{ fontSize:10, color:"#6ee7b7" }}>🔮 Outros</div>
            <div style={{ fontSize:13, fontWeight:700, color:"#fbbf24" }}>{fmt(totEst)}</div>
          </div>
          <div style={{ background:"#065f46", borderRadius:8, padding:"6px 12px" }}>
            <div style={{ fontSize:10, color:"#6ee7b7" }}>DY mensal (FIIs)</div>
            <div style={{ fontSize:13, fontWeight:700, color:"#a78bfa" }}>{dyMensal.toFixed(2)}%</div>
          </div>
        </div>
      </div>

      {/* contribuição por ativo */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px" }}>
        <div style={{ fontSize:11, color:T.textFaint, marginBottom:10, textTransform:"uppercase", letterSpacing:1 }}>Contribuição por ativo</div>
        {pagantes.map(f=>{
          const pctBar = totalPrev>0 ? f.total/totalPrev*100 : 0;
          const ehFII = f.cat==="FII";
          return (
            <div key={f.ticker} style={{ marginBottom:9 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                <span onClick={()=>abrirEditorAtivo(f.ticker)} style={{ fontSize:11, color:T.textDim, fontWeight:600, cursor:"pointer" }}>{f.ticker} <span style={{ fontSize:9, color:T.textFaint }}>· {f.qtd}× R${f.provCota.toFixed(2)}</span></span>
                <span style={{ fontSize:11, color: ehFII?T.green:T.amber, fontWeight:700 }}>{fmt(f.total)}</span>
              </div>
              <div style={{ height:6, background:T.cardAlt, borderRadius:4, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${pctBar}%`, background: ehFII?T.green:T.amber, borderRadius:4 }}/>
              </div>
            </div>
          );
        })}
        <div style={{ fontSize:9, color:T.textFaint, marginTop:8, lineHeight:1.6 }}>
          ⚠️ Projeção informativa baseada no provento/cota atual e nos meses de pagamento cadastrados. Valores reais são divulgados pelos gestores ao longo do mês.
        </div>
      </div>
    </div>
  );
}

function AnaliseCarteira({ ativos, T }) {
  const todos = ativos;
  const patri = todos.reduce((s,a)=>s+a.qtd*a.cotacao,0);
  const investido = todos.reduce((s,a)=>s+a.qtd*a.precoMedio,0);
  const divAnual = todos.reduce((s,a)=>s+a.prov*a.meses.length*a.qtd,0);
  const yieldAtual = patri>0 ? divAnual/patri*100 : 0;
  const yieldCusto = investido>0 ? divAnual/investido*100 : 0;
  const porAtivo = todos.map(a=>({ ticker:a.ticker, v:a.qtd*a.cotacao })).sort((x,y)=>y.v-x.v);
  const maior = porAtivo[0];
  const concentracao = patri>0 && maior ? maior.v/patri*100 : 0;
  const nAtivos = todos.filter(a=>a.qtd>0).length;
  const CDI=10.5, POUP=6.2;
  const alertaConc = concentracao>30;
  const alertaPoucos = nAtivos<5;
  return (
    <>
      {/* yields */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:16 }}>
        <div style={{ fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>📈 Rendimento da carteira</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          <div style={{ background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Yield atual (s/ cotação)</div>
            <div style={{ fontSize:17, fontWeight:800, color:T.cyan }}>{yieldAtual.toFixed(2)}%<span style={{ fontSize:9, color:T.textFaint, fontWeight:600 }}>/ano</span></div>
          </div>
          <div style={{ background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Yield on cost (s/ p. médio)</div>
            <div style={{ fontSize:17, fontWeight:800, color:T.green }}>{yieldCusto.toFixed(2)}%<span style={{ fontSize:9, color:T.textFaint, fontWeight:600 }}>/ano</span></div>
          </div>
        </div>
        <div style={{ marginTop:10 }}>
          {[
            { nome:"Sua carteira", v:yieldAtual, cor:T.cyan },
            { nome:"CDI (ref.)",   v:CDI,        cor:T.amber },
            { nome:"Poupança (ref.)", v:POUP,    cor:T.textMute },
          ].map(b=>{
            const max = Math.max(yieldAtual, CDI, POUP, 1);
            return (
              <div key={b.nome} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                <span style={{ fontSize:10, color:T.textDim, minWidth:96 }}>{b.nome}</span>
                <div style={{ flex:1, height:7, background:T.cardAlt, borderRadius:4, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${b.v/max*100}%`, background:b.cor, borderRadius:4 }}/>
                </div>
                <span style={{ fontSize:10, fontWeight:700, color:b.cor, minWidth:42, textAlign:"right" }}>{b.v.toFixed(1)}%</span>
              </div>
            );
          })}
          <div style={{ fontSize:8, color:T.textFaint, marginTop:4 }}>CDI/Poupança são referências aproximadas (~jun/2026). Compara só o rendimento em dividendos — não inclui valorização das cotas.</div>
        </div>
      </div>

      {/* saúde / diversificação */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:16 }}>
        <div style={{ fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>🩺 Saúde da carteira</div>
        <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
          <div style={{ flex:1, minWidth:100, background:T.cardAlt, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Nº de ativos</div>
            <div style={{ fontSize:16, fontWeight:800, color:T.text }}>{nAtivos}</div>
          </div>
          <div style={{ flex:1, minWidth:100, background:T.cardAlt, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Maior posição</div>
            <div style={{ fontSize:16, fontWeight:800, color:alertaConc?T.red:T.green }}>{concentracao.toFixed(0)}%</div>
            <div style={{ fontSize:8, color:T.textFaint }}>{maior?.ticker}</div>
          </div>
        </div>
        {alertaConc && (
          <div style={{ background:`${T.red}12`, border:`1px solid ${T.red}44`, borderRadius:8, padding:"8px 10px", marginBottom:6 }}>
            <span style={{ fontSize:10, color:T.red }}>⚠️ <strong>{maior.ticker}</strong> concentra {concentracao.toFixed(0)}% da carteira. Concentração acima de 30% aumenta o risco.</span>
          </div>
        )}
        {alertaPoucos && (
          <div style={{ background:`${T.amber}12`, border:`1px solid ${T.amber}44`, borderRadius:8, padding:"8px 10px", marginBottom:6 }}>
            <span style={{ fontSize:10, color:T.amber }}>💡 Poucos ativos ({nAtivos}). Diversificar mais reduz o risco de depender de um só.</span>
          </div>
        )}
        {!alertaConc && !alertaPoucos && (
          <div style={{ background:`${T.green}12`, border:`1px solid ${T.green}44`, borderRadius:8, padding:"8px 10px" }}>
            <span style={{ fontSize:10, color:T.green }}>✓ Boa diversificação — nenhuma posição domina a carteira.</span>
          </div>
        )}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO DE PROVENTOS — 12 meses, quanto cada mês paga e quais ativos
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// CALENDÁRIO DE PROVENTOS — pagamento × data-com (mesmo padrão do painel HTML)
// ════════════════════════════════════════════════════════════════════════════
const NOMES_MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const n4BR = (v) => (+v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const ddmm = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—";

function CalendarioProventos({ ativos, registros, eventos, T }) {
  const hojeD = new Date();
  const HOJE = isoDia(hojeD);
  const [cal, setCal] = useState({ y: hojeD.getFullYear(), m: hojeD.getMonth(), modo: "pag", sel: null });
  const [mesAberto, setMesAberto] = useState(null);
  const { y, m, modo } = cal;

  // pagamentos do mês e, para a visão data-com, também os do mês seguinte (a data-com cai antes do pagamento)
  const itensPag = useMemo(() => agendaMes({ ativos, registros, eventos, y, m }), [ativos, registros, eventos, y, m]);
  const itensProx = useMemo(() => { const d = new Date(y, m + 1, 1); return agendaMes({ ativos, registros, eventos, y: d.getFullYear(), m: d.getMonth() }); }, [ativos, registros, eventos, y, m]);
  const ymMes = `${y}-${p2(m + 1)}`;
  const itensCom = useMemo(() => [...itensPag, ...itensProx].filter(i => i.com && i.com.slice(0, 7) === ymMes), [itensPag, itensProx, ymMes]);
  const lista = modo === "pag" ? itensPag : itensCom;
  const porDia = {};
  lista.forEach(i => { const k = modo === "pag" ? i.pag : i.com; (porDia[k] = porDia[k] || []).push(i); });
  const valDia = (xs) => modo === "pag" ? xs.reduce((t, i) => t + i.valor, 0) : xs.length;
  const maxDia = Math.max(1, ...Object.values(porDia).map(valDia));
  // dia selecionado: o escolhido; senão o próximo dia com evento (ou o primeiro do mês)
  let sel = cal.sel && porDia[cal.sel] ? cal.sel : null;
  if (!sel) { const ks = Object.keys(porDia).sort(); sel = ks.find(k => k >= HOJE) || ks[0] || null; }

  const total = lista.reduce((t, i) => t + i.valor, 0);
  const porSeg = {};
  lista.forEach(i => { porSeg[i.segmento] = (porSeg[i.segmento] || 0) + (modo === "pag" ? i.valor : 1); });
  const primeiroDia = new Date(y, m, 1).getDay(), nDias = new Date(y, m + 1, 0).getDate();
  const cor = modo === "pag" ? T.green : T.amber;
  const mudaMes = (delta) => { const d = new Date(y, m + delta, 1); setCal(c => ({ ...c, y: d.getFullYear(), m: d.getMonth(), sel: null })); };

  const card = { background:T.card, border:`1px solid ${T.border}`, borderRadius:20, padding:"14px 12px", boxShadow:"0 2px 10px #0000000d" };
  const btnSeg = (on) => ({ padding:"7px 12px", borderRadius:10, cursor:"pointer", fontSize:12, fontWeight:700, border:`1px solid ${on ? T.accent : T.border}`, background: on ? T.accentBg : T.cardAlt, color: on ? T.accent : T.textDim });
  const btnNav = { width:40, height:40, borderRadius:12, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontSize:20, fontWeight:700 };
  const selecionados = sel ? (porDia[sel] || []) : [];
  const gruposDia = {};
  selecionados.forEach(i => { (gruposDia[i.segmento] = gruposDia[i.segmento] || []).push(i); });
  const selloStatus = (st) => st === "recebido" ? { t:"recebido", c:T.green } : st === "anunciado" ? { t:"anunciado B3", c:T.cyan } : { t:"estimado", c:T.textMute };

  // próximos 12 meses (lista que já existia, agora com os valores do motor)
  const doze = useMemo(() => Array.from({ length: 12 }, (_, k) => {
    const d = new Date(hojeD.getFullYear(), hojeD.getMonth() + k, 1);
    const its = agendaMes({ ativos, registros, eventos, y: d.getFullYear(), m: d.getMonth() });
    return { ym: isoDia(d).slice(0, 7), rotulo: `${MESES_ABREV[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, itens: its, total: its.reduce((t, i) => t + i.valor, 0) };
    // eslint-disable-next-line
  }), [ativos, registros, eventos]);
  const maxDoze = Math.max(1, ...doze.map(x => x.total));
  const totalDoze = doze.reduce((t, x) => t + x.total, 0);
  const maiorDoze = doze.reduce((a, b) => (b.total > a.total ? b : a), doze[0]);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={card}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, flexWrap:"wrap", marginBottom:12 }}>
          <span style={{ fontSize:15, fontWeight:800, color:T.text }}>Calendário de proventos</span>
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={()=>setCal(c=>({ ...c, modo:"pag", sel:null }))} style={btnSeg(modo === "pag")}>Pagamento</button>
            <button onClick={()=>setCal(c=>({ ...c, modo:"com", sel:null }))} style={btnSeg(modo === "com")}>Data-com</button>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:12, textAlign:"center" }}>
          <button onClick={()=>mudaMes(-1)} aria-label="Mês anterior" style={btnNav}>‹</button>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:17, fontWeight:800, color:T.text }}>{NOMES_MES[m][0].toUpperCase() + NOMES_MES[m].slice(1)} de {y}</div>
            <div style={{ fontSize:11.5, color:T.textMute, marginTop:2 }}>
              {modo === "pag" ? `${fmt(total)} em ${lista.length} pagamento${lista.length === 1 ? "" : "s"}` : `${lista.length} data${lista.length === 1 ? "" : "s"}-com no mês · ${fmt(total)} a receber`}
            </div>
          </div>
          <button onClick={()=>mudaMes(1)} aria-label="Próximo mês" style={btnNav}>›</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7, minmax(0, 1fr))", gap:5 }}>
          {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map(d => <b key={d} style={{ fontSize:10.5, color:T.textMute, textAlign:"center", fontWeight:600 }}>{d}</b>)}
          {Array.from({ length: primeiroDia }, (_, i) => <i key={"v" + i}/>)}
          {Array.from({ length: nDias }, (_, i) => {
            const d = new Date(y, m, i + 1, 12), k = isoDia(d), xs = porDia[k] || [], n = xs.length;
            const intens = n ? valDia(xs) / maxDia : 0;
            const util = ehDiaUtil(d);
            return (
              <button key={k} onClick={()=>setCal(c=>({ ...c, sel:k }))}
                style={{ minHeight:54, padding:"5px 2px", borderRadius:10, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, minWidth:0,
                  background: n ? `${cor}${Math.round((0.14 + intens * 0.4) * 255).toString(16).padStart(2, "0")}` : T.cardAlt,
                  border:`1px solid ${n ? cor + "88" : T.border}`, opacity: util || n ? 1 : 0.45,
                  outline: k === sel ? `2px solid ${T.text}` : "none", outlineOffset:1,
                  boxShadow: k === HOJE ? `inset 0 0 0 2px ${T.cyan}` : "none", color:T.text }}>
                <span style={{ fontSize:13, fontWeight:700 }}>{i + 1}</span>
                {n > 0 && <em style={{ fontStyle:"normal", fontSize:9.5, lineHeight:1.1, fontWeight:700, maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {modo === "pag" ? valDia(xs).toLocaleString("pt-BR", { minimumFractionDigits:2, maximumFractionDigits:2 }) : `${n} ${n > 1 ? "ativos" : "ativo"}`}
                </em>}
              </button>
            );
          })}
        </div>
        {Object.keys(porSeg).length > 0 && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, margin:"12px 0" }}>
            {Object.entries(porSeg).map(([sg, v]) => (
              <span key={sg} style={{ display:"inline-flex", alignItems:"center", gap:6, background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:99, padding:"4px 10px", fontSize:11.5, color:T.textDim }}>
                <i style={{ width:8, height:8, borderRadius:"50%", background:COR_SEGMENTO[sg] || COR_SEGMENTO.Outros, display:"inline-block" }}/>{sg}: {modo === "pag" ? fmt(v) : v}
              </span>
            ))}
          </div>
        )}
        <div style={{ border:`1px solid ${T.border}`, borderRadius:14, padding:12, background:T.cardAlt, marginTop: Object.keys(porSeg).length ? 0 : 12 }}>
          {!selecionados.length ? (
            <div style={{ fontSize:12, color:T.textMute }}>{lista.length ? "Toque num dia marcado para ver os detalhes." : "Nenhum evento neste mês."}</div>
          ) : (<>
            <div style={{ fontSize:15, fontWeight:800, color:T.text }}>{(() => { const t = dataDeIso(sel).toLocaleDateString("pt-BR", { weekday:"long", day:"numeric", month:"long" }); return t[0].toUpperCase() + t.slice(1); })()}</div>
            <div style={{ fontSize:11.5, color:T.textMute, marginTop:2 }}>
              {modo === "pag" ? "Cai na conta" : "Último dia para ter a cota · valor a receber"}: <strong style={{ color:T.text }}>{fmt(selecionados.reduce((t, i) => t + i.valor, 0))}</strong> em {selecionados.length} {selecionados.length > 1 ? "ativos" : "ativo"}
            </div>
            {Object.entries(gruposDia).map(([sg, xs]) => (
              <div key={sg}>
                <div style={{ display:"flex", justifyContent:"space-between", gap:8, margin:"12px 0 4px", fontWeight:800, fontSize:12.5, color:T.text }}>
                  <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}><i style={{ width:8, height:8, borderRadius:"50%", background:COR_SEGMENTO[sg] || COR_SEGMENTO.Outros, display:"inline-block" }}/>{sg}</span>
                  <span>{fmt(xs.reduce((t, i) => t + i.valor, 0))}</span>
                </div>
                {xs.map((i, idx) => {
                  const st = selloStatus(i.status);
                  return (
                    <div key={i.ticker + idx} style={{ display:"grid", gridTemplateColumns:"64px 1fr auto", gap:8, alignItems:"center", fontSize:12.5, padding:"7px 0", borderBottom:`1px solid ${T.border}` }}>
                      <b onClick={()=> i.naCarteira && abrirEditorAtivo(i.ticker)} style={{ color:T.text, cursor: i.naCarteira ? "pointer" : "default", textDecoration: i.naCarteira ? "underline dotted" : "none" }}>{i.ticker}</b>
                      <span style={{ fontSize:10.5, color:T.textMute, lineHeight:1.35, minWidth:0 }}>
                        {i.porCota && i.qtd ? `${n4BR(i.porCota)} por cota × ${(+i.qtd).toLocaleString("pt-BR")} cotas; ` : ""}
                        {modo === "com" ? `paga em ${ddmm(i.pag)}` : `data-com ${ddmm(i.com)}${i.com && i.comEstimada ? " (estimada)" : ""}`}
                        {!i.naCarteira && i.status !== "recebido" && <span style={{ color:T.amber }}> · já vendido, direito garantido</span>}
                        <span style={{ display:"block", color:st.c, fontWeight:700, marginTop:1 }}>{st.t}{i.dataAprox ? " · dia aproximado" : ""}</span>
                      </span>
                      <span style={{ fontWeight:800, color:T.text }}>{fmt(i.valor)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </>)}
        </div>
        <div style={{ fontSize:10.5, color:T.textFaint, lineHeight:1.5, marginTop:10 }}>
          <strong>Recebido</strong> = já caiu (Movimentação da B3). <strong>Anunciado</strong> = arquivo de eventos da B3, inclusive de ativos que você vendeu depois da data-com. <strong>Estimado</strong> = repete o último provento por cota × suas cotas, no dia útil que o fundo costuma pagar. A B3 não informa a data-com no arquivo de eventos: ela vem das regras de cada fundo e pode mudar no comunicado.
        </div>
      </div>

      {/* próximos 12 meses */}
      <div style={card}>
        <div style={{ fontSize:10.5, color:T.textMute, letterSpacing:0.6, textTransform:"uppercase", fontWeight:700 }}>📅 Próximos 12 meses</div>
        <div style={{ fontSize:26, fontWeight:800, color:T.text, marginTop:4 }}>{fmt(totalDoze)}<span style={{ fontSize:13, color:T.textMute, fontWeight:600 }}>/12 meses</span></div>
        {maiorDoze && <div style={{ fontSize:11.5, color:T.textMute, marginTop:2 }}>Maior mês: <strong style={{ color:T.green }}>{maiorDoze.rotulo}</strong> ({fmt(maiorDoze.total)})</div>}
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:12 }}>
          {doze.map(x => (
            <div key={x.ym} style={{ border:`1px solid ${T.border}`, borderRadius:14, background:T.cardAlt, padding:"10px 12px" }}>
              <button onClick={()=>setMesAberto(mesAberto === x.ym ? null : x.ym)} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, background:"none", border:"none", padding:0, cursor:"pointer", color:T.text }}>
                <span style={{ fontSize:11, color:T.textMute }}>{mesAberto === x.ym ? "▼" : "▶"}</span>
                <strong style={{ fontSize:14, textTransform:"capitalize" }}>{x.rotulo}</strong>
                <span style={{ fontSize:11, color:T.textMute }}>{x.itens.length} pagamento{x.itens.length === 1 ? "" : "s"}</span>
                <span style={{ marginLeft:"auto", fontSize:14, fontWeight:800, color:T.green }}>{fmt(x.total)}</span>
              </button>
              <div style={{ height:6, borderRadius:4, background:T.border, marginTop:8, overflow:"hidden" }}>
                <div style={{ width:`${(x.total / maxDoze) * 100}%`, height:"100%", background:T.green, borderRadius:4 }}/>
              </div>
              {mesAberto === x.ym && (
                <div style={{ marginTop:8 }}>
                  {x.itens.map((i, idx) => (
                    <div key={i.ticker + idx} style={{ display:"flex", justifyContent:"space-between", gap:8, fontSize:12, padding:"5px 0", borderBottom:`1px solid ${T.border}` }}>
                      <span style={{ color:T.text }}><strong>{i.ticker}</strong> <span style={{ color:T.textMute, fontSize:10.5 }}>· {ddmm(i.pag)} · {selloStatus(i.status).t}</span></span>
                      <span style={{ fontWeight:700, color:T.text }}>{fmt(i.valor)}</span>
                    </div>
                  ))}
                  {!x.itens.length && <div style={{ fontSize:11, color:T.textMute }}>Nenhum pagamento previsto.</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES — datas-com e pagamentos dos próximos 7 dias + dicas diárias da IA
// ════════════════════════════════════════════════════════════════════════════
function rotuloQuando(iso, hojeIso) {
  const dias = Math.round((dataDeIso(iso) - dataDeIso(hojeIso)) / 86400000);
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  return `em ${dias} dias (${ddmm(iso)})`;
}
function notificacoesDeEventos({ ativos, registros, eventos, dias = 7 }) {
  const agora = new Date();
  const hoje = isoDia(agora);
  const ate = isoDia(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + dias, 12));
  const prox = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);
  const itens = [
    ...agendaMes({ ativos, registros, eventos, y: agora.getFullYear(), m: agora.getMonth() }),
    ...agendaMes({ ativos, registros, eventos, y: prox.getFullYear(), m: prox.getMonth() }),
  ].filter(i => i.status !== "recebido");
  const lista = [];
  itens.forEach(i => {
    if (i.pag >= hoje && i.pag <= ate) lista.push({ id:`pag|${i.ticker}|${i.pag}`, tipo:"pagamento", data:i.pag,
      titulo:`💰 ${i.ticker} paga ${fmt(i.valor)}`, texto:`Cai ${rotuloQuando(i.pag, hoje)} · ${i.status === "anunciado" ? "anunciado pela B3" : "estimado"}${i.naCarteira ? "" : " · ativo já vendido"}` });
    if (i.com && i.com >= hoje && i.com <= ate && i.naCarteira) lista.push({ id:`com|${i.ticker}|${i.com}`, tipo:"datacom", data:i.com,
      titulo:`📌 Data-com de ${i.ticker} ${rotuloQuando(i.com, hoje)}`, texto:`Tenha a cota até esse dia para receber ${i.porCota ? n4BR(i.porCota) + " por cota" : fmt(i.valor)} (paga ${ddmm(i.pag)})${i.comEstimada ? " · data estimada" : ""}` });
  });
  return lista.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}
// lê as dicas da resposta da IA: JSON [{titulo, texto}] ou lista numerada
const ehRespostaDeErro = (t) => /^\s*⚠️|erro ao processar|falha no streaming|não foi possível gerar|^\s*erro\b/i.test(String(t || ""));
function lerDicasIA(txt) {
  if (ehRespostaDeErro(txt)) return [];
  const limpo = String(txt || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/\[\[THINK\]\][\s\S]*?\[\[\/THINK\]\]/g, "").trim();
  try {
    const bloco = limpo.match(/\[[\s\S]*\]/);
    if (bloco) {
      const arr = JSON.parse(bloco[0]);
      const ok = (Array.isArray(arr) ? arr : []).map(o => typeof o === "string" ? { titulo: o.split(/[:.]/)[0].slice(0, 60), texto: o }
        : { titulo: String(o.titulo || o.title || "").trim(), texto: String(o.texto || o.dica || o.text || "").trim() }).filter(d => d.texto || d.titulo);
      if (ok.length) return ok.map(d => ({ titulo: d.titulo || d.texto.split(/[:.]/)[0].slice(0, 60), texto: d.texto || d.titulo }));
    }
  } catch { /* não era JSON: tenta lista numerada */ }
  const partes = limpo.split(/\n(?=\s*(?:\d+[.)-]|[-•*])\s+)/).map(p => p.replace(/^\s*(?:\d+[.)-]|[-•*])\s+/, "").replace(/\*\*/g, "").trim()).filter(p => p.length > 15);
  return partes.map(p => { const i = p.indexOf(":"); return i > 3 && i < 70 ? { titulo: p.slice(0, i).trim(), texto: p.slice(i + 1).trim() } : { titulo: p.split(/\s+/).slice(0, 6).join(" "), texto: p }; })
    .filter(d => !ehRespostaDeErro(d.titulo) && !ehRespostaDeErro(d.texto));
}

function CentralNotificacoes({ eventos = [], dicas = [], vistas = [], onMarcarVistas = () => {}, onAbrirCalendario = () => {}, T }) {
  const [aberto, setAberto] = useState(false);
  const [dicaAberta, setDicaAberta] = useState(null);
  const todas = [...eventos.map(e => e.id), ...dicas.map((d, i) => `dica|${d.data || ""}|${i}`)];
  const novas = todas.filter(id => !vistas.includes(id)).length;
  const abrir = () => { setAberto(v => !v); onMarcarVistas(todas); };
  const icone = (t) => t === "pagamento" ? T.green : T.amber;
  return (
    <div style={{ position:"relative", flexShrink:0 }}>
      <button onClick={abrir} title="Notificações" aria-label={`Notificações${novas ? `: ${novas} novas` : ""}`} aria-expanded={aberto}
        style={{ width:42, height:42, borderRadius:"50%", border:`1px solid ${aberto ? T.accent : T.border}`, background:T.card, cursor:"pointer", padding:0, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px #0000001a", position:"relative" }}>
        <Icone nome="sino" size={21} cor={T.accent}/>
        {novas > 0 && <span style={{ position:"absolute", top:-3, right:-3, minWidth:19, height:19, padding:"0 5px", borderRadius:10, background:"#e5483f", color:"#fff", fontSize:10.5, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", border:`2px solid ${T.bg || T.card}` }}>{novas > 99 ? "99+" : novas}</span>}
      </button>
      {aberto && (<>
        <div onClick={()=>setAberto(false)} style={{ position:"fixed", inset:0, zIndex:1190, background:"transparent" }}/>
        <div role="dialog" aria-label="Notificações" style={{ position:"absolute", top:"calc(100% + 12px)", right:-6, zIndex:1200, width:"min(340px, calc(100vw - 28px))",
          background:T.card, border:`1px solid ${T.border}`, borderRadius:18, boxShadow:"0 14px 40px #0000003a" }}>
          {/* setinha apontando para o sino */}
          <span style={{ position:"absolute", top:-8, right:20, width:16, height:16, background:T.card, borderLeft:`1px solid ${T.border}`, borderTop:`1px solid ${T.border}`, transform:"rotate(45deg)", borderRadius:"3px 0 0 0" }}/>
          <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 14px 8px" }}>
            <strong style={{ fontSize:14.5, color:T.text }}>Notificações</strong>
            <button onClick={()=>setAberto(false)} aria-label="Fechar" style={{ background:"none", border:"none", cursor:"pointer", fontSize:18, color:T.textMute, padding:0, lineHeight:1 }}>✕</button>
          </div>
          <div style={{ maxHeight:"62vh", overflowY:"auto", padding:"0 14px 12px" }}>
            <div style={{ fontSize:10.5, color:T.textMute, textTransform:"uppercase", letterSpacing:0.6, fontWeight:700, margin:"4px 0 6px" }}>Próximos 7 dias</div>
            {eventos.length === 0 && <div style={{ fontSize:12, color:T.textMute, padding:"6px 0 10px" }}>Nenhuma data-com ou pagamento nos próximos 7 dias.</div>}
            {eventos.map(e => (
              <button key={e.id} onClick={()=>{ setAberto(false); onAbrirCalendario(); }} style={{ display:"flex", gap:10, width:"100%", textAlign:"left", background: vistas.includes(e.id) ? "transparent" : `${T.accent}0d`, border:"none", borderBottom:`1px solid ${T.border}`, padding:"9px 4px", cursor:"pointer", color:T.text, borderRadius:8 }}>
                <span style={{ width:4, alignSelf:"stretch", borderRadius:2, background:icone(e.tipo), flexShrink:0 }}/>
                <span style={{ minWidth:0 }}>
                  <span style={{ display:"block", fontSize:12.5, fontWeight:700, lineHeight:1.3 }}>{e.titulo}</span>
                  <span style={{ display:"block", fontSize:11, color:T.textMute, marginTop:2, lineHeight:1.35 }}>{e.texto}</span>
                </span>
              </button>
            ))}
            {dicas.length > 0 && (<>
              <div style={{ fontSize:10.5, color:T.textMute, textTransform:"uppercase", letterSpacing:0.6, fontWeight:700, margin:"14px 0 6px" }}>💡 Dicas da IA para hoje</div>
              {dicas.map((d, i) => (
                <button key={i} onClick={()=>setDicaAberta(dicaAberta === i ? null : i)} style={{ display:"block", width:"100%", textAlign:"left", background:`${T.cyan}0f`, border:`1px solid ${T.cyan}33`, borderRadius:12, padding:"9px 11px", marginBottom:7, cursor:"pointer", color:T.text }}>
                  <span style={{ display:"block", fontSize:12.5, fontWeight:700, lineHeight:1.3 }}>{d.titulo}</span>
                  <span style={{ display:"block", fontSize:11.5, color:T.textDim, marginTop:3, lineHeight:1.45, ...(dicaAberta === i ? {} : { display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }) }}>{d.texto}</span>
                </button>
              ))}
              <div style={{ fontSize:9.5, color:T.textFaint, lineHeight:1.4 }}>Geradas pela sua IA local com base na carteira. São sugestões, não recomendação de investimento.</div>
            </>)}
            <button onClick={()=>{ setAberto(false); onAbrirCalendario(); }} style={{ marginTop:10, width:"100%", padding:"9px", borderRadius:10, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.accent, fontWeight:700, fontSize:12, cursor:"pointer" }}>Ver calendário ›</button>
          </div>
        </div>
      </>)}
    </div>
  );
}

function Calendario({ ativos, T }) {
  const [mesAberto, setMesAberto] = useState(null);
  // monta os 12 meses (base Jul/26 → Jun/27)
  const meses = MESES_BASE.map((label, idx) => {
    const pagantes = ativos
      .filter(a => a.qtd>0 && a.prov>0 && mesesIdx(a.meses).includes(idx))
      .map(a => ({ ticker:a.ticker, cat:a.cat, valor:+(a.prov*a.qtd).toFixed(2) }))
      .sort((x,y)=>y.valor-x.valor);
    const total = pagantes.reduce((s,p)=>s+p.valor,0);
    return { idx, label, pagantes, total };
  });
  const maxMes = Math.max(...meses.map(m=>m.total), 1);
  const totalAno = meses.reduce((s,m)=>s+m.total,0);
  const mesAtualIdx = meses.reduce((best,m,i)=> m.total>meses[best].total ? i : best, 0);

  return (
    <div>
      <div style={{ background:`linear-gradient(135deg, ${T.cyan}1c, ${T.card})`, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px 16px", marginBottom:16 }}>
        <div style={{ fontSize:10, color:T.textFaint, textTransform:"uppercase", letterSpacing:1 }}>📅 Calendário de proventos · 12 meses</div>
        <div style={{ fontSize:24, fontWeight:800, color:T.text }}>{fmt(totalAno)}<span style={{ fontSize:12, color:T.textFaint, fontWeight:600 }}>/ano</span></div>
        <div style={{ fontSize:10, color:T.textMute, marginTop:2 }}>Maior mês: <strong style={{ color:T.green }}>{meses[mesAtualIdx].label}</strong> ({fmt(meses[mesAtualIdx].total)})</div>
      </div>

      {meses.map(m=>{
        const aberto = mesAberto===m.idx;
        const pct = m.total/maxMes*100;
        return (
          <div key={m.idx} style={{ marginBottom:6 }}>
            <div onClick={()=>setMesAberto(aberto?null:m.idx)} style={{ cursor:"pointer", background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 13px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:10, color:T.textFaint, transform:aberto?"rotate(90deg)":"none", transition:"transform 0.2s", display:"inline-block" }}>▶</span>
                  <span style={{ fontSize:13, fontWeight:700, color:T.text }}>{m.label}</span>
                  <span style={{ fontSize:9, color:T.textFaint }}>{m.pagantes.length} ativo{m.pagantes.length!==1?"s":""}</span>
                </div>
                <span style={{ fontSize:13, fontWeight:800, color: m.total>0?T.green:T.textFaint }}>{m.total>0?fmt(m.total):"—"}</span>
              </div>
              <div style={{ height:6, background:T.cardAlt, borderRadius:4, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${pct}%`, background:T.green, borderRadius:4 }}/>
              </div>
            </div>
            {aberto && m.pagantes.length>0 && (
              <div style={{ paddingLeft:6, marginTop:5 }}>
                {m.pagantes.map(p=>{
                  const c = corDe(p.ticker, p.cat, T);
                  return (
                    <div key={p.ticker} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:`${c}0d`, borderLeft:`3px solid ${c}`, borderRadius:7, padding:"7px 11px", marginBottom:4 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                        <div style={{ width:8, height:8, borderRadius:2, background:c }}/>
                        <span style={{ fontSize:12, fontWeight:700, color:T.text }}>{p.ticker}</span>
                      </div>
                      <span style={{ fontSize:12, fontWeight:700, color:c }}>{fmt(p.valor)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ fontSize:9, color:T.textFaint, marginTop:8, textAlign:"center", lineHeight:1.5 }}>
        Baseado na frequência cadastrada de cada ativo. Datas exatas (data-com/pagamento) viriam da integração com API no futuro.
      </div>
    </div>
  );
}

function Ranking({ ativos, T }) {
  const [modo, setModo] = useState("proventos"); // "proventos" | "valorizacao"

  // PROVENTOS: ranking anual
  const rankedProv = ativos.map(a=>({...a,ano:+(mesesIdx(a.meses).length*a.prov*a.qtd).toFixed(2)})).filter(a=>a.ano>0).sort((a,b)=>b.ano-a.ano);
  const totalProv = rankedProv.reduce((s,a)=>s+a.ano,0); const maxProv = rankedProv[0]?.ano||1;

  // VALORIZAÇÃO: ganho/perda desde o preço médio
  const rankedVal = ativos.map(a=>{
    const pctVal = a.precoMedio>0 ? ((a.cotacao-a.precoMedio)/a.precoMedio)*100 : 0;
    const ganho = (a.cotacao-a.precoMedio)*a.qtd;
    return {...a, pctVal:+pctVal.toFixed(2), ganho:+ganho.toFixed(2)};
  }).sort((a,b)=>b.pctVal-a.pctVal);
  const maxAbsVal = Math.max(...rankedVal.map(a=>Math.abs(a.pctVal)),1);

  return (
    <div>
      {/* toggle proventos / valorização */}
      <div style={{ display:"flex", gap:4, background:T.card, borderRadius:10, padding:3, marginBottom:20 }}>
        {[{id:"proventos",l:"💰 Proventos"},{id:"valorizacao",l:"📈 Valorização"}].map(o=>(
          <button key={o.id} onClick={()=>setModo(o.id)} style={{ flex:1, padding:"8px 4px", borderRadius:7, border:"none", cursor:"pointer", fontSize:12, fontWeight:700, background:modo===o.id?T.accent:"transparent", color:modo===o.id?"#fff":T.textMute }}>{o.l}</button>
        ))}
      </div>

      {modo==="proventos" ? (
        <>
          <div style={{ fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:1,marginBottom:16 }}>Ranking anual de proventos · {fmt(totalProv)}</div>
          {rankedProv.map((a,i)=>{
            const c = corDe(a.ticker,a.cat,T);
            return (
              <div key={a.ticker} style={{ marginBottom:9 }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                    <span style={{ fontSize:10,color:T.textFaint,fontWeight:700,minWidth:18 }}>#{i+1}</span>
                    <div style={{ width:9,height:9,borderRadius:2,background:c }}/>
                    <span onClick={()=>abrirEditorAtivo(a.ticker)} style={{ fontSize:12,fontWeight:700,color:T.text, cursor:"pointer" }}>{a.ticker}</span>
                    <span style={{ fontSize:9,color:T.textFaint,background:T.border,padding:"1px 5px",borderRadius:4 }}>{a.freq}</span>
                  </div>
                  <span style={{ fontSize:12,fontWeight:800,color:c }}>{fmt(a.ano)}</span>
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                  <div style={{ flex:1,height:5,background:T.border,borderRadius:4,overflow:"hidden" }}>
                    <div style={{ height:"100%",width:`${(a.ano/maxProv)*100}%`,background:c,borderRadius:4 }}/>
                  </div>
                  <span style={{ fontSize:9,color:T.textFaint,minWidth:32,textAlign:"right" }}>{((a.ano/totalProv)*100).toFixed(1)}%</span>
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div style={{ fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:1,marginBottom:4 }}>Valorização desde o preço médio</div>
          <div style={{ fontSize:10,color:T.textFaint,marginBottom:16,lineHeight:1.5 }}>Quanto cada ativo subiu ou caiu em relação ao que você pagou. Atualize as cotações na aba Editar para acompanhar mês a mês.</div>
          {rankedVal.map((a,i)=>{
            const pos = a.pctVal>=0;
            const cor = pos?T.green:T.red;
            return (
              <div key={a.ticker} style={{ marginBottom:9 }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                    <span style={{ fontSize:10,color:T.textFaint,fontWeight:700,minWidth:18 }}>#{i+1}</span>
                    <div style={{ width:9,height:9,borderRadius:2,background:corDe(a.ticker,a.cat,T) }}/>
                    <span onClick={()=>abrirEditorAtivo(a.ticker)} style={{ fontSize:12,fontWeight:700,color:T.text, cursor:"pointer" }}>{a.ticker}</span>
                    <span style={{ fontSize:9,color:T.textFaint }}>R${a.precoMedio.toFixed(2)}→R${a.cotacao.toFixed(2)}</span>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <span style={{ fontSize:12,fontWeight:800,color:cor }}>{pos?"+":""}{a.pctVal.toFixed(1)}%</span>
                    <div style={{ fontSize:9,color:cor }}>{pos?"+":""}{fmtK(a.ganho)}</div>
                  </div>
                </div>
                {/* barra divergente: centro = 0 */}
                <div style={{ display:"flex",alignItems:"center",height:6 }}>
                  <div style={{ flex:1,display:"flex",justifyContent:"flex-end" }}>
                    {!pos && <div style={{ height:6,width:`${(Math.abs(a.pctVal)/maxAbsVal)*100}%`,background:T.red,borderRadius:"4px 0 0 4px" }}/>}
                  </div>
                  <div style={{ width:1,height:10,background:T.borderSoft }}/>
                  <div style={{ flex:1 }}>
                    {pos && <div style={{ height:6,width:`${(a.pctVal/maxAbsVal)*100}%`,background:T.green,borderRadius:"0 4px 4px 0" }}/>}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA EDITAR ATIVOS
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// ASSISTENTE IA — chat conectado ao seu AI Bridge / Ollama (Gemma) local
// ════════════════════════════════════════════════════════════════════════════
function Assistente({ ativos, setAtivos, T }) {
  const [urlServidor, setUrlServidor] = useEstadoSalvo("aiUrl", "http://100.100.195.84:4000");
  const [mensagens, setMensagens] = useState([]); // {role, content, acao?}
  const [input, setInput] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [status, setStatus] = useState("desconhecido"); // online | offline | desconhecido
  const [showCfg, setShowCfg] = useState(false);
  const fimRef = useRef(null);

  useLayoutEffect(()=>{ fimRef.current?.scrollIntoView({ behavior:"smooth" }); }, [mensagens, carregando]);

  // testa se o servidor está vivo (rota /ping)
  async function testar() {
    setStatus("desconhecido");
    try {
      const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), 6000);
      const r = await fetch(`${urlServidor.replace(/\/$/,"")}/ping`, { signal:ctrl.signal });
      clearTimeout(t);
      setStatus(r.ok ? "online" : "offline");
    } catch { setStatus("offline"); }
  }

  // extrai bloco <<ACAO>>{...}<</ACAO>> da resposta
  function extrairAcao(txt) {
    const m = txt.match(/<<ACAO>>([\s\S]*?)<<\/ACAO>>/);
    if (!m) return { texto:txt, acao:null };
    let acao=null;
    try { acao = JSON.parse(m[1].trim()); } catch {}
    return { texto: txt.replace(m[0],"").trim(), acao };
  }

  async function enviar() {
    const pergunta = input.trim();
    if (!pergunta || carregando) return;
    setInput("");
    const novas = [...mensagens, { role:"user", content:pergunta }];
    setMensagens(novas);
    setCarregando(true);
    try {
      const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), 60000);
      const r = await fetch(`${urlServidor.replace(/\/$/,"")}/chat`, {
        method:"POST", headers:{ "Content-Type":"application/json" }, signal:ctrl.signal,
        body: JSON.stringify({
          pergunta,
          carteira: ativos.map(a=>({ ticker:a.ticker, nome:a.nome, cat:a.cat, qtd:a.qtd, precoMedio:a.precoMedio, cotacao:a.cotacao, prov:a.prov, setor:a.setor })),
          historico: mensagens.slice(-6).map(m=>({ role:m.role, content:m.content })),
        }),
      });
      clearTimeout(t);
      if (!r.ok) throw new Error("servidor");
      const data = await r.json();
      setStatus("online");
      const { texto, acao } = extrairAcao(data.resposta || "(sem resposta)");
      setMensagens(m=>[...m, { role:"assistant", content:texto, acao }]);
    } catch (e) {
      setStatus("offline");
      setMensagens(m=>[...m, { role:"assistant", content:"⚠️ Não consegui falar com o servidor. Verifique se o PC está ligado, o AI Bridge rodando (porta 4000) e o Tailscale ativo. Toque na engrenagem para conferir o endereço.", erro:true }]);
    } finally { setCarregando(false); }
  }

  // aplica a ação proposta pela IA
  function aplicarAcao(acao) {
    if (!acao || acao.tipo!=="editar") return;
    const campos = ["qtd","precoMedio","cotacao","prov"];
    if (!campos.includes(acao.campo)) return;
    setAtivos(prev => prev.map(a => a.ticker===String(acao.ticker).toUpperCase()
      ? { ...a, [acao.campo]: acao.campo==="qtd"?Math.round(+acao.valor): +acao.valor } : a));
    setMensagens(m=>[...m, { role:"assistant", content:`✓ Pronto! ${acao.ticker}: ${acao.campo} = ${acao.valor}.`, sistema:true }]);
  }

  const corStatus = status==="online"?T.green : status==="offline"?T.red : T.textFaint;
  const sugestoes = ["Como está minha carteira?", "Qual meu maior dividendo?", "Quanto recebo este mês?", "Estou diversificado?"];

  return (
    <div>
      {/* status do servidor */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"10px 13px", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:9, height:9, borderRadius:"50%", background:corStatus }}/>
          <span style={{ fontSize:12, color:T.textDim, fontWeight:600 }}>
            IA local · {status==="online"?"conectado":status==="offline"?"offline":"toque em testar"}
          </span>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={testar} style={{ padding:"6px 10px", borderRadius:8, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:11, fontWeight:600 }}>Testar</button>
          <button onClick={()=>setShowCfg(v=>!v)} style={{ width:32, height:30, borderRadius:8, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontSize:13 }}>⚙️</button>
        </div>
      </div>

      {/* config do endereço */}
      {showCfg && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"12px", marginBottom:14 }}>
          <div style={{ fontSize:10, color:T.textMute, marginBottom:5 }}>Endereço do AI Bridge (Tailscale)</div>
          <input value={urlServidor} onChange={e=>setUrlServidor(e.target.value)} placeholder="http://100.100.195.84:4000"
            style={{ width:"100%", background:T.cardAlt, border:`1px solid ${T.borderSoft}`, borderRadius:8, color:T.text, padding:"10px", fontSize:13, outline:"none", fontFamily:"monospace" }}/>
          <div style={{ fontSize:9, color:T.textFaint, marginTop:6, lineHeight:1.5 }}>Use o IP do Tailscale do seu PC com a porta 4000. O PC precisa estar ligado com o AI Bridge rodando.</div>
        </div>
      )}

      {/* mensagens */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"12px", minHeight:300, marginBottom:12 }}>
        {mensagens.length===0 && (
          <div style={{ textAlign:"center", padding:"24px 12px" }}>
            <div style={{ fontSize:34, marginBottom:8 }}>🤖</div>
            <div style={{ fontSize:13, color:T.textDim, fontWeight:600, marginBottom:4 }}>Assistente da sua carteira</div>
            <div style={{ fontSize:11, color:T.textFaint, lineHeight:1.5, marginBottom:14 }}>Pergunte sobre seus proventos, peça análises ou diga uma alteração (ex: "comprei mais 10 de BBAS3").</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center" }}>
              {sugestoes.map(s=>(
                <button key={s} onClick={()=>setInput(s)} style={{ fontSize:10, padding:"6px 10px", borderRadius:8, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.textMute, cursor:"pointer" }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {mensagens.map((m,i)=>(
          <div key={i} style={{ display:"flex", justifyContent: m.role==="user"?"flex-end":"flex-start", marginBottom:10 }}>
            <div style={{
              maxWidth:"82%", padding:"9px 12px", borderRadius:12, fontSize:13, lineHeight:1.45,
              background: m.role==="user"?T.accent : m.erro?`${T.red}14`:m.sistema?`${T.green}14`:T.cardAlt,
              color: m.role==="user"?"#fff":m.erro?T.red:T.text,
              border: m.role==="user"?"none":`1px solid ${m.erro?T.red+"44":m.sistema?T.green+"44":T.border}`,
              whiteSpace:"pre-wrap"
            }}>
              {m.content}
              {/* botão de aplicar ação proposta */}
              {m.acao && m.acao.tipo==="editar" && (
                <button onClick={()=>aplicarAcao(m.acao)} style={{ display:"block", marginTop:8, padding:"7px 12px", borderRadius:8, border:"none", background:T.green, color:"#06281b", cursor:"pointer", fontSize:11, fontWeight:700 }}>
                  ✓ Aplicar: {m.acao.ticker} {m.acao.campo}={m.acao.valor}
                </button>
              )}
            </div>
          </div>
        ))}
        {carregando && (
          <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:10 }}>
            <div style={{ padding:"9px 14px", borderRadius:12, background:T.cardAlt, border:`1px solid ${T.border}`, fontSize:13, color:T.textMute }}>
              pensando…
            </div>
          </div>
        )}
        <div ref={fimRef}/>
      </div>

      {/* entrada */}
      <div style={{ display:"flex", gap:8 }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") enviar(); }}
          placeholder="Pergunte algo sobre sua carteira..."
          style={{ flex:1, background:T.card, border:`1px solid ${T.borderSoft}`, borderRadius:12, color:T.text, padding:"12px 14px", fontSize:14, outline:"none" }}/>
        <button onClick={enviar} disabled={carregando||!input.trim()} style={{ padding:"0 18px", borderRadius:12, border:"none", background: (carregando||!input.trim())?T.border:T.accent, color:"#fff", cursor:"pointer", fontSize:16, fontWeight:700 }}>➤</button>
      </div>
      <div style={{ fontSize:9, color:T.textFaint, textAlign:"center", marginTop:8, lineHeight:1.5 }}>
        Respostas geradas pela sua IA local (Gemma). Confira sempre os números — a IA pode errar.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// IMPORTAR EM MASSA — cola texto e atualiza/cria ativos de uma vez
// ════════════════════════════════════════════════════════════════════════════
function ImportarMassa({ ativos, setAtivos, onProventosRecebidos, onEventosB3 = () => {}, onVendidos = () => {}, onClose, T }) {
  // arquivo de EVENTOS da B3 (proventos anunciados)
  const [eventosInfo, setEventosInfo] = useState(null);
  const [erroEventos, setErroEventos] = useState(null);
  const [lendoEventos, setLendoEventos] = useState(false);
  const fileEvRef = useRef(null);
  const lerArquivoEventos = (file) => {
    if (!file) return;
    setLendoEventos(true); setErroEventos(null); setEventosInfo(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type:"array", cellDates:true });
        const nomeAba = wb.SheetNames.find(n => /event|provent/i.test(n)) || wb.SheetNames[0];
        const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { defval:null });
        const res = parseB3Eventos(linhas);
        if (res.itens.length === 0) {
          setErroEventos("Não encontrei eventos com produto, data e valor. Veja as colunas detectadas depois de escolher um arquivo válido.");
        } else {
          onEventosB3(res.itens);
          setEventosInfo({ nome:file.name, aba:nomeAba, total:res.itens.length, ignoradas:res.ignoradas, colunas:res.colunas });
          registrarLog("import", `Eventos da B3 importados: ${res.itens.length}`, { direcao:"interno", origem:"app" });
        }
      } catch (err) { setErroEventos("Erro ao ler o arquivo de eventos: " + err.message); }
      finally { setLendoEventos(false); }
    };
    reader.onerror = () => { setErroEventos("Não consegui ler o arquivo."); setLendoEventos(false); };
    reader.readAsArrayBuffer(file);
  };
  const [modo, setModo] = useState("texto"); // "texto" | "arquivo"
  const fileRef = useRef(null);
  const [texto, setTexto] = useState("");
  const [itensArquivo, setItensArquivo] = useState(null);
  const [proventosArquivo, setProventosArquivo] = useState(null); // {porMes, total, registros}
  const [vendidosArquivo, setVendidosArquivo] = useState([]);     // tickers zerados na Movimentação (com histórico)
  const [removerAusentes, setRemoverAusentes] = useState(true);
  const [infoArquivo, setInfoArquivo] = useState(null); // {nome, lidas, ignoradas}
  const [erroArquivo, setErroArquivo] = useState(null);
  const [lendo, setLendo] = useState(false);

  const itens = modo==="arquivo" ? (itensArquivo || []) : parseImportacao(texto);
  const validos = itens.filter(i=>!i.erro);
  const erros = itens.filter(i=>i.erro);
  const porTicker = {}; ativos.forEach(a=>porTicker[a.ticker]=a);
  const atualizados = validos.filter(i=>porTicker[i.ticker]);
  const novos = validos.filter(i=>!porTicker[i.ticker]);
  // Movimentação da B3 = histórico completo: o que está na carteira e NÃO está no arquivo foi vendido/resgatado
  // (ou tem quantidade zerada/negativa). Ativos digitados à mão que nunca vieram da B3 (sem movimentações) ficam.
  const tickersArquivo = new Set(validos.map(i=>i.ticker));
  const tickersVendidos = new Set((vendidosArquivo||[]).map(v=>v.ticker));
  const ausentes = modo==="arquivo" && itensArquivo ? ativos.filter(a => !tickersArquivo.has(a.ticker) &&
    (tickersVendidos.has(a.ticker) || (a.movimentacoes||[]).length > 0 || !(a.qtd > 0) || /^[A-Z]{4}1[2-5]$/.test(a.ticker))) : [];

  // lê o arquivo .xlsx da B3 e calcula as posições
  const lerArquivo = (file) => {
    if (!file) return;
    setLendo(true); setErroArquivo(null); setItensArquivo(null); setInfoArquivo(null);
    registrarLog("import", `Arquivo selecionado: ${file.name}`, { direcao:"interno", origem:"app" });
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type:"array" });
        const nomeAba = wb.SheetNames.find(n=>/moviment/i.test(n)) || wb.SheetNames[0];
        const sheet = wb.Sheets[nomeAba];
        const linhas = XLSX.utils.sheet_to_json(sheet, { defval:null });
        const { itens:its, lidas, ignoradas, vendidos } = parseB3Movimentacao(linhas);
        setVendidosArquivo(vendidos || []);
        if (its.length === 0) {
          setErroArquivo("Não encontrei movimentações de compra/venda nesta planilha. Confira se é o extrato de Movimentação da B3.");
          registrarLog("erro", `Arquivo sem posições válidas`, { direcao:"interno", origem:"app", detalhe:`aba=${nomeAba}, linhas=${linhas.length}` });
        } else {
          setItensArquivo(its);
          setInfoArquivo({ nome:file.name, aba:nomeAba, lidas, ignoradas, total:its.length });
          registrarLog("import", `Planilha lida: ${its.length} ativos (${lidas} movimentos)`, { direcao:"interno", origem:"app", detalhe:its.map(i=>`${i.ticker}=${i.qtd}`).join(", ") });
          // proventos realmente recebidos (Rendimento/Dividendo/JCP) por mês
          const prov = parseProventosRecebidos(linhas);
          setProventosArquivo(prov);
          if (prov.total>0) registrarLog("import", `Proventos recebidos lidos: ${fmt(prov.total)} em ${Object.keys(prov.porMes).length} meses`, { direcao:"interno", origem:"app" });
        }
      } catch (err) {
        setErroArquivo("Erro ao ler o arquivo: " + err.message);
        registrarLog("erro", `Falha ao ler planilha: ${err.message}`, { direcao:"interno", origem:"app" });
      } finally { setLendo(false); }
    };
    reader.onerror = () => { setErroArquivo("Não consegui abrir o arquivo."); setLendo(false); };
    reader.readAsArrayBuffer(file);
  };

  const aplicar = () => {
    registrarLog("import", `Importação (${modo}): ${atualizados.length} atualizados, ${novos.length} novos`, { direcao:"interno", origem:"app", detalhe: validos.map(i=>`${i.ticker} qtd=${i.qtd} pm=${i.precoMedio}`).join("; ") });
    setAtivos(prev => {
      const mapa = {}; prev.forEach(a=>mapa[a.ticker]={...a});
      validos.forEach(i=>{
        if (mapa[i.ticker]) {
          if (i.qtd!=null) mapa[i.ticker].qtd = i.qtd;
          if (i.precoMedio!=null) mapa[i.ticker].precoMedio = i.precoMedio;
          if (i.cotacao!=null) mapa[i.ticker].cotacao = i.cotacao;
          if (i.dataCompra) mapa[i.ticker].dataCompra = i.dataCompra;
          if (i.ultimaCompra) mapa[i.ticker].ultimaCompra = i.ultimaCompra;
          if (i.movimentacoes) mapa[i.ticker].movimentacoes = i.movimentacoes;
        } else {
          const ehTesouro = /^tesouro/i.test(i.ticker);
          const ehFII = /11$/.test(i.ticker) && !ehTesouro;
          mapa[i.ticker] = {
            ticker:i.ticker, nome:i.ticker, cat: ehTesouro?"Tesouro":(ehFII?"FII":"Ação"),
            freq: ehFII?"Mensal":"—",
            qtd:i.qtd||0, prov:0,
            precoMedio:i.precoMedio||0, cotacao:i.cotacao||i.precoMedio||0,
            meses: ehFII?[1,2,3,4,5,6,7,8,9,10,11,12]:[],
            setor:"Outros",
            dataCompra:i.dataCompra||null, ultimaCompra:i.ultimaCompra||null, movimentacoes:i.movimentacoes||[],
          };
        }
      });
      if (removerAusentes && ausentes.length) ausentes.forEach(a => { delete mapa[a.ticker]; });
      return Object.values(mapa);
    });
    if (modo==="arquivo" && itensArquivo) onVendidos(vendidosArquivo || []);
    // anexa a cada ativo o seu histórico de dividendos (campo proventosHist)
    if (proventosArquivo?.registros?.length) {
      setAtivos(prev => prev.map(a => {
        const regs = proventosArquivo.registros.filter(r => r.ticker === a.ticker);
        return regs.length ? { ...a, proventosHist: regs } : a;
      }));
    }
    if (proventosArquivo && proventosArquivo.total>0 && onProventosRecebidos) {
      onProventosRecebidos(proventosArquivo);
    }
    onClose();
  };

  return (
    <div onClick={onClose} className="modal-overlay" style={{ position:"fixed", inset:0, background:"#000b", zIndex:1100, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"16px 12px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} className="modal-content" style={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16, width:"100%", maxWidth:460, padding:"20px", boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:17, fontWeight:800, color:T.text }}>📋 Importar em massa</div>
          <button onClick={onClose} style={{ width:34,height:34,borderRadius:8,border:`1px solid ${T.border}`,background:T.cardAlt,color:T.text,cursor:"pointer",fontSize:16 }}>✕</button>
        </div>
        {/* abas de modo */}
        <div style={{ display:"flex", gap:6, marginBottom:14, background:T.cardAlt, borderRadius:10, padding:4 }}>
          <button onClick={()=>setModo("texto")} style={{ flex:1, padding:"9px", borderRadius:7, border:"none", cursor:"pointer", fontSize:12, fontWeight:700, background:modo==="texto"?T.accent:"transparent", color:modo==="texto"?"#fff":T.textMute }}>📋 Colar texto</button>
          <button onClick={()=>setModo("arquivo")} style={{ flex:1, padding:"9px", borderRadius:7, border:"none", cursor:"pointer", fontSize:12, fontWeight:700, background:modo==="arquivo"?T.green:"transparent", color:modo==="arquivo"?"#06281b":T.textMute }}>📁 Arquivo da B3</button>
        </div>

        {modo==="texto" && (<>
          <div style={{ fontSize:11, color:T.textMute, marginBottom:12, lineHeight:1.5 }}>
            Cole uma linha por ativo no formato <strong style={{ color:T.text }}>TICKER QTD PREÇO-MÉDIO</strong> (cotação é opcional). Ex: <span style={{ color:T.accentSoft }}>BBAS3 291 20,55</span>
          </div>
          <textarea value={texto} onChange={e=>setTexto(e.target.value)} rows={7}
            placeholder={"BBAS3 291 20,55\nMFII11 132 52,69 50,71\nPETR4 145 40,75"}
            style={{ width:"100%", background:T.cardAlt, border:`1px solid ${T.borderSoft}`, borderRadius:10, color:T.text, padding:"12px", fontSize:14, fontFamily:"monospace", resize:"vertical", outline:"none", marginBottom:12 }}/>
        </>)}

        {modo==="arquivo" && (<>
          <div style={{ fontSize:11, color:T.textMute, marginBottom:12, lineHeight:1.5 }}>
            Envie o extrato de <strong style={{ color:T.text }}>Movimentação</strong> da B3 (arquivo <strong style={{ color:T.text }}>.xlsx</strong>). O app calcula sozinho quantidades e preço médio a partir das suas compras e vendas.
            <br/><span style={{ color:T.textFaint }}>Baixe em investidor.b3.com.br → Extratos → Movimentação → Exportar para Excel.</span>
            <br/><span style={{ color:T.amber, fontWeight:600 }}>⚠️ Importante: no filtro da B3, escolha um período AMPLO (ex.: 01/01 do primeiro ano de investimento até hoje). A exportação traz apenas o período filtrado — se filtrar 30 dias, só virão 30 dias de compras e proventos.</span>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:"none" }} onChange={e=>{ lerArquivo(e.target.files?.[0]); e.target.value=""; }}/>
          <button onClick={()=>fileRef.current?.click()} style={{ display:"block", width:"100%", border:`2px dashed ${T.green}66`, borderRadius:12, padding:"22px 16px", textAlign:"center", cursor:"pointer", background:`${T.green}0c`, marginBottom:12 }}>
            <div style={{ fontSize:30, marginBottom:6 }}>{lendo?"⏳":"📁"}</div>
            <div style={{ fontSize:13, color:T.green, fontWeight:700 }}>{lendo?"Lendo planilha...":"Toque para escolher o arquivo"}</div>
            <div style={{ fontSize:10, color:T.textFaint, marginTop:4 }}>.xlsx da Movimentação da B3</div>
          </button>
          <div style={{ marginTop:4, marginBottom:12, paddingTop:12, borderTop:`1px dashed ${T.border}` }}>
            <div style={{ fontSize:12, color:T.text, fontWeight:800, marginBottom:4 }}>📑 Arquivo de EVENTOS da B3 (opcional)</div>
            <div style={{ fontSize:10, color:T.textFaint, lineHeight:1.5, marginBottom:8 }}>Traz os próximos pagamentos já anunciados. O app usa esses valores nos meses futuros; onde não houver anúncio, repete o último valor recebido.</div>
            <input ref={fileEvRef} type="file" accept=".xlsx,.xls,.csv" style={{ display:"none" }} onChange={e=>{ lerArquivoEventos(e.target.files?.[0]); e.target.value=""; }}/>
            <button onClick={()=>fileEvRef.current?.click()} style={{ display:"block", width:"100%", border:`2px dashed ${T.cyan}66`, borderRadius:12, padding:"14px 16px", textAlign:"center", cursor:"pointer", background:`${T.cyan}0c` }}>
              <div style={{ fontSize:13, color:T.cyan, fontWeight:700 }}>{lendoEventos ? "Lendo eventos..." : "📑 Escolher arquivo de eventos"}</div>
            </button>
            {erroEventos && <div style={{ marginTop:8, fontSize:11, color:T.red }}>⚠️ {erroEventos}</div>}
            {eventosInfo && (
              <div style={{ marginTop:8, padding:"9px 11px", borderRadius:9, background:`${T.cyan}12`, border:`1px solid ${T.cyan}44`, fontSize:10, color:T.text, lineHeight:1.6 }}>
                ✅ {eventosInfo.total} evento(s) importado(s) de <strong>{eventosInfo.nome}</strong>{eventosInfo.ignoradas ? ` · ${eventosInfo.ignoradas} linha(s) ignorada(s)` : ""}.
                <div style={{ color:T.textMute, marginTop:4 }}>Colunas detectadas: {Object.entries(eventosInfo.colunas).filter(([,v])=>v).map(([k,v])=>`${k} = "${v}"`).join(" · ") || "nenhuma"}</div>
              </div>
            )}
          </div>
          {erroArquivo && (
            <div style={{ background:`${T.red}12`, border:`1px solid ${T.red}44`, borderRadius:8, padding:"10px 12px", marginBottom:12, fontSize:11, color:T.red }}>⚠️ {erroArquivo}</div>
          )}
          {infoArquivo && (
            <div style={{ background:`${T.green}10`, border:`1px solid ${T.green}33`, borderRadius:8, padding:"10px 12px", marginBottom:12, fontSize:11, color:T.textDim }}>
              ✓ <strong style={{ color:T.green }}>{infoArquivo.nome}</strong><br/>
              <span style={{ fontSize:10, color:T.textFaint }}>Aba "{infoArquivo.aba}" · {infoArquivo.lidas} movimentos processados · {infoArquivo.total} ativos com posição</span>
            </div>
          )}
        </>)}

        {/* prévia */}
        {((modo==="texto" && texto.trim()) || (modo==="arquivo" && itensArquivo)) && (
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", gap:8, marginBottom:8, flexWrap:"wrap" }}>
              <span style={{ fontSize:10, color:T.green, background:`${T.green}14`, border:`1px solid ${T.green}44`, borderRadius:6, padding:"3px 8px", fontWeight:700 }}>{atualizados.length} atualiza</span>
              <span style={{ fontSize:10, color:T.cyan, background:`${T.cyan}14`, border:`1px solid ${T.cyan}44`, borderRadius:6, padding:"3px 8px", fontWeight:700 }}>{novos.length} novo{novos.length!==1?"s":""}</span>
              {erros.length>0 && <span style={{ fontSize:10, color:T.red, background:`${T.red}14`, border:`1px solid ${T.red}44`, borderRadius:6, padding:"3px 8px", fontWeight:700 }}>{erros.length} não lido{erros.length!==1?"s":""}</span>}
            </div>
            <div style={{ maxHeight:160, overflowY:"auto", background:T.cardAlt, borderRadius:8, padding:"8px" }}>
              {validos.map((i,idx)=>{
                const ex = porTicker[i.ticker];
                return (
                  <div key={idx} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 6px", borderBottom:`1px solid ${T.border}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ fontSize:10, color: ex?T.green:T.cyan }}>{ex?"↻":"+"}</span>
                      <span style={{ fontSize:12, fontWeight:700, color:T.text }}>{i.ticker}</span>
                    </div>
                    <span style={{ fontSize:10, color:T.textMute }}>
                      {i.qtd!=null?`${i.qtd} cotas`:""}{i.precoMedio!=null?` · PM ${fmt(i.precoMedio)}`:""}{i.cotacao!=null?` · cot ${fmt(i.cotacao)}`:""}
                    </span>
                  </div>
                );
              })}
              {erros.map((e,idx)=>(
                <div key={"e"+idx} style={{ fontSize:10, color:T.red, padding:"4px 6px" }}>⚠️ não reconhecido: "{e.raw}"</div>
              ))}
            </div>
            {ausentes.length > 0 && (
              <div style={{ marginTop:10, padding:"10px 12px", borderRadius:10, background:`${T.amber}12`, border:`1px solid ${T.amber}55` }}>
                <label style={{ display:"flex", alignItems:"flex-start", gap:8, cursor:"pointer" }}>
                  <input type="checkbox" checked={removerAusentes} onChange={e=>setRemoverAusentes(e.target.checked)} style={{ marginTop:2, width:18, height:18, accentColor:T.accent }}/>
                  <span style={{ fontSize:11.5, color:T.text, lineHeight:1.45 }}>
                    <strong>Remover {ausentes.length} ativo(s) que você não tem mais</strong> (vendidos, resgatados, vencidos ou direitos de subscrição):
                    <span style={{ display:"block", marginTop:4, color:T.textDim }}>{ausentes.map(a=>a.nome && a.nome!==a.ticker ? `${a.ticker} (${a.nome})` : a.ticker).join(" · ")}</span>
                    <span style={{ display:"block", marginTop:4, fontSize:10, color:T.textFaint }}>Os proventos que eles já pagaram e os que ainda vão pagar (arquivo de eventos) continuam contando.</span>
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:"12px", borderRadius:10, border:`1px solid ${T.borderSoft}`, background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:13, fontWeight:600 }}>Cancelar</button>
          <button onClick={aplicar} disabled={validos.length===0} style={{ flex:1, padding:"12px", borderRadius:10, border:"none", background:validos.length>0?T.green:T.border, color:validos.length>0?"#06281b":T.textFaint, cursor:validos.length>0?"pointer":"default", fontSize:13, fontWeight:700 }}>
            ✓ Aplicar ({validos.length})
          </button>
        </div>
        <div style={{ marginTop:10, fontSize:9, color:T.textFaint, textAlign:"center", lineHeight:1.6 }}>
          {modo==="arquivo"
            ? "O preço médio é calculado das suas compras (média ponderada). Proventos da B3 não entram como quantidade. Ativos zerados (vendidos) saem da lista, mas os proventos deles continuam nos cálculos. Novos ativos entram com proventos a preencher."
            : "Ativos existentes têm quantidade e preço atualizados. Novos ativos entram com proventos zerados — preencha depois. Nada é apagado automaticamente."}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EDITOR GLOBAL DE ATIVO — popup que pode ser aberto de qualquer lugar do app
// ════════════════════════════════════════════════════════════════════════════
let _editorListener = null;
// chame de qualquer lugar: abrirEditorAtivo("BBAS3") edita, abrirEditorAtivo(null) cria novo
function abrirEditorAtivo(ticker) { if (_editorListener) _editorListener(ticker === undefined ? null : ticker); }
function registrarEditorAtivo(fn) { _editorListener = fn; return () => { if (_editorListener === fn) _editorListener = null; }; }

const CATS_EDIT = ["FII","Ação","ETF","Cripto","Tesouro"];
const FREQS_EDIT = ["Mensal","Bimestral","Trimestral","Semestral","Anual","—"];
const MESES_CURTOS = ["J","F","M","A","M","J","J","A","S","O","N","D"];

// ════════════════════════════════════════════════════════════════════════════
// PROVENTOS POR ATIVO — últimos 12 meses e último valor líquido por cota
// ════════════════════════════════════════════════════════════════════════════
// Últimos 12 meses (inclui o mês atual) do histórico de proventos de UM ativo.
// Compara datas como texto "AAAA-MM-DD", sem depender de fuso horário.
function proventosUltimos12Meses(hist = []) {
  const hoje = new Date();
  const meses = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - k, 1);
    meses.push({
      chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      rotulo: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
    });
  }
  const inicio = `${meses[0].chave}-01`;
  const lista = (hist || [])
    .filter(r => r && (r.data || "") >= inicio)
    .sort((a, b) => (a.data < b.data ? 1 : -1));
  const porMes = {};
  lista.forEach(r => {
    const k = (r.data || "").slice(0, 7);
    const acc = porMes[k] || { liquido: 0, bruto: 0 };
    acc.liquido += Number(r.valor) || 0;
    acc.bruto += Number(r.bruto ?? r.valor) || 0;
    porMes[k] = acc;
  });
  const dados = meses.map(m => ({
    mes: m.rotulo,
    liquido: +((porMes[m.chave] ? porMes[m.chave].liquido : 0)).toFixed(2),
    bruto: +((porMes[m.chave] ? porMes[m.chave].bruto : 0)).toFixed(2),
  }));
  return {
    dados,
    lista,
    totalLiquido: +dados.reduce((soma, d) => soma + d.liquido, 0).toFixed(2),
    totalBruto: +dados.reduce((soma, d) => soma + d.bruto, 0).toFixed(2),
  };
}

// Último provento recebido POR COTA, líquido (valor creditado ÷ quantidade).
// Ignora amortização: é devolução de capital, não provento recorrente.
function ultimoProventoPorCota(hist = []) {
  const validos = (hist || [])
    .filter(r => r && r.qtd > 0 && r.valor > 0 && !/amortiz/i.test(r.tipo || ""))
    .sort((a, b) => (a.data < b.data ? 1 : -1));
  if (!validos.length) return null;
  const r = validos[0];
  return { porCota: +(r.valor / r.qtd).toFixed(4), data: r.data, tipo: r.tipo };
}

// ════════════════════════════════════════════════════════════════════════════
// HISTÓRICO DE COTAÇÃO DO ATIVO — Yahoo Finance (gráfico diário/semanal, sem token)
// No celular a busca é nativa (CapacitorHttp, sem bloqueio de CORS). Reserva: servidor do PC (/historico).
// Cada ativo guarda o último gráfico baixado de cada filtro (abre na hora e funciona sem internet).
// ════════════════════════════════════════════════════════════════════════════
const FAIXAS_COTACAO = [
  { id:"5d",  rotulo:"5D",  range:"5d",  interval:"30m", validadeMin: 15 },
  { id:"1mo", rotulo:"1M",  range:"1mo", interval:"1d",  validadeMin: 360 },
  { id:"1y",  rotulo:"1A",  range:"1y",  interval:"1d",  validadeMin: 720 },
  { id:"5y",  rotulo:"5A",  range:"5y",  interval:"1wk", validadeMin: 1440 },
  { id:"max", rotulo:"Máx", range:"max", interval:"1wk", validadeMin: 1440 },
];
// código da B3 → símbolo do Yahoo (PETR4 → PETR4.SA). Tesouro, CDB, LCI etc. não têm cotação em bolsa.
function simboloYahoo(ticker) {
  const t = String(ticker || "").toUpperCase().trim().replace(/F$/, "");
  return /^[A-Z]{4}\d{1,2}$/.test(t) ? `${t}.SA` : null;
}
function lerGraficoYahoo(json) {
  const res = json && json.chart && json.chart.result && json.chart.result[0];
  if (!res) throw new Error((json && json.chart && json.chart.error && json.chart.error.description) || "resposta sem dados");
  const ts = res.timestamp || [];
  const fech = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const pontos = [];
  ts.forEach((t, i) => { const c = fech[i]; if (c != null && isFinite(c) && c > 0) pontos.push([t, +(+c).toFixed(2)]); });
  const meta = res.meta || {};
  return { pontos, moeda: meta.currency || "BRL", fuso: isFinite(meta.gmtoffset) ? meta.gmtoffset : -10800, atual: meta.regularMarketPrice ?? null };
}
async function buscarHistoricoCotacao(ticker, faixa, bridgeUrl) {
  const sym = simboloYahoo(ticker);
  if (!sym) throw new Error("este ativo não é negociado em bolsa");
  const f = FAIXAS_COTACAO.find(x => x.id === faixa) || FAIXAS_COTACAO[2];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${f.range}&interval=${f.interval}`;
  const falhas = [];
  if (Capacitor.isNativePlatform()) {
    try {
      const r = await CapacitorHttp.get({ url, connectTimeout: 12000, readTimeout: 20000,
        headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36", "Accept": "application/json" } });
      if (r.status === 200) return lerGraficoYahoo(typeof r.data === "string" ? JSON.parse(r.data) : r.data);
      falhas.push(`Yahoo HTTP ${r.status}`);
    } catch (e) { falhas.push(`Yahoo: ${e.message}`); }
  }
  if (bridgeUrl) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(`${bridgeUrl}/historico?ticker=${encodeURIComponent(sym)}&range=${f.range}&interval=${f.interval}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) { const d = await r.json(); if (d && d.ok) return lerGraficoYahoo(d.data); falhas.push(`servidor: ${(d && d.erro) || "sem dados"}`); }
      else falhas.push(`servidor HTTP ${r.status}${r.status === 404 ? " (rota /historico não instalada)" : ""}`);
    } catch (e) { falhas.push(`servidor: ${e.name === "AbortError" ? "tempo esgotado" : e.message}`); }
  }
  throw new Error(falhas.join(" · ") || "sem fonte disponível");
}
// data/hora no fuso da B3 (o timestamp vem em UTC)
function dataCotacao(t, fuso, comHora) {
  const d = new Date((t + fuso) * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0"), aa = d.getUTCFullYear();
  const base = `${dd}/${mm}/${aa}`;
  return comHora ? `${base} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : base;
}

function GraficoCotacao({ ativo, bridgeUrl, T }) {
  const sym = simboloYahoo(ativo && ativo.ticker);
  const [faixa, setFaixa] = useState("1y");
  const chave = `cotHist_${ativo && ativo.ticker}_${faixa}`;
  const [dados, setDados] = useState(() => lerSalvo(chave, null));
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [sel, setSel] = useState(null);
  const caixa = useRef(null);
  const [larg, setLarg] = useState(320);
  const ALT = 190, PAD_T = 14, PAD_B = 22;

  useLayoutEffect(() => {
    const el = caixa.current; if (!el) return;
    const medir = () => setLarg(el.clientWidth || 320);
    medir();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(medir); ro.observe(el); }
    return () => { if (ro) ro.disconnect(); };
  }, []);

  const carregar = async (forcar = false) => {
    if (!sym) return;
    const guardado = lerSalvo(chave, null);
    setDados(guardado); setSel(null); setErro(null);
    const f = FAIXAS_COTACAO.find(x => x.id === faixa);
    const fresco = guardado && (Date.now() - guardado.em) < f.validadeMin * 60000;
    if (fresco && !forcar) return;
    setCarregando(true);
    try {
      const d = await buscarHistoricoCotacao(ativo.ticker, faixa, bridgeUrl);
      const novo = { ...d, em: Date.now() };
      setDados(novo);
      gravarSalvo(chave, novo);
      registrarLog("cotacao", `Histórico ${ativo.ticker} (${faixa}): ${d.pontos.length} pontos`, { direcao:"volta", origem:"api" });
    } catch (e) {
      setErro(e.message);
      registrarLog("erro", `Histórico ${ativo.ticker} (${faixa}) falhou: ${e.message}`, { direcao:"volta", origem:"api" });
    } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(false); /* eslint-disable-next-line */ }, [faixa, ativo && ativo.ticker]);

  const chip = (on) => ({ flex:1, padding:"7px 0", borderRadius:9, cursor:"pointer", fontSize:12, fontWeight:700,
    border: on ? "none" : `1px solid ${T.border}`, background: on ? T.accent : T.cardAlt, color: on ? "#fff" : T.textDim });

  const pts = (dados && dados.pontos) || [];
  const fuso = dados ? dados.fuso : -10800;
  const comHora = faixa === "5d";
  let corpo = null;
  if (pts.length >= 2) {
    const vals = pts.map(p => p[1]);
    let min = Math.min(...vals), max = Math.max(...vals);
    const pm = +ativo.precoMedio > 0 ? +ativo.precoMedio : null;
    const pmNaFaixa = pm && pm >= min * 0.85 && pm <= max * 1.15;
    if (pmNaFaixa) { min = Math.min(min, pm); max = Math.max(max, pm); }
    const folga = (max - min) * 0.08 || max * 0.02 || 1;
    min -= folga; max += folga;
    const W = Math.max(larg, 200);
    const X = (i) => (i / (pts.length - 1)) * (W - 2) + 1;
    const Y = (v) => PAD_T + (1 - (v - min) / (max - min)) * (ALT - PAD_T - PAD_B);
    const linha = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(" ");
    const primeiro = pts[0][1], ultimo = pts[pts.length - 1][1];
    const sobe = ultimo >= primeiro;
    const cor = sobe ? T.green : T.red;
    const iSel = sel == null ? null : Math.max(0, Math.min(pts.length - 1, sel));
    const pSel = iSel == null ? pts[pts.length - 1] : pts[iSel];
    const varSel = ((pSel[1] - primeiro) / primeiro) * 100;
    const indice = (clientX) => {
      const r = caixa.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, clientX - r.left));
      return Math.round((x / r.width) * (pts.length - 1));
    };
    const mover = (e) => setSel(indice(e.clientX));
    const xs = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
    const tipX = iSel == null ? null : X(iSel);
    corpo = (<>
      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:8, flexWrap:"wrap", marginBottom:6 }}>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:22, fontWeight:800, color:T.text, lineHeight:1.1 }}>{fmt(pSel[1])}</div>
          <div style={{ fontSize:11, color:T.textMute, marginTop:2 }}>{iSel == null ? `último · ${dataCotacao(pSel[0], fuso, comHora)}` : dataCotacao(pSel[0], fuso, comHora)}</div>
        </div>
        <span style={{ fontSize:13, fontWeight:800, color: varSel >= 0 ? T.green : T.red, background: varSel >= 0 ? `${T.green}14` : `${T.red}14`, borderRadius:20, padding:"3px 9px" }}>
          {varSel >= 0 ? "▲ +" : "▼ −"}{pctBR(Math.abs(varSel))}% <span style={{ fontWeight:500, color:T.textMute }}>{iSel == null ? "no período" : "do início até aqui"}</span>
        </span>
      </div>
      <div ref={caixa} style={{ position:"relative", height:ALT, touchAction:"pan-y", userSelect:"none", WebkitUserSelect:"none", cursor:"crosshair" }}
        onPointerDown={mover} onPointerMove={(e)=>{ if (e.pointerType === "mouse" || e.buttons || e.pressure > 0) mover(e); }}
        onPointerLeave={(e)=>{ if (e.pointerType === "mouse") setSel(null); }}>
        <svg width={W} height={ALT} style={{ display:"block" }} aria-label={`Gráfico de cotação de ${ativo.ticker}`}>
          <defs>
            <linearGradient id={`gc_${ativo.ticker}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cor} stopOpacity="0.28"/><stop offset="100%" stopColor={cor} stopOpacity="0"/>
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map(k => <line key={k} x1="0" x2={W} y1={PAD_T + k * (ALT - PAD_T - PAD_B)} y2={PAD_T + k * (ALT - PAD_T - PAD_B)} stroke={T.border} strokeWidth="1"/>)}
          <path d={`${linha} L${X(pts.length - 1).toFixed(1)} ${ALT - PAD_B} L${X(0).toFixed(1)} ${ALT - PAD_B} Z`} fill={`url(#gc_${ativo.ticker})`}/>
          <path d={linha} fill="none" stroke={cor} strokeWidth="2" strokeLinejoin="round"/>
          {pmNaFaixa && (<>
            <line x1="0" x2={W} y1={Y(pm)} y2={Y(pm)} stroke={T.amber} strokeWidth="1.2" strokeDasharray="5 4"/>
            <text x={W - 4} y={Y(pm) - 4} textAnchor="end" fontSize="10" fill={T.amber} fontWeight="700">PM {fmt(pm)}</text>
          </>)}
          <text x="2" y={PAD_T - 3} fontSize="10" fill={T.textFaint}>{fmt(max - folga)}</text>
          <text x="2" y={ALT - PAD_B - 4} fontSize="10" fill={T.textFaint}>{fmt(min + folga)}</text>
          {xs.map((i, k) => (
            <text key={k} x={X(i)} y={ALT - 6} fontSize="10" fill={T.textFaint} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}>{dataCotacao(pts[i][0], fuso, false).slice(0, comHora ? 5 : 10)}</text>
          ))}
          {tipX != null && (<>
            <line x1={tipX} x2={tipX} y1={PAD_T - 6} y2={ALT - PAD_B} stroke={T.text} strokeOpacity="0.35" strokeWidth="1"/>
            <circle cx={tipX} cy={Y(pSel[1])} r="5" fill={cor} stroke={T.card} strokeWidth="2"/>
          </>)}
        </svg>
        {tipX != null && (
          <div style={{ position:"absolute", top:0, left: Math.min(Math.max(tipX - 60, 0), W - 120), width:120, pointerEvents:"none",
            background:T.text, color:T.card, borderRadius:8, padding:"4px 6px", fontSize:10.5, textAlign:"center", lineHeight:1.3, boxShadow:"0 4px 12px #0003" }}>
            <strong>{fmt(pSel[1])}</strong><br/>{dataCotacao(pSel[0], fuso, comHora)}
          </div>
        )}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.textFaint, marginTop:4, gap:8, flexWrap:"wrap" }}>
        <span>Mín {fmt(Math.min(...vals))} · Máx {fmt(Math.max(...vals))}</span>
        <span>{iSel != null ? <button onClick={()=>setSel(null)} style={{ background:"none", border:"none", padding:0, color:T.accent, cursor:"pointer", fontSize:10, fontWeight:700 }}>limpar seleção</button> : "arraste o dedo no gráfico"}</span>
      </div>
    </>);
  }

  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:16, padding:"12px 12px 10px", margin:"0 0 14px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:10 }}>
        <span style={{ fontSize:13, fontWeight:800, color:T.text }}>📈 Cotação de {ativo.ticker}</span>
        {sym && <button onClick={()=>carregar(true)} disabled={carregando} title="Atualizar agora" style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:8, padding:"4px 8px", cursor:"pointer", fontSize:11, color:T.textDim }}>{carregando ? "⏳" : "↻"}</button>}
      </div>
      {!sym ? (
        <div style={{ fontSize:11.5, color:T.textMute, lineHeight:1.5 }}>Este ativo não é negociado em bolsa (Tesouro, CDB, LCI…), então não há cotação diária para mostrar.</div>
      ) : (<>
        <div style={{ display:"flex", gap:5, marginBottom:12 }}>
          {FAIXAS_COTACAO.map(f => <button key={f.id} onClick={()=>setFaixa(f.id)} style={chip(faixa === f.id)}>{f.rotulo}</button>)}
        </div>
        {corpo || (
          <div style={{ height:ALT, display:"flex", alignItems:"center", justifyContent:"center", textAlign:"center", fontSize:12, color: erro ? T.red : T.textMute, padding:"0 10px", lineHeight:1.5 }}>
            {carregando ? "Buscando histórico…" : erro ? `Não consegui baixar o histórico. ${erro}` : "Sem dados para este período."}
          </div>
        )}
        {erro && pts.length >= 2 && <div style={{ fontSize:10, color:T.amber, marginTop:6 }}>Sem conexão agora: mostrando o gráfico salvo em {new Date(dados.em).toLocaleString("pt-BR")}.</div>}
        {!erro && dados && dados.em && <div style={{ fontSize:9.5, color:T.textFaint, marginTop:6 }}>Fonte: Yahoo Finance · atualizado {new Date(dados.em).toLocaleString("pt-BR")}</div>}
      </>)}
    </div>
  );
}

function EditarAtivoPopup({ ticker, ativos, setAtivos, onClose, eventos = [], bridgeUrl = "", T }) {
  const existente = ticker ? ativos.find(a=>a.ticker===ticker) : null;
  const novo = !existente;
  const [f, setF] = useState(() => existente ? { ...existente } : {
    ticker:"", nome:"", cat:"Ação", setor:"Outros", qtd:"", precoMedio:"", cotacao:"", prov:"", freq:"—", meses:[],
  });
  const set = (campo,val) => setF(p=>({ ...p, [campo]:val }));
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);
  const [janelaP, setJanelaP] = useState("ano");
  const [anoP, setAnoP] = useState(() => new Date().getFullYear());
  const confirmarExclusao = () => {
    if (!existente) return;
    registrarLog("edicao", `Ativo excluído: ${existente.ticker}`, { direcao:"interno", origem:"app" });
    setAtivos(prev => prev.filter(a => a.ticker !== ticker));
    setConfirmaExcluir(false);
    onClose();
  };
  const toggleMes = (m) => setF(p=>({ ...p, meses: p.meses.includes(m) ? p.meses.filter(x=>x!==m) : [...p.meses, m].sort((a,b)=>a-b) }));

  const tickerLimpo = String(f.ticker||"").toUpperCase().trim();
  const duplicado = novo && tickerLimpo && ativos.some(a=>a.ticker===tickerLimpo);
  const podeSalvar = tickerLimpo.length>=2 && !duplicado;

  const salvar = () => {
    if (!podeSalvar) return;
    const limpo = {
      ...f, ticker:tickerLimpo, nome: f.nome||tickerLimpo,
      qtd:+f.qtd||0, precoMedio:+f.precoMedio||0, cotacao:+f.cotacao|| +f.precoMedio||0, prov:+f.prov||0,
      meses: f.meses||[],
    };
    if (novo) {
      registrarLog("edicao", `Novo ativo adicionado: ${limpo.ticker} (${limpo.qtd} cotas)`, { direcao:"interno", origem:"app", detalhe:limpo });
      setAtivos(prev => [...prev, limpo]);
    } else {
      registrarLog("edicao", `Ativo editado: ${limpo.ticker}`, { direcao:"interno", origem:"app", detalhe:limpo });
      setAtivos(prev => prev.map(a=>a.ticker===ticker ? limpo : a));
    }
    onClose();
  };
  const excluir = () => { if (existente) setConfirmaExcluir(true); };

  // Campo definido UMA vez: não é recriado a cada tecla (isso fazia o cursor/foco pular)
  const Campo = useMemo(() => function CampoForm({ label, children }) {
    return (
      <div style={{ marginBottom:13 }}>
        <div style={{ fontSize:10, color:T.textMute, fontWeight:600, marginBottom:5, textTransform:"uppercase", letterSpacing:0.5 }}>{label}</div>
        {children}
      </div>
    );
  }, [T]);
  const inputStyle = { width:"100%", background:T.cardAlt, border:`1px solid ${T.borderSoft}`, borderRadius:9, color:T.text, padding:"10px 12px", fontSize:14, outline:"none" };

  return (
    <div onClick={onClose} className="modal-overlay" style={{ position:"fixed", inset:0, background:"#000b", zIndex:1400, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"14px 12px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} className="modal-content" style={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16, width:"100%", maxWidth:440, padding:"20px", boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontSize:17, fontWeight:800, color:T.text }}>{novo ? "➕ Adicionar ativo" : `✏️ Editar ${existente.ticker}`}</div>
          <div style={{ display:"flex", gap:8 }}>
            {!novo && <button onClick={()=>setConfirmaExcluir(true)} title="Excluir ativo da carteira" style={{ width:34,height:34,borderRadius:8,border:`1px solid ${T.red}88`,background:`${T.red}18`,color:T.red,cursor:"pointer",fontSize:16,fontWeight:800 }}>✕</button>}
            <button onClick={onClose} title="Fechar" style={{ width:34,height:34,borderRadius:8,border:`1px solid ${T.border}`,background:T.cardAlt,color:T.text,cursor:"pointer",fontSize:16 }}>✕</button>
          </div>
          {confirmaExcluir && (
            <div onClick={(e)=>{ e.stopPropagation(); setConfirmaExcluir(false); }} style={{ position:"fixed", inset:0, background:"#000c", zIndex:1700, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
              <div onClick={e=>e.stopPropagation()} style={{ background:T.bg, border:`1px solid ${T.red}66`, borderRadius:14, padding:18, maxWidth:320, width:"100%", textAlign:"center" }}>
                <div style={{ fontSize:26, marginBottom:6 }}>🗑️</div>
                <div style={{ fontSize:14, fontWeight:800, color:T.text, marginBottom:6 }}>Excluir {existente?.ticker}?</div>
                <div style={{ fontSize:11, color:T.textMute, lineHeight:1.5, marginBottom:14 }}>O ativo sai da carteira e dos cálculos de proventos. Você pode adicioná-lo de novo depois.</div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={()=>setConfirmaExcluir(false)} style={{ flex:1, padding:"11px", borderRadius:9, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontWeight:700 }}>Cancelar</button>
                  <button onClick={confirmarExclusao} style={{ flex:1, padding:"11px", borderRadius:9, border:"none", background:T.red, color:"#fff", cursor:"pointer", fontWeight:800 }}>Excluir</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <div style={{ flex:1 }}>
            <Campo label="Ticker">
              <input value={f.ticker} list="catalogoAtivos" onChange={e=>{
                  const v = e.target.value.toUpperCase();
                  const hit = novo ? CATALOGO_ATIVOS.find(c=>c.t===v) : null;
                  if (hit) setF(p=>({ ...p, ticker:v, nome:hit.n, cat:hit.c, setor:hit.s, freq:hit.f||"—",
                    meses: hit.c==="FII" ? [1,2,3,4,5,6,7,8,9,10,11,12] : (hit.f==="Trimestral" ? [3,6,9,12] : p.meses) }));
                  else set("ticker", v);
                }} disabled={!novo}
                placeholder="Digite ou escolha…" style={{ ...inputStyle, fontWeight:700, opacity:novo?1:0.6, fontFamily:"monospace" }}/>
              {novo && <datalist id="catalogoAtivos">{CATALOGO_ATIVOS.map(c=><option key={c.t} value={c.t}>{c.n} · {c.c}</option>)}</datalist>}
            </Campo>
          </div>
          <div style={{ flex:1.4 }}>
            <Campo label="Nome"><input value={f.nome} onChange={e=>set("nome",e.target.value)} placeholder="Banco do Brasil" style={inputStyle}/></Campo>
          </div>
        </div>
        {duplicado && <div style={{ fontSize:10, color:T.red, marginTop:-6, marginBottom:10 }}>⚠️ Já existe um ativo com esse ticker.</div>}

        <Campo label="Categoria">
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {CATS_EDIT.map(c=>(
              <button key={c} onClick={()=>set("cat",c)} style={{ padding:"7px 12px", borderRadius:8, border:`1px solid ${f.cat===c?T.accent:T.border}`, background:f.cat===c?T.accent:"transparent", color:f.cat===c?"#fff":T.textMute, cursor:"pointer", fontSize:11, fontWeight:700 }}>{c}</button>
            ))}
          </div>
        </Campo>

        <div style={{ display:"flex", gap:10 }}>
          <div style={{ flex:1 }}><Campo label="Quantidade"><input type="text" inputMode="decimal" value={f.qtd} onChange={e=>set("qtd",e.target.value.replace(",", "."))} placeholder="ex.: 10" style={inputStyle}/></Campo></div>
          <div style={{ flex:1 }}><Campo label="Setor"><input value={f.setor} onChange={e=>set("setor",e.target.value)} placeholder="Bancos" style={inputStyle}/></Campo></div>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <div style={{ flex:1 }}><Campo label="Preço médio (R$)"><input type="text" inputMode="decimal" value={f.precoMedio} onChange={e=>set("precoMedio",e.target.value.replace(",", "."))} placeholder="ex.: 25.50" style={inputStyle}/></Campo></div>
          <div style={{ flex:1 }}><Campo label="Cotação (R$)"><input type="text" inputMode="decimal" value={f.cotacao} onChange={e=>set("cotacao",e.target.value.replace(",", "."))} placeholder="ex.: 27.10" style={inputStyle}/></Campo></div>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <div style={{ flex:1 }}><Campo label="Provento / cota (R$)"><input type="text" inputMode="decimal" value={f.prov} onChange={e=>set("prov",e.target.value.replace(",", "."))} placeholder="ex.: 0.50" style={inputStyle}/></Campo></div>
          <div style={{ flex:1 }}>
            <Campo label="Frequência">
              <select value={f.freq} onChange={e=>set("freq",e.target.value)} style={{ ...inputStyle, appearance:"auto" }}>
                {FREQS_EDIT.map(fr=><option key={fr} value={fr}>{fr}</option>)}
              </select>
            </Campo>
          </div>
        </div>

        <Campo label="Meses que paga proventos">
          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
            {MESES_CURTOS.map((nome,i)=>{
              const m=i+1; const on=f.meses.includes(m);
              return <button key={i} onClick={()=>toggleMes(m)} style={{ width:34, height:34, borderRadius:8, border:`1px solid ${on?T.green:T.border}`, background:on?T.green:"transparent", color:on?"#06281b":T.textMute, cursor:"pointer", fontSize:12, fontWeight:700 }}>{nome}</button>;
            })}
          </div>
        </Campo>

        {/* preview do valor */}
        <div style={{ background:T.cardAlt, borderRadius:10, padding:"10px 12px", margin:"4px 0 14px", display:"flex", justifyContent:"space-between", fontSize:12 }}>
          <span style={{ color:T.textMute }}>Posição</span>
          <span style={{ color:T.text, fontWeight:700 }}>{fmt((+f.qtd||0)*(+f.cotacao|| +f.precoMedio||0))} · {fmt((+f.prov||0)*(+f.qtd||0)*(f.meses?.length||0))}/ano</span>
        </div>

        {/* ── COTAÇÃO DESTE ATIVO: histórico com filtros e toque para ver dia e preço ── */}
        {!novo && existente && <GraficoCotacao ativo={existente} bridgeUrl={bridgeUrl} T={T}/>}

        {/* ── DIVIDENDOS DESTE ATIVO: já recebido + previsto, com filtros ── */}
        {!novo && existente?.proventosHist?.length > 0 && (() => {
          const j = janelaProventos(janelaP, anoP, existente.proventosHist, [existente]);
          const serie = serieProventos({ ativos:[existente], registros:existente.proventosHist, eventos:(eventos||[]).filter(e=>e.ticker===existente.ticker), inicio:j.inicio, fim:j.fim });
          const recebido = +serie.reduce((soma,l)=>soma+l.real,0).toFixed(2);
          const previsto = +serie.reduce((soma,l)=>soma+l.previsto,0).toFixed(2);
          const lista = registrosValidos(existente.proventosHist, [existente])
            .filter(r => ymDe(r.data) >= j.inicio && ymDe(r.data) <= j.fim)
            .sort((a,b)=> (a.data<b.data?1:-1));
          const FILTROS = [["ano","Ano"],["12m","12 meses"],["2a","2 anos"],["tudo","Desde o começo"]];
          const btn = (ativo) => ({ padding:"5px 8px", borderRadius:7, border:`1px solid ${ativo?T.accent:T.border}`, background: ativo?`${T.accent}22`:T.cardAlt, color: ativo?T.accentSoft:T.textMute, cursor:"pointer", fontSize:10, fontWeight:700 });
          const dados = serie.map(l=>({ mes:l.rotulo, Recebido:l.real, Previsto:l.previsto }));
          return (
            <div style={{ margin:"0 0 14px" }}>
              <div style={{ fontSize:10, color:T.textMute, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>📈 Dividendos deste ativo</div>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:8, flexWrap:"wrap" }}>
                {janelaP==="ano" && (<>
                  <button onClick={()=>setAnoP(anoP-1)} style={btn(false)}>‹</button>
                  <span style={{ fontSize:12, fontWeight:800, color:T.text, minWidth:42, textAlign:"center" }}>{anoP}</span>
                  <button onClick={()=>setAnoP(anoP+1)} style={btn(false)}>›</button>
                </>)}
                <span style={{ flex:1 }}/>
                {FILTROS.map(([id,lb])=>(<button key={id} onClick={()=>setJanelaP(id)} style={btn(janelaP===id)}>{lb}</button>))}
              </div>
              <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                <div style={{ flex:1, background:`${T.green}12`, border:`1px solid ${T.green}44`, borderRadius:10, padding:"8px 10px" }}>
                  <div style={{ fontSize:9, color:T.textFaint }}>Já recebido (líquido)</div>
                  <div style={{ fontSize:14, fontWeight:800, color:T.green }}>{fmt(recebido)}</div>
                </div>
                <div style={{ flex:1, background:`${T.cyan}12`, border:`1px solid ${T.cyan}44`, borderRadius:10, padding:"8px 10px" }}>
                  <div style={{ fontSize:9, color:T.textFaint }}>Previsto (meses em aberto)</div>
                  <div style={{ fontSize:14, fontWeight:800, color:T.cyan }}>{fmt(previsto)}</div>
                </div>
              </div>
              <div style={{ background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:12, padding:"10px 8px 6px", marginBottom:8 }}>
                <div style={{ width:"100%", height:140 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dados} margin={{ top:4, right:6, left:0, bottom:0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false}/>
                      <XAxis dataKey="mes" tick={{ fontSize:8, fill:T.textMute }} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
                      <YAxis tick={{ fontSize:8, fill:T.textMute }} axisLine={false} tickLine={false} width={40} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(1)}k`:`${Math.round(v)}`}/>
                      <Tooltip formatter={(v)=>fmt(v)} contentStyle={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:8, fontSize:12 }} cursor={{ fill:`${T.accent}11` }}/>
                      <Bar dataKey="Recebido" stackId="p" fill={T.green}/>
                      <Bar dataKey="Previsto" stackId="p" fill={T.cyan} fillOpacity={0.5} radius={[3,3,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {lista.length>0 ? (
                <div style={{ maxHeight:150, overflowY:"auto", border:`1px solid ${T.border}`, borderRadius:10 }}>
                  {lista.map((r,i)=>(
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", borderBottom: i<lista.length-1?`1px solid ${T.border}`:"none", fontSize:10 }}>
                      <span style={{ color:T.textFaint, minWidth:62 }}>{(r.data||"").split("-").reverse().join("/")}</span>
                      <span style={{ flex:1, minWidth:0, color:T.textMute, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.tipo}{r.qtd && r.unit ? ` · ${r.qtd}×${fmt(r.unit)}` : ""}</span>
                      <span style={{ fontWeight:800, color:T.green }}>{fmt(r.valor)}</span>
                    </div>
                  ))}
                </div>
              ) : (<div style={{ fontSize:10, color:T.textFaint }}>Nenhum provento recebido neste período.</div>)}
              {existente.proventosHist.some(r=>r.imposto>0) && (<div style={{ fontSize:9, color:T.amber, marginTop:5 }}>⚖️ JCP exibido líquido (IR retido na fonte já descontado).</div>)}
            </div>
          );
        })()}
        {!novo && (!existente?.proventosHist || existente.proventosHist.length===0) && (
          <div style={{ fontSize:9, color:T.textFaint, margin:"0 0 14px", lineHeight:1.5 }}>
            💡 Importe a planilha de Movimentação da B3 (✏️ Editar → Importar) para carregar o histórico de dividendos deste ativo.
          </div>
        )}

        <div style={{ display:"flex", gap:8 }}>
          {!novo && <button onClick={excluir} style={{ padding:"12px 14px", borderRadius:10, border:`1px solid ${T.red}44`, background:`${T.red}10`, color:T.red, cursor:"pointer", fontSize:13, fontWeight:700 }}>🗑️</button>}
          <button onClick={onClose} style={{ flex:1, padding:"12px", borderRadius:10, border:`1px solid ${T.borderSoft}`, background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:13, fontWeight:600 }}>Cancelar</button>
          <button onClick={salvar} disabled={!podeSalvar} style={{ flex:1.4, padding:"12px", borderRadius:10, border:"none", background:podeSalvar?T.green:T.border, color:podeSalvar?"#06281b":T.textFaint, cursor:podeSalvar?"pointer":"default", fontSize:13, fontWeight:700 }}>{novo?"➕ Adicionar":"✓ Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

function EditarAtivos({ ativos, setAtivos, bridgeUrl, onProventosRecebidos = () => {}, onEventosB3 = () => {}, onVendidos = () => {}, T }) {
  const [filtroCat, setFiltroCat] = useState("TODOS");
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState({}); // grupos expandidos
  const [showImport, setShowImport] = useState(false);
  const [statusCot, setStatusCot] = useState(null); // null | "carregando" | {n,total} | "erro" | "offline"
  const [logVivo, setLogVivo] = useState([]); // log ao vivo da atualização de cotações

  function addLogVivo(txt, tipo="info") {
    setLogVivo(prev => [...prev, { txt, tipo, hora: new Date().toLocaleTimeString("pt-BR") }]);
  }

  // busca cotações reais no AI Bridge (brapi) e atualiza os ativos — com log ao vivo
  async function atualizarCotacoes() {
    setStatusCot("carregando");
    setLogVivo([]);
    const tickers = ativos.map(a=>a.ticker);

    addLogVivo(`Iniciando atualização de ${tickers.length} ativos`, "passo");
    addLogVivo(`Ativos: ${tickers.join(", ")}`, "dado");
    registrarLog("cotacao", `Atualização iniciada para ${tickers.length} ativos`, { direcao:"interno", origem:"app", detalhe:tickers });

    const alvo = `${bridgeUrl}/cotacoes`;
    addLogVivo(`Montando requisição POST → ${alvo}`, "passo");
    addLogVivo(`Corpo: { tickers: [${tickers.length} itens] }`, "dado");
    registrarLog("cotacao", `Requisição enviada ao servidor`, { direcao:"ida", origem:"servidor", detalhe:alvo });

    try {
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 30000);
      const inicio = Date.now();
      const r = await fetch(alvo, {
        method:"POST", headers:{ "Content-Type":"application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ tickers }),
      });
      clearTimeout(t);
      addLogVivo(`Resposta recebida em ${Date.now()-inicio}ms (HTTP ${r.status})`, "passo");

      const data = await r.json();
      registrarLog("cotacao", `Resposta recebida (HTTP ${r.status})`, { direcao:"volta", origem:"servidor", detalhe:data });

      if (data.ok && data.cotacoes) {
        const achadas = Object.keys(data.cotacoes).length;
        addLogVivo(`Servidor retornou ${achadas} cotações (token brapi: ${data.comToken?"SIM":"NÃO"})`, achadas>0?"ok":"erro");
        if (data.comToken===false) addLogVivo(`⚠️ Sem token brapi no servidor — pode ser a causa de 0 resultados`, "erro");

        // aplica e loga cada alteração
        let mudancas = 0;
        setAtivos(prev => prev.map(a => {
          const nova = data.cotacoes[a.ticker];
          if (nova!=null && nova!==a.cotacao) {
            addLogVivo(`${a.ticker}: R$${a.cotacao} → R$${nova}`, "mudou");
            mudancas++;
            return { ...a, cotacao: nova };
          } else if (nova!=null) {
            addLogVivo(`${a.ticker}: R$${nova} (sem mudança)`, "igual");
            return a;
          } else {
            addLogVivo(`${a.ticker}: não retornado pela brapi`, "falta");
            return a;
          }
        }));

        addLogVivo(`Concluído: ${achadas} cotações, ${mudancas} alteradas`, "passo");
        registrarLog("cotacao", `Concluído: ${achadas}/${tickers.length} cotações, ${mudancas} alteradas`, { direcao:"interno", origem:"app" });
        setStatusCot({ n: achadas, total: tickers.length });
      } else {
        addLogVivo(`Resposta sem cotações válidas`, "erro");
        registrarLog("erro", `Cotações: resposta inválida do servidor`, { direcao:"volta", origem:"servidor", detalhe:data });
        setStatusCot("erro");
      }
    } catch (e) {
      addLogVivo(`FALHA: ${e.message} (servidor offline?)`, "erro");
      registrarLog("erro", `Cotações falhou: ${e.message}`, { direcao:"volta", origem:"servidor" });
      setStatusCot("offline");
    }
  }

  const lista = ativos.filter(a => {
    if (filtroCat === "FII" && a.cat !== "FII") return false;
    if (filtroCat === "Ação" && a.cat !== "Ação") return false;
    if (busca && !a.ticker.toLowerCase().includes(busca.toLowerCase()) && !a.nome.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });

  function atualizar(ticker, campo, valor) {
    const nomesCampo = { qtd:"quantidade", precoMedio:"preço médio", cotacao:"cotação", prov:"provento/cota", freq:"frequência", meses:"meses" };
    setAtivos(prev => prev.map(a => {
      if (a.ticker !== ticker) return a;
      const antigo = a[campo];
      // registra só mudanças de campos numéricos relevantes (evita poluir com cada tecla de meses)
      if (campo!=="meses" && antigo !== valor) {
        registrarLog("edicao", `${ticker}: ${nomesCampo[campo]||campo} ${antigo} → ${valor}`, { direcao:"interno", origem:"app", detalhe:{ ticker, campo, de:antigo, para:valor } });
      }
      return { ...a, [campo]: valor };
    }));
  }

  function resetar() {
    if (window.confirm("Restaurar todos os valores originais? Suas edições serão perdidas.")) {
      registrarLog("edicao", "Carteira restaurada aos valores originais", { direcao:"interno", origem:"app" });
      setAtivos(ATIVOS_INICIAIS.map(a => ({ ...a })));
    }
  }

  const totalInvestido = ativos.reduce((s,a)=>s + a.qtd*a.precoMedio, 0);
  const totalAtual = ativos.reduce((s,a)=>s + a.qtd*a.cotacao, 0);
  const lucro = totalAtual - totalInvestido;

  const FREQS = ["Mensal","Trimestral","Semestral"];

  // ── PROVENTO POR COTA (último recebido, líquido) — botão ao lado das cotações ──
  const [msgDiv, setMsgDiv] = useState(null);
  function atualizarDividendosUltimo() {
    let atualizados = 0, semHist = 0;
    const novos = ativos.map(a => {
      const u = ultimoProventoPorCota(a.proventosHist);
      if (!u) { semHist++; return a; }
      if (Math.abs((a.prov || 0) - u.porCota) < 0.00005) return a;
      atualizados++;
      return { ...a, prov: u.porCota };
    });
    setAtivos(novos);
    const msg = atualizados
      ? `💰 ${atualizados} ativo(s) atualizados com o último provento líquido por cota` + (semHist ? ` · ${semHist} sem histórico` : "")
      : `Nenhum ativo mudou · ${semHist} sem histórico de dividendos (importe a planilha da B3)`;
    setMsgDiv(msg);
    registrarLog("cotacao", msg, { direcao:"interno", origem:"app" });
  }

  return (
    <div>
      {/* ações em massa: cotações reais + importar */}
      <button onClick={atualizarCotacoes} disabled={statusCot==="carregando"} style={{
        width:"100%", padding:"12px", borderRadius:12, marginBottom:8, cursor:statusCot==="carregando"?"default":"pointer",
        border:`1px solid ${T.cyan}55`, background:`${T.cyan}12`, color:T.cyan, fontSize:13, fontWeight:700,
        display:"flex", alignItems:"center", justifyContent:"center", gap:8
      }}>
        {statusCot==="carregando" ? "⏳ Buscando cotações..." : "💹 Atualizar cotações reais (brapi)"}
      </button>
      <button onClick={atualizarDividendosUltimo} style={{
        width:"100%", padding:"12px", borderRadius:12, marginBottom:8, cursor:"pointer",
        border:`1px solid ${T.green}55`, background:`${T.green}12`, color:T.green, fontSize:13, fontWeight:700,
        display:"flex", alignItems:"center", justifyContent:"center", gap:8
      }}>
        💰 Atualizar dividendos (último recebido)
      </button>
      {msgDiv && (
        <div style={{ marginBottom:8, padding:"8px 12px", borderRadius:9, fontSize:11, fontWeight:600, background:`${T.green}12`, border:`1px solid ${T.green}44`, color:T.text }}>{msgDiv}</div>
      )}
      {/* resultado da atualização */}
      {statusCot && statusCot!=="carregando" && (
        <div style={{ marginBottom:8, padding:"8px 12px", borderRadius:9, fontSize:11, fontWeight:600,
          background: typeof statusCot==="object" ? `${T.green}12` : `${T.red}12`,
          border:`1px solid ${typeof statusCot==="object" ? T.green+"44" : T.red+"44"}`,
          color: typeof statusCot==="object" ? T.green : T.red }}>
          {typeof statusCot==="object"
            ? `✓ ${statusCot.n} de ${statusCot.total} cotações atualizadas com o preço real.`
            : statusCot==="offline"
              ? "🔴 Servidor offline. Ligue o PC, o AI Bridge e o Tailscale (endereço na engrenagem ⚙️)."
              : "⚠️ Não foi possível buscar as cotações agora."}
        </div>
      )}

      {/* LOG AO VIVO da atualização de cotações */}
      {logVivo.length>0 && (
        <div style={{ marginBottom:12, background:"#0a0e1a", border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", borderBottom:`1px solid ${T.border}`, background:T.cardAlt }}>
            <span style={{ fontSize:10, color:T.textMute, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>📋 Log da operação</span>
            <button onClick={()=>setLogVivo([])} style={{ fontSize:9, color:T.textFaint, background:"transparent", border:"none", cursor:"pointer" }}>limpar</button>
          </div>
          <div style={{ maxHeight:220, overflowY:"auto", padding:"8px 10px", fontFamily:"monospace" }}>
            {logVivo.map((l,i)=>{
              const cor = l.tipo==="erro"?T.red : l.tipo==="ok"||l.tipo==="mudou"?T.green : l.tipo==="passo"?T.accentSoft : l.tipo==="falta"?T.amber : l.tipo==="dado"?T.textFaint : T.textMute;
              const ic = l.tipo==="erro"?"✕" : l.tipo==="mudou"?"↻" : l.tipo==="ok"||l.tipo==="passo"?"▸" : l.tipo==="falta"?"⚠" : l.tipo==="igual"?"=" : "·";
              return (
                <div key={i} style={{ display:"flex", gap:6, fontSize:10, lineHeight:1.6, color:cor }}>
                  <span style={{ color:T.textFaint, flexShrink:0 }}>{l.hora.slice(0,8)}</span>
                  <span style={{ flexShrink:0 }}>{ic}</span>
                  <span style={{ wordBreak:"break-word" }}>{l.txt}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* botões adicionar + importar em massa */}
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        <button onClick={()=>abrirEditorAtivo(null)} style={{
          flex:1, padding:"12px", borderRadius:12, cursor:"pointer",
          border:`1px solid ${T.accent}`, background:T.accent, color:"#fff", fontSize:13, fontWeight:700,
          display:"flex", alignItems:"center", justifyContent:"center", gap:6
        }}>➕ Adicionar ativo</button>
        <button onClick={()=>setShowImport(true)} style={{
          flex:1, padding:"12px", borderRadius:12, cursor:"pointer",
          border:`1px solid ${T.green}55`, background:`${T.green}12`, color:T.green, fontSize:13, fontWeight:700,
          display:"flex", alignItems:"center", justifyContent:"center", gap:6
        }}>📋 Importar</button>
      </div>

      {showImport && <ImportarMassa ativos={ativos} setAtivos={setAtivos} onProventosRecebidos={onProventosRecebidos} onEventosB3={onEventosB3} onVendidos={onVendidos} onClose={()=>setShowImport(false)} T={T}/>}

      {/* Resumo topo */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:20 }}>
        {[
          {l:"Investido", v:fmtK(totalInvestido), c:T.textDim},
          {l:"Atual", v:fmtK(totalAtual), c:T.accentSoft},
          {l:"Resultado", v:`${lucro>=0?"+":""}${fmtK(lucro)}`, c:lucro>=0?T.green:T.red},
        ].map(k=>(
          <div key={k.l} style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 8px" }}>
            <div style={{ fontSize:9,color:T.textFaint,marginBottom:2 }}>{k.l}</div>
            <div style={{ fontSize:13,fontWeight:800,color:k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Busca + filtro */}
      <div style={{ display:"flex",gap:8,marginBottom:6,flexWrap:"wrap" }}>
        <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="🔍 Buscar ativo..."
          style={{ flex:"1 1 140px",background:T.cardAlt,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"8px 12px",fontSize:13 }}/>
      </div>
      <div style={{ display:"flex",gap:6,marginBottom:16 }}>
        {[["TODOS","Todos"],["FII","FIIs"],["Ação","Ações"]].map(([k,l])=>(
          <button key={k} onClick={()=>setFiltroCat(k)} style={{ flex:"1 1 0",padding:"7px 4px",borderRadius:8,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,background:filtroCat===k?T.accent:T.border,color:filtroCat===k?"#fff":T.textMute }}>{l}</button>
        ))}
      </div>

      {/* Lista editável — agrupada por categoria, expansível */}
      {(() => {
        const grupos = {};
        lista.forEach(a => { const g = grupoDe(a); (grupos[g] = grupos[g] || []).push(a); });
        const ordenados = ORDEM_GRUPOS.filter(g => grupos[g]);
        if (ordenados.length === 0) return <div style={{ fontSize:12, color:T.textFaint, textAlign:"center", padding:"20px 0" }}>Nenhum ativo encontrado</div>;
        const buscando = busca.trim().length > 0;
        return ordenados.map(g => {
          const itens = grupos[g];
          const cg = COR_GRUPO(g, T);
          const aberto = buscando || abertos[g]; // busca abre tudo
          const patri = itens.reduce((s,a)=>s+a.qtd*a.cotacao,0);
          const divAno = itens.reduce((s,a)=>s+a.prov*a.meses.length*a.qtd,0);
          return (
            <div key={g} style={{ marginBottom:8 }}>
              {/* cabeçalho do grupo (clicável) */}
              <div onClick={()=>setAbertos(p=>({ ...p, [g]:!p[g] }))} style={{
                display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer",
                background:T.card, border:`1px solid ${T.border}`, borderLeft:`3px solid ${cg}`,
                borderRadius:10, padding:"11px 13px"
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                  <span style={{ fontSize:11, color:T.textFaint, transform:aberto?"rotate(90deg)":"none", transition:"transform 0.2s", display:"inline-block" }}>▶</span>
                  <span style={{ fontSize:15 }}>{EMOJI_GRUPO[g]}</span>
                  <div>
                    <div style={{ fontSize:13, fontWeight:800, color:T.text }}>{g}</div>
                    <div style={{ fontSize:9, color:T.textFaint }}>{itens.length} ativo{itens.length>1?"s":""}</div>
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:13, fontWeight:800, color:cg }}>{fmt(patri)}</div>
                  <div style={{ fontSize:9, color:T.green }}>{fmt(divAno)}/ano</div>
                </div>
              </div>

              {/* cards dos ativos (quando aberto) */}
              {aberto && (
                <div className="expand-anim" style={{ paddingLeft:6, marginTop:6 }}>
                  {itens.map(a=>{
                    const c = corDe(a.ticker,a.cat,T);
                    const valorTotal = a.qtd*a.cotacao;
                    const result = (a.cotacao-a.precoMedio)*a.qtd;
                    return (
                      <div key={a.ticker} style={{ background:T.card,border:`1px solid ${T.border}`,borderLeft:`3px solid ${c}`,borderRadius:10,padding:"12px",marginBottom:8 }}>
                        {/* cabeçalho */}
                        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                          <div onClick={()=>abrirEditorAtivo(a.ticker)} role="button" title="Ver todas as informações do ativo" style={{ display:"flex",alignItems:"center",gap:7, cursor:"pointer", minWidth:0 }}>
                            <div style={{ width:9,height:9,borderRadius:2,background:c }}/>
                            <div>
                              <span style={{ fontSize:13,fontWeight:800,color:T.text, textDecoration:"underline dotted", textUnderlineOffset:3 }}>{a.ticker} ›</span>
                              {a.setor && <span style={{ fontSize:9,color:T.textMute,background:T.cardAlt,padding:"1px 6px",borderRadius:4,marginLeft:6 }}>{a.setor}</span>}
                              <div style={{ fontSize:10,color:T.textFaint,marginTop:1 }}>{a.nome}</div>
                            </div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <div style={{ fontSize:13,fontWeight:800,color:T.text }}>{fmt(valorTotal)}</div>
                            <div style={{ fontSize:10,color:result>=0?T.green:T.red }}>{result>=0?"+":""}{fmt(result)}</div>
                          </div>
                        </div>
                        {/* campos editáveis */}
                        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                          <CampoEdit label="Quantidade" valor={a.qtd} step="1" onChange={v=>atualizar(a.ticker,"qtd",Math.max(0,Math.round(v)))} T={T}/>
                          <CampoEdit label="Preço médio (R$)" valor={a.precoMedio} step="0.01" onChange={v=>atualizar(a.ticker,"precoMedio",Math.max(0,v))} T={T}/>
                          <CampoEdit label="Cotação atual (R$)" valor={a.cotacao} step="0.01" onChange={v=>atualizar(a.ticker,"cotacao",Math.max(0,v))} T={T}/>
                          <CampoEdit label="Provento/cota (R$)" valor={a.prov} step="0.01" onChange={v=>atualizar(a.ticker,"prov",Math.max(0,v))} T={T}/>
                        </div>
                        {/* frequência */}
                        <div style={{ marginTop:8 }}>
                          <div style={{ fontSize:9,color:T.textFaint,marginBottom:4 }}>Frequência de pagamento</div>
                          <div style={{ display:"flex",gap:4 }}>
                            {FREQS.map(f=>(
                              <button key={f} onClick={()=>{
                                atualizar(a.ticker,"freq",f);
                                const novosMeses = f==="Mensal" ? [1,2,3,4,5,6,7,8,9,10,11,12]
                                  : f==="Trimestral" ? [3,6,9,12]
                                  : [6,12];
                                atualizar(a.ticker,"meses",novosMeses);
                              }} style={{ flex:"1 1 0",padding:"5px 4px",borderRadius:6,border:"none",cursor:"pointer",fontSize:10,fontWeight:600,background:a.freq===f?c:T.border,color:a.freq===f?"#fff":T.textMute }}>{f}</button>
                            ))}
                          </div>
                        </div>
                        {/* Magic Number — quantas cotas para o dividendo comprar 1 cota sozinho */}
                        {(() => {
                          const provMensal = a.prov * (a.meses.length/12); // provento médio mensal por cota
                          if (provMensal<=0 || a.cotacao<=0) return null;
                          const magic = Math.ceil(a.cotacao / provMensal); // cotas necessárias p/ 1 cota/mês
                          const faltam = Math.max(magic - a.qtd, 0);
                          const ok = a.qtd >= magic;
                          const prog = Math.min(a.qtd/magic*100, 100);
                          return (
                            <div style={{ marginTop:8, background:ok?`${T.green}10`:T.cardAlt, border:`1px solid ${ok?T.green+"44":T.border}`, borderRadius:8, padding:"8px 10px" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                                <span style={{ fontSize:10, color:T.textMute }}>✨ Magic Number <span style={{ color:T.textFaint }}>(cotas p/ autossustentar)</span></span>
                                <span style={{ fontSize:11, fontWeight:800, color:ok?T.green:c }}>{a.qtd} / {magic}</span>
                              </div>
                              <div style={{ height:4, background:T.border, borderRadius:3, overflow:"hidden" }}>
                                <div style={{ height:"100%", width:`${prog}%`, background:ok?T.green:c, borderRadius:3 }}/>
                              </div>
                              <div style={{ fontSize:9, color:ok?T.green:T.textFaint, marginTop:3 }}>
                                {ok ? "✓ O dividendo já compra 1 cota por mês sozinho!" : `Faltam ${faltam} cotas para o dividendo comprar 1 cota/mês`}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        });
      })()}

      {/* Reset */}
      <button onClick={resetar} style={{ width:"100%",padding:"10px",borderRadius:8,border:`1px solid ${T.red}44`,background:`${T.red}11`,color:T.red,cursor:"pointer",fontSize:12,fontWeight:600,marginTop:6 }}>
        ↺ Restaurar valores originais
      </button>

      <div style={{ background:T.cardAlt,border:`1px dashed ${T.borderSoft}`,borderRadius:10,padding:"10px 12px",marginTop:12 }}>
        <div style={{ fontSize:10,color:T.textFaint,lineHeight:1.7 }}>
          ✏️ As alterações refletem na hora em todas as abas (Gráfico, Ranking e Cenário Futuro). Mudar a frequência ajusta automaticamente os meses de pagamento. As edições valem durante o uso do app.
        </div>
      </div>
    </div>
  );
}

function CampoEdit({ label, valor, step, onChange, T }) {
  return (
    <div>
      <div style={{ fontSize:9,color:T.textFaint,marginBottom:3 }}>{label}</div>
      <input type="number" step={step} value={valor}
        onChange={e=>onChange(parseFloat(e.target.value)||0)}
        style={{ width:"100%",background:T.cardAlt,border:`1px solid ${T.border}`,borderRadius:6,color:T.text,padding:"7px 8px",fontSize:13,fontWeight:600 }}/>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA CENÁRIO FUTURO
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// MODAL — adicionar aporte esporádico (valor + data)
// ════════════════════════════════════════════════════════════════════════════
function ModalAporteExtra({ horizonte, onAdd, onClose, T }) {
  const [valor, setValor] = useState(2000);
  const [mes, setMes]     = useState(5); // padrão: primeiro dezembro
  const [label, setLabel] = useState("13º");
  const LABELS = [
    { id:"13º",    emoji:"🎁" },
    { id:"Férias", emoji:"🏖️" },
    { id:"Venda",  emoji:"🏷️" },
    { id:"Bônus",  emoji:"💵" },
    { id:"Outro",  emoji:"⚡" },
  ];
  // lista de meses disponíveis no horizonte
  const opcoesMes = Array.from({ length: horizonte }, (_, i) => i);

  return (
    <div onClick={onClose} className="modal-overlay" style={{ position:"fixed", inset:0, background:"#000a", zIndex:1100, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"20px 12px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} className="modal-content" style={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16, width:"100%", maxWidth:420, padding:"20px", boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={{ fontSize:17, fontWeight:800, color:T.text }}>⚡ Aporte esporádico</div>
          <button onClick={onClose} style={{ width:34,height:34,borderRadius:8,border:`1px solid ${T.border}`,background:T.cardAlt,color:T.text,cursor:"pointer",fontSize:16 }}>✕</button>
        </div>

        <div style={{ fontSize:11, color:T.textMute, marginBottom:5 }}>Valor do aporte (R$)</div>
        <input type="number" min="0" value={valor} onChange={e=>setValor(Math.max(0,+e.target.value))}
          style={{ width:"100%", background:T.cardAlt, border:`2px solid ${T.amber}`, borderRadius:10, color:T.text, padding:"11px 14px", fontSize:20, fontWeight:800, textAlign:"center", marginBottom:20 }}/>

        <div style={{ fontSize:11, color:T.textMute, marginBottom:5 }}>Tipo de evento</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:20 }}>
          {LABELS.map(l=>(
            <button key={l.id} onClick={()=>setLabel(l.id)} style={{
              flex:"1 1 0", padding:"8px 4px", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:600,
              border:`2px solid ${label===l.id?T.amber:T.border}`,
              background:label===l.id?`${T.amber}1a`:T.cardAlt, color:label===l.id?T.amber:T.textMute
            }}>{l.emoji} {l.id}</button>
          ))}
        </div>

        <div style={{ fontSize:11, color:T.textMute, marginBottom:5 }}>Quando? (mês do evento)</div>
        <select value={mes} onChange={e=>setMes(+e.target.value)}
          style={{ width:"100%", background:T.cardAlt, border:`1px solid ${T.borderSoft}`, borderRadius:10, color:T.text, padding:"11px 14px", fontSize:14, fontWeight:600, marginBottom:18 }}>
          {opcoesMes.map(i=>(
            <option key={i} value={i}>{labelMes(i)}{i>=5 && (i-5)%12===0 ? " 🎁 (dezembro)" : ""}</option>
          ))}
        </select>

        <div style={{ background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 12px", marginBottom:16 }}>
          <div style={{ fontSize:10, color:T.textFaint }}>Vai adicionar</div>
          <div style={{ fontSize:14, fontWeight:800, color:T.amber }}>{fmt(valor)} <span style={{ fontSize:11, color:T.textMute, fontWeight:600 }}>em {labelMes(mes)}</span></div>
          <div style={{ fontSize:10, color:T.textFaint, marginTop:2 }}>Esse valor será reinvestido (compra cotas) conforme sua estratégia.</div>
        </div>

        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onClose} style={{ flex:"1 1 0", padding:"12px", borderRadius:10, border:`1px solid ${T.borderSoft}`, background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:13, fontWeight:600 }}>Cancelar</button>
          <button onClick={()=>{ if(valor>0){ onAdd({ mes, valor, label }); onClose(); } }}
            style={{ flex:"1 1 0", padding:"12px", borderRadius:10, border:"none", background:T.amber, color:"#1a1a1a", cursor:"pointer", fontSize:13, fontWeight:700 }}>✓ Adicionar ponto</button>
        </div>
      </div>
    </div>
  );
}

function CenarioFuturo({ ativos, fundosProvisionados = 0, T }) {
  const PRESETS = [
    { id:"mfii",  emoji:"🏗️", label:"100% MFII11",   desc:"Mérito — paga todo mês",     regras:[{ticker:"MFII11",pct:100,cotacaoAlvo:50.71}] },
    { id:"kncr",  emoji:"💼", label:"100% KNCR11",   desc:"Kinea — CRI seguro",         regras:[{ticker:"KNCR11",pct:100,cotacaoAlvo:107.28}] },
    { id:"vghf",  emoji:"📦", label:"100% VGHF11",   desc:"Valora — mais cotas/R$",     regras:[{ticker:"VGHF11",pct:100,cotacaoAlvo:5.99}] },
    { id:"mix",   emoji:"⚖️", label:"Mix FIIs",       desc:"MFII 50%·VGHF 30%·KNCR 20%",regras:[{ticker:"MFII11",pct:50,cotacaoAlvo:50.71},{ticker:"VGHF11",pct:30,cotacaoAlvo:5.99},{ticker:"KNCR11",pct:20,cotacaoAlvo:107.28}] },
    { id:"custom",emoji:"⚙️", label:"Personalizado",  desc:"Configure você mesmo",       regras:[] },
  ];

  const [presetId,  setPresetId]  = useState("mfii");
  const [horizonte, setHorizonte] = useState(60);
  const [aporte,    setAporte]    = useState(0);
  const [modo,      setModo]      = useState("provento");
  const [mesSelSim, setMesSelSim] = useState(0);
  const [aportesExtras, setAportesExtras] = useState([]); // [{mes, valor, label}]
  const [showAporteExtra, setShowAporteExtra] = useState(false);
  const [comCartao, setComCartao] = useState(false); // fluxo de reinvestimento com/sem crédito do cartão
  const [customR,   setCustomR]   = useState([
    { ticker:"MFII11",pct:60,cotacaoAlvo:50.71 },
    { ticker:"VGHF11",pct:40,cotacaoAlvo:5.99 },
  ]);

  const preset = PRESETS.find(p=>p.id===presetId);
  const regras = presetId==="custom" ? customR : preset.regras;
  const pctTotal = regras.reduce((s,r)=>s+r.pct,0);
  const PATRI_INICIAL = ativos.reduce((s,a)=>s+a.qtd*a.cotacao,0);

  // remove aportes extras que caem fora do horizonte atual
  const extrasValidos = aportesExtras.filter(e => e.mes < horizonte);

  const dados = useMemo(
    () => simular(ativos, regras, horizonte, aporte, extrasValidos),
    [presetId, horizonte, aporte, JSON.stringify(customR), JSON.stringify(ativos), JSON.stringify(extrasValidos)]
  );

  // simulação do fluxo de reinvestimento COM o crédito do cartão (R$ provisionados)
  const dadosComCartao = useMemo(
    () => simular(ativos, regras, horizonte, aporte, extrasValidos, fundosProvisionados),
    [presetId, horizonte, aporte, JSON.stringify(customR), JSON.stringify(ativos), JSON.stringify(extrasValidos), fundosProvisionados]
  );

  // dados de reinvestimento acumulado (para o gráfico #9)
  const dadosReinvest = useMemo(() => {
    let ac=0, acC=0;
    return dados.map((d,i)=>{
      ac += d.reinvestido;
      acC += dadosComCartao[i]?.reinvestido || 0;
      return { mes:d.mes, reinvestido:d.reinvestido, acumulado:+ac.toFixed(2), acumuladoCartao:+acC.toFixed(2) };
    });
  }, [dados, dadosComCartao]);

  // ESTRATEGISTA (#5): ranking por dividend yield — mais dividendo por R$ investido
  const rankYield = useMemo(() => {
    return ativos
      .filter(a => a.cotacao>0 && a.prov>0)
      .map(a => {
        const provAnual = a.prov * a.meses.length;
        const yieldAnual = (provAnual / a.cotacao) * 100;
        return { ticker:a.ticker, nome:a.nome, cat:a.cat, setor:a.setor, cotacao:a.cotacao,
                 yieldAnual:+yieldAnual.toFixed(2), yieldMensal:+(yieldAnual/12).toFixed(2) };
      })
      .sort((a,b)=>b.yieldAnual-a.yieldAnual);
  }, [ativos]);
  const melhor = rankYield[0];
  const totalReinvestSemCartao = dadosReinvest[dadosReinvest.length-1]?.acumulado || 0;
  const totalReinvestComCartao = dadosReinvest[dadosReinvest.length-1]?.acumuladoCartao || 0;

  const provInicial = dados[0]?.provento || 0;
  const provMedioFinal = dados[dados.length-1]?.provMedio || 0;
  const patriFinal  = dados[dados.length-1]?.patrimonio || 0;
  const crescProv   = (dados[0]?.provMedio||0)>0 ? +((provMedioFinal/(dados[0]?.provMedio||1)-1)*100).toFixed(1) : 0;
  const crescPatri  = +((patriFinal/PATRI_INICIAL-1)*100).toFixed(1);

  function updR(i,f,v) { setCustomR(prev=>prev.map((r,j)=>j===i?{...r,[f]:v}:r)); }

  const HORIZ = [{v:12,l:"1a"},{v:24,l:"2a"},{v:36,l:"3a"},{v:60,l:"5a"},{v:120,l:"10a"}];
  const APORTES = [-500,-200,0,100,200,500,1000];
  const mSel = dados[Math.min(mesSelSim, dados.length-1)];

  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:20 }}>
        {[
          {l:"Provento 1º mês", v:fmt(provInicial), c:T.textDim},
          {l:`Provento médio em ${horizonte>=12?`${horizonte/12}a`:horizonte+"m"}`, v:fmt(provMedioFinal), c:T.green},
          {l:"Crescimento proventos", v:`+${crescProv}%`, c:T.amber},
          {l:"Patrimônio projetado", v:fmtK(patriFinal), c:T.accentSoft},
        ].map(k=>(
          <div key={k.l} style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 12px" }}>
            <div style={{ fontSize:9,color:T.textFaint,marginBottom:2 }}>{k.l}</div>
            <div style={{ fontSize:16,fontWeight:800,color:k.c }}>{k.v}</div>
            {k.l.includes("Patrimônio")&&<div style={{ fontSize:9,color:T.textFaint }}>+{crescPatri}% vs hoje</div>}
          </div>
        ))}
      </div>

      <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px",marginBottom:20 }}>
        <div style={{ fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:1,marginBottom:16 }}>⚙️ Configuração</div>

        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11,color:T.textMute,marginBottom:6 }}>Horizonte</div>
          <div style={{ display:"flex",gap:6 }}>
            {HORIZ.map(o=>(
              <button key={o.v} onClick={()=>{setHorizonte(o.v); setMesSelSim(0);}} style={{ flex:"1 1 0",padding:"6px 4px",borderRadius:8,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,background:horizonte===o.v?T.accent:T.border,color:horizonte===o.v?"#fff":T.textMute }}>{o.l}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11,color:T.textMute,marginBottom:6 }}>Aporte mensal extra (+) ou retirada para despesas (−)</div>
          <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
            {APORTES.map(v=>{
              const neg = v<0; const sel = aporte===v;
              const bg = sel ? (neg?T.red:T.green) : T.border;
              const fg = sel ? "#fff" : (neg?T.red:T.textMute);
              return (
                <button key={v} onClick={()=>setAporte(v)} style={{ padding:"6px 10px",borderRadius:8,border:neg&&!sel?`1px solid ${T.red}55`:"none",cursor:"pointer",fontSize:10,fontWeight:600,background:bg,color:fg }}>
                  {v===0?"Sem aporte":neg?`−${fmt(Math.abs(v))}`:`+${fmt(v)}`}
                </button>
              );
            })}
          </div>
          {aporte<0 && (
            <div style={{ fontSize:9,color:T.red,marginTop:5 }}>↓ Retirando {fmt(Math.abs(aporte))}/mês dos proventos para despesas — reinveste menos.</div>
          )}
        </div>

        {/* APORTES ESPORÁDICOS — pontos de aceleração únicos (13º, férias, venda) */}
        <div style={{ marginBottom:16, background:`${T.amber}0d`, border:`1px solid ${T.amber}33`, borderRadius:10, padding:"10px 12px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <div>
              <div style={{ fontSize:11, color:T.amber, fontWeight:700 }}>⚡ Aportes esporádicos</div>
              <div style={{ fontSize:9, color:T.textFaint, marginTop:1 }}>Eventos únicos que reinvestem (13º, férias, venda de item)</div>
            </div>
            <button onClick={()=>setShowAporteExtra(true)} style={{
              padding:"7px 12px", borderRadius:8, border:"none", cursor:"pointer",
              background:T.amber, color:"#1a1a1a", fontSize:11, fontWeight:700
            }}>➕ Adicionar</button>
          </div>
          {/* atalho rápido: 13º de R$2.000 em dezembro */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom: extrasValidos.length?8:0 }}>
            <button onClick={()=>{
              // adiciona R$2.000 no próximo dezembro dentro do horizonte (Dez = offset 5, 17, 29...)
              const proxDez = [5,17,29,41,53,65,77,89,101,113].find(m => m < horizonte);
              if(proxDez!=null && !aportesExtras.some(e=>e.mes===proxDez && e.label==="13º"))
                setAportesExtras(prev=>[...prev,{mes:proxDez, valor:2000, label:"13º"}]);
            }} style={{ padding:"5px 10px",borderRadius:7,border:`1px solid ${T.amber}55`,background:"transparent",color:T.amber,cursor:"pointer",fontSize:10,fontWeight:600 }}>
              🎁 13º · R$2.000 (Dez)
            </button>
          </div>
          {/* lista dos aportes adicionados */}
          {extrasValidos.length>0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {extrasValidos.sort((a,b)=>a.mes-b.mes).map((e,i)=>(
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:T.cardAlt, borderRadius:7, padding:"6px 10px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:13 }}>{e.label==="13º"?"🎁":e.label==="Férias"?"🏖️":e.label==="Venda"?"🏷️":"⚡"}</span>
                    <div>
                      <span style={{ fontSize:11, fontWeight:700, color:T.text }}>{fmt(e.valor)}</span>
                      <span style={{ fontSize:10, color:T.textMute, marginLeft:6 }}>{e.label} · {labelMes(e.mes)}</span>
                    </div>
                  </div>
                  <button onClick={()=>setAportesExtras(prev=>prev.filter(x=>!(x.mes===e.mes&&x.valor===e.valor&&x.label===e.label)))}
                    style={{ background:"transparent", border:"none", color:T.red, cursor:"pointer", fontSize:15, lineHeight:1 }}>×</button>
                </div>
              ))}
              <div style={{ fontSize:10, color:T.textFaint, textAlign:"right", marginTop:2 }}>
                Total esporádico: <strong style={{ color:T.amber }}>{fmt(extrasValidos.reduce((s,e)=>s+(+e.valor||0),0))}</strong>
              </div>
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize:11,color:T.textMute,marginBottom:6 }}>Estratégia de reinvestimento</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:presetId==="custom"?12:0 }}>
            {PRESETS.map(p=>{
              const sel=presetId===p.id;
              return (
                <button key={p.id} onClick={()=>{setPresetId(p.id); setMesSelSim(0);}} style={{ padding:"9px 10px",borderRadius:10,border:`2px solid ${sel?T.accent:T.border}`,background:sel?T.accentBg:T.cardAlt,cursor:"pointer",textAlign:"left" }}>
                  <div style={{ fontSize:11,fontWeight:700,color:sel?T.accentSoft:T.textMute }}>{p.emoji} {p.label}</div>
                  <div style={{ fontSize:9,color:T.textFaint,marginTop:2 }}>{p.desc}</div>
                </button>
              );
            })}
          </div>

          {presetId==="custom" && (
            <div>
              <div style={{ fontSize:10,color:T.textMute,marginBottom:8 }}>
                Regras · <span style={{ color:pctTotal===100?T.green:pctTotal>100?T.red:T.amber,fontWeight:700 }}>{pctTotal}% alocado {pctTotal!==100?"⚠️":"✓"}</span>
              </div>
              {customR.map((r,i)=>{
                const base = ativos.find(a=>a.ticker===r.ticker);
                return (
                  <div key={i} style={{ background:T.cardAlt,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px",marginBottom:6 }}>
                    <div style={{ display:"flex",gap:6,alignItems:"center",flexWrap:"wrap" }}>
                      <select value={r.ticker} onChange={e=>{ const a=ativos.find(x=>x.ticker===e.target.value); updR(i,"ticker",e.target.value); if(a)updR(i,"cotacaoAlvo",a.cotacao); }} style={{ flex:"1 1 140px",background:T.border,border:`1px solid ${T.borderSoft}`,borderRadius:6,color:T.text,padding:"5px 8px",fontSize:11 }}>
                        {ativos.map(a=><option key={a.ticker} value={a.ticker}>{a.ticker} — {a.nome}</option>)}
                      </select>
                      <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                        <input type="number" min="0" max="100" value={r.pct} onChange={e=>updR(i,"pct",+e.target.value)} style={{ width:50,background:T.border,border:`1px solid ${T.borderSoft}`,borderRadius:6,color:T.text,padding:"5px 6px",fontSize:11,textAlign:"center" }} />
                        <span style={{ fontSize:10,color:T.textFaint }}>%</span>
                      </div>
                      <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                        <span style={{ fontSize:10,color:T.textFaint }}>R$</span>
                        <input type="number" min="0" step="0.01" value={r.cotacaoAlvo} onChange={e=>updR(i,"cotacaoAlvo",+e.target.value)} style={{ width:60,background:T.border,border:`1px solid ${T.borderSoft}`,borderRadius:6,color:T.text,padding:"5px 6px",fontSize:11,textAlign:"center" }} />
                      </div>
                      <button onClick={()=>setCustomR(p=>p.filter((_,j)=>j!==i))} style={{ background:`${T.red}33`,border:"none",borderRadius:6,color:T.red,padding:"5px 9px",cursor:"pointer",fontSize:11 }}>✕</button>
                    </div>
                    {base&&<div style={{ fontSize:9,color:T.textFaint,marginTop:4 }}>Prov: R${base.prov.toFixed(2)}/cota · DY {((base.prov/base.cotacao)*100).toFixed(2)}%/mês · {base.freq}</div>}
                  </div>
                );
              })}
              <button onClick={()=>setCustomR(p=>[...p,{ticker:"MXRF11",pct:0,cotacaoAlvo:9.68}])} style={{ width:"100%",padding:"7px",borderRadius:8,border:`1px dashed ${T.borderSoft}`,background:"transparent",color:T.textFaint,cursor:"pointer",fontSize:11,marginTop:4 }}>+ Adicionar ativo</button>
            </div>
          )}
        </div>
      </div>

      <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 6px 10px",marginBottom:20 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",paddingLeft:8,marginBottom:10 }}>
          <div style={{ fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:1 }}>Evolução mês a mês</div>
          <div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>
            {[["provento","💰 Proventos"],["patrimonio","💼 Patrimônio"],["caixa","💵 Caixa"],["limiteCartao","💳 Limite cartão"]].map(([id,l])=>(
              <button key={id} onClick={()=>setModo(id)} style={{ padding:"4px 8px",borderRadius:6,border:"none",cursor:"pointer",fontSize:9,fontWeight:600,background:modo===id?T.accent:T.border,color:modo===id?"#fff":T.textMute }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ width:"100%", height:240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dados} margin={{ top:8,right:12,left:0,bottom:0 }}
              onClick={(e)=>{ if(e && e.activeTooltipIndex!=null) setMesSelSim(e.activeTooltipIndex); }}>
              <defs>
                <linearGradient id="gradProv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.green} stopOpacity={0.4}/>
                  <stop offset="100%" stopColor={T.green} stopOpacity={0.02}/>
                </linearGradient>
                <linearGradient id="gradPatri" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.accent} stopOpacity={0.4}/>
                  <stop offset="100%" stopColor={T.accent} stopOpacity={0.02}/>
                </linearGradient>
                <linearGradient id="gradCaixa" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.cyan} stopOpacity={0.4}/>
                  <stop offset="100%" stopColor={T.cyan} stopOpacity={0.02}/>
                </linearGradient>
                <linearGradient id="gradCartao" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.amber} stopOpacity={0.4}/>
                  <stop offset="100%" stopColor={T.amber} stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false}/>
              <XAxis dataKey="mes" tick={{ fontSize:8,fill:T.textMute }} axisLine={false} tickLine={false}
                interval={Math.max(Math.floor(dados.length/7)-1,0)} minTickGap={10}/>
              <YAxis tick={{ fontSize:8,fill:T.textMute }} axisLine={false} tickLine={false}
                width={42} domain={[0,'auto']}
                tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:`${Math.round(v)}`}/>
              <Tooltip content={<TipSim T={T} />}/>
              {/* marcadores dos aportes esporádicos (pontos de aceleração) */}
              {extrasValidos.map((e,i)=>(
                <ReferenceLine key={i} x={labelMes(e.mes)} stroke={T.amber} strokeDasharray="4 3" strokeWidth={1.5}
                  label={{ value:`⚡${(e.valor/1000).toFixed(e.valor>=1000?0:1)}k`, position:"top", fontSize:9, fill:T.amber }}/>
              ))}
              {modo==="provento" && (
                <Area type="monotone" dataKey="provMedio" name="Provento médio/mês"
                  stroke={T.green} strokeWidth={2.5} fill="url(#gradProv)" dot={false} activeDot={{ r:4, fill:T.green }}/>
              )}
              {modo==="patrimonio" && (
                <Area type="monotone" dataKey="patrimonio" name="Patrimônio total"
                  stroke={T.accent} strokeWidth={2.5} fill="url(#gradPatri)" dot={false} activeDot={{ r:4, fill:T.accent }}/>
              )}
              {modo==="caixa" && (
                <Area type="monotone" dataKey="caixa" name="Caixa acumulado"
                  stroke={T.cyan} strokeWidth={2.5} fill="url(#gradCaixa)" dot={false} activeDot={{ r:4, fill:T.cyan }}/>
              )}
              {modo==="limiteCartao" && (
                <Area type="monotone" dataKey="limiteCartao" name="Limite cartão (projeção)"
                  stroke={T.amber} strokeWidth={2.5} fill="url(#gradCartao)" dot={false} activeDot={{ r:4, fill:T.amber }}/>
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {modo==="limiteCartao" && (
          <div style={{ background:`${T.amber}12`, border:`1px dashed ${T.amber}55`, borderRadius:8, padding:"8px 10px", margin:"0 8px 8px" }}>
            <div style={{ fontSize:9, color:T.amber, lineHeight:1.5 }}>
              💳 <strong>Prévia.</strong> Hoje mostra ~40% do patrimônio como limite estimado. Vamos refinar isso na aba de cartões (Onda 3), usando ativos como Tesouro de garantia.
            </div>
          </div>
        )}
        <div style={{ display:"flex",gap:6,marginTop:10,paddingLeft:8,overflowX:"auto" }}>
          {[12,24,36,60,120].filter(m=>m<=horizonte).map(m=>{
            const d = dados[m-1]; if(!d) return null;
            return (
              <div key={m} style={{ flex:"0 0 auto",background:T.cardAlt,border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",textAlign:"center" }}>
                <div style={{ fontSize:8,color:T.textFaint,marginBottom:2 }}>{m>=12?`${m/12} ano${m/12>1?"s":""}`:m+"m"}</div>
                <div style={{ fontSize:11,fontWeight:800,color:T.green }}>{fmtK(d.provMedio)}</div>
                <div style={{ fontSize:8,color:T.textMute }}>/mês</div>
                <div style={{ fontSize:10,fontWeight:700,color:T.accent,marginTop:2 }}>{fmtK(d.patrimonio)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px",marginBottom:20 }}>
        <div style={{ fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:1,marginBottom:10 }}>
          📋 Fluxo de reinvestimento — toque numa barra do gráfico
        </div>
        <div style={{ display:"flex",gap:2,marginBottom:16,overflowX:"auto" }}>
          {dados.slice(0,Math.min(horizonte,24)).map((d,i)=>(
            <button key={i} onClick={()=>setMesSelSim(i)} style={{ flex:"0 0 auto",minWidth:54,padding:"5px 4px",borderRadius:6,border:`1px solid ${i===mesSelSim?T.accent:T.border}`,background:i===mesSelSim?T.accentBg:T.cardAlt,cursor:"pointer" }}>
              <div style={{ fontSize:8,color:i===mesSelSim?T.accentSoft:T.textFaint }}>{d.mes}</div>
              <div style={{ fontSize:9,fontWeight:700,color:i===mesSelSim?T.green:T.textMute }}>{fmtK(d.provento)}</div>
            </button>
          ))}
        </div>

        {mSel && (
          <div>
            <div style={{ display:"flex",gap:8,marginBottom:16,flexWrap:"wrap" }}>
              <div style={{ background:`${T.cyan}1a`,border:`1px solid ${T.cyan}55`,borderRadius:8,padding:"8px 12px",flex:"1 1 auto" }}>
                <div style={{ fontSize:9,color:T.cyan }}>Provento recebido</div>
                <div style={{ fontSize:15,fontWeight:800,color:T.cyan }}>{fmt(mSel.provento)}</div>
                {aporte>0 && <div style={{ fontSize:9,color:T.textFaint }}>+ {fmt(aporte)} aporte</div>}
              </div>
              <div style={{ background:T.accentBg,border:`1px solid ${T.accentBorder}`,borderRadius:8,padding:"8px 12px",flex:"1 1 auto" }}>
                <div style={{ fontSize:9,color:T.accentSoft }}>Patrimônio acumulado</div>
                <div style={{ fontSize:15,fontWeight:800,color:T.accentSoft }}>{fmtK(mSel.patrimonio)}</div>
                {mSel.caixa>0 && <div style={{ fontSize:9,color:T.textFaint }}>Caixa: {fmt(mSel.caixa)}</div>}
              </div>
            </div>
            <div style={{ fontSize:10,color:T.textMute,marginBottom:6 }}>🛒 Cotas compradas com o reinvestimento:</div>
            {mSel.compras.length===0
              ? <div style={{ fontSize:11,color:T.textFaint,padding:"8px 0",textAlign:"center" }}>Saldo insuficiente para cota inteira (acumulou {fmt(mSel.caixa)})</div>
              : mSel.compras.map(co=>{
                const c = corDe(co.ticker, ativos.find(a=>a.ticker===co.ticker)?.cat, T);
                return (
                  <div key={co.ticker} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",background:`${c}0d`,border:`1px solid ${c}33`,borderLeft:`3px solid ${c}`,borderRadius:8,padding:"8px 12px",marginBottom:5 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                      <div style={{ width:8,height:8,borderRadius:2,background:c }}/>
                      <div>
                        <span style={{ fontSize:12,fontWeight:700,color:T.text }}>{co.ticker}</span>
                        <div style={{ fontSize:10,color:T.textFaint }}>+{co.cotas} cota{co.cotas>1?"s":""}</div>
                      </div>
                    </div>
                    <div style={{ fontSize:12,fontWeight:700,color:c }}>{fmt(co.gasto)}</div>
                  </div>
                );
              })
            }
            {mSel.detalhes.length>0 && (
              <div style={{ marginTop:10 }}>
                <div style={{ fontSize:10,color:T.textMute,marginBottom:6 }}>💵 De onde veio o provento deste mês:</div>
                <div style={{ display:"flex",flexWrap:"wrap",gap:5 }}>
                  {mSel.detalhes.slice(0,12).map(d=>{
                    const c = corDe(d.ticker, d.cat, T);
                    return (
                      <div key={d.ticker} style={{ background:T.cardAlt,border:`1px solid ${c}33`,borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:5 }}>
                        <div style={{ width:6,height:6,borderRadius:1,background:c }}/>
                        <span style={{ fontSize:9,color:T.textDim }}>{d.ticker}</span>
                        <span style={{ fontSize:9,fontWeight:700,color:c }}>{fmt(d.val)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ MODO ESTRATEGISTA (#5) — onde colocar o próximo real ═══ */}
      {melhor && (
        <div style={{ background:`linear-gradient(135deg, ${T.green}1c, ${T.card})`, border:`1px solid ${T.green}44`, borderRadius:14, padding:"16px 14px", marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
            <span style={{ fontSize:20 }}>🧠</span>
            <div style={{ fontSize:13, fontWeight:800, color:T.text }}>Pense como estrategista</div>
          </div>
          <div style={{ fontSize:10, color:T.textMute, marginBottom:16, lineHeight:1.5 }}>
            Para <strong style={{ color:T.green }}>mais dividendo em menos tempo</strong>, o que rende mais por real investido hoje é:
          </div>

          {/* destaque do melhor ativo */}
          <div style={{ background:T.card, border:`1.5px solid ${T.green}`, borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:9, color:T.green, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>🏆 Melhor agora</div>
                <div style={{ fontSize:17, fontWeight:800, color:T.text, marginTop:2 }}>{melhor.ticker}</div>
                <div style={{ fontSize:9, color:T.textFaint }}>{melhor.nome} · {melhor.setor}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:22, fontWeight:800, color:T.green }}>{melhor.yieldAnual.toFixed(1)}%</div>
                <div style={{ fontSize:9, color:T.textMute }}>ao ano · {melhor.yieldMensal.toFixed(2)}%/mês</div>
              </div>
            </div>
          </div>

          {/* top yields — barras */}
          <div style={{ fontSize:9, color:T.textFaint, marginBottom:6, textTransform:"uppercase", letterSpacing:1 }}>Maiores rendimentos da carteira</div>
          {rankYield.slice(0,5).map((r,i)=>{
            const max = rankYield[0]?.yieldAnual||1;
            const c = corDe(r.ticker, r.cat, T);
            return (
              <div key={r.ticker} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                <span style={{ fontSize:10, color:T.textFaint, fontWeight:700, minWidth:16 }}>#{i+1}</span>
                <span style={{ fontSize:11, fontWeight:700, color:T.text, minWidth:58 }}>{r.ticker}</span>
                <div style={{ flex:1, height:7, background:T.cardAlt, borderRadius:4, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${(r.yieldAnual/max)*100}%`, background:c, borderRadius:4 }}/>
                </div>
                <span style={{ fontSize:11, fontWeight:700, color:c, minWidth:42, textAlign:"right" }}>{r.yieldAnual.toFixed(1)}%</span>
              </div>
            );
          })}

          {/* dica estratégica */}
          <div style={{ marginTop:10, background:`${T.amber}12`, border:`1px solid ${T.amber}33`, borderRadius:9, padding:"9px 11px" }}>
            <div style={{ fontSize:10, color:T.amber, lineHeight:1.6 }}>
              💡 <strong>Tática:</strong> concentrar nos maiores yields acelera a bola de neve no começo. Mas diversifique para reduzir risco — alto yield às vezes vem com mais risco. Use os presets abaixo para testar concentrar vs diversificar.
            </div>
          </div>
        </div>
      )}

      {/* ═══ FLUXO DE REINVESTIMENTO (#9) — gráfico próprio, com/sem cartão ═══ */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"14px 6px 12px", marginBottom:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingLeft:8, paddingRight:8, marginBottom:10 }}>
          <div style={{ fontSize:10, color:T.textFaint, textTransform:"uppercase", letterSpacing:1 }}>♻️ Fluxo de reinvestimento</div>
          <button onClick={()=>setComCartao(v=>!v)} style={{
            padding:"5px 10px", borderRadius:7, cursor:"pointer", fontSize:10, fontWeight:700,
            border:`1px solid ${comCartao?T.amber:T.border}`,
            background:comCartao?`${T.amber}1a`:T.cardAlt, color:comCartao?T.amber:T.textMute
          }}>💳 {comCartao?"Com cartão (ON)":"Com cartão (OFF)"}</button>
        </div>

        {/* resumo */}
        <div style={{ display:"flex", gap:8, padding:"0 8px", marginBottom:10, flexWrap:"wrap" }}>
          <div style={{ background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 10px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Reinvestido (sem cartão)</div>
            <div style={{ fontSize:13, fontWeight:800, color:T.cyan }}>{fmt(totalReinvestSemCartao)}</div>
          </div>
          {comCartao && (
            <div style={{ background:`${T.amber}12`, border:`1px solid ${T.amber}44`, borderRadius:8, padding:"6px 10px" }}>
              <div style={{ fontSize:9, color:T.textFaint }}>Com cartão (+{fmt(fundosProvisionados)})</div>
              <div style={{ fontSize:13, fontWeight:800, color:T.amber }}>{fmt(totalReinvestComCartao)}</div>
            </div>
          )}
        </div>

        <div style={{ width:"100%", height:200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dadosReinvest} margin={{ top:8,right:12,left:0,bottom:0 }}>
              <defs>
                <linearGradient id="gradReinv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.cyan} stopOpacity={0.4}/>
                  <stop offset="100%" stopColor={T.cyan} stopOpacity={0.02}/>
                </linearGradient>
                <linearGradient id="gradReinvC" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.amber} stopOpacity={0.4}/>
                  <stop offset="100%" stopColor={T.amber} stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false}/>
              <XAxis dataKey="mes" tick={{ fontSize:8,fill:T.textMute }} axisLine={false} tickLine={false}
                interval={Math.max(Math.floor(dadosReinvest.length/7)-1,0)} minTickGap={10}/>
              <YAxis tick={{ fontSize:8,fill:T.textMute }} axisLine={false} tickLine={false}
                width={42} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:`${Math.round(v)}`}/>
              <Tooltip content={<TipSim T={T} />}/>
              {comCartao && (
                <Area type="monotone" dataKey="acumuladoCartao" name="Reinvestido c/ cartão"
                  stroke={T.amber} strokeWidth={2.5} fill="url(#gradReinvC)" dot={false} activeDot={{ r:4, fill:T.amber }}/>
              )}
              <Area type="monotone" dataKey="acumulado" name="Reinvestido acumulado"
                stroke={T.cyan} strokeWidth={2.5} fill="url(#gradReinv)" dot={false} activeDot={{ r:4, fill:T.cyan }}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{ fontSize:9, color:T.textFaint, padding:"6px 10px 0", lineHeight:1.6 }}>
          Mostra só o dinheiro que voltou pra carteira como novas cotas (acumulado). {comCartao ? `Com cartão: injeta ${fmt(fundosProvisionados)} de crédito garantido por ativos no início, acelerando as compras.` : "Ative o cartão para ver o efeito dos fundos provisionados."}
        </div>
      </div>

      <div style={{ background:T.cardAlt,border:`1px dashed ${T.borderSoft}`,borderRadius:10,padding:"10px 12px" }}>
        <div style={{ fontSize:10,color:T.textFaint,lineHeight:1.7 }}>
          🤖 <strong style={{ color:T.textMute }}>Como funciona:</strong> Cada mês recebe os proventos das cotas que você já tem (incluindo as compradas antes — efeito bola de neve). Esse valor + aporte compra novas cotas inteiras. A sobra acumula. Cotações e proventos/cota mantidos constantes. Sem IR/taxas.
        </div>
      </div>

      {/* MODAL aporte esporádico */}
      {showAporteExtra && (
        <ModalAporteExtra
          horizonte={horizonte}
          onAdd={(novo)=>setAportesExtras(prev=>[...prev, novo])}
          onClose={()=>setShowAporteExtra(false)}
          T={T}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TRILHA DE METAS — progressão por estágios (cores quente → frio)
// ════════════════════════════════════════════════════════════════════════════
// Paleta de estágios: do quente (início) ao frio (meta final).
// Início = vermelho/laranja, meio = amarelo/verde, fim = azul/ciano (mais frio).
const CORES_ESTAGIOS = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6"];

function gerarEstagios(metaMensal, nEstagios) {
  // divide a meta em N checkpoints proporcionais
  const passo = metaMensal / nEstagios;
  return Array.from({ length: nEstagios }, (_, i) => ({
    idx: i + 1,
    valor: +(passo * (i + 1)).toFixed(0),
    cor: CORES_ESTAGIOS[i] || CORES_ESTAGIOS[CORES_ESTAGIOS.length - 1],
  }));
}

function TrilhaMetas({ estiloDe = () => ({ style:{}, cls:"" }), valorAtual, metaMensal, compacto=false, onConfigurar, onAbrirAnalises, T }) {
  const [nivel, setNivel] = useState(0); // 0=base, 1=+500, 2=+1500
  const niveis = [{ lb:"Base", extra:0 }, { lb:"+R$500", extra:500 }, { lb:"+R$1.500", extra:1500 }];
  const metaEfetiva = metaMensal + niveis[nivel].extra;
  const N = 5; // numero de estagios
  const estagios = gerarEstagios(metaEfetiva, N);
  const pctGeral = Math.min((valorAtual / metaEfetiva) * 100, 100);
  const estagiosAlcancados = estagios.filter(e => valorAtual >= e.valor).length;
  const metaBatida = valorAtual >= metaEfetiva;
  const proximoEstagio = estagios.find(e => valorAtual < e.valor);
  const faltaProximo = proximoEstagio ? proximoEstagio.valor - valorAtual : 0;
  const faltaMetaFinal = metaBatida ? 0 : metaEfetiva - valorAtual;
  const stop = (fn)=>(e)=>{ e.stopPropagation(); fn&&fn(); };

  // modo compacto (carrossel minimizado) — uma linha só
  if (compacto) {
    return (
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:16, padding:"11px 13px", boxShadow:"0 2px 10px #0000000d" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span className={estiloDe("tituloMetaProventos",13).cls} style={{ fontSize:13, fontWeight:800, color:T.text, ...estiloDe("tituloMetaProventos",13).style }}>🎯 Meta de proventos</span>
        </div>
        <div style={{ display:"flex", alignItems:"baseline", gap:5, marginTop:8 }}>
          <span style={{ fontSize:15, fontWeight:800, color:metaBatida?T.green:T.accentSoft }}>{fmt(valorAtual)}</span>
          <span style={{ fontSize:9, color:T.textFaint }}>/ {fmt(metaEfetiva)} · {pctGeral.toFixed(0)}%</span>
        </div>
        <div style={{ height:4, background:T.cardAlt, borderRadius:3, overflow:"hidden", marginTop:4 }}>
          <div style={{ height:"100%", width:`${pctGeral}%`, background:metaBatida?T.green:T.accent, borderRadius:3 }}/>
        </div>
      </div>
    );
  }

  // visual no layout novo (anel + estágios) — a conta é a mesma de antes
  const CORES_VISUAL = ["#e5483f", "#f07a1a", "#e8b512", "#4caf50", "#3b8f4a"];
  const corEst = (i) => CORES_VISUAL[i] || CORES_VISUAL[CORES_VISUAL.length - 1];
  const raio = 40, circ = 2 * Math.PI * raio;
  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:20, padding:"15px 14px 14px", boxShadow:"0 2px 10px #0000000d" }}>
      {/* cabeçalho: título + ver análise */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <span style={{ fontSize:22, flexShrink:0 }}>🎯</span>
        <span className={estiloDe("tituloMetaProventos",15).cls} style={{ flex:1, minWidth:0, fontSize:15, fontWeight:800, color:T.text, lineHeight:1.2, ...estiloDe("tituloMetaProventos",15).style }}>Minha meta de proventos</span>
        <button onClick={stop(onAbrirAnalises)} style={{ flexShrink:0, display:"flex", alignItems:"center", gap:2, border:`1px solid ${T.accentBorder}`, background:T.card, color:T.accent, borderRadius:20, padding:"6px 10px", cursor:"pointer", fontSize:11, fontWeight:700, whiteSpace:"nowrap" }}>Ver análise <Icone nome="chevron" size={13} cor={T.accent}/></button>
      </div>

      {/* anel de progresso + valor atual / meta */}
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        <div style={{ position:"relative", width:96, height:96, flexShrink:0 }}>
          <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
            <circle cx="48" cy="48" r={raio} fill="none" stroke={T.cardAlt} strokeWidth="10"/>
            <circle cx="48" cy="48" r={raio} fill="none" stroke={metaBatida ? T.green : (estagiosAlcancados ? corEst(estagiosAlcancados - 1) : T.accent)} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${(pctGeral / 100) * circ} ${circ}`} transform="rotate(-90 48 48)" style={{ transition:"stroke-dasharray 0.5s" }}/>
          </svg>
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
            <span style={{ fontSize:22, fontWeight:800, color:T.text, lineHeight:1 }}>{Math.floor(pctGeral)}%</span>
            <span style={{ fontSize:10.5, color:T.textDim }}>da meta</span>
          </div>
        </div>
        <div style={{ flex:1, minWidth:0, borderLeft:`1px solid ${T.border}`, paddingLeft:14 }}>
          <TextoAjustado max={24} min={13} className={estiloDe("metaValorAtual",24).cls} style={{ fontWeight:800, color: metaBatida ? T.green : T.text, lineHeight:1.15, ...estiloDe("metaValorAtual",24).style }}>{fmt(valorAtual)} /</TextoAjustado>
          <button onClick={stop(onConfigurar)} title="Definir meta base" className={estiloDe("metaAlvo",13).cls} style={{ background:"none", border:"none", padding:0, cursor:"pointer", fontSize:13, color:T.textDim, textAlign:"left", ...estiloDe("metaAlvo",13).style }}>{fmt(metaEfetiva)}/mês ✏️</button>
          <div style={{ fontSize:10.5, color:T.textFaint, marginTop:3, lineHeight:1.3 }}>média mensal prevista da carteira</div>
        </div>
      </div>

      {/* níveis de meta — alternam ao vivo */}
      <div style={{ display:"flex", gap:6, marginTop:12 }}>
        {niveis.map((n,i)=>(
          <button key={i} onClick={stop(()=>setNivel(i))} style={{ flex:1, minWidth:0, padding:"8px 2px", borderRadius:10, cursor:"pointer", fontSize:12, fontWeight:700, whiteSpace:"nowrap",
            border: nivel===i ? "none" : `1px solid ${T.border}`, background: nivel===i ? T.accent : T.cardAlt, color: nivel===i ? "#fff" : T.textDim }}>{n.lb}</button>
        ))}
      </div>

      {/* estágios */}
      <div style={{ display:"flex", gap:3, marginTop:16 }}>
        {estagios.map((e, i) => {
          const alcancado = valorAtual >= e.valor;
          return (
            <div key={e.idx} style={{ flex:1, minWidth:0, textAlign:"center" }}>
              <div style={{ position:"relative", borderRadius:9, padding:"5px 0", fontSize:13, fontWeight:800,
                background: alcancado ? corEst(i) : T.cardAlt, color: alcancado ? "#fff" : T.textFaint }}>
                {String(e.idx).padStart(2, "0")}
                {alcancado && <span style={{ position:"absolute", left:"50%", bottom:-5, marginLeft:-5, width:10, height:10, background:corEst(i), transform:"rotate(45deg)" }}/>}
              </div>
              <div style={{ fontSize:10, color: alcancado ? T.text : T.textMute, marginTop:8, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.valor >= 1000 ? fmtK(e.valor) : `R$ ${Math.round(e.valor)}`}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position:"relative", height:14, margin:"8px 0 2px" }}>
        <div style={{ position:"absolute", left:"10%", right:"10%", top:6, height:3, borderRadius:2, background:T.border }}/>
        <div style={{ position:"absolute", left:"10%", width:`${Math.max(0, Math.min(80, (pctGeral / 100) * 100 - 20)) }%`, top:6, height:3, borderRadius:2, background:`linear-gradient(90deg, ${CORES_VISUAL.join(",")})`, transition:"width 0.5s" }}/>
        {estagios.map((e, i) => {
          const alcancado = valorAtual >= e.valor;
          return <span key={e.idx} style={{ position:"absolute", top:1, left:`calc(${10 + i*20}% - 6px)`, width:12, height:12, borderRadius:"50%",
            background: alcancado ? corEst(i) : T.card, border:`2px solid ${alcancado ? corEst(i) : T.textFaint}`, boxShadow: alcancado ? `0 0 6px ${corEst(i)}88` : "none" }}/>;
        })}
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:8, gap:8 }}>
        <span style={{ fontSize:12, color:T.text }}>🏆 Estágio <strong>{estagiosAlcancados}</strong> de {N}</span>
        <span style={{ fontSize:12, fontWeight:800, color: metaBatida ? T.green : T.accent }}>{Math.floor(pctGeral)}% da meta</span>
      </div>

      {/* quanto falta para a próxima meta (como antes) */}
      <div style={{
        marginTop:12,
        background: metaBatida ? `${T.green}14` : "rgba(239,68,68,0.10)",
        border: `1.5px solid ${metaBatida ? T.green : "#ef4444"}`,
        borderRadius:14, padding:"11px 13px",
        display:"flex", alignItems:"center", justifyContent:"space-between", gap:10
      }}>
        {metaBatida ? (
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:20 }}>🏆</span>
            <div>
              <div style={{ fontSize:12, fontWeight:800, color:T.green }}>Meta final alcançada!</div>
              <div style={{ fontSize:10.5, color:T.textMute, marginTop:1 }}>Você bateu todos os estágios. Hora de subir a meta.</div>
            </div>
          </div>
        ) : (<>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:9.5, color:"#ef4444", textTransform:"uppercase", letterSpacing:0.5, fontWeight:700 }}>⚠️ Falta para a próxima meta</div>
            <div style={{ display:"flex", alignItems:"baseline", gap:6, marginTop:3, flexWrap:"wrap" }}>
              <span style={{ fontSize:20, fontWeight:800, color:"#ef4444" }}>{fmt(faltaProximo)}</span>
              <span style={{ fontSize:10.5, color:T.textMute }}>para chegar em <strong style={{ color:T.text }}>{fmt(proximoEstagio.valor)}</strong></span>
            </div>
            <div style={{ fontSize:10, color:T.textFaint, marginTop:3 }}>Faltam {fmt(faltaMetaFinal)} para a meta final de {fmt(metaEfetiva)}</div>
          </div>
          <div style={{ flexShrink:0, width:42 }}>
            <div style={{ background: corEst(proximoEstagio.idx - 1), clipPath:"polygon(0 0, 100% 0, 100% 62%, 50% 100%, 0 62%)", height:34, display:"flex", alignItems:"flex-start", justifyContent:"center", paddingTop:5, borderRadius:"6px 6px 0 0" }}>
              <span style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{String(proximoEstagio.idx).padStart(2,"0")}</span>
            </div>
          </div>
        </>)}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CARROSSEL DE METAS — 3 painéis deslizáveis (Proventos / Contas / Reserva Plus)
// Cada painel leva à aba Análises. Proventos tem 3 níveis alternáveis ao vivo.
// ════════════════════════════════════════════════════════════════════════════
const ETFS_GLOBAIS = ["VWRA11","IVVB11","NASD11","XINA11","BNDX11","WRLD11"];

function CarrosselMetas({ ativos, mediaMes, metaMensal, metaAporte=0, aporteEsteMes=0, custoVida={}, onConfigurar, onConfigAporte, onAbrirAnalises, onAbrirContas, onAbrirReserva, estiloDe = () => ({ style:{}, cls:"" }), T }) {
  // ── CONTAS A PAGAR (dados reais da página Custo de Vida) ──
  const contasLista = CUSTOS_DEF.map(c=>({ ...c, valor:+custoVida[c.id]||0 })).filter(c=>c.valor>0).sort((a,b)=>a.valor-b.valor);
  const custoTotal = contasLista.reduce((s,c)=>s+c.valor,0);
  let _acc=0; const marcos = contasLista.map(g=>{ _acc+=g.valor; return { ...g, alvo:_acc }; });
  const contasPagas = marcos.filter(m=>mediaMes>=m.alvo).length;
  const contasPct = custoTotal>0 ? Math.min(mediaMes/custoTotal*100,100) : 0;

  // ── RESERVA PLUS (Tesouro Direto + CDB/LCI/LCA + ETFs globais) ──
  const ehReserva = ehReservaAtivo;
  const reservaItens = ativos.filter(a=>a.qtd>0 && ehReserva(a)).map(a=>({ ...a, valor:a.qtd*a.cotacao })).sort((x,y)=>y.valor-x.valor);
  const reservaValor = reservaItens.reduce((s,a)=>s+a.valor,0);
  const patrimonio = ativos.filter(a=>a.qtd>0).reduce((s,a)=>s+a.qtd*a.cotacao,0);
  const reservaAlvo = Math.max(patrimonio*0.25, 1000);
  const reservaPct = Math.min(reservaValor/reservaAlvo*100, 100);

  const [aberto, setAberto] = useState(true);
  const stop = (fn) => (e)=>{ e.stopPropagation(); fn&&fn(); };
  const Barra = ({ pct, cor }) => (
    <div style={{ height:8, background:T.cardAlt, borderRadius:5, overflow:"hidden", marginTop:8 }}>
      <div style={{ height:"100%", width:`${pct}%`, background:cor, borderRadius:5, transition:"width 0.4s ease" }}/>
    </div>
  );
  const MiniBarra = ({ pct, cor }) => (
    <div style={{ height:4, background:T.cardAlt, borderRadius:3, overflow:"hidden", marginTop:4 }}>
      <div style={{ height:"100%", width:`${pct}%`, background:cor, borderRadius:3 }}/>
    </div>
  );
  const painelStyle = { flex:"0 0 88%", scrollSnapAlign:"center", background:T.card, border:`1px solid ${T.border}`, borderRadius:20, padding:"15px 14px", cursor:"pointer", boxShadow:"0 2px 10px #0000000d" };
  const painelMini = { flex:"0 0 70%", scrollSnapAlign:"center", background:T.card, border:`1px solid ${T.border}`, borderRadius:16, padding:"11px 13px", cursor:"pointer", boxShadow:"0 2px 10px #0000000d" };
  const btnVer = (fn) => (
    <button onClick={stop(fn)} style={{ fontSize:9, fontWeight:700, color:T.accentSoft, background:T.accentBg, border:`1px solid ${T.accentBorder}55`, borderRadius:7, padding:"4px 9px", cursor:"pointer" }}>ver detalhe ›</button>
  );

  return (
    <div style={{ marginTop:12 }}>
      {/* cabeçalho com setinha de minimizar/expandir (controla os 3 painéis) */}
      <div onClick={()=>setAberto(v=>!v)} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:8, cursor:"pointer" }}>
        <span style={{ fontSize:11, color:T.textFaint, transform:aberto?"rotate(90deg)":"none", transition:"transform 0.3s ease", display:"inline-block" }}>▶</span>
        <span style={{ fontSize:12.5, color:T.text, fontWeight:700 }}>🎯 Minhas metas <span style={{ color:T.textMute, fontWeight:500 }}>{aberto ? "· deslize ›" : "· toque para expandir"}</span></span>
      </div>
      <div style={{ display:"flex", alignItems:"flex-start", gap:12, overflowX:"auto", padding:"2px 2px 10px", scrollSnapType:"x mandatory" }}>

        {/* PAINEL 1 — META DE PROVENTOS (timeline detalhada + 3 níveis) */}
        <div style={{ flex: aberto?"0 0 88%":"0 0 70%", scrollSnapAlign:"center" }}>
          <TrilhaMetas estiloDe={estiloDe} valorAtual={mediaMes} metaMensal={metaMensal} compacto={!aberto} onConfigurar={onConfigurar} onAbrirAnalises={onAbrirAnalises} T={T} />
        </div>

        {/* PAINEL 2 — CONTAS PAGAS (dados reais da página Custo de Vida) */}
        <div style={aberto?painelStyle:painelMini} onClick={onAbrirContas}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:13, fontWeight:800, color:T.text }}>🧾 Contas pagas</span>{aberto && btnVer(onAbrirContas)}
          </div>
          {!aberto ? (
            <div style={{ marginTop:8 }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                <span style={{ fontSize:15, fontWeight:800, color:contasPct>=100?T.green:T.cyan }}>{contasPagas}/{marcos.length}</span>
                <span style={{ fontSize:9, color:T.textFaint }}>contas · {contasPct.toFixed(0)}%</span>
              </div>
              <MiniBarra pct={contasPct} cor={contasPct>=100?T.green:T.cyan}/>
            </div>
          ) : custoTotal>0 ? (<>
            <div style={{ display:"flex", alignItems:"baseline", gap:6, marginTop:12 }}>
              <span style={{ fontSize:26, fontWeight:800, color: contasPct>=100?T.green:T.cyan }}>{contasPagas}<span style={{ fontSize:15, color:T.textFaint }}>/{marcos.length}</span></span>
              <span style={{ fontSize:11, color:T.textFaint }}>contas pagas pelos proventos</span>
            </div>
            <Barra pct={contasPct} cor={contasPct>=100?T.green:T.cyan}/>
            <div style={{ fontSize:9, color:T.textMute, marginTop:8, marginBottom:4 }}>Proventos cobrem <strong style={{ color:contasPct>=100?T.green:T.cyan }}>{contasPct.toFixed(0)}%</strong> de {fmt(custoTotal)}/mês</div>
            {/* lista dos gastos (acumulado, menor → maior) */}
            <div style={{ marginTop:6 }}>
              {marcos.map(m=>{
                const coberto = mediaMes >= m.alvo;
                const pctM = Math.min(mediaMes/m.alvo*100, 100);
                const falta = Math.max(m.alvo - mediaMes, 0);
                return (
                  <div key={m.id} style={{ background: coberto?`${T.green}12`:T.cardAlt, border:`1px solid ${coberto?T.green+"44":T.border}`, borderRadius:9, padding:"8px 10px", marginBottom:5 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, fontWeight:700, color:T.textDim, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{coberto?"✅":m.emoji} {m.label}</span>
                      <span style={{ fontSize:11, fontWeight:800, color: coberto?T.green:T.amber, flexShrink:0 }}>{coberto ? "Coberto ✓" : `faltam ${fmt(falta)}`}</span>
                    </div>
                    <div style={{ fontSize:8, color:T.textFaint, marginTop:1 }}>precisa de {fmt(m.alvo)}/mês (acumulado)</div>
                    <div style={{ height:4, background:T.bg, borderRadius:3, overflow:"hidden", marginTop:4 }}>
                      <div style={{ height:"100%", width:`${pctM}%`, background: coberto?T.green:T.amber, borderRadius:3 }}/>
                    </div>
                  </div>
                );
              })}
            </div>
            {contasPagas<marcos.length
              ? <div style={{ fontSize:9, color:T.textFaint, marginTop:3, textAlign:"center" }}>{contasPagas}/{marcos.length} gastos cobertos pelos proventos</div>
              : <div style={{ fontSize:9, color:T.green, fontWeight:700, marginTop:3, textAlign:"center" }}>✓ Todas as contas cobertas pelos proventos!</div>}
          </>) : (
            <div style={{ marginTop:16, textAlign:"center" }}>
              <div style={{ fontSize:11, color:T.textMute, marginBottom:8 }}>Você ainda não cadastrou suas contas fixas.</div>
              <span style={{ fontSize:10, fontWeight:700, color:T.accentSoft }}>Toque para configurar →</span>
            </div>
          )}
        </div>

        {/* PAINEL 3 — RESERVA PLUS (Tesouro + CDB/LCI + ETFs globais) */}
        <div style={aberto?painelStyle:painelMini} onClick={onAbrirReserva}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:13, fontWeight:800, color:T.text }}>🌍 Reserva Plus</span>{aberto && btnVer(onAbrirReserva)}
          </div>
          {!aberto ? (
            <div style={{ marginTop:8 }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                <span style={{ fontSize:15, fontWeight:800, color:T.amber }}>{fmt(reservaValor)}</span>
                <span style={{ fontSize:9, color:T.textFaint }}>{reservaPct.toFixed(0)}% do alvo</span>
              </div>
              <MiniBarra pct={reservaPct} cor={T.amber}/>
            </div>
          ) : (<>
          <div style={{ display:"flex", alignItems:"baseline", gap:6, marginTop:12 }}>
            <span style={{ fontSize:26, fontWeight:800, color:T.amber }}>{fmt(reservaValor)}</span>
            <span style={{ fontSize:11, color:T.textFaint }}>/ {fmt(reservaAlvo)}</span>
          </div>
          <Barra pct={reservaPct} cor={T.amber}/>
          {reservaItens.length>0 ? (
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:9, color:T.textFaint, marginBottom:5 }}>Títulos que compõem ({reservaPct.toFixed(0)}% do alvo de 25%):</div>
              {reservaItens.slice(0,4).map(a=>(
                <div key={a.ticker} style={{ display:"flex", justifyContent:"space-between", marginBottom:3, gap:8 }}>
                  <span style={{ fontSize:10, color:T.textDim, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{/tesouro/i.test(String(a.nome))?"🏛️":ETFS_GLOBAIS.includes(a.ticker)?"🌎":"🔒"} {a.nome}</span>
                  <span style={{ fontSize:10, color:T.amber, fontWeight:700, flexShrink:0 }}>{fmt(a.valor)}</span>
                </div>
              ))}
              {reservaItens.length>4 && <div style={{ fontSize:9, color:T.textFaint, marginTop:2 }}>+{reservaItens.length-4} outros títulos</div>}
            </div>
          ) : (
            <div style={{ fontSize:9, color:T.textFaint, marginTop:10 }}>Sem títulos de reserva ainda (Tesouro, CDB, ETFs globais).</div>
          )}
          </>)}
        </div>

        {/* PAINEL 4 — APORTE MENSAL (quanto investir/mês; realizado vem das compras B3) */}
        <div style={aberto?painelStyle:painelMini} onClick={onConfigAporte}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:13, fontWeight:800, color:T.text }}>💵 Aporte mensal</span>
            {aberto && <button onClick={stop(onConfigAporte)} style={{ fontSize:9, fontWeight:700, color:T.cyan, background:`${T.cyan}1c`, border:`1px solid ${T.cyan}55`, borderRadius:7, padding:"4px 9px", cursor:"pointer" }}>definir ›</button>}
          </div>
          {!aberto ? (
            <div style={{ marginTop:8 }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                <span style={{ fontSize:15, fontWeight:800, color:T.cyan }}>{fmt(aporteEsteMes)}</span>
                <span style={{ fontSize:9, color:T.textFaint }}>{metaAporte>0?`${Math.min(aporteEsteMes/metaAporte*100,100).toFixed(0)}%`:"sem meta"}</span>
              </div>
              <MiniBarra pct={metaAporte>0?Math.min(aporteEsteMes/metaAporte*100,100):0} cor={T.cyan}/>
            </div>
          ) : metaAporte>0 ? (<>
            <div style={{ fontSize:10, color:T.textMute, marginTop:8 }}>Quanto você já investiu este mês (compras da B3)</div>
            <div style={{ display:"flex", alignItems:"baseline", gap:6, marginTop:10 }}>
              <span style={{ fontSize:26, fontWeight:800, color: aporteEsteMes>=metaAporte?T.green:T.cyan }}>{fmt(aporteEsteMes)}</span>
              <span style={{ fontSize:11, color:T.textFaint }}>/ {fmt(metaAporte)}/mês</span>
            </div>
            <Barra pct={Math.min(aporteEsteMes/metaAporte*100,100)} cor={aporteEsteMes>=metaAporte?T.green:T.cyan}/>
            <div style={{ fontSize:9, color: aporteEsteMes>=metaAporte?T.green:T.textMute, marginTop:8, fontWeight:600 }}>
              {aporteEsteMes>=metaAporte ? "✓ meta de aporte batida este mês!" : `faltam ${fmt(metaAporte-aporteEsteMes)} para a meta do mês`}
            </div>
          </>) : (
            <div style={{ marginTop:14, textAlign:"center" }}>
              <div style={{ fontSize:11, color:T.textMute, marginBottom:8 }}>Defina quanto pretende investir por mês e acompanhe seus aportes.</div>
              <span style={{ fontSize:10, fontWeight:700, color:T.cyan }}>Toque para definir →</span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL DEFINIR META
// ════════════════════════════════════════════════════════════════════════════
function ModalMeta({ metaMensal, setMetaMensal, valorAtual, onClose, T }) {
  const [valor, setValor] = useState(metaMensal);
  const estagios = gerarEstagios(valor || 1, 5);
  const sugestoes = [300, 500, 1000, 2000, 5000];

  return (
    <div onClick={onClose} className="modal-overlay" style={{
      position:"fixed", inset:0, background:"#000a", zIndex:1000,
      display:"flex", alignItems:"flex-start", justifyContent:"center",
      padding:"20px 12px", overflowY:"auto"
    }}>
      <div onClick={e=>e.stopPropagation()} className="modal-content" style={{
        background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16,
        width:"100%", maxWidth:440, padding:"20px", boxShadow:"0 20px 60px #000c"
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={{ fontSize:18, fontWeight:800, color:T.text }}>🎯 Definir meta</div>
          <button onClick={onClose} style={{ width:34, height:34, borderRadius:8, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontSize:16 }}>✕</button>
        </div>

        <div style={{ fontSize:11, color:T.textMute, marginBottom:6 }}>Meta de provento médio por mês (R$)</div>
        <input type="number" min="1" value={valor} onChange={e=>setValor(Math.max(0, +e.target.value))}
          style={{ width:"100%", background:T.cardAlt, border:`2px solid ${T.accent}`, borderRadius:10, color:T.text, padding:"12px 14px", fontSize:22, fontWeight:800, textAlign:"center", marginBottom:16 }} />

        {/* sugestões rápidas */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:18 }}>
          {sugestoes.map(s=>(
            <button key={s} onClick={()=>setValor(s)} style={{
              flex:"1 1 0", padding:"7px 4px", borderRadius:8, border:"none", cursor:"pointer",
              fontSize:11, fontWeight:700,
              background: valor===s ? T.accent : T.border, color: valor===s ? "#fff" : T.textMute
            }}>{fmtK(s)}</button>
          ))}
        </div>

        {/* prévia dos estágios gerados */}
        <div style={{ fontSize:11, color:T.textMute, marginBottom:8 }}>Prévia dos 5 estágios:</div>
        <div style={{ display:"flex", gap:4, marginBottom:18 }}>
          {estagios.map((e,i)=>(
            <div key={e.idx} style={{ flex:"1 1 0", textAlign:"center" }}>
              <div style={{
                background:e.cor, borderRadius:6, height:30,
                display:"flex", alignItems:"center", justifyContent:"center",
                clipPath:"polygon(0 0, 100% 0, 100% 65%, 50% 100%, 0 65%)"
              }}>
                <span style={{ fontSize:10, fontWeight:800, color:"#fff" }}>{String(e.idx).padStart(2,"0")}</span>
              </div>
              <div style={{ fontSize:9, fontWeight:700, color:e.cor, marginTop:4 }}>{fmtK(e.valor)}</div>
            </div>
          ))}
        </div>

        {/* status atual em relação à nova meta */}
        <div style={{ background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 12px", marginBottom:16 }}>
          <div style={{ fontSize:10, color:T.textFaint }}>Seu provento médio atual</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
            <span style={{ fontSize:15, fontWeight:800, color:T.accentSoft }}>{fmt(valorAtual)}/mês</span>
            <span style={{ fontSize:11, color: valorAtual>=valor ? T.green : T.amber, fontWeight:700 }}>
              {valor>0 ? `${Math.min((valorAtual/valor)*100,100).toFixed(0)}% da nova meta` : ""}
            </span>
          </div>
        </div>

        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onClose} style={{ flex:"1 1 0", padding:"12px", borderRadius:10, border:`1px solid ${T.borderSoft}`, background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:13, fontWeight:600 }}>
            Cancelar
          </button>
          <button onClick={()=>{ setMetaMensal(valor||1); onClose(); }} style={{ flex:"1 1 0", padding:"12px", borderRadius:10, border:"none", background:T.accent, color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>
            ✓ Salvar meta
          </button>
        </div>

        <div style={{ marginTop:12, fontSize:10, color:T.textFaint, textAlign:"center", lineHeight:1.6 }}>
          A trilha divide sua meta em 5 estágios. Conforme seu provento médio cresce, os estágios vão sendo preenchidos com cores — do vermelho (início) ao azul (meta final).
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL — meta de APORTE mensal (quanto pretendo investir por mês)
// ════════════════════════════════════════════════════════════════════════════
function ModalAporte({ metaAporte, setMetaAporte, aporteEsteMes, onClose, T }) {
  const [valor, setValor] = useState(metaAporte || 0);
  const sugestoes = [200, 500, 1000, 2000, 5000];
  const pct = valor>0 ? Math.min(aporteEsteMes/valor*100, 100) : 0;
  return (
    <div onClick={onClose} className="modal-overlay" style={{ position:"fixed", inset:0, background:"#000a", zIndex:1000, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"20px 12px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} className="modal-content" style={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16, width:"100%", maxWidth:440, padding:"20px", boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={{ fontSize:18, fontWeight:800, color:T.text }}>💵 Meta de aporte mensal</div>
          <button onClick={onClose} style={{ width:34, height:34, borderRadius:8, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontSize:16 }}>✕</button>
        </div>
        <div style={{ fontSize:11, color:T.textMute, marginBottom:6 }}>Quanto você pretende investir/aportar por mês (R$)</div>
        <input type="number" min="0" value={valor} onChange={e=>setValor(Math.max(0, +e.target.value))}
          style={{ width:"100%", background:T.cardAlt, border:`2px solid ${T.cyan}`, borderRadius:10, color:T.text, padding:"12px 14px", fontSize:22, fontWeight:800, textAlign:"center", marginBottom:16 }} />
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:18 }}>
          {sugestoes.map(s=>(
            <button key={s} onClick={()=>setValor(s)} style={{ flex:"1 1 0", padding:"7px 4px", borderRadius:8, border:"none", cursor:"pointer", fontSize:11, fontWeight:700, background: valor===s ? T.cyan : T.border, color: valor===s ? "#fff" : T.textMute }}>{fmtK(s)}</button>
          ))}
        </div>
        <div style={{ background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 12px", marginBottom:16 }}>
          <div style={{ fontSize:10, color:T.textFaint }}>Aportado este mês (das compras da planilha B3)</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
            <span style={{ fontSize:15, fontWeight:800, color:T.cyan }}>{fmt(aporteEsteMes)}</span>
            <span style={{ fontSize:11, color: aporteEsteMes>=valor&&valor>0 ? T.green : T.amber, fontWeight:700 }}>{valor>0 ? `${pct.toFixed(0)}% da meta` : ""}</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onClose} style={{ flex:"1 1 0", padding:"12px", borderRadius:10, border:`1px solid ${T.borderSoft}`, background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:13, fontWeight:600 }}>Cancelar</button>
          <button onClick={()=>{ setMetaAporte(valor||0); onClose(); }} style={{ flex:"1 1 0", padding:"12px", borderRadius:10, border:"none", background:T.cyan, color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>✓ Salvar</button>
        </div>
        <div style={{ marginTop:12, fontSize:10, color:T.textFaint, textAlign:"center", lineHeight:1.6 }}>
          O "aportado este mês" é calculado pelas suas compras registradas na planilha da B3. Reimporte a planilha para manter atualizado.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA CUSTO DE VIDA — gastos fixos + marcos de provento/mês necessário
// ════════════════════════════════════════════════════════════════════════════
const CUSTOS_DEF = [
  { id:"agua",       emoji:"💧", label:"Água" },
  { id:"luz",        emoji:"⚡", label:"Luz / Energia" },
  { id:"condominio", emoji:"🏢", label:"Condomínio" },
  { id:"aluguel",    emoji:"🏠", label:"Aluguel / Moradia" },
  { id:"internet",   emoji:"🌐", label:"Internet / Telefone" },
  { id:"outros",     emoji:"📦", label:"Outros fixos" },
];

function CustoVida({ custoVida, setCustoVida, mediaMes, T }) {
  const custoTotal = Object.values(custoVida).reduce((s,v)=>s+(+v||0),0);

  // marcos: ordena os gastos do menor pro maior e acumula (cobrir o + barato primeiro)
  const gastos = CUSTOS_DEF
    .map(c => ({ ...c, valor:+custoVida[c.id]||0 }))
    .filter(c => c.valor>0)
    .sort((a,b)=>a.valor-b.valor);
  let acumulado = 0;
  const marcos = gastos.map(g => { acumulado += g.valor; return { ...g, alvo:acumulado }; });

  const pctTotal = custoTotal>0 ? Math.min(mediaMes/custoTotal*100,100) : 0;
  const cobertos = marcos.filter(m => mediaMes >= m.alvo).length;

  return (
    <div>
      {/* resumo no topo */}
      <div style={{ background:`linear-gradient(135deg, ${T.red}1c, ${T.card})`, border:`1px solid ${T.border}`, borderRadius:14, padding:"16px", marginBottom:20 }}>
        <div style={{ fontSize:10, color:T.textFaint, textTransform:"uppercase", letterSpacing:1 }}>Custo de vida mensal</div>
        <div style={{ fontSize:26, fontWeight:800, color:T.text, letterSpacing:-1 }}>{fmt(custoTotal)}<span style={{ fontSize:13, color:T.textFaint, fontWeight:600 }}>/mês</span></div>
        <div style={{ marginTop:10, height:8, background:T.cardAlt, borderRadius:5, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pctTotal}%`, background:pctTotal>=100?T.green:T.amber, borderRadius:5, transition:"width 0.4s" }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:6 }}>
          <span style={{ fontSize:10, color:T.textMute }}>Proventos cobrem <strong style={{ color:pctTotal>=100?T.green:T.amber }}>{pctTotal.toFixed(0)}%</strong></span>
          <span style={{ fontSize:10, color:T.textMute }}>{fmt(mediaMes)}/mês de proventos</span>
        </div>
      </div>

      {/* MARCOS — quanto de provento/mês para cobrir cada gasto */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:20 }}>
        <div style={{ fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>🎯 Marcos de independência</div>
        <div style={{ fontSize:10, color:T.textFaint, marginBottom:16, lineHeight:1.5 }}>
          Quanto de provento médio/mês você precisa para cobrir cada gasto (acumulado, do menor ao maior).
        </div>
        {marcos.length===0 ? (
          <div style={{ fontSize:11, color:T.textFaint, textAlign:"center", padding:"12px 0" }}>Defina seus gastos abaixo para ver os marcos.</div>
        ) : marcos.map((m,i)=>{
          const coberto = mediaMes >= m.alvo;
          const falta = Math.max(m.alvo - mediaMes, 0);
          const prog = Math.min(mediaMes/m.alvo*100,100);
          return (
            <div key={m.id} style={{ marginBottom:10, background:coberto?`${T.green}10`:T.cardAlt, border:`1px solid ${coberto?T.green+"44":T.border}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:15 }}>{coberto?"✅":m.emoji}</span>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:coberto?T.green:T.textDim }}>+ {m.label}</div>
                    <div style={{ fontSize:9, color:T.textFaint }}>precisa de {fmt(m.alvo)}/mês</div>
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  {coberto
                    ? <span style={{ fontSize:11, fontWeight:700, color:T.green }}>Coberto ✓</span>
                    : <><div style={{ fontSize:12, fontWeight:800, color:T.amber }}>faltam {fmt(falta)}</div><div style={{ fontSize:8, color:T.textFaint }}>de provento/mês</div></>}
                </div>
              </div>
              <div style={{ height:5, background:T.border, borderRadius:3, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${prog}%`, background:coberto?T.green:T.amber, borderRadius:3, transition:"width 0.4s" }}/>
              </div>
            </div>
          );
        })}
        {marcos.length>0 && (
          <div style={{ marginTop:6, fontSize:10, color:T.textMute, textAlign:"center" }}>
            {cobertos}/{marcos.length} gastos cobertos pelos proventos
            {cobertos===marcos.length && <span style={{ color:T.green, fontWeight:700 }}> · Independência total! 🎉</span>}
          </div>
        )}
      </div>

      {/* EDITOR dos gastos */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:20 }}>
        <div style={{ fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>🧾 Seus gastos fixos</div>
        {CUSTOS_DEF.map(c=>(
          <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <span style={{ fontSize:16, width:22, textAlign:"center" }}>{c.emoji}</span>
            <span style={{ flex:1, fontSize:12, color:T.textDim }}>{c.label}</span>
            <div style={{ display:"flex", alignItems:"center", gap:4, background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:8, padding:"4px 8px" }}>
              <span style={{ fontSize:10, color:T.textFaint }}>R$</span>
              <input type="number" min="0" value={custoVida[c.id]||0}
                onChange={e=>setCustoVida({ ...custoVida, [c.id]: Math.max(0,+e.target.value) })}
                style={{ width:64, background:"transparent", border:"none", color:T.text, fontSize:13, fontWeight:700, textAlign:"right", outline:"none" }}/>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background:T.cardAlt, border:`1px dashed ${T.borderSoft}`, borderRadius:10, padding:"10px 12px" }}>
        <div style={{ fontSize:10, color:T.textFaint, lineHeight:1.6 }}>
          💡 Esses marcos conversam com a aba <strong style={{ color:T.textMute }}>🤖 Cenário</strong>: simule reinvestimentos lá para ver em quanto tempo seu provento médio alcança cada gasto daqui.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ABA CARTÃO — jornada em 3 fases para ficar sem cartão de crédito tradicional
// + limite garantido por ativos
// ════════════════════════════════════════════════════════════════════════════
function CartaoCredito({ ativos, mediaMes, custoVida, setCustoVida, fundosProvisionados, setFundosProvisionados, T }) {
  const patrimonio = ativos.reduce((s,a)=>s+a.qtd*a.cotacao,0);
  // ativos "garantidores": renda fixa / tesouro (mais seguros como garantia de crédito)
  const ativosGarantia = ativos.filter(a => /tesouro|kncr|cpts|rbry|irim|mxrf/i.test(a.ticker+a.nome));
  const valorGarantia = ativosGarantia.reduce((s,a)=>s+a.qtd*a.cotacao,0);

  const custoTotal = Object.values(custoVida).reduce((s,v)=>s+(+v||0),0);
  // limite garantido = fundos provisionados (R$3.000) — base da estratégia
  const limiteGarantido = +fundosProvisionados || 0;

  // ── 3 FASES ──────────────────────────────────────────────────────────────
  // Fase 1: proventos cobrem o custo de vida básico (você não depende de crédito p/ viver)
  // Fase 2: montar a garantia provisionada (meta R$3.000)
  // Fase 3: cartão garantido por ativos ativo (liberdade do crédito tradicional)
  const META_GARANTIA = 3000;
  const fase1ok = custoTotal>0 && mediaMes >= custoTotal;
  const fase2ok = limiteGarantido >= META_GARANTIA;
  const fase3ok = fase1ok && fase2ok;
  const fasesOk = [fase1ok, fase2ok, fase3ok].filter(Boolean).length;

  const FASES = [
    { n:1, cor:"#ef4444", titulo:"Cobrir o básico", desc:"Seus proventos pagam o custo de vida sem precisar de crédito",
      ok:fase1ok, prog: custoTotal>0 ? Math.min(mediaMes/custoTotal*100,100) : 0,
      detalhe: custoTotal>0 ? `${fmt(mediaMes)} de ${fmt(custoTotal)}/mês` : "Defina seu custo de vida abaixo" },
    { n:2, cor:"#f59e0b", titulo:"Montar garantia", desc:"Provisionar R$3.000 em ativos seguros como lastro do limite",
      ok:fase2ok, prog: Math.min(limiteGarantido/META_GARANTIA*100,100),
      detalhe: `${fmt(limiteGarantido)} de ${fmt(META_GARANTIA)}` },
    { n:3, cor:"#22c55e", titulo:"Cartão por ativos", desc:"Limite garantido pelos seus ativos — sem dívida rotativa",
      ok:fase3ok, prog: fase3ok?100:0,
      detalhe: fase3ok ? "Liberdade conquistada!" : "Conclua as fases 1 e 2" },
  ];

  return (
    <div>
      {/* AVISO EXPLÍCITO — proibido cartão de crédito */}
      <div style={{ background:"rgba(239,68,68,0.14)", border:`2px solid #ef4444`, borderRadius:14, padding:"14px 16px", marginBottom:20, textAlign:"center" }}>
        <div style={{ fontSize:26, marginBottom:4 }}>🚫💳</div>
        <div style={{ fontSize:14, fontWeight:800, color:"#ef4444" }}>PROIBIDO CARTÃO DE CRÉDITO</div>
        <div style={{ fontSize:10, color:T.textMute, marginTop:4, lineHeight:1.5 }}>
          A meta é nunca usar crédito rotativo. O único crédito permitido no futuro é o <strong style={{ color:T.text }}>garantido pelos seus próprios ativos</strong>.
        </div>
      </div>

      {/* JORNADA 3 FASES */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"16px 14px", marginBottom:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1 }}>🎯 Jornada: liberdade do crédito</div>
          <span style={{ fontSize:11, fontWeight:800, color: fasesOk===3?T.green:T.accentSoft }}>{fasesOk}/3 fases</span>
        </div>

        {/* setas das fases (estilo trilha de metas) */}
        <div style={{ display:"flex", gap:6, marginBottom:20 }}>
          {FASES.map(f=>(
            <div key={f.n} style={{ flex:1, opacity:f.ok?1:0.4, transition:"opacity 0.3s" }}>
              <div style={{
                background:f.ok?f.cor:T.borderSoft, borderRadius:"6px 6px 0 0",
                clipPath:"polygon(0 0, 100% 0, 100% 70%, 50% 100%, 0 70%)",
                height:38, display:"flex", alignItems:"flex-start", justifyContent:"center", paddingTop:6
              }}>
                <span style={{ fontSize:14, fontWeight:800, color:"#fff" }}>{f.ok?"✓":f.n}</span>
              </div>
              <div style={{ fontSize:8, fontWeight:700, color:f.ok?f.cor:T.textFaint, textAlign:"center", marginTop:4, lineHeight:1.2 }}>{f.titulo}</div>
            </div>
          ))}
        </div>

        {/* detalhe de cada fase */}
        {FASES.map(f=>(
          <div key={f.n} style={{ marginBottom:10, background:f.ok?`${f.cor}10`:T.cardAlt, border:`1px solid ${f.ok?f.cor+"44":T.border}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <span style={{ fontSize:12, fontWeight:700, color:f.ok?f.cor:T.textDim }}>
                {f.ok?"✓ ":""}Fase {f.n} · {f.titulo}
              </span>
              <span style={{ fontSize:10, fontWeight:700, color:f.ok?f.cor:T.textMute }}>{f.prog.toFixed(0)}%</span>
            </div>
            <div style={{ fontSize:9, color:T.textFaint, marginBottom:6 }}>{f.desc}</div>
            <div style={{ height:6, background:T.border, borderRadius:4, overflow:"hidden", marginBottom:4 }}>
              <div style={{ height:"100%", width:`${f.prog}%`, background:f.cor, borderRadius:4, transition:"width 0.4s" }}/>
            </div>
            <div style={{ fontSize:10, color:T.textMute, textAlign:"right" }}>{f.detalhe}</div>
          </div>
        ))}
      </div>

      {/* CUSTO DE VIDA — resumo (edição completa na aba Custo Vida) */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1 }}>🧾 Custo de vida</div>
          <span style={{ fontSize:14, fontWeight:800, color:T.red }}>{fmt(custoTotal)}/mês</span>
        </div>
        <div style={{ marginTop:8, padding:"10px 12px", borderRadius:10, background: mediaMes>=custoTotal ? `${T.green}12` : `${T.amber}12`, border:`1px solid ${mediaMes>=custoTotal?T.green:T.amber}44` }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
            <span style={{ fontSize:16, fontWeight:800, color:mediaMes>=custoTotal?T.green:T.amber }}>
              {custoTotal>0 ? Math.min(mediaMes/custoTotal*100,100).toFixed(0) : 0}%
            </span>
            <span style={{ fontSize:11, color:T.textMute }}>coberto pelos proventos</span>
          </div>
          {custoTotal>mediaMes && (
            <div style={{ fontSize:10, color:T.amber, marginTop:3 }}>Faltam {fmt(custoTotal-mediaMes)}/mês de proventos para a independência</div>
          )}
        </div>
        <div style={{ fontSize:9, color:T.textFaint, marginTop:8, textAlign:"center" }}>Edite seus gastos e veja os marcos na aba 🧾 Custo Vida</div>
      </div>

      {/* GARANTIA / LIMITE POR ATIVOS */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:20 }}>
        <div style={{ fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>💎 Limite garantido por ativos</div>

        <div style={{ fontSize:11, color:T.textDim, marginBottom:6 }}>Fundos provisionados como garantia (R$)</div>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:16 }}>
          <input type="number" min="0" step="100" value={fundosProvisionados}
            onChange={e=>setFundosProvisionados(Math.max(0,+e.target.value))}
            style={{ flex:1, background:T.cardAlt, border:`2px solid ${T.green}`, borderRadius:10, color:T.text, padding:"10px 14px", fontSize:18, fontWeight:800, textAlign:"center" }}/>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          <div style={{ background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Limite disponível</div>
            <div style={{ fontSize:15, fontWeight:800, color:T.green }}>{fmt(limiteGarantido)}</div>
          </div>
          <div style={{ background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Ativos seguros (lastro)</div>
            <div style={{ fontSize:15, fontWeight:800, color:T.cyan }}>{fmt(valorGarantia)}</div>
          </div>
        </div>
        <div style={{ fontSize:10, color:T.textFaint, marginTop:10, lineHeight:1.6 }}>
          💡 A ideia: usar parte dos dividendos para provisionar uma garantia. Com ela, o limite vem dos seus próprios ativos (ex: Tesouro, FIIs de papel) — crédito planejado para compras pensadas em meses, <strong style={{ color:T.textMute }}>sem juros de cartão</strong>.
        </div>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// CHATBOT — assistente conectado à IA local (via AI Bridge na rede Tailscale)
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// CHAT — ANEXO DE ARQUIVO (📎) + DITADO POR VOZ (🎤)
// ════════════════════════════════════════════════════════════════════════════
// Lê o arquivo anexado e devolve texto (xlsx vira CSV; demais lidos como texto)
function lerAnexoArquivo(file) {
  return new Promise((resolve, reject) => {
    const ext = String(file.name.split(".").pop()||"").toLowerCase();
    const r = new FileReader();
    if (["xlsx","xls"].includes(ext)) {
      r.onload = (e) => { try {
        const wb = XLSX.read(e.target.result, { type:"array" });
        let out = "";
        wb.SheetNames.slice(0,3).forEach(n=>{ out += `\n[Aba: ${n}]\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n]).slice(0,6000); });
        resolve(out.trim());
      } catch(err){ reject(err); } };
      r.onerror = reject; r.readAsArrayBuffer(file);
    } else {
      r.onload = (e) => resolve(String(e.target.result||""));
      r.onerror = reject; r.readAsText(file);
    }
  });
}

// 📎 Anexar arquivo no chat da IA (txt, md, csv, json, xlsx)
function AnexoChat({ anexo, setAnexo, T }) {
  const ref = useRef(null);
  return (<>
    <button onClick={()=>ref.current?.click()} title="Anexar arquivo"
      style={{ width:44, borderRadius:12, border:`1px solid ${anexo?T.accent:T.borderSoft}`, background: anexo?`${T.accent}22`:T.cardAlt, color: anexo?T.accent:T.textMute, cursor:"pointer", fontSize:16 }}>📎</button>
    <input ref={ref} type="file" accept=".txt,.md,.csv,.json,.xlsx,.xls" style={{ display:"none" }} onChange={async e=>{
      const f = e.target.files?.[0]; e.target.value="";
      if (!f) return;
      if (f.size > 2*1024*1024) { window.alert("Arquivo muito grande (máximo 2MB)."); return; }
      try {
        let txt = await lerAnexoArquivo(f);
        let truncado = false;
        // limite conservador para caber na janela de contexto do modelo local
        const LIMITE_ANEXO = 4000;
        if (txt.length > LIMITE_ANEXO) { txt = txt.slice(0, LIMITE_ANEXO); truncado = true; }
        setAnexo({ nome:f.name, conteudo:txt, truncado });
        registrarLog("chat", `Arquivo anexado: ${f.name}`, { direcao:"interno", origem:"app" });
      } catch(err){ window.alert("Não consegui ler este arquivo. Formatos aceitos: txt, md, csv, json, xlsx."); }
    }}/>
  </>);
}

// 🎤 Ditado por voz → texto no campo do chat.
// No APK usa o reconhecimento nativo do Android (plugin Capacitor); no navegador, a Web Speech API.
// Feedback tátil + sonoro (acessibilidade): vibra e toca um bipe curto.
async function feedbackVozInicio() {
  try { if (window.Capacitor?.isNativePlatform?.()) { const h = await import("@capacitor/haptics"); await h.Haptics.impact({ style:"MEDIUM" }); } else if (navigator.vibrate) navigator.vibrate(40); } catch {}
  try { beep(880, 0.12); } catch {}
}
async function feedbackVozFim() {
  try { if (window.Capacitor?.isNativePlatform?.()) { const h = await import("@capacitor/haptics"); await h.Haptics.impact({ style:"LIGHT" }); } else if (navigator.vibrate) navigator.vibrate([30,40,30]); } catch {}
  try { beep(440, 0.15); } catch {}
}
function beep(freq, dur) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = new AC(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.frequency.value = freq; osc.type = "sine"; gain.gain.value = 0.08;
    osc.connect(gain); gain.connect(ctx.destination); osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.stop(ctx.currentTime + dur + 0.02);
    setTimeout(()=>{ try{ ctx.close(); }catch{} }, (dur+0.1)*1000);
  } catch {}
}

function BotaoAudioChat({ textoAtual, setTexto, onEstado = ()=>{}, T }) {
  const [gravando, setGravando] = useState(false);
  const [nivel, setNivel] = useState(0); // volume ao vivo (0..1) para o visualizador
  const recRef = useRef(null);
  const baseRef = useRef("");
  const timerRef = useRef(null);
  const audioRef = useRef({ ctx:null, stream:null, raf:0 });

  const pararVisualizador = () => {
    const a = audioRef.current;
    if (a.raf) cancelAnimationFrame(a.raf);
    try { a.stream?.getTracks().forEach(t=>t.stop()); } catch {}
    try { a.ctx?.close(); } catch {}
    audioRef.current = { ctx:null, stream:null, raf:0 };
    setNivel(0);
  };
  // captura o microfone só para medir o VOLUME (a transcrição continua com o motor nativo/web)
  const iniciarVisualizador = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC(); const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser(); analyser.fftSize = 256; src.connect(analyser);
      const dados = new Uint8Array(analyser.frequencyBinCount);
      audioRef.current = { ctx, stream, raf:0 };
      const loop = () => {
        analyser.getByteFrequencyData(dados);
        let soma = 0; for (let i=0;i<dados.length;i++) soma += dados[i];
        const media = soma / dados.length / 255; // 0..1
        setNivel(prev => prev*0.6 + media*0.4); // suaviza
        audioRef.current.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* sem permissão de áudio: segue sem visualizador */ }
  };

  const mudar = (v) => {
    setGravando(v); onEstado(v);
    if (v) { feedbackVozInicio(); iniciarVisualizador(); }
    else { feedbackVozFim(); pararVisualizador(); if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } }
  };
  useEffect(()=>()=>pararVisualizador(), []);
  const aplicar = (t) => setTexto((baseRef.current ? baseRef.current.trim()+" " : "") + t);

  const toggle = async () => {
    if (gravando) {
      if (window.Capacitor?.isNativePlatform?.()) { try { const m = await import("@capacitor-community/speech-recognition"); await m.SpeechRecognition.stop(); } catch {} }
      else { try { recRef.current?.stop(); } catch {} }
      mudar(false); return;
    }
    baseRef.current = textoAtual || "";
    if (window.Capacitor?.isNativePlatform?.()) {
      try {
        const m = await import("@capacitor-community/speech-recognition");
        const disp = await m.SpeechRecognition.available();
        if (!disp?.available) { window.alert("Reconhecimento de voz indisponível neste aparelho."); return; }
        await m.SpeechRecognition.requestPermissions();
        await m.SpeechRecognition.removeAllListeners();
        m.SpeechRecognition.addListener("partialResults", (data)=>{ const t = data?.matches?.[0]; if (t) aplicar(t); });
        try { m.SpeechRecognition.addListener("listeningState", (st)=>{ if (st?.status === "stopped") mudar(false); }); } catch {}
        mudar(true);
        timerRef.current = setTimeout(()=>mudar(false), 30000);
        const res = await m.SpeechRecognition.start({ language:"pt-BR", maxResults:1, partialResults:true, popup:false });
        const fin = res?.matches?.[0];
        if (fin) aplicar(fin);
      } catch(e){ mudar(false); window.alert("Erro no microfone: "+(e?.message||e)); }
    } else {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { window.alert("Ditado não suportado neste navegador. No APK do app funciona com o reconhecimento nativo do Android."); return; }
      const rec = new SR(); recRef.current = rec;
      rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = false;
      rec.onresult = (ev) => { let t=""; for (const r of ev.results) t += r[0].transcript; aplicar(t); };
      rec.onend = () => mudar(false);
      rec.onerror = () => mudar(false);
      mudar(true); rec.start();
    }
  };

  // escala do halo e altura das barras reagem ao volume real
  const escalaHalo = 1 + nivel * 1.4;
  const barras = [0.5, 0.8, 1, 0.8, 0.5];
  return (
    <div style={{ position:"relative", width:44, height:44, flex:"0 0 auto" }}>
      {/* HALO reativo ao volume (acende e cresce com a voz) */}
      {gravando && (
        <motion.span
          animate={{ scale: escalaHalo, opacity: 0.25 + nivel*0.5 }}
          transition={{ type:"spring", stiffness:200, damping:18 }}
          style={{ position:"absolute", inset:0, borderRadius:"50%", background:T.red, filter:"blur(4px)", pointerEvents:"none" }}
        />
      )}
      <button onClick={toggle} title={gravando?"Parar gravação":"Falar (ditado por voz)"} aria-label={gravando?"Gravando, toque para parar":"Falar por voz"}
        style={{ position:"relative", zIndex:1, width:44, height:44, borderRadius:12, border:`2px solid ${gravando?T.red:T.borderSoft}`, background: gravando?`${T.red}33`:T.cardAlt, color: gravando?T.red:T.textMute, cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", gap:2, overflow:"hidden", boxShadow: gravando?`0 0 ${8+nivel*22}px ${T.red}` : "none" }}>
        {gravando ? (
          // EQUALIZADOR ao vivo (barras que dançam com o volume)
          <span style={{ display:"flex", alignItems:"center", gap:2, height:20 }}>
            {barras.map((b,i)=>(
              <motion.span key={i}
                animate={{ height: 4 + nivel*18*b + Math.sin(Date.now()/120 + i)*2 }}
                transition={{ duration:0.08 }}
                style={{ width:3, borderRadius:2, background:T.red, minHeight:4 }}/>
            ))}
          </span>
        ) : "🎤"}
      </button>
    </div>
  );
}

// 🔊 Ouvir a resposta da IA em voz alta (text-to-speech).
// No APK usa a voz nativa do Android (plugin); no navegador, a SpeechSynthesis do Chrome.
function BotaoOuvirResposta({ texto, T }) {
  const [falando, setFalando] = useState(false);
  const limparParaFala = (t) => String(t||"")
    .replace(/\[\[THINK\]\][\s\S]*?\[\[\/THINK\]\]/g, "")
    .replace(/[*#`_>|]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/\s+/g, " ").trim();
  const toggle = async () => {
    const t = limparParaFala(texto);
    if (!t) return;
    if (falando) {
      if (window.Capacitor?.isNativePlatform?.()) { try { const m = await import("@capacitor-community/text-to-speech"); await m.TextToSpeech.stop(); } catch {} }
      else { try { window.speechSynthesis?.cancel(); } catch {} }
      setFalando(false); return;
    }
    if (window.Capacitor?.isNativePlatform?.()) {
      try {
        const m = await import("@capacitor-community/text-to-speech");
        setFalando(true);
        const cfgV = lerSalvo("vozTTS", { rate:1, pitch:1, voice:null });
        await m.TextToSpeech.speak({ text:t, lang:"pt-BR", rate:cfgV.rate||1, pitch:cfgV.pitch||1, volume:1.0, ...(Number.isInteger(cfgV.voice)?{ voice:cfgV.voice }:{}) });
        setFalando(false);
      } catch(e){ setFalando(false); window.alert("Não consegui reproduzir a voz neste aparelho."); }
    } else {
      const synth = window.speechSynthesis;
      if (!synth) { window.alert("Leitura em voz não suportada neste navegador. No APK funciona com a voz do Android."); return; }
      synth.cancel();
      const cfgV = lerSalvo("vozTTS", { rate:1, pitch:1, nomeVoz:null });
      const u = new SpeechSynthesisUtterance(t);
      u.lang = "pt-BR"; u.rate = cfgV.rate||1; u.pitch = cfgV.pitch||1;
      if (cfgV.nomeVoz) { const vz = synth.getVoices().find(v=>v.name===cfgV.nomeVoz); if (vz) u.voice = vz; }
      u.onend = () => setFalando(false);
      u.onerror = () => setFalando(false);
      setFalando(true); synth.speak(u);
    }
  };
  return (
    <button onClick={toggle} title={falando?"Parar leitura":"Ouvir resposta"} className={falando?"ia-anim-pulsar":""}
      style={{ marginTop:8, display:"inline-flex", alignItems:"center", gap:5, padding:"5px 10px", borderRadius:8, border:`1px solid ${falando?T.red+"66":T.border}`, background: falando?`${T.red}14`:T.cardAlt, color: falando?T.red:T.textMute, cursor:"pointer", fontSize:11, fontWeight:600 }}>
      {falando?"⏹ Parar":"🔊 Ouvir"}
    </button>
  );
}

function ChatBot({ ativos, setAtivos, bridgeUrl, servidorNome, onVisualizarAcoes, onAplicarAcoes, iaModelo = "", iaInstrucoes = "", onAbrirConfigIA = () => {}, estiloDe = () => ({ style:{}, cls:"" }), T }) {
  const saneouStreaming = useRef(false);
  const [pensar, setPensar] = useEstadoSalvo("chatPensar", false);
  const capPensar = capacidadePensar(iaModelo);
  const pensando = capPensar === "sempre" || (capPensar === "opcional" && pensar);
  // ── MÚLTIPLAS CONVERSAS (sidebar estilo ChatGPT) — persistentes por usuário ──
  const [conversas, setConversas] = useEstadoSalvo("chatConversas", null); // null = migrar do formato antigo
  const [convAtiva, setConvAtiva] = useEstadoSalvo("chatConversaAtiva", null);
  const [sidebarAberta, setSidebarAberta] = useState(false);
  useEffect(() => {
    if (conversas === null) {
      // migração: o histórico antigo (chatHistorico) vira a primeira conversa
      let antigas = [];
      try { antigas = JSON.parse(localStorage.getItem(PREFIXO+"chatHistorico")||"[]")||[]; } catch {}
      antigas = antigas.map(m => m.streaming ? { ...m, streaming:false } : m);
      const primeira = { id:"c"+Date.now(), titulo:(antigas.find(m=>m.role==="user")?.content||"").slice(0,34) || "Nova conversa", mensagens:antigas, criadoEm:new Date().toISOString() };
      setConversas([primeira]); setConvAtiva(primeira.id);
      return;
    }
    // saneamento: destrava mensagens presas em "streaming" (app fechado no meio de uma resposta).
    // Roda SÓ na abertura — durante uma resposta ele apagava a marca e cada pedaço virava um balão novo.
    if (!saneouStreaming.current) {
      saneouStreaming.current = true;
      if (conversas.some(c=>(c.mensagens||[]).some(m=>m.streaming))) {
        setConversas(prev=>(prev||[]).map(c=>({ ...c, mensagens:(c.mensagens||[]).map(m=>m.streaming?{ ...m, streaming:false }:m) })));
        return;
      }
    }
    if (!conversas.length) {
      const nova = { id:"c"+Date.now(), titulo:"Nova conversa", mensagens:[], criadoEm:new Date().toISOString() };
      setConversas([nova]); setConvAtiva(nova.id);
    } else if (!convAtiva || !conversas.some(c=>c.id===convAtiva)) {
      setConvAtiva(conversas[0].id);
    }
  }, [conversas]);
  const convObj = (conversas||[]).find(c=>c.id===convAtiva) || null;
  const mensagens = convObj?.mensagens || [];
  const setMensagens = (updater) => setConversas(prev => {
    const lista = prev || [];
    const idx = lista.findIndex(c=>c.id===convAtiva);
    if (idx < 0) return prev;
    const atual = lista[idx];
    const novas = typeof updater === "function" ? updater(atual.mensagens||[]) : updater;
    let titulo = atual.titulo;
    if (!titulo || titulo === "Nova conversa") {
      const u = novas.find(m=>m.role==="user");
      if (u?.content) titulo = u.content.slice(0,34);
    }
    const copia = [...lista];
    copia[idx] = { ...atual, mensagens:novas, titulo, atualizadoEm:new Date().toISOString() };
    return copia;
  });
  const novaConversa = () => {
    const nova = { id:"c"+Date.now(), titulo:"Nova conversa", mensagens:[], criadoEm:new Date().toISOString() };
    setConversas(prev => [nova, ...(prev||[])].slice(0, 15)); // mantém as 15 mais recentes
    setConvAtiva(nova.id);
  };
  const excluirConversa = (id) => {
    if (!window.confirm("Excluir esta conversa? Não dá para desfazer.")) return;
    setConversas(prev => (prev||[]).filter(c=>c.id!==id));
  };
  const [input, setInput] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [anexo, setAnexo] = useState(null); // {nome, conteudo, truncado}
  const [ouvindo, setOuvindo] = useState(false); // microfone ativo (feedback visual)
  const [statusPC, setStatusPC] = useState("checando"); // checando | online | offline
  const fimRef = useRef(null);

  // verifica se o PC/servidor está ligado e guarda o MOTIVO da falha para mostrar ao usuário
  const [erroPC, setErroPC] = useState("");
  useEffect(() => {
    let vivo = true;
    const ping = async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(()=>ctrl.abort(), 4000);
        const r = await fetch(`${bridgeUrl}/health`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!vivo) return;
        if (r.ok) { setStatusPC("online"); setErroPC(""); }
        else { setStatusPC("offline"); setErroPC(`HTTP ${r.status} (confira a porta e o endereço)`); }
      } catch (e) {
        if (vivo) { setStatusPC("offline"); setErroPC(e && e.name==="AbortError" ? "tempo esgotado (4s)" : "sem conexão: Tailscale ligado neste aparelho? PC ligado?"); }
      }
    };
    ping();
    const id = setInterval(ping, 15000);
    return () => { vivo=false; clearInterval(id); };
  }, [bridgeUrl]);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior:"smooth" }); }, [mensagens, carregando]);

  // resumo enxuto da carteira para dar contexto ao modelo
  const resumoCarteira = () => ({
    totalPatrimonio: +ativos.reduce((s,a)=>s+a.qtd*a.cotacao,0).toFixed(2),
    proventoAnual: +ativos.reduce((s,a)=>s+a.prov*a.meses.length*a.qtd,0).toFixed(2),
    ativos: ativos.filter(a=>a.qtd>0).map(a=>({ ticker:a.ticker, cat:a.cat, qtd:a.qtd, precoMedio:a.precoMedio, cotacao:a.cotacao, provMes:a.prov })),
  });

  const enviar = async () => {
    const texto = input.trim();
    if ((!texto && !anexo) || carregando) return;
    setInput("");
    // histórico enxuto: últimos 6 turnos, cada um recortado (evita estourar o contexto do modelo local)
    const RECORTE_HIST = 1500;
    const baseHist = mensagens.slice(-6).map(m=>{
      let c = m.contentServidor || m.content || "";
      if (c.length > RECORTE_HIST) c = c.slice(0, RECORTE_HIST) + " …(recortado)";
      return { role:m.role, content:c };
    });
    // se há anexo, o conteúdo vai embutido na mensagem para o modelo ler
    let mensagemServidor = anexo
      ? `[ARQUIVO ANEXADO: ${anexo.nome}${anexo.truncado?" (truncado)":""}]\n${anexo.conteudo}\n[/ARQUIVO]\n\n${texto || "Analise o arquivo anexado e resuma os pontos importantes."}`
      : texto;
    // Qwen3: liga/desliga o raciocínio por mensagem (o texto exibido no chat não muda)
    if (capPensar === "opcional") mensagemServidor += pensar ? "\n/think" : "\n/no_think";
    setMensagens(m=>[...m, { role:"user", content: texto || `Analise o arquivo ${anexo?.nome}`, contentServidor: mensagemServidor, anexoNome: anexo?.nome }]);
    setAnexo(null);
    setCarregando(true);
    const carteira = resumoCarteira();
    registrarLog("chat", `Pergunta enviada: "${(texto || "[arquivo anexado]").slice(0,60)}"`, { direcao:"ida", origem:"servidor", detalhe:{ contextoEnviado:{ totalPatrimonio:carteira.totalPatrimonio, proventoAnual:carteira.proventoAnual, qtdAtivos:carteira.ativos.length } } });
    const corpo = JSON.stringify({ mensagem: mensagemServidor, historico: baseHist, carteira, ...(iaModelo ? { modelo: iaModelo } : {}), ...(iaInstrucoes ? { instrucoes: iaInstrucoes } : {}),
      ...(capPensar === "opcional" ? { pensar } : {}), ...(pensando ? { maxTokens: 3072 } : {}) });
    const inicio = Date.now();

    // separa o raciocínio [[THINK]]...[[/THINK]] do texto da resposta
    const parseThink = (raw0) => {
      const raw = String(raw0 || "").replace(/<think>/g, "[[THINK]]").replace(/<\/think>/g, "[[/THINK]]");
      let reasoning = "", content = raw;
      const ini = raw.indexOf("[[THINK]]");
      if (ini !== -1) {
        const fim = raw.indexOf("[[/THINK]]");
        if (fim !== -1) {
          reasoning = raw.slice(ini+9, fim);
          content = raw.slice(0, ini) + raw.slice(fim+10);
        } else {
          reasoning = raw.slice(ini+9); // ainda gerando o raciocínio
          content = raw.slice(0, ini);
        }
      }
      return { reasoning: reasoning.trim(), content: content.trim() };
    };

    // atualiza (ou cria) a última mensagem do assistente em streaming
    const atualizarAssist = (raw) => setMensagens(m=>{
      const { reasoning, content } = parseThink(raw);
      const copy=[...m]; const last=copy[copy.length-1];
      if (last && last.role==="assistant" && last.streaming) copy[copy.length-1]={ ...last, content, reasoning, streaming:true };
      else copy.push({ role:"assistant", content, reasoning, streaming:true });
      return copy;
    });
    const finalizarAssist = (raw, erro=false) => setMensagens(m=>{
      const { reasoning, content } = erro ? { reasoning:"", content:raw } : parseThink(raw);
      let copy=[...m]; const last=copy[copy.length-1];
      const msg = { role:"assistant", content: content || (erro?raw:""), reasoning, erro };
      if (last && last.role==="assistant" && last.streaming) copy[copy.length-1]=msg;
      else copy.push(msg);
      if (copy.length > 40) copy = copy.slice(-40); // mantém só os 40 turnos mais recentes
      return copy;
    });

    // 1) tenta STREAMING (/chat/stream) — resposta em tempo real
    try {
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), pensando ? 300000 : 120000);
      let r = await fetch(`${bridgeUrl}/ia/chat/stream`, {
        method:"POST", headers:{ "Content-Type":"application/json" }, signal: ctrl.signal, body: corpo,
      });
      if (r.status === 404) r = await fetch(`${bridgeUrl}/chat/stream`, {
        method:"POST", headers:{ "Content-Type":"application/json" }, signal: ctrl.signal, body: corpo,
      });
      if (!r.ok || !r.body) throw new Error("stream indisponível ("+r.status+")");
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      setMensagens(m=>[...m, { role:"assistant", content:"", streaming:true }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        let pedaco = dec.decode(value, { stream:true });
        // limpa prefixos SSE "data:" se o servidor usar esse formato
        if (/^data:/m.test(pedaco)) {
          pedaco = pedaco.split(/\r?\n/).map(l=>l.replace(/^data:\s?/,"")).filter(l=>l && l!=="[DONE]").join("");
        }
        acc += pedaco;
        atualizarAssist(acc);
      }
      clearTimeout(t);
      // servidor pode ter enviado um erro no corpo do stream (ex.: contexto estourado)
      const accLow = (acc||"").toLowerCase();
      const erroContexto = /context size|context length|kv cache|exceeded|out of memory|memory slot/.test(accLow);
      if (!acc.trim() || erroContexto) {
        const msgErro = erroContexto
          ? "⚠️ O conteúdo enviado passou do limite que o modelo local consegue ler de uma vez (janela de contexto).\n\nComo resolver:\n• Envie um arquivo/trecho menor, ou\n• Aumente o \"Context Length\" do modelo no LM Studio (ex.: 8192), ou\n• Faça a pergunta em partes.\n\nDica: para bases grandes, importe pela tela ✏️ Editar em vez de anexar tudo no chat."
          : "⚠️ O servidor não retornou texto. Verifique se o modelo está carregado no LM Studio.";
        finalizarAssist(msgErro, true);
        registrarLog("erro", `Stream sem texto útil (${erroContexto?"contexto estourado":"vazio"})`, { direcao:"volta", origem:"servidor", detalhe:(acc||"").slice(0,200) });
        setStatusPC("online"); setCarregando(false); return;
      }
      finalizarAssist(acc);
      setStatusPC("online");
      registrarLog("chat", `Resposta (stream) em ${Date.now()-inicio}ms`, { direcao:"volta", origem:"servidor", detalhe:(acc||"").slice(0,200) });
      setCarregando(false);
      return;
    } catch (eStream) {
      registrarLog("sistema", `Stream indisponível, usando /chat: ${eStream.message}`, { direcao:"interno", origem:"app" });
    }

    // 2) fallback: /chat normal (resposta de uma vez)
    try {
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 60000);
      const r = await fetch(`${bridgeUrl}/chat`, {
        method:"POST", headers:{ "Content-Type":"application/json" }, signal: ctrl.signal, body: corpo,
      });
      clearTimeout(t);
      const data = await r.json();
      const resposta = data?.resposta || data?.erro || "(sem resposta)";
      registrarLog("chat", `Resposta recebida em ${Date.now()-inicio}ms`, { direcao:"volta", origem:"servidor", detalhe:resposta.slice(0,200) });
      finalizarAssist(resposta);
      setStatusPC("online");
    } catch (e) {
      registrarLog("erro", `Chat falhou: ${e.message}`, { direcao:"volta", origem:"servidor" });
      finalizarAssist("⚠️ Não consegui falar com o servidor ("+bridgeUrl+"): "+(e && e.message ? e.message : "sem resposta")+". Confira o endereço em ⚙️ Configurações → Servidor de IA (use 🔌 Testar conexão) e se o Tailscale está ligado neste aparelho.", true);
      setStatusPC("offline");
    } finally { setCarregando(false); }
  };

  // detecta se a resposta tem linhas tipo "BBAS3 291 20,55" para aplicar na carteira
  // detecta edições na resposta da IA: linhas "TICKER QTD PM" OU bloco JSON [{ticker,qtd,...}]
  const detectarEdicoes = (txt) => {
    const doTexto = parseImportacao(txt).filter(i=>!i.erro && i.qtd!=null);
    const porTicker = {}; doTexto.forEach(i=>porTicker[i.ticker]=i);
    // tenta achar um array JSON com objetos {ticker, qtd, ...}
    try {
      const blocos = txt.match(/\[\s*\{[\s\S]*?\}\s*\]/g) || [];
      blocos.forEach(b=>{
        const arr = JSON.parse(b);
        if (Array.isArray(arr)) arr.forEach(o=>{
          if (o && o.ticker) {
            const tk = String(o.ticker).toUpperCase();
            porTicker[tk] = {
              ticker: tk,
              qtd: o.qtd!=null?+o.qtd:(porTicker[tk]?.qtd ?? null),
              precoMedio: o.precoMedio!=null?+o.precoMedio:(o.pm!=null?+o.pm:(porTicker[tk]?.precoMedio ?? null)),
              cotacao: o.cotacao!=null?+o.cotacao:(porTicker[tk]?.cotacao ?? null),
              prov: o.prov!=null?+o.prov:(o.provMes!=null?+o.provMes:null),
            };
          }
        });
      });
    } catch(e) { /* JSON inválido — ignora, usa só o texto */ }
    return Object.values(porTicker);
  };

  const sugestoes = [
    "Resuma minha carteira",
    "Qual meu maior pagador de dividendos?",
    "Quanto recebo de proventos por ano?",
    "Como está minha diversificação?",
  ];

  return (
    <div style={{ position:"relative", display:"flex", flexDirection:"column", minHeight:"calc(100vh - 280px)" }}>
      {/* ═══ SIDEBAR DE CONVERSAS — drawer 38% com slide ═══ */}
      <AnimatePresence>
        {sidebarAberta && (
          <>
            <motion.div key="sbfundo" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
              onClick={()=>setSidebarAberta(false)}
              style={{ position:"absolute", inset:0, background:"#0006", zIndex:40, borderRadius:12 }}/>
            <motion.div key="sb" initial={{ x:"-110%" }} animate={{ x:0 }} exit={{ x:"-110%" }}
              transition={{ type:"spring", stiffness:320, damping:30 }}
              style={{ position:"absolute", left:0, top:0, bottom:0, width:"38%", minWidth:190, zIndex:41,
                background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:12, padding:10, overflowY:"auto", boxShadow:"8px 0 30px #0007" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
                <span style={{ flex:1, fontSize:11, fontWeight:800, color:T.text }}>💬 Conversas</span>
                <button onClick={novaConversa} title="Nova conversa" style={{ width:26, height:26, borderRadius:7, border:"none", background:T.accent, color:"#fff", cursor:"pointer", fontSize:14, fontWeight:800 }}>+</button>
                <button onClick={()=>setSidebarAberta(false)} title="Esconder (desliza p/ esquerda)" style={{ width:26, height:26, borderRadius:7, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:12 }}>«</button>
              </div>
              {(conversas||[]).map(c=>(
                <div key={c.id} onClick={()=>setConvAtiva(c.id)} style={{ display:"flex", alignItems:"center", gap:6, padding:"9px 10px", marginBottom:5, borderRadius:9, cursor:"pointer",
                  border:`1px solid ${c.id===convAtiva?T.accent:T.border}`, background: c.id===convAtiva?`${T.accent}14`:T.card }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.titulo || "Conversa"}</div>
                    <div style={{ fontSize:8, color:T.textFaint }}>{(c.mensagens||[]).length} mensagens</div>
                  </div>
                  <button onClick={(e)=>{ e.stopPropagation(); excluirConversa(c.id); }} title="Excluir conversa" style={{ width:20, height:20, borderRadius:5, border:"none", background:"transparent", color:T.textFaint, cursor:"pointer", fontSize:10 }}>🗑</button>
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* status do servidor */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"10px 12px", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0 }}>
          <button onClick={()=>setSidebarAberta(v=>!v)} title={sidebarAberta?"Esconder conversas":"Mostrar conversas"}
            style={{ width:30, height:30, borderRadius:8, border:`1px solid ${sidebarAberta?T.accent:T.border}`, background: sidebarAberta?`${T.accent}18`:T.cardAlt, color: sidebarAberta?T.accentSoft:T.textMute, cursor:"pointer", fontSize:13, fontWeight:800 }}>☰</button>
          <button onClick={onAbrirConfigIA} title="Servidor, modelo e instruções da IA" style={{ display:"flex", alignItems:"center", gap:8, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"left", minWidth:0, flex:1 }}>
            <span style={{ width:9, height:9, borderRadius:"50%", flexShrink:0, background: statusPC==="online"?T.green:statusPC==="offline"?T.red:T.amber, boxShadow:`0 0 8px ${statusPC==="online"?T.green:statusPC==="offline"?T.red:T.amber}` }}/>
            <span style={{ minWidth:0 }}>
              <span style={{ display:"block", fontSize:12, fontWeight:700, color:T.text, textDecoration:"underline dotted", textUnderlineOffset:3 }}>
                {statusPC==="online"?(servidorNome?`IA conectada · ${servidorNome}`:"IA conectada"):statusPC==="offline"?("Servidor offline · "+(erroPC||"sem resposta")):"Verificando..."}
              </span>
              <span style={{ display:"block", fontSize:9.5, color:T.textFaint, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{iaModelo ? iaModelo.split("/").pop() : "modelo padrão"}{iaInstrucoes ? " · instruções próprias" : ""} ⚙️</span>
            </span>
          </button>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          {mensagens.length>0 && (
            <button onClick={()=>{ if(window.confirm("Limpar todo o histórico desta conversa? Esta ação não pode ser desfeita.")){ setMensagens([]); registrarLog("chat","Histórico do chat limpo pelo usuário",{ direcao:"interno", origem:"app" }); } }}
              title="Limpar histórico" style={{ padding:"5px 9px", borderRadius:7, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:10, fontWeight:600 }}>🗑️ Limpar</button>
          )}
          <span title="IA local · privada" style={{ fontSize:12 }}>🔒</span>
        </div>
      </div>

      {statusPC==="offline" && (
        <div style={{ background:`${T.amber}12`, border:`1px solid ${T.amber}44`, borderRadius:10, padding:"11px 13px", marginBottom:14 }}>
          <div style={{ fontSize:11, color:T.amber, lineHeight:1.6 }}>
            💡 O assistente usa a IA do seu PC. Para usar: ligue o PC, rode o <strong>AI Bridge</strong> (porta 4000) e conecte o <strong>Tailscale</strong> no celular. Configure o endereço do servidor na engrenagem ⚙️.
          </div>
        </div>
      )}

      {/* histórico de mensagens — ocupa o espaço livre; vazio, centraliza as sugestões */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent: mensagens.length===0 ? "center" : "flex-start", marginBottom:14 }}>
        {mensagens.length===0 ? (
          <div style={{ textAlign:"center", padding:"24px 12px" }}>
            <div style={{ fontSize:34, marginBottom:8 }}>🤖</div>
            <div style={{ fontSize:13, color:T.textMute, marginBottom:16 }}>Pergunte qualquer coisa sobre sua carteira.</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {sugestoes.map(s=>(
                <button key={s} onClick={()=>setInput(s)} style={{ padding:"9px 12px", borderRadius:9, border:`1px solid ${T.border}`, background:T.card, color:T.textDim, cursor:"pointer", fontSize:12, textAlign:"left" }}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          mensagens.map((m,i)=>{
            const eu = m.role==="user";
            const edicoes = !eu && !m.erro && !m.streaming ? detectarEdicoes(m.content) : [];
            const acoes = !eu && !m.erro && !m.streaming ? detectarAcoes(m.content) : [];
            const textoLimpo = (!eu && acoes.length>0) ? limparAcoesDoTexto(m.content) : m.content;
            return (
              <div key={i} style={{ display:"flex", justifyContent:eu?"flex-end":"flex-start", marginBottom:10 }}>
                <div style={{ maxWidth:"85%", background: eu?T.accent:(m.erro?`${T.red}14`:T.card), border:`1px solid ${eu?T.accent:(m.erro?T.red+"44":T.border)}`, borderRadius:14, padding:"10px 13px" }}>
                  {/* raciocínio do modelo (DeepSeek R1) — em cinza, recolhível */}
                  {!eu && m.reasoning && (
                    <details open={m.streaming && !m.content} style={{ marginBottom: m.content?8:0 }}>
                      <summary style={{ fontSize:10, color:T.textFaint, cursor:"pointer", userSelect:"none", listStyle:"none" }}>
                        💭 {m.streaming && !m.content ? "pensando..." : "raciocínio"} {m.streaming && !m.content && <span className="cursor-pisca">▋</span>}
                      </summary>
                      <div style={{ fontSize:11, color:T.textMute, lineHeight:1.5, whiteSpace:"pre-wrap", marginTop:5, paddingLeft:8, borderLeft:`2px solid ${T.border}`, fontStyle:"italic" }}>{m.reasoning}</div>
                    </details>
                  )}
                  {eu && m.anexoNome && (
                    <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"#ffffff22", border:"1px solid #ffffff44", borderRadius:8, padding:"4px 8px", marginBottom:6, fontSize:11, color:"#fff" }}>📎 {m.anexoNome}</div>
                  )}
                  {textoLimpo && <div className={estiloDe(eu?"chatBalaoUsuario":"chatBalaoIA",13).cls} style={{ fontSize:13, color: eu?"#fff":T.text, lineHeight:1.5, whiteSpace:"pre-wrap", ...estiloDe(eu?"chatBalaoUsuario":"chatBalaoIA",13).style }}>{textoLimpo}{m.streaming && <span className="cursor-pisca">▋</span>}</div>}
                  {!eu && !m.streaming && !m.erro && textoLimpo && <div><BotaoOuvirResposta texto={textoLimpo} T={T}/></div>}
                  {/* AÇÕES DE CONFIGURAÇÃO sugeridas pela IA — visualizar (preview) ou aplicar */}
                  {acoes.length>0 && (
                    <div style={{ marginTop:10, padding:"10px", background:T.accentBg, border:`1px solid ${T.accentBorder}66`, borderRadius:10 }}>
                      <div style={{ fontSize:10, color:T.accentSoft, fontWeight:700, marginBottom:6 }}>⚙️ {acoes.length} alteração(ões) no app sugerida(s):</div>
                      {acoes.map((a,idx)=>(
                        <div key={idx} style={{ fontSize:11, color:T.textDim, marginBottom:2 }}>• {ACOES_VALIDAS[a.tipo]?.label || a.tipo}: <strong>{String(a.valor)}</strong></div>
                      ))}
                      <div style={{ display:"flex", gap:8, marginTop:8 }}>
                        <button onClick={()=>onVisualizarAcoes && onVisualizarAcoes(acoes)} style={{ flex:1, padding:"9px", borderRadius:8, border:`1px solid ${T.accent}`, background:"transparent", color:T.accent, cursor:"pointer", fontSize:12, fontWeight:700 }}>👁️ Visualizar</button>
                        <button onClick={()=>onAplicarAcoes && onAplicarAcoes(acoes)} style={{ flex:1, padding:"9px", borderRadius:8, border:"none", background:T.accent, color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700 }}>✓ Aplicar</button>
                      </div>
                    </div>
                  )}
                  {/* se o assistente sugeriu edições de ativos, oferece aplicar */}
                  {edicoes.length>0 && (
                    <button onClick={()=>{
                      // backup dos dados ANTES de a IA alterar (permite desfazer em Configurações)
                      try { localStorage.setItem(PREFIXO+"backupDados", JSON.stringify({ ativos, quando:new Date().toISOString(), origem:"edicao IA" })); } catch {}
                      registrarLog("edicao", `IA aplicou ${edicoes.length} alteração(ões)`, { direcao:"interno", origem:"app", detalhe: edicoes.map(i=>`${i.ticker} qtd=${i.qtd} pm=${i.precoMedio}`).join("; ") });
                      setAtivos(prev=>{
                        const mapa={}; prev.forEach(a=>mapa[a.ticker]={...a});
                        edicoes.forEach(i=>{
                          if(mapa[i.ticker]){
                            if(i.qtd!=null)mapa[i.ticker].qtd=i.qtd;
                            if(i.precoMedio!=null)mapa[i.ticker].precoMedio=i.precoMedio;
                            if(i.cotacao!=null)mapa[i.ticker].cotacao=i.cotacao;
                            if(i.prov!=null)mapa[i.ticker].prov=i.prov;
                          } else {
                            const ehTesouro=/^tesouro/i.test(i.ticker); const ehFII=/11$/.test(i.ticker)&&!ehTesouro;
                            mapa[i.ticker]={ ticker:i.ticker, nome:i.ticker, cat:ehTesouro?"Tesouro":(ehFII?"FII":"Ação"), freq:ehFII?"Mensal":"—", qtd:i.qtd||0, prov:i.prov||0, precoMedio:i.precoMedio||0, cotacao:i.cotacao||i.precoMedio||0, meses:ehFII?[1,2,3,4,5,6,7,8,9,10,11,12]:[], setor:"Outros" };
                          }
                        });
                        return Object.values(mapa);
                      });
                    }} style={{ marginTop:8, padding:"7px 11px", borderRadius:8, border:"none", background:T.green, color:"#06281b", cursor:"pointer", fontSize:11, fontWeight:700 }}>
                      ✓ Aplicar {edicoes.length} alteração(ões) na carteira
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        {carregando && (
          <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:10 }}>
            <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"10px 14px", fontSize:13, color:T.textMute }}>pensando…</div>
          </div>
        )}
        <div ref={fimRef}/>
      </div>

      {/* rodapé fixo: anexo + caixa de envio, sempre embaixo, acima do menu flutuante */}
      <div style={{ position:"sticky", bottom:118, zIndex:5, background:T.bg, padding:"8px 0 4px", marginTop:"auto" }}>
      {capPensar !== "nao" && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <button onClick={()=>{ if (capPensar === "opcional") setPensar(v=>!v); }} disabled={capPensar === "sempre"}
            title={capPensar === "sempre" ? "Este modelo sempre raciocina antes de responder" : "Ligar/desligar o raciocínio"}
            style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:700, whiteSpace:"nowrap", flexShrink:0, cursor: capPensar === "sempre" ? "default" : "pointer",
              border:`1px solid ${pensando ? T.accent : T.border}`, background: pensando ? `${T.accent}18` : T.cardAlt, color: pensando ? T.accent : T.textMute }}>
            🧠 Pensar {capPensar === "sempre" ? "· sempre" : pensando ? "· ligado" : "· desligado"}
          </button>
          <span style={{ fontSize:10, color:T.textFaint, lineHeight:1.3 }}>{pensando ? "respostas melhores, mas levam de 30 s a 2 min" : "resposta direta e rápida"}</span>
        </div>
      )}
      {/* anexo selecionado (chip acima da caixa) */}
      {anexo && (
        <div style={{ display:"flex", alignItems:"center", gap:8, background:T.card, border:`1px solid ${T.accentBorder}`, borderRadius:10, padding:"7px 10px", marginBottom:8 }}>
          <span style={{ fontSize:13 }}>📎</span>
          <span style={{ flex:1, fontSize:11, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{anexo.nome}{anexo.truncado && <span style={{ color:T.amber }}> · grande — enviarei um trecho</span>}</span>
          <button onClick={()=>setAnexo(null)} style={{ width:24, height:24, borderRadius:6, border:"none", background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:11 }}>✕</button>
        </div>
      )}
      {/* caixa de envio */}
      <div style={{ display:"flex", gap:8 }}>
        <AnexoChat anexo={anexo} setAnexo={setAnexo} T={T}/>
        <BotaoAudioChat textoAtual={input} setTexto={setInput} onEstado={setOuvindo} T={T}/>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") enviar(); }}
          placeholder={ouvindo ? "🎙️ Ouvindo... pode falar" : "Pergunte, fale 🎤 ou anexe 📎..."}
          style={{ flex:1, minWidth:0, background:T.cardAlt, border:`1px solid ${T.borderSoft}`, borderRadius:12, color:T.text, padding:"12px 14px", fontSize:14, outline:"none" }}/>
        <button onClick={enviar} disabled={carregando||(!input.trim()&&!anexo)} style={{ width:48, borderRadius:12, border:"none", background: (input.trim()||anexo)&&!carregando?T.accent:T.border, color:"#fff", cursor: (input.trim()||anexo)&&!carregando?"pointer":"default", fontSize:18 }}>↑</button>
      </div>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// PAINEL DE CONFIGURAÇÕES (engrenagem)
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// VISUALIZADOR DE LOGS — histórico com filtros (tipo, direção, origem, data)
// ════════════════════════════════════════════════════════════════════════════
function VisualizadorLogs({ onClose, T }) {
  const [logs, setLogs] = useState(()=>lerLogs());
  const [fTipo, setFTipo] = useState("todos");
  const [fDir, setFDir] = useState("todos");
  const [fOrigem, setFOrigem] = useState("todos");
  const [fData, setFData] = useState(""); // YYYY-MM-DD
  const [expandido, setExpandido] = useState(null);

  useEffect(()=> inscreverLogs(setLogs), []);

  const TIPOS = { cotacao:{l:"Cotação",c:T.cyan,e:"💹"}, edicao:{l:"Edição",c:T.amber,e:"✏️"}, chat:{l:"Chat",c:T.accentSoft,e:"🤖"}, erro:{l:"Erro",c:T.red,e:"⚠️"}, sistema:{l:"Sistema",c:T.textMute,e:"⚙️"}, import:{l:"Import",c:T.green,e:"📋"} };
  const DIRS = { ida:{l:"Ida →",c:T.accent}, volta:{l:"← Volta",c:T.green}, interno:{l:"Interno",c:T.textMute} };
  const ORIGENS = { app:"App", api:"API brapi", servidor:"Servidor/IA" };

  const filtrados = logs.filter(l=>{
    if (fTipo!=="todos" && l.tipo!==fTipo) return false;
    if (fDir!=="todos" && l.direcao!==fDir) return false;
    if (fOrigem!=="todos" && l.origem!==fOrigem) return false;
    if (fData && !l.ts.startsWith(fData)) return false;
    return true;
  });

  const fmtHora = (ts) => { try { const d=new Date(ts); return d.toLocaleString("pt-BR",{ day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit" }); } catch { return ts; } };

  const Chip = ({ ativo, onClick, cor, children }) => (
    <button onClick={onClick} style={{ padding:"5px 10px", borderRadius:7, border:`1px solid ${ativo?(cor||T.accent):T.border}`, background:ativo?`${cor||T.accent}1a`:"transparent", color:ativo?(cor||T.accentSoft):T.textMute, fontSize:10, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>{children}</button>
  );

  return (
    <div onClick={onClose} className="modal-overlay" style={{ position:"fixed", inset:0, background:"#000b", zIndex:1200, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"12px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} className="modal-content" style={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16, width:"100%", maxWidth:520, maxHeight:"92vh", display:"flex", flexDirection:"column", boxShadow:"0 20px 60px #000c" }}>
        {/* cabeçalho */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"16px 18px", borderBottom:`1px solid ${T.border}` }}>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:T.text }}>🗂️ Histórico de logs</div>
            <div style={{ fontSize:10, color:T.textFaint }}>{filtrados.length} de {logs.length} registros</div>
          </div>
          <button onClick={onClose} style={{ width:34,height:34,borderRadius:8,border:`1px solid ${T.border}`,background:T.cardAlt,color:T.text,cursor:"pointer",fontSize:16 }}>✕</button>
        </div>

        {/* filtros */}
        <div style={{ padding:"12px 14px", borderBottom:`1px solid ${T.border}`, display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ fontSize:9, color:T.textFaint, textTransform:"uppercase", letterSpacing:1 }}>Tipo</div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            <Chip ativo={fTipo==="todos"} onClick={()=>setFTipo("todos")}>Todos</Chip>
            {Object.entries(TIPOS).map(([k,v])=><Chip key={k} ativo={fTipo===k} cor={v.c} onClick={()=>setFTipo(k)}>{v.e} {v.l}</Chip>)}
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <div style={{ flex:1, minWidth:130 }}>
              <div style={{ fontSize:9, color:T.textFaint, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Fluxo</div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                <Chip ativo={fDir==="todos"} onClick={()=>setFDir("todos")}>Todos</Chip>
                {Object.entries(DIRS).map(([k,v])=><Chip key={k} ativo={fDir===k} cor={v.c} onClick={()=>setFDir(k)}>{v.l}</Chip>)}
              </div>
            </div>
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div style={{ flex:1, minWidth:140 }}>
              <div style={{ fontSize:9, color:T.textFaint, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Origem</div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                <Chip ativo={fOrigem==="todos"} onClick={()=>setFOrigem("todos")}>Todas</Chip>
                {Object.entries(ORIGENS).map(([k,v])=><Chip key={k} ativo={fOrigem===k} onClick={()=>setFOrigem(k)}>{v}</Chip>)}
              </div>
            </div>
            <div>
              <div style={{ fontSize:9, color:T.textFaint, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Data</div>
              <input type="date" value={fData} onChange={e=>setFData(e.target.value)} style={{ background:T.cardAlt, border:`1px solid ${T.border}`, borderRadius:7, color:T.text, padding:"6px 8px", fontSize:11 }}/>
            </div>
          </div>
          {(fTipo!=="todos"||fDir!=="todos"||fOrigem!=="todos"||fData) && (
            <button onClick={()=>{ setFTipo("todos"); setFDir("todos"); setFOrigem("todos"); setFData(""); }} style={{ alignSelf:"flex-start", fontSize:10, color:T.accentSoft, background:"transparent", border:"none", cursor:"pointer", textDecoration:"underline" }}>limpar filtros</button>
          )}
        </div>

        {/* lista */}
        <div style={{ flex:1, overflowY:"auto", padding:"10px 12px" }}>
          {filtrados.length===0 ? (
            <div style={{ textAlign:"center", padding:"30px 0", fontSize:12, color:T.textFaint }}>Nenhum registro com esses filtros.</div>
          ) : filtrados.map(l=>{
            const tp = TIPOS[l.tipo] || TIPOS.sistema;
            const dr = DIRS[l.direcao] || DIRS.interno;
            const aberto = expandido===l.id;
            return (
              <div key={l.id} onClick={()=>setExpandido(aberto?null:l.id)} style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`3px solid ${tp.c}`, borderRadius:9, padding:"9px 11px", marginBottom:6, cursor:l.detalhe?"pointer":"default" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                    <span style={{ fontSize:9, color:tp.c, background:`${tp.c}1a`, padding:"1px 6px", borderRadius:4, fontWeight:700 }}>{tp.e} {tp.l}</span>
                    <span style={{ fontSize:8, color:dr.c }}>{dr.l}</span>
                    <span style={{ fontSize:8, color:T.textFaint }}>{ORIGENS[l.origem]||l.origem}</span>
                  </div>
                  <span style={{ fontSize:9, color:T.textFaint, whiteSpace:"nowrap" }}>{fmtHora(l.ts)}</span>
                </div>
                <div style={{ fontSize:11, color:T.textDim, marginTop:4 }}>{l.msg}</div>
                {l.detalhe && aberto && (
                  <pre style={{ fontSize:9, color:T.textMute, background:T.cardAlt, borderRadius:6, padding:"8px", marginTop:6, overflowX:"auto", whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{l.detalhe}</pre>
                )}
                {l.detalhe && !aberto && <div style={{ fontSize:8, color:T.textFaint, marginTop:3 }}>toque para ver detalhes</div>}
              </div>
            );
          })}
        </div>

        {/* rodapé */}
        <div style={{ padding:"10px 14px", borderTop:`1px solid ${T.border}`, display:"flex", gap:8 }}>
          <button onClick={()=>{ if(window.confirm("Apagar todo o histórico de logs?")) limparLogs(); }} style={{ flex:1, padding:"10px", borderRadius:9, border:`1px solid ${T.red}44`, background:`${T.red}10`, color:T.red, fontSize:12, fontWeight:600, cursor:"pointer" }}>🗑️ Limpar logs</button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ORGANIZAR BLOCOS — controles manuais da Camada 2 (mover/ordenar/ocultar)
// A base nunca muda: "Restaurar padrão" volta tudo à instalação original.
// ════════════════════════════════════════════════════════════════════════════
function OrganizarBlocos({ layoutBlocos, setLayoutBlocos, onClose, T }) {
  const PAGINAS = [
    { id:"painel",     lb:"🏠 Início" },
    { id:"analises",   lb:"🔬 Análises" },
    { id:"calendario", lb:"📅 Agenda" },
    { id:"ranking",    lb:"🏆 Ranking" },
    { id:"custovida",  lb:"🧾 Custo" },
  ];
  const cfg = (id) => {
    const def = BLOCOS_DEF.find(b=>b.id===id) || {};
    const c = (layoutBlocos||{})[id] || {};
    return { pagina: BLOCOS_PAGINAS.includes(c.pagina)?c.pagina:def.paginaPadrao, ordem: c.ordem??def.ordemPadrao, visivel: c.visivel!==false };
  };
  const setCfg = (id, patch) => setLayoutBlocos(prev=>({ ...(prev||{}), [id]: { ...cfg(id), ...patch } }));
  const mover = (id, dir) => {
    const c = cfg(id);
    const daPagina = BLOCOS_DEF.map(b=>({ ...b, ...cfg(b.id) })).filter(b=>b.pagina===c.pagina).sort((a,b)=>a.ordem-b.ordem);
    const idx = daPagina.findIndex(b=>b.id===id);
    const alvo = daPagina[idx+dir];
    if (!alvo) return;
    setLayoutBlocos(prev=>({ ...(prev||{}), [id]:{ ...c, ordem:alvo.ordem }, [alvo.id]:{ ...cfg(alvo.id), ordem:c.ordem } }));
  };
  const btn = (extra={}) => ({ width:30, height:30, borderRadius:8, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", ...extra });

  return (
    <div onClick={onClose} className="modal-overlay" style={{ position:"fixed", inset:0, background:"#000b", zIndex:1450, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"20px 12px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} className="modal-content" style={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16, width:"100%", maxWidth:460, padding:"20px", boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:18, fontWeight:800, color:T.text }}>🧩 Organizar blocos</div>
          <button onClick={onClose} style={{ width:34, height:34, borderRadius:8, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontSize:16 }}>✕</button>
        </div>
        <div style={{ fontSize:10, color:T.textFaint, marginBottom:14, lineHeight:1.5 }}>
          Mova blocos entre páginas, mude a ordem (↑ ↓) ou oculte (👁). A instalação padrão fica intacta — "Restaurar padrão" desfaz tudo.
        </div>

        {PAGINAS.map(pg=>{
          const lista = BLOCOS_DEF.map(b=>({ ...b, ...cfg(b.id) })).filter(b=>b.pagina===pg.id).sort((a,b)=>a.ordem-b.ordem);
          if (!lista.length) return null;
          return (
            <div key={pg.id} style={{ marginBottom:14 }}>
              <div style={{ fontSize:10, color:T.textMute, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6 }}>{pg.lb}</div>
              {lista.map((b,i)=>(
                <div key={b.id} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:11, padding:"10px 11px", marginBottom:6, opacity:b.visivel?1:0.55 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:15 }}>{b.emoji}</span>
                    <span style={{ flex:1, fontSize:12, fontWeight:700, color:T.text, minWidth:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{b.nome}</span>
                    <button onClick={()=>mover(b.id,-1)} disabled={i===0} style={btn({ opacity:i===0?0.35:1 })}>↑</button>
                    <button onClick={()=>mover(b.id,1)} disabled={i===lista.length-1} style={btn({ opacity:i===lista.length-1?0.35:1 })}>↓</button>
                    <button onClick={()=>setCfg(b.id,{ visivel:!b.visivel })} title={b.visivel?"Ocultar":"Mostrar"} style={btn()}>{b.visivel?"👁":"🚫"}</button>
                  </div>
                  {/* escolher a página do bloco */}
                  <div style={{ display:"flex", gap:5, marginTop:8, flexWrap:"wrap" }}>
                    {PAGINAS.map(p2=>(
                      <button key={p2.id} onClick={()=>setCfg(b.id,{ pagina:p2.id })} style={{ padding:"5px 9px", borderRadius:7, border:`1px solid ${b.pagina===p2.id?T.accent:T.border}`, background:b.pagina===p2.id?T.accent:T.cardAlt, color:b.pagina===p2.id?"#fff":T.textMute, cursor:"pointer", fontSize:9, fontWeight:700 }}>{p2.lb}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        <button onClick={()=>{ if(window.confirm("Restaurar a organização padrão de instalação dos blocos?")) setLayoutBlocos(null); }} style={{ width:"100%", padding:"11px", borderRadius:10, border:`1px solid ${T.accentBorder}`, background:T.accentBg, color:T.accentSoft, cursor:"pointer", fontSize:12, fontWeight:700 }}>♻️ Restaurar padrão de instalação</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// HISTÓRICO — compras/vendas (da planilha B3) e proventos recebidos com fiscal
// ════════════════════════════════════════════════════════════════════════════
function HistoricoCompleto({ ativos, proventosRecebidos, T }) {
  const [vista, setVista] = useState("proventos"); // proventos | compras
  const [filtroTicker, setFiltroTicker] = useState("TODOS");

  const regs = (proventosRecebidos?.registros || []);
  const totalLiq = proventosRecebidos?.total || 0;
  const totalBruto = proventosRecebidos?.totalBruto || 0;
  const totalImp = proventosRecebidos?.totalImposto || 0;

  // todas as movimentações de compra/venda, achatadas e ordenadas
  const movs = [];
  ativos.forEach(a => (a.movimentacoes||[]).forEach(mv => movs.push({ ...mv, ticker:a.ticker })));
  movs.sort((a,b)=> a.data < b.data ? 1 : -1);

  const tickers = ["TODOS", ...Array.from(new Set([...regs.map(r=>r.ticker), ...movs.map(m=>m.ticker)])).sort()];
  const regsF = filtroTicker==="TODOS" ? regs : regs.filter(r=>r.ticker===filtroTicker);
  const movsF = filtroTicker==="TODOS" ? movs : movs.filter(m=>m.ticker===filtroTicker);
  const dataBR = (iso) => { const [a,m,d] = String(iso||"").split("-"); return d? `${d}/${m}/${a}` : "—"; };
  const corTipo = (t) => /juros/i.test(t) ? T.amber : /rendimento/i.test(t) ? T.cyan : T.green;

  const semDados = regs.length===0 && movs.length===0;
  if (semDados) return (
    <div style={{ background:T.card, border:`2px dashed ${T.accentBorder}`, borderRadius:16, padding:"26px 18px", textAlign:"center" }}>
      <div style={{ fontSize:38, marginBottom:8 }}>🗂️</div>
      <div style={{ fontSize:15, fontWeight:800, color:T.text, marginBottom:6 }}>Nenhum histórico ainda</div>
      <div style={{ fontSize:11, color:T.textMute, lineHeight:1.6 }}>Importe a planilha de <strong>Movimentação da B3</strong> na tela ✏️ Editar (Importar em massa → Arquivo da B3). Ela traz suas compras, vendas e os proventos recebidos.<br/><br/>💡 Na B3, use o filtro de datas <strong>amplo</strong> (ex.: 01/jan do primeiro ano até hoje) — a exportação traz só o período filtrado.</div>
    </div>
  );

  return (
    <div>
      {/* resumo fiscal dos proventos */}
      {regs.length>0 && (
        <div style={{ display:"flex", gap:8, marginBottom:14 }}>
          <div style={{ flex:1, background:`${T.green}12`, border:`1px solid ${T.green}44`, borderRadius:12, padding:"11px 12px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Recebido (líquido)</div>
            <div style={{ fontSize:16, fontWeight:800, color:T.green }}>{fmt(totalLiq)}</div>
          </div>
          <div style={{ flex:1, background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"11px 12px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Bruto</div>
            <div style={{ fontSize:16, fontWeight:800, color:T.text }}>{fmt(totalBruto)}</div>
          </div>
          <div style={{ flex:1, background:`${T.amber}12`, border:`1px solid ${T.amber}44`, borderRadius:12, padding:"11px 12px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>IR retido (JCP)</div>
            <div style={{ fontSize:16, fontWeight:800, color:T.amber }}>{fmt(totalImp)}</div>
          </div>
        </div>
      )}

      {/* abas internas */}
      <div style={{ display:"flex", gap:6, marginBottom:10 }}>
        {[["proventos",`💰 Proventos (${regs.length})`],["compras",`🛒 Compras e vendas (${movs.length})`]].map(([id,lb])=>(
          <button key={id} onClick={()=>setVista(id)} style={{ flex:1, padding:"9px", borderRadius:9, border:`1px solid ${vista===id?T.accent:T.border}`, background: vista===id?T.accent:T.cardAlt, color: vista===id?"#fff":T.textMute, cursor:"pointer", fontSize:11, fontWeight:700 }}>{lb}</button>
        ))}
      </div>

      {/* filtro por ativo */}
      {tickers.length>2 && (
        <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:6, marginBottom:10 }}>
          {tickers.map(t=>(
            <button key={t} onClick={()=>setFiltroTicker(t)} style={{ flex:"0 0 auto", padding:"6px 11px", borderRadius:7, border:`1px solid ${filtroTicker===t?T.accent:T.border}`, background: filtroTicker===t?`${T.accent}18`:T.cardAlt, color: filtroTicker===t?T.accentSoft:T.textMute, cursor:"pointer", fontSize:10, fontWeight:700, whiteSpace:"nowrap" }}>{t}</button>
          ))}
        </div>
      )}

      {/* PROVENTOS */}
      {vista==="proventos" && (
        regsF.length===0 ? <div style={{ fontSize:11, color:T.textFaint, textAlign:"center", padding:20 }}>Nenhum provento neste filtro.</div> :
        <div>
          {regsF.map((r,i)=>(
            <div key={i} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:11, padding:"11px 13px", marginBottom:6 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:12, fontWeight:800, color:T.text, fontFamily:"monospace" }}>{r.ticker}</span>
                <span style={{ fontSize:9, color:corTipo(r.tipo), background:`${corTipo(r.tipo)}18`, padding:"2px 7px", borderRadius:5, fontWeight:700 }}>{r.tipo}</span>
                <span style={{ flex:1 }}/>
                <span style={{ fontSize:14, fontWeight:800, color:T.green }}>{fmt(r.valor)}</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:5, fontSize:9, color:T.textFaint }}>
                <span>📅 {dataBR(r.data)}</span>
                {r.tributavel && r.imposto>0 && (
                  <span style={{ color:T.amber }}>Bruto {fmt(r.bruto)} · IR {(r.aliquota*100).toFixed(1)}% = −{fmt(r.imposto)}</span>
                )}
                {!r.tributavel && <span style={{ color:T.green }}>✓ Isento de IR</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* COMPRAS E VENDAS */}
      {vista==="compras" && (
        movsF.length===0 ? <div style={{ fontSize:11, color:T.textFaint, textAlign:"center", padding:20 }}>Nenhuma movimentação neste filtro.</div> :
        <div>
          {movsF.map((m,i)=>{
            const compra = m.qtd > 0;
            return (
              <div key={i} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:11, padding:"11px 13px", marginBottom:6 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:13 }}>{compra?"🟢":"🔴"}</span>
                  <span style={{ fontSize:12, fontWeight:800, color:T.text, fontFamily:"monospace" }}>{m.ticker}</span>
                  <span style={{ fontSize:9, color: compra?T.green:T.red, background:`${compra?T.green:T.red}18`, padding:"2px 7px", borderRadius:5, fontWeight:700 }}>{compra?"Compra":"Venda"}</span>
                  <span style={{ flex:1 }}/>
                  <span style={{ fontSize:13, fontWeight:800, color:T.text }}>{fmt(Math.abs(m.qtd)*(m.preco||0))}</span>
                </div>
                <div style={{ display:"flex", gap:10, marginTop:5, fontSize:9, color:T.textFaint }}>
                  <span>📅 {dataBR(m.data)}</span>
                  <span>{Math.abs(m.qtd)} × {m.preco ? fmt(m.preco) : "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize:9, color:T.textFaint, textAlign:"center", marginTop:14, lineHeight:1.6 }}>
        Dados extraídos da planilha de Movimentação da B3.<br/>
        Regra fiscal: dividendos e rendimentos de FII são isentos para pessoa física; JCP tem IR retido na fonte (15% até 2025, 17,5% a partir de 2026).
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DE VOZ (TTS) — escolher voz, velocidade e tom + testar
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DA IA — servidor, modelo do LM Studio e instruções (system prompt)
// Fica salva no APARELHO (vale para todas as contas), igual ao endereço do servidor.
// Usada em dois lugares: popup do status do chat e ⚙️ Configurações → Servidor de IA.
// ════════════════════════════════════════════════════════════════════════════
const IA_MODELO_KEY = "carteiraProventos_iaModelo";
const IA_INSTR_KEY = "carteiraProventos_iaInstrucoes";
const INSTRUCOES_PADRAO_IA = "Você é o assistente do app Carteira Proventos. Responda em português do Brasil, de forma direta e objetiva, com no máximo 3 frases. Use os dados reais fornecidos. NUNCA recomende compra/venda.";
// Modelos que pensam (pelo nome/apelido no llama-swap):
//  "sempre"   → DeepSeek R1 (não dá para desligar)
//  "opcional" → Qwen3 (liga/desliga com /think e /no_think)
//  "nao"      → os demais (ex.: Qwen2.5 = "carteira")
function capacidadePensar(modelo) {
  const m = String(modelo || "").toLowerCase();
  if (/deepseek|(^|[^a-z])r1([^0-9]|$)/.test(m)) return "sempre";
  if (/qwen-?3/.test(m)) return "opcional";
  return "nao";
}
const lerTextoAparelho = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const gravarTextoAparelho = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* sem acesso */ } };

function ConfigModeloIA({ bridgeUrl, iaModelo, setIaModelo, iaInstrucoes, setIaInstrucoes, T }) {
  const [modelos, setModelos] = useState(null);
  const [estado, setEstado] = useState(null);
  const [rascunho, setRascunho] = useState(iaInstrucoes || "");
  useEffect(() => setRascunho(iaInstrucoes || ""), [iaInstrucoes]);
  const carregar = async () => {
    setEstado({ t: "carregando" });
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
      const r = await fetch(`${bridgeUrl}/modelos`, { signal: c.signal }); clearTimeout(t);
      if (r.status === 404) { setEstado({ t: "erro", msg: "O servidor do PC ainda não tem a rota /modelos. Atualize o server.js (veja a mensagem de entrega) e reinicie." }); return; }
      const d = await r.json();
      if (!d.ok) throw new Error(d.erro || "sem resposta do LM Studio");
      setModelos(d.modelos || []);
      setEstado({ t: "ok", msg: `${(d.modelos || []).length} modelo(s) no LM Studio${d.padrao ? ` · padrão do servidor: ${d.padrao}` : ""}` });
    } catch (e) { setEstado({ t: "erro", msg: `Não consegui listar os modelos: ${e.name === "AbortError" ? "tempo esgotado" : e.message}` }); }
  };
  const campo = { width:"100%", background:T.cardAlt, border:`1px solid ${T.borderSoft}`, borderRadius:8, color:T.text, padding:"9px 11px", fontSize:12, outline:"none" };
  const mudou = (rascunho || "").trim() !== (iaInstrucoes || "").trim();
  return (
    <div>
      <div style={{ fontSize:11, fontWeight:700, color:T.textDim, margin:"14px 0 6px" }}>Modelo do LM Studio</div>
      <div style={{ display:"flex", gap:6 }}>
        <input value={iaModelo || ""} onChange={e=>setIaModelo(e.target.value.trim())} placeholder="padrão do servidor" style={{ ...campo, flex:1, minWidth:0, fontFamily:"monospace" }}/>
        <button onClick={carregar} style={{ flexShrink:0, padding:"0 12px", borderRadius:8, border:`1px solid ${T.accent}66`, background:`${T.accent}12`, color:T.accent, fontWeight:700, fontSize:11.5, cursor:"pointer" }}>{estado && estado.t === "carregando" ? "⏳" : "↻ Listar"}</button>
      </div>
      {modelos && modelos.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:5, marginTop:8 }}>
          <button onClick={()=>setIaModelo("")} style={{ textAlign:"left", padding:"8px 10px", borderRadius:8, cursor:"pointer", fontSize:11.5, border:`1px solid ${!iaModelo ? T.accent : T.border}`, background: !iaModelo ? `${T.accent}14` : T.card, color:T.text }}>{!iaModelo ? "● " : "○ "}Padrão do servidor</button>
          {modelos.map(m => (
            <button key={m} onClick={()=>setIaModelo(m)} style={{ textAlign:"left", padding:"8px 10px", borderRadius:8, cursor:"pointer", fontSize:11.5, fontFamily:"monospace", wordBreak:"break-all", border:`1px solid ${iaModelo === m ? T.accent : T.border}`, background: iaModelo === m ? `${T.accent}14` : T.card, color:T.text }}>{iaModelo === m ? "● " : "○ "}{m}</button>
          ))}
        </div>
      )}
      {estado && estado.msg && <div style={{ fontSize:10.5, marginTop:6, lineHeight:1.45, color: estado.t === "erro" ? T.red : T.textMute }}>{estado.msg}</div>}

      <div style={{ fontSize:11, fontWeight:700, color:T.textDim, margin:"16px 0 6px" }}>Instruções do agente (System Prompt)</div>
      <textarea value={rascunho} onChange={e=>setRascunho(e.target.value)} rows={7} placeholder={INSTRUCOES_PADRAO_IA}
        style={{ ...campo, resize:"vertical", lineHeight:1.45, fontFamily:"inherit" }}/>
      <div style={{ display:"flex", gap:6, marginTop:6 }}>
        <button onClick={()=>setIaInstrucoes(rascunho.trim())} disabled={!mudou} style={{ flex:1, padding:"10px", borderRadius:9, border:"none", background: mudou ? T.accent : T.border, color:"#fff", fontWeight:800, fontSize:12, cursor: mudou ? "pointer" : "default" }}>{mudou ? "💾 Salvar instruções" : "✓ Salvo"}</button>
        <button onClick={()=>{ setRascunho(""); setIaInstrucoes(""); }} title="Volta para as instruções padrão do servidor" style={{ padding:"10px 12px", borderRadius:9, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.textMute, fontSize:12, cursor:"pointer" }}>♻️ Padrão</button>
      </div>
      <div style={{ fontSize:10, color:T.textFaint, marginTop:6, lineHeight:1.5 }}>
        Vazio = usa as instruções padrão (texto de exemplo acima). Os dados da sua carteira continuam sendo enviados junto, depois das instruções. Modelo e instruções valem a partir da próxima mensagem e precisam do server.js atualizado no PC.
      </div>
    </div>
  );
}

function ModalServidorIA({ bridgeUrl, setBridgeUrl, iaModelo, setIaModelo, iaInstrucoes, setIaInstrucoes, onClose, T }) {
  const [url, setUrl] = useState(bridgeUrl);
  const [teste, setTeste] = useState(null);
  const testar = async () => {
    const alvo = normalizarUrlServidor(url);
    setBridgeUrl(alvo);
    setTeste({ t:"testando", msg:`Testando ${alvo}…` });
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 6000);
      const r = await fetch(`${alvo}/health`, { signal: c.signal }); clearTimeout(t);
      const d = await r.json().catch(() => ({}));
      setTeste({ t: r.ok ? "ok" : "erro", msg: r.ok ? `✅ Conectado${d && (d.nome || d.name || d.servidor) ? ` · ${d.nome || d.name || d.servidor}` : ""}` : `❌ HTTP ${r.status}` });
    } catch (e) { setTeste({ t:"erro", msg:`❌ Não conectou: ${e.name === "AbortError" ? "tempo esgotado (PC ligado? Tailscale ativo?)" : e.message}` }); }
  };
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"#000b", zIndex:1600, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:T.bg, borderRadius:"20px 20px 0 0", width:"100%", maxWidth:460, maxHeight:"88vh", overflowY:"auto", padding:"18px 18px 28px" }}>
        <div style={{ width:38, height:4, borderRadius:2, background:T.border, margin:"0 auto 14px" }}/>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <strong style={{ fontSize:16, color:T.text }}>🤖 Servidor e modelo da IA</strong>
          <button onClick={onClose} aria-label="Fechar" style={{ background:"none", border:"none", fontSize:20, color:T.textMute, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ fontSize:11, fontWeight:700, color:T.textDim, margin:"6px 0 6px" }}>Endereço do servidor (AI Bridge)</div>
        <div style={{ display:"flex", gap:6 }}>
          <input value={url} onChange={e=>setUrl(e.target.value)} onBlur={()=>setBridgeUrl(url)} placeholder="100.100.195.84:4000"
            style={{ flex:1, minWidth:0, background:T.cardAlt, border:`1px solid ${T.borderSoft}`, borderRadius:8, color:T.text, padding:"9px 11px", fontSize:12, outline:"none", fontFamily:"monospace" }}/>
          <button onClick={testar} style={{ flexShrink:0, padding:"0 12px", borderRadius:8, border:`1px solid ${T.green}66`, background:`${T.green}12`, color:T.green, fontWeight:700, fontSize:11.5, cursor:"pointer" }}>🔌 Testar</button>
        </div>
        {teste && <div style={{ fontSize:11, marginTop:6, color: teste.t === "erro" ? T.red : teste.t === "ok" ? T.green : T.textMute }}>{teste.msg}</div>}
        <ConfigModeloIA bridgeUrl={normalizarUrlServidor(url)} iaModelo={iaModelo} setIaModelo={setIaModelo} iaInstrucoes={iaInstrucoes} setIaInstrucoes={setIaInstrucoes} T={T}/>
        <div style={{ fontSize:10, color:T.textFaint, marginTop:12 }}>Também em ⚙️ Configurações → Servidor de IA.</div>
      </div>
    </div>
  );
}

function ConfigVoz({ onClose, T }) {
  const nativo = !!window.Capacitor?.isNativePlatform?.();
  const [vozes, setVozes] = useState([]);
  const [cfg, setCfg] = useState(()=>lerSalvo("vozTTS", { rate:1, pitch:1, voice:null, nomeVoz:null }));
  const salvar = (novo) => { const c={ ...cfg, ...novo }; setCfg(c); gravarSalvo("vozTTS", c); };

  useEffect(()=>{ (async()=>{
    try {
      if (nativo) {
        const m = await import("@capacitor-community/text-to-speech");
        const r = await m.TextToSpeech.getSupportedVoices();
        const todas = r?.voices || [];
        // prioriza vozes em português
        const pt = todas.map((v,i)=>({ ...v, _idx:i })).filter(v=>/pt/i.test(v.lang||""));
        setVozes(pt.length?pt:todas.map((v,i)=>({ ...v, _idx:i })));
      } else {
        const synth = window.speechSynthesis;
        const carregar = ()=>{ const all = synth.getVoices(); setVozes(all.filter(v=>/pt/i.test(v.lang)).length?all.filter(v=>/pt/i.test(v.lang)):all); };
        carregar(); synth.onvoiceschanged = carregar;
      }
    } catch {}
  })(); }, []);

  const testar = async () => {
    const txt = "Olá! Esta é a voz que vai ler as respostas da sua carteira de proventos.";
    try {
      if (nativo) {
        const m = await import("@capacitor-community/text-to-speech");
        await m.TextToSpeech.stop();
        await m.TextToSpeech.speak({ text:txt, lang:"pt-BR", rate:cfg.rate, pitch:cfg.pitch, volume:1, ...(Number.isInteger(cfg.voice)?{ voice:cfg.voice }:{}) });
      } else {
        const synth = window.speechSynthesis; synth.cancel();
        const u = new SpeechSynthesisUtterance(txt); u.lang="pt-BR"; u.rate=cfg.rate; u.pitch=cfg.pitch;
        if (cfg.nomeVoz){ const vz = synth.getVoices().find(v=>v.name===cfg.nomeVoz); if (vz) u.voice=vz; }
        synth.speak(u);
      }
    } catch { window.alert("Não consegui testar a voz neste aparelho."); }
  };

  const slider = (label, prop, min, max) => (
    <div style={{ marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.textMute, marginBottom:5 }}>
        <span>{label}</span><span style={{ fontWeight:700, color:T.text }}>{(cfg[prop]||1).toFixed(2)}×</span>
      </div>
      <input type="range" min={min} max={max} step={0.05} value={cfg[prop]||1} onChange={e=>salvar({ [prop]:parseFloat(e.target.value) })} style={{ width:"100%", accentColor:T.accent }}/>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"#000b", zIndex:1600, display:"flex", alignItems:"flex-end", justifyContent:"center", padding:0 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:T.bg, borderRadius:"20px 20px 0 0", width:"100%", maxWidth:460, maxHeight:"85vh", overflowY:"auto", padding:"18px 18px 26px" }}>
        <div style={{ width:38, height:4, borderRadius:2, background:T.border, margin:"0 auto 14px" }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <div style={{ fontSize:16, fontWeight:800, color:T.text }}>🗣️ Voz da leitura</div>
          <button onClick={onClose} style={{ width:32, height:32, borderRadius:8, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontSize:15 }}>✕</button>
        </div>

        <div style={{ fontSize:10, color:T.textMute, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Voz {vozes.length?`(${vozes.length})`:""}</div>
        {vozes.length===0 ? (
          <div style={{ fontSize:11, color:T.textFaint, marginBottom:12, lineHeight:1.6 }}>Nenhuma voz em português encontrada. No Android, instale/atualize a "Fala do Google" em Configurações → Sistema → Idiomas → Saída de conversão de texto em voz — as vozes pt-BR de lá são bem mais naturais.</div>
        ) : (
          <div style={{ maxHeight:180, overflowY:"auto", marginBottom:12 }}>
            {vozes.map((v,i)=>{
              const sel = nativo ? cfg.voice===v._idx : cfg.nomeVoz===v.name;
              return (
                <button key={i} onClick={()=> nativo ? salvar({ voice:v._idx }) : salvar({ nomeVoz:v.name })}
                  style={{ display:"flex", alignItems:"center", gap:8, width:"100%", textAlign:"left", padding:"10px 12px", marginBottom:5, borderRadius:9, cursor:"pointer",
                    border:`1px solid ${sel?T.accent:T.border}`, background: sel?`${T.accent}14`:T.card, color:T.text, fontSize:12 }}>
                  <span>{sel?"🔘":"⚪"}</span>
                  <span style={{ flex:1, minWidth:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{v.name || v.voiceURI || "Voz "+(i+1)}</span>
                  <span style={{ fontSize:9, color:T.textFaint }}>{v.lang}</span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ fontSize:10, color:T.textMute, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Ajustes</div>
        {slider("Velocidade", "rate", 0.5, 2)}
        {slider("Tom (grave ↔ agudo)", "pitch", 0.5, 2)}

        <div style={{ display:"flex", gap:8, marginTop:16 }}>
          <button onClick={testar} style={{ flex:1, padding:"13px", borderRadius:10, border:`1px solid ${T.accent}`, background:`${T.accent}14`, color:T.accentSoft, cursor:"pointer", fontSize:12, fontWeight:700 }}>▶️ Testar voz</button>
          <button onClick={()=>{ gravarSalvo("vozTTS", { rate:1, pitch:1, voice:null, nomeVoz:null }); setCfg({ rate:1, pitch:1, voice:null, nomeVoz:null }); }} style={{ padding:"13px 16px", borderRadius:10, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:12, fontWeight:700 }}>♻️</button>
          <button onClick={onClose} style={{ flex:1, padding:"13px", borderRadius:10, border:"none", background:T.accent, color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700 }}>✓ Pronto</button>
        </div>
      </div>
    </div>
  );
}

function PainelConfig({ T, temaId, setTemaId, layout, setLayout, fontEsc, setFontEsc, densidade, setDensidade, bridgeUrl, setBridgeUrl, iaModelo = "", setIaModelo = ()=>{}, iaInstrucoes = "", setIaInstrucoes = ()=>{}, onResetDados, onResetApp, onDesfazerDados, onExportar, onImportar, onExportarPDF, onOrganizarBlocos, onRemodelar, usuario, onLogout, metaPatrimonio = 0, setMetaPatrimonio = ()=>{}, onClose }) {
  const [showLogs, setShowLogs] = useState(false);
  const [showVoz, setShowVoz] = useState(false);
  // ponte da IA: rascunho local (salva ao sair do campo ou ao testar)
  const [rascunhoBridge, setRascunhoBridge] = useState(bridgeUrl);
  useEffect(() => setRascunhoBridge(bridgeUrl), [bridgeUrl]);
  const [testeConexao, setTesteConexao] = useState(null);
  const testarConexaoIA = async () => {
    const url = normalizarUrlServidor(rascunhoBridge);
    setBridgeUrl(url);
    setTesteConexao({ status:"testando", url });
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`${url}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      setTesteConexao(r.ok
        ? { status:"ok", url, detalhe:`Resposta HTTP ${r.status}. Endereço salvo neste aparelho.` }
        : { status:"erro", url, detalhe:`O servidor respondeu HTTP ${r.status}. Confira a porta (4000) e se o AI Bridge está rodando.` });
    } catch (e) {
      setTesteConexao({ status:"erro", url, detalhe: e && e.name === "AbortError"
        ? "Tempo esgotado (6s). O servidor não respondeu: o PC está ligado e o AI Bridge rodando?"
        : `${e && e.message ? e.message : "falha de rede"}. Confira se o Tailscale está ligado NESTE aparelho e se o endereço está certo.` });
    }
  };
  const [secAberta, setSecAberta] = useState(null); // tudo fechado ao abrir; toque para expandir
  // uso de armazenamento local (dados do app no aparelho)
  const usoStorage = (() => {
    try { let t=0; Object.keys(localStorage).forEach(k=>{ if(k.startsWith(PREFIXO)) t += (localStorage.getItem(k)||"").length; }); return (t/1024).toFixed(1)+" KB"; }
    catch(e){ return "—"; }
  })();

  const Opcao = ({ ativo, onClick, children, cor }) => (
    <button onClick={onClick} style={{
      flex:"1 1 0", padding:"12px 8px", borderRadius:10, cursor:"pointer",
      border:`2px solid ${ativo ? (cor||T.accent) : T.border}`,
      background: ativo ? `${cor||T.accent}1a` : T.cardAlt,
      color: ativo ? (cor||T.accentSoft) : T.textMute,
      fontSize:13, fontWeight:600, transition:"all 0.15s",
      display:"flex", flexDirection:"column", alignItems:"center", gap:4
    }}>{children}</button>
  );
  const mini = (t) => <div style={{ fontSize:10, color:T.textMute, fontWeight:700, margin:"12px 0 8px", textTransform:"uppercase", letterSpacing:0.5 }}>{t}</div>;
  const nota = (t) => <div style={{ fontSize:9, color:T.textFaint, marginTop:6, lineHeight:1.5 }}>{t}</div>;

  // sanfona como FUNÇÃO (não componente) — evita remontagem e perda de foco no input
  const sanfona = ({ id, emoji, titulo, sub, children }) => {
    const aberta = secAberta===id;
    return (
      <div key={id} style={{ border:`1px solid ${aberta?T.accentBorder:T.border}`, borderRadius:12, marginBottom:10, overflow:"hidden", background:T.card }}>
        <button onClick={()=>setSecAberta(aberta?null:id)} style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"13px 14px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}>
          <span style={{ fontSize:17 }}>{emoji}</span>
          <span style={{ flex:1, minWidth:0 }}>
            <span style={{ display:"block", fontSize:13, fontWeight:800, color:T.text }}>{titulo}</span>
            <span style={{ display:"block", fontSize:9, color:T.textFaint, marginTop:1 }}>{sub}</span>
          </span>
          <span style={{ fontSize:11, color:T.textMute, transform:aberta?"rotate(90deg)":"none", transition:"transform 0.2s" }}>▶</span>
        </button>
        {aberta && <div style={{ padding:"2px 14px 14px" }}>{children}</div>}
      </div>
    );
  };

  return (
    <div onClick={onClose} className="modal-overlay" style={{
      position:"fixed", inset:0, background:"#000a", zIndex:1000,
      display:"flex", alignItems:"flex-start", justifyContent:"center",
      padding:"20px 12px", overflowY:"auto"
    }}>
      <div onClick={e=>e.stopPropagation()} className="modal-content" style={{
        background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16,
        width:"100%", maxWidth:440, padding:"20px", boxShadow:"0 20px 60px #000c"
      }}>
        {/* cabeçalho */}
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
          <div style={{ fontSize:18,fontWeight:800,color:T.text }}>⚙️ Configurações</div>
          <button onClick={onClose} style={{ width:34,height:34,borderRadius:8,border:`1px solid ${T.border}`,background:T.cardAlt,color:T.text,cursor:"pointer",fontSize:16 }}>✕</button>
        </div>

        {/* ═══ 🎨 APARÊNCIA ═══ */}
        {sanfona({ id:"aparencia", emoji:"🎨", titulo:"Aparência", sub:"Tema, exibição, fonte e densidade", children:(<>
          {mini("Tema de cores")}
          <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:6, scrollSnapType:"x mandatory" }}>
            {Object.entries(TEMAS).map(([id,tema])=>(
              <div key={id} style={{ flex:"0 0 auto", width:104, scrollSnapAlign:"start", display:"flex" }}>
                <Opcao ativo={temaId===id} onClick={()=>setTemaId(id)}>
                  <span style={{ fontSize:22 }}>{tema.emoji}</span>
                  <span style={{ fontSize:11, whiteSpace:"nowrap" }}>{tema.nome}</span>
                </Opcao>
              </div>
            ))}
          </div>

          {mini("Modo de exibição")}
          <div style={{ display:"flex",gap:8 }}>
            <Opcao ativo={layout==="celular"} onClick={()=>setLayout("celular")} cor={T.accent}>
              <span style={{ fontSize:22 }}>📱</span>
              <span>Celular</span>
              <span style={{ fontSize:9,color:T.textFaint }}>Toque · vertical</span>
            </Opcao>
            <Opcao ativo={layout==="tv"} onClick={()=>setLayout("tv")} cor={T.green}>
              <span style={{ fontSize:22 }}>📺</span>
              <span>TV</span>
              <span style={{ fontSize:9,color:T.textFaint }}>Mouse · ampliado</span>
            </Opcao>
          </div>
          {layout==="tv" && (
            <div style={{ marginTop:8,background:`${T.green}14`,border:`1px solid ${T.green}44`,borderRadius:8,padding:"8px 10px" }}>
              <div style={{ fontSize:10,color:T.green,lineHeight:1.6 }}>
                📺 Modo TV ativo: tudo maior e centralizado. Use teclado e mouse emparelhados na TV para navegar.
              </div>
            </div>
          )}

          {mini("Tamanho da fonte")}
          <div style={{ display:"flex",gap:6 }}>
            {[
              {v:0.85,l:"P",nome:"Pequeno"},
              {v:1,   l:"M",nome:"Médio"},
              {v:1.15,l:"G",nome:"Grande"},
              {v:1.35,l:"GG",nome:"Extra"},
            ].map(o=>(
              <Opcao key={o.v} ativo={fontEsc===o.v} onClick={()=>setFontEsc(o.v)}>
                <span style={{ fontSize:16+o.v*4,fontWeight:800,lineHeight:1 }}>{o.l}</span>
                <span style={{ fontSize:9 }}>{o.nome}</span>
              </Opcao>
            ))}
          </div>

          {mini("Densidade dos elementos")}
          <div style={{ display:"flex",gap:8 }}>
            <Opcao ativo={densidade==="compacto"} onClick={()=>setDensidade("compacto")}>
              <span style={{ fontSize:18 }}>▤</span>
              <span>Compacto</span>
            </Opcao>
            <Opcao ativo={densidade==="confortavel"} onClick={()=>setDensidade("confortavel")}>
              <span style={{ fontSize:18 }}>☰</span>
              <span>Confortável</span>
            </Opcao>
          </div>
        </>)})}

        {/* ═══ 🧩 PÁGINAS E BLOCOS ═══ */}
        {sanfona({ id:"blocos", emoji:"🧩", titulo:"Páginas e blocos", sub:"Mova, ordene e oculte os blocos do app", children:(<>
          <button onClick={onRemodelar} style={{
            width:"100%", padding:"13px", borderRadius:10, cursor:"pointer", marginTop:8,
            border:"none", background:T.accent, color:"#fff", fontSize:13, fontWeight:800
          }}>🎨 Remodelar o app (edição visual)</button>
          {nota("Abre o painel com um ✏️ em cada elemento personalizável. Toque no lápis para mudar tamanho, cor, fonte, fundo, cantos, animação e mais.")}
          <button onClick={onOrganizarBlocos} style={{
            width:"100%", padding:"12px", borderRadius:10, cursor:"pointer", marginTop:12,
            border:`1px solid ${T.cyan}66`, background:`${T.cyan}14`, color:T.cyan, fontSize:13, fontWeight:700
          }}>🧩 Organizar blocos das páginas</button>
          {nota("Mova blocos entre Painel, Análises, Agenda, Ranking e Custo de vida; mude a ordem (↑↓) ou oculte. A IA também organiza por comando no chat. \"Restaurar padrão\" desfaz tudo.")}
        </>)})}

        {/* ═══ 🤖 SERVIDOR DE IA ═══ */}
        {sanfona({ id:"ia", emoji:"🤖", titulo:"Servidor de IA", sub:"Servidor, modelo, instruções e voz", children:(<>
          {mini("Endereço do servidor")}
          <input value={rascunhoBridge} onChange={e=>setRascunhoBridge(e.target.value)}
            onBlur={()=>setBridgeUrl(rascunhoBridge)}
            placeholder="100.100.195.84:4000"
            style={{ width:"100%", background:T.cardAlt, border:`1px solid ${T.borderSoft}`, borderRadius:8, color:T.text, padding:"9px 11px", fontSize:12, outline:"none", fontFamily:"monospace" }}/>
          <button onClick={testarConexaoIA} style={{ width:"100%", padding:"11px", borderRadius:10, cursor:"pointer", marginTop:10, border:`1px solid ${T.green}66`, background:`${T.green}12`, color:T.green, fontSize:12, fontWeight:700 }}>🔌 Testar conexão agora</button>
          {testeConexao && (
            <div style={{ marginTop:8, padding:"9px 11px", borderRadius:9, fontSize:10, lineHeight:1.5, color:T.text, background: testeConexao.status==="ok" ? `${T.green}14` : testeConexao.status==="erro" ? `${T.red}14` : T.cardAlt, border:`1px solid ${testeConexao.status==="ok" ? T.green : testeConexao.status==="erro" ? T.red : T.border}55` }}>
              {testeConexao.status==="testando" ? "⏳ Testando " : testeConexao.status==="ok" ? "✅ Conectado em " : "❌ Não conectou em "}<strong>{testeConexao.url}</strong>
              {testeConexao.detalhe && <div style={{ color:T.textMute, marginTop:3 }}>{testeConexao.detalhe}</div>}
            </div>
          )}
          {nota("Endereço do PC (Tailscale ou rede local) + porta 4000. Fica salvo neste aparelho e vale para todas as contas. Pode digitar sem http:// — o app completa.")}
          <ConfigModeloIA bridgeUrl={bridgeUrl} iaModelo={iaModelo} setIaModelo={setIaModelo} iaInstrucoes={iaInstrucoes} setIaInstrucoes={setIaInstrucoes} T={T}/>
          <button onClick={()=>setShowVoz(true)} style={{ width:"100%", padding:"12px", borderRadius:10, cursor:"pointer", marginTop:12, border:`1px solid ${T.accent}55`, background:`${T.accent}12`, color:T.accentSoft, fontSize:13, fontWeight:700 }}>🗣️ Configurar voz da leitura (TTS)</button>
          {nota("Escolha a voz, a velocidade e o tom que a IA usa ao ler as respostas em voz alta. Toque em 🔊 Ouvir nas respostas do chat.")}
        </>)})}

        {/* ═══ 💾 DADOS E BACKUP ═══ */}
        {sanfona({ id:"dados", emoji:"💾", titulo:"Dados e backup", sub:"Exportar, importar e relatório PDF", children:(<>
          {mini("Meta de patrimônio")}
          <input defaultValue={metaPatrimonio > 0 ? String(metaPatrimonio).replace(".", ",") : ""} inputMode="decimal" placeholder="ex.: 50.000"
            onBlur={e=>setMetaPatrimonio(parseValorBR(e.target.value))}
            style={{ width:"100%", background:T.cardAlt, border:`1px solid ${T.borderSoft}`, borderRadius:8, color:T.text, padding:"9px 11px", fontSize:13, outline:"none", marginBottom:4 }}/>
          {nota("Aparece como \"% da meta\" no cartão do patrimônio, na tela inicial. Deixe vazio para remover.")}
          <div style={{ background:`${T.green}10`, border:`1px solid ${T.green}33`, borderRadius:10, padding:"10px 12px", marginTop:8, marginBottom:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              <span style={{ fontSize:16 }}>✓</span>
              <div style={{ fontSize:11, color:T.green, fontWeight:700 }}>Salvamento automático ativado</div>
            </div>
            <div style={{ fontSize:10, color:T.textMute, marginTop:4, lineHeight:1.5 }}>
              Edições, metas e preferências ficam gravadas no aparelho e voltam ao reabrir o app.
            </div>
          </div>
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={onExportar} style={{
              flex:1, padding:"10px", borderRadius:10, cursor:"pointer",
              border:`1px solid ${T.green}55`, background:`${T.green}12`, color:T.green, fontSize:12, fontWeight:600
            }}>⬇️ Exportar backup</button>
            <button onClick={onImportar} style={{
              flex:1, padding:"10px", borderRadius:10, cursor:"pointer",
              border:`1px solid ${T.cyan}55`, background:`${T.cyan}12`, color:T.cyan, fontSize:12, fontWeight:600
            }}>⬆️ Importar backup</button>
          </div>
          {nota("Exporta um arquivo com todos os seus dados (ativos, metas, custo de vida). Guarde-o para restaurar se trocar de aparelho.")}
          <button onClick={onExportarPDF} style={{
            width:"100%", padding:"11px", borderRadius:10, cursor:"pointer", marginTop:10,
            border:`1px solid ${T.accent}`, background:T.accent, color:"#fff", fontSize:12, fontWeight:700
          }}>📄 Gerar relatório PDF da carteira</button>
          {nota("PDF com patrimônio, dividendos, composição, lista de ativos e metas — pronto para guardar, imprimir ou compartilhar.")}
        </>)})}

        {/* ═══ 🗂️ DIAGNÓSTICO ═══ */}
        {sanfona({ id:"diagnostico", emoji:"🗂️", titulo:"Diagnóstico", sub:"Histórico de logs do app", children:(<>
          <button onClick={()=>setShowLogs(true)} style={{
            width:"100%", padding:"12px", borderRadius:10, cursor:"pointer", marginTop:8,
            border:`1px solid ${T.accent}55`, background:`${T.accent}12`, color:T.accentSoft, fontSize:13, fontWeight:700
          }}>🗂️ Ver histórico de logs</button>
          {nota("Registra tudo: cotações, edições, chat e erros — com filtros por tipo, fluxo, origem e data. Útil para entender onde algo falha.")}
        </>)})}

        {/* ═══ 🛟 SEGURANÇA E RESET ═══ */}
        {sanfona({ id:"seguranca", emoji:"🛟", titulo:"Segurança e reset", sub:"Resets separados: aparência ou dados", children:(<>
          <button onClick={onResetApp} style={{
            width:"100%", padding:"11px", borderRadius:10, cursor:"pointer", marginTop:8,
            border:`1px solid ${T.accentBorder}`, background:T.accentBg, color:T.accentSoft, fontSize:12, fontWeight:700
          }}>🎨 Resetar aparência do app</button>
          {nota("Volta tema, layout, densidade, fonte e blocos ao padrão de instalação. NÃO mexe nos dados da carteira.")}

          <button onClick={onDesfazerDados} style={{
            width:"100%", padding:"11px", borderRadius:10, cursor:"pointer", marginTop:12,
            border:`1px solid ${T.amber}77`, background:`${T.amber}14`, color:T.amber, fontSize:12, fontWeight:700
          }}>↩️ Desfazer última alteração de dados</button>
          {nota("Restaura os dados da carteira do backup guardado antes do último reset ou alteração grave (inclusive edições da IA).")}

          <button onClick={onResetDados} style={{
            width:"100%", padding:"11px", borderRadius:10, cursor:"pointer", marginTop:12,
            border:`1px solid ${T.red}55`, background:`${T.red}12`, color:T.red, fontSize:12, fontWeight:700
          }}>🗑️ Resetar dados da carteira</button>
          {nota("Volta ativos, metas e custo de vida ao início — guardando um backup para desfazer. NÃO mexe na aparência.")}
        </>)})}

        {/* ═══ ℹ️ SOBRE ═══ */}
        {sanfona({ id:"sobre", emoji:"ℹ️", titulo:"Sobre o app", sub:"Versão e armazenamento", children:(<>
          <div style={{ display:"flex", gap:8, marginTop:8 }}>
            <div style={{ flex:1, background:T.cardAlt, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:T.textFaint }}>Versão</div>
              <div style={{ fontSize:13, fontWeight:800, color:T.text }}>Carteira Proventos 2.0</div>
            </div>
            <div style={{ flex:1, background:T.cardAlt, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:T.textFaint }}>Dados no aparelho</div>
              <div style={{ fontSize:13, fontWeight:800, color:T.text }}>{usoStorage}</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, background:T.cardAlt, borderRadius:10, padding:"10px 12px" }}>
            <span style={{ fontSize:14 }}>👤</span>
            <span style={{ flex:1, minWidth:0, fontSize:11, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{usuario || "—"}</span>
            <button onClick={onLogout} style={{ padding:"7px 12px", borderRadius:8, border:`1px solid ${T.red}55`, background:`${T.red}12`, color:T.red, cursor:"pointer", fontSize:11, fontWeight:700 }}>Sair</button>
          </div>
          {nota("App pessoal de acompanhamento de dividendos da B3 com assistente de IA local e privado. Seus dados não saem do seu aparelho (exceto o chat, que fala com o SEU servidor).")}
        </>)})}

        {showLogs && <VisualizadorLogs onClose={()=>setShowLogs(false)} T={T}/>}
        {showVoz && <ConfigVoz onClose={()=>setShowVoz(false)} T={T}/>}

        {/* FECHAR */}
        <button onClick={onClose} style={{ width:"100%", marginTop:6, padding:"13px", borderRadius:10, border:"none", background:T.accent, color:"#fff", cursor:"pointer", fontSize:13, fontWeight:700 }}>
          ✓ Fechar
        </button>

        <div style={{ marginTop:12,fontSize:10,color:T.textFaint,textAlign:"center",lineHeight:1.6 }}>
          Tudo é salvo automaticamente. No modo TV, empareie teclado e mouse via Bluetooth.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
// ÍCONES DE LINHA (SVG) — sem biblioteca externa; herdam a cor do texto
// ════════════════════════════════════════════════════════════════════════════
function Icone({ nome, size = 22, cor = "currentColor", stroke = 2 }) {
  const p = { width:size, height:size, viewBox:"0 0 24 24", fill:"none", stroke:cor, strokeWidth:stroke, strokeLinecap:"round", strokeLinejoin:"round", "aria-hidden":true, style:{ display:"block", flexShrink:0 } };
  switch (nome) {
    case "menu":       return <svg {...p}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
    case "engrenagem": return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>;
    case "barras":     return <svg {...p} fill={cor} stroke="none"><rect x="4" y="12" width="4" height="8" rx="1"/><rect x="10" y="5" width="4" height="15" rx="1"/><rect x="16" y="9" width="4" height="11" rx="1"/></svg>;
    case "robo":       return <svg {...p}><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V5M9 13h.01M15 13h.01M9.5 16.5h5M2 12v3M22 12v3"/><circle cx="12" cy="4" r="1"/></svg>;
    case "casa":       return <svg {...p}><path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>;
    case "trofeu":     return <svg {...p}><path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4"/></svg>;
    case "lapis":      return <svg {...p}><path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z"/><path d="M14 7l3 3"/></svg>;
    case "info":       return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>;
    case "calendario": return <svg {...p}><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></svg>;
    case "sobe":       return <svg {...p}><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>;
    case "desce":      return <svg {...p}><path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/></svg>;
    case "seta-cima":  return <svg {...p}><path d="M12 19V5M6 11l6-6 6 6"/></svg>;
    case "seta-baixo": return <svg {...p}><path d="M12 5v14M6 13l6 6 6-6"/></svg>;
    case "chevron":    return <svg {...p}><path d="M9 6l6 6-6 6"/></svg>;
    case "voz":        return <svg {...p}><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>;
    case "sino":       return <svg {...p}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>;
    case "crescimento":return <svg {...p} strokeWidth={stroke}><rect x="3" y="14" width="3.5" height="6" rx="0.6" fill={cor} stroke="none"/><rect x="8.5" y="11" width="3.5" height="9" rx="0.6" fill={cor} stroke="none"/><rect x="14" y="13" width="3.5" height="7" rx="0.6" fill={cor} stroke="none"/><path d="M3.5 10l5-4.5 4 3L20 3"/><path d="M15.5 3H20v4.5"/></svg>;
    default: return null;
  }
}

// moedas empilhadas (desenho) para o cartão de dividendos
function IconeMoedas({ size = 52 }) {
  const moeda = (cx, cy, k) => (<g key={k}><ellipse cx={cx} cy={cy+3} rx="15" ry="5.5" fill="#b8860b"/><rect x={cx-15} y={cy-3} width="30" height="6" fill="#d4a017"/><ellipse cx={cx} cy={cy-3} rx="15" ry="5.5" fill="#f5c84c" stroke="#c9961a" strokeWidth="1"/></g>);
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true" style={{ display:"block", flexShrink:0 }}>
      {[0,1,2,3].map(i => moeda(20, 50 - i*7, "a"+i))}
      {[0,1,2].map(i => moeda(40, 52 - i*7, "b"+i))}
    </svg>
  );
}

// "50.000", "50000,50" ou "R$ 50.000,00" → número
function parseValorBR(t) {
  let v = String(t == null ? "" : t).trim().replace(/[R$\s]/g, "");
  if (!v) return 0;
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, "");
  const n = parseFloat(v);
  return isFinite(n) && n > 0 ? n : 0;
}
const pctBR = (v, casas = 1) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits:casas, maximumFractionDigits:casas });

// janela para definir a meta de patrimônio (campo aceita vazio; só converte ao salvar)
function ModalMetaPatrimonio({ valor = 0, patrimonio = 0, onSalvar, onClose, T }) {
  const [txt, setTxt] = useState(valor > 0 ? String(valor).replace(".", ",") : "");
  const n = parseValorBR(txt);
  return (
    <div onClick={onClose} className="modal-overlay" style={{ position:"fixed", inset:0, background:"#000a", zIndex:1500, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={e=>e.stopPropagation()} className="modal-content" style={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16, width:"100%", maxWidth:360, padding:20 }}>
        <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:4 }}>🎯 Meta de patrimônio</div>
        <div style={{ fontSize:11, color:T.textMute, lineHeight:1.5, marginBottom:14 }}>Quanto você quer acumular. O cartão do patrimônio mostra quanto já foi atingido.</div>
        <input value={txt} onChange={e=>setTxt(e.target.value)} inputMode="decimal" placeholder="ex.: 50.000" autoFocus
          style={{ width:"100%", background:T.cardAlt, border:`1px solid ${T.borderSoft}`, borderRadius:10, color:T.text, padding:"12px 14px", fontSize:16, outline:"none", marginBottom:8 }}/>
        <div style={{ fontSize:11, color:T.textMute, marginBottom:16 }}>{n > 0 ? `Hoje: ${fmt(patrimonio)} = ${pctBR(patrimonio/n*100)}% da meta` : "Deixe vazio para remover a meta."}</div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:12, borderRadius:10, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontWeight:700 }}>Cancelar</button>
          <button onClick={()=>{ onSalvar(n); onClose(); }} style={{ flex:1, padding:12, borderRadius:10, border:"none", background:T.accent, color:"#fff", cursor:"pointer", fontWeight:800 }}>Salvar</button>
        </div>
      </div>
    </div>
  );
}

// texto de uma linha que diminui sozinho até caber na largura (valores grandes, fonte do sistema aumentada)
function TextoAjustado({ children, max = 30, min = 12, style = {}, className = "" }) {
  const ref = useRef(null);
  const [fs, setFs] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ajustar = () => {
      let f = max;
      el.style.fontSize = f + "px";
      while (f > min && el.scrollWidth > el.clientWidth + 1) { f -= 1; el.style.fontSize = f + "px"; }
      setFs(f);
    };
    ajustar();
    let ro = null;
    if (typeof ResizeObserver !== "undefined" && el.parentElement) { ro = new ResizeObserver(ajustar); ro.observe(el.parentElement); }
    return () => { if (ro) ro.disconnect(); };
  }, [children, max, min]);
  return <div ref={ref} className={className} style={{ ...style, fontSize: fs, whiteSpace: "nowrap", overflow: "hidden", minWidth: 0 }}>{children}</div>;
}

// gráfico de evolução dentro do cartão verde: linha do valor aplicado mês a mês + pontos do patrimônio (valor de mercado)
function GraficoEvolucao({ meses = [] }) {
  const N = meses.length;
  const [sel, setSel] = useState(N - 1);
  const caixa = useRef(null);
  const [largura, setLargura] = useState(320);
  useEffect(() => { setSel(N - 1); }, [N]);
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLargura(el.clientWidth || 320);
    medir();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(medir); ro.observe(el); }
    return () => { if (ro) ro.disconnect(); };
  }, []);
  if (N < 2) return null;
  const topo = Math.max(...meses.map(m => Math.max(m.aplicado || 0, m.patrimonio || 0)), 1) * 1.1;
  const X = (i) => ((i + 0.5) / N) * 100;
  const Y = (v) => 4 + (1 - v / topo) * 52; // viewBox 0..60
  const linha = meses.map((m, i) => `${i ? "L" : "M"}${X(i).toFixed(2)} ${Y(m.aplicado).toFixed(2)}`).join(" ");
  const conhecidos = meses.map((m, i) => ({ i, v: m.patrimonio })).filter(p => p.v != null);
  const linhaPat = conhecidos.length >= 2 ? conhecidos.map((p, k) => `${k ? "L" : "M"}${X(p.i).toFixed(2)} ${Y(p.v).toFixed(2)}`).join(" ") : null;
  const cabem = Math.max(2, Math.floor(largura / 27)); // ~27px por rótulo
  const passo = Math.max(1, Math.ceil(N / cabem));
  const m = meses[Math.min(sel, N - 1)];
  const ponto = (i, v, cor, tam) => (
    <span key={`${cor}${i}`} style={{ position:"absolute", left:`calc(${X(i)}% - ${tam/2}px)`, top:`calc(${(Y(v)/60)*100}% - ${tam/2}px)`, width:tam, height:tam, borderRadius:"50%", background:cor, border:"2px solid #ffffffaa", pointerEvents:"none" }}/>
  );
  return (
    <div ref={caixa} style={{ marginTop:14 }} onClick={e => e.stopPropagation()}>
      <div style={{ position:"relative", height:78 }}>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ position:"absolute", inset:0, width:"100%", height:"100%", display:"block" }} aria-hidden="true">
          <path d={`${linha} L${X(N - 1).toFixed(2)} 60 L${X(0).toFixed(2)} 60 Z`} fill="#ffffff" fillOpacity="0.13"/>
          <path d={linha} fill="none" stroke="#d6efc9" strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
          {linhaPat && <path d={linhaPat} fill="none" stroke="#ffd36e" strokeWidth="1.6" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/>}
          <line x1={X(sel)} x2={X(sel)} y1="0" y2="60" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
        </svg>
        {ponto(sel, m.aplicado, "#d6efc9", 10)}
        {conhecidos.map(p => ponto(p.i, p.v, "#ffd36e", p.i === sel ? 11 : 8))}
        <div style={{ position:"absolute", inset:0, display:"flex" }}>
          {meses.map((mm, i) => (
            <button key={mm.ym} onClick={() => setSel(i)} aria-label={`Ver ${mm.rotulo}`} style={{ flex:1, background:"transparent", border:"none", padding:0, cursor:"pointer" }}/>
          ))}
        </div>
      </div>
      <div style={{ display:"flex", marginTop:4 }}>
        {meses.map((mm, i) => {
          const mostra = i === N - 1 || (i % passo === 0 && N - 1 - i >= passo);
          const [mes, aa] = mm.rotulo.split("/");
          const comAno = i === 0 || mes === "jan" || i === N - 1;
          return (
            <div key={mm.ym} style={{ flex:1, minWidth:0, textAlign:"center", lineHeight:1.1, fontSize:9, color: i === sel ? "#ffffff" : "#ffffffb3", fontWeight: i === sel ? 800 : 500, overflow:"visible", whiteSpace:"nowrap" }}>
              {mostra ? <>{mes}{comAno && <div style={{ fontSize:8, opacity:0.8 }}>{aa}</div>}</> : ""}
            </div>
          );
        })}
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:"4px 12px", marginTop:8, fontSize:11, lineHeight:1.3 }}>
        <strong>{m.atual ? `${m.rotulo} (hoje)` : m.rotulo}</strong>
        <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}><span style={{ width:12, height:3, borderRadius:2, background:"#d6efc9" }}/>aplicado {fmt(m.aplicado)}</span>
        {m.patrimonio != null && <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}><span style={{ width:8, height:8, borderRadius:"50%", background:"#ffd36e" }}/>patrimônio {fmt(m.patrimonio)}</span>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TELA INICIAL — patrimônio (aplicado, variação e evolução), dividendos, indicadores e metas
// ════════════════════════════════════════════════════════════════════════════
function TelaInicio({ patrimonio = 0, aplicado = 0, evolucao, metaPatrimonio = 0, resumo, esteMes = 0, proj12 = 0,
  recebidoTotal = 0, primeiroRecebimento = null, kpis = {}, metas = null,
  onDefinirMetaPatrimonio = ()=>{}, onVerCarteira = ()=>{}, onImportar = ()=>{},
  modoEdicao = false, onEditar = ()=>{}, estiloDe = () => ({ style:{}, cls:"" }), T }) {
  const [info, setInfo] = useState(false);
  const ano = new Date().getFullYear();
  const variacao = patrimonio - aplicado;
  const pctVar = aplicado > 0 ? (variacao / aplicado) * 100 : null;
  const pctPat = metaPatrimonio > 0 ? (patrimonio / metaPatrimonio) * 100 : null;
  const meses = evolucao?.meses || [];
  const rotuloYm = (ym) => ym ? `${MESES_ABREV[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}` : "";

  const card = { background:T.card, border:`1px solid ${T.border}`, borderRadius:20, boxShadow:"0 2px 10px #0000000d" };
  const ed = (id, filho, inline) => <Editavel id={id} modoEdicao={modoEdicao} onEditar={onEditar} inline={inline} T={T}>{filho}</Editavel>;
  const linhaInfo = (icone, texto, cor = T.textDim) => (
    <div style={{ display:"flex", alignItems:"flex-start", gap:8, color:cor, fontSize:11.5, lineHeight:1.4 }}>
      <span style={{ marginTop:1 }}><Icone nome={icone} size={16} cor={cor}/></span><span style={{ minWidth:0 }}>{texto}</span>
    </div>
  );

  const KPIS = [
    { l:"Média/mês", v:kpis.mediaMes, ic:"calendario", c:T.accent, sub:"projeção 12 meses" },
    { l:"Maior mês", v:kpis.maxMes, ic:"sobe", c:T.green, sub:kpis.maxRotulo ? `em ${kpis.maxRotulo}` : "—" },
    { l:"Menor mês", v:kpis.minMes, ic:"desce", c:T.red, sub:kpis.minRotulo ? `em ${kpis.minRotulo}` : "—" },
    { l:"FIIs/ano", v:kpis.totFII, ic:"casa", c:T.cyan, sub:"estimado" },
    { l:"Ações/ano", v:kpis.totAcao, ic:"crescimento", c:T.accentSoft || T.accent, sub:"estimado" },
    { l:"Recebido", v:recebidoTotal, ic:"seta-baixo", c:T.green, sub:primeiroRecebimento ? `desde ${rotuloYm(primeiroRecebimento)}` : "nada importado" },
  ];

  return (
    <div style={{ padding:"4px 0 8px" }}>
      {/* ── PATRIMÔNIO ── */}
      {ed("patrimonioCard",
        <div onClick={onVerCarteira} className={estiloDe("patrimonioCard",13).cls} style={{ position:"relative", overflow:"hidden", cursor:"pointer", borderRadius:22, padding:"18px 16px 14px",
          background:`linear-gradient(135deg, ${T.accent} 0%, ${T.accent}e6 60%, ${T.accentSoft} 100%)`, color:"#fff", marginBottom:14, boxShadow:`0 10px 26px ${T.accent}55`, ...estiloDe("patrimonioCard",13).style }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
            <div style={{ flexShrink:0 }}><Icone nome="crescimento" size={40} cor="#ffffff" stroke={2.2}/></div>
            <div style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", flexWrap:"wrap", gap:6, paddingTop:9 }}>
              {ed("patrimonioLabel", <span className={estiloDe("patrimonioLabel",15).cls} style={{ fontSize:15, fontWeight:700, opacity:0.95, lineHeight:1.2, ...estiloDe("patrimonioLabel",15).style }}>Patrimônio total</span>, true)}
              <button onClick={e=>{ e.stopPropagation(); setInfo(v=>!v); }} aria-label="O que é o patrimônio total" style={{ background:"none", border:"none", padding:0, cursor:"pointer", color:"#fff", opacity:0.85 }}><Icone nome="info" size={17} cor="#ffffff"/></button>
            </div>
            <button onClick={e=>{ e.stopPropagation(); onDefinirMetaPatrimonio(); }} title="Meta de patrimônio"
              style={{ flexShrink:0, border:"1.5px solid #ffffff66", background:"#ffffff14", color:"#fff", borderRadius:14, padding:"5px 9px", cursor:"pointer", textAlign:"right", lineHeight:1.15 }}>
              {pctPat == null ? (
                <span style={{ fontSize:11, fontWeight:700 }}>🎯 Definir<br/>meta</span>
              ) : (<>
                <span style={{ display:"block", fontSize:14, fontWeight:800 }}>{pctBR(pctPat)}%</span>
                <span style={{ fontSize:10, opacity:0.9 }}>da meta</span>
              </>)}
            </button>
          </div>
          {ed("patrimonioValor", <TextoAjustado max={estiloDe("patrimonioValor",38).style.fontSize || 38} min={18} className={estiloDe("patrimonioValor",38).cls} style={{ fontWeight:800, letterSpacing:-1, lineHeight:1.1, marginTop:8, ...estiloDe("patrimonioValor",38).style }}>{fmt(patrimonio)}</TextoAjustado>)}
          <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:"4px 8px", marginTop:6 }}>
            {pctVar != null && (
              <span style={{ display:"inline-flex", alignItems:"center", gap:3, background:"#ffffff", color: variacao >= 0 ? "#2e7d32" : "#c62828", borderRadius:20, padding:"3px 9px", fontSize:12.5, fontWeight:800 }}>
                <Icone nome={variacao >= 0 ? "seta-cima" : "seta-baixo"} size={13} cor={variacao >= 0 ? "#2e7d32" : "#c62828"} stroke={2.8}/>{variacao >= 0 ? "+" : "−"}{pctBR(Math.abs(pctVar))}%
              </span>
            )}
            {pctVar != null && <span style={{ fontSize:12.5, fontWeight:700, opacity:0.95 }}>{variacao >= 0 ? "+" : "−"}{fmt(Math.abs(variacao))}</span>}
          </div>
          <div style={{ fontSize:12.5, opacity:0.92, marginTop:5 }}>Valor aplicado: <strong>{fmt(aplicado)}</strong></div>
          {info && <div style={{ fontSize:10.5, opacity:0.9, marginTop:6, lineHeight:1.45 }}>Patrimônio = quantidade × cotação de cada ativo. Aplicado = quantidade × preço médio. A variação é a diferença entre os dois. A linha mostra o valor aplicado mês a mês (compras − vendas da Movimentação da B3) e os pontos amarelos o patrimônio de mercado nos meses em que ele foi registrado. Toque no cartão para ver a carteira.</div>}
          {meses.length >= 2 && <GraficoEvolucao meses={meses}/>}
          {!evolucao?.temHistorico && (
            <button onClick={e=>{ e.stopPropagation(); onImportar(); }} style={{ marginTop:10, width:"100%", textAlign:"left", background:"#ffffff1f", border:"1px dashed #ffffff88", color:"#fff", borderRadius:12, padding:"8px 10px", fontSize:11, lineHeight:1.4, cursor:"pointer" }}>
              Sem histórico de compras com data. Importe a <strong>Movimentação da B3</strong> (Editar → Importar) para a linha mostrar cada mês desde o primeiro aporte.
            </button>
          )}
        </div>
      )}

      {/* ── DIVIDENDOS ── */}
      {ed("dividendosCard",
        <div className={estiloDe("dividendosCard",13).cls} style={{ ...card, padding:"16px 16px 14px", marginBottom:12, ...estiloDe("dividendosCard",13).style }}>
          <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:"10px 10px" }}>
            <IconeMoedas size={40}/>
            <div style={{ flex:"1 1 100px", minWidth:0 }}>
              {ed("dividendosHeader", <div className={estiloDe("dividendosHeader",12.5).cls} style={{ fontSize:12.5, color:T.text, fontWeight:600, lineHeight:1.25, ...estiloDe("dividendosHeader",12.5).style }}>Dividendos – total do ano</div>)}
              {ed("dividendosValor", <TextoAjustado max={estiloDe("dividendosValor",28).style.fontSize || 28} min={11} className={estiloDe("dividendosValor",28).cls} style={{ fontWeight:800, color:T.accent, letterSpacing:-0.5, lineHeight:1.15, ...estiloDe("dividendosValor",28).style }}>{fmt(resumo?.total || 0)}</TextoAjustado>)}
            </div>
            <div style={{ textAlign:"center", minWidth:0, flex:"1 0 64px", maxWidth:170, borderLeft:`1px solid ${T.border}`, paddingLeft:10 }}>
              <TextoAjustado max={22} min={10} style={{ fontWeight:800, color:T.accent, lineHeight:1.15 }}>{fmt(esteMes)}</TextoAjustado>
              <div style={{ fontSize:11.5, color:T.text, fontWeight:600 }}>este mês</div>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:12 }}>
            {linhaInfo("calendario", <>{ano}: recebido <strong style={{ color:T.text }}>{fmt(resumo?.real || 0)}</strong> · previsto <strong style={{ color:T.text }}>{fmt(resumo?.previsto || 0)}</strong></>)}
            {linhaInfo("seta-baixo", primeiroRecebimento
              ? <>Desde o início ({rotuloYm(primeiroRecebimento)}): <strong style={{ color:T.green }}>{fmt(recebidoTotal)}</strong> recebidos</>
              : <>Nenhum provento recebido importado ainda.</>, primeiroRecebimento ? T.textDim : T.amber)}
            {linhaInfo("sobe", <>Próximos 12 meses (projeção): <strong style={{ color:T.text }}>{fmt(proj12)}</strong></>)}
          </div>
          {!primeiroRecebimento && (
            <button onClick={onImportar} style={{ marginTop:10, width:"100%", textAlign:"left", background:`${T.amber}14`, border:`1px dashed ${T.amber}`, color:T.text, borderRadius:12, padding:"8px 10px", fontSize:11, lineHeight:1.4, cursor:"pointer" }}>
              Para somar o que já caiu na conta, importe a planilha de <strong>Movimentação da B3</strong> (Editar → Importar). Rendimentos, dividendos e JCP entram aqui.
            </button>
          )}
        </div>
      )}

      {/* ── INDICADORES (os mesmos de antes) ── */}
      {ed("kpiCard",
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(106px, 1fr))", gap:8, marginBottom:14 }}>
          {KPIS.map(k => (
            <div key={k.l} className={estiloDe("kpiCard",12).cls} style={{ ...card, minWidth:0, borderRadius:16, padding:"10px 9px", ...estiloDe("kpiCard",12).style }}>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <Icone nome={k.ic} size={16} cor={k.c}/>
                <span className={estiloDe("kpiLabel",11).cls} style={{ fontSize:11, color:T.textDim, lineHeight:1.15, minWidth:0, ...estiloDe("kpiLabel",11).style }}>{k.l}</span>
              </div>
              <TextoAjustado max={17} min={9} className={estiloDe("kpiValor",17).cls} style={{ fontWeight:800, color:k.c, marginTop:4, ...estiloDe("kpiValor",17).style }}>{fmt(+k.v || 0)}</TextoAjustado>
              <div style={{ fontSize:9.5, color:T.textFaint, lineHeight:1.25 }}>{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── METAS (proventos, contas pagas, reserva plus, aporte) — mesmas regras de antes ── */}
      {ed("metaCard", <div>{metas}</div>)}
    </div>
  );
}

function AppCarteira({ usuario, contaNome, onLogout }) {
  const [temaId, setTemaId] = useEstadoSalvo("tema", "minimalista2");
  const [ativos, setAtivos] = useState(carregarAtivos);
  const [filtro, setFiltro] = useState("TUDO");
  const [mesSel, setMesSel] = useState(0);
  const [aba,    setAba]    = useState("painel");
  const [menuAberto, setMenuAberto] = useState(false);
  // ao trocar de aba pelo menu, rola suavemente até o topo (centraliza o cabeçalho do tema)
  useEffect(() => {
    const t = setTimeout(() => { try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch(e){ window.scrollTo(0,0); } }, 40);
    return () => clearTimeout(t);
  }, [aba]);

  // ── CONFIGURAÇÕES (engrenagem) — todas salvas na memória ────────────────
  const [showConfig, setShowConfig] = useState(false);
  const [showCarteira, setShowCarteira] = useState(false);
  const [showReserva, setShowReserva] = useState(false);
  const [editandoTicker, setEditandoTicker] = useState(undefined); // undefined=fechado, null=novo, string=editar
  useEffect(() => registrarEditorAtivo((tk)=>setEditandoTicker(tk)), []);
  const [layout,   setLayout]   = useEstadoSalvo("layout", "celular");  // "celular" | "tv"
  const [fontEsc,  setFontEsc]  = useEstadoSalvo("fonte", 1);           // 0.85 | 1 | 1.15 | 1.35
  const [densidade,setDensidade]= useEstadoSalvo("densidade", "confortavel"); // "compacto" | "confortavel"

  // ── META DE PROVENTOS (trilha de progressão) — salva na memória ─────────
  const [metaMensal, setMetaMensal] = useEstadoSalvo("meta", 500);    // meta de provento médio/mes
  const [metaAporte, setMetaAporte] = useEstadoSalvo("metaAporte", 0); // meta de aporte mensal (quanto investir/mês)
  const [metaPatrimonio, setMetaPatrimonio] = useEstadoSalvo("metaPatrimonio", 0); // meta de patrimônio (selo do cartão)
  const [showMetaPat, setShowMetaPat] = useState(false);
  const [proventosRecebidos, setProventosRecebidos] = useEstadoSalvo("proventosRecebidos", { porMes:{}, total:0, registros:[] }); // realizado (da planilha B3)
  const [showMeta,   setShowMeta]   = useState(false);
  const [showAporte, setShowAporte] = useState(false);

  // ── CAMADA 2: BLOCOS CONFIGURÁVEIS (ordem/página/visibilidade por cima da base) ──
  const [layoutBlocos, setLayoutBlocos] = useEstadoSalvo("layoutBlocos", null); // null = padrão de instalação
  const [showBlocos, setShowBlocos] = useState(false);
  // ── MODO DE EDIÇÃO VISUAL (lapisinhos em cada elemento customizável) ──
  const [modoEdicao, setModoEdicao] = useState(false);
  const [editandoElemento, setEditandoElemento] = useState(null);
  // ── ESTILOS CUSTOM (camada acima — a IA estiliza elementos registrados) ──
  const [estilosCustom, setEstilosCustom] = useEstadoSalvo("estilosCustom", null); // null = padrão intacto
  const estiloDe = (id, base=13) => {
    const e = (estilosCustom||{})[id]; if (!e) return { style:{}, cls:"" };
    const style = {};
    // texto
    if (e.escala)        style.fontSize = Math.round(base*e.escala*10)/10;
    if (e.cor)           style.color = e.cor;
    if (e.negrito!=null) style.fontWeight = e.negrito?800:500;
    if (e.italico)       style.fontStyle = "italic";
    if (e.sublinhado)    style.textDecoration = "underline";
    if (e.maiuscula)     style.textTransform = "uppercase";
    if (e.espacamentoLetras!=null) style.letterSpacing = e.espacamentoLetras;
    if (e.alinhamento)   style.textAlign = e.alinhamento;
    if (e.fonte)         style.fontFamily = e.fonte;
    // caixa / container
    if (e.fundo)         style.background = e.fundo;
    if (e.borda)         style.border = e.borda;
    if (e.raio!=null)    style.borderRadius = e.raio;
    if (e.sombra)        style.boxShadow = e.sombra;
    if (e.padding!=null) style.padding = e.padding;
    if (e.margem!=null)  style.margin = e.margem;
    if (e.opacidade!=null) style.opacity = Math.max(0.1, Math.min(1, e.opacidade));
    if (e.rotacao!=null) style.transform = `rotate(${e.rotacao}deg)`;
    if (e.oculto)        style.display = "none";
    return { style, cls: (e.animacao && e.animacao!=="nenhuma") ? `ia-anim-${e.animacao}` : "" };
  };
  const configBloco = (id) => {
    const def = BLOCOS_DEF.find(b=>b.id===id) || {};
    const c = (layoutBlocos||{})[id] || {};
    return { pagina: BLOCOS_PAGINAS.includes(c.pagina)?c.pagina:def.paginaPadrao, ordem: c.ordem??def.ordemPadrao, visivel: c.visivel!==false };
  };
  const blocosDe = (pagina) => BLOCOS_DEF
    .map(b=>({ ...b, ...configBloco(b.id) }))
    .filter(b=>b.visivel && b.pagina===pagina)
    .sort((a,b)=>a.ordem-b.ordem);
  const renderBloco = (id) => {
    if (id==="prox3meses") return <BlocoProx3Meses serie={prox3Serie} estiloDe={estiloDe} T={T}/>;
    if (id==="graficoMensal") return <BlocoGraficoMensal serie={janelaSerie} janela={janelaProv} setJanela={setJanelaProv} ano={anoProv} setAno={setAnoProv} estiloDe={estiloDe} T={T}/>;
    if (id==="projecao") return <ProjecaoProventos ativos={ativos} T={T}/>;
    if (id==="previstoRealizado") return <PrevistoVsRealizado ativos={ativos} proventosRecebidos={proventosRecebidos} estiloDe={estiloDe} T={T}/>;
    return null;
  };
  const blocosJSX = (pagina) => blocosDe(pagina).map(b=><div key={b.id}>{renderBloco(b.id)}</div>);

  // ── CAMADA DE ALTERAÇÕES DA IA (preview → aplicar/cancelar) ─────────────
  const [previewAtivo, setPreviewAtivo] = useState(false);
  const [snapshotConfig, setSnapshotConfig] = useState(null); // config antes do preview
  const [previewResumo, setPreviewResumo] = useState([]);      // o que muda (texto)

  // aplica uma lista de ações nos estados reais (usado por preview e aplicar direto)
  const executarAcoes = (acoes) => {
    const resumo = [];
    acoes.forEach(a=>{
      const v = a.valor;
      if (a.tipo==="tema" && TEMAS[v]) { setTemaId(v); resumo.push(`Tema → ${TEMAS[v].nome}`); }
      else if (a.tipo==="layout" && ["celular","tv"].includes(v)) { setLayout(v); resumo.push(`Layout → ${v==="tv"?"TV":"Celular"}`); }
      else if (a.tipo==="densidade" && ["compacto","confortavel"].includes(v)) { setDensidade(v); resumo.push(`Densidade → ${v}`); }
      else if (a.tipo==="fonte") { const f=parseFloat(v)||1; setFontEsc(f); resumo.push(`Fonte → ${f}x`); }
      else if (a.tipo==="meta") { const n=+v||0; setMetaMensal(n); resumo.push(`Meta de proventos → ${fmt(n)}/mês`); }
      else if (a.tipo==="aporte") { const n=+v||0; setMetaAporte(n); resumo.push(`Meta de aporte → ${fmt(n)}/mês`); }
      else if (a.tipo==="navegar") { setAba(v); resumo.push(`Ir para: ${v}`); }
      else if (a.tipo==="blocoMover" && v && v.id && BLOCOS_DEF.some(b=>b.id===v.id) && BLOCOS_PAGINAS.includes(v.pagina)) {
        const nome = BLOCOS_DEF.find(b=>b.id===v.id)?.nome || v.id;
        setLayoutBlocos(prev=>({ ...(prev||{}), [v.id]: { ...configBloco(v.id), pagina:v.pagina } }));
        resumo.push(`Bloco "${nome}" → ${v.pagina}`);
      }
      else if (a.tipo==="blocoVisivel" && v && v.id && BLOCOS_DEF.some(b=>b.id===v.id)) {
        const nome = BLOCOS_DEF.find(b=>b.id===v.id)?.nome || v.id;
        setLayoutBlocos(prev=>({ ...(prev||{}), [v.id]: { ...configBloco(v.id), visivel: v.visivel!==false } }));
        resumo.push(`Bloco "${nome}" → ${v.visivel!==false?"visível":"oculto"}`);
      }
      else if (a.tipo==="estilo" && v && v.id && ELEMENTOS_ESTILO[v.id]) {
        const nome = ELEMENTOS_ESTILO[v.id].nome;
        setEstilosCustom(prev=>{
          if (v.reset) { const c={ ...(prev||{}) }; delete c[v.id]; return Object.keys(c).length?c:null; }
          const atual = (prev||{})[v.id]||{};
          const novo = { ...atual };
          // texto
          if (v.escala!=null) novo.escala = Math.max(0.5, Math.min(3, +v.escala||1));
          if (v.cor) novo.cor = String(v.cor).slice(0,30);
          if (v.negrito!=null) novo.negrito = !!v.negrito;
          if (v.italico!=null) novo.italico = !!v.italico;
          if (v.sublinhado!=null) novo.sublinhado = !!v.sublinhado;
          if (v.maiuscula!=null) novo.maiuscula = !!v.maiuscula;
          if (v.espacamentoLetras!=null) novo.espacamentoLetras = Math.max(-3, Math.min(10, +v.espacamentoLetras||0));
          if (v.alinhamento && ["left","center","right"].includes(v.alinhamento)) novo.alinhamento = v.alinhamento;
          if (v.fonte) novo.fonte = String(v.fonte).slice(0,60);
          // caixa
          if (v.fundo) novo.fundo = String(v.fundo).slice(0,80);
          if (v.borda) novo.borda = String(v.borda).slice(0,60);
          if (v.raio!=null) novo.raio = Math.max(0, Math.min(60, +v.raio||0));
          if (v.sombra) novo.sombra = String(v.sombra).slice(0,80);
          if (v.padding!=null) novo.padding = Math.max(0, Math.min(60, +v.padding||0));
          if (v.margem!=null) novo.margem = Math.max(0, Math.min(60, +v.margem||0));
          if (v.opacidade!=null) novo.opacidade = Math.max(0.1, Math.min(1, +v.opacidade||1));
          if (v.rotacao!=null) novo.rotacao = Math.max(-180, Math.min(180, +v.rotacao||0));
          if (v.oculto!=null) novo.oculto = !!v.oculto;
          if (v.animacao && ANIMACOES_IA.includes(v.animacao)) novo.animacao = v.animacao;
          return { ...(prev||{}), [v.id]: novo };
        });
        resumo.push(v.reset ? `Estilo de "${nome}" restaurado` : `Estilo de "${nome}" ajustado`);
      }
    });
    return resumo;
  };
  // entra no modo PREVIEW (guarda snapshot, aplica temporariamente, mostra barra)
  const entrarPreview = (acoes) => {
    setSnapshotConfig({ temaId, layout, densidade, fontEsc, metaMensal, metaAporte, aba, layoutBlocos, estilosCustom });
    const resumo = executarAcoes(acoes);
    setPreviewResumo(resumo);
    setPreviewAtivo(true);
    registrarLog("sistema", `Preview de ${acoes.length} alteração(ões) da IA`, { direcao:"interno", origem:"app", detalhe:resumo.join("; ") });
  };
  const aplicarPreview = () => {
    setSnapshotConfig(null); setPreviewAtivo(false);
    registrarLog("sistema", `Alterações aplicadas: ${previewResumo.join("; ")}`, { direcao:"interno", origem:"app" });
    setPreviewResumo([]);
  };
  const cancelarPreview = () => {
    if (snapshotConfig) {
      setTemaId(snapshotConfig.temaId); setLayout(snapshotConfig.layout); setDensidade(snapshotConfig.densidade);
      setFontEsc(snapshotConfig.fontEsc); setMetaMensal(snapshotConfig.metaMensal); setMetaAporte(snapshotConfig.metaAporte);
      setAba(snapshotConfig.aba);
      setLayoutBlocos(snapshotConfig.layoutBlocos ?? null);
      setEstilosCustom(snapshotConfig.estilosCustom ?? null);
    }
    setSnapshotConfig(null); setPreviewAtivo(false); setPreviewResumo([]);
    registrarLog("sistema", "Alterações da IA canceladas (restaurado)", { direcao:"interno", origem:"app" });
  };

  // ── CARTÃO / CUSTO DE VIDA — salvos na memória ──────────────────────────
  const [custoVida, setCustoVida] = useEstadoSalvo("custoVida", { agua:100, luz:200, condominio:0, aluguel:1000, internet:120, outros:0 });
  const [fundosProvisionados, setFundosProvisionados] = useEstadoSalvo("fundosProv", 3000);

  // ── CHATBOT / IA LOCAL ──────────────────────────────────────────────────
  // ponte da IA: guardada NO APARELHO (vale para todas as contas), normalizada e sempre salva
  const [bridgeUrl, setBridgeUrlState] = useState(() => lerPonteIA());
  // modelo do LM Studio e instruções do agente (System Prompt) — salvos no aparelho
  const [iaModelo, setIaModeloState] = useState(() => lerTextoAparelho(IA_MODELO_KEY));
  const [iaInstrucoes, setIaInstrucoesState] = useState(() => lerTextoAparelho(IA_INSTR_KEY));
  const setIaModelo = (v) => { setIaModeloState(v || ""); gravarTextoAparelho(IA_MODELO_KEY, v || ""); };
  const setIaInstrucoes = (v) => { setIaInstrucoesState(v || ""); gravarTextoAparelho(IA_INSTR_KEY, v || ""); };
  const [showConfigIA, setShowConfigIA] = useState(false);
  const [showVozChat, setShowVozChat] = useState(false);
  const setBridgeUrl = (u) => { const n = normalizarUrlServidor(u); setBridgeUrlState(n); gravarPonteIA(n); };
  // proventos anunciados (arquivo de eventos da B3) e filtros do gráfico — por conta
  const [eventosB3, setEventosB3] = useEstadoSalvo("eventosB3", []);
  // notificações: eventos dos próximos 7 dias + 4 dicas por dia da IA (guardadas para não pedir de novo)
  const [dicasIA, setDicasIA] = useEstadoSalvo("dicasIA", { data:null, dicas:[] });
  const [notifVistas, setNotifVistas] = useEstadoSalvo("notifVistas", []);
  const pedindoDicas = useRef(false);
  // ativos vendidos por completo: fora da lista, mas o histórico de compras/vendas segue na evolução do patrimônio
  const [vendidosHist, setVendidosHist] = useEstadoSalvo("vendidosHist", []);
  const [anoProv, setAnoProv] = useState(() => new Date().getFullYear());
  const [janelaProv, setJanelaProv] = useState("ano");

  // ── HISTÓRICO REAL — retrato mensal da carteira (salvo na memória) ──────
  const [historico, setHistorico] = useEstadoSalvo("historico", []);

  // salva os ativos sempre que forem editados (merge é feito só na carga)
  // salva os ativos sempre que forem editados.
  // Proteção: na 1ª montagem NUNCA sobrescreve uma lista guardada com uma lista vazia.
  const primeiraGravacaoAtivos = useRef(true);
  useEffect(() => {
    if (primeiraGravacaoAtivos.current) {
      primeiraGravacaoAtivos.current = false;
      const guardado = lerSalvo("ativos", null);
      if (Array.isArray(guardado) && guardado.length > 0 && ativos.length === 0) return;
    }
    gravarSalvo("ativos", ativos);
  }, [ativos]);

  // grava/atualiza o retrato do mês atual ao abrir o app (1 por mês)
  useEffect(() => {
    const mesAtual = new Date().toISOString().slice(0,7); // AAAA-MM
    const patrimonio = ativos.reduce((s,a)=>s+a.qtd*a.cotacao,0);
    const divAnual = ativos.reduce((s,a)=>s+a.prov*a.meses.length*a.qtd,0);
    setHistorico(prev => {
      const semAtual = (prev||[]).filter(h=>h.mes!==mesAtual);
      return [...semAtual, { mes:mesAtual, data:new Date().toISOString(),
        patrimonio:+patrimonio.toFixed(2), divAnual:+divAnual.toFixed(2) }]
        .sort((a,b)=>a.mes.localeCompare(b.mes));
    });
  }, []); // só ao montar

  // log de início de sessão
  useEffect(() => {
    registrarLog("sistema", "App aberto", { direcao:"interno", origem:"app", detalhe:{ ativos: ativos.length, bridge: bridgeUrl } });
  }, []);

  // AUTO-DETECT do servidor (Tailscale → Local → localhost) ao abrir o app
  const [servidorNome, setServidorNome] = useState(null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const achado = await detectarServidor((s, ok) =>
        registrarLog("sistema", `Servidor ${s.nome}: ${ok ? "online ✓" : "sem resposta"}`, { direcao:"ida", origem:"app", detalhe:s.url })
      );
      if (!vivo) return;
      if (achado) {
        setBridgeUrl(achado.url);
        setServidorNome(achado.nome);
        try {
          localStorage.setItem(PREFIXO+"lastConnection", new Date().toISOString());
          const log = JSON.parse(localStorage.getItem(PREFIXO+"connectionLog")||"[]");
          log.push({ quando:new Date().toISOString(), servidor:achado.nome, url:achado.url });
          localStorage.setItem(PREFIXO+"connectionLog", JSON.stringify(log.slice(-30)));
        } catch {}
        registrarLog("sistema", `Conectado via ${achado.nome}`, { direcao:"volta", origem:"servidor", detalhe:achado.url });
      } else {
        registrarLog("erro", "Nenhum servidor respondeu ao /health", { direcao:"volta", origem:"app", detalhe:SERVIDORES.map(s=>s.url).join(", ") });
      }
    })();
    return () => { vivo = false; };
  }, []);

  // ── BOTÃO VOLTAR (Android/navegador): desfaz o percurso dentro do app ──
  const navPilha = useRef([]);
  const navRestaurando = useRef(false);
  const navPrev = useRef(null);
  useEffect(() => {
    const atual = { aba, showCarteira, showReserva, showConfig, showBlocos, showMeta, showAporte, editandoTicker };
    if (navPrev.current === null) { navPrev.current = atual; return; }
    if (JSON.stringify(atual) === JSON.stringify(navPrev.current)) return;
    if (navRestaurando.current) { navRestaurando.current = false; navPrev.current = atual; return; }
    navPilha.current.push(navPrev.current);
    if (navPilha.current.length > 60) navPilha.current.shift();
    navPrev.current = atual;
    try { window.history.pushState({ carteiraNav:true }, ""); } catch {}
  }, [aba, showCarteira, showReserva, showConfig, showBlocos, showMeta, showAporte, editandoTicker]);
  useEffect(() => {
    const onPop = () => {
      const alvo = navPilha.current.pop();
      if (!alvo) return; // pilha vazia → comportamento padrão (sair do app)
      navRestaurando.current = true;
      setAba(alvo.aba); setShowCarteira(!!alvo.showCarteira); setShowReserva(!!alvo.showReserva);
      setShowConfig(!!alvo.showConfig); setShowBlocos(!!alvo.showBlocos);
      setShowMeta(!!alvo.showMeta); setShowAporte(!!alvo.showAporte); setEditandoTicker(alvo.editandoTicker);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const T = TEMAS[temaId];
  const ehTV = layout === "tv";
  // fator de escala global: TV aumenta tudo, + multiplicador de fonte do usuario
  const escala = (ehTV ? 1.25 : 1) * fontEsc;

  const listaFiltrada = filtro==="TUDO"?ativos:filtro==="FII"?ativos.filter(a=>a.cat==="FII"):ativos.filter(a=>a.cat==="Ação");
  // proventos: total do ano (realizado + previsto), série da janela do gráfico e próximos 3 meses
  // todos os proventos que já caíram (planilha + histórico guardado em cada ativo, sem duplicatas)
  const registrosProv = useMemo(() => juntarRegistros(proventosRecebidos, ativos), [proventosRecebidos, ativos]);
  const resumoProv = useMemo(() => resumoAno(anoProv, ativos, registrosProv, eventosB3), [anoProv, ativos, proventosRecebidos, eventosB3]);
  const janelaSerie = useMemo(() => {
    const j = janelaProventos(janelaProv, anoProv, registrosProv, ativos);
    return serieProventos({ ativos, registros: registrosProv, eventos: eventosB3, inicio: j.inicio, fim: j.fim });
  }, [janelaProv, anoProv, ativos, proventosRecebidos, eventosB3]);
  const prox3Serie = useMemo(() => {
    const h = ymHojeStr();
    return serieProventos({ ativos, registros: registrosProv, eventos: eventosB3, inicio: h, fim: ymAdd(h, 2) });
  }, [ativos, proventosRecebidos, eventosB3]);
  // projeção usa o provento/cota digitado; se estiver vazio, o último recebido (mesma regra do calendário)
  const ativosProj = useMemo(() => ativos.map(a => a.prov > 0 ? a : { ...a, prov: porCotaVigente(a, registrosProv) }), [ativos, registrosProv]);
  const chartData = useMemo(()=>buildChart(ativosProj, filtro),[ativosProj, filtro]);
  // ano ATUAL fixo para a tela inicial e o menu (o gráfico pode navegar por outros anos sem afetar isto)
  const resumoAtual = useMemo(() => resumoAno(new Date().getFullYear(), ativos, registrosProv, eventosB3), [ativos, proventosRecebidos, eventosB3]);
  const totalAnual = resumoAtual.total; // total do ano atual (realizado + previsto) — cartão de dividendos
  // projeção dos próximos 12 meses pela carteira de hoje (mesma conta da versão anterior).
  // É a base da meta de proventos, contas pagas, custo de vida e cartão — NÃO mudar para o total do ano.
  const totalProj12 = chartData.reduce((s,d)=>s+d._total,0);
  const mediaMes   = totalProj12/12;
  const esteMesProv = (resumoAtual.linhas.find(l => l.ym === ymHojeStr()) || {}).total || 0;
  const recebidoTotal = +registrosProv.reduce((s,r)=>s+r.valor,0).toFixed(2);
  const notifEventos = useMemo(() => notificacoesDeEventos({ ativos, registros: registrosProv, eventos: eventosB3 }), [ativos, registrosProv, eventosB3]);
  const hojeIsoDicas = isoDia(new Date());
  // descarta dicas salvas que na verdade eram mensagem de erro do servidor (versão anterior guardava)
  const dicasValidas = (dicasIA && dicasIA.data === hojeIsoDicas ? (dicasIA.dicas || []) : []).filter(d => !ehRespostaDeErro(d.titulo) && !ehRespostaDeErro(d.texto));
  const dicasHoje = dicasValidas.map(d => ({ ...d, data: hojeIsoDicas }));
  // Dicas da IA: 1 pedido por dia, só se o servidor responder. Sem servidor, as dicas simplesmente não aparecem.
  useEffect(() => {
    if (!bridgeUrl || pedindoDicas.current || !ativos.length) return;
    if (dicasValidas.length) return;
    pedindoDicas.current = true;
    (async () => {
      try {
        const c1 = new AbortController(); const t1 = setTimeout(() => c1.abort(), 6000);
        const h = await fetch(`${bridgeUrl}/health`, { signal: c1.signal }); clearTimeout(t1);
        if (!h.ok) return;
        const pat = ativos.reduce((t,a)=>t+(a.qtd>0?a.qtd*a.cotacao:0),0) || 1;
        const linhas = ativos.filter(a=>a.qtd>0).sort((a,b)=>b.qtd*b.cotacao-a.qtd*a.cotacao).slice(0,25).map(a=>{
          const v = porCotaVigente(a, registrosProv); const dy = a.cotacao>0 && v>0 ? (v*(a.meses||[]).length/a.cotacao*100) : 0;
          return `${a.ticker} (${a.cat}${a.setor?"/"+a.setor:""}): ${a.qtd} cotas, PM ${a.precoMedio||"?"}, cotação ${a.cotacao}, ${((a.qtd*a.cotacao)/pat*100).toFixed(1)}% da carteira, DY ~${dy.toFixed(1)}% a.a.`;
        }).join("\n");
        const mensagem = `Analise minha carteira e me dê EXATAMENTE 4 dicas práticas e específicas para melhorá-la hoje (diversificação, concentração, renda mensal, preço médio, reserva). `
          + `Responda SOMENTE com um JSON no formato [{"titulo":"até 8 palavras","texto":"até 3 frases"}], em português, sem texto fora do JSON.\n`
          + `Patrimônio R$ ${pat.toFixed(2)}; renda média prevista R$ ${(totalProj12/12).toFixed(2)}/mês; meta R$ ${metaMensal}/mês.\n${linhas}`;
        const carteira = { totalPatrimonio: +pat.toFixed(2), proventoAnual: +totalProj12.toFixed(2),
          ativos: ativos.filter(a=>a.qtd>0).map(a=>({ ticker:a.ticker, cat:a.cat, qtd:a.qtd, precoMedio:a.precoMedio, cotacao:a.cotacao, provMes:porCotaVigente(a, registrosProv) })) };
        const capDicas = capacidadePensar(iaModelo);
        const corpo = JSON.stringify({ mensagem: mensagem + (capDicas === "opcional" ? "\n/no_think" : ""), historico: [], carteira,
          maxTokens: capDicas === "sempre" ? 4096 : 2048, ...(capDicas === "opcional" ? { pensar: false } : {}), ...(iaModelo ? { modelo: iaModelo } : {}),
          instrucoes: "Você é um consultor de carteira de dividendos (FIIs e ações da B3). Gere dicas práticas, específicas e curtas em português do Brasil, baseadas nos dados reais. Responda apenas com o JSON pedido." });
        registrarLog("chat", "Pedindo as dicas do dia para a IA", { direcao:"ida", origem:"servidor" });
        let texto = "";
        try {
          const c2 = new AbortController(); const t2 = setTimeout(() => c2.abort(), 300000);
          let r = await fetch(`${bridgeUrl}/ia/chat/stream`, { method:"POST", headers:{ "Content-Type":"application/json" }, signal:c2.signal, body: corpo });
          if (r.status === 404) r = await fetch(`${bridgeUrl}/chat/stream`, { method:"POST", headers:{ "Content-Type":"application/json" }, signal:c2.signal, body: corpo });
          if (!r.ok || !r.body) throw new Error(`stream HTTP ${r.status}`);
          const leitor = r.body.getReader(); const dec = new TextDecoder();
          for (;;) { const { done, value } = await leitor.read(); if (done) break; texto += dec.decode(value, { stream:true }); }
          clearTimeout(t2);
          texto = texto.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/\[\[THINK\]\][\s\S]*?(\[\[\/THINK\]\]|$)/g, "");
        } catch (eStream) {
          const c3 = new AbortController(); const t3 = setTimeout(() => c3.abort(), 180000);
          const r = await fetch(`${bridgeUrl}/chat`, { method:"POST", headers:{ "Content-Type":"application/json" }, signal:c3.signal, body: corpo });
          clearTimeout(t3);
          const d0 = await r.json().catch(() => ({}));
          texto = r.ok ? (d0.resposta || d0.texto || "") : "";
        }
        const d = { resposta: texto };
        const dicas = lerDicasIA(texto).slice(0, 6);
        if (dicas.length) {
          setDicasIA({ data: hojeIsoDicas, dicas, em: Date.now() });
          registrarLog("chat", `Dicas do dia recebidas (${dicas.length})`, { direcao:"volta", origem:"servidor" });
        } else registrarLog("erro", "A IA respondeu, mas não deu para ler as dicas", { direcao:"volta", origem:"servidor", detalhe:String(d && d.resposta || "").slice(0,200) });
      } catch (e) {
        registrarLog("sistema", `Dicas da IA indisponíveis agora: ${e.name === "AbortError" ? "tempo esgotado" : e.message}`, { direcao:"volta", origem:"servidor" });
      }
    })();
    // eslint-disable-next-line
  }, [bridgeUrl, ativos.length, hojeIsoDicas, dicasValidas.length]);
  const primeiroRecebimento = registrosProv.length ? registrosProv.map(r=>ymDe(r.data)).sort()[0] : null;
  // dividendo previsto para o mês atual (pela data real) — usado no card do topo
  const provEsteMes = (() => {
    const hoje = new Date();
    const m = hoje.getMonth()+1;
    const primeiroDiaMes = `${hoje.getFullYear()}-${String(m).padStart(2,"0")}-01`;
    return ativos.filter(a=>a.qtd>0 && a.prov>0 && a.meses.includes(m)).reduce((s,a)=>{
      // se comprou DURANTE ou DEPOIS do início do mês, não recebe o provento deste mês (data-base ~ início do mês)
      if (a.dataCompra && a.dataCompra >= primeiroDiaMes) return s;
      return s + a.prov*a.qtd;
    }, 0);
  })();
  const patrimonioTotal = ativos.reduce((s,a)=>s+a.qtd*a.cotacao,0);
  // valor aplicado = quantidade × preço médio (sem preço médio, usa a cotação → variação zero naquele ativo)
  const aplicadoTotal = ativos.reduce((s,a)=>s+(a.qtd>0 ? a.qtd*(a.precoMedio>0 ? a.precoMedio : (a.cotacao||0)) : 0),0);
  const evolucao = useMemo(() => evolucaoPatrimonio({ ativos, vendidos: vendidosHist, historico, patrimonioAtual: patrimonioTotal, aplicadoAtual: aplicadoTotal }), [ativos, vendidosHist, historico, patrimonioTotal, aplicadoTotal]);
  // aporte realizado este mês = soma das compras (movimentações da planilha B3) no mês atual
  const aporteEsteMes = (() => {
    const hoje = new Date();
    const mesKey = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,"0")}`;
    let t = 0;
    ativos.forEach(a => (a.movimentacoes||[]).forEach(mv => {
      if (mv.tipo==="compra" && mv.data && mv.data.slice(0,7)===mesKey) t += Math.abs(mv.qtd)*(mv.preco||0);
    }));
    return +t.toFixed(2);
  })();
  const maxMes     = Math.max(...chartData.map(d=>d._total), 0);
  const positivos  = chartData.filter(d=>d._total>0);
  const minMes     = positivos.length ? Math.min(...positivos.map(d=>d._total)) : 0;
  const totFII  = useMemo(()=>buildChart(ativosProj,"FII").reduce((s,d)=>s+d._total,0),[ativosProj]);
  const totAcao = useMemo(()=>buildChart(ativosProj,"Ação").reduce((s,d)=>s+d._total,0),[ativosProj]);
  const rotuloMesChart = (v) => { const d = chartData.find(x=>x._total===v); return d ? String(d.mes).split("/")[0] : null; };

  const FILTROS = [
    {id:"TUDO",emoji:"📊",label:"Panorama", sub:"Ações + FIIs",cor:T.accentSoft},
    {id:"FII", emoji:"🏢",label:"Só FIIs",  sub:`${ativos.filter(a=>a.cat==="FII").length} fundos`, cor:T.cyan},
    {id:"Ação",emoji:"📈",label:"Só Ações", sub:`${ativos.filter(a=>a.cat==="Ação").length} ações`, cor:T.accent},
  ];
  // navegação organizada em seções (para a gaveta lateral)
  const SECOES = [
    { titulo:"Visão geral", itens:[
      {id:"painel",     label:"Início",      emoji:"🏠", desc:"Patrimônio, dividendos e meta"},
      {id:"analises",   label:"Análises",    emoji:"🔬", desc:"Gráfico detalhado + saúde"},
      {id:"calendario", label:"Calendário",  emoji:"📅", desc:"Quando cada um paga"},
      {id:"ranking",    label:"Ranking",     emoji:"🏆", desc:"Proventos e valorização"},
    ]},
    { titulo:"Planejamento", itens:[
      {id:"cenario",    label:"Cenário",     emoji:"🤖", desc:"Simular reinvestimento"},
      {id:"custovida",  label:"Custo de Vida",emoji:"🧾",desc:"Gastos e marcos"},
      {id:"historico",  label:"Histórico",    emoji:"🗂️",desc:"Compras e proventos recebidos"},
      {id:"cartao",     label:"Cartão",      emoji:"💳", desc:"Jornada sem crédito"},
    ]},
    { titulo:"Gerenciar", itens:[
      {id:"editar",     label:"Editar ativos",emoji:"✏️",desc:"Quantidades e cotações"},
      {id:"chat",       label:"Assistente IA",emoji:"🤖",desc:"Converse sobre a carteira"},
    ]},
  ];
  const TODAS_ABAS = SECOES.flatMap(s=>s.itens);
  const abaAtual = TODAS_ABAS.find(a=>a.id===aba) || TODAS_ABAS[0];

  return (
    <div className={T.espacoso ? "app-espacoso" : ""} style={{ background:T.bg,minHeight:"100vh",color:T.text,fontFamily:"'Inter',system-ui,sans-serif",paddingBottom:140,transition:"background 0.3s", ...estiloDe("fundoApp",13).style }}>

      {/* WRAPPER DE ESCALA — transform:scale escala TUDO (px fixos inclusive).
          Usa 'zoom': escala tudo (px fixos inclusive) e reflui naturalmente,
          sem cortar conteúdo longo. */}
      <div style={{ zoom: escala, maxWidth: ehTV ? Math.round(1100/escala) : "none", margin:"0 auto" }}>
      {/* container interno centralizado para TV */}
      <div style={{ maxWidth: ehTV ? 1100 : "none", margin:"0 auto" }}>

      {/* HEADER — barra superior: menu, título, configurações e análises */}
      <div className={estiloDe("headerApp",13).cls} style={{ padding: densidade==="compacto" ? "12px 14px 8px" : "16px 16px 10px", ...estiloDe("headerApp",13).style }}>
        <div style={{ display:"flex", alignItems:"center", gap:9, minWidth:0 }}>
          <button onClick={()=>setMenuAberto(true)} title="Menu" aria-label="Abrir menu" style={{ width:44, height:42, borderRadius:14, border:`1px solid ${T.border}`, background:T.cardAlt, cursor:"pointer", padding:0, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", color:T.text }}>
            <Icone nome="menu" size={24} cor={T.text}/>
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <TextoAjustado max={estiloDe("logoApp",26).style.fontSize || 26} min={12} className={estiloDe("logoApp",26).cls} style={{ fontWeight:800, color:T.text, letterSpacing:-0.5, ...estiloDe("logoApp",26).style }}>
              Carteira{ehTV && <span style={{ color:T.green, fontSize:14 }}> · TV</span>}
            </TextoAjustado>
          </div>
          <button onClick={()=>setShowConfig(true)} title="Configurações" aria-label="Configurações" style={{ width:42, height:42, borderRadius:"50%", border:`1px solid ${T.border}`, background:T.card, cursor:"pointer", padding:0, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px #0000001a" }}>
            <Icone nome="engrenagem" size={22} cor={T.accent}/>
          </button>
          <button onClick={()=>setAba("analises")} title="Análises" aria-label="Abrir análises" style={{ width:42, height:42, borderRadius:"50%", border:`1px solid ${T.border}`, background:T.card, cursor:"pointer", padding:0, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px #0000001a" }}>
            <Icone nome="barras" size={20} cor={T.accent}/>
          </button>
          <CentralNotificacoes eventos={notifEventos} dicas={dicasHoje} vistas={notifVistas}
            onMarcarVistas={(ids)=>setNotifVistas(prev=>[...new Set([...(prev||[]), ...ids])].slice(-400))}
            onAbrirCalendario={()=>setAba("calendario")} T={T}/>
        </div>
      </div>

      {/* MODAL DEFINIR META */}
      {showMeta && (
        <ModalMeta metaMensal={metaMensal} setMetaMensal={setMetaMensal} valorAtual={mediaMes} onClose={()=>setShowMeta(false)} T={T} />
      )}

      {showMetaPat && (
        <ModalMetaPatrimonio valor={metaPatrimonio} patrimonio={patrimonioTotal} onSalvar={setMetaPatrimonio} onClose={()=>setShowMetaPat(false)} T={T}/>
      )}

      {showAporte && (
        <ModalAporte metaAporte={metaAporte} setMetaAporte={setMetaAporte} aporteEsteMes={aporteEsteMes} onClose={()=>setShowAporte(false)} T={T} />
      )}

      {/* PAINEL DE CONFIGURAÇÕES (modal) */}
      {showCarteira && <TelaCarteira ativos={ativos} onClose={()=>setShowCarteira(false)} onEditar={()=>setAba("editar")} T={T}/>}

      {showReserva && <TelaReservaPlus ativos={ativos} onClose={()=>setShowReserva(false)} T={T}/>}

      {showBlocos && <OrganizarBlocos layoutBlocos={layoutBlocos} setLayoutBlocos={setLayoutBlocos} onClose={()=>setShowBlocos(false)} T={T}/>}

      {/* popup de customização do elemento escolhido */}
      <AnimatePresence>
        {editandoElemento === "__lista__" && (
          <div onClick={()=>setEditandoElemento(null)} style={{ position:"fixed", inset:0, background:"#000b", zIndex:1600, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
            <motion.div onClick={e=>e.stopPropagation()} initial={{ y:"100%" }} animate={{ y:0 }} exit={{ y:"100%" }} transition={{ type:"spring", stiffness:340, damping:32 }}
              style={{ background:T.bg, borderRadius:"20px 20px 0 0", width:"100%", maxWidth:460, maxHeight:"80vh", overflowY:"auto", padding:"18px 18px 26px" }}>
              <div style={{ width:38, height:4, borderRadius:2, background:T.border, margin:"0 auto 14px" }}/>
              <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:12 }}>📋 Todos os elementos</div>
              {Array.from(new Set(Object.values(ELEMENTOS_ESTILO).map(e=>e.grupo))).map(grupo=>(
                <div key={grupo} style={{ marginBottom:12 }}>
                  <div style={{ fontSize:10, color:T.textMute, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6 }}>{grupo}</div>
                  {Object.entries(ELEMENTOS_ESTILO).filter(([id,e])=>e.grupo===grupo).map(([id,e])=>(
                    <button key={id} onClick={()=>setEditandoElemento(id)} style={{ display:"flex", alignItems:"center", gap:8, width:"100%", textAlign:"left", padding:"10px 12px", marginBottom:5, borderRadius:10, border:`1px solid ${(estilosCustom||{})[id]?T.accent:T.border}`, background:(estilosCustom||{})[id]?`${T.accent}10`:T.card, color:T.text, cursor:"pointer", fontSize:12, fontWeight:600 }}>
                      <span>✏️</span><span style={{ flex:1 }}>{e.nome}</span>
                      {(estilosCustom||{})[id] && <span style={{ fontSize:9, color:T.accentSoft, fontWeight:700 }}>personalizado</span>}
                    </button>
                  ))}
                </div>
              ))}
            </motion.div>
          </div>
        )}
        {editandoElemento && editandoElemento !== "__lista__" && (
          <PopupCustomizar id={editandoElemento} estilosCustom={estilosCustom} setEstilosCustom={setEstilosCustom}
            onClose={()=>setEditandoElemento(null)} T={T}/>
        )}
      </AnimatePresence>

      {/* barra do MODO DE EDIÇÃO (substitui o menu flutuante enquanto ativo) */}
      <AnimatePresence>
        {modoEdicao && !editandoElemento && (
          <motion.div
            initial={{ y:100, opacity:0 }} animate={{ y:0, opacity:1 }} exit={{ y:100, opacity:0 }}
            transition={{ type:"spring", stiffness:340, damping:28 }}
            style={{ position:"fixed", left:0, right:0, bottom:0, zIndex:1500, background:T.card, borderTop:`2px solid ${T.accent}`, boxShadow:"0 -8px 30px #0006", padding:"12px 14px calc(12px + env(safe-area-inset-bottom))" }}
          >
            <div style={{ display:"flex", alignItems:"center", gap:8, maxWidth:460, margin:"0 auto" }}>
              <span style={{ fontSize:18 }}>🎨</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:800, color:T.text }}>Modo de edição</div>
                <div style={{ fontSize:9, color:T.textFaint }}>Toque nos ✏️ para personalizar cada elemento</div>
              </div>
              <button onClick={()=>setEditandoElemento("__lista__")}
                style={{ padding:"9px 12px", borderRadius:9, border:`1px solid ${T.cyan}66`, background:`${T.cyan}14`, color:T.cyan, cursor:"pointer", fontSize:11, fontWeight:700 }}>📋 Todos</button>
              <button onClick={()=>{ if(window.confirm("Restaurar TODOS os elementos ao padrão de instalação?")) setEstilosCustom(null); }}
                style={{ padding:"9px 12px", borderRadius:9, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:11, fontWeight:700 }}>♻️</button>
              <button onClick={()=>setModoEdicao(false)}
                style={{ padding:"11px 18px", borderRadius:9, border:"none", background:T.accent, color:"#fff", cursor:"pointer", fontSize:12, fontWeight:800 }}>✓ Concluir</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* POPUP GLOBAL DE EDITAR/ADICIONAR ATIVO — abre de qualquer lugar */}
      {editandoTicker!==undefined && (
        <EditarAtivoPopup ticker={editandoTicker} ativos={ativos} setAtivos={setAtivos} onClose={()=>setEditandoTicker(undefined)} eventos={eventosB3} bridgeUrl={bridgeUrl} T={T}/>
      )}

      {/* MENU FLUTUANTE — Home no centro + atalhos, sempre leva à Home */}
      {/* BARRA DE PREVIEW — aparece durante a pré-visualização de alterações da IA */}
      {previewAtivo && (
        <div style={{ position:"fixed", left:0, right:0, bottom:0, zIndex:1500, background:T.card, borderTop:`2px solid ${T.accent}`, boxShadow:"0 -8px 30px #0006", padding:"12px 14px calc(12px + env(safe-area-inset-bottom))" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <span style={{ fontSize:16 }}>👁️</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:800, color:T.text }}>Pré-visualização de alterações</div>
              <div style={{ fontSize:10, color:T.textMute, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{previewResumo.join(" · ") || "navegue pelo app para ver como fica"}</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={cancelarPreview} style={{ flex:1, padding:"12px", borderRadius:10, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.textDim, cursor:"pointer", fontSize:14, fontWeight:700 }}>Cancelar</button>
            <button onClick={aplicarPreview} style={{ flex:2, padding:"12px", borderRadius:10, border:"none", background:T.accent, color:"#fff", cursor:"pointer", fontSize:14, fontWeight:800 }}>✓ Aplicar</button>
          </div>
        </div>
      )}

      {!showCarteira && !showReserva && !previewAtivo && editandoTicker===undefined && (
        <motion.div
          initial={{ y:80, opacity:0 }}
          animate={{ y: modoEdicao ? 120 : 0, opacity: modoEdicao ? 0 : 1 }}
          transition={{ type:"spring", stiffness:320, damping:26 }}
          style={{ position:"fixed", left:0, right:0, bottom:14, padding:"0 10px", display:"flex", justifyContent:"center", zIndex:900, pointerEvents: modoEdicao ? "none" : "none" }}
        >
          <motion.div layout className={estiloDe("menuFlutuante",13).cls} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:2, width:"100%", maxWidth:420, minWidth:0, background:T.card, border:`1px solid ${T.borderSoft}`, borderRadius:30, padding:"7px 10px", boxShadow:"0 8px 30px #0006", pointerEvents: modoEdicao ? "none" : "auto", ...estiloDe("menuFlutuante",13).style }}>
            {[
              { id:"analises",   ic:"barras", lb:"Análises" },
              { id:"calendario", ic:"calendario", lb:"Calendário" },
              { id:"__chat__",   ic:"robo",   lb:"IA" },
              { id:"__home__",   ic:"casa",   lb:"Início" },
              { id:"ranking",    ic:"trofeu", lb:"Ranking" },
              { id:"editar",     ic:"lapis",  lb:"Editar" },
            ].map(item=>{
              const home = item.id==="__home__";
              const chat = item.id==="__chat__";
              const ativoTab = home ? aba==="painel" : chat ? aba==="chat" : aba===item.id;
              const corTexto = home ? "#fff" : (ativoTab ? T.accent : T.textDim);
              return (
                <motion.button
                  key={item.id}
                  onClick={()=>{
                    const alvo = home ? "painel" : chat ? "chat" : item.id;
                    if (aba===alvo) { try{ window.scrollTo({top:0,behavior:"smooth"}); }catch(e){ window.scrollTo(0,0);} }
                    else { setAba(alvo); }
                  }}
                  title={item.lb}
                  aria-label={item.lb}
                  whileTap={{ scale:0.88 }}
                  whileHover={{ scale:1.05 }}
                  animate={{ y: home ? -12 : 0 }}
                  transition={{ type:"spring", stiffness:420, damping:22 }}
                  style={{
                    position:"relative",
                    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2, cursor:"pointer", border:"none",
                    background: home ? T.accent : "transparent", color: corTexto,
                    borderRadius: home ? "50%" : 18,
                    flex: home ? "0 0 64px" : "1 1 0", minWidth:0, maxWidth: home ? 64 : 70, width: home ? 64 : "auto", height: home ? 64 : 54, padding:0,
                    boxShadow: home ? `0 8px 18px ${T.accent}66` : "none",
                    ...estiloDe("menuBotao",8).style,
                  }}
                >
                  {/* fundo da aba ativa (layoutId faz o destaque deslizar entre os botões) */}
                  {ativoTab && !home && (
                    <motion.span layoutId="abaAtiva" transition={{ type:"spring", stiffness:400, damping:30 }}
                      style={{ position:"absolute", inset:0, borderRadius:18, background:T.accentBg, border:`1px solid ${T.accentBorder}55`, pointerEvents:"none" }}/>
                  )}
                  <span style={{ position:"relative" }}><Icone nome={item.ic} size={home ? 28 : 23} cor={corTexto}/></span>
                  <span style={{ position:"relative", fontSize: home ? 11 : "clamp(8.5px, 2.5vw, 10px)", letterSpacing: home ? 0 : -0.2, fontWeight: ativoTab || home ? 800 : 600, maxWidth:"100%", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.lb}</span>
                </motion.button>
              );
            })}
          </motion.div>
        </motion.div>
      )}

      {showConfig && (
        <PainelConfig
          T={T}
          iaModelo={iaModelo} setIaModelo={setIaModelo} iaInstrucoes={iaInstrucoes} setIaInstrucoes={setIaInstrucoes}
          temaId={temaId} setTemaId={setTemaId}
          layout={layout} setLayout={setLayout}
          fontEsc={fontEsc} setFontEsc={setFontEsc}
          densidade={densidade} setDensidade={setDensidade}
          bridgeUrl={bridgeUrl} setBridgeUrl={setBridgeUrl}
          metaPatrimonio={metaPatrimonio} setMetaPatrimonio={setMetaPatrimonio}
          onResetDados={()=>{
            if(window.confirm("RESET DE DADOS DA CARTEIRA\n\nIsso volta seus ativos, metas e custo de vida ao estado inicial. Suas preferências de aparência (tema, layout) são mantidas.\n\nUm backup dos dados atuais será guardado para você desfazer. Continuar?")){
              try { localStorage.setItem(PREFIXO+"backupDados", JSON.stringify({ ativos, metaMensal, metaAporte, custoVida, proventosRecebidos, historico, quando:new Date().toISOString() })); } catch {}
              setAtivos(ATIVOS_INICIAIS.map(a=>({...a})));
              setMetaMensal(500); setMetaAporte(0);
              setCustoVida({ agua:100, luz:200, condominio:0, aluguel:1000, internet:120, outros:0 });
              setProventosRecebidos({ porMes:{}, porMesBruto:{}, total:0, totalBruto:0, totalImposto:0, registros:[] });
              registrarLog("sistema","Reset de dados da carteira (backup guardado)",{ direcao:"interno", origem:"app" });
              setShowConfig(false);
            }
          }}
          onResetApp={()=>{
            if(window.confirm("RESET DE CONFIGURAÇÃO DO APP\n\nIsso volta a aparência (tema, layout, densidade, fonte) ao padrão de instalação. Seus dados da carteira NÃO são afetados. Continuar?")){
              setTemaId("minimalista2"); setLayout("celular"); setFontEsc(1); setDensidade("confortavel"); setLayoutBlocos(null); setEstilosCustom(null);
              registrarLog("sistema","Reset de configuração do app (aparência padrão)",{ direcao:"interno", origem:"app" });
              setShowConfig(false);
            }
          }}
          onDesfazerDados={()=>{
            try {
              const b = JSON.parse(localStorage.getItem(PREFIXO+"backupDados")||"null");
              if (!b) { window.alert("Não há backup de dados para desfazer."); return; }
              if(window.confirm(`Restaurar os dados da carteira do backup de ${new Date(b.quando).toLocaleString("pt-BR")}? Isso desfaz o último reset/alteração grave.`)){
                if (b.ativos) setAtivos(b.ativos);
                if (b.metaMensal!=null) setMetaMensal(b.metaMensal);
                if (b.metaAporte!=null) setMetaAporte(b.metaAporte);
                if (b.custoVida) setCustoVida(b.custoVida);
                if (b.proventosRecebidos) setProventosRecebidos(b.proventosRecebidos);
                if (b.historico) setHistorico(b.historico);
                registrarLog("sistema","Dados da carteira restaurados do backup",{ direcao:"interno", origem:"app" });
                setShowConfig(false);
              }
            } catch(e){ window.alert("Erro ao restaurar backup."); }
          }}
          onExportar={async ()=>{
            // Backup de TUDO: todas as chaves do app no aparelho (todas as contas, ativos, proventos, eventos,
            // vendidos, metas, aparência, blocos, gráficos de cotação salvos, servidor de IA) + os campos antigos
            // (ativos, meta…) para continuar compatível com backups anteriores.
            const chaves = {};
            try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("carteiraProventos")) chaves[k] = localStorage.getItem(k); } } catch { /* sem acesso */ }
            const backup = {
              app:"CarteiraProventos", versao:"2.0.0", tipo:"completo", data:new Date().toISOString(),
              ativos, meta:metaMensal, custoVida, fundosProvisionados, tema:temaId, layout, fonte:fontEsc, densidade,
              chaves, totalChaves:Object.keys(chaves).length,
            };
            const conteudo = JSON.stringify(backup, null, 1);
            const agora = new Date();
            const nome = `carteira-backup-${agora.toISOString().slice(0,10)}-${String(agora.getHours()).padStart(2,"0")}${String(agora.getMinutes()).padStart(2,"0")}.json`;
            try {
              if (Capacitor.isNativePlatform()) {
                const r = await SalvarArquivo.salvar({ nome, conteudo, mime:"application/json" });
                if (r && r.salvo) {
                  registrarLog("sistema", `Backup completo salvo (${Object.keys(chaves).length} itens)`, { direcao:"interno", origem:"app", detalhe:r.uri || nome });
                  window.alert(`Backup salvo! ${Object.keys(chaves).length} itens do app em "${nome}".`);
                } else registrarLog("sistema", "Backup cancelado (nenhuma pasta escolhida)", { direcao:"interno", origem:"app" });
                return;
              }
              // navegador: download comum
              const blob = new Blob([conteudo], { type:"application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = nome;
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              URL.revokeObjectURL(url);
            } catch(e){
              registrarLog("erro", `Backup falhou: ${e.message}`, { direcao:"interno", origem:"app" });
              window.alert("Não foi possível salvar o backup: " + (e && e.message ? e.message : e) + (/not implemented|não implementado|SalvarArquivo/i.test(String(e && e.message)) ? "\n\nEste APK foi gerado sem o plugin de salvar arquivo. Gere de novo pelo GitHub Actions com o build.yml atualizado." : ""));
            }
          }}
          usuario={usuario}
          onLogout={onLogout}
          onRemodelar={()=>{ setShowConfig(false); setAba("painel"); setModoEdicao(true); }}
          onOrganizarBlocos={()=>{ setShowConfig(false); setShowBlocos(true); }}
          onExportarPDF={()=>{
            try {
              registrarLog("sistema", "Relatório PDF gerado", { direcao:"interno", origem:"app" });
              gerarRelatorioPDF({ ativos, metaMensal, custoVida, totalAnual: totalProj12, provEsteMes, mediaMes, patrimonioTotal });
            } catch(e){ window.alert("Não foi possível gerar o PDF: "+e.message); }
          }}
          onImportar={()=>{
            try {
              const input = document.createElement("input");
              input.type = "file"; input.accept = "application/json,.json";
              input.onchange = (ev) => {
                const file = ev.target.files?.[0]; if(!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const d = JSON.parse(reader.result);
                    if(!d || !Array.isArray(d.ativos)) { window.alert("Arquivo inválido."); return; }
                    // backup completo (2.0+): restaura todas as chaves do app e reinicia
                    if (d.chaves && typeof d.chaves === "object" && Object.keys(d.chaves).length) {
                      if(!window.confirm(`Restaurar o backup completo de ${new Date(d.data).toLocaleString("pt-BR")}? Ele substitui TODOS os dados atuais do app (${Object.keys(d.chaves).length} itens) e o app reinicia.`)) return;
                      const atuais = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("carteiraProventos")) atuais.push(k); }
                      atuais.forEach(k => localStorage.removeItem(k));
                      Object.entries(d.chaves).forEach(([k, v]) => { if (k.startsWith("carteiraProventos")) localStorage.setItem(k, v); });
                      registrarLog("sistema", "Backup completo restaurado", { direcao:"interno", origem:"app" });
                      window.location.reload();
                      return;
                    }
                    if(!window.confirm("Importar este backup vai substituir seus dados atuais. Continuar?")) return;
                    setAtivos(d.ativos);
                    if(d.meta!=null) setMetaMensal(d.meta);
                    if(d.custoVida) setCustoVida(d.custoVida);
                    if(d.fundosProvisionados!=null) setFundosProvisionados(d.fundosProvisionados);
                    if(d.tema) setTemaId(d.tema);
                    if(d.layout) setLayout(d.layout);
                    if(d.fonte) setFontEsc(d.fonte);
                    if(d.densidade) setDensidade(d.densidade);
                    setShowConfig(false);
                    window.alert("Backup importado com sucesso!");
                  } catch { window.alert("Não foi possível ler o arquivo."); }
                };
                reader.readAsText(file);
              };
              input.click();
            } catch(e){ window.alert("Importação indisponível neste ambiente. No APK funciona normalmente."); }
          }}
          onClose={()=>setShowConfig(false)}
        />
      )}

      {/* GAVETA LATERAL — navegação */}
      {menuAberto && (
        <div onClick={()=>setMenuAberto(false)} className="modal-overlay" style={{ position:"fixed", inset:0, background:"#000a", zIndex:1050, display:"flex" }}>
          <div onClick={e=>e.stopPropagation()} className="drawer-anim" style={{
            width:"82%", maxWidth:320, height:"100%", background:T.bg, borderRight:`1px solid ${T.borderSoft}`,
            boxShadow:"4px 0 30px #000a", overflowY:"auto", display:"flex", flexDirection:"column"
          }}>
            {/* cabeçalho da gaveta */}
            <div style={{ padding:"18px 16px 14px", borderBottom:`1px solid ${T.border}`, background:T.bgHeader }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:14, fontWeight:800, color:T.text }}>💰 Carteira Proventos</div>
                <button onClick={()=>setMenuAberto(false)} style={{ width:32,height:32,borderRadius:8,border:`1px solid ${T.border}`,background:T.cardAlt,color:T.text,cursor:"pointer",fontSize:15 }}>✕</button>
              </div>
              <div style={{ fontSize:10, color:T.textFaint, marginTop:4 }}>{fmt(totalProj12)}/ano · {fmt(mediaMes)}/mês</div>
            </div>

            {/* seções */}
            <div style={{ flex:1, padding:"8px 10px" }}>
              {SECOES.map(sec=>(
                <div key={sec.titulo} style={{ marginBottom:20 }}>
                  <div style={{ fontSize:9, color:T.textFaint, textTransform:"uppercase", letterSpacing:1.5, padding:"6px 8px 4px" }}>{sec.titulo}</div>
                  {sec.itens.map(it=>{
                    const ativo = aba===it.id;
                    return (
                      <button key={it.id} onClick={()=>{ setAba(it.id); setMenuAberto(false); }} style={{
                        width:"100%", display:"flex", alignItems:"center", gap:12, textAlign:"left",
                        padding:"11px 12px", marginBottom:2, borderRadius:10, cursor:"pointer",
                        border:"none", background: ativo?T.accentBg:"transparent",
                        borderLeft:`3px solid ${ativo?T.accent:"transparent"}`
                      }}>
                        <span style={{ fontSize:19 }}>{it.emoji}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, fontWeight:700, color: ativo?T.accentSoft:T.text }}>{it.label}</div>
                          <div style={{ fontSize:9, color:T.textFaint }}>{it.desc}</div>
                        </div>
                        {ativo && <span style={{ fontSize:11, color:T.accent }}>●</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* rodapé: configurações */}
            <div style={{ padding:"10px 14px 16px", borderTop:`1px solid ${T.border}` }}>
              <button onClick={()=>{ setMenuAberto(false); setShowConfig(true); }} style={{
                width:"100%", display:"flex", alignItems:"center", gap:10, padding:"11px 12px",
                borderRadius:10, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.textDim, cursor:"pointer", fontSize:13, fontWeight:600
              }}>⚙️ Configurações</button>
            </div>
          </div>
        </div>
      )}

      <div key={aba} className="tela-anim" style={{ padding:"14px" }}>
        {/* TÍTULO DA TELA ATUAL (substitui a barra de abas) — oculto no Painel (lá o "Boa noite" é o destaque) */}
        {aba!=="painel" && (
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <span style={{ fontSize:22 }}>{abaAtual.emoji}</span>
            <div>
              <div style={{ fontSize:18,fontWeight:800,color:T.text,lineHeight:1.2,marginBottom:3 }}>{abaAtual.label}</div>
              <div style={{ fontSize:11,color:T.textFaint }}>{abaAtual.desc}</div>
            </div>
          </div>
          {aba==="chat" ? (
            <button onClick={()=>setShowVozChat(true)} title="Configurar a voz da IA" aria-label="Configurar a voz da IA" style={{ width:42, height:42, borderRadius:"50%", border:`1px solid ${T.border}`, background:T.card, cursor:"pointer", padding:0, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px #0000001a", flexShrink:0 }}>
              <Icone nome="voz" size={21} cor={T.accent}/>
            </button>
          ) : (
          <button onClick={()=>setMenuAberto(true)} style={{ display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:9,border:`1px solid ${T.border}`,background:T.card,color:T.textMute,cursor:"pointer",fontSize:11,fontWeight:600 }}>
            ☰ Menu
          </button>
          )}
        </div>
        )}

        {/* FILTROS — seletor segmentado (só em gráfico/ranking) */}
        {(aba==="analises"||aba==="ranking") && (
          <div style={{ display:"flex", gap:3, background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:3, marginBottom:20 }}>
            {FILTROS.map(f=>{
              const sel=filtro===f.id;
              return (
                <button key={f.id} onClick={()=>{setFiltro(f.id);setMesSel(0);}} style={{ flex:"1 1 0",padding:"8px 4px",borderRadius:7,border:"none",cursor:"pointer",background:sel?`${f.cor}22`:"transparent",textAlign:"center",transition:"background 0.2s" }}>
                  <span style={{ fontSize:13,marginRight:5 }}>{f.emoji}</span>
                  <span style={{ fontSize:12,fontWeight:700,color:sel?f.cor:T.textMute }}>{f.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ABA PAINEL (tela inicial) — topo no layout novo + tudo o que a página tinha antes */}
        {aba==="painel" && (<>
          <TelaInicio patrimonio={patrimonioTotal} aplicado={aplicadoTotal} evolucao={evolucao} metaPatrimonio={metaPatrimonio}
            resumo={resumoAtual} esteMes={esteMesProv} proj12={totalProj12} recebidoTotal={recebidoTotal} primeiroRecebimento={primeiroRecebimento}
            kpis={{ mediaMes, maxMes, maxRotulo: rotuloMesChart(maxMes), minMes, minRotulo: rotuloMesChart(minMes), totFII, totAcao }}
            metas={<CarrosselMetas ativos={ativos} mediaMes={mediaMes} metaMensal={metaMensal} metaAporte={metaAporte} aporteEsteMes={aporteEsteMes} custoVida={custoVida} onConfigurar={()=>setShowMeta(true)} onConfigAporte={()=>setShowAporte(true)} onAbrirAnalises={()=>setAba("analises")} onAbrirContas={()=>setAba("custovida")} onAbrirReserva={()=>setShowReserva(true)} estiloDe={estiloDe} T={T} />}
            onDefinirMetaPatrimonio={()=>setShowMetaPat(true)} onVerCarteira={()=>setShowCarteira(true)} onImportar={()=>setAba("editar")}
            modoEdicao={modoEdicao} onEditar={setEditandoElemento} estiloDe={estiloDe} T={T}/>
          <div style={{ height:14 }}/>
          <PainelCarteira ativos={ativos} historico={historico} proventosRecebidos={proventosRecebidos} blocosRender={blocosJSX("painel")} estiloDe={estiloDe} modoEdicao={modoEdicao} onEditar={setEditandoElemento} T={T}/>
        </>)}

        {/* ABA CALENDÁRIO */}
        {aba==="calendario" && (<>{blocosJSX("calendario")}<CalendarioProventos ativos={ativos} registros={registrosProv} eventos={eventosB3} T={T}/></>)}

        {/* ABA GRÁFICO */}
        {aba==="analises" && (<>
          {blocosJSX("analises")}
          <>
            <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"14px 6px 8px",marginBottom:20 }}>
              <div style={{ paddingLeft:8,marginBottom:6,fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:1 }}>
                {filtro==="TUDO"?"Proventos por mês — cada cor = um ativo":filtro==="FII"?"FIIs":"Ações"}
              </div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={chartData} margin={{ top:4,right:6,left:0,bottom:0 }} onClick={({activeTooltipIndex})=>{ if(activeTooltipIndex!=null)setMesSel(activeTooltipIndex); }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false}/>
                  <XAxis dataKey="mes" tick={{ fontSize:9,fill:T.textMute }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fontSize:9,fill:T.textMute }} axisLine={false} tickLine={false} tickFormatter={v=>v===0?"":v>=1000?`${(v/1000).toFixed(1)}k`:`${v}`} width={32}/>
                  <Tooltip content={<TipBar ativos={ativos} T={T} />}/>
                  {listaFiltrada.map((a,ai)=>(
                    <Bar key={a.ticker} dataKey={a.ticker} stackId="s" fill={corDe(a.ticker,a.cat,T)} radius={ai===listaFiltrada.length-1?[4,4,0,0]:[0,0,0,0]}>
                      {chartData.map((_,ci)=><Cell key={ci} fill={corDe(a.ticker,a.cat,T)} opacity={ci===mesSel?1:0.72} stroke={ci===mesSel?T.text:"none"} strokeWidth={ci===mesSel?0.5:0}/>)}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <Legenda ativos={listaFiltrada} T={T}/>
              <div style={{ display:"flex",gap:2,marginTop:8,paddingLeft:4,paddingRight:4,overflowX:"auto" }}>
                {chartData.map((d,i)=>{
                  const pct=maxMes>0?d._total/maxMes:0; const sel=i===mesSel;
                  return (
                    <div key={i} onClick={()=>setMesSel(i)} style={{ flex:"0 0 auto",minWidth:40,textAlign:"center",cursor:"pointer",background:sel?T.accentBg:T.cardAlt,border:`1px solid ${sel?T.accent:T.border}`,borderRadius:8,padding:"4px" }}>
                      <div style={{ fontSize:8,color:sel?T.accentSoft:T.textFaint,marginBottom:2 }}>{d.mes.split("/")[0]}</div>
                      <div style={{ width:22,height:22,margin:"0 auto 2px",display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
                        <div style={{ width:14,height:`${Math.max(pct*22,2)}px`,background:sel?T.accent:T.borderSoft,borderRadius:"2px 2px 0 0" }}/>
                      </div>
                      <div style={{ fontSize:9,fontWeight:700,color:sel?T.text:T.textFaint }}>{d._total>=1000?`${(d._total/1000).toFixed(1)}k`:d._total>0?`${Math.round(d._total)}`:"—"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"14px",marginBottom:20 }}>
              <div style={{ fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:1,marginBottom:10 }}>Detalhes do mês · toque em uma barra</div>
              <DetalheMes ativos={ativos} idx={mesSel} filtro={filtro} T={T}/>
            </div>
            {/* análises de carteira (yield, saúde, benchmarks) */}
            <AnaliseCarteira ativos={ativos} T={T}/>
          </>
        </>)}

        {/* ABA RANKING */}
        {aba==="ranking" && (
          <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"14px" }}>
            <Ranking ativos={listaFiltrada} T={T}/>
          </div>
        )}

        {/* ABA CENÁRIO */}
        {aba==="cenario" && <CenarioFuturo ativos={ativos} fundosProvisionados={fundosProvisionados} T={T}/>}

        {/* ABA CUSTO DE VIDA */}
        {aba==="custovida" && (<>{blocosJSX("custovida")}<CustoVida custoVida={custoVida} setCustoVida={setCustoVida} mediaMes={mediaMes} T={T}/></>)}

        {aba==="historico" && <HistoricoCompleto ativos={ativos} proventosRecebidos={proventosRecebidos} T={T}/>}

        {/* ABA CARTÃO */}
        {aba==="cartao" && <CartaoCredito ativos={ativos} mediaMes={mediaMes} custoVida={custoVida} setCustoVida={setCustoVida} fundosProvisionados={fundosProvisionados} setFundosProvisionados={setFundosProvisionados} T={T}/>}

        {/* ABA EDITAR */}
        {aba==="editar" && <EditarAtivos ativos={ativos} setAtivos={setAtivos} bridgeUrl={bridgeUrl} onEventosB3={(lista)=>setEventosB3(prev=>mesclarEventos(prev, lista))} onVendidos={setVendidosHist}
          onProventosRecebidos={(p)=>setProventosRecebidos(prev=>{
            // soma ao que já estava salvo (importar um período menor não apaga o histórico); duplicatas saem
            const registros = registrosValidos([...(prev?.registros||[]), ...(p?.registros||[])]);
            const porMes = {}, porMesBruto = {};
            registros.forEach(r=>{ const k=ymDe(r.data); porMes[k]=+((porMes[k]||0)+r.valor).toFixed(2); porMesBruto[k]=+((porMesBruto[k]||0)+(r.bruto ?? r.valor)).toFixed(2); });
            return { ...p, registros, porMes, porMesBruto, total:+registros.reduce((t,r)=>t+r.valor,0).toFixed(2) };
          })} T={T}/>}

        {/* ABA CHAT / ASSISTENTE IA */}
        {aba==="chat" && <ChatBot ativos={ativos} setAtivos={setAtivos} bridgeUrl={bridgeUrl} servidorNome={servidorNome} onVisualizarAcoes={entrarPreview} onAplicarAcoes={executarAcoes}
          iaModelo={iaModelo} iaInstrucoes={iaInstrucoes} onAbrirConfigIA={()=>setShowConfigIA(true)} T={T} estiloDe={estiloDe}/>}
        {showConfigIA && <ModalServidorIA bridgeUrl={bridgeUrl} setBridgeUrl={setBridgeUrl} iaModelo={iaModelo} setIaModelo={setIaModelo} iaInstrucoes={iaInstrucoes} setIaInstrucoes={setIaInstrucoes} onClose={()=>setShowConfigIA(false)} T={T}/>}
        {showVozChat && <ConfigVoz onClose={()=>setShowVozChat(false)} T={T}/>}

        {(aba==="analises"||aba==="ranking") && (
          <div style={{ background:T.cardAlt,border:`1px dashed ${T.borderSoft}`,borderRadius:10,padding:"10px 12px",marginTop:14 }}>
            <div style={{ fontSize:10,color:T.textFaint,lineHeight:1.7 }}>📌 FIIs pagam mensalmente. Ações seguem calendário histórico. Valores brutos — JCP têm IR 15%; FIIs isentos para PF.</div>
          </div>
        )}
      </div>

      </div>{/* fim container TV center */}
      </div>{/* fim wrapper de zoom */}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// TELA DE LOGIN / CADASTRO / RECUPERAÇÃO — contas locais (dados por conta)
// ════════════════════════════════════════════════════════════════════════════
function TelaAuth({ aoEntrar }) {
  const T = TEMAS.minimalista2 || TEMAS[Object.keys(TEMAS)[0]];
  const [modo, setModo] = useState("login"); // login | cadastro | frase | recuperar
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [frase, setFrase] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [fraseGerada, setFraseGerada] = useState("");
  const [erro, setErro] = useState("");
  const em = email.trim().toLowerCase();
  const inp = { width:"100%", background:T.cardAlt, border:`1px solid ${T.borderSoft}`, borderRadius:10, color:T.text, padding:"12px 14px", fontSize:14, outline:"none", marginBottom:10 };
  const btnP = { width:"100%", padding:"13px", borderRadius:10, border:"none", background:T.accent, color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700 };
  const btnL = { background:"none", border:"none", color:T.accentSoft, cursor:"pointer", fontSize:12, fontWeight:600, padding:6 };

  const entrar = () => {
    setErro("");
    const c = lerContas()[em];
    if (!c) { setErro("Conta não encontrada. Crie uma conta."); return; }
    if (c.senhaHash !== hashSenha(senha)) { setErro("Senha incorreta."); return; }
    aoEntrar(em);
  };
  const cadastrar = () => {
    setErro("");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setErro("Digite um e-mail válido."); return; }
    if (senha.length < 4) { setErro("A senha precisa de pelo menos 4 caracteres."); return; }
    if (senha !== senha2) { setErro("As senhas não conferem."); return; }
    const contas = lerContas();
    if (contas[em]) { setErro("Já existe uma conta com este e-mail."); return; }
    const fr = gerarFraseRec();
    contas[em] = { nome: nome.trim()||em.split("@")[0], senhaHash: hashSenha(senha), fraseRec: hashSenha(fr.toLowerCase()), criadoEm: new Date().toISOString() };
    gravarContas(contas);
    setFraseGerada(fr); setModo("frase");
  };
  const recuperar = () => {
    setErro("");
    const contas = lerContas();
    const c = contas[em];
    if (!c) { setErro("Conta não encontrada."); return; }
    if (hashSenha(frase.trim().toLowerCase()) !== c.fraseRec) { setErro("Frase de recuperação incorreta."); return; }
    if (novaSenha.length < 4) { setErro("A nova senha precisa de pelo menos 4 caracteres."); return; }
    c.senhaHash = hashSenha(novaSenha); gravarContas(contas);
    window.alert("Senha redefinida! Entre com a nova senha.");
    setSenha(""); setModo("login");
  };
  const google = () => window.alert("Entrar com Google requer um Client ID do Google Cloud (OAuth) e o SHA-1 do APK cadastrados — configuração externa. Por enquanto, use e-mail e senha: seus dados ficam 100% no aparelho.");

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 16px" }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        <div style={{ textAlign:"center", marginBottom:26 }}>
          <div style={{ fontSize:44 }}>💼</div>
          <div style={{ fontSize:24, fontWeight:800, color:T.text, letterSpacing:-0.5 }}>Carteira de Proventos</div>
          <div style={{ fontSize:12, color:T.textMute, marginTop:4 }}>Seus dividendos, no seu controle — 100% no seu aparelho.</div>
        </div>
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:16, padding:"20px" }}>
          {modo==="login" && (<>
            <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:14 }}>Entrar</div>
            <input style={inp} placeholder="E-mail" inputMode="email" autoCapitalize="none" value={email} onChange={e=>setEmail(e.target.value)}/>
            <input style={inp} placeholder="Senha" type="password" value={senha} onChange={e=>setSenha(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") entrar(); }}/>
            {erro && <div style={{ fontSize:11, color:T.red, marginBottom:10 }}>⚠️ {erro}</div>}
            <button style={btnP} onClick={entrar}>Entrar</button>
            <button onClick={google} style={{ width:"100%", marginTop:10, padding:"12px", borderRadius:10, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontSize:13, fontWeight:600 }}>🔵 Entrar com Google</button>
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:12 }}>
              <button style={btnL} onClick={()=>{ setErro(""); setModo("cadastro"); }}>Criar conta</button>
              <button style={btnL} onClick={()=>{ setErro(""); setModo("recuperar"); }}>Esqueci a senha</button>
            </div>
          </>)}
          {modo==="cadastro" && (<>
            <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:14 }}>Criar conta</div>
            <input style={inp} placeholder="Seu nome" value={nome} onChange={e=>setNome(e.target.value)}/>
            <input style={inp} placeholder="E-mail" inputMode="email" autoCapitalize="none" value={email} onChange={e=>setEmail(e.target.value)}/>
            <input style={inp} placeholder="Senha" type="password" value={senha} onChange={e=>setSenha(e.target.value)}/>
            <input style={inp} placeholder="Confirmar senha" type="password" value={senha2} onChange={e=>setSenha2(e.target.value)}/>
            {erro && <div style={{ fontSize:11, color:T.red, marginBottom:10 }}>⚠️ {erro}</div>}
            <button style={btnP} onClick={cadastrar}>Criar conta</button>
            <div style={{ textAlign:"center", marginTop:12 }}><button style={btnL} onClick={()=>{ setErro(""); setModo("login"); }}>← Já tenho conta</button></div>
          </>)}
          {modo==="frase" && (<>
            <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:10 }}>🛟 Guarde sua frase de recuperação</div>
            <div style={{ fontSize:12, color:T.textMute, lineHeight:1.6, marginBottom:12 }}>Se você esquecer a senha, esta frase é o <strong>único</strong> jeito de recuperar a conta (não enviamos e-mail — tudo fica no aparelho). Anote em lugar seguro:</div>
            <div style={{ background:T.cardAlt, border:`2px dashed ${T.accent}`, borderRadius:12, padding:"14px", textAlign:"center", fontSize:18, fontWeight:800, color:T.accentSoft, letterSpacing:1, marginBottom:14, userSelect:"all" }}>{fraseGerada}</div>
            <button style={btnP} onClick={()=>aoEntrar(em)}>✓ Anotei — entrar no app</button>
          </>)}
          {modo==="recuperar" && (<>
            <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:14 }}>Recuperar senha</div>
            <input style={inp} placeholder="E-mail" inputMode="email" autoCapitalize="none" value={email} onChange={e=>setEmail(e.target.value)}/>
            <input style={inp} placeholder="Frase de recuperação (ex: sol-rio-lua-123)" value={frase} onChange={e=>setFrase(e.target.value)}/>
            <input style={inp} placeholder="Nova senha" type="password" value={novaSenha} onChange={e=>setNovaSenha(e.target.value)}/>
            {erro && <div style={{ fontSize:11, color:T.red, marginBottom:10 }}>⚠️ {erro}</div>}
            <button style={btnP} onClick={recuperar}>Redefinir senha</button>
            <div style={{ textAlign:"center", marginTop:12 }}><button style={btnL} onClick={()=>{ setErro(""); setModo("login"); }}>← Voltar ao login</button></div>
          </>)}
        </div>
        <div style={{ fontSize:10, color:T.textFaint, textAlign:"center", marginTop:14, lineHeight:1.6 }}>Contas e dados são armazenados localmente neste aparelho.<br/>Cada conta tem sua própria carteira, metas e preferências.</div>
        {/* modo teste: entra direto com uma conta de desenvolvimento, sem cadastro */}
        <div style={{ textAlign:"center", marginTop:18 }}>
          <button onClick={()=>{
            const em = "teste@dev.local";
            const contas = lerContas();
            if (!contas[em]) {
              contas[em] = { nome:"Testador", senhaHash:hashSenha("teste"), fraseRec:hashSenha("teste-teste-teste-000"), criadoEm:new Date().toISOString() };
              gravarContas(contas);
            }
            aoEntrar(em);
          }} style={{ background:"none", border:"none", color:T.textFaint, cursor:"pointer", fontSize:10, textDecoration:"underline", opacity:0.7, padding:6 }}>
            🧪 entrar em modo teste
          </button>
        </div>
        {/* modo teste: entra direto com uma conta fixa, sem cadastro (para desenvolvimento) */}
        <div style={{ textAlign:"center", marginTop:18 }}>
          <button onClick={()=>{
            const em = "teste@carteira.dev";
            const contas = lerContas();
            if (!contas[em]) {
              contas[em] = { nome:"Testador", senhaHash:hashSenha("teste"), fraseRec:hashSenha("teste-teste-teste-000"), criadoEm:new Date().toISOString() };
              gravarContas(contas);
            }
            aoEntrar(em);
          }} style={{ background:"none", border:"none", color:T.textFaint, cursor:"pointer", fontSize:10, opacity:0.55, padding:8, textDecoration:"underline" }}>
            🧪 entrar em modo teste
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ERRO VISÍVEL — se algo quebrar, mostra o erro na tela (em vez de tela preta)
// ════════════════════════════════════════════════════════════════════════════
class ErroApp extends React.Component {
  constructor(props){ super(props); this.state = { erro:null }; }
  static getDerivedStateFromError(erro){ return { erro }; }
  componentDidCatch(erro, info){ try { registrarLog("sistema", `ERRO fatal: ${erro?.message}`, { direcao:"interno", origem:"app", detalhe:String(info?.componentStack||"").slice(0,400) }); } catch {} }
  render(){
    if (!this.state.erro) return this.props.children;
    return (
      <div style={{ minHeight:"100vh", background:"#f6f7f9", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
        <div style={{ maxWidth:420, width:"100%", background:"#fff", border:"1px solid #e5e7eb", borderRadius:16, padding:22, textAlign:"center" }}>
          <div style={{ fontSize:36 }}>🛠️</div>
          <div style={{ fontSize:16, fontWeight:800, color:"#111", margin:"8px 0" }}>Algo quebrou nesta tela</div>
          <div style={{ fontSize:11, color:"#666", lineHeight:1.6, marginBottom:12 }}>Manda um print desta mensagem para o desenvolvedor:</div>
          <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:10, padding:"10px 12px", fontSize:11, color:"#b91c1c", fontFamily:"monospace", wordBreak:"break-word", marginBottom:14, textAlign:"left" }}>{String(this.state.erro?.message || this.state.erro)}</div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>{ this.setState({ erro:null }); }} style={{ flex:1, padding:"12px", borderRadius:10, border:"1px solid #d1d5db", background:"#f9fafb", color:"#111", cursor:"pointer", fontSize:12, fontWeight:700 }}>↻ Tentar de novo</button>
            <button onClick={()=>{ try { localStorage.removeItem(SESSAO_KEY); } catch {} window.location.reload(); }} style={{ flex:1, padding:"12px", borderRadius:10, border:"none", background:"#111", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:700 }}>Sair e recarregar</button>
          </div>
        </div>
      </div>
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ROOT — controla a sessão; cada conta tem seus próprios dados (PREFIXO próprio)
// ════════════════════════════════════════════════════════════════════════════
export default function Root() {
  const [usuario, setUsuario] = useState(() => {
    try { const u = localStorage.getItem(SESSAO_KEY); if (u) definirUsuarioAtivo(u); return u || null; } catch { return null; }
  });
  const entrar = (email) => { definirUsuarioAtivo(email); try { localStorage.setItem(SESSAO_KEY, email); } catch {} setUsuario(email); };
  const sair = () => { try { localStorage.removeItem(SESSAO_KEY); } catch {} setUsuario(null); };
  const contaNome = (() => { try { return lerContas()[usuario]?.nome || ""; } catch { return ""; } })();
  if (!usuario) return <TelaAuth aoEntrar={entrar}/>;
  return <ErroApp><AppCarteira key={usuario} usuario={usuario} contaNome={contaNome} onLogout={sair}/></ErroApp>;
}
