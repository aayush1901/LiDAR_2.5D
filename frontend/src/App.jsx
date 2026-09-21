import React, { useEffect, useRef, useState } from 'react';

export default function App() {
  const canvasRef = useRef(null);

  // Presentation Controls
  const [showCartesian, setShowCartesian] = useState(false);
  const showCartesianRef = useRef(showCartesian);

  // Sync state to ref so the WebSocket loop always has the latest value
  useEffect(() => {
    showCartesianRef.current = showCartesian;
  }, [showCartesian]);

  const VIEW_RADIUS_METERS = 42.0;
  const CANVAS_SIZE = 850;
  const PIXELS_PER_METER = CANVAS_SIZE / (VIEW_RADIUS_METERS * 2);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8765');
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event) => {
      if (!canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      const rawData = new Float32Array(event.data);
      const numCells = rawData.length / 4;

      // Clear background
      ctx.fillStyle = '#0b0c10';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Draw standard circular reference rings
      const drawRing = (radiusMeters, color) => {
        ctx.beginPath();
        ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, radiusMeters * PIXELS_PER_METER, 0, 2 * Math.PI);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
      };

      drawRing(10, 'rgba(255, 255, 255, 0.10)');
      drawRing(20, 'rgba(255, 255, 255, 0.10)');
      drawRing(40, 'rgba(255, 255, 255, 0.10)');

      // PRESENTATION MODE: Draw explicit Cartesian (Square) Boundaries & Grid
      if (showCartesianRef.current) {
        ctx.strokeStyle = 'rgba(255, 105, 180, 0.8)'; // Bright pink for boundaries
        ctx.lineWidth = 2;

        const drawSquareZone = (radiusMeters) => {
          const p = (VIEW_RADIUS_METERS - radiusMeters) * PIXELS_PER_METER;
          const w = (radiusMeters * 2) * PIXELS_PER_METER;
          ctx.strokeRect(p, p, w, w);
        };

        drawSquareZone(10); // Zone 1
        drawSquareZone(20); // Zone 2
        drawSquareZone(40); // Zone 3

        // Overlay a faint 1-meter structural matrix
        ctx.strokeStyle = 'rgba(255, 105, 180, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= CANVAS_SIZE; i += (1.0 * PIXELS_PER_METER)) {
          ctx.moveTo(i, 0); ctx.lineTo(i, CANVAS_SIZE);
          ctx.moveTo(0, i); ctx.lineTo(CANVAS_SIZE, i);
        }
        ctx.stroke();
      }

      for (let i = 0; i < numCells; i++) {
        const x = rawData[i * 4];
        const y = rawData[i * 4 + 1];
        const sizeMeters = rawData[i * 4 + 2];
        const label = rawData[i * 4 + 3];

        const pixelX = (x + VIEW_RADIUS_METERS) * PIXELS_PER_METER;
        const pixelY = (y + VIEW_RADIUS_METERS) * PIXELS_PER_METER;
        const pixelSize = Math.max(sizeMeters * PIXELS_PER_METER, 2.0);

        if (label >= 1 && label <= 5) ctx.fillStyle = '#ff2a2a';
        else if (label >= 6 && label <= 8) ctx.fillStyle = '#ffaa00';
        else if (label === 9 || label === 10) ctx.fillStyle = '#1c1f24';
        else if (label === 11) ctx.fillStyle = '#3a3f47';
        else if (label >= 15 && label <= 17) ctx.fillStyle = '#1e4726';
        else if (label === 13 || label === 14) ctx.fillStyle = '#6b5d4f';
        else ctx.fillStyle = '#4a4c52';

        ctx.fillRect(pixelX - pixelSize / 2, pixelY - pixelSize / 2, pixelSize, pixelSize);

        // Highlight high-density threat densification cells in pink
        if (showCartesianRef.current) {
          if (sizeMeters < 0.20 && (Math.abs(x) >= 10 || Math.abs(y) >= 10)) {
            ctx.strokeStyle = 'rgba(255, 105, 180, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(pixelX - pixelSize / 2, pixelY - pixelSize / 2, pixelSize, pixelSize);
          } else if (sizeMeters >= 0.5) {
            ctx.strokeStyle = 'rgba(255, 105, 180, 0.3)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(pixelX - pixelSize / 2, pixelY - pixelSize / 2, pixelSize, pixelSize);
          }
        } else if (sizeMeters >= 0.5) {
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(pixelX - pixelSize / 2, pixelY - pixelSize / 2, pixelSize, pixelSize);
        }
      }

      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(CANVAS_SIZE / 2 - 6, CANVAS_SIZE / 2 - 12, 12, 24);
    };

    return () => ws.close();
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

      {/* FLOATING CONTROL PANEL */}
      <div style={{
        position: 'absolute',
        top: '30px',
        right: '30px',
        backgroundColor: 'rgba(20, 22, 28, 0.95)',
        border: '1px solid #333',
        borderRadius: '12px',
        padding: '20px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        gap: '15px'
      }}>
        <h3 style={{ color: '#fff', margin: 0, fontFamily: 'sans-serif', fontSize: '16px' }}>Presentation Controls</h3>

        <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', color: '#ccc', fontFamily: 'sans-serif', fontSize: '14px' }}>
          <div style={{
            width: '44px',
            height: '24px',
            backgroundColor: showCartesian ? '#ff69b4' : '#333',
            borderRadius: '24px',
            position: 'relative',
            transition: 'background-color 0.3s'
          }}>
            <div style={{
              width: '18px',
              height: '18px',
              backgroundColor: '#fff',
              borderRadius: '50%',
              position: 'absolute',
              top: '3px',
              left: showCartesian ? '23px' : '3px',
              transition: 'left 0.3s'
            }} />
          </div>
          <input
            type="checkbox"
            checked={showCartesian}
            onChange={(e) => setShowCartesian(e.target.checked)}
            style={{ display: 'none' }}
          />
          Show Cartesian Architecture
        </label>
      </div>

      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        style={{
          border: '1px solid #333',
          transform: 'rotate(-90deg) scaleX(-1)',
          boxShadow: '0 0 40px rgba(0, 0, 0, 0.8)'
        }}
      />
    </div>
  );
}