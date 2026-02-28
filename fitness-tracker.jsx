import { useState, useEffect, useRef, useCallback } from "react";

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
    : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function fmtPace(secPerKm) {
  if (!secPerKm || secPerKm === Infinity || secPerKm > 3600) return "--:--";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2,"0")}`;
}

const ACTIVITIES = [
  { id:"run",  label:"BĚH",       icon:"↑",  cal:10, color:"#FF5C1A" },
  { id:"bike", label:"KOLO",      icon:"⊕",  cal:6,  color:"#00D4FF" },
  { id:"walk", label:"CHŮZE",     icon:"→",  cal:4,  color:"#AAFF00" },
  { id:"hike", label:"TURISTIKA", icon:"△",  cal:7,  color:"#FFD700" },
  { id:"swim", label:"PLAVÁNÍ",   icon:"~",  cal:8,  color:"#A78BFA" },
];

function RouteSVG({ points, color }) {
  if (points.length < 2) return (
    <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontFamily:"Share Tech Mono,monospace",fontSize:10,color:"#2a2a1e",letterSpacing:3}}>ČEKÁM NA GPS</span>
    </div>
  );
  const lats = points.map(p=>p.lat), lons = points.map(p=>p.lon);
  const minLat=Math.min(...lats), maxLat=Math.max(...lats);
  const minLon=Math.min(...lons), maxLon=Math.max(...lons);
  const pad=12, W=300, H=130;
  const toX = lon => pad + ((lon-minLon)/(maxLon-minLon||0.0001))*(W-pad*2);
  const toY = lat => (H-pad) - ((lat-minLat)/(maxLat-minLat||0.0001))*(H-pad*2);
  const d = points.map((p,i)=>`${i===0?"M":"L"} ${toX(p.lon).toFixed(1)} ${toY(p.lat).toFixed(1)}`).join(" ");
  const last = points[points.length-1];
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={toX(last.lon)} cy={toY(last.lat)} r="5" fill={color}/>
      <circle cx={toX(last.lon)} cy={toY(last.lat)} r="10" fill="none" stroke={color} strokeWidth="1" opacity="0.5">
        <animate attributeName="r" values="5;16;5" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite"/>
      </circle>
    </svg>
  );
}

const Scanlines = () => (
  <div style={{
    position:"fixed",inset:0,pointerEvents:"none",zIndex:999,
    background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.04) 2px,rgba(0,0,0,0.04) 4px)",
  }}/>
);

export default function App() {
  const [screen, setScreen] = useState("home");
  const [activity, setActivity] = useState(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  const [gpsStatus, setGpsStatus] = useState("idle");
  const [gpsPoints, setGpsPoints] = useState([]);
  const [lastPos, setLastPos] = useState(null);
  const [distance, setDistance] = useState(0);
  const [speed, setSpeed] = useState(0);
  const watchRef = useRef(null);
  const distRef = useRef(0);
  const lastPosRef = useRef(null);

  const [history, setHistory] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("fitness_history_v2");
        if (res) setHistory(JSON.parse(res.value));
      } catch(_) {}
    })();
  }, []);

  const saveHistory = useCallback(async (h) => {
    try { await window.storage.set("fitness_history_v2", JSON.stringify(h)); } catch(_) {}
  }, []);

  useEffect(() => {
    if (running && !paused) {
      timerRef.current = setInterval(() => setElapsed(e=>e+1), 1000);
    } else clearInterval(timerRef.current);
    return () => clearInterval(timerRef.current);
  }, [running, paused]);

  const startGPS = useCallback(() => {
    if (!navigator.geolocation) { setGpsStatus("denied"); return; }
    setGpsStatus("acquiring");
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude:lat, longitude:lon, speed:sp, accuracy } = pos.coords;
        setGpsStatus("ok");
        setSpeed(sp || 0);
        setLastPos({ lat, lon, accuracy });
        setGpsPoints(pts => [...pts, { lat, lon }]);
        if (lastPosRef.current) {
          const d = haversine(lastPosRef.current.lat, lastPosRef.current.lon, lat, lon);
          if (d > 2 && accuracy < 30) {
            distRef.current += d;
            setDistance(distRef.current);
          }
        }
        lastPosRef.current = { lat, lon };
      },
      (err) => { setGpsStatus(err.code === 1 ? "denied" : "acquiring"); },
      { enableHighAccuracy:true, maximumAge:0, timeout:10000 }
    );
  }, []);

  const stopGPS = useCallback(() => {
    if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setGpsStatus("idle");
  }, []);

  const startWorkout = (act) => {
    setActivity(act);
    setElapsed(0);
    setDistance(0);
    setGpsPoints([]);
    setLastPos(null);
    distRef.current = 0;
    lastPosRef.current = null;
    setRunning(true);
    setPaused(false);
    startGPS();
    setScreen("active");
  };

  const finishWorkout = async () => {
    setRunning(false);
    stopGPS();
    const cal = Math.round((activity.cal * 70 * elapsed) / 3600);
    const entry = {
      id: Date.now(),
      actId: activity.id,
      label: activity.label,
      color: activity.color,
      icon: activity.icon,
      date: new Date().toLocaleDateString("cs-CZ"),
      time: new Date().toLocaleTimeString("cs-CZ", {hour:"2-digit",minute:"2-digit"}),
      duration: elapsed,
      distanceM: Math.round(distRef.current),
      calories: cal,
      avgSpeedKmh: elapsed > 0 ? ((distRef.current/1000)/(elapsed/3600)).toFixed(1) : "0",
      points: gpsPoints.slice(0, 500),
    };
    const newH = [entry, ...history];
    setHistory(newH);
    await saveHistory(newH);
    setScreen("summary");
  };

  const distKm = distance / 1000;
  const pace = elapsed > 0 && distKm > 0.01 ? elapsed / distKm : Infinity;
  const speedKmh = speed ? (speed * 3.6).toFixed(1) : "0.0";
  const totalKm = history.reduce((s,h) => s + h.distanceM/1000, 0);
  const totalCal = history.reduce((s,h) => s + h.calories, 0);
  const totalTime = history.reduce((s,h) => s + h.duration, 0);

  return (
    <div style={{
      fontFamily:"'Share Tech Mono',monospace",
      background:"#0C0C0A",
      color:"#E8E0C8",
      minHeight:"100dvh",
      maxWidth:430,
      margin:"0 auto",
      position:"relative",
      overflowX:"hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Bebas+Neue&family=Share+Tech&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
        ::-webkit-scrollbar{width:0;}
        .blink{animation:blink 1s step-end infinite;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        .fadeup{animation:fadeup 0.3s ease both;}
        @keyframes fadeup{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        .tap{transition:transform 0.1s,opacity 0.1s;}
        .tap:active{transform:scale(0.96);opacity:0.7;}
        .numglow{text-shadow:0 0 30px currentColor;}
      `}</style>
      <Scanlines/>

      {/* ══ HOME ══════════════════════════════════════════════ */}
      {screen === "home" && (
        <div className="fadeup" style={{paddingBottom:100}}>
          <div style={{
            padding:"52px 24px 20px",
            borderBottom:"1px solid #191913",
            display:"flex",alignItems:"flex-end",justifyContent:"space-between",
          }}>
            <div>
              <div style={{fontSize:9,letterSpacing:4,color:"#3a3a2e",marginBottom:6}}>
                {new Date().toLocaleDateString("cs-CZ",{weekday:"long",day:"numeric",month:"long"}).toUpperCase()}
              </div>
              <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:60,lineHeight:1,letterSpacing:1}}>
                MOVE<span style={{color:"#FF5C1A"}}>.</span>
              </div>
            </div>
            <div style={{textAlign:"right",paddingBottom:4}}>
              <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:48,lineHeight:1,color:"#FF5C1A"}}>{history.length}</div>
              <div style={{fontSize:9,color:"#3a3a2e",letterSpacing:3}}>AKTIVIT</div>
            </div>
          </div>

          {history.length > 0 && (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",borderBottom:"1px solid #191913"}}>
              {[
                {v:totalKm.toFixed(1),u:"KM"},
                {v:totalCal.toLocaleString(),u:"KCAL"},
                {v:fmtTime(totalTime),u:"ČAS"},
              ].map((s,i)=>(
                <div key={i} style={{
                  padding:"14px 0",textAlign:"center",
                  borderRight:i<2?"1px solid #191913":"none",
                }}>
                  <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:24,letterSpacing:1}}>{s.v}</div>
                  <div style={{fontSize:8,color:"#3a3a2e",letterSpacing:3,marginTop:2}}>{s.u}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{padding:"28px 24px 0"}}>
            <div style={{fontSize:9,letterSpacing:4,color:"#3a3a2e",marginBottom:18}}>// VYBER AKTIVITU</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {ACTIVITIES.map(act => (
                <button key={act.id} className="tap"
                  onClick={() => startWorkout(act)}
                  style={{
                    background:"transparent",
                    border:"1px solid #1a1a12",
                    borderLeft:`3px solid ${act.color}`,
                    padding:"20px 18px",
                    display:"flex",alignItems:"center",gap:18,
                    cursor:"pointer",color:"#E8E0C8",textAlign:"left",
                  }}>
                  <span style={{fontFamily:"Bebas Neue,sans-serif",fontSize:30,color:act.color,lineHeight:1,minWidth:22,textAlign:"center"}}>{act.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:26,letterSpacing:2}}>{act.label}</div>
                    <div style={{fontSize:8,color:"#3a3a2e",letterSpacing:3,marginTop:3}}>GPS · {act.cal} KCAL/KG/H</div>
                  </div>
                  <span style={{fontFamily:"Bebas Neue,sans-serif",fontSize:22,color:act.color}}>›</span>
                </button>
              ))}
            </div>
          </div>

          {history.length > 0 && (
            <div style={{padding:"28px 24px 0"}}>
              <div style={{fontSize:9,color:"#3a3a2e",letterSpacing:4,marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>// POSLEDNÍ</span>
                <button className="tap" onClick={()=>setScreen("history")}
                  style={{background:"none",border:"none",color:"#FF5C1A",fontSize:9,letterSpacing:3,cursor:"pointer"}}>
                  VŠE ›
                </button>
              </div>
              {history.slice(0,3).map(h=>(
                <div key={h.id} style={{borderBottom:"1px solid #111110",padding:"14px 0",display:"flex",alignItems:"center",gap:14}}>
                  <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:22,color:h.color,minWidth:24,textAlign:"center"}}>{h.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:18,letterSpacing:1}}>{h.label}</div>
                    <div style={{fontSize:8,color:"#3a3a2e",letterSpacing:2}}>{h.date} · {h.time}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:20,color:h.color}}>{(h.distanceM/1000).toFixed(2)} <span style={{fontSize:11}}>KM</span></div>
                    <div style={{fontSize:8,color:"#3a3a2e",letterSpacing:2}}>{fmtTime(h.duration)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ ACTIVE ════════════════════════════════════════════ */}
      {screen === "active" && activity && (
        <div className="fadeup">
          <div style={{
            display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"52px 24px 18px",
            borderBottom:`2px solid ${activity.color}`,
          }}>
            <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:32,letterSpacing:3,color:activity.color}}>
              {activity.icon} {activity.label}
            </div>
            <div>
              {gpsStatus==="ok" && <div style={{fontSize:9,letterSpacing:2,color:"#AAFF00"}}><span className="blink">●</span> GPS LOCK</div>}
              {gpsStatus==="acquiring" && <div style={{fontSize:9,letterSpacing:2,color:"#FFD700"}} className="blink">◌ HLEDÁM</div>}
              {gpsStatus==="denied" && <div style={{fontSize:9,letterSpacing:2,color:"#FF5C1A"}}>✕ GPS OFF</div>}
            </div>
          </div>

          <div style={{textAlign:"center",padding:"32px 24px 20px"}}>
            <div style={{fontSize:8,letterSpacing:4,color:"#3a3a2e",marginBottom:10}}>ČISTÝ ČAS</div>
            <div style={{
              fontFamily:"Bebas Neue,sans-serif",fontSize:88,lineHeight:1,letterSpacing:-2,
              color:paused?"#2a2a1e":"#E8E0C8",transition:"color 0.3s",
            }} className={running&&!paused?"numglow":""}>
              {fmtTime(elapsed)}
            </div>
            {paused && <div style={{fontSize:9,letterSpacing:6,color:"#FFD700",marginTop:10}} className="blink">⏸ PAUZA</div>}
            {running&&!paused && <div style={{fontSize:9,letterSpacing:6,color:activity.color,marginTop:10}}>▶ NAHRÁVÁM</div>}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",margin:"0 24px",border:"1px solid #191913"}}>
            {[
              {l:"VZDÁLENOST", v:distKm.toFixed(3), u:"KM"},
              {l:"RYCHLOST",   v:speedKmh,          u:"KM/H"},
              {l:"TEMPO",      v:fmtPace(pace),      u:"MIN/KM"},
              {l:"KALORIE",    v:Math.round(activity.cal*70*elapsed/3600), u:"KCAL"},
            ].map((s,i)=>(
              <div key={i} style={{
                padding:"18px",
                borderRight:i%2===0?"1px solid #191913":"none",
                borderBottom:i<2?"1px solid #191913":"none",
              }}>
                <div style={{fontSize:8,letterSpacing:3,color:"#3a3a2e",marginBottom:6}}>{s.l}</div>
                <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:36,lineHeight:1,color:activity.color}}>{s.v}</div>
                <div style={{fontSize:8,color:"#2a2a1e",letterSpacing:2,marginTop:4}}>{s.u}</div>
              </div>
            ))}
          </div>

          <div style={{margin:"14px 24px",height:120,border:"1px solid #191913",background:"#080806",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:6,left:8,fontSize:7,letterSpacing:3,color:"#222218"}}>TRASA GPS</div>
            {lastPos && (
              <div style={{position:"absolute",top:6,right:8,fontSize:7,letterSpacing:1,color:"#222218"}}>
                {lastPos.lat.toFixed(4)}°N {lastPos.lon.toFixed(4)}°E
              </div>
            )}
            <RouteSVG points={gpsPoints} color={activity.color}/>
          </div>

          <div style={{display:"flex",gap:10,padding:"0 24px",marginBottom:16}}>
            {running && !paused ? (
              <>
                <button className="tap" onClick={()=>setPaused(true)}
                  style={{flex:1,border:"1px solid #3a3a2e",background:"transparent",padding:"18px",cursor:"pointer",color:"#FFD700",fontFamily:"Bebas Neue,sans-serif",fontSize:20,letterSpacing:3}}>
                  ⏸ PAUZA
                </button>
                <button className="tap" onClick={finishWorkout}
                  style={{flex:1,border:`1px solid ${activity.color}`,background:`${activity.color}18`,padding:"18px",cursor:"pointer",color:activity.color,fontFamily:"Bebas Neue,sans-serif",fontSize:20,letterSpacing:3}}>
                  ⏹ KONEC
                </button>
              </>
            ) : paused ? (
              <>
                <button className="tap" onClick={()=>setPaused(false)}
                  style={{flex:1,border:`1px solid ${activity.color}`,background:`${activity.color}18`,padding:"18px",cursor:"pointer",color:activity.color,fontFamily:"Bebas Neue,sans-serif",fontSize:20,letterSpacing:3}}>
                  ▶ POKRAČOVAT
                </button>
                <button className="tap" onClick={finishWorkout}
                  style={{flex:1,border:"1px solid #FF5C1A",background:"#FF5C1A18",padding:"18px",cursor:"pointer",color:"#FF5C1A",fontFamily:"Bebas Neue,sans-serif",fontSize:20,letterSpacing:3}}>
                  ⏹ STOP
                </button>
              </>
            ) : null}
          </div>
          <div style={{textAlign:"center",padding:"0 24px 40px"}}>
            <div style={{fontSize:8,color:"#1e1e16",letterSpacing:3}}>
              {gpsStatus==="denied" ? "KALORIE A ČAS BĚŽÍ BEZ GPS" : "GPS POLOHA SE VZORKUJE KAŽDOU SEKUNDU"}
            </div>
          </div>
        </div>
      )}

      {/* ══ SUMMARY ═══════════════════════════════════════════ */}
      {screen === "summary" && history[0] && (() => {
        const h = history[0];
        const act = ACTIVITIES.find(a=>a.id===h.actId);
        return (
          <div className="fadeup" style={{padding:"52px 24px 100px"}}>
            <div style={{fontSize:9,letterSpacing:4,color:"#3a3a2e",marginBottom:4}}>// SHRNUTÍ</div>
            <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:56,color:act?.color,lineHeight:1,marginBottom:36,letterSpacing:1}}>
              HOTOVO<span style={{color:"#E8E0C8"}}>.</span>
            </div>
            <div style={{border:"1px solid #1e1e16",marginBottom:20}}>
              {[
                {l:"AKTIVITA",           v:h.label},
                {l:"DATUM / ČAS",        v:`${h.date} · ${h.time}`},
                {l:"VZDÁLENOST",         v:`${(h.distanceM/1000).toFixed(3)} KM`},
                {l:"ČISTÝ ČAS",          v:fmtTime(h.duration)},
                {l:"PRŮMĚRNÁ RYCHLOST",  v:`${h.avgSpeedKmh} KM/H`},
                {l:"KALORIE",            v:`${h.calories} KCAL`},
              ].map((row,i)=>(
                <div key={i} style={{
                  display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"16px 18px",
                  borderBottom:i<5?"1px solid #111110":"none",
                }}>
                  <div style={{fontSize:8,letterSpacing:3,color:"#3a3a2e"}}>{row.l}</div>
                  <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:20,color:act?.color}}>{row.v}</div>
                </div>
              ))}
            </div>
            {h.points && h.points.length > 1 && (
              <div style={{border:"1px solid #191913",height:150,marginBottom:20,background:"#080806",position:"relative"}}>
                <div style={{position:"absolute",top:6,left:8,fontSize:7,letterSpacing:3,color:"#1e1e16"}}>ZAZNAMENANÁ TRASA</div>
                <RouteSVG points={h.points} color={act?.color||"#FF5C1A"}/>
              </div>
            )}
            <div style={{display:"flex",gap:10}}>
              <button className="tap" onClick={()=>setScreen("home")}
                style={{flex:1,border:"1px solid #2a2a1e",background:"transparent",padding:"18px",cursor:"pointer",color:"#E8E0C8",fontFamily:"Bebas Neue,sans-serif",fontSize:18,letterSpacing:3}}>
                ← DOMŮ
              </button>
              <button className="tap" onClick={()=>setScreen("history")}
                style={{flex:1,border:`1px solid ${act?.color}`,background:`${act?.color}18`,padding:"18px",cursor:"pointer",color:act?.color,fontFamily:"Bebas Neue,sans-serif",fontSize:18,letterSpacing:3}}>
                ZÁZNAMY ›
              </button>
            </div>
          </div>
        );
      })()}

      {/* ══ HISTORY ═══════════════════════════════════════════ */}
      {screen === "history" && (
        <div className="fadeup" style={{paddingBottom:100}}>
          <div style={{padding:"52px 24px 20px",borderBottom:"1px solid #191913"}}>
            <div style={{fontSize:9,letterSpacing:4,color:"#3a3a2e",marginBottom:4}}>{history.length} AKTIVIT CELKEM</div>
            <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:56,lineHeight:1}}>
              HISTO<span style={{color:"#FF5C1A"}}>RIE</span>
            </div>
          </div>
          {history.length === 0 && (
            <div style={{textAlign:"center",padding:60,color:"#2a2a1e",fontSize:12,letterSpacing:3}}>ŽÁDNÉ ZÁZNAMY.</div>
          )}
          {history.map(h => {
            const act = ACTIVITIES.find(a=>a.id===h.actId);
            return (
              <div key={h.id} style={{borderBottom:"1px solid #0e0e0c",padding:"16px 24px",display:"flex",gap:14,alignItems:"center"}}>
                <div style={{width:42,height:42,border:`1px solid ${h.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Bebas Neue,sans-serif",fontSize:20,color:h.color,flexShrink:0}}>
                  {h.icon}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:20,letterSpacing:1}}>{h.label}</div>
                  <div style={{fontSize:8,color:"#3a3a2e",letterSpacing:2}}>{h.date} · {h.time} · {fmtTime(h.duration)}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontFamily:"Bebas Neue,sans-serif",fontSize:22,color:h.color}}>{(h.distanceM/1000).toFixed(2)} <span style={{fontSize:11}}>KM</span></div>
                  <div style={{fontSize:8,color:"#3a3a2e",letterSpacing:2}}>{h.calories} KCAL</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══ BOTTOM NAV ════════════════════════════════════════ */}
      {(screen==="home"||screen==="history") && (
        <div style={{
          position:"fixed",bottom:0,
          left:"50%",transform:"translateX(-50%)",
          width:"100%",maxWidth:430,
          background:"#0C0C0A",
          borderTop:"1px solid #1a1a12",
          display:"flex",
        }}>
          {[
            {id:"home",    icon:"⬡", label:"DOMŮ"},
            {id:"history", icon:"≡", label:"ZÁZNAMY"},
          ].map(t=>(
            <button key={t.id} className="tap" onClick={()=>setScreen(t.id)}
              style={{
                flex:1,background:"none",border:"none",
                padding:"16px 0 calc(16px + env(safe-area-inset-bottom,0px))",
                cursor:"pointer",
                borderTop:screen===t.id?"2px solid #FF5C1A":"2px solid transparent",
                display:"flex",flexDirection:"column",alignItems:"center",gap:4,
              }}>
              <span style={{fontSize:20,color:screen===t.id?"#FF5C1A":"#2a2a1e"}}>{t.icon}</span>
              <span style={{fontFamily:"Share Tech,sans-serif",fontSize:8,letterSpacing:3,color:screen===t.id?"#FF5C1A":"#2a2a1e"}}>{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
