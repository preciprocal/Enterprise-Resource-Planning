// components/admin/KanbanTab.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Preciprocal Advanced Kanban — beyond any corporate board
//
// Features:
//  🧠 AI Card Assistant — auto-writes story, scores effort/value, suggests subtasks
//  ⚡ Auto-prioritization — sort backlog by Value÷Effort score
//  💬 @mention notifications — type @Name → email via /api/kanban/notify
//  🕐 Cycle time tracking — timestamps In Progress entry/Done exit
//  📊 Burndown mini-chart - cards completed per day this sprint
//  🔔 Due-date alerts — 24h email warning via Resend
//  🔒 Card locking — "Maya is editing" soft-lock badge
//  🎯 My Cards focus — one-click filter to your own cards
//  🏃 Standup mode — fullscreen yesterday/today/blockers
//  ⏱ Actual hours — prompt on Done, builds velocity data
//  💰 Revenue tagging — tag cards with MRR impact
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { confirmDialog, alertDialog } from "@/components/ui/dialog-host";
import { useState, useCallback, useEffect, useMemo } from "react";
import { getAdminToken } from "@/lib/supabase/client";
import { Select, Checkbox, tint } from "./admin-shared";

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function getMsToken()   { return typeof window==="undefined"?null:localStorage.getItem("ms_access_token"); }
// Supabase access token of the signed-in admin (kept current by app/page.tsx)
function getAuthToken() { return getAdminToken()||null; }

/** Starts a Google or Zoom connection: the server signs the request, then the browser goes to the provider. */
async function startConnect(platform: "meet" | "zoom") {
  const token = getAuthToken();
  if (!token) { void alertDialog({ title: "Sign in again", message: "Your ERP session has ended. Sign in again, then connect." }); return; }
  try {
    const r = await fetch(`/api/auth/${platform === "meet" ? "google" : "zoom"}`, { headers: { "x-admin-token": token } });
    const j = await r.json() as { url?: string; error?: string };
    if (!r.ok || !j.url) throw new Error(j.error ?? `HTTP ${r.status}`);
    window.location.href = j.url;
  } catch (e) { void alertDialog({ title: "Could not start the connection", message: (e as Error).message, tone: "danger" }); }
}

// ─── Integration status ───────────────────────────────────────────────────────
interface IntegrationStatus { teams:boolean; google:boolean; zoom:boolean; }
async function fetchIntegrationStatus(): Promise<IntegrationStatus> {
  const teams=!!getMsToken(); let google=false,zoom=false;
  const token=getAuthToken();
  if(!token) return{teams,google,zoom};
  try {
    const h={"x-admin-token":token};
    const[gR,zR]=await Promise.all([fetch("/api/meetings/google",{headers:h}),fetch("/api/meetings/zoom",{headers:h})]);
    if(gR.ok)({connected:google}=await gR.json());
    if(zR.ok)({connected:zoom}=await zR.json());
  } catch{/**/}
  return{teams,google,zoom};
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Priority     = "critical"|"high"|"medium"|"low";
type LabelKey     = "bug"|"feature"|"design"|"infra"|"docs"|"research";
type MeetPlatform = "teams"|"meet"|"zoom";
type MobileTab    = "board"|"calendar"|"meetings"|"standup";

interface Subtask  { done:boolean; label:string }
interface Comment  { id:string; author:string; authorColor:string; text:string; createdAt:string }
interface CardLink { id:string; label:string; url:string }

interface KanbanCard {
  id:string; title:string; description?:string; story?:string;
  priority:Priority; labels:LabelKey[];
  assigneeId?:string; dueDate?:string;
  effortScore?:number; valueScore?:number;
  blockedBy?:string|null;
  subtasks?:Subtask[]; commentList?:Comment[]; links?:CardLink[];
  inProgressAt?:string; completedAt?:string; actualHours?:number;
  lockedBy?:string; lockedAt?:string;
}

interface KanbanColumn { id:string; title:string; color:string; desc?:string; limit?:number; cards:KanbanCard[]; }

interface Meeting {
  id:string; title:string; date:string; startTime:string; endTime:string;
  platform:MeetPlatform; joinUrl:string; meetingId?:string;
  attendeeIds:string[]; description?:string; createdAt:string; status:"confirmed"|"pending"|"failed";
}

interface SprintDay { date:string; completed:number; }

// ─── Employee ─────────────────────────────────────────────────────────────────
interface Employee { id:string; name:string; role:string; color:string; email:string }
const FALLBACK_ME:Employee={ id:"",name:"Admin",role:"Admin",color:"#5b6cff",email:"" };
const empById=(list:Employee[],id?:string)=>list.find(e=>e.id===id);

// ─── Constants ────────────────────────────────────────────────────────────────
// badge = chip on a card tile; on = selected state of the picker button in the card modal
const PRIORITY_META:Record<Priority,{label:string;badge:string;on:string}>={
  critical:{label:"Critical",badge:"badge-danger", on:"border-danger-line bg-danger-soft text-danger-fg"},
  high:    {label:"High",    badge:"badge-warning",on:"border-warning-line bg-warning-soft text-warning-fg"},
  medium:  {label:"Medium",  badge:"badge-info",   on:"border-info-line bg-info-soft text-info-fg"},
  low:     {label:"Low",     badge:"badge-success",on:"border-success-line bg-success-soft text-success-fg"},
};
const LABEL_META:Record<LabelKey,{label:string;badge:string;on:string}>={
  bug:     {label:"Bug",     badge:"badge-danger", on:"border-danger-line bg-danger-soft text-danger-fg"},
  feature: {label:"Feature", badge:"badge-brand",  on:"border-brand-line bg-brand-soft text-brand-fg"},
  design:  {label:"Design",  badge:"badge-violet", on:"border-violet-line bg-violet-soft text-violet-fg"},
  infra:   {label:"Infra",   badge:"badge-info",   on:"border-info-line bg-info-soft text-info-fg"},
  docs:    {label:"Docs",    badge:"badge-success",on:"border-success-line bg-success-soft text-success-fg"},
  research:{label:"Research",badge:"badge-violet", on:"border-violet-line bg-violet-soft text-violet-fg"},
};
// Meeting platform brand colours (data); bg is a translucent tint so it works in both themes
const PLATFORM_META:Record<MeetPlatform,{label:string;color:string;bg:string;btnBg:string}>={
  teams:{label:"Teams",      color:"#5558AF",bg:tint("#5558AF","1f"),btnBg:"#5558AF"},
  meet: {label:"Google Meet",color:"#34A853",bg:tint("#34A853","1f"),btnBg:"#34A853"},
  zoom: {label:"Zoom",       color:"#2D8CFF",bg:tint("#2D8CFF","1f"),btnBg:"#2D8CFF"},
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pad=(n:number)=>String(n).padStart(2,"0");
const today=new Date();
const fmtDate=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const NOW_ISO=fmtDate(today);
const mkDate=(n:number)=>fmtDate(new Date(today.getFullYear(),today.getMonth(),today.getDate()+n));
const initials=(name:string)=>name.split(" ").map(p=>p[0]).join("").toUpperCase().slice(0,2);
const tsNow=()=>{ const n=new Date(); return n.toLocaleDateString("en-US",{month:"short",day:"numeric"})+" · "+n.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}); };
const calcScore=(v?:number,e?:number)=>(!v||!e||e===0)?null:Math.round((v/e)*10);
const formatDue=(iso:string)=>{ const d=new Date(iso),diff=(d.getTime()-today.getTime())/86400000; return{label:d.toLocaleDateString("en-US",{month:"short",day:"numeric"}),overdue:diff<0,soon:diff>=0&&diff<=2}; };
const cycleHours=(s:string,e:string)=>Math.round((new Date(e).getTime()-new Date(s).getTime())/3600000);
function calDays(month:Date){ const year=month.getFullYear(),m=month.getMonth(); const first=new Date(year,m,1).getDay(),lastDay=new Date(year,m+1,0).getDate(); const startDow=first===0?6:first-1; const days:{date:string;day:number;cur:boolean}[]=[]; for(let i=0;i<startDow;i++){const d=new Date(year,m,-startDow+i+1);days.push({date:fmtDate(d),day:d.getDate(),cur:false});} for(let i=1;i<=lastDay;i++) days.push({date:fmtDate(new Date(year,m,i)),day:i,cur:true}); const rem=42-days.length; for(let i=1;i<=rem;i++) days.push({date:fmtDate(new Date(year,m+1,i)),day:i,cur:false}); return days; }
function buildBurndown(columns:KanbanColumn[]):SprintDay[]{ const done=columns.find(c=>c.id==="done")?.cards??[]; const counts:Record<string,number>={}; for(let i=6;i>=0;i--){const d=mkDate(-i);counts[d]=0;} done.forEach(c=>{if(c.completedAt){const d=fmtDate(new Date(c.completedAt));if(counts[d]!==undefined)counts[d]++;}}); return Object.entries(counts).map(([date,completed])=>({date,completed})); }

// ─── Seed data ────────────────────────────────────────────────────────────────

