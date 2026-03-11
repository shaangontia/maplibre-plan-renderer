"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DETECT_WORK_H = exports.DETECT_WORK_W = exports.ALLOWED_EXTENSIONS = exports.ALLOWED_MIMETYPES = exports.MAX_FILE_SIZE = exports.DB_PATH = exports.UPLOADS_DIR = exports.PLANS_DIR = exports.PORT = void 0;
const path_1 = __importDefault(require("path"));
exports.PORT = parseInt(process.env.PORT || "8080", 10);
exports.PLANS_DIR = path_1.default.join(__dirname, "..", "..", "plans");
exports.UPLOADS_DIR = path_1.default.join(exports.PLANS_DIR, "images");
exports.DB_PATH = path_1.default.join(__dirname, "..", "..", "plans.json");
exports.MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB
exports.ALLOWED_MIMETYPES = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/tiff",
    "application/pdf",
    "application/octet-stream",
];
exports.ALLOWED_EXTENSIONS = [
    ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff",
    ".pgw", ".jgw", ".tfw", ".wld", ".pdf",
];
// Area detection working resolution
exports.DETECT_WORK_W = 1000;
exports.DETECT_WORK_H = 744;
//# sourceMappingURL=index.js.map