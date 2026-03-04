/**
 * Generate production-grade GeoPDFs with detailed architectural floor plans.
 *
 * Pipeline:
 *   1. Draw detailed floor plan with node-canvas → PNG (pixel-perfect)
 *   2. Embed PNG into PDFKit PDF with geo-reference metadata in Keywords
 *   3. Server extracts PNG from PDF and serves to MapLibre
 *
 * Geo-reference metadata in PDF Keywords:
 *   GEO:CRS, GEO:TOPLEFT, GEO:TOPRIGHT, GEO:BOTTOMRIGHT, GEO:BOTTOMLEFT
 */

const { createCanvas } = require("canvas");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const PLANS_DIR = path.join(__dirname, "plans");
const IMAGES_DIR = path.join(PLANS_DIR, "images");
fs.mkdirSync(IMAGES_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Drawing primitives (Canvas 2D API)
// ---------------------------------------------------------------------------
const WALL_COLOR = "#4a4a4a";
const WALL_WIDTH = 6;
const INNER_WALL_WIDTH = 4;
const WINDOW_COLOR = "#64B5F6";
const DOOR_COLOR = "#888";
const FURNITURE_FILL = "#e8e8e8";
const FURNITURE_STROKE = "#999";
const LABEL_COLOR = "#333";
const DIM_COLOR = "#999";
const BG_COLOR = "#ffffff";

function drawWall(ctx, x1, y1, x2, y2, thickness = WALL_WIDTH) {
  ctx.save();
  ctx.lineWidth = thickness;
  ctx.strokeStyle = WALL_COLOR;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawInnerWall(ctx, x1, y1, x2, y2) {
  drawWall(ctx, x1, y1, x2, y2, INNER_WALL_WIDTH);
}

function drawDoor(ctx, x, y, width, direction = "right", orientation = "down") {
  ctx.save();
  // Door opening (gap in wall)
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(x - 1, y - 1, width + 2, INNER_WALL_WIDTH + 2);
  // Door leaf line
  ctx.lineWidth = 1;
  ctx.strokeStyle = DOOR_COLOR;
  ctx.beginPath();
  if (orientation === "down") {
    if (direction === "right") {
      ctx.moveTo(x, y); ctx.lineTo(x + width, y + width);
    } else {
      ctx.moveTo(x + width, y); ctx.lineTo(x, y + width);
    }
  } else {
    if (direction === "right") {
      ctx.moveTo(x, y); ctx.lineTo(x + width, y - width);
    } else {
      ctx.moveTo(x + width, y); ctx.lineTo(x, y - width);
    }
  }
  ctx.stroke();
  // Arc
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = "#bbb";
  ctx.beginPath();
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const angle = (Math.PI / 2) * (i / steps);
    let px, py;
    if (orientation === "down" && direction === "right") {
      px = x + width * Math.cos(angle); py = y + width * Math.sin(angle);
    } else if (orientation === "down" && direction === "left") {
      px = x + width - width * Math.cos(angle); py = y + width * Math.sin(angle);
    } else if (orientation === "up" && direction === "right") {
      px = x + width * Math.cos(angle); py = y - width * Math.sin(angle);
    } else {
      px = x + width - width * Math.cos(angle); py = y - width * Math.sin(angle);
    }
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

function drawWindow(ctx, x, y, length, isHorizontal = true) {
  ctx.save();
  if (isHorizontal) {
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(x, y - 3, length, 6);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = WINDOW_COLOR;
    ctx.fillRect(x, y - 2, length, 4);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1; ctx.strokeStyle = WINDOW_COLOR;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + length, y); ctx.stroke();
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, y - 2); ctx.lineTo(x + length, y - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x + length, y + 2); ctx.stroke();
  } else {
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(x - 3, y, 6, length);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = WINDOW_COLOR;
    ctx.fillRect(x - 2, y, 4, length);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1; ctx.strokeStyle = WINDOW_COLOR;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + length); ctx.stroke();
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x - 2, y + length); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x + 2, y + length); ctx.stroke();
  }
  ctx.restore();
}

