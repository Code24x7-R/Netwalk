
import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// --- TYPES AND CONSTANTS ---

enum TileType {
    TERMINAL, STRAIGHT, CORNER, T_JUNCTION, CROSS
}

interface Tile {
    type: TileType;
    rotation: number; // 0: 0deg, 1: 90deg, 2: 180deg, 3: 270deg
    connected: boolean;
    isServer: boolean;
}

type Grid = Tile[][];
type Coords = { r: number; c: number };

const DIRECTIONS = {
    N: { r: -1, c: 0, from: 'S', mask: 1 },
    E: { r: 0, c: 1, from: 'W', mask: 2 },
    S: { r: 1, c: 0, from: 'N', mask: 4 },
    W: { r: 0, c: -1, from: 'E', mask: 8 },
};

const TILE_CONNECTIONS: Record<TileType, number[]> = {
    [TileType.TERMINAL]: [1, 2, 4, 8],
    [TileType.STRAIGHT]: [5, 10, 5, 10],
    [TileType.CORNER]: [3, 6, 12, 9],
    [TileType.T_JUNCTION]: [7, 14, 13, 11],
    [TileType.CROSS]: [15, 15, 15, 15],
};


// --- SVG TILE COMPONENT ---

const TileIcon = ({ type, connected, isServer }: { type: TileType, connected: boolean, isServer: boolean }) => {
    const classNames = `wire ${connected ? 'connected' : ''}`;
    
    if (isServer) {
        return <rect width="60" height="60" x="20" y="20" className="server" rx="5" />;
    }

    switch (type) {
        case TileType.TERMINAL:
            return <>
                <rect x="25" y="25" width="50" height="50" rx="5" className={`endpoint ${connected ? 'connected' : ''}`} />
                <line x1="50" y1="25" x2="50" y2="0" className={classNames} />
            </>;
        case TileType.STRAIGHT:
            return <line x1="50" y1="0" x2="50" y2="100" className={classNames} />;
        case TileType.CORNER:
            return <>
                <line x1="50" y1="0" x2="50" y2="50" className={classNames} />
                <line x1="50" y1="50" x2="100" y2="50" className={classNames} />
            </>;
        case TileType.T_JUNCTION:
            return <>
                <line x1="50" y1="0" x2="50" y2="100" className={classNames} />
                <line x1="50" y1="50" x2="100" y2="50" className={classNames} />
            </>;
        case TileType.CROSS:
            return <>
                <line x1="50" y1="0" x2="50" y2="100" className={classNames} />
                <line x1="0" y1="50" x2="100" y2="50" className={classNames} />
            </>;
        default: return null;
    }
};

// --- AUDIO UTILITIES ---

const playConnectSound = (audioCtx: AudioContext, count: number) => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.type = 'square';
    osc.frequency.setValueAtTime(100 + count * 5, audioCtx.currentTime);

    gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.2);
};

const playWinSound = (audioCtx: AudioContext) => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    const lfo = audioCtx.createOscillator(); // For vibrato
    const vibratoGain = audioCtx.createGain(); // To control vibrato depth

    // Vibrato setup
    lfo.frequency.setValueAtTime(5, audioCtx.currentTime); // 5 Hz vibrato
    vibratoGain.gain.setValueAtTime(5, audioCtx.currentTime); // 5 cents of detune
    lfo.connect(vibratoGain);
    vibratoGain.connect(osc.detune);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.type = 'triangle';
    const now = audioCtx.currentTime;

    const notes = [
        261.63, // C4
        329.63, // E4
        392.00, // G4
        523.25, // C5
        659.25, // E5
        783.99, // G5
        1046.50, // C6
        783.99, // G5
        523.25, // C5
        392.00, // G4
        261.63, // C4
    ];
    const noteDuration = 0.1;
    const totalDuration = notes.length * noteDuration;

    gainNode.gain.setValueAtTime(0.2, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + totalDuration);

    notes.forEach((freq, i) => {
        osc.frequency.setValueAtTime(freq, now + i * noteDuration);
    });

    lfo.start(now);
    osc.start(now);

    lfo.stop(now + totalDuration + 0.1);
    osc.stop(now + totalDuration + 0.1);
};

