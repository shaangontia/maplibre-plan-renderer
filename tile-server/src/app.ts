import express from "express";
import cors from "cors";
import fs from "fs";
import { UPLOADS_DIR } from "./config";
import plansRouter from "./routes/plans";
import tilesRouter from "./routes/tiles";

// Ensure upload directory exists
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());

// Mount routes
app.use("/api/plans", plansRouter);
app.use("/proxy", tilesRouter);

// Top-level routes that live on tilesRouter but need root mounting
app.use("/", tilesRouter);

export default app;
