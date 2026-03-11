import type { Corners, WorldFileParams } from "../types";
export declare function parseWorldFile(content: string): WorldFileParams | null;
export declare function worldFileToCorners(wf: WorldFileParams, imgWidth: number, imgHeight: number, sourceCRS?: string): Corners;
export declare function findWorldFile(imagePath: string): string | null;
export declare function metersToCorners(centerLon: number, centerLat: number, widthM: number, heightM: number, rotationDeg: number): Corners;
export declare function getImageDimensions(filePath: string): Promise<{
    width: number;
    height: number;
} | null>;
export declare function pixelToGeo(px: number, py: number, width: number, height: number, corners: Corners): [number, number];
//# sourceMappingURL=geo-utils.d.ts.map