const playHintSound = (audioCtx: AudioContext) => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.type = 'sine';
    const now = audioCtx.currentTime;
    
    gainNode.gain.setValueAtTime(0.3, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.2);

    osc.start(now);
    osc.stop(now + 0.4);
};


// --- GAME LOGIC UTILITIES ---

const generateGrid = (size: number, isWrapping: boolean): [Grid, number[][], Coords, Coords[]] => {
    // 1. Create a spanning tree covering all cells to guarantee a single, fully connected network
    const connections: number[][] = Array(size).fill(0).map(() => Array(size).fill(0));
    const visited: boolean[][] = Array(size).fill(false).map(() => Array(size).fill(false));
    
    const startR = Math.floor(Math.random() * size);
    const startC = Math.floor(Math.random() * size);
    const stack: Coords[] = [{ r: startR, c: startC }];
    visited[startR][startC] = true;

    while (stack.length > 0) {
        const { r, c } = stack[stack.length - 1];
        const neighbors = [];
        for (const key in DIRECTIONS) {
            const dir = DIRECTIONS[key as keyof typeof DIRECTIONS];
            let nr = r + dir.r;
            let nc = c + dir.c;

            if (isWrapping) {
                nr = (nr + size) % size;
                nc = (nc + size) % size;
            }

            if ((isWrapping || (nr >= 0 && nr < size && nc >= 0 && nc < size)) && !visited[nr][nc]) {
                neighbors.push({ r: nr, c: nc, mask: dir.mask, fromMask: DIRECTIONS[dir.from as keyof typeof DIRECTIONS].mask });
            }
        }

        if (neighbors.length > 0) {
            const neighbor = neighbors[Math.floor(Math.random() * neighbors.length)];
            connections[r][c] |= neighbor.mask;
            connections[neighbor.r][neighbor.c] |= neighbor.fromMask;
            visited[neighbor.r][neighbor.c] = true;
            stack.push({ r: neighbor.r, c: neighbor.c });
        } else {
            stack.pop();
        }
    }

    // 2. Determine tile types based on the connections, and identify terminals
    const terminals: Coords[] = [];
    const solvedGrid: Omit<Tile, 'connected' | 'isServer'>[][] = connections.map((row, r) => row.map((conn, c) => {
        const numConnections = conn.toString(2).split('1').length - 1;
        let type: TileType;

        if (numConnections === 1) {
            type = TileType.TERMINAL;
            terminals.push({ r, c });
        } else {
            switch (numConnections) {
                case 2: type = (conn === 5 || conn === 10) ? TileType.STRAIGHT : TileType.CORNER; break;
                case 3: type = TileType.T_JUNCTION; break;
                case 4: type = TileType.CROSS; break;
                default: type = TileType.TERMINAL; // Should not happen
            }
        }

        const targetRotations = TILE_CONNECTIONS[type];
        let rotation = targetRotations.indexOf(conn);
        if (rotation === -1) rotation = 0;

        return { type, rotation };
    }));
    
    // 3. Select a server from any location
    const allCoords: Coords[] = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            allCoords.push({ r, c });
        }
    }
    const serverCoords = allCoords[Math.floor(Math.random() * allCoords.length)];

    const solutionRotations = solvedGrid.map(row => row.map(tile => tile.rotation));

    // 4. Scramble the grid, keeping only the server fixed in its solved rotation
    const finalGrid: Grid = solvedGrid.map((row, r) => row.map((tile, c) => {
        const isThisServer = r === serverCoords.r && c === serverCoords.c;

        return {
            ...tile,
            isServer: isThisServer,
            rotation: isThisServer ? tile.rotation : Math.floor(Math.random() * 4),
            connected: false,
        };
    }));


    return [finalGrid, solutionRotations, serverCoords, terminals];
};

