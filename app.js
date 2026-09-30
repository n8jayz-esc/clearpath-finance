(() => {
  "use strict";

  const STORAGE_KEY = "clearpath_finance_v1";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const money = (n) => new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"}).format(Number(n) || 0);
  const clamp = (n,min,max) => Math.min(max,Math.max(min,Number(n)||0));
  const uid = () => Date.now() + Math.floor(Math.random()*100000);
  const pad = (n) => String(n).padStart(2,"0");
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  const defaultMonth = `${today.getFullYear()}-${pad(today.getMonth()+1)}`;

  // Baselines from the balances being tracked when debt-progress tracking began.
  // Once migrated, each debt keeps its own startingBalance in saved data.
  const STARTING_BALANCE_BASELINES = {
    "amex plum": 2676.55,
    "amex gold": 3126.84,
    "apple card": 3477.86,
    "discover": 3969.47,
    "rcbc tuition": 1975.73
  };

  const starter = {
    monthlyIncome: 3640,
    weeklyIncome: 840,
    emergency: 100,
    emergencyTarget: 1000,
    creditScore: "",
    debts: [
      {id:1,name:"Amex Plum",balance:2742.55,startingBalance:2742.55,apr:0,min:66,limit:0,dueDay:"",type:"Charge card"},
      {id:2,name:"Amex Gold",balance:3112.15,startingBalance:3112.15,apr:0,min:86,limit:0,dueDay:"",type:"Charge card"},
      {id:3,name:"Apple Card",balance:3504.35,startingBalance:3504.35,apr:25.49,min:110,limit:0,dueDay:"",type:"Credit card"},
      {id:4,name:"Discover",balance:3993.47,startingBalance:3993.47,apr:23.49,min:115,limit:0,dueDay:"",type:"Credit card"}
    ],
    assets: [{id:11,name:"Starter savings",balance:100,type:"Savings"}],
    bills: [],
    goals: [],
    paychecks: [],
    transactions: [],
    rules: [
      {id:21,contains:"Wawa",category:"Flexible living"},
      {id:22,contains:"Sunoco",category:"Flexible living"},
      {id:23,contains:"Paycheck",category:"Income"}
    ],
    budget: [
      {id:31,name:"Debt minimums",type:"fixed",planned:412,monthlyPct:11.32,weeklyPct:11.32,rollover:false,carry:0},
      {id:32,name:"Flexible living",type:"flex",planned:728,monthlyPct:20,weeklyPct:20,rollover:false,carry:0},
      {id:33,name:"Buffer / sinking",type:"nonmonthly",planned:291,monthlyPct:8,weeklyPct:8,rollover:true,carry:0},
      {id:34,name:"Emergency / extra debt",type:"goal",planned:2209,monthlyPct:60.68,weeklyPct:60.68,rollover:false,carry:0}
    ]
  };

  function nextDueFromDay(day){
    const d = new Date();
    const target = clamp(day,1,28);
    let y=d.getFullYear(), m=d.getMonth();
    if(d.getDate()>target) m += 1;
    const x = new Date(y,m,target);
    return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;
  }

  function migrate(raw){
    const merged = {...structuredClone(starter), ...(raw || {})};
    merged.weeklyIncome = Number(merged.weeklyIncome) || Math.round((Number(merged.monthlyIncome)||3640)*12/52);
    merged.paychecks = Array.isArray(merged.paychecks) ? merged.paychecks : [];
    merged.transactions = Array.isArray(merged.transactions) ? merged.transactions : [];
    merged.debts = (Array.isArray(merged.debts) ? merged.debts : structuredClone(starter.debts)).map(d=>{
      const currentBalance=Math.max(0,Number(d.balance)||0);
      const knownBaseline=STARTING_BALANCE_BASELINES[String(d.name||"").trim().toLowerCase()];
      const startingBalance=Number.isFinite(Number(d.startingBalance))
        ? Math.max(0,Number(d.startingBalance))
        : (Number.isFinite(Number(knownBaseline)) ? Number(knownBaseline) : currentBalance);
      return {
        ...d,
        balance:currentBalance,
        startingBalance,
        minimumPayments:Array.isArray(d.minimumPayments) ? d.minimumPayments.filter(x=>x && x.period).map(x=>({period:String(x.period),paidAt:x.paidAt || ""})) : []
      };
    });
    merged.bills = (Array.isArray(merged.bills) ? merged.bills : []).map(b=>({
      id:b.id || uid(),
      name:b.name || "Recurring payment",
      amount:Math.max(0,Number(b.amount)||0),
      frequency:b.frequency === "yearly" ? "yearly" : "monthly",
      dueDate:b.dueDate || nextDueFromDay(b.day || 1),
      status:b.status === "canceled" ? "canceled" : "active",
      lastPaid:b.lastPaid || "",
      payments:Array.isArray(b.payments) ? b.payments.filter(x=>x && x.dueDate).map(x=>({dueDate:String(x.dueDate),paidAt:x.paidAt || ""})) : []
    }));
    merged.budget = (Array.isArray(merged.budget) ? merged.budget : structuredClone(starter.budget)).map(b=>{
      const monthlyIncome = Math.max(1,Number(merged.monthlyIncome)||3640);
      const fallbackPct = (Number(b.planned)||0)/monthlyIncome*100;
      return {
        id:b.id || uid(),
        name:b.name || "Budget category",
        type:b.type || "fixed",
        planned:Number(b.planned)||0,
        monthlyPct:Number.isFinite(Number(b.monthlyPct)) ? Number(b.monthlyPct) : fallbackPct,
        weeklyPct:Number.isFinite(Number(b.weeklyPct)) ? Number(b.weeklyPct) : fallbackPct,
        rollover:!!b.rollover,
        carry:Number(b.carry)||0
      };
    });
    return merged;
  }

  function load(){
    try{
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? migrate(JSON.parse(saved)) : structuredClone(starter);
    }catch(e){
      return structuredClone(starter);
    }
  }

  let state = load();
  let receiptItemsDraft = [];
  let receiptPreviewUrl = "";
  let calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0);
  let reportWeekISO = todayISO;

  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const el = $("#saveStatus");
    if(el) el.textContent = "Saved locally";
  }

  function escapeHtml(str){
    return String(str ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
  }

  function totalDebt(){ return state.debts.reduce((s,d)=>s+Math.max(0,Number(d.balance)||0),0); }
  function totalMinimums(){ return state.debts.reduce((s,d)=>s+Math.max(0,Number(d.min)||0),0); }
  function totalAssets(){ return state.assets.reduce((s,a)=>s+Math.max(0,Number(a.balance)||0),0); }
  function monthlyPlanned(b){ return Math.max(0,(state.monthlyIncome*(Number(b.monthlyPct)||0)/100) + (Number(b.carry)||0)); }
  function weeklyPlanned(b){ return Math.max(0,state.weeklyIncome*(Number(b.weeklyPct)||0)/100); }
  function totalMonthlyPlanned(){ return state.budget.reduce((s,b)=>s+monthlyPlanned(b),0); }

  function debtProgressRows(){
    return state.debts.map(d=>{
      const current=Math.max(0,Number(d.balance)||0);
      const starting=Math.max(0,Number(d.startingBalance)||0);
      const delta=starting-current;
      const paid=Math.max(0,delta);
      const pct=starting>0 ? clamp((delta/starting)*100,0,100) : (current===0 ? 100 : 0);
      return {...d,current,starting,delta,paid,pct};
    });
  }

  function currentMonthPaymentProgress(){
    const year=today.getFullYear(), month=today.getMonth(), period=monthKey(year,month);
    const items=[];
    state.debts.filter(d=>d.balance>0 && Number(d.min)>0).forEach(d=>{
      items.push({amount:Math.max(0,Number(d.min)||0),paid:!!debtPaymentFor(d,period)});
    });
    state.bills.filter(b=>b.status!=="canceled").forEach(b=>{
      const due=projectedBillDateForMonth(b,year,month);
      if(!due) return;
      const dueISO=occurrenceISO(due);
      items.push({amount:Math.max(0,Number(b.amount)||0),paid:!!billPaymentFor(b,dueISO)});
    });
    return {
      count:items.length,
      paidCount:items.filter(x=>x.paid).length,
      totalAmount:items.reduce((sum,x)=>sum+x.amount,0),
      paidAmount:items.filter(x=>x.paid).reduce((sum,x)=>sum+x.amount,0)
    };
  }

  function renderDebtProgress(){
    const wrap=$("#debtProgressAccounts");
    if(!wrap) return;
    const rows=debtProgressRows();
    const totalStarting=rows.reduce((sum,d)=>sum+d.starting,0);
    const totalCurrent=rows.reduce((sum,d)=>sum+d.current,0);
    const netPaid=Math.max(0,totalStarting-totalCurrent);
    const pct=totalStarting>0 ? clamp(netPaid/totalStarting*100,0,100) : 0;

    $("#debtProgressPaid").textContent=money(netPaid);
    $("#debtProgressRemaining").textContent=money(totalCurrent);
    $("#debtProgressStarting").textContent=money(totalStarting);
    $("#debtProgressPercent").textContent=`${pct.toFixed(pct<10?1:0)}%`;
    $("#debtMasterProgressBar").style.width=`${pct}%`;
    $("#debtProgressRing").style.setProperty("--debt-progress",`${pct*3.6}deg`);

    let message="Your progress will appear after a balance goes down.";
    if(pct>0 && pct<10) message="Momentum started. Keep stacking balance reductions.";
    else if(pct>=10 && pct<25) message="You have real momentum now. Keep the line moving.";
    else if(pct>=25 && pct<50) message="A quarter of the starting debt is already behind you.";
    else if(pct>=50 && pct<75) message="More progress is visible every time you lower a balance.";
    else if(pct>=75 && pct<100) message="The finish line is getting close.";
    else if(pct>=100) message="All tracked starting debt has been paid off.";
    $("#debtProgressMessage").textContent=message;

    const milestones=[1,5,10,25,50,75,100];
    const next=milestones.find(x=>x>pct+.0001);
    if(next){
      const amountToMilestone=Math.max(0,totalStarting*(next/100)-netPaid);
      $("#debtProgressMilestone").textContent=`${money(amountToMilestone)} to ${next}%`;
    }else{
      $("#debtProgressMilestone").textContent="Debt free";
    }

    wrap.innerHTML=rows.length ? rows.map(d=>{
      const changeText=d.delta>0.005 ? `${money(d.delta)} paid down` : d.delta<-.005 ? `${money(Math.abs(d.delta))} above start` : "At starting balance";
      return `<div class="debt-progress-row ${d.delta<-.005?'is-up':''}">
        <div class="debt-progress-row-head"><div><strong>${escapeHtml(d.name)}</strong><span>${escapeHtml(changeText)}</span></div><strong>${d.pct.toFixed(d.pct<10?1:0)}%</strong></div>
        <div class="debt-account-bar"><i style="width:${d.pct}%"></i></div>
        <div class="debt-progress-row-foot"><span>Started ${money(d.starting)}</span><span>Now ${money(d.current)}</span></div>
      </div>`;
    }).join("") : `<div class="empty">Add a debt account to start tracking payoff progress.</div>`;

    const payment=currentMonthPaymentProgress();
    const paymentPct=payment.count ? clamp(payment.paidCount/payment.count*100,0,100) : 0;
    $("#monthlyPaymentProgressText").textContent=`${payment.paidCount} of ${payment.count} paid`;
    $("#monthlyPaymentProgressAmount").textContent=`${money(payment.paidAmount)} of ${money(payment.totalAmount)} scheduled`;
    $("#monthlyPaymentProgressBar").style.width=`${paymentPct}%`;
  }

  function parseISO(dateLike){
    if(!dateLike) return null;
    if(/^\d{4}-\d{2}-\d{2}$/.test(dateLike)){
      const [y,m,d] = dateLike.split("-").map(Number);
      return new Date(y,m-1,d,12,0,0);
    }
    const d = new Date(dateLike);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function txDate(tx){ return parseISO(tx.dateISO) || parseISO(tx.date); }

  function currentMonthRange(){
    const now=new Date();
    return [new Date(now.getFullYear(),now.getMonth(),1), new Date(now.getFullYear(),now.getMonth()+1,1)];
  }

  function currentWeekRange(){
    const now=new Date();
    const start=new Date(now.getFullYear(),now.getMonth(),now.getDate(),0,0,0);
    const day=(start.getDay()+6)%7;
    start.setDate(start.getDate()-day);
    const end=new Date(start); end.setDate(end.getDate()+7);
    return [start,end];
  }

  function weekRangeForDate(dateLike){
    const d=parseISO(dateLike) || new Date();
    const start=new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,0,0);
    const day=(start.getDay()+6)%7;
    start.setDate(start.getDate()-day);
    const end=new Date(start); end.setDate(end.getDate()+7);
    return [start,end];
  }

  function toISODate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

  function inRange(date,start,end){ return !!date && date>=start && date<end; }

  function categorySpent(name, period="month"){
    const [start,end] = period === "week" ? currentWeekRange() : currentMonthRange();
    return state.transactions
      .filter(t => (t.type === "expense" || t.type === "debt") && t.category === name && inRange(txDate(t),start,end))
      .reduce((s,t)=>s+Math.max(0,Number(t.amount)||0),0);
  }

  function categoryFunded(categoryId, period="month"){
    const [start,end] = period === "week" ? currentWeekRange() : currentMonthRange();
    return state.paychecks
      .filter(p => inRange(parseISO(p.date),start,end))
      .reduce((sum,p)=>sum + (p.allocations || []).filter(a=>Number(a.categoryId)===Number(categoryId)).reduce((s,a)=>s+Math.max(0,Number(a.amount)||0),0),0);
  }

  function activeSnowball(){
    return [...state.debts].filter(d=>d.balance>0).sort((a,b)=>a.balance-b.balance || b.apr-a.apr)[0] || null;
  }

  function nav(){
    $$(".tab").forEach(btn=>btn.addEventListener("click",()=>{
      $$(".tab").forEach(x=>x.classList.remove("active"));
      $$(".view").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      const view = $(`#view-${btn.dataset.tab}`);
      if(view) view.classList.add("active");
    }));
  }

  function renderMetrics(){
    $("#metricDebt").textContent = money(totalDebt());
    $("#metricDebtCount").textContent = `${state.debts.length} tracked account${state.debts.length===1?"":"s"}`;
    $("#metricEmergency").textContent = `${money(state.emergency)} / ${money(state.emergencyTarget)}`;
    $("#metricEmergencyBar").style.width = `${clamp(state.emergency/state.emergencyTarget*100,0,100)}%`;
    $("#metricMinimums").textContent = money(totalMinimums());
    $("#metricNetWorth").textContent = money(totalAssets()-totalDebt());
    $("#snapshotIncome").textContent = money(state.monthlyIncome);
    $("#snapshotBudget").textContent = money(totalMonthlyPlanned());
    $("#snapshotLeft").textContent = money(state.monthlyIncome - state.budget.reduce((s,b)=>s+(state.monthlyIncome*(Number(b.monthlyPct)||0)/100),0));
    const target = activeSnowball();
    $("#snapshotTarget").textContent = target ? target.name : "Debt free";
  }

  function renderAllocator(){
    const net = Math.max(0,Number($("#payNet").value)||0);
    const living = net*clamp($("#payLivingPct").value,0,100)/100;
    const buffer = net*clamp($("#payBufferPct").value,0,100)/100;
    const bills = Math.min(Math.max(0,Number($("#payBills").value)||0),Math.max(0,net-living-buffer));
    const remaining = Math.max(0,net-living-buffer-bills);
    const emergencyLeft = Math.max(0,state.emergencyTarget-state.emergency);
    const toEmergency = Math.min(remaining,emergencyLeft);
    const toDebt = Math.max(0,remaining-toEmergency);
    $("#priorityChip").textContent = emergencyLeft>0 ? "Emergency fund" : "Debt snowball";

    const rows = [
      ["Living",living,"Gas, groceries, food, personal"],
      ["Bills / minimums",bills,"Money already spoken for"],
      ["Buffer",buffer,"Small cushion and sinking money"]
    ];
    if(emergencyLeft>0) rows.push(["Emergency fund",toEmergency,`${money(emergencyLeft)} remaining to target`]);
    if(toDebt>0 || emergencyLeft===0) rows.push(["Extra debt snowball",emergencyLeft>0?toDebt:remaining,"Send to current payoff target"]);
    $("#allocationResults").innerHTML = rows.map(r=>`<div class="item"><span class="dot"></span><div class="item-main"><strong>${escapeHtml(r[0])}</strong><span>${escapeHtml(r[2])}</span></div><div class="item-money">${money(r[1])}</div></div>`).join("");
  }

  function getPaycheckAllocationInputs(){ return [...document.querySelectorAll("[data-paycheck-allocation]")]; }

  function updatePaycheckTotals(){
    const amount = Math.max(0,Number($("#paycheckAmount")?.value)||0);
    const allocated = getPaycheckAllocationInputs().reduce((sum,input)=>sum+Math.max(0,Number(input.value)||0),0);
    const remaining = amount-allocated;
    if($("#paycheckAllocatedTotal")) $("#paycheckAllocatedTotal").textContent = money(allocated);
    if($("#paycheckUnallocatedTotal")) $("#paycheckUnallocatedTotal").textContent = money(remaining);
    if($("#paycheckRemainingChip")){
      $("#paycheckRemainingChip").textContent = `${money(Math.abs(remaining))} ${remaining<-.005?"over":"unallocated"}`;
      $("#paycheckRemainingChip").classList.toggle("bad",remaining<-.005);
      $("#paycheckRemainingChip").classList.toggle("good",Math.abs(remaining)<.005);
    }
  }

  function renderPaycheckEditor(){
    const wrap=$("#paycheckAllocationEditor");
    if(!wrap) return;
    wrap.innerHTML = state.budget.length ? state.budget.map(b=>`
      <div class="allocation-row">
        <div><strong>${escapeHtml(b.name)}</strong><span>${Number(b.weeklyPct||0).toFixed(1)}% weekly plan · ${money(categoryFunded(b.id,"week"))} funded this week</span></div>
        <input data-paycheck-allocation="${b.id}" type="number" min="0" step="0.01" value="0" aria-label="Allocation to ${escapeHtml(b.name)}" />
      </div>`).join("") : `<div class="empty">Add budget categories first.</div>`;
    getPaycheckAllocationInputs().forEach(input=>input.addEventListener("input",updatePaycheckTotals));
    updatePaycheckTotals();
  }

  function autoAllocatePaycheck(){
    const amount=Math.max(0,Number($("#paycheckAmount").value)||0);
    if(!state.budget.length || amount<=0){ updatePaycheckTotals(); return; }
    const weights=state.budget.map(b=>Math.max(0,Number(b.weeklyPct)||0));
    const total=weights.reduce((a,b)=>a+b,0);
    let used=0;
    const inputs=getPaycheckAllocationInputs();
    inputs.forEach((input,i)=>{
      let value=0;
      if(total>0) value = i===inputs.length-1 ? amount-used : Math.round((amount*(weights[i]/total))*100)/100;
      else value = i===inputs.length-1 ? amount-used : Math.round((amount/inputs.length)*100)/100;
      value=Math.max(0,value); used+=value; input.value=value.toFixed(2);
    });
    updatePaycheckTotals();
  }

  function savePaycheckAllocation(){
    const amount=Math.max(0,Number($("#paycheckAmount").value)||0);
    const date=$("#paycheckDate").value;
    if(!date || amount<=0){ alert("Enter the pay date and take-home amount first."); return; }
    const allocations=getPaycheckAllocationInputs().map(input=>({categoryId:Number(input.dataset.paycheckAllocation),amount:Math.max(0,Number(input.value)||0)})).filter(a=>a.amount>0);
    const allocated=allocations.reduce((s,a)=>s+a.amount,0);
    if(allocated-amount>.005){ alert("Your allocations are more than the paycheck. Reduce them before saving."); return; }
    const txId=uid();
    state.transactions.push({id:txId,name:"Paycheck",amount,type:"income",category:"Income",tag:"paycheck",dateISO:date,date:parseISO(date).toLocaleDateString()});
    state.paychecks.push({id:uid(),date,amount,allocations,transactionId:txId});
    $("#paycheckAmount").value="";
    getPaycheckAllocationInputs().forEach(i=>i.value="0");
    save(); renderAll();
  }

  function renderPaychecks(){
    const wrap=$("#paycheckHistory"); if(!wrap) return;
    $("#paycheckCountChip").textContent = `${state.paychecks.length} check${state.paychecks.length===1?"":"s"}`;
    const items=[...state.paychecks].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    wrap.innerHTML = items.length ? items.map(p=>{
      const lines=(p.allocations||[]).map(a=>{
        const b=state.budget.find(x=>Number(x.id)===Number(a.categoryId));
        return `${escapeHtml(b?.name || "Deleted category")}: ${money(a.amount)}`;
      }).join(" · ");
      return `<div class="item"><span class="dot"></span><div class="item-main"><strong>${parseISO(p.date)?.toLocaleDateString() || p.date}</strong><span>${lines || "No allocations"}</span></div><div class="item-money">${money(p.amount)}</div><button class="icon-button" data-delete-paycheck="${p.id}" aria-label="Delete paycheck">×</button></div>`;
    }).join("") : `<div class="empty">No paychecks saved yet.</div>`;
    $$('[data-delete-paycheck]').forEach(btn=>btn.addEventListener('click',()=>{
      if(!confirm("Delete this saved paycheck allocation?")) return;
      const p=state.paychecks.find(x=>Number(x.id)===Number(btn.dataset.deletePaycheck));
      if(p?.transactionId) state.transactions=state.transactions.filter(t=>Number(t.id)!==Number(p.transactionId));
      state.paychecks=state.paychecks.filter(x=>Number(x.id)!==Number(btn.dataset.deletePaycheck));
      save(); renderAll();
    }));
  }

  function renderDaily(){
    const activeBills=state.bills.filter(b=>b.status!=="canceled");
    const nextBills=activeBills.map(b=>({bill:b,due:nextBillOccurrence(b)})).filter(x=>x.due).sort((a,b)=>a.due-b.due).slice(0,3);
    const target=activeSnowball();
    const emergencyLeft=Math.max(0,state.emergencyTarget-state.emergency);
    const tasks=[
      ["Review transactions",`${state.transactions.length} transaction${state.transactions.length===1?"":"s"} tracked`],
      ["Check recurring bills",nextBills.length ? `Next: ${nextBills[0].bill.name} ${formatDueDate(occurrenceISO(nextBills[0].due))}` : "No active recurring bills"],
      [emergencyLeft>0 ? "Build starter fund" : "Make snowball payment", emergencyLeft>0 ? `${money(emergencyLeft)} left to reach goal` : target ? `Current target: ${target.name}` : "No remaining debt"]
    ];
    $("#dailyChecklist").innerHTML = tasks.map(t=>`<div class="item"><span class="dot"></span><div class="item-main"><strong>${escapeHtml(t[0])}</strong><span>${escapeHtml(t[1])}</span></div></div>`).join("");
  }

  function projectedBillDateForMonth(bill,year,monthIndex){
    if(!bill || bill.status === "canceled" || !bill.dueDate) return null;
    const base=parseISO(bill.dueDate); if(!base) return null;
    const monthKey=year*12+monthIndex;
    const baseKey=base.getFullYear()*12+base.getMonth();
    if(monthKey < baseKey) return null;
    if(bill.frequency === "yearly" && monthIndex !== base.getMonth()) return null;
    const day=Math.min(base.getDate(),new Date(year,monthIndex+1,0).getDate());
    return new Date(year,monthIndex,day,12,0,0);
  }

  function calendarEventsForMonth(year,monthIndex){
    const events=[];
    const daysInMonth=new Date(year,monthIndex+1,0).getDate();
    state.debts.filter(d=>d.balance>0 && Number(d.min)>0 && Number(d.dueDay)>0).forEach(d=>{
      const day=Math.min(clamp(d.dueDay,1,31),daysInMonth);
      const paid=!!debtPaymentFor(d,monthKey(year,monthIndex));
      events.push({day,type:"debt",name:d.name,amount:Number(d.min)||0,detail:paid?"minimum · paid":"minimum",paid});
    });
    state.bills.forEach(b=>{
      const due=projectedBillDateForMonth(b,year,monthIndex);
      if(due){ const dueISO=occurrenceISO(due); const paid=!!billPaymentFor(b,dueISO); events.push({day:due.getDate(),type:"bill",name:b.name,amount:Number(b.amount)||0,detail:`${b.frequency === "yearly" ? "yearly" : "monthly"}${paid?" · paid":""}`,paid}); }
    });
    return events;
  }

  function renderCalendar(){
    const grid=$("#paymentCalendar"), title=$("#calendarTitle");
    if(!grid || !title) return;
    const year=calendarCursor.getFullYear(), month=calendarCursor.getMonth();
    title.textContent=calendarCursor.toLocaleDateString("en-US",{month:"long",year:"numeric"});
    const first=new Date(year,month,1,12,0,0);
    const days=new Date(year,month+1,0).getDate();
    const prevDays=new Date(year,month,0).getDate();
    const leading=first.getDay();
    const totalCells=Math.ceil((leading+days)/7)*7;
    const events=calendarEventsForMonth(year,month);
    const cells=[];
    for(let i=0;i<totalCells;i++){
      let cellDay,cellMonth=month,cellYear=year,outside=false;
      if(i<leading){ cellDay=prevDays-leading+i+1; cellMonth=month-1; outside=true; }
      else if(i>=leading+days){ cellDay=i-leading-days+1; cellMonth=month+1; outside=true; }
      else cellDay=i-leading+1;
      const cellDate=new Date(cellYear,cellMonth,cellDay,12,0,0);
      const isToday=cellDate.getFullYear()===today.getFullYear() && cellDate.getMonth()===today.getMonth() && cellDate.getDate()===today.getDate();
      const dayEvents=outside ? [] : events.filter(e=>e.day===cellDay);
      cells.push(`<div class="calendar-day${outside?" outside":""}${isToday?" today":""}"><div class="calendar-day-number"><span>${cellDay}</span></div><div class="calendar-events">${dayEvents.map(e=>`<div class="calendar-event ${e.type}${e.paid?' paid':''}" title="${escapeHtml(e.name)} ${money(e.amount)}"><strong>${e.paid?'✓ ':''}${escapeHtml(e.name)}</strong><span>${money(e.amount)} ${escapeHtml(e.detail)}</span></div>`).join("")}</div></div>`);
    }
    grid.innerHTML=cells.join("");
  }

  function renderDebts(){
    $("#debtTotalChip").textContent = money(totalDebt());
    const sorted=[...state.debts].sort((a,b)=>a.balance-b.balance);
    $("#debtList").innerHTML = sorted.length ? sorted.map((d,i)=>{
      const util=d.limit>0 ? clamp(d.balance/d.limit*100,0,999) : null;
      return `<div class="item"><span class="chip">${i+1}</span><div class="item-main"><strong>${escapeHtml(d.name)}</strong><span>${escapeHtml(d.type)} · ${Number(d.apr).toFixed(2)}% APR · ${money(d.min)}/mo minimum${d.dueDay?` · due day ${d.dueDay}`:""}</span>${util!==null?`<span>${util.toFixed(1)}% utilization</span>`:""}</div><div class="item-money">${money(d.balance)}</div><button class="secondary" data-edit-debt="${d.id}" type="button">Edit</button><button class="icon-button" data-delete-debt="${d.id}" aria-label="Delete ${escapeHtml(d.name)}">×</button></div>`;
    }).join("") : `<div class="empty">No debts added.</div>`;
    $$('[data-edit-debt]').forEach(btn=>btn.addEventListener('click',()=>openDebtEdit(Number(btn.dataset.editDebt))));
    $$('[data-delete-debt]').forEach(btn=>btn.addEventListener('click',()=>{
      if(confirm("Remove this debt account?")){
        state.debts=state.debts.filter(d=>d.id!==Number(btn.dataset.deleteDebt)); save(); renderAll();
      }
    }));
    refreshDebtSelect(); simulatePayoff();
  }

  function openDebtEdit(id){
    const d=state.debts.find(x=>x.id===id); if(!d) return;
    $("#editDebtId").value=d.id; $("#editDebtName").value=d.name; $("#editDebtBalance").value=d.balance; $("#editDebtStartingBalance").value=Number.isFinite(Number(d.startingBalance))?d.startingBalance:d.balance; $("#editDebtApr").value=d.apr; $("#editDebtMin").value=d.min; $("#editDebtLimit").value=d.limit||""; $("#editDebtDueDay").value=d.dueDay||""; $("#editDebtType").value=d.type;
    $("#debtEditDialog").showModal();
  }

  function simulatePayoff(){
    const strategy=$("#payoffStrategy").value;
    const extra=Math.max(0,Number($("#payoffExtra").value)||0);
    const lump=Math.max(0,Number($("#payoffLump").value)||0);
    const debts=state.debts.filter(d=>d.balance>0).map(d=>({...d,balance:Number(d.balance),apr:Number(d.apr),min:Number(d.min)}));
    if(!debts.length){ $("#payoffDate").textContent="Debt free"; $("#payoffInterest").textContent=money(0); $("#payoffOrder").innerHTML=""; $("#payoffNote").textContent="No tracked balances remain."; return; }
    let lumpLeft=lump;
    const sortFn=strategy==="avalanche" ? (a,b)=>b.apr-a.apr || a.balance-b.balance : (a,b)=>a.balance-b.balance || b.apr-a.apr;
    for(const d of [...debts].sort(sortFn)){ if(lumpLeft<=0) break; const p=Math.min(lumpLeft,d.balance); d.balance-=p; lumpLeft-=p; }
    const monthlyBudget=debts.reduce((s,d)=>s+d.min,0)+extra;
    let month=0,interest=0; const payoffMonth={};
    while(debts.some(d=>d.balance>.005) && month<600 && monthlyBudget>0){
      month++;
      for(const d of debts){ if(d.balance<=0) continue; const i=d.balance*(d.apr/1200); d.balance+=i; interest+=i; }
      let available=monthlyBudget;
      for(const d of debts){ if(d.balance<=0 || available<=0) continue; const p=Math.min(d.min,d.balance,available); d.balance-=p; available-=p; }
      for(const d of [...debts].filter(x=>x.balance>0).sort(sortFn)){ if(available<=0) break; const p=Math.min(available,d.balance); d.balance-=p; available-=p; }
      for(const d of debts){ if(d.balance<=.005 && !payoffMonth[d.id]) payoffMonth[d.id]=month; }
    }
    const startRaw=$("#payoffStart").value||defaultMonth; const [y,m]=startRaw.split("-").map(Number); const finish=new Date(y,m-1+Math.max(0,month-1),1);
    $("#payoffDate").textContent=month>=600?"600+ months":finish.toLocaleDateString("en-US",{month:"long",year:"numeric"});
    $("#payoffInterest").textContent=money(interest);
    $("#payoffNote").textContent=`${strategy==="snowball"?"Snowball":"Avalanche"} using ${money(monthlyBudget)}/month total debt payments${lump>0?` plus a ${money(lump)} lump sum`:""}. Interest is estimated monthly.`;
    const order=[...state.debts].filter(d=>d.balance>0).sort(sortFn);
    $("#payoffOrder").innerHTML=order.map((d,i)=>`<div class="item"><span class="chip">${i+1}</span><div class="item-main"><strong>${escapeHtml(d.name)}</strong><span>${money(d.balance)} · ${Number(d.apr).toFixed(2)}% APR</span></div><div class="item-money">${payoffMonth[d.id]?`~${payoffMonth[d.id]} mo`:"—"}</div></div>`).join("");
  }

  function renderBudgetOverview(){
    const wrap=$("#budgetOverview"); if(!wrap) return;
    wrap.innerHTML=state.budget.length ? state.budget.map(b=>{
      const planned=monthlyPlanned(b), spent=categorySpent(b.name,"month"), left=planned-spent, pct=planned?clamp(spent/planned*100,0,100):0;
      return `<div class="budget-overview-card"><div class="budget-overview-top"><div><strong>${escapeHtml(b.name)}</strong><span>${Number(b.monthlyPct||0).toFixed(1)}% of monthly income</span></div><strong class="${left<0?'bad':'good'}">${left<0?`${money(Math.abs(left))} over`:`${money(left)} left`}</strong></div><div class="progress"><i style="width:${pct}%"></i></div><div class="budget-overview-numbers"><span>Planned ${money(planned)}</span><span>Spent ${money(spent)}</span></div></div>`;
    }).join("") : `<div class="empty">Add budget categories to see an overview.</div>`;
  }

  function renderBudget(){
    $("#monthlyIncome").value=state.monthlyIncome;
    $("#weeklyIncome").value=state.weeklyIncome;
    const monthlyBase=state.budget.reduce((s,b)=>s+state.monthlyIncome*(Number(b.monthlyPct)||0)/100,0);
    const weeklyBase=state.budget.reduce((s,b)=>s+state.weeklyIncome*(Number(b.weeklyPct)||0)/100,0);
    $("#budgetLeftChip").textContent=`${money(state.monthlyIncome-monthlyBase)} left`;
    $("#weeklyBudgetLeftChip").textContent=`${money(state.weeklyIncome-weeklyBase)} left`;

    const body=$("#budgetTable"); body.innerHTML=""; const tpl=$("#budgetRowTemplate");
    state.budget.forEach((b,index)=>{
      const row=tpl.content.firstElementChild.cloneNode(true);
      const planned=monthlyPlanned(b), funded=categoryFunded(b.id,"month"), spent=categorySpent(b.name,"month"), remaining=planned-spent;
      row.querySelector(".budget-name").value=b.name;
      row.querySelector(".budget-type").value=b.type;
      row.querySelector(".budget-monthly-pct").value=Number(b.monthlyPct||0).toFixed(1);
      row.querySelector(".budget-planned").value=planned.toFixed(2);
      row.querySelector(".budget-funded-cell").textContent=money(funded);
      row.querySelector(".budget-spent-cell").textContent=money(spent);
      row.querySelector(".budget-remaining-cell").textContent=money(remaining);
      row.querySelector(".budget-remaining-cell").classList.toggle("bad",remaining<0);
      row.querySelector(".budget-rollover").checked=!!b.rollover;
      row.querySelector(".budget-name").addEventListener("change",e=>{ b.name=e.target.value.trim()||"Untitled"; save(); renderAll(); });
      row.querySelector(".budget-type").addEventListener("change",e=>{ b.type=e.target.value; save(); renderAll(); });
      row.querySelector(".budget-monthly-pct").addEventListener("change",e=>{ b.monthlyPct=clamp(e.target.value,0,100); b.planned=state.monthlyIncome*b.monthlyPct/100; save(); renderAll(); });
      row.querySelector(".budget-planned").addEventListener("change",e=>{ const val=Math.max(0,Number(e.target.value)||0); b.monthlyPct=state.monthlyIncome?val/state.monthlyIncome*100:0; b.planned=val; save(); renderAll(); });
      row.querySelector(".budget-rollover").addEventListener("change",e=>{ b.rollover=e.target.checked; save(); renderAll(); });
      row.querySelector(".budget-delete").addEventListener("click",()=>{ if(confirm("Delete this budget category?")){ state.budget.splice(index,1); save(); renderAll(); } });
      body.appendChild(row);
    });

    const weeklyBody=$("#weeklyBudgetTable"); weeklyBody.innerHTML=""; const weeklyTpl=$("#weeklyBudgetRowTemplate");
    state.budget.forEach(b=>{
      const row=weeklyTpl.content.firstElementChild.cloneNode(true);
      const planned=weeklyPlanned(b), funded=categoryFunded(b.id,"week"), spent=categorySpent(b.name,"week"), remaining=planned-spent;
      row.querySelector(".weekly-budget-name").textContent=b.name;
      row.querySelector(".budget-weekly-pct").value=Number(b.weeklyPct||0).toFixed(1);
      row.querySelector(".budget-weekly-planned").value=planned.toFixed(2);
      row.querySelector(".weekly-funded-cell").textContent=money(funded);
      row.querySelector(".weekly-spent-cell").textContent=money(spent);
      row.querySelector(".weekly-remaining-cell").textContent=money(remaining);
      row.querySelector(".weekly-remaining-cell").classList.toggle("bad",remaining<0);
      row.querySelector(".budget-weekly-pct").addEventListener("change",e=>{ b.weeklyPct=clamp(e.target.value,0,100); save(); renderAll(); });
      row.querySelector(".budget-weekly-planned").addEventListener("change",e=>{ const val=Math.max(0,Number(e.target.value)||0); b.weeklyPct=state.weeklyIncome?val/state.weeklyIncome*100:0; save(); renderAll(); });
      weeklyBody.appendChild(row);
    });

    const monthlySpent=state.budget.reduce((s,b)=>s+categorySpent(b.name,"month"),0);
    const monthlyFunded=state.budget.reduce((s,b)=>s+categoryFunded(b.id,"month"),0);
    const weeklySpent=state.budget.reduce((s,b)=>s+categorySpent(b.name,"week"),0);
    const weeklyFunded=state.budget.reduce((s,b)=>s+categoryFunded(b.id,"week"),0);
    $("#budgetPlanned").textContent=money(totalMonthlyPlanned());
    $("#budgetFunded").textContent=money(monthlyFunded);
    $("#budgetSpent").textContent=money(monthlySpent);
    $("#budgetSaved").textContent=money(totalMonthlyPlanned()-monthlySpent);
    $("#weeklyBudgetPlanned").textContent=money(weeklyBase);
    $("#weeklyBudgetFunded").textContent=money(weeklyFunded);
    $("#weeklyBudgetSpent").textContent=money(weeklySpent);
    renderBudgetOverview();
    refreshCategorySelects();
    renderReceiptItems();
  }

  function addTransaction({name,amount,type="expense",category,tag="",dateISO=todayISO,receiptId=""}){
    const value=Math.max(0,Number(amount)||0); if(!name || value<=0) return null;
    const d=parseISO(dateISO)||new Date();
    const tx={id:uid(),name,amount:value,type,category,tag,dateISO:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,date:d.toLocaleDateString(),receiptId};
    state.transactions.push(tx); return tx;
  }

  function renderTransactions(){
    const search=($("#txSearch").value||"").trim().toLowerCase();
    const list=[...state.transactions].reverse().filter(t=>!search || `${t.name} ${t.category} ${t.tag||""}`.toLowerCase().includes(search));
    $("#transactionList").innerHTML=list.length ? list.map(t=>`<div class="item"><span class="dot"></span><div class="item-main"><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.category)}${t.tag?` · #${escapeHtml(t.tag)}`:""} · ${escapeHtml(t.date || t.dateISO || "")}</span></div><div class="item-money ${t.type==="income"?"good":"bad"}">${t.type==="income"?"+":"-"}${money(t.amount)}</div><button class="icon-button" data-delete-tx="${t.id}" aria-label="Delete transaction">×</button></div>`).join("") : `<div class="empty">No matching transactions.</div>`;
    $$('[data-delete-tx]').forEach(btn=>btn.addEventListener('click',()=>{ state.transactions=state.transactions.filter(t=>t.id!==Number(btn.dataset.deleteTx)); save(); renderAll(); }));
  }

  function renderRules(){
    $("#ruleList").innerHTML=state.rules.length ? state.rules.map(r=>`<div class="item"><span class="dot"></span><div class="item-main"><strong>Contains “${escapeHtml(r.contains)}”</strong><span>→ ${escapeHtml(r.category)}</span></div><button class="icon-button" data-delete-rule="${r.id}" aria-label="Delete rule">×</button></div>`).join("") : `<div class="empty">No rules yet.</div>`;
    $$('[data-delete-rule]').forEach(btn=>btn.addEventListener('click',()=>{ state.rules=state.rules.filter(r=>r.id!==Number(btn.dataset.deleteRule)); save(); renderAll(); }));
  }

  function receiptCategoryOptions(selected=""){
    const names=state.budget.map(b=>b.name);
    return names.map(n=>`<option ${n===selected?"selected":""}>${escapeHtml(n)}</option>`).join("");
  }

  function renderReceiptItems(){
    const wrap=$("#receiptItems"); if(!wrap) return;
    wrap.innerHTML=receiptItemsDraft.length ? receiptItemsDraft.map(item=>`<div class="receipt-item-row" data-receipt-item="${item.id}"><label class="receipt-confirm"><input data-receipt-confirm="${item.id}" type="checkbox" ${item.confirmed!==false?"checked":""} /> Use</label><input data-receipt-name="${item.id}" value="${escapeHtml(item.name)}" aria-label="Receipt item name" /><input data-receipt-price="${item.id}" type="number" min="0" step="0.01" value="${Number(item.price||0).toFixed(2)}" aria-label="Receipt item price" /><select data-receipt-category="${item.id}" aria-label="Receipt item category">${receiptCategoryOptions(item.category)}</select><button class="icon-button" data-delete-receipt-item="${item.id}" type="button" aria-label="Delete receipt item">×</button></div>`).join("") : `<div class="empty">No receipt items yet. Scan a photo or add an item manually.</div>`;
    $$('[data-receipt-confirm]').forEach(el=>el.addEventListener('change',()=>{ const x=receiptItemsDraft.find(i=>i.id===Number(el.dataset.receiptConfirm)); if(x) x.confirmed=el.checked; updateReceiptTotals(); }));
    $$('[data-receipt-name]').forEach(el=>el.addEventListener('input',()=>{ const x=receiptItemsDraft.find(i=>i.id===Number(el.dataset.receiptName)); if(x) x.name=el.value; }));
    $$('[data-receipt-price]').forEach(el=>el.addEventListener('input',()=>{ const x=receiptItemsDraft.find(i=>i.id===Number(el.dataset.receiptPrice)); if(x) x.price=Math.max(0,Number(el.value)||0); updateReceiptTotals(); }));
    $$('[data-receipt-category]').forEach(el=>el.addEventListener('change',()=>{ const x=receiptItemsDraft.find(i=>i.id===Number(el.dataset.receiptCategory)); if(x) x.category=el.value; }));
    $$('[data-delete-receipt-item]').forEach(el=>el.addEventListener('click',()=>{ receiptItemsDraft=receiptItemsDraft.filter(i=>i.id!==Number(el.dataset.deleteReceiptItem)); renderReceiptItems(); updateReceiptTotals(); }));
    updateReceiptTotals();
  }

  function updateReceiptTotals(){
    const confirmed=receiptItemsDraft.filter(i=>i.confirmed!==false).reduce((s,i)=>s+Math.max(0,Number(i.price)||0),0);
    if($("#receiptConfirmedTotal")) $("#receiptConfirmedTotal").value=money(confirmed);
    const receiptTotal=Math.max(0,Number($("#receiptTotal")?.value)||0);
    const diff=receiptTotal-confirmed;
    if($("#receiptDifference")){
      if(!receiptTotal && !confirmed) $("#receiptDifference").textContent="Add or scan items to compare them with the receipt total.";
      else if(Math.abs(diff)<0.01) $("#receiptDifference").textContent="Confirmed items match the receipt total.";
      else $("#receiptDifference").textContent=`Difference: ${money(diff)}. Check tax, discounts, tips, or any missed item.`;
    }
  }

  function clearReceipt(){
    receiptItemsDraft=[];
    if(receiptPreviewUrl){ URL.revokeObjectURL(receiptPreviewUrl); receiptPreviewUrl=""; }
    $("#receiptImage").value=""; $("#receiptPreview").hidden=true; $("#receiptPreview").removeAttribute("src"); $("#receiptMerchant").value=""; $("#receiptTotal").value=""; $("#receiptDate").value=todayISO; $("#receiptScanStatus").textContent="Choose a receipt image to begin. If OCR cannot read something, you can type it manually.";
    renderReceiptItems();
  }

  function addManualReceiptItem(name="Receipt item",price=0,category=""){
    receiptItemsDraft.push({id:uid(),name,price,category:category || state.budget[0]?.name || "",confirmed:true});
    renderReceiptItems();
  }

  function loadTesseract(){
    if(window.Tesseract) return Promise.resolve(window.Tesseract);
    return new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-tesseract-loader]');
      if(existing){ existing.addEventListener('load',()=>resolve(window.Tesseract),{once:true}); existing.addEventListener('error',reject,{once:true}); return; }
      const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'; s.async=true; s.dataset.tesseractLoader='1'; s.onload=()=>resolve(window.Tesseract); s.onerror=()=>reject(new Error('OCR library failed to load')); document.head.appendChild(s);
    });
  }

  function parseReceiptText(text){
    const lines=String(text||"").split(/\r?\n/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
    const priceRe=/(\d{1,5}[.,]\d{2})\s*$/;
    const skipRe=/\b(subtotal|total|tax|change|cash|credit|debit|visa|mastercard|amex|discover|balance|payment|tender|amount due|savings|discount)\b/i;
    let total=0;
    for(const line of lines){
      const m=line.match(priceRe);
      if(m && /\btotal\b/i.test(line) && !/subtotal/i.test(line)) total=Math.max(total,Number(m[1].replace(',','.'))||0);
    }
    const items=[];
    for(const line of lines){
      const m=line.match(priceRe); if(!m || skipRe.test(line)) continue;
      const price=Number(m[1].replace(',','.'))||0; if(price<=0) continue;
      let name=line.slice(0,m.index).replace(/[\*#]+/g,'').trim();
      name=name.replace(/^\d{4,}\s+/, '').replace(/\s{2,}/g,' ').trim();
      if(name.length<2) name='Receipt item';
      items.push({id:uid(),name:name.slice(0,80),price,category:state.budget.find(b=>b.type==='flex')?.name || state.budget[0]?.name || '',confirmed:true});
    }
    const merchant=lines.find(line=>!priceRe.test(line) && line.length>=3 && line.length<=50) || '';
    return {items:items.slice(0,40),total,merchant};
  }

  async function scanReceipt(){
    const file=$("#receiptImage").files?.[0];
    if(!file){ alert("Choose or take a receipt photo first."); return; }
    $("#receiptScanStatus").textContent="Loading receipt scanner…";
    try{
      const T=await loadTesseract();
      $("#receiptScanStatus").textContent="Reading receipt… this can take a little while on a phone.";
      const result=await T.recognize(file,'eng',{logger:m=>{ if(m.status && typeof m.progress==='number') $("#receiptScanStatus").textContent=`${m.status} ${Math.round(m.progress*100)}%`; }});
      const parsed=parseReceiptText(result?.data?.text || '');
      if(parsed.merchant && !$("#receiptMerchant").value) $("#receiptMerchant").value=parsed.merchant;
      if(parsed.total>0) $("#receiptTotal").value=parsed.total.toFixed(2);
      receiptItemsDraft=parsed.items;
      if(!receiptItemsDraft.length) addManualReceiptItem(); else renderReceiptItems();
      $("#receiptScanStatus").textContent=parsed.items.length ? `Found ${parsed.items.length} possible item${parsed.items.length===1?'':'s'}. Confirm names, prices, and categories.` : "OCR finished, but item lines were unclear. Add the items manually below.";
      updateReceiptTotals();
    }catch(err){
      $("#receiptScanStatus").textContent="Automatic scanning is unavailable right now. You can still enter the receipt items manually.";
      if(!receiptItemsDraft.length) addManualReceiptItem();
    }
  }

  function confirmReceipt(){
    const merchant=$("#receiptMerchant").value.trim() || "Receipt";
    const date=$("#receiptDate").value || todayISO;
    const selected=receiptItemsDraft.filter(i=>i.confirmed!==false && Math.max(0,Number(i.price)||0)>0);
    if(!selected.length){ alert("Confirm at least one receipt item with a price."); return; }
    const receiptId=`receipt-${uid()}`;
    selected.forEach(i=>addTransaction({name:i.name.trim() || `${merchant} item`,amount:i.price,type:'expense',category:i.category || state.budget[0]?.name || 'Uncategorized',tag:`receipt:${merchant}`,dateISO:date,receiptId}));
    save(); clearReceipt(); renderAll();
  }

  function formatDueDate(iso){ const d=parseISO(iso); return d ? d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'No due date'; }
  function monthKey(year,monthIndex){ return `${year}-${pad(monthIndex+1)}`; }
  function debtPaymentFor(d,period){ return (d.minimumPayments || []).find(x=>x.period===period) || null; }
  function billPaymentFor(b,dueISO){ return (b.payments || []).find(x=>x.dueDate===dueISO) || null; }
  function debtDueDateForMonth(d,year,monthIndex){
    if(!(Number(d.dueDay)>0)) return null;
    const day=Math.min(clamp(d.dueDay,1,31),new Date(year,monthIndex+1,0).getDate());
    return new Date(year,monthIndex,day,12,0,0);
  }
  function occurrenceISO(date){ return date ? toISODate(date) : ""; }
  function nextBillOccurrence(b){
    if(!b || b.status==='canceled') return null;
    const current=projectedBillDateForMonth(b,today.getFullYear(),today.getMonth());
    if(current) return current;
    for(let i=1;i<=24;i++){
      const d=new Date(today.getFullYear(),today.getMonth()+i,1,12,0,0);
      const occurrence=projectedBillDateForMonth(b,d.getFullYear(),d.getMonth());
      if(occurrence) return occurrence;
    }
    return null;
  }
  function followingBillOccurrence(b,afterDate){
    if(!b || !afterDate) return null;
    for(let i=1;i<=24;i++){
      const d=new Date(afterDate.getFullYear(),afterDate.getMonth()+i,1,12,0,0);
      const occurrence=projectedBillDateForMonth(b,d.getFullYear(),d.getMonth());
      if(occurrence) return occurrence;
    }
    return null;
  }
  function paymentTimingText(paidAt,dueISO){
    if(!paidAt) return '';
    const paid=parseISO(paidAt), due=parseISO(dueISO);
    if(!paid || !due) return `Paid ${formatDueDate(paidAt)}`;
    const short=paid.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    if(paid < due) return `Paid early ${short}`;
    return `Paid ${short}`;
  }
  function toggleDebtMinimumPaid(id,period,checked){
    const d=state.debts.find(x=>Number(x.id)===Number(id)); if(!d) return;
    d.minimumPayments=Array.isArray(d.minimumPayments) ? d.minimumPayments : [];
    d.minimumPayments=d.minimumPayments.filter(x=>x.period!==period);
    if(checked) d.minimumPayments.push({period,paidAt:todayISO});
    save(); renderAll();
  }
  function toggleBillOccurrencePaid(id,dueISO,checked){
    const b=state.bills.find(x=>Number(x.id)===Number(id)); if(!b) return;
    b.payments=Array.isArray(b.payments) ? b.payments : [];
    b.payments=b.payments.filter(x=>x.dueDate!==dueISO);
    if(checked) b.payments.push({dueDate:dueISO,paidAt:todayISO});
    const latest=[...b.payments].sort((a,b)=>String(b.paidAt).localeCompare(String(a.paidAt)))[0];
    b.lastPaid=latest?.paidAt || '';
    save(); renderAll();
  }

  function renderPaymentChecklist(){
    const wrap=$("#paymentChecklist"), chip=$("#paymentChecklistChip"); if(!wrap || !chip) return;
    const year=today.getFullYear(), month=today.getMonth(), period=monthKey(year,month);
    const items=[];
    state.debts.filter(d=>d.balance>0 && Number(d.min)>0).forEach(d=>{
      const due=debtDueDateForMonth(d,year,month), payment=debtPaymentFor(d,period);
      items.push({kind:'debt',id:d.id,name:d.name,amount:Number(d.min)||0,dueISO:occurrenceISO(due),paid:!!payment,paidAt:payment?.paidAt||'',period,detail:'Card / loan minimum'});
    });
    state.bills.filter(b=>b.status!=='canceled').forEach(b=>{
      const due=projectedBillDateForMonth(b,year,month); if(!due) return;
      const dueISO=occurrenceISO(due), payment=billPaymentFor(b,dueISO);
      items.push({kind:'bill',id:b.id,name:b.name,amount:Number(b.amount)||0,dueISO,paid:!!payment,paidAt:payment?.paidAt||'',detail:b.frequency==='yearly'?'Yearly payment':'Monthly payment'});
    });
    items.sort((a,b)=>(a.dueISO||'9999').localeCompare(b.dueISO||'9999') || a.name.localeCompare(b.name));
    const paidCount=items.filter(x=>x.paid).length;
    chip.textContent=`${paidCount} of ${items.length} paid`;
    wrap.innerHTML=items.length ? items.map(item=>{
      const dueText=item.dueISO ? `Due ${formatDueDate(item.dueISO)}` : 'Due date not set';
      const timing=item.paid ? paymentTimingText(item.paidAt,item.dueISO) : '';
      const dataAttr=item.kind==='debt' ? `data-debt-paid="${item.id}" data-period="${item.period}"` : `data-bill-paid="${item.id}" data-due="${item.dueISO}"`;
      return `<article class="payment-check-card ${item.paid?'is-paid':''}"><div class="payment-check-main"><div class="payment-check-title"><strong>${escapeHtml(item.name)}</strong><span class="status-pill ${item.paid?'paid':'due'}">${item.paid?'Paid':'Due'}</span></div><span>${escapeHtml(item.detail)} · ${escapeHtml(dueText)}</span>${timing?`<small>${escapeHtml(timing)}</small>`:''}</div><div class="payment-check-side"><strong>${money(item.amount)}</strong><label class="payment-toggle"><input type="checkbox" ${dataAttr} ${item.paid?'checked':''}/><span>${item.paid?'Done':'Mark paid'}</span></label></div></article>`;
    }).join('') : `<div class="empty">Add debt due dates or recurring payments to build this month’s checklist.</div>`;
    $$('[data-debt-paid]').forEach(input=>input.addEventListener('change',()=>toggleDebtMinimumPaid(Number(input.dataset.debtPaid),input.dataset.period,input.checked)));
    $$('[data-bill-paid]').forEach(input=>input.addEventListener('change',()=>toggleBillOccurrencePaid(Number(input.dataset.billPaid),input.dataset.due,input.checked)));
  }

  function renderBills(){
    renderPaymentChecklist();
    const active=state.bills.filter(b=>b.status!=="canceled");
    const monthlyEq=active.reduce((sum,b)=>sum+(b.frequency==='yearly' ? Number(b.amount||0)/12 : Number(b.amount||0)),0);
    $("#billTotalChip").textContent=`${money(monthlyEq)}/mo equivalent`;
    const sorted=[...state.bills].sort((a,b)=>(a.status==='canceled')-(b.status==='canceled') || String(a.dueDate).localeCompare(String(b.dueDate)));
    $("#billList").innerHTML=sorted.length ? sorted.map(b=>{
      const occurrence=nextBillOccurrence(b);
      const dueISO=occurrenceISO(occurrence);
      const payment=dueISO ? billPaymentFor(b,dueISO) : null;
      const nextAfter=payment && occurrence ? followingBillOccurrence(b,occurrence) : null;
      const overdue=occurrence && !payment && occurrence < new Date(today.getFullYear(),today.getMonth(),today.getDate(),0,0,0);
      const status=b.status==='canceled' ? 'Canceled' : payment ? 'Paid' : overdue ? 'Overdue' : 'Upcoming';
      const timing=payment ? paymentTimingText(payment.paidAt,dueISO) : '';
      return `<article class="bill-card ${b.status==='canceled'?'is-canceled':''} ${payment?'is-paid':''}">
        <div class="bill-card-top">
          <div class="bill-card-heading"><span class="dot"></span><div><strong>${escapeHtml(b.name)}</strong><div class="bill-card-badges"><span class="status-pill">${b.frequency==='yearly'?'Yearly':'Monthly'}</span><span class="status-pill ${status.toLowerCase()}">${status}</span></div></div></div>
          <div class="bill-card-amount">${money(b.amount)}</div>
        </div>
        <div class="bill-card-details">
          <div><span>Payment date</span><strong>${occurrence ? formatDueDate(dueISO) : 'No upcoming date'}</strong></div>
          <div><span>Payment status</span><strong>${payment ? escapeHtml(timing) : overdue ? 'Past due / not marked paid' : 'Not marked paid'}</strong></div>
          ${nextAfter?`<div><span>Next after this</span><strong>${formatDueDate(occurrenceISO(nextAfter))}</strong></div>`:''}
        </div>
        ${b.status!=='canceled' && dueISO ? `<label class="bill-paid-control"><input type="checkbox" data-bill-card-paid="${b.id}" data-due="${dueISO}" ${payment?'checked':''}/><span><strong>${payment?'Payment complete':'Mark this payment as paid'}</strong><small>${payment?'Uncheck if you marked it by mistake.':'Use this even if you pay before the due date.'}</small></span></label>` : ''}
        <div class="bill-card-actions"><button class="secondary" data-edit-bill="${b.id}" type="button">Edit</button><button class="secondary" data-toggle-bill-status="${b.id}" type="button">${b.status==='canceled'?'Reactivate':'Cancel'}</button><button class="danger" data-delete-bill="${b.id}" type="button">Delete</button></div>
      </article>`;
    }).join("") : `<div class="empty">Add monthly or yearly bills and subscriptions.</div>`;
    $$('[data-edit-bill]').forEach(btn=>btn.addEventListener('click',()=>openBillEdit(Number(btn.dataset.editBill))));
    $$('[data-bill-card-paid]').forEach(input=>input.addEventListener('change',()=>toggleBillOccurrencePaid(Number(input.dataset.billCardPaid),input.dataset.due,input.checked)));
    $$('[data-toggle-bill-status]').forEach(btn=>btn.addEventListener('click',()=>{ const b=state.bills.find(x=>x.id===Number(btn.dataset.toggleBillStatus)); if(!b) return; b.status=b.status==='canceled'?'active':'canceled'; save(); renderAll(); }));
    $$('[data-delete-bill]').forEach(btn=>btn.addEventListener('click',()=>{ if(confirm("Delete this recurring bill or subscription?")){ state.bills=state.bills.filter(x=>x.id!==Number(btn.dataset.deleteBill)); save(); renderAll(); } }));

    $("#emergencyCurrent").value=state.emergency; $("#emergencyTarget").value=state.emergencyTarget; $("#emergencyGoalText").textContent=`${money(state.emergency)} / ${money(state.emergencyTarget)}`; $("#emergencyGoalBar").style.width=`${clamp(state.emergency/state.emergencyTarget*100,0,100)}%`;
    $("#customGoals").innerHTML=state.goals.length ? state.goals.map(g=>{ const p=clamp(g.current/g.target*100,0,100); return `<div class="goal-card"><div class="goal-top"><div><strong>${escapeHtml(g.name)}</strong><span>${p.toFixed(0)}% complete</span></div><button class="icon-button" data-delete-goal="${g.id}" aria-label="Delete goal">×</button></div><div class="progress"><i style="width:${p}%"></i></div><div class="form-grid two top-gap"><label>Current<input data-goal-current="${g.id}" type="number" min="0" step="1" value="${g.current}" /></label><label>Target<input data-goal-target="${g.id}" type="number" min="1" step="1" value="${g.target}" /></label></div></div>`; }).join("") : `<div class="empty">No extra savings goals yet.</div>`;
    $$('[data-delete-goal]').forEach(btn=>btn.addEventListener('click',()=>{ state.goals=state.goals.filter(g=>g.id!==Number(btn.dataset.deleteGoal)); save(); renderAll(); }));
    $$('[data-goal-current]').forEach(inp=>inp.addEventListener('change',()=>{ const g=state.goals.find(x=>x.id===Number(inp.dataset.goalCurrent)); if(g) g.current=Math.max(0,Number(inp.value)||0); save(); renderAll(); }));
    $$('[data-goal-target]').forEach(inp=>inp.addEventListener('change',()=>{ const g=state.goals.find(x=>x.id===Number(inp.dataset.goalTarget)); if(g) g.target=Math.max(1,Number(inp.value)||1); save(); renderAll(); }));
  }

  function openBillEdit(id){
    const b=state.bills.find(x=>x.id===id); if(!b) return;
    $("#editBillId").value=b.id; $("#editBillName").value=b.name; $("#editBillAmount").value=b.amount; $("#editBillFrequency").value=b.frequency; $("#editBillDueDate").value=b.dueDate;
    $("#billEditDialog").showModal();
  }

  function renderAccounts(){
    $("#assetTotalChip").textContent=money(totalAssets());
    $("#assetList").innerHTML=state.assets.length ? state.assets.map(a=>`<div class="item"><span class="dot"></span><div class="item-main"><strong>${escapeHtml(a.name)}</strong><span>${escapeHtml(a.type)} · edit the balance any time</span></div><div class="asset-balance-editor"><label>Current balance<input data-asset-balance="${a.id}" type="number" min="0" step="0.01" value="${Number(a.balance||0).toFixed(2)}" /></label><button class="mini-button" data-save-asset-balance="${a.id}" type="button">Update</button></div><button class="icon-button" data-delete-asset="${a.id}" aria-label="Delete asset">×</button></div>`).join("") : `<div class="empty">No assets added.</div>`;
    $$('[data-save-asset-balance]').forEach(btn=>btn.addEventListener('click',()=>{
      const id=Number(btn.dataset.saveAssetBalance); const asset=state.assets.find(a=>Number(a.id)===id); const input=$(`[data-asset-balance="${id}"]`);
      if(!asset || !input) return; asset.balance=Math.max(0,Number(input.value)||0);
      if(asset.name === "Starter savings") state.emergency=asset.balance;
      save(); renderAll();
    }));
    $$('[data-asset-balance]').forEach(input=>input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); const btn=$(`[data-save-asset-balance="${input.dataset.assetBalance}"]`); if(btn) btn.click(); } }));
    $$('[data-delete-asset]').forEach(btn=>btn.addEventListener('click',()=>{ state.assets=state.assets.filter(a=>a.id!==Number(btn.dataset.deleteAsset)); save(); renderAll(); }));
    $("#creditScore").value=state.creditScore||"";
    const score=Number(state.creditScore); $("#creditScoreView").innerHTML=score ? `<strong style="font-size:28px">${score}</strong><div class="note">Manual snapshot only. Use this to show score trend in a future version.</div>` : `<span class="note">Enter a score if you want a manual snapshot displayed here.</span>`;
    const cards=state.debts.filter(d=>/card/i.test(d.type));
    $("#utilizationList").innerHTML=cards.length ? cards.map(d=>{ if(!d.limit) return `<div class="item"><div class="item-main"><strong>${escapeHtml(d.name)}</strong><span>Add a limit in Debts to calculate utilization.</span></div><span class="chip">—</span></div>`; const u=clamp(d.balance/d.limit*100,0,999); return `<div class="goal-card"><div class="goal-top"><div><strong>${escapeHtml(d.name)}</strong><span>${money(d.balance)} of ${money(d.limit)}</span></div><strong>${u.toFixed(1)}%</strong></div><div class="progress"><i style="width:${clamp(u,0,100)}%"></i></div></div>`; }).join("") : `<div class="empty">No card accounts.</div>`;
  }

  function reportTransactionsInRange(start,end){ return state.transactions.filter(t=>inRange(txDate(t),start,end)); }
  function reportPaychecksInRange(start,end){ return state.paychecks.filter(p=>inRange(parseISO(p.date),start,end)); }

  function renderWeeklyReport(){
    const input=$("#reportWeekDate"); if(input && !input.value) input.value=reportWeekISO;
    const [start,end]=weekRangeForDate(reportWeekISO);
    const endDisplay=new Date(end); endDisplay.setDate(endDisplay.getDate()-1);
    $("#weeklyReportRange").textContent=`${start.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} – ${endDisplay.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
    const txs=reportTransactionsInRange(start,end);
    const checks=reportPaychecksInRange(start,end);
    const income=txs.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount||0),0);
    const spent=txs.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount||0),0);
    const debtMinimumSpent=txs.filter(t=>t.type==='debt' && /minimum/i.test(String(t.category||''))).reduce((s,t)=>s+Number(t.amount||0),0);
    const allocs=[]; checks.forEach(p=>(p.allocations||[]).forEach(a=>allocs.push(a)));
    const saved=allocs.reduce((sum,a)=>{ const b=state.budget.find(x=>Number(x.id)===Number(a.categoryId)); return sum + (b?.type==='goal' ? Number(a.amount||0) : 0); },0);
    const debtMinimumFunded=allocs.reduce((sum,a)=>{ const b=state.budget.find(x=>Number(x.id)===Number(a.categoryId)); return sum + (/debt.*minimum|minimum.*debt/i.test(String(b?.name||'')) ? Number(a.amount||0) : 0); },0);
    $("#weeklyReportIncome").textContent=money(income);
    $("#weeklyReportSpent").textContent=money(spent);
    $("#weeklyReportSaved").textContent=money(saved);
    $("#weeklyReportDebtMinimums").textContent=money(debtMinimumSpent || debtMinimumFunded);
    $("#weeklyDebtMinimumCaption").textContent=debtMinimumSpent>0 ? "Recorded debt-minimum payments" : debtMinimumFunded>0 ? "Funded from weekly paychecks" : "Nothing recorded this week";

    const categories={};
    txs.filter(t=>t.type==='expense'||t.type==='debt').forEach(t=>{ const name=t.category || 'Uncategorized'; categories[name]=(categories[name]||0)+Number(t.amount||0); });
    const catEntries=Object.entries(categories).sort((a,b)=>b[1]-a[1]); const catMax=Math.max(...catEntries.map(x=>x[1]),1);
    $("#weeklySpendingChart").innerHTML=catEntries.length ? catEntries.map(([name,val],i)=>chartRow(name,val,val/catMax*100,["var(--series-a)","var(--series-b)","var(--series-c)","var(--series-d)"][i%4])).join("") : `<div class="empty">No spending or debt payments recorded for this week.</div>`;

    const funding={};
    allocs.forEach(a=>{ const b=state.budget.find(x=>Number(x.id)===Number(a.categoryId)); const name=b?.name || 'Deleted category'; funding[name]=(funding[name]||0)+Number(a.amount||0); });
    const fundingEntries=Object.entries(funding).sort((a,b)=>b[1]-a[1]); const fundingMax=Math.max(...fundingEntries.map(x=>x[1]),1);
    $("#weeklyFundingChart").innerHTML=fundingEntries.length ? fundingEntries.map(([name,val],i)=>chartRow(name,val,val/fundingMax*100,["var(--series-b)","var(--series-a)","var(--series-d)","var(--series-c)"][i%4])).join("") : `<div class="empty">No paycheck allocations saved for this week.</div>`;
  }

  function renderReports(){
    renderWeeklyReport();
    const income=state.transactions.filter(t=>t.type==="income").reduce((s,t)=>s+Number(t.amount||0),0);
    const outflow=state.transactions.filter(t=>t.type==="expense"||t.type==="debt").reduce((s,t)=>s+Number(t.amount||0),0);
    $("#reportIncome").textContent=money(income); $("#reportOutflow").textContent=money(outflow); const maxFlow=Math.max(income,outflow,1);
    $("#cashFlowChart").innerHTML=[["Income",income,"var(--series-b)"],["Outflow",outflow,"var(--series-c)"],["Net",income-outflow,"var(--series-a)"]].map(([name,val,color])=>chartRow(name,val,Math.abs(val)/maxFlow*100,color)).join("");
    const categoryTotals={}; state.transactions.filter(t=>t.type==="expense"||t.type==="debt").forEach(t=>{ categoryTotals[t.category]=(categoryTotals[t.category]||0)+Number(t.amount||0); });
    const catEntries=Object.entries(categoryTotals).sort((a,b)=>b[1]-a[1]); const catMax=Math.max(...catEntries.map(x=>x[1]),1);
    $("#spendingChart").innerHTML=catEntries.length ? catEntries.map(([name,val],i)=>chartRow(name,val,val/catMax*100,["var(--series-a)","var(--series-b)","var(--series-c)","var(--series-d)"][i%4])).join("") : `<div class="empty">Add expense transactions to see category reports.</div>`;
    const debtMax=Math.max(...state.debts.map(d=>d.balance),1);
    $("#debtChart").innerHTML=state.debts.length ? [...state.debts].sort((a,b)=>b.balance-a.balance).map(d=>chartRow(d.name,d.balance,d.balance/debtMax*100,"var(--series-d)")).join("") : `<div class="empty">No debt balances.</div>`;
  }

  function chartRow(name,val,width,color){ return `<div class="chart-row"><span>${escapeHtml(name)}</span><div class="chart-bar"><i style="width:${clamp(width,0,100)}%;background:${color}"></i></div><div class="chart-value">${money(val)}</div></div>`; }

  function refreshCategorySelects(){
    const names=state.budget.map(b=>b.name);
    ["#txCategory","#ruleCategory"].forEach(sel=>{ const el=$(sel); if(!el) return; const current=el.value; el.innerHTML=[...new Set([...names,"Income","Transfer"])].map(n=>`<option>${escapeHtml(n)}</option>`).join(""); if([...el.options].some(o=>o.value===current)) el.value=current; });
  }

  function refreshDebtSelect(){
    const el=$("#txDebt"); const current=el.value; el.innerHTML=`<option value="">Not a debt payment</option>`+state.debts.map(d=>`<option value="${d.id}">${escapeHtml(d.name)}</option>`).join(""); if([...el.options].some(o=>o.value===current)) el.value=current;
  }

  function renderAll(){
    renderMetrics(); renderDebtProgress(); renderAllocator(); renderPaycheckEditor(); renderPaychecks(); renderDaily(); renderCalendar(); renderDebts(); renderBudget(); renderTransactions(); renderRules(); renderBills(); renderAccounts(); renderReports();
  }

  function bindForms(){
    ["#payNet","#payLivingPct","#payBufferPct","#payBills"].forEach(s=>$(s).addEventListener("input",renderAllocator));
    $("#paycheckAmount").addEventListener("input",updatePaycheckTotals);
    $("#autoAllocatePaycheck").addEventListener("click",autoAllocatePaycheck);
    $("#clearPaycheckAllocation").addEventListener("click",()=>{ getPaycheckAllocationInputs().forEach(i=>i.value="0"); updatePaycheckTotals(); });
    $("#savePaycheck").addEventListener("click",savePaycheckAllocation);
    ["#payoffStrategy","#payoffExtra","#payoffLump","#payoffStart"].forEach(s=>$(s).addEventListener("input",simulatePayoff));
    $("#calendarPrev").addEventListener("click",()=>{ calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1,12,0,0); renderCalendar(); });
    $("#calendarNext").addEventListener("click",()=>{ calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1,12,0,0); renderCalendar(); });
    $("#calendarToday").addEventListener("click",()=>{ calendarCursor=new Date(today.getFullYear(),today.getMonth(),1,12,0,0); renderCalendar(); });
    $("#reportWeekDate").addEventListener("change",e=>{ reportWeekISO=e.target.value||todayISO; renderReports(); });
    $("#reportWeekPrev").addEventListener("click",()=>{ const d=parseISO(reportWeekISO)||new Date(); d.setDate(d.getDate()-7); reportWeekISO=toISODate(d); $("#reportWeekDate").value=reportWeekISO; renderReports(); });
    $("#reportWeekNext").addEventListener("click",()=>{ const d=parseISO(reportWeekISO)||new Date(); d.setDate(d.getDate()+7); reportWeekISO=toISODate(d); $("#reportWeekDate").value=reportWeekISO; renderReports(); });
    $("#reportWeekToday").addEventListener("click",()=>{ reportWeekISO=todayISO; $("#reportWeekDate").value=reportWeekISO; renderReports(); });

    $("#monthlyIncome").addEventListener("change",e=>{ state.monthlyIncome=Math.max(0,Number(e.target.value)||0); save(); renderAll(); });
    $("#weeklyIncome").addEventListener("change",e=>{ state.weeklyIncome=Math.max(0,Number(e.target.value)||0); save(); renderAll(); });

    $("#debtForm").addEventListener("submit",e=>{
      e.preventDefault(); const name=$("#debtName").value.trim(); const balance=Math.max(0,Number($("#debtBalance").value)||0); if(!name || balance<=0) return;
      state.debts.push({id:uid(),name,balance,startingBalance:balance,apr:Math.max(0,Number($("#debtApr").value)||0),min:Math.max(0,Number($("#debtMin").value)||0),limit:Math.max(0,Number($("#debtLimit").value)||0),dueDay:$("#debtDueDay").value?clamp($("#debtDueDay").value,1,31):"",type:$("#debtType").value,minimumPayments:[]});
      e.target.reset(); $("#debtApr").value=0; $("#debtMin").value=0; save(); renderAll();
    });

    $("#debtEditForm").addEventListener("submit",e=>{
      e.preventDefault(); const d=state.debts.find(x=>x.id===Number($("#editDebtId").value)); if(!d) return;
      d.name=$("#editDebtName").value.trim()||d.name; d.balance=Math.max(0,Number($("#editDebtBalance").value)||0); d.startingBalance=Math.max(0,Number($("#editDebtStartingBalance").value)||d.balance); d.apr=Math.max(0,Number($("#editDebtApr").value)||0); d.min=Math.max(0,Number($("#editDebtMin").value)||0); d.limit=Math.max(0,Number($("#editDebtLimit").value)||0); d.dueDay=$("#editDebtDueDay").value?clamp($("#editDebtDueDay").value,1,31):""; d.type=$("#editDebtType").value; $("#debtEditDialog").close(); save(); renderAll();
    });
    ["#debtEditCancel","#debtEditCancelX"].forEach(id=>$(id).addEventListener("click",()=>$("#debtEditDialog").close()));

    $("#transactionForm").addEventListener("submit",e=>{
      e.preventDefault(); const name=$("#txName").value.trim(); const amount=Math.max(0,Number($("#txAmount").value)||0); if(!name || amount<=0) return;
      let type=$("#txType").value, category=$("#txCategory").value; const matched=state.rules.find(r=>name.toLowerCase().includes(r.contains.toLowerCase())); if(matched) category=matched.category; if(category==="Income") type="income";
      addTransaction({name,amount,type,category,tag:$("#txTag").value.trim(),dateISO:todayISO});
      if(type==="debt" && $("#txDebt").value){ const d=state.debts.find(x=>x.id===Number($("#txDebt").value)); if(d) d.balance=Math.max(0,d.balance-amount); }
      e.target.reset(); save(); renderAll();
    });
    $("#txSearch").addEventListener("input",renderTransactions);

    $("#ruleForm").addEventListener("submit",e=>{ e.preventDefault(); const contains=$("#ruleContains").value.trim(); if(!contains) return; state.rules.push({id:uid(),contains,category:$("#ruleCategory").value}); e.target.reset(); save(); renderAll(); });

    $("#receiptImage").addEventListener("change",e=>{ const file=e.target.files?.[0]; if(!file) return; if(receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl); receiptPreviewUrl=URL.createObjectURL(file); $("#receiptPreview").src=receiptPreviewUrl; $("#receiptPreview").hidden=false; $("#receiptScanStatus").textContent="Receipt photo selected. Tap Scan receipt or enter items manually."; });
    $("#scanReceipt").addEventListener("click",scanReceipt);
    $("#addReceiptItem").addEventListener("click",()=>addManualReceiptItem());
    $("#clearReceipt").addEventListener("click",clearReceipt);
    $("#receiptTotal").addEventListener("input",updateReceiptTotals);
    $("#confirmReceipt").addEventListener("click",confirmReceipt);

    $("#billForm").addEventListener("submit",e=>{ e.preventDefault(); const name=$("#billName").value.trim(); const amount=Math.max(0,Number($("#billAmount").value)||0); const dueDate=$("#billDueDate").value; if(!name || amount<=0 || !dueDate) return; state.bills.push({id:uid(),name,amount,frequency:$("#billFrequency").value,dueDate,status:'active',lastPaid:'',payments:[]}); e.target.reset(); $("#billFrequency").value='monthly'; $("#billDueDate").value=todayISO; save(); renderAll(); });
    $("#billEditForm").addEventListener("submit",e=>{ e.preventDefault(); const b=state.bills.find(x=>x.id===Number($("#editBillId").value)); if(!b) return; b.name=$("#editBillName").value.trim()||b.name; b.amount=Math.max(0,Number($("#editBillAmount").value)||0); b.frequency=$("#editBillFrequency").value; b.dueDate=$("#editBillDueDate").value; $("#billEditDialog").close(); save(); renderAll(); });
    ["#billEditCancel","#billEditCancelX"].forEach(id=>$(id).addEventListener("click",()=>$("#billEditDialog").close()));

    $("#emergencyCurrent").addEventListener("change",e=>{ state.emergency=Math.max(0,Number(e.target.value)||0); const a=state.assets.find(x=>x.name==="Starter savings"); if(a) a.balance=state.emergency; save(); renderAll(); });
    $("#emergencyTarget").addEventListener("change",e=>{ state.emergencyTarget=Math.max(1,Number(e.target.value)||1000); save(); renderAll(); });
    $("#goalForm").addEventListener("submit",e=>{ e.preventDefault(); const name=$("#goalName").value.trim(); const current=Math.max(0,Number($("#goalCurrent").value)||0), target=Math.max(1,Number($("#goalTarget").value)||1); if(!name) return; state.goals.push({id:uid(),name,current,target}); e.target.reset(); $("#goalCurrent").value=0; save(); renderAll(); });

    $("#assetForm").addEventListener("submit",e=>{ e.preventDefault(); const name=$("#assetName").value.trim(); const balance=Math.max(0,Number($("#assetBalance").value)||0); if(!name) return; state.assets.push({id:uid(),name,balance,type:$("#assetType").value}); e.target.reset(); save(); renderAll(); });
    $("#creditScore").addEventListener("change",e=>{ state.creditScore=e.target.value?clamp(e.target.value,300,850):""; save(); renderAll(); });

    $("#addBudgetCategory").addEventListener("click",()=>{ state.budget.push({id:uid(),name:"New category",type:"fixed",planned:0,monthlyPct:0,weeklyPct:0,rollover:false,carry:0}); save(); renderAll(); });
    $("#newMonth").addEventListener("click",()=>{ if(!confirm("Carry the current month's unused amounts forward for rollover categories?")) return; state.budget.forEach(b=>{ if(b.rollover){ b.carry=Math.max(0,monthlyPlanned(b)-categorySpent(b.name,"month")); } }); save(); renderAll(); });

    $("#exportData").addEventListener("click",()=>{ const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="clearpath-finance-backup.json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),500); });
    $("#importData").addEventListener("change",e=>{ const file=e.target.files?.[0]; if(!file) return; const reader=new FileReader(); reader.onload=()=>{ try{ state=migrate(JSON.parse(reader.result)); save(); renderAll(); alert("Backup imported."); }catch(err){ alert("That file is not a valid ClearPath backup."); } }; reader.readAsText(file); e.target.value=""; });
    $("#resetData").addEventListener("click",()=>{ if(!confirm("Reset the app to the original demo data?")) return; state=structuredClone(starter); save(); renderAll(); });
  }

  nav();
  $("#payoffStart").value=defaultMonth;
  $("#paycheckDate").value=todayISO;
  $("#receiptDate").value=todayISO;
  $("#billDueDate").value=todayISO;
  $("#reportWeekDate").value=reportWeekISO;
  bindForms();
  renderAll();
})();
