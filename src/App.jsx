import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Area, AreaChart
} from "recharts";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
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

// ─── PALETAS ──────────────────────────────────────────────────────────────────
const COR_FII  = { MFII11:"#06b6d4",VGHF11:"#0891b2",RBRY11:"#0e7490",OIAG11:"#22d3ee",CPTS11:"#67e8f9",GARE11:"#2dd4bf",TRXF11:"#0d9488",RBRX11:"#14b8a6",IRIM11:"#5eead4",KNCR11:"#99f6e4",VISC11:"#34d399",XPML11:"#6ee7b7",MXRF11:"#a7f3d0" };
const COR_ACAO = { BBAS3:"#6366f1",PETR4:"#8b5cf6",BBDC3:"#a78bfa",ITSA4:"#c084fc",BBSE3:"#e879f9",TAEE11:"#f472b6",BRSR6:"#818cf8",KLBN4:"#7c3aed",KLBN11:"#db2777",CXSE3:"#ec4899",WEGE3:"#be185d",CPLE3:"#9d174d",SANB3:"#fb7185" };
const CORES    = { ...COR_FII, ...COR_ACAO };

// ─── ATIVOS ───────────────────────────────────────────────────────────────────
const ATIVOS = [
  { ticker:"MFII11",nome:"Mérito Desenvolvimento",  cat:"FII", freq:"Mensal",    qtd:132,prov:1.06,cotacao:50.71,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"VGHF11",nome:"Valora Hedge Fund",        cat:"FII", freq:"Mensal",    qtd:333,prov:0.07,cotacao:5.99, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"RBRY11",nome:"BR Credit",                cat:"FII", freq:"Mensal",    qtd:21, prov:1.00,cotacao:89.49,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"OIAG11",nome:"Ourinvest Agro",           cat:"FII", freq:"Mensal",    qtd:146,prov:0.08,cotacao:8.15, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"CPTS11",nome:"Capitânia Securities",     cat:"FII", freq:"Mensal",    qtd:152,prov:0.09,cotacao:7.39, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"GARE11",nome:"Guardian",                 cat:"FII", freq:"Mensal",    qtd:114,prov:0.08,cotacao:8.14, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"TRXF11",nome:"TRX Real Estate",          cat:"FII", freq:"Mensal",    qtd:10, prov:0.85,cotacao:91.53,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"RBRX11",nome:"RBR Properties",           cat:"FII", freq:"Mensal",    qtd:112,prov:0.09,cotacao:8.11, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"IRIM11",nome:"Iridium Recebíveis",       cat:"FII", freq:"Mensal",    qtd:12, prov:0.90,cotacao:65.95,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"KNCR11",nome:"Kinea Crédito Real",       cat:"FII", freq:"Mensal",    qtd:5,  prov:1.10,cotacao:107.28,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"VISC11",nome:"Vinci Shopping Centers",   cat:"FII", freq:"Mensal",    qtd:3,  prov:0.72,cotacao:103.86,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"XPML11",nome:"XP Malls",                 cat:"FII", freq:"Mensal",    qtd:2,  prov:0.72,cotacao:103.98,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"MXRF11",nome:"Maxi Renda",               cat:"FII", freq:"Mensal",    qtd:16, prov:0.10,cotacao:9.68, meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"BBAS3", nome:"Banco do Brasil",  cat:"Ação",freq:"Trimestral", qtd:291,prov:0.14,cotacao:19.86,meses:[3,6,9,12] },
  { ticker:"PETR4", nome:"Petrobras",        cat:"Ação",freq:"Trimestral", qtd:145,prov:0.47,cotacao:39.33,meses:[2,5,8,11] },
  { ticker:"BBDC3", nome:"Bradesco",         cat:"Ação",freq:"Mensal",     qtd:50, prov:0.02,cotacao:15.54,meses:[1,2,3,4,5,6,7,8,9,10,11,12] },
  { ticker:"ITSA4", nome:"Itaúsa",           cat:"Ação",freq:"Trimestral", qtd:116,prov:0.08,cotacao:13.03,meses:[1,4,7,10] },
  { ticker:"BBSE3", nome:"BB Seguridade",    cat:"Ação",freq:"Semestral",  qtd:9,  prov:0.40,cotacao:38.27,meses:[5,11] },
  { ticker:"TAEE11",nome:"Taesa",            cat:"Ação",freq:"Semestral",  qtd:6,  prov:0.90,cotacao:39.79,meses:[6,12] },
  { ticker:"BRSR6", nome:"Banrisul",         cat:"Ação",freq:"Trimestral", qtd:44, prov:0.32,cotacao:13.55,meses:[3,6,9,12] },
  { ticker:"KLBN4", nome:"Klabin PN",        cat:"Ação",freq:"Semestral",  qtd:332,prov:0.10,cotacao:3.37, meses:[4,10] },
  { ticker:"KLBN11",nome:"Klabin UNT",       cat:"Ação",freq:"Semestral",  qtd:14, prov:0.25,cotacao:16.81,meses:[4,10] },
  { ticker:"CXSE3", nome:"Caixa Seguridade", cat:"Ação",freq:"Semestral",  qtd:13, prov:0.35,cotacao:19.43,meses:[5,11] },
  { ticker:"WEGE3", nome:"Weg",              cat:"Ação",freq:"Semestral",  qtd:2,  prov:0.12,cotacao:45.71,meses:[4,10] },
  { ticker:"CPLE3", nome:"Copel",            cat:"Ação",freq:"Semestral",  qtd:3,  prov:0.22,cotacao:14.99,meses:[5,11] },
  { ticker:"SANB3", nome:"Santander",        cat:"Ação",freq:"Trimestral", qtd:102,prov:0.06,cotacao:12.86,meses:[3,6,9,12] },
];
const FIIS  = ATIVOS.filter(a => a.cat === "FII");
const ACOES = ATIVOS.filter(a => a.cat === "Ação");
const MESES_BASE = ["Jul/26","Ago/26","Set/26","Out/26","Nov/26","Dez/26","Jan/27","Fev/27","Mar/27","Abr/27","Mai/27","Jun/27"];
const PATRI_INICIAL = ATIVOS.reduce((s,a) => s + a.qtd * a.cotacao, 0);

