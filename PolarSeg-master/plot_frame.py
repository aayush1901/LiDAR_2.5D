import numpy as np
import open3d as o3d
import os

# Paths to the specific frame
bin_path = r"data\sequences\11\velodyne\000000.bin"
label_path = r"out\SemKITTI_test\sequences\11\predictions\000000.label" # Update if it's "semanticKitti"


# 1. Load data
points = np.fromfile(bin_path, dtype=np.float32).reshape(-1, 4)[:, :3]
labels = np.fromfile(label_path, dtype=np.uint32) & 0xFFFF

# 2. Assign Colors based on AI Classes (R, G, B format between 0.0 and 1.0)
colors = np.ones((len(labels), 3)) * 0.7  # Default: Light Gray

colors[labels == 9] = [0.3, 0.3, 0.3]     # Road -> Dark Gray
colors[labels == 1] = [1.0, 0.0, 0.0]     # Car -> Bright Red
colors[labels == 15] = [0.0, 0.8, 0.0]    # Vegetation -> Green
colors[labels == 11] = [0.5, 0.5, 0.5]    # Sidewalk -> Medium Gray
colors[labels == 13] = [0.8, 0.6, 0.0]    # Building -> Orange/Yellow

# 3. Create Open3D Point Cloud Object
pcd = o3d.geometry.PointCloud()
pcd.points = o3d.utility.Vector3dVector(points)
pcd.colors = o3d.utility.Vector3dVector(colors)

# 4. Render the Window
print("Opening 3D Viewer... (Use mouse to rotate, scroll to zoom)")
o3d.visualization.draw_geometries([pcd], window_name="AI Segmentation Output")