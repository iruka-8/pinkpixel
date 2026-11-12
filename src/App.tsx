import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

type Tool = 'pen' | 'eraser' | 'fill' | 'eyedropper';
type GridData = (string | null)[];

const DEFAULT_PALETTE = [
  '#ff3b88', '#ff85b3', '#ffc2d9', '#7a123c', '#ffffff', '#2b1b24',
  '#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff924c',
  '#f72585', '#b5179e', '#7209b7', '#4cc9f0', '#aacc00', '#8d99ae',
];

const BASE_CANVAS_SIZE = 480; // 100%時のキャンバス基準サイズ(px)

function hslaToRgbaString(h: number, s: number, l: number, a: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const arm = s * Math.min(l, 1 - l);
  const f = (n: number) => l - arm * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(255 * f(0));
  const g = Math.round(255 * f(8));
  const b = Math.round(255 * f(4));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(c => c + c).join('');
  }
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export default function App() {
  const [gridSize, setGridSize] = useState<number>(16);
  const [frames, setFrames] = useState<GridData[]>(() => [Array(16 * 16).fill(null)]);
  const [currentFrameIdx, setCurrentFrameIdx] = useState<number>(0);

  // ツール & 表示 & ズーム設定
  const [tool, setTool] = useState<Tool>('pen');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [onionSkin, setOnionSkin] = useState<boolean>(true);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1); // 0.5 (50%) 〜 4.0 (400%)

  // カラー設定
  const [hue, setHue] = useState<number>(336);
  const [sat, setSat] = useState<number>(100);
  const [light, setLight] = useState<number>(62);
  const [alpha, setAlpha] = useState<number>(1);
  const [hexInput, setHexInput] = useState<string>('#ff3b88');
  const [palette, setPalette] = useState<string[]>(DEFAULT_PALETTE);

  // アニメーション制御
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(6);
  const [previewFrameIdx, setPreviewFrameIdx] = useState<number>(0);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const activeColor = hslaToRgbaString(hue, sat, light, alpha);
  const currentGrid = frames[currentFrameIdx] || Array(gridSize * gridSize).fill(null);
  const zoomedPixelDimension = Math.round(BASE_CANVAS_SIZE * zoom);

  // ズーム操作用ヘルパー
  const changeZoom = (delta: number) => {
    setZoom(prev => {
      const next = Math.round((prev + delta) * 100) / 100;
      return Math.min(4, Math.max(0.5, next));
    });
  };

  // Ctrl + ホイールでキャンバスのみズーム
  const handleCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      changeZoom(e.deltaY < 0 ? 0.25 : -0.25);
    }
  };

  const handleGridSizeChange = (newSize: number) => {
    if (!window.confirm(`キャンバスサイズを ${newSize}x${newSize} に変更しますか？（現在の絵はリセットされます）`)) {
      return;
    }
    setGridSize(newSize);
    setFrames([Array(newSize * newSize).fill(null)]);
    setCurrentFrameIdx(0);
    setPreviewFrameIdx(0);
  };

  const selectHexColor = (hex: string) => {
    setHexInput(hex);
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      const { h, s, l } = hexToHsl(hex);
      setHue(h);
      setSat(s);
      setLight(l);
      setAlpha(1);
    }
  };

  const addCurrentColorToPalette = () => {
    if (!palette.includes(activeColor)) {
      setPalette([...palette, activeColor]);
    }
  };

  const floodFill = (startIdx: number, targetColor: string | null, replacementColor: string | null, grid: GridData): GridData => {
    if (targetColor === replacementColor) return grid;
    const newGrid = [...grid];
    const queue = [startIdx];
    const visited = new Set<number>([startIdx]);

    while (queue.length > 0) {
      const idx = queue.shift()!;
      if (newGrid[idx] === targetColor) {
        newGrid[idx] = replacementColor;
        const x = idx % gridSize;
        const y = Math.floor(idx / gridSize);

        const neighbors = [
          y > 0 ? idx - gridSize : -1,
          y < gridSize - 1 ? idx + gridSize : -1,
          x > 0 ? idx - 1 : -1,
          x < gridSize - 1 ? idx + 1 : -1,
        ];

        for (const n of neighbors) {
          if (n !== -1 && !visited.has(n) && newGrid[n] === targetColor) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
    }
    return newGrid;
  };

  const applyToolToCell = useCallback((idx: number) => {
    setFrames(prevFrames => {
      const updatedFrames = [...prevFrames];
      const grid = [...updatedFrames[currentFrameIdx]];

      if (tool === 'pen') {
        grid[idx] = activeColor;
      } else if (tool === 'eraser') {
        grid[idx] = null;
      } else if (tool === 'fill') {
        updatedFrames[currentFrameIdx] = floodFill(idx, grid[idx], activeColor, grid);
        return updatedFrames;
      } else if (tool === 'eyedropper') {
        const picked = grid[idx];
        if (picked) {
          if (picked.startsWith('#')) {
            selectHexColor(picked);
          } else {
            const match = picked.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (match) {
              const hex = '#' + [match[1], match[2], match[3]]
                .map(n => parseInt(n).toString(16).padStart(2, '0'))
                .join('');
              selectHexColor(hex);
              if (match[4]) setAlpha(parseFloat(match[4]));
            }
          }
          setTool('pen');
        }
        return prevFrames;
      }

      updatedFrames[currentFrameIdx] = grid;
      return updatedFrames;
    });
  }, [currentFrameIdx, tool, activeColor, gridSize]);

  useEffect(() => {
    if (!isPlaying) {
      setPreviewFrameIdx(currentFrameIdx);
      return;
    }
    const interval = setInterval(() => {
      setPreviewFrameIdx(prev => (prev + 1) % frames.length);
    }, 1000 / fps);
    return () => clearInterval(interval);
  }, [isPlaying, fps, frames.length, currentFrameIdx]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, gridSize, gridSize);
    const targetGrid = frames[previewFrameIdx] || frames[0];
    targetGrid.forEach((color, idx) => {
      if (color) {
        const x = idx % gridSize;
        const y = Math.floor(idx / gridSize);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    });
  }, [frames, previewFrameIdx, gridSize]);

  const addFrame = () => {
    const newFrames = [...frames, Array(gridSize * gridSize).fill(null)];
    setFrames(newFrames);
    setCurrentFrameIdx(newFrames.length - 1);
  };

  const duplicateFrame = (idx: number) => {
    const copy = [...frames[idx]];
    const newFrames = [...frames];
    newFrames.splice(idx + 1, 0, copy);
    setFrames(newFrames);
    setCurrentFrameIdx(idx + 1);
  };

  const deleteFrame = (idx: number) => {
    if (frames.length <= 1) return;
    const newFrames = frames.filter((_, i) => i !== idx);
    setFrames(newFrames);
    setCurrentFrameIdx(Math.max(0, idx - 1));
  };

  const clearCurrentFrame = () => {
    const updated = [...frames];
    updated[currentFrameIdx] = Array(gridSize * gridSize).fill(null);
    setFrames(updated);
  };

  const exportPNG = (asSpriteSheet: boolean) => {
    const scale = 24;
    const frameCount = asSpriteSheet ? frames.length : 1;
    const canvas = document.createElement('canvas');
    canvas.width = gridSize * scale * frameCount;
    canvas.height = gridSize * scale;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const targetFrames = asSpriteSheet ? frames : [currentGrid];
    targetFrames.forEach((frameGrid, fIdx) => {
      const offsetX = fIdx * gridSize * scale;
      frameGrid.forEach((color, idx) => {
        if (color) {
          const x = (idx % gridSize) * scale + offsetX;
          const y = Math.floor(idx / gridSize) * scale;
          ctx.fillStyle = color;
          ctx.fillRect(x, y, scale, scale);
        }
      });
    });

    const link = document.createElement('a');
    link.download = asSpriteSheet
      ? `pink-pixel-spritesheet-${frames.length}frames.png`
      : `pink-pixel-frame${currentFrameIdx + 1}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="app-container" onMouseUp={() => setIsDrawing(false)}>
      <header className="header">
        <h1 className="logo">✨ Pink Pixel Studio</h1>

        <div className="header-controls">
          <select
            className="select-box"
            value={gridSize}
            onChange={(e) => handleGridSizeChange(Number(e.target.value))}
          >
            <option value={8}>8 × 8</option>
            <option value={16}>16 × 16</option>
            <option value={24}>24 × 24</option>
            <option value={32}>32 × 32</option>
          </select>

          <button
            className={`btn ${showGrid ? 'active' : ''}`}
            onClick={() => setShowGrid(!showGrid)}
          >
            🔲 グリッド
          </button>

          <button
            className={`btn ${onionSkin ? 'active' : ''}`}
            onClick={() => setOnionSkin(!onionSkin)}
            title="前のフレームを薄く表示"
          >
            👁️ オニオンスキン
          </button>

          <button className="btn btn-primary" onClick={() => exportPNG(false)}>
            💾 透過PNG
          </button>

          {frames.length > 1 && (
            <button className="btn" onClick={() => exportPNG(true)}>
              🎞️ スプライトPNG
            </button>
          )}
        </div>
      </header>

      <main className="workspace">
        {/* 左パネル：ツール & カラーピッカー */}
        <section className="panel">
          <h2 className="panel-title">描画ツール</h2>
          <div className="tool-grid">
            <button
              className={`btn ${tool === 'pen' ? 'active' : ''}`}
              onClick={() => setTool('pen')}
            >
              ✏️ ペン
            </button>
            <button
              className={`btn ${tool === 'eraser' ? 'active' : ''}`}
              onClick={() => setTool('eraser')}
            >
              🧹 消しゴム
            </button>
            <button
              className={`btn ${tool === 'fill' ? 'active' : ''}`}
              onClick={() => setTool('fill')}
            >
              🪣 塗りつぶし
            </button>
            <button
              className={`btn ${tool === 'eyedropper' ? 'active' : ''}`}
              onClick={() => setTool('eyedropper')}
            >
              🧪 スポイト
            </button>
          </div>

          <button className="btn" onClick={clearCurrentFrame} style={{ justifyContent: 'center' }}>
            🔄 現在のフレームをクリア
          </button>

          <h2 className="panel-title">
            カラークリエイター
            <button className="icon-btn" onClick={addCurrentColorToPalette} title="現在の色をパレットに追加">
              ➕ パレット保存
            </button>
          </h2>

          <div className="color-preview-row">
            <div className="current-color-box">
              <div className="current-color-fill" style={{ backgroundColor: activeColor }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="color"
                  value={hexInput}
                  onChange={(e) => selectHexColor(e.target.value)}
                  style={{ width: '36px', height: '32px', border: 'none', background: 'none', cursor: 'pointer' }}
                />
                <input
                  type="text"
                  className="hex-input"
                  value={hexInput}
                  onChange={(e) => selectHexColor(e.target.value)}
                  maxLength={7}
                />
              </div>
            </div>
          </div>

          <div className="slider-group">
            <div className="slider-row">
              <label>色相</label>
              <input
                type="range"
                className="hue-slider"
                min={0}
                max={360}
                value={hue}
                onChange={(e) => setHue(Number(e.target.value))}
              />
            </div>
            <div className="slider-row">
              <label>彩度</label>
              <input
                type="range"
                min={0}
                max={100}
                value={sat}
                onChange={(e) => setSat(Number(e.target.value))}
              />
            </div>
            <div className="slider-row">
              <label>明度</label>
              <input
                type="range"
                min={0}
                max={100}
                value={light}
                onChange={(e) => setLight(Number(e.target.value))}
              />
            </div>
            <div className="slider-row">
              <label>透明</label>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={alpha}
                onChange={(e) => setAlpha(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="palette-grid">
            {palette.map((color, idx) => (
              <div
                key={idx}
                className={`swatch ${activeColor === color || hexInput === color ? 'selected' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => {
                  if (color.startsWith('#')) {
                    selectHexColor(color);
                  } else {
                    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                    if (match) {
                      const hex = '#' + [match[1], match[2], match[3]]
                        .map(n => parseInt(n).toString(16).padStart(2, '0'))
                        .join('');
                      selectHexColor(hex);
                      if (match[4]) setAlpha(parseFloat(match[4]));
                    }
                  }
                }}
              />
            ))}
          </div>
        </section>

        {/* 中央：ズーム対応ピクセルキャンバス */}
        <section className="canvas-area">
          {/* キャンバス専用ズームコントロールバー */}
          <div className="zoom-bar">
            <button
              className="icon-btn"
              onClick={() => changeZoom(-0.25)}
              disabled={zoom <= 0.5}
              title="縮小 (-25%)"
            >
              ➖
            </button>
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.25}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ width: '120px', accentColor: 'var(--pink-500)' }}
            />
            <button
              className="icon-btn"
              onClick={() => changeZoom(0.25)}
              disabled={zoom >= 4}
              title="拡大 (+25%)"
            >
              ➕
            </button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button
              className="btn"
              onClick={() => setZoom(1)}
              style={{ padding: '4px 8px', fontSize: '0.75rem' }}
            >
              100%に戻す
            </button>
          </div>

          {/* 固定枠ビューポート（拡大時は内部スクロール） */}
          <div className="canvas-viewport" onWheel={handleCanvasWheel}>
            <div
              className="canvas-wrapper"
              style={{
                width: `${zoomedPixelDimension}px`,
                height: `${zoomedPixelDimension}px`
              }}
            >
              <div
                className={`pixel-grid ${showGrid ? 'show-grid' : ''}`}
                style={{
                  gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
                  gridTemplateRows: `repeat(${gridSize}, 1fr)`
                }}
                onMouseLeave={() => setIsDrawing(false)}
              >
                {currentGrid.map((cellColor, idx) => {
                  const prevFrameColor =
                    onionSkin && currentFrameIdx > 0
                      ? frames[currentFrameIdx - 1][idx]
                      : null;

                  return (
                    <div
                      key={idx}
                      className="pixel-cell"
                      style={{
                        backgroundColor: cellColor
                          ? cellColor
                          : prevFrameColor
                          ? prevFrameColor
                          : 'transparent',
                        opacity: !cellColor && prevFrameColor ? 0.25 : 1
                      }}
                      onMouseDown={() => {
                        setIsDrawing(true);
                        applyToolToCell(idx);
                      }}
                      onMouseEnter={() => {
                        if (isDrawing && (tool === 'pen' || tool === 'eraser')) {
                          applyToolToCell(idx);
                        }
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--pink-600)' }}>
            フレーム {currentFrameIdx + 1} / {frames.length} （Ctrl + ホイールでも拡大縮小できます）
          </div>
        </section>

        {/* 右パネル：アニメーション & フレーム管理 */}
        <section className="panel">
          <h2 className="panel-title">アニメーションプレビュー</h2>

          <div className="preview-box">
            <canvas
              ref={previewCanvasRef}
              width={gridSize}
              height={gridSize}
              className="preview-canvas"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <button
              className={`btn ${isPlaying ? 'active' : 'btn-primary'}`}
              onClick={() => setIsPlaying(!isPlaying)}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              {isPlaying ? '⏸️ 停止' : '▶️ 再生'}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 700 }}>
              <span>{fps} FPS</span>
              <input
                type="range"
                min={1}
                max={24}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                style={{ width: '70px', accentColor: 'var(--pink-500)' }}
              />
            </div>
          </div>

          <h2 className="panel-title">
            フレーム一覧
            <button className="btn btn-primary" onClick={addFrame} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
              ➕ 新規
            </button>
          </h2>

          <div className="frames-list">
            {frames.map((_, idx) => (
              <div
                key={idx}
                className={`frame-item ${currentFrameIdx === idx ? 'active' : ''}`}
                onClick={() => {
                  setIsPlaying(false);
                  setCurrentFrameIdx(idx);
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                  Frame #{idx + 1}
                </span>
                <div className="frame-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn"
                    onClick={() => duplicateFrame(idx)}
                    title="複製"
                  >
                    📋
                  </button>
                  {frames.length > 1 && (
                    <button
                      className="icon-btn"
                      onClick={() => deleteFrame(idx)}
                      title="削除"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}