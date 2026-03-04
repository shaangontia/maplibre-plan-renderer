/**
 * Generate a realistic 2D floor plan PNG using node-canvas.
 * This creates a multi-room office/residential floor plan with:
 * - Walls, doors, windows
 * - Room labels and dimensions
 * - Furniture outlines
 * - North arrow
 */
const { createCanvas } = require("canvas");
const fs = require("fs");
const path = require("path");

const W = 2000;
const H = 1400;
const WALL = 8;
const DOOR_W = 60;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

// ── Background ──────────────────────────────────────────────────────────
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, W, H);

// ── Helper functions ────────────────────────────────────────────────────
function drawWall(x1, y1, x2, y2) {
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = WALL;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawDoor(x, y, w, h, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angle * Math.PI) / 180);
  // Door opening
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, w, 0, Math.PI / 2);
  ctx.stroke();
  // Door leaf
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.stroke();
  ctx.restore();
}

function drawWindow(x1, y1, x2, y2) {
  ctx.strokeStyle = "#4a90d9";
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Double line for window
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / len * 4, ny = dx / len * 4;
  ctx.strokeStyle = "#4a90d9";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1 + nx, y1 + ny);
  ctx.lineTo(x2 + nx, y2 + ny);
  ctx.stroke();
}

function label(text, x, y, size = 16) {
  ctx.fillStyle = "#333";
  ctx.font = `${size}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function dimension(x1, y1, x2, y2, text, offset = 20) {
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
  // Ticks
  ctx.beginPath();
  ctx.moveTo(x1 + nx * 0.5, y1 + ny * 0.5);
  ctx.lineTo(x1 + nx * 1.5, y1 + ny * 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2 + nx * 0.5, y2 + ny * 0.5);
  ctx.lineTo(x2 + nx * 1.5, y2 + ny * 1.5);
  ctx.stroke();

  ctx.fillStyle = "#999";
  ctx.font = "12px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, mx + nx * 1.5, my + ny * 1.5);
}

function drawRect(x, y, w, h, color = "#ddd") {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
}

function drawFurniture(x, y, w, h, clr = "#ccc") {
  ctx.fillStyle = clr;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#aaa";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

// ── Layout: Office floor plan ───────────────────────────────────────────
const OX = 100, OY = 100; // origin offset
const FW = 1800, FH = 1200; // floor extents

// Outer walls
drawWall(OX, OY, OX + FW, OY);           // top
drawWall(OX, OY + FH, OX + FW, OY + FH); // bottom
drawWall(OX, OY, OX, OY + FH);           // left
drawWall(OX + FW, OY, OX + FW, OY + FH); // right

// ── Room divisions ──────────────────────────────────────────────────────
// Horizontal corridor at y=500
drawWall(OX, OY + 500, OX + FW, OY + 500);

// Vertical walls (top half)
drawWall(OX + 450, OY, OX + 450, OY + 500);
drawWall(OX + 900, OY, OX + 900, OY + 500);
drawWall(OX + 1350, OY, OX + 1350, OY + 500);

// Bottom half: large open area + meeting rooms
drawWall(OX + 600, OY + 500, OX + 600, OY + FH);
drawWall(OX + 1200, OY + 500, OX + 1200, OY + FH);
// Small meeting room partition
drawWall(OX + 1200, OY + 850, OX + FW, OY + 850);

// ── Doors ───────────────────────────────────────────────────────────────
// Top rooms doors (into corridor)
drawDoor(OX + 200, OY + 500, DOOR_W, 0, -90);
drawDoor(OX + 650, OY + 500, DOOR_W, 0, -90);
drawDoor(OX + 1100, OY + 500, DOOR_W, 0, -90);
drawDoor(OX + 1550, OY + 500, DOOR_W, 0, -90);

// Bottom rooms doors
drawDoor(OX + 300, OY + 500, DOOR_W, 0, 90);
drawDoor(OX + 800, OY + 500, DOOR_W, 0, 90);
drawDoor(OX + 1400, OY + 500, DOOR_W, 0, 90);
drawDoor(OX + 1400, OY + 850, DOOR_W, 0, 90);

// Main entrance
drawDoor(OX + 900, OY + FH, DOOR_W * 1.5, 0, -90);

// ── Windows ─────────────────────────────────────────────────────────────
// Top wall windows
drawWindow(OX + 150, OY, OX + 350, OY);
drawWindow(OX + 550, OY, OX + 800, OY);
drawWindow(OX + 1000, OY, OX + 1250, OY);
drawWindow(OX + 1450, OY, OX + 1700, OY);

// Bottom wall windows
drawWindow(OX + 150, OY + FH, OX + 500, OY + FH);
drawWindow(OX + 700, OY + FH, OX + 850, OY + FH);
drawWindow(OX + 950, OY + FH, OX + 1100, OY + FH);
drawWindow(OX + 1300, OY + FH, OX + 1700, OY + FH);

// Side windows
drawWindow(OX, OY + 150, OX, OY + 400);
drawWindow(OX + FW, OY + 150, OX + FW, OY + 400);
drawWindow(OX, OY + 600, OX, OY + 1000);
drawWindow(OX + FW, OY + 600, OX + FW, OY + 1000);

// ── Room labels ─────────────────────────────────────────────────────────
label("Office A", OX + 225, OY + 250, 20);
label("4.5m × 5.0m", OX + 225, OY + 280, 12);

label("Office B", OX + 675, OY + 250, 20);
label("4.5m × 5.0m", OX + 675, OY + 280, 12);

label("Office C", OX + 1125, OY + 250, 20);
label("4.5m × 5.0m", OX + 1125, OY + 280, 12);

label("Office D", OX + 1575, OY + 250, 20);
label("4.5m × 5.0m", OX + 1575, OY + 280, 12);

label("Open Plan Area", OX + 300, OY + 850, 24);
label("6.0m × 7.0m", OX + 300, OY + 890, 14);

label("Conference Room", OX + 900, OY + 850, 24);
label("6.0m × 7.0m", OX + 900, OY + 890, 14);

label("Meeting Room A", OX + 1500, OY + 675, 18);
label("6.0m × 3.5m", OX + 1500, OY + 705, 12);

label("Meeting Room B", OX + 1500, OY + 1025, 18);
label("6.0m × 3.5m", OX + 1500, OY + 1055, 12);

// Corridor label
ctx.fillStyle = "#666";
ctx.font = "italic 14px Arial";
ctx.textAlign = "center";
ctx.fillText("C O R R I D O R", OX + FW / 2, OY + 500 - 15);

// ── Furniture (desks, tables, chairs) ───────────────────────────────────
// Office A: desk + chair
drawFurniture(OX + 140, OY + 150, 120, 60, "#e8e8e8");
drawFurniture(OX + 180, OY + 220, 40, 40, "#ddd");

// Office B: desk + chair
drawFurniture(OX + 580, OY + 150, 120, 60, "#e8e8e8");
drawFurniture(OX + 620, OY + 220, 40, 40, "#ddd");

// Office C: desk + chair
drawFurniture(OX + 1020, OY + 150, 120, 60, "#e8e8e8");
drawFurniture(OX + 1060, OY + 220, 40, 40, "#ddd");

// Office D: L-shaped desk
drawFurniture(OX + 1460, OY + 150, 120, 60, "#e8e8e8");
drawFurniture(OX + 1540, OY + 210, 60, 100, "#e8e8e8");

// Conference room: large table
drawFurniture(OX + 750, OY + 750, 300, 150, "#e0d8c8");
// Chairs around table
for (let i = 0; i < 5; i++) {
  drawFurniture(OX + 770 + i * 55, OY + 720, 30, 25, "#d0d0d0");
  drawFurniture(OX + 770 + i * 55, OY + 910, 30, 25, "#d0d0d0");
}

// Open plan: workstation pods
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 2; col++) {
    drawFurniture(OX + 120 + col * 200, OY + 600 + row * 160, 150, 50, "#e8e8e8");
    drawFurniture(OX + 150 + col * 200, OY + 660 + row * 160, 30, 30, "#ddd");
  }
}

// Meeting rooms: small tables
drawFurniture(OX + 1350, OY + 620, 180, 80, "#e0d8c8");
drawFurniture(OX + 1350, OY + 920, 180, 80, "#e0d8c8");

// ── Dimensions ──────────────────────────────────────────────────────────
dimension(OX, OY - 30, OX + FW, OY - 30, "18.0m", 15);
dimension(OX - 30, OY, OX - 30, OY + FH, "12.0m", 15);

// ── North arrow ─────────────────────────────────────────────────────────
const nx = OX + FW - 60, ny = OY + 60;
ctx.save();
ctx.translate(nx, ny);
ctx.fillStyle = "#333";
ctx.beginPath();
ctx.moveTo(0, -25);
ctx.lineTo(-10, 10);
ctx.lineTo(0, 3);
ctx.lineTo(10, 10);
ctx.closePath();
ctx.fill();
ctx.font = "bold 14px Arial";
ctx.textAlign = "center";
ctx.fillText("N", 0, -30);
ctx.restore();

// ── Title block ─────────────────────────────────────────────────────────
ctx.fillStyle = "#1a1a1a";
ctx.font = "bold 20px Arial";
ctx.textAlign = "left";
ctx.fillText("FLOOR PLAN - LEVEL 1", OX, OY + FH + 60);
ctx.font = "14px Arial";
ctx.fillStyle = "#666";
ctx.fillText("Scale 1:100  |  All dimensions in meters", OX, OY + FH + 85);
ctx.fillText("Building: Innovation Centre, 10 Finsbury Square, London EC2A 1AF", OX, OY + FH + 105);

// ── Export ──────────────────────────────────────────────────────────────
const outDir = path.join(__dirname, "plans");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "floor_plan.png");
const buf = canvas.toBuffer("image/png");
fs.writeFileSync(outPath, buf);
console.log(`Floor plan generated: ${outPath} (${W}×${H})`);
