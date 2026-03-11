"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadFields = exports.upload = void 0;
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const multer_1 = __importDefault(require("multer"));
const config_1 = require("../config");
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, config_1.UPLOADS_DIR),
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname) || ".png";
        cb(null, `${crypto_1.default.randomUUID()}${ext}`);
    },
});
exports.upload = (0, multer_1.default)({
    storage,
    fileFilter: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        cb(null, config_1.ALLOWED_MIMETYPES.includes(file.mimetype) || config_1.ALLOWED_EXTENSIONS.includes(ext));
    },
    limits: { fileSize: config_1.MAX_FILE_SIZE },
});
exports.uploadFields = exports.upload.fields([
    { name: "image", maxCount: 1 },
    { name: "worldfile", maxCount: 1 },
]);
//# sourceMappingURL=upload.js.map