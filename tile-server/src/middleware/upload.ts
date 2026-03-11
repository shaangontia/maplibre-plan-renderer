import path from "path";
import crypto from "crypto";
import multer from "multer";
import { UPLOADS_DIR, ALLOWED_MIMETYPES, ALLOWED_EXTENSIONS, MAX_FILE_SIZE } from "../config";

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_MIMETYPES.includes(file.mimetype) || ALLOWED_EXTENSIONS.includes(ext));
  },
  limits: { fileSize: MAX_FILE_SIZE },
});

export const uploadFields = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "worldfile", maxCount: 1 },
]);
