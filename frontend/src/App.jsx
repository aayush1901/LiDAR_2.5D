import React, { useEffect, useRef } from 'react';

export default function App() {
  const canvasRef = useRef(null);
  const GRID_SIZE = 500;

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8765');
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event) => {
      if (!canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      
      // The incoming buffer is a flat array of RGBA bytes
      const rawBytes = new Uint8ClampedArray(event.data);
      const imageData = new ImageData(rawBytes, GRID_SIZE, GRID_SIZE);
      
      // Paint directly to the canvas
      ctx.putImageData(imageData, 0, 0);
    };

    return () => ws.close();
  }, []);

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      backgroundColor: '#111',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      color: 'white',
      fontFamily: 'sans-serif'
    }}>
      <h2>Live Drivability Map (Bird's Eye View)</h2>
      
      {/* 
        CSS Transform rotates the array so the vehicle points UP visually, 
        matching standard navigation intuition without complex Python math.
      */}
      <canvas 
        ref={canvasRef} 
        width={GRID_SIZE} 
        height={GRID_SIZE} 
        style={{ 
          border: '2px solid #333', 
          backgroundColor: 'black',
          transform: 'rotate(-90deg) scaleX(-1)',
          boxShadow: '0px 0px 30px rgba(0, 255, 0, 0.15)'
        }} 
      />
      
      <div style={{ marginTop: '20px', display: 'flex', gap: '30px', fontSize: '1.2rem' }}>
        <span style={{ color: '#00ff00' }}>🟩 Drivable Area</span>
        <span style={{ color: '#ff0000' }}>🟥 Obstacles</span>
        <span style={{ color: '#0064ff' }}>🟦 Ego Vehicle</span>
      </div>
    </div>
  );
}