function fillStrokeRect(ctx, x, y, w, h, fill, stroke, lw = 0.8) {
  ctx.save();
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawDesk(ctx, x, y, w, h) {
  fillStrokeRect(ctx, x, y, w, h, FURNITURE_FILL, FURNITURE_STROKE);
  // Monitor
  const mw = w * 0.5, mh = 3;
  fillStrokeRect(ctx, x + (w - mw) / 2, y + 2, mw, mh, "#ccc", "#aaa", 0.5);
}

function drawChair(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = "#ddd"; ctx.strokeStyle = "#aaa"; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#ccc"; ctx.strokeStyle = "#999"; ctx.lineWidth = 0.4;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawTable(ctx, x, y, w, h, rounded = false) {
  ctx.save();
  ctx.fillStyle = FURNITURE_FILL; ctx.strokeStyle = FURNITURE_STROKE; ctx.lineWidth = 0.8;
  if (rounded) {
    roundedRect(ctx, x, y, w, h, 4); ctx.fill(); ctx.stroke();
  } else {
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawRoundTable(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = FURNITURE_FILL; ctx.strokeStyle = FURNITURE_STROKE; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawBookshelf(ctx, x, y, w, h) {
  fillStrokeRect(ctx, x, y, w, h, "#d7ccc8", "#8d6e63");
  const numShelves = Math.floor(h / 8);
  ctx.save(); ctx.lineWidth = 0.3; ctx.strokeStyle = "#8d6e63";
  for (let i = 1; i < numShelves; i++) {
    const sy = y + (h / numShelves) * i;
    ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x + w, sy); ctx.stroke();
  }
  ctx.restore();
}

function drawFileCabinet(ctx, x, y, w, h) {
  fillStrokeRect(ctx, x, y, w, h, "#e0e0e0", "#9e9e9e");
  const drawers = 3;
  ctx.save();
  for (let i = 0; i < drawers; i++) {
    const dy = y + 2 + (h - 4) / drawers * i;
    const dh = (h - 4) / drawers - 2;
    ctx.lineWidth = 0.4; ctx.strokeStyle = "#bbb";
    ctx.strokeRect(x + 2, dy, w - 4, dh);
    ctx.fillStyle = "#bbb";
    ctx.fillRect(x + w / 2 - 3, dy + dh / 2 - 1, 6, 2);
  }
  ctx.restore();
}

function drawSofa(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = "#c5cae9"; ctx.strokeStyle = "#7986cb"; ctx.lineWidth = 0.8;
  roundedRect(ctx, x, y, w, h, 3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#9fa8da";
  roundedRect(ctx, x + 2, y + 2, w - 4, h * 0.3, 2); ctx.fill();
  ctx.restore();
}

function drawSink(ctx, cx, cy, w, h) {
  fillStrokeRect(ctx, cx - w/2, cy - h/2, w, h, "#e3f2fd", "#90caf9");
  ctx.save();
  ctx.lineWidth = 0.5; ctx.strokeStyle = "#64b5f6";
  ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.3, h * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawToilet(ctx, cx, cy) {
  fillStrokeRect(ctx, cx - 6, cy - 10, 12, 6, "#f5f5f5", "#bbb", 0.6);
  ctx.save();
  ctx.fillStyle = "#f5f5f5"; ctx.strokeStyle = "#bbb"; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.ellipse(cx, cy, 7, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawPlant(ctx, cx, cy) {
  ctx.save();
  ctx.fillStyle = "#a5d6a7";
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#81c784";
  ctx.beginPath(); ctx.arc(cx - 3, cy - 3, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#66bb6a";
  ctx.beginPath(); ctx.arc(cx + 3, cy - 2, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#81c784";
  ctx.beginPath(); ctx.arc(cx, cy - 5, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawLabel(ctx, x, y, text, size = 7) {
  ctx.save();
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = "center";
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + 60, y + i * (size + 2));
  }
  ctx.restore();
}

function drawDimension(ctx, x1, y1, x2, y2, label, offset = 12) {
  ctx.save();
  ctx.lineWidth = 0.4; ctx.strokeStyle = DIM_COLOR; ctx.fillStyle = DIM_COLOR;
  const isHoriz = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  if (isHoriz) {
    const dy = y1 + offset;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1, dy + 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2, dy + 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, dy); ctx.lineTo(x2, dy); ctx.stroke();
    // Arrows
    ctx.beginPath(); ctx.moveTo(x1, dy); ctx.lineTo(x1 + 4, dy - 2); ctx.lineTo(x1 + 4, dy + 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x2, dy); ctx.lineTo(x2 - 4, dy - 2); ctx.lineTo(x2 - 4, dy + 2); ctx.fill();
    ctx.font = "5px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(label, (x1 + x2) / 2, dy - 3);
  } else {
    const dx = x1 + offset;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(dx + 3, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(dx + 3, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(dx, y1); ctx.lineTo(dx, y2); ctx.stroke();
    ctx.font = "5px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(label, dx + 3, (y1 + y2) / 2 + 2);
  }
  ctx.restore();
}

function drawLabeledBox(ctx, x, y, w, h, fill, stroke, text, fontSize = 5) {
  fillStrokeRect(ctx, x, y, w, h, fill, stroke);
  ctx.save();
  ctx.fillStyle = "#666"; ctx.font = `${fontSize}px sans-serif`; ctx.textAlign = "center";
  ctx.fillText(text, x + w / 2, y + h / 2 + fontSize / 3);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------
const PW = 780; // page width
const PH = 580; // page height
const M = 40;   // margin

function buildGeoKeywords(plan) {
  return [
    `GEO:CRS=EPSG:4326`,
    `GEO:TOPLEFT=${plan.corners.topLeft[0]},${plan.corners.topLeft[1]}`,
    `GEO:TOPRIGHT=${plan.corners.topRight[0]},${plan.corners.topRight[1]}`,
    `GEO:BOTTOMRIGHT=${plan.corners.bottomRight[0]},${plan.corners.bottomRight[1]}`,
    `GEO:BOTTOMLEFT=${plan.corners.bottomLeft[0]},${plan.corners.bottomLeft[1]}`,
    `GEO:FLOOR=${plan.floor}`,
    `GEO:BUILDING=${plan.name}`,
    `GEO:SITE=${plan.site}`,
  ].join("; ");
}

// ---------------------------------------------------------------------------
// LONDON — Innovation Centre, 10 Finsbury Square
// ---------------------------------------------------------------------------
function drawLondonPlan(ctx) {
  const L = M, T = M + 20;
  const W = 700, H = 480;

  // Outer walls
  drawWall(ctx, L, T, L + W, T);
  drawWall(ctx, L, T + H, L + W, T + H);
  drawWall(ctx, L, T, L, T + H);
  drawWall(ctx, L + W, T, L + W, T + H);

  // Staff Workstations (top-left)
  const swW = 230, swH = 200;
  drawInnerWall(ctx, L + swW, T, L + swW, T + swH);
  drawInnerWall(ctx, L, T + swH, L + swW, T + swH);
  drawDoor(ctx, L + swW - 35, T + swH, 30, "left", "down");
  drawLabel(ctx, L + 60, T + swH - 25, "STAFF\nWORKSTATIONS", 8);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 2; col++) {
      const dx = L + 30 + col * 100, dy = T + 25 + row * 42;
      drawDesk(ctx, dx, dy, 50, 25);
      drawChair(ctx, dx + 25, dy + 32, 6);
    }
  }

  // Document Disposal Area (top-center)
  const ddL = L + swW + 30, ddW = 200, ddH = 200;
  drawInnerWall(ctx, ddL + ddW, T, ddL + ddW, T + ddH);
  drawInnerWall(ctx, ddL, T + ddH, ddL + ddW, T + ddH);
  drawDoor(ctx, ddL + 10, T + ddH, 30, "right", "down");
  drawLabel(ctx, ddL + 50, T + ddH / 2 - 10, "DOCUMENT\nDISPOSAL AREA", 8);
  for (let i = 0; i < 3; i++) drawFileCabinet(ctx, ddL + 20 + i * 55, T + 20, 40, 50);
  drawFileCabinet(ctx, ddL + 20, T + 90, 40, 50);
  drawLabeledBox(ctx, ddL + 80, T + 100, 25, 25, "#ffcdd2", "#e57373", "SHRED", 4);

  // Conference Room (top-right)
  const crL = ddL + ddW + 30, crW = W - swW - ddW - 60 - 30, crH = 200;
  drawInnerWall(ctx, crL, T, crL, T + crH);
  drawInnerWall(ctx, crL, T + crH, L + W, T + crH);
  drawDoor(ctx, crL + 10, T + crH, 30, "right", "up");
  drawLabel(ctx, crL + 30, T + 20, "CONFERENCE\nROOM", 8);
  drawTable(ctx, crL + 40, T + 55, 100, 50, true);
  for (let i = 0; i < 4; i++) {
    drawChair(ctx, crL + 55 + i * 25, T + 50, 6);
    drawChair(ctx, crL + 55 + i * 25, T + 112, 6);
  }
  drawChair(ctx, crL + 35, T + 80, 6);
  drawChair(ctx, crL + 145, T + 80, 6);
  drawLabeledBox(ctx, crL + 25, T + 150, 120, 8, "#f5f5f5", "#bbb", "WHITEBOARD", 4);

  // Windows top wall
  drawWindow(ctx, L + 30, T, 70); drawWindow(ctx, L + 130, T, 70);
  drawWindow(ctx, ddL + 20, T, 60); drawWindow(ctx, ddL + 100, T, 60);
  drawWindow(ctx, crL + 20, T, 50); drawWindow(ctx, crL + 90, T, 50);

  // Reception Area (corridor)
  const recL = L + swW + 60, recT = T + swH + 20;
  drawLabel(ctx, recL, recT + 5, "RECEPTION\nAREA", 7);
  fillStrokeRect(ctx, recL + 30, recT + 20, 60, 25, FURNITURE_FILL, FURNITURE_STROKE);
  fillStrokeRect(ctx, recL + 30, recT + 20, 20, 50, FURNITURE_FILL, FURNITURE_STROKE);
  drawChair(ctx, recL + 55, recT + 55, 7);
  drawChair(ctx, recL + 110, recT + 30, 6); drawChair(ctx, recL + 130, recT + 30, 6);
  drawChair(ctx, recL + 110, recT + 55, 6); drawChair(ctx, recL + 130, recT + 55, 6);
  drawPlant(ctx, recL + 155, recT + 25);

  // Bottom row
  const botT = T + swH + 100, botH = H - swH - 100;

  // Library Room
  const libW = 180;
  drawInnerWall(ctx, L, botT, L + libW, botT);
  drawInnerWall(ctx, L + libW, botT, L + libW, T + H);
  drawDoor(ctx, L + libW - 35, botT, 30, "left", "down");
  drawLabel(ctx, L + 50, botT + botH - 30, "LIBRARY\nROOM", 8);
  drawRoundTable(ctx, L + 90, botT + 80, 25);
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6;
    drawChair(ctx, L + 90 + 38 * Math.cos(a), botT + 80 + 38 * Math.sin(a), 6);
  }
  drawBookshelf(ctx, L + 5, botT + 5, 12, 60);
  drawBookshelf(ctx, L + 5, botT + 70, 12, 60);
  drawBookshelf(ctx, L + 20, botT + botH - 18, 60, 12);
  drawSofa(ctx, L + 130, botT + 20, 35, 20);
  drawSofa(ctx, L + 130, botT + 50, 35, 20);
  drawPlant(ctx, L + 155, botT + botH - 25);

  // Attorney Offices (4)
  const offStart = L + libW + 25, offW = 90, offGap = 10;
  drawInnerWall(ctx, L + libW, botT, L + W, botT);
  for (let i = 0; i < 4; i++) {
    const ox = offStart + i * (offW + offGap);
    if (i > 0) drawInnerWall(ctx, ox, botT, ox, T + H);
    drawDoor(ctx, ox + 10, botT, 25, "right", "down");
    drawDesk(ctx, ox + 15, botT + 55, 55, 25);
    drawChair(ctx, ox + 42, botT + 88, 7);
    drawChair(ctx, ox + 20, botT + 35, 5);
    drawChair(ctx, ox + 55, botT + 35, 5);
    drawFileCabinet(ctx, ox + offW - 25, botT + 10, 18, 30);
    if (i % 2 === 0) drawPlant(ctx, ox + 10, botT + botH - 15);
  }
  drawLabel(ctx, offStart + 100, botT + botH - 20, "ATTORNEY OFFICES", 7);

  // Case Records Room
  const crRightL = offStart + 4 * (offW + offGap);
  drawInnerWall(ctx, crRightL, botT, crRightL, T + H);
  drawDoor(ctx, crRightL + 10, botT, 25, "right", "down");
  drawLabel(ctx, crRightL + 15, botT + botH - 25, "CASE\nRECORDS\nROOM", 7);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 2; c++)
      drawFileCabinet(ctx, crRightL + 15 + c * 35, botT + 15 + r * 45, 28, 35);

  // Windows bottom, left, right
  drawWindow(ctx, L + 30, T + H, 50); drawWindow(ctx, L + 100, T + H, 50);
  for (let i = 0; i < 4; i++) drawWindow(ctx, offStart + i * (offW + offGap) + 20, T + H, 50);
  drawWindow(ctx, L, T + 50, 60, false); drawWindow(ctx, L, T + 150, 60, false);
  drawWindow(ctx, L, botT + 30, 50, false); drawWindow(ctx, L, botT + 100, 50, false);
  drawWindow(ctx, L + W, T + 40, 50, false); drawWindow(ctx, L + W, T + 120, 50, false);
  drawWindow(ctx, L + W, botT + 30, 50, false); drawWindow(ctx, L + W, botT + 100, 50, false);

  drawDimension(ctx, L, T - 10, L + W, T - 10, "28.0 m", -15);
  drawDimension(ctx, L - 10, T, L - 10, T + H, "19.2 m", -18);
}

// ---------------------------------------------------------------------------
// BERLIN — Startup Hub, Alexanderplatz
// ---------------------------------------------------------------------------
function drawBerlinPlan(ctx) {
  const L = M, T = M + 20, W = 700, H = 480;

  drawWall(ctx, L, T, L + W, T); drawWall(ctx, L, T + H, L + W, T + H);
  drawWall(ctx, L, T, L, T + H); drawWall(ctx, L + W, T, L + W, T + H);

  // Co-Working Space
  const cwW = 320, cwH = 195;
  drawInnerWall(ctx, L + cwW, T, L + cwW, T + cwH);
  drawInnerWall(ctx, L, T + cwH, L + cwW + 140, T + cwH);
  drawDoor(ctx, L + cwW - 35, T + cwH, 30, "left", "down");
  drawLabel(ctx, L + 100, T + cwH - 22, "CO-WORKING SPACE", 9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      const dx = L + 25 + c * 75, dy = T + 20 + r * 55;
      drawDesk(ctx, dx, dy, 50, 22); drawChair(ctx, dx + 25, dy + 30, 5);
    }
  drawPlant(ctx, L + cwW - 20, T + 20); drawPlant(ctx, L + cwW - 20, T + 90);

  // Phone Booths
  const pbL = L + cwW + 10, pbW = 130;
  drawInnerWall(ctx, pbL + pbW, T, pbL + pbW, T + cwH);
  drawInnerWall(ctx, pbL, T + cwH, pbL + pbW, T + cwH);
  drawLabel(ctx, pbL + 20, T + 15, "PHONE BOOTHS", 7);
  for (let i = 0; i < 3; i++) {
    const by = T + 35 + i * 52;
    drawInnerWall(ctx, pbL, by + 45, pbL + pbW, by + 45);
    drawDoor(ctx, pbL + 10, by + 45, 22, "right", "up");
    drawDesk(ctx, pbL + 15, by + 5, 35, 18);
    drawChair(ctx, pbL + 32, by + 28, 5);
    fillStrokeRect(ctx, pbL + pbW - 20, by + 5, 12, 35, "#e1bee7", "#ce93d8", 0.4);
  }

  // Print/Copy Room
  const prL = pbL + pbW + 10, prW = W - cwW - pbW - 30;
  drawInnerWall(ctx, prL, T, prL, T + cwH);
  drawInnerWall(ctx, prL, T + cwH, L + W, T + cwH);
  drawDoor(ctx, prL + 10, T + cwH, 25, "right", "up");
  drawLabel(ctx, prL + 30, T + 15, "PRINT / COPY\nROOM", 7);
  drawLabeledBox(ctx, prL + 15, T + 40, 50, 40, "#e0e0e0", "#9e9e9e", "COPIER", 5);
  drawLabeledBox(ctx, prL + 15, T + 95, 50, 35, "#e0e0e0", "#9e9e9e", "PRINTER", 5);
  drawBookshelf(ctx, prL + prW - 30, T + 20, 20, 80);

  // Workshop | Event Space | Café
  const midT = T + cwH + 10, midH = 160;
  const wsW = 220;
  drawInnerWall(ctx, L, midT, L + wsW, midT);
  drawInnerWall(ctx, L + wsW, midT, L + wsW, midT + midH);
  drawInnerWall(ctx, L, midT + midH, L + wsW, midT + midH);
  drawDoor(ctx, L + wsW - 30, midT, 25, "left", "down");
  drawLabel(ctx, L + 70, midT + midH - 22, "WORKSHOP", 8);
  drawTable(ctx, L + 20, midT + 15, 80, 30); drawTable(ctx, L + 120, midT + 15, 80, 30);
  drawTable(ctx, L + 20, midT + 65, 80, 30); drawTable(ctx, L + 120, midT + 65, 80, 30);
  for (let i = 0; i < 4; i++) {
    drawChair(ctx, L + 40 + (i % 2) * 100, midT + 52, 5);
    drawChair(ctx, L + 40 + (i % 2) * 100, midT + 102, 5);
  }
  fillStrokeRect(ctx, L + 5, midT + 5, 8, midH - 10, "#ffccbc", "#ff8a65", 0.5);

  const evL = L + wsW + 15, evW = 220;
  drawInnerWall(ctx, evL, midT, evL + evW, midT);
  drawInnerWall(ctx, evL + evW, midT, evL + evW, midT + midH);
  drawInnerWall(ctx, evL, midT + midH, evL + evW, midT + midH);
  drawDoor(ctx, evL + 10, midT, 30, "right", "down");
  drawDoor(ctx, evL + evW - 35, midT, 30, "left", "down");
  drawLabel(ctx, evL + 60, midT + midH / 2 - 5, "EVENT SPACE", 9);
  drawLabeledBox(ctx, evL + 20, midT + 15, 60, 30, "#fff9c4", "#fbc02d", "PODIUM", 5);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 6; c++) drawChair(ctx, evL + 30 + c * 28, midT + 65 + r * 28, 5);

  const caL = evL + evW + 15, caW = W - wsW - evW - 45;
  drawInnerWall(ctx, caL, midT, L + W, midT);
  drawInnerWall(ctx, caL, midT, caL, midT + midH);
  drawInnerWall(ctx, caL, midT + midH, L + W, midT + midH);
  drawDoor(ctx, caL + 10, midT, 30, "right", "down");
  drawLabel(ctx, caL + 50, midT + 15, "CAFÉ", 9);
  fillStrokeRect(ctx, caL + 15, midT + 35, caW - 30, 12, "#d7ccc8", "#795548");
  drawRoundTable(ctx, caL + 40, midT + 80, 15); drawChair(ctx, caL + 22, midT + 80, 5); drawChair(ctx, caL + 58, midT + 80, 5);
  drawRoundTable(ctx, caL + 110, midT + 80, 15); drawChair(ctx, caL + 92, midT + 80, 5); drawChair(ctx, caL + 128, midT + 80, 5);
  drawRoundTable(ctx, caL + 75, midT + 125, 15); drawChair(ctx, caL + 57, midT + 125, 5); drawChair(ctx, caL + 93, midT + 125, 5);
  drawPlant(ctx, caL + caW - 20, midT + 20); drawPlant(ctx, caL + 20, midT + midH - 20);

  // Bike Storage | WC | Lobby
  const botT = midT + midH + 15, botH = T + H - botT;
  const bsW = 250;
  drawInnerWall(ctx, L + bsW, botT, L + bsW, T + H);
  drawInnerWall(ctx, L, botT, L + bsW, botT);
  drawDoor(ctx, L + bsW - 35, botT, 30, "left", "down");
  drawLabel(ctx, L + 80, botT + botH / 2 - 5, "BIKE STORAGE", 8);
  for (let i = 0; i < 8; i++) {
    const bx = L + 20 + i * 28;
    ctx.save(); ctx.lineWidth = 0.6; ctx.strokeStyle = "#90a4ae";
    ctx.beginPath(); ctx.moveTo(bx, botT + 15); ctx.lineTo(bx, botT + 45); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx - 5, botT + 15); ctx.lineTo(bx + 5, botT + 15); ctx.stroke();
    ctx.restore();
  }

  const wcL = L + bsW + 15, wcW = 170;
  drawInnerWall(ctx, wcL, botT, wcL + wcW, botT);
  drawInnerWall(ctx, wcL + wcW, botT, wcL + wcW, T + H);
  drawDoor(ctx, wcL + 10, botT, 25, "right", "down");
  drawLabel(ctx, wcL + 55, botT + 10, "WC", 8);
  drawToilet(ctx, wcL + 30, botT + 50); drawToilet(ctx, wcL + 70, botT + 50); drawToilet(ctx, wcL + 110, botT + 50);
  drawSink(ctx, wcL + 30, botT + botH - 20, 18, 12); drawSink(ctx, wcL + 70, botT + botH - 20, 18, 12); drawSink(ctx, wcL + 110, botT + botH - 20, 18, 12);
  drawInnerWall(ctx, wcL + 50, botT + 30, wcL + 50, botT + 65);
  drawInnerWall(ctx, wcL + 90, botT + 30, wcL + 90, botT + 65);

  const lobL = wcL + wcW + 15, lobW = L + W - lobL;
  drawInnerWall(ctx, lobL, botT, L + W, botT);
  drawDoor(ctx, lobL + 10, botT, 30, "right", "down");
  drawLabel(ctx, lobL + 45, botT + 15, "LOBBY", 9);
  drawTable(ctx, lobL + 20, botT + 40, 80, 20, true); drawChair(ctx, lobL + 60, botT + 68, 6);
  drawSofa(ctx, lobL + lobW - 70, botT + 20, 55, 22); drawSofa(ctx, lobL + lobW - 70, botT + 50, 55, 22);
  drawPlant(ctx, lobL + lobW - 15, botT + 15);
  // Entrance
  ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = "#f44336";
  ctx.beginPath(); ctx.moveTo(lobL + lobW / 2 - 20, T + H); ctx.lineTo(lobL + lobW / 2 + 20, T + H); ctx.stroke();
  ctx.fillStyle = "#f44336"; ctx.font = "5px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("ENTRANCE", lobL + lobW / 2, T + H - 5); ctx.restore();

  drawWindow(ctx, L + 30, T, 80); drawWindow(ctx, L + 150, T, 80); drawWindow(ctx, L + 280, T, 60);
  drawWindow(ctx, pbL + 20, T, 50); drawWindow(ctx, prL + 20, T, 60);
  drawWindow(ctx, L, T + 50, 60, false); drawWindow(ctx, L, T + 150, 60, false);
  drawWindow(ctx, L + W, T + 50, 60, false); drawWindow(ctx, L + W, T + 150, 60, false);

  drawDimension(ctx, L, T - 10, L + W, T - 10, "28.0 m", -15);
  drawDimension(ctx, L - 10, T, L - 10, T + H, "19.2 m", -18);
}

// ---------------------------------------------------------------------------
// PARIS — Design Studio, Champs-Élysées
// ---------------------------------------------------------------------------
function drawParisPlan(ctx) {
  const L = M, T = M + 20, W = 700, H = 480;

  drawWall(ctx, L, T, L + W, T); drawWall(ctx, L, T + H, L + W, T + H);
  drawWall(ctx, L, T, L, T + H); drawWall(ctx, L + W, T, L + W, T + H);

  // Design Atelier
  const atW = 270, atH = 210;
  drawInnerWall(ctx, L + atW, T, L + atW, T + atH);
  drawInnerWall(ctx, L, T + atH, L + atW, T + atH);
  drawDoor(ctx, L + atW - 35, T + atH, 30, "left", "down");
  drawLabel(ctx, L + 80, T + atH - 22, "ATELIER DESIGN", 9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const dx = L + 25 + c * 80, dy = T + 20 + r * 58;
      drawDesk(ctx, dx, dy, 55, 25); drawChair(ctx, dx + 27, dy + 33, 6);
    }
  drawPlant(ctx, L + 250, T + 20);

  // Director Office
  const doL = L + atW + 15, doW = 195;
  drawInnerWall(ctx, doL + doW, T, doL + doW, T + atH);
  drawInnerWall(ctx, doL, T + atH, doL + doW, T + atH);
  drawDoor(ctx, doL + 10, T + atH, 25, "right", "up");
  drawLabel(ctx, doL + 50, T + 18, "BUREAU DIRECTION", 8);
  drawDesk(ctx, doL + 30, T + 45, 70, 30); drawChair(ctx, doL + 65, T + 85, 7);
  drawChair(ctx, doL + 40, T + 35, 5); drawChair(ctx, doL + 75, T + 35, 5);
  drawBookshelf(ctx, doL + doW - 25, T + 10, 18, 80);
  drawSofa(ctx, doL + 20, T + 130, 70, 25);
  drawTable(ctx, doL + 30, T + 160, 50, 20, true);
  drawPlant(ctx, doL + doW - 20, T + atH - 20); drawPlant(ctx, doL + 10, T + 10);

  // Meeting Room
  const mrL = doL + doW + 15, mrW = W - atW - doW - 45, mrH = atH;
  drawInnerWall(ctx, mrL, T, mrL, T + mrH);
  drawInnerWall(ctx, mrL, T + mrH, L + W, T + mrH);
  drawDoor(ctx, mrL + 10, T + mrH, 25, "right", "up");
  drawLabel(ctx, mrL + 20, T + 18, "SALLE DE\nRÉUNION", 8);
  // Oval table
  ctx.save(); ctx.fillStyle = FURNITURE_FILL; ctx.strokeStyle = FURNITURE_STROKE; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.ellipse(mrL + mrW / 2, T + mrH / 2, mrW * 0.35, mrH * 0.25, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke(); ctx.restore();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10;
    drawChair(ctx, mrL + mrW / 2 + (mrW * 0.42) * Math.cos(a), T + mrH / 2 + (mrH * 0.35) * Math.sin(a), 5);
  }
  fillStrokeRect(ctx, mrL + mrW - 18, T + 30, 10, 80, "#e0e0e0", "#9e9e9e", 0.5);

  // Windows top
  drawWindow(ctx, L + 30, T, 80); drawWindow(ctx, L + 150, T, 80);
  drawWindow(ctx, doL + 20, T, 60); drawWindow(ctx, doL + 100, T, 60);
  drawWindow(ctx, mrL + 20, T, 60); drawWindow(ctx, mrL + 100, T, 60);

  // Bibliothèque | Espace Détente | Cuisine
  const midT = T + atH + 15, midH = 145;
  const bibW = 195;
  drawInnerWall(ctx, L, midT, L + bibW, midT);
  drawInnerWall(ctx, L + bibW, midT, L + bibW, midT + midH);
  drawInnerWall(ctx, L, midT + midH, L + bibW, midT + midH);
  drawDoor(ctx, L + bibW - 30, midT, 25, "left", "down");
  drawLabel(ctx, L + 60, midT + midH - 20, "BIBLIOTHÈQUE", 8);
  drawBookshelf(ctx, L + 8, midT + 8, 15, midH - 16);
  drawBookshelf(ctx, L + 28, midT + 8, 15, midH - 16);
  drawTable(ctx, L + 60, midT + 30, 80, 30, true);
  drawChair(ctx, L + 75, midT + 25, 5); drawChair(ctx, L + 110, midT + 25, 5);
  drawChair(ctx, L + 75, midT + 67, 5); drawChair(ctx, L + 110, midT + 67, 5);
  drawSofa(ctx, L + 60, midT + 90, 35, 18); drawPlant(ctx, L + bibW - 20, midT + 15);

  const edL = L + bibW + 15, edW = 250;
  drawInnerWall(ctx, edL, midT, edL + edW, midT);
  drawInnerWall(ctx, edL + edW, midT, edL + edW, midT + midH);
  drawInnerWall(ctx, edL, midT + midH, edL + edW, midT + midH);
  drawDoor(ctx, edL + 10, midT, 30, "right", "down");
  drawLabel(ctx, edL + 80, midT + 15, "ESPACE DÉTENTE", 9);
  drawSofa(ctx, edL + 20, midT + 40, 80, 25); drawSofa(ctx, edL + 20, midT + 80, 80, 25);
  drawSofa(ctx, edL + 130, midT + 40, 80, 25);
  drawTable(ctx, edL + 30, midT + 68, 60, 10, true); drawTable(ctx, edL + 140, midT + 68, 60, 10, true);
  fillStrokeRect(ctx, edL + edW - 20, midT + 30, 10, 60, "#424242", "#212121", 0.5);
  drawPlant(ctx, edL + 15, midT + midH - 15); drawPlant(ctx, edL + edW - 30, midT + midH - 15);

  const cuL = edL + edW + 15, cuW = W - bibW - edW - 45;
  drawInnerWall(ctx, cuL, midT, L + W, midT);
  drawInnerWall(ctx, cuL, midT, cuL, midT + midH);
  drawInnerWall(ctx, cuL, midT + midH, L + W, midT + midH);
  drawDoor(ctx, cuL + 10, midT, 25, "right", "down");
  drawLabel(ctx, cuL + 50, midT + 15, "CUISINE", 8);
  fillStrokeRect(ctx, cuL + cuW - 25, midT + 10, 18, midH - 20, "#d7ccc8", "#8d6e63");
  drawSink(ctx, cuL + cuW - 16, midT + 40, 14, 10);
  drawTable(ctx, cuL + 15, midT + 50, 60, 30, true);
  drawChair(ctx, cuL + 25, midT + 45, 5); drawChair(ctx, cuL + 55, midT + 45, 5);
  drawChair(ctx, cuL + 25, midT + 87, 5); drawChair(ctx, cuL + 55, midT + 87, 5);
  drawLabeledBox(ctx, cuL + 15, midT + 10, 25, 30, "#e0e0e0", "#9e9e9e", "FRIDGE", 4);

  // Vestiaire | Accueil | Toilettes
  const botT = midT + midH + 15, botH = T + H - botT;
  const vesW = 210;
  drawInnerWall(ctx, L, botT, L + vesW, botT);
  drawInnerWall(ctx, L + vesW, botT, L + vesW, T + H);
  drawDoor(ctx, L + vesW - 30, botT, 25, "left", "down");
  drawLabel(ctx, L + 70, botT + botH / 2 - 5, "VESTIAIRE", 8);
  for (let i = 0; i < 5; i++) {
    fillStrokeRect(ctx, L + 15 + i * 35, botT + 10, 28, 40, "#e0e0e0", "#9e9e9e", 0.6);
    fillStrokeRect(ctx, L + 15 + i * 35, botT + 55, 28, 40, "#e0e0e0", "#9e9e9e", 0.6);
  }
  fillStrokeRect(ctx, L + 15, botT + botH - 20, vesW - 30, 10, "#d7ccc8", "#8d6e63", 0.6);

  const accL = L + vesW + 15, accW = 255;
  drawInnerWall(ctx, accL, botT, accL + accW, botT);
  drawInnerWall(ctx, accL + accW, botT, accL + accW, T + H);
  drawDoor(ctx, accL + 10, botT, 30, "right", "down");
  drawLabel(ctx, accL + 80, botT + 15, "ACCUEIL", 9);
  fillStrokeRect(ctx, accL + 30, botT + 35, 100, 20, FURNITURE_FILL, FURNITURE_STROKE);
  fillStrokeRect(ctx, accL + 30, botT + 35, 20, 45, FURNITURE_FILL, FURNITURE_STROKE);
  drawChair(ctx, accL + 80, botT + 65, 7);
  drawSofa(ctx, accL + 150, botT + 25, 70, 22); drawSofa(ctx, accL + 150, botT + 55, 70, 22);
  drawTable(ctx, accL + 155, botT + 50, 60, 5, true);
  drawPlant(ctx, accL + accW - 20, botT + 15); drawPlant(ctx, accL + accW - 20, botT + botH - 15);
  ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = "#f44336";
  ctx.beginPath(); ctx.moveTo(accL + accW / 2 - 25, T + H); ctx.lineTo(accL + accW / 2 + 25, T + H); ctx.stroke();
  ctx.fillStyle = "#f44336"; ctx.font = "5px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("ENTRÉE", accL + accW / 2, T + H - 5); ctx.restore();

  const wcL = accL + accW + 15;
  drawInnerWall(ctx, wcL, botT, L + W, botT);
  drawDoor(ctx, wcL + 10, botT, 25, "right", "down");
  drawLabel(ctx, wcL + 40, botT + 12, "TOILETTES", 7);
  drawToilet(ctx, wcL + 30, botT + 50); drawToilet(ctx, wcL + 70, botT + 50);
  drawInnerWall(ctx, wcL + 50, botT + 30, wcL + 50, botT + 65);
  drawSink(ctx, wcL + 30, botT + botH - 18, 18, 12);
  drawSink(ctx, wcL + 70, botT + botH - 18, 18, 12);
  drawSink(ctx, wcL + 110, botT + botH - 18, 18, 12);

  drawWindow(ctx, L, T + 40, 60, false); drawWindow(ctx, L, T + 140, 60, false);
  drawWindow(ctx, L, midT + 20, 50, false);
  drawWindow(ctx, L + W, T + 40, 60, false); drawWindow(ctx, L + W, T + 140, 60, false);

  drawDimension(ctx, L, T - 10, L + W, T - 10, "28.0 m", -15);
  drawDimension(ctx, L - 10, T, L - 10, T + H, "19.2 m", -18);
}

// ---------------------------------------------------------------------------
// Plan metadata
// ---------------------------------------------------------------------------
const plans = [
  {
    filename: "london_plan.pdf",
    name: "Innovation Centre - Level 1",
    site: "10 Finsbury Square, London EC2A 1AF",
    floor: "Level 1",
    corners: {
      topLeft: [-0.08740, 51.52140],
      topRight: [-0.08540, 51.52140],
      bottomRight: [-0.08540, 51.52080],
      bottomLeft: [-0.08740, 51.52080],
    },
    drawFn: drawLondonPlan,
  },
  {
    filename: "berlin_plan.pdf",
    name: "Startup Hub - Ground Floor",
    site: "Alexanderplatz 1, 10178 Berlin",
    floor: "Ground",
    corners: {
      topLeft: [13.41300, 52.52180],
      topRight: [13.41530, 52.52180],
      bottomRight: [13.41530, 52.52110],
      bottomLeft: [13.41300, 52.52110],
    },
    drawFn: drawBerlinPlan,
  },
  {
    filename: "paris_plan.pdf",
    name: "Design Studio - 1er Étage",
    site: "Avenue des Champs-Élysées 101, 75008 Paris",
    floor: "1er Étage",
    corners: {
      topLeft: [2.29550, 48.87410],
      topRight: [2.29750, 48.87410],
      bottomRight: [2.29750, 48.87350],
      bottomLeft: [2.29550, 48.87350],
    },
    drawFn: drawParisPlan,
  },
];

// ---------------------------------------------------------------------------
// Generation pipeline: Canvas → PNG → embed in PDF with geo-metadata
// ---------------------------------------------------------------------------
function renderPlanToPNG(plan) {
  const scale = 3; // 3x for high-res
  const canvas = createCanvas(PW * scale, PH * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, PW, PH);

  // Title bar
  ctx.fillStyle = "#37474f";
  ctx.fillRect(0, 0, PW, 22);
  ctx.fillStyle = "#fff";
  ctx.font = "9px sans-serif";
  ctx.fillText(`${plan.name}  |  ${plan.floor}  |  ${plan.site}`, 10, 15);

  // Draw detailed floor plan
  plan.drawFn(ctx);

  // Scale bar
  const sbY = PH - 22;
  ctx.fillStyle = "#333";
  ctx.fillRect(20, sbY, 80, 1.5);
  ctx.fillRect(20, sbY - 3, 1, 7);
  ctx.fillRect(60, sbY - 3, 1, 7);
  ctx.fillRect(100, sbY - 3, 1, 7);
  ctx.font = "5px sans-serif"; ctx.textAlign = "left";
  ctx.fillText("0", 17, sbY + 8);
  ctx.fillText("5m", 55, sbY + 8);
  ctx.fillText("10m", 93, sbY + 8);

  // North arrow
  ctx.fillStyle = "#333"; ctx.font = "8px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("N", PW - 28, PH - 28);
  ctx.strokeStyle = "#333"; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(PW - 24, PH - 8); ctx.lineTo(PW - 24, PH - 32); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(PW - 24, PH - 32); ctx.lineTo(PW - 27, PH - 26); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(PW - 24, PH - 32); ctx.lineTo(PW - 21, PH - 26); ctx.stroke();

  // Geo-reference stamp
  ctx.fillStyle = "#bbb"; ctx.font = "4.5px sans-serif"; ctx.textAlign = "left";
  const c = plan.corners;
  ctx.fillText(
    `CRS: EPSG:4326 | TL: [${c.topLeft[0]}, ${c.topLeft[1]}] | BR: [${c.bottomRight[0]}, ${c.bottomRight[1]}] | Generated: ${new Date().toISOString().split("T")[0]}`,
    120, PH - 8
  );

  return canvas.toBuffer("image/png");
}

function generateGeoPDF(plan, pngBuffer) {
  const doc = new PDFDocument({
    size: [PW, PH],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    info: {
      Title: plan.name,
      Author: "Plan Viewer System",
      Subject: `Floor plan for ${plan.site}`,
      Keywords: buildGeoKeywords(plan),
    },
  });

  const outPath = path.join(IMAGES_DIR, plan.filename);
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  // Embed the pre-rendered PNG into the PDF (full page)
  doc.image(pngBuffer, 0, 0, { width: PW, height: PH });

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on("finish", () => {
      console.log(`  PDF: ${plan.filename}`);
      resolve(outPath);
    });
    stream.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("Generating production-grade GeoPDFs...\n");

  for (const plan of plans) {
    // 1. Render detailed floor plan to PNG with node-canvas
    const pngBuffer = renderPlanToPNG(plan);
    const pngPath = path.join(IMAGES_DIR, plan.filename.replace(".pdf", ".png"));
    fs.writeFileSync(pngPath, pngBuffer);
    console.log(`  PNG: ${plan.filename.replace(".pdf", ".png")} (${(pngBuffer.length / 1024).toFixed(0)} KB)`);

    // 2. Embed PNG into PDF with geo-reference metadata
    await generateGeoPDF(plan, pngBuffer);
  }

  console.log(`\nDone! Generated ${plans.length} GeoPDFs + PNGs in ${IMAGES_DIR}`);
}

main().catch(console.error);
