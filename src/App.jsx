import { useState, useEffect, useMemo, useRef, useCallback } from "react";

const fmt$ = v => { const a = Math.abs(v); return (v < 0 ? "-$" : "$") + a.toFixed(2); };
const OUTCOMES = ["Win","Loss","Breakeven"];
const BIASES = ["Bullish","Bearish","Neutral"];
const EMOTIONS = ["Calm","Anxious","Confident","Revenge","FOMO","Disciplined","Tired"];
const TRADE_RATINGS = ["A+","A","A-","B+","B","B-","C"];
const ASSETS = ["MNQ","NQ","MES","ES","Other"];
const RR_BUCKETS = ["0.5R","1R","1.5R","2R","2.5R","3R","3.5R","4R","4.5R","5R+"];
const CONTRACT_MULTIPLIERS = { MNQ:2, NQ:20, MES:5, ES:50 };
const COMMISSIONS = { MNQ:0.52, NQ:1.55, MES:0.52, ES:1.55 };
const DEFAULT_CONFLUENCES = ["IFVG","SMT","Liquidity Sweep","5-minute FVG Delivery","15-minute FVG Delivery","1-hour FVG Delivery","4-hour FVG Delivery","Order Block","Judas Swing","Premium/Discount","Macro"];
const DEFAULT_FIRMS = ["FTMO","Funded Trading Plus","The Funded Trader","MyForexFunds","E8 Funding","True Forex Funds","Apex Trader Funding","TopStep","Tradovate"];
const BE_TOLERANCE = 0.20;
const TIME_SLOTS = [];
for (let h=9;h<=10;h++) for (let m=0;m<60;m+=5) { if(h===10&&m>30)break; TIME_SLOTS.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`); }
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_OF_WEEK = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

const EMPTY = { date:new Date().toISOString().split("T")[0], time:"", exitTime:"", asset:"MNQ", bias:"Bullish", entry:"", exit:"", stopLoss:"", takeProfit:"", contracts:"1", outcome:"Win", pnl:"", rr:"", maxPotentialRR:"", risk:"250", rating:"A", notes:"", emotion:"Calm", followedPlan:true, screenshot:"", aiReview:"", accountIds:[], confluences:[] };
const EMPTY_ACCOUNT = { id:"", name:"", firm:"", size:"50000", startingBalance:"50000", maxTotalDrawdown:"10", phase:"Funded", notes:"", dormant:false };
const EMPTY_TRANSACTION = { id:"", type:"expense", amount:"", date:new Date().toISOString().split("T")[0], notes:"", accountId:"" };

function useStorage(key, fallback) {
  const [val, setVal] = useState(() => { try { const s=localStorage.getItem(key); return s?JSON.parse(s):fallback; } catch { return fallback; } });
  useEffect(() => { try { localStorage.setItem(key,JSON.stringify(val)); } catch {} }, [key,val]);
  return [val, setVal];
}

async function callClaude(messages, systemPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{ "Content-Type":"application/json", "x-api-key":import.meta.env.VITE_ANTHROPIC_KEY, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" },
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system:systemPrompt, messages })
  });
  const data = await res.json();
  return data.content?.map(b=>b.text||"").join("")||"";
}

function calcCommission(asset, contracts) {
  const rate = COMMISSIONS[asset] || 0.52;
  return rate * contracts * 2;
}

function timeDiffMinutes(t1, t2) {
  if (!t1 || !t2) return null;
  const [h1,m1] = t1.split(":").map(Number);
  const [h2,m2] = t2.split(":").map(Number);
  const diff = (h2*60+m2) - (h1*60+m1);
  return diff > 0 ? diff : null;
}

function fmtDuration(mins) {
  if (mins === null || isNaN(mins)) return "—";
  if (mins < 60) return `${Math.round(mins)}m`;
  return `${Math.floor(mins/60)}h ${Math.round(mins%60)}m`;
}

const SEL_STYLE = {
  width:"100%", background:"#0c1117", border:"1px solid #1e2730",
  borderRadius:6, padding:"9px 12px", color:"#e2e8f0", fontSize:13,
  fontFamily:"'DM Sans',sans-serif", cursor:"pointer",
  appearance:"none", WebkitAppearance:"none", outline:"none"
};

function Select({ value, onChange, options, style }) {
  return (
    <div style={{ position:"relative" }}>
      <select value={value} onChange={onChange} style={{ ...SEL_STYLE, ...style }}>
        {options.map(o => typeof o==="string"
          ? <option key={o} value={o} style={{ background:"#0c1117", color:"#e2e8f0" }}>{o}</option>
          : <option key={o.value} value={o.value} style={{ background:"#0c1117", color:"#e2e8f0" }}>{o.label}</option>)}
      </select>
      <div style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none", color:"#4a5568", fontSize:10 }}>▾</div>
    </div>
  );
}

function FirmInput({ value, onChange, firms }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value);
  const ref = useRef();
  useEffect(() => { setInput(value); }, [value]);
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const filtered = [...new Set([...DEFAULT_FIRMS, ...firms])].filter(f => f.toLowerCase().includes(input.toLowerCase()) && f !== input);
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <input value={input} onChange={e=>{ setInput(e.target.value); onChange(e.target.value); setOpen(true); }} onFocus={()=>setOpen(true)}
        style={{ width:"100%", background:"#0c1117", border:"1px solid #1e2730", borderRadius:6, padding:"9px 12px", color:"#e2e8f0", fontSize:13, fontFamily:"'DM Sans',sans-serif", outline:"none", boxSizing:"border-box" }}
        placeholder="Type or select prop firm..."/>
      {open && filtered.length > 0 && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:"#0f161e", border:"1px solid #1e2730", borderRadius:6, zIndex:300, maxHeight:160, overflowY:"auto", boxShadow:"0 8px 24px rgba(0,0,0,0.4)" }}>
          {filtered.map(f => (
            <div key={f} onClick={()=>{ setInput(f); onChange(f); setOpen(false); }}
              style={{ padding:"9px 14px", fontSize:13, color:"#e2e8f0", cursor:"pointer", borderBottom:"1px solid #1a2030" }}
              onMouseEnter={e=>e.currentTarget.style.background="#141c26"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{f}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfluenceCheckboxes({ selected, onChange, confluences }) {
  const toggle = c => onChange(selected.includes(c) ? selected.filter(x=>x!==c) : [...selected,c]);
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:6 }}>
      {confluences.map(c => (
        <div key={c} onClick={()=>toggle(c)} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:selected.includes(c)?"rgba(59,130,246,0.08)":"transparent", border:`1px solid ${selected.includes(c)?"rgba(59,130,246,0.4)":"#1e2730"}`, borderRadius:6, cursor:"pointer", transition:"all 0.15s" }}>
          <div style={{ width:14, height:14, borderRadius:3, border:`1.5px solid ${selected.includes(c)?"#3b82f6":"#2d3a48"}`, background:selected.includes(c)?"#3b82f6":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all 0.15s" }}>
            {selected.includes(c)&&<svg width="8" height="8" viewBox="0 0 8 8"><polyline points="1,4 3,6 7,2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </div>
          <span style={{ fontSize:12, color:selected.includes(c)?"#93c5fd":"#6b7a8d", fontFamily:"'DM Sans',sans-serif" }}>{c}</span>
        </div>
      ))}
    </div>
  );
}

function AccountCheckboxes({ accounts, selected, onChange, label }) {
  const toggle = id => onChange(selected.includes(id) ? selected.filter(x=>x!==id) : [...selected,id]);
  const active = accounts.filter(a=>!a.dormant);
  const toggleAll = () => onChange(selected.length===active.length ? [] : active.map(a=>a.id));
  return (
    <div>
      {label && <div style={{ fontSize:11, color:"#4a5568", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8, fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>{label}</div>}
      {!active.length
        ? <div style={{ fontSize:12, color:"#4a5568", padding:"10px 12px", background:"#0c1117", border:"1px solid #1e2730", borderRadius:6, fontFamily:"'DM Sans',sans-serif" }}>No active accounts</div>
        : <>
          <div onClick={toggleAll} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 14px", background:"transparent", border:"1px solid #1e2730", borderRadius:6, cursor:"pointer", marginBottom:6, transition:"all 0.15s" }}>
            <div style={{ width:14, height:14, borderRadius:3, border:`1.5px solid ${selected.length===active.length?"#3b82f6":"#2d3a48"}`, background:selected.length===active.length?"#3b82f6":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {selected.length===active.length&&<svg width="8" height="8" viewBox="0 0 8 8"><polyline points="1,4 3,6 7,2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
            <span style={{ fontSize:12, color:"#6b7a8d", fontFamily:"'DM Sans',sans-serif" }}>Select all accounts</span>
          </div>
          {active.map(a => (
            <div key={a.id} onClick={()=>toggle(a.id)} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:selected.includes(a.id)?"rgba(59,130,246,0.06)":"transparent", border:`1px solid ${selected.includes(a.id)?"rgba(59,130,246,0.35)":"#1e2730"}`, borderRadius:6, cursor:"pointer", transition:"all 0.15s", marginBottom:5 }}>
              <div style={{ width:14, height:14, borderRadius:3, border:`1.5px solid ${selected.includes(a.id)?"#3b82f6":"#2d3a48"}`, background:selected.includes(a.id)?"#3b82f6":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                {selected.includes(a.id)&&<svg width="8" height="8" viewBox="0 0 8 8"><polyline points="1,4 3,6 7,2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, color:selected.includes(a.id)?"#e2e8f0":"#94a3b8", fontFamily:"'DM Sans',sans-serif", fontWeight:500 }}>{a.name}</div>
                <div style={{ fontSize:11, color:"#4a5568", fontFamily:"'DM Sans',sans-serif" }}>{a.firm} · {a.phase}</div>
              </div>
            </div>
          ))}
        </>
      }
    </div>
  );
}

function parseTradovateCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h=>h.replace(/"/g,"").trim());
  const col = name => headers.indexOf(name);
  const get = (row, name) => (row[col(name)]||"").replace(/"/g,"").trim();
  const rows = lines.slice(1).map(line => {
    const parts=[]; let inQ=false,cur="";
    for(const ch of line){if(ch==='"'){inQ=!inQ;}else if(ch===','&&!inQ){parts.push(cur.trim());cur="";}else cur+=ch;}
    parts.push(cur.trim()); return parts;
  });
  const filled = rows.filter(r=>get(r,"Status").trim()==="Filled"&&get(r,"Avg Fill Price")).sort((a,b)=>new Date(get(a,"Fill Time"))-new Date(get(b,"Fill Time")));
  const trades=[]; let position=0, tradeOrders=[];
  const closeTrade = orders => {
    if(!orders.length)return;
    const contractCode=get(orders[0],"Contract").replace(/[A-Z]\d+$/,"");
    const multiplier=CONTRACT_MULTIPLIERS[contractCode]||2;
    const isShort=get(orders[0],"B/S").trim()==="Sell";
    const entryOrders=orders.filter(r=>isShort?get(r,"B/S").trim()==="Sell":get(r,"B/S").trim()==="Buy");
    const exitOrders=orders.filter(r=>isShort?get(r,"B/S").trim()==="Buy":get(r,"B/S").trim()==="Sell");
    let tEQ=0,tEV=0; entryOrders.forEach(r=>{const q=parseFloat(get(r,"Filled Qty"))||0;const p=parseFloat(get(r,"Avg Fill Price"))||0;tEQ+=q;tEV+=q*p;});
    const avgEntry=tEQ?tEV/tEQ:0;
    let tXQ=0,tXV=0; exitOrders.forEach(r=>{const q=parseFloat(get(r,"Filled Qty"))||0;const p=parseFloat(get(r,"Avg Fill Price"))||0;tXQ+=q;tXV+=q*p;});
    const avgExit=tXQ?tXV/tXQ:0;
    const contracts=Math.min(tEQ,tXQ);
    const grossPnl=isShort?(avgEntry-avgExit)*contracts*multiplier:(avgExit-avgEntry)*contracts*multiplier;
    const commission=calcCommission(contractCode,contracts);
    const pnl=grossPnl-commission;
    const fillTime=get(orders[0],"Fill Time");
    const exitFillTime=get(orders[orders.length-1],"Fill Time");
    const timePart=fillTime.split(" ")[1]?.substring(0,5)||"";
    const exitTimePart=exitFillTime.split(" ")[1]?.substring(0,5)||"";
    const dp=fillTime.split(" ")[0]?.split("/")||[];
    const tradeDate=dp.length===3?`${dp[2]}-${dp[0].padStart(2,"0")}-${dp[1].padStart(2,"0")}`:new Date().toISOString().split("T")[0];
    trades.push({...EMPTY,id:Date.now()+Math.random(),date:tradeDate,time:timePart,exitTime:exitTimePart,asset:ASSETS.includes(contractCode)?contractCode:"MNQ",entry:avgEntry.toFixed(2),exit:avgExit.toFixed(2),contracts:String(contracts),pnl:pnl.toFixed(2),outcome:pnl>0.01?"Win":pnl<-0.01?"Loss":"Breakeven",bias:isShort?"Bearish":"Bullish",accountIds:[],notes:`Auto-imported · ${contractCode} · ${isShort?"Short":"Long"} · Commission: ${fmt$(commission)}`});
  };
  filled.forEach(r=>{
    const side=get(r,"B/S").trim(); const qty=parseFloat(get(r,"Filled Qty"))||0;
    tradeOrders.push(r);
    if(side==="Buy")position+=qty; else position-=qty;
    if(position===0&&tradeOrders.length>0){closeTrade(tradeOrders);tradeOrders=[];}
  });
  if(tradeOrders.length>0)closeTrade(tradeOrders);
  return trades;
}

export default function App() {
  const [trades, setTrades] = useStorage("nq_trades_v8",[]);
  const [accounts, setAccounts] = useStorage("nq_accounts_v6",[]);
  const [confluences, setConfluences] = useStorage("nq_confluences_v1",DEFAULT_CONFLUENCES);
  const [propFirms, setPropFirms] = useStorage("nq_firms_v1",DEFAULT_FIRMS);
  const [transactions, setTransactions] = useStorage("nq_transactions_v2",[]);
  const [showDormant, setShowDormant] = useStorage("nq_show_dormant",false);
  const [view, setView] = useState("dashboard");
  const [analyticsSection, setAnalyticsSection] = useState("rr");
  const [showForm, setShowForm] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showConfluenceManager, setShowConfluenceManager] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [editAccountIdx, setEditAccountIdx] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT);
  const [newConfluence, setNewConfluence] = useState("");
  const [newTransaction, setNewTransaction] = useState(EMPTY_TRANSACTION);
  const [filterOutcome, setFilterOutcome] = useState("All");
  const [filterAccount, setFilterAccount] = useState("All");
  const [filterConfluence, setFilterConfluence] = useState("All");
  const [filterMonth, setFilterMonth] = useState("All");
  const [calSelectedAccounts, setCalSelectedAccounts] = useState([]);
  const [calMonth, setCalMonth] = useState(()=>{ const d=new Date(); return{y:d.getFullYear(),m:d.getMonth()}; });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReviewLoading, setAiReviewLoading] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [toast, setToast] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importFileName, setImportFileName] = useState("");
  const [importSelectedAccounts, setImportSelectedAccounts] = useState([]);
  const [galleryFilter, setGalleryFilter] = useState({ outcome:"All", confluence:"All" });
  const [expandedScreenshot, setExpandedScreenshot] = useState(null);
  const fileRef = useRef();
  const tvRef = useRef();

  const showToast = (msg,type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),3500); };
  const sf = (k,v) => setForm(f=>({...f,[k]:v}));
  const saf = (k,v) => setAccountForm(f=>({...f,[k]:v}));
  const activeAccounts = useMemo(()=>accounts.filter(a=>showDormant||!a.dormant),[accounts,showDormant]);

  useEffect(()=>{
    const pnl=parseFloat(form.pnl);
    const risk=parseFloat(form.risk)||250;
    if(!isNaN(pnl)&&risk>0){
      const rr=(pnl/risk).toFixed(2);
      if(Math.abs(pnl)<=risk*BE_TOLERANCE) setForm(f=>({...f,rr,outcome:"Breakeven"}));
      else if(pnl>0) setForm(f=>({...f,rr,outcome:"Win"}));
      else setForm(f=>({...f,rr,outcome:"Loss"}));
    }
  },[form.pnl,form.risk]);

  const computeStats = useCallback((tradeList)=>{
    if(!tradeList.length)return null;
    const wins=tradeList.filter(t=>t.outcome==="Win");
    const losses=tradeList.filter(t=>t.outcome==="Loss");
    const nonBE=tradeList.filter(t=>t.outcome!=="Breakeven");
    const totalPnl=tradeList.reduce((s,t)=>s+(parseFloat(t.pnl)||0),0);
    const winRate=nonBE.length?(wins.length/nonBE.length)*100:0;
    const avgWin=wins.length?wins.reduce((s,t)=>s+(parseFloat(t.pnl)||0),0)/wins.length:0;
    const avgLoss=losses.length?losses.reduce((s,t)=>s+(parseFloat(t.pnl)||0),0)/losses.length:0;
    const totalWinPnl=wins.reduce((s,t)=>s+(parseFloat(t.pnl)||0),0);
    const totalLossPnl=Math.abs(losses.reduce((s,t)=>s+(parseFloat(t.pnl)||0),0));
    const profitFactor=totalLossPnl?totalWinPnl/totalLossPnl:wins.length?999:0;
    const avgRR=tradeList.filter(t=>t.rr).reduce((s,t)=>s+(parseFloat(t.rr)||0),0)/(tradeList.filter(t=>t.rr).length||1);
    const sorted=[...tradeList].sort((a,b)=>new Date(a.date)-new Date(b.date));
    let cum=0,peak=0,maxDD=0;
    const equity=sorted.map(t=>{cum+=parseFloat(t.pnl)||0;if(cum>peak)peak=cum;const dd=peak-cum;if(dd>maxDD)maxDD=dd;return{date:t.date,value:cum};});
    const dayMap={};
    tradeList.forEach(t=>{if(!dayMap[t.date])dayMap[t.date]={pnl:0,count:0,wins:0,losses:0};dayMap[t.date].pnl+=parseFloat(t.pnl)||0;dayMap[t.date].count++;if(t.outcome==="Win")dayMap[t.date].wins++;if(t.outcome==="Loss")dayMap[t.date].losses++;});
    const followedPlanRate=tradeList.filter(t=>t.followedPlan).length/tradeList.length*100;
    const revSorted=[...sorted].reverse(); let streak=0;
    for(let i=0;i<revSorted.length;i++){const t=revSorted[i];if(i===0){streak=t.outcome==="Win"?1:t.outcome==="Loss"?-1:0;}else{if(t.outcome==="Win"&&streak>0)streak++;else if(t.outcome==="Loss"&&streak<0)streak--;else break;}}
    const rrDist={};
    RR_BUCKETS.forEach(b=>rrDist[b]={count:0,wins:0,losses:0});
    tradeList.filter(t=>t.rr).forEach(t=>{
      const r=parseFloat(t.rr);
      const bucket=r>=5?"5R+":Math.round(Math.abs(r)*2)/2+"R";
      if(rrDist[bucket]){rrDist[bucket].count++;if(t.outcome==="Win")rrDist[bucket].wins++;if(t.outcome==="Loss")rrDist[bucket].losses++;}
    });
    const rrHitRate={};
    RR_BUCKETS.forEach(b=>{
      const threshold=b==="5R+"?5:parseFloat(b);
      const reached=tradeList.filter(t=>t.rr&&Math.abs(parseFloat(t.rr))>=threshold);
      rrHitRate[b]={count:reached.length,pct:tradeList.length?(reached.length/tradeList.length)*100:0};
    });
    const confMap={};
    confluences.forEach(c=>confMap[c]={count:0,wins:0,losses:0,pnl:0});
    tradeList.forEach(t=>{(t.confluences||[]).forEach(c=>{if(confMap[c]){confMap[c].count++;confMap[c].pnl+=parseFloat(t.pnl)||0;if(t.outcome==="Win")confMap[c].wins++;if(t.outcome==="Loss")confMap[c].losses++;}});});
    const timeMap={};
    TIME_SLOTS.forEach(s=>timeMap[s]={count:0,wins:0,losses:0,pnl:0});
    tradeList.forEach(t=>{
      if(!t.time)return;
      const [th,tm]=t.time.split(":").map(Number);
      const slot=`${String(th).padStart(2,"0")}:${String(Math.floor(tm/5)*5).padStart(2,"0")}`;
      if(timeMap[slot]){timeMap[slot].count++;timeMap[slot].pnl+=parseFloat(t.pnl)||0;if(t.outcome==="Win")timeMap[slot].wins++;if(t.outcome==="Loss")timeMap[slot].losses++;}
    });
    const longs=tradeList.filter(t=>t.bias==="Bullish");
    const shorts=tradeList.filter(t=>t.bias==="Bearish");
    const longWR=longs.filter(t=>t.outcome!=="Breakeven").length?(longs.filter(t=>t.outcome==="Win").length/longs.filter(t=>t.outcome!=="Breakeven").length)*100:0;
    const shortWR=shorts.filter(t=>t.outcome!=="Breakeven").length?(shorts.filter(t=>t.outcome==="Win").length/shorts.filter(t=>t.outcome!=="Breakeven").length)*100:0;
    const withDuration=tradeList.filter(t=>t.time&&t.exitTime&&timeDiffMinutes(t.time,t.exitTime)!==null);
    const avgDuration=withDuration.length?withDuration.reduce((s,t)=>s+(timeDiffMinutes(t.time,t.exitTime)||0),0)/withDuration.length:null;
    const winDuration=wins.filter(t=>t.time&&t.exitTime&&timeDiffMinutes(t.time,t.exitTime)!==null);
    const avgWinDuration=winDuration.length?winDuration.reduce((s,t)=>s+(timeDiffMinutes(t.time,t.exitTime)||0),0)/winDuration.length:null;
    const lossDuration=losses.filter(t=>t.time&&t.exitTime&&timeDiffMinutes(t.time,t.exitTime)!==null);
    const avgLossDuration=lossDuration.length?lossDuration.reduce((s,t)=>s+(timeDiffMinutes(t.time,t.exitTime)||0),0)/lossDuration.length:null;
    const rrVsPotential=tradeList.filter(t=>t.rr&&t.maxPotentialRR).map(t=>({achieved:parseFloat(t.rr),potential:parseFloat(t.maxPotentialRR),left:parseFloat(t.maxPotentialRR)-parseFloat(t.rr),date:t.date}));
    const avgLeft=rrVsPotential.length?rrVsPotential.reduce((s,t)=>s+t.left,0)/rrVsPotential.length:0;
    const ratingMap={};
    TRADE_RATINGS.forEach(r=>ratingMap[r]={count:0,wins:0,losses:0,pnl:0});
    tradeList.forEach(t=>{if(t.rating&&ratingMap[t.rating]){ratingMap[t.rating].count++;ratingMap[t.rating].pnl+=parseFloat(t.pnl)||0;if(t.outcome==="Win")ratingMap[t.rating].wins++;if(t.outcome==="Loss")ratingMap[t.rating].losses++;}});
    const dayEntries=Object.entries(dayMap);
    const bestDay=dayEntries.length?[...dayEntries].sort((a,b)=>b[1].pnl-a[1].pnl)[0]:null;
    const worstDay=dayEntries.length?[...dayEntries].sort((a,b)=>a[1].pnl-b[1].pnl)[0]:null;
    const dowMap={};
    DAYS_OF_WEEK.forEach(d=>dowMap[d]={count:0,wins:0,losses:0,pnl:0});
    tradeList.forEach(t=>{const dow=DAYS_OF_WEEK[new Date(t.date+"T12:00:00").getDay()];if(dowMap[dow]){dowMap[dow].count++;dowMap[dow].pnl+=parseFloat(t.pnl)||0;if(t.outcome==="Win")dowMap[dow].wins++;if(t.outcome==="Loss")dowMap[dow].losses++;}});
    const mostActiveDay=Object.entries(dowMap).sort((a,b)=>b[1].count-a[1].count)[0];
    const bestWRDay=Object.entries(dowMap).filter(([,d])=>d.count>0).sort((a,b)=>{const awr=a[1].wins/(a[1].wins+a[1].losses||1);const bwr=b[1].wins/(b[1].wins+b[1].losses||1);return bwr-awr;})[0];
    return{wins:wins.length,losses:losses.length,total:tradeList.length,totalPnl,winRate,avgWin,avgLoss,profitFactor,avgRR,equity,maxDD,followedPlanRate,dayMap,streak,rrDist,rrHitRate,confMap,timeMap,longs:longs.length,shorts:shorts.length,longWR,shortWR,avgDuration,avgWinDuration,avgLossDuration,rrVsPotential,avgLeft,ratingMap,bestDay,worstDay,mostActiveDay,bestWRDay,dowMap};
  },[confluences]);

  const stats=useMemo(()=>computeStats(trades),[trades,computeStats]);
  const accountStats=useMemo(()=>accounts.map(acc=>{
    const accTrades=trades.filter(t=>(t.accountIds||[]).includes(acc.id));
    const s=computeStats(accTrades);
    const startBal=parseFloat(acc.startingBalance||acc.size)||50000;
    const pnl=s?.totalPnl||0;
    const currentBalance=startBal+pnl;
    const gainPct=(pnl/startBal)*100;
    const ddUsed=s?.maxDD||0;
    const ddPct=(ddUsed/startBal)*100;
    const acctTx=transactions.filter(t=>t.accountId===acc.id);
    const totalExpenses=acctTx.filter(t=>t.type==="expense").reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
    const totalPayouts=acctTx.filter(t=>t.type==="payout").reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
    const netReal=totalPayouts-totalExpenses;
    return{...acc,stats:s,pnl,currentBalance,startBal,gainPct,ddPct,ddLimit:parseFloat(acc.maxTotalDrawdown)||10,tradeCount:accTrades.length,totalExpenses,totalPayouts,netReal};
  }),[accounts,trades,transactions,computeStats]);

  const equityPath=useMemo(()=>{
    const src=selectedAccount?(accountStats.find(a=>a.id===selectedAccount)?.stats?.equity||[]):(stats?.equity||[]);
    if(!src.length)return"";
    const vals=src.map(p=>p.value);
    const minV=Math.min(0,...vals),maxV=Math.max(0,...vals),range=maxV-minV||1;
    return src.map((p,i)=>{const x=(i/(src.length-1||1))*400;const y=80-((p.value-minV)/range)*80;return`${i===0?"M":"L"}${x},${y}`;}).join(" ");
  },[stats,accountStats,selectedAccount]);

  const calDayMap=useMemo(()=>{
    const filtered=calSelectedAccounts.length>0?trades.filter(t=>(t.accountIds||[]).some(id=>calSelectedAccounts.includes(id))):trades;
    const map={};
    filtered.forEach(t=>{
      if(!map[t.date])map[t.date]={pnl:0,count:0,wins:0,losses:0};
      const accountCount=calSelectedAccounts.length>0?(t.accountIds||[]).filter(id=>calSelectedAccounts.includes(id)).length:(t.accountIds||[]).length||1;
      map[t.date].pnl+=(parseFloat(t.pnl)||0)*accountCount;
      map[t.date].count++;
      if(t.outcome==="Win")map[t.date].wins++;
      if(t.outcome==="Loss")map[t.date].losses++;
    });
    return map;
  },[trades,calSelectedAccounts]);

  const calDays=useMemo(()=>({first:new Date(calMonth.y,calMonth.m,1).getDay(),total:new Date(calMonth.y,calMonth.m+1,0).getDate()}),[calMonth]);
  const availableMonths=useMemo(()=>{const months=new Set(trades.map(t=>t.date?.substring(0,7)).filter(Boolean));return["All",...[...months].sort().reverse()];},[trades]);
  const filteredTrades=useMemo(()=>trades.filter(t=>(filterOutcome==="All"||t.outcome===filterOutcome)&&(filterAccount==="All"||(t.accountIds||[]).includes(filterAccount))&&(filterConfluence==="All"||(t.confluences||[]).includes(filterConfluence))&&(filterMonth==="All"||t.date?.startsWith(filterMonth))).sort((a,b)=>new Date(b.date)-new Date(a.date)),[trades,filterOutcome,filterAccount,filterConfluence,filterMonth]);
  const galleryTrades=useMemo(()=>trades.filter(t=>t.screenshot&&(galleryFilter.outcome==="All"||t.outcome===galleryFilter.outcome)&&(galleryFilter.confluence==="All"||(t.confluences||[]).includes(galleryFilter.confluence))).sort((a,b)=>new Date(b.date)-new Date(a.date)),[trades,galleryFilter]);
  const financialsSummary=useMemo(()=>({totalExpenses:transactions.filter(t=>t.type==="expense").reduce((s,t)=>s+(parseFloat(t.amount)||0),0),totalPayouts:transactions.filter(t=>t.type==="payout").reduce((s,t)=>s+(parseFloat(t.amount)||0),0),net:transactions.filter(t=>t.type==="payout").reduce((s,t)=>s+(parseFloat(t.amount)||0),0)-transactions.filter(t=>t.type==="expense").reduce((s,t)=>s+(parseFloat(t.amount)||0),0)}),[transactions]);

  const handleScreenshot=useCallback(async(file)=>{
    if(!file)return;
    const reader=new FileReader();
    reader.onload=async(e)=>{
      const b64=e.target.result.split(",")[1];
      setScreenshotPreview(e.target.result);
      setForm(f=>({...f,screenshot:e.target.result}));
      setAiLoading(true);
      try{
        const raw=await callClaude([{role:"user",content:[{type:"image",source:{type:"base64",media_type:file.type||"image/png",data:b64}},{type:"text",text:`Analyze this NQ futures TradingView chart. Return ONLY valid JSON:\n{"entry":number|null,"stopLoss":number|null,"takeProfit":number|null,"exit":number|null,"time":"HH:MM"|null,"exitTime":"HH:MM"|null,"bias":"Bullish"|"Bearish"|"Neutral"|null,"pnl":number|null,"rr":number|null,"confluences":[],"notes":string|null}`}]}],"You are an expert NQ futures ICT analyst. Extract trade data from TradingView screenshots. Return only valid JSON, no markdown.");
        const parsed=JSON.parse(raw.replace(/```json|```/g,"").trim());
        setForm(f=>({...f,...(parsed.entry&&{entry:String(parsed.entry)}),...(parsed.stopLoss&&{stopLoss:String(parsed.stopLoss)}),...(parsed.takeProfit&&{takeProfit:String(parsed.takeProfit)}),...(parsed.exit&&{exit:String(parsed.exit)}),...(parsed.time&&{time:parsed.time}),...(parsed.exitTime&&{exitTime:parsed.exitTime}),...(parsed.bias&&BIASES.includes(parsed.bias)&&{bias:parsed.bias}),...(parsed.pnl!=null&&{pnl:String(parsed.pnl)}),...(parsed.rr&&{rr:String(parsed.rr)}),...(parsed.confluences?.length&&{confluences:parsed.confluences.filter(c=>confluences.includes(c))}),...(parsed.notes&&{notes:parsed.notes})}));
        showToast("AI extracted trade data");
      }catch{showToast("Could not parse chart","error");}
      setAiLoading(false);
    };
    reader.readAsDataURL(file);
  },[confluences]);

  const runAiReview=async(trade)=>{
    setAiReviewLoading(true);
    const accs=accounts.filter(a=>(trade.accountIds||[]).includes(a.id));
    try{
      const review=await callClaude([{role:"user",content:`Review this NQ futures trade:\nDate: ${trade.date} ${trade.time}→${trade.exitTime||"?"}${accs.length?` | Accounts: ${accs.map(a=>a.name).join(", ")}`:""}\nAsset: ${trade.asset||"MNQ"} | Bias: ${trade.bias} | Rating: ${trade.rating||"—"}\nEntry: ${trade.entry} | SL: ${trade.stopLoss} | TP: ${trade.takeProfit} | Exit: ${trade.exit}\nP&L: ${trade.pnl} | R:R: ${trade.rr}R | Max Potential R:R: ${trade.maxPotentialRR||"—"} | Risk: $${trade.risk||250}\nConfluences: ${(trade.confluences||[]).join(", ")||"None"}\nFollowed Plan: ${trade.followedPlan} | Emotion: ${trade.emotion}\nNotes: ${trade.notes}\nReview: (1) Confluence strength (2) Execution (3) Risk/reward (4) R left on table? (5) Improvement. Under 200 words.`}],
        "You are an elite NQ futures trading coach specialising in ICT concepts. Give specific, actionable feedback.");
      const idx=trades.indexOf(trade);
      if(idx!==-1)setTrades(prev=>prev.map((t,i)=>i===idx?{...t,aiReview:review}:t));
      showToast("AI review complete");
    }catch{showToast("Review failed","error");}
    setAiReviewLoading(false);
  };

  const exportCSV=()=>{
    const headers=["date","time","exitTime","asset","bias","entry","exit","stopLoss","takeProfit","contracts","outcome","pnl","rr","maxPotentialRR","risk","rating","emotion","followedPlan","confluences","notes","accountIds"];
    const rows=trades.map(t=>headers.map(h=>{const v=t[h]??"";return`"${Array.isArray(v)?v.join("|"):v.toString().replace(/"/g,'""')}"`}).join(","));
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([[headers.join(","),...rows].join("\n")],{type:"text/csv"}));a.download=`trading_journal_${new Date().toISOString().split("T")[0]}.csv`;a.click();
    showToast("CSV exported");
  };

  const handleTradovateFile=(file)=>{
    const reader=new FileReader();
    reader.onload=(e)=>{
      try{
        const parsed=parseTradovateCSV(e.target.result);
        const withBE=parsed.map(t=>{const pnl=parseFloat(t.pnl)||0;const risk=250;if(Math.abs(pnl)<=risk*BE_TOLERANCE)return{...t,outcome:"Breakeven"};return t;});
        setImportPreview(withBE);setImportFileName(file.name);setImportSelectedAccounts(activeAccounts.map(a=>a.id));setShowImportModal(true);
      }catch{showToast("Could not parse Tradovate file","error");}
    };
    reader.readAsText(file);
  };

  const confirmTradovateImport=()=>{
    if(!importPreview||!importSelectedAccounts.length){showToast("Select at least one account","warn");return;}
    const existing=new Set(trades.map(t=>`${t.date}${t.time}${t.entry}`));
    const newTrades=importPreview.filter(t=>!existing.has(`${t.date}${t.time}${t.entry}`)).map(t=>{const pnl=parseFloat(t.pnl)||0;return{...t,id:Date.now()+Math.random(),accountIds:[...importSelectedAccounts],risk:"250",rr:(pnl/250).toFixed(2)};});
    setTrades(prev=>[...prev,...newTrades]);setShowImportModal(false);setImportPreview(null);
    showToast(`Imported ${newTrades.length} trades`);
  };

  const handleSubmit=()=>{
    if(!form.date||!form.entry)return;
    if(editIdx!==null){setTrades(prev=>prev.map((t,i)=>i===editIdx?{...form}:t));setEditIdx(null);}
    else setTrades(prev=>[...prev,{...form,id:Date.now()}]);
    setForm(EMPTY);setScreenshotPreview(null);setShowForm(false);showToast("Trade logged");
  };

  const handleAccountSubmit=()=>{
    if(!accountForm.name)return;
    const acc={...accountForm,id:accountForm.id||String(Date.now())};
    if(accountForm.firm&&!propFirms.includes(accountForm.firm))setPropFirms(prev=>[...new Set([...prev,accountForm.firm])]);
    if(editAccountIdx!==null){setAccounts(prev=>prev.map((a,i)=>i===editAccountIdx?acc:a));setEditAccountIdx(null);}
    else setAccounts(prev=>[...prev,acc]);
    setAccountForm(EMPTY_ACCOUNT);setShowAccountForm(false);showToast("Account saved");
  };

  const toggleDormant=(idx)=>{setAccounts(prev=>prev.map((a,i)=>i===idx?{...a,dormant:!a.dormant}:a));showToast(accounts[idx].dormant?"Account reactivated":"Account set to dormant");};
  const openEdit=(idx)=>{setEditIdx(idx);setForm({...EMPTY,...trades[idx],accountIds:trades[idx].accountIds||[],confluences:trades[idx].confluences||[]});setScreenshotPreview(trades[idx].screenshot||null);setShowForm(true);};
  const deleteTrade=(idx)=>{setTrades(prev=>prev.filter((_,i)=>i!==idx));showToast("Trade deleted","warn");};
  const openEditAccount=(idx)=>{setEditAccountIdx(idx);setAccountForm(accounts[idx]);setShowAccountForm(true);};
  const deleteAccount=(idx)=>{setAccounts(prev=>prev.filter((_,i)=>i!==idx));showToast("Account removed","warn");};

  const activeStats=selectedAccount?accountStats.find(a=>a.id===selectedAccount)?.stats:stats;
  const ratingColor=r=>({"A+":"#4ade80","A":"#4ade80","A-":"#86efac","B+":"#f0b429","B":"#f0b429","B-":"#fcd34d","C":"#f87171"}[r]||"#e2e8f0");

  const ANALYTICS_SECTIONS=[
    {id:"rr",label:"R:R Distribution"},
    {id:"hitrate",label:"Cumulative Hit Rate"},
    {id:"potential",label:"Achieved vs Potential"},
    {id:"direction",label:"Direction & Duration"},
    {id:"ratings",label:"Trade Ratings"},
    {id:"confluence",label:"Confluence"},
    {id:"time",label:"Time of Day"},
    {id:"summary",label:"Performance Summary"},
    {id:"metrics",label:"Key Metrics"},
  ];

  // Shared input style
  const inp={width:"100%",background:"#0c1117",border:"1px solid #1e2730",borderRadius:6,padding:"9px 12px",color:"#e2e8f0",fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:"none",boxSizing:"border-box",transition:"border-color 0.15s"};
  const lbl={display:"block",color:"#4a5568",fontSize:11,marginBottom:6,letterSpacing:"0.06em",textTransform:"uppercase",fontFamily:"'DM Sans',sans-serif",fontWeight:600};

  return (
    <div style={{fontFamily:"'DM Sans','Inter',sans-serif",background:"#080d12",minHeight:"100vh",color:"#e2e8f0",width:"100%"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body,#root{width:100%;min-height:100vh;background:#080d12}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1e2a38;border-radius:4px}
        ::-webkit-scrollbar-thumb:hover{background:#2d3a4a}

        .card{background:#0c1117;border:1px solid #141c26;border-radius:10px;padding:20px;transition:border-color 0.2s}
        .card:hover{border-color:#1e2a38}

        .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 16px;border-radius:7px;font-size:12px;font-weight:600;letter-spacing:0.04em;cursor:pointer;border:none;font-family:'DM Sans',sans-serif;transition:all 0.15s;white-space:nowrap}
        .btn-primary{background:#3b82f6;color:#fff}.btn-primary:hover{background:#2563eb}
        .btn-ghost{background:transparent;color:#64748b;border:1px solid #1e2730}.btn-ghost:hover{color:#94a3b8;border-color:#2d3a4a;background:#0f161e}
        .btn-danger{background:transparent;color:#f87171;border:1px solid #2d1515}.btn-danger:hover{background:#1a0a0a}
        .btn-success{background:rgba(34,197,94,0.1);color:#4ade80;border:1px solid rgba(74,222,128,0.2)}.btn-success:hover{background:rgba(34,197,94,0.15)}
        .btn-sm{padding:5px 11px;font-size:11px}

        .overlay{position:fixed;inset:0;background:rgba(4,7,10,0.85);backdrop-filter:blur(12px);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto}
        .modal{background:#0c1117;border:1px solid #1e2730;border-radius:14px;width:100%;max-width:860px;padding:32px;margin:auto;box-shadow:0 24px 64px rgba(0,0,0,0.6)}

        .dz{border:1px dashed #1e2730;border-radius:10px;padding:28px;text-align:center;cursor:pointer;transition:all 0.2s;background:#090e14}
        .dz:hover{border-color:#3b82f6;background:#0c1520}

        .toast{position:fixed;bottom:24px;right:24px;padding:11px 18px;border-radius:8px;font-size:12px;font-family:'DM Sans',sans-serif;font-weight:500;z-index:999;animation:slideup 0.2s ease;box-shadow:0 8px 24px rgba(0,0,0,0.4)}
        @keyframes slideup{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}

        .nav-tab{padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;letter-spacing:0.03em;border:none;font-family:'DM Sans',sans-serif}
        .nav-active{background:#141c26;color:#e2e8f0}
        .nav-inactive{background:transparent;color:#4a5568}.nav-inactive:hover{color:#94a3b8}

        .stat-card{background:#0c1117;border:1px solid #141c26;border-radius:10px;padding:18px 20px;transition:border-color 0.2s}
        .stat-card:hover{border-color:#1e2a38}

        .mono{font-family:'DM Mono',monospace}

        .analytics-nav-item{padding:9px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:500;transition:all 0.15s;margin-bottom:3px;font-family:'DM Sans',sans-serif}
        .analytics-nav-active{background:#141c26;color:#e2e8f0}
        .analytics-nav-inactive{color:#4a5568}.analytics-nav-inactive:hover{color:#94a3b8;background:#0c1117}

        .tag{display:inline-flex;align-items:center;padding:3px 9px;border-radius:5px;font-size:11px;font-weight:500;background:rgba(59,130,246,0.1);color:#93c5fd;border:1px solid rgba(59,130,246,0.15)}
        .outcome-win{color:#4ade80}.outcome-loss{color:#f87171}.outcome-be{color:#fbbf24}
        .bar-bg{background:#141c26;border-radius:3px;height:4px;overflow:hidden}
        .gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
        .gallery-item{cursor:pointer;border-radius:10px;overflow:hidden;border:1px solid #141c26;transition:all 0.2s;background:#0c1117}
        .gallery-item:hover{border-color:#3b82f6;transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.3)}
        .cal-cell{padding:10px;border-radius:8px;min-height:80px;transition:border-color 0.15s;border:1px solid #141c26}
        .section-title{font-size:11px;font-weight:600;color:#4a5568;letter-spacing:0.08em;text-transform:uppercase;font-family:'DM Sans',sans-serif}
        .page-title{font-size:22px;font-weight:600;color:#e2e8f0;letter-spacing:-0.02em}
        .page-sub{font-size:13px;color:#4a5568;margin-top:3px}
        input:focus,textarea:focus,select:focus{border-color:#3b82f6!important}
        .review-box{background:#090e14;border:1px solid #141c26;border-radius:8px;padding:16px;font-size:12px;line-height:1.75;color:#64748b;white-space:pre-wrap;margin-top:12px;font-family:'DM Sans',sans-serif}
        .pulse{animation:pulse 1.5s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        .sep{border:none;border-top:1px solid #141c26;margin:0}
        .badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:0.05em}
      `}</style>

      {toast&&<div className="toast" style={{
        background:toast.type==="error"?"#120a0a":toast.type==="warn"?"#12100a":"#0a120e",
        border:`1px solid ${toast.type==="error"?"#3a1515":toast.type==="warn"?"#3a2a0a":"#1a3a24"}`,
        color:toast.type==="error"?"#f87171":toast.type==="warn"?"#fbbf24":"#4ade80"
      }}>{toast.msg}</div>}

      {/* NAV */}
      <div style={{borderBottom:"1px solid #141c26",padding:"0 28px",background:"#080d12",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:56}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:28,height:28,borderRadius:7,background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><polyline points="1,10 4,6 7,8 10,3 13,5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",letterSpacing:"-0.02em"}}>Trading Journal</div>
            <div style={{fontSize:11,color:"#2d3a4a",marginLeft:4,paddingLeft:10,borderLeft:"1px solid #141c26"}}>NQ · ICT · IFVG</div>
          </div>
          <div style={{display:"flex",gap:2,background:"#0c1117",border:"1px solid #141c26",borderRadius:9,padding:3}}>
            {["dashboard","accounts","journal","analytics","screenshots","financials"].map(v=>(
              <button key={v} className={`nav-tab ${view===v?"nav-active":"nav-inactive"}`} onClick={()=>setView(v)} style={{textTransform:"capitalize"}}>{v}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button className="btn btn-ghost btn-sm" onClick={exportCSV}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3 5l3 3 3-3M1 10h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Export
            </button>
            <label className="btn btn-ghost btn-sm" style={{cursor:"pointer",color:"#4ade80",borderColor:"rgba(74,222,128,0.2)",background:"rgba(74,222,128,0.06)"}}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3 5l3 3 3-3M1 10h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" style={{transform:"scaleY(-1)",transformOrigin:"center"}}/></svg>
              Tradovate
              <input ref={tvRef} type="file" accept=".csv" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleTradovateFile(e.target.files[0])}/>
            </label>
            <button className="btn btn-ghost btn-sm" onClick={()=>{setEditAccountIdx(null);setAccountForm(EMPTY_ACCOUNT);setShowAccountForm(true);}}>
              + Account
            </button>
            <button className="btn btn-primary btn-sm" onClick={()=>{setEditIdx(null);setForm(EMPTY);setScreenshotPreview(null);setShowForm(true);}}>
              + Log Trade
            </button>
          </div>
        </div>
      </div>

      <div style={{padding:"24px 28px",maxWidth:1400,margin:"0 auto"}}>

        {/* ─── DASHBOARD ─── */}
        {view==="dashboard"&&(
          <div>
            <div style={{marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
              <div>
                <div className="page-title">Overview</div>
                <div className="page-sub">{trades.length} trades · {activeAccounts.length} active accounts</div>
              </div>
              <div style={{display:"flex",gap:4,background:"#0c1117",border:"1px solid #141c26",borderRadius:8,padding:3}}>
                <button className={`btn btn-sm ${!selectedAccount?"btn-ghost":"btn-ghost"}`} onClick={()=>setSelectedAccount(null)} style={{background:!selectedAccount?"#141c26":"transparent",color:!selectedAccount?"#e2e8f0":"#4a5568",border:"none"}}>All</button>
                {activeAccounts.map(a=><button key={a.id} className="btn btn-sm" onClick={()=>setSelectedAccount(selectedAccount===a.id?null:a.id)} style={{background:selectedAccount===a.id?"#141c26":"transparent",color:selectedAccount===a.id?"#e2e8f0":"#4a5568",border:"none",fontSize:11}}>{a.name}</button>)}
              </div>
            </div>

            {!trades.length?(
              <div style={{textAlign:"center",padding:"100px 0"}}>
                <div style={{width:56,height:56,borderRadius:14,background:"#0c1117",border:"1px solid #1e2730",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px"}}>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><polyline points="2,16 7,10 11,13 16,6 20,9" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <div style={{fontSize:16,fontWeight:600,color:"#e2e8f0",marginBottom:8}}>No trades yet</div>
                <div style={{fontSize:13,color:"#4a5568",marginBottom:28}}>Import from Tradovate or log your first trade manually</div>
                <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                  <label className="btn btn-success" style={{cursor:"pointer",padding:"10px 20px",fontSize:13}}>
                    Import Tradovate CSV
                    <input type="file" accept=".csv" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleTradovateFile(e.target.files[0])}/>
                  </label>
                  <button className="btn btn-primary" style={{padding:"10px 20px",fontSize:13}} onClick={()=>setShowForm(true)}>Log Manually</button>
                </div>
              </div>
            ):(
              <>
                {/* Stats row */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:8,marginBottom:16}}>
                  {[
                    {l:"Total P&L",v:fmt$(activeStats?.totalPnl||0),c:(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"},
                    {l:"Win Rate",v:`${(activeStats?.winRate||0).toFixed(1)}%`,c:(activeStats?.winRate||0)>=50?"#4ade80":"#f87171"},
                    {l:"Profit Factor",v:(activeStats?.profitFactor||0)===999?"∞":(activeStats?.profitFactor||0).toFixed(2),c:(activeStats?.profitFactor||0)>=1.5?"#4ade80":"#f87171"},
                    {l:"Avg R:R",v:`${(activeStats?.avgRR||0).toFixed(2)}R`,c:"#93c5fd"},
                    {l:"Trades",v:activeStats?.total||0,c:"#e2e8f0"},
                    {l:"Max Drawdown",v:fmt$(activeStats?.maxDD||0),c:"#f87171"},
                    {l:"Plan %",v:`${(activeStats?.followedPlanRate||0).toFixed(0)}%`,c:(activeStats?.followedPlanRate||0)>=70?"#4ade80":"#fbbf24"},
                    {l:"Streak",v:(activeStats?.streak||0)>0?`+${activeStats.streak}W`:(activeStats?.streak||0)<0?`${Math.abs(activeStats.streak)}L`:"—",c:(activeStats?.streak||0)>0?"#4ade80":(activeStats?.streak||0)<0?"#f87171":"#4a5568"}
                  ].map(s=>(
                    <div key={s.l} className="stat-card">
                      <div style={{fontSize:10,color:"#334155",letterSpacing:"0.06em",textTransform:"uppercase",fontWeight:600,marginBottom:8}}>{s.l}</div>
                      <div className="mono" style={{fontSize:18,fontWeight:500,color:s.c}}>{s.v}</div>
                    </div>
                  ))}
                </div>

                {/* Equity + Accounts */}
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12,marginBottom:16}}>
                  <div className="card">
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                      <div className="section-title">Equity Curve</div>
                      <div className="mono" style={{fontSize:18,fontWeight:500,color:(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"}}>{fmt$(activeStats?.totalPnl||0)}</div>
                    </div>
                    <svg width="100%" viewBox="0 0 400 80" preserveAspectRatio="none" style={{height:72,display:"block"}}>
                      <defs>
                        <linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"} stopOpacity="0.15"/>
                          <stop offset="100%" stopColor={(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"} stopOpacity="0"/>
                        </linearGradient>
                      </defs>
                      {equityPath&&<>
                        <path d={equityPath+" L400,80 L0,80 Z"} fill="url(#eqg)"/>
                        <path d={equityPath} fill="none" stroke={(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"} strokeWidth="1.5" strokeLinecap="round"/>
                      </>}
                    </svg>
                  </div>
                  <div className="card" style={{overflowY:"auto",maxHeight:180}}>
                    <div className="section-title" style={{marginBottom:14}}>Accounts</div>
                    {accountStats.filter(a=>!a.dormant).map(a=>(
                      <div key={a.id} style={{marginBottom:14,paddingBottom:14,borderBottom:"1px solid #0f161e"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                          <div style={{fontSize:13,color:"#94a3b8",fontWeight:500}}>{a.name}</div>
                          <div style={{textAlign:"right"}}>
                            <div className="mono" style={{fontSize:14,fontWeight:500,color:a.pnl>=0?"#4ade80":"#f87171"}}>{fmt$(a.pnl)}</div>
                            <div style={{fontSize:10,color:a.gainPct>=0?"#4ade80":"#f87171"}}>{a.gainPct>=0?"+":""}{a.gainPct.toFixed(2)}%</div>
                          </div>
                        </div>
                        <div style={{fontSize:10,color:"#334155",marginBottom:4}}>DD {a.ddPct.toFixed(1)}% / {a.ddLimit}%</div>
                        <div className="bar-bg"><div style={{width:`${Math.min(100,(a.ddPct/a.ddLimit)*100)}%`,height:"100%",background:a.ddPct/a.ddLimit>0.7?"#f87171":a.ddPct/a.ddLimit>0.4?"#fbbf24":"#4ade80",transition:"width 0.3s"}}/></div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Calendar */}
                <div className="card">
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                    <div className="section-title">P&L Calendar</div>
                    <div style={{display:"flex",gap:10,alignItems:"center"}}>
                      <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                        <button className="btn btn-sm" onClick={()=>setCalSelectedAccounts([])} style={{background:calSelectedAccounts.length===0?"#141c26":"transparent",color:calSelectedAccounts.length===0?"#e2e8f0":"#4a5568",border:"1px solid #1e2730",fontSize:11}}>All</button>
                        {activeAccounts.map(a=><button key={a.id} className="btn btn-sm" onClick={()=>setCalSelectedAccounts(prev=>prev.includes(a.id)?prev.filter(x=>x!==a.id):[...prev,a.id])} style={{background:calSelectedAccounts.includes(a.id)?"#141c26":"transparent",color:calSelectedAccounts.includes(a.id)?"#e2e8f0":"#4a5568",border:"1px solid #1e2730",fontSize:11}}>{a.name}</button>)}
                      </div>
                      <div style={{display:"flex",gap:4,alignItems:"center",borderLeft:"1px solid #141c26",paddingLeft:12}}>
                        <button onClick={()=>setCalMonth(p=>{const d=new Date(p.y,p.m-1);return{y:d.getFullYear(),m:d.getMonth()};})} className="btn btn-ghost btn-sm">‹</button>
                        <span className="mono" style={{fontSize:13,fontWeight:500,color:"#94a3b8",minWidth:120,textAlign:"center"}}>{MONTHS[calMonth.m]} {calMonth.y}</span>
                        <button onClick={()=>setCalMonth(p=>{const d=new Date(p.y,p.m+1);return{y:d.getFullYear(),m:d.getMonth()};})} className="btn btn-ghost btn-sm">›</button>
                      </div>
                    </div>
                  </div>

                  {(()=>{
                    const mt=Object.entries(calDayMap).filter(([date])=>{const d=new Date(date);return d.getFullYear()===calMonth.y&&d.getMonth()===calMonth.m;});
                    const mPnl=mt.reduce((s,[,d])=>s+d.pnl,0);
                    const mTrades=mt.reduce((s,[,d])=>s+d.count,0);
                    const mWins=mt.reduce((s,[,d])=>s+d.wins,0);
                    const mLosses=mt.reduce((s,[,d])=>s+d.losses,0);
                    const mWR=mWins+mLosses>0?(mWins/(mWins+mLosses))*100:0;
                    return(
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:20}}>
                        {[["Month P&L",fmt$(mPnl),mPnl>=0?"#4ade80":"#f87171"],["Trades",mTrades,"#e2e8f0"],["Win Rate",`${mWR.toFixed(0)}%`,mWR>=50?"#4ade80":"#f87171"],["Trading Days",mt.length,"#93c5fd"]].map(([l,v,c])=>(
                          <div key={l} style={{background:"#090e14",border:"1px solid #141c26",borderRadius:8,padding:"14px 16px"}}>
                            <div className="section-title" style={{marginBottom:8}}>{l}</div>
                            <div className="mono" style={{fontSize:20,fontWeight:500,color:c}}>{v}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
                    {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>(
                      <div key={d} style={{textAlign:"center",fontSize:11,color:"#2d3a4a",padding:"6px 0",fontWeight:600}}>{d}</div>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
                    {Array.from({length:calDays.first}).map((_,i)=><div key={`e${i}`}/>)}
                    {Array.from({length:calDays.total}).map((_,i)=>{
                      const day=i+1;
                      const ds=`${calMonth.y}-${String(calMonth.m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                      const d=calDayMap[ds]; const ht=!!d;
                      const today=new Date().toISOString().split("T")[0]===ds;
                      return(
                        <div key={day} className="cal-cell" style={{
                          borderColor:today?"#3b82f6":ht?(d.pnl>=0?"rgba(74,222,128,0.25)":"rgba(248,113,113,0.25)"):"#141c26",
                          background:ht?(d.pnl>=0?"rgba(74,222,128,0.04)":"rgba(248,113,113,0.04)"):"transparent"
                        }}>
                          <div style={{fontSize:12,color:today?"#60a5fa":"#334155",marginBottom:6,fontWeight:today?600:400}}>{day}</div>
                          {ht&&(
                            <>
                              <div className="mono" style={{fontSize:13,fontWeight:500,color:d.pnl>=0?"#4ade80":"#f87171",marginBottom:2}}>{fmt$(d.pnl)}</div>
                              <div style={{fontSize:10,color:"#334155"}}>{d.count}t · {d.wins}W {d.losses}L</div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── ACCOUNTS ─── */}
        {view==="accounts"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:24}}>
              <div>
                <div className="page-title">Accounts</div>
                <div className="page-sub">{activeAccounts.length} active · {accounts.filter(a=>a.dormant).length} dormant</div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button className={`btn btn-ghost btn-sm`} onClick={()=>setShowDormant(p=>!p)}>{showDormant?"Hide Dormant":"Show Dormant"}</button>
                <button className="btn btn-primary btn-sm" onClick={()=>{setEditAccountIdx(null);setAccountForm(EMPTY_ACCOUNT);setShowAccountForm(true);}}>+ Add Account</button>
              </div>
            </div>
            {!accounts.length?(
              <div style={{textAlign:"center",padding:"80px 0"}}>
                <div style={{fontSize:14,color:"#4a5568",marginBottom:20}}>No accounts added yet</div>
                <button className="btn btn-primary" onClick={()=>setShowAccountForm(true)} style={{padding:"10px 24px"}}>Add First Account</button>
              </div>
            ):(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:12}}>
                {accountStats.filter(a=>showDormant||!a.dormant).map((a)=>{
                  const realIdx=accounts.findIndex(ac=>ac.id===a.id);
                  const ddColor=a.ddPct/a.ddLimit>0.7?"#f87171":a.ddPct/a.ddLimit>0.4?"#fbbf24":"#4ade80";
                  return(
                    <div key={a.id} className="card" style={{padding:22,opacity:a.dormant?0.55:1}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                            <div style={{fontSize:15,fontWeight:600,color:a.dormant?"#4a5568":"#e2e8f0"}}>{a.name}</div>
                            {a.dormant&&<span className="badge" style={{background:"rgba(251,191,36,0.1)",color:"#fbbf24",border:"1px solid rgba(251,191,36,0.2)"}}>Dormant</span>}
                          </div>
                          <div style={{fontSize:12,color:"#4a5568"}}>{a.firm} · <span style={{color:"#93c5fd"}}>{a.phase}</span></div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div className="mono" style={{fontSize:18,fontWeight:500,color:a.pnl>=0?"#4ade80":"#f87171"}}>{fmt$(a.pnl)}</div>
                          <div style={{fontSize:11,color:a.gainPct>=0?"#4ade80":"#f87171"}}>{a.gainPct>=0?"+":""}{a.gainPct.toFixed(2)}%</div>
                          <div style={{fontSize:11,color:"#334155"}}>Bal: <span className="mono" style={{color:"#94a3b8"}}>${a.currentBalance.toLocaleString(undefined,{maximumFractionDigits:0})}</span></div>
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
                        {[["Trades",a.tradeCount,"#e2e8f0"],["Win Rate",a.stats?`${a.stats.winRate.toFixed(0)}%`:"—",a.stats?.winRate>=50?"#4ade80":"#f87171"],["Avg R:R",a.stats?`${a.stats.avgRR.toFixed(1)}R`:"—","#93c5fd"]].map(([l,v,c])=>(
                          <div key={l} style={{background:"#090e14",border:"1px solid #141c26",borderRadius:7,padding:"10px 12px"}}>
                            <div className="section-title" style={{marginBottom:4}}>{l}</div>
                            <div className="mono" style={{fontSize:14,fontWeight:500,color:c}}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{marginBottom:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                          <span style={{fontSize:11,color:"#334155"}}>Drawdown</span>
                          <span className="mono" style={{fontSize:11,color:ddColor}}>{a.ddPct.toFixed(2)}% / {a.ddLimit}%</span>
                        </div>
                        <div className="bar-bg" style={{height:5}}><div style={{width:`${Math.min(100,(a.ddPct/a.ddLimit)*100)}%`,height:"100%",background:ddColor,borderRadius:3,transition:"width 0.3s"}}/></div>
                      </div>
                      <div style={{background:"#090e14",border:"1px solid #141c26",borderRadius:7,padding:"10px 14px",marginBottom:14}}>
                        <div className="section-title" style={{marginBottom:8}}>Financials</div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                          {[["Spent",fmt$(a.totalExpenses),"#f87171"],["Withdrawn",fmt$(a.totalPayouts),"#4ade80"],["Net",fmt$(a.netReal),a.netReal>=0?"#4ade80":"#f87171"]].map(([l,v,c])=>(
                            <div key={l}>
                              <div style={{fontSize:10,color:"#334155",marginBottom:3}}>{l}</div>
                              <div className="mono" style={{fontSize:13,fontWeight:500,color:c}}>{v}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                      {a.notes&&<div style={{fontSize:12,color:"#4a5568",borderLeft:"2px solid #1e2730",paddingLeft:10,marginBottom:14,fontStyle:"italic",lineHeight:1.5}}>{a.notes}</div>}
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={()=>openEditAccount(realIdx)} className="btn btn-ghost btn-sm">Edit</button>
                        <button onClick={()=>toggleDormant(realIdx)} className="btn btn-sm" style={{background:"transparent",color:a.dormant?"#4ade80":"#fbbf24",border:`1px solid ${a.dormant?"rgba(74,222,128,0.2)":"rgba(251,191,36,0.2)"}`,fontSize:11}}>{a.dormant?"Reactivate":"Set Dormant"}</button>
                        <button onClick={()=>deleteAccount(realIdx)} className="btn btn-danger btn-sm">Remove</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── JOURNAL ─── */}
        {view==="journal"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:24}}>
              <div>
                <div className="page-title">Journal</div>
                <div className="page-sub">{filteredTrades.length} entries</div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <Select value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} options={availableMonths.map(m=>m==="All"?{value:"All",label:"All Months"}:{value:m,label:m})} style={{width:140}}/>
                <Select value={filterOutcome} onChange={e=>setFilterOutcome(e.target.value)} options={["All",...OUTCOMES]} style={{width:120}}/>
                <Select value={filterAccount} onChange={e=>setFilterAccount(e.target.value)} options={[{value:"All",label:"All Accounts"},...activeAccounts.map(a=>({value:a.id,label:a.name}))]} style={{width:150}}/>
                <Select value={filterConfluence} onChange={e=>setFilterConfluence(e.target.value)} options={["All",...confluences]} style={{width:150}}/>
                <button className="btn btn-ghost btn-sm" onClick={()=>setShowConfluenceManager(true)}>⚙ Confluences</button>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {filteredTrades.map((t,i)=>{
                const oi=trades.indexOf(t);const pnl=parseFloat(t.pnl)||0;
                const accs=accounts.filter(a=>(t.accountIds||[]).includes(a.id));
                const duration=timeDiffMinutes(t.time,t.exitTime);
                return(
                  <div key={t.id||i} className="card" style={{padding:"16px 20px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <span style={{fontSize:12,color:"#64748b",fontWeight:500}}>
                          {t.date}
                          {t.time&&<span className="mono" style={{color:"#93c5fd",marginLeft:6}}>{t.time}</span>}
                          {t.exitTime&&<span className="mono" style={{color:"#334155"}}>→{t.exitTime}</span>}
                        </span>
                        {duration&&<span style={{fontSize:11,color:"#4a5568",background:"#0f161e",border:"1px solid #1e2730",padding:"2px 7px",borderRadius:5}}>{fmtDuration(duration)}</span>}
                        {t.asset&&<span style={{fontSize:11,color:"#93c5fd",background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.15)",padding:"2px 8px",borderRadius:5}}>{t.asset}</span>}
                        <span style={{fontSize:12,fontWeight:500,color:t.bias==="Bullish"?"#4ade80":"#f87171"}}>{t.bias==="Bullish"?"↑":"↓"} {t.bias}</span>
                        {t.rating&&<span style={{fontSize:12,fontWeight:600,color:ratingColor(t.rating)}}>{t.rating}</span>}
                        {accs.map(a=><span key={a.id} style={{fontSize:11,color:"#fbbf24",background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.2)",padding:"2px 8px",borderRadius:5}}>{a.name}</span>)}
                        {!t.followedPlan&&<span style={{fontSize:11,color:"#fbbf24"}}>⚠ Off-plan</span>}
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <div style={{textAlign:"right"}}>
                          <div className={`mono outcome-${t.outcome.toLowerCase()==="breakeven"?"be":t.outcome.toLowerCase()}`} style={{fontSize:17,fontWeight:500}}>{fmt$(pnl)}</div>
                          <div style={{fontSize:11,color:"#4a5568",display:"flex",gap:8,justifyContent:"flex-end"}}>
                            {t.rr&&<span className="mono">{parseFloat(t.rr)>=0?"+":""}{t.rr}R</span>}
                            {t.maxPotentialRR&&<span className="mono" style={{color:"#334155"}}>/ {t.maxPotentialRR}R max</span>}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:5}}>
                          <button onClick={()=>openEdit(oi)} className="btn btn-ghost btn-sm">Edit</button>
                          <button onClick={()=>deleteTrade(oi)} className="btn btn-danger btn-sm">Del</button>
                        </div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
                      {[["Entry",t.entry,"#94a3b8"],["Exit",t.exit,"#94a3b8"],["SL",t.stopLoss,"#f87171"],["TP",t.takeProfit,"#4ade80"],["Risk",`$${t.risk||250}`,"#64748b"],["Contracts",t.contracts,"#64748b"]].map(([l,v,c])=>(
                        <span key={l} style={{fontSize:12,color:"#334155"}}>{l}: <span className="mono" style={{color:c}}>{v||"—"}</span></span>
                      ))}
                    </div>
                    {(t.confluences||[]).length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:10}}>{t.confluences.map(c=><span key={c} className="tag">{c}</span>)}</div>}
                    {t.notes&&<div style={{marginTop:10,fontSize:12,color:"#4a5568",borderLeft:"2px solid #1e2730",paddingLeft:12,lineHeight:1.6}}>{t.notes}</div>}
                    {t.screenshot&&<div style={{marginTop:12}}><img src={t.screenshot} alt="chart" style={{maxHeight:160,borderRadius:8,border:"1px solid #1e2730",objectFit:"contain",cursor:"pointer"}} onClick={()=>setExpandedScreenshot(t)}/></div>}
                    <div style={{marginTop:12}}>
                      <button onClick={()=>runAiReview(t)} disabled={aiReviewLoading} className="btn btn-ghost btn-sm">
                        {aiReviewLoading?"Analysing...":"✦ AI Review"}
                      </button>
                    </div>
                    {t.aiReview&&<div className="review-box">{t.aiReview}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── ANALYTICS ─── */}
        {view==="analytics"&&(
          <div>
            <div style={{marginBottom:24}}>
              <div className="page-title">Analytics</div>
            </div>
            {!stats?(
              <div style={{textAlign:"center",padding:"80px 0",color:"#4a5568",fontSize:13}}>Log trades to see analytics</div>
            ):(
              <div style={{display:"grid",gridTemplateColumns:"190px 1fr",gap:16,alignItems:"start"}}>
                <div className="card" style={{padding:8,position:"sticky",top:72}}>
                  {ANALYTICS_SECTIONS.map(s=>(
                    <div key={s.id} className={`analytics-nav-item ${analyticsSection===s.id?"analytics-nav-active":"analytics-nav-inactive"}`} onClick={()=>setAnalyticsSection(s.id)}>{s.label}</div>
                  ))}
                </div>
                <div>
                  {analyticsSection==="rr"&&(
                    <div className="card">
                      <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:4}}>R:R Distribution</div>
                      <div style={{fontSize:12,color:"#4a5568",marginBottom:20}}>How often you close trades at each R level</div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
                        {RR_BUCKETS.map(b=>{const d=stats.rrDist[b];const wr=d.count?(d.wins/d.count)*100:0;return(
                          <div key={b} style={{background:"#090e14",border:`1px solid ${d.count>0?"#1e2730":"#141c26"}`,borderRadius:8,padding:"14px 12px",textAlign:"center"}}>
                            <div className="mono" style={{fontSize:12,fontWeight:500,color:d.count>0?"#93c5fd":"#1e2730",marginBottom:10}}>{b}</div>
                            <div className="mono" style={{fontSize:24,fontWeight:500,color:wr>=50?"#4ade80":d.count>0?"#f87171":"#1e2730",marginBottom:6}}>{d.count}</div>
                            <div style={{fontSize:11,color:"#334155",marginBottom:8}}>{d.count>0?`${wr.toFixed(0)}% WR`:"—"}</div>
                            {d.count>0&&<div className="bar-bg" style={{height:3}}><div style={{width:`${wr}%`,height:"100%",background:wr>=50?"#4ade80":"#f87171"}}/></div>}
                          </div>
                        );})}
                      </div>
                    </div>
                  )}
                  {analyticsSection==="hitrate"&&(
                    <div className="card">
                      <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:4}}>Cumulative Hit Rate</div>
                      <div style={{fontSize:12,color:"#4a5568",marginBottom:20}}>% of all trades that reached at least this R</div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
                        {RR_BUCKETS.map(b=>{const d=stats.rrHitRate[b];return(
                          <div key={b} style={{background:"#090e14",border:`1px solid ${d.count>0?"#1e2730":"#141c26"}`,borderRadius:8,padding:"14px 12px",textAlign:"center"}}>
                            <div className="mono" style={{fontSize:12,fontWeight:500,color:d.count>0?"#93c5fd":"#1e2730",marginBottom:10}}>{b}</div>
                            <div className="mono" style={{fontSize:24,fontWeight:500,color:d.pct>=70?"#4ade80":d.pct>=40?"#fbbf24":d.count>0?"#f87171":"#1e2730",marginBottom:6}}>{d.pct.toFixed(0)}%</div>
                            <div style={{fontSize:11,color:"#334155",marginBottom:8}}>{d.count} trades</div>
                            {d.count>0&&<div className="bar-bg" style={{height:3}}><div style={{width:`${d.pct}%`,height:"100%",background:"#3b82f6"}}/></div>}
                          </div>
                        );})}
                      </div>
                    </div>
                  )}
                  {analyticsSection==="potential"&&(
                    <div className="card">
                      <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:4}}>Achieved vs Potential R:R</div>
                      <div style={{fontSize:12,color:"#4a5568",marginBottom:20}}>How much R you left on the table</div>
                      {!stats.rrVsPotential.length?(
                        <div style={{textAlign:"center",padding:"40px 0",color:"#334155",fontSize:12}}>No potential R:R data yet — add Max Potential R:R when logging trades</div>
                      ):(
                        <>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:20}}>
                            {[["Avg Achieved",`${(stats.rrVsPotential.reduce((s,t)=>s+t.achieved,0)/stats.rrVsPotential.length).toFixed(2)}R`,"#4ade80"],["Avg Potential",`${(stats.rrVsPotential.reduce((s,t)=>s+t.potential,0)/stats.rrVsPotential.length).toFixed(2)}R`,"#93c5fd"],["Avg Left on Table",`${stats.avgLeft.toFixed(2)}R`,stats.avgLeft>1?"#f87171":"#fbbf24"]].map(([l,v,c])=>(
                              <div key={l} style={{background:"#090e14",border:"1px solid #141c26",borderRadius:8,padding:16,textAlign:"center"}}>
                                <div className="section-title" style={{marginBottom:8}}>{l}</div>
                                <div className="mono" style={{fontSize:22,fontWeight:500,color:c}}>{v}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            {stats.rrVsPotential.slice(0,20).map((t,i)=>(
                              <div key={i} style={{display:"grid",gridTemplateColumns:"100px 1fr 70px 70px 70px",gap:10,alignItems:"center",padding:"10px 14px",background:"#090e14",border:"1px solid #141c26",borderRadius:7}}>
                                <div style={{fontSize:11,color:"#4a5568"}}>{t.date}</div>
                                <div style={{position:"relative",height:6,background:"#141c26",borderRadius:3}}>
                                  <div style={{position:"absolute",left:0,width:`${Math.min(100,(t.potential/5)*100)}%`,height:"100%",background:"#1e3a5a",borderRadius:3}}/>
                                  <div style={{position:"absolute",left:0,width:`${Math.min(100,(Math.max(0,t.achieved)/5)*100)}%`,height:"100%",background:t.achieved>=0?"#4ade80":"#f87171",borderRadius:3}}/>
                                </div>
                                <div className="mono" style={{fontSize:12,color:"#4ade80",textAlign:"right"}}>+{t.achieved.toFixed(1)}R</div>
                                <div className="mono" style={{fontSize:12,color:"#93c5fd",textAlign:"right"}}>{t.potential.toFixed(1)}R</div>
                                <div className="mono" style={{fontSize:12,color:t.left>1?"#f87171":"#fbbf24",textAlign:"right"}}>-{t.left.toFixed(1)}R</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {analyticsSection==="direction"&&(
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <div className="card">
                        <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:4}}>Direction Split</div>
                        <div style={{fontSize:12,color:"#4a5568",marginBottom:20}}>Long vs short performance</div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                          {[["Longs ↑",stats.longs,stats.total,stats.longWR,"#4ade80","rgba(74,222,128,0.08)"],["Shorts ↓",stats.shorts,stats.total,stats.shortWR,"#f87171","rgba(248,113,113,0.08)"]].map(([label,count,total,wr,color,bg])=>(
                            <div key={label} style={{background:bg,border:`1px solid ${color=="#4ade80"?"rgba(74,222,128,0.15)":"rgba(248,113,113,0.15)"}`,borderRadius:8,padding:16}}>
                              <div style={{fontSize:14,color,marginBottom:14,fontWeight:600}}>{label}</div>
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
                                {[["Trades",count,"#e2e8f0"],["% Total",total?`${((count/total)*100).toFixed(0)}%`:"—","#64748b"],["Win Rate",`${wr.toFixed(0)}%`,wr>=50?"#4ade80":"#f87171"]].map(([l,v,c])=>(
                                  <div key={l}><div style={{fontSize:10,color:"#334155",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600}}>{l}</div><div className="mono" style={{fontSize:18,fontWeight:500,color:c}}>{v}</div></div>
                                ))}
                              </div>
                              <div className="bar-bg" style={{height:4}}><div style={{width:`${wr}%`,height:"100%",background:wr>=50?"#4ade80":"#f87171",borderRadius:3}}/></div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="card">
                        <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:4}}>Trade Duration</div>
                        <div style={{fontSize:12,color:"#4a5568",marginBottom:20}}>How long your trades last on average</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
                          {[["Avg Duration",fmtDuration(stats.avgDuration),"#e2e8f0"],["Avg Win Duration",fmtDuration(stats.avgWinDuration),"#4ade80"],["Avg Loss Duration",fmtDuration(stats.avgLossDuration),"#f87171"]].map(([l,v,c])=>(
                            <div key={l} style={{background:"#090e14",border:"1px solid #141c26",borderRadius:8,padding:16,textAlign:"center"}}>
                              <div className="section-title" style={{marginBottom:10}}>{l}</div>
                              <div className="mono" style={{fontSize:22,fontWeight:500,color:c}}>{v}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {analyticsSection==="ratings"&&(
                    <div className="card">
                      <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:4}}>Trade Ratings</div>
                      <div style={{fontSize:12,color:"#4a5568",marginBottom:20}}>Performance by setup quality grade</div>
                      {TRADE_RATINGS.filter(r=>stats.ratingMap[r]?.count>0).map(r=>{
                        const d=stats.ratingMap[r];const wr=(d.wins/(d.wins+d.losses||1))*100;
                        return(
                          <div key={r} style={{marginBottom:8,padding:"14px 18px",background:"#090e14",border:"1px solid #141c26",borderRadius:8}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                              <div style={{display:"flex",gap:14,alignItems:"center"}}>
                                <div className="mono" style={{fontSize:18,fontWeight:500,color:ratingColor(r),minWidth:32}}>{r}</div>
                                <div>
                                  <div style={{fontSize:13,color:"#94a3b8",marginBottom:2}}>{d.count} trades · {d.wins}W {d.losses}L</div>
                                  <div style={{fontSize:12,color:"#4a5568"}}>{wr.toFixed(0)}% win rate</div>
                                </div>
                              </div>
                              <div className="mono" style={{fontSize:16,fontWeight:500,color:d.pnl>=0?"#4ade80":"#f87171"}}>{fmt$(d.pnl)}</div>
                            </div>
                            <div className="bar-bg" style={{height:4}}><div style={{width:`${wr}%`,height:"100%",background:ratingColor(r),borderRadius:3}}/></div>
                          </div>
                        );
                      })}
                      {!TRADE_RATINGS.some(r=>stats.ratingMap[r]?.count>0)&&<div style={{textAlign:"center",padding:"40px 0",color:"#334155",fontSize:12}}>No rating data yet</div>}
                    </div>
                  )}
                  {analyticsSection==="confluence"&&(
                    <div className="card">
                      <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:4}}>Confluence Performance</div>
                      <div style={{fontSize:12,color:"#4a5568",marginBottom:20}}>Which confluences contribute most to wins</div>
                      {Object.entries(stats.confMap).filter(([,d])=>d.count>0).sort((a,b)=>b[1].pnl-a[1].pnl).map(([conf,d])=>{
                        const wr=(d.wins/(d.wins+d.losses||1))*100;
                        return(
                          <div key={conf} style={{marginBottom:8,padding:"14px 18px",background:"#090e14",border:"1px solid #141c26",borderRadius:8}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                              <div>
                                <div style={{fontSize:13,color:"#e2e8f0",fontWeight:500,marginBottom:4}}>{conf}</div>
                                <div style={{fontSize:12,color:"#4a5568"}}>{d.count} trades · {d.wins}W {d.losses}L</div>
                              </div>
                              <div style={{textAlign:"right"}}>
                                <div className="mono" style={{fontSize:16,fontWeight:500,color:d.pnl>=0?"#4ade80":"#f87171"}}>{fmt$(d.pnl)}</div>
                                <div style={{fontSize:12,color:wr>=50?"#4ade80":"#f87171"}}>{wr.toFixed(0)}% WR</div>
                              </div>
                            </div>
                            <div className="bar-bg" style={{height:4}}><div style={{width:`${wr}%`,height:"100%",background:wr>=50?"#4ade80":"#f87171",borderRadius:3}}/></div>
                          </div>
                        );
                      })}
                      {!Object.values(stats.confMap).some(d=>d.count>0)&&<div style={{textAlign:"center",padding:"40px 0",color:"#334155",fontSize:12}}>No confluence data yet</div>}
                    </div>
                  )}
                  {analyticsSection==="time"&&(
                    <div className="card">
                      <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:4}}>Time of Day — NY Open</div>
                      <div style={{fontSize:12,color:"#4a5568",marginBottom:20}}>Win rate and P&L by 5-minute slot, 9:30–10:30</div>
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        {TIME_SLOTS.map(slot=>{
                          const d=stats.timeMap[slot];if(!d)return null;
                          const wr=d.count?(d.wins/d.count)*100:0;
                          return(
                            <div key={slot} style={{display:"grid",gridTemplateColumns:"60px 1fr 58px 80px 88px",gap:10,alignItems:"center",padding:"9px 14px",background:"#090e14",border:`1px solid ${d.count>0?"#141c26":"transparent"}`,borderRadius:7}}>
                              <div className="mono" style={{fontSize:12,fontWeight:500,color:d.count>0?"#93c5fd":"#1e2730"}}>{slot}</div>
                              <div style={{height:5,background:d.count>0?"#141c26":"transparent",borderRadius:3,overflow:"hidden"}}>{d.count>0&&<div style={{width:`${wr}%`,height:"100%",background:wr>=50?"#4ade80":"#f87171",borderRadius:3}}/>}</div>
                              <div className="mono" style={{fontSize:12,fontWeight:500,color:wr>=50?"#4ade80":d.count>0?"#f87171":"#1e2730",textAlign:"right"}}>{d.count>0?`${wr.toFixed(0)}%`:"—"}</div>
                              <div style={{fontSize:11,color:"#334155",textAlign:"right"}}>{d.count>0?`${d.count} trade${d.count>1?"s":""}`:"—"}</div>
                              <div className="mono" style={{fontSize:11,fontWeight:500,color:d.pnl>=0?"#4ade80":d.count>0?"#f87171":"#1e2730",textAlign:"right"}}>{d.count>0?fmt$(d.pnl):"—"}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {analyticsSection==="summary"&&(
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        <div className="card">
                          <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:16}}>Best & Worst Days</div>
                          {stats.bestDay&&<div style={{marginBottom:10,padding:14,background:"#090e14",border:"1px solid rgba(74,222,128,0.15)",borderRadius:8}}>
                            <div className="section-title" style={{marginBottom:6}}>Best Day</div>
                            <div style={{fontSize:12,color:"#4a5568",marginBottom:4}}>{stats.bestDay[0]}</div>
                            <div className="mono" style={{fontSize:20,fontWeight:500,color:"#4ade80"}}>{fmt$(stats.bestDay[1].pnl)}</div>
                            <div style={{fontSize:11,color:"#334155",marginTop:4}}>{stats.bestDay[1].count} trades · {stats.bestDay[1].wins}W {stats.bestDay[1].losses}L</div>
                          </div>}
                          {stats.worstDay&&<div style={{padding:14,background:"#090e14",border:"1px solid rgba(248,113,113,0.15)",borderRadius:8}}>
                            <div className="section-title" style={{marginBottom:6}}>Worst Day</div>
                            <div style={{fontSize:12,color:"#4a5568",marginBottom:4}}>{stats.worstDay[0]}</div>
                            <div className="mono" style={{fontSize:20,fontWeight:500,color:"#f87171"}}>{fmt$(stats.worstDay[1].pnl)}</div>
                            <div style={{fontSize:11,color:"#334155",marginTop:4}}>{stats.worstDay[1].count} trades · {stats.worstDay[1].wins}W {stats.worstDay[1].losses}L</div>
                          </div>}
                        </div>
                        <div className="card">
                          <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:16}}>Day of Week</div>
                          {stats.mostActiveDay&&<div style={{marginBottom:10,padding:14,background:"#090e14",border:"1px solid #141c26",borderRadius:8}}>
                            <div className="section-title" style={{marginBottom:6}}>Most Active</div>
                            <div className="mono" style={{fontSize:18,fontWeight:500,color:"#fbbf24"}}>{stats.mostActiveDay[0]}</div>
                            <div style={{fontSize:11,color:"#334155",marginTop:4}}>{stats.mostActiveDay[1].count} trades</div>
                          </div>}
                          {stats.bestWRDay&&<div style={{padding:14,background:"#090e14",border:"1px solid #141c26",borderRadius:8}}>
                            <div className="section-title" style={{marginBottom:6}}>Best Win Rate</div>
                            <div className="mono" style={{fontSize:18,fontWeight:500,color:"#4ade80"}}>{stats.bestWRDay[0]}</div>
                            <div style={{fontSize:11,color:"#334155",marginTop:4}}>{((stats.bestWRDay[1].wins/(stats.bestWRDay[1].wins+stats.bestWRDay[1].losses||1))*100).toFixed(0)}% WR · {stats.bestWRDay[1].count} trades</div>
                          </div>}
                        </div>
                      </div>
                      <div className="card">
                        <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:16}}>Performance by Day of Week</div>
                        <div style={{display:"flex",flexDirection:"column",gap:5}}>
                          {Object.entries(stats.dowMap).filter(([,d])=>d.count>0).sort((a,b)=>b[1].pnl-a[1].pnl).map(([day,d])=>{
                            const wr=(d.wins/(d.wins+d.losses||1))*100;
                            return(
                              <div key={day} style={{display:"grid",gridTemplateColumns:"100px 1fr 50px 60px 90px",gap:10,alignItems:"center",padding:"10px 14px",background:"#090e14",border:"1px solid #141c26",borderRadius:7}}>
                                <div style={{fontSize:13,color:"#94a3b8",fontWeight:500}}>{day}</div>
                                <div className="bar-bg" style={{height:4}}><div style={{width:`${wr}%`,height:"100%",background:wr>=50?"#4ade80":"#f87171",borderRadius:3}}/></div>
                                <div style={{fontSize:11,color:"#334155",textAlign:"right"}}>{d.count}t</div>
                                <div className="mono" style={{fontSize:12,fontWeight:500,color:wr>=50?"#4ade80":"#f87171",textAlign:"right"}}>{wr.toFixed(0)}%</div>
                                <div className="mono" style={{fontSize:12,fontWeight:500,color:d.pnl>=0?"#4ade80":"#f87171",textAlign:"right"}}>{fmt$(d.pnl)}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  {analyticsSection==="metrics"&&(
                    <div className="card">
                      <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0",marginBottom:20}}>Key Metrics</div>
                      {[
                        ["Total Trades",stats.total,"#e2e8f0"],["Wins",stats.wins,"#4ade80"],["Losses",stats.losses,"#f87171"],
                        ["Breakeven",stats.total-stats.wins-stats.losses,"#fbbf24"],["Win Rate",`${stats.winRate.toFixed(1)}%`,stats.winRate>=50?"#4ade80":"#f87171"],
                        ["Avg Win",fmt$(stats.avgWin),"#4ade80"],["Avg Loss",fmt$(stats.avgLoss),"#f87171"],
                        ["Profit Factor",stats.profitFactor===999?"∞":stats.profitFactor.toFixed(2),stats.profitFactor>=1.5?"#4ade80":"#f87171"],
                        ["Avg R:R",`${stats.avgRR.toFixed(2)}R`,stats.avgRR>=1.5?"#4ade80":"#64748b"],["Max Drawdown",fmt$(stats.maxDD),"#f87171"],
                        ["Plan Adherence",`${stats.followedPlanRate.toFixed(0)}%`,stats.followedPlanRate>=70?"#4ade80":"#fbbf24"],
                        ["Longs",`${stats.longs} (${stats.total?((stats.longs/stats.total)*100).toFixed(0):0}%)`,"#4ade80"],
                        ["Shorts",`${stats.shorts} (${stats.total?((stats.shorts/stats.total)*100).toFixed(0):0}%)`,"#f87171"],
                        ["Avg Duration",fmtDuration(stats.avgDuration),"#e2e8f0"]
                      ].map(([l,v,c])=>(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"13px 0",borderBottom:"1px solid #0f161e"}}>
                          <span style={{fontSize:13,color:"#4a5568"}}>{l}</span>
                          <span className="mono" style={{fontSize:16,fontWeight:500,color:c}}>{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── SCREENSHOTS ─── */}
        {view==="screenshots"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:24}}>
              <div>
                <div className="page-title">Screenshots</div>
                <div className="page-sub">{galleryTrades.length} charts</div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <Select value={galleryFilter.outcome} onChange={e=>setGalleryFilter(f=>({...f,outcome:e.target.value}))} options={["All",...OUTCOMES]} style={{width:120}}/>
                <Select value={galleryFilter.confluence} onChange={e=>setGalleryFilter(f=>({...f,confluence:e.target.value}))} options={["All",...confluences]} style={{width:150}}/>
              </div>
            </div>
            {!galleryTrades.length?(
              <div style={{textAlign:"center",padding:"80px 0",color:"#4a5568",fontSize:13}}>No screenshots yet</div>
            ):(
              <div className="gallery-grid">
                {galleryTrades.map((t,i)=>{
                  const pnl=parseFloat(t.pnl)||0;const accs=accounts.filter(a=>(t.accountIds||[]).includes(a.id));
                  return(
                    <div key={t.id||i} className="gallery-item" onClick={()=>setExpandedScreenshot(t)}>
                      <div style={{position:"relative"}}>
                        <img src={t.screenshot} alt="trade" style={{width:"100%",height:150,objectFit:"cover",display:"block"}}/>
                        <div style={{position:"absolute",top:8,right:8,background:"rgba(6,10,15,0.85)",backdropFilter:"blur(4px)",borderRadius:5,padding:"3px 9px"}}>
                          <span className="mono" style={{fontSize:12,fontWeight:500,color:t.outcome==="Win"?"#4ade80":t.outcome==="Loss"?"#f87171":"#fbbf24"}}>{fmt$(pnl)}</span>
                        </div>
                        <div style={{position:"absolute",top:8,left:8,background:"rgba(6,10,15,0.85)",backdropFilter:"blur(4px)",borderRadius:5,padding:"3px 9px"}}>
                          <span style={{fontSize:11,color:t.bias==="Bullish"?"#4ade80":"#f87171"}}>{t.bias==="Bullish"?"↑":"↓"} {t.bias}</span>
                        </div>
                        {t.rating&&<div style={{position:"absolute",bottom:8,right:8,background:"rgba(6,10,15,0.85)",borderRadius:5,padding:"2px 8px"}}>
                          <span style={{fontSize:11,fontWeight:600,color:ratingColor(t.rating)}}>{t.rating}</span>
                        </div>}
                      </div>
                      <div style={{padding:"10px 14px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                          <span style={{fontSize:12,color:"#4a5568"}}>{t.date}{t.time&&<span className="mono" style={{color:"#93c5fd",marginLeft:6}}>{t.time}</span>}</span>
                          {t.rr&&<span className="mono" style={{fontSize:11,color:"#4a5568"}}>{t.rr}R</span>}
                        </div>
                        {(t.confluences||[]).length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4}}>{t.confluences.slice(0,3).map(c=><span key={c} className="tag">{c}</span>)}{t.confluences.length>3&&<span className="tag">+{t.confluences.length-3}</span>}</div>}
                        {accs.length>0&&<div style={{fontSize:11,color:"#fbbf24"}}>{accs.map(a=>a.name).join(", ")}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── FINANCIALS ─── */}
        {view==="financials"&&(
          <div>
            <div style={{marginBottom:24}}>
              <div className="page-title">Financials</div>
              <div className="page-sub">Prop firm expenses and payouts</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
              {[["Total Spent on Fees",fmt$(financialsSummary.totalExpenses),"#f87171"],["Total Withdrawn",fmt$(financialsSummary.totalPayouts),"#4ade80"],["Net Real Profit",fmt$(financialsSummary.net),financialsSummary.net>=0?"#4ade80":"#f87171"]].map(([l,v,c])=>(
                <div key={l} className="card" style={{padding:24}}>
                  <div className="section-title" style={{marginBottom:10}}>{l}</div>
                  <div className="mono" style={{fontSize:28,fontWeight:500,color:c}}>{v}</div>
                </div>
              ))}
            </div>
            <div className="card" style={{marginBottom:16,padding:24}}>
              <div style={{fontSize:14,fontWeight:600,color:"#e2e8f0",marginBottom:16}}>Log Transaction</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:10}}>
                <div><label style={lbl}>Type</label><Select value={newTransaction.type} onChange={e=>setNewTransaction(t=>({...t,type:e.target.value}))} options={[{value:"expense",label:"Expense / Fee"},{value:"payout",label:"Payout / Withdrawal"}]}/></div>
                <div><label style={lbl}>Amount ($)</label><input type="number" value={newTransaction.amount} onChange={e=>setNewTransaction(t=>({...t,amount:e.target.value}))} style={inp} placeholder="0.00"/></div>
                <div><label style={lbl}>Date</label><input type="date" value={newTransaction.date} onChange={e=>setNewTransaction(t=>({...t,date:e.target.value}))} style={inp}/></div>
                <div><label style={lbl}>Account (optional)</label><Select value={newTransaction.accountId||""} onChange={e=>setNewTransaction(t=>({...t,accountId:e.target.value}))} options={[{value:"",label:"No account"},...accounts.map(a=>({value:a.id,label:a.name}))]}/></div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <input value={newTransaction.notes} onChange={e=>setNewTransaction(t=>({...t,notes:e.target.value}))} style={{...inp,flex:1}} placeholder='e.g. "FTMO 50K challenge fee", "First payout from Apex"...'/>
                <button className="btn btn-primary" onClick={()=>{if(!newTransaction.amount)return;setTransactions(prev=>[...prev,{...newTransaction,id:Date.now()}]);setNewTransaction(EMPTY_TRANSACTION);showToast("Transaction logged");}}>Add</button>
              </div>
            </div>
            <div className="card" style={{padding:24}}>
              <div style={{fontSize:14,fontWeight:600,color:"#e2e8f0",marginBottom:16}}>Transaction Log</div>
              {!transactions.length?(
                <div style={{textAlign:"center",padding:"40px 0",color:"#334155",fontSize:13}}>No transactions yet</div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {[...transactions].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(tx=>{
                    const linkedAcc=tx.accountId?accounts.find(a=>a.id===tx.accountId):null;
                    return(
                      <div key={tx.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",background:"#090e14",border:`1px solid ${tx.type==="expense"?"rgba(248,113,113,0.12)":"rgba(74,222,128,0.12)"}`,borderRadius:8}}>
                        <div style={{display:"flex",gap:12,alignItems:"center"}}>
                          <span className="badge" style={{background:tx.type==="expense"?"rgba(248,113,113,0.1)":"rgba(74,222,128,0.1)",color:tx.type==="expense"?"#f87171":"#4ade80",border:`1px solid ${tx.type==="expense"?"rgba(248,113,113,0.2)":"rgba(74,222,128,0.2)"}`}}>{tx.type==="expense"?"Expense":"Payout"}</span>
                          <span className="mono" style={{fontSize:12,color:"#64748b"}}>{tx.date}</span>
                          {linkedAcc&&<span style={{fontSize:11,color:"#fbbf24",background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.15)",padding:"2px 8px",borderRadius:5}}>{linkedAcc.name}</span>}
                          {tx.notes&&<span style={{fontSize:12,color:"#4a5568",fontStyle:"italic"}}>{tx.notes}</span>}
                        </div>
                        <div style={{display:"flex",gap:12,alignItems:"center"}}>
                          <span className="mono" style={{fontSize:15,fontWeight:500,color:tx.type==="expense"?"#f87171":"#4ade80"}}>{tx.type==="expense"?"-":"+"}${parseFloat(tx.amount).toFixed(2)}</span>
                          <button onClick={()=>setTransactions(prev=>prev.filter(t=>t.id!==tx.id))} className="btn btn-danger btn-sm">Del</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── EXPANDED SCREENSHOT ─── */}
      {expandedScreenshot&&(
        <div className="overlay" onClick={()=>setExpandedScreenshot(null)}>
          <div className="modal" style={{maxWidth:1000}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div style={{fontSize:15,fontWeight:600,color:"#e2e8f0"}}>{expandedScreenshot.date} {expandedScreenshot.time}{expandedScreenshot.exitTime&&` → ${expandedScreenshot.exitTime}`}</div>
                <span className="mono" style={{fontSize:16,fontWeight:500,color:expandedScreenshot.outcome==="Win"?"#4ade80":expandedScreenshot.outcome==="Loss"?"#f87171":"#fbbf24"}}>{fmt$(parseFloat(expandedScreenshot.pnl)||0)}</span>
                {expandedScreenshot.rating&&<span style={{fontSize:13,fontWeight:600,color:ratingColor(expandedScreenshot.rating)}}>{expandedScreenshot.rating}</span>}
              </div>
              <button onClick={()=>setExpandedScreenshot(null)} style={{background:"none",border:"none",color:"#4a5568",fontSize:20,cursor:"pointer",lineHeight:1}}>✕</button>
            </div>
            <img src={expandedScreenshot.screenshot} alt="chart" style={{width:"100%",borderRadius:10,border:"1px solid #1e2730",marginBottom:16}}/>
            <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:12}}>
              {[["Asset",expandedScreenshot.asset||"MNQ","#93c5fd"],["Entry",expandedScreenshot.entry,"#e2e8f0"],["Exit",expandedScreenshot.exit,"#e2e8f0"],["SL",expandedScreenshot.stopLoss,"#f87171"],["TP",expandedScreenshot.takeProfit,"#4ade80"],["R:R",expandedScreenshot.rr?expandedScreenshot.rr+"R":null,"#64748b"],["Max R:R",expandedScreenshot.maxPotentialRR?expandedScreenshot.maxPotentialRR+"R":null,"#4a5568"],["Risk",`$${expandedScreenshot.risk||250}`,"#64748b"]].map(([l,v,c])=>(
                v&&<span key={l} style={{fontSize:12,color:"#4a5568"}}>{l}: <span className="mono" style={{color:c}}>{v}</span></span>
              ))}
            </div>
            {(expandedScreenshot.confluences||[]).length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:10}}>{expandedScreenshot.confluences.map(c=><span key={c} className="tag">{c}</span>)}</div>}
            {expandedScreenshot.notes&&<div style={{fontSize:12,color:"#4a5568",fontStyle:"italic",borderLeft:"2px solid #1e2730",paddingLeft:12,lineHeight:1.6}}>{expandedScreenshot.notes}</div>}
          </div>
        </div>
      )}

      {/* ─── CONFLUENCE MANAGER ─── */}
      {showConfluenceManager&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowConfluenceManager(false);}}>
          <div className="modal" style={{maxWidth:480}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
              <div style={{fontSize:16,fontWeight:600,color:"#e2e8f0"}}>Manage Confluences</div>
              <button onClick={()=>setShowConfluenceManager(false)} style={{background:"none",border:"none",color:"#4a5568",fontSize:20,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <input value={newConfluence} onChange={e=>setNewConfluence(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newConfluence.trim()){setConfluences(prev=>[...prev,newConfluence.trim()]);setNewConfluence("");}}} style={{...inp,flex:1}} placeholder="Add new confluence..."/>
              <button className="btn btn-primary" onClick={()=>{if(newConfluence.trim()){setConfluences(prev=>[...prev,newConfluence.trim()]);setNewConfluence("");}}} style={{padding:"9px 18px"}}>Add</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:400,overflowY:"auto"}}>
              {confluences.map((c,i)=>(
                <div key={c} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"#090e14",border:"1px solid #141c26",borderRadius:7}}>
                  <span style={{fontSize:13,color:"#94a3b8"}}>{c}</span>
                  <button onClick={()=>setConfluences(prev=>prev.filter((_,j)=>j!==i))} className="btn btn-danger btn-sm">Remove</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── ACCOUNT FORM ─── */}
      {showAccountForm&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget){setShowAccountForm(false);setEditAccountIdx(null);}}}>
          <div className="modal" style={{maxWidth:560}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
              <div style={{fontSize:16,fontWeight:600,color:"#e2e8f0"}}>{editAccountIdx!==null?"Edit Account":"Add Account"}</div>
              <button onClick={()=>{setShowAccountForm(false);setEditAccountIdx(null);}} style={{background:"none",border:"none",color:"#4a5568",fontSize:20,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{gridColumn:"1/-1"}}><label style={lbl}>Account Name</label><input value={accountForm.name} onChange={e=>saf("name",e.target.value)} style={inp} placeholder='e.g. "FTMO 50K #1"'/></div>
              <div style={{gridColumn:"1/-1"}}><label style={lbl}>Prop Firm</label><FirmInput value={accountForm.firm} onChange={v=>saf("firm",v)} firms={propFirms}/><div style={{fontSize:11,color:"#334155",marginTop:4}}>Type your own — saved for next time</div></div>
              <div><label style={lbl}>Phase</label><Select value={accountForm.phase} onChange={e=>saf("phase",e.target.value)} options={["Phase 1","Phase 2","Funded","Verification"]}/></div>
              <div><label style={lbl}>Max Total Drawdown (%)</label><input type="number" value={accountForm.maxTotalDrawdown} onChange={e=>saf("maxTotalDrawdown",e.target.value)} style={inp} placeholder="10"/></div>
              <div><label style={lbl}>Account Size ($)</label><input type="number" value={accountForm.size} onChange={e=>saf("size",e.target.value)} style={inp} placeholder="50000"/></div>
              <div><label style={lbl}>Starting Balance ($)</label><input type="number" value={accountForm.startingBalance} onChange={e=>saf("startingBalance",e.target.value)} style={inp} placeholder="50000"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={lbl}>Notes</label><input value={accountForm.notes} onChange={e=>saf("notes",e.target.value)} style={inp} placeholder="Any notes..."/></div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:24}}>
              <button onClick={handleAccountSubmit} className="btn btn-primary" style={{flex:1,padding:11}}>{editAccountIdx!==null?"Update Account":"Add Account"}</button>
              <button onClick={()=>{setShowAccountForm(false);setEditAccountIdx(null);}} className="btn btn-ghost" style={{padding:"11px 22px"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── LOG TRADE FORM ─── */}
      {showForm&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget){setShowForm(false);setEditIdx(null);}}}>
          <div className="modal" style={{maxWidth:740}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
              <div style={{fontSize:16,fontWeight:600,color:"#e2e8f0"}}>{editIdx!==null?"Edit Trade":"Log Trade"}</div>
              <button onClick={()=>{setShowForm(false);setEditIdx(null);}} style={{background:"none",border:"none",color:"#4a5568",fontSize:20,cursor:"pointer"}}>✕</button>
            </div>

            {/* Screenshot drop zone */}
            <div className="dz" style={{marginBottom:18}} onClick={()=>!aiLoading&&fileRef.current?.click()}
              onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="#3b82f6";}}
              onDragLeave={e=>{e.currentTarget.style.borderColor="#1e2730";}}
              onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="#1e2730";const f=e.dataTransfer.files[0];if(f)handleScreenshot(f);}}>
              {screenshotPreview?(
                <div style={{position:"relative"}}>
                  <img src={screenshotPreview} alt="chart" style={{maxHeight:160,objectFit:"contain",borderRadius:8,width:"100%"}}/>
                  <div style={{position:"absolute",top:8,right:8,background:"rgba(6,10,15,0.85)",borderRadius:5,padding:"3px 10px",fontSize:11,color:"#4ade80",fontWeight:500}}>✓ Chart attached</div>
                </div>
              ):aiLoading?(
                <div className="pulse" style={{color:"#93c5fd",fontSize:13}}>✦ AI extracting trade levels...</div>
              ):(
                <>
                  <div style={{fontSize:24,marginBottom:8}}>📊</div>
                  <div style={{color:"#4a5568",fontSize:13}}>Drop TradingView screenshot · AI auto-fills entry, SL, TP and R</div>
                  <div style={{color:"#334155",fontSize:11,marginTop:4}}>or click to browse</div>
                </>
              )}
              <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleScreenshot(e.target.files[0])}/>
            </div>

            <div style={{marginBottom:16}}>
              <AccountCheckboxes accounts={activeAccounts} selected={form.accountIds||[]} onChange={v=>sf("accountIds",v)} label="Accounts"/>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label style={lbl}>Asset</label><Select value={form.asset||"MNQ"} onChange={e=>sf("asset",e.target.value)} options={ASSETS}/></div>
              <div><label style={lbl}>Trade Rating</label><Select value={form.rating||"A"} onChange={e=>sf("rating",e.target.value)} options={TRADE_RATINGS}/></div>
              {[["Date","date","date"],["Entry Time","time","time"],["Exit Time","exitTime","time"],["Entry Price","entry","number"],["Exit Price","exit","number"],["Stop Loss","stopLoss","number"],["Take Profit","takeProfit","number"],["Contracts","contracts","number"]].map(([l,k,t])=>(
                <div key={k}><label style={lbl}>{l}</label><input type={t} value={form[k]} onChange={e=>sf(k,e.target.value)} style={inp}/></div>
              ))}
              <div><label style={lbl}>Risk ($) <span style={{color:"#334155",fontStyle:"italic",textTransform:"none",letterSpacing:0,fontWeight:400}}>defaults $250</span></label><input type="number" value={form.risk} onChange={e=>sf("risk",e.target.value)} style={inp} placeholder="250"/></div>
              <div><label style={lbl}>P&L ($) <span style={{color:"#334155",fontStyle:"italic",textTransform:"none",letterSpacing:0,fontWeight:400}}>auto-calculates R:R</span></label><input type="number" value={form.pnl} onChange={e=>sf("pnl",e.target.value)} style={inp}/></div>
              <div><label style={lbl}>R:R Achieved <span style={{color:"#334155",fontStyle:"italic",textTransform:"none",letterSpacing:0,fontWeight:400}}>auto-filled</span></label><input type="number" value={form.rr} onChange={e=>sf("rr",e.target.value)} style={inp} placeholder="auto"/></div>
              <div><label style={lbl}>Max Potential R:R</label><input type="number" value={form.maxPotentialRR} onChange={e=>sf("maxPotentialRR",e.target.value)} style={inp} placeholder="e.g. 3"/></div>
              <div><label style={lbl}>Outcome <span style={{color:"#334155",fontStyle:"italic",textTransform:"none",letterSpacing:0,fontWeight:400}}>auto-set</span></label><Select value={form.outcome} onChange={e=>sf("outcome",e.target.value)} options={OUTCOMES}/></div>
              {[["Bias","bias",BIASES],["Emotion","emotion",EMOTIONS]].map(([l,k,opts])=>(
                <div key={k}><label style={lbl}>{l}</label><Select value={form[k]} onChange={e=>sf(k,e.target.value)} options={opts}/></div>
              ))}
            </div>

            <div style={{marginTop:14}}>
              <label style={{...lbl,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span>Confluences ({(form.confluences||[]).length} selected)</span>
                <button onClick={()=>setShowConfluenceManager(true)} style={{background:"none",border:"none",color:"#3b82f6",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>+ Manage</button>
              </label>
              <ConfluenceCheckboxes selected={form.confluences||[]} onChange={v=>sf("confluences",v)} confluences={confluences}/>
            </div>

            <div style={{marginTop:14}}><label style={lbl}>Notes</label><textarea value={form.notes} onChange={e=>sf("notes",e.target.value)} style={{...inp,minHeight:70,resize:"vertical",lineHeight:1.6}} placeholder="IFVG formed during NY open, entered on retest..."/></div>

            <div style={{marginTop:12,display:"flex",alignItems:"center",gap:10}}>
              <input type="checkbox" id="fp" checked={form.followedPlan} onChange={e=>sf("followedPlan",e.target.checked)} style={{accentColor:"#3b82f6",width:14,height:14,cursor:"pointer"}}/>
              <label htmlFor="fp" style={{fontSize:12,color:"#4a5568",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>Followed trading plan</label>
            </div>

            <div style={{display:"flex",gap:8,marginTop:24}}>
              <button onClick={handleSubmit} className="btn btn-primary" style={{flex:1,padding:11,fontSize:13}}>{editIdx!==null?"Update Trade":"Log Trade"}</button>
              <button onClick={()=>{setShowForm(false);setEditIdx(null);}} className="btn btn-ghost" style={{padding:"11px 22px",fontSize:13}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── IMPORT MODAL ─── */}
      {showImportModal&&importPreview&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowImportModal(false);}}>
          <div className="modal">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
              <div>
                <div style={{fontSize:16,fontWeight:600,color:"#e2e8f0",marginBottom:4}}>Import Trades</div>
                <div style={{fontSize:12,color:"#4a5568"}}>{importFileName} · {importPreview.length} trades · commissions auto-deducted</div>
              </div>
              <button onClick={()=>setShowImportModal(false)} style={{background:"none",border:"none",color:"#4a5568",fontSize:20,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:20}}>
              <div style={{overflowX:"auto",maxHeight:360,overflowY:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead style={{position:"sticky",top:0,background:"#0c1117"}}>
                    <tr style={{borderBottom:"1px solid #141c26"}}>
                      {["Date","Time","Asset","Dir","Entry","Exit","Qty","Net P&L","Outcome"].map(h=><th key={h} style={{padding:"7px 10px",fontWeight:600,fontSize:10,textAlign:"left",color:"#334155",textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.map((t,i)=>{
                      const pnl=parseFloat(t.pnl)||0;
                      return(
                        <tr key={i} style={{borderBottom:"1px solid #0f161e"}}>
                          <td style={{padding:"7px 10px",color:"#64748b"}}>{t.date}</td>
                          <td style={{padding:"7px 10px"}}><span className="mono" style={{color:"#93c5fd"}}>{t.time}</span></td>
                          <td style={{padding:"7px 10px"}}><span className="mono" style={{color:"#93c5fd"}}>{t.asset||"MNQ"}</span></td>
                          <td style={{padding:"7px 10px",color:t.bias==="Bullish"?"#4ade80":"#f87171"}}>{t.bias==="Bullish"?"↑":"↓"}</td>
                          <td style={{padding:"7px 10px"}}><span className="mono" style={{color:"#94a3b8"}}>{t.entry}</span></td>
                          <td style={{padding:"7px 10px"}}><span className="mono" style={{color:"#94a3b8"}}>{t.exit}</span></td>
                          <td style={{padding:"7px 10px",color:"#4a5568"}}>{t.contracts}</td>
                          <td style={{padding:"7px 10px"}}><span className="mono" style={{fontWeight:500,color:pnl>=0?"#4ade80":"#f87171"}}>{fmt$(pnl)}</span></td>
                          <td style={{padding:"7px 10px"}}><span style={{fontSize:10,fontWeight:600,color:t.outcome==="Win"?"#4ade80":t.outcome==="Loss"?"#f87171":"#fbbf24"}}>{t.outcome}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div>
                <AccountCheckboxes accounts={activeAccounts} selected={importSelectedAccounts} onChange={setImportSelectedAccounts} label="Apply to accounts"/>
                {importSelectedAccounts.length>0&&<div style={{marginTop:10,background:"#090e14",border:"1px solid #141c26",borderRadius:7,padding:"10px 14px",fontSize:12,color:"#4a5568"}}>{importPreview.length} trades → <span style={{color:"#fbbf24",fontWeight:500}}>{importSelectedAccounts.length} account{importSelectedAccounts.length>1?"s":""}</span></div>}
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={confirmTradovateImport} className="btn btn-success" style={{flex:1,padding:11,fontSize:13}} disabled={!importSelectedAccounts.length}>
                Confirm Import → {importSelectedAccounts.length} account{importSelectedAccounts.length!==1?"s":""}
              </button>
              <button onClick={()=>setShowImportModal(false)} className="btn btn-ghost" style={{padding:"11px 22px"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
