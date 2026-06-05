/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { CalibrationData, HighScoreRecord } from '../types';
import { Trophy, Sliders, PlayCircle, Info, ChevronRight, CheckCircle2, RefreshCw } from 'lucide-react';
import { audio } from '../utils/audio';

interface DashboardProps {
  calibration: CalibrationData;
  onCalibrationChange: (cal: CalibrationData) => void;
  gameScore: number;
}

export default function Dashboard({
  calibration,
  onCalibrationChange,
  gameScore
}: DashboardProps) {
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'sensitivity' | 'howtoplay'>('howtoplay');
  const [highScores, setHighScores] = useState<HighScoreRecord[]>([]);
  const [newScoreSaved, setNewScoreSaved] = useState<boolean>(false);
  const [nickname, setNickname] = useState<string>('');

  // Load High Scores from LocalStorage
  useEffect(() => {
    const raw = localStorage.getItem('floor_lava_scores');
    if (raw) {
      try {
        setHighScores(JSON.parse(raw));
      } catch (_) {
        loadMockScores();
      }
    } else {
      loadMockScores();
    }
  }, []);

  const loadMockScores = () => {
    const mocks: HighScoreRecord[] = [
      { name: 'AlphaRunner', score: 1800, date: '2026-06-01' },
      { name: 'LavaJumper99', score: 1420, date: '2026-06-03' },
      { name: 'SquatKing', score: 950, date: '2026-06-04' },
      { name: 'CouchPotato', score: 320, date: '2026-06-05' }
    ];
    localStorage.setItem('floor_lava_scores', JSON.stringify(mocks));
    setHighScores(mocks);
  };

  // Detect and offer saving of current score if significant
  const saveCurrentScore = () => {
    if (!nickname.trim() || gameScore <= 0) return;

    const newRecord: HighScoreRecord = {
      name: nickname.trim(),
      score: gameScore,
      date: new Date().toISOString().split('T')[0]
    };

    const combined = [...highScores, newRecord]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5); // top 5 only

    localStorage.setItem('floor_lava_scores', JSON.stringify(combined));
    setHighScores(combined);
    setNewScoreSaved(true);
    audio.playHighScore();

    // Reset score checks
    if (gameScore > Number(localStorage.getItem('floor_lava_hs') || '0')) {
      localStorage.setItem('floor_lava_hs', String(gameScore));
    }
  };

  // Adjust calibrator thresholds
  const updateSensitivityField = (field: 'jumpThreshold' | 'squatAngle', value: number) => {
    onCalibrationChange({
      ...calibration,
      [field]: value
    });
  };

  return (
    <div className="bg-slate-900/60 backdrop-blur-md rounded-2xl border border-slate-800 p-5 select-none text-left flex flex-col h-full justify-between">
      
      {/* Tab Selectors */}
      <div>
        <div className="flex bg-slate-950 p-1.5 rounded-xl border border-slate-800 gap-1">
          <button
            onClick={() => setActiveTab('howtoplay')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              activeTab === 'howtoplay'
              ? 'bg-slate-800 text-cyan-300 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PlayCircle className="w-4 h-4" />
            Tutorial
          </button>

          <button
            onClick={() => setActiveTab('sensitivity')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              activeTab === 'sensitivity'
              ? 'bg-slate-800 text-yellow-300 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            Calibration
          </button>

          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              activeTab === 'leaderboard'
              ? 'bg-slate-800 text-amber-300 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Trophy className="w-4 h-4" />
            Leaderboard
          </button>
        </div>

        {/* Tab Body Renderings */}
        <div className="mt-4 min-h-[290px]">
          
          {/* TAB 1: HOW TO PLAY */}
          {activeTab === 'howtoplay' && (
            <div className="space-y-3.5 pr-1 text-slate-300">
              <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-3 flex items-start gap-3">
                <Info className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                <div className="text-left">
                  <span className="font-semibold text-xs text-cyan-300 block">Game Description</span>
                  <span className="text-[11px] text-slate-400 leading-relaxed block mt-1">
                    An augmented physical playground! Map out your physical living room furniture using our visual editor, then test your reflexes in front of the camera as virtual obstacles flood the viewport and dangerous lava bubbles rises.
                  </span>
                </div>
              </div>

              <div className="space-y-2 mt-2 select-none">
                <h5 className="font-sans font-semibold text-xs text-slate-400 tracking-tight">GAMEPLAY CHECKLISTS:</h5>
                
                <div className="flex items-start gap-2.5 text-[11px]">
                  <ChevronRight className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <b className="text-slate-200 block">1. Calibrate standing level</b>
                    <span className="text-slate-400 block mt-0.5">Click "Start Auto Calibration" while standing still in the video capture frame.</span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 text-[11px]">
                  <ChevronRight className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <b className="text-slate-200 block">2. Model your furniture</b>
                    <span className="text-slate-400 block mt-0.5">In the "Safe Zone Planner", draw boundaries over the camera corresponding to physical sofas or step boards.</span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 text-[11px]">
                  <ChevronRight className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <b className="text-slate-200 block">3. Play the tide & dodge!</b>
                    <span className="text-slate-400 block mt-0.5">Start game and stand on defined zones or physically jump/squat inside the frame boundaries.</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DETECTOR CALIBRATIONS */}
          {activeTab === 'sensitivity' && (
            <div className="space-y-4">
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                <h5 className="font-sans font-semibold text-xs text-slate-200 tracking-tight">Fine-Tune Sensitivity Sliders</h5>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Adjust coordinate tolerances dynamically to match your camera perspective or distance bounds.
                </p>

                {/* Slider 1: Jump height requirement threshold */}
                <div className="mt-4">
                  <div className="flex justify-between font-mono text-xs mb-1.5">
                    <span className="text-slate-400 font-medium">Jump Height Threshold:</span>
                    <span className="text-yellow-400 font-bold">{Math.round(calibration.jumpThreshold * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.04"
                    max="0.18"
                    step="0.01"
                    value={calibration.jumpThreshold}
                    onChange={(e) => updateSensitivityField('jumpThreshold', parseFloat(e.target.value))}
                    className="w-full accent-yellow-400"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 mt-0.5 font-sans">
                    <span>Oversensitive (Low)</span>
                    <span>High Lift Needed (High)</span>
                  </div>
                </div>

                {/* Slider 2: Squat knee bending angle */}
                <div className="mt-5">
                  <div className="flex justify-between font-mono text-xs mb-1.5">
                    <span className="text-slate-400 font-medium">Squat Angle Cutoff:</span>
                    <span className="text-pink-400 font-bold">{calibration.squatAngle}°</span>
                  </div>
                  <input
                    type="range"
                    min="105"
                    max="145"
                    step="5"
                    value={calibration.squatAngle}
                    onChange={(e) => updateSensitivityField('squatAngle', parseInt(e.target.value))}
                    className="w-full accent-pink-500"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 mt-0.5 font-sans">
                    <span>Deep Squat (105°)</span>
                    <span>Slight Knee Bend (145°)</span>
                  </div>
                </div>
              </div>

              <div className="text-[10px] font-mono text-slate-500 bg-slate-950/40 p-2.5 rounded border border-slate-800/60 leading-relaxed leading-normal">
                <span className="font-bold text-slate-400 block mb-0.5">CALIBRATION SUMMARY:</span>
                • Base Stand Hip Y Coordinate: <span className="text-slate-300 font-bold">{calibration.isCalibrated ? `${Math.round(calibration.baseHipY * 100)}%` : 'PENDING'}</span> <br />
                • Active Status: <span className={`font-bold ${calibration.isCalibrated ? 'text-emerald-400' : 'text-red-400'}`}>{calibration.isCalibrated ? 'STATIONARY REFERENCE SAVED' : 'CALIBRATE FIRST'}</span>
              </div>
            </div>
          )}

          {/* TAB 3: LOCAL HIGH-SCORES LEADERBOARD */}
          {activeTab === 'leaderboard' && (
            <div className="space-y-4">
              
              {/* If game score is greater than zero, prompt nickname input for saving */}
              {gameScore > 0 && !newScoreSaved ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-left">
                  <span className="text-xs font-semibold text-amber-300 block">Record Saved On Sandbox!</span>
                  <p className="text-[10px] text-slate-400 leading-normal mt-0.5">Your score is <b className="text-slate-100">{gameScore} pts</b>. Enter your name below to lock it in!</p>
                  
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="text"
                      maxLength={12}
                      placeholder="JUMPNINJA"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="bg-slate-950 text-slate-100 font-mono text-xs border border-slate-700 rounded px-2 py-1 focus:outline-none focus:border-amber-400 flex-1 uppercase"
                    />
                    <button
                      onClick={saveCurrentScore}
                      className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded cursor-pointer transition-all shrink-0"
                    >
                      Save Score
                    </button>
                  </div>
                </div>
              ) : newScoreSaved ? (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/35 rounded-xl flex items-center gap-2 text-emerald-300 text-xs select-none">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  Your score record has been appended to local storage!
                </div>
              ) : null}

              {/* Leaderboard records listing */}
              <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800 text-xs font-mono">
                <div className="grid grid-cols-12 bg-slate-900 border-b border-slate-800 p-2 text-slate-500 font-bold">
                  <div className="col-span-2">RANK</div>
                  <div className="col-span-6 text-left">NICKNAME</div>
                  <div className="col-span-4 text-right">SCORE</div>
                </div>

                <div className="divide-y divide-slate-800/60 font-medium">
                  {highScores.map((record, idx) => (
                    <div key={idx} className="grid grid-cols-12 p-2.5 items-center text-slate-300">
                      <div className="col-span-2 flex items-center">
                        {idx === 0 ? '🏆' : `0${idx + 1}`}
                      </div>
                      <div className="col-span-6 text-left truncate font-bold text-slate-100">{record.name.toUpperCase()}</div>
                      <div className="col-span-4 text-right font-extrabold text-amber-400">{record.score}</div>
                    </div>
                  ))}

                  {highScores.length === 0 && (
                    <div className="text-center py-6 text-slate-500">
                      No highscore listings logged yet.
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={loadMockScores}
                className="text-[9px] font-mono text-slate-500 underline text-right w-full block hover:text-slate-400 uppercase"
              >
                Reset Default Mocks
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Persistent footer statistics banner */}
      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between font-mono text-[9px] text-slate-500 uppercase leading-none">
        <span>AI Studio Build Engine</span>
        <span>Version 1.0.0</span>
      </div>

    </div>
  );
}
