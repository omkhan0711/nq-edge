import { useState, useEffect, useMemo, useRef, useCallback } from "react";

const fmt$ = v => { const a = Math.abs(v); return (v < 0 ? "-$" : "$") + a.toFixed(2); };
const OUTCOMES = ["Win","Loss","Breakeven"];
const BIASES = ["Bullish","Bearish","Neutral"];
const EMOTIONS = ["Calm","Anxious","Confident","Revenge","FOMO","Disciplined","Tired"];
const RR_BUCKETS = ["0.5R","1R","1.5R","2R","2.5R","3R","3.5R","4R","4.5R","5R+"];
const CONTRACT_MULTIPLIERS = { MNQ:2, NQ:20, MES:5, ES:50 };
const DEFAULT_CONFLUENCES = ["IFVG","SMT","Liquidity Sweep","5-minute FVG Delivery","15-minute FVG Delivery","1-hour FVG Delivery","4-hour FVG Delivery","Order Block","Judas Swing","Premium/Discount","Macro"];
const DEFAULT_FIRMS = ["FTMO","Funded Trading Plus","The Funded Trader","MyForexFunds","E8 Funding","True Forex Funds","Apex Trader Funding","TopStep","Tradovate"];
const BE_TOLERANCE = 0.20;
const TIME_SLOTS = [];
for (let h=9;h<=10;h++) for (let m=0;m<60;m+=5) { if(h===10&&m>30)break; TIME_SLOTS.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`); }

const EMPTY = { date:new Date().toISOString().split("T")[0], time:"", bias:"Bullish", entry:"", exit:"", stopLoss:"", takeProfit:"", contracts:"1", outcome:"Win", pnl:"", rr:"", risk:"250", notes:"", emotion:"Calm", followedPlan:true, screenshot:"", aiReview:"", accountIds:[], confluences:[] };
const EMPTY_ACCOUNT = { id:"", name:"", firm:"", size:"50000", startingBalance:"50000", maxTotalDrawdown:"10", phase:"Funded", notes:"" };

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

const SEL_STYLE = { width:"100%", background:"#0d1520", border:"1px solid #2a3a50", borderRadius:3, padding:"8px 10px", color:"#cdd6e0", fontSize:12, fontFamily:"inherit", cursor:"pointer", appearance:"none", WebkitAppearance:"none", outline:"none" };

function Select({ value, onChange, options, style }) {
  return (
    <div style={{ position:"relative" }}>
      <select value={value} onChange={onChange} style={{ ...SEL_STYLE, ...style }}>
        {options.map(o => typeof o==="string"
          ? <option key={o} value={o} style={{ background:"#0d1520", color:"#cdd6e0" }}>{o}</option>
          : <option key={o.value} value={o.value} style={{ background:"#0d1520", color:"#cdd6e0" }}>{o.label}</option>)}
      </select>
      <div style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", pointerEvents:"none", color:"#5a6a7a", fontSize:10 }}>▼</div>
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
      <input value={input} onChange={e => { setInput(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        style={{ width:"100%", background:"#0d1520", border:"1px solid #2a3a50", borderRadius:3, padding:"8px 10px", color:"#cdd6e0", fontSize:12, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}
        placeholder="Type or select prop firm..." />
      {open && filtered.length > 0 && (
        <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"#0d1520", border:"1px solid #2a3a50", borderRadius:3, zIndex:300, maxHeight:160, overflowY:"auto" }}>
          {filtered.map(f => (
            <div key={f} onClick={() => { setInput(f); onChange(f); setOpen(false); }}
              style={{ padding:"8px 12px", fontSize:12, color:"#cdd6e0", cursor:"pointer", borderBottom:"1px solid #1a2535" }}
              onMouseEnter={e => e.currentTarget.style.background="#1a2535"}
              onMouseLeave={e => e.currentTarget.style.background="transparent"}>{f}</div>
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
        <div key={c} onClick={() => toggle(c)} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", background:selected.includes(c)?"#0d1a2a":"#060a0f", border:`1px solid ${selected.includes(c)?"#60a5fa":"#1a2535"}`, borderRadius:3, cursor:"pointer", transition:"all 0.15s" }}>
          <div style={{ width:12, height:12, borderRadius:2, border:`1px solid ${selected.includes(c)?"#60a5fa":"#2a3a50"}`, background:selected.includes(c)?"#60a5fa":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            {selected.includes(c) && <div style={{ width:6, height:6, background:"#060a0f", borderRadius:1 }}/>}
          </div>
          <span style={{ fontSize:11, color:selected.includes(c)?"#60a5fa":"#4a6a8a" }}>{c}</span>
        </div>
      ))}
    </div>
  );
}

function AccountCheckboxes({ accounts, selected, onChange, label }) {
  const toggle = id => onChange(selected.includes(id) ? selected.filter(x=>x!==id) : [...selected,id]);
  const toggleAll = () => onChange(selected.length===accounts.length ? [] : accounts.map(a=>a.id));
  return (
    <div>
      {label && <div style={{ fontSize:9, color:"#4a6a8a", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:8 }}>{label}</div>}
      {!accounts.length
        ? <div style={{ fontSize:11, color:"#3a5a7a", padding:"10px", background:"#060a0f", border:"1px solid #1a2535", borderRadius:3 }}>No accounts added yet</div>
        : <>
          <div onClick={toggleAll} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:"#060a0f", border:"1px solid #1a2535", borderRadius:3, cursor:"pointer", marginBottom:6 }}>
            <div style={{ width:13, height:13, borderRadius:2, border:`1px solid ${selected.length===accounts.length?"#f0b429":"#2a3a50"}`, background:selected.length===accounts.length?"#f0b429":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {selected.length===accounts.length && <div style={{ width:7, height:7, background:"#060a0f", borderRadius:1 }}/>}
            </div>
            <span style={{ fontSize:11, color:"#8a9ab8", fontStyle:"italic" }}>Select all accounts</span>
          </div>
          {accounts.map(a => (
            <div key={a.id} onClick={() => toggle(a.id)} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", background:selected.includes(a.id)?"#0d1a2a":"#060a0f", border:`1px solid ${selected.includes(a.id)?"#f0b429":"#1a2535"}`, borderRadius:3, cursor:"pointer", transition:"all 0.15s", marginBottom:5 }}>
              <div style={{ width:13, height:13, borderRadius:2, border:`1px solid ${selected.includes(a.id)?"#f0b429":"#2a3a50"}`, background:selected.includes(a.id)?"#f0b429":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                {selected.includes(a.id) && <div style={{ width:7, height:7, background:"#060a0f", borderRadius:1 }}/>}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, color:selected.includes(a.id)?"#f0b429":"#cdd6e0" }}>{a.name}</div>
                <div style={{ fontSize:9, color:"#3a5a7a" }}>{a.firm} · {a.phase} · ${parseInt(a.startingBalance||a.size).toLocaleString()} starting</div>
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
    let totalEntryQty=0,totalEntryVal=0;
    entryOrders.forEach(r=>{const qty=parseFloat(get(r,"Filled Qty"))||0;const price=parseFloat(get(r,"Avg Fill Price"))||0;totalEntryQty+=qty;totalEntryVal+=qty*price;});
    const avgEntry=totalEntryQty?totalEntryVal/totalEntryQty:0;
    let totalExitQty=0,totalExitVal=0;
    exitOrders.forEach(r=>{const qty=parseFloat(get(r,"Filled Qty"))||0;const price=parseFloat(get(r,"Avg Fill Price"))||0;totalExitQty+=qty;totalExitVal+=qty*price;});
    const avgExit=totalExitQty?totalExitVal/totalExitQty:0;
    const contracts=Math.min(totalEntryQty,totalExitQty);
    const pnl=isShort?(avgEntry-avgExit)*contracts*multiplier:(avgExit-avgEntry)*contracts*multiplier;
    const fillTime=get(orders[0],"Fill Time");
    const timePart=fillTime.split(" ")[1]?.substring(0,5)||"";
    const dateParts=fillTime.split(" ")[0]?.split("/")||[];
    const tradeDate=dateParts.length===3?`${dateParts[2]}-${dateParts[0].padStart(2,"0")}-${dateParts[1].padStart(2,"0")}`:new Date().toISOString().split("T")[0];
    const stopOrder=orders.find(r=>get(r,"Type").trim()==="Stop"&&get(r,"Stop Price"));
    const limitOrder=orders.find(r=>get(r,"Type").trim()==="Limit"&&get(r,"Limit Price"));
    trades.push({ ...EMPTY, id:Date.now()+Math.random(), date:tradeDate, time:timePart, entry:avgEntry.toFixed(2), exit:avgExit.toFixed(2), stopLoss:stopOrder?get(stopOrder,"Stop Price"):"", takeProfit:limitOrder?get(limitOrder,"Limit Price"):"", contracts:String(contracts), pnl:pnl.toFixed(2), outcome:pnl>0.01?"Win":pnl<-0.01?"Loss":"Breakeven", bias:isShort?"Bearish":"Bullish", accountIds:[], notes:`Auto-imported · ${contractCode} · ${isShort?"Short":"Long"}` });
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
  const [trades, setTrades] = useStorage("nq_trades_v7",[]);
  const [accounts, setAccounts] = useStorage("nq_accounts_v5",[]);
  const [confluences, setConfluences] = useStorage("nq_confluences_v1", DEFAULT_CONFLUENCES);
  const [propFirms, setPropFirms] = useStorage("nq_firms_v1", DEFAULT_FIRMS);
  const [transactions, setTransactions] = useStorage("nq_transactions_v1", {}); // { accountId: [{type,amount,date,notes}] }
  const [view, setView] = useState("dashboard");
  const [showForm, setShowForm] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showConfluenceManager, setShowConfluenceManager] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(null); // accountId
  const [editIdx, setEditIdx] = useState(null);
  const [editAccountIdx, setEditAccountIdx] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT);
  const [newConfluence, setNewConfluence] = useState("");
  const [newTransaction, setNewTransaction] = useState(EMPTY_TRANSACTION);
  const [filterOutcome, setFilterOutcome] = useState("All");
  const [filterAccount, setFilterAccount] = useState("All");
  const [filterConfluence, setFilterConfluence] = useState("All");
  const [calSelectedAccounts, setCalSelectedAccounts] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReviewLoading, setAiReviewLoading] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [calMonth, setCalMonth] = useState(()=>{ const d=new Date(); return{y:d.getFullYear(),m:d.getMonth()}; });
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

  // Auto-calc RR when pnl or risk changes
  useEffect(() => {
    const pnl = parseFloat(form.pnl);
    const risk = parseFloat(form.risk) || 250;
    if (!isNaN(pnl) && risk > 0) {
      const rr = (pnl / risk).toFixed(2);
      setForm(f => ({ ...f, rr }));
      // Auto breakeven
      if (Math.abs(pnl) <= risk * BE_TOLERANCE) setForm(f => ({ ...f, rr, outcome: "Breakeven" }));
      else if (pnl > 0) setForm(f => ({ ...f, rr, outcome: "Win" }));
      else setForm(f => ({ ...f, rr, outcome: "Loss" }));
    }
  }, [form.pnl, form.risk]);

  // Save new prop firm
  useEffect(() => {
    if (accountForm.firm && !propFirms.includes(accountForm.firm)) {
      setPropFirms(prev => [...new Set([...prev, accountForm.firm])]);
    }
  }, [accountForm.firm]);

  const computeStats = useCallback((tradeList) => {
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
    tradeList.forEach(t=>{if(!dayMap[t.date])dayMap[t.date]=0;dayMap[t.date]+=parseFloat(t.pnl)||0;});
    const followedPlanRate=tradeList.filter(t=>t.followedPlan).length/tradeList.length*100;
    const revSorted=[...sorted].reverse(); let streak=0;
    for(let i=0;i<revSorted.length;i++){const t=revSorted[i];if(i===0){streak=t.outcome==="Win"?1:t.outcome==="Loss"?-1:0;}else{if(t.outcome==="Win"&&streak>0)streak++;else if(t.outcome==="Loss"&&streak<0)streak--;else break;}}

    // RR Distribution (final R per trade)
    const rrDist={};
    RR_BUCKETS.forEach(b=>rrDist[b]={count:0,wins:0,losses:0});
    tradeList.filter(t=>t.rr).forEach(t=>{
      const r=parseFloat(t.rr);
      let bucket=r>=5?"5R+":Math.round(Math.abs(r)*2)/2+"R";
      if(rrDist[bucket]){rrDist[bucket].count++;if(t.outcome==="Win")rrDist[bucket].wins++;if(t.outcome==="Loss")rrDist[bucket].losses++;}
    });

    // Cumulative hit rate — for each R level, % of trades that reached AT LEAST that R
    const rrHitRate={};
    RR_BUCKETS.forEach(b=>{
      const threshold=b==="5R+"?5:parseFloat(b);
      const reached=tradeList.filter(t=>t.rr&&Math.abs(parseFloat(t.rr))>=threshold);
      rrHitRate[b]={ count:reached.length, pct:tradeList.length?(reached.length/tradeList.length)*100:0, wins:reached.filter(t=>t.outcome==="Win").length };
    });

    // Confluence stats
    const confMap={};
    confluences.forEach(c=>confMap[c]={count:0,wins:0,losses:0,pnl:0});
    tradeList.forEach(t=>{(t.confluences||[]).forEach(c=>{if(confMap[c]){confMap[c].count++;confMap[c].pnl+=parseFloat(t.pnl)||0;if(t.outcome==="Win")confMap[c].wins++;if(t.outcome==="Loss")confMap[c].losses++;}});});

    // Time of day distribution (5 min slots 9:30-10:30)
    const timeMap={};
    TIME_SLOTS.forEach(s=>timeMap[s]={count:0,wins:0,losses:0,pnl:0});
    tradeList.forEach(t=>{
      if(!t.time)return;
      const [th,tm]=t.time.split(":").map(Number);
      const roundedM=Math.floor(tm/5)*5;
      const slot=`${String(th).padStart(2,"0")}:${String(roundedM).padStart(2,"0")}`;
      if(timeMap[slot]){timeMap[slot].count++;timeMap[slot].pnl+=parseFloat(t.pnl)||0;if(t.outcome==="Win")timeMap[slot].wins++;if(t.outcome==="Loss")timeMap[slot].losses++;}
    });

    return{wins:wins.length,losses:losses.length,total:tradeList.length,totalPnl,winRate,avgWin,avgLoss,profitFactor,avgRR,equity,maxDD,followedPlanRate,dayMap,streak,rrDist,rrHitRate,confMap,timeMap};
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
    const acctTx=transactions[acc.id]||[];
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

  const filteredTrades=useMemo(()=>trades.filter(t=>
    (filterOutcome==="All"||t.outcome===filterOutcome)&&
    (filterAccount==="All"||(t.accountIds||[]).includes(filterAccount))&&
    (filterConfluence==="All"||(t.confluences||[]).includes(filterConfluence))
  ).sort((a,b)=>new Date(b.date)-new Date(a.date)),[trades,filterOutcome,filterAccount,filterConfluence]);

  // Calendar day map for selected accounts
  const calDayMap=useMemo(()=>{
    const filtered=calSelectedAccounts.length>0
      ?trades.filter(t=>(t.accountIds||[]).some(id=>calSelectedAccounts.includes(id)))
      :trades;
    const map={};
    filtered.forEach(t=>{if(!map[t.date])map[t.date]={pnl:0,count:0,wins:0,losses:0};map[t.date].pnl+=parseFloat(t.pnl)||0;map[t.date].count++;if(t.outcome==="Win")map[t.date].wins++;if(t.outcome==="Loss")map[t.date].losses++;});
    return map;
  },[trades,calSelectedAccounts]);

  const galleryTrades=useMemo(()=>trades.filter(t=>t.screenshot&&
    (galleryFilter.outcome==="All"||t.outcome===galleryFilter.outcome)&&
    (galleryFilter.confluence==="All"||(t.confluences||[]).includes(galleryFilter.confluence))
  ).sort((a,b)=>new Date(b.date)-new Date(a.date)),[trades,galleryFilter]);

  const handleScreenshot=useCallback(async(file)=>{
    if(!file)return;
    const reader=new FileReader();
    reader.onload=async(e)=>{
      const b64=e.target.result.split(",")[1];
      setScreenshotPreview(e.target.result);
      setForm(f=>({...f,screenshot:e.target.result}));
      setAiLoading(true);
      try{
        const raw=await callClaude([{role:"user",content:[
          {type:"image",source:{type:"base64",media_type:file.type||"image/png",data:b64}},
          {type:"text",text:`Analyze this NQ futures TradingView chart. Return ONLY valid JSON:\n{"entry":number|null,"stopLoss":number|null,"takeProfit":number|null,"exit":number|null,"time":"HH:MM"|null,"bias":"Bullish"|"Bearish"|"Neutral"|null,"pnl":number|null,"rr":number|null,"confluences":[],"notes":string|null}`}
        ]}],"You are an expert NQ futures ICT analyst. Extract trade data from TradingView screenshots. Return only valid JSON, no markdown.");
        const parsed=JSON.parse(raw.replace(/```json|```/g,"").trim());
        setForm(f=>({...f,
          ...(parsed.entry&&{entry:String(parsed.entry)}),
          ...(parsed.stopLoss&&{stopLoss:String(parsed.stopLoss)}),
          ...(parsed.takeProfit&&{takeProfit:String(parsed.takeProfit)}),
          ...(parsed.exit&&{exit:String(parsed.exit)}),
          ...(parsed.time&&{time:parsed.time}),
          ...(parsed.bias&&BIASES.includes(parsed.bias)&&{bias:parsed.bias}),
          ...(parsed.pnl!=null&&{pnl:String(parsed.pnl)}),
          ...(parsed.rr&&{rr:String(parsed.rr)}),
          ...(parsed.confluences?.length&&{confluences:parsed.confluences.filter(c=>confluences.includes(c))}),
          ...(parsed.notes&&{notes:parsed.notes}),
        }));
        showToast("✓ AI extracted trade data from chart");
      }catch{showToast("Could not parse chart — fill in manually","error");}
      setAiLoading(false);
    };
    reader.readAsDataURL(file);
  },[confluences]);

  const runAiReview=async(trade)=>{
    setAiReviewLoading(true);
    const accs=accounts.filter(a=>(trade.accountIds||[]).includes(a.id));
    try{
      const review=await callClaude([{role:"user",content:`Review this NQ futures trade:\nDate: ${trade.date} ${trade.time}${accs.length?` | Accounts: ${accs.map(a=>a.name).join(", ")}`:""}\nBias: ${trade.bias}\nEntry: ${trade.entry} | SL: ${trade.stopLoss} | TP: ${trade.takeProfit} | Exit: ${trade.exit}\nP&L: $${trade.pnl} | R:R: ${trade.rr}R | Risk: $${trade.risk||250} | Outcome: ${trade.outcome}\nConfluences: ${(trade.confluences||[]).join(", ")||"None logged"}\nFollowed Plan: ${trade.followedPlan} | Emotion: ${trade.emotion}\nNotes: ${trade.notes}\nProvide concise review: (1) Confluence strength (2) Execution (3) Risk management (4) What to improve. Under 200 words.`}],
        "You are an elite NQ futures trading coach specialising in ICT concepts. Give specific, actionable feedback.");
      const idx=trades.indexOf(trade);
      if(idx!==-1)setTrades(prev=>prev.map((t,i)=>i===idx?{...t,aiReview:review}:t));
      showToast("✓ AI review complete");
    }catch{showToast("Review failed","error");}
    setAiReviewLoading(false);
  };

  const exportCSV=()=>{
    const headers=["date","time","bias","entry","exit","stopLoss","takeProfit","contracts","outcome","pnl","rr","risk","emotion","followedPlan","confluences","notes","accountIds"];
    const rows=trades.map(t=>headers.map(h=>{const v=t[h]??"";return`"${Array.isArray(v)?v.join("|"):v.toString().replace(/"/g,'""')}"`}).join(","));
    const csv=[headers.join(","),...rows].join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`trading_journal_${new Date().toISOString().split("T")[0]}.csv`;a.click();
    showToast("✓ CSV exported");
  };

  const handleTradovateFile=(file)=>{
    const reader=new FileReader();
    reader.onload=(e)=>{
      try{
        const parsed=parseTradovateCSV(e.target.result);
        // Apply BE tolerance
        const withBE=parsed.map(t=>{
          const pnl=parseFloat(t.pnl)||0;
          const risk=250;
          if(Math.abs(pnl)<=risk*BE_TOLERANCE)return{...t,outcome:"Breakeven"};
          return t;
        });
        setImportPreview(withBE);
        setImportFileName(file.name);
        setImportSelectedAccounts(accounts.map(a=>a.id));
        setShowImportModal(true);
      }catch(err){showToast("Could not parse Tradovate file","error");}
    };
    reader.readAsText(file);
  };

  const confirmTradovateImport=()=>{
    if(!importPreview||!importSelectedAccounts.length){showToast("Select at least one account","warn");return;}
    const existing=new Set(trades.map(t=>`${t.date}${t.time}${t.entry}`));
    const risk=250;
    const newTrades=importPreview.filter(t=>!existing.has(`${t.date}${t.time}${t.entry}`)).map(t=>{
      const pnl=parseFloat(t.pnl)||0;
      const rr=(pnl/risk).toFixed(2);
      return{...t,id:Date.now()+Math.random(),accountIds:[...importSelectedAccounts],risk:String(risk),rr};
    });
    setTrades(prev=>[...prev,...newTrades]);
    setShowImportModal(false);
    setImportPreview(null);
    showToast(`✓ Imported ${newTrades.length} trades across ${importSelectedAccounts.length} accounts`);
  };

  const handleSubmit=()=>{
    if(!form.date||!form.entry)return;
    if(editIdx!==null){setTrades(prev=>prev.map((t,i)=>i===editIdx?{...form}:t));setEditIdx(null);}
    else setTrades(prev=>[...prev,{...form,id:Date.now()}]);
    setForm(EMPTY);setScreenshotPreview(null);setShowForm(false);
    showToast("✓ Trade logged");
  };

  const handleAccountSubmit=()=>{
    if(!accountForm.name)return;
    const acc={...accountForm,id:accountForm.id||String(Date.now())};
    if(accountForm.firm&&!propFirms.includes(accountForm.firm))setPropFirms(prev=>[...new Set([...prev,accountForm.firm])]);
    if(editAccountIdx!==null){setAccounts(prev=>prev.map((a,i)=>i===editAccountIdx?acc:a));setEditAccountIdx(null);}
    else setAccounts(prev=>[...prev,acc]);
    setAccountForm(EMPTY_ACCOUNT);setShowAccountForm(false);
    showToast("✓ Account saved");
  };

  const addTransaction=(accountId)=>{
    if(!newTransaction.amount)return;
    const tx={...newTransaction,id:Date.now()};
    setTransactions(prev=>({...prev,[accountId]:[...(prev[accountId]||[]),tx]}));
    setNewTransaction(EMPTY_TRANSACTION);
    showToast(`✓ ${tx.type==="expense"?"Expense":"Payout"} logged`);
  };

  const deleteTransaction=(accountId,txId)=>{
    setTransactions(prev=>({...prev,[accountId]:(prev[accountId]||[]).filter(t=>t.id!==txId)}));
  };

  const openEdit=(idx)=>{setEditIdx(idx);setForm({...EMPTY,...trades[idx],accountIds:trades[idx].accountIds||[],confluences:trades[idx].confluences||[]});setScreenshotPreview(trades[idx].screenshot||null);setShowForm(true);};
  const deleteTrade=(idx)=>{setTrades(prev=>prev.filter((_,i)=>i!==idx));showToast("Trade deleted","warn");};
  const openEditAccount=(idx)=>{setEditAccountIdx(idx);setAccountForm(accounts[idx]);setShowAccountForm(true);};
  const deleteAccount=(idx)=>{setAccounts(prev=>prev.filter((_,i)=>i!==idx));showToast("Account removed","warn");};

  const calDays=useMemo(()=>({first:new Date(calMonth.y,calMonth.m,1).getDay(),total:new Date(calMonth.y,calMonth.m+1,0).getDate()}),[calMonth]);
  const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const inp={width:"100%",background:"#0d1520",border:"1px solid #2a3a50",borderRadius:3,padding:"8px 10px",color:"#cdd6e0",fontSize:12,fontFamily:"inherit",outline:"none",boxSizing:"border-box"};
  const lbl={display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"};
  const activeStats=selectedAccount?accountStats.find(a=>a.id===selectedAccount)?.stats:stats;

  return (
    <div style={{fontFamily:"'IBM Plex Mono','Courier New',monospace",background:"#060a0f",minHeight:"100vh",color:"#cdd6e0",width:"100%"}}>
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
        .teal{background:#0d2a2a;color:#34d399;border:1px solid #0a4040}.teal:hover{background:#0d3535}
        .red{background:#1a0808;color:#f87171;border:1px solid #3a1515}.red:hover{background:#2a0808}
        .win{color:#4ade80}.loss{color:#f87171}.be{color:#f0b429}
        .tag{padding:2px 7px;border-radius:2px;font-size:10px;letter-spacing:0.08em}
        .ct{background:#0d1a1a;color:#34d399;border:1px solid #0a3030;font-size:9px;padding:2px 6px;border-radius:2px}
        .overlay{position:fixed;inset:0;background:rgba(6,10,15,0.93);backdrop-filter:blur(8px);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto}
        .modal{background:#0a0f18;border:1px solid #2a3a50;border-radius:6px;width:100%;max-width:860px;padding:28px;margin:auto}
        .dz{border:1px dashed #2a3a50;border-radius:4px;padding:24px;text-align:center;cursor:pointer;transition:all 0.2s;background:#060a0f}
        .dz:hover{border-color:#f0b429;background:#0a0f18}
        .toast{position:fixed;bottom:24px;right:24px;padding:10px 18px;border-radius:3px;font-size:11px;letter-spacing:0.08em;z-index:999;animation:si 0.2s ease}
        @keyframes si{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
        .hd{font-family:'Orbitron',monospace;font-weight:900;font-size:17px;letter-spacing:0.12em;color:#f0b429}
        .shd{font-family:'Orbitron',monospace;font-weight:900;font-size:14px;letter-spacing:0.12em;color:#f0b429}
        .pulse{animation:p 1.5s infinite}@keyframes p{0%,100%{opacity:1}50%{opacity:0.4}}
        input:focus,textarea:focus{border-color:#f0b429!important;outline:none}
        .meter-bg{background:#1a2535;border-radius:2px;height:5px;overflow:hidden}
        .review-box{background:#060a0f;border:1px solid #1a2535;border-radius:3px;padding:12px;font-size:11px;line-height:1.7;color:#7a9ab8;white-space:pre-wrap;margin-top:10px}
        .nav-active{background:#0d1520;color:#f0b429;border:1px solid #2a3a50}
        .nav-inactive{background:transparent;color:#4a6a8a;border:1px solid transparent}
        .import-row:hover{background:#0d1520}
        .split-modal{display:grid;grid-template-columns:1fr 300px;gap:20px}
        .gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
        .gallery-item{cursor:pointer;border-radius:4px;overflow:hidden;border:1px solid #1a2535;transition:all 0.2s;background:#0a0f18}
        .gallery-item:hover{border-color:#f0b429;transform:translateY(-2px)}
        .time-bar{display:flex;align-items:flex-end;gap:3px;height:80px}
      `}</style>

      {toast&&<div className="toast" style={{background:toast.type==="error"?"#1a0808":toast.type==="warn"?"#1a1208":"#081a0e",border:`1px solid ${toast.type==="error"?"#5a1a1a":toast.type==="warn"?"#5a4a0a":"#1a5a2a"}`,color:toast.type==="error"?"#f87171":toast.type==="warn"?"#f0b429":"#4ade80"}}>{toast.msg}</div>}

      {/* Header */}
      <div style={{borderBottom:"1px solid #1a2535",padding:"0 24px",background:"#060a0f",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",height:52}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div className="hd">Trading<span style={{color:"#cdd6e0"}}> Journal</span></div>
            <div style={{fontSize:9,color:"#2a3a50",letterSpacing:"0.2em",borderLeft:"1px solid #1a2535",paddingLeft:12}}>NQ · ICT · IFVG</div>
          </div>
          <div style={{display:"flex",gap:2}}>
            {["dashboard","accounts","journal","analytics","calendar","screenshots"].map(v=>(
              <button key={v} className={`np ${view===v?"nav-active":"nav-inactive"}`} onClick={()=>setView(v)}>{v}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button className="np dim" onClick={exportCSV}>↓ CSV</button>
            <label className="np teal" style={{cursor:"pointer"}}>↑ TRADOVATE<input ref={tvRef} type="file" accept=".csv" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleTradovateFile(e.target.files[0])}/></label>
            <button className="np" style={{background:"#1a2535",color:"#cdd6e0",border:"1px solid #2a3a50"}} onClick={()=>{setEditAccountIdx(null);setAccountForm(EMPTY_ACCOUNT);setShowAccountForm(true);}}>+ ACCOUNT</button>
            <button className="np gold" onClick={()=>{setEditIdx(null);setForm(EMPTY);setScreenshotPreview(null);setShowForm(true);}}>+ LOG TRADE</button>
          </div>
        </div>
      </div>

      <div style={{maxWidth:"100%",padding:"20px 24px"}}>

        {/* DASHBOARD */}
        {view==="dashboard"&&(
          <div>
            <div style={{marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
              <div>
                <div className="hd" style={{fontSize:20}}>PERFORMANCE</div>
                <div style={{color:"#3a5a7a",fontSize:11,marginTop:4}}>{trades.length} trades across {accounts.length} accounts</div>
              </div>
              {accounts.length>0&&(
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <button className={`np ${!selectedAccount?"gold":"dim"}`} onClick={()=>setSelectedAccount(null)} style={{fontSize:9}}>ALL</button>
                  {accounts.map(a=>(
                    <button key={a.id} className={`np ${selectedAccount===a.id?"gold":"dim"}`} onClick={()=>setSelectedAccount(selectedAccount===a.id?null:a.id)} style={{fontSize:9}}>{a.name}</button>
                  ))}
                </div>
              )}
            </div>
            {!trades.length?(
              <div style={{textAlign:"center",padding:"80px 0"}}>
                <div className="hd" style={{fontSize:40,color:"#1a2535",marginBottom:16}}>0</div>
                <div style={{color:"#4a6a8a",marginBottom:20,fontSize:13}}>No trades yet</div>
                <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                  <label className="np teal" style={{cursor:"pointer",padding:"10px 20px"}}>↑ IMPORT TRADOVATE<input type="file" accept=".csv" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleTradovateFile(e.target.files[0])}/></label>
                  <button className="np gold" style={{padding:"10px 20px"}} onClick={()=>setShowForm(true)}>+ LOG MANUALLY</button>
                </div>
              </div>
            ):(
              <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:10,marginBottom:12}}>
                  {[
                    {l:"TOTAL P&L",v:fmt$(activeStats?.totalPnl||0),c:(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"},
                    {l:"WIN RATE",v:`${(activeStats?.winRate||0).toFixed(1)}%`,c:(activeStats?.winRate||0)>=50?"#4ade80":"#f87171"},
                    {l:"PROFIT FACTOR",v:(activeStats?.profitFactor||0)===999?"∞":(activeStats?.profitFactor||0).toFixed(2),c:(activeStats?.profitFactor||0)>=1.5?"#4ade80":"#f87171"},
                    {l:"AVG R:R",v:`${(activeStats?.avgRR||0).toFixed(2)}R`,c:(activeStats?.avgRR||0)>=1.5?"#4ade80":"#4a6a8a"},
                    {l:"TRADES",v:activeStats?.total||0,c:"#cdd6e0"},
                    {l:"MAX DRAWDOWN",v:fmt$(activeStats?.maxDD||0),c:"#f87171"},
                    {l:"PLAN %",v:`${(activeStats?.followedPlanRate||0).toFixed(0)}%`,c:(activeStats?.followedPlanRate||0)>=70?"#4ade80":"#f0b429"},
                    {l:"STREAK",v:(activeStats?.streak||0)>0?`+${activeStats.streak}W`:(activeStats?.streak||0)<0?`${Math.abs(activeStats.streak)}L`:"—",c:(activeStats?.streak||0)>0?"#4ade80":(activeStats?.streak||0)<0?"#f87171":"#4a6a8a"},
                  ].map(s=>(
                    <div key={s.l} className="card" style={{padding:14}}>
                      <div style={{fontSize:8,color:"#2a3a50",letterSpacing:"0.15em",marginBottom:6}}>{s.l}</div>
                      <div style={{fontFamily:"'Orbitron'",fontSize:18,fontWeight:900,color:s.c}}>{s.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12}}>
                  <div className="card">
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{fontSize:9,color:"#3a5a7a",letterSpacing:"0.15em"}}>EQUITY CURVE</div>
                      <div style={{fontFamily:"'Orbitron'",fontSize:16,fontWeight:900,color:(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"}}>{fmt$(activeStats?.totalPnl||0)}</div>
                    </div>
                    <svg width="100%" viewBox="0 0 400 80" preserveAspectRatio="none" style={{height:70,display:"block"}}>
                      <defs><linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"} stopOpacity="0.2"/><stop offset="100%" stopColor={(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"} stopOpacity="0"/></linearGradient></defs>
                      {equityPath&&<><path d={equityPath+" L400,80 L0,80 Z"} fill="url(#eqg)"/><path d={equityPath} fill="none" stroke={(activeStats?.totalPnl||0)>=0?"#4ade80":"#f87171"} strokeWidth="1.5"/></>}
                    </svg>
                  </div>
                  <div className="card" style={{overflowY:"auto",maxHeight:220}}>
                    <div style={{fontSize:9,color:"#3a5a7a",letterSpacing:"0.15em",marginBottom:12}}>ACCOUNTS</div>
                    {!accounts.length?<div style={{color:"#3a5a7a",fontSize:11}}>No accounts added</div>:accountStats.map(a=>(
                      <div key={a.id} style={{marginBottom:14,paddingBottom:14,borderBottom:"1px solid #0d1520"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <div><div style={{fontSize:11,color:"#cdd6e0"}}>{a.name}</div><div style={{fontSize:9,color:"#3a5a7a"}}>{a.firm} · {a.phase}</div></div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontFamily:"'Orbitron'",fontSize:13,fontWeight:900,color:a.pnl>=0?"#4ade80":"#f87171"}}>{fmt$(a.pnl)}</div>
                            <div style={{fontSize:9,color:a.gainPct>=0?"#4ade80":"#f87171"}}>{a.gainPct>=0?"+":""}{a.gainPct.toFixed(2)}%</div>
                          </div>
                        </div>
                        <div style={{fontSize:9,color:"#3a5a7a",marginBottom:3}}>DD {a.ddPct.toFixed(1)}% / {a.ddLimit}%</div>
                        <div className="meter-bg"><div style={{width:`${Math.min(100,(a.ddPct/a.ddLimit)*100)}%`,height:"100%",background:a.ddPct/a.ddLimit>0.7?"#f87171":a.ddPct/a.ddLimit>0.4?"#f0b429":"#4ade80",borderRadius:2}}/></div>
                        <div style={{fontSize:9,color:"#3a5a7a",marginTop:5,marginBottom:3}}>GAIN FROM START</div>
                        <div className="meter-bg" style={{background:a.gainPct<0?"#2a0808":"#1a2535"}}>
                          <div style={{width:`${Math.min(100,Math.abs(a.gainPct))}%`,height:"100%",background:a.gainPct>=0?"#4ade80":"#f87171",borderRadius:2}}/>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ACCOUNTS */}
        {view==="accounts"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:20}}>
              <div><div className="hd" style={{fontSize:20}}>ACCOUNTS</div><div style={{color:"#3a5a7a",fontSize:11,marginTop:4}}>{accounts.length} funded accounts</div></div>
              <button className="np" style={{background:"#1a2535",color:"#cdd6e0",border:"1px solid #2a3a50"}} onClick={()=>{setEditAccountIdx(null);setAccountForm(EMPTY_ACCOUNT);setShowAccountForm(true);}}>+ ADD ACCOUNT</button>
            </div>
            {!accounts.length?(
              <div style={{textAlign:"center",padding:"60px 0"}}>
                <div style={{color:"#4a6a8a",marginBottom:16,fontSize:13}}>No accounts added yet</div>
                <button className="np gold" onClick={()=>setShowAccountForm(true)} style={{padding:"10px 24px"}}>ADD FIRST ACCOUNT</button>
              </div>
            ):(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:12}}>
                {accountStats.map((a,i)=>{
                  const ddColor=a.ddPct/a.ddLimit>0.7?"#f87171":a.ddPct/a.ddLimit>0.4?"#f0b429":"#4ade80";
                  const acctTx=transactions[a.id]||[];
                  return(
                    <div key={a.id} className="card" style={{padding:20}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                        <div>
                          <div style={{fontFamily:"'Orbitron'",fontSize:13,fontWeight:900,color:"#cdd6e0",marginBottom:3}}>{a.name}</div>
                          <div style={{fontSize:10,color:"#4a6a8a"}}>{a.firm} · <span style={{color:"#60a5fa"}}>{a.phase}</span></div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"'Orbitron'",fontSize:18,fontWeight:900,color:a.pnl>=0?"#4ade80":"#f87171"}}>{fmt$(a.pnl)}</div>
                          <div style={{fontSize:9,color:a.gainPct>=0?"#4ade80":"#f87171"}}>{a.gainPct>=0?"+":""}{a.gainPct.toFixed(2)}% from start</div>
                          <div style={{fontSize:9,color:"#3a5a7a"}}>Balance: <span style={{color:"#cdd6e0"}}>${a.currentBalance.toLocaleString(undefined,{maximumFractionDigits:0})}</span></div>
                        </div>
                      </div>

                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
                        {[["TRADES",a.tradeCount,"#cdd6e0"],["WIN RATE",a.stats?`${a.stats.winRate.toFixed(0)}%`:"—",a.stats?.winRate>=50?"#4ade80":"#f87171"],["AVG R:R",a.stats?`${a.stats.avgRR.toFixed(1)}R`:"—","#60a5fa"]].map(([l,v,c])=>(
                          <div key={l} style={{background:"#060a0f",border:"1px solid #1a2535",borderRadius:3,padding:"8px 10px"}}>
                            <div style={{fontSize:8,color:"#3a5a7a",letterSpacing:"0.1em",marginBottom:4}}>{l}</div>
                            <div style={{fontFamily:"'Orbitron'",fontSize:14,fontWeight:900,color:c}}>{v}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <span style={{fontSize:9,color:"#4a6a8a"}}>DRAWDOWN USED</span>
                          <span style={{fontSize:9,color:ddColor}}>{a.ddPct.toFixed(2)}% / {a.ddLimit}% max</span>
                        </div>
                        <div className="meter-bg"><div style={{width:`${Math.min(100,(a.ddPct/a.ddLimit)*100)}%`,height:"100%",background:ddColor,borderRadius:2}}/></div>
                      </div>

                      <div style={{marginBottom:14}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <span style={{fontSize:9,color:"#4a6a8a"}}>GAIN FROM STARTING BALANCE</span>
                          <span style={{fontSize:9,color:a.gainPct>=0?"#4ade80":"#f87171"}}>{a.gainPct>=0?"+":""}{a.gainPct.toFixed(2)}%</span>
                        </div>
                        <div className="meter-bg" style={{background:a.gainPct<0?"#2a0808":"#1a2535"}}>
                          <div style={{width:`${Math.min(100,Math.abs(a.gainPct))}%`,height:"100%",background:a.gainPct>=0?"#4ade80":"#f87171",borderRadius:2}}/>
                        </div>
                      </div>

                      {/* Expense / Payout summary */}
                      <div style={{background:"#060a0f",border:"1px solid #1a2535",borderRadius:3,padding:"10px 12px",marginBottom:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                          <span style={{fontSize:9,color:"#4a6a8a",letterSpacing:"0.1em"}}>FINANCIALS</span>
                          <button onClick={()=>setShowTransactionModal(a.id)} className="np dim" style={{fontSize:8,padding:"2px 8px"}}>MANAGE</button>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                          {[["SPENT",fmt$(a.totalExpenses),"#f87171"],["WITHDRAWN",fmt$(a.totalPayouts),"#4ade80"],["NET REAL",fmt$(a.netReal),a.netReal>=0?"#4ade80":"#f87171"]].map(([l,v,c])=>(
                            <div key={l}>
                              <div style={{fontSize:8,color:"#3a5a7a",marginBottom:2}}>{l}</div>
                              <div style={{fontFamily:"'Orbitron'",fontSize:12,fontWeight:900,color:c}}>{v}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {a.notes&&<div style={{fontSize:10,color:"#3a5a7a",borderLeft:"2px solid #1a2535",paddingLeft:8,marginBottom:12,fontStyle:"italic"}}>{a.notes}</div>}
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>openEditAccount(i)} className="np dim" style={{fontSize:9,padding:"5px 12px"}}>EDIT</button>
                        <button onClick={()=>deleteAccount(i)} className="np red" style={{fontSize:9,padding:"5px 12px"}}>REMOVE</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* JOURNAL */}
        {view==="journal"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:20}}>
              <div><div className="hd" style={{fontSize:20}}>JOURNAL</div><div style={{color:"#3a5a7a",fontSize:11,marginTop:4}}>{filteredTrades.length} entries</div></div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <Select value={filterOutcome} onChange={e=>setFilterOutcome(e.target.value)} options={["All",...OUTCOMES]}/>
                <Select value={filterAccount} onChange={e=>setFilterAccount(e.target.value)} options={[{value:"All",label:"All Accounts"},...accounts.map(a=>({value:a.id,label:a.name}))]}/>
                <Select value={filterConfluence} onChange={e=>setFilterConfluence(e.target.value)} options={["All",...confluences]}/>
                <button className="np dim" style={{fontSize:9}} onClick={()=>setShowConfluenceManager(true)}>⚙ CONFLUENCES</button>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {filteredTrades.map((t,i)=>{
                const oi=trades.indexOf(t);const pnl=parseFloat(t.pnl)||0;
                const accs=accounts.filter(a=>(t.accountIds||[]).includes(a.id));
                return(
                  <div key={t.id||i} className="card" style={{padding:"14px 18px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <span style={{fontSize:11,color:"#4a6a8a"}}>{t.date}{t.time&&<span style={{color:"#60a5fa",marginLeft:6}}>{t.time}</span>}</span>
                        <span style={{fontSize:10,color:t.bias==="Bullish"?"#4ade80":"#f87171"}}>● {t.bias}</span>
                        {accs.map(a=><span key={a.id} style={{fontSize:9,color:"#f0b429",background:"#1a1400",border:"1px solid #3a2a00",padding:"2px 7px",borderRadius:2}}>{a.name}</span>)}
                        {!t.followedPlan&&<span style={{fontSize:9,color:"#f0b429",letterSpacing:"0.12em"}}>⚠ OFF-PLAN</span>}
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"'Orbitron'",fontSize:16,fontWeight:900,color:t.outcome==="Win"?"#4ade80":t.outcome==="Loss"?"#f87171":"#f0b429"}}>{fmt$(pnl)}</div>
                          {t.rr&&<div style={{fontSize:9,color:"#4a6a8a"}}>{parseFloat(t.rr)>=0?"+":""}{t.rr}R</div>}
                        </div>
                        <button onClick={()=>openEdit(oi)} className="np dim" style={{fontSize:9,padding:"4px 10px"}}>EDIT</button>
                        <button onClick={()=>deleteTrade(oi)} className="np red" style={{fontSize:9,padding:"4px 10px"}}>DEL</button>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:16,marginTop:8,fontSize:11,flexWrap:"wrap"}}>
                      {[["Entry",t.entry,"#cdd6e0"],["Exit",t.exit,"#cdd6e0"],["SL",t.stopLoss,"#f87171"],["TP",t.takeProfit,"#4ade80"],["Risk",t.risk?`$${t.risk}`:"$250","#4a6a8a"],["Contracts",t.contracts,"#4a6a8a"]].map(([l,v,c])=>(
                        <span key={l} style={{color:"#3a5a7a"}}>{l}: <span style={{color:c}}>{v||"—"}</span></span>
                      ))}
                    </div>
                    {(t.confluences||[]).length>0&&(
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:8}}>
                        {t.confluences.map(c=><span key={c} className="ct">{c}</span>)}
                      </div>
                    )}
                    {t.notes&&<div style={{marginTop:8,fontSize:11,color:"#4a6a8a",borderLeft:"2px solid #1a2535",paddingLeft:10,fontStyle:"italic"}}>{t.notes}</div>}
                    {t.screenshot&&<div style={{marginTop:10}}><img src={t.screenshot} alt="chart" style={{maxHeight:180,borderRadius:3,border:"1px solid #1a2535",objectFit:"contain",cursor:"pointer"}} onClick={()=>setExpandedScreenshot(t)}/></div>}
                    <div style={{marginTop:10}}>
                      <button onClick={()=>runAiReview(t)} disabled={aiReviewLoading} className="np dim" style={{fontSize:9,padding:"5px 12px"}}>{aiReviewLoading?"ANALYSING...":"🤖 AI REVIEW"}</button>
                    </div>
                    {t.aiReview&&<div className="review-box">{t.aiReview}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ANALYTICS */}
        {view==="analytics"&&(
          <div>
            <div style={{marginBottom:20}}><div className="hd" style={{fontSize:20}}>ANALYTICS</div></div>
            {!stats?<div style={{textAlign:"center",padding:"60px 0",color:"#4a6a8a"}}>Log trades to see analytics</div>:(
              <>
                {/* R:R Distribution + Hit Rate */}
                <div className="card" style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{fontSize:9,color:"#3a5a7a",letterSpacing:"0.15em"}}>R:R DISTRIBUTION & CUMULATIVE HIT RATE</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
                    {RR_BUCKETS.map(b=>{
                      const d=stats.rrDist[b];const wr=d.count?(d.wins/d.count)*100:0;
                      return(
                        <div key={b} style={{background:"#060a0f",border:`1px solid ${d.count>0?"#2a3a50":"#1a2535"}`,borderRadius:3,padding:"10px 8px",textAlign:"center"}}>
                          <div style={{fontFamily:"'Orbitron'",fontSize:11,fontWeight:900,color:d.count>0?"#f0b429":"#2a3a50",marginBottom:4}}>{b}</div>
                          <div style={{fontSize:16,fontFamily:"'Orbitron'",fontWeight:900,color:wr>=50?"#4ade80":d.count>0?"#f87171":"#2a3a50"}}>{d.count}</div>
                          <div style={{fontSize:9,color:"#3a5a7a",marginTop:2}}>{d.count>0?`${wr.toFixed(0)}% WR`:"—"}</div>
                          {d.count>0&&<div style={{marginTop:6}}><div className="meter-bg"><div style={{width:`${wr}%`,height:"100%",background:wr>=50?"#4ade80":"#f87171",borderRadius:2}}/></div></div>}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{fontSize:9,color:"#3a5a7a",letterSpacing:"0.15em",marginBottom:10}}>CUMULATIVE HIT RATE — % OF ALL TRADES THAT REACHED THIS R</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
                    {RR_BUCKETS.map(b=>{
                      const d=stats.rrHitRate[b];
                      return(
                        <div key={b} style={{background:"#060a0f",border:`1px solid ${d.count>0?"#1a3050":"#1a2535"}`,borderRadius:3,padding:"10px 8px",textAlign:"center"}}>
                          <div style={{fontFamily:"'Orbitron'",fontSize:11,fontWeight:900,color:d.count>0?"#60a5fa":"#2a3a50",marginBottom:4}}>{b}</div>
                          <div style={{fontSize:16,fontFamily:"'Orbitron'",fontWeight:900,color:d.pct>=50?"#4ade80":d.count>0?"#f0b429":"#2a3a50"}}>{d.pct.toFixed(0)}%</div>
                          <div style={{fontSize:9,color:"#3a5a7a",marginTop:2}}>{d.count} trades</div>
                          {d.count>0&&<div style={{marginTop:6}}><div className="meter-bg"><div style={{width:`${d.pct}%`,height:"100%",background:"#60a5fa",borderRadius:2}}/></div></div>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Confluence performance */}
                <div className="card" style={{marginBottom:12}}>
                  <div style={{fontSize:9,color:"#3a5a7a",letterSpacing:"0.15em",marginBottom:14}}>CONFLUENCE PERFORMANCE</div>
                  {Object.entries(stats.confMap).filter(([,d])=>d.count>0).sort((a,b)=>b[1].pnl-a[1].pnl).map(([conf,d])=>{
                    const wr=(d.wins/(d.wins+d.losses||1))*100;
                    return(
                      <div key={conf} style={{marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <div style={{display:"flex",gap:10,alignItems:"center"}}>
                            <span className="ct">{conf}</span>
                            <span style={{fontSize:10,color:"#3a5a7a"}}>{d.count} trades · {wr.toFixed(0)}% WR</span>
                          </div>
                          <span style={{fontFamily:"'Orbitron'",fontSize:12,fontWeight:900,color:d.pnl>=0?"#4ade80":"#f87171"}}>{fmt$(d.pnl)}</span>
                        </div>
                        <div className="meter-bg"><div style={{width:`${wr}%`,height:"100%",background:wr>=50?"#4ade80":"#f87171",borderRadius:2}}/></div>
                      </div>
                    );
                  })}
                  {!Object.values(stats.confMap).some(d=>d.count>0)&&<div style={{color:"#3a5a7a",fontSize:11}}>No confluence data yet</div>}
                </div>

                {/* Time of day distribution */}
                <div className="card" style={{marginBottom:12}}>
                  <div style={{fontSize:9,color:"#3a5a7a",letterSpacing:"0.15em",marginBottom:14}}>TIME OF DAY — NY OPEN (9:30–10:30)</div>
                  <div style={{overflowX:"auto"}}>
                    <div style={{display:"flex",alignItems:"flex-end",gap:4,height:100,minWidth:600}}>
                      {TIME_SLOTS.map(slot=>{
                        const d=stats.timeMap[slot];
                        const maxCount=Math.max(1,...Object.values(stats.timeMap).map(v=>v.count));
                        const h=d.count?Math.max(8,(d.count/maxCount)*80):0;
                        const wr=d.count?(d.wins/d.count)*100:0;
                        return(
                          <div key={slot} style={{display:"flex",flexDirection:"column",alignItems:"center",flex:1,minWidth:28}}>
                            {d.count>0&&<div style={{fontSize:8,color:wr>=50?"#4ade80":"#f87171",marginBottom:2}}>{wr.toFixed(0)}%</div>}
                            <div style={{width:"100%",height:h,background:d.count>0?(wr>=50?"rgba(74,222,128,0.6)":"rgba(248,113,113,0.6)"):"#1a2535",borderRadius:"2px 2px 0 0",transition:"height 0.3s",position:"relative"}} title={`${slot}: ${d.count} trades, ${wr.toFixed(0)}% WR, ${fmt$(d.pnl)}`}>
                              {d.count>0&&<div style={{position:"absolute",top:-16,left:"50%",transform:"translateX(-50%)",fontSize:8,color:"#cdd6e0",whiteSpace:"nowrap"}}>{d.count}</div>}
                            </div>
                            <div style={{fontSize:7,color:"#2a3a50",marginTop:3,transform:"rotate(-45deg)",transformOrigin:"top left",whiteSpace:"nowrap",marginLeft:6}}>{slot}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:16,marginTop:16,fontSize:10,color:"#3a5a7a"}}>
                    <span><span style={{color:"#4ade80"}}>■</span> Win rate ≥50%</span>
                    <span><span style={{color:"#f87171"}}>■</span> Win rate &lt;50%</span>
                    <span>Numbers = trade count · % = win rate</span>
                  </div>
                </div>

                <div className="card">
                  <div style={{fontSize:9,color:"#3a5a7a",letterSpacing:"0.15em",marginBottom:12}}>KEY METRICS</div>
                  {[["Wins",stats.wins,"#4ade80"],["Losses",stats.losses,"#f87171"],["Breakeven",stats.total-stats.wins-stats.losses,"#f0b429"],["Avg Win",fmt$(stats.avgWin),"#4ade80"],["Avg Loss",fmt$(stats.avgLoss),"#f87171"],["Profit Factor",stats.profitFactor===999?"∞":stats.profitFactor.toFixed(2),stats.profitFactor>=1.5?"#4ade80":"#f87171"],["Max Drawdown",fmt$(stats.maxDD),"#f87171"],["Plan Adherence",`${stats.followedPlanRate.toFixed(0)}%`,stats.followedPlanRate>=70?"#4ade80":"#f0b429"]].map(([l,v,c])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #0d1117",fontSize:11}}>
                      <span style={{color:"#4a6a8a"}}>{l}</span>
                      <span style={{fontFamily:"'Orbitron'",fontSize:13,fontWeight:900,color:c}}>{v}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* CALENDAR */}
        {view==="calendar"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:16}}>
              <div><div className="hd" style={{fontSize:20}}>P&L CALENDAR</div></div>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <button onClick={()=>setCalMonth(p=>{const d=new Date(p.y,p.m-1);return{y:d.getFullYear(),m:d.getMonth()};})} className="np dim" style={{padding:"5px 12px"}}>‹</button>
                <span style={{fontSize:12,color:"#cdd6e0",minWidth:140,textAlign:"center"}}>{MONTHS[calMonth.m]} {calMonth.y}</span>
                <button onClick={()=>setCalMonth(p=>{const d=new Date(p.y,p.m+1);return{y:d.getFullYear(),m:d.getMonth()};})} className="np dim" style={{padding:"5px 12px"}}>›</button>
              </div>
            </div>

            {/* Multi-account filter for calendar */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:9,color:"#4a6a8a",letterSpacing:"0.15em",marginBottom:8}}>FILTER BY ACCOUNTS</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                <button className={`np ${calSelectedAccounts.length===0?"gold":"dim"}`} onClick={()=>setCalSelectedAccounts([])} style={{fontSize:9}}>ALL ACCOUNTS</button>
                {accounts.map(a=>(
                  <button key={a.id} className={`np ${calSelectedAccounts.includes(a.id)?"gold":"dim"}`} onClick={()=>setCalSelectedAccounts(prev=>prev.includes(a.id)?prev.filter(x=>x!==a.id):[...prev,a.id])} style={{fontSize:9}}>{a.name}</button>
                ))}
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
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
                  {[["MONTH P&L",fmt$(mPnl),mPnl>=0?"#4ade80":"#f87171"],["MONTH TRADES",mTrades,"#cdd6e0"],["WIN RATE",`${mWR.toFixed(0)}%`,mWR>=50?"#4ade80":"#f87171"],["TRADING DAYS",mt.length,"#60a5fa"]].map(([l,v,c])=>(
                    <div key={l} className="card" style={{padding:12}}>
                      <div style={{fontSize:8,color:"#3a5a7a",letterSpacing:"0.15em",marginBottom:6}}>{l}</div>
                      <div style={{fontFamily:"'Orbitron'",fontSize:18,fontWeight:900,color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div className="card">
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:6}}>
                {["SUN","MON","TUE","WED","THU","FRI","SAT"].map(d=><div key={d} style={{textAlign:"center",fontSize:9,color:"#2a3a50",padding:"4px 0"}}>{d}</div>)}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
                {Array.from({length:calDays.first}).map((_,i)=><div key={`e${i}`} style={{aspectRatio:"1"}}/>)}
                {Array.from({length:calDays.total}).map((_,i)=>{
                  const day=i+1;
                  const ds=`${calMonth.y}-${String(calMonth.m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                  const d=calDayMap[ds];
                  const ht=!!d;
                  const today=new Date().toISOString().split("T")[0]===ds;
                  return(
                    <div key={day} style={{aspectRatio:"1",padding:4,border:`1px solid ${today?"#f0b429":ht?(d.pnl>=0?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)"):"#1a2535"}`,borderRadius:3,background:ht?(d.pnl>=0?"rgba(74,222,128,0.06)":"rgba(248,113,113,0.06)"):"#0a0f18",minHeight:60}}>
                      <div style={{fontSize:9,color:today?"#f0b429":"#2a3a50",marginBottom:2}}>{day}</div>
                      {ht&&<>
                        <div style={{fontFamily:"'Orbitron'",fontSize:10,fontWeight:900,color:d.pnl>=0?"#4ade80":"#f87171"}}>{fmt$(d.pnl)}</div>
                        <div style={{fontSize:8,color:"#3a5a7a"}}>{d.count}t · {d.wins}W {d.losses}L</div>
                      </>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* SCREENSHOTS */}
        {view==="screenshots"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:20}}>
              <div><div className="hd" style={{fontSize:20}}>SCREENSHOTS</div><div style={{color:"#3a5a7a",fontSize:11,marginTop:4}}>{galleryTrades.length} charts</div></div>
              <div style={{display:"flex",gap:8}}>
                <Select value={galleryFilter.outcome} onChange={e=>setGalleryFilter(f=>({...f,outcome:e.target.value}))} options={["All",...OUTCOMES]}/>
                <Select value={galleryFilter.confluence} onChange={e=>setGalleryFilter(f=>({...f,confluence:e.target.value}))} options={["All",...confluences]}/>
              </div>
            </div>
            {!galleryTrades.length?(
              <div style={{textAlign:"center",padding:"60px 0",color:"#4a6a8a"}}>No screenshots yet — attach charts when logging trades</div>
            ):(
              <div className="gallery-grid">
                {galleryTrades.map((t,i)=>{
                  const pnl=parseFloat(t.pnl)||0;
                  const accs=accounts.filter(a=>(t.accountIds||[]).includes(a.id));
                  return(
                    <div key={t.id||i} className="gallery-item" onClick={()=>setExpandedScreenshot(t)}>
                      <div style={{position:"relative"}}>
                        <img src={t.screenshot} alt="trade" style={{width:"100%",height:160,objectFit:"cover",display:"block"}}/>
                        <div style={{position:"absolute",top:8,right:8,fontFamily:"'Orbitron'",fontSize:12,fontWeight:900,color:t.outcome==="Win"?"#4ade80":t.outcome==="Loss"?"#f87171":"#f0b429",background:"rgba(6,10,15,0.85)",padding:"2px 8px",borderRadius:2}}>{fmt$(pnl)}</div>
                        <div style={{position:"absolute",top:8,left:8,fontSize:9,color:t.bias==="Bullish"?"#4ade80":"#f87171",background:"rgba(6,10,15,0.85)",padding:"2px 6px",borderRadius:2}}>● {t.bias}</div>
                      </div>
                      <div style={{padding:"10px 12px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                          <span style={{fontSize:11,color:"#4a6a8a"}}>{t.date} {t.time&&<span style={{color:"#60a5fa"}}>{t.time}</span>}</span>
                          {t.rr&&<span style={{fontSize:10,color:"#4a6a8a"}}>{t.rr}R</span>}
                        </div>
                        {(t.confluences||[]).length>0&&(
                          <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:4}}>
                            {t.confluences.slice(0,3).map(c=><span key={c} className="ct">{c}</span>)}
                            {t.confluences.length>3&&<span className="ct">+{t.confluences.length-3}</span>}
                          </div>
                        )}
                        {accs.length>0&&<div style={{fontSize:9,color:"#f0b429"}}>{accs.map(a=>a.name).join(", ")}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* EXPANDED SCREENSHOT MODAL */}
      {expandedScreenshot&&(
        <div className="overlay" onClick={()=>setExpandedScreenshot(null)}>
          <div className="modal" style={{maxWidth:1000}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <div className="shd">{expandedScreenshot.date} {expandedScreenshot.time}</div>
                <span style={{fontFamily:"'Orbitron'",fontSize:16,fontWeight:900,color:expandedScreenshot.outcome==="Win"?"#4ade80":expandedScreenshot.outcome==="Loss"?"#f87171":"#f0b429"}}>{fmt$(parseFloat(expandedScreenshot.pnl)||0)}</span>
                {expandedScreenshot.rr&&<span style={{fontSize:11,color:"#4a6a8a"}}>{expandedScreenshot.rr}R</span>}
              </div>
              <button onClick={()=>setExpandedScreenshot(null)} style={{background:"none",border:"none",color:"#4a6a8a",fontSize:20,cursor:"pointer"}}>✕</button>
            </div>
            <img src={expandedScreenshot.screenshot} alt="chart" style={{width:"100%",borderRadius:4,border:"1px solid #1a2535",marginBottom:14}}/>
            <div style={{display:"flex",gap:16,fontSize:11,flexWrap:"wrap",marginBottom:10}}>
              {[["Entry",expandedScreenshot.entry,"#cdd6e0"],["Exit",expandedScreenshot.exit,"#cdd6e0"],["SL",expandedScreenshot.stopLoss,"#f87171"],["TP",expandedScreenshot.takeProfit,"#4ade80"],["Bias",expandedScreenshot.bias,expandedScreenshot.bias==="Bullish"?"#4ade80":"#f87171"],["Risk",`$${expandedScreenshot.risk||250}`,"#4a6a8a"]].map(([l,v,c])=>(
                v&&<span key={l} style={{color:"#3a5a7a"}}>{l}: <span style={{color:c}}>{v}</span></span>
              ))}
            </div>
            {(expandedScreenshot.confluences||[]).length>0&&(
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:10}}>
                {expandedScreenshot.confluences.map(c=><span key={c} className="ct">{c}</span>)}
              </div>
            )}
            {expandedScreenshot.notes&&<div style={{fontSize:11,color:"#4a6a8a",fontStyle:"italic",borderLeft:"2px solid #1a2535",paddingLeft:10}}>{expandedScreenshot.notes}</div>}
          </div>
        </div>
      )}

      {/* CONFLUENCE MANAGER */}
      {showConfluenceManager&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowConfluenceManager(false);}}>
          <div className="modal" style={{maxWidth:500}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
              <div className="shd">MANAGE CONFLUENCES</div>
              <button onClick={()=>setShowConfluenceManager(false)} style={{background:"none",border:"none",color:"#4a6a8a",fontSize:20,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <input value={newConfluence} onChange={e=>setNewConfluence(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"&&newConfluence.trim()){setConfluences(prev=>[...prev,newConfluence.trim()]);setNewConfluence("");}}} style={{...inp,flex:1}} placeholder="Add new confluence..."/>
              <button className="np gold" onClick={()=>{ if(newConfluence.trim()){setConfluences(prev=>[...prev,newConfluence.trim()]);setNewConfluence("");}}} style={{padding:"8px 16px"}}>ADD</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:400,overflowY:"auto"}}>
              {confluences.map((c,i)=>(
                <div key={c} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:"#060a0f",border:"1px solid #1a2535",borderRadius:3}}>
                  <span style={{fontSize:12,color:"#cdd6e0"}}>{c}</span>
                  <button onClick={()=>setConfluences(prev=>prev.filter((_,j)=>j!==i))} className="np red" style={{fontSize:9,padding:"3px 8px"}}>REMOVE</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TRANSACTION MODAL */}
      {showTransactionModal&&(()=>{
        const acc=accountStats.find(a=>a.id===showTransactionModal);
        const acctTx=transactions[showTransactionModal]||[];
        if(!acc)return null;
        return(
          <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowTransactionModal(null);}}>
            <div className="modal" style={{maxWidth:560}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                <div><div className="shd">FINANCIALS — {acc.name}</div><div style={{fontSize:10,color:"#3a5a7a",marginTop:4}}>{acc.firm}</div></div>
                <button onClick={()=>setShowTransactionModal(null)} style={{background:"none",border:"none",color:"#4a6a8a",fontSize:20,cursor:"pointer"}}>✕</button>
              </div>

              {/* Summary */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>
                {[["TOTAL SPENT",fmt$(acc.totalExpenses),"#f87171"],
                ["TOTAL WITHDRAWN",fmt$(acc.totalPayouts),"#4ade80"],["NET REAL P&L",fmt$(acc.netReal),acc.netReal>=0?"#4ade80":"#f87171"]].map(([l,v,c])=>(
                  <div key={l} style={{background:"#060a0f",border:"1px solid #1a2535",borderRadius:3,padding:"12px"}}>
                    <div style={{fontSize:8,color:"#3a5a7a",letterSpacing:"0.12em",marginBottom:6}}>{l}</div>
                    <div style={{fontFamily:"'Orbitron'",fontSize:16,fontWeight:900,color:c}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Add transaction */}
              <div style={{background:"#060a0f",border:"1px solid #1a2535",borderRadius:3,padding:"14px",marginBottom:16}}>
                <div style={{fontSize:9,color:"#4a6a8a",letterSpacing:"0.15em",marginBottom:10}}>ADD TRANSACTION</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                  <div>
                    <label style={{display:"block",fontSize:9,color:"#4a6a8a",letterSpacing:"0.12em",marginBottom:4}}>TYPE</label>
                    <Select value={newTransaction.type} onChange={e=>setNewTransaction(t=>({...t,type:e.target.value}))} options={[{value:"expense",label:"Expense (Fee)"},{value:"payout",label:"Payout (Withdrawal)"}]}/>
                  </div>
                  <div>
                    <label style={{display:"block",fontSize:9,color:"#4a6a8a",letterSpacing:"0.12em",marginBottom:4}}>AMOUNT ($)</label>
                    <input type="number" value={newTransaction.amount} onChange={e=>setNewTransaction(t=>({...t,amount:e.target.value}))} style={{...inp}} placeholder="0.00"/>
                  </div>
                  <div>
                    <label style={{display:"block",fontSize:9,color:"#4a6a8a",letterSpacing:"0.12em",marginBottom:4}}>DATE</label>
                    <input type="date" value={newTransaction.date} onChange={e=>setNewTransaction(t=>({...t,date:e.target.value}))} style={{...inp}}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <input value={newTransaction.notes} onChange={e=>setNewTransaction(t=>({...t,notes:e.target.value}))} style={{...inp,flex:1}} placeholder="Notes (e.g. FTMO challenge fee, first payout...)"/>
                  <button onClick={()=>addTransaction(showTransactionModal)} className="np gold" style={{padding:"8px 16px",whiteSpace:"nowrap"}}>ADD</button>
                </div>
              </div>

              {/* Transaction history */}
              <div style={{maxHeight:280,overflowY:"auto"}}>
                {!acctTx.length
                  ?<div style={{textAlign:"center",padding:"24px 0",color:"#3a5a7a",fontSize:11}}>No transactions logged yet</div>
                  :[...acctTx].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(tx=>(
                    <div key={tx.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",background:"#060a0f",border:"1px solid #1a2535",borderRadius:3,marginBottom:6}}>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        <span style={{fontSize:9,padding:"2px 8px",borderRadius:2,background:tx.type==="expense"?"#1a0808":"#081a0e",color:tx.type==="expense"?"#f87171":"#4ade80",border:`1px solid ${tx.type==="expense"?"#3a1515":"#1a5a2a"}`}}>{tx.type==="expense"?"EXPENSE":"PAYOUT"}</span>
                        <span style={{fontSize:11,color:"#cdd6e0"}}>{tx.date}</span>
                        {tx.notes&&<span style={{fontSize:10,color:"#4a6a8a",fontStyle:"italic"}}>{tx.notes}</span>}
                      </div>
                      <div style={{display:"flex",gap:10,alignItems:"center"}}>
                        <span style={{fontFamily:"'Orbitron'",fontSize:13,fontWeight:900,color:tx.type==="expense"?"#f87171":"#4ade80"}}>{tx.type==="expense"?"-":"+"}${parseFloat(tx.amount).toFixed(2)}</span>
                        <button onClick={()=>deleteTransaction(showTransactionModal,tx.id)} className="np red" style={{fontSize:8,padding:"3px 8px"}}>DEL</button>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        );
      })()}

      {/* TRADOVATE IMPORT MODAL */}
      {showImportModal&&importPreview&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowImportModal(false);}}>
          <div className="modal">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div className="shd">IMPORT TRADES</div>
                <div style={{fontSize:10,color:"#3a5a7a",marginTop:4}}>{importFileName} · {importPreview.length} trades detected</div>
              </div>
              <button onClick={()=>setShowImportModal(false)} style={{background:"none",border:"none",color:"#4a6a8a",fontSize:20,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:20}}>
              <div>
                <div style={{fontSize:9,color:"#4a6a8a",letterSpacing:"0.15em",marginBottom:10}}>DETECTED TRADES</div>
                <div style={{overflowX:"auto",maxHeight:380,overflowY:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead style={{position:"sticky",top:0,background:"#0a0f18"}}>
                      <tr style={{borderBottom:"1px solid #1a2535",color:"#3a5a7a"}}>
                        {["Date","Time","Dir","Entry","Exit","Qty","P&L","R:R","Outcome"].map(h=>(
                          <th key={h} style={{padding:"6px 8px",fontWeight:400,letterSpacing:"0.08em",fontSize:9,textAlign:"left"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.map((t,i)=>{
                        const pnl=parseFloat(t.pnl)||0;
                        return(
                          <tr key={i} className="import-row" style={{borderBottom:"1px solid #0d1117"}}>
                            <td style={{padding:"6px 8px"}}>{t.date}</td>
                            <td style={{padding:"6px 8px",color:"#60a5fa"}}>{t.time}</td>
                            <td style={{padding:"6px 8px",color:t.bias==="Bullish"?"#4ade80":"#f87171"}}>{t.bias==="Bullish"?"▲":"▼"}</td>
                            <td style={{padding:"6px 8px"}}>{t.entry}</td>
                            <td style={{padding:"6px 8px"}}>{t.exit}</td>
                            <td style={{padding:"6px 8px",color:"#4a6a8a"}}>{t.contracts}</td>
                            <td style={{padding:"6px 8px",fontFamily:"'Orbitron'",fontSize:11,fontWeight:900,color:pnl>=0?"#4ade80":"#f87171"}}>{fmt$(pnl)}</td>
                            <td style={{padding:"6px 8px",color:"#4a6a8a"}}>{t.rr||"—"}</td>
                            <td style={{padding:"6px 8px",fontSize:9,color:t.outcome==="Win"?"#4ade80":t.outcome==="Loss"?"#f87171":"#f0b429"}}>{t.outcome}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <AccountCheckboxes accounts={accounts} selected={importSelectedAccounts} onChange={setImportSelectedAccounts} label="Apply to accounts"/>
                {importSelectedAccounts.length>0&&(
                  <div style={{marginTop:12,background:"#060a0f",border:"1px solid #1a2535",borderRadius:3,padding:"10px 12px",fontSize:10,color:"#4a6a8a"}}>
                    {importPreview.length} trades → <span style={{color:"#f0b429"}}>{importSelectedAccounts.length} account{importSelectedAccounts.length>1?"s":""}</span>
                  </div>
                )}
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={confirmTradovateImport} className="np teal" style={{flex:1,padding:11}} disabled={!importSelectedAccounts.length}>
                CONFIRM IMPORT → {importSelectedAccounts.length} ACCOUNT{importSelectedAccounts.length!==1?"S":""}
              </button>
              <button onClick={()=>setShowImportModal(false)} className="np dim" style={{padding:"11px 22px"}}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* ACCOUNT MODAL */}
      {showAccountForm&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget){setShowAccountForm(false);setEditAccountIdx(null);}}}>
          <div className="modal" style={{maxWidth:560}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
              <div className="shd">{editAccountIdx!==null?"EDIT ACCOUNT":"ADD ACCOUNT"}</div>
              <button onClick={()=>{setShowAccountForm(false);setEditAccountIdx(null);}} style={{background:"none",border:"none",color:"#4a6a8a",fontSize:20,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{gridColumn:"1/-1"}}>
                <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>Account Name</label>
                <input value={accountForm.name} onChange={e=>saf("name",e.target.value)} style={{...inp}} placeholder='e.g. "FTMO 50K #1"'/>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>Prop Firm</label>
                <FirmInput value={accountForm.firm} onChange={v=>saf("firm",v)} firms={propFirms}/>
                <div style={{fontSize:9,color:"#3a5a7a",marginTop:4}}>Type your own firm name — it'll be saved for next time</div>
              </div>
              <div>
                <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>Phase</label>
                <Select value={accountForm.phase} onChange={e=>saf("phase",e.target.value)} options={["Phase 1","Phase 2","Funded","Verification"]}/>
              </div>
              <div>
                <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>Max Total Drawdown (%)</label>
                <input type="number" value={accountForm.maxTotalDrawdown} onChange={e=>saf("maxTotalDrawdown",e.target.value)} style={{...inp}} placeholder="10"/>
              </div>
              <div>
                <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>Account Size ($)</label>
                <input type="number" value={accountForm.size} onChange={e=>saf("size",e.target.value)} style={{...inp}} placeholder="50000"/>
              </div>
              <div>
                <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>Starting Balance ($)</label>
                <input type="number" value={accountForm.startingBalance} onChange={e=>saf("startingBalance",e.target.value)} style={{...inp}} placeholder="50000"/>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>Notes</label>
                <input value={accountForm.notes} onChange={e=>saf("notes",e.target.value)} style={{...inp}} placeholder="Any notes about this account..."/>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={handleAccountSubmit} className="np gold" style={{flex:1,padding:11}}>{editAccountIdx!==null?"UPDATE":"ADD ACCOUNT"}</button>
              <button onClick={()=>{setShowAccountForm(false);setEditAccountIdx(null);}} className="np dim" style={{padding:"11px 22px"}}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* TRADE MODAL */}
      {showForm&&(
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget){setShowForm(false);setEditIdx(null);}}}>
          <div className="modal" style={{maxWidth:740}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
              <div className="shd">{editIdx!==null?"EDIT TRADE":"LOG TRADE"}</div>
              <button onClick={()=>{setShowForm(false);setEditIdx(null);}} style={{background:"none",border:"none",color:"#4a6a8a",fontSize:20,cursor:"pointer"}}>✕</button>
            </div>
            <div className="dz" style={{marginBottom:16}} onClick={()=>!aiLoading&&fileRef.current?.click()}
              onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="#f0b429";}}
              onDragLeave={e=>{e.currentTarget.style.borderColor="#2a3a50";}}
              onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="#2a3a50";const f=e.dataTransfer.files[0];if(f)handleScreenshot(f);}}>
              {screenshotPreview
                ?<div style={{position:"relative"}}><img src={screenshotPreview} alt="chart" style={{maxHeight:160,objectFit:"contain",borderRadius:3,width:"100%"}}/><div style={{position:"absolute",top:6,right:6,background:"#060a0f",border:"1px solid #1a2535",borderRadius:2,padding:"2px 8px",fontSize:9,color:"#4ade80"}}>✓ CHART ATTACHED</div></div>
                :aiLoading?<div className="pulse" style={{color:"#f0b429",fontSize:12,letterSpacing:"0.15em"}}>🤖 AI EXTRACTING TRADE LEVELS...</div>
                :<><div style={{fontSize:22,marginBottom:6}}>📊</div><div style={{color:"#4a6a8a",fontSize:12}}>Drop TradingView screenshot · AI auto-extracts Entry, SL, TP and R</div></>}
              <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleScreenshot(e.target.files[0])}/>
            </div>
            <div style={{marginBottom:12}}>
              <AccountCheckboxes accounts={accounts} selected={form.accountIds||[]} onChange={v=>sf("accountIds",v)} label="Accounts (select all that apply)"/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {[["Date","date","date"],["Time","time","time"],["Entry Price","entry","number"],["Exit Price","exit","number"],["Stop Loss","stopLoss","number"],["Take Profit","takeProfit","number"],["Contracts","contracts","number"]].map(([l,k,t])=>(
                <div key={k}><label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>{l}</label><input type={t} value={form[k]} onChange={e=>sf(k,e.target.value)} style={{...inp}}/></div>
              ))}
              <div>
                <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>Risk ($) <span style={{color:"#3a5a7a",fontStyle:"italic"}}>defaults $250</span></label>
                <input type="number" value={form.risk} onChange={e=>sf("risk",e.target.value)} style={{...inp}} placeholder="250"/>
              </div>
              <div>
                <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>P&L ($) <span style={{color:"#3a5a7a",fontStyle:"italic"}}>auto-calculates R:R</span></label>
                <input type="number" value={form.pnl} onChange={e=>sf("pnl",e.target.value)} style={{...inp}}/>
              </div>
              <div>
                <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>R:R Achieved <span style={{color:"#3a5a7a",fontStyle:"italic"}}>auto-filled</span></label>
                <input type="number" value={form.rr} onChange={e=>sf("rr",e.target.value)} style={{...inp,borderColor:form.rr?"#2a3a50":"#1a2535"}} placeholder="auto"/>
              </div>
              <div>
                <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>Outcome <span style={{color:"#3a5a7a",fontStyle:"italic"}}>auto-set</span></label>
                <Select value={form.outcome} onChange={e=>sf("outcome",e.target.value)} options={OUTCOMES}/>
              </div>
              {[["Bias","bias",BIASES],["Emotion","emotion",EMOTIONS]].map(([l,k,opts])=>(
                <div key={k}><label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>{l}</label><Select value={form[k]} onChange={e=>sf(k,e.target.value)} options={opts}/></div>
              ))}
            </div>
            <div style={{marginTop:12}}>
              <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>Confluences ({(form.confluences||[]).length} selected) <button onClick={()=>setShowConfluenceManager(true)} style={{background:"none",border:"none",color:"#60a5fa",fontSize:9,cursor:"pointer",letterSpacing:"0.1em"}}>+ MANAGE</button></label>
              <ConfluenceCheckboxes selected={form.confluences||[]} onChange={v=>sf("confluences",v)} confluences={confluences}/>
            </div>
            <div style={{marginTop:12}}>
              <label style={{display:"block",color:"#4a6a8a",fontSize:9,marginBottom:5,letterSpacing:"0.15em",textTransform:"uppercase"}}>Notes / Trade Rationale</label>
              <textarea value={form.notes} onChange={e=>sf("notes",e.target.value)} style={{...inp,minHeight:65,resize:"vertical"}} placeholder="IFVG formed during NY open, entered on retest..."/>
            </div>
            <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
              <input type="checkbox" id="fp" checked={form.followedPlan} onChange={e=>sf("followedPlan",e.target.checked)} style={{accentColor:"#f0b429",width:14,height:14}}/>
              <label htmlFor="fp" style={{fontSize:10,color:"#4a6a8a",cursor:"pointer",letterSpacing:"0.12em"}}>FOLLOWED TRADING PLAN</label>
            </div>
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={handleSubmit} className="np gold" style={{flex:1,padding:11}}>{editIdx!==null?"UPDATE TRADE":"LOG TRADE"}</button>
              <button onClick={()=>{setShowForm(false);setEditIdx(null);}} className="np dim" style={{padding:"11px 22px"}}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
