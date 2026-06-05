/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { CalibrationData, SafeZone } from './types';
import SafeZoneMapper from './components/SafeZoneMapper';
import PoseDetector from './components/PoseDetector';
import GameCanvas from './components/ThreeGameCanvas';
import Dashboard from './components/Dashboard';
import { Flame, ShieldCheck, ArrowRight, Eye, Video, Sparkles, AlertCircle, HelpCircle } from 'lucide-react';

export default function App() {
  // 1. Initial State Configurations
  const [calibration, setCalibration] = useState<CalibrationData>({
    baseHipY: 0.5,
    jumpThreshold: 0.08, // vertical jump distance fraction
    squatAngle: 125,     // default joint angle threshold
    isCalibrated: false
  });

  // Default mock lounge environment so the game is immediately rich & playable
  const [safeZones, setSafeZones] = useState<SafeZone[]>([
    { id: 'zone_1', name: 'Green Lounge Sofa', x: 10, y: 55, width: 28, height: 26 },
    { id: 'zone_2', name: 'Armchair Base', x: 65, y: 60, width: 25, height: 22 }
  ]);

  // Real-time pose metrics piped from PoseDetector component
  const [poseState, setPoseState] = useState({
    isJumping: false,
    isSquatting: false,
    activityStrength: 10,
    playerX: 50 // initial horizontal center
  });

  const [useSimulator, setUseSimulator] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentScore, setCurrentScore] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'PLAY' | 'PLAN'>('PLAY');

  // Trigger mapping planner if no zones exist
  useEffect(() => {
    if (safeZones.length === 0) {
      setViewMode('PLAN');
    }
  }, [safeZones]);

  // Calibration sync
  const handleCalibrationChange = (newCal: CalibrationData) => {
    setCalibration(newCal);
  };

  const handlePoseChange = (detected: {
    landmarks: any;
    isJumping: boolean;
    isSquatting: boolean;
    activityStrength: number;
    playerX: number;
  }) => {
    setPoseState({
      isJumping: detected.isJumping,
      isSquatting: detected.isSquatting,
      activityStrength: detected.activityStrength,
      playerX: detected.playerX
    });
  };

  const handleGameOver = (finalScore: number) => {
    setCurrentScore(finalScore);
    setIsPlaying(false);
  };

  const handleStartPlaying = () => {
    setIsPlaying(true);
    setViewMode('PLAY'); // force visibility of the play console
  };

  return (
    <div className="min-h-screen bg-[#080b11] text-slate-100 flex flex-col font-sans selection:bg-orange-500/30 select-none pb-12">
      
      {/* 2. Top Styled Application Navigation bar */}
      <header className="sticky top-0 z-50 bg-[#080b11]/85 backdrop-blur-md border-b border-slate-900 px-6 py-4 flex items-center justify-between select-none shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-orange-600/10 border border-orange-500/20 text-orange-500 animate-pulse">
            <Flame className="w-6 h-6 fill-orange-500/10" />
          </div>
          <div>
            <h1 className="font-sans font-black text-xl tracking-tight uppercase flex items-center gap-1.5 leading-none">
              Floor is Lava <span className="text-xs font-mono font-bold bg-orange-600 px-1.5 py-0.5 rounded text-white tracking-widest uppercase">AR MODE</span>
            </h1>
            <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
              REAL-TIME WEB CAMERA AR COORDINATE PLATFORMER
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
            <span className="text-[10px] font-mono font-bold text-emerald-400 tracking-wide">
              CAM POSE TRACKING ONLINE
            </span>
          </div>
          
          <div className="flex bg-slate-950 rounded-xl p-1 border border-slate-900 gap-1">
            <button
              onClick={() => setViewMode('PLAY')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                viewMode === 'PLAY'
                ? 'bg-orange-500 text-slate-950 font-black shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Play Interface
            </button>
            <button
              onClick={() => setViewMode('PLAN')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                viewMode === 'PLAN'
                ? 'bg-emerald-500 text-slate-950 font-black shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              Zone Planner
            </button>
          </div>
        </div>
      </header>

      {/* 3. Primary Dashboard Layout Panel */}
      <main className="max-w-7xl w-full mx-auto px-4 md:px-6 mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: Main Game Canvas Frame / Visual Room Planner */}
        <section className="lg:col-span-8 flex flex-col gap-6">
          
          {viewMode === 'PLAY' ? (
            <GameCanvas
              safeZones={safeZones}
              isPoseJumping={poseState.isJumping}
              isPoseSquatting={poseState.isSquatting}
              playerX={poseState.playerX}
              isPlaying={isPlaying}
              onGameOver={handleGameOver}
              onStartGame={handleStartPlaying}
            />
          ) : (
            <SafeZoneMapper
              safeZones={safeZones}
              onUpdateZones={setSafeZones}
            />
          )}

          {/* Prompt banner detailing simulator or calibration highlights */}
          {!calibration.isCalibrated && !useSimulator && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-left">
                <span className="font-semibold text-xs text-amber-400 block">Skeletal Cam Reference Pending</span>
                <span className="text-[10px] text-slate-400 leading-relaxed block mt-1">
                  We highly recommend clicking <b className="text-slate-200">Start Auto Calibration</b> in the tracker container below. This takes 3 quick seconds to record your standing height coordinates and ensures body vertical jumps and ducking squats register flawlessly!
                </span>
              </div>
            </div>
          )}

          {/* Quick instructions details banner */}
          <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-900 text-left grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <span className="font-semibold text-xs text-orange-400 block tracking-tight">🔥 FLUID LAUNCH LAVA LEVEL</span>
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                Liquid fiery tides slowly rise vertically. Standing directly on the room floor causes constant health and multipliers loss!
              </p>
            </div>
            <div>
              <span className="font-semibold text-xs text-emerald-400 block tracking-tight">🛋️ MODEL ROOM SAFEZONES</span>
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                Sketch out couches, chairs, or boxes. Standard vertical coordinates of the player rise to platforms height to gain immunity from standard lava!
              </p>
            </div>
            <div>
              <span className="font-semibold text-xs text-cyan-400 block tracking-tight">🏃 SKELETAL SENSORS</span>
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                Jump over low walls and squat under cyber lasers. Use your actual camera pose or tap keyboard simulator arrows!
              </p>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: Webcamera video skeletal tracker overlay & leaderboard details dashboard */}
        <section className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Real-time MediaPipe Skeleton canvas / Webcam element */}
          <PoseDetector
            onPoseDetected={handlePoseChange}
            calibration={calibration}
            onCalibrationChange={handleCalibrationChange}
            useSimulator={useSimulator}
            onToggleSimulator={setUseSimulator}
            isPlaying={isPlaying}
          />

          {/* Highscore logs & calibration tuning panel */}
          <Dashboard
            calibration={calibration}
            onCalibrationChange={handleCalibrationChange}
            gameScore={currentScore}
          />

        </section>

      </main>

    </div>
  );
}
