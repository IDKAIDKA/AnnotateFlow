import React, { useRef, useState, useEffect } from 'react';
import { Point, Annotation, Area, AppSettings, AppMode, EditTool } from '../types';
import { Move, Copy, Trash2, Maximize, CornerUpRight, Type, PlusCircle, PenTool, GripHorizontal } from 'lucide-react';

interface CanvasAreaProps {
  image: string | null;
  points: Point[];
  onAddPoint: (p: Point, index?: number) => void;
  onMovePoint: (index: number, p: Point) => void;
  onDeletePoint: (index: number) => void;
  onUpdatePointColor: (index: number, color: string | undefined) => void;
  annotations: Annotation[];
  onAddAnnotation: (pointIndex: number) => void;
  onDeleteAnnotation: (id: string) => void;
  onDuplicateAnnotation: (id: string) => void;
  onUpdateAnnotationOffset: (id: string, offset: { x: number; y: number }) => void;
  onUpdateLeaderPoints: (id: string, points: Point[]) => void;
  onSelect: (id: string | null, type: 'annotation' | 'area') => void;
  selectedId: string | null;
  settings: AppSettings;
  mode: AppMode;
  editTool: EditTool;
  
  areas: Area[];
  onAddAreaPoint: (point: Point) => void;
  onFinishArea: () => void;
  onUpdateArea: (id: string, updates: Partial<Area>) => void;
  onMoveAreaPoint: (id: string, index: number, p: Point) => void;
  tempAreaPoints: Point[]; // Points for area currently being drawn

  // New props for precise timing
  currentDistance: number;
  totalPathLength: number;
  visibleAnnotationIds: string[];
  visibleAreaIds: string[];
  isFlashing: boolean;
  activeComment: string | null;
}

type ContextMenuType = {
    x: number;
    y: number;
    type: 'point' | 'annotation' | 'canvas' | 'segment' | 'leader' | 'area';
    targetId?: string; // for annotations/areas
    index?: number; // for points
    segmentIndex?: number; // for insert on segment
    clickPoint?: Point; // for insert location
};

// Helper: Distance from point P to segment AB
function distToSegment(p: Point, v: Point, w: Point) {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
  if (l2 === 0) return Math.sqrt((p.x - v.x) ** 2 + (p.y - v.y) ** 2);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
  return Math.sqrt((p.x - proj.x) ** 2 + (p.y - proj.y) ** 2);
}

