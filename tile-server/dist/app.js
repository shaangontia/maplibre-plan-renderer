"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("./config");
const plans_1 = __importDefault(require("./routes/plans"));
const tiles_1 = __importDefault(require("./routes/tiles"));
// Ensure upload directory exists
fs_1.default.mkdirSync(config_1.UPLOADS_DIR, { recursive: true });
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Mount routes
app.use("/api/plans", plans_1.default);
app.use("/proxy", tiles_1.default);
// Top-level routes that live on tilesRouter but need root mounting
app.use("/", tiles_1.default);
exports.default = app;
//# sourceMappingURL=app.js.map