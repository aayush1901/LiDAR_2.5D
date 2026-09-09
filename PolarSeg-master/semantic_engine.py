import numpy as np
import os

class SemanticFoveatedGrid:
    def __init__(self):
        self.zone_configs = [
            {"id": 1, "r_in": 0.0,  "r_out": 10.0, "bg_cs": 0.05, "fg_cs": 0.05}, 
            {"id": 2, "r_in": 10.0, "r_out": 20.0, "bg_cs": 0.20, "fg_cs": 0.05}, 
            {"id": 3, "r_in": 20.0, "r_out": 40.0, "bg_cs": 0.50, "fg_cs": 0.10}, 
            {"id": 4, "r_in": 40.0, "r_out": 100.0,"bg_cs": 1.00, "fg_cs": 1.00}, 
        ]
        for z in self.zone_configs:
            z["bg_dim"] = int(np.round((2 * z["r_out"]) / z["bg_cs"]))
            z["fg_dim"] = int(np.round((2 * z["r_out"]) / z["fg_cs"]))

    def _rasterize(self, x, y, z, labels, r_out, cs, dim, f_avg, b_avg):
        if len(x) == 0: return None

        i_idx = np.clip(np.floor((x + r_out) / cs).astype(np.int32), 0, dim - 1)
        j_idx = np.clip(np.floor((y + r_out) / cs).astype(np.int32), 0, dim - 1)
        flat_idx = i_idx * dim + j_idx

        min_z_flat = np.full(dim * dim, np.inf, dtype=np.float32)
        max_z_flat = np.full(dim * dim, -np.inf, dtype=np.float32)
        label_flat = np.zeros(dim * dim, dtype=np.uint16)
        occupancy_flat = np.zeros(dim * dim, dtype=bool)

        np.minimum.at(min_z_flat, flat_idx, z)
        np.maximum.at(max_z_flat, flat_idx, z)
        
        label_flat[flat_idx] = labels 
        occupancy_flat[flat_idx] = True

        min_z = min_z_flat.reshape((dim, dim))
        max_z = max_z_flat.reshape((dim, dim))
        occupied = occupancy_flat.reshape((dim, dim))
        labels_grid = label_flat.reshape((dim, dim))

        dz = max_z - min_z
        dz[~occupied] = 0.0
        
        # Geometry Edge Detection (Grid Level)
        x_center = np.arange(dim) * cs - r_out + (cs / 2.0)
        x_grid = np.tile(x_center[:, None], (1, dim))

        # Curbs: Sidewalk/Terrain cells with high internal vertical variance
        is_curb_cell = occupied & np.isin(labels_grid, [11, 12, 17]) & (dz >= 0.10) & (dz <= 0.40)
        labels_grid[is_curb_cell] = 21

        # Potholes: Road cells that drop below the regional average
        pothole_mask = np.zeros((dim, dim), dtype=bool)
        if f_avg != 0.0:
            pothole_mask |= occupied & (labels_grid == 9) & (x_grid > 0) & (min_z < f_avg - 0.15)
        if b_avg != 0.0:
            pothole_mask |= occupied & (labels_grid == 9) & (x_grid < 0) & (min_z < b_avg - 0.15)
        labels_grid[pothole_mask] = 20

        return {"dz": dz, "labels": labels_grid, "occupied": occupied, "dim": dim, "cs": cs}

    def process_frame(self, points, labels):
        x, y, z = points[:, 0], points[:, 1], points[:, 2]
        labels = labels.flatten()
        
        corridor_mask = np.abs(y) <= 1.5
        valid_road = corridor_mask & (labels == 9)
        
        averages = []
        chebyshev_dist = np.maximum(np.abs(x), np.abs(y))
        
        # 1. Extract true regional road elevations
        for cfg in self.zone_configs:
            r_in, r_out = cfg["r_in"], cfg["r_out"]
            z_mask = (chebyshev_dist >= r_in) & (chebyshev_dist < r_out) if r_in != 0.0 else (chebyshev_dist < r_out)
            
            front_mask = valid_road & z_mask & (x > 0)
            back_mask = valid_road & z_mask & (x < 0)
            
            averages.extend([
                float(np.mean(z[front_mask])) if np.any(front_mask) else 0.0,
                float(np.mean(z[back_mask])) if np.any(back_mask) else 0.0
            ])
            
        results = {"averages": averages}
        is_threat = np.isin(labels, [1, 2, 3, 4, 5, 6, 7, 8]) 
        
        # 2. Rasterize zones with averages injected
        for i, cfg in enumerate(self.zone_configs):
            r_in, r_out = cfg["r_in"], cfg["r_out"]
            mask = (chebyshev_dist >= r_in) & (chebyshev_dist < r_out) if r_in != 0.0 else (chebyshev_dist < r_out)
            
            if not np.any(mask):
                results[cfg["id"]] = {"bg": None, "fg": None}
                continue

            z_x, z_y, z_z, z_l = x[mask], y[mask], z[mask], labels[mask]
            z_threat_mask = is_threat[mask]

            f_avg, b_avg = averages[i*2], averages[i*2 + 1]

            bg_grid = self._rasterize(z_x[~z_threat_mask], z_y[~z_threat_mask], z_z[~z_threat_mask], z_l[~z_threat_mask], r_out, cfg["bg_cs"], cfg["bg_dim"], f_avg, b_avg)
            fg_grid = self._rasterize(z_x[z_threat_mask], z_y[z_threat_mask], z_z[z_threat_mask], z_l[z_threat_mask], r_out, cfg["fg_cs"], cfg["fg_dim"], f_avg, b_avg)

            results[cfg["id"]] = {"bg": bg_grid, "fg": fg_grid}

        return results