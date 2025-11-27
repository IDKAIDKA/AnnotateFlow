import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Point, Annotation, Area, AppSettings, AppMode, Version, EditTool } from './types';
import CanvasArea from './components/CanvasArea';
import SettingsPanel from './components/SettingsPanel';
import { Upload, Play, Pause, RefreshCw, Eraser, Edit3, Save, Video, MousePointer2, PenTool, Square, ChevronLeft, ChevronRight, GripHorizontal } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

// Helper to calculate distance between two points
const dist = (p1: Point, p2: Point) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

const App: React.FC = () => {
  // --- State ---
  const [image, setImage] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  
  const [mode, setMode] = useState<AppMode>('edit');
  const [editTool, setEditTool] = useState<EditTool>('path');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  const [versions, setVersions] = useState<Version[]>([]);
  
  // Temporary State for Area Drawing
  const [tempAreaPoints, setTempAreaPoints] = useState<Point[]>([]);

  // Settings
  const [settings, setSettings] = useState<AppSettings>({
    pathColor: '#ef4444',
    pathWidth: 4,
    pathOpacity: 1,
    
    showTrace: false,
    traceColor: '#ffffff',
    traceOpacity: 0.2,

    enableFlash: false,
    flashColor: '#ffffff',
    flashDuration: 0.5,

    defaultSegmentDuration: 2,
    defaultPauseDuration: 1.5,
    defaultAreaDuration: 2,
    
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    labelTextColor: '#ffffff',
    labelBackgroundColor: '#111827',
    labelBackgroundOpacity: 0.8,
    arrowColor: '#ef4444',
    arrowWidth: 2,

    showOrderNumbers: true,
    enableCommentMode: false,
  });

  // Animation State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0); 
  const [isFlashing, setIsFlashing] = useState(false);

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingCountdown, setRecordingCountdown] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Controls Dragging State
  const [controlsPosition, setControlsPosition] = useState<{x: number, y: number} | null>(null);
  const isDraggingControls = useRef(false);
  const controlsDragOffset = useRef({ x: 0, y: 0 });
  const controlsRef = useRef<HTMLDivElement>(null);

  const requestRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // --- Derived State (Timeline Engine) ---
  
  // 1. Path Segments & Distances
  const pathData = useMemo(() => {
    let totalLength = 0;
    const segmentLengths: number[] = [];
    const pointDistances: number[] = [0]; // Distance from start to point i

    for (let i = 0; i < points.length - 1; i++) {
        const d = dist(points[i], points[i+1]);
        segmentLengths.push(d);
        totalLength += d;
        pointDistances.push(totalLength);
    }
    return { totalLength, segmentLengths, pointDistances };
  }, [points]);

  // 2. Timeline Schedule (Mixed Annotations and Areas)
  const timeline = useMemo(() => {
    // Collect all timed events
    const schedule: Array<{
        type: 'draw' | 'wait' | 'area';
        startTime: number;
        duration: number;
        startDist: number; // Path distance at this time
        endDist: number;
        itemId?: string; // Annotation or Area ID
    }> = [];

    // Combine and sort by order
    const items = [
        ...annotations.map(a => ({ ...a, itemType: 'annotation' as const })),
        ...areas.map(a => ({ ...a, itemType: 'area' as const }))
    ].sort((a, b) => a.order - b.order);

    let timeCursor = 0;
    let distCursor = 0;
    
    let currentPointIdx = 0;

    for (const item of items) {
        if (item.itemType === 'annotation') {
            const ann = item as Annotation;
            const targetIdx = ann.pathIndex;
            
            // Draw Path Segment
            let segmentDist = 0;
            if (targetIdx > currentPointIdx) {
                segmentDist = pathData.pointDistances[targetIdx] - pathData.pointDistances[currentPointIdx];
            }
            
            if (segmentDist > 0 || (currentPointIdx === 0 && targetIdx === 0 && schedule.length === 0)) {
                const drawDuration = ann.segmentDuration ?? settings.defaultSegmentDuration;
                schedule.push({
                    type: 'draw',
                    startTime: timeCursor,
                    duration: drawDuration,
                    startDist: distCursor,
                    endDist: distCursor + segmentDist
                });
                timeCursor += drawDuration;
                distCursor += segmentDist;
            }

            // Wait/Show Label
            const waitDuration = ann.pauseDuration ?? settings.defaultPauseDuration;
            schedule.push({
                type: 'wait',
                startTime: timeCursor,
                duration: waitDuration,
                startDist: distCursor,
                endDist: distCursor,
                itemId: ann.id
            });
            timeCursor += waitDuration;
            
            currentPointIdx = targetIdx;

        } else if (item.itemType === 'area') {
            const area = item as Area;
            // Area fade in event
            const duration = area.appearDuration ?? settings.defaultAreaDuration;
            
            schedule.push({
                type: 'area',
                startTime: timeCursor,
                duration: duration,
                startDist: distCursor,
                endDist: distCursor,
                itemId: area.id
            });
            timeCursor += duration;
        }
    }

    // Finish path tail
    if (points.length > 0 && currentPointIdx < points.length - 1) {
        const remainingDist = pathData.totalLength - pathData.pointDistances[currentPointIdx];
        if (remainingDist > 0.1) {
             const drawDuration = settings.defaultSegmentDuration; 
             schedule.push({
                type: 'draw',
                startTime: timeCursor,
                duration: drawDuration,
                startDist: distCursor,
                endDist: distCursor + remainingDist
            });
            timeCursor += drawDuration;
        }
    }

    return { schedule, totalDuration: timeCursor };

  }, [points, annotations, areas, settings.defaultSegmentDuration, settings.defaultPauseDuration, settings.defaultAreaDuration, pathData]);


  // --- Animation Logic ---

  const getAnimationState = (time: number) => {
    // 1. Flash Phase
    if (settings.enableFlash && time < settings.flashDuration) {
        return { 
            currentDistance: 0, 
            activeAnnotationIds: [], 
            visibleAreaIds: [],
            isFlashing: true 
        };
    }

    const effectiveTime = settings.enableFlash ? time - settings.flashDuration : time;
    if (effectiveTime < 0) return { currentDistance: 0, activeAnnotationIds: [], visibleAreaIds: [], isFlashing: false };

    // 2. Timeline Phase
    const activeEvent = timeline.schedule.find(e => effectiveTime >= e.startTime && effectiveTime < e.startTime + e.duration);
    
    // Determine visible items based on passed events
    const visibleAnnIds: string[] = [];
    const visibleAreaIds: string[] = [];
    
    // Add items from fully passed events
    timeline.schedule.filter(e => e.startTime + e.duration <= effectiveTime).forEach(e => {
        if (e.type === 'wait' && e.itemId) visibleAnnIds.push(e.itemId);
        if (e.type === 'area' && e.itemId) visibleAreaIds.push(e.itemId);
    });

    // Add current item if active
    if (activeEvent?.type === 'wait' && activeEvent.itemId) visibleAnnIds.push(activeEvent.itemId);
    if (activeEvent?.type === 'area' && activeEvent.itemId) visibleAreaIds.push(activeEvent.itemId);

    let currentDistance = 0;
    
    if (activeEvent) {
        if (activeEvent.type === 'draw') {
             const progress = (effectiveTime - activeEvent.startTime) / activeEvent.duration;
             currentDistance = activeEvent.startDist + (activeEvent.endDist - activeEvent.startDist) * progress;
        } else {
             // For wait or area events, path distance is static
             currentDistance = activeEvent.startDist;
        }
    } else if (effectiveTime >= timeline.totalDuration) {
        currentDistance = pathData.totalLength;
    }

    return {
        currentDistance,
        activeAnnotationIds: visibleAnnIds,
        visibleAreaIds: visibleAreaIds,
        isFlashing: false
    };
  };

  const animate = (time: number) => {
    if (!startTimeRef.current) startTimeRef.current = time;
    requestRef.current = requestAnimationFrame(animate);
  };
  
  // Animation Loop
  useEffect(() => {
      let lastFrameTime = 0;
      
      const loop = (timestamp: number) => {
          if (!isPlaying) return;
          
          if (!lastFrameTime) lastFrameTime = timestamp;
          const dt = (timestamp - lastFrameTime) / 1000;
          lastFrameTime = timestamp;
          
          setCurrentTime(prev => {
              const next = prev + dt;
              const totalTime = timeline.totalDuration + (settings.enableFlash ? settings.flashDuration : 0);
              
              if (next >= totalTime) {
                  setIsPlaying(false);
                  
                  // Stop Recording if active
                  if (recorderRef.current && recorderRef.current.state === 'recording') {
                      recorderRef.current.stop();
                  }

                  return totalTime;
              }
              return next;
          });
          
          requestRef.current = requestAnimationFrame(loop);
      };

      if (isPlaying) {
          requestRef.current = requestAnimationFrame(loop);
      } else {
          lastFrameTime = 0;
      }

      return () => {
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
      };
  }, [isPlaying, timeline.totalDuration, settings.enableFlash, settings.flashDuration]);


  // --- Keyboard Controls ---
  useEffect(() => {
      if (mode !== 'present') return;

      const handleKeyDown = (e: KeyboardEvent) => {
          if (e.code === 'Space') {
              e.preventDefault();
              togglePlay();
          } else if (e.code === 'ArrowRight') {
              e.preventDefault();
              // Jump to next event
              const effectiveTime = settings.enableFlash ? currentTime - settings.flashDuration : currentTime;
              const nextEvent = timeline.schedule.find(ev => ev.startTime > effectiveTime + 0.1);
              if (nextEvent) {
                  setCurrentTime(nextEvent.startTime + (settings.enableFlash ? settings.flashDuration : 0));
              } else {
                  // Jump to end
                   setCurrentTime(timeline.totalDuration + (settings.enableFlash ? settings.flashDuration : 0));
              }
          } else if (e.code === 'ArrowLeft') {
              e.preventDefault();
              // Jump to start of current or prev event
              const effectiveTime = settings.enableFlash ? currentTime - settings.flashDuration : currentTime;
              const currentEvent = timeline.schedule.find(ev => effectiveTime >= ev.startTime && effectiveTime < ev.startTime + ev.duration);
              
              if (currentEvent && (effectiveTime - currentEvent.startTime > 0.5)) {
                  // Reset to start of current
                   setCurrentTime(currentEvent.startTime + (settings.enableFlash ? settings.flashDuration : 0));
              } else {
                   // Go to previous
                   const prevEvents = timeline.schedule.filter(ev => ev.startTime < effectiveTime - 0.1);
                   const prev = prevEvents[prevEvents.length - 1];
                   if (prev) {
                        setCurrentTime(prev.startTime + (settings.enableFlash ? settings.flashDuration : 0));
                   } else {
                       setCurrentTime(0);
                   }
              }
          }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, currentTime, timeline.schedule, settings.enableFlash, settings.flashDuration]);


  // --- Global Mouse Handlers (for Draggable Controls) ---
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
        if (isDraggingControls.current) {
            setControlsPosition({
                x: e.clientX - controlsDragOffset.current.x,
                y: e.clientY - controlsDragOffset.current.y
            });
        }
    };

    const handleMouseUp = () => {
        isDraggingControls.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // --- Handlers ---

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          setImage(evt.target.result as string);
          setPoints([]);
          setAnnotations([]);
          setAreas([]);
          setCurrentTime(0);
          setMode('edit');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddPoint = (point: Point, index?: number) => {
      setPoints(prev => {
          if (typeof index === 'number') {
              const newPoints = [...prev];
              newPoints.splice(index, 0, point);
              return newPoints;
          }
          return [...prev, point];
      });
      // Correct annotation indices if needed
      if (typeof index === 'number') {
          setAnnotations(prev => prev.map(ann => {
              if (ann.pathIndex >= index) return { ...ann, pathIndex: ann.pathIndex + 1 };
              return ann;
          }));
      }
  };

  const handleMovePoint = (index: number, newPos: Point) => {
    setPoints(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...newPos }; // Preserve color
      return next;
    });
  };

  const handleDeletePoint = (index: number) => {
    setPoints(prev => prev.filter((_, i) => i !== index));
    setAnnotations(prev => {
        const kept: Annotation[] = [];
        prev.forEach(ann => {
            if (ann.pathIndex === index) return;
            if (ann.pathIndex > index) kept.push({ ...ann, pathIndex: ann.pathIndex - 1 });
            else kept.push(ann);
        });
        return kept;
    });
  };

  const handleUpdatePointColor = (index: number, color: string | undefined) => {
      setPoints(prev => {
          const next = [...prev];
          next[index] = { ...next[index], color };
          return next;
      });
  };

  const handleAddAnnotation = (pointIndex: number) => {
    const newOrder = annotations.length + areas.length + 1;
    const newAnnotation: Annotation = {
      id: uuidv4(),
      pathIndex: pointIndex,
      text: `Label ${annotations.length + 1}`,
      order: newOrder,
      offset: { x: 50, y: -50 }, 
      segmentDuration: settings.defaultSegmentDuration,
      pauseDuration: settings.defaultPauseDuration
    };
    setAnnotations(prev => [...prev, newAnnotation]);
    setSelectedId(newAnnotation.id);
  };

  const handleAddAreaPoint = (p: Point) => {
      setTempAreaPoints(prev => [...prev, p]);
  };

  const handleFinishArea = () => {
      if (tempAreaPoints.length < 3) {
          setTempAreaPoints([]);
          return;
      }
      const newOrder = annotations.length + areas.length + 1;
      const newArea: Area = {
          id: uuidv4(),
          points: tempAreaPoints,
          fillColor: '#8b5cf6',
          fillOpacity: 0.3,
          strokeColor: '#8b5cf6',
          strokeWidth: 2,
          order: newOrder,
          appearDuration: settings.defaultAreaDuration
      };
      setAreas(prev => [...prev, newArea]);
      setTempAreaPoints([]);
      setSelectedId(newArea.id);
  };
  
  const handleMoveAreaPoint = (id: string, index: number, newPos: Point) => {
      setAreas(prev => prev.map(a => {
          if (a.id !== id) return a;
          const newPoints = [...a.points];
          newPoints[index] = newPos;
          return { ...a, points: newPoints };
      }));
  };

  const handleDeleteAnnotation = (id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleDeleteArea = (id: string) => {
      setAreas(prev => prev.filter(a => a.id !== id));
      if (selectedId === id) setSelectedId(null);
  };

  const handleDuplicateAnnotation = (id: string) => {
    const original = annotations.find(a => a.id === id);
    if (!original) return;
    const newOrder = annotations.length + areas.length + 1;
    const clone: Annotation = {
        ...original,
        id: uuidv4(),
        text: `${original.text} (Copy)`,
        order: newOrder,
        offset: { x: original.offset.x + 20, y: original.offset.y + 20 },
        leaderPoints: original.leaderPoints ? [...original.leaderPoints] : undefined
    };
    setAnnotations(prev => [...prev, clone]);
    setSelectedId(clone.id);
  };

  const handleUpdateAnnotationOffset = (id: string, offset: { x: number, y: number }) => {
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, offset } : a));
  };
  
  const handleUpdateLeaderPoints = (id: string, leaderPoints: Point[]) => {
      setAnnotations(prev => prev.map(a => a.id === id ? { ...a, leaderPoints } : a));
  };

  const handleClear = () => {
    if (confirm("Clear all points, annotations, and areas?")) {
      setPoints([]);
      setAnnotations([]);
      setAreas([]);
      setCurrentTime(0);
    }
  };

  const saveVersion = () => {
    const versionNum = versions.length + 1;
    const newVersion: Version = {
        id: uuidv4(),
        name: `V${versionNum}`,
        timestamp: Date.now(),
        data: {
            points: [...points],
            annotations: [...annotations],
            areas: [...areas],
            settings: { ...settings }
        }
    };
    setVersions(prev => [newVersion, ...prev]);
  };

  const restoreVersion = (version: Version) => {
    if (confirm(`Restore version "${version.name}"? Unsaved changes will be lost.`)) {
        setPoints(version.data.points);
        setAnnotations(version.data.annotations);
        setAreas(version.data.areas || []);
        setSettings(version.data.settings);
        setMode('edit');
        setCurrentTime(0);
    }
  };

  const togglePlay = () => {
    if (mode === 'edit') setMode('present');
    
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (currentTime >= timeline.totalDuration + (settings.enableFlash ? settings.flashDuration : 0)) {
         setCurrentTime(0);
      }
      setIsPlaying(true);
    }
  };

  const resetAnimation = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleExportVideo = async () => {
    if (isRecording) return;
    
    const confirmRec = confirm("Export to Video:\n\n1. Select 'Current Tab' (recommended) or 'Entire Screen' in the next popup.\n2. The animation will start automatically after a 3s countdown.\n3. Do not interact with the page while recording.\n\nReady?");
    if (!confirmRec) return;

    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: "browser" },
            audio: false 
        });

        // Robust mime type selection
        const possibleTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
            'video/mp4'
        ];
        const mimeType = possibleTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';

        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
            // Cleanup tracks
            stream.getTracks().forEach(track => track.stop());
            
            // Create download
            const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
            if (blob.size === 0) {
                alert("Export Failed: No video data captured.");
            } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `annotate-flow-export-${Date.now()}.${mimeType?.includes('mp4') ? 'mp4' : 'webm'}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
            
            // Reset state
            setIsRecording(false);
            setRecordingCountdown(null);
            setMode('edit');
            setIsPlaying(false);
        };

        // Handle user cancelling via browser UI
        stream.getVideoTracks()[0].onended = () => {
             if (recorder.state === 'recording') {
                 recorder.stop();
             } else {
                 setIsRecording(false);
                 setRecordingCountdown(null);
                 setMode('edit');
             }
        };

        // UI Transition
        setIsRecording(true);
        setMode('present');
        setCurrentTime(0);
        
        // Start Countdown
        setRecordingCountdown(3);
        let count = 3;
        const interval = setInterval(() => {
            count--;
            setRecordingCountdown(count);
            if (count === 0) {
                clearInterval(interval);
                setRecordingCountdown(null);
                
                // Start Recording & Animation
                if (recorder.state === 'inactive') {
                    // IMPORTANT: 100ms timeslice ensures data is captured even if stop is called abruptly
                    recorder.start(100); 
                    setIsPlaying(true);
                }
            }
        }, 1000);

    } catch (err) {
        console.error("Export failed:", err);
        setIsRecording(false);
        setRecordingCountdown(null);
    }
  };
  
  const handleControlsMouseDown = (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return; 
      isDraggingControls.current = true;
      if (controlsRef.current) {
          const rect = controlsRef.current.getBoundingClientRect();
          controlsDragOffset.current = {
              x: e.clientX - rect.left,
              y: e.clientY - rect.top
          };
      }
  };

  // Get current visual state
  const visualState = getAnimationState(currentTime);
  
  // Get active comment
  const activeComment = useMemo(() => {
      if (!settings.enableCommentMode) return null;
      // Get all active items
      const activeAnns = annotations.filter(a => visualState.activeAnnotationIds.includes(a.id));
      const activeAreas = areas.filter(a => visualState.visibleAreaIds.includes(a.id));
      
      const combined = [...activeAnns, ...activeAreas].sort((a, b) => b.order - a.order);
      // Return comment of highest order visible item
      return combined[0]?.comment ?? null;
  }, [settings.enableCommentMode, visualState.activeAnnotationIds, visualState.visibleAreaIds, annotations, areas]);

  return (
    <div className="flex h-screen bg-gray-950 text-white font-sans overflow-hidden">
      <div className="flex-1 flex flex-col relative min-w-0">
        
        {/* Top Toolbar (Hidden during recording) */}
        {!isRecording && (
            <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 z-30 shadow-md flex-shrink-0">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-lg tracking-tight">
                <Edit3 className="w-5 h-5" />
                <span>AnnotateFlow</span>
                </div>
                <div className="h-6 w-px bg-gray-700 mx-2"></div>
                
                <label className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg cursor-pointer transition-colors text-xs font-medium border border-gray-700">
                <Upload className="w-3 h-3" />
                <span>Upload</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>

                {image && (
                    <>
                    <button 
                    onClick={saveVersion}
                    className="flex items-center gap-2 px-3 py-1.5 text-gray-300 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors text-xs"
                    >
                    <Save className="w-3 h-3" />
                    <span>Save Ver</span>
                    </button>
                    <button 
                        onClick={handleClear}
                        className="flex items-center gap-2 px-3 py-1.5 text-gray-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors text-xs"
                    >
                        <Eraser className="w-3 h-3" />
                        <span>Clear</span>
                    </button>
                    
                    <div className="h-6 w-px bg-gray-700 mx-2"></div>
                    
                    <button 
                        onClick={handleExportVideo}
                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-900/50 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/30 rounded-lg transition-colors text-xs font-medium"
                        title="Record presentation to WebM video"
                    >
                        <Video className="w-3 h-3" />
                        <span>Export Video</span>
                    </button>
                </>
                )}
            </div>
            
            {/* Mode Switcher */}
            <div className="flex items-center bg-gray-800 rounded-lg p-1 border border-gray-700">
                <button
                    onClick={() => { setMode('edit'); resetAnimation(); }}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${mode === 'edit' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                    Edit
                </button>
                <button
                    onClick={() => { setMode('present'); }}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${mode === 'present' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                    Present
                </button>
            </div>
            </header>
        )}

        {/* Edit Tools Toolbar (Sub-header) - Hidden during recording */}
        {mode === 'edit' && image && !isRecording && (
            <div className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-center gap-4 px-4 z-20 flex-shrink-0">
                <button
                    onClick={() => setEditTool('path')}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all border ${editTool === 'path' ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-transparent border-transparent text-gray-400 hover:bg-gray-800'}`}
                >
                    <PenTool className="w-4 h-4" /> Draw Path
                </button>
                <button
                    onClick={() => setEditTool('node')}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all border ${editTool === 'node' ? 'bg-blue-500/20 border-blue-500 text-blue-300' : 'bg-transparent border-transparent text-gray-400 hover:bg-gray-800'}`}
                >
                    <MousePointer2 className="w-4 h-4" /> Edit Nodes
                </button>
                <button
                    onClick={() => setEditTool('area')}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all border ${editTool === 'area' ? 'bg-purple-500/20 border-purple-500 text-purple-300' : 'bg-transparent border-transparent text-gray-400 hover:bg-gray-800'}`}
                >
                    <Square className="w-4 h-4" /> Draw Zone
                </button>
            </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-auto flex items-center justify-center bg-gray-950 custom-scrollbar p-0">
             <CanvasArea
                image={image}
                points={points}
                onAddPoint={handleAddPoint}
                onMovePoint={handleMovePoint}
                onDeletePoint={handleDeletePoint}
                onUpdatePointColor={handleUpdatePointColor}
                annotations={annotations}
                onAddAnnotation={handleAddAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                onDuplicateAnnotation={handleDuplicateAnnotation}
                onUpdateAnnotationOffset={handleUpdateAnnotationOffset}
                onUpdateLeaderPoints={handleUpdateLeaderPoints}
                onSelect={(id, type) => {
                    setSelectedId(id);
                }}
                selectedId={selectedId}
                settings={settings}
                mode={mode}
                editTool={editTool}
                
                areas={areas}
                onAddAreaPoint={handleAddAreaPoint}
                onFinishArea={handleFinishArea}
                onUpdateArea={(id, up) => setAreas(p => p.map(a => a.id === id ? { ...a, ...up } : a))}
                onMoveAreaPoint={handleMoveAreaPoint}
                tempAreaPoints={tempAreaPoints}
                
                currentDistance={visualState.currentDistance}
                totalPathLength={pathData.totalLength}
                visibleAnnotationIds={visualState.activeAnnotationIds}
                visibleAreaIds={visualState.visibleAreaIds}
                isFlashing={visualState.isFlashing}
                activeComment={activeComment}
            />
        </div>
        
        {/* Playback Controls (Hidden during recording) */}
        {mode === 'present' && !isRecording && (
            <div 
                ref={controlsRef}
                onMouseDown={handleControlsMouseDown}
                className="absolute flex items-center gap-4 bg-gray-900/90 backdrop-blur border border-gray-700 rounded-full pl-4 pr-6 py-2 shadow-2xl z-50 cursor-grab active:cursor-grabbing hover:border-gray-500 transition-colors"
                style={{
                    left: controlsPosition ? controlsPosition.x : '50%',
                    top: controlsPosition ? controlsPosition.y : 'auto',
                    bottom: controlsPosition ? 'auto' : '1.5rem', // Default to bottom
                    transform: controlsPosition ? 'none' : 'translateX(-50%)',
                }}
            >
                <div className="mr-2 text-gray-600">
                    <GripHorizontal className="w-4 h-4" />
                </div>
                
                <button onClick={resetAnimation} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors">
                    <RefreshCw className="w-4 h-4" />
                </button>
                <button onClick={() => {}} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors">
                    <ChevronLeft className="w-5 h-5" />
                </button>
                
                <button 
                    onClick={togglePlay}
                    className={`
                        w-12 h-12 flex items-center justify-center rounded-full shadow-lg transform transition-all active:scale-95
                        ${isPlaying ? 'bg-yellow-500 hover:bg-yellow-400 text-black' : 'bg-indigo-500 hover:bg-indigo-400 text-white'}
                    `}
                >
                    {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                </button>

                 <button onClick={() => {}} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors">
                    <ChevronRight className="w-5 h-5" />
                </button>
                
                <div className="text-xs font-mono text-gray-500 min-w-[60px] text-center border-l border-gray-700 pl-4 ml-2">
                    {currentTime.toFixed(1)}s
                </div>
            </div>
        )}

        {/* Recording Countdown / Indicator */}
        {isRecording && (
             <div className="absolute top-0 right-0 p-4 z-50 pointer-events-none">
                 {recordingCountdown !== null ? (
                    <div className="flex flex-col items-center justify-center min-h-[200px] min-w-[200px] bg-black/60 backdrop-blur-md rounded-2xl animate-in fade-in zoom-in duration-300">
                        <div className="text-6xl font-black text-white mb-2">{recordingCountdown}</div>
                        <div className="text-sm font-medium text-gray-300 uppercase tracking-widest">Starting Record</div>
                    </div>
                 ) : (
                    <div className="flex items-center gap-2 bg-red-900/80 backdrop-blur text-red-200 px-3 py-1.5 rounded-full text-xs font-medium animate-pulse">
                        <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                        Recording...
                    </div>
                 )}
             </div>
        )}
      </div>

      {/* --- Right Sidebar (Settings) - Hidden during recording --- */}
      {!isRecording && (
        <SettingsPanel 
            settings={settings}
            setSettings={setSettings}
            annotations={annotations}
            setAnnotations={setAnnotations}
            areas={areas}
            setAreas={setAreas}
            mode={mode}
            onDeleteAnnotation={handleDeleteAnnotation}
            onDeleteArea={handleDeleteArea}
            selectedId={selectedId}
            setSelectedId={(id) => setSelectedId(id)}
            versions={versions}
            onRestoreVersion={restoreVersion}
            totalDuration={timeline.totalDuration}
        />
      )}
    </div>
  );
};

export default App;