import path from "path";

export const PORT = parseInt(process.env.PORT || "8080", 10);
export const PLANS_DIR = path.join(__dirname, "..", "..", "plans");
export const UPLOADS_DIR = path.join(PLANS_DIR, "images");
export const DB_PATH = path.join(__dirname, "..", "..", "plans.json");

export const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB

export const ALLOWED_MIMETYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/tiff",
  "application/pdf",
  "application/octet-stream",
];

export const ALLOWED_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff",
  ".pgw", ".jgw", ".tfw", ".wld", ".pdf",
];

// Area detection working resolution
export const DETECT_WORK_W = 1000;
export const DETECT_WORK_H = 744;
