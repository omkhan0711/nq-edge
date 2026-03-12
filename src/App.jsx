import { useState, useEffect, useMemo, useRef, useCallback } from "react";

const fmt$ = v => { const a = Math.abs(v); return (v < 0 ? "-$" : "$") + a.toFixed(2); };
const SESSIONS = ["London","New York","London/NY Overlap","Asian","Pre-Market"];
const SETUPS   = ["IFVG Long","IFVG Short","FVG Long","FVG Short","OB Long","OB Short","BPR Long","BPR Short","Liquidity Sweep","MSS","Other"];
const OUTCOMES = ["Win","Loss","Breakeven"];
const BIASES   = ["Bullish","Bearish","Neutral"];
const EMOTIONS = ["Calm","Anxious","Confident","Revenge","FOMO","Disciplined","Tired"];
const PROP_FIRMS = ["FTMO","Funded Trading Plus","The Funded Trader","MyForexFunds","E8 Funding","True Forex Funds","Apex Trader Funding","TopStep","Other"];
const EMPTY = { date: new Date().toISOString().split("T")[0], time:"", session:"New York", setup:"IFVG Long", bias:"Bullish", entry:"", exit:"", stopLoss:"", takeProfit:"", contracts:"1", outcome:"Win", pnl:"", rr:"", notes:"", emotion:"Calm", followedPlan:true, screenshot:"", aiReview:"", accountId:"" };
const EMPTY_ACCOUNT = { id:"", name:"", firm:"FTMO", size:"100000", maxDailyDrawdown:"5", maxTotalDrawdown:"10", profitTarget:"10", phase:"Funded", notes:"" };

function useStorage(key, fallback) {
  const [val, setVal] = useState(() => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }, [key, val]);
  return [val, setVal];
}

async function callClaude(messages, systemPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: systemPrompt, messages })
  });
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("") || "";
}

const SEL = "width:100%;background:#0d1520;border:1px solid #2a3a50;color:#cdd6e0;padding:8px 10px;border-radius:3px;font-size:12px;font-family:inherit;cursor:pointer;appearance:none;-webkit-appearance:none;outline:none;";

function Select({ value, onChange, options, style }) {
  return (
    <div style={{ position: "relative" }}>
      <select value={value} onChange={onChange} style={{ ...Object.fromEntries(SEL.split(";").filter(Boolean).map(s => { const [k,...v]=s.trim().split(":"); return [k.trim().replace(/-([a-z])/g,(_,c)=>c.toUpperCase()), v.join(":").trim()]; })), ...style }}>
        {options.map(o => typeof o === "string" ? <option key={o} value={o} style={{ background: "#0d1520", color: "#cdd6e0" }}>{o}</option> : <option key={o.value} value={o.value} style={{ background: "#0d1520", color: "#cdd6e0" }}>{o.label}</option>)}
      </select>
      <div style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", pointerEvents:"none", color:"#5a6a7a", fontSize:10 }}>▼</div>
    </div>
  );
}

