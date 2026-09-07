import asyncio
import websockets
import numpy as np
import os

BIN_DIR = os.path.join("data", "sequences", "11", "velodyne")
LABEL_DIR = os.path.join("out", "SemKITTI_test", "sequences", "11", "predictions")

GRID_SIZE = 500
MAX_RANGE = 50.0  

def create_bev(points, labels):
    # Extract X (forward/back) and Y (left/right)
    x = points[:, 0]
    y = points[:, 1]
    
    # Map physical meters to 500x500 pixel indices
    x_idx = np.clip(((x + MAX_RANGE) / (2 * MAX_RANGE)) * GRID_SIZE, 0, GRID_SIZE - 1).astype(int)
    y_idx = np.clip(((y + MAX_RANGE) / (2 * MAX_RANGE)) * GRID_SIZE, 0, GRID_SIZE - 1).astype(int)
    
    # Create an empty RGBA image (Black background)
    bev = np.zeros((GRID_SIZE, GRID_SIZE, 4), dtype=np.uint8)
    bev[:, :, 3] = 255 # Full Alpha opacity
    
    labels = labels.flatten()
    is_road = (labels == 9)
    # Strictly Non-Drivable Obstacles: Cars(1), Buildings(13), Fences(14), Vegetation(15), Trunks(16), Poles(18), Signs(19)
    is_obstacle = np.isin(labels, [1, 13, 14, 15, 16, 18, 19]) 
    
    # Paint Drivable Road (Green)
    bev[x_idx[is_road], y_idx[is_road]] = [0, 255, 0, 255]
    
    # Paint Obstacles (Red)
    bev[x_idx[is_obstacle], y_idx[is_obstacle]] = [255, 0, 0, 255]
    
    # Paint Ego Vehicle in the direct center (Blue)
    center = GRID_SIZE // 2
    bev[center-4:center+4, center-4:center+4] = [0, 100, 255, 255]

    return bev.tobytes()

async def file_producer(queue):
    bin_files = sorted([f for f in os.listdir(BIN_DIR) if f.endswith('.bin')])
    for filename in bin_files:
        base_name = filename.replace('.bin', '')
        bin_path = os.path.join(BIN_DIR, filename)
        label_path = os.path.join(LABEL_DIR, f"{base_name}.label")
        
        if os.path.exists(label_path):
            points = np.fromfile(bin_path, dtype=np.float32).reshape(-1, 4)[:, :3]
            labels = np.fromfile(label_path, dtype=np.uint32) & 0xFFFF
            
            payload = create_bev(points, labels)
            await queue.put(payload)
            await asyncio.sleep(0.01)

async def websocket_consumer(websocket, queue):
    try:
        while True:
            payload = await queue.get()
            await websocket.send(payload)
            await asyncio.sleep(0.1) # 10 FPS streaming
    except websockets.exceptions.ConnectionClosed:
        pass

async def handler(websocket):
    queue = asyncio.Queue(maxsize=50)
    producer = asyncio.create_task(file_producer(queue))
    consumer = asyncio.create_task(websocket_consumer(websocket, queue))
    await asyncio.gather(producer, consumer)

async def main():
    async with websockets.serve(handler, "localhost", 8765):
        print("BEV server running on ws://localhost:8765")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())