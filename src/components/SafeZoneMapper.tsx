/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { SafeZone } from '../types';
import { Plus, Trash2, Edit2, Check, Sparkles, Move } from 'lucide-react';

interface SafeZoneMapperProps {
  safeZones: SafeZone[];
  onUpdateZones: (zones: SafeZone[]) => void;
  aspectRatio?: number; // width / height
}

export default function SafeZoneMapper({
  safeZones,
  onUpdateZones,
  aspectRatio = 4 / 3
}: SafeZoneMapperProps) {
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  
  const drawAreaRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 });
  const [currentBox, setCurrentBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Convert pixel click on drawer to percentages
  const getCoordinates = (e: React.MouseEvent) => {
    if (!drawAreaRef.current) return { x: 0, y: 0 };
    const rect = drawAreaRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return {
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y))
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only allow drawing on left click with no drag target
    if (e.button !== 0) return;
    const coords = getCoordinates(e);
    setIsDrawing(true);
    setDrawStart(coords);
    setCurrentBox({ x: coords.x, y: coords.y, w: 0, h: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !currentBox) return;
    const coords = getCoordinates(e);
    
    const x = Math.min(drawStart.x, coords.x);
    const y = Math.min(drawStart.y, coords.y);
    const w = Math.abs(drawStart.x - coords.x);
    const h = Math.abs(drawStart.y - coords.y);
    
    setCurrentBox({ x, y, w, h });
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
    if (currentBox && currentBox.w > 3 && currentBox.h > 3) {
      const defaultNames = ['Sofa Safe Zone', 'Armchair Safe Space', 'Safe Island Step', 'Rebound Pad'];
      const randomName = defaultNames[Math.floor(Math.random() * defaultNames.length)];
      
      const newZone: SafeZone = {
        id: 'zone_' + Date.now(),
        name: `${randomName} #${safeZones.length + 1}`,
        x: Math.round(currentBox.x),
        y: Math.round(currentBox.y),
        width: Math.round(currentBox.w),
        height: Math.round(currentBox.h)
      };
      
      onUpdateZones([...safeZones, newZone]);
      setActiveZone(newZone.id);
    }
    
    setCurrentBox(null);
  };

  const deleteZone = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const filtered = safeZones.filter(z => z.id !== id);
    onUpdateZones(filtered);
    if (activeZone === id) setActiveZone(null);
  };

  const addPredefinedZone = () => {
    const defaultZones = [
      { name: 'Left Sofa Plat', x: 5, y: 55, w: 32, h: 30 },
      { name: 'Right Armchair Island', x: 63, y: 60, w: 32, h: 25 },
      { name: 'Center Ottoman Safe', x: 40, y: 70, w: 20, h: 18 }
    ];
    
    // Choose one that doesn't overlap perfectly
    const count = safeZones.length % defaultZones.length;
    const template = defaultZones[count];
    
    const newZone: SafeZone = {
      id: 'zone_pre_' + Date.now(),
      name: `${template.name} (${safeZones.length + 1})`,
      x: template.x,
      y: template.y,
      width: template.w,
      height: template.h
    };
    
    onUpdateZones([...safeZones, newZone]);
    setActiveZone(newZone.id);
  };

  const startRename = (zone: SafeZone, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingNameId(zone.id);
    setTempName(zone.name);
  };

  const saveRename = (id: string) => {
    if (tempName.trim()) {
      const updated = safeZones.map(z => z.id === id ? { ...z, name: tempName.trim() } : z);
      onUpdateZones(updated);
    }
    setEditingNameId(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-slate-900/60 backdrop-blur-md rounded-2xl border border-slate-800 p-6 overflow-hidden select-none">
      
      {/* Visual Workspace */}
      <div className="lg:col-span-8 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-sans font-medium text-lg text-slate-100 tracking-tight flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-400" /> Room Virtual Planner
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Click-and-drag over the scene layout below to sketch your physical furniture / safe platforms.
            </p>
          </div>
          
          <button
            onClick={addPredefinedZone}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Quick Spawn Safe Zone
          </button>
        </div>

        {/* Mapper Draw Canvas Frame */}
        <div 
          ref={drawAreaRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="relative bg-black/60 aspect-[4/3] w-full rounded-xl border border-slate-700 overflow-hidden cursor-crosshair group shadow-inner"
          id="safe-zone-draw-container"
          style={{ aspectRatio }}
        >
          {/* Visual Grid Lines and Background Decoration */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#0000000a_1px,transparent_1px),linear-gradient(to_bottom,#0000000a_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none opacity-20"></div>
          <div className="absolute inset-x-0 bottom-0 top-1/2 bg-gradient-to-t from-orange-600/10 to-transparent pointer-events-none border-b-4 border-orange-500/20"></div>
          
          <div className="absolute top-3 left-3 px-2 py-1 rounded bg-slate-950/80 border border-slate-800 text-[10px] font-mono text-slate-300 pointer-events-none">
            MAPPING CAM RESOLUTION: 100% RELATIVE VIEWPORT
          </div>

          {/* Render Active Drawn Zones */}
          {safeZones.map(zone => {
            const isActive = activeZone === zone.id;
            return (
              <div
                key={zone.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveZone(zone.id);
                }}
                className={`absolute rounded-md border-2 transition-all p-1 flex flex-col justify-between ${
                  isActive 
                  ? 'bg-emerald-500/35 border-emerald-400 ring-2 ring-emerald-400/50 shadow-lg shadow-emerald-500/20 z-10' 
                  : 'bg-emerald-500/15 border-emerald-500/70 hover:bg-emerald-500/25 z-0'
                }`}
                style={{
                  left: `${zone.x}%`,
                  top: `${zone.y}%`,
                  width: `${zone.width}%`,
                  height: `${zone.height}%`
                }}
              >
                <div className="flex items-start justify-between gap-1 overflow-hidden">
                  <span className="font-mono text-[10px] bg-slate-950/80 px-1 py-0.5 rounded text-emerald-300 font-bold truncate max-w-full block">
                    {zone.name}
                  </span>
                  {isActive && (
                    <button 
                      onClick={(e) => deleteZone(zone.id, e)}
                      className="text-red-400 hover:text-red-300 p-0.5 rounded bg-slate-950/80 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                
                <span className="self-end font-mono text-[8px] opacity-75 text-emerald-100 bg-slate-950/60 px-0.5 rounded">
                  {zone.width}% x {zone.height}%
                </span>
              </div>
            );
          })}

          {/* Current Drag Box Preview */}
          {currentBox && (
            <div 
              className="absolute border-2 border-dashed border-emerald-400 bg-emerald-500/20 flex items-center justify-center"
              style={{
                left: `${currentBox.x}%`,
                top: `${currentBox.y}%`,
                width: `${currentBox.w}%`,
                height: `${currentBox.h}%`
              }}
            >
              <span className="text-[10px] font-mono text-emerald-400 bg-slate-900 px-1.5 py-0.5 rounded border border-emerald-400/40">
                Drawing Safe Zone
              </span>
            </div>
          )}

          {safeZones.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center pointer-events-none select-none">
              <Move className="w-12 h-12 text-slate-600 animate-pulse mb-3" />
              <p className="font-sans font-medium text-slate-300 text-sm">No Safe Furniture Zones Mapped</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
                Draw shapes on top of the box grid here, mimicking where your couches or desks sit in your physical lounge!
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Control / Directory Panel */}
      <div className="lg:col-span-4 flex flex-col h-full overflow-hidden">
        <h4 className="font-sans font-medium text-sm text-slate-300 pb-2 border-b border-slate-800">
          Zones Directory ({safeZones.length})
        </h4>

        <div className="flex-1 overflow-y-auto max-h-[350px] pr-1 space-y-2 mt-3 select-none">
          {safeZones.map(zone => {
            const isActive = activeZone === zone.id;
            const isEditing = editingNameId === zone.id;

            return (
              <div 
                key={zone.id}
                onClick={() => setActiveZone(zone.id)}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  isActive 
                  ? 'bg-emerald-500/10 border-emerald-500/50' 
                  : 'bg-slate-800/30 border-slate-800/80 hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  {isEditing ? (
                    <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
                      <input 
                        type="text" 
                        value={tempName}
                        onChange={e => setTempName(e.target.value)}
                        className="bg-slate-950 font-mono text-xs border border-emerald-500/50 px-2 py-1 rounded text-emerald-200 focus:outline-none w-full"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveRename(zone.id);
                          if (e.key === 'Escape') setEditingNameId(null);
                        }}
                      />
                      <button 
                        onClick={() => saveRename(zone.id)}
                        className="p-1 rounded bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      <span className="font-mono text-xs text-slate-100 font-medium truncate">
                        {zone.name}
                      </span>
                    </div>
                  )}

                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <button 
                        onClick={(e) => startRename(zone, e)}
                        className="text-slate-400 hover:text-slate-200 p-1 rounded"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={(e) => deleteZone(zone.id, e)}
                        className="text-red-400 hover:text-red-300 p-1 rounded"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-1 mt-2 text-[10px] font-mono text-slate-500">
                  <div>X: <span className="text-slate-400 font-bold">{zone.x}%</span></div>
                  <div>Y: <span className="text-slate-400 font-bold">{zone.y}%</span></div>
                  <div>W: <span className="text-slate-400 font-bold">{zone.width}%</span></div>
                  <div>H: <span className="text-slate-400 font-bold">{zone.height}%</span></div>
                </div>
              </div>
            );
          })}

          {safeZones.length === 0 && (
            <div className="text-center py-10 border border-dashed border-slate-800 rounded-lg">
              <span className="text-xs text-slate-500">List is empty</span>
            </div>
          )}
        </div>

        <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800 text-[10px] leading-relaxed text-slate-400 mt-4 font-sans select-none">
          <span className="font-bold text-slate-300 block mb-1">PRO-TIP:</span>
          When playing, climb atop the couch or step. Visually, your skeleton's **HIP** or **FEET** should land inside the green zones on-screen to gain immunity from the fiery liquid terrain!
        </div>
      </div>

    </div>
  );
}
