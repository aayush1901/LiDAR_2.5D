import numpy as np
import os

# Pointing to the first frame of Sequence 11
bin_path = r"data\sequences\11\velodyne\000000.bin"
label_path = r"out\SemKITTI_test\sequences\11\predictions\000000.label"

if not os.path.exists(label_path):
    print(f"Error: Could not find {label_path}")
else:
    # 1. Load raw Lidar points (x, y, z, intensity)
    points = np.fromfile(bin_path, dtype=np.float32).reshape(-1, 4)
    
    # 2. Load the AI predictions
    labels = np.fromfile(label_path, dtype=np.uint32)
    
    # SemanticKITTI format stores the class ID in the lower 16 bits
    semantic_labels = labels & 0xFFFF
    
    print("✅ AI Prediction File Successfully Read!")
    print(f"Raw Lidar Points: {points.shape[0]}")
    print(f"AI Labels Generated: {labels.shape[0]}")
    
    if points.shape[0] == labels.shape[0]:
        print("-> PERFECT MATCH: Every physical point was classified.\n")
        
    print("Classes found in this single frame:")
    unique_classes, counts = np.unique(semantic_labels, return_counts=True)
    for cls, count in zip(unique_classes, counts):
        print(f" - Class {cls:2d}: {count} points")