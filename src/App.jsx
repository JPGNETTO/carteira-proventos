import { useState, useMemo, useRef, useLayoutEffect, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Area, AreaChart, ReferenceLine, ReferenceDot,
  PieChart, Pie
} from "recharts";

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

// Grupo de exibição (para listas agrupadas e expansíveis). NÃO altera o campo
// 'cat' do ativo (que continua alimentando gráficos e filtros) — é só para exibir.
function grupoDe(a) {
  if (a.cat === "FII") return "FIIs";
  if (a.cat === "Cripto") return "Cripto";
  if (/^(BOVA11|BOVX11|IVVB11|SMAL11|HASH11|XINA11|NASD11)$/.test(a.ticker)) return "ETFs";
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

const ATIVOS_INICIAIS = [
  { ticker:"MFII11",nome:"Mérito Desenvolvimento",  cat:"FII", freq:"Mensal",    qtd:132,prov:1.06,precoMedio:52.69,cotacao:50.71,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"VGHF11",nome:"Valora Hedge Fund",        cat:"FII", freq:"Mensal",    qtd:333,prov:0.07,precoMedio:6.05, cotacao:5.99, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"RBRY11",nome:"BR Credit",                cat:"FII", freq:"Mensal",    qtd:21, prov:1.00,precoMedio:91.23,cotacao:89.49,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"OIAG11",nome:"Ourinvest Agro",           cat:"FII", freq:"Mensal",    qtd:146,prov:0.08,precoMedio:8.57, cotacao:8.15, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"CPTS11",nome:"Capitânia Securities",     cat:"FII", freq:"Mensal",    qtd:152,prov:0.09,precoMedio:7.42, cotacao:7.39, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"GARE11",nome:"Guardian",                 cat:"FII", freq:"Mensal",    qtd:114,prov:0.08,precoMedio:8.38, cotacao:8.14, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"TRXF11",nome:"TRX Real Estate",          cat:"FII", freq:"Mensal",    qtd:10, prov:0.85,precoMedio:91.46,cotacao:91.53,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"RBRX11",nome:"RBR Properties",           cat:"FII", freq:"Mensal",    qtd:112,prov:0.09,precoMedio:8.62, cotacao:8.11, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"IRIM11",nome:"Iridium Recebíveis",       cat:"FII", freq:"Mensal",    qtd:12, prov:0.90,precoMedio:65.79,cotacao:65.95,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"KNCR11",nome:"Kinea Crédito Real",       cat:"FII", freq:"Mensal",    qtd:5,  prov:1.10,precoMedio:106.83,cotacao:107.28,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"VISC11",nome:"Vinci Shopping Centers",   cat:"FII", freq:"Mensal",    qtd:3,  prov:0.72,precoMedio:106.14,cotacao:103.86,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"XPML11",nome:"XP Malls",                 cat:"FII", freq:"Mensal",    qtd:2,  prov:0.72,precoMedio:107.44,cotacao:103.98,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"MXRF11",nome:"Maxi Renda",               cat:"FII", freq:"Mensal",    qtd:16, prov:0.10,precoMedio:9.71, cotacao:9.68, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"BBAS3", nome:"Banco do Brasil",  cat:"Ação",freq:"Trimestral", qtd:291,prov:0.14,precoMedio:20.55,cotacao:19.86,meses:[3,6,9,12] },
  { ticker:"PETR4", nome:"Petrobras",        cat:"Ação",freq:"Trimestral", qtd:145,prov:0.47,precoMedio:40.75,cotacao:39.33,meses:[2,5,8,11] },
  { ticker:"BBDC3", nome:"Bradesco",         cat:"Ação",freq:"Mensal",     qtd:50, prov:0.02,precoMedio:15.73,cotacao:15.54,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"ITSA4", nome:"Itaúsa",           cat:"Ação",freq:"Trimestral", qtd:116,prov:0.08,precoMedio:12.88,cotacao:13.03,meses:[1,4,7,10] },
  { ticker:"BBSE3", nome:"BB Seguridade",    cat:"Ação",freq:"Semestral",  qtd:9,  prov:0.40,precoMedio:37.47,cotacao:38.27,meses:[5,11] },
  { ticker:"TAEE11",nome:"Taesa",            cat:"Ação",freq:"Semestral",  qtd:6,  prov:0.90,precoMedio:41.68,cotacao:39.79,meses:[6,12] },
  { ticker:"BRSR6", nome:"Banrisul",         cat:"Ação",freq:"Trimestral", qtd:44, prov:0.32,precoMedio:15.76,cotacao:13.55,meses:[3,6,9,12] },
  { ticker:"KLBN4", nome:"Klabin PN",        cat:"Ação",freq:"Semestral",  qtd:332,prov:0.10,precoMedio:3.41, cotacao:3.37, meses:[4,10] },
  { ticker:"KLBN11",nome:"Klabin UNT",       cat:"Ação",freq:"Semestral",  qtd:14, prov:0.25,precoMedio:17.03,cotacao:16.81,meses:[4,10] },
  { ticker:"CXSE3", nome:"Caixa Seguridade", cat:"Ação",freq:"Semestral",  qtd:13, prov:0.35,precoMedio:17.66,cotacao:19.43,meses:[5,11] },
  { ticker:"WEGE3", nome:"Weg",              cat:"Ação",freq:"Semestral",  qtd:2,  prov:0.12,precoMedio:44.96,cotacao:45.71,meses:[4,10] },
  { ticker:"CPLE3", nome:"Copel",            cat:"Ação",freq:"Semestral",  qtd:3,  prov:0.22,precoMedio:15.63,cotacao:14.99,meses:[5,11] },
  { ticker:"SANB3", nome:"Santander",        cat:"Ação",freq:"Trimestral", qtd:102,prov:0.06,precoMedio:12.90,cotacao:12.86,meses:[3,6,9,12] },
  { ticker:"EMBJ3", nome:"Embraer",          cat:"Ação",freq:"Anual",      qtd:2,  prov:0.55,precoMedio:79.62,cotacao:78.80,meses:[12] },
  { ticker:"B3SA3", nome:"B3 Brasil Bolsa",  cat:"Ação",freq:"Trimestral", qtd:10, prov:0.12,precoMedio:15.63,cotacao:14.72,meses:[3,6,9,12] },
  { ticker:"SBSP3", nome:"Sabesp",           cat:"Ação",freq:"Anual",      qtd:4,  prov:0.80,precoMedio:28.80,cotacao:28.16,meses:[8] },
  { ticker:"BOVA11",nome:"iShares Ibovespa", cat:"Ação",freq:"Semestral",  qtd:3,  prov:1.50,precoMedio:175.40,cotacao:168.21,meses:[1,7] },
  { ticker:"BOVX11",nome:"Trend Ibovespa",   cat:"Ação",freq:"Semestral",  qtd:3,  prov:0.15,precoMedio:20.12,cotacao:17.56,meses:[1,7] },
  { ticker:"COIN11",nome:"Hashdex Nasdaq Crypto",cat:"Cripto",freq:"Mensal", qtd:33, prov:0.00,precoMedio:38.70,cotacao:39.20,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
].map(a => ({ ...a, setor: SETOR_TICKER[a.ticker] || "Outros" }));

// ════════════════════════════════════════════════════════════════════════════
// PERSISTÊNCIA — salva tudo na memória permanente do app (localStorage)
// Funciona no APK. No preview do Claude o localStorage é bloqueado, então
// envolvemos em try/catch: lá não salva, mas também não quebra.
// ════════════════════════════════════════════════════════════════════════════
const PREFIXO = "carteiraProventos_";

function lerSalvo(chave, padrao) {
  try {
    const v = localStorage.getItem(PREFIXO + chave);
    return v !== null ? JSON.parse(v) : padrao;
  } catch { return padrao; }
}
function gravarSalvo(chave, valor) {
  try { localStorage.setItem(PREFIXO + chave, JSON.stringify(valor)); } catch { /* preview: ignora */ }
}

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
  if (!Array.isArray(salvos)) return ATIVOS_INICIAIS.map(a => ({ ...a }));
  const porTicker = {};
  salvos.forEach(a => { if (a && a.ticker) porTicker[a.ticker] = a; });
  // base = lista do código; aplica edições salvas por cima; adiciona tickers novos
  const merge = ATIVOS_INICIAIS.map(base =>
    porTicker[base.ticker]
      ? { ...base, qtd:porTicker[base.ticker].qtd, prov:porTicker[base.ticker].prov,
          precoMedio:porTicker[base.ticker].precoMedio, cotacao:porTicker[base.ticker].cotacao,
          freq:porTicker[base.ticker].freq ?? base.freq, meses:porTicker[base.ticker].meses ?? base.meses }
      : { ...base }
  );
  return merge;
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
                            <span style={{ fontSize:12,fontWeight:700,color:T.text }}>{a.ticker}</span>
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
function PainelCarteira({ ativos, historico = [], T }) {
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

  const corGrupo = (nome) => agrupar==="cat" ? (corCat[nome]||T.accent) : (COR_SETOR[nome]||T.textMute);

  const pieData = arr.map(g => ({ name:g.nome, value:+g.valor.toFixed(2), cor:corGrupo(g.nome) }));
  const maxBar = Math.max(...arr.map(g=>g.valor), 1);

  const FILTROS_CAT = [
    { id:"TUDO", label:"Tudo" },
    { id:"FII",  label:"FIIs" },
    { id:"Ação", label:"Ações" },
    { id:"Cripto",label:"Cripto" },
  ];

  const [vista, setVista] = useState("resumo"); // "resumo" | "composicao" | "historico"
  const MINI = [
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
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:8 }}>
              <span style={{ fontSize:15, fontWeight:800, color:T.text }}>{saud}! 👋</span>
              <span style={{ fontSize:11, color:T.textFaint }}>{dataFmt}</span>
            </div>
            <div style={{ background:`linear-gradient(135deg, ${T.amber}1c, ${T.card})`, border:`1px solid ${T.amber}44`, borderRadius:12, padding:"11px 13px", display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:20 }}>{destaque.icon}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:8, color:T.amber, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Destaque do dia</div>
                <div style={{ fontSize:12, color:T.text, fontWeight:600, lineHeight:1.3 }}>{destaque.txt}</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* mini-abas internas do Painel */}
      <div style={{ display:"flex", gap:3, background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:3, marginBottom:14 }}>
        {MINI.map(m=>{
          const sel = vista===m.id;
          return (
            <button key={m.id} onClick={()=>setVista(m.id)} style={{ flex:1, padding:"8px 4px", borderRadius:7, border:"none", cursor:"pointer", fontSize:11, fontWeight:700, background:sel?T.accentBg:"transparent", color:sel?T.accentSoft:T.textMute }}>
              {m.emoji} {m.label}
            </button>
          );
        })}
      </div>

      {/* ═══ VISTA: RESUMO ═══ */}
      {vista==="resumo" && (<>
      {/* PRÓXIMOS PROVENTOS — mês atual e próximo (estimado pelas datas) */}
      {(() => {
        const NOMES_MES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
        const hoje = new Date();
        const mAtual = hoje.getMonth()+1;          // 1-12
        const mProx  = mAtual===12 ? 1 : mAtual+1;
        const provDoMes = (m) => ativos
          .filter(a=>a.qtd>0 && a.prov>0 && a.meses.includes(m))
          .map(a=>({ ticker:a.ticker, cat:a.cat, valor:+(a.prov*a.qtd).toFixed(2) }))
          .sort((x,y)=>y.valor-x.valor);
        const esteList = provDoMes(mAtual);
        const proxList = provDoMes(mProx);
        const esteTot = esteList.reduce((s,p)=>s+p.valor,0);
        const proxTot = proxList.reduce((s,p)=>s+p.valor,0);
        return (
          <div style={{ display:"flex", gap:8, marginBottom:12 }}>
            {/* este mês */}
            <div style={{ flex:1, background:`linear-gradient(135deg, ${T.green}22, ${T.card})`, border:`1px solid ${T.green}44`, borderRadius:14, padding:"13px 14px" }}>
              <div style={{ fontSize:9, color:T.green, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>📥 Este mês</div>
              <div style={{ fontSize:9, color:T.textFaint, marginBottom:3 }}>{NOMES_MES[mAtual-1]}</div>
              <div style={{ fontSize:20, fontWeight:800, color:T.green, letterSpacing:-0.5 }}>{fmt(esteTot)}</div>
              <div style={{ fontSize:9, color:T.textMute, marginTop:2 }}>{esteList.length} ativo{esteList.length!==1?"s":""} pagando</div>
            </div>
            {/* próximo mês */}
            <div style={{ flex:1, background:`linear-gradient(135deg, ${T.accent}22, ${T.card})`, border:`1px solid ${T.accent}44`, borderRadius:14, padding:"13px 14px" }}>
              <div style={{ fontSize:9, color:T.accentSoft, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>📅 Próximo mês</div>
              <div style={{ fontSize:9, color:T.textFaint, marginBottom:3 }}>{NOMES_MES[mProx-1]}</div>
              <div style={{ fontSize:20, fontWeight:800, color:T.accentSoft, letterSpacing:-0.5 }}>{fmt(proxTot)}</div>
              <div style={{ fontSize:9, color:T.textMute, marginTop:2 }}>{proxList.length} ativo{proxList.length!==1?"s":""} pagando</div>
            </div>
          </div>
        );
      })()}

      {/* PROVENTOS MÊS A MÊS — gráfico compacto no contexto da home */}
      {(() => {
        const dataMes = MESES_BASE.map((label,idx)=>({
          mes: label.slice(0,3),
          total: +ativos.filter(a=>a.qtd>0 && mesesIdx(a.meses).includes(idx)).reduce((s,a)=>s+a.prov*a.qtd,0).toFixed(2)
        }));
        const temDados = dataMes.some(d=>d.total>0);
        if (!temDados) return null;
        return (
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px 6px 8px", marginBottom:12 }}>
            <div style={{ paddingLeft:8, marginBottom:8, fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1 }}>💵 Proventos mês a mês</div>
            <div style={{ width:"100%", height:150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dataMes} margin={{ top:4,right:8,left:0,bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false}/>
                  <XAxis dataKey="mes" tick={{ fontSize:8,fill:T.textMute }} axisLine={false} tickLine={false} interval={0}/>
                  <YAxis tick={{ fontSize:8,fill:T.textMute }} axisLine={false} tickLine={false} width={38} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:`${Math.round(v)}`}/>
                  <Tooltip formatter={(v)=>fmt(v)} contentStyle={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:8, fontSize:12 }} cursor={{ fill:`${T.accent}11` }}/>
                  <Bar dataKey="total" radius={[4,4,0,0]} fill={T.cyan}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize:9, color:T.textFaint, padding:"4px 10px 0" }}>Visão completa e detalhada na tela 📈 Gráfico.</div>
          </div>
        );
      })()}

      {/* resumo geral */}
      <div style={{ background:`linear-gradient(135deg, ${T.accent}22, ${T.card})`, border:`1px solid ${T.border}`, borderRadius:14, padding:"16px", marginBottom:12 }}>
        <div style={{ fontSize:10, color:T.textFaint, textTransform:"uppercase", letterSpacing:1 }}>Patrimônio atual</div>
        <div style={{ fontSize:26, fontWeight:800, color:T.text, letterSpacing:-1 }}>{fmt(totalAtual)}</div>
        <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"5px 10px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Investido</div>
            <div style={{ fontSize:11, fontWeight:700, color:T.textDim }}>{fmt(totalInvest)}</div>
          </div>
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"5px 10px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Resultado</div>
            <div style={{ fontSize:11, fontWeight:700, color:resultadoGeral>=0?T.green:T.red }}>{resultadoGeral>=0?"+":""}{fmt(resultadoGeral)}</div>
          </div>
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"5px 10px" }}>
            <div style={{ fontSize:9, color:T.textFaint }}>Rentab.</div>
            <div style={{ fontSize:11, fontWeight:700, color:resultadoGeral>=0?T.green:T.red }}>{totalInvest>0?`${resultadoGeral>=0?"+":""}${((resultadoGeral/totalInvest)*100).toFixed(1)}%`:"—"}</div>
          </div>
        </div>
      </div>

      </>)}

      {/* ═══ VISTA: HISTÓRICO ═══ */}
      {vista==="historico" && (
        historico.length>0 ? (
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px 6px 12px", marginBottom:12 }}>
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
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
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
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:12 }}>
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
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:12 }}>
        <div style={{ fontSize:11, color:T.textMute, marginBottom:12, textTransform:"uppercase", letterSpacing:1 }}>
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
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:12 }}>
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
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:12 }}>
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
      <div style={{ background:`linear-gradient(135deg, ${T.cyan}1c, ${T.card})`, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px 16px", marginBottom:12 }}>
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
      <div style={{ display:"flex", gap:4, background:T.card, borderRadius:10, padding:3, marginBottom:14 }}>
        {[{id:"proventos",l:"💰 Proventos"},{id:"valorizacao",l:"📈 Valorização"}].map(o=>(
          <button key={o.id} onClick={()=>setModo(o.id)} style={{ flex:1, padding:"8px 4px", borderRadius:7, border:"none", cursor:"pointer", fontSize:12, fontWeight:700, background:modo===o.id?T.accent:"transparent", color:modo===o.id?"#fff":T.textMute }}>{o.l}</button>
        ))}
      </div>

      {modo==="proventos" ? (
        <>
          <div style={{ fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:1,marginBottom:12 }}>Ranking anual de proventos · {fmt(totalProv)}</div>
          {rankedProv.map((a,i)=>{
            const c = corDe(a.ticker,a.cat,T);
            return (
              <div key={a.ticker} style={{ marginBottom:9 }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                    <span style={{ fontSize:10,color:T.textFaint,fontWeight:700,minWidth:18 }}>#{i+1}</span>
                    <div style={{ width:9,height:9,borderRadius:2,background:c }}/>
                    <span style={{ fontSize:12,fontWeight:700,color:T.text }}>{a.ticker}</span>
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
          <div style={{ fontSize:10,color:T.textFaint,marginBottom:12,lineHeight:1.5 }}>Quanto cada ativo subiu ou caiu em relação ao que você pagou. Atualize as cotações na aba Editar para acompanhar mês a mês.</div>
          {rankedVal.map((a,i)=>{
            const pos = a.pctVal>=0;
            const cor = pos?T.green:T.red;
            return (
              <div key={a.ticker} style={{ marginBottom:9 }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                    <span style={{ fontSize:10,color:T.textFaint,fontWeight:700,minWidth:18 }}>#{i+1}</span>
                    <div style={{ width:9,height:9,borderRadius:2,background:corDe(a.ticker,a.cat,T) }}/>
                    <span style={{ fontSize:12,fontWeight:700,color:T.text }}>{a.ticker}</span>
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
function EditarAtivos({ ativos, setAtivos, T }) {
  const [filtroCat, setFiltroCat] = useState("TODOS");
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState({}); // grupos expandidos

  const lista = ativos.filter(a => {
    if (filtroCat === "FII" && a.cat !== "FII") return false;
    if (filtroCat === "Ação" && a.cat !== "Ação") return false;
    if (busca && !a.ticker.toLowerCase().includes(busca.toLowerCase()) && !a.nome.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });

  function atualizar(ticker, campo, valor) {
    setAtivos(prev => prev.map(a => a.ticker === ticker ? { ...a, [campo]: valor } : a));
  }

  function resetar() {
    if (window.confirm("Restaurar todos os valores originais? Suas edições serão perdidas.")) {
      setAtivos(ATIVOS_INICIAIS.map(a => ({ ...a })));
    }
  }

  const totalInvestido = ativos.reduce((s,a)=>s + a.qtd*a.precoMedio, 0);
  const totalAtual = ativos.reduce((s,a)=>s + a.qtd*a.cotacao, 0);
  const lucro = totalAtual - totalInvestido;

  const FREQS = ["Mensal","Trimestral","Semestral"];

  return (
    <div>
      {/* Resumo topo */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14 }}>
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
      <div style={{ display:"flex",gap:6,marginBottom:12 }}>
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
                <div style={{ paddingLeft:6, marginTop:6 }}>
                  {itens.map(a=>{
                    const c = corDe(a.ticker,a.cat,T);
                    const valorTotal = a.qtd*a.cotacao;
                    const result = (a.cotacao-a.precoMedio)*a.qtd;
                    return (
                      <div key={a.ticker} style={{ background:T.card,border:`1px solid ${T.border}`,borderLeft:`3px solid ${c}`,borderRadius:10,padding:"12px",marginBottom:8 }}>
                        {/* cabeçalho */}
                        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                          <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                            <div style={{ width:9,height:9,borderRadius:2,background:c }}/>
                            <div>
                              <span style={{ fontSize:13,fontWeight:800,color:T.text }}>{a.ticker}</span>
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
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"#000a", zIndex:1100, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"20px 12px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16, width:"100%", maxWidth:420, padding:"20px", boxShadow:"0 20px 60px #000c" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={{ fontSize:17, fontWeight:800, color:T.text }}>⚡ Aporte esporádico</div>
          <button onClick={onClose} style={{ width:34,height:34,borderRadius:8,border:`1px solid ${T.border}`,background:T.cardAlt,color:T.text,cursor:"pointer",fontSize:16 }}>✕</button>
        </div>

        <div style={{ fontSize:11, color:T.textMute, marginBottom:5 }}>Valor do aporte (R$)</div>
        <input type="number" min="0" value={valor} onChange={e=>setValor(Math.max(0,+e.target.value))}
          style={{ width:"100%", background:T.cardAlt, border:`2px solid ${T.amber}`, borderRadius:10, color:T.text, padding:"11px 14px", fontSize:20, fontWeight:800, textAlign:"center", marginBottom:14 }}/>

        <div style={{ fontSize:11, color:T.textMute, marginBottom:5 }}>Tipo de evento</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
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
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14 }}>
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

      <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px",marginBottom:14 }}>
        <div style={{ fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:1,marginBottom:12 }}>⚙️ Configuração</div>

        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11,color:T.textMute,marginBottom:6 }}>Horizonte</div>
          <div style={{ display:"flex",gap:6 }}>
            {HORIZ.map(o=>(
              <button key={o.v} onClick={()=>{setHorizonte(o.v); setMesSelSim(0);}} style={{ flex:"1 1 0",padding:"6px 4px",borderRadius:8,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,background:horizonte===o.v?T.accent:T.border,color:horizonte===o.v?"#fff":T.textMute }}>{o.l}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:12 }}>
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
        <div style={{ marginBottom:12, background:`${T.amber}0d`, border:`1px solid ${T.amber}33`, borderRadius:10, padding:"10px 12px" }}>
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

      <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 6px 10px",marginBottom:14 }}>
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

      <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px",marginBottom:14 }}>
        <div style={{ fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:1,marginBottom:10 }}>
          📋 Fluxo de reinvestimento — toque numa barra do gráfico
        </div>
        <div style={{ display:"flex",gap:2,marginBottom:12,overflowX:"auto" }}>
          {dados.slice(0,Math.min(horizonte,24)).map((d,i)=>(
            <button key={i} onClick={()=>setMesSelSim(i)} style={{ flex:"0 0 auto",minWidth:54,padding:"5px 4px",borderRadius:6,border:`1px solid ${i===mesSelSim?T.accent:T.border}`,background:i===mesSelSim?T.accentBg:T.cardAlt,cursor:"pointer" }}>
              <div style={{ fontSize:8,color:i===mesSelSim?T.accentSoft:T.textFaint }}>{d.mes}</div>
              <div style={{ fontSize:9,fontWeight:700,color:i===mesSelSim?T.green:T.textMute }}>{fmtK(d.provento)}</div>
            </button>
          ))}
        </div>

        {mSel && (
          <div>
            <div style={{ display:"flex",gap:8,marginBottom:12,flexWrap:"wrap" }}>
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
        <div style={{ background:`linear-gradient(135deg, ${T.green}1c, ${T.card})`, border:`1px solid ${T.green}44`, borderRadius:14, padding:"16px 14px", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
            <span style={{ fontSize:20 }}>🧠</span>
            <div style={{ fontSize:13, fontWeight:800, color:T.text }}>Pense como estrategista</div>
          </div>
          <div style={{ fontSize:10, color:T.textMute, marginBottom:12, lineHeight:1.5 }}>
            Para <strong style={{ color:T.green }}>mais dividendo em menos tempo</strong>, o que rende mais por real investido hoje é:
          </div>

          {/* destaque do melhor ativo */}
          <div style={{ background:T.card, border:`1.5px solid ${T.green}`, borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
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
            const max = rankYield[0].yieldAnual||1;
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
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"14px 6px 12px", marginBottom:14 }}>
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

function TrilhaMetas({ valorAtual, metaMensal, onConfigurar, T }) {
  const [aberta, setAberta] = useState(false);
  const N = 5; // numero de estagios
  const estagios = gerarEstagios(metaMensal, N);
  const pctGeral = Math.min((valorAtual / metaMensal) * 100, 100);
  const estagiosAlcancados = estagios.filter(e => valorAtual >= e.valor).length;
  const metaBatida = valorAtual >= metaMensal;

  // proximo estagio ainda nao alcancado (para o card "quanto falta")
  const proximoEstagio = estagios.find(e => valorAtual < e.valor);
  const faltaProximo = proximoEstagio ? proximoEstagio.valor - valorAtual : 0;
  const faltaMetaFinal = metaBatida ? 0 : metaMensal - valorAtual;

  return (
    <div style={{ marginTop:12, background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"11px 13px" }}>
      {/* cabeçalho compacto — sempre visível, clicável para expandir */}
      <div onClick={()=>setAberta(v=>!v)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0 }}>
          <span style={{ fontSize:11, color:T.textFaint, transform:aberta?"rotate(90deg)":"none", transition:"transform 0.2s", display:"inline-block" }}>▶</span>
          <span style={{ fontSize:14 }}>🎯</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
              <span style={{ fontSize:14, fontWeight:800, color:metaBatida?T.green:T.accentSoft }}>{fmt(valorAtual)}</span>
              <span style={{ fontSize:10, color:T.textFaint }}>/ {fmt(metaMensal)}</span>
            </div>
            {/* mini barra */}
            <div style={{ height:4, background:T.cardAlt, borderRadius:3, overflow:"hidden", marginTop:3 }}>
              <div style={{ height:"100%", width:`${pctGeral}%`, background:metaBatida?T.green:`linear-gradient(to right, ${CORES_ESTAGIOS[0]}, ${CORES_ESTAGIOS[3]})`, borderRadius:3 }}/>
            </div>
          </div>
        </div>
        <div style={{ textAlign:"right", marginLeft:10 }}>
          {metaBatida
            ? <span style={{ fontSize:11, fontWeight:700, color:T.green }}>✓ batida</span>
            : <><div style={{ fontSize:12, fontWeight:800, color:"#ef4444" }}>faltam {fmtK(faltaProximo)}</div><div style={{ fontSize:8, color:T.textFaint }}>p/ {fmtK(proximoEstagio.valor)}</div></>}
        </div>
      </div>

      {/* conteúdo expandido */}
      {aberta && (<>
      <div style={{ display:"flex", justifyContent:"flex-end", marginTop:10, marginBottom:8 }}>
        <button onClick={onConfigurar} title="Definir meta" style={{
          padding:"5px 10px", borderRadius:8, border:`1px solid ${T.border}`,
          background:T.cardAlt, color:T.textMute, cursor:"pointer", fontSize:11, fontWeight:600
        }}>🎯 Definir meta</button>
      </div>

      {/* trilha visual com setas/checkpoints */}
      <div style={{ position:"relative", paddingTop:4 }}>
        {/* setas dos estágios */}
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
          {estagios.map((e) => {
            const alcancado = valorAtual >= e.valor;
            return (
              <div key={e.idx} style={{ flex:"1 1 0", display:"flex", flexDirection:"column", alignItems:"center" }}>
                {/* seta para baixo (chevron) com número */}
                <div style={{
                  width:"100%", maxWidth:54, position:"relative",
                  opacity: alcancado ? 1 : 0.32, transition:"opacity 0.3s"
                }}>
                  <div style={{
                    background: alcancado ? e.cor : T.borderSoft,
                    clipPath:"polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)",
                    height:36, display:"flex", alignItems:"flex-start", justifyContent:"center",
                    paddingTop:5, borderRadius:"3px 3px 0 0"
                  }}>
                    <span style={{ fontSize:12, fontWeight:800, color:"#fff" }}>{String(e.idx).padStart(2,"0")}</span>
                  </div>
                </div>
                {/* valor do checkpoint */}
                <div style={{ fontSize:9, fontWeight:700, color: alcancado ? e.cor : T.textFaint, marginTop:3 }}>
                  {fmtK(e.valor)}
                </div>
              </div>
            );
          })}
        </div>

        {/* linha fina de progresso */}
        <div style={{ position:"relative", height:6, marginTop:4 }}>
          {/* trilho cinza de fundo */}
          <div style={{ position:"absolute", top:"50%", left:0, right:0, height:3, background:T.border, borderRadius:3, transform:"translateY(-50%)" }} />
          {/* preenchimento colorido (gradiente quente→frio) */}
          <div style={{
            position:"absolute", top:"50%", left:0, width:`${pctGeral}%`, height:3,
            background:`linear-gradient(to right, ${CORES_ESTAGIOS[0]}, ${CORES_ESTAGIOS[1]}, ${CORES_ESTAGIOS[2]}, ${CORES_ESTAGIOS[3]}, ${CORES_ESTAGIOS[4]})`,
            borderRadius:3, transform:"translateY(-50%)", transition:"width 0.5s"
          }} />
          {/* pontos/marcadores em cada checkpoint */}
          {estagios.map((e, i) => {
            const alcancado = valorAtual >= e.valor;
            const posPct = ((i + 1) / N) * 100;
            return (
              <div key={e.idx} style={{
                position:"absolute", top:"50%", left:`${posPct}%`,
                width:10, height:10, borderRadius:"50%",
                background: alcancado ? e.cor : T.cardAlt,
                border:`2px solid ${alcancado ? e.cor : T.borderSoft}`,
                transform:"translate(-50%,-50%)", transition:"all 0.3s",
                boxShadow: alcancado ? `0 0 8px ${e.cor}88` : "none"
              }} />
            );
          })}
        </div>

        {/* resumo de progresso */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10 }}>
          <span style={{ fontSize:10, color:T.textFaint }}>
            Estágio <strong style={{ color:T.text }}>{estagiosAlcancados}</strong> de {N}
          </span>
          <span style={{ fontSize:10, color:metaBatida?T.green:T.accentSoft, fontWeight:700 }}>
            {pctGeral.toFixed(0)}% da meta
          </span>
        </div>
      </div>

      {/* CARD VERMELHO — quanto falta para a próxima meta (sempre visível, chamariz) */}
      <div style={{
        marginTop:12,
        background: metaBatida ? `${T.green}14` : "rgba(239,68,68,0.12)",
        border: `1.5px solid ${metaBatida ? T.green : "#ef4444"}`,
        borderRadius:10, padding:"11px 13px",
        display:"flex", alignItems:"center", justifyContent:"space-between", gap:10
      }}>
        {metaBatida ? (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:20 }}>🏆</span>
              <div>
                <div style={{ fontSize:11, fontWeight:800, color:T.green }}>Meta final alcançada!</div>
                <div style={{ fontSize:10, color:T.textMute, marginTop:1 }}>Você bateu todos os estágios. Hora de subir a meta.</div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:9, color:"#ef4444", textTransform:"uppercase", letterSpacing:0.5, fontWeight:700 }}>
                ⚠️ Falta para a próxima meta
              </div>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, marginTop:3, flexWrap:"wrap" }}>
                <span style={{ fontSize:20, fontWeight:800, color:"#ef4444" }}>{fmt(faltaProximo)}</span>
                <span style={{ fontSize:10, color:T.textMute }}>
                  para chegar em <strong style={{ color:T.text }}>{fmt(proximoEstagio.valor)}</strong>
                </span>
              </div>
              <div style={{ fontSize:9, color:T.textFaint, marginTop:3 }}>
                Faltam {fmt(faltaMetaFinal)} para a meta final de {fmt(metaMensal)}
              </div>
            </div>
            {/* selo do estágio-alvo */}
            <div style={{
              flexShrink:0, width:42, height:48, position:"relative",
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center"
            }}>
              <div style={{
                background: proximoEstagio.cor, width:"100%",
                clipPath:"polygon(0 0, 100% 0, 100% 62%, 50% 100%, 0 62%)",
                height:34, display:"flex", alignItems:"flex-start", justifyContent:"center", paddingTop:5
              }}>
                <span style={{ fontSize:13, fontWeight:800, color:"#fff" }}>
                  {String(proximoEstagio.idx).padStart(2,"0")}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
      </>)}
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
    <div onClick={onClose} style={{
      position:"fixed", inset:0, background:"#000a", zIndex:1000,
      display:"flex", alignItems:"flex-start", justifyContent:"center",
      padding:"20px 12px", overflowY:"auto"
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16,
        width:"100%", maxWidth:440, padding:"20px", boxShadow:"0 20px 60px #000c"
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={{ fontSize:18, fontWeight:800, color:T.text }}>🎯 Definir meta</div>
          <button onClick={onClose} style={{ width:34, height:34, borderRadius:8, border:`1px solid ${T.border}`, background:T.cardAlt, color:T.text, cursor:"pointer", fontSize:16 }}>✕</button>
        </div>

        <div style={{ fontSize:11, color:T.textMute, marginBottom:6 }}>Meta de provento médio por mês (R$)</div>
        <input type="number" min="1" value={valor} onChange={e=>setValor(Math.max(0, +e.target.value))}
          style={{ width:"100%", background:T.cardAlt, border:`2px solid ${T.accent}`, borderRadius:10, color:T.text, padding:"12px 14px", fontSize:22, fontWeight:800, textAlign:"center", marginBottom:12 }} />

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
      <div style={{ background:`linear-gradient(135deg, ${T.red}1c, ${T.card})`, border:`1px solid ${T.border}`, borderRadius:14, padding:"16px", marginBottom:14 }}>
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
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:14 }}>
        <div style={{ fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>🎯 Marcos de independência</div>
        <div style={{ fontSize:10, color:T.textFaint, marginBottom:12, lineHeight:1.5 }}>
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
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:14 }}>
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
      <div style={{ background:"rgba(239,68,68,0.14)", border:`2px solid #ef4444`, borderRadius:14, padding:"14px 16px", marginBottom:14, textAlign:"center" }}>
        <div style={{ fontSize:26, marginBottom:4 }}>🚫💳</div>
        <div style={{ fontSize:14, fontWeight:800, color:"#ef4444" }}>PROIBIDO CARTÃO DE CRÉDITO</div>
        <div style={{ fontSize:10, color:T.textMute, marginTop:4, lineHeight:1.5 }}>
          A meta é nunca usar crédito rotativo. O único crédito permitido no futuro é o <strong style={{ color:T.text }}>garantido pelos seus próprios ativos</strong>.
        </div>
      </div>

      {/* JORNADA 3 FASES */}
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"16px 14px", marginBottom:14 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <div style={{ fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1 }}>🎯 Jornada: liberdade do crédito</div>
          <span style={{ fontSize:11, fontWeight:800, color: fasesOk===3?T.green:T.accentSoft }}>{fasesOk}/3 fases</span>
        </div>

        {/* setas das fases (estilo trilha de metas) */}
        <div style={{ display:"flex", gap:6, marginBottom:14 }}>
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
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:14 }}>
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
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px", marginBottom:14 }}>
        <div style={{ fontSize:11, color:T.textMute, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>💎 Limite garantido por ativos</div>

        <div style={{ fontSize:11, color:T.textDim, marginBottom:6 }}>Fundos provisionados como garantia (R$)</div>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:12 }}>
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
// PAINEL DE CONFIGURAÇÕES (engrenagem)
// ════════════════════════════════════════════════════════════════════════════
function PainelConfig({ T, temaId, setTemaId, layout, setLayout, fontEsc, setFontEsc, densidade, setDensidade, onLimparDados, onExportar, onImportar, onClose }) {
  const Secao = ({ titulo, children }) => (
    <div style={{ marginBottom:20 }}>
      <div style={{ fontSize:11,color:T.textMute,textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontWeight:700 }}>{titulo}</div>
      {children}
    </div>
  );
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

  return (
    <div onClick={onClose} style={{
      position:"fixed", inset:0, background:"#000a", zIndex:1000,
      display:"flex", alignItems:"flex-start", justifyContent:"center",
      padding:"20px 12px", overflowY:"auto"
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:T.bg, border:`1px solid ${T.borderSoft}`, borderRadius:16,
        width:"100%", maxWidth:440, padding:"20px", boxShadow:"0 20px 60px #000c"
      }}>
        {/* cabeçalho */}
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
          <div style={{ fontSize:18,fontWeight:800,color:T.text }}>⚙️ Configurações</div>
          <button onClick={onClose} style={{ width:34,height:34,borderRadius:8,border:`1px solid ${T.border}`,background:T.cardAlt,color:T.text,cursor:"pointer",fontSize:16 }}>✕</button>
        </div>

        {/* TEMA DE CORES */}
        <Secao titulo="🎨 Tema de cores">
          <div style={{ display:"flex",gap:8 }}>
            {Object.entries(TEMAS).map(([id,tema])=>(
              <Opcao key={id} ativo={temaId===id} onClick={()=>setTemaId(id)}>
                <span style={{ fontSize:22 }}>{tema.emoji}</span>
                <span>{tema.nome}</span>
              </Opcao>
            ))}
          </div>
        </Secao>

        {/* MODO DE LAYOUT */}
        <Secao titulo="🖥️ Modo de exibição">
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
                📺 Modo TV ativo: tudo maior e centralizado. Use teclado e mouse emparelhados na TV para navegar e configurar.
              </div>
            </div>
          )}
        </Secao>

        {/* TAMANHO DA FONTE */}
        <Secao titulo="🔤 Tamanho da fonte">
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
        </Secao>

        {/* DENSIDADE */}
        <Secao titulo="📏 Densidade dos elementos">
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
        </Secao>

        {/* DADOS — salvamento automático */}
        <Secao titulo="💾 Dados">
          <div style={{ background:`${T.green}10`, border:`1px solid ${T.green}33`, borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              <span style={{ fontSize:16 }}>✓</span>
              <div style={{ fontSize:11, color:T.green, fontWeight:700 }}>Salvamento automático ativado</div>
            </div>
            <div style={{ fontSize:10, color:T.textMute, marginTop:4, lineHeight:1.5 }}>
              Suas edições de ativos, meta e preferências ficam gravadas no aparelho e voltam ao reabrir o app.
            </div>
          </div>
          {/* backup */}
          <div style={{ display:"flex", gap:6, marginBottom:8 }}>
            <button onClick={onExportar} style={{
              flex:1, padding:"10px", borderRadius:10, cursor:"pointer",
              border:`1px solid ${T.green}55`, background:`${T.green}12`, color:T.green, fontSize:12, fontWeight:600
            }}>⬇️ Exportar backup</button>
            <button onClick={onImportar} style={{
              flex:1, padding:"10px", borderRadius:10, cursor:"pointer",
              border:`1px solid ${T.cyan}55`, background:`${T.cyan}12`, color:T.cyan, fontSize:12, fontWeight:600
            }}>⬆️ Importar backup</button>
          </div>
          <div style={{ fontSize:9, color:T.textFaint, marginBottom:8, lineHeight:1.5 }}>
            Exporta um arquivo com todos os seus dados (ativos, meta, custo de vida). Guarde-o para restaurar se trocar de aparelho ou reinstalar.
          </div>
          <button onClick={onLimparDados} style={{
            width:"100%", padding:"10px", borderRadius:10, cursor:"pointer",
            border:`1px solid ${T.red}55`, background:`${T.red}12`, color:T.red, fontSize:12, fontWeight:600
          }}>
            🗑️ Limpar dados salvos (voltar ao original)
          </button>
        </Secao>

        {/* RESET + FECHAR */}
        <div style={{ display:"flex",gap:8,marginTop:8 }}>
          <button onClick={()=>{ setTemaId("padrao"); setLayout("celular"); setFontEsc(1); setDensidade("confortavel"); }}
            style={{ flex:"1 1 0",padding:"11px",borderRadius:10,border:`1px solid ${T.borderSoft}`,background:T.cardAlt,color:T.textMute,cursor:"pointer",fontSize:12,fontWeight:600 }}>
            ↺ Restaurar padrão
          </button>
          <button onClick={onClose} style={{ flex:"1 1 0",padding:"11px",borderRadius:10,border:"none",background:T.accent,color:"#fff",cursor:"pointer",fontSize:12,fontWeight:700 }}>
            ✓ Aplicar e fechar
          </button>
        </div>

        <div style={{ marginTop:14,fontSize:10,color:T.textFaint,textAlign:"center",lineHeight:1.6 }}>
          As preferências valem durante o uso. No modo TV, empareie teclado e mouse via Bluetooth nas configurações da sua TV.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [temaId, setTemaId] = useEstadoSalvo("tema", "padrao");
  const [ativos, setAtivos] = useState(carregarAtivos);
  const [filtro, setFiltro] = useState("TUDO");
  const [mesSel, setMesSel] = useState(0);
  const [aba,    setAba]    = useState("painel");
  const [menuAberto, setMenuAberto] = useState(false);

  // ── CONFIGURAÇÕES (engrenagem) — todas salvas na memória ────────────────
  const [showConfig, setShowConfig] = useState(false);
  const [layout,   setLayout]   = useEstadoSalvo("layout", "celular");  // "celular" | "tv"
  const [fontEsc,  setFontEsc]  = useEstadoSalvo("fonte", 1);           // 0.85 | 1 | 1.15 | 1.35
  const [densidade,setDensidade]= useEstadoSalvo("densidade", "confortavel"); // "compacto" | "confortavel"

  // ── META DE PROVENTOS (trilha de progressão) — salva na memória ─────────
  const [metaMensal, setMetaMensal] = useEstadoSalvo("meta", 500);    // meta de provento médio/mes
  const [showMeta,   setShowMeta]   = useState(false);

  // ── CARTÃO / CUSTO DE VIDA — salvos na memória ──────────────────────────
  const [custoVida, setCustoVida] = useEstadoSalvo("custoVida", { agua:100, luz:200, condominio:0, aluguel:1000, internet:120, outros:0 });
  const [fundosProvisionados, setFundosProvisionados] = useEstadoSalvo("fundosProv", 3000);

  // ── HISTÓRICO REAL — retrato mensal da carteira (salvo na memória) ──────
  const [historico, setHistorico] = useEstadoSalvo("historico", []);

  // salva os ativos sempre que forem editados (merge é feito só na carga)
  useEffect(() => { gravarSalvo("ativos", ativos); }, [ativos]);

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

  const T = TEMAS[temaId];
  const ehTV = layout === "tv";
  // fator de escala global: TV aumenta tudo, + multiplicador de fonte do usuario
  const escala = (ehTV ? 1.25 : 1) * fontEsc;

  // ── ESCALA REAL via transform (funciona em qualquer navegador, inclusive preview) ──
  // 'zoom' falha em alguns ambientes; transform:scale sempre funciona, mas nao reflui
  // a altura — entao medimos o conteudo e reservamos o espaco vertical correto.
  const escalaRef = useRef(null);
  const [alturaEscalada, setAlturaEscalada] = useState(null);
  useLayoutEffect(() => {
    if (!escalaRef.current) return;
    const medir = () => {
      const h = escalaRef.current?.offsetHeight || 0;
      setAlturaEscalada(escala === 1 ? null : h * escala);
    };
    medir();
    // re-mede quando a janela muda de tamanho
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  });

  const listaFiltrada = filtro==="TUDO"?ativos:filtro==="FII"?ativos.filter(a=>a.cat==="FII"):ativos.filter(a=>a.cat==="Ação");
  const chartData = useMemo(()=>buildChart(ativos, filtro),[ativos, filtro]);
  const totalAnual = chartData.reduce((s,d)=>s+d._total,0);
  const mediaMes   = totalAnual/12;
  const maxMes     = Math.max(...chartData.map(d=>d._total), 0);
  const positivos  = chartData.filter(d=>d._total>0);
  const minMes     = positivos.length ? Math.min(...positivos.map(d=>d._total)) : 0;
  const totFII  = useMemo(()=>buildChart(ativos,"FII").reduce((s,d)=>s+d._total,0),[ativos]);
  const totAcao = useMemo(()=>buildChart(ativos,"Ação").reduce((s,d)=>s+d._total,0),[ativos]);

  const FILTROS = [
    {id:"TUDO",emoji:"📊",label:"Panorama", sub:"Ações + FIIs",cor:T.accentSoft},
    {id:"FII", emoji:"🏢",label:"Só FIIs",  sub:`${ativos.filter(a=>a.cat==="FII").length} fundos`, cor:T.cyan},
    {id:"Ação",emoji:"📈",label:"Só Ações", sub:`${ativos.filter(a=>a.cat==="Ação").length} ações`, cor:T.accent},
  ];
  // navegação organizada em seções (para a gaveta lateral)
  const SECOES = [
    { titulo:"Visão geral", itens:[
      {id:"painel",     label:"Painel",      emoji:"📊", desc:"Visão rápida da carteira"},
      {id:"analises",   label:"Análises",    emoji:"🔬", desc:"Gráfico detalhado + saúde"},
      {id:"calendario", label:"Calendário",  emoji:"📅", desc:"Quando cada um paga"},
      {id:"ranking",    label:"Ranking",     emoji:"🏆", desc:"Proventos e valorização"},
    ]},
    { titulo:"Planejamento", itens:[
      {id:"cenario",    label:"Cenário",     emoji:"🤖", desc:"Simular reinvestimento"},
      {id:"custovida",  label:"Custo de Vida",emoji:"🧾",desc:"Gastos e marcos"},
      {id:"cartao",     label:"Cartão",      emoji:"💳", desc:"Jornada sem crédito"},
    ]},
    { titulo:"Gerenciar", itens:[
      {id:"editar",     label:"Editar ativos",emoji:"✏️",desc:"Quantidades e cotações"},
    ]},
  ];
  const TODAS_ABAS = SECOES.flatMap(s=>s.itens);
  const abaAtual = TODAS_ABAS.find(a=>a.id===aba) || TODAS_ABAS[0];

  return (
    <div style={{ background:T.bg,minHeight:"100vh",color:T.text,fontFamily:"'Inter',system-ui,sans-serif",paddingBottom:48,transition:"background 0.3s" }}>

      {/* WRAPPER DE ESCALA — transform:scale escala TUDO (px fixos inclusive).
          A altura do container externo reserva o espaco do conteudo ja escalado,
          para o scroll funcionar corretamente. */}
      <div style={{ height: alturaEscalada || "auto", overflow: alturaEscalada ? "hidden" : "visible" }}>
      <div ref={escalaRef} style={{
        transform: escala !== 1 ? `scale(${escala})` : "none",
        transformOrigin: "top center",
        width: escala !== 1 ? `${100/escala}%` : "100%",
        marginLeft: escala !== 1 ? `${-(100/escala - 100)/2}%` : 0,
      }}>
      {/* container interno centralizado para TV */}
      <div style={{ maxWidth: ehTV ? 1100 : "none", margin:"0 auto" }}>

      {/* HEADER */}
      <div style={{ background:T.bgHeader,padding: densidade==="compacto" ? "12px 12px" : "16px 16px",borderBottom:`1px solid ${T.border}` }}>
        {/* linha superior: menu + título + engrenagem */}
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            {/* HAMBÚRGUER — abre a gaveta */}
            <button onClick={()=>setMenuAberto(true)} title="Menu" style={{
              width:38,height:34,borderRadius:9,border:`1px solid ${T.border}`,
              background:T.cardAlt,cursor:"pointer",fontSize:17,padding:0,
              display:"flex",alignItems:"center",justifyContent:"center",color:T.text
            }}>☰</button>
            <div style={{ fontSize:10,color:T.accent,letterSpacing:2,textTransform:"uppercase" }}>
              💰 Carteira {ehTV && <span style={{ color:T.green }}>· TV</span>}
            </div>
          </div>
          {/* ENGRENAGEM — abre configurações */}
          <button onClick={()=>setShowConfig(true)} title="Configurações" style={{
            width:38,height:34,borderRadius:9,border:`1px solid ${T.border}`,
            background:T.cardAlt,cursor:"pointer",fontSize:18,padding:0,
            display:"flex",alignItems:"center",justifyContent:"center"
          }}>⚙️</button>
        </div>
        {/* MODO FOCO — esconde KPIs e meta nas telas de trabalho */}
        {!["editar","cartao","custovida"].includes(aba) && (<>
        <div style={{ fontSize:26,fontWeight:800,color:T.text,letterSpacing:-1 }}>{fmt(totalAnual)}<span style={{ fontSize:12,color:T.textFaint,fontWeight:400,marginLeft:8 }}>/ ano · total</span></div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:6,marginTop:10 }}>
          {[
            {l:"Média/mês",v:fmt(mediaMes),c:T.accentSoft},
            {l:"Maior mês",v:fmt(maxMes),  c:T.green},
            {l:"Menor mês",v:fmt(minMes),  c:T.red},
            {l:"FIIs/ano", v:fmt(totFII),  c:T.cyan},
            {l:"Ações/ano",v:fmt(totAcao), c:T.accent},
            {l:"Por mês",  v:fmt(totalAnual/12), c:T.textDim},
          ].map(x=>(
            <div key={x.l} style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 8px" }}>
              <div style={{ fontSize:8,color:T.textFaint }}>{x.l}</div>
              <div style={{ fontSize:11,fontWeight:700,color:x.c }}>{x.v}</div>
            </div>
          ))}
        </div>

        {/* TRILHA DE METAS — progressão por estágios */}
        <TrilhaMetas valorAtual={mediaMes} metaMensal={metaMensal} onConfigurar={()=>setShowMeta(true)} T={T} />
        </>)}
      </div>

      {/* MODAL DEFINIR META */}
      {showMeta && (
        <ModalMeta metaMensal={metaMensal} setMetaMensal={setMetaMensal} valorAtual={mediaMes} onClose={()=>setShowMeta(false)} T={T} />
      )}

      {/* PAINEL DE CONFIGURAÇÕES (modal) */}
      {showConfig && (
        <PainelConfig
          T={T}
          temaId={temaId} setTemaId={setTemaId}
          layout={layout} setLayout={setLayout}
          fontEsc={fontEsc} setFontEsc={setFontEsc}
          densidade={densidade} setDensidade={setDensidade}
          onLimparDados={()=>{
            if(window.confirm("Apagar TODOS os dados salvos (ativos editados, meta e preferências) e voltar ao original? Isso não pode ser desfeito.")){
              try { Object.keys(localStorage).filter(k=>k.startsWith(PREFIXO)).forEach(k=>localStorage.removeItem(k)); } catch {}
              setAtivos(ATIVOS_INICIAIS.map(a=>({...a})));
              setTemaId("padrao"); setLayout("celular"); setFontEsc(1); setDensidade("confortavel"); setMetaMensal(500);
              setShowConfig(false);
            }
          }}
          onExportar={()=>{
            const backup = {
              app:"CarteiraProventos", versao:"1.9.0", data:new Date().toISOString(),
              ativos, meta:metaMensal, custoVida, fundosProvisionados,
              tema:temaId, layout, fonte:fontEsc, densidade,
            };
            try {
              const blob = new Blob([JSON.stringify(backup,null,2)], { type:"application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              const hoje = new Date().toISOString().slice(0,10);
              a.href = url; a.download = `carteira-backup-${hoje}.json`;
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              URL.revokeObjectURL(url);
            } catch(e){ window.alert("Não foi possível exportar neste ambiente. No APK funciona normalmente."); }
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
        <div onClick={()=>setMenuAberto(false)} style={{ position:"fixed", inset:0, background:"#000a", zIndex:1050, display:"flex" }}>
          <div onClick={e=>e.stopPropagation()} style={{
            width:"82%", maxWidth:320, height:"100%", background:T.bg, borderRight:`1px solid ${T.borderSoft}`,
            boxShadow:"4px 0 30px #000a", overflowY:"auto", display:"flex", flexDirection:"column"
          }}>
            {/* cabeçalho da gaveta */}
            <div style={{ padding:"18px 16px 14px", borderBottom:`1px solid ${T.border}`, background:T.bgHeader }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:14, fontWeight:800, color:T.text }}>💰 Carteira Proventos</div>
                <button onClick={()=>setMenuAberto(false)} style={{ width:32,height:32,borderRadius:8,border:`1px solid ${T.border}`,background:T.cardAlt,color:T.text,cursor:"pointer",fontSize:15 }}>✕</button>
              </div>
              <div style={{ fontSize:10, color:T.textFaint, marginTop:4 }}>{fmt(totalAnual)}/ano · {fmt(mediaMes)}/mês</div>
            </div>

            {/* seções */}
            <div style={{ flex:1, padding:"8px 10px" }}>
              {SECOES.map(sec=>(
                <div key={sec.titulo} style={{ marginBottom:14 }}>
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
        {/* TÍTULO DA TELA ATUAL (substitui a barra de abas) */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14 }}>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <span style={{ fontSize:22 }}>{abaAtual.emoji}</span>
            <div>
              <div style={{ fontSize:17,fontWeight:800,color:T.text,lineHeight:1.1 }}>{abaAtual.label}</div>
              <div style={{ fontSize:10,color:T.textFaint }}>{abaAtual.desc}</div>
            </div>
          </div>
          <button onClick={()=>setMenuAberto(true)} style={{ display:"flex",alignItems:"center",gap:5,padding:"7px 12px",borderRadius:9,border:`1px solid ${T.border}`,background:T.card,color:T.textMute,cursor:"pointer",fontSize:11,fontWeight:600 }}>
            ☰ Menu
          </button>
        </div>

        {/* FILTROS — seletor segmentado (só em gráfico/ranking) */}
        {(aba==="analises"||aba==="ranking") && (
          <div style={{ display:"flex", gap:3, background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:3, marginBottom:14 }}>
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

        {/* ABA PAINEL (dashboard) */}
        {aba==="painel" && <PainelCarteira ativos={ativos} historico={historico} T={T}/>}


        {/* ABA CALENDÁRIO */}
        {aba==="calendario" && <Calendario ativos={ativos} T={T}/>}

        {/* ABA GRÁFICO */}
        {aba==="analises" && (
          <>
            <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"14px 6px 8px",marginBottom:14 }}>
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
            <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"14px",marginBottom:14 }}>
              <div style={{ fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:1,marginBottom:10 }}>Detalhes do mês · toque em uma barra</div>
              <DetalheMes ativos={ativos} idx={mesSel} filtro={filtro} T={T}/>
            </div>
            {/* análises de carteira (yield, saúde, benchmarks) */}
            <AnaliseCarteira ativos={ativos} T={T}/>
          </>
        )}

        {/* ABA RANKING */}
        {aba==="ranking" && (
          <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"14px" }}>
            <Ranking ativos={listaFiltrada} T={T}/>
          </div>
        )}

        {/* ABA CENÁRIO */}
        {aba==="cenario" && <CenarioFuturo ativos={ativos} fundosProvisionados={fundosProvisionados} T={T}/>}

        {/* ABA CUSTO DE VIDA */}
        {aba==="custovida" && <CustoVida custoVida={custoVida} setCustoVida={setCustoVida} mediaMes={mediaMes} T={T}/>}

        {/* ABA CARTÃO */}
        {aba==="cartao" && <CartaoCredito ativos={ativos} mediaMes={mediaMes} custoVida={custoVida} setCustoVida={setCustoVida} fundosProvisionados={fundosProvisionados} setFundosProvisionados={setFundosProvisionados} T={T}/>}

        {/* ABA EDITAR */}
        {aba==="editar" && <EditarAtivos ativos={ativos} setAtivos={setAtivos} T={T}/>}

        {(aba==="analises"||aba==="ranking") && (
          <div style={{ background:T.cardAlt,border:`1px dashed ${T.borderSoft}`,borderRadius:10,padding:"10px 12px",marginTop:14 }}>
            <div style={{ fontSize:10,color:T.textFaint,lineHeight:1.7 }}>📌 FIIs pagam mensalmente. Ações seguem calendário histórico. Valores brutos — JCP têm IR 15%; FIIs isentos para PF.</div>
          </div>
        )}
      </div>

      </div>{/* fim container TV center */}
      </div>{/* fim escalaRef scale */}
      </div>{/* fim container de altura */}
    </div>
  );
}