const DEFAULT_COLUMNS:KanbanColumn[]=[
  {id:"todo",title:"To Do",color:"#5b6cff",desc:"Ready to be picked up",cards:[
    {id:"k1",title:"CSV export for analytics tabs",priority:"medium",labels:["feature"],story:"As an admin, I want to export data for offline analysis.",assigneeId:"emp-yash",dueDate:mkDate(12),effortScore:3,valueScore:7,blockedBy:null,subtasks:[{done:false,label:"API endpoint"},{done:false,label:"UI button"},{done:false,label:"Tests"}],commentList:[{id:"c1",author:"Maya Patel",authorColor:"#5b6cff",text:"Should we support XLSX?",createdAt:"Jun 3 · 10:12 AM"},{id:"c2",author:"Yash D.",authorColor:"#5b6cff",text:"Good call, adding to scope.",createdAt:"Jun 3 · 11:05 AM"}],links:[{id:"l1",label:"Figma mockup",url:"https://figma.com"}]},
    {id:"k2",title:"Stripe webhook retry logic",priority:"high",labels:["infra","feature"],assigneeId:"emp-alex",dueDate:mkDate(4),effortScore:5,valueScore:8,blockedBy:null,subtasks:[{done:false,label:"Exponential backoff"},{done:false,label:"Dead-letter queue"}],commentList:[],links:[{id:"l2",label:"Stripe docs",url:"https://stripe.com/docs/webhooks"}]},
  ]},
  {id:"inprogress",title:"In Progress",color:"#f59e0b",limit:4,desc:"WIP - actively being worked on",cards:[
    {id:"k4",title:"OpenAI usage pagination fix",priority:"critical",labels:["bug","infra"],story:"As an admin, I want accurate usage data so billing is correct.",assigneeId:"emp-yash",dueDate:NOW_ISO,effortScore:3,valueScore:10,blockedBy:null,inProgressAt:new Date(Date.now()-172800000).toISOString(),subtasks:[{done:true,label:"Debug root cause"},{done:true,label:"Implement fix"},{done:false,label:"Verify in prod"}],commentList:[{id:"c3",author:"Sam Lee",authorColor:"#3b82f6",text:"Verified on staging.",createdAt:"Jun 5 · 2:45 PM"}],links:[{id:"l3",label:"OpenAI API docs",url:"https://platform.openai.com/docs/api-reference"}]},
    {id:"k5",title:"Cloudflare analytics stream",priority:"high",labels:["infra"],assigneeId:"emp-jordan",dueDate:mkDate(-2),effortScore:7,valueScore:8,blockedBy:"Waiting for Cloudflare Enterprise plan",inProgressAt:new Date(Date.now()-259200000).toISOString(),subtasks:[{done:true,label:"Schema research"},{done:false,label:"Stream integration"}],commentList:[],links:[]},
  ]},
  {id:"review",title:"In Review",color:"#5b6cff",limit:5,desc:"PR open / QA in progress",cards:[
    {id:"k6",title:"Claude token pricing — cache reads at 10%",priority:"critical",labels:["bug"],assigneeId:"emp-yash",dueDate:NOW_ISO,effortScore:2,valueScore:10,blockedBy:null,inProgressAt:new Date(Date.now()-86400000).toISOString(),subtasks:[{done:true,label:"Fix pricing logic"},{done:true,label:"Unit tests"},{done:false,label:"PR review"}],commentList:[{id:"c6",author:"Priya Singh",authorColor:"#a855f7",text:"Left 2 inline comments.",createdAt:"Jun 6 · 10:00 AM"}],links:[{id:"l4",label:"PR #247",url:"https://github.com"}]},
  ]},
  {id:"done",title:"Done",color:"#10b981",desc:"Completed & shipped",cards:[
    {id:"k8",title:"Login page light mode redesign",priority:"medium",labels:["design"],assigneeId:"emp-yash",effortScore:3,valueScore:7,blockedBy:null,inProgressAt:new Date(Date.now()-604800000).toISOString(),completedAt:new Date(Date.now()-432000000).toISOString(),actualHours:18,subtasks:[{done:true,label:"Layout"},{done:true,label:"Branding"},{done:true,label:"Mobile"}],commentList:[{id:"c7",author:"Maya Patel",authorColor:"#5b6cff",text:"Shipped to prod!",createdAt:"Jun 2 · 4:00 PM"}],links:[]},
    {id:"k9",title:"Firestore composite index fix",priority:"high",labels:["bug","infra"],assigneeId:"emp-yash",effortScore:2,valueScore:9,blockedBy:null,inProgressAt:new Date(Date.now()-518400000).toISOString(),completedAt:new Date(Date.now()-345600000).toISOString(),actualHours:6,subtasks:[],commentList:[],links:[]},
  ]},
];
// A first-time board: the same columns, no sample cards.
const EMPTY_COLUMNS:KanbanColumn[]=DEFAULT_COLUMNS.map(c=>({...c,cards:[]}));

// ─── Icons ────────────────────────────────────────────────────────────────────
const XIcon=()=>(<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>);
const PlusIcon=()=>(<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>);
const ChevronIcon=({dir}:{dir:"left"|"right"})=>(<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d={dir==="left"?"M15 18l-6-6 6-6":"M9 18l6-6-6-6"}/></svg>);
const SearchIcon=()=>(<svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-4 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>);

// Shared modal pieces
const BACKDROP="fixed inset-0 bg-scrim backdrop-blur-[2px] flex items-center justify-center";
// Pick-one / toggle chip used for attendees and assignees
const pickCls=(active:boolean)=>`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${active?"border-brand-line bg-brand-soft":"border-line bg-raised hover:border-line-hover"}`;

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({name,color,size=22}:{name:string;color?:string;size?:number}){
  return(
    <div className="rounded-full text-white font-semibold flex items-center justify-center shrink-0 select-none border border-line"
      style={{width:size,height:size,fontSize:size*0.36,background:color??"var(--brand)"}}>
      {initials(name)}
    </div>
  );
}

function AttendeeStack({ids,max=3,admins}:{ids:string[];max?:number;admins:Employee[]}){
  const shown=ids.slice(0,max),extra=ids.length-max;
  return(
    <div className="flex items-center">
      {shown.map((id,i)=>{const e=empById(admins,id);if(!e)return null;return(
        <div key={id} style={{marginLeft:i>0?-6:0,zIndex:shown.length-i}}><Avatar name={e.name} color={e.color} size={20}/></div>
      );})}
      {extra>0&&<span className="ml-1 text-[11px] font-semibold text-fg-4">+{extra}</span>}
    </div>
  );
}


// ─── Tooltip ──────────────────────────────────────────────────────────────────
function Tooltip({text,children}:{text:string;children:React.ReactNode}){
  const [show,setShow]=useState(false);
  return(
    // shrink-0 — otherwise wrapped toolbar controls squash and overlap instead of scrolling
    <div className="relative inline-flex shrink-0"
      onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
      {children}
      {show&&(
        <div className="popover absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 z-9999 pointer-events-none w-max max-w-55 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-fg-2 text-center whitespace-normal rounded-lg!">
          {text}
        </div>
      )}
    </div>
  );
}

// ─── Platform icon ────────────────────────────────────────────────────────────
function PlatformIcon({p,size=16}:{p:MeetPlatform;size?:number}){
  if(p==="teams")return(<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="1" y="6" width="14" height="13" rx="2" fill="#5558AF"/><path d="M15 10l8-5v14l-8-5V10z" fill="#7B83EB"/><circle cx="18" cy="5" r="3" fill="#5558AF"/></svg>);
  if(p==="meet")return(<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="14" height="14" rx="2" fill="#34A853"/><path d="M16 9l6-4v14l-6-4V9z" fill="#4285F4"/></svg>);
  return(<svg width={size} height={size} viewBox="0 0 24 24" fill="#2D8CFF"><rect x="2" y="6" width="13" height="12" rx="2"/><path d="M15 10l7-4v12l-7-4V10z"/></svg>);
}

// ─── Burndown Chart ───────────────────────────────────────────────────────────
function BurndownChart({data}:{data:SprintDay[]}){
  const max=Math.max(...data.map(d=>d.completed),1);
  const W=180,H=40,P=4;
  const pts=data.map((d,i)=>({x:P+i*(W-P*2)/(data.length-1||1),y:H-P-(d.completed/max)*(H-P*2),n:d.completed}));
  const path=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
  return(
    <svg width={W} height={H} className="overflow-visible">
      <path d={path} fill="none" className="stroke-brand" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {pts.map((p,i)=>p.n>0&&(
        <g key={i}><circle cx={p.x} cy={p.y} r={3} className="fill-brand"/><text x={p.x} y={p.y-6} textAnchor="middle" fontSize={11} className="fill-fg-4">{p.n}</text></g>
      ))}
    </svg>
  );
}

// ─── AI Assistant (OpenAI GPT-4o — server-side via /api/kanban/ai) ───────────
function AIAssistant({title,onResult,onClose}:{title:string;onResult:(d:{story:string;subtasks:Subtask[];effortScore:number;valueScore:number})=>void;onClose:()=>void;}){
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{if(title)run();},[]);
  async function run(){
    setLoading(true);setError(null);
    try{
      const res=await fetch("/api/kanban/ai",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-admin-token":getAuthToken()??''},
        body:JSON.stringify({title}),
      });
      const data=await res.json() as {story:string;subtasks:Subtask[];effortScore:number;valueScore:number;error?:string};
      if(!res.ok||data.error){setError(data.error??"AI request failed");setLoading(false);return;}
      onResult({story:data.story,subtasks:data.subtasks,effortScore:data.effortScore,valueScore:data.valueScore});
    }catch(e){setError("AI error: "+String(e));}
    setLoading(false);
  }
  return(
    <div className="rounded-lg border border-brand-line bg-brand-soft px-3.5 py-3 mb-3.5">
      <div className={`flex items-center gap-2 ${loading||error?"mb-2":""}`}>
        <span className="text-[16px]">🤖</span><span className="text-[13px] font-semibold text-brand-fg">AI Assistant</span>
        <div className="flex-1"/>
        <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-icon"><XIcon/></button>
      </div>
      {loading&&<div className="text-[12px] text-fg-4 flex items-center gap-1.5"><div className="w-3 h-3 rounded-full border-2 border-brand-line border-t-brand animate-spin"/>Analyzing card…</div>}
      {error&&<div className="text-[12px] text-danger-fg">{error}</div>}
    </div>
  );
}

