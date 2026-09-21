import asyncio
import websockets
import numpy as np
import os
import time
import random
from semantic_engine import SemanticFoveatedGrid 

APP_STATE = {"tracking_enabled": False}

def extract_cells(grid_dict, r_out):
    if not grid_dict: return np.empty((0, 4), dtype=np.float32)
    occupied = grid_dict["occupied"]
    if not np.any(occupied): return np.empty((0, 4), dtype=np.float32)
    cs = grid_dict["cs"]
    labels = grid_dict["labels"][occupied]
    i_idx, j_idx = np.where(occupied)
    x = i_idx * cs - r_out + (cs / 2.0)
    y = j_idx * cs - r_out + (cs / 2.0)
    sizes = np.full_like(x, cs)
    return np.column_stack((x, y, sizes, labels)).astype(np.float32)

async def file_producer(queue):
    engine = SemanticFoveatedGrid()
    base_seq_dir = os.path.join("data", "sequences")
    
    # Process all sequence folders dynamically
    for seq_folder in sorted(os.listdir(base_seq_dir)):
        bin_dir = os.path.join(base_seq_dir, seq_folder, "velodyne")
        label_dir = os.path.join("out", "SemKITTI_test", "sequences", seq_folder, "predictions")
        
        if not os.path.exists(bin_dir): continue
        
        bin_files = sorted([f for f in os.listdir(bin_dir) if f.endswith('.bin')])
        
        for filename in bin_files:
            loop_start = time.perf_counter()
            
            base_name = filename.replace('.bin', '')
            bin_path = os.path.join(bin_dir, filename)
            label_path = os.path.join(label_dir, f"{base_name}.label")
            
            if os.path.exists(label_path):
                points = np.fromfile(bin_path, dtype=np.float32).reshape(-1, 4)[:, :3]
                labels = np.fromfile(label_path, dtype=np.uint32) & 0xFFFF
                
                grids = engine.process_frame(points, labels, enable_tracking=APP_STATE["tracking_enabled"])
                all_cells = []
                
                for cfg in engine.zone_configs:
                    zone_data = grids[cfg["id"]]
                    r_out = cfg["r_out"]
                    all_cells.append(extract_cells(zone_data["bg"], r_out))
                    all_cells.append(extract_cells(zone_data["fg"], r_out))
                
                num_tracks = len(grids["tracks"]) // 6
                header_data = grids["averages"] + [grids["fps"], num_tracks]
                header = np.array(header_data, dtype=np.float32).tobytes()
                
                track_bytes = b""
                if num_tracks > 0:
                    track_bytes = np.array(grids["tracks"], dtype=np.float32).tobytes()
                    
                body = np.vstack(all_cells).astype(np.float32).tobytes()
                
                await queue.put(header + track_bytes + body)
                
                # Dynamic Frame Pacing (Simulate 25 - 45 FPS model latency)
                target_fps = random.uniform(25.0, 45.0)
                target_duration = 1.0 / target_fps
                process_duration = time.perf_counter() - loop_start
                
                sleep_time = max(0.001, target_duration - process_duration)
                await asyncio.sleep(sleep_time)

async def websocket_consumer(websocket, queue):
    try:
        while True:
            await websocket.send(await queue.get())
            await asyncio.sleep(0.01) 
    except websockets.exceptions.ConnectionClosed:
        pass

async def websocket_listener(websocket):
    global APP_STATE
    try:
        async for message in websocket:
            if message == "TRACKING_ON":
                APP_STATE["tracking_enabled"] = True
            elif message == "TRACKING_OFF":
                APP_STATE["tracking_enabled"] = False
    except websockets.exceptions.ConnectionClosed:
        pass

async def handler(websocket):
    queue = asyncio.Queue(maxsize=50)
    await asyncio.gather(
        asyncio.create_task(file_producer(queue)), 
        asyncio.create_task(websocket_consumer(websocket, queue)),
        asyncio.create_task(websocket_listener(websocket))
    )

async def main():
    async with websockets.serve(handler,"localhost", 8765) as server:
        await server.serve_forever()

if __name__ == "__main__":
    asyncio.run(main())