/**
 * Generate floor plan PNGs for London, Berlin, and Paris using node-canvas.
 */
const { createCanvas } = require("canvas");
const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "plans");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────
function drawWall(ctx, x1, y1, x2, y2, w = 8) {
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = w;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawDoor(ctx, x, y, w, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, w, 0, Math.PI / 2);
  ctx.stroke();
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.stroke();
  ctx.restore();
}

function drawWindow(ctx, x1, y1, x2, y2) {
  ctx.strokeStyle = "#4a90d9";
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function label(ctx, text, x, y, size = 16, color = "#333") {
  ctx.fillStyle = color;
  ctx.font = `${size}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawFurniture(ctx, x, y, w, h, clr = "#ccc") {
  ctx.fillStyle = clr;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#aaa";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

function dimension(ctx, x1, y1, x2, y2, text, offset = 20) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / len * offset, ny = dx / len * offset;
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1 + nx, y1 + ny);
  ctx.lineTo(x2 + nx, y2 + ny);
  ctx.stroke();
  ctx.fillStyle = "#999";
  ctx.font = "12px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, mx + nx * 1.5, my + ny * 1.5);
}

// ── Berlin: Startup Hub ──────────────────────────────────────────────────
function generateBerlin() {
  const W = 1800, H = 1200;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const OX = 80, OY = 80, FW = 1640, FH = 1000;

  // Outer walls
  drawWall(ctx, OX, OY, OX + FW, OY);
  drawWall(ctx, OX, OY + FH, OX + FW, OY + FH);
  drawWall(ctx, OX, OY, OX, OY + FH);
  drawWall(ctx, OX + FW, OY, OX + FW, OY + FH);

  // Central corridor horizontal
  drawWall(ctx, OX, OY + 450, OX + FW, OY + 450);

  // Top rooms
  drawWall(ctx, OX + 410, OY, OX + 410, OY + 450);
  drawWall(ctx, OX + 820, OY, OX + 820, OY + 450);
  drawWall(ctx, OX + 1230, OY, OX + 1230, OY + 450);

  // Bottom: open plan + 2 meeting rooms
  drawWall(ctx, OX + 1000, OY + 450, OX + 1000, OY + FH);
  drawWall(ctx, OX + 1000, OY + 700, OX + FW, OY + 700);

  // Doors
  drawDoor(ctx, OX + 200, OY + 450, 55, -90);
  drawDoor(ctx, OX + 600, OY + 450, 55, -90);
  drawDoor(ctx, OX + 1000, OY + 450, 55, -90);
  drawDoor(ctx, OX + 1400, OY + 450, 55, -90);
  drawDoor(ctx, OX + 500, OY + 450, 55, 90);
  drawDoor(ctx, OX + 1200, OY + 450, 55, 90);
  drawDoor(ctx, OX + 1200, OY + 700, 55, 90);

  // Windows
  drawWindow(ctx, OX + 100, OY, OX + 350, OY);
  drawWindow(ctx, OX + 500, OY, OX + 750, OY);
  drawWindow(ctx, OX + 900, OY, OX + 1150, OY);
  drawWindow(ctx, OX + 1300, OY, OX + 1600, OY);
  drawWindow(ctx, OX + 100, OY + FH, OX + 800, OY + FH);
  drawWindow(ctx, OX + 1100, OY + FH, OX + 1600, OY + FH);
  drawWindow(ctx, OX, OY + 100, OX, OY + 400);
  drawWindow(ctx, OX + FW, OY + 100, OX + FW, OY + 400);

  // Labels
  label(ctx, "Workspace A", OX + 205, OY + 220, 20);
  label(ctx, "4.1m \u00D7 4.5m", OX + 205, OY + 250, 12);
  label(ctx, "Workspace B", OX + 615, OY + 220, 20);
  label(ctx, "4.1m \u00D7 4.5m", OX + 615, OY + 250, 12);
  label(ctx, "Workspace C", OX + 1025, OY + 220, 20);
  label(ctx, "4.1m \u00D7 4.5m", OX + 1025, OY + 250, 12);
  label(ctx, "Workspace D", OX + 1435, OY + 220, 20);
  label(ctx, "4.1m \u00D7 4.5m", OX + 1435, OY + 250, 12);
  label(ctx, "Co-Working Space", OX + 500, OY + 720, 24);
  label(ctx, "10.0m \u00D7 5.5m", OX + 500, OY + 755, 14);
  label(ctx, "Meeting Room 1", OX + 1320, OY + 570, 18);
  label(ctx, "Meeting Room 2", OX + 1320, OY + 840, 18);

  ctx.fillStyle = "#666";
  ctx.font = "italic 14px Arial";
  ctx.textAlign = "center";
  ctx.fillText("C O R R I D O R", OX + FW / 2, OY + 435);

  // Furniture
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      drawFurniture(ctx, OX + 120 + c * 210, OY + 550 + r * 130, 140, 45, "#e8e8e8");
    }
  }
  drawFurniture(ctx, OX + 1100, OY + 520, 200, 80, "#e0d8c8");
  drawFurniture(ctx, OX + 1100, OY + 780, 200, 80, "#e0d8c8");

  // Dimensions
  dimension(ctx, OX, OY - 25, OX + FW, OY - 25, "16.4m", 15);
  dimension(ctx, OX - 25, OY, OX - 25, OY + FH, "10.0m", 15);

  // North arrow
  ctx.save();
  ctx.translate(OX + FW - 50, OY + 50);
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.moveTo(0, -25); ctx.lineTo(-10, 10); ctx.lineTo(0, 3); ctx.lineTo(10, 10);
  ctx.closePath(); ctx.fill();
  ctx.font = "bold 14px Arial"; ctx.textAlign = "center";
  ctx.fillText("N", 0, -30);
  ctx.restore();

  // Title
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 20px Arial"; ctx.textAlign = "left";
  ctx.fillText("FLOOR PLAN - STARTUP HUB", OX, OY + FH + 50);
  ctx.font = "14px Arial"; ctx.fillStyle = "#666";
  ctx.fillText("Scale 1:100  |  Alexanderplatz 1, 10178 Berlin", OX, OY + FH + 75);

  const buf = canvas.toBuffer("image/png");
  fs.writeFileSync(path.join(outDir, "berlin_floor_plan.png"), buf);
  console.log("Generated: berlin_floor_plan.png");
}

// ── Paris: Design Studio ─────────────────────────────────────────────────
function generateParis() {
  const W = 1600, H = 1100;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const OX = 80, OY = 80, FW = 1440, FH = 900;

  // Outer walls
  drawWall(ctx, OX, OY, OX + FW, OY);
  drawWall(ctx, OX, OY + FH, OX + FW, OY + FH);
  drawWall(ctx, OX, OY, OX, OY + FH);
  drawWall(ctx, OX + FW, OY, OX + FW, OY + FH);

  // L-shaped layout: corridor vertical at x=480
  drawWall(ctx, OX + 480, OY, OX + 480, OY + FH);
  // Right side split horizontal
  drawWall(ctx, OX + 480, OY + 400, OX + FW, OY + 400);
  // Top right: 2 rooms
  drawWall(ctx, OX + 960, OY, OX + 960, OY + 400);
  // Bottom right: large studio
  drawWall(ctx, OX + 960, OY + 400, OX + 960, OY + 650);
  drawWall(ctx, OX + 480, OY + 650, OX + 960, OY + 650);

  // Doors
  drawDoor(ctx, OX + 480, OY + 200, 55, 0);
  drawDoor(ctx, OX + 480, OY + 500, 55, 0);
  drawDoor(ctx, OX + 700, OY + 400, 55, -90);
  drawDoor(ctx, OX + 1100, OY + 400, 55, -90);
  drawDoor(ctx, OX + 700, OY + 650, 55, 90);
  drawDoor(ctx, OX + 960, OY + 200, 55, 0);

  // Windows
  drawWindow(ctx, OX + 100, OY, OX + 400, OY);
  drawWindow(ctx, OX + 550, OY, OX + 880, OY);
  drawWindow(ctx, OX + 1050, OY, OX + 1380, OY);
  drawWindow(ctx, OX + 100, OY + FH, OX + 400, OY + FH);
  drawWindow(ctx, OX + 550, OY + FH, OX + 1380, OY + FH);
  drawWindow(ctx, OX, OY + 100, OX, OY + 800);
  drawWindow(ctx, OX + FW, OY + 100, OX + FW, OY + 800);

  // Labels
  label(ctx, "Gallery / Showroom", OX + 240, OY + 450, 22);
  label(ctx, "4.8m \u00D7 9.0m", OX + 240, OY + 485, 13);
  label(ctx, "Design Office", OX + 720, OY + 200, 20);
  label(ctx, "4.8m \u00D7 4.0m", OX + 720, OY + 230, 12);
  label(ctx, "Director Office", OX + 1200, OY + 200, 20);
  label(ctx, "4.8m \u00D7 4.0m", OX + 1200, OY + 230, 12);
  label(ctx, "Main Studio", OX + 1100, OY + 650, 24);
  label(ctx, "9.6m \u00D7 5.0m", OX + 1100, OY + 685, 14);
  label(ctx, "Print Room", OX + 720, OY + 530, 18);
  label(ctx, "Kitchenette", OX + 720, OY + 770, 18);

  // Furniture
  // Gallery: display stands
  for (let i = 0; i < 3; i++) {
    drawFurniture(ctx, OX + 100 + i * 130, OY + 200, 80, 15, "#d0d0d0");
    drawFurniture(ctx, OX + 100 + i * 130, OY + 600, 80, 15, "#d0d0d0");
  }
  // Design office desks
  drawFurniture(ctx, OX + 550, OY + 120, 140, 55, "#e8e8e8");
  drawFurniture(ctx, OX + 550, OY + 280, 140, 55, "#e8e8e8");
  // Director desk
  drawFurniture(ctx, OX + 1080, OY + 150, 180, 70, "#d8c8b0");
  // Main studio: large tables
  drawFurniture(ctx, OX + 550, OY + 480, 250, 100, "#e0d8c8");
  drawFurniture(ctx, OX + 1050, OY + 480, 300, 120, "#e8e8e8");
  drawFurniture(ctx, OX + 1050, OY + 700, 300, 100, "#e8e8e8");

  // Dimensions
  dimension(ctx, OX, OY - 25, OX + FW, OY - 25, "14.4m", 15);
  dimension(ctx, OX - 25, OY, OX - 25, OY + FH, "9.0m", 15);

  // North arrow
  ctx.save();
  ctx.translate(OX + FW - 50, OY + 50);
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.moveTo(0, -25); ctx.lineTo(-10, 10); ctx.lineTo(0, 3); ctx.lineTo(10, 10);
  ctx.closePath(); ctx.fill();
  ctx.font = "bold 14px Arial"; ctx.textAlign = "center";
  ctx.fillText("N", 0, -30);
  ctx.restore();

  // Title
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 20px Arial"; ctx.textAlign = "left";
  ctx.fillText("FLOOR PLAN - DESIGN STUDIO", OX, OY + FH + 50);
  ctx.font = "14px Arial"; ctx.fillStyle = "#666";
  ctx.fillText("Scale 1:100  |  Avenue des Champs-\u00C9lys\u00E9es 101, 75008 Paris", OX, OY + FH + 75);

  const buf = canvas.toBuffer("image/png");
  fs.writeFileSync(path.join(outDir, "paris_floor_plan.png"), buf);
  console.log("Generated: paris_floor_plan.png");
}

generateBerlin();
generateParis();
console.log("Done.");
