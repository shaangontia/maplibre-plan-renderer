"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDb = readDb;
exports.writeDb = writeDb;
exports.getBounds = getBounds;
exports.getCenter = getCenter;
exports.findPlanById = findPlanById;
exports.findPlanIndex = findPlanIndex;
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config");
function readDb() {
    if (!fs_1.default.existsSync(config_1.DB_PATH))
        return [];
    try {
        return JSON.parse(fs_1.default.readFileSync(config_1.DB_PATH, "utf-8"));
    }
    catch {
        return [];
    }
}
function writeDb(plans) {
    fs_1.default.writeFileSync(config_1.DB_PATH, JSON.stringify(plans, null, 2));
}
function getBounds(plan) {
    const c = plan.corners;
    const lons = [c.topLeft[0], c.topRight[0], c.bottomRight[0], c.bottomLeft[0]];
    const lats = [c.topLeft[1], c.topRight[1], c.bottomRight[1], c.bottomLeft[1]];
    return {
        sw: [Math.min(...lons), Math.min(...lats)],
        ne: [Math.max(...lons), Math.max(...lats)],
    };
}
function getCenter(plan) {
    const c = plan.corners;
    return [
        (c.topLeft[0] + c.topRight[0] + c.bottomRight[0] + c.bottomLeft[0]) / 4,
        (c.topLeft[1] + c.topRight[1] + c.bottomRight[1] + c.bottomLeft[1]) / 4,
    ];
}
function findPlanById(id) {
    return readDb().find((p) => p.id === id);
}
function findPlanIndex(id) {
    const plans = readDb();
    const idx = plans.findIndex((p) => p.id === id);
    return { plans, idx };
}
//# sourceMappingURL=plans.js.map