function buildChart(filtro) {
  const ativos = filtro==="TUDO" ? ATIVOS : filtro==="FII" ? FIIS : ACOES;
  return MESES_BASE.map((mes,i) => {
    const e = { mes };
    let t = 0;
    ativos.forEach(a => { const v = mesesIdx(a.meses).includes(i) ? +(a.prov*a.qtd).toFixed(2) : 0; e[a.ticker]=v; t+=v; });
    e._total = +t.toFixed(2);
    return e;
  });
}

// ─── SIMULAÇÃO MÊS A MÊS (reativa, composta) ─────────────────────────────────
// Cada mês: recebe proventos (já com cotas compradas em meses anteriores),
// soma aporte extra, reinveste conforme regras comprando cotas inteiras.
function simular(regras, horizonte, aporte) {
  const estado = ATIVOS.map(a => ({ ...a }));
  let acum = 0;
  return Array.from({ length: horizonte }, (_, m) => {
    // 1) Proventos REAIS do mês com as quantidades ATUAIS (já incrementadas)
    let provBrutoMes = 0;
    const detalhes = [];
    estado.forEach(a => {
      if (mesesIdx(a.meses).includes(m % 12)) {
        const v = a.prov * a.qtd;
        provBrutoMes += v;
        detalhes.push({ ticker: a.ticker, cat: a.cat, val: +v.toFixed(2) });
      }
    });

    // 2) Caixa disponível = sobra anterior + provento do mês + aporte
    let caixa = acum + provBrutoMes + aporte;
    const caixaInicial = caixa;

    // 3) Reinvestir conforme regras (compra cotas inteiras)
    const compras = [];
    regras.forEach(r => {
      if (r.pct <= 0) return;
      const ativo = estado.find(a => a.ticker === r.ticker);
      if (!ativo) return;
      const cot = r.cotacaoAlvo || ativo.cotacao;
      const orcamento = caixaInicial * (r.pct / 100);
      const cotas = Math.floor(orcamento / cot);
      if (cotas > 0) {
        ativo.qtd += cotas;
        caixa -= cotas * cot;
        compras.push({ ticker: r.ticker, cotas, gasto: +(cotas*cot).toFixed(2) });
      }
    });
    acum = Math.max(caixa, 0);

    // 4) Patrimônio e provento médio mensal projetado (com novas qtds)
    const patri = estado.reduce((s,a) => s + a.qtd*a.cotacao, 0);
    const provMedio = estado.reduce((s,a) => s + a.prov*a.qtd*a.meses.length/12, 0);

    return {
      mes: labelMes(m),
      provento: +provBrutoMes.toFixed(2),     // provento recebido NESTE mês
      provMedio: +provMedio.toFixed(2),         // média mensal projetada
      patrimonio: +patri.toFixed(2),
      caixa: +acum.toFixed(2),
      compras,
      detalhes: detalhes.sort((a,b)=>b.val-a.val),
    };
  });
}

