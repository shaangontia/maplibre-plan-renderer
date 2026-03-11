export interface Coord {
    0: number;
    1: number;
}
export interface Corners {
    topLeft: [number, number];
    topRight: [number, number];
    bottomRight: [number, number];
    bottomLeft: [number, number];
}
export interface Bounds {
    sw: [number, number];
    ne: [number, number];
}
export interface Plan {
    id: string;
    name: string;
    imagePath: string;
    pdfPath: string | null;
    corners: Corners;
    opacity: number;
    rotation: number;
    floor: string;
    building: string;
    site: string;
    crs: string;
    calibrationMethod: string;
    createdAt: string;
    updatedAt: string;
    group?: string;
    isOverview?: boolean;
    linkedSheets?: string[];
    sheetNumber?: number;
}
export interface PlanWithDerived extends Plan {
    center: [number, number];
    bounds: Bounds;
}
export interface WorldFileParams {
    resX: number;
    rotY: number;
    rotX: number;
    resY: number;
    originX: number;
    originY: number;
}
export interface GeoExtractResult {
    corners: Corners | null;
    crs: string;
    calibrationMethod: string;
    renderedImagePath?: string | null;
    metadata?: PdfMetadata | null;
}
export interface PdfMetadata {
    floor: string;
    building: string;
    site: string;
    title: string;
}
export interface GeoTIFFResult {
    corners: Corners;
    crs: string;
    width: number;
    height: number;
}
export interface GeoPDFResult {
    corners: Corners;
    crs: string;
    metadata: PdfMetadata;
}
export interface NormBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}
export interface PixelBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
export interface DetectedArea {
    id: string;
    label: string;
    coords: [number, number][];
    pixelBounds: PixelBox;
}
export interface ControlPoint {
    pixel: [number, number];
    world: [number, number];
}
//# sourceMappingURL=index.d.ts.map