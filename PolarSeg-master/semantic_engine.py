import numpy as np
import time
import os

class SemanticFoveatedGrid:
    def __init__(self):
        # Configuration: r_in, r_out, background_cell_size, foreground_cell_size
        self.zone_configs = [
            {"id": 1, "r_in": 0.0,  "r_out": 10.0, "bg_cs": 0.05, "fg_cs": 0.05}, # Zone 1: Everything is 5cm
            {"id": 2, "r_in": 10.0, "r_out": 20.0, "bg_cs": 0.20, "fg_cs": 0.05}, # Zone 2: Static 20cm | Threats 5cm
            {"id": 3, "r_in": 20.0, "r_out": 40.0, "bg_cs": 0.50, "fg_cs": 0.10}, # Zone 3: Static 50cm | Threats 10cm
            {"id": 4, "r_in": 40.0, "r_out": 100.0,"bg_cs": 1.00, "fg_cs": 1.00}, # Zone 4: Peripheral tracking
        ]
        
        for z in self.zone_configs:
            z["bg_dim"] = int(np.round((2 * z["r_out"]) / z["bg_cs"]))
            z["fg_dim"] = int(np.round((2 * z["r_out"]) / z["fg_cs"]))

    def _rasterize(self, x, y, z, labels, r_out, cs, dim):
        """Helper to compute the 2.5D grid for a specific point subset."""
        if len(x) == 0:
            return None

        i_idx = np.clip(np.floor((x + r_out) / cs).astype(np.int32), 0, dim - 1)
        j_idx = np.clip(np.floor((y + r_out) / cs).astype(np.int32), 0, dim - 1)
        flat_idx = i_idx * dim + j_idx

        min_z_flat = np.full(dim * dim, np.inf, dtype=np.float32)
        max_z_flat = np.full(dim * dim, -np.inf, dtype=np.float32)
        label_flat = np.zeros(dim * dim, dtype=np.uint16)
        occupancy_flat = np.zeros(dim * dim, dtype=bool)

        np.minimum.at(min_z_flat, flat_idx, z)
        np.maximum.at(max_z_flat, flat_idx, z)
        
        # Keep the most severe class id (highest number priority logic can go here)
        label_flat[flat_idx] = labels 
        occupancy_flat[flat_idx] = True

        min_z = min_z_flat.reshape((dim, dim))
        max_z = max_z_flat.reshape((dim, dim))
        occupied = occupancy_flat.reshape((dim, dim))
        labels_grid = label_flat.reshape((dim, dim))

        min_z[~occupied] = 0.0
        max_z[~occupied] = 0.0
        
        dz = max_z - min_z
        dz[~occupied] = 0.0

        return {"dz": dz, "labels": labels_grid, "occupied": occupied, "dim": dim, "cs": cs}

    def process_frame(self, points, labels):
        x, y, z = points[:, 0], points[:, 1], points[:, 2]
        labels = labels.flatten()
        
        # Categorize Threats
        is_vehicle = np.isin(labels, [1, 2, 3, 4, 5])
        is_vru = np.isin(labels, [6, 7, 8])
        is_threat = is_vehicle | is_vru
        
        chebyshev_dist = np.maximum(np.abs(x), np.abs(y))
        results = {}

        for cfg in self.zone_configs:
            r_in, r_out = cfg["r_in"], cfg["r_out"]
            
            mask = (chebyshev_dist < r_out) if r_in == 0.0 else ((chebyshev_dist >= r_in) & (chebyshev_dist < r_out))
            if not np.any(mask):
                results[cfg["id"]] = {"bg": None, "fg": None}
                continue

            z_x, z_y, z_z, z_l = x[mask], y[mask], z[mask], labels[mask]
            z_threat_mask = is_threat[mask]

            # Split points mathematically
            bg_mask = ~z_threat_mask
            fg_mask = z_threat_mask

            bg_grid = self._rasterize(z_x[bg_mask], z_y[bg_mask], z_z[bg_mask], z_l[bg_mask], r_out, cfg["bg_cs"], cfg["bg_dim"])
            fg_grid = self._rasterize(z_x[fg_mask], z_y[fg_mask], z_z[fg_mask], z_l[fg_mask], r_out, cfg["fg_cs"], cfg["fg_dim"])

            results[cfg["id"]] = {"bg": bg_grid, "fg": fg_grid}

        return results

if __name__ == "__main__":
    bin_path = os.path.join("data", "sequences", "11", "velodyne", "000000.bin")
    label_path = os.path.join("out", "SemKITTI_test", "sequences", "11", "predictions", "000000.label")

    if os.path.exists(bin_path):
        points = np.fromfile(bin_path, dtype=np.float32).reshape(-1, 4)[:, :3]
        labels = np.fromfile(label_path, dtype=np.uint32) & 0xFFFF

        engine = SemanticFoveatedGrid()
        grids = engine.process_frame(points, labels)
        
        # Example output for Zone 2 Threat channel
        z2_fg = grids[2]["fg"]
        if z2_fg:
            print(f"Zone 2 Threat Grid: {z2_fg['dim']}x{z2_fg['dim']} at {z2_fg['cs']*100}cm")
            print(f"Detected {np.count_nonzero(z2_fg['occupied'])} high-resolution threat cells.")