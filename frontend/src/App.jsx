import React, { useEffect, useRef, useState } from 'react';

export default function App() {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const CANVAS_SIZE = 850; 
  
  const [showCartesian, setShowCartesian] = useState(false);
  const [enableTracking, setEnableTracking] = useState(false);
  const [zoomRadius, setZoomRadius] = useState(60.0); 
  
  const showCartesianRef = useRef(showCartesian);
  const zoomRadiusRef = useRef(zoomRadius);
  const lastFrameTime = useRef(performance.now());
  const smoothedFps = useRef(0);
  
  useEffect(() => { showCartesianRef.current = showCartesian; }, [showCartesian]);
  useEffect(() => { zoomRadiusRef.current = zoomRadius; }, [zoomRadius]);

  // Set the document title to your project name
  useEffect(() => {
    document.title = "Project Sanjay";
  }, []);

  const handleWheel = (e) => {
    setZoomRadius(prev => Math.max(10, Math.min(prev + (e.deltaY > 0 ? 5 : -5), 110)));
  };

  const handleTrackingToggle = (e) => {
    const checked = e.target.checked;
    setEnableTracking(checked);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(checked ? "TRACKING_ON" : "TRACKING_OFF");
    }
  };

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8765');
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (event) => {
      if (!canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      const rawBytes = event.data;
      const header = new Float32Array(rawBytes.slice(0, 40)); 
      const numTracks = header[9];

      const now = performance.now();
      const delta = now - lastFrameTime.current;
      lastFrameTime.current = now;
      const currentFps = 1000 / (delta || 1);
      smoothedFps.current = smoothedFps.current * 0.85 + currentFps * 0.15; 
      const displayFps = Math.min(smoothedFps.current, 55.0); 

      const fpsEl = document.getElementById('engine-fps');
      if (fpsEl) {
          fpsEl.innerText = `${displayFps.toFixed(1)} FPS`;
          fpsEl.style.color = displayFps > 35 ? '#00ffaa' : '#ffaa00';
      }

      for (let i = 0; i < 4; i++) {
          const frontEl = document.getElementById(`zone-${i}-front`);
          const rearEl = document.getElementById(`zone-${i}-rear`);
          if (frontEl) frontEl.innerText = `${header[i * 2].toFixed(2)}m`;
          if (rearEl) rearEl.innerText = `${header[i * 2 + 1].toFixed(2)}m`;
      }

      const trackOffset = 40;
      const trackBytesLen = numTracks * 6 * 4;
      const trackData = new Float32Array(rawBytes.slice(trackOffset, trackOffset + trackBytesLen));
      
      const cellDataOffset = trackOffset + trackBytesLen;
      const rawData = new Float32Array(rawBytes.slice(cellDataOffset));
      const numCells = rawData.length / 4;

      const rawPoints = 120000;
      const reduction = ((1 - (numCells / rawPoints)) * 100).toFixed(1);
      const memKB = (numCells * 16 / 1024).toFixed(1);
      const latencyMs = delta.toFixed(1);

      const ptsEl = document.getElementById('perf-points');
      if (ptsEl) ptsEl.innerText = `Points: 120k → ${numCells} (-${reduction}%)`;
      const memEl = document.getElementById('perf-memory');
      if (memEl) memEl.innerText = `Payload: 1.92 MB → ${memKB} KB`;
      const latEl = document.getElementById('perf-latency');
      if (latEl) latEl.innerText = `Network Latency: ${latencyMs} ms`;

      const currentRadius = zoomRadiusRef.current;
      const PIXELS_PER_METER = CANVAS_SIZE / (currentRadius * 2);

      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      const drawRing = (radiusMeters, color) => {
        ctx.beginPath(); ctx.arc(CANVAS_SIZE/2, CANVAS_SIZE/2, radiusMeters * PIXELS_PER_METER, 0, 2 * Math.PI);
        ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
      };
      
      drawRing(10, 'rgba(255, 255, 255, 0.05)');
      drawRing(20, 'rgba(255, 255, 255, 0.05)');
      drawRing(40, 'rgba(255, 255, 255, 0.05)');

      if (showCartesianRef.current) {
        ctx.strokeStyle = 'rgba(255, 48, 144, 0.7)'; 
        ctx.lineWidth = 1.5;
        const drawSquareZone = (radiusMeters) => {
          const cornerX = Math.floor((-radiusMeters + currentRadius) * PIXELS_PER_METER);
          const width = Math.floor((radiusMeters * 2) * PIXELS_PER_METER);
          ctx.strokeRect(cornerX, cornerX, width, width);
        };
        drawSquareZone(10); drawSquareZone(20); drawSquareZone(40); drawSquareZone(100); 

        ctx.strokeStyle = 'rgba(255, 48, 144, 0.15)'; ctx.lineWidth = 1; ctx.beginPath();
        const startGrid = Math.floor(-currentRadius);
        for (let i = startGrid; i <= currentRadius; i += 1.0) {
          const p = Math.floor((i + currentRadius) * PIXELS_PER_METER);
          ctx.moveTo(p, 0); ctx.lineTo(p, CANVAS_SIZE);
          ctx.moveTo(0, p); ctx.lineTo(CANVAS_SIZE, p);
        }
        ctx.stroke();
      }

      for (let i = 0; i < numCells; i++) {
        const x = rawData[i * 4], y = rawData[i * 4 + 1], sizeMeters = rawData[i * 4 + 2], label = rawData[i * 4 + 3];
        const pixelX = (x + currentRadius) * PIXELS_PER_METER, pixelY = (y + currentRadius) * PIXELS_PER_METER;
        let pixelSize = sizeMeters * PIXELS_PER_METER; 
        let isVRU = false, isThreat = false;

        if (label === 20) { ctx.fillStyle = '#00bfff'; isThreat = true; pixelSize = Math.max(pixelSize, 4.0); }
        else if (label === 21) { ctx.fillStyle = '#a855f7'; isThreat = true; pixelSize = Math.max(pixelSize, 4.0); }
        else if (label >= 1 && label <= 5) { ctx.fillStyle = '#ff0000'; isThreat = true; pixelSize = Math.max(pixelSize, 4.5); }
        else if (label >= 6 && label <= 8) { ctx.fillStyle = '#ff00ff'; isVRU = true; isThreat = true; pixelSize = Math.max(pixelSize, 5.0); }
        else if (label === 9 || label === 10) { ctx.fillStyle = '#cccccc'; pixelSize = Math.max(pixelSize, 1.5); }
        else if (label === 11) { ctx.fillStyle = '#ffffff'; pixelSize = Math.max(pixelSize, 1.5); }
        else if (label >= 15 && label <= 17) { ctx.fillStyle = '#1e4726'; pixelSize = Math.max(pixelSize, 1.5); }
        else if (label === 13 || label === 14) { ctx.fillStyle = '#8b6c4c'; pixelSize = Math.max(pixelSize, 1.5); } 
        else { ctx.fillStyle = '#2a3441'; pixelSize = Math.max(pixelSize, 1.5); }

        const drawX = Math.floor(pixelX - pixelSize/2), drawY = Math.floor(pixelY - pixelSize/2);
        ctx.fillRect(drawX, drawY, pixelSize, pixelSize);

        if (showCartesianRef.current && !isThreat) {
          ctx.strokeStyle = sizeMeters <= 0.20 ? 'rgba(255, 48, 144, 0.4)' : 'rgba(255, 48, 144, 0.7)';
          ctx.lineWidth = sizeMeters <= 0.20 ? 0.5 : 1.0;
          ctx.strokeRect(drawX, drawY, pixelSize, pixelSize);
        }
        if (isVRU) {
            ctx.strokeStyle = '#0066ff'; ctx.lineWidth = 1.5;
            ctx.strokeRect(drawX - 2, drawY - 2, pixelSize + 4, pixelSize + 4);
        }
      }

      const maxTracks = Math.min(numTracks, 35);

      for (let t = 0; t < maxTracks; t++) {
        const tx = trackData[t * 6 + 1], ty = trackData[t * 6 + 2];
        const distMeters = Math.hypot(tx, ty);

        if (distMeters < 10.0 || distMeters > 40.0) continue;

        const tvx = trackData[t * 6 + 3], tvy = trackData[t * 6 + 4], isRisk = trackData[t * 6 + 5] === 1;

        const pixelX = (tx + currentRadius) * PIXELS_PER_METER;
        const pixelY = (ty + currentRadius) * PIXELS_PER_METER;
        
        ctx.strokeStyle = isRisk ? 'rgba(255, 42, 42, 0.8)' : 'rgba(0, 255, 170, 0.6)'; 
        ctx.lineWidth = isRisk ? 2.0 : 1.2;
        ctx.strokeRect(pixelX - 10, pixelY - 10, 20, 20);
        
        const endX = pixelX + (tvx * PIXELS_PER_METER);
        const endY = pixelY + (tvy * PIXELS_PER_METER);
        
        ctx.strokeStyle = '#ff8800';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(pixelX, pixelY);
        ctx.lineTo(endX, endY);
        
        const angle = Math.atan2(tvy, tvx);
        const headLength = 6;
        ctx.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
        
        const speedMs = Math.hypot(tvx, tvy) * 10;
        const isApproaching = (tx * tvx + ty * tvy) < 0; 
        
        if (speedMs > 0.5 && isApproaching) {
            const ttc = distMeters / speedMs;
            
            ctx.save();
            ctx.translate(pixelX + 14, pixelY - 14);
            ctx.scale(-1, 1);
            ctx.rotate(90 * Math.PI / 180);
            
            ctx.fillStyle = isRisk ? '#ff2a2a' : '#ff8800';
            ctx.font = 'bold 12px monospace';
            ctx.fillText(ttc < 10 ? `TTC:${ttc.toFixed(1)}s` : "TTC:>10s", 0, 0);
            
            ctx.restore();
        }
      }

      const cx = CANVAS_SIZE / 2;
      const cy = CANVAS_SIZE / 2;
      
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = '#0f172a'; 
      ctx.strokeStyle = '#00e5ff'; 
      ctx.lineWidth = 1.5;
      
      ctx.beginPath();
      ctx.roundRect(-14, -7, 28, 14, 4); 
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = '#38bdf8'; 
      ctx.beginPath();
      ctx.roundRect(0, -5, 6, 10, 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.fillRect(12, -6, 2, 3);
      ctx.fillRect(12, 3, 2, 3);
      
      ctx.restore();
    };

    return () => ws.close();
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: 'radial-gradient(circle at center, #0a0e17 0%, #020203 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      
      {/* Project Sanjay Logo & Title */}
      <div style={{ position: 'absolute', top: '24px', left: '30px', display: 'flex', alignItems: 'center', gap: '12px', zIndex: 100, background: 'linear-gradient(135deg, rgba(15, 17, 21, 0.9) 0%, rgba(20, 25, 35, 0.8) 100%)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0, 229, 255, 0.2)', borderRadius: '12px', padding: '12px 20px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
        <img src="/favicon.svg" alt="Project Sanjay Logo" style={{ width: '28px', height: '28px', borderRadius: '6px' }} />
        <h1 style={{ color: '#00e5ff', margin: 0, fontFamily: 'sans-serif', fontSize: '18px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Project Sanjay</h1>
      </div>

      {/* Telemetry Left Panel (Moved down to accommodate the logo) */}
      <div style={{ position: 'absolute', top: '90px', left: '30px', width: '200px', background: 'linear-gradient(135deg, rgba(15, 17, 21, 0.9) 0%, rgba(20, 25, 35, 0.8) 100%)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0, 229, 255, 0.2)', borderRadius: '16px', padding: '24px', boxShadow: '0 12px 40px rgba(0,0,0,0.8), inset 0 0 20px rgba(0, 229, 255, 0.05)', zIndex: 100, color: '#e2e8f0', fontFamily: 'monospace' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px', marginBottom: '18px' }}>
          <h3 style={{ color: '#fff', margin: 0, fontFamily: 'sans-serif', fontSize: '16px', fontWeight: '600' }}>Telemetry</h3>
          <span id="engine-fps" style={{ fontWeight: 'bold', background: 'rgba(0, 255, 170, 0.1)', padding: '4px 8px', borderRadius: '6px' }}>-- FPS</span>
        </div>
        
        {['10m', '20m', '40m', '100m'].map((zone, idx) => (
          <div key={zone} style={{ marginBottom: '14px' }}>
            <div style={{ color: '#00e5ff', fontWeight: 'bold', marginBottom: '8px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '1px' }}>Zone {zone} Matrix</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', background: 'rgba(0, 0, 0, 0.4)', padding: '8px', borderRadius: '6px', marginBottom: '4px', borderLeft: '2px solid #00e5ff' }}>
              <span style={{ color: '#94a3b8' }}>Front (+X):</span> <span id={`zone-${idx}-front`} style={{ fontWeight: 'bold' }}>0.00m</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', background: 'rgba(0, 0, 0, 0.4)', padding: '8px', borderRadius: '6px', borderLeft: '2px solid #38bdf8' }}>
              <span style={{ color: '#94a3b8' }}>Rear (-X):</span> <span id={`zone-${idx}-rear`} style={{ fontWeight: 'bold' }}>0.00m</span>
            </div>
          </div>
        ))}
      </div>

      {/* Perception Controls & Efficiency Right Panel */}
      <div style={{ position: 'absolute', top: '30px', right: '30px', display: 'flex', flexDirection: 'column', gap: '20px', zIndex: 100 }}>
        <div style={{ width: '280px', background: 'linear-gradient(135deg, rgba(15, 17, 21, 0.9) 0%, rgba(20, 25, 35, 0.8) 100%)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0, 229, 255, 0.2)', borderRadius: '16px', padding: '24px', boxShadow: '0 12px 40px rgba(0,0,0,0.8), inset 0 0 20px rgba(0, 229, 255, 0.05)', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <h3 style={{ color: '#fff', margin: 0, fontFamily: 'sans-serif', fontSize: '16px', fontWeight: '600', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>Perception Engine</h3>
          <div style={{ color: '#38bdf8', fontFamily: 'monospace', fontSize: '14px', background: 'rgba(56, 189, 248, 0.1)', padding: '8px 12px', borderRadius: '6px' }}>
            Scale Range: ±{zoomRadius}m
          </div>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer', color: '#e2e8f0', fontFamily: 'sans-serif', fontSize: '14px' }}>
            <div style={{ width: '44px', height: '24px', backgroundColor: showCartesian ? '#ff3055' : 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px', position: 'relative', transition: 'all 0.3s' }}>
              <div style={{ width: '16px', height: '16px', backgroundColor: '#fff', borderRadius: '50%', position: 'absolute', top: '3px', left: showCartesian ? '23px' : '3px', transition: 'left 0.3s', boxShadow: '0 2px 4px rgba(0,0,0,0.4)' }} />
            </div>
            <input type="checkbox" checked={showCartesian} onChange={(e) => setShowCartesian(e.target.checked)} style={{ display: 'none' }} />
            Cartesian Foveation
          </label>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer', color: '#e2e8f0', fontFamily: 'sans-serif', fontSize: '14px' }}>
            <div style={{ width: '44px', height: '24px', backgroundColor: enableTracking ? '#00ffaa' : 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px', position: 'relative', transition: 'all 0.3s', boxShadow: enableTracking ? '0 0 10px rgba(0,255,170,0.4)' : 'none' }}>
              <div style={{ width: '16px', height: '16px', backgroundColor: '#fff', borderRadius: '50%', position: 'absolute', top: '3px', left: enableTracking ? '23px' : '3px', transition: 'left 0.3s', boxShadow: '0 2px 4px rgba(0,0,0,0.4)' }} />
            </div>
            <input type="checkbox" checked={enableTracking} onChange={handleTrackingToggle} style={{ display: 'none' }} />
            Enable Risk Tracking
          </label>
        </div>

        <div style={{ width: '280px', background: 'linear-gradient(135deg, rgba(15, 17, 21, 0.9) 0%, rgba(20, 25, 35, 0.8) 100%)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0, 229, 255, 0.2)', borderRadius: '16px', padding: '24px', boxShadow: '0 12px 40px rgba(0,0,0,0.8), inset 0 0 20px rgba(0, 229, 255, 0.05)' }}>
          <h3 style={{ color: '#fff', margin: 0, fontFamily: 'sans-serif', fontSize: '16px', fontWeight: '600', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px', marginBottom: '16px' }}>Pipeline Efficiency</h3>
          <div id="perf-points" style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: '13px', marginBottom: '10px', background: 'rgba(0,0,0,0.3)', padding: '6px', borderRadius: '4px' }}>Points: --</div>
          <div id="perf-memory" style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: '13px', marginBottom: '10px', background: 'rgba(0,0,0,0.3)', padding: '6px', borderRadius: '4px' }}>Payload: --</div>
          <div id="perf-latency" style={{ color: '#00ffaa', fontFamily: 'monospace', fontSize: '13px', background: 'rgba(0, 255, 170, 0.1)', padding: '6px', borderRadius: '4px', borderLeft: '2px solid #00ffaa' }}>Network Latency: --</div>
        </div>
      </div>
      {/* Color Classification Legend Box - Arranged in a single horizontal row at the bottom */}
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '56%',
          transform: 'translateX(-50%)',
          maxWidth: 'calc(100vw - 80px)',
          background: 'rgba(3, 10, 20, 0.92)',
          border: '1.5px solid #1a4968',
          borderRadius: '10px',
          padding: '10px 16px',
          boxSizing: 'border-box',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8), 0 0 15px rgba(0, 229, 255, 0.08)',
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '14px',
          zIndex: 100,
          fontFamily: "'Segoe UI', -apple-system, Roboto, sans-serif",
          overflowX: 'auto',
        }}
      >
        {/* Car / Truck / Bike */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{ width: '12px', height: '12px', backgroundColor: '#FF0000', display: 'inline-block', flexShrink: 0, borderRadius: '2px' }} />
          <span style={{ color: '#ffffff', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap' }}>Car / Truck / Bike</span>
        </div>

        {/* Building */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{ width: '12px', height: '12px', backgroundColor: '#FFDD00', display: 'inline-block', flexShrink: 0, borderRadius: '2px' }} />
          <span style={{ color: '#ffffff', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap' }}>Building</span>
        </div>

        {/* Pedestrian + Bicycle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{ width: '12px', height: '12px', backgroundColor: '#0080FF', display: 'inline-block', flexShrink: 0, borderRadius: '2px' }} />
          <span style={{ color: '#ffffff', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap' }}>Pedestrian + Bicycle</span>
        </div>

        {/* Road */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{ width: '12px', height: '12px', backgroundColor: '#9ea8b6', display: 'inline-block', flexShrink: 0, borderRadius: '2px' }} />
          <span style={{ color: '#ffffff', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap' }}>Road</span>
        </div>

        {/* Vegetation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{ width: '12px', height: '12px', backgroundColor: '#138808', display: 'inline-block', flexShrink: 0, borderRadius: '2px' }} />
          <span style={{ color: '#ffffff', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap' }}>Vegetation</span>
        </div>

        {/* Pothole Candidate */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{ width: '12px', height: '12px', backgroundColor: '#00bfff', display: 'inline-block', flexShrink: 0, borderRadius: '2px' }} />
          <span style={{ color: '#ffffff', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap' }}>Pothole Candidate</span>
        </div>

        {/* Curb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{ width: '12px', height: '12px', backgroundColor: '#9b26ff', display: 'inline-block', flexShrink: 0, borderRadius: '2px' }} />
          <span style={{ color: '#ffffff', fontSize: '11px', fontWeight: '500', whiteSpace: 'nowrap' }}>Curb</span>
        </div>
      </div>

      {/* Main LiDAR 2.5D Canvas */}
      <canvas 
        ref={canvasRef} 
        width={CANVAS_SIZE} 
        height={CANVAS_SIZE} 
        onWheel={handleWheel} 
        style={{ 
          borderRadius: '50%', 
          border: '2px solid rgba(0, 229, 255, 0.15)', 
          transform: 'rotate(-90deg) scaleX(-1)', 
          boxShadow: '0 0 100px rgba(0, 229, 255, 0.05)', 
          cursor: 'ns-resize' 
        }} 
      />
    </div>
  );
}