import numpy as np
import os
import time
from sklearn.cluster import DBSCAN

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
            
        self.tracks = {} 
        self.next_track_id = 1

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
        
        x_center = np.arange(dim) * cs - r_out + (cs / 2.0)
        x_grid = np.tile(x_center[:, None], (1, dim))

        is_curb = occupied & np.isin(labels_grid, [11, 12, 17]) & (dz >= 0.10) & (dz <= 0.40)
        labels_grid[is_curb] = 21

        potholes = np.zeros((dim, dim), dtype=bool)
        if f_avg != 0.0: potholes |= occupied & (labels_grid == 9) & (x_grid > 0) & (min_z < f_avg - 0.15)
        if b_avg != 0.0: potholes |= occupied & (labels_grid == 9) & (x_grid < 0) & (min_z < b_avg - 0.15)
        labels_grid[potholes] = 20

        return {"dz": dz, "labels": labels_grid, "occupied": occupied, "dim": dim, "cs": cs}

    def process_frame(self, points, labels, enable_tracking=False):
        start_time = time.perf_counter()
        
        x, y, z = points[:, 0], points[:, 1], points[:, 2]
        labels = labels.flatten()
        
        corridor_mask = np.abs(y) <= 1.5
        valid_road = corridor_mask & (labels == 9)
        chebyshev_dist = np.maximum(np.abs(x), np.abs(y))
        
        averages = []
        is_threat = np.isin(labels, [1, 2, 3, 4, 5, 6, 7, 8]) 
        
        for cfg in self.zone_configs:
            r_in, r_out = cfg["r_in"], cfg["r_out"]
            z_mask = (chebyshev_dist >= r_in) & (chebyshev_dist < r_out) if r_in != 0.0 else (chebyshev_dist < r_out)
            f_mask = valid_road & z_mask & (x > 0)
            b_mask = valid_road & z_mask & (x < 0)
            averages.extend([
                float(np.mean(z[f_mask])) if np.any(f_mask) else 0.0,
                float(np.mean(z[b_mask])) if np.any(b_mask) else 0.0
            ])
            
        # CONDITIONAL TRACKING BLOCK
        track_payload = []
        if enable_tracking:
            dyn_points = points[is_threat]
            current_centroids = []
            
            if len(dyn_points) > 0:
                clustering = DBSCAN(eps=1.2, min_samples=3).fit(dyn_points[:, :2])
                for k in set(clustering.labels_):
                    if k == -1: continue 
                    mask = (clustering.labels_ == k)
                    current_centroids.append([np.mean(dyn_points[mask, 0]), np.mean(dyn_points[mask, 1])])
                    
            current_centroids = np.array(current_centroids)
            new_tracks = {}
            
            if len(current_centroids) > 0:
                if len(self.tracks) > 0:
                    old_ids = list(self.tracks.keys())
                    old_centers = np.array([self.tracks[tid]['pos'] for tid in old_ids])
                    dists = np.linalg.norm(old_centers[:, None, :] - current_centroids[None, :, :], axis=-1)
                    matched_new = set()
                    
                    for i, tid in enumerate(old_ids):
                        best_new_idx = np.argmin(dists[i])
                        if dists[i, best_new_idx] < 2.5 and best_new_idx not in matched_new:
                            prev_pos = self.tracks[tid]['pos']
                            curr_pos = current_centroids[best_new_idx]
                            
                            vx = (curr_pos[0] - prev_pos[0]) * 10.0
                            vy = (curr_pos[1] - prev_pos[1]) * 10.0
                            
                            is_risk = 0
                            if vx < 0 and curr_pos[0] > 0:
                                ttc_x = curr_pos[0] / abs(vx) if vx != 0 else 999
                                fut_y = curr_pos[1] + (vy * ttc_x)
                                if abs(fut_y) < 2.5 and ttc_x < 3.0: 
                                    is_risk = 1

                            new_tracks[tid] = {'pos': curr_pos, 'vel': [vx, vy], 'risk': is_risk, 'missed': 0}
                            matched_new.add(best_new_idx)
                        else:
                            if self.tracks[tid]['missed'] < 3:
                                trk = self.tracks[tid]
                                trk['missed'] += 1
                                trk['pos'][0] += trk['vel'][0] * 0.1 
                                trk['pos'][1] += trk['vel'][1] * 0.1
                                new_tracks[tid] = trk
                    
                    for j in range(len(current_centroids)):
                        if j not in matched_new:
                            new_tracks[self.next_track_id] = {'pos': current_centroids[j], 'vel': [0,0], 'risk': 0, 'missed': 0}
                            self.next_track_id += 1
                else:
                    for j in range(len(current_centroids)):
                        new_tracks[self.next_track_id] = {'pos': current_centroids[j], 'vel': [0,0], 'risk': 0, 'missed': 0}
                        self.next_track_id += 1
            
            self.tracks = new_tracks
            
            for tid, t in self.tracks.items():
                if t['missed'] == 0: 
                    track_payload.extend([float(tid), t['pos'][0], t['pos'][1], t['vel'][0], t['vel'][1], float(t['risk'])])
        else:
            self.tracks = {} # Clear memory if tracking is toggled off

        process_time = time.perf_counter() - start_time
        fps = 1.0 / process_time if process_time > 0 else 0.0
        
        results = {"averages": averages, "fps": fps, "tracks": track_payload}
        
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