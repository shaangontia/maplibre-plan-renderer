"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.floodDetect = floodDetect;
exports.gridDetect = gridDetect;
exports.detectAreas = detectAreas;
const geo_utils_1 = require("./geo-utils");
const config_1 = require("../config");
// ---------------------------------------------------------------------------
// Flood-fill enclosure detection
// ---------------------------------------------------------------------------
function floodDetect(data, width, height, threshold, dilate) {
    const idx = (x, y) => y * width + x;
    // Dilate walls to seal doorway gaps
    const wd = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let wall = false;
            for (let dy = -dilate; dy <= dilate && !wall; dy++) {
                for (let dx = -dilate; dx <= dilate && !wall; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && ny >= 0 && nx < width && ny < height && data[idx(nx, ny)] < threshold) {
                        wall = true;
                    }
                }
            }
            wd[idx(x, y)] = wall ? 1 : 0;
        }
    }
    // Flood fill from border to mark "outside"
    const outside = new Uint8Array(width * height);
    const bs = [];
    for (let x = 0; x < width; x++) {
        bs.push([x, 0], [x, height - 1]);
    }
    for (let y = 1; y < height - 1; y++) {
        bs.push([0, y], [width - 1, y]);
    }
    while (bs.length) {
        const [x, y] = bs.pop();
        if (x < 0 || y < 0 || x >= width || y >= height || wd[idx(x, y)] || outside[idx(x, y)])
            continue;
        outside[idx(x, y)] = 1;
        bs.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    // Connected-component labeling on enclosed regions
    const labels = new Int32Array(width * height).fill(-1);
    let nl = 0;
    const boxes = new Map();
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = idx(x, y);
            if (wd[i] || outside[i] || labels[i] !== -1)
                continue;
            const label = nl++;
            const s = [[x, y]];
            while (s.length) {
                const [cx, cy] = s.pop();
                if (cx < 0 || cy < 0 || cx >= width || cy >= height)
                    continue;
                const ci = idx(cx, cy);
                if (wd[ci] || outside[ci] || labels[ci] !== -1)
                    continue;
                labels[ci] = label;
                if (!boxes.has(label)) {
                    boxes.set(label, { minX: cx, minY: cy, maxX: cx, maxY: cy, count: 1 });
                }
                else {
                    const b = boxes.get(label);
                    b.count++;
                    if (cx < b.minX)
                        b.minX = cx;
                    if (cy < b.minY)
                        b.minY = cy;
                    if (cx > b.maxX)
                        b.maxX = cx;
                    if (cy > b.maxY)
                        b.maxY = cy;
                }
                s.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
            }
        }
    }
    const total = width * height;
    return [...boxes.values()]
        .filter((b) => {
        const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
        return b.count > total * 0.003 && b.count < total * 0.20 &&
            bw > width * 0.03 && bh > height * 0.03;
    })
        .map((b) => ({
        x1: b.minX / width,
        y1: b.minY / height,
        x2: b.maxX / width,
        y2: b.maxY / height,
    }));
}
// ---------------------------------------------------------------------------
// Grid/projection-based room detection
// ---------------------------------------------------------------------------
function gridDetect(data, width, height) {
    const idx = (x, y) => y * width + x;
    const WALL_T = 130, MIN_DARK = 0.14, MERGE_GAP = 8;
    const hProj = new Float32Array(height);
    const vProj = new Float32Array(width);
    for (let y = 0; y < height; y++) {
        let d = 0;
        for (let x = 0; x < width; x++)
            if (data[idx(x, y)] < WALL_T)
                d++;
        hProj[y] = d / width;
    }
    for (let x = 0; x < width; x++) {
        let d = 0;
        for (let y = 0; y < height; y++)
            if (data[idx(x, y)] < WALL_T)
                d++;
        vProj[x] = d / height;
    }
    function findBands(proj, size) {
        const raw = [];
        let inB = false, st = 0;
        for (let i = 0; i < size; i++) {
            if (proj[i] >= MIN_DARK && !inB) {
                inB = true;
                st = i;
            }
            else if (proj[i] < MIN_DARK && inB) {
                raw.push({ s: st, e: i - 1 });
                inB = false;
            }
        }
        if (inB)
            raw.push({ s: st, e: size - 1 });
        const merged = [];
        for (const b of raw) {
            if (merged.length > 0 && b.s - merged[merged.length - 1].e <= MERGE_GAP) {
                merged[merged.length - 1].e = b.e;
            }
            else {
                merged.push({ ...b });
            }
        }
        return merged;
    }
    const hB = findBands(hProj, height);
    const vB = findBands(vProj, width);
    const topBound = hB[0] ? hB[0].e + 1 : 0;
    const botBound = hB[hB.length - 1] ? hB[hB.length - 1].s : height;
    const leftBound = vB[0] ? vB[0].e + 1 : 0;
    const rightBound = vB[vB.length - 1] ? vB[vB.length - 1].s : width;
    const innerH = hB.filter((b) => b.s > height * 0.03 && b.e < height * 0.97);
    const innerV = vB.filter((b) => b.s > width * 0.03 && b.e < width * 0.97);
    const ys = [topBound, ...innerH.map((b) => b.e + 1), botBound]
        .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
    const xs = [leftBound, ...innerV.map((b) => b.e + 1), rightBound]
        .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
    const MIN_W = width * 0.08, MIN_H = height * 0.08;
    const rooms = [];
    for (let ri = 0; ri < ys.length - 1; ri++) {
        for (let ci = 0; ci < xs.length - 1; ci++) {
            const y1 = ys[ri], y2 = ys[ri + 1], x1 = xs[ci], x2 = xs[ci + 1];
            if (x2 - x1 < MIN_W || y2 - y1 < MIN_H)
                continue;
            let light = 0, total = 0;
            const step = Math.max(1, Math.floor(Math.min(x2 - x1, y2 - y1) / 12));
            for (let y = y1 + 2; y < y2 - 2; y += step) {
                for (let x = x1 + 2; x < x2 - 2; x += step) {
                    if (data[idx(x, y)] >= 140)
                        light++;
                    total++;
                }
            }
            if (total > 0 && light / total > 0.60) {
                rooms.push({ x1: x1 / width, y1: y1 / height, x2: x2 / width, y2: y2 / height });
            }
        }
    }
    return rooms;
}
// ---------------------------------------------------------------------------
// Non-maximum suppression
// ---------------------------------------------------------------------------
function iou(a, b) {
    const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1);
    const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
    if (ix2 <= ix1 || iy2 <= iy1)
        return 0;
    const inter = (ix2 - ix1) * (iy2 - iy1);
    const ua = (a.x2 - a.x1) * (a.y2 - a.y1);
    const ub = (b.x2 - b.x1) * (b.y2 - b.y1);
    return inter / (ua + ub - inter);
}
function boxArea(b) {
    return (b.x2 - b.x1) * (b.y2 - b.y1);
}
function nonMaxSuppression(candidates, iouThreshold = 0.25) {
    candidates.sort((a, b) => boxArea(b) - boxArea(a));
    const kept = [];
    for (const box of candidates) {
        if (!kept.some((k) => iou(k, box) > iouThreshold))
            kept.push(box);
    }
    return kept;
}
// ---------------------------------------------------------------------------
// Remove container boxes (covered >50% by smaller boxes)
// ---------------------------------------------------------------------------
function removeContainers(boxes) {
    function coveredFraction(big, smaller) {
        const N = 20;
        let cov = 0, tot = 0;
        for (let i = 0; i <= N; i++) {
            for (let j = 0; j <= N; j++) {
                const px = big.x1 + (big.x2 - big.x1) * i / N;
                const py = big.y1 + (big.y2 - big.y1) * j / N;
                tot++;
                if (smaller.some((s) => px >= s.x1 && px <= s.x2 && py >= s.y1 && py <= s.y2))
                    cov++;
            }
        }
        return cov / tot;
    }
    return boxes.filter((box) => {
        const smaller = boxes.filter((o) => o !== box && boxArea(o) < boxArea(box));
        return coveredFraction(box, smaller) < 0.50;
    });
}
// ---------------------------------------------------------------------------
// Full detection pipeline: image buffer → detected areas
// ---------------------------------------------------------------------------
async function detectAreas(imagePath, corners) {
    const sharp = require("sharp");
    const { data, info } = await sharp(imagePath)
        .resize(config_1.DETECT_WORK_W, config_1.DETECT_WORK_H, { fit: "fill" })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    // Run both detectors
    const candidates = [
        ...floodDetect(data, width, height, 160, 4),
        ...floodDetect(data, width, height, 160, 6),
        ...gridDetect(data, width, height),
    ];
    // NMS + container removal
    const nms = nonMaxSuppression(candidates);
    const rooms = removeContainers(nms);
    // Sort top-to-bottom, left-to-right
    rooms.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
    // Convert to pixel boxes
    const roomsAsPx = rooms.map((r) => ({
        minX: Math.round(r.x1 * width),
        minY: Math.round(r.y1 * height),
        maxX: Math.round(r.x2 * width),
        maxY: Math.round(r.y2 * height),
    }));
    // Map to geo-coordinates
    return roomsAsPx.map((box, i) => {
        const tl = (0, geo_utils_1.pixelToGeo)(box.minX, box.minY, width, height, corners);
        const tr = (0, geo_utils_1.pixelToGeo)(box.maxX, box.minY, width, height, corners);
        const br = (0, geo_utils_1.pixelToGeo)(box.maxX, box.maxY, width, height, corners);
        const bl = (0, geo_utils_1.pixelToGeo)(box.minX, box.maxY, width, height, corners);
        return {
            id: `detected-${i}`,
            label: `Room ${i + 1}`,
            coords: [tl, tr, br, bl],
            pixelBounds: box,
        };
    });
}
//# sourceMappingURL=area-detect.js.map