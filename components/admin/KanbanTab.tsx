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

import { useState, useCallback, useEffect, useMemo } from "react";
import { getAdminToken } from "@/lib/supabase/client";

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function getMsToken()   { return typeof window==="undefined"?null:localStorage.getItem("ms_access_token"); }
// Supabase access token of the signed-in admin (kept current by app/page.tsx)
function getAuthToken() { return getAdminToken()||null; }

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
const FALLBACK_ME:Employee={ id:"",name:"Admin",role:"Admin",color:"#4F6FF0",email:"" };
const empById=(list:Employee[],id?:string)=>list.find(e=>e.id===id);

// ─── Constants ────────────────────────────────────────────────────────────────
const PRIORITY_META:Record<Priority,{label:string;color:string;bg:string}>={
  critical:{label:"Critical",color:"#DC2626",bg:"#FEF2F2"},
  high:    {label:"High",    color:"#EA580C",bg:"#FFF7ED"},
  medium:  {label:"Medium",  color:"#D97706",bg:"#FFFBEB"},
  low:     {label:"Low",     color:"#059669",bg:"#F0FDF4"},
};
const LABEL_META:Record<LabelKey,{label:string;color:string;bg:string}>={
  bug:     {label:"Bug",     color:"#DC2626",bg:"#FEF2F2"},
  feature: {label:"Feature", color:"#4F6FF0",bg:"#EEF2FF"},
  design:  {label:"Design",  color:"#7C3AED",bg:"#F5F3FF"},
  infra:   {label:"Infra",   color:"#0891B2",bg:"#ECFEFF"},
  docs:    {label:"Docs",    color:"#059669",bg:"#F0FDF4"},
  research:{label:"Research",color:"#9333EA",bg:"#FAF5FF"},
};
const PLATFORM_META:Record<MeetPlatform,{label:string;color:string;bg:string;btnBg:string}>={
  teams:{label:"Teams",      color:"#5558AF",bg:"#EEEEFF",btnBg:"#5558AF"},
  meet: {label:"Google Meet",color:"#1B5E20",bg:"#E8F5E9",btnBg:"#34A853"},
  zoom: {label:"Zoom",       color:"#0D47A1",bg:"#E3F2FD",btnBg:"#2D8CFF"},
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
const SEED_MEETINGS:Meeting[]=[
  {id:"m1",title:"Sprint Planning",date:NOW_ISO,startTime:"09:00",endTime:"10:00",platform:"teams",joinUrl:"https://teams.microsoft.com/l/meetup-join/placeholder",attendeeIds:["emp-yash","emp-maya","emp-jordan"],description:"Plan sprint 14.",createdAt:"Jun 1 · 9:00 AM",status:"confirmed"},
  {id:"m2",title:"Design Review",date:mkDate(1),startTime:"10:00",endTime:"10:30",platform:"meet",joinUrl:"https://meet.google.com/placeholder",attendeeIds:["emp-maya","emp-tom"],description:"Review usage tab UI.",createdAt:"Jun 1 · 9:05 AM",status:"confirmed"},
  {id:"m3",title:"Stakeholder Demo",date:mkDate(2),startTime:"14:00",endTime:"15:00",platform:"zoom",joinUrl:"https://zoom.us/j/placeholder",attendeeIds:["emp-yash","emp-maya","emp-jordan","emp-alex","emp-sam","emp-priya","emp-tom"],description:"Q2 product demo.",createdAt:"Jun 2 · 2:00 PM",status:"confirmed"},
];

const DEFAULT_COLUMNS:KanbanColumn[]=[
  {id:"todo",title:"To Do",color:"#6366F1",desc:"Ready to be picked up",cards:[
    {id:"k1",title:"CSV export for analytics tabs",priority:"medium",labels:["feature"],story:"As an admin, I want to export data for offline analysis.",assigneeId:"emp-yash",dueDate:mkDate(12),effortScore:3,valueScore:7,blockedBy:null,subtasks:[{done:false,label:"API endpoint"},{done:false,label:"UI button"},{done:false,label:"Tests"}],commentList:[{id:"c1",author:"Maya Patel",authorColor:"#7C4FE0",text:"Should we support XLSX?",createdAt:"Jun 3 · 10:12 AM"},{id:"c2",author:"Yash D.",authorColor:"#4F6FF0",text:"Good call, adding to scope.",createdAt:"Jun 3 · 11:05 AM"}],links:[{id:"l1",label:"Figma mockup",url:"https://figma.com"}]},
    {id:"k2",title:"Stripe webhook retry logic",priority:"high",labels:["infra","feature"],assigneeId:"emp-alex",dueDate:mkDate(4),effortScore:5,valueScore:8,blockedBy:null,subtasks:[{done:false,label:"Exponential backoff"},{done:false,label:"Dead-letter queue"}],commentList:[],links:[{id:"l2",label:"Stripe docs",url:"https://stripe.com/docs/webhooks"}]},
  ]},
  {id:"inprogress",title:"In Progress",color:"#F59E0B",limit:4,desc:"WIP - actively being worked on",cards:[
    {id:"k4",title:"OpenAI usage pagination fix",priority:"critical",labels:["bug","infra"],story:"As an admin, I want accurate usage data so billing is correct.",assigneeId:"emp-yash",dueDate:NOW_ISO,effortScore:3,valueScore:10,blockedBy:null,inProgressAt:new Date(Date.now()-172800000).toISOString(),subtasks:[{done:true,label:"Debug root cause"},{done:true,label:"Implement fix"},{done:false,label:"Verify in prod"}],commentList:[{id:"c3",author:"Sam Lee",authorColor:"#0891B2",text:"Verified on staging.",createdAt:"Jun 5 · 2:45 PM"}],links:[{id:"l3",label:"OpenAI API docs",url:"https://platform.openai.com/docs/api-reference"}]},
    {id:"k5",title:"Cloudflare analytics stream",priority:"high",labels:["infra"],assigneeId:"emp-jordan",dueDate:mkDate(-2),effortScore:7,valueScore:8,blockedBy:"Waiting for Cloudflare Enterprise plan",inProgressAt:new Date(Date.now()-259200000).toISOString(),subtasks:[{done:true,label:"Schema research"},{done:false,label:"Stream integration"}],commentList:[],links:[]},
  ]},
  {id:"review",title:"In Review",color:"#7C4FE0",limit:5,desc:"PR open / QA in progress",cards:[
    {id:"k6",title:"Claude token pricing — cache reads at 10%",priority:"critical",labels:["bug"],assigneeId:"emp-yash",dueDate:NOW_ISO,effortScore:2,valueScore:10,blockedBy:null,inProgressAt:new Date(Date.now()-86400000).toISOString(),subtasks:[{done:true,label:"Fix pricing logic"},{done:true,label:"Unit tests"},{done:false,label:"PR review"}],commentList:[{id:"c6",author:"Priya Singh",authorColor:"#9333EA",text:"Left 2 inline comments.",createdAt:"Jun 6 · 10:00 AM"}],links:[{id:"l4",label:"PR #247",url:"https://github.com"}]},
  ]},
  {id:"done",title:"Done",color:"#10B981",desc:"Completed & shipped",cards:[
    {id:"k8",title:"Login page light mode redesign",priority:"medium",labels:["design"],assigneeId:"emp-yash",effortScore:3,valueScore:7,blockedBy:null,inProgressAt:new Date(Date.now()-604800000).toISOString(),completedAt:new Date(Date.now()-432000000).toISOString(),actualHours:18,subtasks:[{done:true,label:"Layout"},{done:true,label:"Branding"},{done:true,label:"Mobile"}],commentList:[{id:"c7",author:"Maya Patel",authorColor:"#7C4FE0",text:"Shipped to prod!",createdAt:"Jun 2 · 4:00 PM"}],links:[]},
    {id:"k9",title:"Firestore composite index fix",priority:"high",labels:["bug","infra"],assigneeId:"emp-yash",effortScore:2,valueScore:9,blockedBy:null,inProgressAt:new Date(Date.now()-518400000).toISOString(),completedAt:new Date(Date.now()-345600000).toISOString(),actualHours:6,subtasks:[],commentList:[],links:[]},
  ]},
];

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({name,color,size=22}:{name:string;color?:string;size?:number}){
  return(<div style={{width:size,height:size,borderRadius:"50%",background:color??"#4F6FF0",color:"#fff",fontSize:size*0.36,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,userSelect:"none",border:"1px solid #1a1a1a"}}>{initials(name)}</div>);
}

function AttendeeStack({ids,max=3,admins}:{ids:string[];max?:number;admins:Employee[]}){
  const shown=ids.slice(0,max),extra=ids.length-max;
  return(<div style={{display:"flex",alignItems:"center"}}>{shown.map((id,i)=>{const e=empById(admins,id);if(!e)return null;return(<div key={id} style={{marginLeft:i>0?-6:0,zIndex:shown.length-i}}><Avatar name={e.name} color={e.color} size={20}/></div>);})}{extra>0&&<span style={{marginLeft:4,fontSize:9.5,fontWeight:700,color:"#94A3B8"}}>+{extra}</span>}</div>);
}


// ─── Tooltip ──────────────────────────────────────────────────────────────────
function Tooltip({text,children}:{text:string;children:React.ReactNode}){
  const [show,setShow]=useState(false);
  return(
    // flexShrink:0 — otherwise wrapped toolbar controls squash and overlap instead of scrolling
    <div style={{position:"relative",display:"inline-flex",flexShrink:0}}
      onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
      {children}
      {show&&(
        <div style={{position:"absolute",bottom:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)",
          background:"#0F172A",color:"#F8FAFC",fontSize:11,fontWeight:500,lineHeight:1.4,
          padding:"5px 9px",borderRadius:7,zIndex:9999,
          boxShadow:"0 4px 12px rgba(0,0,0,0.25)",pointerEvents:"none",
          maxWidth:220,textAlign:"center",whiteSpace:"normal" as "normal"}}>
          {text}
          <div style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",
            width:0,height:0,borderLeft:"5px solid transparent",borderRight:"5px solid transparent",
            borderTop:"5px solid #0F172A"}}/>
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
  return(<svg width={W} height={H} style={{overflow:"visible"}}><path d={path} fill="none" stroke="#4F6FF0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>{pts.map((p,i)=>p.n>0&&(<g key={i}><circle cx={p.x} cy={p.y} r={3} fill="#4F6FF0"/><text x={p.x} y={p.y-6} textAnchor="middle" fontSize={9} fill="#6B7280">{p.n}</text></g>))}</svg>);
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
  return(<div style={{background:"rgba(79,111,240,0.08)",border:"1.5px solid rgba(79,111,240,0.2)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:loading||error?8:0}}>
      <span style={{fontSize:16}}>🤖</span><span style={{fontSize:12.5,fontWeight:700,color:"#4F6FF0"}}>AI Assistant</span>
      <div style={{flex:1}}/><button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#555",fontSize:14}}>✕</button>
    </div>
    {loading&&<div style={{fontSize:11.5,color:"#555",display:"flex",alignItems:"center",gap:6}}><div style={{width:12,height:12,border:"2px solid rgba(79,111,240,0.3)",borderTopColor:"#4F6FF0",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>Analyzing card…</div>}
    {error&&<div style={{fontSize:11.5,color:"#f44"}}>{error}</div>}
  </div>);
}

// ─── Standup Mode ─────────────────────────────────────────────────────────────
function StandupMode({columns,admins,me,onClose}:{columns:KanbanColumn[];admins:Employee[];me:Employee;onClose:()=>void}){
  const myCards=columns.flatMap(col=>col.cards.filter(c=>c.assigneeId===me.id).map(c=>({...c,colTitle:col.title,colId:col.id})));
  const inProgress=myCards.filter(c=>c.colId==="inprogress");
  const done=myCards.filter(c=>c.colId==="done");
  const blocked=myCards.filter(c=>c.blockedBy);
  return(<div style={{position:"fixed",inset:0,background:"#0F172A",zIndex:2000,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:40}}>
    <div style={{maxWidth:700,width:"100%"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:40}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>Daily Standup</div>
          <div style={{fontSize:32,fontWeight:800,color:"#F8FAFC",letterSpacing:-1}}>{today.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <Avatar name={me.name} color={me.color} size={44}/>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:"#94A3B8",padding:"8px 16px",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600}}>Exit</button>
        </div>
      </div>
      {([{emoji:"✅",label:"Done since last standup",cards:done,color:"#10B981"},{emoji:"🔨",label:"Working on today",cards:inProgress,color:"#F59E0B"},{emoji:"🚫",label:"Blocked",cards:blocked,color:"#EF4444"}]).map(({emoji,label,cards,color})=>(
        <div key={label} style={{marginBottom:28}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <span style={{fontSize:20}}>{emoji}</span>
            <span style={{fontSize:14,fontWeight:700,color:"#CBD5E1"}}>{label}</span>
            <div style={{flex:1,height:1,background:"rgba(255,255,255,0.06)"}}/>
            <span style={{fontSize:12,fontWeight:600,color,background:"rgba(255,255,255,0.06)",padding:"2px 8px",borderRadius:99}}>{cards.length}</span>
          </div>
          {cards.length===0?<div style={{fontSize:13,color:"#475569",fontStyle:"italic",paddingLeft:30}}>Nothing to report</div>
          :cards.map(c=><div key={c.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 14px 10px 30px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,marginBottom:6}}>
            <div style={{flex:1}}><div style={{fontSize:13.5,fontWeight:600,color:"#F1F5F9"}}>{c.title}</div>{c.blockedBy&&<div style={{fontSize:11.5,color:"#EF4444",marginTop:3}}>🚫 {c.blockedBy}</div>}</div>
            <span style={{fontSize:10,fontWeight:700,color,background:`${color}22`,padding:"2px 7px",borderRadius:99,flexShrink:0}}>{c.colTitle}</span>
          </div>)}
        </div>
      ))}
    </div>
  </div>);
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
  const fi:React.CSSProperties={display:"block",width:"100%",border:"1.5px solid #2a2a2a",borderRadius:8,padding:"7px 10px",fontSize:12.5,fontFamily:"inherit",outline:"none",color:"#ededed",background:"#0a0a0a"};
  const fl:React.CSSProperties={fontSize:10,fontWeight:700,color:"#555",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:5};
  if(created)return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(3px)"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#0a0a0a",border:"1px solid #1a1a1a",borderRadius:14,width:460,maxWidth:"94vw",padding:"28px 28px 24px",boxShadow:"0 24px 60px rgba(0,0,0,0.6)",textAlign:"center"}}>
      <div style={{width:52,height:52,borderRadius:"50%",background:"rgba(62,207,142,0.1)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontSize:26}}>+</div>
      <div style={{fontSize:16,fontWeight:700,color:"#ededed",marginBottom:4}}>Meeting Created</div>
      <div style={{fontSize:13,color:"#555",marginBottom:20}}>{created.title} - {created.startTime}-{created.endTime}</div>
      <a href={created.joinUrl} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:8,padding:"10px 22px",borderRadius:9,background:pm.btnBg,color:"#fff",fontSize:13,fontWeight:700,textDecoration:"none",marginBottom:18}}><PlatformIcon p={created.platform} size={15}/>Join {pm.label} →</a>
      <div style={{marginBottom:20}}><div style={{fontSize:10,fontWeight:700,color:"#444",textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:6}}>Join URL</div><div style={{fontSize:11,color:"#4F6FF0",wordBreak:"break-all",padding:"8px 12px",background:"rgba(79,111,240,0.08)",borderRadius:7,userSelect:"all"}}>{created.joinUrl}</div></div>
      <button onClick={()=>onSave(created)} style={{padding:"8px 22px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#4F6FF0,#7C4FE0)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Save to Calendar</button>
    </div>
  </div>);
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(3px)"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#0a0a0a",border:"1px solid #1a1a1a",borderRadius:14,width:540,maxWidth:"94vw",maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 24px 60px rgba(0,0,0,0.6)"}}>
      <div style={{padding:"18px 22px 14px",borderBottom:"1px solid #1a1a1a",flexShrink:0}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><div style={{fontSize:14,fontWeight:700,color:"#ededed"}}>{isNew?"Schedule Meeting":"Edit Meeting"}</div><button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#555",fontSize:18,lineHeight:1}}>x</button></div></div>
      <div style={{flex:1,overflowY:"auto",padding:"18px 22px"}}>
        <div style={{marginBottom:13}}><label style={fl}>Meeting Title *</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Sprint Planning" style={fi}/></div>
        <div style={{marginBottom:13}}><label style={fl}>Platform</label>
          <div style={{display:"flex",gap:8}}>{(["teams","meet","zoom"] as MeetPlatform[]).map(p=>{const meta=PLATFORM_META[p],active=platform===p,conn=p==="teams"?integrations.teams:p==="meet"?integrations.google:integrations.zoom;return(<button key={p} onClick={()=>setPlatform(p)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5,padding:"10px 0",borderRadius:10,cursor:"pointer",border:active?`2px solid ${meta.color}`:"1.5px solid #2a2a2a",background:active?meta.bg:"#111",fontWeight:600,fontSize:11.5,color:active?meta.color:"#555"}}><PlatformIcon p={p} size={18}/>{meta.label}<span style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:99,background:conn?"rgba(62,207,142,0.12)":"#1a1a1a",color:conn?"#3ecf8e":"#444"}}>{conn?"Connected":"Not connected"}</span></button>);})}
          </div>
        </div>
        {!isConnected&&<div style={{background:"rgba(245,166,35,0.06)",border:"1.5px solid rgba(245,166,35,0.2)",borderRadius:10,padding:"14px 16px",marginBottom:13}}>
          <div style={{fontSize:12.5,fontWeight:700,color:"#f5a623",marginBottom:8}}>Connect your {pm.label} account first</div>
          <div style={{fontSize:11.5,color:"#f5a623",lineHeight:1.5,marginBottom:12}}>{platform==="teams"&&"Sign in via the Outlook tab first."}{platform==="meet"&&"Authorize Preciprocal to create Google Calendar events with Meet links."}{platform==="zoom"&&"Authorize Preciprocal to create Zoom meetings on your behalf."}</div>
          {platform!=="teams"&&<a href={`/api/auth/${platform==="meet"?"google":"zoom"}`} style={{display:"inline-flex",alignItems:"center",gap:7,padding:"8px 18px",borderRadius:8,background:pm.btnBg,color:"#fff",fontSize:12.5,fontWeight:700,textDecoration:"none"}}><PlatformIcon p={platform} size={14}/>Connect {pm.label} →</a>}
        </div>}
        {isConnected&&<>
          <div style={{display:"flex",gap:10,marginBottom:13}}>
            <div style={{flex:2}}><label style={fl}>Date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={fi}/></div>
            <div style={{flex:1}}><label style={fl}>Start</label><input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} style={fi}/></div>
            <div style={{flex:1}}><label style={fl}>End</label><input type="time" value={endTime} onChange={e=>setEndTime(e.target.value)} style={fi}/></div>
          </div>
          <div style={{marginBottom:13}}><label style={fl}>Description</label><textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={2} placeholder="Agenda…" style={{...fi,resize:"vertical" as const}}/></div>
          <div style={{marginBottom:13}}><label style={fl}>Invite Attendees</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:7}}>{admins.map(emp=>{const active=attendees.includes(emp.id);return(<button key={emp.id} onClick={()=>toggleAttendee(emp.id)} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 10px",borderRadius:8,border:active?"1.5px solid #4F6FF0":"1.5px solid #2a2a2a",background:active?"rgba(79,111,240,0.12)":"#111",cursor:"pointer"}}><Avatar name={emp.name} color={emp.color} size={22}/><div><div style={{fontSize:11.5,fontWeight:600,color:active?"#4F6FF0":"#888"}}>{emp.name}</div><div style={{fontSize:10,color:"#444"}}>{emp.role}</div></div>{active&&<span style={{fontSize:12,color:"#4F6FF0"}}>✓</span>}</button>);})}</div>
          </div>
          <div style={{background:pm.bg,border:`1.5px solid ${pm.color}33`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}><PlatformIcon p={platform} size={16}/><div style={{flex:1,fontSize:11.5,color:"#555"}}>{platform==="teams"&&"Meeting created via Microsoft Graph · Calendar invites sent"}{platform==="meet"&&"Event created in Google Calendar · Meet link auto-generated"}{platform==="zoom"&&"Zoom meeting created · Unique join URL generated"}</div><a href={platform!=="teams"?`/api/auth/${platform==="meet"?"google":"zoom"}`:"#"} style={{fontSize:10,color:pm.color,textDecoration:"none",fontWeight:600,flexShrink:0}}>Reconnect</a></div>
          {error&&<div style={{marginTop:10,fontSize:11.5,color:"#f44",background:"rgba(255,68,68,0.06)",border:"1px solid rgba(255,68,68,0.2)",borderRadius:7,padding:"8px 10px",lineHeight:1.5}}>{error}</div>}
        </>}
      </div>
      <div style={{padding:"12px 22px 16px",borderTop:"1px solid #1a1a1a",display:"flex",gap:8,justifyContent:"flex-end",flexShrink:0}}>
        {!isNew&&meeting&&<button onClick={()=>onDelete(meeting.id)} style={{padding:"7px 13px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",border:"1.5px solid rgba(255,68,68,0.2)",background:"rgba(255,68,68,0.06)",color:"#f44",marginRight:"auto"}}>Delete</button>}
        <button onClick={onClose} style={{padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",border:"1.5px solid #2a2a2a",background:"#111",color:"#555"}}>Cancel</button>
        {isConnected&&<button onClick={createMeeting} disabled={!title.trim()||loading} style={{padding:"7px 18px",borderRadius:8,fontSize:12,fontWeight:700,cursor:(!title.trim()||loading)?"not-allowed":"pointer",border:"none",background:(!title.trim()||loading)?"rgba(79,111,240,0.3)":"linear-gradient(135deg,#4F6FF0,#7C4FE0)",color:"#fff",display:"flex",alignItems:"center",gap:7}}><PlatformIcon p={platform} size={13}/>{loading?"Creating...":"Create Meeting"}</button>}
      </div>
    </div>
  </div>);
}

// ─── Calendar Panel ───────────────────────────────────────────────────────────
function CalendarPanel({cards,meetings,admins,calMonth,setCalMonth,calSelected,setCalSelected,onSchedule,onEditMeeting,compact=false}:{cards:KanbanCard[];meetings:Meeting[];admins:Employee[];calMonth:Date;setCalMonth:(d:Date)=>void;calSelected:string;setCalSelected:(s:string)=>void;onSchedule:(date:string)=>void;onEditMeeting:(m:Meeting)=>void;compact?:boolean;}){
  const monthLabel=calMonth.toLocaleDateString("en-US",{month:"long",year:"numeric"});
  const days=calDays(calMonth);
  const eventDates=new Set<string>([...meetings.map(m=>m.date),...cards.filter(c=>c.dueDate).map(c=>c.dueDate!)]);
  const selMeetings=meetings.filter(m=>m.date===calSelected).sort((a,b)=>a.startTime.localeCompare(b.startTime));
  const dueTiles=cards.filter(c=>c.dueDate===calSelected);
  const selLabel=new Date(calSelected).toLocaleDateString("en-US",{weekday:"short",month:"long",day:"numeric"});
  const navBtn:React.CSSProperties={background:"none",border:"1px solid #2a2a2a",borderRadius:6,width:24,height:24,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#555",fontSize:13};
  return(<div style={{display:"flex",flexDirection:"column",overflow:"hidden",...(compact?{flex:1}:{width:268,minWidth:268,maxWidth:268,flexShrink:0,borderLeft:"1px solid #1a1a1a",alignSelf:"stretch"}),background:"#0a0a0a"}}>
    <div style={{padding:"14px 14px 10px",borderBottom:"1px solid #1a1a1a",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div><div style={{fontSize:14,fontWeight:700,color:"#ededed",letterSpacing:-0.3}}>Calendar</div><div style={{fontSize:11,color:"#444",marginTop:1}}>{selLabel}</div></div>
        <button onClick={()=>onSchedule(calSelected)} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 10px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#4F6FF0,#7C4FE0)",color:"#fff",fontSize:11.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ Meet</button>
      </div>
    </div>
    <div style={{padding:"12px 12px 8px",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <span style={{fontSize:12.5,fontWeight:700,color:"#ededed"}}>{monthLabel}</span>
        <div style={{display:"flex",gap:4}}><button style={navBtn} onClick={()=>setCalMonth(new Date(calMonth.getFullYear(),calMonth.getMonth()-1,1))}>&#8249;</button><button style={navBtn} onClick={()=>setCalMonth(new Date(calMonth.getFullYear(),calMonth.getMonth()+1,1))}>&#8250;</button></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1}}>
        {["Mo","Tu","We","Th","Fr","Sa","Su"].map(d=><div key={d} style={{fontSize:9,fontWeight:700,color:"#444",textAlign:"center",padding:"2px 0",textTransform:"uppercase"}}>{d}</div>)}
        {days.map(({date,day,cur})=>{const isT=date===NOW_ISO,isSel=date===calSelected&&!isT,hasEv=eventDates.has(date);return(<div key={date} onClick={()=>setCalSelected(date)} style={{aspectRatio:"1",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,borderRadius:6,cursor:"pointer",position:"relative",fontWeight:isT?700:500,color:!cur?"#333":isT?"#fff":isSel?"#4F6FF0":"#888",background:isT?"linear-gradient(135deg,#4F6FF0,#7C4FE0)":isSel?"rgba(79,111,240,0.15)":"transparent"}}>{day}{hasEv&&<div style={{position:"absolute",bottom:2,left:"50%",transform:"translateX(-50%)",width:3,height:3,borderRadius:"50%",background:isT?"#fff":"#4F6FF0"}}/>}</div>);})}</div>
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"0 12px 12px"}}>
      {selMeetings.length===0&&dueTiles.length===0&&<div style={{padding:16,textAlign:"center",fontSize:11,color:"#444"}}>Nothing scheduled.<br/><button onClick={()=>onSchedule(calSelected)} style={{marginTop:8,fontSize:11,fontWeight:600,color:"#4F6FF0",background:"none",border:"none",cursor:"pointer"}}>+ Schedule a meeting</button></div>}
      {selMeetings.length>0&&<div style={{marginBottom:10}}><div style={{fontSize:10,fontWeight:700,color:"#444",textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:6,paddingTop:4}}>Meetings</div>
        {selMeetings.map(m=>{const pm=PLATFORM_META[m.platform];return(<div key={m.id} style={{background:"#111",border:"1px solid #1a1a1a",borderRadius:10,padding:"10px 11px",marginBottom:7,cursor:"pointer"}} onClick={()=>onEditMeeting(m)}>
          <div style={{display:"flex",alignItems:"flex-start",gap:8}}><div style={{width:32,height:32,borderRadius:8,background:pm.bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><PlatformIcon p={m.platform} size={16}/></div>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:"#ededed",marginBottom:2}}>{m.title}</div><div style={{fontSize:10.5,color:"#555",marginBottom:6}}>{m.startTime} - {m.endTime}</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><AttendeeStack ids={m.attendeeIds} admins={admins}/><a href={m.joinUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 9px",borderRadius:6,fontSize:11,fontWeight:700,textDecoration:"none",background:pm.btnBg,color:"#fff"}}>Join →</a></div>
            </div>
          </div>
        </div>);})}</div>}
      {dueTiles.length>0&&<div><div style={{fontSize:10,fontWeight:700,color:"#444",textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:6,paddingTop:4}}>Due Tasks</div>
        {dueTiles.map(c=>{const emp=empById(admins,c.assigneeId);return(<div key={c.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 9px",background:"#111",borderRadius:8,marginBottom:5}}><div style={{width:28,height:28,borderRadius:7,background:"#1a1a1a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#555",flexShrink:0}}>DUE</div><div style={{flex:1,minWidth:0}}><div style={{fontSize:11.5,fontWeight:600,color:"#ededed",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.title}</div><div style={{fontSize:10,color:"#444",marginTop:1}}>Due today{emp?` - ${emp.name}`:""}</div></div></div>);})}</div>}
    </div>
  </div>);
}

// ─── Meetings Panel (mobile) ──────────────────────────────────────────────────
function MeetingsPanel({meetings,admins,onSchedule,onEdit}:{meetings:Meeting[];admins:Employee[];onSchedule:(d:string)=>void;onEdit:(m:Meeting)=>void;}){
  const sorted=[...meetings].sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime));
  return(<div style={{flex:1,overflowY:"auto",padding:14,background:"#000"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}><span style={{fontSize:14,fontWeight:700,color:"#ededed"}}>All Meetings</span><button onClick={()=>onSchedule(NOW_ISO)} style={{padding:"6px 12px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#4F6FF0,#7C4FE0)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Schedule</button></div>
    {sorted.map(m=>{const pm=PLATFORM_META[m.platform];const dl=new Date(m.date).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});return(<div key={m.id} style={{background:"#111",border:"1px solid #1a1a1a",borderRadius:12,padding:"12px 14px",marginBottom:10,cursor:"pointer"}} onClick={()=>onEdit(m)}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}><div style={{width:36,height:36,borderRadius:9,background:pm.bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><PlatformIcon p={m.platform} size={18}/></div><div style={{flex:1}}><div style={{fontSize:13,fontWeight:700,color:"#ededed"}}>{m.title}</div><div style={{fontSize:11,color:"#555"}}>{dl} - {m.startTime}-{m.endTime}</div></div><a href={m.joinUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{padding:"5px 12px",borderRadius:7,fontSize:12,fontWeight:700,textDecoration:"none",background:pm.btnBg,color:"#fff",flexShrink:0}}>Join</a></div>
      <AttendeeStack ids={m.attendeeIds} max={7} admins={admins}/>
    </div>);})}
  </div>);
}

// ─── Card Tile ────────────────────────────────────────────────────────────────
function KanbanCardTile({card,colId,isDragging,admins,onDragStart,onClick}:{card:KanbanCard;colId:string;isDragging:boolean;admins:Employee[];onDragStart:(e:React.DragEvent,cardId:string,colId:string)=>void;onClick:(card:KanbanCard,colId:string)=>void;}){
  const emp=empById(admins,card.assigneeId);
  const pm=PRIORITY_META[card.priority];
  const doneSubs=card.subtasks?.filter(s=>s.done).length??0;
  const totalSubs=card.subtasks?.length??0;
  const progress=totalSubs?doneSubs/totalSubs:0;
  const score=calcScore(card.valueScore,card.effortScore);
  const scoreColor=score!==null?(score>=15?"#3ecf8e":score>=8?"#f5a623":"#f44"):"#555";
  const due=card.dueDate?formatDue(card.dueDate):null;
  const commentCount=card.commentList?.length??0;
  const linkCount=card.links?.length??0;
  const cycleTime=card.inProgressAt&&card.completedAt?cycleHours(card.inProgressAt,card.completedAt):card.inProgressAt?cycleHours(card.inProgressAt,new Date().toISOString()):null;
  return(<div draggable onDragStart={e=>onDragStart(e,card.id,colId)} onClick={()=>onClick(card,colId)}
    style={{background:card.lockedBy?"rgba(245,166,35,0.06)":"#111",border:`1px solid ${card.lockedBy?"rgba(245,166,35,0.3)":"#1a1a1a"}`,borderRadius:10,padding:"11px 12px",cursor:card.lockedBy?"default":"grab",opacity:isDragging?0.35:1,userSelect:"none",transition:"box-shadow 0.15s,transform 0.15s"}}
    onMouseEnter={e=>{if(!card.lockedBy){const el=e.currentTarget as HTMLElement;el.style.boxShadow="0 4px 14px rgba(79,111,240,0.1)";el.style.transform="translateY(-1px)";}}}
    onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.boxShadow="none";el.style.transform="none";}}>
    {card.lockedBy&&<div style={{fontSize:10,color:"#D97706",fontWeight:600,marginBottom:5}}>🔒 {card.lockedBy} is editing</div>}
    {card.labels.length>0&&<div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:7}}>{card.labels.map(l=>{const lm=LABEL_META[l];return<span key={l} style={{fontSize:9.5,fontWeight:700,padding:"2px 5px",borderRadius:4,color:lm.color,background:lm.bg}}>{lm.label}</span>;})}</div>}
    {card.blockedBy&&<div style={{background:"rgba(255,68,68,0.08)",borderLeft:"3px solid #f44",borderRadius:"0 4px 4px 0",padding:"3px 7px",fontSize:10,color:"#f44",fontWeight:600,marginBottom:6}}>Blocked: {card.blockedBy}</div>}
    <div style={{fontSize:12.5,fontWeight:600,color:"#ededed",lineHeight:1.4,marginBottom:card.story?4:6}}>{card.title}</div>
    {card.story&&<div style={{fontSize:10.5,color:"#555",fontStyle:"italic",marginBottom:7,paddingLeft:8,borderLeft:"2px solid #2a2a2a",lineHeight:1.5}}>{card.story.length>70?card.story.slice(0,70)+"...":card.story}</div>}
    {linkCount>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:7}}>{card.links!.map(lk=><a key={lk.id} href={lk.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:9.5,fontWeight:600,color:"#4F6FF0",background:"#EEF2FF",padding:"2px 6px",borderRadius:4,textDecoration:"none"}}>🔗 {lk.label}</a>)}</div>}
    {totalSubs>0&&<div style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:9.5,color:"#555",fontWeight:500}}>{doneSubs}/{totalSubs} tasks</span><span style={{fontSize:9.5,fontWeight:700,color:progress===1?"#3ecf8e":"#555"}}>{Math.round(progress*100)}%</span></div><div style={{height:3,background:"#1a1a1a",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",width:`${progress*100}%`,borderRadius:99,transition:"width 0.3s",background:progress===1?"linear-gradient(90deg,#3ecf8e,#10B981)":"linear-gradient(90deg,#4F6FF0,#7C4FE0)"}}/></div></div>}
    <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
      <span style={{fontSize:9.5,fontWeight:700,padding:"2px 5px",borderRadius:4,color:pm.color,background:pm.bg}}>{pm.label}</span>
      {due&&<span style={{fontSize:9.5,fontWeight:600,padding:"2px 5px",borderRadius:4,color:due.overdue?"#f44":due.soon?"#f5a623":"#555",background:due.overdue?"rgba(255,68,68,0.08)":due.soon?"rgba(245,166,35,0.08)":"#111"}}>{due.label}</span>}

      <div style={{flex:1}}/>
      {commentCount>0&&<span style={{fontSize:9.5,color:"#555"}}>{commentCount} cmts</span>}
      {linkCount>0&&<span style={{fontSize:9.5,color:"#555"}}>{linkCount} lnks</span>}
      {cycleTime!==null&&<Tooltip text={`Cycle time: ${cycleTime}h${card.completedAt?" (completed)":"  in progress"}`}><span style={{fontSize:9.5,color:"#94A3B8",cursor:"default"}}>⏱{cycleTime}h</span></Tooltip>}
      {score!==null&&<Tooltip text={`Priority Score: ${score}/100 (Value ${card.valueScore} ÷ Effort ${card.effortScore} × 10). Higher = do it sooner.`}><span style={{fontSize:9.5,fontWeight:700,color:scoreColor,cursor:"default"}}>⚡{score}</span></Tooltip>}
      {emp&&<Avatar name={emp.name} color={emp.color} size={20}/>}
    </div>
  </div>);
}

// ─── Column ───────────────────────────────────────────────────────────────────
function Column({col,dragOverColId,draggingCardId,admins,onDragStart,onDragOver,onDrop,onDragLeave,onAddCard,onEditCard}:{col:KanbanColumn;dragOverColId:string|null;draggingCardId:string|null;admins:Employee[];onDragStart:(e:React.DragEvent,cid:string,colId:string)=>void;onDragOver:(e:React.DragEvent,colId:string)=>void;onDrop:(e:React.DragEvent,colId:string)=>void;onDragLeave:()=>void;onAddCard:(colId:string)=>void;onEditCard:(card:KanbanCard,colId:string)=>void;}){
  const isDragOver=dragOverColId===col.id;
  const overLimit=col.limit!==undefined&&col.cards.length>col.limit;
  return(<div onDragOver={e=>onDragOver(e,col.id)} onDrop={e=>onDrop(e,col.id)} onDragLeave={onDragLeave}
    style={{display:"flex",flex:1,flexDirection:"column",minWidth:0,height:"100%",background:isDragOver?"rgba(79,111,240,0.1)":"#050505",border:isDragOver?"1.5px dashed #4F6FF0":"1.5px solid #1a1a1a",borderRadius:12,transition:"background 0.15s,border 0.15s"}}>
    <div style={{height:36,minHeight:36,padding:"0 10px 0 12px",display:"flex",alignItems:"center",gap:7,flexShrink:0}}>
      <div style={{width:8,height:8,borderRadius:"50%",background:col.color,flexShrink:0}}/>
      <span style={{fontSize:12,fontWeight:700,color:"#888",flex:1,lineHeight:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{col.title}</span>
      <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:99,lineHeight:1.4,flexShrink:0,background:overLimit?"rgba(255,68,68,0.12)":"#1a1a1a",color:overLimit?"#f44":"#555"}}>{col.cards.length}{col.limit?`/${col.limit}`:""}</span>
      <button onClick={()=>onAddCard(col.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#444",width:22,height:22,borderRadius:5,fontSize:15,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>+</button>
    </div>
    <div style={{height:22,minHeight:22,padding:"0 12px",display:"flex",alignItems:"center",flexShrink:0}}>{col.desc&&<span style={{fontSize:10,color:"#444",fontStyle:"italic",lineHeight:1}}>{col.desc}</span>}</div>
    <div style={{flex:1,overflowY:"auto",padding:"0 8px 8px",display:"flex",flexDirection:"column",gap:6}}>
      {col.cards.length===0?<div style={{border:"1.5px dashed #2a2a2a",borderRadius:8,padding:"20px 12px",textAlign:"center",fontSize:11,color:"#444"}}>Drop cards here</div>
      :col.cards.map(card=><KanbanCardTile key={card.id} card={card} colId={col.id} isDragging={draggingCardId===card.id} admins={admins} onDragStart={onDragStart} onClick={onEditCard}/>)}
    </div>
  </div>);
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
  const scoreColor=score>=15?"#3ecf8e":score>=8?"#f5a623":"#f44";
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
  const fi:React.CSSProperties={display:"block",width:"100%",border:"1.5px solid #2a2a2a",borderRadius:8,padding:"7px 10px",fontSize:12.5,fontFamily:"inherit",outline:"none",color:"#ededed",background:"#0a0a0a"};
  const fl:React.CSSProperties={fontSize:10,fontWeight:700,color:"#555",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:5};
  const tabBtn=(t:typeof tab,label:string)=>(<button onClick={()=>setTab(t)} style={{padding:"5px 14px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",border:"none",background:tab===t?"rgba(79,111,240,0.12)":"transparent",color:tab===t?"#4F6FF0":"#555"}}>{label}</button>);
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(3px)"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#0a0a0a",border:"1px solid #1a1a1a",borderRadius:14,width:580,maxWidth:"94vw",maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 24px 60px rgba(0,0,0,0.6)"}}>
      <div style={{padding:"18px 22px 12px",borderBottom:"1px solid #1a1a1a",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{fontSize:14,fontWeight:700,color:"#ededed"}}>{isNew?"New Card":"Edit Card"}</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {!isNew&&title&&<Tooltip text="Let AI auto-fill the user story, subtasks, and effort/value scores based on the card title"><button onClick={()=>setShowAI(a=>!a)} style={{fontSize:11.5,fontWeight:600,padding:"4px 10px",borderRadius:7,border:"1.5px solid rgba(79,111,240,0.3)",background:showAI?"rgba(79,111,240,0.12)":"#0a0a0a",color:"#4F6FF0",cursor:"pointer"}}>AI</button></Tooltip>}
            <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#555",fontSize:18,lineHeight:1}}>x</button>
          </div>
        </div>
        <div style={{display:"flex",gap:2,background:"#111",borderRadius:8,padding:3,width:"fit-content"}}>{tabBtn("details","Details")}{tabBtn("comments",`Comments${comments.length?` (${comments.length})`:""}`)}{ tabBtn("links",`Links${links.length?` (${links.length})`:""}`)} </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"18px 22px"}}>
        {showAI&&title&&<AIAssistant title={title} onClose={()=>setShowAI(false)} onResult={r=>{setStory(r.story);setSubtasks(r.subtasks);setEffort(r.effortScore);setValue(r.valueScore);setShowAI(false);}}/>}
        {tab==="details"&&(<>
          <div style={{marginBottom:13}}><label style={fl}>Title *</label><textarea value={title} onChange={e=>setTitle(e.target.value)} rows={2} style={{...fi,resize:"vertical" as const}}/></div>
          <div style={{marginBottom:13}}><label style={fl}>User Story</label><textarea value={story} onChange={e=>setStory(e.target.value)} rows={2} placeholder="As a [user], I want [goal] so that [reason]…" style={{...fi,resize:"vertical" as const}}/></div>
          <div style={{marginBottom:13}}><label style={fl}>Description / Acceptance Criteria</label><textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={2} placeholder="Technical notes, DoD…" style={{...fi,resize:"vertical" as const}}/></div>
          <div style={{marginBottom:13}}><label style={fl}>Priority</label><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{(["critical","high","medium","low"] as Priority[]).map(p=>{const pm=PRIORITY_META[p],act=priority===p;return<button key={p} onClick={()=>setPriority(p)} style={{padding:"5px 10px",borderRadius:6,fontSize:11.5,fontWeight:600,cursor:"pointer",border:act?`1.5px solid ${pm.color}`:"1.5px solid #2a2a2a",background:act?pm.bg:"#111",color:act?pm.color:"#555"}}>{pm.label}</button>;})}</div></div>
          <div style={{marginBottom:13}}><label style={fl}>Labels</label><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{(Object.keys(LABEL_META) as LabelKey[]).map(l=>{const lm=LABEL_META[l],act=labels.includes(l);return<button key={l} onClick={()=>toggleLabel(l)} style={{padding:"4px 9px",borderRadius:5,fontSize:11,fontWeight:600,cursor:"pointer",border:act?`1.5px solid ${lm.color}`:"1.5px solid #2a2a2a",background:act?lm.bg:"#111",color:act?lm.color:"#444"}}>{lm.label}</button>;})}</div></div>
          <div style={{marginBottom:13}}><label style={fl}>Assignee</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              <button onClick={()=>setAssigneeId("")} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 10px",borderRadius:8,border:assigneeId===""?"1.5px solid #4F6FF0":"1.5px solid #2a2a2a",background:assigneeId===""?"rgba(79,111,240,0.12)":"#111",cursor:"pointer"}}><div style={{width:22,height:22,borderRadius:"50%",background:"#1a1a1a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#555"}}>-</div><span style={{fontSize:11.5,fontWeight:600,color:assigneeId===""?"#4F6FF0":"#888"}}>Unassigned</span></button>
              {admins.map(emp=>{const act=assigneeId===emp.id;return(<button key={emp.id} onClick={()=>setAssigneeId(emp.id)} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 10px",borderRadius:8,border:act?"1.5px solid #4F6FF0":"1.5px solid #2a2a2a",background:act?"rgba(79,111,240,0.12)":"#111",cursor:"pointer"}}><Avatar name={emp.name} color={emp.color} size={22}/><div><div style={{fontSize:11.5,fontWeight:600,color:act?"#4F6FF0":"#888"}}>{emp.name}</div><div style={{fontSize:10,color:"#444"}}>{emp.role}</div></div></button>);})}
            </div>
          </div>
          <div style={{display:"flex",gap:10,marginBottom:13}}>
            <div style={{flex:1}}><label style={fl}>Effort (1–10)</label><input type="number" min={1} max={10} value={effort} onChange={e=>setEffort(Number(e.target.value))} style={fi}/></div>
            <div style={{flex:1}}><label style={fl}>Value (1–10)</label><input type="number" min={1} max={10} value={value} onChange={e=>setValue(Number(e.target.value))} style={fi}/></div>
            <div style={{flex:1}}><label style={fl}><Tooltip text="Priority Score = Value ÷ Effort × 10. Score above 15 = high priority, 8-14 = medium, below 8 = low.">⚡ Score ℹ</Tooltip></label><div style={{height:34,display:"flex",alignItems:"center",fontSize:20,fontWeight:700,color:scoreColor}}>{score}</div></div>

          </div>
          <div style={{display:"flex",gap:10,marginBottom:13}}>
            <div style={{flex:1}}><label style={fl}>Due Date</label><input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} style={fi}/></div>
            {isDone&&<div style={{flex:1}}><label style={fl}><Tooltip text="How many hours did this card actually take? Used to build velocity data and improve future estimates.">⏱ Actual Hours ℹ</Tooltip></label><input type="number" min={0} value={actualHours} onChange={e=>setActualHours(Number(e.target.value))} placeholder="e.g. 12" style={fi}/></div>}
          </div>
          <div style={{marginBottom:13}}><label style={fl}>Blocked By</label><input value={String(blockedBy??"")} onChange={e=>setBlockedBy(e.target.value)} placeholder="Describe blocker (leave empty if none)…" style={fi}/></div>
          <div style={{marginBottom:13}}>
            <label style={fl}>Subtasks</label>
            {subtasks.map((s,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}><input type="checkbox" checked={s.done} onChange={()=>toggleSubtask(i)} style={{cursor:"pointer",width:14,height:14,flexShrink:0}}/><span style={{flex:1,fontSize:12.5,textDecoration:s.done?"line-through":"none",color:s.done?"#444":"#ccc"}}>{s.label}</span><button onClick={()=>removeSubtask(i)} style={{background:"none",border:"none",cursor:"pointer",color:"#333",fontSize:14,padding:2}}>x</button></div>)}
            <div style={{display:"flex",gap:6,marginTop:6}}><input value={newSubtask} onChange={e=>setNewSubtask(e.target.value)} placeholder="Add subtask..." onKeyDown={e=>{if(e.key==="Enter")addSubtask();}} style={{...fi,flex:1}}/><button onClick={addSubtask} disabled={!newSubtask.trim()} style={{padding:"7px 12px",borderRadius:8,border:"none",background:"rgba(79,111,240,0.12)",color:"#4F6FF0",fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0}}>Add</button></div>
          </div>
          <div><label style={fl}>Column</label><select value={targetCol} onChange={e=>setTargetCol(e.target.value)} style={{...fi}}>{columns.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></div>
        </>)}
        {tab==="comments"&&<div>
          {comments.length===0&&<div style={{textAlign:"center",padding:"28px 0",fontSize:12,color:"#444"}}>No comments yet. Use @Name to mention teammates.</div>}
          {comments.map(cm=><div key={cm.id} style={{display:"flex",gap:10,marginBottom:16}}><Avatar name={cm.author} color={cm.authorColor} size={28}/><div style={{flex:1}}><div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:4}}><span style={{fontSize:12.5,fontWeight:700,color:"#ededed"}}>{cm.author}</span><span style={{fontSize:10.5,color:"#444"}}>{cm.createdAt}</span>{cm.author===me.name&&<button onClick={()=>card&&onDeleteComment(card.id,colId??columns[0].id,cm.id)} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#333",fontSize:11,padding:0}}>Delete</button>}</div><div style={{fontSize:12.5,color:"#aaa",lineHeight:1.6,background:"#111",borderRadius:8,padding:"8px 12px",border:"1px solid #1a1a1a"}}>{cm.text.split(/(@\w+)/g).map((part,i)=>part.startsWith("@")?<span key={i} style={{color:"#4F6FF0",fontWeight:700}}>{part}</span>:<span key={i}>{part}</span>)}</div></div></div>)}
          <div style={{display:"flex",gap:10,marginTop:8,paddingTop:14,borderTop:"1px solid #1a1a1a"}}><Avatar name={me.name} color={me.color} size={28}/><div style={{flex:1}}><textarea value={commentText} onChange={e=>setCommentText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))addComment();}} placeholder="Write a comment... Use @Name to notify." rows={3} style={{...fi,resize:"vertical" as const,marginBottom:8}}/><div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><span style={{fontSize:10.5,color:"#444"}}>@mention to notify teammates</span><button onClick={addComment} disabled={!commentText.trim()} style={{padding:"6px 16px",borderRadius:7,border:"none",background:"linear-gradient(135deg,#4F6FF0,#7C4FE0)",color:"#fff",fontSize:12,fontWeight:700,cursor:commentText.trim()?"pointer":"not-allowed",opacity:commentText.trim()?1:0.45}}>Post</button></div></div></div>
        </div>}
        {tab==="links"&&<div>
          {links.length===0&&!showLinkForm&&<div style={{textAlign:"center",padding:"24px 0",fontSize:12,color:"#444"}}>No links attached yet.</div>}
          {links.map(lk=><div key={lk.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#111",border:"1px solid #1a1a1a",borderRadius:9,marginBottom:8}}><div style={{width:32,height:32,borderRadius:8,background:"rgba(79,111,240,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0,color:"#4F6FF0"}}>lk</div><div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:"#ededed",marginBottom:2}}>{lk.label}</div><a href={lk.url} target="_blank" rel="noreferrer" style={{fontSize:11,color:"#4F6FF0",textDecoration:"none",wordBreak:"break-all"}}>{lk.url}</a></div><button onClick={()=>setLinks(prev=>prev.filter(l=>l.id!==lk.id))} style={{background:"none",border:"none",cursor:"pointer",color:"#333",fontSize:16,padding:4}}>x</button></div>)}
          {showLinkForm?<div style={{background:"#111",border:"1.5px solid #2a2a2a",borderRadius:10,padding:"14px 14px 12px",marginTop:4}}><div style={{marginBottom:9}}><label style={fl}>Label</label><input value={linkLabel} onChange={e=>setLinkLabel(e.target.value)} placeholder="e.g. PR #247, Figma..." style={fi}/></div><div style={{marginBottom:12}}><label style={fl}>URL</label><input value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} placeholder="https://..." style={fi} onKeyDown={e=>{if(e.key==="Enter")addLink();}}/></div><div style={{display:"flex",gap:8}}><button onClick={()=>setShowLinkForm(false)} style={{padding:"6px 12px",borderRadius:7,border:"1.5px solid #2a2a2a",background:"#0a0a0a",color:"#555",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancel</button><button onClick={addLink} disabled={!linkLabel.trim()||!linkUrl.trim()} style={{padding:"6px 16px",borderRadius:7,border:"none",background:"linear-gradient(135deg,#4F6FF0,#7C4FE0)",color:"#fff",fontSize:12,fontWeight:700,cursor:(linkLabel.trim()&&linkUrl.trim())?"pointer":"not-allowed",opacity:(linkLabel.trim()&&linkUrl.trim())?1:0.45}}>Add</button></div></div>
          :<button onClick={()=>setShowLinkForm(true)} style={{marginTop:4,display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:8,border:"1.5px dashed #2a2a2a",background:"transparent",color:"#555",fontSize:12,fontWeight:600,cursor:"pointer",width:"100%"}}>+ Attach a link</button>}
        </div>}
      </div>
      <div style={{padding:"12px 22px 16px",borderTop:"1px solid #1a1a1a",display:"flex",gap:8,justifyContent:"flex-end",flexShrink:0}}>
        {!isNew&&card&&<button onClick={()=>onDelete(card.id)} style={{padding:"7px 13px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",border:"1.5px solid rgba(255,68,68,0.2)",background:"rgba(255,68,68,0.06)",color:"#f44",marginRight:"auto"}}>Delete Card</button>}
        <button onClick={onClose} style={{padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",border:"1.5px solid #2a2a2a",background:"#111",color:"#555"}}>Cancel</button>
        <button onClick={handleSave} disabled={!title.trim()} style={{padding:"7px 18px",borderRadius:8,fontSize:12,fontWeight:700,cursor:title.trim()?"pointer":"not-allowed",border:"none",background:"linear-gradient(135deg,#4F6FF0,#7C4FE0)",color:"#fff",opacity:title.trim()?1:0.45}}>{isNew?"Add Card":"Save Card"}</button>
      </div>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Main KanbanTab ───────────────────────────────────────────────────────────
export default function KanbanTab({token="",currentUser}:{token?:string;currentUser?:{uid:string;name:string;email:string;color?:string};}){
  const me:Employee=currentUser?{id:currentUser.uid,name:currentUser.name||currentUser.email||"Admin",role:"Admin",color:currentUser.color??"#4F6FF0",email:currentUser.email||""}:FALLBACK_ME;

  const [columns,      setColumns]      = useState<KanbanColumn[]>(JSON.parse(JSON.stringify(DEFAULT_COLUMNS)));
  const [meetings,     setMeetings]     = useState<Meeting[]>(SEED_MEETINGS);
  const [admins,       setAdmins]       = useState<Employee[]>([me]);
  const [boardLoading, setBoardLoading] = useState(true);
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
    fetch("/api/kanban?action=board",{headers:h}).then(r=>r.json()).then((d:{columns:KanbanColumn[]|null})=>{if(d.columns)setColumns(d.columns);setBoardLoading(false);}).catch(()=>setBoardLoading(false));
    fetch("/api/kanban?action=admins",{headers:h}).then(r=>r.json()).then((d:{admins:Employee[]})=>{if(d.admins?.length)setAdmins(d.admins);}).catch(()=>{});
  },[token]);

  useEffect(()=>{
    if(!token||boardLoading)return;
    const t=setTimeout(()=>{fetch("/api/kanban?action=save-board",{method:"POST",headers:{"Content-Type":"application/json","x-admin-token":token},body:JSON.stringify({columns})}).catch(()=>{});},1000);
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
  const handleAddComment=async(cardId:string,colId:string,comment:Comment)=>{setColumns(prev=>prev.map(col=>col.id!==colId?col:{...col,cards:col.cards.map(c=>c.id!==cardId?c:{...c,commentList:[...(c.commentList??[]),comment]})}));if(!token)return;await fetch("/api/kanban?action=add-comment",{method:"POST",headers:{"Content-Type":"application/json","x-admin-token":token},body:JSON.stringify({cardId,colId,comment})}).catch(()=>{});};
  const handleDeleteComment=async(cardId:string,colId:string,commentId:string)=>{setColumns(prev=>prev.map(col=>col.id!==colId?col:{...col,cards:col.cards.map(c=>c.id!==cardId?c:{...c,commentList:(c.commentList??[]).filter(cm=>cm.id!==commentId)})}));if(!token)return;await fetch("/api/kanban?action=delete-comment",{method:"POST",headers:{"Content-Type":"application/json","x-admin-token":token},body:JSON.stringify({cardId,colId,commentId})}).catch(()=>{});};
  const handleMeetSave=(m:Meeting)=>{setMeetings(prev=>{const idx=prev.findIndex(x=>x.id===m.id);if(idx>=0){const n=[...prev];n[idx]=m;return n;}return[...prev,m];});setMeetModal(null);};
  const handleMeetDelete=(id:string)=>{setMeetings(prev=>prev.filter(m=>m.id!==id));setMeetModal(null);};

  const toolbar=(<div style={{background:"#0a0a0a",borderBottom:"1px solid #1a1a1a",padding:"0 16px",height:48,display:"flex",alignItems:"center",gap:8,flexShrink:0,overflowX:"auto"}}>
    <span style={{fontSize:14,fontWeight:700,color:"#ededed",letterSpacing:-0.2}}>Board</span>
    <span style={{fontSize:10,fontWeight:700,background:"rgba(79,111,240,0.12)",color:"#4F6FF0",padding:"2px 7px",borderRadius:99,flexShrink:0}}>{totalCards}</span>
    <div style={{width:1,height:18,background:"#1a1a1a",margin:"0 2px",flexShrink:0}}/>
    <Tooltip text="Search cards by title"><div style={{position:"relative",flexShrink:0}}><span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"#555"}}>🔍</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{paddingLeft:24,paddingRight:8,height:30,borderRadius:7,border:"1px solid #2a2a2a",fontSize:12,color:"#ededed",width:120,outline:"none",fontFamily:"inherit",background:"#0a0a0a"}}/></div></Tooltip>
    <Tooltip text="Filter cards by priority level"><select value={filterPri} onChange={e=>setFilterPri(e.target.value as Priority|"all")} style={{height:30,borderRadius:7,border:"1px solid #2a2a2a",fontSize:11,color:"#888",padding:"0 5px",outline:"none",background:"#0a0a0a",fontFamily:"inherit",cursor:"pointer",flexShrink:0}}><option value="all">Priority</option>{(["critical","high","medium","low"] as Priority[]).map(p=><option key={p} value={p}>{PRIORITY_META[p].label}</option>)}</select></Tooltip>
    <Tooltip text="Filter cards by label type"><select value={filterLabel} onChange={e=>setFilterLabel(e.target.value as LabelKey|"all")} style={{height:30,borderRadius:7,border:"1px solid #2a2a2a",fontSize:11,color:"#888",padding:"0 5px",outline:"none",background:"#0a0a0a",fontFamily:"inherit",cursor:"pointer",flexShrink:0}}><option value="all">Label</option>{(Object.keys(LABEL_META) as LabelKey[]).map(l=><option key={l} value={l}>{LABEL_META[l].label}</option>)}</select></Tooltip>
    <Tooltip text="Show only cards assigned to you across all columns"><button onClick={()=>setFocusMe(f=>!f)} style={{height:30,borderRadius:7,border:`1px solid ${focusMe?"#4F6FF0":"#2a2a2a"}`,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",padding:"0 8px",background:focusMe?"rgba(79,111,240,0.12)":"#0a0a0a",color:focusMe?"#4F6FF0":"#888",flexShrink:0,display:"flex",alignItems:"center",gap:4}}><Avatar name={me.name} color={me.color} size={16}/>{!isMobile&&"My Cards"}</button></Tooltip>
    <Tooltip text="Sort the To Do column by Priority Score (Value / Effort x 10). Highest value, lowest effort cards float to the top."><button onClick={()=>setSortByScore(s=>!s)} style={{height:30,borderRadius:7,border:`1px solid ${sortByScore?"#a855f7":"#2a2a2a"}`,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",padding:"0 8px",background:sortByScore?"rgba(168,85,247,0.1)":"#0a0a0a",color:sortByScore?"#a855f7":"#888",flexShrink:0}}>Score Sort</button></Tooltip>
    {blockedCount>0&&<Tooltip text={`${blockedCount} card${blockedCount>1?"s are":" is"} currently blocked`}><span style={{fontSize:11,color:"#f44",fontWeight:700,flexShrink:0,cursor:"default"}}>Blocked: {blockedCount}</span></Tooltip>}
    <div style={{flex:1}}/>
    {!isMobile&&avgCycle!==null&&<Tooltip text="Average cycle time - how long cards typically spend from In Progress to Done"><span style={{fontSize:10.5,color:"#555",flexShrink:0,cursor:"default"}}>Avg cycle <b style={{color:"#ededed"}}>{avgCycle}h</b></span></Tooltip>}

    {!isMobile&&<Tooltip text="Toggle 7-day burndown chart - cards completed per day this sprint"><button onClick={()=>setShowBurndown(s=>!s)} style={{height:30,borderRadius:7,border:"1px solid #2a2a2a",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",padding:"0 8px",background:showBurndown?"rgba(79,111,240,0.12)":"#0a0a0a",color:showBurndown?"#4F6FF0":"#888",flexShrink:0}}>Burndown</button></Tooltip>}
    {!isMobile&&<Tooltip text="Launch fullscreen standup mode - shows your Done, In Progress, and Blocked cards for the daily standup"><button onClick={()=>setShowStandup(true)} style={{height:30,borderRadius:7,border:"1px solid #2a2a2a",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",padding:"0 8px",background:"#0a0a0a",color:"#888",flexShrink:0}}>Standup</button></Tooltip>}
    <Tooltip text="Create a new card in the To Do column"><button onClick={()=>setCardModal({card:null,colId:columns[0]?.id??null,isNew:true})} style={{height:30,borderRadius:7,border:"none",fontSize:11.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit",padding:"0 12px",background:"linear-gradient(135deg,#4F6FF0,#7C4FE0)",color:"#fff",flexShrink:0}}>+ Card</button></Tooltip>
  </div>);

  const burndownBar=showBurndown&&!isMobile&&(<div style={{background:"#0a0a0a",borderBottom:"1px solid #1a1a1a",padding:"8px 16px",display:"flex",alignItems:"center",gap:16,flexShrink:0}}>
    <span style={{fontSize:10,fontWeight:700,color:"#444",textTransform:"uppercase",letterSpacing:"0.05em"}}>7-Day Burndown</span>
    <BurndownChart data={burndown}/>
    <span style={{fontSize:11,color:"#555"}}>Completed: <b style={{color:"#ededed"}}>{burndown.reduce((a,d)=>a+d.completed,0)}</b></span>
    <button onClick={()=>setShowBurndown(false)} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#555",fontSize:16}}>✕</button>
  </div>);

  const boardArea=(<div style={{flex:1,display:"flex",gap:isMobile?8:10,padding:isMobile?10:14,overflow:isMobile?"auto":"hidden",alignItems:isMobile?"flex-start":"stretch",minWidth:0,...(isMobile?{flexDirection:"column" as const,overflowX:"hidden",overflowY:"auto"}:{})}}>
    {filteredCols.map(col=>(
      <div key={col.id} style={isMobile?{width:"100%",minWidth:0}:{display:"flex",flex:1,minWidth:0}}>
        <Column col={col} dragOverColId={dragOverColId} draggingCardId={dragCardId} admins={admins} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={onDragLeave} onAddCard={colId=>setCardModal({card:null,colId,isNew:true})} onEditCard={(card,colId)=>setCardModal({card,colId,isNew:false})}/>
      </div>
    ))}
  </div>);

  const velocityBar=showVelocity&&!isMobile&&(<div style={{height:42,background:"#0a0a0a",borderTop:"1px solid #1a1a1a",display:"flex",alignItems:"center",gap:16,padding:"0 16px",flexShrink:0}}>
    <span style={{fontSize:10,fontWeight:700,color:"#444",textTransform:"uppercase",letterSpacing:"0.05em"}}>Sprint Health</span>
    {[{color:"#3ecf8e",label:"Done",val:doneCount},{color:"#f5a623",label:"In Progress",val:inProgCount},{color:"#f44",label:"Blocked",val:blockedCount}].map(({color,label,val})=>(
      <div key={label} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#555"}}><div style={{width:8,height:8,borderRadius:2,background:color}}/>{label}:<b style={{color:label==="Blocked"&&val>0?"#f44":"#ededed"}}>{val}</b></div>
    ))}
    <div style={{flex:1}}/>
    <div style={{display:"flex",alignItems:"center",gap:7,fontSize:11,color:"#555"}}>Completion<div style={{width:80,height:5,background:"#1a1a1a",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#4F6FF0,#3ecf8e)",borderRadius:99,transition:"width 0.4s"}}/></div><b style={{color:"#ededed"}}>{pct}%</b></div>
    <button onClick={()=>setShowVelocity(false)} style={{background:"none",border:"none",cursor:"pointer",color:"#444",fontSize:14}}>✕</button>
  </div>);

  const modals=(<>
    {cardModal&&<CardModal card={cardModal.card} colId={cardModal.colId} columns={columns} isNew={cardModal.isNew} me={me} admins={admins} onClose={()=>setCardModal(null)} onSave={handleCardSave} onDelete={handleCardDelete} onAddComment={handleAddComment} onDeleteComment={handleDeleteComment}/>}
    {meetModal&&<MeetingModal meeting={meetModal.meeting} defaultDate={meetModal.defaultDate} integrations={integrations} admins={admins} onClose={()=>setMeetModal(null)} onSave={handleMeetSave} onDelete={handleMeetDelete}/>}
    {showStandup&&<StandupMode columns={columns} admins={admins} me={me} onClose={()=>setShowStandup(false)}/>}
  </>);

  if(isMobile)return(<div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden",background:"#000"}}>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    {toolbar}
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      {mobileTab==="board"&&<div style={{flex:1,overflowY:"auto",background:"#000"}}>{boardArea}</div>}
      {mobileTab==="calendar"&&<CalendarPanel cards={allCards} meetings={meetings} admins={admins} calMonth={calMonth} setCalMonth={setCalMonth} calSelected={calSelected} setCalSelected={setCalSelected} onSchedule={d=>setMeetModal({meeting:null,defaultDate:d})} onEditMeeting={m=>setMeetModal({meeting:m})} compact/>}
      {mobileTab==="meetings"&&<MeetingsPanel meetings={meetings} admins={admins} onSchedule={d=>setMeetModal({meeting:null,defaultDate:d})} onEdit={m=>setMeetModal({meeting:m})}/>}
      {mobileTab==="standup"&&<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:"#000"}}><button onClick={()=>setShowStandup(true)} style={{padding:"14px 28px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#0F172A,#1E293B)",color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer"}}>Standup Mode</button></div>}
    </div>
    <div style={{height:56,background:"#0a0a0a",borderTop:"1px solid #1a1a1a",display:"flex",alignItems:"stretch",flexShrink:0}}>
      {([{id:"board" as MobileTab,label:"Board",icon:"▦"},{id:"calendar" as MobileTab,label:"Calendar",icon:"📅"},{id:"meetings" as MobileTab,label:"Meetings",icon:"📹"},{id:"standup" as MobileTab,label:"Standup",icon:"🏃"}]).map(t=>(
        <button key={t.id} onClick={()=>setMobileTab(t.id)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,background:"none",border:"none",cursor:"pointer",color:mobileTab===t.id?"#4F6FF0":"#555"}}>
          <span style={{fontSize:18}}>{t.icon}</span><span style={{fontSize:10,fontWeight:mobileTab===t.id?700:500}}>{t.label}</span>
        </button>
      ))}
    </div>
    {modals}
  </div>);

  return(<div style={{display:"flex",width:"100%",height:"100%",overflow:"hidden",flex:1,background:"#000"}}>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"#000",minWidth:0,minHeight:0}}>
      {toolbar}{burndownBar}{boardArea}{velocityBar}
    </div>
    <CalendarPanel cards={allCards} meetings={meetings} admins={admins} calMonth={calMonth} setCalMonth={setCalMonth} calSelected={calSelected} setCalSelected={setCalSelected} onSchedule={d=>setMeetModal({meeting:null,defaultDate:d})} onEditMeeting={m=>setMeetModal({meeting:m})}/>
    {modals}
  </div>);
}