export default function App() {
  const [trades, setTrades] = useStorage("nq_trades_v3", []);
  const [accounts, setAccounts] = useStorage("nq_accounts_v1", []);
  const [view, setView] = useState("dashboard");
  const [showForm, setShowForm] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [editAccountIdx, setEditAccountIdx] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT);
  const [filterSetup, setFilterSetup] = useState("All");
  const [filterOutcome, setFilterOutcome] = useState("All");
  const [filterAccount, setFilterAccount] = useState("All");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReviewLoading, setAiReviewLoading] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [toast, setToast] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const fileRef = useRef();
  const csvRef = useRef();

  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const saf = (k, v) => setAccountForm(f => ({ ...f, [k]: v }));

  const accountOptions = [{ value: "", label: "— Select Account —" }, ...accounts.map(a => ({ value: a.id, label: `${a.name} (${a.firm})` }))];

  // Stats for all trades or filtered by account
  const computeStats = useCallback((tradeList) => {
    if (!tradeList.length) return null;
    const wins = tradeList.filter(t => t.outcome === "Win");
    const losses = tradeList.filter(t => t.outcome === "Loss");
    const nonBE = tradeList.filter(t => t.outcome !== "Breakeven");
    const totalPnl = tradeList.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
    const winRate = nonBE.length ? (wins.length / nonBE.length) * 100 : 0;
    const avgWin = wins.length ? wins.reduce((s,t)=>s+(parseFloat(t.pnl)||0),0)/wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((s,t)=>s+(parseFloat(t.pnl)||0),0)/losses.length : 0;
    const totalWinPnl = wins.reduce((s,t)=>s+(parseFloat(t.pnl)||0),0);
    const totalLossPnl = Math.abs(losses.reduce((s,t)=>s+(parseFloat(t.pnl)||0),0));
    const profitFactor = totalLossPnl ? totalWinPnl/totalLossPnl : wins.length ? 999 : 0;
    const avgRR = tradeList.filter(t=>t.rr).reduce((s,t)=>s+(parseFloat(t.rr)||0),0)/(tradeList.filter(t=>t.rr).length||1);
    const sorted = [...tradeList].sort((a,b)=>new Date(a.date)-new Date(b.date));
    let cum=0, peak=0, maxDD=0;
    const equity = sorted.map(t=>{ cum+=parseFloat(t.pnl)||0; if(cum>peak)peak=cum; const dd=peak-cum; if(dd>maxDD)maxDD=dd; return{date:t.date,value:cum}; });
    const setupMap = {};
    tradeList.forEach(t=>{ if(!setupMap[t.setup])setupMap[t.setup]={wins:0,losses:0,pnl:0,count:0}; setupMap[t.setup].count++; setupMap[t.setup].pnl+=parseFloat(t.pnl)||0; if(t.outcome==="Win")setupMap[t.setup].wins++; if(t.outcome==="Loss")setupMap[t.setup].losses++; });
    const dayMap = {};
    tradeList.forEach(t=>{ if(!dayMap[t.date])dayMap[t.date]=0; dayMap[t.date]+=parseFloat(t.pnl)||0; });
    const followedPlanRate = tradeList.filter(t=>t.followedPlan).length/tradeList.length*100;
    const revSorted = [...sorted].reverse();
    let streak = 0;
    for(let i=0;i<revSorted.length;i++){
      const t=revSorted[i];
      if(i===0){streak=t.outcome==="Win"?1:t.outcome==="Loss"?-1:0;}
      else{ if(t.outcome==="Win"&&streak>0)streak++; else if(t.outcome==="Loss"&&streak<0)streak--; else break; }
    }
    return { wins:wins.length, losses:losses.length, total:tradeList.length, totalPnl, winRate, avgWin, avgLoss, profitFactor, avgRR, equity, setupMap, maxDD, followedPlanRate, dayMap, streak };
  }, []);

  const stats = useMemo(() => computeStats(trades), [trades, computeStats]);

  const accountStats = useMemo(() => {
    return accounts.map(acc => {
      const accTrades = trades.filter(t => t.accountId === acc.id);
      const s = computeStats(accTrades);
      const size = parseFloat(acc.size) || 100000;
      const maxDD = parseFloat(acc.maxTotalDrawdown) || 10;
      const dailyDD = parseFloat(acc.maxDailyDrawdown) || 5;
      const target = parseFloat(acc.profitTarget) || 10;
      const pnl = s?.totalPnl || 0;
      const ddUsed = s?.maxDD || 0;
      const ddPct = (ddUsed / size) * 100;
      const targetPct = (pnl / size) * 100;
      return { ...acc, stats: s, pnl, ddPct, targetPct, ddLimit: maxDD, dailyDD, targetGoal: target, size, tradeCount: accTrades.length };
    });
  }, [accounts, trades, computeStats]);

  const equityPath = useMemo(() => {
    const src = selectedAccount ? (accountStats.find(a=>a.id===selectedAccount)?.stats?.equity||[]) : (stats?.equity||[]);
    if (!src.length) return "";
    const vals = src.map(p=>p.value);
    const minV=Math.min(0,...vals), maxV=Math.max(0,...vals), range=maxV-minV||1;
    return src.map((p,i)=>{ const x=(i/(src.length-1||1))*400; const y=80-((p.value-minV)/range)*80; return `${i===0?"M":"L"}${x},${y}`; }).join(" ");
  }, [stats, accountStats, selectedAccount]);

  const filteredTrades = useMemo(() => trades.filter(t =>
    (filterSetup==="All"||t.setup===filterSetup) &&
    (filterOutcome==="All"||t.outcome===filterOutcome) &&
    (filterAccount==="All"||t.accountId===filterAccount)
  ).sort((a,b)=>new Date(b.date)-new Date(a.date)), [trades, filterSetup, filterOutcome, filterAccount]);

  const handleScreenshot = useCallback(async (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const b64 = e.target.result.split(",")[1];
      setScreenshotPreview(e.target.result);
      setForm(f=>({...f, screenshot: e.target.result}));
      setAiLoading(true);
      try {
        const raw = await callClaude([{ role:"user", content:[
          { type:"image", source:{ type:"base64", media_type: file.type||"image/png", data:b64 }},
          { type:"text", text:`Analyze this NQ futures trading chart. Return ONLY valid JSON:\n{"entry":number|null,"stopLoss":number|null,"takeProfit":number|null,"exit":number|null,"bias":"Bullish"|"Bearish"|"Neutral"|null,"setup":"IFVG Long"|"IFVG Short"|"FVG Long"|"FVG Short"|"OB Long"|"OB Short"|"BPR Long"|"BPR Short"|"Liquidity Sweep"|"MSS"|"Other"|null,"session":"London"|"New York"|"London/NY Overlap"|"Asian"|"Pre-Market"|null,"pnl":number|null,"rr":number|null,"notes":string|null}` }
        ]}], "You are an expert NQ futures ICT analyst. Extract trade data from chart screenshots. Return only valid JSON, no markdown.");
        const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
        setForm(f=>({...f,
          ...(parsed.entry&&{entry:String(parsed.entry)}),
          ...(parsed.stopLoss&&{stopLoss:String(parsed.stopLoss)}),
          ...(parsed.takeProfit&&{takeProfit:String(parsed.takeProfit)}),
          ...(parsed.exit&&{exit:String(parsed.exit)}),
          ...(parsed.bias&&BIASES.includes(parsed.bias)&&{bias:parsed.bias}),
          ...(parsed.setup&&SETUPS.includes(parsed.setup)&&{setup:parsed.setup}),
          ...(parsed.session&&SESSIONS.includes(parsed.session)&&{session:parsed.session}),
          ...(parsed.pnl!=null&&{pnl:String(parsed.pnl)}),
          ...(parsed.rr&&{rr:String(parsed.rr)}),
          ...(parsed.notes&&{notes:parsed.notes}),
        }));
        showToast("✓ AI extracted trade levels from chart");
      } catch { showToast("Could not parse chart — fill in manually","error"); }
      setAiLoading(false);
    };
    reader.readAsDataURL(file);
  }, []);

  const runAiReview = async (trade) => {
    setAiReviewLoading(true);
    const acc = accounts.find(a=>a.id===trade.accountId);
    try {
      const review = await callClaude([{ role:"user", content:`Review this NQ futures trade:\nDate: ${trade.date} ${trade.time} | Session: ${trade.session}${acc?` | Account: ${acc.name} (${acc.firm} $${acc.size})`:""}
Setup: ${trade.setup} | Bias: ${trade.bias}\nEntry: ${trade.entry} | SL: ${trade.stopLoss} | TP: ${trade.takeProfit} | Exit: ${trade.exit}\nP&L: $${trade.pnl} | R:R: ${trade.rr}R | Outcome: ${trade.outcome}\nFollowed Plan: ${trade.followedPlan} | Emotion: ${trade.emotion}\nNotes: ${trade.notes}\n\nProvide concise review: (1) Setup quality (2) Execution (3) Risk management (4) What was done well (5) What to improve. Under 200 words.` }],
        "You are an elite NQ futures trading coach specialising in ICT concepts. Give specific, actionable feedback.");
      const idx = trades.indexOf(trade);
      if (idx!==-1) setTrades(prev=>prev.map((t,i)=>i===idx?{...t,aiReview:review}:t));
      showToast("✓ AI review complete");
    } catch { showToast("Review failed","error"); }
    setAiReviewLoading(false);
  };

  const exportCSV = () => {
    const headers = ["date","time","session","setup","bias","entry","exit","stopLoss","takeProfit","contracts","outcome","pnl","rr","emotion","followedPlan","notes","accountId"];
    const rows = trades.map(t=>headers.map(h=>`"${(t[h]??"").toString().replace(/"/g,'""')}"`).join(","));
    const csv = [headers.join(","),...rows].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download=`omar_journal_${new Date().toISOString().split("T")[0]}.csv`; a.click();
    showToast("✓ CSV exported");
  };

  const importCSV = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const lines = e.target.result.trim().split("\n");
        const headers = lines[0].split(",").map(h=>h.replace(/"/g,"").trim());
        const imported = lines.slice(1).map(line=>{ const vals=line.match(/(".*?"|[^,]+)(?=,|$)/g)||[]; const obj={...EMPTY}; headers.forEach((h,i)=>{ if(h in EMPTY)obj[h]=(vals[i]||"").replace(/^"|"$/g,"").trim(); }); obj.followedPlan=obj.followedPlan==="true"; obj.id=Date.now()+Math.random(); return obj; }).filter(t=>t.date);
        setTrades(prev=>{ const dates=new Set(prev.map(t=>t.date+t.time+t.entry)); return [...prev,...imported.filter(t=>!dates.has(t.date+t.time+t.entry))]; });
        showToast(`✓ Imported ${imported.length} trades`);
      } catch { showToast("CSV parse error","error"); }
    };
    reader.readAsText(file);
  };

  const handleSubmit = () => {
    if (!form.date||!form.entry) return;
    if (editIdx!==null) { setTrades(prev=>prev.map((t,i)=>i===editIdx?{...form}:t)); setEditIdx(null); }
    else setTrades(prev=>[...prev,{...form,id:Date.now()}]);
    setForm(EMPTY); setScreenshotPreview(null); setShowForm(false);
    showToast("✓ Trade logged");
  };

  const handleAccountSubmit = () => {
    if (!accountForm.name) return;
    const acc = { ...accountForm, id: accountForm.id || String(Date.now()) };
    if (editAccountIdx!==null) { setAccounts(prev=>prev.map((a,i)=>i===editAccountIdx?acc:a)); setEditAccountIdx(null); }
    else setAccounts(prev=>[...prev,acc]);
    setAccountForm(EMPTY_ACCOUNT); setShowAccountForm(false);
    showToast("✓ Account saved");
  };

  const openEdit = (idx) => { setEditIdx(idx); setForm(trades[idx]); setScreenshotPreview(trades[idx].screenshot||null); setShowForm(true); };
  const deleteTrade = (idx) => { setTrades(prev=>prev.filter((_,i)=>i!==idx)); showToast("Trade deleted","warn"); };
  const openEditAccount = (idx) => { setEditAccountIdx(idx); setAccountForm(accounts[idx]); setShowAccountForm(true); };
  const deleteAccount = (idx) => { setAccounts(prev=>prev.filter((_,i)=>i!==idx)); showToast("Account removed","warn"); };

  const calDays = useMemo(() => { const {y,m}=calMonth; return { first:new Date(y,m,1).getDay(), total:new Date(y,m+1,0).getDate() }; }, [calMonth]);
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const inp = { width:"100%", background:"#0d1520", border:"1px solid #2a3a50", borderRadius:3, padding:"8px 10px", color:"#cdd6e0", fontSize:12, fontFamily:"inherit", outline:"none", boxSizing:"border-box" };
  const lbl = { display:"block", color:"#4a6a8a", fontSize:9, marginBottom:5, letterSpacing:"0.15em", textTransform:"uppercase" };

  const activeStats = selectedAccount ? accountStats.find(a=>a.id===selectedAccount)?.stats : stats;

  return (
    <div style={{ fontFamily:"'IBM Plex Mono','Courier New',monospace", background:"#060a0f", minHeight:"100vh", color:"#cdd6e0", width:"100%" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=Orbitron:wght@700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body,#root{width:100%;min-height:100vh;background:#060a0f}
        ::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#060a0f}::-webkit-scrollbar-thumb{background:#1e2a38}
        .card{background:#0a0f18;border:1px solid #1a2535;border-radius:4px;padding:16px;transition:border-color 0.2s}
        .card:hover{border-color:#2a3a50}
        .np{padding:7px 14px;border-radius:2px;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;transition:all 0.15s;cursor:pointer;border:none;font-family:inherit}
        .gold{background:#f0b429;color:#060a0f;font-weight:500}.gold:hover{background:#f7c948}
        .dim{background:transparent;color:#4a6a8a;border:1px solid #1a2535}.dim:hover{color:#cdd6e0;border-color:#2a3a50}
        .win{color:#4ade80}.loss{color:#f87171}.be{color:#4a6a8a}
        .tag{padding:2px 7px;border-radius:2px;font-size:10px;letter-spacing:0.08em}
        .it{background:#0d1a2a;color:#60a5fa;border:1px solid #1a3050}
        .overlay{position:fixed;inset:0;background:rgba(6,10,15,0.93);backdrop-filter:blur(8px);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto}
        .modal{background:#0a0f18;border:1px solid #2a3a50;border-radius:6px;width:100%;max-width:740px;padding:28px;margin:auto}
        .dz{border:1px dashed #2a3a50;border-radius:4px;padding:24px;text-align:center;cursor:pointer;transition:all 0.2s;background:#060a0f}
        .dz:hover{border-color:#f0b429;background:#0a0f18}
        .toast{position:fixed;bottom:24px;right:24px;padding:10px 18px;border-radius:3px;font-size:11px;letter-spacing:0.08em;z-index:999;animation:si 0.2s ease}
        @keyframes si{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
        .hd{font-family:'Orbitron',monospace;font-weight:900;font-size:17px;letter-spacing:0.12em;color:#f0b429}
        .shd{font-family:'Orbitron',monospace;font-weight:900;font-size:14px;letter-spacing:0.12em;color:#f0b429}
        .pulse{animation:p 1.5s infinite}@keyframes p{0%,100%{opacity:1}50%{opacity:0.4}}
        input:focus,textarea:focus{border-color:#f0b429!important;outline:none}
        .acc-card{background:#0a0f18;border:1px solid #1a2535;border-radius:6px;padding:18px;transition:all 0.2s;cursor:pointer}
        .acc-card:hover{border-color:#2a3a50}
        .acc-card.selected{border-color:#f0b429;background:#0d1520}
        .nav-active{background:#0d1520;color:#f0b429;border:1px solid #2a3a50}
        .nav-inactive{background:transparent;color:#4a6a8a;border:1px solid transparent}
        .meter-bg{background:#1a2535;border-radius:2px;height:5px;overflow:hidden}
        .review-box{background:#060a0f;border:1px solid #1a2535;border-radius:3px;padding:12px;font-size:11px;line-height:1.7;color:#7a9ab8;white-space:pre-wrap;margin-top:10px}
      `}</style>

      {toast && <div className="toast" style={{ background:toast.type==="error"?"#1a0808":toast.type==="warn"?"#1a1208":"#081a0e", border:`1px solid ${toast.type==="error"?"#5a1a1a":toast.type==="warn"?"#5a4a0a":"#1a5a2a"}`, color:toast.type==="error"?"#f87171":toast.type==="warn"?"#f0b429":"#4ade80" }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ borderBottom:"1px solid #1a2535", padding:"0 24px", background:"#060a0f", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ maxWidth:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", height:52 }}>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div className="hd">Omar's<span style={{ color:"#cdd6e0" }}> Journal</span></div>
            <div style={{ fontSize:9, color:"#2a3a50", letterSpacing:"0.2em", borderLeft:"1px solid #1a2535", paddingLeft:12 }}>NQ · ICT · IFVG</div>
          </div>
          <div style={{ display:"flex", gap:2 }}>
            {["dashboard","accounts","journal","analytics","calendar"].map(v=>(
              <button key={v} className={`np ${view===v?"nav-active":"nav-inactive"}`} onClick={()=>setView(v)}>{v}</button>
            ))}
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button className="np dim" onClick={exportCSV}>↓ CSV</button>
            <label className="np dim" style={{ cursor:"pointer" }}>↑ CSV<input ref={csvRef} type="file" accept=".csv" style={{ display:"none" }} onChange={e=>e.target.files[0]&&importCSV(e.target.files[0])} /></label>
            <button className="np" style={{ background:"#1a2535", color:"#cdd6e0", border:"1px solid #2a3a50" }} onClick={()=>{setEditAccountIdx(null);setAccountForm(EMPTY_ACCOUNT);setShowAccountForm(true);}}>+ ACCOUNT</button>
            <button className="np gold" onClick={()=>{setEditIdx(null);setForm(EMPTY);setScreenshotPreview(null);setShowForm(true);}}>+ LOG TRADE</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:"100%", padding:"20px 24px" }}>

        {/* DASHBOARD */}
        {view==="dashboard" && (
          <div>
            <div style={{ marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
              <div>
                <div className="hd" style={{ fontSize:20 }}>PERFORMANCE</div>
                <div style={{ color:"#3a5a7a", fontSize:11, marginTop:4 }}>{trades.length} trades across {accounts.length} accounts</div>
              </div>
              {accounts.length > 0 && (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  <button className={`np ${!selectedAccount?"gold":"dim"}`} onClick={()=>setSelectedAccount(null)} style={{ fontSize:9 }}>ALL ACCOUNTS</button>
                  {accounts.map(a=>(
                    <button key={a.id} className={`np ${selectedAccount===a.id?"gold":"dim"}`} onClick={()=>setSelectedAccount(selectedAccount===a.id?null:a.id)} style={{ fontSize:9 }}>{a.name}</button>
                  ))}
                </div>
              )}
            </div>

            {!trades.length ? (
              <div style={{ textAlign:"center", padding:"80px 0" }}>
                <div className="hd" style={{ fontSize:40, color:"#1a2535", marginBottom:16 }}>0</div>
                <div style={{ color:"#4a6a8a", marginBottom:8 }}>No trades logged yet</div>
                <button className="np gold" style={{ padding:"10px 24px" }} onClick={()=>setShowForm(true)}>LOG FIRST TRADE</button>
              </div>
            ) : (
              <>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(8,1fr)", gap:10, marginBottom:12 }}>
                  {[
                    { l:"TOTAL P&L", v:fmt$(activeStats?.totalPnl||0), c:(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171" },
                    { l:"WIN RATE", v:`${(activeStats?.winRate||0).toFixed(1)}%`, c:(activeStats?.winRate||0)>=50?"#4ade80":"#f87171" },
                    { l:"PROFIT FACTOR", v:(activeStats?.profitFactor||0)===999?"∞":(activeStats?.profitFactor||0).toFixed(2), c:(activeStats?.profitFactor||0)>=1.5?"#4ade80":"#f87171" },
                    { l:"AVG R:R", v:`${(activeStats?.avgRR||0).toFixed(2)}R`, c:(activeStats?.avgRR||0)>=1.5?"#4ade80":"#4a6a8a" },
                    { l:"TRADES", v:activeStats?.total||0, c:"#cdd6e0" },
                    { l:"MAX DRAWDOWN", v:fmt$(activeStats?.maxDD||0), c:"#f87171" },
                    { l:"PLAN %", v:`${(activeStats?.followedPlanRate||0).toFixed(0)}%`, c:(activeStats?.followedPlanRate||0)>=70?"#4ade80":"#f0b429" },
                    { l:"STREAK", v:(activeStats?.streak||0)>0?`+${activeStats.streak}W`:(activeStats?.streak||0)<0?`${Math.abs(activeStats.streak)}L`:"—", c:(activeStats?.streak||0)>0?"#4ade80":(activeStats?.streak||0)<0?"#f87171":"#4a6a8a" },
                  ].map(s=>(
                    <div key={s.l} className="card" style={{ padding:14 }}>
                      <div style={{ fontSize:8, color:"#2a3a50", letterSpacing:"0.15em", marginBottom:6 }}>{s.l}</div>
                      <div style={{ fontFamily:"'Orbitron'", fontSize:18, fontWeight:900, color:s.c }}>{s.v}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:12, marginBottom:12 }}>
                  <div className="card">
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                      <div style={{ fontSize:9, color:"#3a5a7a", letterSpacing:"0.15em" }}>EQUITY CURVE</div>
                      <div style={{ fontFamily:"'Orbitron'", fontSize:16, fontWeight:900, color:(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171" }}>{fmt$(activeStats?.totalPnl||0)}</div>
                    </div>
                    <svg width="100%" viewBox="0 0 400 80" preserveAspectRatio="none" style={{ height:70, display:"block" }}>
                      <defs><linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"} stopOpacity="0.2"/><stop offset="100%" stopColor={(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"} stopOpacity="0"/></linearGradient></defs>
                      {equityPath&&<><path d={equityPath+" L400,80 L0,80 Z"} fill="url(#eqg)"/><path d={equityPath} fill="none" stroke={(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"} strokeWidth="1.5"/></>}
                    </svg>
                  </div>
                  <div className="card">
                    <div style={{ fontSize:9, color:"#3a5a7a", letterSpacing:"0.15em", marginBottom:12 }}>ACCOUNTS OVERVIEW</div>
                    {!accounts.length ? <div style={{ color:"#3a5a7a", fontSize:11 }}>No accounts added yet</div> : accountStats.map(a=>(
                      <div key={a.id} style={{ marginBottom:14, paddingBottom:14, borderBottom:"1px solid #0d1520" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                          <div>
                            <div style={{ fontSize:11, color:"#cdd6e0" }}>{a.name}</div>
                            <div style={{ fontSize:9, color:"#3a5a7a" }}>{a.firm} · {a.phase}</div>
                          </div>
                          <div style={{ fontFamily:"'Orbitron'", fontSize:13, fontWeight:900, color:a.pnl>=0?"#4ade80":"#f87171" }}>{fmt$(a.pnl)}</div>
                        </div>
                        <div style={{ fontSize:9, color:"#3a5a7a", marginBottom:3 }}>DRAWDOWN {a.ddPct.toFixed(1)}% / {a.ddLimit}%</div>
                        <div className="meter-bg"><div style={{ width:`${Math.min(100,(a.ddPct/a.ddLimit)*100)}%`, height:"100%", background:a.ddPct/a.ddLimit>0.7?"#f87171":a.ddPct/a.ddLimit>0.4?"#f0b429":"#4ade80", borderRadius:2 }}/></div>
                        <div style={{ fontSize:9, color:"#3a5a7a", marginTop:6, marginBottom:3 }}>TARGET {a.targetPct.toFixed(1)}% / {a.targetGoal}%</div>
                        <div className="meter-bg"><div style={{ width:`${Math.min(100,(a.targetPct/a.targetGoal)*100)}%`, height:"100%", background:"#60a5fa", borderRadius:2 }}/></div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ACCOUNTS */}
        {view==="accounts" && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:20 }}>
              <div><div className="hd" style={{ fontSize:20 }}>ACCOUNTS</div><div style={{ color:"#3a5a7a", fontSize:11, marginTop:4 }}>{accounts.length} funded accounts</div></div>
              <button className="np" style={{ background:"#1a2535", color:"#cdd6e0", border:"1px solid #2a3a50" }} onClick={()=>{setEditAccountIdx(null);setAccountForm(EMPTY_ACCOUNT);setShowAccountForm(true);}}>+ ADD ACCOUNT</button>
            </div>
            {!accounts.length ? (
              <div style={{ textAlign:"center", padding:"60px 0" }}>
                <div style={{ color:"#4a6a8a", marginBottom:16, fontSize:13 }}>No accounts added yet</div>
                <button className="np gold" onClick={()=>{setShowAccountForm(true)}} style={{ padding:"10px 24px" }}>ADD YOUR FIRST ACCOUNT</button>
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))", gap:12 }}>
                {accountStats.map((a, i)=>{
                  const ddColor = a.ddPct/a.ddLimit>0.7?"#f87171":a.ddPct/a.ddLimit>0.4?"#f0b429":"#4ade80";
                  return (
                    <div key={a.id} className="card" style={{ padding:20 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                        <div>
                          <div style={{ fontFamily:"'Orbitron'", fontSize:14, fontWeight:900, color:"#cdd6e0", marginBottom:3 }}>{a.name}</div>
                          <div style={{ fontSize:10, color:"#4a6a8a" }}>{a.firm} · <span style={{ color:"#60a5fa" }}>{a.phase}</span> · ${parseInt(a.size).toLocaleString()}</div>
                        </div>
                        <div style={{ fontFamily:"'Orbitron'", fontSize:20, fontWeight:900, color:a.pnl>=0?"#4ade80":"#f87171" }}>{fmt$(a.pnl)}</div>
                      </div>

                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:14 }}>
                        {[["TRADES",a.tradeCount,"#cdd6e0"],["WIN RATE",a.stats?`${a.stats.winRate.toFixed(0)}%`:"—",a.stats?.winRate>=50?"#4ade80":"#f87171"],["AVG R:R",a.stats?`${a.stats.avgRR.toFixed(1)}R`:"—","#60a5fa"]].map(([l,v,c])=>(
                          <div key={l} style={{ background:"#060a0f", border:"1px solid #1a2535", borderRadius:3, padding:"8px 10px" }}>
                            <div style={{ fontSize:8, color:"#3a5a7a", letterSpacing:"0.12em", marginBottom:4 }}>{l}</div>
                            <div style={{ fontFamily:"'Orbitron'", fontSize:14, fontWeight:900, color:c }}>{v}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ marginBottom:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                          <span style={{ fontSize:9, color:"#4a6a8a", letterSpacing:"0.1em" }}>DRAWDOWN USED</span>
                          <span style={{ fontSize:9, color:ddColor }}>{a.ddPct.toFixed(2)}% / {a.ddLimit}% max</span>
                        </div>
                        <div className="meter-bg"><div style={{ width:`${Math.min(100,(a.ddPct/a.ddLimit)*100)}%`, height:"100%", background:ddColor, borderRadius:2, transition:"width 0.5s" }}/></div>
                      </div>
                      <div style={{ marginBottom:14 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                          <span style={{ fontSize:9, color:"#4a6a8a", letterSpacing:"0.1em" }}>PROFIT TARGET</span>
                          <span style={{ fontSize:9, color:"#60a5fa" }}>{a.targetPct.toFixed(2)}% / {a.targetGoal}% goal</span>
                        </div>
                        <div className="meter-bg"><div style={{ width:`${Math.min(100,(a.targetPct/a.targetGoal)*100)}%`, height:"100%", background:"#60a5fa", borderRadius:2, transition:"width 0.5s" }}/></div>
                      </div>

                      {a.notes && <div style={{ fontSize:10, color:"#3a5a7a", borderLeft:"2px solid #1a2535", paddingLeft:8, marginBottom:12, fontStyle:"italic" }}>{a.notes}</div>}

                      <div style={{ display:"flex", gap:8 }}>
                        <button onClick={()=>openEditAccount(i)} className="np dim" style={{ fontSize:9, padding:"5px 12px" }}>EDIT</button>
                        <button onClick={()=>deleteAccount(i)} className="np" style={{ fontSize:9, padding:"5px 12px", background:"transparent", color:"#f87171", border:"1px solid #2a1515" }}>REMOVE</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* JOURNAL */}
        {view==="journal" && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:20 }}>
              <div><div className="hd" style={{ fontSize:20 }}>JOURNAL</div><div style={{ color:"#3a5a7a", fontSize:11, marginTop:4 }}>{filteredTrades.length} entries</div></div>
              <div style={{ display:"flex", gap:8 }}>
                {[[filterSetup,setFilterSetup,["All",...SETUPS]],[filterOutcome,setFilterOutcome,["All",...OUTCOMES]],[filterAccount,setFilterAccount,["All",...accounts.map(a=>a.id)]]].map(([val,setter,opts],ki)=>(
                  <Select key={ki} value={val} onChange={e=>setter(e.target.value)}
                    options={ki===2 ? [{ value:"All", label:"All Accounts" }, ...accounts.map(a=>({ value:a.id, label:a.name }))] : opts}
                  />
                ))}
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {filteredTrades.map((t,i)=>{
                const oi=trades.indexOf(t); const pnl=parseFloat(t.pnl)||0;
                const acc=accounts.find(a=>a.id===t.accountId);
                return (
                  <div key={t.id||i} className="card" style={{ padding:"14px 18px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        <span style={{ fontSize:11, color:"#4a6a8a" }}>{t.date}{t.time&&<span style={{ color:"#60a5fa", marginLeft:6 }}>{t.time}</span>}</span>
                        <span className="tag it">{t.setup}</span>
                        <span style={{ fontSize:10, color:"#4a6a8a", background:"#0d1117", padding:"2px 7px", borderRadius:2 }}>{t.session}</span>
                        <span style={{ fontSize:10, color:t.bias==="Bullish"?"#4ade80":t.bias==="Bearish"?"#f87171":"#4a6a8a" }}>● {t.bias}</span>
                        {acc&&<span style={{ fontSize:9, color:"#f0b429", background:"#1a1400", border:"1px solid #3a2a00", padding:"2px 7px", borderRadius:2 }}>{acc.name}</span>}
                        {!t.followedPlan&&<span style={{ fontSize:9, color:"#f0b429", letterSpacing:"0.12em" }}>⚠ OFF-PLAN</span>}
                      </div>
                      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                        <div style={{ fontFamily:"'Orbitron'", fontSize:16, fontWeight:900, color:pnl>=0?"#4ade80":"#f87171" }}>{fmt$(pnl)}</div>
                        <button onClick={()=>openEdit(oi)} className="np dim" style={{ fontSize:9, padding:"4px 10px" }}>EDIT</button>
                        <button onClick={()=>deleteTrade(oi)} className="np" style={{ fontSize:9, padding:"4px 10px", background:"transparent", color:"#f87171", border:"1px solid #2a1515" }}>DEL</button>
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:16, marginTop:8, fontSize:11, flexWrap:"wrap" }}>
                      {[["Entry",t.entry,"#cdd6e0"],["Exit",t.exit,"#cdd6e0"],["SL",t.stopLoss,"#f87171"],["TP",t.takeProfit,"#4ade80"],["R:R",t.rr?t.rr+"R":"—","#4a6a8a"],["Contracts",t.contracts,"#4a6a8a"]].map(([l,v,c])=>(
                        <span key={l} style={{ color:"#3a5a7a" }}>{l}: <span style={{ color:c }}>{v||"—"}</span></span>
                      ))}
                    </div>
                    {t.notes&&<div style={{ marginTop:8, fontSize:11, color:"#4a6a8a", borderLeft:"2px solid #1a2535", paddingLeft:10, fontStyle:"italic" }}>{t.notes}</div>}
                    {t.screenshot&&<div style={{ marginTop:10 }}><img src={t.screenshot} alt="chart" style={{ maxHeight:180, borderRadius:3, border:"1px solid #1a2535", objectFit:"contain" }}/></div>}
                    <div style={{ marginTop:10 }}>
                      <button onClick={()=>runAiReview(t)} disabled={aiReviewLoading} className="np dim" style={{ fontSize:9, padding:"5px 12px" }}>{aiReviewLoading?"ANALYSING...":"🤖 AI REVIEW"}</button>
                    </div>
                    {t.aiReview&&<div className="review-box">{t.aiReview}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ANALYTICS */}
        {view==="analytics" && (
          <div>
            <div style={{ marginBottom:20 }}><div className="hd" style={{ fontSize:20 }}>ANALYTICS</div><div style={{ color:"#3a5a7a", fontSize:11, marginTop:4 }}>Deep performance breakdown</div></div>
            {!stats ? <div style={{ textAlign:"center", padding:"60px 0", color:"#4a6a8a" }}>Log trades to see analytics</div> : (
              <>
                <div className="card" style={{ marginBottom:12 }}>
                  <div style={{ fontSize:9, color:"#3a5a7a", letterSpacing:"0.15em", marginBottom:14 }}>SETUP PERFORMANCE</div>
                  {Object.entries(stats.setupMap).sort((a,b)=>b[1].pnl-a[1].pnl).map(([setup,d])=>{
                    const wr=(d.wins/(d.wins+d.losses||1))*100;
                    return (
                      <div key={setup} style={{ marginBottom:12 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                            <span className="tag it">{setup}</span>
                            <span style={{ fontSize:10, color:"#3a5a7a" }}>{d.count} trades · {wr.toFixed(0)}% WR</span>
                          </div>
                          <span style={{ fontFamily:"'Orbitron'", fontSize:13, fontWeight:900, color:d.pnl>=0?"#4ade80":"#f87171" }}>{fmt$(d.pnl)}</span>
                        </div>
                        <div className="meter-bg"><div style={{ width:`${wr}%`, height:"100%", background:wr>=50?"#4ade80":"#f87171", borderRadius:2, transition:"width 0.6s" }}/></div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <div className="card">
                    <div style={{ fontSize:9, color:"#3a5a7a", letterSpacing:"0.15em", marginBottom:12 }}>SESSION BREAKDOWN</div>
                    {Object.entries(trades.reduce((acc,t)=>{ if(!acc[t.session])acc[t.session]={pnl:0,count:0,wins:0}; acc[t.session].pnl+=parseFloat(t.pnl)||0; acc[t.session].count++; if(t.outcome==="Win")acc[t.session].wins++; return acc; },{})).sort((a,b)=>b[1].pnl-a[1].pnl).map(([sess,d])=>(
                      <div key={sess} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid #0d1117", fontSize:11 }}>
                        <span style={{ color:"#4a6a8a" }}>{sess}</span>
                        <div style={{ display:"flex", gap:14 }}>
                          <span style={{ color:"#3a5a7a" }}>{d.count}t</span>
                          <span style={{ fontFamily:"'Orbitron'", fontSize:12, fontWeight:900, color:d.pnl>=0?"#4ade80":"#f87171" }}>{fmt$(d.pnl)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="card">
                    <div style={{ fontSize:9, color:"#3a5a7a", letterSpacing:"0.15em", marginBottom:12 }}>KEY METRICS</div>
                    {[["Wins",stats.wins,"#4ade80"],["Losses",stats.losses,"#f87171"],["Avg Win",fmt$(stats.avgWin),"#4ade80"],["Avg Loss",fmt$(stats.avgLoss),"#f87171"],["Profit Factor",stats.profitFactor===999?"∞":stats.profitFactor.toFixed(2),stats.profitFactor>=1.5?"#4ade80":"#f87171"],["Max Drawdown",fmt$(stats.maxDD),"#f87171"],["Plan Adherence",`${stats.followedPlanRate.toFixed(0)}%`,stats.followedPlanRate>=70?"#4ade80":"#f0b429"]].map(([l,v,c])=>(
                      <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid #0d1117", fontSize:11 }}>
                        <span style={{ color:"#4a6a8a" }}>{l}</span>
                        <span style={{ fontFamily:"'Orbitron'", fontSize:13, fontWeight:900, color:c }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* CALENDAR */}
        {view==="calendar" && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:20 }}>
              <div><div className="hd" style={{ fontSize:20 }}>P&L CALENDAR</div><div style={{ color:"#3a5a7a", fontSize:11, marginTop:4 }}>Daily performance heatmap</div></div>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <button onClick={()=>setCalMonth(p=>{ const d=new Date(p.y,p.m-1); return{y:d.getFullYear(),m:d.getMonth()}; })} className="np dim" style={{ padding:"5px 12px" }}>‹</button>
                <span style={{ fontSize:12, color:"#cdd6e0", letterSpacing:"0.1em", minWidth:140, textAlign:"center" }}>{MONTHS[calMonth.m]} {calMonth.y}</span>
                <button onClick={()=>setCalMonth(p=>{ const d=new Date(p.y,p.m+1); return{y:d.getFullYear(),m:d.getMonth()}; })} className="np dim" style={{ padding:"5px 12px" }}>›</button>
              </div>
            </div>
            {stats&&(()=>{
              const mt=trades.filter(t=>{ const d=new Date(t.date); return d.getFullYear()===calMonth.y&&d.getMonth()===calMonth.m; });
              const mPnl=mt.reduce((s,t)=>s+(parseFloat(t.pnl)||0),0);
              const mWR=mt.filter(t=>t.outcome!=="Breakeven").length?(mt.filter(t=>t.outcome==="Win").length/mt.filter(t=>t.outcome!=="Breakeven").length*100):0;
              return <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 }}>
                {[["MONTH P&L",fmt$(mPnl),mPnl>=0?"#4ade80":"#f87171"],["MONTH TRADES",mt.length,"#cdd6e0"],["MONTH WIN RATE",`${mWR.toFixed(0)}%`,mWR>=50?"#4ade80":"#f87171"]].map(([l,v,c])=>(
                  <div key={l} className="card" style={{ padding:12 }}>
                    <div style={{ fontSize:8, color:"#3a5a7a", letterSpacing:"0.15em", marginBottom:6 }}>{l}</div>
                    <div style={{ fontFamily:"'Orbitron'", fontSize:18, fontWeight:900, color:c }}>{v}</div>
                  </div>
                ))}
              </div>;
            })()}
            <div className="card">
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:6 }}>
                {["SUN","MON","TUE","WED","THU","FRI","SAT"].map(d=><div key={d} style={{ textAlign:"center", fontSize:9, color:"#2a3a50", letterSpacing:"0.1em", padding:"4px 0" }}>{d}</div>)}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
                {Array.from({length:calDays.first}).map((_,i)=><div key={`e${i}`} style={{ aspectRatio:"1" }}/>)}
                {Array.from({length:calDays.total}).map((_,i)=>{
                  const day=i+1;
                  const ds=`${calMonth.y}-${String(calMonth.m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                  const dp=stats?.dayMap?.[ds];
                  const ht=dp!==undefined;
                  const today=new Date().toISOString().split("T")[0]===ds;
                  return <div key={day} style={{ aspectRatio:"1", padding:4, border:`1px solid ${today?"#f0b429":ht?(dp>=0?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)"):"#1a2535"}`, borderRadius:3, background:ht?(dp>=0?"rgba(74,222,128,0.06)":"rgba(248,113,113,0.06)"):"#0a0f18", minHeight:52 }}>
                    <div style={{ fontSize:9, color:today?"#f0b429":"#2a3a50", marginBottom:2 }}>{day}</div>
                    {ht&&<><div style={{ fontFamily:"'Orbitron'", fontSize:10, fontWeight:900, color:dp>=0?"#4ade80":"#f87171" }}>{fmt$(dp)}</div><div style={{ fontSize:8, color:"#3a5a7a" }}>{trades.filter(t=>t.date===ds).length}t</div></>}
                  </div>;
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ACCOUNT FORM MODAL */}
      {showAccountForm&&(
        <div className="overlay" onClick={e=>{ if(e.target===e.currentTarget){setShowAccountForm(false);setEditAccountIdx(null);} }}>
          <div className="modal">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
              <div className="shd">{editAccountIdx!==null?"EDIT ACCOUNT":"ADD ACCOUNT"}</div>
              <button onClick={()=>{setShowAccountForm(false);setEditAccountIdx(null);}} style={{ background:"none", border:"none", color:"#4a6a8a", fontSize:20, cursor:"pointer" }}>✕</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={lbl}>Account Name (e.g. "FTMO 100K #1")</label>
                <input value={accountForm.name} onChange={e=>saf("name",e.target.value)} style={inp} placeholder="My Account Name" />
              </div>
              <div>
                <label style={lbl}>Prop Firm</label>
                <Select value={accountForm.firm} onChange={e=>saf("firm",e.target.value)} options={PROP_FIRMS} />
              </div>
              <div>
                <label style={lbl}>Account Size ($)</label>
                <input type="number" value={accountForm.size} onChange={e=>saf("size",e.target.value)} style={inp} placeholder="100000" />
              </div>
              <div>
                <label style={lbl}>Max Daily Drawdown (%)</label>
                <input type="number" value={accountForm.maxDailyDrawdown} onChange={e=>saf("maxDailyDrawdown",e.target.value)} style={inp} placeholder="5" />
              </div>
              <div>
                <label style={lbl}>Max Total Drawdown (%)</label>
                <input type="number" value={accountForm.maxTotalDrawdown} onChange={e=>saf("maxTotalDrawdown",e.target.value)} style={inp} placeholder="10" />
              </div>
              <div>
                <label style={lbl}>Profit Target (%)</label>
                <input type="number" value={accountForm.profitTarget} onChange={e=>saf("profitTarget",e.target.value)} style={inp} placeholder="10" />
              </div>
              <div>
                <label style={lbl}>Phase</label>
                <Select value={accountForm.phase} onChange={e=>saf("phase",e.target.value)} options={["Phase 1","Phase 2","Funded","Verification"]} />
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={lbl}>Notes</label>
                <input value={accountForm.notes} onChange={e=>saf("notes",e.target.value)} style={inp} placeholder="Any notes about this account..." />
              </div>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={handleAccountSubmit} className="np gold" style={{ flex:1, padding:11 }}>{editAccountIdx!==null?"UPDATE ACCOUNT":"ADD ACCOUNT"}</button>
              <button onClick={()=>{setShowAccountForm(false);setEditAccountIdx(null);}} className="np dim" style={{ padding:"11px 22px" }}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* TRADE FORM MODAL */}
      {showForm&&(
        <div className="overlay" onClick={e=>{ if(e.target===e.currentTarget){setShowForm(false);setEditIdx(null);} }}>
          <div className="modal">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
              <div className="shd">{editIdx!==null?"EDIT TRADE":"LOG TRADE"}</div>
              <button onClick={()=>{setShowForm(false);setEditIdx(null);}} style={{ background:"none", border:"none", color:"#4a6a8a", fontSize:20, cursor:"pointer" }}>✕</button>
            </div>

            {/* Screenshot */}
            <div className="dz" style={{ marginBottom:16 }} onClick={()=>!aiLoading&&fileRef.current?.click()} onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="#f0b429";}} onDragLeave={e=>{e.currentTarget.style.borderColor="#2a3a50";}} onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="#2a3a50";const f=e.dataTransfer.files[0];if(f)handleScreenshot(f);}}>
              {screenshotPreview ? <div style={{ position:"relative" }}><img src={screenshotPreview} alt="chart" style={{ maxHeight:160, objectFit:"contain", borderRadius:3, width:"100%" }}/><div style={{ position:"absolute", top:6, right:6, background:"#060a0f", border:"1px solid #1a2535", borderRadius:2, padding:"2px 8px", fontSize:9, color:"#4ade80" }}>✓ CHART ATTACHED</div></div>
              : aiLoading ? <div className="pulse" style={{ color:"#f0b429", fontSize:12, letterSpacing:"0.15em" }}>🤖 AI EXTRACTING TRADE LEVELS...</div>
              : <><div style={{ fontSize:22, marginBottom:6 }}>📊</div><div style={{ color:"#4a6a8a", fontSize:12 }}>Drop chart screenshot · AI auto-extracts Entry, SL, TP, Setup & Bias</div></>}
              <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>e.target.files[0]&&handleScreenshot(e.target.files[0])} />
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={lbl}>Account</label>
                <Select value={form.accountId} onChange={e=>sf("accountId",e.target.value)} options={accountOptions} />
              </div>
              {[["Date","date","date"],["Time","time","time"],["Entry Price","entry","number"],["Exit Price","exit","number"],["Stop Loss","stopLoss","number"],["Take Profit","takeProfit","number"],["Contracts","contracts","number"],["P&L ($)","pnl","number"],["R:R Achieved","rr","number"]].map(([l,k,t])=>(
                <div key={k}><label style={lbl}>{l}</label><input type={t} value={form[k]} onChange={e=>sf(k,e.target.value)} style={inp} /></div>
              ))}
              {[["Setup","setup",SETUPS],["Session","session",SESSIONS],["Bias","bias",BIASES],["Outcome","outcome",OUTCOMES],["Emotion","emotion",EMOTIONS]].map(([l,k,opts])=>(
                <div key={k}><label style={lbl}>{l}</label><Select value={form[k]} onChange={e=>sf(k,e.target.value)} options={opts} /></div>
              ))}
            </div>
            <div style={{ marginTop:10 }}>
              <label style={lbl}>Notes / Trade Rationale</label>
              <textarea value={form.notes} onChange={e=>sf("notes",e.target.value)} style={{ ...inp, minHeight:65, resize:"vertical" }} placeholder="IFVG formed during NY open, entered on retest..." />
            </div>
            <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:8 }}>
              <input type="checkbox" id="fp" checked={form.followedPlan} onChange={e=>sf("followedPlan",e.target.checked)} style={{ accentColor:"#f0b429", width:14, height:14 }} />
              <label htmlFor="fp" style={{ fontSize:10, color:"#4a6a8a", cursor:"pointer", letterSpacing:"0.12em" }}>FOLLOWED TRADING PLAN</label>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={handleSubmit} className="np gold" style={{ flex:1, padding:11 }}>{editIdx!==null?"UPDATE TRADE":"LOG TRADE"}</button>
              <button onClick={()=>{setShowForm(false);setEditIdx(null);}} className="np dim" style={{ padding:"11px 22px" }}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}