// ─── Standup Mode ─────────────────────────────────────────────────────────────
function StandupMode({columns,admins,me,onClose}:{columns:KanbanColumn[];admins:Employee[];me:Employee;onClose:()=>void}){
  const myCards=columns.flatMap(col=>col.cards.filter(c=>c.assigneeId===me.id).map(c=>({...c,colTitle:col.title,colId:col.id})));
  const inProgress=myCards.filter(c=>c.colId==="inprogress");
  const done=myCards.filter(c=>c.colId==="done");
  const blocked=myCards.filter(c=>c.blockedBy);
  return(
    <div className="fixed inset-0 bg-canvas z-2000 flex flex-col items-center justify-center p-10">
      <div className="max-w-175 w-full">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="label mb-1.5">Daily Standup</div>
            <div className="text-[32px] font-bold text-fg tracking-tight">{today.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
          </div>
          <div className="flex items-center gap-3">
            <Avatar name={me.name} color={me.color} size={44}/>
            <button onClick={onClose} className="btn btn-secondary">Exit</button>
          </div>
        </div>
        {([{emoji:"✅",label:"Done since last standup",cards:done,color:"var(--success-fg)"},{emoji:"🔨",label:"Working on today",cards:inProgress,color:"var(--warning-fg)"},{emoji:"🚫",label:"Blocked",cards:blocked,color:"var(--danger-fg)"}]).map(({emoji,label,cards,color})=>(
          <div key={label} className="mb-7">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-[20px]">{emoji}</span>
              <span className="section-title text-fg-2">{label}</span>
              <div className="flex-1 h-px bg-line-soft"/>
              <span className="badge badge-neutral" style={{color}}>{cards.length}</span>
            </div>
            {cards.length===0?<div className="text-[13px] text-fg-4 italic pl-7.5">Nothing to report</div>
            :cards.map(c=>(
              <div key={c.id} className="flex items-start gap-2.5 py-2.5 pr-3.5 pl-7.5 bg-surface border border-line rounded-lg mb-1.5">
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-fg">{c.title}</div>
                  {c.blockedBy&&<div className="text-[12px] text-danger-fg mt-0.5">🚫 {c.blockedBy}</div>}
                </div>
                <span className="badge shrink-0" style={{color,background:tint(color,"22"),borderColor:tint(color,"40")}}>{c.colTitle}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Meeting Modal ────────────────────────────────────────────────────────────
function MeetingModal({meeting,defaultDate,integrations,admins,onClose,onSave,onDelete}:{meeting:Meeting|null;defaultDate?:string;integrations:IntegrationStatus;admins:Employee[];onClose:()=>void;onSave:(m:Meeting)=>void;onDelete:(id:string)=>void;}){
  const isNew=!meeting;
  const [title,setTitle]=useState(meeting?.title??"");
  const [date,setDate]=useState(meeting?.date??defaultDate??NOW_ISO);
  const [startTime,setStartTime]=useState(meeting?.startTime??"09:00");
  const [endTime,setEndTime]=useState(meeting?.endTime??"09:30");
  const [platform,setPlatform]=useState<MeetPlatform>(meeting?.platform??"teams");
  const [attendees,setAttendees]=useState<string[]>(meeting?.attendeeIds??[]);
  const [desc,setDesc]=useState(meeting?.description??"");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [created,setCreated]=useState<Meeting|null>(null);
  const toggleAttendee=(id:string)=>setAttendees(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  const toISO=(d:string,t:string)=>`${d}T${t}:00`;
  const isConnected=platform==="teams"?integrations.teams:platform==="meet"?integrations.google:integrations.zoom;
  const pm=PLATFORM_META[platform];
  async function createMeeting(){
    if(!title.trim())return;setLoading(true);setError(null);
    const emails=attendees.map(id=>admins.find(e=>e.id===id)?.email).filter(Boolean) as string[];
    try{
      let apiUrl="",body:Record<string,unknown>={};
      if(platform==="teams"){apiUrl="/api/meetings/teams";body={subject:title,startTime:toISO(date,startTime),endTime:toISO(date,endTime),attendees:emails,msAccessToken:getMsToken()};}
      else if(platform==="meet"){apiUrl="/api/meetings/google";body={title,startTime:toISO(date,startTime),endTime:toISO(date,endTime),attendees:emails,description:desc};}
      else{apiUrl="/api/meetings/zoom";body={title,startTime:toISO(date,startTime),endTime:toISO(date,endTime),description:desc};}
      const tok=getAuthToken()??'';
      const res=await fetch(apiUrl,{method:"POST",headers:{"Content-Type":"application/json","x-admin-token":tok},body:JSON.stringify(body)});
      const data=await res.json() as {joinUrl?:string;meetingId?:string;error?:string};
      if(!res.ok||data.error){setError(data.error??"Failed to create meeting");setLoading(false);return;}
      setCreated({id:meeting?.id??"m"+Date.now(),title,date,startTime,endTime,platform,joinUrl:data.joinUrl!,meetingId:data.meetingId,attendeeIds:attendees,description:desc||undefined,createdAt:meeting?.createdAt??tsNow(),status:"confirmed"});
    }catch(e){setError(String(e));}
    setLoading(false);
  }
  if(created)return(
    <div className={`${BACKDROP} z-1100`} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="popover animate-pop-in w-115 max-w-[94vw] px-7 pt-7 pb-6 text-center">
        <div className="w-13 h-13 rounded-full bg-success-soft text-success-fg flex items-center justify-center mx-auto mb-4 text-[26px]">+</div>
        <div className="text-[16px] font-semibold text-fg mb-1">Meeting Created</div>
        <div className="text-[13px] text-fg-4 mb-5">{created.title} - {created.startTime}-{created.endTime}</div>
        <a href={created.joinUrl} target="_blank" rel="noreferrer" className="btn btn-lg text-white no-underline mb-4" style={{background:pm.btnBg}}><PlatformIcon p={created.platform} size={15}/>Join {pm.label} →</a>
        <div className="mb-5">
          <div className="label text-fg-5 mb-1.5">Join URL</div>
          <div className="text-[12px] text-brand-fg break-all px-3 py-2 bg-brand-soft rounded-lg select-all">{created.joinUrl}</div>
        </div>
        <button onClick={()=>onSave(created)} className="btn btn-primary">Save to Calendar</button>
      </div>
    </div>
  );
  return(
    <div className={`${BACKDROP} z-1100`} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="popover animate-pop-in w-135 max-w-[94vw] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line-soft shrink-0">
          <div className="section-title">{isNew?"Schedule Meeting":"Edit Meeting"}</div>
          <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-icon"><XIcon/></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3.5"><label className="field-label">Meeting Title *</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Sprint Planning" className="field"/></div>
          <div className="mb-3.5"><label className="field-label">Platform</label>
            <div className="flex gap-2">
              {(["teams","meet","zoom"] as MeetPlatform[]).map(p=>{
                const meta=PLATFORM_META[p],active=platform===p,conn=p==="teams"?integrations.teams:p==="meet"?integrations.google:integrations.zoom;
                return(
                  <button key={p} onClick={()=>setPlatform(p)}
                    className={`flex-1 flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-lg border cursor-pointer text-[12px] font-semibold transition-colors ${active?"":"border-line bg-raised text-fg-4 hover:border-line-hover"}`}
                    style={active?{borderColor:meta.color,background:meta.bg,color:meta.color}:undefined}>
                    <PlatformIcon p={p} size={18}/>{meta.label}
                    <span className={`badge ${conn?"badge-success":"badge-neutral"}`}>{conn?"Connected":"Not connected"}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {!isConnected&&<div className="rounded-lg border border-warning-line bg-warning-soft px-4 py-3.5 mb-3.5">
            <div className="text-[13px] font-semibold text-warning-fg mb-2">Connect your {pm.label} account first</div>
            <div className="text-[12px] text-warning-fg leading-normal mb-3">{platform==="teams"&&"Sign in via the Outlook tab first."}{platform==="meet"&&"Authorize Preciprocal to create Google Calendar events with Meet links."}{platform==="zoom"&&"Authorize Preciprocal to create Zoom meetings on your behalf."}</div>
            {platform!=="teams"&&<button type="button" onClick={()=>void startConnect(platform as "meet"|"zoom")} className="btn text-white" style={{background:pm.btnBg}}><PlatformIcon p={platform} size={14}/>Connect {pm.label} →</button>}
          </div>}
          {isConnected&&<>
            <div className="flex gap-2.5 mb-3.5">
              <div className="flex-2"><label className="field-label">Date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="field"/></div>
              <div className="flex-1"><label className="field-label">Start</label><input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} className="field"/></div>
              <div className="flex-1"><label className="field-label">End</label><input type="time" value={endTime} onChange={e=>setEndTime(e.target.value)} className="field"/></div>
            </div>
            <div className="mb-3.5"><label className="field-label">Description</label><textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={2} placeholder="Agenda…" className="field min-h-0"/></div>
            <div className="mb-3.5"><label className="field-label">Invite Attendees</label>
              <div className="flex flex-wrap gap-2">
                {admins.map(emp=>{const active=attendees.includes(emp.id);return(
                  <button key={emp.id} onClick={()=>toggleAttendee(emp.id)} className={pickCls(active)}>
                    <Avatar name={emp.name} color={emp.color} size={22}/>
                    <div className="text-left"><div className={`text-[12px] font-semibold ${active?"text-brand-fg":"text-fg-3"}`}>{emp.name}</div><div className="text-[11px] text-fg-5">{emp.role}</div></div>
                    {active&&<span className="text-[12px] text-brand-fg">✓</span>}
                  </button>
                );})}
              </div>
            </div>
            <div className="rounded-lg border px-3.5 py-2.5 flex items-center gap-2.5" style={{background:pm.bg,borderColor:tint(pm.color,"33")}}>
              <PlatformIcon p={platform} size={16}/>
              <div className="flex-1 text-[12px] text-fg-4">{platform==="teams"&&"Meeting created via Microsoft Graph · Calendar invites sent"}{platform==="meet"&&"Event created in Google Calendar · Meet link auto-generated"}{platform==="zoom"&&"Zoom meeting created · Unique join URL generated"}</div>
              {platform!=="teams"&&<button type="button" onClick={()=>void startConnect(platform as "meet"|"zoom")} className="link text-[11px] shrink-0" style={{color:pm.color}}>Reconnect</button>}
            </div>
            {error&&<div className="mt-2.5 text-[12px] text-danger-fg bg-danger-soft border border-danger-line rounded-lg px-2.5 py-2 leading-normal">{error}</div>}
          </>}
        </div>
        <div className="px-5 py-3 border-t border-line-soft flex gap-2 justify-end shrink-0">
          {!isNew&&meeting&&<button onClick={()=>onDelete(meeting.id)} className="btn btn-danger mr-auto">Delete</button>}
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          {isConnected&&<button onClick={createMeeting} disabled={!title.trim()||loading} className="btn btn-primary"><PlatformIcon p={platform} size={13}/>{loading?"Creating...":"Create Meeting"}</button>}
        </div>
      </div>
    </div>
  );
}

// ─── Calendar Panel ───────────────────────────────────────────────────────────
function CalendarPanel({cards,meetings,admins,calMonth,setCalMonth,calSelected,setCalSelected,onSchedule,onEditMeeting,compact=false}:{cards:KanbanCard[];meetings:Meeting[];admins:Employee[];calMonth:Date;setCalMonth:(d:Date)=>void;calSelected:string;setCalSelected:(s:string)=>void;onSchedule:(date:string)=>void;onEditMeeting:(m:Meeting)=>void;compact?:boolean;}){
  const monthLabel=calMonth.toLocaleDateString("en-US",{month:"long",year:"numeric"});
  const days=calDays(calMonth);
  const eventDates=new Set<string>([...meetings.map(m=>m.date),...cards.filter(c=>c.dueDate).map(c=>c.dueDate!)]);
  const selMeetings=meetings.filter(m=>m.date===calSelected).sort((a,b)=>a.startTime.localeCompare(b.startTime));
  const dueTiles=cards.filter(c=>c.dueDate===calSelected);
  const selLabel=new Date(calSelected).toLocaleDateString("en-US",{weekday:"short",month:"long",day:"numeric"});
  return(
    <div className={`flex flex-col overflow-hidden bg-surface ${compact?"flex-1":"w-67 min-w-67 max-w-67 shrink-0 border-l border-line self-stretch"}`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-line-soft shrink-0">
        <div className="flex items-center justify-between">
          <div><div className="section-title">Calendar</div><div className="text-[12px] text-fg-4 mt-px">{selLabel}</div></div>
          <button onClick={()=>onSchedule(calSelected)} className="btn btn-primary btn-sm"><PlusIcon/>Meet</button>
        </div>
      </div>
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[13px] font-semibold text-fg">{monthLabel}</span>
          <div className="flex gap-1">
            <button aria-label="Previous month" className="btn btn-ghost btn-sm btn-icon" onClick={()=>setCalMonth(new Date(calMonth.getFullYear(),calMonth.getMonth()-1,1))}><ChevronIcon dir="left"/></button>
            <button aria-label="Next month" className="btn btn-ghost btn-sm btn-icon" onClick={()=>setCalMonth(new Date(calMonth.getFullYear(),calMonth.getMonth()+1,1))}><ChevronIcon dir="right"/></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px">
          {["Mo","Tu","We","Th","Fr","Sa","Su"].map(d=><div key={d} className="text-[11px] font-semibold text-fg-5 text-center py-0.5 uppercase">{d}</div>)}
          {days.map(({date,day,cur})=>{
            const isT=date===NOW_ISO,isSel=date===calSelected&&!isT,hasEv=eventDates.has(date);
            const tone=isT?"bg-brand text-white font-semibold":isSel?"bg-brand-soft text-brand-fg font-medium":!cur?"text-fg-5 font-medium hover:bg-hover":"text-fg-3 font-medium hover:bg-hover";
            return(
              <div key={date} onClick={()=>setCalSelected(date)} className={`aspect-square flex items-center justify-center text-[11px] rounded-md cursor-pointer relative transition-colors ${tone}`}>
                {day}
                {hasEv&&<div className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-0.75 h-0.75 rounded-full ${isT?"bg-current":"bg-brand"}`}/>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {selMeetings.length===0&&dueTiles.length===0&&<div className="p-4 text-center text-[12px] text-fg-5">Nothing scheduled.<br/><button onClick={()=>onSchedule(calSelected)} className="link text-[12px] mt-2">+ Schedule a meeting</button></div>}
        {selMeetings.length>0&&<div className="mb-2.5"><div className="label pt-1 mb-1.5">Meetings</div>
          {selMeetings.map(m=>{const pm=PLATFORM_META[m.platform];return(
            <div key={m.id} className="bg-raised border border-line rounded-lg px-3 py-2.5 mb-2 cursor-pointer hover:border-line-hover transition-colors" onClick={()=>onEditMeeting(m)}>
              <div className="flex items-start gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{background:pm.bg}}><PlatformIcon p={m.platform} size={16}/></div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-fg mb-0.5">{m.title}</div>
                  <div className="text-[11px] text-fg-4 mb-1.5">{m.startTime} - {m.endTime}</div>
                  <div className="flex items-center justify-between">
                    <AttendeeStack ids={m.attendeeIds} admins={admins}/>
                    <a href={m.joinUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} className="btn btn-sm text-white no-underline" style={{background:pm.btnBg}}>Join →</a>
                  </div>
                </div>
              </div>
            </div>
          );})}
        </div>}
        {dueTiles.length>0&&<div><div className="label pt-1 mb-1.5">Due Tasks</div>
          {dueTiles.map(c=>{const emp=empById(admins,c.assigneeId);return(
            <div key={c.id} className="flex items-center gap-2 px-2.5 py-2 bg-raised rounded-lg mb-1.5">
              <div className="w-7 h-7 rounded-md bg-raised-2 flex items-center justify-center text-[11px] font-semibold text-fg-4 shrink-0">DUE</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-fg truncate">{c.title}</div>
                <div className="text-[11px] text-fg-5 mt-px">Due today{emp?` - ${emp.name}`:""}</div>
              </div>
            </div>
          );})}
        </div>}
      </div>
    </div>
  );
}

// ─── Meetings Panel (mobile) ──────────────────────────────────────────────────
function MeetingsPanel({meetings,admins,onSchedule,onEdit}:{meetings:Meeting[];admins:Employee[];onSchedule:(d:string)=>void;onEdit:(m:Meeting)=>void;}){
  const sorted=[...meetings].sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime));
  return(
    <div className="flex-1 overflow-y-auto p-3.5 bg-canvas">
      <div className="flex items-center justify-between mb-3.5">
        <span className="section-title">All Meetings</span>
        <button onClick={()=>onSchedule(NOW_ISO)} className="btn btn-primary btn-sm"><PlusIcon/>Schedule</button>
      </div>
      {sorted.map(m=>{
        const pm=PLATFORM_META[m.platform];
        const dl=new Date(m.date).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
        return(
          <div key={m.id} className="card px-3.5 py-3 mb-2.5 cursor-pointer" onClick={()=>onEdit(m)}>
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{background:pm.bg}}><PlatformIcon p={m.platform} size={18}/></div>
              <div className="flex-1"><div className="text-[13px] font-semibold text-fg">{m.title}</div><div className="text-[12px] text-fg-4">{dl} - {m.startTime}-{m.endTime}</div></div>
              <a href={m.joinUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} className="btn btn-sm text-white no-underline shrink-0" style={{background:pm.btnBg}}>Join</a>
            </div>
            <AttendeeStack ids={m.attendeeIds} max={7} admins={admins}/>
          </div>
        );
      })}
    </div>
  );
}

// ─── Card Tile ────────────────────────────────────────────────────────────────
function KanbanCardTile({card,colId,isDragging,admins,onDragStart,onClick}:{card:KanbanCard;colId:string;isDragging:boolean;admins:Employee[];onDragStart:(e:React.DragEvent,cardId:string,colId:string)=>void;onClick:(card:KanbanCard,colId:string)=>void;}){
  const emp=empById(admins,card.assigneeId);
  const pm=PRIORITY_META[card.priority];
  const doneSubs=card.subtasks?.filter(s=>s.done).length??0;
  const totalSubs=card.subtasks?.length??0;
  const progress=totalSubs?doneSubs/totalSubs:0;
  const score=calcScore(card.valueScore,card.effortScore);
  const scoreColor=score!==null?(score>=15?"var(--success-fg)":score>=8?"var(--warning-fg)":"var(--danger-fg)"):"var(--fg-4)";
  const due=card.dueDate?formatDue(card.dueDate):null;
  const commentCount=card.commentList?.length??0;
  const linkCount=card.links?.length??0;
  const cycleTime=card.inProgressAt&&card.completedAt?cycleHours(card.inProgressAt,card.completedAt):card.inProgressAt?cycleHours(card.inProgressAt,new Date().toISOString()):null;
  return(
    <div draggable onDragStart={e=>onDragStart(e,card.id,colId)} onClick={()=>onClick(card,colId)}
      className={`rounded-lg border px-3 py-2.5 select-none transition-[box-shadow,transform,border-color] duration-150 ${card.lockedBy?"bg-warning-soft border-warning-line cursor-default":"bg-surface border-line hover:border-line-hover cursor-grab"}`}
      style={{opacity:isDragging?0.35:1}}
      onMouseEnter={e=>{if(!card.lockedBy){const el=e.currentTarget as HTMLElement;el.style.boxShadow="0 4px 14px -6px var(--scrim)";el.style.transform="translateY(-1px)";}}}
      onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.boxShadow="none";el.style.transform="none";}}>
      {card.lockedBy&&<div className="text-[11px] text-warning-fg font-semibold mb-1.5">🔒 {card.lockedBy} is editing</div>}
      {card.labels.length>0&&<div className="flex gap-1 flex-wrap mb-2">{card.labels.map(l=>{const lm=LABEL_META[l];return<span key={l} className={`badge ${lm.badge}`}>{lm.label}</span>;})}</div>}
      {card.blockedBy&&<div className="bg-danger-soft border-l-[3px] border-l-danger rounded-r px-2 py-0.5 text-[11px] text-danger-fg font-semibold mb-1.5">Blocked: {card.blockedBy}</div>}
      <div className={`text-[13px] font-semibold text-fg leading-snug ${card.story?"mb-1":"mb-1.5"}`}>{card.title}</div>
      {card.story&&<div className="text-[12px] text-fg-4 italic mb-2 pl-2 border-l-2 border-line leading-normal">{card.story.length>70?card.story.slice(0,70)+"...":card.story}</div>}
      {linkCount>0&&<div className="flex gap-1 flex-wrap mb-2">{card.links!.map(lk=><a key={lk.id} href={lk.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} className="badge badge-brand no-underline">🔗 {lk.label}</a>)}</div>}
      {totalSubs>0&&<div className="mb-2">
        <div className="flex justify-between mb-1"><span className="text-[11px] text-fg-4 font-medium">{doneSubs}/{totalSubs} tasks</span><span className={`text-[11px] font-semibold ${progress===1?"text-success-fg":"text-fg-4"}`}>{Math.round(progress*100)}%</span></div>
        <div className="h-0.75 bg-raised-2 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-[width] duration-300 ${progress===1?"bg-success":"bg-brand"}`} style={{width:`${progress*100}%`}}/></div>
      </div>}
      <div className="flex items-center gap-1 flex-wrap">
        <span className={`badge ${pm.badge}`}>{pm.label}</span>
        {due&&<span className={`badge ${due.overdue?"badge-danger":due.soon?"badge-warning":"badge-neutral"}`}>{due.label}</span>}

        <div className="flex-1"/>
        {commentCount>0&&<span className="text-[11px] text-fg-4">{commentCount} cmts</span>}
        {linkCount>0&&<span className="text-[11px] text-fg-4">{linkCount} lnks</span>}
        {cycleTime!==null&&<Tooltip text={`Cycle time: ${cycleTime}h${card.completedAt?" (completed)":"  in progress"}`}><span className="text-[11px] text-fg-4 cursor-default">⏱{cycleTime}h</span></Tooltip>}
        {score!==null&&<Tooltip text={`Priority Score: ${score}/100 (Value ${card.valueScore} ÷ Effort ${card.effortScore} × 10). Higher = do it sooner.`}><span className="text-[11px] font-semibold cursor-default" style={{color:scoreColor}}>⚡{score}</span></Tooltip>}
        {emp&&<Avatar name={emp.name} color={emp.color} size={20}/>}
      </div>
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────
function Column({col,dragOverColId,draggingCardId,admins,onDragStart,onDragOver,onDrop,onDragLeave,onAddCard,onEditCard}:{col:KanbanColumn;dragOverColId:string|null;draggingCardId:string|null;admins:Employee[];onDragStart:(e:React.DragEvent,cid:string,colId:string)=>void;onDragOver:(e:React.DragEvent,colId:string)=>void;onDrop:(e:React.DragEvent,colId:string)=>void;onDragLeave:()=>void;onAddCard:(colId:string)=>void;onEditCard:(card:KanbanCard,colId:string)=>void;}){
  const isDragOver=dragOverColId===col.id;
  const overLimit=col.limit!==undefined&&col.cards.length>col.limit;
  return(
    <div onDragOver={e=>onDragOver(e,col.id)} onDrop={e=>onDrop(e,col.id)} onDragLeave={onDragLeave}
      className={`flex flex-1 flex-col min-w-0 h-full rounded-xl border transition-colors duration-150 ${isDragOver?"bg-brand-soft border-dashed border-brand":"bg-subtle border-line"}`}>
      <div className="h-9 min-h-9 pl-3 pr-1.5 flex items-center gap-2 shrink-0">
        <div className="w-2 h-2 rounded-full shrink-0" style={{background:col.color}}/>
        <span className="text-[12px] font-semibold text-fg-3 flex-1 leading-none truncate">{col.title}</span>
        <span className={`badge shrink-0 ${overLimit?"badge-danger":"badge-neutral"}`}>{col.cards.length}{col.limit?`/${col.limit}`:""}</span>
        <button onClick={()=>onAddCard(col.id)} aria-label="Add card" className="btn btn-ghost btn-sm btn-icon shrink-0"><PlusIcon/></button>
      </div>
      <div className="h-5.5 min-h-5.5 px-3 flex items-center shrink-0">{col.desc&&<span className="text-[11px] text-fg-5 italic leading-none">{col.desc}</span>}</div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-1.5">
        {col.cards.length===0?<div className="border border-dashed border-line rounded-lg py-5 px-3 text-center text-[12px] text-fg-5">Drop cards here</div>
        :col.cards.map(card=><KanbanCardTile key={card.id} card={card} colId={col.id} isDragging={draggingCardId===card.id} admins={admins} onDragStart={onDragStart} onClick={onEditCard}/>)}
      </div>
    </div>
  );
}

// ─── Card Modal ───────────────────────────────────────────────────────────────
function CardModal({card,colId,columns,isNew,me,admins,onClose,onSave,onDelete,onAddComment,onDeleteComment}:{card:KanbanCard|null;colId:string|null;columns:KanbanColumn[];isNew:boolean;me:Employee;admins:Employee[];onClose:()=>void;onSave:(card:KanbanCard,colId:string)=>void;onDelete:(id:string)=>void;onAddComment:(cardId:string,colId:string,comment:Comment)=>Promise<void>;onDeleteComment:(cardId:string,colId:string,commentId:string)=>Promise<void>;}){
  const [title,setTitle]=useState(card?.title??"");
  const [desc,setDesc]=useState(card?.description??"");
  const [story,setStory]=useState(card?.story??"");
  const [priority,setPriority]=useState<Priority>(card?.priority??"medium");
  const [labels,setLabels]=useState<LabelKey[]>(card?.labels??[]);
  const [assigneeId,setAssigneeId]=useState(card?.assigneeId??"");
  const [dueDate,setDueDate]=useState(card?.dueDate??"");
  const [blockedBy,setBlockedBy]=useState(card?.blockedBy??"");
  const [effort,setEffort]=useState(card?.effortScore??3);
  const [value,setValue]=useState(card?.valueScore??5);

  const [targetCol,setTargetCol]=useState(colId??columns[0]?.id??"");
  const [actualHours,setActualHours]=useState(card?.actualHours??0);
  const [subtasks,setSubtasks]=useState<Subtask[]>(card?.subtasks??[]);
  const [newSubtask,setNewSubtask]=useState("");
  const comments=card?.commentList??[];
  const [commentText,setCommentText]=useState("");
  const [links,setLinks]=useState<CardLink[]>(card?.links??[]);
  const [linkLabel,setLinkLabel]=useState("");
  const [linkUrl,setLinkUrl]=useState("");
  const [showLinkForm,setShowLinkForm]=useState(false);
  const [tab,setTab]=useState<"details"|"comments"|"links">("details");
  const [showAI,setShowAI]=useState(false);
  const score=effort>0?Math.round((value/effort)*10):0;
  const scoreColor=score>=15?"var(--success-fg)":score>=8?"var(--warning-fg)":"var(--danger-fg)";
  const isDone=targetCol==="done";
  const toggleLabel=(l:LabelKey)=>setLabels(prev=>prev.includes(l)?prev.filter(x=>x!==l):[...prev,l]);
  const addComment=async()=>{
    const t=commentText.trim();if(!t||!card)return;
    const comment:Comment={id:"cm"+Date.now(),author:me.name,authorColor:me.color,text:t,createdAt:tsNow()};
    setCommentText("");
    await onAddComment(card.id,colId??columns[0].id,comment);
    // @mention notifications
    const mentions=[...t.matchAll(/@(\w+)/g)].map(m=>m[1]);
    if(mentions.length>0){
      const emails=admins.filter(a=>mentions.some(m=>a.name.toLowerCase().includes(m.toLowerCase()))).map(a=>a.email);
      if(emails.length>0&&getAuthToken()){fetch("/api/kanban/notify",{method:"POST",headers:{"Content-Type":"application/json","x-admin-token":getAuthToken()!},body:JSON.stringify({type:"mention",from:me.name,cardTitle:card.title,comment:t,emails})}).catch(()=>{});}
    }
  };
  const addLink=()=>{const lbl=linkLabel.trim(),url=linkUrl.trim();if(!lbl||!url)return;setLinks(prev=>[...prev,{id:"lk"+Date.now(),label:lbl,url:url.startsWith("http")?url:"https://"+url}]);setLinkLabel("");setLinkUrl("");setShowLinkForm(false);};
  const addSubtask=()=>{const t=newSubtask.trim();if(!t)return;setSubtasks(prev=>[...prev,{done:false,label:t}]);setNewSubtask("");};
  const toggleSubtask=(i:number)=>setSubtasks(prev=>prev.map((s,j)=>j===i?{...s,done:!s.done}:s));
  const removeSubtask=(i:number)=>setSubtasks(prev=>prev.filter((_,j)=>j!==i));
  const handleSave=()=>{
    if(!title.trim())return;
    const now=new Date().toISOString();
    onSave({id:card?.id??`k${Date.now()}`,title:title.trim(),description:desc.trim()||undefined,story:story.trim()||undefined,priority,labels,assigneeId:assigneeId||undefined,dueDate:dueDate||undefined,blockedBy:blockedBy.trim()||null,effortScore:effort,valueScore:value,subtasks,commentList:comments,links,
      inProgressAt:targetCol==="inprogress"&&!card?.inProgressAt?now:card?.inProgressAt,
      completedAt:targetCol==="done"&&!card?.completedAt?now:card?.completedAt,
      actualHours:isDone&&actualHours>0?actualHours:card?.actualHours,
    },targetCol);
  };
  const tabBtn=(t:typeof tab,label:string)=>(<button onClick={()=>setTab(t)} className={`seg-item ${tab===t?"seg-item-active":""}`}>{label}</button>);
  const chipCls=(act:boolean,on:string)=>`h-7 px-2.5 rounded-lg border cursor-pointer text-[12px] font-semibold transition-colors ${act?on:"border-line bg-raised text-fg-4 hover:text-fg-2 hover:border-line-hover"}`;
  return(
    <div className={`${BACKDROP} z-1000`} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="popover animate-pop-in w-145 max-w-[94vw] max-h-[90vh] flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-line-soft shrink-0">
          <div className="flex items-center justify-between mb-2.5">
            <div className="section-title">{isNew?"New Card":"Edit Card"}</div>
            <div className="flex gap-2 items-center">
              {!isNew&&title&&<Tooltip text="Let AI auto-fill the user story, subtasks, and effort/value scores based on the card title"><button onClick={()=>setShowAI(a=>!a)} className={`btn btn-sm btn-secondary ${showAI?"btn-on":""}`}>AI</button></Tooltip>}
              <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-icon"><XIcon/></button>
            </div>
          </div>
          <div className="seg">{tabBtn("details","Details")}{tabBtn("comments",`Comments${comments.length?` (${comments.length})`:""}`)}{tabBtn("links",`Links${links.length?` (${links.length})`:""}`)}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {showAI&&title&&<AIAssistant title={title} onClose={()=>setShowAI(false)} onResult={r=>{setStory(r.story);setSubtasks(r.subtasks);setEffort(r.effortScore);setValue(r.valueScore);setShowAI(false);}}/>}
          {tab==="details"&&(<>
            <div className="mb-3.5"><label className="field-label">Title *</label><textarea value={title} onChange={e=>setTitle(e.target.value)} rows={2} className="field min-h-0"/></div>
            <div className="mb-3.5"><label className="field-label">User Story</label><textarea value={story} onChange={e=>setStory(e.target.value)} rows={2} placeholder="As a [user], I want [goal] so that [reason]…" className="field min-h-0"/></div>
            <div className="mb-3.5"><label className="field-label">Description / Acceptance Criteria</label><textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={2} placeholder="Technical notes, DoD…" className="field min-h-0"/></div>
            <div className="mb-3.5"><label className="field-label">Priority</label>
              <div className="flex gap-1.5 flex-wrap">{(["critical","high","medium","low"] as Priority[]).map(p=>{const pm=PRIORITY_META[p],act=priority===p;return<button key={p} onClick={()=>setPriority(p)} className={chipCls(act,pm.on)}>{pm.label}</button>;})}</div>
            </div>
            <div className="mb-3.5"><label className="field-label">Labels</label>
              <div className="flex gap-1.5 flex-wrap">{(Object.keys(LABEL_META) as LabelKey[]).map(l=>{const lm=LABEL_META[l],act=labels.includes(l);return<button key={l} onClick={()=>toggleLabel(l)} className={chipCls(act,lm.on)}>{lm.label}</button>;})}</div>
            </div>
            <div className="mb-3.5"><label className="field-label">Assignee</label>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={()=>setAssigneeId("")} className={pickCls(assigneeId==="")}>
                  <div className="w-5.5 h-5.5 rounded-full bg-raised-2 flex items-center justify-center text-[11px] text-fg-4">-</div>
                  <span className={`text-[12px] font-semibold ${assigneeId===""?"text-brand-fg":"text-fg-3"}`}>Unassigned</span>
                </button>
                {admins.map(emp=>{const act=assigneeId===emp.id;return(
                  <button key={emp.id} onClick={()=>setAssigneeId(emp.id)} className={pickCls(act)}>
                    <Avatar name={emp.name} color={emp.color} size={22}/>
                    <div className="text-left"><div className={`text-[12px] font-semibold ${act?"text-brand-fg":"text-fg-3"}`}>{emp.name}</div><div className="text-[11px] text-fg-5">{emp.role}</div></div>
                  </button>
                );})}
              </div>
            </div>
            <div className="flex gap-2.5 mb-3.5">
              <div className="flex-1"><label className="field-label">Effort (1–10)</label><input type="number" min={1} max={10} value={effort} onChange={e=>setEffort(Number(e.target.value))} className="field"/></div>
              <div className="flex-1"><label className="field-label">Value (1–10)</label><input type="number" min={1} max={10} value={value} onChange={e=>setValue(Number(e.target.value))} className="field"/></div>
              <div className="flex-1"><label className="field-label"><Tooltip text="Priority Score = Value ÷ Effort × 10. Score above 15 = high priority, 8-14 = medium, below 8 = low.">⚡ Score ℹ</Tooltip></label><div className="h-9 flex items-center text-[20px] font-semibold num" style={{color:scoreColor}}>{score}</div></div>

            </div>
            <div className="flex gap-2.5 mb-3.5">
              <div className="flex-1"><label className="field-label">Due Date</label><input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} className="field"/></div>
              {isDone&&<div className="flex-1"><label className="field-label"><Tooltip text="How many hours did this card actually take? Used to build velocity data and improve future estimates.">⏱ Actual Hours ℹ</Tooltip></label><input type="number" min={0} value={actualHours} onChange={e=>setActualHours(Number(e.target.value))} placeholder="e.g. 12" className="field"/></div>}
            </div>
            <div className="mb-3.5"><label className="field-label">Blocked By</label><input value={String(blockedBy??"")} onChange={e=>setBlockedBy(e.target.value)} placeholder="Describe blocker (leave empty if none)…" className="field"/></div>
            <div className="mb-3.5">
              <label className="field-label">Subtasks</label>
              {subtasks.map((s,i)=>(
                <div key={i} className="flex items-center gap-2 mb-1">
                  <Checkbox checked={s.done} onChange={()=>toggleSubtask(i)} label={s.label}/>
                  <span className={`flex-1 text-[13px] ${s.done?"line-through text-fg-5":"text-fg-2"}`}>{s.label}</span>
                  <button onClick={()=>removeSubtask(i)} aria-label="Remove subtask" className="btn btn-ghost btn-sm btn-icon"><XIcon/></button>
                </div>
              ))}
              <div className="flex gap-1.5 mt-1.5">
                <input value={newSubtask} onChange={e=>setNewSubtask(e.target.value)} placeholder="Add subtask..." onKeyDown={e=>{if(e.key==="Enter")addSubtask();}} className="field flex-1"/>
                <button onClick={addSubtask} disabled={!newSubtask.trim()} className="btn btn-secondary h-9 shrink-0">Add</button>
              </div>
            </div>
            <div><label className="field-label">Column</label><Select value={targetCol} onChange={e=>setTargetCol(e.target.value)}>{columns.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</Select></div>
          </>)}
          {tab==="comments"&&<div>
            {comments.length===0&&<div className="empty">No comments yet. Use @Name to mention teammates.</div>}
            {comments.map(cm=>(
              <div key={cm.id} className="flex gap-2.5 mb-4">
                <Avatar name={cm.author} color={cm.authorColor} size={28}/>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-[13px] font-semibold text-fg">{cm.author}</span>
                    <span className="text-[11px] text-fg-5">{cm.createdAt}</span>
                    {cm.author===me.name&&<button onClick={()=>card&&onDeleteComment(card.id,colId??columns[0].id,cm.id)} className="btn btn-ghost btn-sm ml-auto h-6 px-2">Delete</button>}
                  </div>
                  <div className="text-[13px] text-fg-3 leading-relaxed bg-subtle rounded-lg px-3 py-2 border border-line-soft">{cm.text.split(/(@\w+)/g).map((part,i)=>part.startsWith("@")?<span key={i} className="text-brand-fg font-semibold">{part}</span>:<span key={i}>{part}</span>)}</div>
                </div>
              </div>
            ))}
            <div className="flex gap-2.5 mt-2 pt-3.5 border-t border-line-soft">
              <Avatar name={me.name} color={me.color} size={28}/>
              <div className="flex-1">
                <textarea value={commentText} onChange={e=>setCommentText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))addComment();}} placeholder="Write a comment... Use @Name to notify." rows={3} className="field mb-2"/>
                <div className="flex items-center justify-between">
                  <span className="text-caption">@mention to notify teammates</span>
                  <button onClick={addComment} disabled={!commentText.trim()} className="btn btn-primary btn-sm">Post</button>
                </div>
              </div>
            </div>
          </div>}
          {tab==="links"&&<div>
            {links.length===0&&!showLinkForm&&<div className="empty">No links attached yet.</div>}
            {links.map(lk=>(
              <div key={lk.id} className="flex items-center gap-2.5 px-3 py-2.5 bg-subtle border border-line-soft rounded-lg mb-2">
                <div className="w-8 h-8 rounded-lg bg-brand-soft text-brand-fg flex items-center justify-center text-[13px] shrink-0">lk</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-fg mb-0.5">{lk.label}</div>
                  <a href={lk.url} target="_blank" rel="noreferrer" className="text-[12px] text-brand-fg no-underline break-all hover:underline">{lk.url}</a>
                </div>
                <button onClick={()=>setLinks(prev=>prev.filter(l=>l.id!==lk.id))} aria-label="Remove link" className="btn btn-ghost btn-sm btn-icon"><XIcon/></button>
              </div>
            ))}
            {showLinkForm?<div className="bg-subtle border border-line-soft rounded-lg p-3.5 mt-1">
              <div className="mb-2.5"><label className="field-label">Label</label><input value={linkLabel} onChange={e=>setLinkLabel(e.target.value)} placeholder="e.g. PR #247, Figma..." className="field"/></div>
              <div className="mb-3"><label className="field-label">URL</label><input value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} placeholder="https://..." className="field" onKeyDown={e=>{if(e.key==="Enter")addLink();}}/></div>
              <div className="flex gap-2">
                <button onClick={()=>setShowLinkForm(false)} className="btn btn-secondary btn-sm">Cancel</button>
                <button onClick={addLink} disabled={!linkLabel.trim()||!linkUrl.trim()} className="btn btn-primary btn-sm">Add</button>
              </div>
            </div>
            :<button onClick={()=>setShowLinkForm(true)} className="btn btn-secondary w-full mt-1 justify-start border-dashed"><PlusIcon/>Attach a link</button>}
          </div>}
        </div>
        <div className="px-5 py-3 border-t border-line-soft flex gap-2 justify-end shrink-0">
          {!isNew&&card&&<button onClick={async()=>{if(await confirmDialog({title:"Delete this card?",message:`"${card.title}" and its comments will be removed. This cannot be undone.`,confirmLabel:"Delete card",tone:"danger"}))onDelete(card.id);}} className="btn btn-danger mr-auto">Delete Card</button>}
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={!title.trim()} className="btn btn-primary">{isNew?"Add Card":"Save Card"}</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Main KanbanTab ───────────────────────────────────────────────────────────
export default function KanbanTab({token="",currentUser}:{token?:string;currentUser?:{uid:string;name:string;email:string;color?:string};}){
  const me:Employee=currentUser?{id:currentUser.uid,name:currentUser.name||currentUser.email||"Admin",role:"Admin",color:currentUser.color??"#5b6cff",email:currentUser.email||""}:FALLBACK_ME;

  const [columns,      setColumns]      = useState<KanbanColumn[]>(JSON.parse(JSON.stringify(EMPTY_COLUMNS)));
  // Starts empty: the sample meetings looked like real ones. Meetings live
  // in this session only until they are saved somewhere.
  const [meetings,     setMeetings]     = useState<Meeting[]>([]);
  const [admins,       setAdmins]       = useState<Employee[]>([me]);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardLoaded,setBoardLoaded]=useState(false);
  const [boardError,setBoardError]=useState<string|null>(null);
  const [dragCardId,   setDragCardId]   = useState<string|null>(null);
  const [dragColId,    setDragColId]    = useState<string|null>(null);
  const [dragOverColId,setDragOverColId]= useState<string|null>(null);
  const [cardModal,    setCardModal]    = useState<{card:KanbanCard|null;colId:string|null;isNew:boolean}|null>(null);
  const [meetModal,    setMeetModal]    = useState<{meeting:Meeting|null;defaultDate?:string}|null>(null);
  const [calMonth,     setCalMonth]     = useState(()=>new Date(today.getFullYear(),today.getMonth(),1));
  const [calSelected,  setCalSelected]  = useState(NOW_ISO);
  const [search,       setSearch]       = useState("");
  const [filterPri,    setFilterPri]    = useState<Priority|"all">("all");
  const [filterLabel,  setFilterLabel]  = useState<LabelKey|"all">("all");
  const [focusMe,      setFocusMe]      = useState(false);
  const [showVelocity, setShowVelocity] = useState(true);
  const [showStandup,  setShowStandup]  = useState(false);
  const [showBurndown, setShowBurndown] = useState(false);
  const [sortByScore,  setSortByScore]  = useState(false);
  const [isMobile,     setIsMobile]     = useState(false);
  const [mobileTab,    setMobileTab]    = useState<MobileTab>("board");
  const [integrations, setIntegrations] = useState<IntegrationStatus>({teams:false,google:false,zoom:false});

  // Board + calendar panel need ~880px beside the 220px sidebar; below that use the tabbed layout
  useEffect(()=>{ const check=()=>setIsMobile(window.innerWidth<1100); check(); window.addEventListener("resize",check); return()=>window.removeEventListener("resize",check); },[]);
  useEffect(()=>{ fetchIntegrationStatus().then(setIntegrations); },[]);
  useEffect(()=>{ if(typeof window==="undefined")return; const p=new URLSearchParams(window.location.search); if(p.has("connected")||p.has("error")){fetchIntegrationStatus().then(setIntegrations);window.history.replaceState({},"",window.location.pathname);} },[]);

  useEffect(()=>{
    if(!token)return;
    const h={"x-admin-token":token};
    // Only a board that actually loaded may be autosaved. Saving after a failed
    // load wrote the sample cards below over the real board.
    fetch("/api/kanban?action=board",{headers:h}).then(async r=>{const d=await r.json() as {columns:KanbanColumn[]|null;error?:string};if(!r.ok||d.error)throw new Error(d.error??`HTTP ${r.status}`);setColumns(d.columns??EMPTY_COLUMNS);setBoardLoaded(true);setBoardLoading(false);}).catch((e:Error)=>{setBoardError(e.message);setBoardLoading(false);});
    fetch("/api/kanban?action=admins",{headers:h}).then(r=>r.json()).then((d:{admins:Employee[]})=>{if(d.admins?.length)setAdmins(d.admins);}).catch(()=>{});
  },[token]);

  useEffect(()=>{
    if(!token||boardLoading||!boardLoaded)return;
    const t=setTimeout(()=>{fetch("/api/kanban?action=save-board",{method:"POST",headers:{"Content-Type":"application/json","x-admin-token":token},body:JSON.stringify({columns})}).then(r=>{if(!r.ok)setBoardError("Your last change was not saved. Refresh before editing again.");}).catch(()=>setBoardError("Your last change was not saved. Refresh before editing again."));},1000);
    return()=>clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[columns]);

  useEffect(()=>{
    if(!token||!me.email)return;
    const tomorrow=mkDate(1);
    const dueSoon=columns.flatMap(c=>c.cards).filter(c=>c.dueDate===tomorrow&&c.assigneeId===me.id);
    if(dueSoon.length>0){fetch("/api/kanban/notify",{method:"POST",headers:{"Content-Type":"application/json","x-admin-token":token},body:JSON.stringify({type:"due_reminder",emails:[me.email],cards:dueSoon.map(c=>c.title)})}).catch(()=>{});}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[token,me.email]);

  const allCards=columns.flatMap(c=>c.cards);
  const totalCards=allCards.length;
  const doneCards=columns.find(c=>c.id==="done")?.cards??[];
  const doneCount=doneCards.length;
  const inProgCount=columns.find(c=>c.id==="inprogress")?.cards.length??0;
  const blockedCount=allCards.filter(c=>c.blockedBy).length;
  const pct=Math.round(doneCount/Math.max(totalCards,1)*100);

  const avgCycle=useMemo(()=>{ const c=doneCards.filter(x=>x.inProgressAt&&x.completedAt); if(!c.length)return null; return Math.round(c.reduce((a,x)=>a+cycleHours(x.inProgressAt!,x.completedAt!),0)/c.length); },[doneCards]);
  const burndown=useMemo(()=>buildBurndown(columns),[columns]);

  const filteredCols=useMemo(()=>columns.map(col=>{
    let cards=col.cards.filter(c=>{
      if(filterPri!=="all"&&c.priority!==filterPri)return false;
      if(filterLabel!=="all"&&!c.labels.includes(filterLabel))return false;
      if(focusMe&&c.assigneeId!==me.id)return false;
      if(search&&!c.title.toLowerCase().includes(search.toLowerCase()))return false;
      return true;
    });
    if(sortByScore&&col.id==="todo")cards=[...cards].sort((a,b)=>(calcScore(b.valueScore,b.effortScore)??0)-(calcScore(a.valueScore,a.effortScore)??0));
    return{...col,cards};
  }),[columns,filterPri,filterLabel,focusMe,search,sortByScore,me.id]);

  const onDragStart=useCallback((e:React.DragEvent,cardId:string,colId:string)=>{setDragCardId(cardId);setDragColId(colId);e.dataTransfer.effectAllowed="move";},[]);
  const onDragOver=useCallback((e:React.DragEvent,colId:string)=>{e.preventDefault();e.dataTransfer.dropEffect="move";setDragOverColId(colId);},[]);
  const onDragLeave=useCallback(()=>setDragOverColId(null),[]);
  const onDrop=useCallback((e:React.DragEvent,targetColId:string)=>{
    e.preventDefault();setDragOverColId(null);
    if(!dragCardId||dragColId===targetColId){setDragCardId(null);setDragColId(null);return;}
    setColumns(prev=>{
      const next=prev.map(c=>({...c,cards:[...c.cards]}));
      const src=next.find(c=>c.id===dragColId),tgt=next.find(c=>c.id===targetColId);
      if(!src||!tgt)return prev;
      const idx=src.cards.findIndex(c=>c.id===dragCardId);if(idx===-1)return prev;
      const[card]=src.cards.splice(idx,1);
      const now=new Date().toISOString();
      if(targetColId==="inprogress"&&!card.inProgressAt)card.inProgressAt=now;
      if(targetColId==="done"&&!card.completedAt)card.completedAt=now;
      tgt.cards.push(card);return next;
    });
    setDragCardId(null);setDragColId(null);
  },[dragCardId,dragColId]);

  const handleCardSave=(card:KanbanCard,targetColId:string)=>{setColumns(prev=>{const next=prev.map(c=>({...c,cards:[...c.cards]}));next.forEach(col=>{col.cards=col.cards.filter(c=>c.id!==card.id);});next.find(c=>c.id===targetColId)?.cards.push(card);return next;});setCardModal(null);};
  const handleCardDelete=(cardId:string)=>{setColumns(prev=>prev.map(col=>({...col,cards:col.cards.filter(c=>c.id!==cardId)})));setCardModal(null);};
  const handleAddComment=async(cardId:string,colId:string,comment:Comment)=>{setColumns(prev=>prev.map(col=>col.id!==colId?col:{...col,cards:col.cards.map(c=>c.id!==cardId?c:{...c,commentList:[...(c.commentList??[]),comment]})}));if(!token)return;await fetch("/api/kanban?action=add-comment",{method:"POST",headers:{"Content-Type":"application/json","x-admin-token":token},body:JSON.stringify({cardId,colId,comment})}).then(r=>{if(!r.ok)setBoardError("A comment was not saved. Refresh before editing again.");}).catch(()=>setBoardError("A comment was not saved. Refresh before editing again."));};
  const handleDeleteComment=async(cardId:string,colId:string,commentId:string)=>{setColumns(prev=>prev.map(col=>col.id!==colId?col:{...col,cards:col.cards.map(c=>c.id!==cardId?c:{...c,commentList:(c.commentList??[]).filter(cm=>cm.id!==commentId)})}));if(!token)return;await fetch("/api/kanban?action=delete-comment",{method:"POST",headers:{"Content-Type":"application/json","x-admin-token":token},body:JSON.stringify({cardId,colId,commentId})}).then(r=>{if(!r.ok)setBoardError("A comment was not deleted. Refresh before editing again.");}).catch(()=>setBoardError("A comment was not deleted. Refresh before editing again."));};
  const handleMeetSave=(m:Meeting)=>{setMeetings(prev=>{const idx=prev.findIndex(x=>x.id===m.id);if(idx>=0){const n=[...prev];n[idx]=m;return n;}return[...prev,m];});setMeetModal(null);};
  const handleMeetDelete=(id:string)=>{setMeetings(prev=>prev.filter(m=>m.id!==id));setMeetModal(null);};

  const toolbar=(<div className="toolbar flex-nowrap overflow-x-auto bg-surface h-12 min-h-12 py-0 px-4 shrink-0">
    <span className="section-title">Board</span>
    <span className="badge badge-brand shrink-0">{totalCards}</span>
    <div className="w-px h-4.5 bg-line mx-0.5 shrink-0"/>
    <Tooltip text="Search cards by title"><div className="relative shrink-0"><SearchIcon/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" className="field field-sm pl-8 w-35"/></div></Tooltip>
    <Tooltip text="Filter cards by priority level"><Select value={filterPri} onChange={e=>setFilterPri(e.target.value as Priority|"all")} aria-label="Filter by priority" wrapperClassName="w-auto shrink-0" className="h-7 rounded-[7px] text-[12px] text-fg-3 pl-2.5 pr-2 gap-1.5"><option value="all">Priority</option>{(["critical","high","medium","low"] as Priority[]).map(p=><option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</Select></Tooltip>
    <Tooltip text="Filter cards by label type"><Select value={filterLabel} onChange={e=>setFilterLabel(e.target.value as LabelKey|"all")} aria-label="Filter by label" wrapperClassName="w-auto shrink-0" className="h-7 rounded-[7px] text-[12px] text-fg-3 pl-2.5 pr-2 gap-1.5"><option value="all">Label</option>{(Object.keys(LABEL_META) as LabelKey[]).map(l=><option key={l} value={l}>{LABEL_META[l].label}</option>)}</Select></Tooltip>
    <Tooltip text="Show only cards assigned to you across all columns"><button onClick={()=>setFocusMe(f=>!f)} className={`btn btn-sm btn-secondary shrink-0 ${focusMe?"btn-on":""}`}><Avatar name={me.name} color={me.color} size={16}/>{!isMobile&&"My Cards"}</button></Tooltip>
    <Tooltip text="Sort the To Do column by Priority Score (Value / Effort x 10). Highest value, lowest effort cards float to the top."><button onClick={()=>setSortByScore(s=>!s)} className={`btn btn-sm btn-secondary shrink-0 ${sortByScore?"btn-on":""}`}>Score Sort</button></Tooltip>
    {blockedCount>0&&<Tooltip text={`${blockedCount} card${blockedCount>1?"s are":" is"} currently blocked`}><span className="text-[12px] text-danger-fg font-semibold shrink-0 cursor-default">Blocked: {blockedCount}</span></Tooltip>}
    <div className="flex-1"/>
    {!isMobile&&avgCycle!==null&&<Tooltip text="Average cycle time - how long cards typically spend from In Progress to Done"><span className="text-[12px] text-fg-4 shrink-0 cursor-default">Avg cycle <b className="text-fg num">{avgCycle}h</b></span></Tooltip>}

    {!isMobile&&<Tooltip text="Toggle 7-day burndown chart - cards completed per day this sprint"><button onClick={()=>setShowBurndown(s=>!s)} className={`btn btn-sm btn-secondary shrink-0 ${showBurndown?"btn-on":""}`}>Burndown</button></Tooltip>}
    {!isMobile&&<Tooltip text="Launch fullscreen standup mode - shows your Done, In Progress, and Blocked cards for the daily standup"><button onClick={()=>setShowStandup(true)} className="btn btn-sm btn-secondary shrink-0">Standup</button></Tooltip>}
    <Tooltip text="Create a new card in the To Do column"><button onClick={()=>setCardModal({card:null,colId:columns[0]?.id??null,isNew:true})} className="btn btn-sm btn-primary shrink-0"><PlusIcon/>Card</button></Tooltip>
  </div>);

  const burndownBar=showBurndown&&!isMobile&&(<div className="bg-surface border-b border-line-soft px-4 py-2 flex items-center gap-4 shrink-0">
    <span className="label">7-Day Burndown</span>
    <BurndownChart data={burndown}/>
    <span className="text-[12px] text-fg-4">Completed: <b className="text-fg num">{burndown.reduce((a,d)=>a+d.completed,0)}</b></span>
    <button onClick={()=>setShowBurndown(false)} aria-label="Hide burndown" className="btn btn-ghost btn-sm btn-icon ml-auto"><XIcon/></button>
  </div>);

  const boardArea=(<div className={isMobile?"flex-1 flex flex-col gap-2 p-2.5 items-start min-w-0 overflow-x-hidden overflow-y-auto":"flex-1 flex gap-2.5 p-3.5 overflow-hidden items-stretch min-w-0"}>
    {filteredCols.map(col=>(
      <div key={col.id} className={isMobile?"w-full min-w-0":"flex flex-1 min-w-0"}>
        <Column col={col} dragOverColId={dragOverColId} draggingCardId={dragCardId} admins={admins} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={onDragLeave} onAddCard={colId=>setCardModal({card:null,colId,isNew:true})} onEditCard={(card,colId)=>setCardModal({card,colId,isNew:false})}/>
      </div>
    ))}
  </div>);

  const velocityBar=showVelocity&&!isMobile&&(<div className="h-10.5 bg-surface border-t border-line-soft flex items-center gap-4 px-4 shrink-0">
    <span className="label">Sprint Health</span>
    {[{dot:"bg-success",label:"Done",val:doneCount},{dot:"bg-warning",label:"In Progress",val:inProgCount},{dot:"bg-danger",label:"Blocked",val:blockedCount}].map(({dot,label,val})=>(
      <div key={label} className="flex items-center gap-1.5 text-[12px] text-fg-4"><div className={`w-2 h-2 rounded-sm ${dot}`}/>{label}:<b className={`num ${label==="Blocked"&&val>0?"text-danger-fg":"text-fg"}`}>{val}</b></div>
    ))}
    <div className="flex-1"/>
    <div className="flex items-center gap-2 text-[12px] text-fg-4">Completion<div className="w-20 h-1.25 bg-raised-2 rounded-full overflow-hidden"><div className="h-full bg-brand rounded-full transition-[width] duration-400" style={{width:`${pct}%`}}/></div><b className="text-fg num">{pct}%</b></div>
    <button onClick={()=>setShowVelocity(false)} aria-label="Hide sprint health" className="btn btn-ghost btn-sm btn-icon"><XIcon/></button>
  </div>);

  const modals=(<>
    {cardModal&&<CardModal card={cardModal.card} colId={cardModal.colId} columns={columns} isNew={cardModal.isNew} me={me} admins={admins} onClose={()=>setCardModal(null)} onSave={handleCardSave} onDelete={handleCardDelete} onAddComment={handleAddComment} onDeleteComment={handleDeleteComment}/>}
    {meetModal&&<MeetingModal meeting={meetModal.meeting} defaultDate={meetModal.defaultDate} integrations={integrations} admins={admins} onClose={()=>setMeetModal(null)} onSave={handleMeetSave} onDelete={handleMeetDelete}/>}
    {showStandup&&<StandupMode columns={columns} admins={admins} me={me} onClose={()=>setShowStandup(false)}/>}
  </>);

  if(isMobile)return(<div className="flex flex-col h-full overflow-hidden bg-canvas">
    {toolbar}
    <div className="flex-1 overflow-hidden flex flex-col">
      {mobileTab==="board"&&<div className="flex-1 overflow-y-auto bg-canvas">{boardArea}</div>}
      {mobileTab==="calendar"&&<CalendarPanel cards={allCards} meetings={meetings} admins={admins} calMonth={calMonth} setCalMonth={setCalMonth} calSelected={calSelected} setCalSelected={setCalSelected} onSchedule={d=>setMeetModal({meeting:null,defaultDate:d})} onEditMeeting={m=>setMeetModal({meeting:m})} compact/>}
      {mobileTab==="meetings"&&<MeetingsPanel meetings={meetings} admins={admins} onSchedule={d=>setMeetModal({meeting:null,defaultDate:d})} onEdit={m=>setMeetModal({meeting:m})}/>}
      {mobileTab==="standup"&&<div className="flex-1 flex items-center justify-center bg-canvas"><button onClick={()=>setShowStandup(true)} className="btn btn-primary btn-lg">Standup Mode</button></div>}
    </div>
    <div className="h-14 bg-surface border-t border-line flex items-stretch shrink-0">
      {([{id:"board" as MobileTab,label:"Board",icon:"▦"},{id:"calendar" as MobileTab,label:"Calendar",icon:"📅"},{id:"meetings" as MobileTab,label:"Meetings",icon:"📹"},{id:"standup" as MobileTab,label:"Standup",icon:"🏃"}]).map(t=>(
        <button key={t.id} onClick={()=>setMobileTab(t.id)} className={`flex-1 flex flex-col items-center justify-center gap-0.5 bg-transparent border-0 cursor-pointer transition-colors ${mobileTab===t.id?"text-brand-fg":"text-fg-4"}`}>
          <span className="text-[18px]">{t.icon}</span><span className={`text-[11px] ${mobileTab===t.id?"font-semibold":"font-medium"}`}>{t.label}</span>
        </button>
      ))}
    </div>
    {modals}
  </div>);

  return(<div className="flex w-full h-full overflow-hidden flex-1 bg-canvas">
    {boardError&&<div role="alert" className="popover fixed top-3 left-1/2 -translate-x-1/2 z-900 px-3.5 py-2 rounded-lg! border-danger-line text-danger-fg text-[12px] font-semibold">{boardLoaded?boardError:`The board could not be loaded (${boardError}). Changes will not be saved until you refresh.`}</div>}
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas min-w-0 min-h-0">
      {toolbar}{burndownBar}{boardArea}{velocityBar}
    </div>
    <CalendarPanel cards={allCards} meetings={meetings} admins={admins} calMonth={calMonth} setCalMonth={setCalMonth} calSelected={calSelected} setCalSelected={setCalSelected} onSchedule={d=>setMeetModal({meeting:null,defaultDate:d})} onEditMeeting={m=>setMeetModal({meeting:m})}/>
    {modals}
  </div>);
}