const CanvasArea: React.FC<CanvasAreaProps> = ({
  image,
  points,
  onAddPoint,
  onMovePoint,
  onDeletePoint,
  onUpdatePointColor,
  annotations,
  onAddAnnotation,
  onDeleteAnnotation,
  onDuplicateAnnotation,
  onUpdateAnnotationOffset,
  onUpdateLeaderPoints,
  onSelect,
  selectedId,
  settings,
  mode,
  editTool,
  
  areas,
  onAddAreaPoint,
  onFinishArea,
  onUpdateArea,
  onMoveAreaPoint,
  tempAreaPoints,

  currentDistance,
  totalPathLength,
  visibleAnnotationIds,
  visibleAreaIds,
  isFlashing,
  activeComment
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Interaction State
  const [draggedAnnotation, setDraggedAnnotation] = useState<string | null>(null);
  const [draggedPointIndex, setDraggedPointIndex] = useState<number | null>(null);
  const [draggedLeaderIndex, setDraggedLeaderIndex] = useState<{ id: string, index: number } | null>(null);
  const [draggedAreaPoint, setDraggedAreaPoint] = useState<{ id: string, index: number } | null>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuType | null>(null);

  // Clear context menu on click elsewhere
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!containerRef.current || !image || mode === 'present') return;
    if (contextMenu) return; // Don't add point if closing menu

    // Only add point if not clicking on an interactive element
    if ((e.target as HTMLElement).closest('.interactive-element')) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (editTool === 'area') {
        onAddAreaPoint({ x, y });
        return;
    }

    if (editTool === 'path') {
        // Check if clicking near a segment to insert
        let insertIndex = -1;
        for (let i = 0; i < points.length - 1; i++) {
            if (distToSegment({ x, y }, points[i], points[i+1]) < 10) {
                insertIndex = i + 1;
                break;
            }
        }

        if (insertIndex !== -1) {
            onAddPoint({ x, y }, insertIndex);
        } else {
            onAddPoint({ x, y });
        }
    }
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
      if (editTool === 'area') {
          e.preventDefault();
          onFinishArea();
      }
  };

  const handleCanvasRightClick = (e: React.MouseEvent) => {
      if (mode === 'present') return;
      e.preventDefault();
      
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (editTool === 'node') {
        // Check segment collision
        let segmentIndex = -1;
        for (let i = 0; i < points.length - 1; i++) {
            if (distToSegment({ x, y }, points[i], points[i+1]) < 10) {
                segmentIndex = i;
                break;
            }
        }

        if (segmentIndex !== -1) {
            setContextMenu({
                x: e.clientX,
                y: e.clientY,
                type: 'segment',
                segmentIndex,
                clickPoint: { x, y }
            });
        }
      }
  };

  const handlePointClick = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    if (mode === 'present') return;
    // Add annotation on left click if none exists and tool is node
    if (editTool === 'node') {
        const exists = annotations.some(a => a.pathIndex === index);
        if (!exists && !contextMenu && e.button === 0) {
            onAddAnnotation(index);
        }
    }
  };

  // --- Dragging Logic ---
  const handleMouseDownPoint = (e: React.MouseEvent, index: number) => {
      if (mode !== 'edit' || e.button !== 0 || editTool !== 'node') return;
      e.stopPropagation();
      setDraggedPointIndex(index);
  };
  
  const handleMouseDownAreaPoint = (e: React.MouseEvent, id: string, index: number) => {
      if (mode !== 'edit' || e.button !== 0 || editTool !== 'node') return;
      e.stopPropagation();
      setDraggedAreaPoint({ id, index });
      onSelect(id, 'area');
  };

  const handleMouseDownLeader = (e: React.MouseEvent, id: string, index: number) => {
      if (mode !== 'edit' || e.button !== 0 || editTool !== 'node') return;
      e.stopPropagation();
      setDraggedLeaderIndex({ id, index });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (draggedPointIndex !== null) {
        onMovePoint(draggedPointIndex, { x: mouseX, y: mouseY });
    } else if (draggedAreaPoint) {
        onMoveAreaPoint(draggedAreaPoint.id, draggedAreaPoint.index, { x: mouseX, y: mouseY });
    } else if (draggedAnnotation) {
      const ann = annotations.find(a => a.id === draggedAnnotation);
      if (ann && points[ann.pathIndex]) {
        const anchor = points[ann.pathIndex];
        onUpdateAnnotationOffset(draggedAnnotation, {
            x: mouseX - anchor.x,
            y: mouseY - anchor.y
        });
      }
    } else if (draggedLeaderIndex) {
         const ann = annotations.find(a => a.id === draggedLeaderIndex.id);
         if (ann && points[ann.pathIndex]) {
             const anchor = points[ann.pathIndex];
             // Leader points are relative to anchor
             const newPoints = [...(ann.leaderPoints || [])];
             newPoints[draggedLeaderIndex.index] = {
                 x: mouseX - anchor.x,
                 y: mouseY - anchor.y
             };
             onUpdateLeaderPoints(ann.id, newPoints);
         }
    }
  };

  const handleMouseUp = () => {
    setDraggedAnnotation(null);
    setDraggedPointIndex(null);
    setDraggedLeaderIndex(null);
    setDraggedAreaPoint(null);
  };

  // --- Context Menu ---
  const handleContextMenu = (e: React.MouseEvent, type: ContextMenuType['type'], id?: string, index?: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (editTool === 'node' || editTool === 'area') {
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            type,
            targetId: id,
            index
        });
      }
  };

  // --- Rendering ---
  const generatePathString = () => {
    if (points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  };
  
  const generatePolyString = (pts: Point[]) => {
      return pts.map(p => `${p.x},${p.y}`).join(' ');
  };

  // Calculate Dash Offset based on current distance
  const strokeDashoffset = Math.max(0, totalPathLength - currentDistance);

  // Leader Line Geometry Construction
  const getLeaderPolyline = (ann: Annotation) => {
      const start = points[ann.pathIndex];
      if (!start) return '';
      const pointsArray = [
          { x: 0, y: 0 }, // Start at Anchor (relative 0,0)
          ...(ann.leaderPoints || []),
          ann.offset // End at label
      ];
      // Convert to absolute string for SVG
      return pointsArray.map(p => `${start.x + p.x},${start.y + p.y}`).join(' ');
  };

  return (
    <div 
      className="flex-1 bg-gray-950 relative flex items-center justify-center select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleCanvasRightClick}
    >
      {!image && (
        <div className="text-gray-500 text-center p-8 border-2 border-dashed border-gray-800 rounded-xl">
          <p className="mb-2 text-lg font-medium">No Image Loaded</p>
          <p className="text-sm">Upload an image from the toolbar to start annotating</p>
        </div>
      )}

      {image && (
        <div 
            className={`inline-flex flex-col shadow-2xl bg-gray-900 transition-all duration-300 ${editTool === 'path' || editTool === 'area' ? 'cursor-crosshair' : 'cursor-default'}`}
            style={{ 
                maxWidth: '100%', 
                maxHeight: settings.enableCommentMode && activeComment ? '90vh' : '85vh',
            }}
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
        >
          {/* Main Canvas Area */}
          <div className="relative overflow-hidden group">
            <img 
                src={image} 
                alt="Annotation Subject" 
                className="block max-w-full max-h-[75vh] pointer-events-none object-contain"
                draggable={false}
            />

            <svg 
                ref={containerRef as any} // Cast for compatibility with div ref logic
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ zIndex: 10 }}
            >
                <defs>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="1" dy="2" stdDeviation="2" floodOpacity="0.5"/>
                </filter>
                {/* Mask for Progressive Stroke on Multi-Colored Path */}
                <mask id="path-mask">
                        <path
                            d={generatePathString()}
                            fill="none"
                            stroke="white"
                            strokeWidth={settings.pathWidth}
                            strokeDasharray={totalPathLength || 1}
                            strokeDashoffset={strokeDashoffset}
                            strokeLinecap={settings.strokeLinecap}
                            strokeLinejoin={settings.strokeLinejoin}
                        />
                </mask>
                </defs>
                
                {/* AREAS (ZONES) */}
                {areas.map(area => {
                    const isVisible = mode === 'edit' || visibleAreaIds.includes(area.id);
                    const isSelected = selectedId === area.id;

                    return (
                        <g key={area.id}>
                            <polygon
                                points={generatePolyString(area.points)}
                                fill={area.fillColor}
                                fillOpacity={area.fillOpacity}
                                stroke={isSelected ? '#fff' : area.strokeColor}
                                strokeWidth={isSelected ? (area.strokeWidth + 2) : area.strokeWidth}
                                strokeDasharray={isSelected && mode === 'edit' ? "5 5" : "none"}
                                className={`transition-all duration-700 ease-in-out ${mode === 'edit' ? 'cursor-pointer pointer-events-auto interactive-element' : ''}`}
                                style={{ opacity: isVisible ? 1 : 0 }}
                                onClick={(e) => {
                                    if(mode === 'edit') {
                                        e.stopPropagation();
                                        onSelect(area.id, 'area');
                                    }
                                }}
                                onContextMenu={(e) => handleContextMenu(e, 'annotation', area.id)}
                            />
                            {/* Area Control Points (Edit Mode Only - Node Tool) */}
                            {mode === 'edit' && editTool === 'node' && area.points.map((p, i) => (
                                <circle
                                    key={`area-${area.id}-pt-${i}`}
                                    cx={p.x}
                                    cy={p.y}
                                    r={4}
                                    fill={area.strokeColor}
                                    stroke="white"
                                    strokeWidth={1}
                                    className="cursor-move interactive-element pointer-events-auto"
                                    onMouseDown={(e) => handleMouseDownAreaPoint(e, area.id, i)}
                                />
                            ))}
                        </g>
                    );
                })}
                
                {/* TEMP AREA DRAWING */}
                {editTool === 'area' && tempAreaPoints.length > 0 && (
                    <g>
                        <polyline
                            points={generatePolyString(tempAreaPoints)}
                            fill="none"
                            stroke="cyan"
                            strokeWidth={2}
                            strokeDasharray="4 2"
                        />
                        {tempAreaPoints.map((p, i) => (
                            <circle key={i} cx={p.x} cy={p.y} r={3} fill="cyan" />
                        ))}
                    </g>
                )}

                {/* Ghost / Trace Path */}
                {settings.showTrace && mode === 'present' && (
                    <path
                        d={generatePathString()}
                        fill="none"
                        stroke={settings.traceColor}
                        strokeWidth={settings.pathWidth}
                        strokeOpacity={settings.traceOpacity}
                        strokeLinecap={settings.strokeLinecap}
                        strokeLinejoin={settings.strokeLinejoin}
                        strokeDasharray="4 4" 
                    />
                )}

                {/* Main Animating Polyline (Masked for Multi-Color support) */}
                {!isFlashing && points.length > 1 && (
                    <g mask={mode === 'present' ? "url(#path-mask)" : undefined} filter="url(#shadow)">
                    {points.map((p, i) => {
                        if (i === points.length - 1) return null;
                        const next = points[i+1];
                        const segmentColor = p.color || settings.pathColor;
                        
                        return (
                            <line
                                    key={`seg-${i}`}
                                    x1={p.x} y1={p.y}
                                    x2={next.x} y2={next.y}
                                    stroke={segmentColor}
                                    strokeWidth={settings.pathWidth}
                                    strokeOpacity={settings.pathOpacity}
                                    strokeLinecap={settings.strokeLinecap}
                            />
                        );
                    })}
                    {points.every(p => !p.color) && (
                        <path
                                d={generatePathString()}
                                fill="none"
                                stroke={settings.pathColor}
                                strokeWidth={settings.pathWidth}
                                strokeOpacity={settings.pathOpacity}
                                strokeLinecap={settings.strokeLinecap}
                                strokeLinejoin={settings.strokeLinejoin}
                            />
                    )}
                    </g>
                )}

                {/* Flash Effect Polyline */}
                {isFlashing && (
                    <path
                        d={generatePathString()}
                        fill="none"
                        stroke={settings.flashColor}
                        strokeWidth={settings.pathWidth + 2} // Slightly thicker
                        strokeLinecap={settings.strokeLinecap}
                        strokeLinejoin={settings.strokeLinejoin}
                        filter="url(#shadow)"
                        className="animate-pulse" // Tailwind pulse
                    />
                )}

                {/* Annotations Lines */}
                {annotations.map(ann => {
                    const isVisible = mode === 'edit' || visibleAnnotationIds.includes(ann.id);
                    const start = points[ann.pathIndex];
                    if (!start) return null;
                    const end = { x: start.x + ann.offset.x, y: start.y + ann.offset.y };
                    
                    const polylinePoints = [
                        { x: start.x, y: start.y },
                        ...(ann.leaderPoints || []).map(lp => ({ x: start.x + lp.x, y: start.y + lp.y })),
                        end
                    ];
                    
                    const lastPt = polylinePoints[polylinePoints.length - 1];
                    const prevPt = polylinePoints[polylinePoints.length - 2];
                    
                    const dx = prevPt.x - lastPt.x;
                    const dy = prevPt.y - lastPt.y;
                    const angle = Math.atan2(dy, dx) * (180 / Math.PI) - 90; 
                    
                    const arrowColor = ann.color || settings.arrowColor; 

                    return (
                        <g key={`leader-group-${ann.id}`} className="transition-opacity duration-300" opacity={isVisible ? 1 : 0}>
                            <polyline
                                points={getLeaderPolyline(ann)}
                                fill="none"
                                stroke={arrowColor}
                                strokeWidth={settings.arrowWidth}
                                strokeOpacity={0.8}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                            {mode === 'edit' && editTool === 'node' && selectedId === ann.id && (ann.leaderPoints || []).map((lp, idx) => (
                                <circle
                                    key={`lp-${idx}`}
                                    cx={start.x + lp.x}
                                    cy={start.y + lp.y}
                                    r={4}
                                    fill="white"
                                    stroke={settings.arrowColor}
                                    className="cursor-move interactive-element pointer-events-auto"
                                    onMouseDown={(e) => handleMouseDownLeader(e, ann.id, idx)}
                                />
                            ))}
                            
                            <polygon
                                points="0,0 -4,-8 4,-8" 
                                fill={arrowColor}
                                transform={`translate(${end.x}, ${end.y}) rotate(${angle}) scale(${settings.arrowWidth * 0.5})`}
                            />
                            <circle cx={end.x} cy={end.y} r={settings.arrowWidth} fill={arrowColor} />
                        </g>
                    );
                })}

                {/* Interactive Points (Edit Mode - Node Tool & Path Tool Visibility) */}
                {mode === 'edit' && (editTool === 'node' || editTool === 'path') && points.map((p, i) => (
                    <circle
                        key={`point-${i}`}
                        cx={p.x}
                        cy={p.y}
                        r={Math.max(6, settings.pathWidth * 1.5)}
                        fill={p.color || settings.pathColor}
                        stroke="white"
                        strokeWidth={2}
                        className={`transition-colors interactive-element ${editTool === 'node' ? 'cursor-move hover:fill-white hover:stroke-indigo-500 pointer-events-auto' : 'pointer-events-none opacity-60'}`}
                        onMouseDown={editTool === 'node' ? (e) => handleMouseDownPoint(e, i) : undefined}
                        onClick={editTool === 'node' ? (e) => handlePointClick(e, i) : undefined}
                        onContextMenu={editTool === 'node' ? (e) => handleContextMenu(e, 'point', undefined, i) : undefined}
                    />
                ))}
            </svg>

            {/* HTML Overlay for Labels */}
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 20 }}>
                {annotations.map(ann => {
                    const isVisible = mode === 'edit' || visibleAnnotationIds.includes(ann.id);
                    const anchor = points[ann.pathIndex];
                    if (!anchor) return null;
                    const x = anchor.x + ann.offset.x;
                    const y = anchor.y + ann.offset.y;
                    const isSelected = selectedId === ann.id;
                    
                    const textColor = ann.color || settings.labelTextColor;
                    const borderColor = ann.color || settings.arrowColor;
                    const bgColor = settings.labelBackgroundColor;
                    
                    const hexToRgb = (hex: string) => {
                        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                        return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0,0,0';
                    }

                    return (
                        <div
                            key={ann.id}
                            className={`absolute interactive-element group flex items-start transition-all duration-500 ease-out`}
                            style={{
                                left: x,
                                top: y,
                                transform: `translate(0, -50%) ${isVisible ? 'scale(1)' : 'scale(0.9)'}`,
                                opacity: isVisible ? 1 : 0,
                                pointerEvents: mode === 'edit' && editTool === 'node' ? 'auto' : 'none',
                            }}
                            onClick={(e) => {
                                if(mode === 'edit' && editTool === 'node') {
                                    e.stopPropagation();
                                    onSelect(ann.id, 'annotation');
                                }
                            }}
                            onContextMenu={(e) => handleContextMenu(e, 'annotation', ann.id)}
                        >
                            {mode === 'edit' && editTool === 'node' && (
                                <div 
                                    className={`mr-2 p-1 rounded bg-black/50 hover:bg-white/20 cursor-move ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        setDraggedAnnotation(ann.id);
                                        onSelect(ann.id, 'annotation');
                                    }}
                                >
                                    <Move className="w-3 h-3 text-white" />
                                </div>
                            )}

                            <div 
                                className={`
                                    relative px-3 py-2 rounded-lg backdrop-blur-sm shadow-xl border
                                    ${isSelected ? 'ring-1 ring-white' : ''}
                                `}
                                style={{ 
                                    backgroundColor: `rgba(${hexToRgb(bgColor)}, ${settings.labelBackgroundOpacity})`,
                                    borderColor: borderColor,
                                    borderLeftWidth: '4px' 
                                }}
                            >
                                <p 
                                    style={{ 
                                        color: textColor, 
                                        fontSize: `${ann.fontSize || 14}px`,
                                        whiteSpace: 'nowrap',
                                        fontWeight: 600
                                    }}
                                >
                                    {ann.text}
                                </p>
                                
                                {(settings.showOrderNumbers || mode === 'edit') && (
                                    <div className="absolute -top-3 -right-3 w-6 h-6 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center text-[10px] text-white font-bold shadow-sm z-10">
                                        {ann.order}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
          </div>

          {/* Integrated Comment Section */}
          {settings.enableCommentMode && (
              <div 
                className={`
                    w-full bg-gray-900 border-t border-gray-800 p-6 flex items-center justify-center text-center transition-all duration-300
                    ${activeComment ? 'min-h-[120px] opacity-100' : 'min-h-[0px] h-0 p-0 overflow-hidden opacity-0'}
                `}
              >
                  <p className="text-xl font-serif text-gray-200 leading-relaxed max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-500">
                    {activeComment}
                  </p>
              </div>
          )}
          
          {/* Context Menu */}
          {contextMenu && (
              <div 
                className="fixed bg-gray-900 border border-gray-700 rounded-lg shadow-2xl py-1 z-50 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
                style={{ left: contextMenu.x, top: contextMenu.y }}
              >
                  {/* SEGMENT MENU */}
                  {contextMenu.type === 'segment' && (
                      <button 
                        onClick={() => {
                            if (contextMenu.clickPoint) {
                                onAddPoint(contextMenu.clickPoint, (contextMenu.segmentIndex || 0) + 1);
                            }
                            setContextMenu(null);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                      >
                          <PlusCircle className="w-4 h-4" /> Add Vertex Here
                      </button>
                  )}

                  {/* POINT MENU */}
                  {contextMenu.type === 'point' && typeof contextMenu.index === 'number' && (
                      <>
                        <div className="px-4 py-2 text-xs text-gray-500 font-bold uppercase tracking-wider">Vertex Color</div>
                        <div className="px-4 pb-2 flex gap-2 flex-wrap max-w-[160px]">
                            {['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff'].map(c => (
                                <button
                                    key={c}
                                    onClick={() => {
                                        onUpdatePointColor(contextMenu.index!, c);
                                        setContextMenu(null);
                                    }}
                                    className="w-5 h-5 rounded-full border border-gray-600 hover:scale-110 transition-transform"
                                    style={{ backgroundColor: c }}
                                    title={c}
                                />
                            ))}
                            <button
                                onClick={() => {
                                    onUpdatePointColor(contextMenu.index!, undefined);
                                    setContextMenu(null);
                                }}
                                className="w-5 h-5 rounded-full border border-gray-600 hover:scale-110 transition-transform bg-gray-800 flex items-center justify-center text-[8px] text-white"
                                title="Reset to Global"
                            >
                                x
                            </button>
                        </div>
                        <div className="h-px bg-gray-800 my-1"></div>
                        <button 
                            onClick={() => onDeletePoint(contextMenu.index!)}
                            className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-800 flex items-center gap-2"
                        >
                            <Trash2 className="w-4 h-4" /> Delete Vertex
                        </button>
                      </>
                  )}

                  {/* ANNOTATION OR AREA MENU */}
                  {contextMenu.type === 'annotation' && contextMenu.targetId && (
                      <>
                        {/* Area/Zone Specific logic can be handled here if needed */}
                        {areas.some(a => a.id === contextMenu.targetId) ? null : (
                            <>
                            <button 
                                onClick={() => {
                                    const ann = annotations.find(a => a.id === contextMenu.targetId);
                                    if (ann) {
                                        const newPoints = ann.leaderPoints ? [...ann.leaderPoints] : [];
                                        newPoints.push({ x: ann.offset.x / 2, y: ann.offset.y / 2 });
                                        onUpdateLeaderPoints(ann.id, newPoints);
                                    }
                                    setContextMenu(null);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                            >
                                <PenTool className="w-4 h-4" /> Add Elbow Point
                            </button>
                            <button 
                                onClick={() => {
                                    const ann = annotations.find(a => a.id === contextMenu.targetId);
                                    if (ann) navigator.clipboard.writeText(ann.text);
                                    setContextMenu(null);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                            >
                                <Copy className="w-4 h-4" /> Copy Text
                            </button>
                            <button 
                                onClick={() => {
                                    onDuplicateAnnotation(contextMenu.targetId!);
                                    setContextMenu(null);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                            >
                                <CornerUpRight className="w-4 h-4" /> Duplicate
                            </button>
                            <div className="h-px bg-gray-800 my-1"></div>
                            <button 
                                onClick={() => onDeleteAnnotation(contextMenu.targetId!)}
                                className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-800 flex items-center gap-2"
                            >
                                <Trash2 className="w-4 h-4" /> Delete Label
                            </button>
                            </>
                        )}
                      </>
                  )}
              </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CanvasArea;