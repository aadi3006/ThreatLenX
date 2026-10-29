'use client';
import {useState,useEffect,useRef} from 'react';
import {Activity,Cpu,Database,Globe,Lock,Server,Shield,Wifi,Zap,ArrowUpRight,MoreHorizontal,Settings,Bell,ChevronsUpDown,Play,Pause,RefreshCw,AlertTriangle,Clock,Terminal,HardDrive,Thermometer,Volume2,Power} from 'lucide-react';

interface DashboardData{
 cpu: number;
 memory: number;
 network: number;
 security: number;
 activeNodes: number;
 threatsBlocked: number;
 dataThroughput: number;
 systemStatus: string;
 temperature: number;
 powerUsage: number;
 uptime: number;
 diskUsage: number;
 alerts: number;
}

interface LogEntry{
 timestamp: string;
 level: 'info'|'warning'|'error'|'success';
 message: string;
}

export default function CyberDashboard(){
 const [data,setData]=useState<DashboardData>({
  cpu:45,
  memory:62,
  network:78,
  security:95,
  activeNodes:142,
  threatsBlocked:8923,
  dataThroughput:4.7,
  systemStatus:'OPTIMAL',
  temperature:42,
  powerUsage:340,
  uptime:0,
  diskUsage:67,
  alerts:3
 });

 const [selectedPanel,setSelectedPanel]=useState<string|null>(null);
 const [isPaused,setIsPaused]=useState(false);
 const [logs,setLogs]=useState<LogEntry[]>([]);
 const [selectedRegion,setSelectedRegion]=useState<string>('');
 const [showAdvanced,setShowAdvanced]=useState(false);
 const logsEndRef=useRef<HTMLDivElement>(null);

 useEffect(()=>{
  if(isPaused)return;
  
  const interval=setInterval(()=>{
   setData(prev=>({
    ...prev,
    cpu:Math.max(20,Math.min(90,prev.cpu+(Math.random()-0.5)*10)),
    memory:Math.max(30,Math.min(85,prev.memory+(Math.random()-0.5)*8)),
    network:Math.max(40,Math.min(95,prev.network+(Math.random()-0.5)*15)),
    security:Math.max(80,Math.min(100,prev.security+(Math.random()-0.5)*3)),
    activeNodes:prev.activeNodes+Math.floor((Math.random()-0.5)*5),
    threatsBlocked:prev.threatsBlocked+Math.floor(Math.random()*3),
    dataThroughput:Math.max(1,Math.min(10,prev.dataThroughput+(Math.random()-0.5)*2)),
    temperature:Math.max(35,Math.min(75,prev.temperature+(Math.random()-0.5)*2)),
    powerUsage:Math.max(250,Math.min(450,prev.powerUsage+(Math.random()-0.5)*20)),
    uptime:prev.uptime+1,
    diskUsage:Math.max(50,Math.min(85,prev.diskUsage+(Math.random()-0.5)*0.5)),
    alerts:Math.max(0,prev.alerts+Math.floor((Math.random()-0.5)*0.3))
   }));
  },2000);

  return()=>clearInterval(interval);
 },[isPaused]);

 useEffect(()=>{
  const interval=setInterval(()=>{
   const newLog:LogEntry={
    timestamp:new Date().toLocaleTimeString(),
    level:Math.random()>0.7?'info':Math.random()>0.5?'warning':Math.random()>0.3?'error':'success',
    message:[
     'System scan completed',
     'Network traffic spike detected',
     'Security protocol updated',
     'Node connection established',
     'Data synchronization complete',
     'Threat neutralized',
     'Backup process initiated',
     'Memory optimization performed',
     'CPU threshold warning',
     'Firewall rule updated'
    ][Math.floor(Math.random()*10)]
   };
   setLogs(prev=>[...prev.slice(-19),newLog]);
  },3000);

  return()=>clearInterval(interval);
 },[]);

 useEffect(()=>{
  logsEndRef.current?.scrollIntoView({behavior:'smooth'});
 },[logs]);

 const formatUptime=(seconds:number)=>{
  const hrs=Math.floor(seconds/3600);
  const mins=Math.floor((seconds%3600)/60);
  const secs=seconds%60;
  return `${hrs}h ${mins}m ${secs}s`;
 };

 const StatCard=({icon:Icon,label,value,unit,color,onClick,trend}:{
  icon:typeof Activity;
  label: string;
  value: number;
  unit: string;
  color: string;
  onClick?: ()=>void;
  trend?: 'up'|'down'|'stable';
 })=>(
  <div 
   className={`stat-card ${selectedPanel===label?'selected':''}`}
   onClick={onClick}
   style={{borderColor:color}}
  >
   <div className="stat-icon" style={{color}}>
    <Icon size={18}/>
   </div>
   <div className="stat-content">
    <span className="stat-label">{label}</span>
    <span className="stat-value" style={{color}}>
     {value.toFixed(1)}{unit}
    </span>
    {trend && (
     <span className={`stat-trend ${trend}`}>
      {trend==='up'?'↑':trend==='down'?'↓':'→'}
     </span>
    )}
   </div>
  </div>
 );

 const SystemBar=({label,value,color,max=100,warningThreshold=80}:{
  label: string;
  value: number;
  color: string;
  max?: number;
  warningThreshold?: number;
 })=>(
  <div className="system-bar">
   <span className="bar-label">{label}</span>
   <div className="bar-track">
    <div 
     className={`bar-fill ${value>warningThreshold?'warning':''}`} 
     style={{width:`${(value/max)*100}%`,backgroundColor:value>warningThreshold?'#ff6600':color}}
    />
   </div>
   <span className="bar-value">{Math.round(value)}%</span>
  </div>
 );

 const DataStream=({label,values,color,animated=true}:{label:string;values:number[];color:string;animated?:boolean})=>(
  <div className="data-stream">
   <span className="stream-label">{label}</span>
   <div className="stream-graph">
    {values.map((v,i)=>(
     <div 
      key={i}
      className={`stream-bar ${animated?'animated':''}`}
      style={{
       height:`${v}%`,
       backgroundColor:color,
       opacity:0.3+(i/values.length)*0.7,
       animationDelay:`${i*50}ms`
      }}
     />
    ))}
   </div>
  </div>
 );

 const LogItem=({log}:{log:LogEntry})=>{
  const levelColors={
   info:'#00ffff',
   warning:'#ffff00',
   error:'#ff6600',
   success:'#00ff00'
  };
  return(
   <div className="log-item">
    <span className="log-time">{log.timestamp}</span>
    <span className="log-level" style={{color:levelColors[log.level]}}>{log.level.toUpperCase()}</span>
    <span className="log-message">{log.message}</span>
   </div>
  );
 };

 // Generate dynamic data for streams
 const [cpuHistory,setCpuHistory]=useState(Array.from({length:30},()=>30+Math.random()*50));
 const [networkHistory,setNetworkHistory]=useState(Array.from({length:30},()=>20+Math.random()*60));

 useEffect(()=>{
  if(isPaused)return;
  const interval=setInterval(()=>{
   setCpuHistory(prev=>[...prev.slice(1),30+Math.random()*50]);
   setNetworkHistory(prev=>[...prev.slice(1),20+Math.random()*60]);
  },1000);
  return()=>clearInterval(interval);
 },[isPaused]);

 const handleAction=(action:string)=>{
  const newLog:LogEntry={
   timestamp:new Date().toLocaleTimeString(),
   level:'success',
   message:`Action executed: ${action}`
  };
  setLogs(prev=>[...prev.slice(-19),newLog]);
 };

 return (
  <div className="cyber-dashboard">
   <div className="dashboard-header">
    <h2>SYSTEM DASHBOARD</h2>
    <div className="header-controls">
     <button 
      className={`control-btn ${isPaused?'paused':''}`}
      onClick={()=>setIsPaused(!isPaused)}
      title={isPaused?'Resume updates':'Pause updates'}
     >
      {isPaused?<Play size={14}/>:<Pause size={14}/>}
     </button>
     <button 
      className="control-btn"
      onClick={()=>setShowAdvanced(!showAdvanced)}
      title="Toggle advanced view"
     >
      <Settings size={14}/>
     </button>
     <div className="status-indicator" style={{color:data.systemStatus==='OPTIMAL'?'#00ff00':'#ff6600'}}>
      <div className="status-dot"/>
      {data.systemStatus}
     </div>
    </div>
   </div>

   <div className="dashboard-grid">
    {/* Main Stats */}
    <div className="stats-row">
     <StatCard 
      icon={Cpu} 
      label="CPU" 
      value={data.cpu} 
      unit="%" 
      color="#00ffff"
      onClick={()=>setSelectedPanel(selectedPanel==='CPU'?null:'CPU')}
      trend={data.cpu>70?'up':data.cpu<30?'down':'stable'}
     />
     <StatCard 
      icon={Database} 
      label="Memory" 
      value={data.memory} 
      unit="%" 
      color="#ff00ff"
      onClick={()=>setSelectedPanel(selectedPanel==='Memory'?null:'Memory')}
      trend={data.memory>75?'up':'stable'}
     />
     <StatCard 
      icon={Wifi} 
      label="Network" 
      value={data.network} 
      unit="%" 
      color="#00ff00"
      onClick={()=>setSelectedPanel(selectedPanel==='Network'?null:'Network')}
      trend="stable"
     />
     <StatCard 
      icon={Shield} 
      label="Security" 
      value={data.security} 
      unit="%" 
      color="#ffff00"
      onClick={()=>setSelectedPanel(selectedPanel==='Security'?null:'Security')}
      trend="up"
     />
    </div>

    {/* System Performance */}
    <div className="panel performance-panel">
     <div className="panel-header">
      <h3>PERFORMANCE</h3>
      <button className="panel-action"><MoreHorizontal size={14}/></button>
     </div>
     <div className="performance-bars">
      <SystemBar label="CPU Load" value={data.cpu} color="#00ffff" warningThreshold={80}/>
      <SystemBar label="Memory Usage" value={data.memory} color="#ff00ff" warningThreshold={85}/>
      <SystemBar label="Network I/O" value={data.network} color="#00ff00" warningThreshold={90}/>
      <SystemBar label="Security Level" value={data.security} color="#ffff00" warningThreshold={95}/>
     </div>
    </div>

    {/* Network Activity */}
    <div className="panel network-panel">
     <div className="panel-header">
      <h3>NETWORK ACTIVITY</h3>
      <button className="panel-action"><MoreHorizontal size={14}/></button>
     </div>
     <div className="network-stats">
      <div className="network-item">
       <Globe size={16} className="network-icon"/>
       <div className="network-info">
        <span className="network-label">Active Nodes</span>
        <span className="network-value">{data.activeNodes}</span>
       </div>
      </div>
      <div className="network-item">
       <Server size={16} className="network-icon"/>
       <div className="network-info">
        <span className="network-label">Data Throughput</span>
        <span className="network-value">{data.dataThroughput.toFixed(1)} GB/s</span>
       </div>
      </div>
      <div className="network-item">
       <Lock size={16} className="network-icon"/>
       <div className="network-info">
        <span className="network-label">Threats Blocked</span>
        <span className="network-value">{data.threatsBlocked.toLocaleString()}</span>
       </div>
      </div>
     </div>
     <DataStream label="Traffic History" values={networkHistory} color="#00ff00"/>
    </div>

    {/* System Health */}
    <div className="panel health-panel">
     <div className="panel-header">
      <h3>SYSTEM HEALTH</h3>
      <button className="panel-action"><MoreHorizontal size={14}/></button>
     </div>
     <div className="health-stats">
      <div className="health-item">
       <Thermometer size={16} className="health-icon"/>
       <div className="health-info">
        <span className="health-label">Temperature</span>
        <span className="health-value" style={{color:data.temperature>70?'#ff6600':'#00ff00'}}>
         {data.temperature.toFixed(1)}°C
        </span>
       </div>
      </div>
      <div className="health-item">
       <Power size={16} className="health-icon"/>
       <div className="health-info">
        <span className="health-label">Power Usage</span>
        <span className="health-value">{data.powerUsage.toFixed(0)}W</span>
       </div>
      </div>
      <div className="health-item">
       <HardDrive size={16} className="health-icon"/>
       <div className="health-info">
        <span className="health-label">Disk Usage</span>
        <span className="health-value" style={{color:data.diskUsage>80?'#ff6600':'#00ff00'}}>
         {data.diskUsage.toFixed(1)}%
        </span>
       </div>
      </div>
      <div className="health-item">
       <Clock size={16} className="health-icon"/>
       <div className="health-info">
        <span className="health-label">Uptime</span>
        <span className="health-value">{formatUptime(data.uptime)}</span>
       </div>
      </div>
     </div>
    </div>

    {/* Alerts Panel */}
    <div className="panel alerts-panel">
     <div className="panel-header">
      <h3>ALERTS</h3>
      <div className="alert-badge" style={{backgroundColor:data.alerts>0?'#ff6600':'#00ff00'}}>
       {data.alerts}
      </div>
     </div>
     <div className="alerts-list">
      {data.alerts>0?(
       <>
        <div className="alert-item warning">
         <AlertTriangle size={12} className="alert-icon"/>
         <span>High CPU usage detected</span>
        </div>
        <div className="alert-item info">
         <Bell size={12} className="alert-icon"/>
         <span>Security update available</span>
        </div>
        <div className="alert-item success">
         <Shield size={12} className="alert-icon"/>
         <span>Backup completed successfully</span>
        </div>
       </>
      ):(
       <div className="no-alerts">
        <Shield size={24} className="no-alerts-icon"/>
        <span>All systems nominal</span>
       </div>
      )}
     </div>
    </div>

    {/* Quick Actions */}
    <div className="panel actions-panel">
     <div className="panel-header">
      <h3>QUICK ACTIONS</h3>
     </div>
     <div className="action-buttons">
      <button className="action-btn primary" onClick={()=>handleAction('System Scan')}>
       <Zap size={14}/>
       <span>System Scan</span>
      </button>
      <button className="action-btn secondary" onClick={()=>handleAction('Security Audit')}>
       <Shield size={14}/>
       <span>Security Audit</span>
      </button>
      <button className="action-btn tertiary" onClick={()=>handleAction('Diagnostics')}>
       <Activity size={14}/>
       <span>Diagnostics</span>
      </button>
      <button className="action-btn quaternary" onClick={()=>handleAction('View Logs')}>
       <Terminal size={14}/>
       <span>View Logs</span>
      </button>
     </div>
    </div>

    {/* Data Streams */}
    <div className="panel streams-panel">
     <div className="panel-header">
      <h3>DATA STREAMS</h3>
      <button className="panel-action" onClick={()=>{setCpuHistory(Array.from({length:30},()=>30+Math.random()*50));setNetworkHistory(Array.from({length:30},()=>20+Math.random()*60));}}>
       <RefreshCw size={14}/>
      </button>
     </div>
     <DataStream label="CPU History" values={cpuHistory} color="#00ffff"/>
     <DataStream label="Network History" values={networkHistory} color="#00ff00"/>
    </div>

    {/* System Logs */}
    <div className="panel logs-panel">
     <div className="panel-header">
      <h3>SYSTEM LOGS</h3>
      <button className="panel-action" onClick={()=>setLogs([])}>
       <Volume2 size={14}/>
      </button>
     </div>
     <div className="logs-container">
      {logs.length===0?(
       <div className="no-logs">No recent activity</div>
      ):(
       logs.map((log,i)=>(
        <LogItem key={i} log={log}/>
       ))
      )}
      <div ref={logsEndRef}/>
     </div>
    </div>

    {/* Advanced Controls */}
    {showAdvanced && (
     <div className="panel advanced-panel">
      <div className="panel-header">
       <h3>ADVANCED CONTROLS</h3>
       <button className="panel-action" onClick={()=>setShowAdvanced(false)}>
        <ChevronsUpDown size={14}/>
       </button>
      </div>
      <div className="advanced-controls">
       <div className="advanced-item">
        <span className="advanced-label">Region Selection</span>
        <select 
         className="advanced-select"
         value={selectedRegion}
         onChange={(e)=>setSelectedRegion(e.target.value)}
        >
         <option value="">Global</option>
         <option value="us-east">US East</option>
         <option value="us-west">US West</option>
         <option value="eu-central">EU Central</option>
         <option value="asia-pacific">Asia Pacific</option>
        </select>
       </div>
       <div className="advanced-item">
        <span className="advanced-label">Update Frequency</span>
        <select className="advanced-select">
         <option value="1000">1 second</option>
         <option value="2000" selected>2 seconds</option>
         <option value="5000">5 seconds</option>
         <option value="10000">10 seconds</option>
        </select>
       </div>
       <div className="advanced-item">
        <span className="advanced-label">Logging Level</span>
        <select className="advanced-select">
         <option value="all">All</option>
         <option value="info">Info+</option>
         <option value="warning">Warning+</option>
         <option value="error">Error only</option>
        </select>
       </div>
      </div>
     </div>
    )}
   </div>
  </div>
 );
}