const checkConnectivity = (grid: Grid, serverCoords: Coords, isWrapping: boolean): Grid => {
    const size = grid.length;
    const connectedSet = new Set<string>();
    const queue: Coords[] = [serverCoords];
    const visited = new Set<string>([`${serverCoords.r},${serverCoords.c}`]);

    while (queue.length > 0) {
        const { r, c } = queue.shift()!;
        connectedSet.add(`${r},${c}`);

        const tile = grid[r][c];
        const connections = TILE_CONNECTIONS[tile.type][tile.rotation];

        for (const key in DIRECTIONS) {
            const dir = DIRECTIONS[key as keyof typeof DIRECTIONS];
            if ((connections & dir.mask) !== 0) {
                let nr = r + dir.r;
                let nc = c + dir.c;

                if (isWrapping) {
                    nr = (nr + size) % size;
                    nc = (nc + size) % size;
                }

                if ((isWrapping || (nr >= 0 && nr < size && nc >= 0 && nc < size)) && !visited.has(`${nr},${nc}`)) {
                    const neighbor = grid[nr][nc];
                    const neighborConnections = TILE_CONNECTIONS[neighbor.type][neighbor.rotation];
                    if ((neighborConnections & DIRECTIONS[dir.from as keyof typeof DIRECTIONS].mask) !== 0) {
                        visited.add(`${nr},${nc}`);
                        queue.push({ r: nr, c: nc });
                    }
                }
            }
        }
    }

    return grid.map((row, r) => row.map((tile, c) => ({
        ...tile,
        connected: connectedSet.has(`${r},${c}`),
    })));
};

// --- MAIN APP COMPONENT ---

