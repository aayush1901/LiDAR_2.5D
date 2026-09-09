import asyncio
import websockets
import numpy as np
import os
from semantic_engine import SemanticFoveatedGrid 

BIN_DIR = os.path.join("data", "sequences", "11", "velodyne")
LABEL_DIR = os.path.join("out", "SemKITTI_test", "sequences", "11", "predictions")

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
    bin_files = sorted([f for f in os.listdir(BIN_DIR) if f.endswith('.bin')])
    
    for filename in bin_files:
        base_name = filename.replace('.bin', '')
        bin_path, label_path = os.path.join(BIN_DIR, filename), os.path.join(LABEL_DIR, f"{base_name}.label")
        
        if os.path.exists(label_path):
            points = np.fromfile(bin_path, dtype=np.float32).reshape(-1, 4)[:, :3]
            labels = np.fromfile(label_path, dtype=np.uint32) & 0xFFFF
            
            grids = engine.process_frame(points, labels)
            all_cells = []
            
            for cfg in engine.zone_configs:
                zone_data = grids[cfg["id"]]
                r_out = cfg["r_out"]
                all_cells.append(extract_cells(zone_data["bg"], r_out))
                all_cells.append(extract_cells(zone_data["fg"], r_out))
            
            # Pack 32-byte Telemetry Header + Cell Data
            header = np.array(grids["averages"], dtype=np.float32).tobytes()
            body = np.vstack(all_cells).astype(np.float32).tobytes()
            
            await queue.put(header + body)
            await asyncio.sleep(0.01)

async def websocket_consumer(websocket, queue):
    try:
        while True:
            await websocket.send(await queue.get())
            await asyncio.sleep(0.1) 
    except websockets.exceptions.ConnectionClosed:
        pass

async def handler(websocket):
    queue = asyncio.Queue(maxsize=50)
    await asyncio.gather(asyncio.create_task(file_producer(queue)), asyncio.create_task(websocket_consumer(websocket, queue)))

if __name__ == "__main__":
    asyncio.run(websockets.serve(handler, "localhost", 8765).serve_forever())
