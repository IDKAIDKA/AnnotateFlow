
import React, { useState } from 'react';
import { Settings, ArrowUp, ArrowDown, Trash2, History, RotateCcw, Clock, Palette, Save, Layers, PlayCircle, Zap, MessageSquare, CheckCircle, Copy, Square } from 'lucide-react';
import { Annotation, Area, AppSettings, AppMode, Version } from '../types';

interface SettingsPanelProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  annotations: Annotation[];
  setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
  areas: Area[];
  setAreas: React.Dispatch<React.SetStateAction<Area[]>>;
  mode: AppMode;
  onDeleteAnnotation: (id: string) => void;
  onDeleteArea: (id: string) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null, type: 'annotation' | 'area') => void;
  versions: Version[];
  onRestoreVersion: (v: Version) => void;
  totalDuration: number;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  setSettings,
  annotations,
  setAnnotations,
  areas,
  setAreas,
  mode,
  onDeleteAnnotation,
  onDeleteArea,
  selectedId,
  setSelectedId,
  versions,
  onRestoreVersion,
  totalDuration
}) => {
  if (mode === 'present') return null;

  const [activeTab, setActiveTab] = useState<'style' | 'timeline' | 'versions'>('style');

  // Combine and sort for Timeline
  const timelineItems = [
      ...annotations.map(a => ({ ...a, type: 'annotation' as const })),
      ...areas.map(a => ({ ...a, type: 'area' as const }))
  ].sort((a, b) => a.order - b.order);

  const updateAnnotation = (id: string, updates: Partial<Annotation>) => {
    setAnnotations((prev) =>
      prev.map((ann) => (ann.id === id ? { ...ann, ...updates } : ann))
    );
  };

  const updateArea = (id: string, updates: Partial<Area>) => {
    setAreas((prev) => 
        prev.map(a => (a.id === id ? { ...a, ...updates } : a))
    );
  };

  const applyDurationToAll = (type: 'draw' | 'wait', value: number) => {
    if (confirm(`Apply ${value}s ${type} time to ALL annotations?`)) {
      setAnnotations(prev => prev.map(ann => ({
        ...ann,
        [type === 'draw' ? 'segmentDuration' : 'pauseDuration']: value
      })));
    }
  };

  const reorder = (id: string, direction: 'up' | 'down') => {
    const currentIndex = timelineItems.findIndex(item => item.id === id);
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= timelineItems.length) return;

    const itemA = timelineItems[currentIndex];
    const itemB = timelineItems[newIndex];

    // Swap orders
    const orderA = itemA.order;
    const orderB = itemB.order;

    // Update state based on types
    const updateOrder = (item: typeof itemA, newOrder: number) => {
        if (item.type === 'annotation') {
            setAnnotations(prev => prev.map(a => a.id === item.id ? { ...a, order: newOrder } : a));
        } else {
            setAreas(prev => prev.map(a => a.id === item.id ? { ...a, order: newOrder } : a));
        }
    };

    updateOrder(itemA, orderB);
    updateOrder(itemB, orderA);
  };

  // Check selected type
  const selectedArea = areas.find(a => a.id === selectedId);
  const selectedAnnotation = annotations.find(a => a.id === selectedId);

  return (
    <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden shadow-xl z-20">
      
      {/* Tab Navigation */}
      <div className="flex border-b border-gray-800">
        <button
          onClick={() => setActiveTab('style')}
          className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${activeTab === 'style' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-gray-800/30' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <Palette className="w-3 h-3" /> Style
        </button>
        <button
          onClick={() => setActiveTab('timeline')}
          className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${activeTab === 'timeline' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-gray-800/30' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <Clock className="w-3 h-3" /> Timeline
        </button>
        <button
          onClick={() => setActiveTab('versions')}
          className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${activeTab === 'versions' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-gray-800/30' : 'text-gray-500 hover:text-gray-300'}`}
        >
          <History className="w-3 h-3" /> Versions
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        
        {/* === STYLE TAB === */}
        {activeTab === 'style' && (
          <div className="space-y-6">
             
             {/* Selected Area/Annotation Settings (Contextual) */}
             {selectedArea && (
                 <section className="bg-indigo-900/20 p-3 rounded-lg border border-indigo-500/30 mb-4">
                     <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-3">Selected Area</h3>
                     <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-[10px] text-gray-400 mb-1">Fill Color</label>
                                <input type="color" value={selectedArea.fillColor} onChange={(e) => updateArea(selectedArea.id, { fillColor: e.target.value })} className="w-full h-8 rounded border-none bg-transparent cursor-pointer"/>
                            </div>
                            <div>
                                <label className="block text-[10px] text-gray-400 mb-1">Stroke Color</label>
                                <input type="color" value={selectedArea.strokeColor} onChange={(e) => updateArea(selectedArea.id, { strokeColor: e.target.value })} className="w-full h-8 rounded border-none bg-transparent cursor-pointer"/>
                            </div>
                        </div>
                        <div>
                            <label className="block text-[10px] text-gray-400 mb-1">Opacity: {Math.round(selectedArea.fillOpacity * 100)}%</label>
                            <input type="range" min="0" max="1" step="0.1" value={selectedArea.fillOpacity} onChange={(e) => updateArea(selectedArea.id, { fillOpacity: parseFloat(e.target.value) })} className="w-full accent-indigo-500 h-1.5 bg-gray-700 rounded-lg"/>
                        </div>
                        <div>
                             <label className="block text-[10px] text-gray-400 mb-1">Stroke Width</label>
                             <input type="number" min="0" max="10" value={selectedArea.strokeWidth} onChange={(e) => updateArea(selectedArea.id, { strokeWidth: parseFloat(e.target.value) })} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs"/>
                        </div>
                     </div>
                 </section>
             )}

             {/* General Path Styles */}
            <section>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Path Appearance</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">Color & Width</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={settings.pathColor}
                                onChange={(e) => setSettings({ ...settings, pathColor: e.target.value })}
                                className="w-10 h-8 rounded border-none cursor-pointer bg-transparent"
                            />
                            <input
                                type="range"
                                min="1"
                                max="20"
                                value={settings.pathWidth}
                                onChange={(e) => setSettings({ ...settings, pathWidth: Number(e.target.value) })}
                                className="flex-1 accent-indigo-500 h-2 bg-gray-700 rounded-lg"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="flex items-center justify-between text-xs text-gray-400 mb-1">
                            <span>Path Opacity</span>
                            <span>{Math.round(settings.pathOpacity * 100)}%</span>
                        </label>
                        <input
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.05"
                            value={settings.pathOpacity}
                            onChange={(e) => setSettings({ ...settings, pathOpacity: Number(e.target.value) })}
                            className="w-full accent-indigo-500 h-2 bg-gray-700 rounded-lg"
                        />
                    </div>
                </div>
            </section>
            
            {/* Flash Animation */}
             <section className="pt-4 border-t border-gray-800">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                        <Zap className="w-3 h-3 text-yellow-500" /> Start Flash
                    </h3>
                    <input 
                        type="checkbox"
                        checked={settings.enableFlash}
                        onChange={(e) => setSettings({...settings, enableFlash: e.target.checked})}
                        className="rounded bg-gray-700 border-gray-600 text-indigo-500 focus:ring-0"
                    />
                </div>
                {settings.enableFlash && (
                    <div className="space-y-3 pl-2 border-l-2 border-gray-800">
                         <div className="flex items-center gap-2">
                             <input
                                type="color"
                                value={settings.flashColor}
                                onChange={(e) => setSettings({ ...settings, flashColor: e.target.value })}
                                className="w-8 h-8 rounded border-none cursor-pointer bg-transparent"
                            />
                            <div className="flex-1">
                                <label className="block text-[10px] text-gray-400">Duration (sec)</label>
                                <input
                                    type="number"
                                    min="0.1"
                                    max="2"
                                    step="0.1"
                                    value={settings.flashDuration}
                                    onChange={(e) => setSettings({ ...settings, flashDuration: Number(e.target.value) })}
                                    className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </section>

             {/* Presentation Settings */}
             <section className="pt-4 border-t border-gray-800">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Presentation</h3>
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-300">Show Order Numbers</span>
                        <input 
                            type="checkbox"
                            checked={settings.showOrderNumbers}
                            onChange={(e) => setSettings({...settings, showOrderNumbers: e.target.checked})}
                            className="rounded bg-gray-700 border-gray-600 text-indigo-500 focus:ring-0"
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                             <MessageSquare className="w-3 h-3 text-indigo-400" />
                             <span className="text-xs text-gray-300">Comment Mode</span>
                        </div>
                        <input 
                            type="checkbox"
                            checked={settings.enableCommentMode}
                            onChange={(e) => setSettings({...settings, enableCommentMode: e.target.checked})}
                            className="rounded bg-gray-700 border-gray-600 text-indigo-500 focus:ring-0"
                        />
                    </div>
                </div>
            </section>

            {/* Label & Arrow */}
            <section className="pt-4 border-t border-gray-800">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Labels & Arrows</h3>
                <div className="space-y-4">
                     <div className="flex items-center gap-2">
                        <div className="flex-1">
                            <label className="block text-[10px] text-gray-400 mb-1">Arrow Color</label>
                            <input
                                type="color"
                                value={settings.arrowColor}
                                onChange={(e) => setSettings({ ...settings, arrowColor: e.target.value })}
                                className="w-full h-8 rounded border-none cursor-pointer bg-transparent"
                            />
                        </div>
                        <div className="flex-1">
                             <label className="block text-[10px] text-gray-400 mb-1">Thickness</label>
                             <input
                                type="number"
                                min="0.5"
                                max="10"
                                step="0.5"
                                value={settings.arrowWidth}
                                onChange={(e) => setSettings({ ...settings, arrowWidth: Number(e.target.value) })}
                                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs"
                            />
                        </div>
                     </div>
                     
                     <div>
                        <label className="block text-[10px] text-gray-400 mb-1">Label Background</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={settings.labelBackgroundColor}
                                onChange={(e) => setSettings({ ...settings, labelBackgroundColor: e.target.value })}
                                className="h-8 w-12 rounded bg-transparent cursor-pointer"
                            />
                            <div className="flex-1 flex flex-col">
                                <span className="text-[10px] text-gray-500 mb-1">Text Color</span>
                                <input
                                    type="color"
                                    value={settings.labelTextColor}
                                    onChange={(e) => setSettings({ ...settings, labelTextColor: e.target.value })}
                                    className="h-6 w-full bg-transparent cursor-pointer"
                                />
                            </div>
                        </div>
                     </div>
                </div>
            </section>
          </div>
        )}

        {/* === TIMELINE TAB === */}
        {activeTab === 'timeline' && (
          <div className="space-y-6">
            <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 flex items-center justify-between">
                <div>
                    <span className="block text-xs text-gray-400 uppercase">Total Duration</span>
                    <span className="text-xl font-bold text-indigo-400">{totalDuration.toFixed(1)}s</span>
                </div>
                <PlayCircle className="w-6 h-6 text-gray-600" />
            </div>

            <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center justify-between">
                    <span>Sequence</span>
                    <span className="text-[10px]">Timing</span>
                </h3>
                
                {timelineItems.length === 0 && (
                     <div className="text-center py-8 text-gray-600 text-sm italic">
                         Add labels or areas to configure.
                     </div>
                )}

                {timelineItems.map((item) => (
                    <div 
                        key={item.id} 
                        className={`p-3 rounded-lg border transition-all ${selectedId === item.id ? 'bg-gray-800 border-indigo-500/50' : 'bg-gray-800/30 border-gray-800'}`}
                        onClick={() => setSelectedId(item.id, item.type)}
                    >
                        <div className="flex items-center justify-between mb-3">
                             <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-mono w-5 h-5 flex items-center justify-center rounded ${item.type === 'area' ? 'bg-purple-900 text-purple-200' : 'bg-gray-700 text-gray-300'}`}>
                                    {item.order}
                                </span>
                                {item.type === 'annotation' ? (
                                    <input
                                        type="text"
                                        value={(item as Annotation).text}
                                        onChange={(e) => updateAnnotation(item.id, { text: e.target.value })}
                                        className="bg-transparent border-none text-sm font-medium text-gray-200 focus:ring-0 p-0 w-32"
                                        placeholder="Label Text"
                                    />
                                ) : (
                                    <span className="text-sm font-medium text-purple-300 flex items-center gap-1">
                                        <Square className="w-3 h-3 fill-current" /> Area Zone
                                    </span>
                                )}
                             </div>
                             <div className="flex items-center gap-1">
                                <button onClick={(e) => { e.stopPropagation(); reorder(item.id, 'up'); }} className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-white"><ArrowUp className="w-3 h-3"/></button>
                                <button onClick={(e) => { e.stopPropagation(); reorder(item.id, 'down'); }} className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-white"><ArrowDown className="w-3 h-3"/></button>
                                <button onClick={(e) => { 
                                    e.stopPropagation(); 
                                    item.type === 'annotation' ? onDeleteAnnotation(item.id) : onDeleteArea(item.id); 
                                }} className="p-1 hover:bg-red-900/30 rounded text-gray-500 hover:text-red-400"><Trash2 className="w-3 h-3"/></button>
                             </div>
                        </div>

                        {item.type === 'annotation' && (
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div className="bg-gray-900/50 rounded p-2 flex flex-col gap-1">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] text-gray-500 uppercase">Draw</label>
                                        <button onClick={(e) => { e.stopPropagation(); applyDurationToAll('draw', (item as Annotation).segmentDuration ?? settings.defaultSegmentDuration)}} className="text-[9px] text-indigo-400 hover:text-white" title="Apply to all">ALL</button>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <input 
                                            type="number"
                                            min="0.5"
                                            step="0.5"
                                            value={(item as Annotation).segmentDuration ?? settings.defaultSegmentDuration}
                                            onChange={(e) => updateAnnotation(item.id, { segmentDuration: Number(e.target.value) })}
                                            className="w-full bg-transparent text-sm font-mono text-indigo-300 focus:outline-none"
                                        />
                                        <span className="text-xs text-gray-600">s</span>
                                    </div>
                                </div>
                                <div className="bg-gray-900/50 rounded p-2 flex flex-col gap-1">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] text-gray-500 uppercase">Wait</label>
                                        <button onClick={(e) => { e.stopPropagation(); applyDurationToAll('wait', (item as Annotation).pauseDuration ?? settings.defaultPauseDuration)}} className="text-[9px] text-green-400 hover:text-white" title="Apply to all">ALL</button>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <input 
                                            type="number"
                                            min="0"
                                            step="0.5"
                                            value={(item as Annotation).pauseDuration ?? settings.defaultPauseDuration}
                                            onChange={(e) => updateAnnotation(item.id, { pauseDuration: Number(e.target.value) })}
                                            className="w-full bg-transparent text-sm font-mono text-green-300 focus:outline-none"
                                        />
                                        <span className="text-xs text-gray-600">s</span>
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {item.type === 'area' && (
                             <div className="bg-gray-900/50 rounded p-2 flex flex-col gap-1 mb-3">
                                <label className="text-[10px] text-gray-500 uppercase">Fade In Duration</label>
                                <div className="flex items-center gap-1">
                                    <input 
                                        type="number"
                                        min="0.1"
                                        step="0.1"
                                        value={(item as Area).appearDuration}
                                        onChange={(e) => updateArea(item.id, { appearDuration: Number(e.target.value) })}
                                        className="w-full bg-transparent text-sm font-mono text-purple-300 focus:outline-none"
                                    />
                                    <span className="text-xs text-gray-600">s</span>
                                </div>
                             </div>
                        )}

                        {settings.enableCommentMode && (
                            <div className="mt-2">
                                <label className="block text-[10px] text-gray-500 mb-1 flex items-center gap-1">
                                    <MessageSquare className="w-3 h-3" /> Narrative Comment
                                </label>
                                <textarea
                                    value={item.comment || ''}
                                    onChange={(e) => item.type === 'annotation' 
                                        ? updateAnnotation(item.id, { comment: e.target.value })
                                        : updateArea(item.id, { comment: e.target.value })
                                    }
                                    className="w-full bg-gray-900/50 border border-gray-700 rounded text-xs p-2 text-gray-300 h-16 focus:border-indigo-500 focus:ring-0 resize-none"
                                    placeholder="Enter narration text..."
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>
          </div>
        )}

        {/* === VERSIONS TAB === */}
        {activeTab === 'versions' && (
             <div className="space-y-4">
                 <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    <Layers className="w-3 h-3" /> Saved States
                </h3>
                
                {versions.length === 0 ? (
                    <div className="text-center py-8 text-gray-600 text-sm">
                        No versions saved.<br/>
                        <span className="text-xs opacity-70">Click "Save Ver" in the toolbar.</span>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {versions.map(v => (
                            <div key={v.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700 hover:border-gray-600 transition-colors group">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="font-mono text-indigo-300 font-bold">{v.name}</span>
                                    <span className="text-[10px] text-gray-500">{new Date(v.timestamp).toLocaleString()}</span>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                                    <span>{v.data.points.length} Pts</span>
                                    <span>{v.data.annotations.length} lbl</span>
                                    <span>{v.data.areas?.length || 0} Areas</span>
                                </div>
                                <button 
                                    onClick={() => onRestoreVersion(v)}
                                    className="w-full py-1.5 bg-gray-700 hover:bg-indigo-600 text-gray-300 hover:text-white rounded text-xs font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    <RotateCcw className="w-3 h-3" /> Restore This Version
                                </button>
                            </div>
                        ))}
                    </div>
                )}
             </div>
        )}

      </div>
    </div>
  );
};

export default SettingsPanel;
