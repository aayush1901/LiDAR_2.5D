import asyncio
import websockets
import numpy as np
import os

print("hello world")
# Paths relative to PolarSeg-master
BIN_DIR = os.path.join("data", "sequences", "11", "velodyne")
LABEL_DIR = os.path.join("out", "SemKITTI_test", "sequences", "11", "predictions")

MAX_RANGE = 50.0  
GRID_R = 480
GRID_THETA = 360

def compress_to_2_5d(points, labels):
    r = np.sqrt(points[:, 0]*2 + points[:, 1]*2)
    theta = np.arctan2(points[:, 1], points[:, 0])

    r_idx = np.clip(np.floor(r / (MAX_RANGE / GRID_R)).astype(int), 0, GRID_R - 1)
    theta_idx = np.clip(np.floor((theta + np.pi) / ((2 * np.pi) / GRID_THETA)).astype(int), 0, GRID_THETA - 1)

    grid_height = np.full((GRID_R, GRID_THETA), -10.0, dtype=np.float32)
    grid_label = np.zeros((GRID_R, GRID_THETA), dtype=np.float32)

    np.maximum.at(grid_height, (r_idx, theta_idx), points[:, 2])
    grid_label[r_idx, theta_idx] = labels

    return np.dstack((grid_height, grid_label)).astype(np.float32).tobytes()

async def file_producer(queue):
    bin_files = sorted([f for f in os.listdir(BIN_DIR) if f.endswith('.bin')])
    
    for filename in bin_files:
        base_name = filename.replace('.bin', '')
        bin_path = os.path.join(BIN_DIR, filename)
        label_path = os.path.join(LABEL_DIR, f"{base_name}.label")
        
        if os.path.exists(label_path):
            points = np.fromfile(bin_path, dtype=np.float32).reshape(-1, 4)[:, :3]
            labels = np.fromfile(label_path, dtype=np.uint32) & 0xFFFF
            
            binary_payload = compress_to_2_5d(points, labels)
            await queue.put(binary_payload)
            await asyncio.sleep(0.01) 

async def websocket_consumer(websocket, queue):
    print("Dashboard connected. Streaming 2.5D frames...")
    try:
        while True:
            binary_payload = await queue.get()
            await websocket.send(binary_payload)
            await asyncio.sleep(0.1) 
    except websockets.exceptions.ConnectionClosed:
        print("Dashboard disconnected.")

async def handler(websocket):
    queue = asyncio.Queue(maxsize=50) 
    producer_task = asyncio.create_task(file_producer(queue))
    consumer_task = asyncio.create_task(websocket_consumer(websocket, queue))
    await asyncio.gather(producer_task, consumer_task)

async def main():
    async with websockets.serve(handler, "localhost", 8765):
        print("Backend streaming matrix active on ws://localhost:8765")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())