const App = () => {
    const [gridSize, setGridSize] = useState(7);
    const [isWrapping, setIsWrapping] = useState(false);
    const [grid, setGrid] = useState<Grid>([]);
    const [solution, setSolution] = useState<number[][]>([]);
    const [serverCoords, setServerCoords] = useState<Coords>({ r: 0, c: 0 });
    const [terminals, setTerminals] = useState<Coords[]>([]);
    const [isWon, setIsWon] = useState(false);
    const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
    const [hintedTile, setHintedTile] = useState<Coords | null>(null);
    const [focusedTile, setFocusedTile] = useState<Coords | null>({ r: 0, c: 0 });
    const [distanceMap, setDistanceMap] = useState<number[][]>([]);


    const startNewGame = useCallback(() => {
        setIsWon(false);
        setDistanceMap([]);
        setFocusedTile({ r: Math.floor(gridSize/2), c: Math.floor(gridSize/2) });
        const [newGrid, newSolution, newServerCoords, newTerminals] = generateGrid(gridSize, isWrapping);
        setServerCoords(newServerCoords);
        setTerminals(newTerminals);
        setSolution(newSolution);
        const updatedGrid = checkConnectivity(newGrid, newServerCoords, isWrapping);
        setGrid(updatedGrid);
    }, [gridSize, isWrapping]);

    useEffect(() => {
        startNewGame();
    }, [startNewGame]);

    const rotateTile = useCallback((r: number, c: number) => {
        const tile = grid[r]?.[c];
        if (!tile || isWon || tile.isServer) return;

        let currentAudioContext = audioContext;
        if (!currentAudioContext) {
            try {
                currentAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                setAudioContext(currentAudioContext);
            } catch (e) {
                console.error("Web Audio API is not supported in this browser");
            }
        }

        const previouslyConnectedCount = grid.flat().filter(t => t.connected).length;

        const newGrid = grid.map(row => row.map(cell => ({ ...cell })));
        newGrid[r][c].rotation = (newGrid[r][c].rotation + 1) % 4;

        const updatedGridWithConnectivity = checkConnectivity(newGrid, serverCoords, isWrapping);
        
        if (currentAudioContext) {
            const newlyConnectedCount = updatedGridWithConnectivity.flat().filter(t => t.connected).length;
            const newConnections = newlyConnectedCount - previouslyConnectedCount;
            if (newConnections > 0) {
                playConnectSound(currentAudioContext, newConnections);
            }
        }
        
        setGrid(updatedGridWithConnectivity);
    }, [grid, isWon, audioContext, serverCoords, isWrapping]);

    // Check for win condition whenever the grid changes
    useEffect(() => {
        if (isWon || grid.length === 0 || terminals.length === 0) return;

        const allTerminalsConnected = terminals.every(
            (t) => grid[t.r][t.c].connected
        );

        if (allTerminalsConnected) {
            setIsWon(true);
            if (audioContext) {
                playWinSound(audioContext);
            }
            
            // Calculate distance map for win animation cascade
            const size = grid.length;
            const newDistanceMap = Array(size).fill(0).map(() => Array(size).fill(-1));
            const queue: Array<{ r: number, c: number, dist: number }> = [{ r: serverCoords.r, c: serverCoords.c, dist: 0 }];
            const visitedForDist = new Set<string>([`${serverCoords.r},${serverCoords.c}`]);
            newDistanceMap[serverCoords.r][serverCoords.c] = 0;

            let head = 0;
            while (head < queue.length) {
                const { r: qr, c: qc, dist } = queue[head++];
                const tile = grid[qr][qc];
                const connections = TILE_CONNECTIONS[tile.type][tile.rotation];

                for (const key in DIRECTIONS) {
                    const dir = DIRECTIONS[key as keyof typeof DIRECTIONS];
                    if ((connections & dir.mask) !== 0) {
                        let nr = qr + dir.r;
                        let nc = qc + dir.c;

                        if (isWrapping) {
                            nr = (nr + size) % size;
                            nc = (nc + size) % size;
                        }
                        
                        const neighborKey = `${nr},${nc}`;
                        if ((isWrapping || (nr >= 0 && nr < size && nc >= 0 && nc < size)) && !visitedForDist.has(neighborKey)) {
                             const neighbor = grid[nr][nc];
                             if (neighbor.connected) {
                                visitedForDist.add(neighborKey);
                                newDistanceMap[nr][nc] = dist + 1;
                                queue.push({ r: nr, c: nc, dist: dist + 1 });
                             }
                        }
                    }
                }
            }
            setDistanceMap(newDistanceMap);
        }
    }, [grid, terminals, isWon, audioContext, serverCoords, isWrapping]);

    const handleTileClick = (r: number, c: number) => {
        setFocusedTile({ r, c });
        rotateTile(r, c);
    };

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!focusedTile) return;

            let { r, c } = focusedTile;

            switch (e.key) {
                case 'ArrowUp':
                    r = isWrapping ? (r - 1 + gridSize) % gridSize : Math.max(0, r - 1);
                    break;
                case 'ArrowDown':
                    r = isWrapping ? (r + 1) % gridSize : Math.min(gridSize - 1, r + 1);
                    break;
                case 'ArrowLeft':
                    c = isWrapping ? (c - 1 + gridSize) % gridSize : Math.max(0, c - 1);
                    break;
                case 'ArrowRight':
                    c = isWrapping ? (c + 1) % gridSize : Math.min(gridSize - 1, c + 1);
                    break;
                case ' ': // Spacebar
                case 'Enter':
                    e.preventDefault();
                    rotateTile(r, c);
                    return; // Return early to avoid setting state again
                default:
                    return; // Ignore other keys
            }
            e.preventDefault();
            setFocusedTile({ r, c });
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusedTile, gridSize, isWrapping, rotateTile]);


    const handleHintClick = () => {
        if (isWon) return;

        let currentAudioContext = audioContext;
        if (!currentAudioContext) {
            try {
                currentAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                setAudioContext(currentAudioContext);
            } catch (e) { console.error("Web Audio API is not supported in this browser"); }
        }

        const incorrectTiles: Coords[] = [];
        for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
                if (!grid[r][c].isServer && grid[r][c].rotation !== solution[r][c]) {
                    incorrectTiles.push({ r, c });
                }
            }
        }

        if (incorrectTiles.length === 0) return;

        let bestHint: { coords: Coords | null, maxNewConnections: number } = { coords: null, maxNewConnections: -1 };
        const previouslyConnectedCount = grid.flat().filter(t => t.connected).length;

        for (const coords of incorrectTiles) {
            const tempGrid = grid.map(row => row.map(cell => ({ ...cell })));
            tempGrid[coords.r][coords.c].rotation = solution[coords.r][coords.c];
            
            const gridAfterHint = checkConnectivity(tempGrid, serverCoords, isWrapping);
            const newlyConnectedCount = gridAfterHint.flat().filter(t => t.connected).length;
            const newConnections = newlyConnectedCount - previouslyConnectedCount;

            if (newConnections > bestHint.maxNewConnections) {
                bestHint = { coords, maxNewConnections: newConnections };
            }
        }
        
        // Fallback: If no rotation provides new connections, find one adjacent to the current network
        if (bestHint.coords === null || bestHint.maxNewConnections <= 0) {
            let adjacentHint: Coords | null = null;
            for (const { r, c } of incorrectTiles) {
                let isAdjacent = false;
                for (const key in DIRECTIONS) {
                    const dir = DIRECTIONS[key as keyof typeof DIRECTIONS];
                    let nr = r + dir.r;
                    let nc = c + dir.c;
                    if (isWrapping) {
                        nr = (nr + gridSize) % gridSize;
                        // FIX: Corrected typo 'size' to 'gridSize'
                        nc = (nc + gridSize) % gridSize;
                    }
                    if ((isWrapping || (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize)) && grid[nr][nc].connected) {
                        isAdjacent = true;
                        break;
                    }
                }
                if (isAdjacent) {
                    adjacentHint = { r, c };
                    break;
                }
            }
            bestHint.coords = adjacentHint || incorrectTiles[0];
        }
        
        const hintCoords = bestHint.coords;

        if (hintCoords) {
            if (currentAudioContext) { playHintSound(currentAudioContext); }
            const { r, c } = hintCoords;
            const newGrid = grid.map(row => row.map(cell => ({ ...cell })));
            newGrid[r][c].rotation = solution[r][c];
            
            const updatedGrid = checkConnectivity(newGrid, serverCoords, isWrapping);
            setGrid(updatedGrid);
            setHintedTile({ r, c });
            setTimeout(() => setHintedTile(null), 1000);
        }
    };

    return (
        <div className="app-container">
            <header className="header">
                <h1 className="title">Netwalk</h1>
            </header>
            <div className="controls">
                <button className="control-button" onClick={startNewGame}>New Game</button>
                <button className="control-button" onClick={handleHintClick} disabled={isWon}>Hint</button>
                <select 
                    className="control-select"
                    value={gridSize}
                    onChange={(e) => setGridSize(Number(e.target.value))}
                    aria-label="Grid Size"
                >
                    <option value="5">5 x 5</option>
                    <option value="7">7 x 7</option>
                    <option value="9">9 x 9</option>
                    <option value="11">11 x 11</option>
                </select>
                <div className="control-toggle">
                    <input 
                        type="checkbox" 
                        id="wrapping-toggle" 
                        className="wrapping-checkbox"
                        checked={isWrapping} 
                        onChange={(e) => setIsWrapping(e.target.checked)} 
                    />
                    <label htmlFor="wrapping-toggle" className="wrapping-label">Wrap Edges</label>
                </div>
            </div>
            <div className="game-container">
                <div 
                    className={`game-board ${isWon ? 'game-won' : ''}`}
                    style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }}
                >
                    {grid.map((row, r) =>
                        row.map((tile, c) => (
                            <div
                                key={`${r}-${c}`}
                                className={`tile ${tile.isServer ? 'fixed' : ''} ${hintedTile && hintedTile.r === r && hintedTile.c === c ? 'hinted' : ''} ${focusedTile && focusedTile.r === r && focusedTile.c === c ? 'focused' : ''}`}
                                onClick={() => handleTileClick(r, c)}
                                role="button"
                                tabIndex={0}
                                aria-label={`Tile at row ${r+1}, column ${c+1}. Type: ${TileType[tile.type]}. Press to rotate.`}
                                style={isWon && distanceMap[r]?.[c] > -1 ? { '--animation-delay': `${distanceMap[r][c] * 50}ms` } as React.CSSProperties : undefined}
                            >
                                <svg
                                    className="tile-svg"
                                    viewBox="0 0 100 100"
                                    style={{ transform: `rotate(${tile.rotation * 90}deg)` }}
                                >
                                    <TileIcon 
                                        type={tile.type} 
                                        connected={tile.connected}
                                        isServer={tile.isServer}
                                    />
                                </svg>
                            </div>
                        ))
                    )}
                </div>
                <div className={`win-message ${isWon ? 'visible' : ''}`}>
                    <p>System Connected!</p>
                </div>
            </div>
        </div>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
