import type { GeoExtractResult, GeoTIFFResult, GeoPDFResult } from "../types";
export declare function extractGeoTIFFCorners(filePath: string): Promise<GeoTIFFResult | null>;
export declare function extractGeoPDFCorners(filePath: string): Promise<GeoPDFResult | null>;
export declare function autoExtractGeoReference(imagePath: string, worldFilePath: string | null): Promise<GeoExtractResult | null>;
//# sourceMappingURL=geo-extract.d.ts.map