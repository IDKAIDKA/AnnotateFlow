
export interface Point {
  x: number;
  y: number;
  color?: string; // Optional segment color starting from this point
}

export interface Area {
  id: string;
  points: Point[];
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWidth: number;
  order: number;
  appearDuration: number; // Seconds to fade in
  comment?: string;
}

export interface Annotation {
  id: string;
  pathIndex: number; // The index of the point in the path this annotation is attached to
  text: string;
  comment?: string; // Narrative text for Comment Mode
  order: number; // Display order
  color?: string; // Optional override
  fontSize?: number; // Optional override
  offset: { x: number; y: number }; // Offset from the path point
  
  // Complex Leader Line
  leaderPoints?: Point[]; // Intermediate waypoints for the arrow line (relative to anchor)

  // Timing Controls
  segmentDuration?: number; // Seconds to travel from previous milestone (or start) to here
  pauseDuration?: number;   // Seconds to wait at this milestone
}

export interface AppSettings {
  pathColor: string;
  pathWidth: number;
  pathOpacity: number; // New: Transparency for the main path
  
  // Trace / Ghost Path
  showTrace: boolean;
  traceColor: string;
  traceOpacity: number;

  // Flash Animation
  enableFlash: boolean;
  flashColor: string;
  flashDuration: number;

  // Global Timing
  defaultSegmentDuration: number;
  defaultPauseDuration: number;
  defaultAreaDuration: number;
  
  strokeLinecap: 'butt' | 'round' | 'square';
  strokeLinejoin: 'miter' | 'round' | 'bevel';
  
  // Global Label Styles
  labelTextColor: string;
  labelBackgroundColor: string;
  labelBackgroundOpacity: number;
  arrowColor: string;
  arrowWidth: number;
  
  // Presentation Options
  showOrderNumbers: boolean;
  enableCommentMode: boolean;
}

export type AppMode = 'edit' | 'present';
export type EditTool = 'path' | 'node' | 'area';

export interface Version {
  id: string;
  name: string;
  timestamp: number;
  data: {
    points: Point[];
    annotations: Annotation[];
    areas: Area[];
    settings: AppSettings;
  };
}

export interface ImageSize {
  width: number;
  height: number;
}