// ─── TOOLTIPS ─────────────────────────────────────────────────────────────────
function TipBar({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter(p=>p.value>0).sort((a,b)=>b.value-a.value);
  return (
    <div style={{ background:"#12122a",border:"1px solid #4338ca",borderRadius:10,padding:"10px 14px",minWidth:200,maxHeight:300,overflowY:"auto",boxShadow:"0 8px 24px #0008" }}>
      <div style={{ fontSize:11,fontWeight:800,color:"#c7d2fe",marginBottom:6,borderBottom:"1px solid #1e293b",paddingBottom:4 }}>{label}</div>
      {items.map(p=>(
        <div key={p.dataKey} style={{ display:"flex",justifyContent:"space-between",gap:10,marginBottom:3,alignItems:"center" }}>
          <div style={{ display:"flex",alignItems:"center",gap:5 }}>
            <div style={{ width:8,height:8,borderRadius:2,background:CORES[p.dataKey]||"#64748b",flexShrink:0 }}/>
            <span style={{ fontSize:10,color:"#94a3b8" }}>{p.dataKey}</span>
          </div>
          <span style={{ fontSize:11,fontWeight:700,color:CORES[p.dataKey]||"#f1f5f9" }}>{fmt(p.value)}</span>
        </div>
      ))}
      <div style={{ borderTop:"1px solid #4338ca",marginTop:6,paddingTop:6,fontSize:12,fontWeight:800,color:"#a5b4fc",display:"flex",justifyContent:"space-between" }}>
        <span>Total</span><span>{fmt(items.reduce((s,p)=>s+p.value,0))}</span>
      </div>
    </div>
  );
}
function TipSim({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#12122a",border:"1px solid #4338ca",borderRadius:10,padding:"10px 14px",minWidth:190,boxShadow:"0 8px 24px #0008" }}>
      <div style={{ fontSize:11,fontWeight:800,color:"#c7d2fe",marginBottom:6,borderBottom:"1px solid #1e293b",paddingBottom:4 }}>{label}</div>
      {payload.map(p=>(
        <div key={p.name} style={{ display:"flex",justifyContent:"space-between",gap:14,marginBottom:3 }}>
          <div style={{ display:"flex",alignItems:"center",gap:5 }}>
            <div style={{ width:8,height:8,borderRadius:2,background:p.color }}/>
            <span style={{ fontSize:10,color:"#94a3b8" }}>{p.name}</span>
          </div>
          <span style={{ fontSize:11,fontWeight:700,color:p.color }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Legenda({ ativos }) {
  return (
    <div style={{ display:"flex",flexWrap:"wrap",gap:"4px 10px",padding:"6px 8px 2px" }}>
      {ativos.map(a=>(
        <div key={a.ticker} style={{ display:"flex",alignItems:"center",gap:4 }}>
          <div style={{ width:8,height:8,borderRadius:2,background:CORES[a.ticker] }}/>
          <span style={{ fontSize:9,color:"#64748b" }}>{a.ticker}</span>
        </div>
      ))}
    </div>
  );
}

function DetalheMes({ idx, filtro }) {
  const ativos = filtro==="TUDO" ? ATIVOS : filtro==="FII" ? FIIS : ACOES;
  const pag = ativos.filter(a=>mesesIdx(a.meses).includes(idx)).map(a=>({...a,total:+(a.prov*a.qtd).toFixed(2)})).sort((a,b)=>b.total-a.total);
  const total = pag.reduce((s,a)=>s+a.total,0);
  return (
    <div>
      <div style={{ display:"flex",alignItems:"baseline",gap:8,marginBottom:10 }}>
        <span style={{ fontSize:12,fontWeight:700,color:"#c7d2fe" }}>{MESES_BASE[idx]}</span>
        <span style={{ fontSize:20,fontWeight:800,color:"#f1f5f9" }}>{fmt(total)}</span>
      </div>
      {pag.length===0
        ? <div style={{ fontSize:12,color:"#475569",textAlign:"center",padding:"16px 0" }}>Nenhum provento neste mês</div>
        : pag.map(a=>(
          <div key={a.ticker} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",background:`${CORES[a.ticker]}0d`,border:`1px solid ${CORES[a.ticker]}33`,borderLeft:`3px solid ${CORES[a.ticker]}`,borderRadius:8,padding:"8px 12px",marginBottom:5 }}>
            <div style={{ display:"flex",alignItems:"center",gap:7 }}>
              <div style={{ width:8,height:8,borderRadius:2,background:CORES[a.ticker] }}/>
              <div>
                <span style={{ fontSize:12,fontWeight:700,color:"#e2e8f0" }}>{a.ticker}</span>
                <span style={{ fontSize:9,color:"#475569",background:"#1e293b",padding:"1px 5px",borderRadius:4,marginLeft:6 }}>{a.freq}</span>
                <div style={{ fontSize:10,color:"#475569",marginTop:1 }}>{a.nome} · {a.qtd}× R${a.prov.toFixed(2)}</div>
              </div>
            </div>
            <div style={{ fontSize:13,fontWeight:800,color:CORES[a.ticker] }}>{fmt(a.total)}</div>
          </div>
        ))
      }
    </div>
  );
}

function Ranking({ ativos }) {
  const ranked = ativos.map(a=>({...a,ano:+(mesesIdx(a.meses).length*a.prov*a.qtd).toFixed(2)})).filter(a=>a.ano>0).sort((a,b)=>b.ano-a.ano);
  const total = ranked.reduce((s,a)=>s+a.ano,0); const max = ranked[0]?.ano||1;
  return (
    <div>
      <div style={{ fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:12 }}>Ranking anual · {fmt(total)}</div>
      {ranked.map((a,i)=>(
        <div key={a.ticker} style={{ marginBottom:9 }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3 }}>
            <div style={{ display:"flex",alignItems:"center",gap:7 }}>
              <span style={{ fontSize:10,color:"#334155",fontWeight:700,minWidth:18 }}>#{i+1}</span>
              <div style={{ width:9,height:9,borderRadius:2,background:CORES[a.ticker] }}/>
              <span style={{ fontSize:12,fontWeight:700,color:"#e2e8f0" }}>{a.ticker}</span>
              <span style={{ fontSize:9,color:"#475569",background:"#1e293b",padding:"1px 5px",borderRadius:4 }}>{a.freq}</span>
            </div>
            <span style={{ fontSize:12,fontWeight:800,color:CORES[a.ticker] }}>{fmt(a.ano)}</span>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:6 }}>
            <div style={{ flex:1,height:5,background:"#1e293b",borderRadius:4,overflow:"hidden" }}>
              <div style={{ height:"100%",width:`${(a.ano/max)*100}%`,background:CORES[a.ticker],borderRadius:4 }}/>
            </div>
            <span style={{ fontSize:9,color:"#475569",minWidth:32,textAlign:"right" }}>{((a.ano/total)*100).toFixed(1)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── CENÁRIO FUTURO ───────────────────────────────────────────────────────────
const PRESETS = [
  { id:"mfii",  emoji:"🏗️", label:"100% MFII11",   desc:"Mérito — paga todo mês",     regras:[{ticker:"MFII11",pct:100,cotacaoAlvo:50.71}] },
  { id:"kncr",  emoji:"💼", label:"100% KNCR11",   desc:"Kinea — CRI seguro",         regras:[{ticker:"KNCR11",pct:100,cotacaoAlvo:107.28}] },
  { id:"vghf",  emoji:"📦", label:"100% VGHF11",   desc:"Valora — mais cotas/R$",     regras:[{ticker:"VGHF11",pct:100,cotacaoAlvo:5.99}] },
  { id:"mix",   emoji:"⚖️", label:"Mix FIIs",       desc:"MFII 50%·VGHF 30%·KNCR 20%",regras:[{ticker:"MFII11",pct:50,cotacaoAlvo:50.71},{ticker:"VGHF11",pct:30,cotacaoAlvo:5.99},{ticker:"KNCR11",pct:20,cotacaoAlvo:107.28}] },
  { id:"custom",emoji:"⚙️", label:"Personalizado",  desc:"Configure você mesmo",       regras:[] },
];

function CenarioFuturo() {
  const [presetId,  setPresetId]  = useState("mfii");
  const [horizonte, setHorizonte] = useState(60);
  const [aporte,    setAporte]    = useState(0);
  const [modo,      setModo]      = useState("provento");
  const [mesSelSim, setMesSelSim] = useState(0);
  const [customR,   setCustomR]   = useState([
    { ticker:"MFII11",pct:60,cotacaoAlvo:50.71 },
    { ticker:"VGHF11",pct:40,cotacaoAlvo:5.99 },
  ]);

  const preset = PRESETS.find(p=>p.id===presetId);
  const regras = presetId==="custom" ? customR : preset.regras;
  const pctTotal = regras.reduce((s,r)=>s+r.pct,0);

  // RECALCULA sempre que qualquer entrada muda → gráfico reage
  const dados = useMemo(
    () => simular(regras, horizonte, aporte),
    [presetId, horizonte, aporte, JSON.stringify(customR)]
  );

  const provInicial = dados[0]?.provento || 0;
  const provFinal   = dados[dados.length-1]?.provento || 0;
  const provMedioFinal = dados[dados.length-1]?.provMedio || 0;
  const patriFinal  = dados[dados.length-1]?.patrimonio || 0;
  const crescProv   = provInicial>0 ? +((provMedioFinal/(dados[0]?.provMedio||1)-1)*100).toFixed(1) : 0;
  const crescPatri  = +((patriFinal/PATRI_INICIAL-1)*100).toFixed(1);

  function updR(i,f,v) { setCustomR(prev=>prev.map((r,j)=>j===i?{...r,[f]:v}:r)); }

  const HORIZ = [{v:12,l:"1a"},{v:24,l:"2a"},{v:36,l:"3a"},{v:60,l:"5a"},{v:120,l:"10a"}];
  const APORTES = [0,100,200,500,1000];

  // mês selecionado na tabela de simulação
  const mSel = dados[Math.min(mesSelSim, dados.length-1)];

  return (
    <div>
      {/* KPIs */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14 }}>
        {[
          {l:"Provento 1º mês", v:fmt(provInicial), c:"#94a3b8"},
          {l:`Provento médio em ${horizonte>=12?`${horizonte/12}a`:horizonte+"m"}`, v:fmt(provMedioFinal), c:"#34d399"},
          {l:"Crescimento proventos", v:`+${crescProv}%`, c:"#fbbf24"},
          {l:"Patrimônio projetado", v:fmtK(patriFinal), c:"#a5b4fc"},
        ].map(k=>(
          <div key={k.l} style={{ background:"#131325",border:"1px solid #1e293b",borderRadius:10,padding:"10px 12px" }}>
            <div style={{ fontSize:9,color:"#475569",marginBottom:2 }}>{k.l}</div>
            <div style={{ fontSize:16,fontWeight:800,color:k.c }}>{k.v}</div>
            {k.l.includes("Patrimônio")&&<div style={{ fontSize:9,color:"#334155" }}>+{crescPatri}% vs hoje</div>}
          </div>
        ))}
      </div>

      {/* Config */}
      <div style={{ background:"#131325",border:"1px solid #1e293b",borderRadius:12,padding:"14px",marginBottom:14 }}>
        <div style={{ fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:12 }}>⚙️ Configuração</div>

        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11,color:"#64748b",marginBottom:6 }}>Horizonte</div>
          <div style={{ display:"flex",gap:6 }}>
            {HORIZ.map(o=>(
              <button key={o.v} onClick={()=>{setHorizonte(o.v); setMesSelSim(0);}} style={{ flex:"1 1 0",padding:"6px 4px",borderRadius:8,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,background:horizonte===o.v?"#6366f1":"#1e293b",color:horizonte===o.v?"#fff":"#64748b" }}>{o.l}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11,color:"#64748b",marginBottom:6 }}>Aporte mensal extra (além dos proventos)</div>
          <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
            {APORTES.map(v=>(
              <button key={v} onClick={()=>setAporte(v)} style={{ padding:"6px 10px",borderRadius:8,border:"none",cursor:"pointer",fontSize:10,fontWeight:600,background:aporte===v?"#059669":"#1e293b",color:aporte===v?"#fff":"#64748b" }}>{v===0?"Sem aporte":`+${fmt(v)}`}</button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize:11,color:"#64748b",marginBottom:6 }}>Estratégia de reinvestimento</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:presetId==="custom"?12:0 }}>
            {PRESETS.map(p=>{
              const sel=presetId===p.id;
              return (
                <button key={p.id} onClick={()=>{setPresetId(p.id); setMesSelSim(0);}} style={{ padding:"9px 10px",borderRadius:10,border:`2px solid ${sel?"#6366f1":"#1e293b"}`,background:sel?"#1a1040":"#0f0f1a",cursor:"pointer",textAlign:"left",transition:"all 0.15s" }}>
                  <div style={{ fontSize:11,fontWeight:700,color:sel?"#a5b4fc":"#64748b" }}>{p.emoji} {p.label}</div>
                  <div style={{ fontSize:9,color:"#475569",marginTop:2 }}>{p.desc}</div>
                </button>
              );
            })}
          </div>

          {presetId==="custom" && (
            <div>
              <div style={{ fontSize:10,color:"#64748b",marginBottom:8 }}>
                Regras · <span style={{ color:pctTotal===100?"#34d399":pctTotal>100?"#f87171":"#fbbf24",fontWeight:700 }}>{pctTotal}% alocado {pctTotal!==100?"⚠️":"✓"}</span>
              </div>
              {customR.map((r,i)=>{
                const base = ATIVOS.find(a=>a.ticker===r.ticker);
                return (
                  <div key={i} style={{ background:"#0f0f1a",border:"1px solid #1e293b",borderRadius:8,padding:"10px",marginBottom:6 }}>
                    <div style={{ display:"flex",gap:6,alignItems:"center",flexWrap:"wrap" }}>
                      <select value={r.ticker} onChange={e=>{ const a=ATIVOS.find(x=>x.ticker===e.target.value); updR(i,"ticker",e.target.value); if(a)updR(i,"cotacaoAlvo",a.cotacao); }} style={{ flex:"1 1 140px",background:"#1e293b",border:"1px solid #334155",borderRadius:6,color:"#e2e8f0",padding:"5px 8px",fontSize:11 }}>
                        {ATIVOS.map(a=><option key={a.ticker} value={a.ticker}>{a.ticker} — {a.nome}</option>)}
                      </select>
                      <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                        <input type="number" min="0" max="100" value={r.pct} onChange={e=>updR(i,"pct",+e.target.value)} style={{ width:50,background:"#1e293b",border:"1px solid #334155",borderRadius:6,color:"#f1f5f9",padding:"5px 6px",fontSize:11,textAlign:"center" }} />
                        <span style={{ fontSize:10,color:"#475569" }}>%</span>
                      </div>
                      <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                        <span style={{ fontSize:10,color:"#475569" }}>R$</span>
                        <input type="number" min="0" step="0.01" value={r.cotacaoAlvo} onChange={e=>updR(i,"cotacaoAlvo",+e.target.value)} style={{ width:60,background:"#1e293b",border:"1px solid #334155",borderRadius:6,color:"#f1f5f9",padding:"5px 6px",fontSize:11,textAlign:"center" }} />
                      </div>
                      <button onClick={()=>setCustomR(p=>p.filter((_,j)=>j!==i))} style={{ background:"#7f1d1d",border:"none",borderRadius:6,color:"#fca5a5",padding:"5px 9px",cursor:"pointer",fontSize:11 }}>✕</button>
                    </div>
                    {base&&<div style={{ fontSize:9,color:"#475569",marginTop:4 }}>Prov: R${base.prov.toFixed(2)}/cota · DY {((base.prov/base.cotacao)*100).toFixed(2)}%/mês · {base.freq}</div>}
                  </div>
                );
              })}
              <button onClick={()=>setCustomR(p=>[...p,{ticker:"MXRF11",pct:0,cotacaoAlvo:9.68}])} style={{ width:"100%",padding:"7px",borderRadius:8,border:"1px dashed #334155",background:"transparent",color:"#475569",cursor:"pointer",fontSize:11,marginTop:4 }}>+ Adicionar ativo</button>
            </div>
          )}
        </div>
      </div>

      {/* GRÁFICO reativo */}
      <div style={{ background:"#131325",border:"1px solid #1e293b",borderRadius:12,padding:"14px 6px 10px",marginBottom:14 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",paddingLeft:8,marginBottom:10 }}>
          <div style={{ fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:1 }}>Evolução mês a mês</div>
          <div style={{ display:"flex",gap:4 }}>
            {[["provento","💰 Proventos"],["patrimonio","💼 Patrimônio"]].map(([id,l])=>(
              <button key={id} onClick={()=>setModo(id)} style={{ padding:"4px 8px",borderRadius:6,border:"none",cursor:"pointer",fontSize:9,fontWeight:600,background:modo===id?"#6366f1":"#1e293b",color:modo===id?"#fff":"#64748b" }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ width:"100%", height:240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dados} margin={{ top:8,right:12,left:0,bottom:0 }}
              onClick={(e)=>{ if(e && e.activeTooltipIndex!=null) setMesSelSim(e.activeTooltipIndex); }}>
              <defs>
                <linearGradient id="gradProv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.4}/>
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.02}/>
                </linearGradient>
                <linearGradient id="gradPatri" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4}/>
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false}/>
              <XAxis dataKey="mes" tick={{ fontSize:8,fill:"#64748b" }} axisLine={false} tickLine={false}
                interval={Math.max(Math.floor(dados.length/7)-1,0)} minTickGap={10}/>
              <YAxis tick={{ fontSize:8,fill:"#64748b" }} axisLine={false} tickLine={false}
                width={42} domain={[0,'auto']}
                tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:`${Math.round(v)}`}/>
              <Tooltip content={<TipSim />}/>
              {modo==="provento" ? (
                <Area type="monotone" dataKey="provMedio" name="Provento médio/mês"
                  stroke="#34d399" strokeWidth={2.5} fill="url(#gradProv)" dot={false} activeDot={{ r:4, fill:"#34d399" }}/>
              ) : (
                <Area type="monotone" dataKey="patrimonio" name="Patrimônio total"
                  stroke="#6366f1" strokeWidth={2.5} fill="url(#gradPatri)" dot={false} activeDot={{ r:4, fill:"#6366f1" }}/>
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Marcos */}
        <div style={{ display:"flex",gap:6,marginTop:10,paddingLeft:8,overflowX:"auto" }}>
          {[12,24,36,60,120].filter(m=>m<=horizonte).map(m=>{
            const d = dados[m-1]; if(!d) return null;
            return (
              <div key={m} style={{ flex:"0 0 auto",background:"#0f0f1a",border:"1px solid #1e293b",borderRadius:8,padding:"5px 10px",textAlign:"center" }}>
                <div style={{ fontSize:8,color:"#475569",marginBottom:2 }}>{m>=12?`${m/12} ano${m/12>1?"s":""}`:m+"m"}</div>
                <div style={{ fontSize:11,fontWeight:800,color:"#34d399" }}>{fmtK(d.provMedio)}</div>
                <div style={{ fontSize:8,color:"#64748b" }}>/mês</div>
                <div style={{ fontSize:10,fontWeight:700,color:"#6366f1",marginTop:2 }}>{fmtK(d.patrimonio)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* TABELA MÊS A MÊS — conversa com o gráfico */}
      <div style={{ background:"#131325",border:"1px solid #1e293b",borderRadius:12,padding:"14px",marginBottom:14 }}>
        <div style={{ fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:10 }}>
          📋 Fluxo de reinvestimento — toque numa barra do gráfico
        </div>

        {/* navegação de mês */}
        <div style={{ display:"flex",gap:2,marginBottom:12,overflowX:"auto" }}>
          {dados.slice(0,Math.min(horizonte,24)).map((d,i)=>(
            <button key={i} onClick={()=>setMesSelSim(i)} style={{ flex:"0 0 auto",minWidth:54,padding:"5px 4px",borderRadius:6,border:`1px solid ${i===mesSelSim?"#6366f1":"#1e293b"}`,background:i===mesSelSim?"#1a1040":"#0f0f1a",cursor:"pointer" }}>
              <div style={{ fontSize:8,color:i===mesSelSim?"#a5b4fc":"#475569" }}>{d.mes}</div>
              <div style={{ fontSize:9,fontWeight:700,color:i===mesSelSim?"#34d399":"#64748b" }}>{fmtK(d.provento)}</div>
            </button>
          ))}
        </div>

        {mSel && (
          <div>
            <div style={{ display:"flex",gap:8,marginBottom:12,flexWrap:"wrap" }}>
              <div style={{ background:"#0c2a2e",border:"1px solid #0e7490",borderRadius:8,padding:"8px 12px",flex:"1 1 auto" }}>
                <div style={{ fontSize:9,color:"#67e8f9" }}>Provento recebido</div>
                <div style={{ fontSize:15,fontWeight:800,color:"#22d3ee" }}>{fmt(mSel.provento)}</div>
                {aporte>0 && <div style={{ fontSize:9,color:"#475569" }}>+ {fmt(aporte)} aporte</div>}
              </div>
              <div style={{ background:"#1a1040",border:"1px solid #4338ca",borderRadius:8,padding:"8px 12px",flex:"1 1 auto" }}>
                <div style={{ fontSize:9,color:"#a5b4fc" }}>Patrimônio acumulado</div>
                <div style={{ fontSize:15,fontWeight:800,color:"#818cf8" }}>{fmtK(mSel.patrimonio)}</div>
                {mSel.caixa>0 && <div style={{ fontSize:9,color:"#475569" }}>Caixa: {fmt(mSel.caixa)}</div>}
              </div>
            </div>

            {/* Compras realizadas neste mês */}
            <div style={{ fontSize:10,color:"#64748b",marginBottom:6 }}>🛒 Cotas compradas com o reinvestimento:</div>
            {mSel.compras.length===0
              ? <div style={{ fontSize:11,color:"#475569",padding:"8px 0",textAlign:"center" }}>Saldo insuficiente para comprar cota inteira (acumulou {fmt(mSel.caixa)})</div>
              : mSel.compras.map(c=>(
                <div key={c.ticker} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",background:`${CORES[c.ticker]}0d`,border:`1px solid ${CORES[c.ticker]}33`,borderLeft:`3px solid ${CORES[c.ticker]}`,borderRadius:8,padding:"8px 12px",marginBottom:5 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                    <div style={{ width:8,height:8,borderRadius:2,background:CORES[c.ticker] }}/>
                    <div>
                      <span style={{ fontSize:12,fontWeight:700,color:"#e2e8f0" }}>{c.ticker}</span>
                      <div style={{ fontSize:10,color:"#475569" }}>+{c.cotas} cota{c.cotas>1?"s":""}</div>
                    </div>
                  </div>
                  <div style={{ fontSize:12,fontWeight:700,color:CORES[c.ticker] }}>{fmt(c.gasto)}</div>
                </div>
              ))
            }

            {/* Detalhes do provento por ativo */}
            {mSel.detalhes.length>0 && (
              <div style={{ marginTop:10 }}>
                <div style={{ fontSize:10,color:"#64748b",marginBottom:6 }}>💵 De onde veio o provento deste mês:</div>
                <div style={{ display:"flex",flexWrap:"wrap",gap:5 }}>
                  {mSel.detalhes.slice(0,12).map(d=>(
                    <div key={d.ticker} style={{ background:"#0f0f1a",border:`1px solid ${CORES[d.ticker]}33`,borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",gap:5 }}>
                      <div style={{ width:6,height:6,borderRadius:1,background:CORES[d.ticker] }}/>
                      <span style={{ fontSize:9,color:"#94a3b8" }}>{d.ticker}</span>
                      <span style={{ fontSize:9,fontWeight:700,color:CORES[d.ticker] }}>{fmt(d.val)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ background:"#0f172a",border:"1px dashed #334155",borderRadius:10,padding:"10px 12px" }}>
        <div style={{ fontSize:10,color:"#475569",lineHeight:1.7 }}>
          🤖 <strong style={{ color:"#64748b" }}>Como funciona:</strong> Cada mês recebe os proventos das cotas que você já tem (incluindo as compradas em meses anteriores — efeito bola de neve). Esse valor + aporte extra compra novas cotas inteiras ao preço configurado. A sobra acumula. Por isso o provento mensal cresce mês a mês. Cotações e proventos/cota mantidos constantes (conservador). Sem IR/taxas.
        </div>
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [filtro, setFiltro] = useState("TUDO");
  const [mesSel, setMesSel] = useState(0);
  const [aba,    setAba]    = useState("grafico");

  const ativos    = filtro==="TUDO"?ATIVOS:filtro==="FII"?FIIS:ACOES;
  const chartData = useMemo(()=>buildChart(filtro),[filtro]);
  const totalAnual = chartData.reduce((s,d)=>s+d._total,0);
  const mediaMes   = totalAnual/12;
  const maxMes     = Math.max(...chartData.map(d=>d._total));
  const minMes     = Math.min(...chartData.filter(d=>d._total>0).map(d=>d._total));
  const totFII  = useMemo(()=>buildChart("FII").reduce((s,d)=>s+d._total,0),[]);
  const totAcao = useMemo(()=>buildChart("Ação").reduce((s,d)=>s+d._total,0),[]);

  const FILTROS = [
    {id:"TUDO",emoji:"📊",label:"Panorama", sub:"Ações + FIIs",cor:"#a5b4fc"},
    {id:"FII", emoji:"🏢",label:"Só FIIs",  sub:"13 fundos",   cor:"#22d3ee"},
    {id:"Ação",emoji:"📈",label:"Só Ações", sub:"13 ações",    cor:"#818cf8"},
  ];
  const ABAS = [
    {id:"grafico", label:"📈 Gráfico"},
    {id:"ranking", label:"🏆 Ranking"},
    {id:"cenario", label:"🤖 Cenário Futuro"},
  ];

  return (
    <div style={{ background:"#0a0a14",minHeight:"100vh",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif",paddingBottom:48 }}>
      <div style={{ background:"linear-gradient(135deg,#1a1040 0%,#0a0a14 100%)",padding:"20px 16px 16px",borderBottom:"1px solid #1e293b" }}>
        <div style={{ fontSize:10,color:"#6366f1",letterSpacing:2,textTransform:"uppercase",marginBottom:4 }}>💰 Projeção de Proventos</div>
        <div style={{ fontSize:26,fontWeight:800,color:"#f1f5f9",letterSpacing:-1 }}>{fmt(totalAnual)}<span style={{ fontSize:12,color:"#475569",fontWeight:400,marginLeft:8 }}>/ ano base</span></div>
        <div style={{ display:"flex",gap:8,marginTop:10,flexWrap:"wrap" }}>
          {[
            {l:"Média/mês",v:fmt(mediaMes),c:"#a5b4fc"},
            {l:"Maior mês",v:fmt(maxMes),  c:"#34d399"},
            {l:"Menor mês",v:fmt(minMes),  c:"#f87171"},
            {l:"FIIs/ano", v:fmt(totFII),  c:"#22d3ee"},
            {l:"Ações/ano",v:fmt(totAcao), c:"#818cf8"},
          ].map(x=>(
            <div key={x.l} style={{ background:"#131325",border:"1px solid #1e293b",borderRadius:8,padding:"5px 10px" }}>
              <div style={{ fontSize:9,color:"#475569" }}>{x.l}</div>
              <div style={{ fontSize:11,fontWeight:700,color:x.c }}>{x.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding:"14px" }}>
        {aba!=="cenario" && (
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:10,color:"#334155",textTransform:"uppercase",letterSpacing:1,marginBottom:8 }}>Modo de visualização</div>
            <div style={{ display:"flex",gap:8 }}>
              {FILTROS.map(f=>{
                const sel=filtro===f.id;
                return (
                  <button key={f.id} onClick={()=>{setFiltro(f.id);setMesSel(0);}} style={{ flex:"1 1 0",padding:"8px 4px",borderRadius:12,border:`2px solid ${sel?f.cor:"#1e293b"}`,background:sel?`${f.cor}14`:"#131325",cursor:"pointer",textAlign:"center",transition:"all 0.2s" }}>
                    <div style={{ fontSize:16,marginBottom:2 }}>{f.emoji}</div>
                    <div style={{ fontSize:11,fontWeight:700,color:sel?f.cor:"#64748b" }}>{f.label}</div>
                    <div style={{ fontSize:9,color:"#475569" }}>{f.sub}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display:"flex",gap:4,marginBottom:12 }}>
          {ABAS.map(a=>(
            <button key={a.id} onClick={()=>setAba(a.id)} style={{ padding:"7px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,whiteSpace:"nowrap",background:aba===a.id?(a.id==="cenario"?"#059669":"#6366f1"):"#131325",color:aba===a.id?"#fff":"#64748b" }}>{a.label}</button>
          ))}
        </div>

        {aba==="grafico" && (
          <>
            <div style={{ background:"#131325",border:"1px solid #1e293b",borderRadius:14,padding:"14px 6px 8px",marginBottom:14 }}>
              <div style={{ paddingLeft:8,marginBottom:6,fontSize:10,color:"#334155",textTransform:"uppercase",letterSpacing:1 }}>
                {filtro==="TUDO"?"Todos os ativos — cada cor = um ativo":filtro==="FII"?"FIIs — tons de ciano":"Ações — tons de roxo"}
              </div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={chartData} margin={{ top:4,right:6,left:0,bottom:0 }} onClick={({activeTooltipIndex})=>{ if(activeTooltipIndex!=null)setMesSel(activeTooltipIndex); }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false}/>
                  <XAxis dataKey="mes" tick={{ fontSize:9,fill:"#475569" }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fontSize:9,fill:"#475569" }} axisLine={false} tickLine={false} tickFormatter={v=>v===0?"":v>=1000?`${(v/1000).toFixed(1)}k`:`${v}`} width={32}/>
                  <Tooltip content={<TipBar />}/>
                  {ativos.map((a,ai)=>(
                    <Bar key={a.ticker} dataKey={a.ticker} stackId="s" fill={CORES[a.ticker]} radius={ai===ativos.length-1?[4,4,0,0]:[0,0,0,0]}>
                      {chartData.map((_,ci)=><Cell key={ci} fill={CORES[a.ticker]} opacity={ci===mesSel?1:0.72} stroke={ci===mesSel?"#fff":"none"} strokeWidth={ci===mesSel?0.5:0}/>)}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <Legenda ativos={ativos}/>
              <div style={{ display:"flex",gap:2,marginTop:8,paddingLeft:4,paddingRight:4,overflowX:"auto" }}>
                {chartData.map((d,i)=>{
                  const pct=maxMes>0?d._total/maxMes:0; const sel=i===mesSel;
                  return (
                    <div key={i} onClick={()=>setMesSel(i)} style={{ flex:"0 0 auto",minWidth:40,textAlign:"center",cursor:"pointer",background:sel?"#1a1040":"#0f0f1a",border:`1px solid ${sel?"#6366f1":"#1e293b"}`,borderRadius:8,padding:"4px" }}>
                      <div style={{ fontSize:8,color:sel?"#a5b4fc":"#334155",marginBottom:2 }}>{d.mes.split("/")[0]}</div>
                      <div style={{ width:22,height:22,margin:"0 auto 2px",display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
                        <div style={{ width:14,height:`${Math.max(pct*22,2)}px`,background:sel?"linear-gradient(to top,#6366f1,#a5b4fc)":"#334155",borderRadius:"2px 2px 0 0" }}/>
                      </div>
                      <div style={{ fontSize:9,fontWeight:700,color:sel?"#f1f5f9":"#475569" }}>{d._total>=1000?`${(d._total/1000).toFixed(1)}k`:d._total>0?`${Math.round(d._total)}`:"—"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ background:"#131325",border:"1px solid #1e293b",borderRadius:14,padding:"14px" }}>
              <div style={{ fontSize:10,color:"#334155",textTransform:"uppercase",letterSpacing:1,marginBottom:10 }}>Detalhes do mês · toque em uma barra</div>
              <DetalheMes idx={mesSel} filtro={filtro}/>
            </div>
          </>
        )}

        {aba==="ranking" && (
          <div style={{ background:"#131325",border:"1px solid #1e293b",borderRadius:14,padding:"14px" }}>
            <Ranking ativos={ativos}/>
          </div>
        )}

        {aba==="cenario" && <CenarioFuturo/>}

        {aba!=="cenario" && (
          <div style={{ background:"#0f172a",border:"1px dashed #334155",borderRadius:10,padding:"10px 12px",marginTop:14 }}>
            <div style={{ fontSize:10,color:"#475569",lineHeight:1.7 }}>📌 FIIs pagam mensalmente. Ações seguem calendário histórico. Valores brutos — JCP têm IR 15%; FIIs isentos para PF.</div>
          </div>
        )}
      </div>
    </div>
  );
}
