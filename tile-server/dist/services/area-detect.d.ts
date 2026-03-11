import type { NormBox, DetectedArea, Corners } from "../types";
export declare function floodDetect(data: Uint8Array, width: number, height: number, threshold: number, dilate: number): NormBox[];
export declare function gridDetect(data: Uint8Array, width: number, height: number): NormBox[];
export declare function detectAreas(imagePath: string, corners: Corners): Promise<DetectedArea[]>;
//# sourceMappingURL=area-detect.d.ts.map